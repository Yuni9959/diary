import { createSupabaseClient, isSupabaseConfigured } from "./supabase-client.js";

const ENTRIES_PATH = "/rest/v1/entries";
const COMMENTS_PATH = "/rest/v1/entry_comments";

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
  return String(body || "").replace(/\r\n/g, "\n").split(/\n[ \t]*\n/);
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
    supabaseRow: row,
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
    return client.request(`${ENTRIES_PATH}?${query}`, { useSession: false });
  }

  return {
    isSupabaseConfigured() {
      return isSupabaseConfigured();
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

    signOutLocal() {
      client.signOut();
    },

    async listEntries() {
      const rows = await selectRows("select=*&order=entry_date.desc");
      return rows.map(mapSupabaseRowToDiaryEntry);
    },

    async listEntryIndex() {
      const rows = await selectRows("select=id,entry_date,title&order=entry_date.asc");
      return Object.fromEntries(rows.map((row) => [row.entry_date, mapSupabaseRowToIndexItem(row)]));
    },

    async getEntryByDate(entryDate) {
      const rows = await client.request(`${byEntryDate(entryDate)}&select=*&limit=1`, { useSession: false });
      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async listEntryComments(entryId) {
      const rows = await client.request(
        `${commentsByEntryId(entryId)}&select=id,entry_id,body,created_at&order=created_at.asc,id.asc`,
        { useSession: false },
      );
      return rows.map(mapSupabaseRowToEntryComment);
    },

    async createEntryComment(entryId, body) {
      const rows = await client.request(`${COMMENTS_PATH}?select=id,entry_id,body,created_at`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        useSession: false,
        body: {
          entry_id: entryId,
          body: String(body || "").trim(),
        },
      });
      return mapSupabaseRowToEntryComment(rows[0] || null);
    },

    async createEntry({ entry_date, title, body, body_format = "plain", mood = null, metadata = {} }) {
      const rows = await client.request(`${ENTRIES_PATH}?select=*`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        useSession: false,
        body: {
          entry_date,
          title,
          body,
          body_format,
          mood,
          metadata,
        },
      });

      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async upsertEntryByDate({ entry_date, title, body, body_format = "plain", mood = null, metadata = {} }) {
      const rows = await client.request(`${ENTRIES_PATH}?on_conflict=entry_date&select=*`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        useSession: false,
        body: {
          entry_date,
          title: title || entry_date,
          body,
          body_format,
          mood,
          metadata,
        },
      });

      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async updateEntry(id, patch) {
      requireSignedInUserId(client);
      const rows = await client.request(`${byId(id)}&select=*`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: patch,
      });

      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async deleteEntry(id) {
      requireSignedInUserId(client);
      await client.request(byId(id), {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    },

    async deleteEntryByDate(entryDate) {
      requireSignedInUserId(client);
      const rows = await client.request(`${byEntryDate(entryDate)}&select=id&limit=1`);
      if (!rows[0]?.id) {
        return false;
      }

      await this.deleteEntry(rows[0].id);
      return true;
    },
  };
}

export { isSupabaseConfigured };
