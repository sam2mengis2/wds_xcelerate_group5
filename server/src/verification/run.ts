// npm run scrape:western -w server
// Scrapes Western's Off-Campus Housing listings and updates Western Verified badges. Takes about a minute
// (one page every few seconds). Safe to run on a schedule, e.g. once a day.
import { pool } from '../db.ts';
import { runWesternVerification } from './index.ts';

try {
  await runWesternVerification(pool, { log: (msg) => console.log(msg) });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
