// Western Verified against a real Postgres database: saving scrapes and setting badges.
// Skipped unless TEST_DATABASE_URL is set. Use a THROWAWAY Neon branch with migrations applied (see
// listings.db.test.ts). It replaces everything in western_listings, so never point it at production.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express, { type RequestHandler } from 'express';
import pg from 'pg';
import { listingsRouter } from '../src/routes/listings.ts';
import { errorHandler } from '../src/errors.ts';
import { saveScrape, startRun, finishRun, recentRuns } from '../src/verification/sync.ts';
import type { WesternListing } from '../src/verification/western.ts';
import { sampleListing } from './fixtures.ts';

const url = process.env.TEST_DATABASE_URL;

function western(westernId: number, address: string): WesternListing {
  return {
    westernId,
    address,
    area: 'Old North',
    price: 900,
    pricePerRoom: true,
    plusUtilities: false,
    bedroomsVacant: 4,
    availableFrom: '2027-05-01',
  };
}

describe('Western Verified (database)', { skip: !url && 'TEST_DATABASE_URL not set' }, () => {
  let pool: pg.Pool;
  let server: Server;
  let base: string;
  const landlord = randomUUID();

  const fakeAuth: RequestHandler = (req, _res, next) => {
    req.user = { id: landlord, email: 'landlord@test.local', name: 'Test', role: 'landlord' };
    next();
  };

  const post = async (streetAddress?: string) => {
    const res = await fetch(`${base}/listings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleListing({ kind: 'lease', availableTo: undefined, ...(streetAddress ? { streetAddress } : {}) })),
    });
    assert.equal(res.status, 201);
    return res.json() as Promise<{ id: string; westernVerified: boolean; streetAddress?: string }>;
  };

  const verified = async (id: string) =>
    (await pool.query<{ western_verified: boolean }>('SELECT western_verified FROM listings WHERE id = $1', [id])).rows[0]!
      .western_verified;

  before(async () => {
    pool = new pg.Pool({
      connectionString: url,
      ssl: url!.includes('sslmode=disable') ? false : { rejectUnauthorized: true },
    });
    await pool.query(
      `INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Test', $2, true, now(), now())`,
      [landlord, `${landlord}@test.local`],
    );
    await pool.query(`INSERT INTO profiles (user_id, role) VALUES ($1, 'landlord')`, [landlord]);
    await pool.query('DELETE FROM western_listings');

    const app = express().use(express.json());
    app.use('/api/listings', listingsRouter({ pool, auth: fakeAuth }));
    app.use(errorHandler);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  after(async () => {
    server?.close();
    if (pool) {
      await pool.query('DELETE FROM western_listings');
      await pool.query(`DELETE FROM neon_auth."user" WHERE id = $1`, [landlord]);
      await pool.end();
    }
  });

  let onWestern: string;
  let notOnWestern: string;

  test('a complete scrape badges listings whose street address Western lists', async () => {
    onWestern = (await post('1066 Richmond Street')).id;
    notOnWestern = (await post('20 Alma St')).id;
    const noNumber = (await post()).id;

    const result = await saveScrape(pool, {
      listings: [western(1, '1066 Richmond St'), western(2, 'Regent&Harrison'), western(3, '9 Oxford St E')],
      pages: 1,
      total: 3,
      skipped: [],
    });
    assert.deepEqual(result, { complete: true, verified: 1 });
    assert.equal(await verified(onWestern), true);
    assert.equal(await verified(notOnWestern), false);
    assert.equal(await verified(noNumber), false);
  });

  test('the street address is never returned by the API', async () => {
    const res = await fetch(`${base}/listings/${onWestern}`);
    const listing = await res.json();
    assert.equal(listing.westernVerified, true);
    assert.equal('streetAddress' in listing, false);
  });

  test('a new listing already on Western’s list is badged right away', async () => {
    const listing = await post('9 Oxford Street East');
    assert.equal(listing.westernVerified, true);
    assert.equal(listing.streetAddress, undefined);
  });

  test('fixing the street address with PATCH re-checks the badge', async () => {
    const res = await fetch(`${base}/listings/${notOnWestern}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streetAddress: '1066 Richmond St' }),
    });
    assert.equal((await res.json()).westernVerified, true);
  });

  test('an incomplete scrape adds what it saw but takes no badges away', async () => {
    const result = await saveScrape(pool, { listings: [western(4, '20 Alma St')], pages: 1, total: 100, skipped: [] });
    assert.equal(result.complete, false);
    assert.equal(await verified(onWestern), true);
    const { rows } = await pool.query('SELECT western_id FROM western_listings ORDER BY western_id');
    assert.deepEqual(rows.map((r) => r.western_id), [1, 2, 3, 4]);
  });

  test('a complete scrape without the ad removes the badge', async () => {
    await saveScrape(pool, { listings: [western(3, '9 Oxford St E')], pages: 1, total: 1, skipped: [] });
    assert.equal(await verified(onWestern), false);
    const { rows } = await pool.query('SELECT western_id FROM western_listings');
    assert.deepEqual(rows.map((r) => r.western_id), [3]);
  });

  test('runs are recorded', async () => {
    const id = await startRun(pool);
    await finishRun(pool, id, { status: 'done', pages: 21, seen: 1003, verified: 1 });
    const [run] = await recentRuns(pool, 1);
    assert.equal(run.id, id);
    assert.equal(run.status, 'done');
    assert.equal(run.seen, 1003);
  });
});
