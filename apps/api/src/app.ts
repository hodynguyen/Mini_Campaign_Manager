/**
 * Express app factory.
 *
 * createApp() returns a configured Express instance WITHOUT calling listen().
 * Tests import this (supertest needs the app, not a live socket); index.ts
 * owns the actual `listen` call.
 *
 * Middleware order (matters):
 *   helmet  -> security headers first
 *   cors    -> CORS preflight + headers (env-driven allowlist)
 *   morgan  -> request logger
 *   express.json -> body parser
 *   /auth, /health -> routes
 *   errorHandler -> LAST (4-arg signature; Express recognizes by arity)
 *
 * F2 changes vs F1:
 *   - cors() locked to env.CORS_ORIGINS allowlist (not wildcard).
 *   - /auth router mounted (register/login).
 *   - Inline 500 handler replaced with the rich `errorHandler` from
 *     ./errors/handler (Zod / AppError / Sequelize / JWT dispatch table).
 */
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import authRouter from './auth/routes';
import { env } from './config/env';
import { errorHandler } from './errors/handler';
import healthRouter from './routes/health';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: false,
    }),
  );
  app.use(morgan('dev'));
  // Cap request bodies. Express's default limit is 100kb but documenting it
  // explicitly here pins the contract so future changes don't silently raise
  // it (DOS surface). All current endpoints accept tiny JSON payloads
  // (auth credentials, campaign metadata).
  app.use(express.json({ limit: '100kb' }));

  // Routes
  app.use('/auth', authRouter);
  app.use('/health', healthRouter);

  // Global error handler — must be last and must have the 4-arg signature so
  // Express dispatches errors here. See ./errors/handler for the dispatch
  // table (Zod / AppError / UniqueConstraintError / JWT errors / fallback).
  app.use(errorHandler);

  return app;
}
