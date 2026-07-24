export const PICS_STALLED_AFTER_HOURS = 24;

export interface PicsSyncProgress {
  lastChangeNumber: number;
  updatedAt: string | null;
}

export interface PicsRuntimeStatus {
  label: 'Active' | 'Inactive' | 'Stalled';
  variant: 'success' | 'warning';
}

export function getPicsRuntimeStatus(
  syncState: PicsSyncProgress,
  nowMs: number = Date.now()
): PicsRuntimeStatus {
  if (syncState.lastChangeNumber <= 0) {
    return {
      label: 'Inactive',
      variant: 'warning',
    };
  }

  if (!syncState.updatedAt) {
    return {
      label: 'Stalled',
      variant: 'warning',
    };
  }

  const progressAtMs = Date.parse(syncState.updatedAt);
  if (Number.isNaN(progressAtMs)) {
    return {
      label: 'Stalled',
      variant: 'warning',
    };
  }

  const freshnessHours = (nowMs - progressAtMs) / (1000 * 60 * 60);
  if (freshnessHours > PICS_STALLED_AFTER_HOURS) {
    return {
      label: 'Stalled',
      variant: 'warning',
    };
  }

  return {
    label: 'Active',
    variant: 'success',
  };
}
