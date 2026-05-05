import { clearCookieHeader, json } from '../_lib/auth.js';

export async function onRequestPost({ request }) {
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookieHeader(request) } });
}
