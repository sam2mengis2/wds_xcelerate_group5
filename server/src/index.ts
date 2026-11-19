import express from 'express';
import { groupsRouter } from './routes/groups.ts';
import cors from 'cors';
import { pool } from './db.ts';
import { auth } from './auth/index.ts';
import { authRouter } from './routes/auth.ts';
import { listingsRouter, meRouter } from './routes/listings.ts';
import { errorHandler } from './errors.ts';
import { verificationRouter } from './routes/verification.ts';
import { failStaleRuns } from './verification/index.ts';

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.use('/api/auth', authRouter(auth));
app.use('/api/listings', listingsRouter({ pool, auth }));
app.use('/api/me', meRouter({ pool, auth }));
app.use('/api/groups', groupsRouter({ pool, auth }));
app.use('/api/verification', verificationRouter({ pool, auth }));

// A run that was in progress when the server last stopped will never finish.
failStaleRuns(pool).catch((err) => console.error('Could not tidy verification runs:', err));

app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
