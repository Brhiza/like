import { json } from '../_lib/auth.js';
import { updateDonations } from '../_lib/github.js';

const MAX_BATCH = 50;

function normalize(input) {
  const required = ['name', 'project', 'foundation', 'date', 'cert_no', 'image'];
  for (const k of required) {
    if (!input?.[k] || String(input[k]).trim() === '') {
      throw new Error(`字段 ${k} 不能为空`);
    }
  }
  const amount = (input.amount === '' || input.amount == null) ? null : Number(input.amount);
  if (amount != null && Number.isNaN(amount)) throw new Error('金额格式错误');

  return {
    id: String(input.id || input.cert_no).trim(),
    name: String(input.name).trim(),
    project: String(input.project).trim(),
    foundation: String(input.foundation).trim(),
    amount,
    amount_unit: '元',
    effect: input.effect ? String(input.effect).trim() : null,
    foundation_logo: input.foundation_logo || undefined,
    date: String(input.date).trim(),
    cert_no: String(input.cert_no).trim(),
    image: String(input.image).trim(),
  };
}

function sortRecords(list) {
  list.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return String(b.cert_no).localeCompare(String(a.cert_no));
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, { status: 400 }); }

  // ===== Batch mode =====
  if (Array.isArray(body?.records)) {
    const list = body.records;
    if (list.length === 0) return json({ error: '记录列表为空' }, { status: 400 });
    if (list.length > MAX_BATCH) {
      return json({ error: `单次最多 ${MAX_BATCH} 条` }, { status: 400 });
    }

    let recs;
    try {
      recs = list.map((r, i) => {
        try { return normalize(r); }
        catch (e) { throw new Error(`第 ${i + 1} 条:${e.message}`); }
      });
    } catch (e) {
      return json({ error: e.message }, { status: 400 });
    }

    // Reject duplicate ids within this batch
    const seen = new Set();
    for (let i = 0; i < recs.length; i++) {
      const id = recs[i].id;
      if (seen.has(id)) {
        return json({ error: `第 ${i + 1} 条:证书编号 ${id} 与本次提交中其他条目重复` }, { status: 400 });
      }
      seen.add(id);
    }

    try {
      const updated = await updateDonations(env, (data) => {
        data.records = Array.isArray(data.records) ? data.records : [];
        for (const rec of recs) {
          if (data.records.some(r => r.id === rec.id)) {
            throw new Error(`证书编号 ${rec.id} 已存在`);
          }
        }
        data.records.unshift(...recs);
        sortRecords(data.records);
      }, recs.length === 1
        ? `feat: add donation ${recs[0].cert_no}`
        : `feat: add ${recs.length} donations`);
      return json({ ok: true, added: recs.length, count: updated.count });
    } catch (e) {
      return json({ error: e.message }, { status: 400 });
    }
  }

  // ===== Single mode =====
  let rec;
  try { rec = normalize(body); } catch (e) { return json({ error: e.message }, { status: 400 }); }

  try {
    const updated = await updateDonations(env, (data) => {
      data.records = Array.isArray(data.records) ? data.records : [];
      if (data.records.some(r => r.id === rec.id)) {
        throw new Error(`证书编号 ${rec.id} 已存在`);
      }
      data.records.unshift(rec);
      sortRecords(data.records);
    }, `feat: add donation ${rec.cert_no}`);
    return json({ ok: true, record: rec, count: updated.count });
  } catch (e) {
    return json({ error: e.message }, { status: 400 });
  }
}
