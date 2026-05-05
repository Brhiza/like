import { json } from '../_lib/auth.js';
import { writeFile, getSha } from '../_lib/github.js';

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const ALLOWED_CHANNEL = new Set(['txgy', 'xwgc', 'other', 'uploads']);
const MAX_BYTES = 8 * 1024 * 1024; // 8MB cap
const MAX_DUP_TRIES = 50;

function sanitizeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function withSuffix(name, n) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return `${name}-${n}`;
  return `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, { status: 400 }); }
  const rawName = sanitizeFilename(body?.filename || '');
  const b64 = String(body?.content_base64 || '');
  const channel = ALLOWED_CHANNEL.has(body?.channel) ? body.channel : 'uploads';
  if (!rawName || !b64) return json({ error: '缺少 filename 或 content_base64' }, { status: 400 });

  const ext = (rawName.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return json({ error: '只允许图片格式 (png/jpg/jpeg/gif/webp)' }, { status: 400 });

  const approxBytes = Math.floor(b64.length * 3 / 4);
  if (approxBytes > MAX_BYTES) return json({ error: '文件过大（最大 8MB）' }, { status: 413 });

  const dir = `images/${channel}`;
  let finalName = rawName;
  let path = `${dir}/${finalName}`;

  try {
    // If channel is txgy/xwgc, names follow YYYY-MM-DD pattern; collisions get -2, -3, ...
    if (channel !== 'uploads') {
      for (let n = 2; n <= MAX_DUP_TRIES + 1; n++) {
        const sha = await getSha(env, path);
        if (!sha) break;
        finalName = withSuffix(rawName, n);
        path = `${dir}/${finalName}`;
      }
      if (await getSha(env, path)) {
        return json({ error: `命名冲突过多 (>${MAX_DUP_TRIES})，请检查日期` }, { status: 409 });
      }
    }

    await writeFile(env, path, b64, `chore: upload ${path}`);
    return json({ ok: true, path });
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }
}
