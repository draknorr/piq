-- Phase 2 Tiger bootstrap for the PublisherIQ identity foundation.
-- Creates platform-native entity tables that preserve deterministic entity_uid
-- mapping and support natural-language lookup across games, publishers, and developers.

CREATE TABLE IF NOT EXISTS core.entities (
    entity_uid uuid PRIMARY KEY,
    entity_kind text NOT NULL,
    platform text NOT NULL,
    platform_entity_id text NOT NULL,
    canonical_name text NOT NULL,
    normalized_name text NOT NULL,
    parent_entity_uid uuid,
    source_table text,
    source_pk text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entities_entity_kind_check CHECK (entity_kind IN ('game', 'publisher', 'developer')),
    CONSTRAINT entities_platform_check CHECK (platform IN ('steam', 'publisheriq')),
    CONSTRAINT entities_platform_identity_key UNIQUE (platform, entity_kind, platform_entity_id),
    CONSTRAINT entities_parent_entity_uid_fkey
      FOREIGN KEY (parent_entity_uid) REFERENCES core.entities(entity_uid) ON DELETE SET NULL
);

COMMENT ON TABLE core.entities IS 'Canonical platform-native identity records for games, publishers, and developers.';
COMMENT ON COLUMN core.entities.entity_uid IS 'Deterministic UUID derived from platform, entity_kind, and platform_entity_id.';
COMMENT ON COLUMN core.entities.source_table IS 'Live source table used for the bootstrap backfill.';
COMMENT ON COLUMN core.entities.source_pk IS 'Primary key value in the live source table used for the bootstrap backfill.';

CREATE INDEX IF NOT EXISTS idx_entities_kind_name ON core.entities (entity_kind, canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_platform_identity ON core.entities (platform, platform_entity_id);
CREATE INDEX IF NOT EXISTS idx_entities_normalized_name ON core.entities (normalized_name);
CREATE INDEX IF NOT EXISTS idx_entities_parent ON core.entities (parent_entity_uid) WHERE parent_entity_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entities_canonical_name_trgm ON core.entities USING gin (canonical_name public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_canonical_name_lower_trgm ON core.entities USING gin (lower(canonical_name) public.gin_trgm_ops);

CREATE TABLE IF NOT EXISTS core.entity_aliases (
    entity_uid uuid NOT NULL,
    alias text NOT NULL,
    normalized_alias text NOT NULL,
    alias_type text DEFAULT 'name'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    source_table text,
    source_pk text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_aliases_pkey PRIMARY KEY (entity_uid, normalized_alias, alias_type),
    CONSTRAINT entity_aliases_entity_uid_fkey
      FOREIGN KEY (entity_uid) REFERENCES core.entities(entity_uid) ON DELETE CASCADE
);

COMMENT ON TABLE core.entity_aliases IS 'Searchable aliases and alternate names for canonical entities.';
COMMENT ON COLUMN core.entity_aliases.alias_type IS 'Examples: canonical_name, storefront_name, normalized_name, imported_alias.';

CREATE INDEX IF NOT EXISTS idx_entity_aliases_normalized_alias ON core.entity_aliases (normalized_alias);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_primary ON core.entity_aliases (entity_uid, is_primary);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias_trgm ON core.entity_aliases USING gin (alias public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias_lower_trgm ON core.entity_aliases USING gin (lower(alias) public.gin_trgm_ops);

CREATE TABLE IF NOT EXISTS core.entity_external_ids (
    entity_uid uuid NOT NULL,
    external_system text NOT NULL,
    external_id text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    source_table text,
    source_pk text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_external_ids_pkey PRIMARY KEY (entity_uid, external_system, external_id),
    CONSTRAINT entity_external_ids_entity_uid_fkey
      FOREIGN KEY (entity_uid) REFERENCES core.entities(entity_uid) ON DELETE CASCADE,
    CONSTRAINT entity_external_ids_system_value_key UNIQUE (external_system, external_id)
);

COMMENT ON TABLE core.entity_external_ids IS 'Non-canonical identifiers that resolve back to a canonical entity.';

CREATE INDEX IF NOT EXISTS idx_entity_external_ids_lookup ON core.entity_external_ids (external_system, external_id);
CREATE INDEX IF NOT EXISTS idx_entity_external_ids_primary ON core.entity_external_ids (entity_uid, is_primary);

CREATE TABLE IF NOT EXISTS core.entity_relationships (
    source_entity_uid uuid NOT NULL,
    target_entity_uid uuid NOT NULL,
    relationship_type text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    source_table text,
    source_pk text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entity_relationships_pkey PRIMARY KEY (source_entity_uid, target_entity_uid, relationship_type),
    CONSTRAINT entity_relationships_source_entity_uid_fkey
      FOREIGN KEY (source_entity_uid) REFERENCES core.entities(entity_uid) ON DELETE CASCADE,
    CONSTRAINT entity_relationships_target_entity_uid_fkey
      FOREIGN KEY (target_entity_uid) REFERENCES core.entities(entity_uid) ON DELETE CASCADE,
    CONSTRAINT entity_relationships_not_self CHECK (source_entity_uid <> target_entity_uid)
);

COMMENT ON TABLE core.entity_relationships IS 'Directed relationships between canonical entities, such as developed_by or published_by.';

CREATE INDEX IF NOT EXISTS idx_entity_relationships_target ON core.entity_relationships (target_entity_uid, relationship_type);
CREATE INDEX IF NOT EXISTS idx_entity_relationships_source ON core.entity_relationships (source_entity_uid, relationship_type);
