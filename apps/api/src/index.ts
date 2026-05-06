/**
 * Process entrypoint for @app/api.
 *
 * Loads env (which validates and exits on failure), constructs the app, and
 * binds the HTTP listener. Tests should import `createApp` directly from
 * `./app` — never this file — so they don't open a real port.
 */
import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.info(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
