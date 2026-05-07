export function sanitizeForwardFacingDataCopy(value: string): string {
  return value
    .replace(/\bTigerData\b/gi, 'PublisherIQ data')
    .replace(/\bon\s+Tiger\s+until\b/gi, 'in this environment until')
    .replace(/\bon\s+tiger\s+until\b/gi, 'in this environment until')
    .replace(/\bTiger-backed\b/gi, 'PublisherIQ')
    .replace(/\bTiger\s+environment\b/gi, 'data environment')
    .replace(/\bTiger\s+data\b/gi, 'PublisherIQ data')
    .replace(/\bTiger\s+primary\b/gi, 'primary data path')
    .replace(/\bTiger\s+shadow\b/gi, 'shadow data path')
    .replace(/\bTiger\b/gi, 'PublisherIQ data');
}
