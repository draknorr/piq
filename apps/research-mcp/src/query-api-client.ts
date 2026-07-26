import type { ResearchMcpConfig, ResearchMcpRole } from './config.js';

export class QueryApiClient {
  constructor(private readonly config: ResearchMcpConfig) {}

  async post<T>(path: string, body: unknown, role?: ResearchMcpRole): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-publisheriq-research-role': role ?? this.config.defaultRole,
    };

    if (this.config.queryApiBearerToken) {
      headers.authorization = `Bearer ${this.config.queryApiBearerToken}`;
    }

    const response = await fetch(new URL(path, this.config.queryApiBaseUrl), {
      body: JSON.stringify(body ?? {}),
      headers,
      method: 'POST',
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const reason =
        typeof payload === 'object' && payload && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `HTTP ${response.status}`;
      throw new Error(reason);
    }

    return payload as T;
  }
}
