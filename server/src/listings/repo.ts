// SQL for the listings table. Every function takes the pool so tests can point it at any database.
import type { Pool } from 'pg';
import type { ListingInput, ListingKind, ListingPatch, ListingQuery } from './schema.ts';

/** A listing as the API returns it; matches ListingRecord in client/src/data/data.ts. */
/** streetAddress is private: stored for Western matching, never sent back. */
export interface Listing extends Omit<ListingInput, 'availableTo' | 'streetAddress'> {
  id: string;
  availableTo?: string;
  westernVerified: boolean;
  landlordId: string | null;
  postedBy: string;
  postedAt: string;
}

export interface ListingRow {
  id: string;
  kind: ListingKind;
  type: ListingInput['type'];
  name: string;
  description: string;
  price: number;
  lease: number;
  address: string;
  neighbourhood: ListingInput['neighbourhood'];
  beds: number;
  baths: string; // NUMERIC comes back as a string
  rooms_open: number;
  walk_minutes: number;
  bus_minutes: number;
  grocery_minutes: number;
  available_from: string;
  available_to: string | null;
  furnished: boolean;
  utilities_included: boolean;
  amenities: ListingInput['amenities'];
  photos: ListingInput['photos'];
  western_verified: boolean;
  posted_by: string;
  landlord_id: string | null;
  posted_at: Date;
}

/** Dates are selected as text so they stay YYYY-MM-DD with no timezone shifts. */
const COLUMNS = `
  id, kind, type, name, description, price, lease, address, neighbourhood,
  beds, baths, rooms_open, walk_minutes, bus_minutes, grocery_minutes,
  available_from::text AS available_from, available_to::text AS available_to,
  furnished, utilities_included, amenities, photos, western_verified,
  posted_by, landlord_id, posted_at`;

export function toListing(row: ListingRow): Listing {
  const listing: Listing = {
    id: row.id,
    kind: row.kind,
    type: row.type,
    name: row.name,
    description: row.description,
    price: row.price,
    lease: row.lease,
    address: row.address,
    neighbourhood: row.neighbourhood,
    housingDetails: { beds: row.beds, baths: Number(row.baths), roomsOpen: row.rooms_open },
    walkMinutes: row.walk_minutes,
    busMinutes: row.bus_minutes,
    groceryMinutes: row.grocery_minutes,
    availableFrom: row.available_from,
    furnished: row.furnished,
    utilitiesIncluded: row.utilities_included,
    amenities: row.amenities,
    photos: row.photos,
    westernVerified: row.western_verified,
    landlordId: row.landlord_id,
    postedBy: row.posted_by,
    postedAt: row.posted_at.toISOString(),
  };
  if (row.available_to) listing.availableTo = row.available_to;
  return listing;
}

/** Maps API fields to columns. Only fields present in the input are returned, so it works for PATCH too. */
export function toColumns(input: Partial<ListingInput> | ListingPatch): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  const set = (col: string, value: unknown) => {
    if (value !== undefined) cols[col] = value;
  };
  set('kind', 'kind' in input ? input.kind : undefined);
  set('type', input.type);
  set('name', input.name);
  set('description', input.description);
  set('price', input.price);
  set('lease', input.lease);
  set('address', input.address);
  set('street_address', input.streetAddress);
  set('neighbourhood', input.neighbourhood);
  set('beds', input.housingDetails?.beds);
  set('baths', input.housingDetails?.baths);
  set('rooms_open', input.housingDetails?.roomsOpen);
  set('walk_minutes', input.walkMinutes);
  set('bus_minutes', input.busMinutes);
  set('grocery_minutes', input.groceryMinutes);
  set('available_from', input.availableFrom);
  set('available_to', input.availableTo);
  set('furnished', input.furnished);
  set('utilities_included', input.utilitiesIncluded);
  set('amenities', input.amenities);
  set('photos', input.photos === undefined ? undefined : JSON.stringify(input.photos));
  return cols;
}

