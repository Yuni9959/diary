import { createSupabaseClient, isSupabaseConfigured } from "./supabase-client.js";

const ENTRIES_PATH = "/rest/v1/entries";

function byEntryDate(entryDate) {
  return `${ENTRIES_PATH}?entry_date=eq.${encodeURIComponent(entryDate)}`;
}

function byId(id) {
  return `${ENTRIES_PATH}?id=eq.${encodeURIComponent(id)}`;
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

function withOwner(record, userId) {
  if (!userId) {
    return record;
  }

  return {
    ...record,
    owner_id: userId,
    created_by: record.created_by || userId,
  };
}

export function createDiaryService(config) {
  const client = createSupabaseClient(config);

  async function selectRows(query) {
    return client.request(`${ENTRIES_PATH}?${query}`);
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
      const rows = await client.request(`${byEntryDate(entryDate)}&select=*&limit=1`);
      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async createEntry({ entry_date, title, body, body_format = "plain", mood = null, metadata = {} }) {
      const rows = await client.request(`${ENTRIES_PATH}?select=*`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: withOwner({
          entry_date,
          title,
          body,
          body_format,
          mood,
          metadata,
        }, client.getUserId()),
      });

      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async upsertEntryByDate({ entry_date, title, body, body_format = "plain", mood = null, metadata = {} }) {
      const rows = await client.request(`${ENTRIES_PATH}?on_conflict=owner_id,entry_date&select=*`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: withOwner({
          entry_date,
          title: title || entry_date,
          body,
          body_format,
          mood,
          metadata,
        }, client.getUserId()),
      });

      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async updateEntry(id, patch) {
      const rows = await client.request(`${byId(id)}&select=*`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: patch,
      });

      return mapSupabaseRowToDiaryEntry(rows[0] || null);
    },

    async deleteEntry(id) {
      await client.request(byId(id), {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    },

    async deleteEntryByDate(entryDate) {
      const entry = await this.getEntryByDate(entryDate);
      if (!entry?.id) {
        return false;
      }

      await this.deleteEntry(entry.id);
      return true;
    },
  };
}

export { isSupabaseConfigured };
