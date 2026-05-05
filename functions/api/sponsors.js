import { json } from '../_lib/auth.js';
import { updateSponsors } from '../_lib/github.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function genId(seed) {
  const bytes = new TextEncoder().encode(seed);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `sp_${hex.slice(0, 10)}`;
}

async function normalize(input, { existingId } = {}) {
  if (!input?.name || String(input.name).trim() === '') throw new Error('字段 name 不能为空');
  if (input.amount === '' || input.amount == null) throw new Error('字段 amount 不能为空');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('金额格式错误');
  if (!input.date || !DATE_RE.test(String(input.date).trim())) throw new Error('日期格式应为 YYYY-MM-DD');

  const name = String(input.name).trim();
  const date = String(input.date).trim();
  const message = input.message == null || String(input.message).trim() === ''
    ? null
    : String(input.message).trim();

  let id = existingId || (input.id ? String(input.id).trim() : '');
  if (!id) id = await genId(`${name}|${date}|${amount}|${Date.now()}|${Math.random()}`);

  return {
    id,
    name,
    amount: Number(amount.toFixed(2)),
    date,
    message,
  };
}

function sortSponsors(list) {
  list.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (Number(b.amount) || 0) - (Number(a.amount) || 0);
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, { status: 400 }); }
  let rec;
  try { rec = await normalize(body); } catch (e) { return json({ error: e.message }, { status: 400 }); }

  try {
    const updated = await updateSponsors(env, (data) => {
      data.sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
      if (data.sponsors.some(r => r.id === rec.id)) {
        throw new Error(`记录 ${rec.id} 已存在`);
      }
      data.sponsors.push(rec);
      sortSponsors(data.sponsors);
    }, `feat: add sponsor ${rec.name} (${rec.date})`);
    return json({ ok: true, sponsor: rec, count: updated.count });
  } catch (e) {
    return json({ error: e.message }, { status: 400 });
  }
}
