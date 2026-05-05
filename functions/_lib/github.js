// Minimal GitHub Contents API client for Cloudflare Pages Functions.
// Required env: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO.
// Optional env: GITHUB_BRANCH (default: main), COMMITTER_NAME, COMMITTER_EMAIL.

const API = 'https://api.github.com';

function ghHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not configured');
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'like-charity-site',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function repoInfo(env) {
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO) {
    throw new Error('GITHUB_OWNER / GITHUB_REPO not configured');
  }
  return {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH || 'main',
  };
}

export function committer(env) {
  return {
    name: env.COMMITTER_NAME || 'like-bot',
    email: env.COMMITTER_EMAIL || 'like-bot@users.noreply.github.com',
  };
}

// Read a file's content + sha. Returns { content, sha } where content is a string.
// Returns null if the file doesn't exist.
export async function readFile(env, path) {
  const { owner, repo, branch } = repoInfo(env);
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub readFile ${path}: ${res.status} ${await res.text()}`);
  const json = await res.json();
  // Files >1MB return content via blob endpoint; this app's JSON is small.
  if (typeof json.content !== 'string') {
    throw new Error(`GitHub readFile ${path}: unexpected response (file too large?)`);
  }
  const cleaned = json.content.replace(/\n/g, '');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const text = new TextDecoder('utf-8').decode(bytes);
  return { content: text, sha: json.sha };
}

// Get only the SHA of a path (cheaper than reading content).
export async function getSha(env, path) {
  const { owner, repo, branch } = repoInfo(env);
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getSha ${path}: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.sha;
}

// Write a file (create or update). content_base64 is the base64-encoded content.
export async function writeFile(env, path, content_base64, message, sha = null) {
  const { owner, repo, branch } = repoInfo(env);
  const body = {
    message,
    content: content_base64,
    branch,
    committer: committer(env),
  };
  if (sha) body.sha = sha;
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURI(path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub writeFile ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

// Encode a UTF-8 string to base64 (for GitHub PUT).
export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Atomic-ish update of a JSON file in the repo: read, mutate, finalize, write back.
// Creates the file on first write if it doesn't exist (with `initial` as the seed).
// Retries once on 409 (sha conflict).
export async function updateJsonFile(env, { path, mutator, finalize, message, initial }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await readFile(env, path);
    let data, sha = null;
    if (cur) {
      data = JSON.parse(cur.content);
      sha = cur.sha;
    } else if (initial) {
      data = typeof initial === 'function' ? initial() : initial;
    } else {
      throw new Error(`${path} not found in repo`);
    }
    const next = mutator(data) || data;
    if (typeof finalize === 'function') finalize(next);
    next.updated = new Date().toISOString();
    const b64 = utf8ToBase64(JSON.stringify(next, null, 2));
    try {
      await writeFile(env, path, b64, message, sha);
      return next;
    } catch (e) {
      if (attempt === 0 && /\b409\b/.test(e.message)) continue;
      throw e;
    }
  }
  throw new Error(`updateJsonFile ${path}: failed after retry`);
}

export function updateDonations(env, mutator, message) {
  return updateJsonFile(env, {
    path: 'data/donations.json',
    mutator,
    message,
    finalize(data) {
      data.records = Array.isArray(data.records) ? data.records : [];
      data.count = data.records.length;
      data.total_amount = data.records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    },
  });
}

export function updateSponsors(env, mutator, message) {
  return updateJsonFile(env, {
    path: 'data/sponsors.json',
    mutator,
    message,
    initial: () => ({ version: 1, sponsors: [] }),
    finalize(data) {
      data.sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
      data.count = data.sponsors.length;
      data.total_amount = Number(
        data.sponsors.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(2),
      );
    },
  });
}
