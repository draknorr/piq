export const PICS_STALLED_AFTER_HOURS = 24;
export const PICS_STATUS_STALLED_AFTER_MINUTES = 10;

export interface PicsSyncProgress {
  lastChangeNumber: number;
  updatedAt: string | null;
}

export interface PicsServiceProgress {
  configured: boolean;
  reachable: boolean;
  status: string | null;
  healthState: string | null;
  updatedAt: string | null;
}

export interface PicsRuntimeStatus {
  label: 'Active' | 'Inactive' | 'Stalled';
  variant: 'success' | 'warning';
  description: string;
}

export function getPicsRuntimeStatus(
  syncState: PicsSyncProgress,
  serviceStatus: PicsServiceProgress,
  nowMs: number = Date.now()
): PicsRuntimeStatus {
  if (syncState.lastChangeNumber <= 0) {
    return {
      label: 'Inactive',
      variant: 'warning',
      description: 'Tiger cursor is unavailable',
    };
  }

  if (!serviceStatus.configured) {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'worker status is not configured',
    };
  }

  if (!serviceStatus.reachable) {
    return {
      label: 'Inactive',
      variant: 'warning',
      description: 'worker status endpoint is unavailable',
    };
  }

  if (serviceStatus.status !== 'running') {
    return {
      label: 'Inactive',
      variant: 'warning',
      description: 'worker is not running',
    };
  }

  if (serviceStatus.healthState === 'unhealthy') {
    return {
      label: 'Inactive',
      variant: 'warning',
      description: 'worker reports unhealthy',
    };
  }

  if (serviceStatus.healthState !== 'ok') {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'worker health is degraded',
    };
  }

  if (!serviceStatus.updatedAt) {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'worker heartbeat is unavailable',
    };
  }

  const serviceUpdatedAtMs = Date.parse(serviceStatus.updatedAt);
  if (Number.isNaN(serviceUpdatedAtMs)) {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'worker heartbeat is invalid',
    };
  }

  const serviceFreshnessMinutes = (nowMs - serviceUpdatedAtMs) / (1000 * 60);
  if (serviceFreshnessMinutes > PICS_STATUS_STALLED_AFTER_MINUTES) {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'worker heartbeat is stale',
    };
  }

  if (!syncState.updatedAt) {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'cursor progress is unavailable',
    };
  }

  const progressAtMs = Date.parse(syncState.updatedAt);
  if (Number.isNaN(progressAtMs)) {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'cursor progress is invalid',
    };
  }

  const freshnessHours = (nowMs - progressAtMs) / (1000 * 60 * 60);
  if (freshnessHours > PICS_STALLED_AFTER_HOURS) {
    return {
      label: 'Stalled',
      variant: 'warning',
      description: 'cursor progress is stale',
    };
  }

  return {
    label: 'Active',
    variant: 'success',
    description: 'live cursor progress',
  };
}
