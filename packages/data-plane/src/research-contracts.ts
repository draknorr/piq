import type { EntityKind, QueryProvenance } from './contracts.js';

export type ResearchRole = 'admin' | 'internal' | 'researcher';
export type ResearchPackBudget = 'full' | 'lite' | 'standard';

export type ReportPackType =
  | 'company_diligence'
  | 'game_research'
  | 'genre_growth'
  | 'readonly_analysis'
  | 'report_recreation'
  | 'unreleased_opportunity'
  | 'youtube_creator';

export type ReportConfidence = 'directional_signal' | 'high_confidence' | 'strategic_inference';

export interface ReportPackFreshness {
  capturedAt: string | null;
  label: string;
  source: string;
}

export interface ReportPackEntity {
  displayName: string;
  entityKind: EntityKind | 'report' | 'topic';
  entityUid?: string | null;
  platform?: string | null;
  platformEntityId?: string | null;
}

export interface ReportEvidenceArtifact {
  artifactId: string;
  byteSize?: number | null;
  citationHandle: string;
  kind:
    | 'csv'
    | 'data_audit'
    | 'html'
    | 'json'
    | 'jsonl'
    | 'markdown'
    | 'pdf'
    | 'sql'
    | 'unknown';
  path: string;
  rowCount?: number | null;
  title: string;
}

export interface ReportEvidenceSection {
  aggregates?: Record<string, unknown> | null;
  citationHandles: string[];
  confidence: ReportConfidence;
  id: string;
  limitations: string[];
  rows: Record<string, unknown>[];
  sampleSize?: number | null;
  sourceTables: string[];
  summary: string;
  title: string;
  truncated: boolean;
}

export interface ReportEvidenceCostEstimate {
  budget: ResearchPackBudget;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedRows: number;
  notes: string[];
}

export interface ReportEvidencePack {
  artifacts: ReportEvidenceArtifact[];
  confidenceHints: Array<{
    confidence: ReportConfidence;
    reason: string;
  }>;
  costEstimate: ReportEvidenceCostEstimate;
  entities: ReportPackEntity[];
  freshness: ReportPackFreshness[];
  generatedAt: string;
  limitations: string[];
  packId: string;
  packType: ReportPackType;
  provenance: QueryProvenance[];
  request: Record<string, unknown>;
  sections: ReportEvidenceSection[];
}

export interface ReportArchiveItem {
  artifactCount: number;
  artifacts: ReportEvidenceArtifact[];
  date: string | null;
  id: string;
  path: string;
  reportType: string;
  title: string;
}

export interface GetReportInstructionsRequest {
  audience?: string | null;
  depth?: 'full' | 'short' | 'standard' | null;
  shape?: string | null;
}

export interface GetReportInstructionsResponse {
  audience: string;
  depth: string;
  resources: Array<{ title: string; uri: string }>;
  sections: ReportEvidenceSection[];
  shape: string;
}

export interface SearchReportArchiveRequest {
  limit?: number | null;
  query?: string | null;
  reportType?: string | null;
}

export interface SearchReportArchiveResponse {
  items: ReportArchiveItem[];
  totalMatches: number;
}

export interface GameResearchPackRequest {
  budget?: ResearchPackBudget | null;
  game: string;
  include?: Array<
    | 'achievement'
    | 'change_activity'
    | 'community'
    | 'metric_history'
    | 'peer_cohort'
    | 'review_history'
    | 'store_state'
    | 'youtube'
  > | null;
  peerMode?: 'none' | 'similarity' | 'tag_cohort' | null;
  windows?: {
    changesDays?: number | null;
    metricStartDate?: string | null;
    metricEndDate?: string | null;
    newsDays?: number | null;
    youtubeWindow?: '1d' | '7d' | '14d' | '30d' | 'current' | null;
  } | null;
}

export interface GenreGrowthPackRequest {
  budget?: ResearchPackBudget | null;
  dimensions?: Array<'genre' | 'tag' | 'theme'> | null;
  topN?: number | null;
  windows?: {
    endDate?: string | null;
    startDate?: string | null;
  } | null;
  year?: number | null;
}

export interface YoutubeCreatorPackRequest {
  budget?: ResearchPackBudget | null;
  game: string;
  limit?: number | null;
  window?: '1d' | '7d' | '14d' | '30d' | 'current' | null;
}

export interface CompanyDiligencePackRequest {
  budget?: ResearchPackBudget | null;
  company: string;
  includeCommunity?: boolean | null;
  targetGames?: string[] | null;
}

export interface UnreleasedOpportunityPackRequest {
  budget?: ResearchPackBudget | null;
  filters?: {
    genres?: string[] | null;
    tags?: string[] | null;
  } | null;
  releaseWindow?: {
    endDate?: string | null;
    startDate?: string | null;
  } | null;
  targetLens?: 'all' | 'no_publisher' | 'self_published' | 'small_publisher' | null;
}

export interface ReportRecreationPackRequest {
  budget?: ResearchPackBudget | null;
  reportId: string;
}

export interface ReadonlyAnalysisRequest {
  budget?: ResearchPackBudget | null;
  expectedRows?: number | null;
  purpose?: string | null;
  question?: string | null;
  sql: string;
}

export interface ReadonlyAnalysisResponse {
  diagnostics: {
    normalizedSqlHash: string;
    planCost: number | null;
    rejectedReasons: string[];
    role: ResearchRole;
    rowCap: number;
    safetyChecks: string[];
  };
  pack: ReportEvidencePack | null;
}
