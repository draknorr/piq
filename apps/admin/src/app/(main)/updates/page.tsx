import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout';
import { Card, Badge } from '@/components/ui';
import {
  Building2,
  Heart,
  Zap,
  BarChart3,
  Shield,
  Palette,
  Sparkles,
  TrendingUp,
  Download,
  Search,
  Bell,
  Pin,
  Gauge,
  LineChart,
  Lock,
  Moon,
  Command,
  Gamepad2,
  SlidersHorizontal,
  Type,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Patch Notes',
  description: 'See the latest features and improvements in PublisherIQ',
};

// Types
interface Feature {
  title: string;
  description: string;
  icon?: React.ReactNode;
}

interface Version {
  version: string;
  name: string;
  date: string;
  headline: string;
  highlights: string[];
  features: Feature[];
  improvements?: string[];
  accentColor: string;
  icon: React.ReactNode;
}

// Version Card Component
function VersionCard({ version, isLatest }: { version: Version; isLatest: boolean }) {
  return (
    <Card className="mb-8">
      {/* Version Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${version.accentColor}`}
          >
            {version.icon}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-heading text-text-primary">
                {version.version}
              </h2>
              {isLatest && (
                <Badge variant="primary" size="sm">Latest</Badge>
              )}
            </div>
            <p className="text-body text-text-secondary">{version.name}</p>
          </div>
        </div>
        <span className="text-body-sm text-text-tertiary">{version.date}</span>
      </div>

      {/* Headline */}
      <p className="text-body-lg text-text-primary mb-6 font-medium">
        {version.headline}
      </p>

      {/* Highlights */}
      <div className="mb-6">
        <h3 className="text-caption uppercase tracking-wide text-text-tertiary mb-3">
          Highlights
        </h3>
        <ul className="space-y-2">
          {version.highlights.map((highlight, index) => (
            <li key={index} className="flex items-start gap-2 text-body text-text-secondary">
              <span className="text-accent-primary mt-1">•</span>
              {highlight}
            </li>
          ))}
        </ul>
      </div>

      {/* Features */}
      {version.features.length > 0 && (
        <div className="mb-6">
          <h3 className="text-caption uppercase tracking-wide text-text-tertiary mb-3">
            New Features
          </h3>
          <div className="grid gap-3">
            {version.features.map((feature, index) => (
              <div
                key={index}
                className="p-4 rounded-lg bg-surface-raised border border-border-subtle"
              >
                <div className="flex items-start gap-3">
                  {feature.icon && (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-overlay shrink-0">
                      {feature.icon}
                    </div>
                  )}
                  <div>
                    <h4 className="text-body font-medium text-text-primary mb-1">
                      {feature.title}
                    </h4>
                    <p className="text-body-sm text-text-secondary">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Improvements */}
      {version.improvements && version.improvements.length > 0 && (
        <div>
          <h3 className="text-caption uppercase tracking-wide text-text-tertiary mb-3">
            Improvements
          </h3>
          <ul className="space-y-2">
            {version.improvements.map((improvement, index) => (
              <li key={index} className="flex items-start gap-2 text-body-sm text-text-secondary">
                <span className="text-accent-green mt-0.5">✓</span>
                {improvement}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// All versions data
const versions: Version[] = [
  {
    version: 'v2.12',
    name: 'YouTube Coverage & Runtime Recovery',
    date: 'April 2026',
    headline: 'Public YouTube chat coverage, stronger data recovery paths, and more reliable storefront pricing sharpen the current runtime',
    accentColor: 'bg-accent-red/10',
    icon: <Search className="h-6 w-6 text-accent-red" />,
    highlights: [
      'Chat now supports public per-game YouTube coverage for latest uploads, creator coverage, top videos, growth, content mix, and cadence',
      'Structured data sync workflows now document the live retry, fallback, watermark, and fast preview classification behavior',
      'Games pricing now prefers storefront current prices and hides sale state when there is no real non-free price',
      'Operators now have explicit storefront-authority repair guidance and commands',
    ],
    features: [
      {
        title: 'YouTube Coverage In Chat',
        description: 'Ask about one tracked game’s recent creator pickup and get structured tables for latest uploads, creator coverage, top videos, growth, content mix, and cadence.',
        icon: <Search className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Fast Data Recovery Paths',
        description: 'Preview and production sync workflows now support bounded app-change retries, projection exact-parity fallback, and a preview-only classification mode for faster incident triage.',
        icon: <Gauge className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Storefront Authority Repair',
        description: 'A dedicated repair command now exists for missing storefront-authoritative latest-state fields, alongside clearer docs for PICS retry and cooldown behavior.',
        icon: <Shield className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Price Reliability Fixes',
        description: 'The Games surface now prefers storefront-backed effective pricing and only shows discount state when there is a real paid price to display.',
        icon: <LineChart className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'YouTube chat tables now support inline pagination without leaving the current conversation',
      'Projection-drift recovery is documented as current operator behavior rather than implied historical context',
      'Storefront pricing, `is_free`, and related authority rules are now clearer across user and operator docs',
    ],
  },
  {
    version: 'v2.11',
    name: 'Chat Contract Cutover',
    date: 'April 2026',
    headline: 'Structured contracts became the canonical chat and discovery runtime while Supabase stayed the write and page-serving control plane',
    accentColor: 'bg-accent-cyan/10',
    icon: <BarChart3 className="h-6 w-6 text-accent-cyan" />,
    highlights: [
      'Chat and discovery moved onto the query-api contract boundary',
      'Execution traces, contract summaries, and session carry-forward metadata became part of the normal chat runtime',
      'Preview and production now use separate data and query-api deployment pairs',
      'Current docs now describe the live Supabase, structured data, and Cube split directly',
    ],
    features: [
      {
        title: 'Contract-First Chat',
        description: 'Supported chat answers now route through typed structured-data contracts for entity resolution, search, momentum, change analysis, and continuation.',
        icon: <Search className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Richer Query Diagnostics',
        description: 'Query details now surface execution traces, quality summaries, and structured routing metadata for easier debugging.',
        icon: <Gauge className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Split Serving Model',
        description: 'Supabase remains the write and control plane while PublisherIQ data serves the current contract-backed read paths through `query-api`.',
        icon: <Shield className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'Deployed Vercel environments now require an explicit `QUERY_API_BASE_URL`',
      'Data refresh automation became part of the normal preview and production operating model',
      'Compatibility reads are now documented as transitional instead of canonical',
    ],
  },
  {
    version: 'v2.10',
    name: 'Chat News & Ops Refresh',
    date: 'March 2026',
    headline: 'Recent news search, CCU quality visibility, and PICS first-pass sync make the current runtime easier to trust',
    accentColor: 'bg-accent-green/10',
    icon: <Search className="h-6 w-6 text-accent-green" />,
    highlights: [
      'Recent Steam news now has latest-item detail, bounded digests, and topic search over stored news text',
      'Admin surfaces now include catalog control, CCU quality, and richer chat-log quality metadata',
      'PICS first-pass sync gives newly discovered unsynced apps a prioritized bounded backfill path',
      'News search projections and app-capture work state keep the change-intelligence runtime responsive',
    ],
    features: [
      {
        title: 'Recent News Detail',
        description: 'Ask what actually changed in the latest Steam news item for a title and get a bounded, evidence-backed answer.',
        icon: <Bell className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Topic Search',
        description: 'Search recent stored Steam news text for developer diaries, patch notes, demos, playtests, roadmaps, and similar concrete topics.',
        icon: <Search className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Catalog Control And CCU Quality',
        description: 'The admin dashboard now surfaces current catalog coverage, live catalog counts, and a cached CCU quality breakdown with confidence signals.',
        icon: <Gauge className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'PICS First-Pass Sync',
        description: 'The PICS service now supports a bounded first-pass mode that prioritizes newly discovered unsynced apps before a full bulk backfill.',
        icon: <LineChart className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'Redundant recent-news queries are blocked within a turn when the earlier result already answers the user',
      'App-capture work state and news-search projections replace the older projection path',
      'Storefront remains authoritative for parsed release dates and free-to-play flags',
    ],
  },
  {
    version: 'v2.9',
    name: 'Change Feed & Auth Hardening',
    date: 'March 2026',
    headline: 'Track what changed, trust the session flow, and run change intelligence with better operational guardrails',
    accentColor: 'bg-accent-primary/10',
    icon: <Zap className="h-6 w-6 text-accent-primary" />,
    highlights: [
      'New /changes page for grouped storefront, media, PICS, and news activity',
      'OTP-first login hardened with authoritative session establishment before redirect',
      'Safe callback origin normalization through NEXT_PUBLIC_SITE_URL',
      'Change-intel runtime improved with stale-claim recovery and stronger PICS history capture',
    ],
    features: [
      {
        title: 'Change Feed',
        description: 'Browse grouped bursts of recent changes, inspect related news, and drill into before/after event detail for a single app.',
        icon: <Sparkles className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Feed Health States',
        description: 'The Change Feed now exposes healthy, catching_up, and delayed states so capture freshness and backlog health are visible in-product.',
        icon: <Gauge className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Auth Session Hardening',
        description: 'OTP login now waits for an authoritative authenticated browser user, respects ?next= redirects, and handles callback origins more safely.',
        icon: <Lock className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Operational Change Intelligence',
        description: 'Stale queue claims are requeued automatically and PICS-side history capture now retries and cools down without blocking latest-state writes.',
        icon: <Shield className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'News RPC pagination optimized for recent-first keyset access',
      'Diff canonicalization reduces false positives from JSON key-order churn',
      'Release-date handling stays strict and preserves raw text when no parsed date exists',
    ],
  },
  {
    version: 'v2.8',
    name: 'Security Fixes',
    date: 'January 2026',
    headline: 'Authentication and client-session issues were tightened up across the dashboard',
    accentColor: 'bg-accent-orange/10',
    icon: <Shield className="h-6 w-6 text-accent-orange" />,
    highlights: [
      'OTP authentication standardized on 8-digit codes',
      'Token refresh loop fixed on the login page',
      'NEXT_PUBLIC_SITE_URL introduced for safer redirect handling',
      'Session-aware client usage standardized across app surfaces',
    ],
    features: [
      {
        title: 'OTP Sign-In',
        description: 'PublisherIQ moved to a clearer OTP sign-in flow with secure browser-session handling and waitlist validation before delivery.',
        icon: <Lock className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Secure Redirect Handling',
        description: 'Redirect construction now depends on a canonical site URL instead of trusting arbitrary request origins.',
        icon: <Shield className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'Apps and companies client hooks were aligned with session-aware Supabase patterns',
      'Login reliability improved for stale-token and refresh-loop cases',
    ],
  },
  {
    version: 'v2.7',
    name: 'Command Palette',
    date: 'January 2026',
    headline: 'Power user filtering with a fresh new look',
    accentColor: 'bg-accent-purple/10',
    icon: <Command className="h-6 w-6 text-accent-purple" />,
    highlights: [
      'Press ⌘K to open the command palette for instant filtering',
      'Type filter syntax like "ccu > 50000" or "free:yes" for power users',
      'Active filters show as color-coded chips grouped by category',
      'Refined warm color palette with better readability',
    ],
    features: [
      {
        title: 'Command Palette',
        description: 'Press ⌘K anywhere on Games or Companies pages. Browse presets, filters, genres, tags, and categories all in one place.',
        icon: <Command className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Filter Syntax',
        description: 'Type natural expressions: "ccu > 50000", "score >= 90", "genre:action", "free:yes". The palette understands and suggests corrections.',
        icon: <Type className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Active Filter Bar',
        description: 'See all active filters as color-coded chips. Click any chip to modify, or X to remove. Purple for presets, blue for metrics, green for content.',
        icon: <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Warm Stone Theme',
        description: 'Refined color palette with warm off-white backgrounds (#FAF9F7) and dusty coral accents for a comfortable viewing experience.',
        icon: <Palette className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'New fonts: DM Sans for UI, JetBrains Mono for data tables',
      'Dark mode with improved warm contrast ratios',
      'Keyboard navigation throughout the palette (arrows, Enter, Escape)',
      'Fuzzy matching for filter shortcuts and preset names',
    ],
  },
  {
    version: 'v2.6',
    name: 'Games Page',
    date: 'January 2026',
    headline: 'Discover and analyze games like never before',
    accentColor: 'bg-accent-primary/10',
    icon: <Gamepad2 className="h-6 w-6 text-accent-primary" />,
    highlights: [
      '12 preset views for instant discovery patterns',
      '6 computed insight metrics including Momentum and Sentiment Delta',
      '33 customizable columns to show exactly what you need',
      '20x faster page loads through database optimization',
    ],
    features: [
      {
        title: 'Preset Discovery Views',
        description: '12 one-click presets: Top Games, Rising Stars, Hidden Gems, Breakout Hits, High Momentum, Comeback Stories, and more.',
        icon: <Sparkles className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Momentum Score',
        description: 'A novel metric combining CCU growth and review velocity to identify games "taking off" right now.',
        icon: <TrendingUp className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Sentiment Delta',
        description: 'Track review sentiment changes over time. Catch comeback stories and review bombs early.',
        icon: <LineChart className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Compare Games',
        description: 'Select 2-5 games and see them side-by-side with best/worst highlighting and percentage differences.',
        icon: <BarChart3 className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'Page loads 20x faster with optimized materialized views',
      '7 new database views for instant filter counts',
      'Sparklines load progressively without blocking the page',
      'All filters persist in URL for easy sharing',
    ],
  },
  {
    version: 'v2.5',
    name: 'Companies Page',
    date: 'January 2026',
    headline: 'One place for all publishers and developers',
    accentColor: 'bg-accent-primary/10',
    icon: <Building2 className="h-6 w-6 text-accent-primary" />,
    highlights: [
      'Browse all publishers and developers in one unified view',
      'Compare up to 5 companies side-by-side to spot differences',
      'Export filtered results to CSV or JSON for your own analysis',
      'Save your favorite filter combinations for quick access',
    ],
    features: [
      {
        title: 'Unified Companies Browser',
        description: 'Browse publishers and developers together with a single toggle. Filter by company type or see everyone at once.',
        icon: <Building2 className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Smart Presets',
        description: 'Jump to curated views: Market Leaders (10+ games), Rising Indies (high growth), Breakout Stars (new & trending), Growing Publishers (consistent growth).',
        icon: <Sparkles className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Advanced Filtering',
        description: 'Filter by game count, revenue, owner count, growth rates, genres, tags, platforms, Steam Deck support, and more. Stack multiple filters for precise results.',
        icon: <Search className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Compare Mode',
        description: 'Select 2-5 companies and see them side-by-side with percentage differences highlighted. Great for competitive analysis.',
        icon: <TrendingUp className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Custom Columns',
        description: "Choose which metrics to display. Show what matters to you, hide what doesn't.",
        icon: <BarChart3 className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Export & Share',
        description: 'Download your filtered results as CSV or JSON. Includes your active filters in the export.',
        icon: <Download className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'Page loads in under 250ms even with complex filters',
      'Growth indicators use color and icons for quick scanning',
      'Sparklines appear on hover without slowing down the page',
    ],
  },
  {
    version: 'v2.4',
    name: 'Your Dashboard',
    date: 'January 2026',
    headline: 'Make it yours with pins and alerts',
    accentColor: 'bg-accent-pink/10',
    icon: <Heart className="h-6 w-6 text-accent-pink" />,
    highlights: [
      'Pin your favorite games, publishers, and developers',
      'Get alerts when something important changes',
      'Search for games by describing what you want',
      'Discover trending games based on momentum',
    ],
    features: [
      {
        title: 'Pin Anything',
        description: "Pin games, publishers, or developers from their detail pages. They'll appear in your personalized dashboard.",
        icon: <Pin className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'My Dashboard',
        description: 'A new tab in Insights showing only your pinned items with live metrics. Your command center.',
        icon: <BarChart3 className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Smart Alerts',
        description: 'Get notified when pinned items have significant changes: player spikes, review surges, price drops, sentiment shifts, and more.',
        icon: <Bell className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Concept Search',
        description: 'Find games by describing what you want: "relaxing farming games with crafting" or "tactical roguelikes with deck building". No need to know exact names.',
        icon: <Search className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Trending Discovery',
        description: 'Find games gaining momentum: most active, accelerating growth, breaking out, or declining.',
        icon: <TrendingUp className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      '10x smaller database storage for similarity search',
      'Alert preferences let you control what you\'re notified about',
      'Better embedding quality captures player trends',
    ],
  },
  {
    version: 'v2.3',
    name: 'Speed Update',
    date: 'January 2026',
    headline: 'Everything runs faster',
    accentColor: 'bg-accent-yellow/10',
    icon: <Zap className="h-6 w-6 text-accent-yellow" />,
    highlights: [
      'Background data updates are 10x faster',
      'More reliable data sync with automatic retry',
    ],
    features: [],
    improvements: [
      'Data sync that previously took 24+ hours now completes in under 30 minutes',
      'Automatic retry when external services are temporarily unavailable',
      'Progress tracking shows exactly where sync operations are',
      'Fixed: Duplicate headers no longer appear in some views',
    ],
  },
  {
    version: 'v2.2',
    name: 'Live Player Counts',
    date: 'January 2026',
    headline: 'See who\'s playing right now',
    accentColor: 'bg-accent-cyan/10',
    icon: <Gauge className="h-6 w-6 text-accent-cyan" />,
    highlights: [
      'New Insights dashboard with live player counts',
      'Sparkline charts show trends at a glance',
      'Sort by what\'s hot, newest releases, or trending',
    ],
    features: [
      {
        title: 'Insights Dashboard',
        description: 'A new way to browse games with live player counts and visual trends.',
        icon: <BarChart3 className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Top Games',
        description: 'See the most popular games by current player count.',
        icon: <TrendingUp className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Newest Releases',
        description: 'Browse recent releases sorted by launch date or growth rate.',
        icon: <Sparkles className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Trending',
        description: 'Discover games growing faster than usual based on player count changes.',
        icon: <LineChart className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Time Ranges',
        description: 'Toggle between 24 hours, 7 days, or 30 days to see different trend windows.',
        icon: <BarChart3 className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Sparklines',
        description: 'Mini charts next to every game showing player count trends over time.',
        icon: <LineChart className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      '3x faster review data updates',
      'More accurate player counts directly from Steam (not estimates)',
      'Full coverage of all games every 2 days',
    ],
  },
  {
    version: 'v2.1',
    name: 'Authentication & Activity',
    date: 'January 2026',
    headline: 'Secure sign-in and smarter tracking',
    accentColor: 'bg-accent-green/10',
    icon: <Shield className="h-6 w-6 text-accent-green" />,
    highlights: [
      'Secure sign-in with magic link emails',
      'Credit system for chat usage tracking',
      'Better detection of active vs. dormant games',
    ],
    features: [
      {
        title: 'Magic Link Sign-In',
        description: "No passwords to remember. Enter your email, click the link we send, and you're in.",
        icon: <Lock className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Credits',
        description: 'Track your chat usage with a simple credit system. New users get 1000 credits to start.',
        icon: <Sparkles className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Search Games in Chat',
        description: 'Ask the assistant to find specific games by name with better accuracy.',
        icon: <Search className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'Games with high activity are checked more frequently',
      "Dormant games don't waste resources with unnecessary checks",
      'Review trends now show smooth curves instead of jagged lines',
    ],
  },
  {
    version: 'v2.0',
    name: 'New Design',
    date: 'January 2026',
    headline: 'Fresh look, faster performance',
    accentColor: 'bg-accent-orange/10',
    icon: <Palette className="h-6 w-6 text-accent-orange" />,
    highlights: [
      'Beautiful new design with light and dark modes',
      '66% fewer database queries mean faster page loads',
      'New metrics: estimated playtime and active discounts',
    ],
    features: [
      {
        title: 'Light & Dark Mode',
        description: 'Choose your preferred theme or let it follow your system settings.',
        icon: <Moon className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Estimated Playtime',
        description: 'See estimated weekly and monthly played hours for any game.',
        icon: <BarChart3 className="h-4 w-4 text-text-tertiary" />,
      },
      {
        title: 'Discount Discovery',
        description: 'Spot games currently on sale with discount percentages shown.',
        icon: <TrendingUp className="h-4 w-4 text-text-tertiary" />,
      },
    ],
    improvements: [
      'Pages load significantly faster with optimized data loading',
      'Mobile-friendly design works on phones and tablets',
      'Chat is more reliable with automatic retry on errors',
      'Tag search understands variations ("coop" finds "co-op" games)',
    ],
  },
];

// Quick navigation component
function VersionNav() {
  return (
    <div className="mb-8 flex flex-wrap gap-2">
      {versions.map((version, index) => (
        <a
          key={version.version}
          href={`#${version.version.replace('.', '')}`}
          className={`
            px-3 py-1.5 rounded-lg text-body-sm font-medium transition-colors
            ${index === 0
              ? 'bg-accent-primary text-white'
              : 'bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
            }
          `}
        >
          {version.version}
        </a>
      ))}
    </div>
  );
}

export default function PatchNotesPage() {
  return (
    <div>
      <PageHeader
        title="Patch Notes"
        description="What's new in PublisherIQ"
      />

      <div className="max-w-3xl mx-auto">
        <VersionNav />

        {versions.map((version, index) => (
          <div key={version.version} id={version.version.replace('.', '')}>
            <VersionCard version={version} isLatest={index === 0} />
          </div>
        ))}
      </div>
    </div>
  );
}
