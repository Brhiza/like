import { json } from '../../_lib/auth.js';
import { updateSponsors } from '../../_lib/github.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalize(input, { existingId }) {
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
  const id = (input.id ? String(input.id).trim() : '') || existingId;

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

export async function onRequestPut({ request, params, env }) {
  const id = decodeURIComponent(params.id);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, { status: 400 }); }

  let rec;
  try { rec = normalize(body, { existingId: id }); } catch (e) { return json({ error: e.message }, { status: 400 }); }

  try {
    await updateSponsors(env, (data) => {
      data.sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
      const idx = data.sponsors.findIndex(r => r.id === id);
      if (idx === -1) throw new Error(`记录 ${id} 不存在`);
      if (rec.id !== id && data.sponsors.some(r => r.id === rec.id)) {
        throw new Error(`记录 ${rec.id} 已存在`);
      }
      data.sponsors[idx] = rec;
      sortSponsors(data.sponsors);
    }, `chore: update sponsor ${rec.name} (${rec.date})`);
    return json({ ok: true, sponsor: rec });
  } catch (e) {
    return json({ error: e.message }, { status: 400 });
  }
}

export async function onRequestDelete({ params, env }) {
  const id = decodeURIComponent(params.id);
  try {
    await updateSponsors(env, (data) => {
      data.sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
      const before = data.sponsors.length;
      data.sponsors = data.sponsors.filter(r => r.id !== id);
      if (data.sponsors.length === before) throw new Error(`记录 ${id} 不存在`);
    }, `chore: delete sponsor ${id}`);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, { status: 400 });
  }
}
