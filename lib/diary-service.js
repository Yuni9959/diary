import { createSupabaseClient, isSupabaseConfigured } from "./supabase-client.js";

const ENTRIES_PATH = "/rest/v1/entries";
const COMMENTS_PATH = "/rest/v1/entry_comments";
const ENTRY_COLUMNS = "id,entry_date,title,body,body_format,mood,metadata,source";
const RETURN_REPRESENTATION = "return=representation";

function byEntryDate(entryDate) {
  return `${ENTRIES_PATH}?entry_date=eq.${encodeURIComponent(entryDate)}`;
}

function byId(id) {
  return `${ENTRIES_PATH}?id=eq.${encodeURIComponent(id)}`;
}

function commentsByEntryId(entryId) {
  return `${COMMENTS_PATH}?entry_id=eq.${encodeURIComponent(entryId)}`;
}

function normalizeBodyLines(body) {
  return String(body ?? "").replace(/\r\n/g, "\n").split(/\n[ \t]*\n/);
}

function requireRows(rows, operation) {
  if (!Array.isArray(rows)) {
    throw new Error(`Supabase returned an invalid response while ${operation}.`);
  }

  return rows;
}

function requireEntry(rows, operation) {
  const row = requireRows(rows, operation)[0];
  if (!row) {
    throw new Error(`Supabase ${operation} did not affect a diary entry.`);
  }

  return mapSupabaseRowToDiaryEntry(row);
}

export function mapSupabaseRowToDiaryEntry(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    date: row.entry_date,
    title: row.title || row.entry_date,
    body: normalizeBodyLines(row.body),
    bodyText: row.body || "",
    body_format: row.body_format || "plain",
    mood: row.mood || null,
    photos: [],
    metadata: row.metadata || {},
    source: row.source || "supabase",
  };
}

export function mapSupabaseRowToIndexItem(row) {
  return {
    title: row.title || row.entry_date,
    entryUrl: `supabase:${row.entry_date}`,
    hasPhotos: false,
    source: "supabase",
    supabaseId: row.id,
  };
}

function requireSignedInUserId(client) {
  const userId = client.getUserId();
  if (!userId) {
    throw new Error("Supabase sign-in is required to write diary entries.");
  }
  return userId;
}

export function mapSupabaseRowToEntryComment(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    entryId: row.entry_id,
    body: row.body || "",
    createdAt: row.created_at,
  };
}

export function createDiaryService(config) {
  const client = createSupabaseClient(config);

  async function selectRows(query) {
    const rows = await client.request(`${ENTRIES_PATH}?${query}`, { useSession: false });
    return requireRows(rows, "reading diary entries");
  }

  async function writeEntry({ path, method, body, prefer = RETURN_REPRESENTATION, useSession, operation }) {
    const separator = path.includes("?") ? "&" : "?";
    const rows = await client.request(`${path}${separator}select=${ENTRY_COLUMNS}`, {
      method,
      headers: { Prefer: prefer },
      useSession,
      body,
    });

    return requireEntry(rows, operation);
  }

  async function deleteEntryById(id) {
    requireSignedInUserId(client);
    await client.request(byId(id), {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  return {
    isSupabaseConfigured() {
      return client.isSupabaseConfigured();
    },

    getSession() {
      return client.getSession();
    },

    signInWithPassword(email, password) {
      return client.signInWithPassword(email, password);
    },

    signOut() {
      client.signOut();
    },

    async listEntries() {
      const rows = await selectRows(`select=${ENTRY_COLUMNS}&order=entry_date.desc`);
      return rows.map(mapSupabaseRowToDiaryEntry);
    },

    async listEntryDates() {
      const rows = await selectRows("select=entry_date&order=entry_date.asc");
      return rows.map((row) => row.entry_date);
    },

    async listEntryIndex() {
      const rows = await selectRows("select=id,entry_date,title&order=entry_date.asc");
      return Object.fromEntries(rows.map((row) => [row.entry_date, mapSupabaseRowToIndexItem(row)]));
    },

    async getEntryByDate(entryDate) {
      const rows = await selectRows(
        `entry_date=eq.${encodeURIComponent(entryDate)}&select=${ENTRY_COLUMNS}&limit=1`,
      );
      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async listEntryComments(entryId) {
      const rows = requireRows(await client.request(
        `${commentsByEntryId(entryId)}&select=id,entry_id,body,created_at&order=created_at.asc,id.asc`,
        { useSession: false },
      ), "reading entry comments");
      return rows.map(mapSupabaseRowToEntryComment);
    },

    async createEntryComment(entryId, body) {
      const normalizedBody = String(body || "").trim();
      if (!normalizedBody) {
        throw new Error("Entry comment body is required.");
      }

      const rows = requireRows(await client.request(`${COMMENTS_PATH}?select=id,entry_id,body,created_at`, {
        method: "POST",
        headers: { Prefer: RETURN_REPRESENTATION },
        useSession: false,
        body: {
          entry_id: entryId,
          body: normalizedBody,
        },
      }), "creating an entry comment");
      const comment = mapSupabaseRowToEntryComment(rows[0] || null);
      if (!comment) {
        throw new Error("Supabase did not return the created entry comment.");
      }
      return comment;
    },

    async createEntry({ entry_date, title, body, body_format = "plain", mood = null, metadata = {} }) {
      return writeEntry({
        path: ENTRIES_PATH,
        method: "POST",
        useSession: false,
        operation: "create",
        body: {
          entry_date,
          title,
          body,
          body_format,
          mood,
          metadata,
        },
      });
    },

    async upsertEntryByDate({ entry_date, title, body, body_format = "plain", mood = null, metadata = {} }) {
      return writeEntry({
        path: `${ENTRIES_PATH}?on_conflict=entry_date`,
        method: "POST",
        prefer: `resolution=merge-duplicates,${RETURN_REPRESENTATION}`,
        useSession: false,
        operation: "upsert",
        body: {
          entry_date,
          title: title || entry_date,
          body,
          body_format,
          mood,
          metadata,
        },
      });
    },

    async updateEntry(id, patch) {
      requireSignedInUserId(client);
      return writeEntry({
        path: byId(id),
        method: "PATCH",
        useSession: true,
        operation: "update",
        body: patch,
      });
    },

    async deleteEntry(id) {
      await deleteEntryById(id);
    },

    async deleteEntryByDate(entryDate) {
      requireSignedInUserId(client);
      const rows = requireRows(await client.request(`${byEntryDate(entryDate)}&select=id`, {
        method: "DELETE",
        headers: { Prefer: RETURN_REPRESENTATION },
      }), "deleting a diary entry");
      return Boolean(rows[0]?.id);
    },
  };
}

export { isSupabaseConfigured };
