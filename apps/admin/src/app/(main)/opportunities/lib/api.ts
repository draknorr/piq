export async function opportunityPost<T>(
  operation: string,
  body: unknown = {},
): Promise<T> {
  const response = await fetch(`/api/opportunities/${operation}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error ?? `Opportunity request failed (${response.status}).`,
    );
  }
  return payload as T;
}

export function humanizeOpportunity(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatOpportunityDate(value: string | null): string {
  if (!value) {
    return "Not available";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
