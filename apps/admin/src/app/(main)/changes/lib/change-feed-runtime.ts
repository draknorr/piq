export function shouldUseTigerChangeFeedReads(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const target =
    env.CHANGE_INTEL_READ_TARGET?.trim().toLowerCase() ??
    env.CHANGE_FEED_READ_TARGET?.trim().toLowerCase();
  return target === 'tiger';
}

export function shouldUseStrictTigerChangeFeedReads(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = env.CHANGE_INTEL_READ_STRICT ?? env.CHANGE_FEED_READ_STRICT;
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}
