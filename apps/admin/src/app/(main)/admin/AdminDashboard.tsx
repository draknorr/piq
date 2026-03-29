'use client';

import { Fragment, useState } from 'react';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { StatusBar } from '@/components/data-display/DenseMetricGrid';
import { SourceCompletionCard } from '@/components/data-display/MiniProgressBar';
import {
  formatRelativeTime,
  formatDuration,
  type PriorityDistribution,
} from '@/lib/sync-queries';
import type { AdminDashboardData, SyncJob, ChatQueryLog } from './page';
import { CheckCircle2, MessageSquare, Search, Copy, ChevronDown, ChevronRight } from 'lucide-react';

// Source configuration
const sourceConfig: Record<string, { label: string; icon: string }> = {
  steamspy: { label: 'SteamSpy', icon: '📊' },
  storefront: { label: 'Storefront', icon: '🏪' },
  reviews: { label: 'Reviews', icon: '⭐' },
  histogram: { label: 'Histogram', icon: '📈' },
  pics: { label: 'PICS', icon: '⚡' },
};

// Priority tier configuration
const priorityConfig = [
  { key: 'high', label: 'High', color: 'bg-accent-red', interval: '6hr' },
  { key: 'medium', label: 'Med', color: 'bg-accent-orange', interval: '12hr' },
  { key: 'normal', label: 'Norm', color: 'bg-accent-yellow', interval: '24hr' },
  { key: 'low', label: 'Low', color: 'bg-accent-primary', interval: '48hr' },
  { key: 'minimal', label: 'Min', color: 'bg-text-muted', interval: '7d' },
] as const;

// Job status colors
const jobStatusColors: Record<string, string> = {
  running: 'bg-accent-primary/15 text-accent-primary border-accent-primary/30',
  completed: 'bg-accent-green/15 text-accent-green border-accent-green/30',
  failed: 'bg-accent-red/15 text-accent-red border-accent-red/30',
};

// Format milliseconds to human readable
function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatChatFlag(flag: string): string {
  return flag.replace(/_/g, ' ');
}

function summarizeSessionContext(context: ChatQueryLog['session_context_summary']): string | null {
  if (!context || typeof context !== 'object') {
    return null;
  }

  const typedContext = context as {
    entities?: Array<{ kind?: string; name?: string }>;
    constraints?: Array<{ key?: string; value?: string }>;
    candidateSet?: { kind?: string; names?: string[] };
  };

  const entitySummary = Array.isArray(typedContext.entities)
    ? typedContext.entities
        .slice(0, 3)
        .map((entity) => `${entity.kind ?? 'entity'}:${entity.name ?? 'unknown'}`)
        .join(', ')
    : '';
  const constraintSummary = Array.isArray(typedContext.constraints)
    ? typedContext.constraints
        .slice(0, 3)
        .map((constraint) => `${constraint.key ?? 'constraint'}=${constraint.value ?? ''}`)
        .join(', ')
    : '';
  const candidateSummary =
    typedContext.candidateSet &&
    Array.isArray(typedContext.candidateSet.names) &&
    typedContext.candidateSet.names.length > 0
      ? `${typedContext.candidateSet.kind ?? 'set'}: ${typedContext.candidateSet.names.slice(0, 4).join(', ')}`
      : '';

  return [entitySummary, constraintSummary, candidateSummary].filter(Boolean).join(' | ') || null;
}

