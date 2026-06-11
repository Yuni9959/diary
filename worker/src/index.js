const MAX_BODY_LENGTH = 120000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.warn('worker error', error);
      return jsonResponse({ok: false, error: 'internal_error'}, 500, request, env);
    }
  }
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return corsPreflight(request, env);
  }

  if (url.pathname !== '/api/diary') {
    return jsonResponse({ok: false, error: 'not_found'}, 404, request, env);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ok: false, error: 'method_not_allowed'}, 405, request, env);
  }

  const origin = verifyOrigin(request, env);
  if (!origin.ok) {
    return jsonResponse({ok: false, error: origin.error}, 403, request, env);
  }

  const auth = verifyWriteToken(request, env);
  if (!auth.ok) {
    return jsonResponse({ok: false, error: auth.error}, auth.status, request, env);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ok: false, error: 'invalid_json'}, 400, request, env);
  }

  const validation = validateDiaryPayload(payload);
  if (!validation.ok) {
    return jsonResponse({ok: false, error: validation.error}, 400, request, env);
  }

  const githubConfig = validateGithubEnv(env);
  if (!githubConfig.ok) {
    return jsonResponse({ok: false, error: githubConfig.error}, 500, request, env);
  }

  const filePath = makeInboxPath(payload);
  const content = makeDiaryText(payload);
  const result = await createGithubFile(filePath, content, payload, env);

  return jsonResponse({
    ok: true,
    path: filePath,
    commitSha: result.commit?.sha || null,
    contentUrl: result.content?.html_url || null
  }, 201, request, env);
}

function validateDiaryPayload(payload) {
  if (!payload || typeof payload !== 'object') return {ok: false, error: 'payload_required'};
  if (typeof payload.date !== 'string' || !DATE_RE.test(payload.date)) return {ok: false, error: 'invalid_date'};
  if (!isRealDate(payload.date)) return {ok: false, error: 'invalid_date'};
  if (typeof payload.body !== 'string' || payload.body.trim().length < 1) return {ok: false, error: 'body_required'};
  if (payload.body.length > MAX_BODY_LENGTH) return {ok: false, error: 'body_too_long'};
  if (payload.title != null && typeof payload.title !== 'string') return {ok: false, error: 'invalid_title'};
  if (payload.title && payload.title.length > 120) return {ok: false, error: 'title_too_long'};
  if (payload.clientId != null && typeof payload.clientId !== 'string') return {ok: false, error: 'invalid_client_id'};
  return {ok: true};
}

function isRealDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function verifyOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return {ok: true};
  if (resolveAllowedOrigin(origin, env)) return {ok: true};
  return {ok: false, error: 'origin_not_allowed'};
}

function verifyWriteToken(request, env) {
  if (!env.WRITE_TOKEN) return {ok: false, status: 500, error: 'write_token_not_configured'};

  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const headerToken = request.headers.get('X-Write-Token') || '';
  const token = bearer || headerToken;

  if (!token) return {ok: false, status: 401, error: 'write_token_required'};
  if (token !== env.WRITE_TOKEN) return {ok: false, status: 403, error: 'write_token_invalid'};
  return {ok: true};
}

function validateGithubEnv(env) {
  const required = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
  const missing = required.filter(name => !env[name]);
  if (missing.length) return {ok: false, error: `missing_env:${missing.join(',')}`};
  return {ok: true};
}

function makeInboxPath(payload) {
  const safeClient = String(payload.clientId || 'pwa')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'pwa';
  const suffix = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `Diary_formyWife/inbox/new/${payload.date}-${suffix}-${safeClient}.txt`;
}

function makeDiaryText(payload) {
  const [year, month, day] = payload.date.split('-').map(Number);
  const dateLine = `${year}년 ${month}월 ${day}일`;
  const title = payload.title && payload.title.trim()
    ? `제목: ${payload.title.trim()}\n\n`
    : '';
  return `${dateLine}\n\n${title}${payload.body.replace(/\r\n/g, '\n')}\n`;
}

async function createGithubFile(path, text, payload, env) {
  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const branch = env.GITHUB_BRANCH || 'main';
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}`;

  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'diary-pwa-worker',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      message: `Add diary draft ${payload.date}`,
      content: base64Utf8(text),
      branch
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn('github create failed', response.status, result);
    throw new Error(`github_create_failed:${response.status}`);
  }
  return result;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function corsPreflight(request, env) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env)
  });
}

function jsonResponse(payload, status, request, env) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env)
    }
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = resolveAllowedOrigin(origin, env);
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Write-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

function resolveAllowedOrigin(origin, env) {
  if (!origin) return '';
  const list = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (list.includes('*')) return origin;
  if (list.includes(origin)) return origin;
  return '';
}
