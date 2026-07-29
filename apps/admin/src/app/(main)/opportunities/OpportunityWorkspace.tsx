"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CircleDot,
  Copy,
  Filter,
  FlaskConical,
  Mail,
  Plus,
  RefreshCw,
  Slack,
  Target,
  Users,
} from "lucide-react";

import { ProfileBuilder } from "./ProfileBuilder";
import {
  describeOpportunityChange,
  formatOpportunityDate,
  humanizeOpportunity,
  opportunityConfidenceExplanation,
  opportunityConfidenceLabel,
  opportunityPost,
  opportunityPotentialLabel,
  opportunityStrengthLabel,
  opportunityWhyItMatters,
} from "./lib/api";
import type {
  OpportunityBootstrap,
  OpportunityProfileDetail,
  OpportunityResultSummary,
} from "./lib/types";

type WorkspaceTab = "brief" | "profiles" | "delivery";

const RESULT_SECTIONS: Array<{
  key: keyof OpportunityBootstrap["dailyOverview"]["groups"];
  kicker: string;
  title: string;
}> = [
  {
    key: "newlyDiscovered",
    kicker: "New to your search",
    title: "New discoveries",
  },
  {
    key: "newlyReleased",
    kicker: "Just launched",
    title: "Newly released",
  },
  {
    key: "newlyQualified",
    kicker: "New match",
    title: "Newly qualified",
  },
  {
    key: "materiallyChanged",
    kicker: "Commercial change",
    title: "Material changes",
  },
  { key: "trackedUpdates", kicker: "You follow", title: "Tracked updates" },
];

function presetMarketLabel(state: string | null): string {
  const labels: Record<string, string> = {
    active: "Steady opportunity flow",
    cooling: "Fewer new matches",
    growing: "More matching games emerging",
    insufficient_data: "Still gathering market history",
    quiet: "Few recent matches",
    surging: "Opportunity pool expanding quickly",
  };
  return labels[state ?? ""] ?? "Market history is developing";
}

