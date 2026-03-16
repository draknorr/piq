import type { Metadata } from 'next';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getUser } from '@/lib/supabase/server';
import { ConfigurationRequired } from '@/components/ConfigurationRequired';
import type { ChangeFeedActivityResponse } from './lib';
import {
  fetchChangeFeedActivityResponse,
  parseChangeFeedActivityParams,
  parseChangeActivityMode,
  parseChangeActivityView,
} from './lib';
import { ChangeFeedPageClient } from './ChangeFeedPageClient';

export const metadata: Metadata = {
  title: 'Steam Activity | PublisherIQ',
  description: 'Track Steam activity in one readable exploration feed with announcement context and before/after detail.',
};

export const dynamic = 'force-dynamic';

function rangeToDays(range: string | undefined): string {
  switch (range) {
    case '24h':
      return '1';
    case '30d':
      return '30';
    default:
      return '7';
  }
}

function toUrlSearchParams(params: Record<string, string | undefined>): URLSearchParams {
  const urlSearchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      urlSearchParams.set(key, value);
    }
  });

  return urlSearchParams;
}

interface PageProps {
  searchParams: Promise<{
    mode?: string;
    view?: string;
    range?: string;
    appTypes?: string;
    signals?: string;
    sort?: string;
    search?: string;
    tab?: string;
    preset?: string;
  }>;
}

export default async function ChangeFeedPage({ searchParams }: PageProps) {
  if (!isSupabaseConfigured()) {
    return <ConfigurationRequired />;
  }

  const params = await searchParams;
  const urlSearchParams = toUrlSearchParams(params);
  const legacyMode =
    !params.mode && params.tab ? (params.tab === 'news' ? 'announcements' : 'changes') : undefined;
  const legacyView =
    !params.view && params.preset
      ? params.preset === 'upcoming-radar'
        ? 'launch-watch'
        : params.preset === 'all-changes'
          ? 'all-activity'
          : 'overview'
      : undefined;

  if (legacyMode) {
    urlSearchParams.set('mode', parseChangeActivityMode(legacyMode));
  }

  if (legacyView) {
    urlSearchParams.set('view', parseChangeActivityView(legacyView));
  }

  if (!urlSearchParams.has('days')) {
    urlSearchParams.set('days', rangeToDays(params.range));
  }

  let initialActivityResponse: ChangeFeedActivityResponse | undefined;

  if (await getUser()) {
    try {
      initialActivityResponse = await fetchChangeFeedActivityResponse(
        parseChangeFeedActivityParams(urlSearchParams)
      );
    } catch (error) {
      console.error('Failed to prefetch Steam Activity data:', error);
    }
  }

  return (
    <ChangeFeedPageClient
      initialMode={params.mode ?? legacyMode}
      initialView={params.view ?? legacyView}
      initialRange={params.range}
      initialAppTypes={params.appTypes}
      initialSignals={params.signals}
      initialSort={params.sort}
      initialSearch={params.search}
      initialActivityResponse={initialActivityResponse}
    />
  );
}
