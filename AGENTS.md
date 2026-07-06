# Project Instructions

## Highest Priority: UI FREEZE

The current Diary UI is approved and wife-facing. Do not change visual UI unless the user explicitly approves that specific UI change.

Do not change `index.html`, CSS, layout, colors, typography, spacing, copy/text, icons, animations, modal structure, responsive behavior, `manifest.webmanifest`, `sw.js`, data files, worker files, pipeline files, or frontend/UI behavior files unless explicitly approved.

## Security

Never commit `.env.local`, secret keys, access tokens, service_role keys, database passwords, or any other private credentials.

Frontend code may use only a Supabase publishable key. Supabase `service_role` keys and secret keys are backend-only and must never appear in browser code.

Do not print secrets, access tokens, or private diary body content in logs or reports.

## Change Management

Prefer small, reviewable changes.

For database schema changes, propose migration SQL first and wait for user approval before applying it.

Supabase MCP should stay configured with `read_only=true` unless the user explicitly approves a write step.

The Diary app is currently a static HTML/PWA. Avoid adding build-system complexity unless explicitly approved.
