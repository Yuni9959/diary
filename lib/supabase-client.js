const DEFAULT_SCHEMA = "diary";
const SESSION_STORAGE_KEY = "diary.supabase.session";

function normalizeUrl(url) {
  if (!url) {
    throw new Error("SUPABASE_URL is required.");
  }

  return url.replace(/\/+$/, "");
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session) {
  if (!session) {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function createSupabaseClient({
  supabaseUrl,
  publishableKey,
  schema = DEFAULT_SCHEMA,
  fetchImpl = fetch,
} = {}) {
  if (!publishableKey) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is required.");
  }

  const baseUrl = normalizeUrl(supabaseUrl);
  let session = readStoredSession();

  function getAccessToken() {
    return session?.access_token || null;
  }

  function buildHeaders({ profile = schema, token = getAccessToken(), json = true } = {}) {
    const headers = {
      apikey: publishableKey,
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
    const body = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = body?.message || body?.error_description || body?.error || response.statusText;
      throw new Error(`Supabase request failed (${response.status}): ${message}`);
    }

    return body;
  }

  async function request(path, { method = "GET", body, headers, profile = schema } = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        ...buildHeaders({ profile, json: body !== undefined }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return parseResponse(response);
  }

  return {
    getSession() {
      return session;
    },

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

    signOutLocal() {
      session = null;
      writeStoredSession(null);
    },

    request,
  };
}
