-- Phase 2.5 Tiger bootstrap for hot-path entity lookup.
-- Adds exact/prefix indexes that support the chat resolver's lexical probe strategy.

CREATE INDEX IF NOT EXISTS idx_entities_canonical_name_lower_pattern ON core.entities (
    entity_kind,
    platform,
    lower(canonical_name) text_pattern_ops
);

CREATE INDEX IF NOT EXISTS idx_entities_normalized_name_pattern ON core.entities (
    entity_kind,
    platform,
    normalized_name text_pattern_ops
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias_lower_pattern_entity_uid ON core.entity_aliases (
    lower(alias) text_pattern_ops,
    entity_uid
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_normalized_alias_pattern_entity_uid ON core.entity_aliases (
    normalized_alias text_pattern_ops,
    entity_uid
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_loose_normalized_alias_pattern_entity_uid ON core.entity_aliases (
    loose_normalized_alias text_pattern_ops,
    entity_uid
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_compact_normalized_alias_pattern_entity_uid ON core.entity_aliases (
    compact_normalized_alias text_pattern_ops,
    entity_uid
);

ANALYZE core.entities;
ANALYZE core.entity_aliases;
