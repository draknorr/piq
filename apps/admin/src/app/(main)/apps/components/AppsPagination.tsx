"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AppsPaginationState } from "../lib/apps-pagination";

interface AppsPaginationProps {
  pagination: AppsPaginationState;
  totalItems: number;
  disabled?: boolean;
  onPageChange: (offset: number) => void;
}

export function AppsPagination({
  pagination,
  totalItems,
  disabled = false,
  onPageChange,
}: AppsPaginationProps) {
  if (totalItems <= 0) {
    return null;
  }

  return (
    <nav
      aria-label="Games pagination"
      className="flex flex-col gap-3 rounded-lg border border-border-muted bg-surface-elevated px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-body-sm text-text-secondary" aria-live="polite">
        Showing{" "}
        <span className="font-medium text-text-primary">
          {pagination.rangeStart.toLocaleString()}–
          {pagination.rangeEnd.toLocaleString()}
        </span>{" "}
        of{" "}
        <span className="font-medium text-text-primary">
          {totalItems.toLocaleString()}
        </span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || !pagination.hasPrevious}
          onClick={() => onPageChange(pagination.previousOffset)}
          aria-label="Go to previous games page"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>

        <span className="min-w-24 text-center text-caption text-text-muted">
          Page {pagination.currentPage.toLocaleString()} of{" "}
          {pagination.totalPages.toLocaleString()}
        </span>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || !pagination.hasNext}
          onClick={() => onPageChange(pagination.nextOffset)}
          aria-label="Go to next games page"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
