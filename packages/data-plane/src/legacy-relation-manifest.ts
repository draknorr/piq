import type { DataPlaneRelationKey } from './contracts.js';

export type LegacyBackfillRelationName =
  | 'apps'
  | 'developers'
  | 'publishers'
  | 'app_developers'
  | 'app_publishers'
  | 'app_dlc'
  | 'steam_genres'
  | 'app_genres'
  | 'steam_tags'
  | 'app_steam_tags'
  | 'app_steam_deck'
  | 'user_pins'
  | 'user_alert_preferences'
  | 'user_pin_alert_settings'
  | 'user_alerts'
  | 'latest_daily_metrics';

export interface LegacyBackfillRelationSpec {
  bootstrapSqlFile: `packages/data-plane/sql/tiger-bootstrap/${string}.sql`;
  name: LegacyBackfillRelationName;
  relationKey: Extract<DataPlaneRelationKey, LegacyBackfillRelationName>;
  targetRelation: `legacy.${LegacyBackfillRelationName}`;
}

export const LEGACY_BACKFILL_RELATION_SPECS: LegacyBackfillRelationSpec[] = [
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0020_legacy_compatibility.sql',
    name: 'apps',
    relationKey: 'apps',
    targetRelation: 'legacy.apps',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0020_legacy_compatibility.sql',
    name: 'developers',
    relationKey: 'developers',
    targetRelation: 'legacy.developers',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0020_legacy_compatibility.sql',
    name: 'publishers',
    relationKey: 'publishers',
    targetRelation: 'legacy.publishers',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0020_legacy_compatibility.sql',
    name: 'app_developers',
    relationKey: 'app_developers',
    targetRelation: 'legacy.app_developers',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0020_legacy_compatibility.sql',
    name: 'app_publishers',
    relationKey: 'app_publishers',
    targetRelation: 'legacy.app_publishers',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0021_legacy_relationship_context.sql',
    name: 'app_dlc',
    relationKey: 'app_dlc',
    targetRelation: 'legacy.app_dlc',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0021_legacy_taxonomy.sql',
    name: 'steam_genres',
    relationKey: 'steam_genres',
    targetRelation: 'legacy.steam_genres',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0021_legacy_taxonomy.sql',
    name: 'app_genres',
    relationKey: 'app_genres',
    targetRelation: 'legacy.app_genres',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0021_legacy_taxonomy.sql',
    name: 'steam_tags',
    relationKey: 'steam_tags',
    targetRelation: 'legacy.steam_tags',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0021_legacy_taxonomy.sql',
    name: 'app_steam_tags',
    relationKey: 'app_steam_tags',
    targetRelation: 'legacy.app_steam_tags',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0022_legacy_feature_and_user_context.sql',
    name: 'app_steam_deck',
    relationKey: 'app_steam_deck',
    targetRelation: 'legacy.app_steam_deck',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0022_legacy_feature_and_user_context.sql',
    name: 'user_pins',
    relationKey: 'user_pins',
    targetRelation: 'legacy.user_pins',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0022_legacy_feature_and_user_context.sql',
    name: 'user_alert_preferences',
    relationKey: 'user_alert_preferences',
    targetRelation: 'legacy.user_alert_preferences',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0022_legacy_feature_and_user_context.sql',
    name: 'user_pin_alert_settings',
    relationKey: 'user_pin_alert_settings',
    targetRelation: 'legacy.user_pin_alert_settings',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0022_legacy_feature_and_user_context.sql',
    name: 'user_alerts',
    relationKey: 'user_alerts',
    targetRelation: 'legacy.user_alerts',
  },
  {
    bootstrapSqlFile: 'packages/data-plane/sql/tiger-bootstrap/0020_legacy_compatibility.sql',
    name: 'latest_daily_metrics',
    relationKey: 'latest_daily_metrics',
    targetRelation: 'legacy.latest_daily_metrics',
  },
];

export const LEGACY_BACKFILL_CRITICAL_RELATIONS: LegacyBackfillRelationName[] = [
  'apps',
  'app_dlc',
  'latest_daily_metrics',
  'app_steam_deck',
];

export const LEGACY_BACKFILL_RELATION_NAMES = LEGACY_BACKFILL_RELATION_SPECS.map(
  ({ name }) => name
);

export const LEGACY_BACKFILL_RELATION_KEYS = LEGACY_BACKFILL_RELATION_SPECS.map(
  ({ relationKey }) => relationKey
);

export const TIGER_LEGACY_READY_CONTRACT_FALLBACK_RELATION_KEYS: DataPlaneRelationKey[] = [
  'app_franchises',
  'franchises',
];

export const TIGER_LEGACY_RELATION_KEYS: DataPlaneRelationKey[] = [
  ...LEGACY_BACKFILL_RELATION_KEYS,
  ...TIGER_LEGACY_READY_CONTRACT_FALLBACK_RELATION_KEYS,
  'steam_categories',
];

export const LEGACY_BACKFILL_RELATIONS_BY_NAME = new Map(
  LEGACY_BACKFILL_RELATION_SPECS.map((spec) => [spec.name, spec] as const)
);

