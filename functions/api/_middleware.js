// Auth middleware for /api/*. Skips public routes (login).
import { getSession, unauthorized } from '../_lib/auth.js';

const PUBLIC_ROUTES = new Set(['/api/login', '/api/logout']);

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (PUBLIC_ROUTES.has(url.pathname)) {
    return next();
  }

  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'admin not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await getSession(request, env);
  if (!session) return unauthorized();

  return next();
}
