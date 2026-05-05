import { issueSessionCookie, json } from '../_lib/auth.js';

// Constant-time string compare to mitigate timing leaks on the password check.
function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: '管理面板未配置 (ADMIN_PASSWORD / SESSION_SECRET)' }, { status: 500 });
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, { status: 400 }); }
  const password = String(body?.password ?? '');
  if (!safeEq(password, String(env.ADMIN_PASSWORD))) {
    return json({ error: '密码错误' }, { status: 401 });
  }
  const cookie = await issueSessionCookie(env, request, { admin: true });
  return json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
}
