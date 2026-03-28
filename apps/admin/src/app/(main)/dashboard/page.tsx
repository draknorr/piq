import type { Metadata } from 'next';
import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ConfigurationRequired } from '@/components/ConfigurationRequired';
import { Card } from '@/components/ui';
import { Gamepad2, Building2, Users, ArrowRight, Sparkles } from 'lucide-react';
import { DashboardSearch } from './DashboardSearch';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export const dynamic = 'force-dynamic';

async function getStats() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  const supabase = getServiceSupabase();

  // Query the pre-computed stats cache (single row, instant response)
  // This avoids expensive COUNT queries that can timeout on cold start
  const { data: cached } = await supabase
    .from('dashboard_stats_cache')
    .select('apps_count, publishers_count, developers_count')
    .eq('id', 'main')
    .single();

  if (cached && (cached.apps_count ?? 0) > 0) {
    return {
      appCount: cached.apps_count ?? 0,
      publisherCount: cached.publishers_count ?? 0,
      developerCount: cached.developers_count ?? 0,
    };
  }

  // Fallback to direct queries only if cache table is empty/missing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: catalogControl } = await (supabase.rpc as any)('get_catalog_control_stats');
  const currentCatalogApps =
    catalogControl && catalogControl.length > 0
      ? Number(catalogControl[0]?.current_catalog_apps ?? 0)
      : null;

  const [legacyAppsResult, publishersResult, developersResult] = await Promise.all([
    supabase.from('apps').select('*', { count: 'exact', head: true }),
    supabase.from('publishers').select('*', { count: 'exact', head: true }),
    supabase.from('developers').select('*', { count: 'exact', head: true }),
  ]);

  return {
    appCount: currentCatalogApps ?? legacyAppsResult.count ?? 0,
    publisherCount: publishersResult.count ?? 0,
    developerCount: developersResult.count ?? 0,
  };
}

interface InsightCardProps {
  title: string;
  value: string | number;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  delay: number;
}

function InsightCard({
  title,
  value,
  description,
  href,
  icon: Icon,
  color,
  delay,
}: InsightCardProps) {
  return (
    <Link href={href} className="block group">
      <Card
        variant="interactive"
        className="p-6 h-full animate-fade-in-up"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted group-hover:text-text-secondary group-hover:translate-x-0.5 transition-all" />
        </div>
        <div>
          <p className="text-display-sm text-text-primary mb-1">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          <p className="text-subheading text-text-primary mb-1">{title}</p>
          <p className="text-body-sm text-text-tertiary">{description}</p>
        </div>
      </Card>
    </Link>
  );
}

function ChatCard({ delay }: { delay: number }) {
  return (
    <Link href="/chat" className="block group">
      <Card
        variant="interactive"
        className="p-6 h-full animate-fade-in-up bg-gradient-to-br from-accent-primary/5 to-accent-cyan/5 border-accent-primary/20 hover:border-accent-primary/40"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <ArrowRight className="h-4 w-4 text-text-muted group-hover:text-accent-primary group-hover:translate-x-0.5 transition-all" />
        </div>
        <div>
          <p className="text-subheading text-text-primary mb-1 flex items-center gap-2">
            AI Chat
            <span className="text-caption-sm px-1.5 py-0.5 rounded bg-accent-primary/15 text-accent-primary">New</span>
          </p>
          <p className="text-body-sm text-text-tertiary">
            Ask questions in natural language and get instant insights from the database
          </p>
        </div>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const stats = await getStats();

  if (!stats) {
    return <ConfigurationRequired />;
  }

  const { appCount, publisherCount, developerCount } = stats;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Search Hero Section */}
      <DashboardSearch />

      {/* Insights Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
        <InsightCard
          title="Games"
          value={appCount}
          description="Browse the complete catalog of games with detailed metrics"
          href="/apps"
          icon={Gamepad2}
          color="bg-accent-purple/15 text-accent-purple"
          delay={100}
        />
        <InsightCard
          title="Publishers"
          value={publisherCount}
          description="Explore publisher portfolios and market presence"
          href="/publishers"
          icon={Building2}
          color="bg-accent-green/15 text-accent-green"
          delay={150}
        />
        <InsightCard
          title="Developers"
          value={developerCount}
          description="Discover development studios and their releases"
          href="/developers"
          icon={Users}
          color="bg-accent-orange/15 text-accent-orange"
          delay={200}
        />
        <ChatCard delay={250} />
      </div>
    </div>
  );
}
