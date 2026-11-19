// Saves a scrape and sets Western Verified on our listings whose street address is on Western's list.
import type { Pool, PoolClient } from 'pg';
import { parseAddress, sameAddress, type ParsedAddress } from './address.ts';
import type { ScrapeResult } from './scrape.ts';
import type { WesternListing } from './western.ts';

/** A scrape with fewer than this share of Western's own count is treated as broken: nothing gets un-verified. */
export const COMPLETE_SHARE = 0.9;

function streetOnly(raw: string): ParsedAddress | null {
  const parsed = parseAddress(raw);
  return parsed.kind === 'street' ? parsed.address : null;
}

/** Ids of our listings whose street address matches any Western listing. Intersections never match. */
export function matchListings(
  western: Pick<WesternListing, 'address'>[],
  ours: { id: string; streetAddress: string | null }[],
): Set<string> {
  const theirs = western
    .map((w) => streetOnly(w.address))
    .filter((a): a is ParsedAddress => a !== null);
  const matched = new Set<string>();
  for (const listing of ours) {
    const mine = listing.streetAddress ? streetOnly(listing.streetAddress) : null;
    if (mine && theirs.some((t) => sameAddress(mine, t))) matched.add(listing.id);
  }
  return matched;
}

export function isComplete(result: Pick<ScrapeResult, 'listings' | 'total'>): boolean {
  return result.total > 0 && result.listings.length >= result.total * COMPLETE_SHARE;
}

async function upsertWestern(client: PoolClient, listings: WesternListing[], seenAt: Date) {
  if (!listings.length) return;
  const col = <K extends keyof WesternListing>(key: K) => listings.map((l) => l[key]);
  await client.query(
    `INSERT INTO western_listings
       (western_id, address, area, price, price_per_room, plus_utilities, bedrooms_vacant, available_from, first_seen_at, last_seen_at)
     SELECT *, $9::timestamptz, $9::timestamptz FROM unnest(
       $1::int[], $2::text[], $3::text[], $4::int[], $5::bool[], $6::bool[], $7::int[], $8::date[])
     ON CONFLICT (western_id) DO UPDATE SET
       address = EXCLUDED.address, area = EXCLUDED.area, price = EXCLUDED.price,
       price_per_room = EXCLUDED.price_per_room, plus_utilities = EXCLUDED.plus_utilities,
       bedrooms_vacant = EXCLUDED.bedrooms_vacant, available_from = EXCLUDED.available_from,
       last_seen_at = EXCLUDED.last_seen_at`,
    [
      col('westernId'),
      col('address'),
      col('area'),
      col('price'),
      col('pricePerRoom'),
      col('plusUtilities'),
      col('bedroomsVacant'),
      col('availableFrom'),
      seenAt,
    ],
  );
}

/** Recomputes western_verified for every listing (or just `onlyId`) from what's in western_listings. */
async function applyVerification(client: PoolClient | Pool, onlyId?: string): Promise<number> {
  const { rows: western } = await client.query<{ address: string }>(
    'SELECT address FROM western_listings',
  );
  const { rows: ours } = await client.query<{ id: string; street_address: string | null }>(
    `SELECT id, street_address FROM listings ${onlyId ? 'WHERE id = $1' : ''}`,
    onlyId ? [onlyId] : [],
  );
  const matched = matchListings(
    western,
    ours.map((r) => ({ id: r.id, streetAddress: r.street_address })),
  );
  await client.query(
    `UPDATE listings SET western_verified = (id = ANY($1::uuid[]))
     WHERE western_verified IS DISTINCT FROM (id = ANY($1::uuid[])) ${onlyId ? 'AND id = $2' : ''}`,
    onlyId ? [[...matched], onlyId] : [[...matched]],
  );
  return matched.size;
}

/**
 * Saves the scrape. If it looks complete, Western listings we didn't see are dropped and every badge is
 * recomputed (so badges come off when an ad leaves Western's site). If it looks incomplete, we only add
 * what we saw and leave existing badges alone.
 */
export async function saveScrape(pool: Pool, result: ScrapeResult, seenAt = new Date()) {
  const complete = isComplete(result);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertWestern(client, result.listings, seenAt);
    if (complete)
      await client.query('DELETE FROM western_listings WHERE last_seen_at < $1', [seenAt]);
    const verified = complete
      ? await applyVerification(client)
      : (
          await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM listings WHERE western_verified',
          )
        ).rows[0]!.n;
    await client.query('COMMIT');
    return { complete, verified };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** After a listing is posted or its street address changes: badge it now if Western already lists it. */
export async function verifyListing(pool: Pool, listingId: string): Promise<boolean> {
  return (await applyVerification(pool, listingId)) > 0;
}

// Run history, for GET /api/verification/runs.

export async function startRun(pool: Pool): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO verification_runs DEFAULT VALUES RETURNING id`,
  );
  return rows[0]!.id;
}

export async function finishRun(
  pool: Pool,
  id: string,
  outcome: {
    status: 'done' | 'failed';
    pages?: number;
    seen?: number;
    verified?: number;
    error?: string;
  },
) {
  await pool.query(
    `UPDATE verification_runs SET finished_at = now(), status = $2, pages = $3, seen = $4, verified = $5, error = $6
     WHERE id = $1`,
    [
      id,
      outcome.status,
      outcome.pages ?? 0,
      outcome.seen ?? 0,
      outcome.verified ?? 0,
      outcome.error ?? null,
    ],
  );
}

export async function recentRuns(pool: Pool, limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, source, started_at AS "startedAt", finished_at AS "finishedAt", status, pages, seen, verified, error
     FROM verification_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Marks runs left 'running' by a crashed or restarted server as failed. */
export async function failStaleRuns(pool: Pool) {
  await pool.query(
    `UPDATE verification_runs SET status = 'failed', finished_at = now(), error = 'server stopped during the run'
     WHERE status = 'running' AND started_at < now() - interval '30 minutes'`,
  );
}
