// Admin-only: start a Western scrape and see past runs.
import { Router, type RequestHandler } from 'express';
import type { Pool } from 'pg';
import { requireRole } from '../auth/middleware.ts';
import { isRunning, recentRuns, runWesternVerification } from '../verification/index.ts';

interface Deps {
  pool: Pool;
  /** requireAuth middleware (sets req.user). */
  auth: RequestHandler;
  /** Swappable for tests. */
  run?: typeof runWesternVerification;
}

export function verificationRouter({ pool, auth, run = runWesternVerification }: Deps): Router {
  const router = Router();
  router.use(auth, requireRole('admin'));

  // POST /api/verification/scrape: starts a run and returns right away; it takes about a minute.
  router.post('/scrape', (_req, res) => {
    if (isRunning()) {
      res.status(409).json({ error: 'already_running', message: 'A scrape is already running.' });
      return;
    }
    run(pool, { log: (msg) => console.log(`[western] ${msg}`) }).catch((err) =>
      console.error('[western] scrape failed:', err instanceof Error ? err.message : err),
    );
    res.status(202).json({ started: true });
  });

  // GET /api/verification/runs: the last 10 runs, newest first.
  router.get('/runs', async (_req, res) => {
    res.json({ running: isRunning(), runs: await recentRuns(pool) });
  });

  return router;
}
