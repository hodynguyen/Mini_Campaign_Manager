/**
 * Liveness probe.
 *
 * F1 scope: just confirms the process is up. Does NOT touch the database.
 * A real readiness probe (with DB ping) is a F2 concern once Sequelize is
 * wired up.
 */
import { Router } from 'express';

const router: Router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({ ok: true });
});

export default router;
