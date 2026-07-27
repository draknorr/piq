const GITHUB_REPOSITORY = "draknorr/piq";

export function buildGitHubActionsRunUrl(runId: string): string {
  return `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${encodeURIComponent(runId)}`;
}
