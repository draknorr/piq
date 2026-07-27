'use client';

import { useState } from 'react';
import Link from 'next/link';
import { buildGitHubActionsRunUrl } from '@/lib/github-actions-url';

export interface SyncJobDetail {
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return 'Never';

  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 60000) return 'Just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return `${Math.floor(diffMs / 86400000)}d ago`;
}

function formatDateTime(timestamp: string | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function JobRow({ job, isExpanded, onToggle }: { job: SyncJobDetail; isExpanded: boolean; onToggle: () => void }) {
  const duration = job.completed_at && job.started_at
    ? formatDuration(new Date(job.completed_at).getTime() - new Date(job.started_at).getTime())
    : 'Running...';

  return (
    <>
      <tr
        className="hover:bg-gray-800/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <svg
              className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-medium text-white">{job.job_type}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              job.status === 'completed'
                ? 'bg-semantic-success-subtle text-semantic-success'
                : job.status === 'running'
                ? 'bg-semantic-info-subtle text-semantic-info'
                : job.status === 'failed'
                ? 'bg-semantic-error-subtle text-semantic-error'
                : 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {job.status}
          </span>
        </td>
        <td className="px-4 py-3 text-sm">
          <span className="text-semantic-success">{job.items_succeeded ?? 0}</span>
          <span className="text-gray-500"> / {job.items_processed ?? 0}</span>
          {(job.items_failed ?? 0) > 0 && (
            <span className="text-semantic-error ml-1">({job.items_failed} failed)</span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-gray-400">{duration}</td>
        <td className="px-4 py-3 text-sm text-gray-500">{formatRelativeTime(job.started_at)}</td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-800/20">
          <td colSpan={5} className="px-4 py-4">
            <div className="pl-6 space-y-3">
              {/* Time details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Started:</span>
                  <span className="ml-2 text-gray-300">{formatDateTime(job.started_at)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Completed:</span>
                  <span className="ml-2 text-gray-300">{formatDateTime(job.completed_at)}</span>
                </div>
              </div>

              {/* Batch size */}
              {job.batch_size !== null && (
                <div className="text-sm">
                  <span className="text-gray-500">Batch size:</span>
                  <span className="ml-2 text-gray-300">{job.batch_size}</span>
                </div>
              )}

              {/* Processing stats */}
              <div className="text-sm">
                <span className="text-gray-500">Processing:</span>
                <span className="ml-2">
                  {(job.items_created !== null || job.items_updated !== null) ? (
                    <>
                      <span className="text-semantic-info">{job.items_created ?? 0} new</span>
                      <span className="text-gray-500"> | </span>
                      <span className="text-semantic-success">{job.items_updated ?? 0} updated</span>
                    </>
                  ) : (
                    <span className="text-semantic-success">{job.items_succeeded ?? 0} succeeded</span>
                  )}
                  {(job.items_failed ?? 0) > 0 && (
                    <>
                      <span className="text-gray-500"> | </span>
                      <span className="text-semantic-error">{job.items_failed} failed</span>
                    </>
                  )}
                  <span className="text-gray-500"> of </span>
                  <span className="text-gray-300">{job.items_processed ?? 0} processed</span>
                </span>
              </div>

              {/* Error message */}
              {job.error_message && (
                <div className="text-sm">
                  <span className="text-semantic-error">Error:</span>
                  <p className="mt-1 text-red-300 bg-red-500/10 rounded p-2 font-mono text-xs">
                    {job.error_message}
                  </p>
                </div>
              )}

              {/* GitHub Actions link */}
              {job.github_run_id && (
                <div className="text-sm">
                  <a
                    href={buildGitHubActionsRunUrl(job.github_run_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent-primary hover:text-accent-primary-hover"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" clipRule="evenodd"/>
                    </svg>
                    View GitHub Actions Run
                  </a>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ExpandableJobsTable({ jobs }: { jobs: SyncJobDetail[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  if (jobs.length === 0) {
    return null;
  }

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
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
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Recent Jobs</h3>
        <Link
          href="/jobs"
          className="text-sm text-accent-primary hover:text-accent-primary-hover"
        >
          View all jobs →
        </Link>
      </div>
      <p className="mb-4 text-sm text-gray-400">Click a row to see details</p>
      <div className="overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">Progress</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-400">Started</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                isExpanded={expandedIds.has(job.id)}
                onToggle={() => toggleExpanded(job.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
