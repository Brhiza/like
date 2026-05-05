import { json } from '../_lib/auth.js';

// The middleware already verified the session. Reaching this means authed.
export async function onRequestGet() {
  return json({ ok: true });
}
