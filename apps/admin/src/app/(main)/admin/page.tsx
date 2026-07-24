import type { Metadata } from "next";
import { runTigerQuery } from "@publisheriq/database";
import { postToQueryApi } from "@/lib/query-api-client";
import { resolveProductReadTarget } from "@/lib/product-read-runtime";
import { resolveAppProjectionRelations } from "@/app/(main)/apps/lib/apps-projection-runtime";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getServiceSupabase } from "@/lib/supabase-service";
import { requireAdmin } from "@/lib/auth-utils";
import { ConfigurationRequired } from "@/components/ConfigurationRequired";
import {
  getSyncHealthData,
  getPriorityDistribution,
  getQueueStatus,
  getAppsWithErrors,
  getSourceCompletionStats,
  getFullyCompletedAppsCount,
  getPICSDataStats,
  getCatalogControlStats,
  getCcuQualityStats,
  getLastSyncTimes,
  type PriorityDistribution,
  type QueueStatus,
  type AppWithError,
  type SourceCompletionStats,
  type SyncHealthData,
  type PICSSyncState,
  type PICSDataStats,
  type CatalogControlStats,
  type CcuQualityStats,
} from '@/lib/sync-queries';
import { getCachedDashboardData, setCachedDashboardData } from '@/lib/admin-dashboard-cache';
import type { GuardrailTraceEntry, ToolAnswerContractSummary } from '@/lib/chat/chat-context-types';
import { AdminDashboard } from './AdminDashboard';
import {
  getPicsServiceStatus,
  type PicsServiceStatus,
} from './pics-service-status';

export const metadata: Metadata = {
  title: 'Admin',
};

export const dynamic = 'force-dynamic';

const ALL_JOBS_LIMIT = 100;
const RECENT_CHAT_LOG_LIMIT = 50;

export interface SyncJob {
  id: string;
  job_type: string;
  status: string | null;
  items_processed: number | null;
  items_succeeded: number | null;
  items_failed: number | null;
  items_created: number | null;
  items_updated: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  github_run_id: string | null;
  batch_size: number | null;
  created_at: string | null;
}

export interface ChatQueryLog {
  id: string;
  query_text: string;
  tool_names: string[];
  tool_count: number;
  iteration_count: number;
  response_length: number;
  timing_llm_ms: number | null;
  timing_tools_ms: number | null;
  timing_total_ms: number | null;
  created_at: string;
  chat_family?: string | null;
  quality_flags?: string[] | null;
  session_context_summary?: Record<string, unknown> | null;
  guardrail_trace?: GuardrailTraceEntry[] | null;
  answer_contract_summary?: ToolAnswerContractSummary | null;
}

export interface AdminDashboardData {
  syncHealth: SyncHealthData;
  priorityDistribution: PriorityDistribution;
  queueStatus: QueueStatus;
  appsWithErrors: AppWithError[];
  completionStats: SourceCompletionStats[];
  fullyCompletedCount: number;
  runningJobs: SyncJob[];
  recentJobs: SyncJob[];
  allJobs: SyncJob[];
  picsSyncState: PICSSyncState;
  picsServiceStatus: PicsServiceStatus;
  picsDataStats: PICSDataStats;
  catalogControlStats: CatalogControlStats;
  ccuQualityStats: CcuQualityStats;
  chatLogs: ChatQueryLog[];
  sourceHealth?: {
    captureQueue: {
      deadLetter: number;
      oldestPendingAt: string | null;
      pending: number;
    };
    eventRegistry: {
      latestUnknownAt: string | null;
      unknownEventTypes: number;
    };
    projection: {
      latestSourceAt: string | null;
      relation: string;
      rowCount: number;
    };
    readiness: Array<{
      count: number;
      source: string;
      status: string;
    }>;
    verifiedAt: string;
  };
}

interface TigerProductHealthResponse {
  admin: Omit<
    AdminDashboardData,
    | "picsServiceStatus"
    | "picsSyncState"
    | "recentJobs"
    | "runningJobs"
    | "sourceHealth"
  > | null;
  provenance: {
    source: "tiger";
  };
  sourceHealth: NonNullable<AdminDashboardData["sourceHealth"]> & {
    pics: {
      cursorUpdatedAt: string | null;
      lastChangeNumber: number;
    };
  };
}

interface TigerPicsSyncStateRow {
  last_change_number: number | string | null;
  updated_at: string | null;
}

