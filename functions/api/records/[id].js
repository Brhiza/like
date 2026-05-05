import { json } from '../../_lib/auth.js';
import { updateDonations } from '../../_lib/github.js';

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
    date: String(input.date).trim(),
    cert_no: String(input.cert_no).trim(),
    image: String(input.image).trim(),
  };
}

export async function onRequestPut({ request, params, env }) {
  const id = decodeURIComponent(params.id);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, { status: 400 }); }
  let rec;
  try { rec = normalize({ ...body, id: body.id || id }); } catch (e) { return json({ error: e.message }, { status: 400 }); }

  try {
    await updateDonations(env, (data) => {
      data.records = Array.isArray(data.records) ? data.records : [];
      const idx = data.records.findIndex(r => r.id === id);
      if (idx === -1) throw new Error(`记录 ${id} 不存在`);
      // If the id changed (cert_no rename), guard against collision.
      if (rec.id !== id && data.records.some(r => r.id === rec.id)) {
        throw new Error(`证书编号 ${rec.id} 已存在`);
      }
      data.records[idx] = rec;
      data.records.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return String(b.cert_no).localeCompare(String(a.cert_no));
      });
    }, `chore: update donation ${rec.cert_no}`);
    return json({ ok: true, record: rec });
  } catch (e) {
    return json({ error: e.message }, { status: 400 });
  }
}

export async function onRequestDelete({ params, env }) {
  const id = decodeURIComponent(params.id);
  try {
    await updateDonations(env, (data) => {
      data.records = Array.isArray(data.records) ? data.records : [];
      const before = data.records.length;
      data.records = data.records.filter(r => r.id !== id);
      if (data.records.length === before) throw new Error(`记录 ${id} 不存在`);
    }, `chore: delete donation ${id}`);
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message }, { status: 400 });
  }
}
