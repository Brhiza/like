import { json } from '../_lib/auth.js';
import { updateSponsors } from '../_lib/github.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BATCH = 50;

async function genId(seed) {
  const bytes = new TextEncoder().encode(seed);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `sp_${hex.slice(0, 10)}`;
}

async function normalize(input, { existingId } = {}) {
  if (input.amount === '' || input.amount == null) throw new Error('字段 amount 不能为空');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('金额格式错误');
  if (!input.date || !DATE_RE.test(String(input.date).trim())) throw new Error('日期格式应为 YYYY-MM-DD');

  const name = String(input?.name ?? '').trim() || '匿名';
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

  // ===== Batch mode =====
  if (Array.isArray(body?.sponsors)) {
    const list = body.sponsors;
    if (list.length === 0) return json({ error: '记录列表为空' }, { status: 400 });
    if (list.length > MAX_BATCH) {
      return json({ error: `单次最多 ${MAX_BATCH} 条` }, { status: 400 });
    }

    let recs;
    try {
      recs = [];
      for (let i = 0; i < list.length; i++) {
        try {
          recs.push(await normalize(list[i]));
        } catch (e) {
          throw new Error(`第 ${i + 1} 条:${e.message}`);
        }
      }
    } catch (e) {
      return json({ error: e.message }, { status: 400 });
    }

    // Ensure batch-internal id uniqueness (re-generate if collision; rare)
    const seen = new Set();
    for (let i = 0; i < recs.length; i++) {
      while (seen.has(recs[i].id)) {
        recs[i].id = await genId(`${recs[i].name}|${recs[i].date}|${recs[i].amount}|${i}|${Math.random()}`);
      }
      seen.add(recs[i].id);
    }

    try {
      const updated = await updateSponsors(env, (data) => {
        data.sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
        for (const rec of recs) {
          if (data.sponsors.some(r => r.id === rec.id)) {
            throw new Error(`记录 ${rec.id} 已存在`);
          }
        }
        data.sponsors.push(...recs);
        sortSponsors(data.sponsors);
      }, recs.length === 1
        ? `feat: add sponsor ${recs[0].name} (${recs[0].date})`
        : `feat: add ${recs.length} sponsors`);
      return json({ ok: true, added: recs.length, count: updated.count });
    } catch (e) {
      return json({ error: e.message }, { status: 400 });
    }
  }

  // ===== Single mode =====
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