/** Builds the WHERE clause for GET /api/listings. Values are always passed as parameters. */
export function buildListQuery(q: ListingQuery): { sql: string; params: unknown[] } {
  const where: string[] = [
    // Sublets that have already ended are hidden from search.
    `(kind <> 'sublet' OR available_to >= current_date)`,
  ];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (q.kind) add('kind = ?', q.kind);
  if (q.type) add('type = ?', q.type);
  if (q.neighbourhood) add('neighbourhood = ?', q.neighbourhood);
  if (q.minPrice !== undefined) add('price >= ?', q.minPrice);
  if (q.maxPrice !== undefined) add('price <= ?', q.maxPrice);
  if (q.furnished !== undefined) add('furnished = ?', q.furnished);
  // Date range: the listing must be available for the whole requested period.
  // Leases have no end date, so only their start date matters.
  if (q.from) add('available_from <= ?', q.from);
  if (q.to) add('(available_to IS NULL OR available_to >= ?)', q.to);

  params.push(q.limit, q.offset);
  const sql = `SELECT ${COLUMNS} FROM listings
    WHERE ${where.join(' AND ')}
    ORDER BY posted_at DESC, id
    LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return { sql, params };
}

export async function listListings(pool: Pool, q: ListingQuery): Promise<Listing[]> {
  const { sql, params } = buildListQuery(q);
  const { rows } = await pool.query<ListingRow>(sql, params);
  return rows.map(toListing);
}

export async function getListing(pool: Pool, id: string): Promise<Listing | null> {
  const { rows } = await pool.query<ListingRow>(`SELECT ${COLUMNS} FROM listings WHERE id = $1`, [id]);
  return rows[0] ? toListing(rows[0]) : null;
}

export async function listByPoster(pool: Pool, userId: string): Promise<Listing[]> {
  const { rows } = await pool.query<ListingRow>(
    `SELECT ${COLUMNS} FROM listings WHERE posted_by = $1 ORDER BY posted_at DESC, id`,
    [userId],
  );
  return rows.map(toListing);
}

export const MAX_ACTIVE_SUBLETS = 3;

export type CreateResult = { ok: true; listing: Listing } | { ok: false; reason: 'sublet_limit' };

/**
 * Inserts a listing. For sublets, enforces MAX_ACTIVE_SUBLETS per student inside a transaction
 * with a per-user lock, so two quick posts can't both slip under the limit.
 */
export async function createListing(
  pool: Pool,
  input: ListingInput,
  poster: { id: string },
): Promise<CreateResult> {
  const cols = {
    ...toColumns(input),
    posted_by: poster.id,
    landlord_id: input.kind === 'lease' ? poster.id : null,
  };
  const names = Object.keys(cols);
  const placeholders = names.map((_, i) => `$${i + 1}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.kind === 'sublet') {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sublets:${poster.id}`]);
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM listings
         WHERE posted_by = $1 AND kind = 'sublet' AND available_to >= current_date`,
        [poster.id],
      );
      if (rows[0]!.n >= MAX_ACTIVE_SUBLETS) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'sublet_limit' };
      }
    }
    const { rows } = await client.query<ListingRow>(
      `INSERT INTO listings (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${COLUMNS}`,
      Object.values(cols),
    );
    await client.query('COMMIT');
    return { ok: true, listing: toListing(rows[0]!) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateListing(pool: Pool, id: string, patch: ListingPatch): Promise<Listing | null> {
  const cols = toColumns(patch);
  const names = Object.keys(cols);
  const sets = names.map((name, i) => `${name} = $${i + 2}`);
  const { rows } = await pool.query<ListingRow>(
    `UPDATE listings SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, ...Object.values(cols)],
  );
  return rows[0] ? toListing(rows[0]) : null;
}

export async function deleteListing(pool: Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM listings WHERE id = $1', [id]);
}