function toCount(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function getTigerPicsSyncState(): Promise<PICSSyncState | null> {
  try {
    const result = await runTigerQuery<TigerPicsSyncStateRow>(
      `
        SELECT last_change_number, updated_at::text
        FROM ops.pics_sync_state
        WHERE id = 1
        LIMIT 1
      `
    );

    const row = result.rows[0];
    if (!row) {
      return {
        lastChangeNumber: 0,
        updatedAt: null,
      };
    }

    return {
      lastChangeNumber: toCount(row.last_change_number),
      updatedAt: row.updated_at ?? null,
    };
  } catch (error) {
    console.warn('Tiger PICS sync-state read failed; reporting unavailable.', error);
    return null;
  }
}

async function getAdminDashboardData(): Promise<AdminDashboardData | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  // Check cache first - return cached data if available and fresh
  const cached = getCachedDashboardData();
  if (cached) {
    return cached;
  }

  if (resolveProductReadTarget("admin") === "tiger") {
    const [healthResult, picsServiceStatus] = await Promise.all([
      postToQueryApi<TigerProductHealthResponse>(
        "/v1/contracts/get-product-health",
        {
          detail: "admin",
          errorLimit: 20,
          jobLimit: ALL_JOBS_LIMIT,
          logLimit: RECENT_CHAT_LOG_LIMIT,
          projectionVersion: resolveAppProjectionRelations().version,
        },
        { timeoutMs: 20_000 },
      ),
      getPicsServiceStatus(),
    ]);

    if (
      !healthResult.ok ||
      !healthResult.data ||
      !healthResult.data.admin ||
      healthResult.data.provenance.source !== "tiger"
    ) {
      throw new Error(
        `Tiger admin product-health contract unavailable: ${
          healthResult.errorCode ?? healthResult.reason ?? "unknown error"
        }`,
      );
    }

    const allJobs = healthResult.data.admin.allJobs as SyncJob[];
    const data: AdminDashboardData = {
      ...healthResult.data.admin,
      allJobs,
      chatLogs: healthResult.data.admin.chatLogs as ChatQueryLog[],
      picsServiceStatus,
      picsSyncState: {
        lastChangeNumber: healthResult.data.sourceHealth.pics.lastChangeNumber,
        updatedAt: healthResult.data.sourceHealth.pics.cursorUpdatedAt,
      },
      recentJobs: allJobs.slice(0, 10),
      runningJobs: allJobs.filter((job) => job.status === "running"),
      sourceHealth: healthResult.data.sourceHealth,
    };
    setCachedDashboardData(data);
    return data;
  }

  const supabase = getServiceSupabase();
  const recentChatCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Phase 1: Fetch shared data first to avoid duplicate queries
  // These are used by multiple functions below
  const [queueStatus, lastSyncs, catalogControlStats] = await Promise.all([
    getQueueStatus(supabase),
    getLastSyncTimes(supabase),
    getCatalogControlStats(supabase),
  ]);
  const totalApps = catalogControlStats.currentCatalogApps;

  // Phase 2: Fetch remaining data, passing shared data where needed
  const [
    syncHealth,
    priorityDistribution,
    appsWithErrors,
    completionStats,
    fullyCompletedCount,
    runningJobs,
    allJobs,
    picsDataStats,
    ccuQualityStats,
    chatLogs,
  ] = await Promise.all([
    // Pass queueStatus.overdue and lastSyncs to avoid re-fetching
    getSyncHealthData(supabase, { lastSyncs, overdueApps: queueStatus.overdue }),
    getPriorityDistribution(supabase),
    getAppsWithErrors(supabase, 20),
    // Pass totalApps and lastSyncs to avoid re-fetching
    getSourceCompletionStats(supabase, { totalApps, lastSyncs }),
    getFullyCompletedAppsCount(supabase),
    supabase
      .from('sync_jobs')
      .select(
        'id, job_type, status, items_processed, items_succeeded, items_failed, items_created, items_updated, started_at, completed_at, error_message, github_run_id, batch_size, created_at'
      )
      .eq('status', 'running')
      .order('started_at', { ascending: false }),
    supabase
      .from('sync_jobs')
      .select(
        'id, job_type, status, items_processed, items_succeeded, items_failed, items_created, items_updated, started_at, completed_at, error_message, github_run_id, batch_size, created_at'
      )
      .order('started_at', { ascending: false })
      .limit(ALL_JOBS_LIMIT),
    // Pass totalApps to avoid re-fetching
    getPICSDataStats(supabase, totalApps),
    getCcuQualityStats(supabase, totalApps),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('chat_query_logs') as any)
      .select(
        'id, query_text, tool_names, tool_count, timing_total_ms, created_at, chat_family, quality_flags, session_context_summary, guardrail_trace, answer_contract_summary'
      )
      .gte('created_at', recentChatCutoff)
      .order('created_at', { ascending: false })
      .limit(RECENT_CHAT_LOG_LIMIT),
  ]);

  const [tigerPicsSyncState, picsServiceStatus] = await Promise.all([
    getTigerPicsSyncState(),
    getPicsServiceStatus(),
  ]);

  const allJobsData = allJobs.data ?? [];

  const data: AdminDashboardData = {
    syncHealth,
    priorityDistribution,
    queueStatus,
    appsWithErrors,
    completionStats,
    fullyCompletedCount,
    runningJobs: runningJobs.data ?? [],
    recentJobs: allJobsData.slice(0, 10), // Derive from allJobs instead of separate query
    allJobs: allJobsData,
    picsSyncState: tigerPicsSyncState ?? {
      lastChangeNumber: 0,
      updatedAt: null,
    },
    picsServiceStatus,
    picsDataStats: {
      ...picsDataStats,
      dataSource: 'approximate_fallback',
      isApproximate: true,
    },
    catalogControlStats,
    ccuQualityStats,
    chatLogs: chatLogs.data ?? [],
  };

  // Cache the fresh data for subsequent requests
  setCachedDashboardData(data);

  return data;
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const data = await getAdminDashboardData();

  if (!data) {
    return <ConfigurationRequired />;
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-display-sm text-text-primary">Admin Dashboard</h1>
        <p className="mt-1 text-body-sm text-text-secondary">
          System health, sync status, and job monitoring
        </p>
      </div>

      <AdminDashboard data={data} />
    </div>
  );
}
