import type { Metadata } from "next";
import { Suspense } from "react";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ConfigurationRequired } from "@/components/ConfigurationRequired";
import { PageHeader } from "@/components/layout";
import { InsightsTabs } from "./InsightsTabs";
import { InsightsSkeleton } from "./components/InsightsSkeleton";
import { getInsightsDashboardData } from "./lib/insights-queries";
import type {
  TimeRange,
  InsightsTab,
  NewestSortMode,
} from "./lib/insights-types";

export const metadata: Metadata = {
  title: 'Insights',
  description: 'Real-time game analytics - top games, newest releases, and trending titles',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    timeRange?: string;
    tab?: string;
    sort?: string;
  }>;
}

export default async function InsightsPage({ searchParams }: PageProps) {
  if (!isSupabaseConfigured()) {
    return <ConfigurationRequired />;
  }

  const params = await searchParams;

  // Parse and validate search params
  const timeRange: TimeRange = ['24h', '7d', '30d'].includes(params.timeRange ?? '')
    ? (params.timeRange as TimeRange)
    : '7d';

  const tab: InsightsTab = ['dashboard', 'top', 'newest', 'trending'].includes(params.tab ?? '')
    ? (params.tab as InsightsTab)
    : 'dashboard';

  const newestSort: NewestSortMode = params.sort === 'growth' ? 'growth' : 'release';

  const { topGames, newestGames, trendingGames } =
    await getInsightsDashboardData(timeRange, newestSort);

  return (
    <div>
      <PageHeader
        title="Insights"
        description="Real-time analytics on top games, newest releases, and trending titles"
      />

      <Suspense fallback={<InsightsSkeleton />}>
        <InsightsTabs
          initialData={{
            topGames,
            newestGames,
            trendingGames,
          }}
          initialTimeRange={timeRange}
          initialTab={tab}
          initialNewestSort={newestSort}
        />
      </Suspense>
    </div>
  );
}
