import type { Metadata } from 'next';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getServiceSupabase } from '@/lib/supabase-service';
import { requireAdmin } from '@/lib/auth-utils';
import { ConfigurationRequired } from '@/components/ConfigurationRequired';
import {
  getSyncHealthData,
  getPriorityDistribution,
  getQueueStatus,
  getAppsWithErrors,
  getSourceCompletionStats,
  getFullyCompletedAppsCount,
  getPICSSyncState,
  getPICSDataStats,
  getCatalogControlStats,
  getLastSyncTimes,
  type PriorityDistribution,
  type QueueStatus,
  type AppWithError,
  type SourceCompletionStats,
  type SyncHealthData,
  type PICSSyncState,
  type PICSDataStats,
  type CatalogControlStats,
} from '@/lib/sync-queries';
import { getCachedDashboardData, setCachedDashboardData } from '@/lib/admin-dashboard-cache';
import type { GuardrailTraceEntry, ToolAnswerContractSummary } from '@/lib/chat/chat-context-types';
import { AdminDashboard } from './AdminDashboard';

export const metadata: Metadata = {
  title: 'Admin',
};

export const dynamic = 'force-dynamic';

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
  picsDataStats: PICSDataStats;
  catalogControlStats: CatalogControlStats;
  chatLogs: ChatQueryLog[];
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

  const supabase = getServiceSupabase();

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
    picsSyncState,
    picsDataStats,
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
      .select('*')
      .eq('status', 'running')
      .order('started_at', { ascending: false }),
    supabase
      .from('sync_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100),
    getPICSSyncState(supabase),
    // Pass totalApps to avoid re-fetching
    getPICSDataStats(supabase, totalApps),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('chat_query_logs') as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
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
    picsSyncState,
    picsDataStats,
    catalogControlStats,
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