export function OpportunityWorkspace() {
  const [data, setData] = useState<OpportunityBootstrap | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>("brief");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [profileDetail, setProfileDetail] =
    useState<OpportunityProfileDetail | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await opportunityPost<OpportunityBootstrap>("bootstrap"));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The opportunity service is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openProfile = async (profileId: string) => {
    setLoadingProfile(true);
    setError(null);
    try {
      setProfileDetail(
        await opportunityPost<OpportunityProfileDetail>("get-profile", {
          profileId,
        }),
      );
      setBuilderOpen(true);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Profile unavailable.",
      );
    } finally {
      setLoadingProfile(false);
    }
  };

  const startProfile = () => {
    setProfileDetail(null);
    setBuilderOpen(true);
  };

  const clonePreset = async (presetId: string, name: string) => {
    setLoadingProfile(true);
    setError(null);
    try {
      const schedule = data?.profiles[0];
      const version = await opportunityPost<{ profileId: string }>(
        "clone-preset",
        {
          name,
          presetId,
          localDeliveryTime: schedule?.localDeliveryTime ?? "09:00",
          timezone:
            schedule?.timezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      );
      await load();
      await openProfile(version.profileId);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Preset clone failed.",
      );
    } finally {
      setLoadingProfile(false);
    }
  };

  const saved = async (profileId: string) => {
    await load();
    await openProfile(profileId);
  };

  const profileStatusChanged = async (
    profileId: string,
    status: "enabled" | "paused" | "archived",
  ) => {
    await load();
    if (status === "archived") {
      setBuilderOpen(false);
      setProfileDetail(null);
      return;
    }
    await openProfile(profileId);
  };

  const resultCount = data?.dailyOverview.matchedCount ?? 0;
  const activeProfiles =
    data?.profiles.filter((profile) => profile.status === "enabled").length ??
    0;
  const highConfidenceResults =
    data === null
      ? 0
      : Object.values(data.dailyOverview.groups)
          .flat()
          .filter((result) => result.confidence === "high").length;

  if (loading && !data) {
    return <OpportunityLoading />;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl pt-16">
        <div className="border-l-2 border-accent-primary pl-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-primary">
            Opportunity Brief
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text-primary">
            The intelligence desk is not connected yet.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            {error ??
              "PublisherIQ could not load your sourcing brief. Please try again."}
          </p>
          <button
            type="button"
            onClick={load}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="-m-4 min-h-screen bg-surface md:-m-6 lg:-m-8">
      <header className="border-b border-border-subtle bg-surface-raised px-5 pb-0 pt-6 md:px-8 md:pt-8">
        <div className="mx-auto max-w-[1500px]">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent-primary">
                <Target className="h-3.5 w-3.5" />
                Custom Steam sourcing
              </div>
              <h1 className="mt-3 max-w-4xl text-[clamp(2rem,5vw,4.4rem)] font-medium leading-[0.94] tracking-[-0.045em] text-text-primary">
                Daily opportunity
                <span className="block text-text-tertiary">
                  intelligence desk.
                </span>
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-text-secondary">
                See the Steam games that newly match your strategy, the changes
                that made them relevant, and the market evidence behind each
                opportunity.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border-muted bg-border-muted">
              <DispatchMetric label="Today" value={String(resultCount)} />
              <DispatchMetric
                label="Live profiles"
                value={String(activeProfiles)}
              />
              <DispatchMetric
                label="High confidence"
                value={String(highConfidenceResults)}
              />
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4">
            <nav
              className="flex min-w-0 gap-1 overflow-x-auto"
              aria-label="Opportunity area"
            >
              {(
                [
                  ["brief", "Daily brief", BookOpen],
                  ["profiles", "Profiles & presets", Filter],
                  ["delivery", "Delivery", Bell],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`relative flex shrink-0 items-center gap-2 px-3 py-3 text-sm font-medium transition ${
                    tab === value
                      ? "text-text-primary"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${tab === value ? "text-accent-primary" : ""}`}
                  />
                  {label}
                  {tab === value && (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-accent-primary" />
                  )}
                </button>
              ))}
            </nav>
            <button
              type="button"
              onClick={startProfile}
              className="hidden items-center gap-2 rounded-lg bg-accent-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-accent-primary-hover sm:inline-flex"
            >
              <Plus className="h-4 w-4" />
              New profile
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-semantic-warning/20 bg-semantic-warning-muted px-5 py-2.5 text-center text-xs text-semantic-warning">
          {error}
        </div>
      )}

      <main className="mx-auto max-w-[1500px]">
        {tab === "brief" && <DailyBrief data={data} />}
        {tab === "profiles" && (
          <ProfilesDesk
            data={data}
            loadingProfile={loadingProfile}
            onClone={clonePreset}
            onNew={startProfile}
            onOpen={openProfile}
          />
        )}
        {tab === "delivery" && <DeliveryDesk data={data} onChanged={load} />}
      </main>

      {builderOpen && (
        <div className="border-t border-border-muted bg-surface-raised lg:grid lg:grid-cols-[minmax(260px,0.33fr)_minmax(0,1fr)]">
          <div className="hidden px-8 py-12 lg:block">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
              How matching works
            </p>
            <ol className="mt-6 space-y-6">
              {[
                ["01", "Check every must-have criterion you choose."],
                ["02", "Reward strengths and screen for dealbreakers."],
                ["03", "Compare qualified games with similar releases."],
                ["04", "Show the evidence behind every recommendation."],
              ].map(([number, label]) => (
                <li key={number} className="flex gap-4">
                  <span className="font-mono text-xs text-accent-primary">
                    {number}
                  </span>
                  <span className="max-w-xs text-sm leading-6 text-text-secondary">
                    {label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <ProfileBuilder
            key={profileDetail?.currentVersionDetail.id ?? "new"}
            defaultLocalDeliveryTime={data.profiles[0]?.localDeliveryTime}
            defaultTimezone={data.profiles[0]?.timezone}
            initialProfile={profileDetail}
            onClose={() => setBuilderOpen(false)}
            onSaved={saved}
            onStatusChanged={profileStatusChanged}
          />
        </div>
      )}
    </div>
  );
}

function DispatchMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[90px] bg-surface-elevated px-4 py-3">
      <p className="text-xl font-semibold tabular-nums text-text-primary">
        {value}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </p>
    </div>
  );
}

