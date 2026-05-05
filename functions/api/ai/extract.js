import { json } from '../../_lib/auth.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const CHANNELS = new Set(['txgy', 'xwgc', 'other']);

function getConfig(env) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  const model = String(env.OPENAI_MODEL || env.OPENAI_VISION_MODEL || '').trim();
  const baseUrl = String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  if (!apiKey || !model) {
    throw new Error('AI 未配置：请设置 OPENAI_API_KEY 和 OPENAI_MODEL');
  }
  return { apiKey, model, baseUrl };
}

function cleanBase64(input) {
  return String(input || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
}

function approxBytesFromBase64(b64) {
  const padding = (b64.match(/=+$/) || [''])[0].length;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function pickMimeType(mimeType) {
  const mime = String(mimeType || '').trim().toLowerCase();
  return ALLOWED_MIME.has(mime) ? mime : null;
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

function extractJsonObject(text) {
  const input = String(text || '').trim();
  if (!input) throw new Error('AI 未返回内容');

  const fence = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) return extractJsonObject(fence[1]);

  const start = input.indexOf('{');
  if (start === -1) throw new Error('AI 返回中没有 JSON 对象');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }

  throw new Error('AI 返回的 JSON 不完整');
}

function asTrimmedString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeAmount(value, amountText) {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
  const text = asTrimmedString(value) || asTrimmedString(amountText);
  if (!text) return null;
  const normalized = text.replace(/[,，\s]/g, '');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
}

function normalizeDate(value) {
  const text = asTrimmedString(value);
  if (!text) return null;
  const direct = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const generic = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  const hit = direct || generic;
  if (!hit) return null;
  const year = hit[1];
  const month = hit[2].padStart(2, '0');
  const day = hit[3].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeChannel(value) {
  const raw = asTrimmedString(value)?.toLowerCase();
  if (!raw) return null;
  if (CHANNELS.has(raw)) return raw;
  if (raw.includes('腾讯')) return 'txgy';
  if (raw.includes('希望')) return 'xwgc';
  return 'other';
}

function normalizeConfidence(value) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return Number(num.toFixed(2));
}

function normalizeDonationResult(data) {
  return {
    name: asTrimmedString(data?.name),
    project: asTrimmedString(data?.project),
    foundation: asTrimmedString(data?.foundation),
    amount: normalizeAmount(data?.amount, data?.amount_text),
    amount_text: asTrimmedString(data?.amount_text),
    amount_unit: data?.amount != null || data?.amount_text ? '元' : null,
    date: normalizeDate(data?.date),
    effect: asTrimmedString(data?.effect),
    cert_no: asTrimmedString(data?.cert_no),
    channel: normalizeChannel(data?.channel),
    confidence: normalizeConfidence(data?.confidence),
    notes: asTrimmedString(data?.notes),
  };
}

function normalizeSponsorResult(data) {
  return {
    name: asTrimmedString(data?.name),
    amount: normalizeAmount(data?.amount, data?.amount_text),
    date: normalizeDate(data?.date),
    message: asTrimmedString(data?.message),
    confidence: normalizeConfidence(data?.confidence),
    notes: asTrimmedString(data?.notes),
  };
}

function buildPrompt(kind) {
  if (kind === 'sponsor') {
    return {
      system: '你是一个严谨的中文图片信息抽取助手，只返回合法 JSON，不要输出解释、Markdown 或代码块。',
      user: [
        '请识别这张赞赏/收款截图，并提取适合管理表单填写的字段。',
        '返回 JSON 对象，字段固定为：',
        '{',
        '  "name": string|null,',
        '  "amount": number|null,',
        '  "amount_text": string|null,',
        '  "date": string|null,',
        '  "message": string|null,',
        '  "confidence": number|null,',
        '  "notes": string|null',
        '}',
        '要求：',
        '- 只返回 JSON 对象。',
        '- date 必须输出 YYYY-MM-DD，无法确定则用 null。',
        '- amount 只保留人民币数字，不带单位；无法判断则 null。',
        '- amount_text 保留截图里的金额文本，如“¥50.00”。',
        '- name 只提取赞赏人/付款人名称或昵称。',
        '- message 只提取留言、附言、备注，没有就 null。',
        '- confidence 为 0 到 1 之间的小数。',
        '- 如果截图不是赞赏/收款记录，尽量提取最接近的字段，并在 notes 说明。',
      ].join('\n'),
    };
  }

  return {
    system: '你是一个严谨的中文公益证书信息抽取助手，只返回合法 JSON，不要输出解释、Markdown 或代码块。',
    user: [
      '请识别这张公益捐赠证书图片，并提取适合管理表单填写的字段。',
      '返回 JSON 对象，字段固定为：',
      '{',
      '  "name": string|null,',
      '  "project": string|null,',
      '  "foundation": string|null,',
      '  "amount": number|null,',
      '  "amount_text": string|null,',
      '  "date": string|null,',
      '  "effect": string|null,',
      '  "cert_no": string|null,',
      '  "channel": "txgy"|"xwgc"|"other"|null,',
      '  "confidence": number|null,',
      '  "notes": string|null',
      '}',
      '要求：',
      '- 只返回 JSON 对象。',
      '- date 必须输出 YYYY-MM-DD，无法确定则用 null。',
      '- amount 只保留人民币数字，不带单位；无法判断则 null。',
      '- amount_text 保留图片里的金额表达。',
      '- effect 仅提取“助力效应/用途/物资数量”等补充说明，没有就 null。',
      '- cert_no 只提取证书编号/证书号。',
      '- channel 按版式判断：腾讯公益=txgy，希望工程=xwgc，其他=other。',
      '- confidence 为 0 到 1 之间的小数。',
      '- 如果有不确定信息，请放到 notes 里，但仍然只返回 JSON。',
    ].join('\n'),
  };
}

async function callModel({ apiKey, baseUrl, model, prompt, imageBase64, mimeType }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt.user },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
    }),
  });

  const raw = await res.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = payload?.error?.message || raw || 'unknown error';
    throw new Error(`AI 接口调用失败 (${res.status}): ${detail.slice(0, 240)}`);
  }

  const content = extractTextContent(payload?.choices?.[0]?.message?.content);
  const jsonText = extractJsonObject(content);
  return JSON.parse(jsonText);
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '请求格式错误' }, { status: 400 });
  }

  const kind = body?.kind === 'sponsor' ? 'sponsor' : 'donation';
  const imageBase64 = cleanBase64(body?.image_base64);
  const mimeType = pickMimeType(body?.mime_type);

  if (!imageBase64 || !mimeType) {
    return json({ error: '缺少有效的图片数据或 mime_type' }, { status: 400 });
  }

  if (approxBytesFromBase64(imageBase64) > MAX_IMAGE_BYTES) {
    return json({ error: '图片过大（最大 8MB）' }, { status: 413 });
  }

  let config;
  try {
    config = getConfig(env);
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }

  try {
    const parsed = await callModel({
      ...config,
      prompt: buildPrompt(kind),
      imageBase64,
      mimeType,
    });
    const extracted = kind === 'sponsor'
      ? normalizeSponsorResult(parsed)
      : normalizeDonationResult(parsed);
    return json({ ok: true, kind, model: config.model, extracted });
  } catch (e) {
    return json({ error: e.message || 'AI 识别失败' }, { status: 502 });
  }
}
