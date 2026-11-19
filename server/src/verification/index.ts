// Scrape Western's listings, save them, and update Western Verified badges. Used by the admin route
// and by `npm run scrape:western -w server`.
import type { Pool } from 'pg';
import { createFetcher, type FetcherOptions } from './fetcher.ts';
import { scrapeWestern } from './scrape.ts';
import { finishRun, saveScrape, startRun } from './sync.ts';

export { verifyListing, recentRuns, failStaleRuns } from './sync.ts';

let running: Promise<unknown> | null = null;

export const isRunning = () => running !== null;

export interface RunOptions extends Partial<FetcherOptions> {
  log?: (msg: string) => void;
}

export async function runWesternVerification(pool: Pool, options: RunOptions = {}) {
  if (running) throw new Error('A Western scrape is already running');
  const log = options.log ?? (() => {});
  const contact = options.contact ?? process.env.SCRAPER_CONTACT;
  if (!contact)
    throw new Error('Set SCRAPER_CONTACT in server/.env (an email Western can reach us at)');

  const job = (async () => {
    const runId = await startRun(pool);
    try {
      const result = await scrapeWestern(createFetcher({ ...options, contact }), log);
      const { complete, verified } = await saveScrape(pool, result);
      if (result.skipped.length)
        log(`skipped ${result.skipped.length} cards: ${result.skipped.slice(0, 5).join('; ')}`);
      if (!complete)
        log(`only got ${result.listings.length} of ${result.total}; kept existing badges`);
      log(`done: ${result.listings.length} Western listings, ${verified} of ours verified`);
      await finishRun(pool, runId, {
        status: 'done',
        pages: result.pages,
        seen: result.listings.length,
        verified,
      });
      return {
        runId,
        pages: result.pages,
        seen: result.listings.length,
        total: result.total,
        complete,
        verified,
      };
    } catch (err) {
      await finishRun(pool, runId, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  })();

  running = job;
  try {
    return await job;
  } finally {
    running = null;
  }
}
