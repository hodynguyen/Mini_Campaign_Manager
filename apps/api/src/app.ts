/**
 * Express app factory.
 *
 * createApp() returns a configured Express instance WITHOUT calling listen().
 * This keeps the app importable from tests (supertest needs the app, not a
 * live socket) and from index.ts (which owns the listen call).
 *
 * F1 scope: middleware stack + /health route + a generic error handler.
 * Auth, validation, domain routes land in F2/F3.
 */
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import healthRouter from './routes/health';

export function createApp(): Express {
  const app = express();

  // Security + logging + parsing middleware. Order matters: helmet first for
  // headers, then cors, then logger, then body parser.
  app.use(helmet());
  app.use(cors());
  app.use(morgan('dev'));
  app.use(express.json());

  // Routes
  app.use('/health', healthRouter);

  // Generic 500 handler. F2 will replace this with a richer error mapper
  // (zod validation errors, domain errors, sequelize errors, etc.).
  // The 4-arg signature is required for Express to recognize this as an
  // error-handling middleware — `_next` is intentionally unused.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error('[unhandled error]', err);
    res.status(500).json({
      error: { code: 'INTERNAL', message: 'Internal Server Error' },
    });
  });

  return app;
}
