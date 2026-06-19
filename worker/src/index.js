const SERVICE_NAME = 'diary-write-api';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_MAX_BODY_LENGTH = 200000;
const MAX_TITLE_LENGTH = 120;

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      if (error instanceof GithubWriteError) {
        return jsonResponse(
          {
            ok: false,
            error: 'github_error',
            message: githubErrorMessage(error.githubStatus),
            githubStatus: error.githubStatus
          },
          error.httpStatus,
          request,
          env
        );
      }

      console.warn('worker_error', error?.message || error);
      return jsonResponse(
        { ok: false, error: 'github_error', message: '요청 처리 중 오류가 발생했습니다.' },
        500,
        request,
        env
      );
    }
  }
};

async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS' && url.pathname === '/api/diary') {
    return handlePreflight(request, env);
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ ok: true, service: SERVICE_NAME }, 200, request, env);
  }

  if (url.pathname !== '/api/diary') {
    return jsonResponse(
      { ok: false, error: 'not_found', message: '존재하지 않는 엔드포인트입니다.' },
      404,
      request,
      env
    );
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { ok: false, error: 'method_not_allowed', message: '허용되지 않는 메서드입니다.' },
      405,
      request,
      env
    );
  }

  const originCheck = checkOrigin(request, env);
  if (!originCheck.ok) {
    return jsonResponse(
      { ok: false, error: 'origin_not_allowed', message: '허용되지 않은 출처입니다.' },
      403,
      request,
      env
    );
  }

  const configCheck = checkConfig(env);
  if (!configCheck.ok) {
    return jsonResponse(
      { ok: false, error: 'config_missing', message: 'Worker 설정이 누락되었습니다.' },
      500,
      request,
      env
    );
  }

  const authCheck = checkWriteToken(request, env);
  if (!authCheck.ok) {
    return jsonResponse(
      { ok: false, error: 'unauthorized', message: '인증에 실패했습니다.' },
      401,
      request,
      env
    );
  }

  if (!isJsonRequest(request)) {
    return jsonResponse(
      { ok: false, error: 'invalid_json', message: 'JSON 요청만 처리할 수 있습니다.' },
      400,
      request,
      env
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse(
      { ok: false, error: 'invalid_json', message: 'JSON 형식이 올바르지 않습니다.' },
      400,
      request,
      env
    );
  }

  const validation = validateDiaryPayload(payload, env);
  if (!validation.ok) {
    return jsonResponse(
      { ok: false, error: validation.error, message: validation.message },
      400,
      request,
      env
    );
  }

  const entry = validation.entry;
  const created = await createDiaryFileWithRetry(entry, env);

  return jsonResponse(
    {
      ok: true,
      path: created.path,
      commitSha: created.commitSha,
      htmlUrl: created.htmlUrl,
      updated: created.updated
    },
    created.updated ? 200 : 201,
    request,
    env
  );
}

function handlePreflight(request, env) {
  const originCheck = checkOrigin(request, env);
  if (!originCheck.ok) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env)
  });
}

function checkConfig(env) {
  const required = ['GITHUB_TOKEN', 'WRITE_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
  return { ok: required.every((key) => Boolean(env[key])) };
}

function checkWriteToken(request, env) {
  if (!env.WRITE_TOKEN) return { ok: false };

  const auth = request.headers.get('Authorization') || '';
  const bearerToken = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const headerToken = request.headers.get('X-Write-Token') || '';

  return { ok: bearerToken === env.WRITE_TOKEN || headerToken === env.WRITE_TOKEN };
}

function checkOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return { ok: true };
  return { ok: allowedOrigins(env).includes(origin) };
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isJsonRequest(request) {
  const contentType = request.headers.get('Content-Type') || '';
  return contentType.toLowerCase().includes('application/json');
}

function validateDiaryPayload(payload, env) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'invalid_json', message: '요청 본문은 JSON 객체여야 합니다.' };
  }

  if (typeof payload.date !== 'string' || !DATE_RE.test(payload.date) || !isRealDate(payload.date)) {
    return { ok: false, error: 'invalid_date', message: 'date는 실제 존재하는 YYYY-MM-DD 날짜여야 합니다.' };
  }

  if (payload.title != null && typeof payload.title !== 'string') {
    return { ok: false, error: 'invalid_body', message: 'title은 문자열이어야 합니다.' };
  }

  const title = normalizeTitle(payload.title, payload.date);
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: 'invalid_body', message: `title은 ${MAX_TITLE_LENGTH}자 이하여야 합니다.` };
  }

  if (typeof payload.body !== 'string') {
    return { ok: false, error: 'invalid_body', message: 'body는 필수 문자열입니다.' };
  }

  const body = payload.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!body.trim()) {
    return { ok: false, error: 'invalid_body', message: 'body는 비어 있을 수 없습니다.' };
  }

  const maxBodyLength = parseMaxBodyLength(env);
  if (body.length > maxBodyLength) {
    return { ok: false, error: 'invalid_body', message: `body는 ${maxBodyLength}자 이하여야 합니다.` };
  }

  const clientId = sanitizeClientId(payload.clientId);

  return {
    ok: true,
    entry: {
      date: payload.date,
      title,
      body,
      clientId,
      createdAt: new Date()
    }
  };
}

