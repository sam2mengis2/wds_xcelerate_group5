// Western Verified scraper tests. No network and no database: pages come from test/fixtures.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { parseAddress, sameAddress, type ParsedAddress } from '../src/verification/address.ts';
import {
  parseAvailable,
  parseListingsPage,
  parsePrice,
  searchFormFields,
  withPage,
} from '../src/verification/western.ts';
import {
  createFetcher,
  robotsAllows,
  ScrapeError,
  type FetchLike,
} from '../src/verification/fetcher.ts';
import { scrapeWestern } from '../src/verification/scrape.ts';
import { isComplete, matchListings } from '../src/verification/sync.ts';
import { verificationRouter } from '../src/routes/verification.ts';
import { errorHandler } from '../src/errors.ts';
import type { Role } from '../src/auth/types.ts';

const PAGE_1 = readFileSync(new URL('./fixtures/western-page-1.html', import.meta.url), 'utf8');

function street(raw: string): ParsedAddress {
  const parsed = parseAddress(raw);
  assert.equal(parsed.kind, 'street', `${raw} should parse as a street address`);
  return (parsed as { kind: 'street'; address: ParsedAddress }).address;
}

describe('parseAddress', () => {
  test('splits number, name, suffix and direction', () => {
    assert.deepEqual(street('307 Fanshawe Park Rd E'), {
      number: '307',
      name: 'fanshawe park',
      suffix: 'rd',
      direction: 'e',
    });
    assert.deepEqual(street('9 Oxford Street East'), {
      number: '9',
      name: 'oxford',
      suffix: 'st',
      direction: 'e',
    });
  });

  test('handles typos, missing suffixes, saints and units', () => {
    assert.equal(street('1548 Richmond Streeet').suffix, 'st');
    assert.deepEqual(street('302 Wharncliffe'), {
      number: '302',
      name: 'wharncliffe',
      suffix: null,
      direction: null,
    });
    assert.equal(street('10 St George Street').name, 'st george');
    assert.equal(street('Unit 4, 23 Partridge St').number, '23');
    assert.equal(street('4-23 Partridge St').number, '23');
    assert.equal(street('23 partridge street, London ON').name, 'partridge');
  });

  test('intersections and junk are not street addresses', () => {
    assert.equal(parseAddress('Regent&Harrison').kind, 'intersection');
    assert.equal(parseAddress('Kensington Ave & Wharncliffe Rd N').kind, 'intersection');
    assert.equal(parseAddress('Richmond and Huron').kind, 'intersection');
    assert.equal(parseAddress('Huron St, Broughdale').kind, 'unknown'); // no house number
  });
});

describe('sameAddress', () => {
  test('matches different spellings of one address', () => {
    assert.ok(sameAddress(street('1548 Richmond Streeet'), street('1548 richmond st.')));
    assert.ok(sameAddress(street('307 Fanshawe Park Road E'), street('307 Fanshawe Park Rd East')));
  });

  test('a missing suffix or direction still matches', () => {
    assert.ok(sameAddress(street('302 Wharncliffe'), street('302 Wharncliffe Rd N')));
  });

  test('different number, name, suffix or direction does not', () => {
    assert.ok(!sameAddress(street('9 Oxford St E'), street('9 Oxford St W')));
    assert.ok(!sameAddress(street('20 Rollscourt Gardens'), street('19 Rollscourt Gardens')));
    assert.ok(!sameAddress(street('15 Mayfair Dr'), street('15 Mayfair Cres')));
    assert.ok(!sameAddress(street('20 Alma St'), street('20 Albert St')));
  });
});