function DailyBrief({ data }: { data: OpportunityBootstrap }) {
  const overview = data.dailyOverview;
  const hasResults = overview.matchedCount > 0;
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_310px]">
      <div className="min-w-0 px-5 py-7 md:px-8 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-muted pb-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              Your latest sourcing brief
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
              {hasResults
                ? `${overview.matchedCount} signals worth opening`
                : overview.status === "not_run"
                  ? "Your first brief is waiting"
                  : "A quiet coverage window"}
            </h2>
            <p className="mt-2 text-sm text-text-tertiary">
              {overview.windowStart && overview.windowEnd
                ? `Changes observed from ${formatOpportunityDate(overview.windowStart)} through ${formatOpportunityDate(overview.windowEnd)}`
                : "Enable a sourcing profile to receive your first brief."}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border-muted px-3 py-1.5 text-xs text-text-secondary">
            <CircleDot
              className={`h-3.5 w-3.5 ${
                overview.status === "failed"
                  ? "text-semantic-error"
                  : overview.status === "running"
                    ? "animate-pulse text-semantic-warning"
                    : "text-semantic-success"
              }`}
            />
            {humanizeOpportunity(overview.status)}
          </div>
        </div>

        {!hasResults ? (
          <div className="grid min-h-[420px] place-items-center">
            <div className="max-w-md text-center">
              <FlaskConical className="mx-auto h-7 w-7 text-accent-primary" />
              <h3 className="mt-5 text-xl font-semibold text-text-primary">
                {overview.status === "not_run"
                  ? "Start with a maintained preset"
                  : "No games crossed your event and rule gates"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-text-tertiary">
                No new game crossed your sourcing criteria in this brief. Your
                enabled profiles will keep watching Steam for meaningful
                changes.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {RESULT_SECTIONS.map((section) => {
              const results = overview.groups[section.key];
              return results.length > 0 ? (
                <ResultSection
                  key={section.key}
                  kicker={section.kicker}
                  results={results}
                  title={section.title}
                />
              ) : null;
            })}
          </div>
        )}
      </div>
      <BriefRail data={data} />
    </div>
  );
}