export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());

  const toggleJobExpanded = (id: string) => {
    setExpandedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Calculate overall completion
  const overallCompletion =
    data.completionStats.length > 0
      ? data.completionStats.reduce((sum, s) => sum + s.completionPercent, 0) /
        data.completionStats.length
      : 0;

  const totalApps = data.completionStats[0]?.totalApps ?? 0;
  const priorityTotal = Object.values(data.priorityDistribution).reduce((a, b) => a + b, 0);
  const confirmedCcuCount =
    data.ccuQualityStats.confirmedPositive + data.ccuQualityStats.confirmedZero;
  const confirmedCcuPercent =
    data.ccuQualityStats.currentCatalogApps > 0
      ? (confirmedCcuCount / data.ccuQualityStats.currentCatalogApps) * 100
      : 0;
  const ccuUpdatedLabel = data.ccuQualityStats.updatedAt
    ? `updated ${formatRelativeTime(data.ccuQualityStats.updatedAt)}`
    : null;

  return (
    <div className="space-y-3">
      {/* Top Status Bar - Always Visible */}
      <StatusBar
        metrics={[
          {
            label: 'Running',
            value: data.runningJobs.length,
            status: data.runningJobs.length > 0 ? 'info' : 'neutral',
          },
          {
            label: 'Jobs (24h)',
            value: data.syncHealth.jobs24h.total,
            status: 'neutral',
          },
          {
            label: 'Success',
            value: `${data.syncHealth.successRate7d.toFixed(1)}%`,
            status: data.syncHealth.successRate7d >= 95 ? 'success' : data.syncHealth.successRate7d >= 80 ? 'warning' : 'error',
          },
          {
            label: 'Overdue',
            value: data.syncHealth.overdueApps,
            status: data.syncHealth.overdueApps > 500 ? 'error' : data.syncHealth.overdueApps > 100 ? 'warning' : 'success',
          },
          {
            label: 'Errors',
            value: data.syncHealth.appsWithErrors,
            status: data.syncHealth.appsWithErrors > 10 ? 'error' : data.syncHealth.appsWithErrors > 0 ? 'warning' : 'success',
          },
          {
            label: 'PICS',
            value: data.picsSyncState.lastChangeNumber > 0 ? `#${data.picsSyncState.lastChangeNumber.toLocaleString()}` : 'N/A',
            status: data.picsSyncState.lastChangeNumber > 0 ? 'info' : 'neutral',
          },
        ]}
      />

      {/* Data Completion Section */}
      <CollapsibleSection
        title="Data Completion"
        badge={{ value: `${overallCompletion.toFixed(1)}%`, variant: overallCompletion >= 80 ? 'success' : overallCompletion >= 50 ? 'info' : 'warning' }}
        headerExtra={
          <span className="text-caption text-text-muted">
            {data.fullyCompletedCount.toLocaleString()} / {totalApps.toLocaleString()} complete
          </span>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {data.completionStats.map((stats) => (
            <SourceCompletionCard
              key={stats.source}
              source={sourceConfig[stats.source]?.label ?? stats.source}
              icon={sourceConfig[stats.source]?.icon ?? '📦'}
              synced={stats.syncedApps}
              total={stats.totalApps}
              lastSync={stats.lastSyncTime ? formatRelativeTime(stats.lastSyncTime) : undefined}
            />
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Catalog Control"
        badge={{
          value: data.catalogControlStats.currentCatalogApps.toLocaleString(),
          variant: data.catalogControlStats.liveOnlyMissing > 0 || data.catalogControlStats.staleRunningApplistJobs > 0
            ? 'warning'
            : 'success',
        }}
        headerExtra={
          <span className="text-caption text-text-muted">
            live applist: {data.catalogControlStats.latestLiveAppCount.toLocaleString()}
          </span>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <QueueMetric
            label="Current Catalog"
            value={data.catalogControlStats.currentCatalogApps}
            status="success"
          />
          <QueueMetric
            label="Historical Retained"
            value={data.catalogControlStats.historicalRetainedApps}
            status={data.catalogControlStats.historicalRetainedApps > 0 ? 'info' : 'neutral'}
          />
          <QueueMetric
            label="Live Missing"
            value={data.catalogControlStats.liveOnlyMissing}
            status={data.catalogControlStats.liveOnlyMissing > 0 ? 'error' : 'success'}
          />
          <QueueMetric
            label="Stale Applist Jobs"
            value={data.catalogControlStats.staleRunningApplistJobs}
            status={data.catalogControlStats.staleRunningApplistJobs > 0 ? 'warning' : 'success'}
          />
        </div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-caption text-text-muted">
          <div>
            Latest applist started:{' '}
            {data.catalogControlStats.latestApplistStartedAt
              ? formatRelativeTime(data.catalogControlStats.latestApplistStartedAt)
              : 'Never'}
          </div>
          <div>
            Latest applist completed:{' '}
            {data.catalogControlStats.latestApplistCompletedAt
              ? formatRelativeTime(data.catalogControlStats.latestApplistCompletedAt)
              : 'Never'}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="CCU Quality"
        badge={{
          value: `${confirmedCcuPercent.toFixed(1)}%`,
          variant:
            data.ccuQualityStats.isApproximate
              || data.ccuQualityStats.suspectZero > 0
              || data.ccuQualityStats.legacyUnknown > 0
              ? 'warning'
              : 'success',
        }}
        headerExtra={
          <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
            <span>
              {confirmedCcuCount.toLocaleString()} / {data.ccuQualityStats.currentCatalogApps.toLocaleString()} confirmed
            </span>
            {ccuUpdatedLabel ? <span>{ccuUpdatedLabel}</span> : null}
            {data.ccuQualityStats.isApproximate ? (
              <span className="text-accent-orange">approximate fallback</span>
            ) : null}
          </div>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <QueueMetric
            label="Tier Assigned"
            value={data.ccuQualityStats.tierAssigned}
            status="success"
          />
          <QueueMetric
            label="No Tier"
            value={data.ccuQualityStats.noTierAssignment}
            status={data.ccuQualityStats.noTierAssignment > 0 ? 'warning' : 'success'}
          />
          <QueueMetric
            label="Confirmed +"
            value={data.ccuQualityStats.confirmedPositive}
            status="success"
          />
          <QueueMetric
            label="Confirmed 0"
            value={data.ccuQualityStats.confirmedZero}
            status="info"
          />
          <QueueMetric
            label="Suspect 0"
            value={data.ccuQualityStats.suspectZero}
            status={data.ccuQualityStats.suspectZero > 0 ? 'warning' : 'success'}
          />
          <QueueMetric
            label="Skipped"
            value={data.ccuQualityStats.skipped}
            status="neutral"
          />
          <QueueMetric
            label="Invalid"
            value={data.ccuQualityStats.invalid}
            status={data.ccuQualityStats.invalid > 0 ? 'warning' : 'success'}
          />
          <QueueMetric
            label="Unavailable"
            value={data.ccuQualityStats.unavailable}
            status={data.ccuQualityStats.unavailable > 0 ? 'warning' : 'success'}
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <QueueMetric
            label="Steam API"
            value={data.ccuQualityStats.steamApi}
            status="success"
          />
          <QueueMetric
            label="SteamSpy"
            value={data.ccuQualityStats.steamspy}
            status={data.ccuQualityStats.steamspy > 0 ? 'info' : 'neutral'}
          />
          <QueueMetric
            label="Legacy Unknown"
            value={data.ccuQualityStats.legacyUnknown}
            status={data.ccuQualityStats.legacyUnknown > 0 ? 'warning' : 'success'}
          />
        </div>
      </CollapsibleSection>

      {/* Sync Queue Section */}
      <CollapsibleSection
        title="Sync Queue"
        badge={{
          value: data.queueStatus.overdue,
          variant: data.queueStatus.overdue > 500 ? 'error' : data.queueStatus.overdue > 100 ? 'warning' : 'success',
        }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Priority Distribution */}
          <div className="p-2 rounded-md border border-border-subtle bg-surface-elevated/50">
            <div className="text-caption text-text-secondary mb-2">Priority Distribution</div>
            <div className="space-y-1.5">
              {priorityConfig.map(({ key, label, color, interval }) => {
                const count = data.priorityDistribution[key as keyof PriorityDistribution];
                const pct = priorityTotal > 0 ? (count / priorityTotal) * 100 : 0;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <div className="w-12 text-caption text-text-tertiary">{label}</div>
                    <div className="flex-1 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                      <div
                        className={`h-full ${color} transition-all`}
                        style={{ width: `${Math.max(pct, 0.5)}%` }}
                      />
                    </div>
                    <div className="w-16 text-caption text-text-secondary text-right">
                      {count.toLocaleString()}
                    </div>
                    <div className="w-8 text-caption-sm text-text-muted">{interval}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t border-border-subtle text-caption text-text-muted">
              Total: {priorityTotal.toLocaleString()} apps
            </div>
          </div>

          {/* Queue Status */}
          <div className="p-2 rounded-md border border-border-subtle bg-surface-elevated/50">
            <div className="text-caption text-text-secondary mb-2">Queue Status</div>
            <div className="grid grid-cols-2 gap-2">
              <QueueMetric
                label="Overdue"
                value={data.queueStatus.overdue}
                status={data.queueStatus.overdue > 500 ? 'error' : data.queueStatus.overdue > 100 ? 'warning' : 'success'}
              />
              <QueueMetric
                label="Due < 1hr"
                value={data.queueStatus.dueIn1Hour}
                status="warning"
              />
              <QueueMetric
                label="Due < 6hr"
                value={data.queueStatus.dueIn6Hours}
                status="info"
              />
              <QueueMetric
                label="Due < 24hr"
                value={data.queueStatus.dueIn24Hours}
                status="neutral"
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* PICS Service Section */}
      <CollapsibleSection
        title="PICS Service"
        badge={{
          value: data.picsSyncState.lastChangeNumber > 0 ? 'Active' : 'Inactive',
          variant: data.picsSyncState.lastChangeNumber > 0 ? 'success' : 'warning',
        }}
      >
        <div className="p-2 rounded-md border border-border-subtle bg-surface-elevated/50">
          {/* Mobile-friendly grid: 2 cols base, scales up on larger screens */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Sync State */}
            <div>
              <div className="text-caption text-text-tertiary">Change Number</div>
              <div className="text-body font-semibold text-text-primary">
                {data.picsSyncState.lastChangeNumber > 0
                  ? data.picsSyncState.lastChangeNumber.toLocaleString()
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-caption text-text-tertiary">Last Updated</div>
              <div className="text-body font-semibold text-text-primary">
                {data.picsSyncState.updatedAt
                  ? formatRelativeTime(data.picsSyncState.updatedAt)
                  : '-'}
              </div>
            </div>
            {/* Data Coverage */}
            <PICSMetric
              label="PICS Synced"
              value={data.picsDataStats.withPicsSync}
              total={data.picsDataStats.totalApps}
            />
            <PICSMetric label="Tags" value={data.picsDataStats.withTags} isTotal />
            <PICSMetric label="Categories" value={data.picsDataStats.withCategories} isTotal />
            <PICSMetric label="Genres" value={data.picsDataStats.withGenres} isTotal />
            <PICSMetric label="Franchises" value={data.picsDataStats.withFranchises} isTotal />
            <PICSMetric label="Parent App" value={data.picsDataStats.withParentApp} isTotal />
          </div>
        </div>
      </CollapsibleSection>

      {/* Errors Section */}
      <CollapsibleSection
        title="Sync Errors"
        badge={{
          value: data.appsWithErrors.length,
          variant: data.appsWithErrors.length > 10 ? 'error' : data.appsWithErrors.length > 0 ? 'warning' : 'success',
        }}
        defaultOpen={data.appsWithErrors.length > 0}
      >
        {data.appsWithErrors.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-accent-green">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-body-sm">No sync errors</span>
          </div>
        ) : (
          <>
            {/* Mobile: Card view */}
            <div className="sm:hidden space-y-2">
            {data.appsWithErrors.slice(0, 10).map((app) => (
              <div key={app.appid} className="p-2 rounded border border-border-subtle bg-surface-raised">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="text-text-primary font-medium text-body-sm truncate">{app.name}</div>
                  <span className="px-1.5 py-0.5 rounded text-caption bg-accent-red/15 text-accent-red shrink-0">
                    {app.consecutive_errors}x
                  </span>
                </div>
                <div className="text-caption text-text-muted mb-1">
                  {app.last_error_source ?? 'Unknown'} • {formatRelativeTime(app.last_error_at)}
                </div>
                <div className="text-caption text-text-secondary line-clamp-2" title={app.last_error_message ?? ''}>
                  {app.last_error_message ?? '-'}
                </div>
              </div>
            ))}
            </div>
            {/* Desktop: Table view */}
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">App</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Errors</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Source</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Last Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.appsWithErrors.slice(0, 10).map((app) => (
                  <tr key={app.appid} className="hover:bg-surface-elevated/50">
                    <td className="py-1.5">
                      <div className="text-text-primary font-medium truncate max-w-[200px]">{app.name}</div>
                      <div className="text-caption text-text-muted">ID: {app.appid}</div>
                    </td>
                    <td className="py-1.5">
                      <span className="px-1.5 py-0.5 rounded text-caption bg-accent-red/15 text-accent-red">
                        {app.consecutive_errors}x
                      </span>
                    </td>
                    <td className="py-1.5 text-text-secondary">{app.last_error_source ?? '-'}</td>
                    <td className="py-1.5">
                      <div className="text-text-secondary truncate max-w-[250px]" title={app.last_error_message ?? ''}>
                        {app.last_error_message ?? '-'}
                      </div>
                      <div className="text-caption text-text-muted">{formatRelativeTime(app.last_error_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              {data.appsWithErrors.length > 10 && (
                <div className="mt-2 text-caption text-text-muted">
                  +{data.appsWithErrors.length - 10} more errors
                </div>
              )}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* Recent Jobs Section */}
      <CollapsibleSection
        title="Recent Jobs"
        badge={{ value: data.allJobs.length, variant: 'default' }}
      >
        <div className="space-y-1">
          {data.allJobs.slice(0, 15).map((job) => (
            <JobRow
              key={job.id}
              job={job}
              isExpanded={expandedJobIds.has(job.id)}
              onToggle={() => toggleJobExpanded(job.id)}
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* Last Sync Times */}
      <CollapsibleSection title="Last Sync Times">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <LastSyncItem label="SteamSpy" time={data.syncHealth.lastSyncs.steamspy} />
          <LastSyncItem label="Storefront" time={data.syncHealth.lastSyncs.storefront} />
          <LastSyncItem label="Reviews" time={data.syncHealth.lastSyncs.reviews} />
          <LastSyncItem label="Histogram" time={data.syncHealth.lastSyncs.histogram} />
        </div>
      </CollapsibleSection>

      {/* Chat Logs Section */}
      <ChatLogsSection logs={data.chatLogs} />
    </div>
  );
}

// Helper Components

function QueueMetric({
  label,
  value,
  status,
}: {
  label: string;
  value: number;
  status: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}) {
  const statusColors = {
    success: 'text-accent-green',
    warning: 'text-accent-yellow',
    error: 'text-accent-red',
    info: 'text-accent-primary',
    neutral: 'text-text-primary',
  };

  return (
    <div className="p-2 rounded bg-surface-raised border border-border-subtle">
      <div className="text-caption text-text-tertiary">{label}</div>
      <div className={`text-body font-semibold ${statusColors[status]}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function PICSMetric({
  label,
  value,
  total,
  isTotal,
}: {
  label: string;
  value: number;
  total?: number;
  isTotal?: boolean;
}) {
  const pct = total && total > 0 ? (value / total) * 100 : 0;

  return (
    <div>
      <div className="text-caption text-text-tertiary">{label}</div>
      <div className="text-body font-semibold text-text-primary">
        {value.toLocaleString()}
        {!isTotal && total && (
          <span className="text-caption text-text-muted ml-1">({pct.toFixed(1)}%)</span>
        )}
      </div>
    </div>
  );
}

function JobRow({
  job,
  isExpanded,
  onToggle,
}: {
  job: SyncJob;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const duration = job.completed_at && job.started_at
    ? formatDuration(new Date(job.completed_at).getTime() - new Date(job.started_at).getTime())
    : 'Running...';

  return (
    <div className="border border-border-subtle rounded overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between px-2 py-2 sm:py-1.5 hover:bg-surface-elevated/50 transition-colors text-left gap-1 sm:gap-0"
      >
        {/* Job info - always visible */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`px-1.5 py-0.5 rounded text-caption border shrink-0 ${
              jobStatusColors[job.status ?? 'unknown'] ?? 'bg-surface-elevated text-text-secondary'
            }`}
          >
            {job.status ?? 'unknown'}
          </span>
          <span className="text-body-sm font-medium text-text-primary truncate">{job.job_type}</span>
          {job.batch_size && (
            <span className="text-caption text-text-muted shrink-0">({job.batch_size})</span>
          )}
        </div>
        {/* Stats - wrap on mobile */}
        <div className="flex items-center gap-2 sm:gap-3 text-caption text-text-secondary flex-wrap">
          <span className="text-accent-green">{job.items_succeeded ?? 0}</span>
          <span className="text-text-muted">/</span>
          <span>{job.items_processed ?? 0}</span>
          {(job.items_failed ?? 0) > 0 && (
            <span className="text-accent-red">({job.items_failed} failed)</span>
          )}
          <span className="text-text-muted">{duration}</span>
          <span className="text-text-muted hidden sm:inline">{formatRelativeTime(job.started_at)}</span>
        </div>
      </button>
      {isExpanded && (
        <div className="px-2 py-2 bg-surface-elevated/30 border-t border-border-subtle text-body-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
            <div>
              <span className="text-text-muted">Started:</span>{' '}
              <span className="text-text-secondary">{job.started_at ? new Date(job.started_at).toLocaleString() : '-'}</span>
            </div>
            <div>
              <span className="text-text-muted">Completed:</span>{' '}
              <span className="text-text-secondary">
                {job.completed_at ? new Date(job.completed_at).toLocaleString() : '-'}
              </span>
            </div>
            {(job.items_created !== null || job.items_updated !== null) && (
              <div className="col-span-2">
                <span className="text-text-muted">Processing:</span>{' '}
                <span className="text-accent-primary">{job.items_created ?? 0} new</span>
                {' | '}
                <span className="text-accent-green">{job.items_updated ?? 0} updated</span>
              </div>
            )}
            {job.error_message && (
              <div className="col-span-2 mt-1">
                <div className="text-accent-red">Error:</div>
                <div className="p-1.5 mt-0.5 rounded bg-accent-red/10 text-accent-red font-mono text-caption-sm">
                  {job.error_message}
                </div>
              </div>
            )}
            {job.github_run_id && (
              <div className="col-span-2">
                <a
                  href={`https://github.com/draknorr/publisheriq/actions/runs/${job.github_run_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  View GitHub Actions Run
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LastSyncItem({ label, time }: { label: string; time: string | null }) {
  return (
    <div className="p-2 rounded border border-border-subtle bg-surface-elevated/50">
      <div className="text-caption text-text-tertiary">{label}</div>
      <div className="text-body-sm font-medium text-text-primary">
        {time ? formatRelativeTime(time) : 'Never'}
      </div>
    </div>
  );
}

function ChatLogsSection({ logs }: { logs: ChatQueryLog[] }) {
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const avgResponseTime =
    logs.length > 0
      ? Math.round(logs.reduce((sum, l) => sum + (l.timing_total_ms ?? 0), 0) / logs.length)
      : null;

  const avgToolCalls =
    logs.length > 0
      ? (logs.reduce((sum, l) => sum + l.tool_count, 0) / logs.length).toFixed(1)
      : '-';

  const queriesWithTools = logs.filter((l) => l.tool_count > 0).length;
  const toggleLogExpanded = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <CollapsibleSection
      title="Chat Logs"
      badge={{ value: logs.length, variant: 'default' }}
      headerExtra={
        <span className="text-caption text-text-muted">7-day retention</span>
      }
    >
      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="p-2 rounded border border-border-subtle bg-surface-elevated/50">
          <div className="text-caption text-text-tertiary">Total Queries</div>
          <div className="text-body font-semibold text-text-primary">{logs.length}</div>
        </div>
        <div className="p-2 rounded border border-border-subtle bg-surface-elevated/50">
          <div className="text-caption text-text-tertiary">Avg Response</div>
          <div className="text-body font-semibold text-text-primary">{formatMs(avgResponseTime)}</div>
        </div>
        <div className="p-2 rounded border border-border-subtle bg-surface-elevated/50">
          <div className="text-caption text-text-tertiary">Avg Tools</div>
          <div className="text-body font-semibold text-text-primary">{avgToolCalls}</div>
        </div>
        <div className="p-2 rounded border border-border-subtle bg-surface-elevated/50">
          <div className="text-caption text-text-tertiary">With Tools</div>
          <div className="text-body font-semibold text-text-primary">{queriesWithTools}</div>
        </div>
      </div>

      {/* Logs */}
      {logs.length === 0 ? (
        <div className="flex items-center gap-2 py-2 text-text-secondary">
          <MessageSquare className="h-4 w-4" />
          <span className="text-body-sm">No chat logs yet</span>
        </div>
      ) : (
        <>
          {/* Mobile: Card view */}
          <div className="sm:hidden space-y-2">
            {logs.slice(0, 10).map((log) => (
              <div key={log.id} className="p-2 rounded border border-border-subtle bg-surface-raised">
                <div className="text-body-sm text-text-primary line-clamp-2 mb-1.5">{log.query_text}</div>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {log.chat_family && (
                    <span className="px-1.5 py-0.5 rounded text-caption bg-surface-elevated text-text-secondary">
                      {log.chat_family}
                    </span>
                  )}
                  {log.quality_flags?.slice(0, 2).map((flag) => (
                    <span key={flag} className="px-1.5 py-0.5 rounded text-caption bg-accent-primary/15 text-accent-primary">
                      {formatChatFlag(flag)}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between text-caption">
                  <div className="flex flex-wrap gap-1">
                    {(log.tool_names ?? []).slice(0, 2).map((tool) => (
                      <span key={tool} className="px-1.5 py-0.5 rounded bg-accent-primary/15 text-accent-primary">
                        {tool}
                      </span>
                    ))}
                    {(log.tool_names?.length ?? 0) > 2 && (
                      <span className="text-text-muted">+{(log.tool_names?.length ?? 0) - 2}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">{formatMs(log.timing_total_ms)}</span>
                    <div className="flex items-center gap-1">
                      <a
                        href={`/chat?q=${encodeURIComponent(log.query_text)}`}
                        className="p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-text-primary"
                        title="Search this query"
                      >
                        <Search className="h-3.5 w-3.5" />
                      </a>
                      <button
                        onClick={() => navigator.clipboard.writeText(log.query_text)}
                        className="p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-text-primary"
                        title="Copy to clipboard"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => toggleLogExpanded(log.id)}
                        className="p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-text-primary"
                        title="Toggle details"
                      >
                        {expandedLogIds.has(log.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
                {expandedLogIds.has(log.id) && (
                  <div className="mt-2 pt-2 border-t border-border-subtle space-y-2 text-caption text-text-secondary">
                    {log.answer_contract_summary?.summary && (
                      <div>
                        <span className="text-text-muted">Contract:</span> {log.answer_contract_summary.summary}
                      </div>
                    )}
                    {summarizeSessionContext(log.session_context_summary) && (
                      <div>
                        <span className="text-text-muted">Context:</span> {summarizeSessionContext(log.session_context_summary)}
                      </div>
                    )}
                    {log.guardrail_trace && log.guardrail_trace.length > 0 && (
                      <div>
                        <div className="text-text-muted mb-1">Guardrail Trace</div>
                        <div className="space-y-1">
                          {log.guardrail_trace.slice(0, 4).map((trace, idx) => (
                            <div key={idx}>
                              {trace.decision}: {trace.reason}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {logs.length > 10 && (
              <div className="text-caption text-text-muted text-center">+{logs.length - 10} more</div>
            )}
          </div>
          {/* Desktop: Table view */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Query</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Family</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Tools</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Time</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">When</th>
                  <th className="pb-1.5 text-left text-caption font-medium text-text-tertiary">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {logs.slice(0, 10).map((log) => (
                  <Fragment key={log.id}>
                    <tr key={log.id} className="hover:bg-surface-elevated/50">
                      <td className="py-1.5">
                        <div className="text-text-primary truncate xl:whitespace-normal max-w-[300px] xl:max-w-none" title={log.query_text}>
                          {log.query_text}
                        </div>
                        {log.quality_flags && log.quality_flags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {log.quality_flags.slice(0, 3).map((flag) => (
                              <span
                                key={flag}
                                className="px-1.5 py-0.5 rounded text-caption bg-surface-elevated text-text-secondary"
                              >
                                {formatChatFlag(flag)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 text-text-secondary">{log.chat_family ?? '-'}</td>
                      <td className="py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {(log.tool_names ?? []).slice(0, 3).map((tool) => (
                            <span
                              key={tool}
                              className="px-1.5 py-0.5 rounded text-caption bg-accent-primary/15 text-accent-primary"
                            >
                              {tool}
                            </span>
                          ))}
                          {(log.tool_names?.length ?? 0) > 3 && (
                            <span className="text-caption text-text-muted">+{(log.tool_names?.length ?? 0) - 3}</span>
                          )}
                          {(log.tool_names?.length ?? 0) === 0 && (
                            <span className="text-caption text-text-muted">-</span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 text-text-secondary">{formatMs(log.timing_total_ms)}</td>
                      <td className="py-1.5 text-text-muted">{formatRelativeTime(log.created_at)}</td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-1">
                          <a
                            href={`/chat?q=${encodeURIComponent(log.query_text)}`}
                            className="p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-text-primary"
                            title="Search this query"
                          >
                            <Search className="h-3.5 w-3.5" />
                          </a>
                          <button
                            onClick={() => navigator.clipboard.writeText(log.query_text)}
                            className="p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-text-primary"
                            title="Copy to clipboard"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => toggleLogExpanded(log.id)}
                            className="p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-text-primary"
                            title="Toggle details"
                          >
                            {expandedLogIds.has(log.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedLogIds.has(log.id) && (
                      <tr key={`${log.id}-details`} className="bg-surface-elevated/30">
                        <td colSpan={6} className="py-2">
                          <div className="space-y-2 text-caption text-text-secondary">
                            {log.answer_contract_summary?.summary && (
                              <div>
                                <span className="text-text-muted">Contract:</span> {log.answer_contract_summary.summary}
                              </div>
                            )}
                            {log.answer_contract_summary?.requiredAnswerFields && log.answer_contract_summary.requiredAnswerFields.length > 0 && (
                              <div>
                                <span className="text-text-muted">Required Fields:</span> {log.answer_contract_summary.requiredAnswerFields.join(', ')}
                              </div>
                            )}
                            {summarizeSessionContext(log.session_context_summary) && (
                              <div>
                                <span className="text-text-muted">Context:</span> {summarizeSessionContext(log.session_context_summary)}
                              </div>
                            )}
                            {log.guardrail_trace && log.guardrail_trace.length > 0 && (
                              <div>
                                <div className="text-text-muted mb-1">Guardrail Trace</div>
                                <div className="space-y-1">
                                  {log.guardrail_trace.slice(0, 6).map((trace, idx) => (
                                    <div key={idx}>
                                      <span className="uppercase text-text-muted">{trace.decision}</span> {trace.reason}
                                      {trace.toolName ? ` (${trace.toolName})` : ''}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {logs.length > 10 && (
              <div className="mt-2 text-caption text-text-muted">
                +{logs.length - 10} more logs
              </div>
            )}
          </div>
        </>
      )}
    </CollapsibleSection>
  );
}