describe('Western page parsing', () => {
  test('prices', () => {
    assert.deepEqual(parsePrice('$850   '), {
      price: 850,
      pricePerRoom: false,
      plusUtilities: false,
    });
    assert.deepEqual(parsePrice('$1050  + per bdrm'), {
      price: 1050,
      pricePerRoom: true,
      plusUtilities: true,
    });
    assert.deepEqual(parsePrice('$1195   per bdrm'), {
      price: 1195,
      pricePerRoom: true,
      plusUtilities: false,
    });
    assert.deepEqual(parsePrice('$2,000  + '), {
      price: 2000,
      pricePerRoom: false,
      plusUtilities: true,
    });
    assert.equal(parsePrice('Call for price'), null);
  });

  test('availability', () => {
    assert.equal(parseAvailable('Available Immediately'), null);
    assert.equal(parseAvailable('Available May 1, 2027'), '2027-05-01');
    assert.equal(parseAvailable('Available December 1, 2026'), '2026-12-01');
    assert.equal(parseAvailable('Available November 15, 2026'), '2026-11-15');
    assert.equal(parseAvailable('Ask the landlord'), undefined);
  });

  test('reads the saved listings page', () => {
    const page = parseListingsPage(PAGE_1);
    assert.equal(page.total, 1003);
    assert.equal(page.first, 1);
    assert.equal(page.perPage, 50);
    assert.deepEqual(page.skipped, []);
    assert.deepEqual(
      page.listings.map((l) => l.westernId).sort(),
      [54619, 61959, 62898, 63633, 63885, 64098, 64110],
    );

    const woodward = page.listings.find((l) => l.westernId === 61959);
    assert.deepEqual(woodward, {
      westernId: 61959,
      address: '49 Woodward Avenue',
      area: 'Near South',
      price: 850,
      pricePerRoom: false,
      plusUtilities: false,
      bedroomsVacant: 5,
      availableFrom: null,
    });
    const richmond = page.listings.find((l) => l.westernId === 63885)!;
    assert.equal(richmond.availableFrom, '2027-05-01');
    assert.equal(richmond.plusUtilities, true);
    assert.equal(page.listings.find((l) => l.westernId === 54619)!.address, 'Regent&Harrison');
  });

  test('a page that is not a listings page reads as empty', () => {
    const page = parseListingsPage('<html><body>Maintenance</body></html>');
    assert.equal(page.total, 0);
    assert.equal(page.listings.length, 0);
  });

  test('the search form is submitted like a browser would', () => {
    const form = searchFormFields(PAGE_1)!;
    assert.equal(form.action, 'https://offcampus.uwo.ca/Listings/SearchListings');
    const body = withPage(form.fields, 3);
    assert.equal(body.get('PageNumber'), '3');
    assert.deepEqual(body.getAll('Desc'), ['true', 'false']); // checkbox + ASP.NET's hidden "false"
    assert.equal(body.get('MaximumRent'), '7000');
    assert.equal(body.get('NumberOfBedrooms'), '0'); // first option of a single select
    assert.deepEqual(body.getAll('SelectedLocations'), []); // nothing picked in a multi select
  });
});

describe('robotsAllows', () => {
  const robots = `
User-agent: *
Disallow: /admin/
Disallow: /Listings/Private
Allow: /Listings/Private/ok

User-agent: knockbot
Disallow: /secret
`;
  test('applies the * group when no group names us', () => {
    assert.ok(robotsAllows(robots, '/listings/', 'otherbot'));
    assert.ok(!robotsAllows(robots, '/admin/page', 'otherbot'));
    assert.ok(robotsAllows(robots, '/Listings/Private/ok', 'otherbot')); // longer Allow wins
  });

  test('our own group replaces the * group', () => {
    assert.ok(!robotsAllows(robots, '/secret/x'));
    assert.ok(robotsAllows(robots, '/admin/page'));
  });

  test('empty or missing robots.txt allows everything', () => {
    assert.ok(robotsAllows('', '/anything'));
    assert.ok(robotsAllows('User-agent: *\nDisallow:', '/anything'));
  });
});

/** Page N of a fake 3-page site built from the fixture. */
function fakePage(page: number, total = 120) {
  const first = page * 50 + 1;
  const last = Math.min(first + 49, total);
  return PAGE_1.replace(
    /Search results: 1 - 50 \(of 1003\)/,
    `Search results: ${first} - ${last} (of ${total})`,
  ).replace(
    /\/Listings\/Details\/(\d+)/g,
    (_m, id) => `/Listings/Details/${Number(id) + page * 100_000}`,
  );
}

function fakeSite(
  opts: { robots?: string; pageFor?: (n: number) => string; status?: number } = {},
) {
  const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    const body = init.body ? String(init.body) : '';
    calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body });
    if (url.endsWith('/robots.txt')) {
      return opts.robots === undefined
        ? new Response('not found', { status: 404 })
        : new Response(opts.robots);
    }
    if (opts.status) return new Response('busy', { status: opts.status });
    const page = init.method === 'POST' ? Number(new URLSearchParams(body).get('PageNumber')) : 0;
    return new Response((opts.pageFor ?? fakePage)(page), {
      headers: { 'Set-Cookie': 'ASP.NET_SessionId=abc123; path=/; HttpOnly' },
    });
  };
  const sleeps: number[] = [];
  const fetcher = createFetcher({
    contact: 'team@example.com',
    fetch,
    delayMs: 2000,
    sleep: async (ms) => void sleeps.push(ms),
  });
  return { calls, sleeps, fetcher };
}