function ResultSection({
  kicker,
  results,
  title,
}: {
  kicker: string;
  results: OpportunityResultSummary[];
  title: string;
}) {
  return (
    <section>
      <div className="flex items-end justify-between border-b border-border-subtle pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
            {kicker}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-text-primary">
            {title}
          </h3>
        </div>
        <span className="text-xs tabular-nums text-text-muted">
          {results.length}
        </span>
      </div>
      <div className="divide-y divide-border-subtle">
        {results.map((result) => (
          <Link
            key={result.id}
            href={`/opportunities/games/${result.appid}?result=${result.id}`}
            prefetch={false}
            className="group grid gap-5 py-6 transition hover:bg-surface-elevated/45 md:grid-cols-[36px_minmax(0,1fr)_210px_24px] md:px-2"
          >
            <span className="text-sm tabular-nums text-text-muted">
              {result.rank ? String(result.rank).padStart(2, "0") : "—"}
            </span>
            <div className="min-w-0">
              <h4 className="truncate text-base font-semibold text-text-primary">
                {result.name}
              </h4>
              <p className="mt-2 max-w-3xl text-base font-medium leading-6 text-text-primary">
                {describeOpportunityChange(result.change)}
              </p>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">
                {opportunityWhyItMatters(result)}
              </p>
              {result.matchedProfiles.length > 0 && (
                <p className="mt-3 text-xs text-text-tertiary">
                  <span className="font-semibold text-text-secondary">
                    Matches your sourcing profile:
                  </span>{" "}
                  {result.matchedProfiles
                    .map((profile) => profile.name)
                    .join(", ")}
                </p>
              )}
            </div>
            <div className="space-y-3 md:text-right">
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {opportunityStrengthLabel(result.score)}
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-text-tertiary">
                  Opportunity fit:{" "}
                  {result.score === null
                    ? "Not available"
                    : `${Math.round(result.score)}/100`}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-text-secondary">
                  Market potential:{" "}
                  {opportunityPotentialLabel(result.marketPotential)}
                </p>
                <p
                  className="mt-0.5 text-xs text-text-tertiary"
                  title={opportunityConfidenceExplanation(result.confidence)}
                >
                  {opportunityConfidenceLabel(result.confidence)}
                </p>
              </div>
            </div>
            <ArrowRight
              aria-hidden="true"
              className="mt-1 h-4 w-4 text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent-primary"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

function BriefRail({ data }: { data: OpportunityBootstrap }) {
  const canSeeDiagnostics =
    data.workspace.role === "owner" || data.workspace.role === "admin";
  return (
    <aside className="border-t border-border-subtle bg-surface-sunken px-5 py-7 lg:border-l lg:border-t-0 lg:px-6 lg:py-10">
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
          Your sourcing strategy
        </p>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          {data.profiles.filter((profile) => profile.status === "enabled")
            .length === 1
            ? "1 active profile is"
            : `${data.profiles.filter((profile) => profile.status === "enabled").length} active profiles are`}{" "}
          watching for games that match your commercial priorities.
        </p>
      </section>
      <section className="mt-8 border-t border-border-muted pt-7">
        <div className="flex items-center gap-2 text-text-primary">
          <Users className="h-4 w-4 text-accent-primary" />
          <h3 className="text-sm font-semibold">{data.workspace.name}</h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-text-tertiary">
          Your team can see who has opened or started researching a game.
          Profiles, tracking, dismissals, and delivery settings remain personal.
        </p>
      </section>
      {canSeeDiagnostics && (
        <details className="mt-8 border-t border-border-muted pt-7">
          <summary className="cursor-pointer text-xs font-semibold text-text-tertiary transition hover:text-text-primary">
            Data status
          </summary>
          <div className="mt-4 space-y-3">
            {data.sourceHealth.map((source) => (
              <div
                key={source.source}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate text-xs text-text-secondary">
                  {humanizeOpportunity(source.label)}
                </span>
                <span className="text-[10px] uppercase text-text-muted">
                  {source.state}
                </span>
              </div>
            ))}
          </div>
          {data.dailyOverview.coverageWarnings.length > 0 && (
            <ul className="mt-4 space-y-2 border-t border-border-muted pt-4">
              {data.dailyOverview.coverageWarnings.map((warning) => (
                <li
                  key={warning}
                  className="text-xs leading-5 text-text-tertiary"
                >
                  {warning}
                </li>
              ))}
            </ul>
          )}
          {data.dailyOverview.presetHealthChanges.length > 0 && (
            <div className="mt-4 border-t border-border-muted pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Recent market health changes
              </p>
              <div className="mt-3 space-y-4">
                {data.dailyOverview.presetHealthChanges.map((change) => (
                  <div key={`${change.name}:${change.asOfDate}`}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-text-primary">
                        {change.name}
                      </p>
                      <span className="text-[10px] uppercase text-accent-primary">
                        {change.priorState
                          ? `${humanizeOpportunity(change.priorState)} → ${humanizeOpportunity(change.state)}`
                          : humanizeOpportunity(change.state)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-text-muted">
                      {formatOpportunityDate(change.asOfDate)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-tertiary">
                      {change.explanation.at(-1) ?? change.explanation[0]}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-text-muted">
                      {change.explanation[0]}
                      {change.sampleCapped
                        ? ` ${change.maximumEvaluated.toLocaleString()}-game evaluation cap reached.`
                        : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </details>
      )}
    </aside>
  );
}

function ProfilesDesk({
  data,
  loadingProfile,
  onClone,
  onNew,
  onOpen,
}: {
  data: OpportunityBootstrap;
  loadingProfile: boolean;
  onClone: (presetId: string, name: string) => Promise<void>;
  onNew: () => void;
  onOpen: (profileId: string) => Promise<void>;
}) {
  return (
    <div className="px-5 py-8 md:px-8 md:py-10">
      <div className="grid gap-10 xl:grid-cols-[minmax(0,0.85fr)_minmax(420px,1.15fr)]">
        <section>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
                Personal
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
                Your sourcing profiles
              </h2>
            </div>
            <button
              type="button"
              onClick={onNew}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-accent-primary transition hover:bg-accent-primary-muted"
            >
              <Plus className="h-4 w-4" />
              Build from scratch
            </button>
          </div>
          <div className="mt-6 divide-y divide-border-subtle border-y border-border-muted">
            {data.profiles.length === 0 ? (
              <div className="py-12">
                <p className="text-sm font-medium text-text-primary">
                  No personal profiles yet.
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-text-tertiary">
                  Clone a PublisherIQ preset to get a transparent starting
                  point, then make every criterion your own.
                </p>
              </div>
            ) : (
              data.profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => onOpen(profile.id)}
                  disabled={loadingProfile}
                  className="group grid w-full gap-3 py-5 text-left transition hover:bg-surface-elevated/50 md:grid-cols-[minmax(0,1fr)_auto_24px] md:px-2"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-text-primary">
                        {profile.name}
                      </h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          profile.status === "enabled"
                            ? "bg-semantic-success-muted text-semantic-success-text"
                            : "bg-surface-sunken text-text-tertiary"
                        }`}
                      >
                        {profile.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-text-tertiary">
                      {profile.description || "No research note"}
                    </p>
                    <p className="mt-2 text-xs text-text-muted">
                      {profile.sourcePresetName
                        ? `Based on ${profile.sourcePresetName}`
                        : "Custom profile"}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      Daily at {profile.localDeliveryTime} {profile.timezone}
                    </p>
                  </div>
                  <div className="text-xs text-text-muted md:text-right">
                    {profile.nextEvaluationAt
                      ? `Next ${formatOpportunityDate(profile.nextEvaluationAt)}`
                      : "Not scheduled"}
                  </div>
                  <ArrowRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent-primary" />
                </button>
              ))
            )}
          </div>
        </section>

        <section>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              PublisherIQ maintained
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
              Preset field notes
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-tertiary">
              PublisherIQ-maintained starting points you can clone and tailor to
              your strategy. Cloning does not turn on alerts automatically.
            </p>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {data.presets.map((preset, index) => (
              <article
                key={preset.id}
                className={`group relative overflow-hidden border border-border-muted bg-surface-raised p-5 ${
                  index === 0 ? "sm:col-span-2" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      preset.healthState === "surging"
                        ? "bg-accent-primary"
                        : preset.healthState === "growing"
                          ? "bg-semantic-success"
                          : "bg-border-prominent"
                    }`}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {preset.healthUnavailableReason === "unreleased_only"
                      ? "Unreleased health model pending"
                      : presetMarketLabel(preset.healthState)}
                  </span>
                </div>
                <h3 className="mt-4 pr-10 text-lg font-semibold text-text-primary">
                  {preset.name}
                </h3>
                <p className="mt-2 text-sm leading-6 text-text-tertiary">
                  {preset.description}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {preset.ruleSummary
                    .slice(0, index === 0 ? 3 : 2)
                    .map((rule) => (
                      <li
                        key={rule}
                        className="line-clamp-1 text-xs text-text-secondary"
                      >
                        {rule}
                      </li>
                    ))}
                </ul>
                <button
                  type="button"
                  disabled={loadingProfile}
                  onClick={() => onClone(preset.id, preset.name)}
                  className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-accent-primary transition group-hover:gap-3 disabled:opacity-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Clone and customize
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function DeliveryDesk({
  data,
  onChanged,
}: {
  data: OpportunityBootstrap;
  onChanged: () => Promise<void>;
}) {
  const [slackUrl, setSlackUrl] = useState("");
  const [maxResults, setMaxResults] = useState(10);
  const [quietDay, setQuietDay] = useState<"skip" | "send_empty">("skip");
  const [immediate, setImmediate] = useState(false);
  const [profileScope, setProfileScope] = useState("all");
  const [saving, setSaving] = useState<"email" | "slack" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const preferences = useMemo(
    () =>
      new Map(
        data.channelPreferences
          .filter(
            (preference) =>
              preference.profileId ===
              (profileScope === "all" ? null : profileScope),
          )
          .map((preference) => [preference.channel, preference]),
      ),
    [data.channelPreferences, profileScope],
  );

  const configure = async (channel: "email" | "slack", enabled: boolean) => {
    setSaving(channel);
    setMessage(null);
    try {
      await opportunityPost("configure-channel", {
        channel,
        destination: channel === "slack" ? slackUrl : undefined,
        enabled,
        immediateFullMatchEnabled: immediate,
        maxResults,
        profileId: profileScope === "all" ? null : profileScope,
        quietDayBehavior: quietDay,
      });
      setMessage(
        `${channel === "email" ? "Email" : "Slack"} delivery updated.`,
      );
      await onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Delivery update failed.",
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="px-5 py-8 md:px-8 md:py-10">
      <div className="max-w-5xl">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
          Stay in the loop
        </p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">
          Deliver the brief where work starts.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-tertiary">
          Email and Slack carry a compact, personal selection. Every item links
          back to the complete research record on PublisherIQ.
        </p>

        <label className="mt-8 block max-w-md">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Delivery scope
          </span>
          <select
            value={profileScope}
            onChange={(event) => setProfileScope(event.target.value)}
            className="mt-2 block w-full rounded-lg border border-border-muted bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent-primary"
          >
            <option value="all">All profiles (one combined brief)</option>
            {data.profiles
              .filter((profile) => profile.status !== "archived")
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
          </select>
          <span className="mt-2 block text-xs leading-5 text-text-tertiary">
            Profile-scoped destinations receive only that profile’s matches. A
            result matched by several profiles is sent at most once per channel.
          </span>
        </label>

        <div className="mt-10 divide-y divide-border-muted border-y border-border-muted">
          <ChannelRow
            configured={preferences.get("email")?.enabled ?? false}
            detail={
              preferences.get("email")?.destinationLabel ??
              "Uses the verified email on your PublisherIQ account."
            }
            icon={Mail}
            loading={saving === "email"}
            name="Email brief"
            onDisable={() => configure("email", false)}
            onEnable={() => configure("email", true)}
          />
          <div className="py-6">
            <div className="grid gap-5 md:grid-cols-[44px_minmax(0,1fr)_auto]">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-elevated text-text-secondary">
                <Slack className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">
                  Slack digest
                </h3>
                <p className="mt-1 text-sm text-text-tertiary">
                  One message per daily brief in the channel selected by the
                  webhook.
                </p>
                <input
                  type="url"
                  value={slackUrl}
                  onChange={(event) => setSlackUrl(event.target.value)}
                  placeholder={
                    preferences.get("slack")?.destinationLabel ??
                    "https://hooks.slack.com/services/…"
                  }
                  className="mt-4 w-full max-w-xl rounded-lg border border-border-muted bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent-primary"
                />
              </div>
              <div className="flex items-start gap-2">
                {preferences.get("slack")?.enabled && (
                  <button
                    type="button"
                    onClick={() => configure("slack", false)}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-text-tertiary hover:bg-surface-elevated"
                  >
                    Disable
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => configure("slack", true)}
                  disabled={!slackUrl || saving === "slack"}
                  className="rounded-lg bg-text-primary px-3 py-2 text-sm font-semibold text-surface disabled:opacity-40"
                >
                  {saving === "slack" ? "Saving…" : "Connect"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <section className="mt-9 grid gap-6 rounded-xl bg-surface-sunken p-5 md:grid-cols-3">
          <label>
            <span className="text-xs font-semibold text-text-primary">
              Maximum results
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxResults}
              onChange={(event) => setMaxResults(Number(event.target.value))}
              className="mt-2 block w-full rounded-lg border border-border-muted bg-surface-raised px-3 py-2 text-sm text-text-primary"
            />
          </label>
          <label>
            <span className="text-xs font-semibold text-text-primary">
              Quiet days
            </span>
            <select
              value={quietDay}
              onChange={(event) =>
                setQuietDay(event.target.value as "skip" | "send_empty")
              }
              className="mt-2 block w-full rounded-lg border border-border-muted bg-surface-raised px-3 py-2 text-sm text-text-primary"
            >
              <option value="skip">Skip delivery</option>
              <option value="send_empty">Send a quiet-day note</option>
            </select>
          </label>
          <label className="flex cursor-pointer items-start gap-3 md:pt-7">
            <input
              type="checkbox"
              checked={immediate}
              onChange={(event) => setImmediate(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent-primary)]"
            />
            <span>
              <span className="block text-xs font-semibold text-text-primary">
                Immediate full matches
              </span>
              <span className="mt-1 block text-xs text-text-tertiary">
                First-observed games only.
              </span>
            </span>
          </label>
        </section>
        {message && (
          <p className="mt-4 text-sm text-text-secondary">{message}</p>
        )}
      </div>
    </div>
  );
}

function ChannelRow({
  configured,
  detail,
  icon: Icon,
  loading,
  name,
  onDisable,
  onEnable,
}: {
  configured: boolean;
  detail: string;
  icon: typeof Mail;
  loading: boolean;
  name: string;
  onDisable: () => void;
  onEnable: () => void;
}) {
  return (
    <div className="grid gap-5 py-6 md:grid-cols-[44px_minmax(0,1fr)_auto]">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-elevated text-text-secondary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-text-primary">{name}</h3>
          {configured && <Check className="h-4 w-4 text-semantic-success" />}
        </div>
        <p className="mt-1 text-sm text-text-tertiary">{detail}</p>
      </div>
      <button
        type="button"
        onClick={configured ? onDisable : onEnable}
        disabled={loading}
        className={`self-start rounded-lg px-3 py-2 text-sm font-semibold ${
          configured
            ? "text-text-tertiary hover:bg-surface-elevated"
            : "bg-text-primary text-surface"
        }`}
      >
        {loading ? "Saving…" : configured ? "Disable" : "Enable"}
      </button>
    </div>
  );
}

function OpportunityLoading() {
  return (
    <div className="-m-4 min-h-screen bg-surface p-8 md:-m-6 lg:-m-8">
      <div className="mx-auto max-w-[1500px] animate-pulse">
        <div className="h-3 w-40 rounded bg-border-muted" />
        <div className="mt-5 h-16 max-w-2xl rounded bg-surface-elevated" />
        <div className="mt-4 h-4 max-w-xl rounded bg-border-subtle" />
        <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_300px]">
          <div className="h-[520px] rounded-xl bg-surface-raised" />
          <div className="h-[420px] rounded-xl bg-surface-elevated" />
        </div>
      </div>
    </div>
  );
}
