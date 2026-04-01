# Tiger Live Baseline Snapshot

- Captured: 2026-03-31T19:33:24.916Z
- Source: supabase-postgres
- Connection source: live production database
- Purpose: bootstrap Tiger migration work from the live database, not historical migration files

## Files

- `source-overview.json`: database identity and engine version
- `schemas.json`: schema inventory
- `portable-schemas.json`: schemas that can move to Tiger without Supabase platform baggage
- `extensions.json`: installed extensions on the source system
- `matviews.json`: materialized view inventory
- `public-functions.json`: public function inventory
- `large-relations.json`: top tables and matviews by size
- `chat-surface.json`: current chat tool usage surface from `chat_query_logs`
- `user-surface.json`: auth-adjacent user tables still coupled to Supabase
- `schema.sql`: schema-only dump of the live source database
