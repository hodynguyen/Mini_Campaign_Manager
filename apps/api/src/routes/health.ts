/**
 * Liveness + readiness probe.
 *
 * F2: extended to ping the database. Returns:
 *   200 { ok: true,  db: 'up' }     when sequelize.authenticate() succeeds
 *   503 { ok: false, db: 'down' }   when it fails
 *
 * Why 503 (not 500) on DB-down: the API process itself is alive, but it can't
 * serve real traffic. 503 Service Unavailable is the standard "load balancer
 * stop sending me requests" signal.
 */
import { Router } from 'express';

import { pingDatabase } from '../db/sequelize';

const router: Router = Router();

router.get('/', async (_req, res) => {
  const ok = await pingDatabase();
  if (ok) {
    res.status(200).json({ ok: true, db: 'up' });
    return;
  }
  res.status(503).json({ ok: false, db: 'down' });
});

export default router;
