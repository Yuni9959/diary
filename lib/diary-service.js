import { createSupabaseClient } from "./supabase-client.js";

const ENTRIES_PATH = "/rest/v1/entries";

function byEntryDate(entryDate) {
  return `${ENTRIES_PATH}?entry_date=eq.${encodeURIComponent(entryDate)}`;
}

function byId(id) {
  return `${ENTRIES_PATH}?id=eq.${encodeURIComponent(id)}`;
}

export function createDiaryService(config) {
  const client = createSupabaseClient(config);

  return {
    getSession() {
      return client.getSession();
    },

    signInWithPassword(email, password) {
      return client.signInWithPassword(email, password);
    },

    signOutLocal() {
      client.signOutLocal();
    },

    listEntries() {
      return client.request(`${ENTRIES_PATH}?select=*&order=entry_date.desc`);
    },

    async getEntryByDate(entryDate) {
      const rows = await client.request(`${byEntryDate(entryDate)}&select=*&limit=1`);
      return rows[0] || null;
    },

    async createEntry({ entry_date, title, body, body_format = "plain", mood = null, metadata = {} }) {
      const rows = await client.request(`${ENTRIES_PATH}?select=*`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          entry_date,
          title,
          body,
          body_format,
          mood,
          metadata,
        },
      });

      return rows[0] || null;
    },

    async updateEntry(id, patch) {
      const rows = await client.request(`${byId(id)}&select=*`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: patch,
      });

      return rows[0] || null;
    },

    async deleteEntry(id) {
      await client.request(byId(id), {
        method: "DELETE",
        headers: { Prefer: "return=minimal" },
      });
    },

    // TODO: Add entry_assets support after the first authenticated entries flow is wired.
  };
}
