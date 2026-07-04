/**
 * agent-UI/config.ts — Shared frontend configuration.
 *
 * BACKEND_URL is intentionally empty so that all API calls use relative paths
 * (e.g. `/api/chat`).  All paths passed to `apiTransport` already start with
 * `/api/`, so no prefix is needed.  In development, Vite proxies every `/api/*`
 * request to the local backend (see vite.demo.config.ts / vite.config.ts).  In
 * production the demo SPA is served by the same Express server, so same-origin
 * relative paths resolve correctly without any proxy.
 */
export const BACKEND_URL = '';