describe('scrapeWestern', () => {
  test('walks every page and collects unique listings', async () => {
    const { calls, sleeps, fetcher } = fakeSite();
    const result = await scrapeWestern(fetcher);
    assert.equal(result.pages, 3);
    assert.equal(result.total, 120);
    assert.equal(result.listings.length, 21); // 7 cards x 3 pages, ids made unique per page

    const pages = calls.filter((c) => !c.url.endsWith('robots.txt'));
    assert.deepEqual(
      pages.map((c) => c.method),
      ['GET', 'POST', 'POST'],
    );
    assert.deepEqual(
      pages.slice(1).map((c) => new URLSearchParams(c.body).get('PageNumber')),
      ['1', '2'],
    );
    assert.match(pages[0]!.headers.get('user-agent')!, /KnockBot.*team@example\.com/);
    assert.equal(pages[1]!.headers.get('cookie'), 'ASP.NET_SessionId=abc123'); // session kept like a browser
    assert.ok(sleeps.length >= 2, 'waits between requests');
  });

  test('stops if a page request returns the wrong page', async () => {
    const { fetcher } = fakeSite({ pageFor: () => fakePage(0) });
    await assert.rejects(scrapeWestern(fetcher), /Asked for page 2/);
  });

  test('stops if the site no longer looks like the listings page', async () => {
    const { fetcher } = fakeSite({ pageFor: () => '<html>New design</html>' });
    await assert.rejects(scrapeWestern(fetcher), /Has the site changed/);
  });

  test('respects robots.txt', async () => {
    const { calls, fetcher } = fakeSite({ robots: 'User-agent: *\nDisallow: /listings' });
    await assert.rejects(scrapeWestern(fetcher), ScrapeError);
    assert.equal(calls.length, 1, 'only robots.txt was fetched');
  });

  test('backs off when the site says it is busy', async () => {
    const { fetcher } = fakeSite({ status: 429 });
    await assert.rejects(scrapeWestern(fetcher), /slow down/);
  });
});

describe('matching our listings', () => {
  const western = parseListingsPage(PAGE_1).listings;

  test('matches by street address, ignoring spelling', () => {
    const matched = matchListings(western, [
      { id: 'a', streetAddress: '1548 Richmond St' }, // Western: "1548 Richmond Streeet"
      { id: 'b', streetAddress: '302 Wharncliffe Rd N' }, // Western: "302 Wharncliffe"
      { id: 'c', streetAddress: '9 Oxford St E' }, // Western: "9 Oxford Street East"
      { id: 'd', streetAddress: '9 Oxford St W' },
      { id: 'e', streetAddress: '50 Woodward Ave' },
      { id: 'f', streetAddress: null },
      { id: 'g', streetAddress: 'Regent St & Harrison Ave' },
    ]);
    assert.deepEqual([...matched].sort(), ['a', 'b', 'c']);
  });

  test('a scrape well short of Western’s count is incomplete', () => {
    assert.ok(isComplete({ listings: new Array(1000), total: 1003 }));
    assert.ok(!isComplete({ listings: new Array(400), total: 1003 }));
    assert.ok(!isComplete({ listings: [], total: 0 }));
  });
});

describe('verification routes', () => {
  async function serve(role: Role | null) {
    let runs = 0;
    const auth: RequestHandler = (req, res, next) => {
      if (!role) return void res.status(401).json({ error: 'not_signed_in' });
      req.user = { id: 'u1', email: 'a@uwo.ca', name: 'A', role };
      next();
    };
    const pool = {
      query: async () => ({ rows: [{ id: 'r1', status: 'done' }] }),
    } as unknown as Pool;
    const run = (async () => {
      runs++;
      return {} as never;
    }) as never;
    const app = express().use(express.json());
    app.use('/api/verification', verificationRouter({ pool, auth, run }));
    app.use(errorHandler);
    const server = app.listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}/api/verification`;
    return { base, server, runs: () => runs };
  }

  test('admins can start a scrape and see runs', async () => {
    const { base, server, runs } = await serve('admin');
    try {
      assert.equal((await fetch(`${base}/scrape`, { method: 'POST' })).status, 202);
      assert.equal(runs(), 1);
      const body = await (await fetch(`${base}/runs`)).json();
      assert.equal(body.runs[0].status, 'done');
    } finally {
      server.close();
    }
  });

  test('students, landlords and signed-out users cannot', async () => {
    for (const role of ['student', 'landlord', null] as const) {
      const { base, server, runs } = await serve(role);
      try {
        const res = await fetch(`${base}/scrape`, { method: 'POST' });
        assert.equal(res.status, role ? 403 : 401);
        assert.equal(runs(), 0);
      } finally {
        server.close();
      }
    }
  });
});