function normalizeTitle(value, date) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || date;
}

function sanitizeClientId(value) {
  const sanitized = String(value || 'pwa')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
  return sanitized || 'pwa';
}

function parseMaxBodyLength(env) {
  const parsed = Number.parseInt(env.MAX_BODY_LENGTH || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BODY_LENGTH;
}

function isRealDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

async function createDiaryFileWithRetry(entry, env) {
  const content = makeDiaryText(entry);
  const basePath = makeInboxPath(entry);
  const candidates = [
    basePath,
    withRetrySuffix(basePath, 2),
    withRetrySuffix(basePath, 3)
  ];

  let lastError;
  for (const path of candidates) {
    const result = await putGithubContent(path, content, entry, env);
    if (result.ok) return { ...result, path };
    if (result.status !== 409) throw new GithubWriteError(result.status);
    lastError = result;
  }

  throw new GithubWriteError(lastError?.status || 409);
}

function makeInboxPath(entry) {
  const timestamp = formatKoreaTimestamp(entry.createdAt);
  return `inbox/new/${entry.date}-${timestamp}-${entry.clientId}.txt`;
}

function withRetrySuffix(path, retryNumber) {
  return path.replace(/\.txt$/, `-${retryNumber}.txt`);
}

function formatKoreaTimestamp(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

function makeDiaryText(entry) {
  const [year, month, day] = entry.date.split('-').map(Number);
  return [
    `${year}년 ${month}월 ${day}일`,
    '',
    `제목: ${entry.title}`,
    `작성 경로: ${entry.clientId}`,
    `작성 시각: ${entry.createdAt.toISOString()}`,
    '',
    entry.body
  ].join('\n');
}

async function putGithubContent(path, content, entry, env) {
  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const branch = env.GITHUB_BRANCH || 'main';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeGithubPath(path)}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'diary-write-worker'
    },
    body: JSON.stringify({
      message: `Add diary entry ${entry.date} from PWA`,
      content: base64Utf8(content),
      branch
    })
  });

  const body = await response.json().catch(() => ({}));
  if (response.status === 201 || response.status === 200) {
    return {
      ok: true,
      status: response.status,
      updated: response.status === 200,
      commitSha: body.commit?.sha || '',
      htmlUrl: body.content?.html_url || ''
    };
  }

  console.warn('github_error_status', response.status);
  return { ok: false, status: response.status };
}

class GithubWriteError extends Error {
  constructor(githubStatus) {
    super(`github_error:${githubStatus}`);
    this.githubStatus = githubStatus;
    this.httpStatus = githubStatus >= 400 && githubStatus < 500 ? githubStatus : 502;
  }
}

function githubErrorMessage(status) {
  const messages = {
    401: 'GitHub 인증에 실패했습니다. Worker secret 설정을 확인하세요.',
    403: 'GitHub 저장 권한이 없거나 요청이 거부되었습니다.',
    404: 'GitHub 저장소 또는 저장 경로를 찾을 수 없습니다.',
    409: '같은 파일명이 이미 존재해 저장에 실패했습니다.',
    422: 'GitHub API 요청 형식이 거부되었습니다.'
  };
  return messages[status] || 'GitHub 저장 중 오류가 발생했습니다.';
}

function encodeGithubPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function jsonResponse(payload, status, request, env) {
  const responsePayload = normalizeErrorPayload(payload, status);
  return new Response(JSON.stringify(responsePayload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env)
    }
  });
}

function normalizeErrorPayload(payload, status) {
  if (payload.ok !== false || payload.message) return payload;
  const fallbackMessages = {
    method_not_allowed: '허용되지 않는 메서드입니다.',
    origin_not_allowed: '허용되지 않은 출처입니다.',
    unauthorized: '인증에 실패했습니다.',
    invalid_json: 'JSON 형식이 올바르지 않습니다.',
    invalid_date: '날짜 형식이 올바르지 않습니다.',
    invalid_body: '본문 형식이 올바르지 않습니다.',
    config_missing: 'Worker 설정이 누락되었습니다.',
    github_error: 'GitHub 저장 중 오류가 발생했습니다.'
  };
  return {
    ...payload,
    message: fallbackMessages[payload.error] || `요청 처리에 실패했습니다. (${status})`
  };
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Write-Token',
    Vary: 'Origin'
  };

  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}
