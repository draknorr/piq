import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth-utils';
import { Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Chat Smoke Tests | Admin',
};

export const dynamic = 'force-dynamic';

type SmokeTestGroup = {
  tool: string;
  note?: string;
  queries: string[];
};

const SMOKE_TESTS: SmokeTestGroup[] = [
  {
    tool: 'query_change_activity',
    note: 'Cross-game change discovery and natural-language variations',
    queries: [
      'Show me the biggest Steam store-page changes in the last 30 days',
      'What are the biggest Steam page refreshes lately?',
      'Which upcoming games changed release timing recently?',
      'Find games that refreshed screenshots or trailers without an announcement',
    ],
  },
  {
    tool: 'get_game_change_timeline',
    note: 'Single-game timeline with fuzzy title handling',
    queries: [
      'Show me the recent Steam changes for Hades II',
      'What changed on No Rest for the Wicked recently?',
      'Show me recent Steam page changes for hades 2',
    ],
  },
  {
    tool: 'compare_change_before_after',
    note: 'Single-game before/after comparison',
    queries: [
      'What changed on Hades II before and after its latest major update?',
      'Compare the latest Steam-page refresh for No Rest for the Wicked',
    ],
  },
  {
    tool: 'find_change_patterns',
    note: 'Pattern detection and inference prompts',
    queries: [
      'Which titles look like they started a new marketing push this month?',
      'Show me games that used a likely relaunch pattern recently',
      'Find games teasing a big update without build movement yet',
      'Which games showed a sustained response after recent Steam changes?',
    ],
  },
  {
    tool: 'query_analytics',
    queries: [
      'What are the top 10 games by total reviews?',
      'Top Steam Deck verified games with 90%+ reviews and at least 10,000 reviews',
    ],
  },
  {
    tool: 'search_games',
    queries: [
      'Linux games with Workshop support and 90%+ reviews',
      'Metroidvania games under $20 with full controller support',
    ],
  },
  {
    tool: 'search_by_concept',
    queries: [
      'Tactical roguelikes with deck building',
      'Relaxing puzzle games with beautiful art',
      'Horror games with investigation and puzzle elements',
    ],
  },
  {
    tool: 'discover_trending',
    queries: ["What’s breaking out right now?", 'Declining multiplayer games'],
  },
  {
    tool: 'find_similar',
    queries: [
      'Games similar to Hades but less popular',
      'Games similar to Hollow Knight with fewer than 10K reviews',
      'Find games in the same series as Dark Souls',
      'Publishers similar to Devolver Digital',
    ],
  },
  {
    tool: 'lookup_games → query_analytics',
    queries: ['Tell me about Elden Ring'],
  },
  {
    tool: 'lookup_publishers → query_analytics',
    queries: ['Show me all games by Krafton'],
  },
  {
    tool: 'lookup_developers → query_analytics',
    queries: ['Show me all games by FromSoftware'],
  },
  {
    tool: 'lookup_tags',
    queries: ['What tags exist for colony sim games?'],
  },
];

function buildChatHref(query: string): string {
  return `/chat?q=${encodeURIComponent(query)}`;
}

export default async function AdminChatSmokeTestsPage() {
  await requireAdmin();

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-display-sm text-text-primary">Chat Smoke Tests</h1>
        <p className="mt-1 text-body-sm text-text-secondary">
          One-click `/chat?q=...` links for fast end-to-end testing. After each run, inspect Query Details and the Admin
          Dashboard Chat Logs.
        </p>
      </div>

      <Card variant="default" padding="md">
        <div className="space-y-2">
          <div className="text-body-sm text-text-secondary">
            Recommended env for these tests:
          </div>
          <ul className="list-disc pl-5 text-body-sm text-text-secondary">
            <li>
              <code className="text-text-primary">USE_CUBE_CHAT=true</code>
            </li>
            <li>
              <code className="text-text-primary">LLM_PROVIDER=openai</code> (streaming supported)
            </li>
          </ul>
        </div>
      </Card>

      <div className="space-y-4">
        {SMOKE_TESTS.map((group) => (
          <Card key={group.tool} variant="default" padding="md">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-subheading text-text-primary">{group.tool}</h2>
                {group.note ? (
                  <p className="mt-1 text-caption text-text-secondary">{group.note}</p>
                ) : null}
              </div>
              <Link href="/admin" className="text-caption text-accent-primary hover:text-accent-primary/80">
                View Chat Logs →
              </Link>
            </div>
            <ul className="space-y-2">
              {group.queries.map((query) => (
                <li key={query} className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <Link
                      href={buildChatHref(query)}
                      className="text-body-sm text-accent-primary hover:text-accent-primary/80"
                      prefetch={false}
                    >
                      Open in chat →
                    </Link>
                    <span className="text-body-sm text-text-primary">{query}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
