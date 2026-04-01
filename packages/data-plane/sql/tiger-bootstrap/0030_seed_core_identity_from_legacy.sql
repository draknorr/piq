-- Phase 4 Tiger bootstrap for the PublisherIQ identity seed.
-- Populates core identity tables from the landed legacy compatibility slice.

WITH constants AS (
  SELECT '8b8600d2-2b09-4f74-b95c-77f95fdf00f4'::uuid AS entity_namespace
)
INSERT INTO core.entities (
  entity_uid,
  entity_kind,
  platform,
  platform_entity_id,
  canonical_name,
  normalized_name,
  parent_entity_uid,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  public.uuid_generate_v5(constants.entity_namespace, 'steam:game:' || a.appid::text),
  'game',
  'steam',
  a.appid::text,
  a.name,
  regexp_replace(lower(trim(a.name)), '\s+', ' ', 'g'),
  CASE
    WHEN a.parent_appid IS NOT NULL
      THEN public.uuid_generate_v5(constants.entity_namespace, 'steam:game:' || a.parent_appid::text)
    ELSE NULL
  END,
  'legacy.apps',
  a.appid::text,
  jsonb_build_object(
    'type', a.type,
    'is_free', a.is_free,
    'is_released', a.is_released,
    'is_delisted', a.is_delisted,
    'release_date', a.release_date,
    'platforms', a.platforms
  ),
  COALESCE(a.created_at, now()),
  COALESCE(a.updated_at, now())
FROM legacy.apps a
CROSS JOIN constants
ON CONFLICT (entity_uid) DO UPDATE
SET
  canonical_name = EXCLUDED.canonical_name,
  normalized_name = EXCLUDED.normalized_name,
  parent_entity_uid = EXCLUDED.parent_entity_uid,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  metadata = EXCLUDED.metadata,
  updated_at = now();

WITH constants AS (
  SELECT '8b8600d2-2b09-4f74-b95c-77f95fdf00f4'::uuid AS entity_namespace
)
INSERT INTO core.entities (
  entity_uid,
  entity_kind,
  platform,
  platform_entity_id,
  canonical_name,
  normalized_name,
  parent_entity_uid,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  public.uuid_generate_v5(constants.entity_namespace, 'publisheriq:developer:' || d.id::text),
  'developer',
  'publisheriq',
  d.id::text,
  d.name,
  d.normalized_name,
  NULL,
  'legacy.developers',
  d.id::text,
  jsonb_build_object(
    'game_count', d.game_count,
    'first_game_release_date', d.first_game_release_date,
    'steam_vanity_url', d.steam_vanity_url
  ),
  COALESCE(d.created_at, now()),
  COALESCE(d.updated_at, now())
FROM legacy.developers d
CROSS JOIN constants
ON CONFLICT (entity_uid) DO UPDATE
SET
  canonical_name = EXCLUDED.canonical_name,
  normalized_name = EXCLUDED.normalized_name,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  metadata = EXCLUDED.metadata,
  updated_at = now();

WITH constants AS (
  SELECT '8b8600d2-2b09-4f74-b95c-77f95fdf00f4'::uuid AS entity_namespace
)
INSERT INTO core.entities (
  entity_uid,
  entity_kind,
  platform,
  platform_entity_id,
  canonical_name,
  normalized_name,
  parent_entity_uid,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  public.uuid_generate_v5(constants.entity_namespace, 'publisheriq:publisher:' || p.id::text),
  'publisher',
  'publisheriq',
  p.id::text,
  p.name,
  p.normalized_name,
  NULL,
  'legacy.publishers',
  p.id::text,
  jsonb_build_object(
    'game_count', p.game_count,
    'first_game_release_date', p.first_game_release_date,
    'steam_vanity_url', p.steam_vanity_url
  ),
  COALESCE(p.created_at, now()),
  COALESCE(p.updated_at, now())
FROM legacy.publishers p
CROSS JOIN constants
ON CONFLICT (entity_uid) DO UPDATE
SET
  canonical_name = EXCLUDED.canonical_name,
  normalized_name = EXCLUDED.normalized_name,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO core.entity_aliases (
  entity_uid,
  alias,
  normalized_alias,
  alias_type,
  is_primary,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  entity_uid,
  canonical_name,
  normalized_name,
  'canonical_name',
  true,
  source_table,
  source_pk,
  '{}'::jsonb,
  created_at,
  updated_at
FROM core.entities
ON CONFLICT (entity_uid, normalized_alias, alias_type) DO UPDATE
SET
  alias = EXCLUDED.alias,
  is_primary = EXCLUDED.is_primary,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  updated_at = now();

INSERT INTO core.entity_aliases (
  entity_uid,
  alias,
  normalized_alias,
  alias_type,
  is_primary,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  entity_uid,
  normalized_name,
  normalized_name,
  'normalized_name',
  false,
  source_table,
  source_pk,
  '{}'::jsonb,
  created_at,
  updated_at
FROM core.entities
ON CONFLICT (entity_uid, normalized_alias, alias_type) DO UPDATE
SET
  alias = EXCLUDED.alias,
  is_primary = EXCLUDED.is_primary,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  updated_at = now();

INSERT INTO core.entity_external_ids (
  entity_uid,
  external_system,
  external_id,
  is_primary,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  entity_uid,
  CASE entity_kind
    WHEN 'game' THEN 'steam_appid'
    WHEN 'developer' THEN 'publisheriq_developer_id'
    WHEN 'publisher' THEN 'publisheriq_publisher_id'
  END,
  platform_entity_id,
  true,
  source_table,
  source_pk,
  '{}'::jsonb,
  created_at,
  updated_at
FROM core.entities
ON CONFLICT (entity_uid, external_system, external_id) DO UPDATE
SET
  is_primary = EXCLUDED.is_primary,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  updated_at = now();

WITH constants AS (
  SELECT '8b8600d2-2b09-4f74-b95c-77f95fdf00f4'::uuid AS entity_namespace
)
INSERT INTO core.entity_relationships (
  source_entity_uid,
  target_entity_uid,
  relationship_type,
  is_primary,
  sort_order,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  public.uuid_generate_v5(constants.entity_namespace, 'steam:game:' || ad.appid::text),
  public.uuid_generate_v5(constants.entity_namespace, 'publisheriq:developer:' || ad.developer_id::text),
  'developed_by',
  true,
  0,
  'legacy.app_developers',
  ad.appid::text || ':' || ad.developer_id::text,
  '{}'::jsonb,
  now(),
  now()
FROM legacy.app_developers ad
CROSS JOIN constants
ON CONFLICT (source_entity_uid, target_entity_uid, relationship_type) DO UPDATE
SET
  is_primary = EXCLUDED.is_primary,
  sort_order = EXCLUDED.sort_order,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  updated_at = now();

WITH constants AS (
  SELECT '8b8600d2-2b09-4f74-b95c-77f95fdf00f4'::uuid AS entity_namespace
)
INSERT INTO core.entity_relationships (
  source_entity_uid,
  target_entity_uid,
  relationship_type,
  is_primary,
  sort_order,
  source_table,
  source_pk,
  metadata,
  created_at,
  updated_at
)
SELECT
  public.uuid_generate_v5(constants.entity_namespace, 'steam:game:' || ap.appid::text),
  public.uuid_generate_v5(constants.entity_namespace, 'publisheriq:publisher:' || ap.publisher_id::text),
  'published_by',
  true,
  0,
  'legacy.app_publishers',
  ap.appid::text || ':' || ap.publisher_id::text,
  '{}'::jsonb,
  now(),
  now()
FROM legacy.app_publishers ap
CROSS JOIN constants
ON CONFLICT (source_entity_uid, target_entity_uid, relationship_type) DO UPDATE
SET
  is_primary = EXCLUDED.is_primary,
  sort_order = EXCLUDED.sort_order,
  source_table = EXCLUDED.source_table,
  source_pk = EXCLUDED.source_pk,
  updated_at = now();
