'use client';

import React, { useMemo, useCallback, useEffect, useRef } from 'react';
import { X, Download, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SparklineCell } from './SparklineCell';
import type { Company, CompanyIdentifier } from '../lib/companies-types';
import type { AggregateStats } from '../lib/companies-types';
import type { useSparklineLoader } from '../hooks/useSparklineLoader';
import {
  buildCompareMetricRows,
  groupMetricsByCategory,
  formatPercentDiff,
  CATEGORY_LABELS,
} from '../lib/companies-compare';
import { generateCompareCSV, downloadCSV, generateFilename } from '../lib/companies-export';

interface CompareModeProps {
  companies: Company[];
  aggregateStats: AggregateStats;
  onClose: () => void;
  onRemove: (id: CompanyIdentifier) => void;
  sparklineLoader: ReturnType<typeof useSparklineLoader>;
}

/**
 * Full-screen modal for side-by-side company comparison.
 * Companies displayed as columns, metrics as rows.
 * First company is baseline for % diff calculations.
 */
export function CompareMode({
  companies,
  aggregateStats,
  onClose,
  onRemove,
  sparklineLoader,
}: CompareModeProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap and ESC key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Focus the close button when modal opens
    closeButtonRef.current?.focus();

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Build comparison data
  const metricRows = useMemo(
    () => buildCompareMetricRows(companies, aggregateStats),
    [companies, aggregateStats]
  );

  const groupedMetrics = useMemo(
    () => groupMetricsByCategory(metricRows),
    [metricRows]
  );

  // M6b: Export comparison to CSV
  const handleExport = useCallback(() => {
    const csv = generateCompareCSV(companies, metricRows);
    const filename = generateFilename('companies-comparison');
    downloadCSV(csv, filename);
  }, [companies, metricRows]);

  // Categories to display (in order)
  const categories = ['engagement', 'content', 'reviews', 'financial', 'growth', 'ratios'];

  if (companies.length < 2) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-modal-title"
        className="relative w-full max-w-5xl mx-4 bg-surface-raised border border-border-subtle rounded-xl shadow-lg max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-surface-elevated">
          <div className="flex items-center gap-3">
            <Scale className="w-5 h-5 text-accent-primary" />
            <h2 id="compare-modal-title" className="text-heading-sm font-semibold text-text-primary">
              Compare Companies
            </h2>
            <Badge variant="default" size="sm">
              {companies.length} companies
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={handleExport}
              title="Export comparison to CSV"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-surface-overlay transition-colors"
              aria-label="Close comparison modal"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>
        </div>

        {/* Content - horizontal scroll wrapper */}
        <div className="flex-1 overflow-x-auto">
          <table className="min-w-full w-max border-collapse">
              {/* Company Headers */}
              <thead className="sticky top-0 bg-surface-elevated z-10">
                <tr>
                  <th className="w-[140px] px-4 py-3 text-left text-caption font-medium text-text-tertiary border-b border-border-subtle">
                    Metric
                  </th>
                  {companies.map((company, i) => (
                    <th
                      key={`${company.type}-${company.id}`}
                      className="w-[130px] px-3 py-3 text-left border-b border-border-subtle"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="text-body-sm font-medium text-text-primary truncate" title={company.name}>
                            {company.name}
                          </span>
                          <div className="flex items-center gap-1">
                            <Badge
                              variant={company.type === 'publisher' ? 'primary' : 'purple'}
                              size="sm"
                            >
                              {company.type === 'publisher' ? 'Pub' : 'Dev'}
                            </Badge>
                            {i === 0 && (
                              <Badge variant="default" size="sm">
                                Baseline
                              </Badge>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => onRemove({ id: company.id, type: company.type })}
                          className="p-1 rounded hover:bg-surface-overlay transition-colors flex-shrink-0 -mr-1"
                          aria-label={`Remove ${company.name}`}
                        >
                          <X className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                        </button>
                      </div>
                    </th>
                  ))}
                  {/* vs Avg column */}
                  <th className="w-[90px] px-3 py-3 text-left border-b border-border-subtle">
                    <span className="text-body-sm font-medium text-text-secondary">
                      vs Avg
                    </span>
                  </th>
                </tr>
              </thead>

              <tbody>
                {/* Sparkline row (special handling) */}
                <tr className="border-b border-border-subtle bg-surface-overlay/30">
                  <td className="px-4 py-3 text-body-sm text-text-secondary">
                    CCU Trend (7d)
                  </td>
                  {companies.map((company) => (
                    <td
                      key={`sparkline-${company.type}-${company.id}`}
                      className="px-3 py-3"
                    >
                      <SparklineCell
                        companyId={company.id}
                        companyType={company.type}
                        growthPercent={company.ccu_growth_7d_percent}
                        registerRow={sparklineLoader.registerRow}
                        getSparklineData={sparklineLoader.getSparklineData}
                        isLoading={sparklineLoader.isLoading}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-text-muted">—</td>
                </tr>

                {/* Grouped metric rows */}
                {categories.map((categoryKey) => {
                  const categoryRows = groupedMetrics[categoryKey];
                  if (!categoryRows || categoryRows.length === 0) return null;

                  return (
                    <React.Fragment key={categoryKey}>
                      {/* Category header */}
                      <tr className="bg-surface-overlay/50">
                        <td
                          colSpan={companies.length + 2}
                          className="px-4 py-2 text-caption font-medium text-text-tertiary uppercase tracking-wide border-b border-border-subtle"
                        >
                          {CATEGORY_LABELS[categoryKey]}
                        </td>
                      </tr>

                      {/* Metric rows */}
                      {categoryRows.map((row) => (
                        <tr
                          key={row.metricId}
                          className="border-b border-border-subtle hover:bg-surface-overlay/20 transition-colors"
                        >
                          {/* Metric label */}
                          <td className="px-4 py-2.5 text-body-sm text-text-secondary">
                            {row.label}
                          </td>

                          {/* Company values */}
                          {row.formattedValues.map((formatted, i) => {
                            const isBest = row.bestIndex === i;
                            const isWorst = row.worstIndex === i && row.bestIndex !== row.worstIndex;
                            const percentDiff = row.percentDiffs[i];

                            return (
                              <td
                                key={i}
                                className={`px-3 py-2.5 ${
                                  isBest
                                    ? 'bg-accent-green/10'
                                    : isWorst
                                    ? 'bg-accent-red/10'
                                    : ''
                                }`}
                              >
                                <div className="flex flex-col">
                                  <span
                                    className={`text-body-sm ${
                                      isBest
                                        ? 'text-accent-green font-medium'
                                        : isWorst
                                        ? 'text-accent-red'
                                        : 'text-text-primary'
                                    }`}
                                  >
                                    {formatted}
                                  </span>
                                  <span
                                    className={`text-caption ${
                                      i === 0
                                        ? 'text-text-muted'
                                        : percentDiff === null
                                        ? 'text-text-muted'
                                        : percentDiff >= 0
                                        ? 'text-accent-green'
                                        : 'text-accent-red'
                                    }`}
                                  >
                                    {i === 0 ? '—' : percentDiff !== null ? formatPercentDiff(percentDiff) : '—'}
                                  </span>
                                </div>
                              </td>
                            );
                          })}

                          {/* vs Avg */}
                          <td className="px-3 py-2.5">
                            {row.vsAvgDiff !== null ? (
                              <span
                                className={`text-body-sm ${
                                  row.vsAvgDiff >= 0
                                    ? 'text-accent-green'
                                    : 'text-accent-red'
                                }`}
                              >
                                {formatPercentDiff(row.vsAvgDiff)}
                              </span>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle bg-surface-elevated">
          <p className="text-caption text-text-muted">
            First company is used as baseline for percentage comparisons
          </p>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
