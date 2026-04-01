-- Phase 1 Tiger bootstrap for the empty PublisherIQ target service.
-- This intentionally creates only the minimum shared foundation:
-- supported extensions that exist on the source system and the target schemas
-- defined in docs/specs/timescale-architecture-plan-2026-03-30.md.
--
-- Safe to run only before any application data is loaded into Tiger.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS legacy;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS metrics;
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS docs;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS chat;

COMMENT ON SCHEMA legacy IS 'Lossless landing zone for source-parity copies during migration.';
COMMENT ON SCHEMA core IS 'Platform-native entities, aliases, relationships, and latest-state catalog data.';
COMMENT ON SCHEMA metrics IS 'Time-series facts and rollups backed by Timescale hypertables.';
COMMENT ON SCHEMA events IS 'Change history and event read models.';
COMMENT ON SCHEMA docs IS 'Searchable document projections and archive metadata.';
COMMENT ON SCHEMA ops IS 'Sync state, jobs, locks, audit trails, and workflow control tables.';
COMMENT ON SCHEMA chat IS 'Chat sessions, eval scaffolding, and conversational query context.';
