const DEFAULT_SCHEMA = "diary";
const SESSION_STORAGE_KEY = "diary.supabase.session";

function browserConfig() {
  return globalThis.window?.DIARY_SUPABASE_CONFIG || globalThis.DIARY_SUPABASE_CONFIG || null;
}

function normalizeUrl(url) {
  if (!url) {
    throw new Error("SUPABASE_URL is required.");
  }

  return url.replace(/\/+$/, "");
}

function storage() {
  try {
    return globalThis.window?.localStorage || null;
  } catch {
    return null;
  }
}

function readStoredSession() {
  try {
    const raw = storage()?.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  try {
    const store = storage();
    if (!store) {
      return;
    }

    if (!session) {
      store.removeItem(SESSION_STORAGE_KEY);
      return;
    }

    store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // The in-memory session remains usable when browser storage is unavailable.
  }
}

function parseJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseErrorMessage(body, fallback) {
  if (body && typeof body === "object") {
    return body.message || body.error_description || body.error || fallback;
  }

  if (typeof body === "string" && body.trim()) {
    return body.trim().slice(0, 300);
  }

  return fallback;
}

function decodeJwtPayload(token) {
  const [, payload] = String(token || "").split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isSupabaseConfigured(config = browserConfig()) {
  return Boolean(config?.enabled && config?.url && config?.publishableKey);
}

export function createSupabaseClient({
  supabaseUrl,
  publishableKey,
  schema = DEFAULT_SCHEMA,
  fetchImpl = fetch,
} = {}) {
  const runtimeConfig = browserConfig();
  const url = supabaseUrl || runtimeConfig?.url;
  const key = publishableKey || runtimeConfig?.publishableKey;

  if (!key) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is required.");
  }

  const baseUrl = normalizeUrl(url);
  let session = readStoredSession();

  function getAccessToken() {
    return session?.access_token || null;
  }

  function getUserId() {
    return decodeJwtPayload(getAccessToken())?.sub || null;
  }

  function buildHeaders({ profile = schema, token = getAccessToken(), json = true } = {}) {
    const headers = {
      apikey: key,
    };

    if (json) {
      headers["Content-Type"] = "application/json";
    }

    if (profile) {
      headers["Accept-Profile"] = profile;
      headers["Content-Profile"] = profile;
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return headers;
  }

  async function parseResponse(response) {
    const text = await response.text();
    const body = parseJson(text);

    if (!response.ok) {
      const message = responseErrorMessage(body, response.statusText);
      throw new Error(`Supabase request failed (${response.status}): ${message}`);
    }

    return body;
  }

  function clearSession() {
    session = null;
    writeStoredSession(null);
  }

  async function request(path, { method = "GET", body, headers, profile = schema, useSession = true } = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        ...buildHeaders({
          profile,
          token: useSession ? getAccessToken() : null,
          json: body !== undefined,
        }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return parseResponse(response);
  }

  return {
    isSupabaseConfigured() {
      return true;
    },

    getSession() {
      return session;
    },

    getUserId,

    async signInWithPassword(email, password) {
      const response = await fetchImpl(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: buildHeaders({ profile: null }),
        body: JSON.stringify({ email, password }),
      });

      session = await parseResponse(response);
      writeStoredSession(session);
      return session;
    },

    signOut: clearSession,

    signOutLocal: clearSession,

    request,
  };
}
