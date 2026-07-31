"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ExternalLink,
  Eye,
  Flag,
  History,
  Minus,
  Newspaper,
  Radar,
  RotateCcw,
  Search,
  ShieldCheck,
  Users,
  X,
  Youtube,
} from "lucide-react";

import {
  describeOpportunityRuleClause,
  formatOpportunityDate,
  formatOpportunityMetricValue,
  OPPORTUNITY_COMPONENTS,
  opportunityComponentStrength,
  opportunityConfidenceExplanation,
  opportunityConfidenceLabel,
  opportunityFieldLabel,
  opportunityMetricLabel,
  opportunityPost,
  opportunityPotentialLabel,
  opportunityStrengthLabel,
  opportunityWhyItMatters,
} from "../../lib/api";
import type {
  OpportunityGameRecord,
  OpportunityRuleField,
  OpportunityRuleOperator,
} from "../../lib/types";

function metricToken(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function metricKind(value: string): string | null {
  const token = metricToken(value);
  if (token === "ccupeak" || token.includes("peakconcurrentplayers")) {
    return "ccupeak";
  }
  if (
    token === "reviewsadded30d" ||
    (token.includes("reviewsadded") && token.includes("30"))
  ) {
    return "reviewsadded30d";
  }
  if (token === "totalreviews" || token.includes("totalsteamreviews")) {
    return "totalreviews";
  }
  if (
    token === "positivepercentage" ||
    token.includes("positivesteamreviewrate")
  ) {
    return "positivepercentage";
  }
  return null;
}

function changeLabel(
  value: OpportunityGameRecord["recentChanges"][number]["eventType"],
): string {
  return {
    announcement: "Official announcement",
    business_model_changed: "Pricing or business model",
    ccu_breakthrough: "Player milestone",
    date_window_changed: "Saved date window",
    demo_added: "Playable demo",
    developer_changed: "Developer",
    first_observed: "New discovery",
    material_change: "Steam update",
    platform_expanded: "Platform support",
    publisher_changed: "Publisher",
    release_timing_changed: "Release timing",
    released: "Steam release",
    review_breakthrough: "Review milestone",
    store_readiness_improved: "Store page",
    taxonomy_repositioned: "Steam positioning",
  }[value];
}

function resultLabel(value: string): string {
  return (
    {
      materially_changed: "Commercial change",
      newly_discovered: "New discovery",
      newly_qualified: "New match",
      newly_released: "Newly released",
      tracked_update: "Tracked update",
    }[value] ?? "Prior brief"
  );
}

function activityLabel(
  value: OpportunityGameRecord["teamActivity"][number]["activityType"],
): string {
  return {
    researching_cleared: "finished researching",
    researching_started: "started researching",
    viewed: "opened this game",
  }[value];
}

function findCurrentMetric(
  metrics: OpportunityGameRecord["currentMetrics"],
  metric: string,
): number | string | null {
  const target = metricKind(metric);
  if (target === null) {
    return null;
  }
  const match = Object.entries(metrics).find(
    ([name]) => metricKind(name) === target,
  );
  return match?.[1] ?? null;
}

function demandSummary(
  direction: "declining" | "improving" | "stable" | "unknown" | undefined,
): string {
  return {
    declining:
      "Recent player and review activity across comparable games is softening.",
    improving:
      "Recent player and review activity across comparable games is strengthening.",
    stable:
      "Recent player and review activity across comparable games is broadly stable.",
    unknown:
      "We do not yet have enough recent player and review data to determine whether demand is rising or falling.",
  }[direction ?? "unknown"];
}

export function OpportunityGameRecordClient({
  appid,
  resultId,
}: {
  appid: number;
  resultId: string;
}) {
  const [record, setRecord] = useState<OpportunityGameRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    if (!appid || !resultId) {
      setError("This opportunity link is incomplete.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRecord(
        await opportunityPost<OpportunityGameRecord>("game-record", {
          appid,
          resultId,
        }),
      );
      setError(null);
    } catch {
      setError(
        "PublisherIQ could not load this opportunity. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [appid, resultId]);

  const setPersonalState = async (
    action: "dismiss" | "ignore" | "restore" | "track" | "untrack",
  ) => {
    if (!record) return;
    setActing(action);
    try {
      await opportunityPost("game-state", {
        action,
        appid,
        eventFingerprint: record.result.eventFingerprint,
      });
      await load();
    } catch {
      setError("PublisherIQ could not update this game. Please try again.");
    } finally {
      setActing(null);
    }
  };

  const setResearching = async (active: boolean) => {
    setActing("researching");
    try {
      await opportunityPost("team-activity", {
        activityType: active ? "researching_started" : "researching_cleared",
        appid,
      });
      await load();
    } catch {
      setError("PublisherIQ could not update team activity. Please try again.");
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] animate-pulse py-10">
        <div className="h-4 w-40 rounded bg-border-muted" />
        <div className="mt-8 h-24 max-w-3xl rounded bg-surface-elevated" />
        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_340px]">
          <div className="h-[600px] rounded-xl bg-surface-raised" />
          <div className="h-[460px] rounded-xl bg-surface-elevated" />
        </div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="mx-auto max-w-3xl py-16">
        <Link
          href="/opportunities"
          className="inline-flex items-center gap-2 text-sm text-text-tertiary hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Daily Intelligence Desk
        </Link>
        <div className="mt-10 border-l-2 border-semantic-error pl-6">
          <h1 className="text-2xl font-semibold text-text-primary">
            Opportunity unavailable
          </h1>
          <p className="mt-3 text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  const market = record.marketContext;
  const tracked = Boolean(record.userState.trackedAt);
  const researching = record.userState.researching;
  const canSeeCoverage =
    record.workspace.role === "owner" || record.workspace.role === "admin";
  const currentMetrics = Object.entries(record.currentMetrics).filter(
    ([name, value]) => metricKind(name) !== null && value !== null,
  );

  return (
    <div className="-m-4 min-h-screen bg-surface md:-m-6 lg:-m-8">
      <header className="border-b border-border-muted bg-surface-raised px-5 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1500px]">
          <Link
            href="/opportunities"
            prefetch={false}
            className="inline-flex items-center gap-2 text-xs font-medium text-text-tertiary transition hover:text-text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Daily Intelligence Desk
          </Link>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
                Opportunity record · observed{" "}
                {formatOpportunityDate(record.result.createdAt)}
              </p>
              <h1 className="mt-3 max-w-4xl text-[clamp(2rem,5vw,4.2rem)] font-medium leading-[0.95] tracking-[-0.045em] text-text-primary">
                {record.app.name}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-tertiary">
                <span>
                  {record.app.developers.join(", ") || "Developer not listed"}
                </span>
                <span aria-hidden="true">→</span>
                <span>
                  {record.app.publishers.join(", ") || "Publisher not listed"}
                </span>
                <a
                  href={record.app.steamUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent-primary"
                >
                  View on Steam <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                active={tracked}
                disabled={acting !== null}
                icon={Flag}
                label={tracked ? "Tracked" : "Track"}
                onClick={() => setPersonalState(tracked ? "untrack" : "track")}
              />
              <ActionButton
                active={researching}
                disabled={acting !== null}
                icon={Search}
                label={researching ? "Researching" : "Start research"}
                onClick={() => setResearching(!researching)}
              />
              {record.userState.dismissedAt || record.userState.ignoredAt ? (
                <ActionButton
                  disabled={acting !== null}
                  icon={RotateCcw}
                  label="Restore"
                  onClick={() => setPersonalState("restore")}
                />
              ) : (
                <>
                  <ActionButton
                    disabled={acting !== null}
                    icon={Minus}
                    label="Dismiss"
                    onClick={() => setPersonalState("dismiss")}
                  />
                  <ActionButton
                    disabled={acting !== null}
                    icon={X}
                    label="Ignore"
                    onClick={() => setPersonalState("ignore")}
                  />
                </>
              )}
            </div>
          </div>
          {error && (
            <p className="mt-4 rounded-lg bg-semantic-warning-muted px-3 py-2 text-xs text-semantic-warning">
              {error}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] lg:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 px-5 py-8 md:px-8 md:py-10">
          <section className="grid gap-8 border-b border-border-muted pb-10 md:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
                What changed
              </p>
              <p className="mt-3 text-[clamp(1.25rem,2.5vw,1.8rem)] font-medium leading-tight text-text-primary">
                {record.result.changeSummary}
              </p>
              <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Why it matters
              </p>
              <p className="mt-2 max-w-3xl text-base leading-7 text-text-secondary">
                {opportunityWhyItMatters(record.result)}
              </p>
              {record.result.matchedProfiles.length > 0 && (
                <p className="mt-5 text-sm text-text-tertiary">
                  <span className="font-semibold text-text-primary">
                    Matches your sourcing profile:
                  </span>{" "}
                  {record.result.matchedProfiles
                    .map((profile) => profile.name)
                    .join(", ")}
                </p>
              )}
            </div>
            <div className="border-l border-border-muted pl-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Opportunity fit
              </p>
              <p className="mt-2 text-4xl font-semibold tabular-nums text-text-primary">
                {record.rank.finalScore === null
                  ? "—"
                  : `${Math.round(record.rank.finalScore)}/100`}
              </p>
              <p className="mt-2 text-sm font-semibold text-accent-primary">
                {opportunityStrengthLabel(record.rank.finalScore)}
              </p>
              <p className="mt-4 text-xs leading-5 text-text-tertiary">
                A higher score means stronger alignment with your sourcing
                criteria, comparable-game position, market momentum, and
                evidence quality.
              </p>
            </div>
          </section>

          <SectionHeader
            icon={ShieldCheck}
            kicker="Your sourcing strategy"
            title="Why this game matches"
          />
          <div className="space-y-8">
            {record.matchedProfiles.map((profile) => (
              <article
                key={profile.id}
                className="border-y border-border-subtle py-6"
              >
                <h3 className="text-base font-semibold text-text-primary">
                  {profile.name}
                </h3>
                <div className="mt-5 grid gap-7 md:grid-cols-3">
                  <RuleOutcomeColumn
                    context="matched"
                    label="What matched"
                    outcomes={profile.ruleOutcomes.requiredOutcomes}
                  />
                  <RuleOutcomeColumn
                    context="strength"
                    label="Additional strengths"
                    outcomes={profile.ruleOutcomes.preferredOutcomes}
                  />
                  <RuleOutcomeColumn
                    context="dealbreaker"
                    label="Dealbreakers checked"
                    outcomes={profile.ruleOutcomes.excludedOutcomes}
                  />
                </div>
              </article>
            ))}
          </div>

          <SectionHeader
            icon={BarChart3}
            kicker="Opportunity strength"
            title="What drives this opportunity score"
          />
          <div className="grid gap-px overflow-hidden border-y border-border-muted bg-border-muted sm:grid-cols-2 xl:grid-cols-5">
            {Object.entries(record.rank.components).map(
              ([component, value]) => {
                const presentation = OPPORTUNITY_COMPONENTS[component];
                if (typeof value !== "number" || !presentation) return null;
                return (
                  <div key={component} className="bg-surface-raised px-4 py-5">
                    <p className="text-sm font-semibold text-text-primary">
                      {presentation.label}
                    </p>
                    <p className="mt-3 text-lg font-semibold text-accent-primary">
                      {opportunityComponentStrength(value)}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-text-tertiary">
                      {presentation.description}
                    </p>
                  </div>
                );
              },
            )}
          </div>

          <SectionHeader
            icon={Radar}
            kicker="Commercial context"
            title="Current traction and comparable-game benchmarks"
          />
          <div className="grid gap-px overflow-hidden border-y border-border-muted bg-border-muted sm:grid-cols-2 xl:grid-cols-4">
            {currentMetrics.length === 0 ? (
              <p className="col-span-full bg-surface-raised px-4 py-5 text-sm text-text-tertiary">
                Current player and review metrics are not yet available.
              </p>
            ) : (
              currentMetrics.slice(0, 4).map(([name, value]) => (
                <div key={name} className="bg-surface-raised px-4 py-5">
                  <p className="text-xs leading-5 text-text-tertiary">
                    {opportunityMetricLabel(name)}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">
                    {formatOpportunityMetricValue(name, value)}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">
                    Selected game
                  </p>
                </div>
              ))
            )}
          </div>
          <p className="mt-5 max-w-3xl text-sm leading-6 text-text-secondary">
            {demandSummary(market?.demandDirection)}
          </p>

          {market && Object.keys(market.distributions).length > 0 && (
            <div className="mt-7 divide-y divide-border-subtle border-y border-border-muted">
              {Object.entries(market.distributions).map(
                ([name, distribution]) => (
                  <MarketMetricRow
                    key={name}
                    current={findCurrentMetric(record.currentMetrics, name)}
                    distribution={distribution}
                    name={name}
                  />
                ),
              )}
            </div>
          )}

          <h3 className="mt-10 text-lg font-semibold text-text-primary">
            Comparable games behind the benchmarks
          </h3>
          {record.cohort && record.cohort.members.length > 0 ? (
            <>
              <p className="mt-2 text-sm leading-6 text-text-tertiary">
                {record.cohort.members.length} similar released{" "}
                {record.cohort.members.length === 1 ? "game was" : "games were"}{" "}
                selected using shared positioning and business-model traits.
                Metric availability varies by game.
              </p>
              <div className="mt-5 overflow-x-auto border-y border-border-muted">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="bg-surface-elevated text-[10px] uppercase tracking-wide text-text-muted">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">
                        Comparable game
                      </th>
                      <th className="px-3 py-2.5 font-semibold">
                        Why it is comparable
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        Total Steam reviews
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        Reviews added in 30 days
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        Peak concurrent players
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {record.cohort.members.slice(0, 20).map((member) => (
                      <tr key={member.appid}>
                        <td className="px-3 py-3 font-medium text-text-primary">
                          {member.name}
                        </td>
                        <td className="max-w-xs px-3 py-3 text-text-tertiary">
                          {member.inclusionReasons.join(" · ")}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                          {member.totalReviews?.toLocaleString() ??
                            "Not available"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                          {member.reviewsAdded30d?.toLocaleString() ??
                            "Not available"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                          {member.ccuPeak?.toLocaleString() ?? "Not available"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm leading-6 text-text-tertiary">
              We do not yet have enough similar released games to build a
              responsible benchmark.
            </p>
          )}

          <SectionHeader
            icon={History}
            kicker="Relevant Steam activity"
            title="Changes that inform this opportunity"
          />
          {record.recentChanges.length === 0 ? (
            <p className="text-sm text-text-tertiary">
              No additional Steam change history is available for this game.
            </p>
          ) : (
            <div className="divide-y divide-border-subtle border-y border-border-muted">
              {record.recentChanges.map((change) => (
                <article
                  key={change.eventFingerprint}
                  className="grid gap-2 py-5 md:grid-cols-[180px_minmax(0,1fr)]"
                >
                  <div>
                    <p className="text-xs font-semibold text-text-primary">
                      {changeLabel(change.eventType)}
                    </p>
                    <p className="mt-1 text-[10px] text-text-muted">
                      Observed {formatOpportunityDate(change.observedAt)}
                    </p>
                  </div>
                  <p className="text-sm font-medium leading-6 text-text-secondary">
                    {change.summary}
                  </p>
                </article>
              ))}
            </div>
          )}

          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <SectionHeader
                icon={Newspaper}
                kicker="Official updates"
                title="Recent Steam announcements"
              />
              {record.officialNews.length === 0 ? (
                <p className="text-sm leading-6 text-text-tertiary">
                  No recent official Steam announcement is linked to this
                  opportunity.
                </p>
              ) : (
                <div className="divide-y divide-border-subtle border-y border-border-muted">
                  {record.officialNews.map((item) => (
                    <a
                      key={item.gid}
                      href={item.url ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="block py-4 transition hover:text-accent-primary"
                    >
                      <p className="text-sm font-medium leading-5 text-text-primary">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">
                        {item.feedLabel ?? "Steam"} ·{" "}
                        {formatOpportunityDate(item.publishedAt)}
                      </p>
                    </a>
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeader
                icon={Youtube}
                kicker="Creator signals"
                title="Recent videos about this game"
              />
              <p className="mb-3 text-xs leading-5 text-text-tertiary">
                Creator coverage is still growing, so no matched video does not
                mean no creator interest exists.
              </p>
              {record.youtubeEvidence.videos.length === 0 ? (
                <p className="text-sm leading-6 text-text-tertiary">
                  No clearly matched creator video is available yet.
                </p>
              ) : (
                <div className="divide-y divide-border-subtle border-y border-border-muted">
                  {record.youtubeEvidence.videos.map((video) => (
                    <a
                      key={video.videoId}
                      href={video.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block py-4"
                    >
                      <p className="text-sm font-medium leading-5 text-text-primary">
                        {video.title}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">
                        {video.channelTitle ?? "YouTube channel"} ·{" "}
                        {video.viewCount?.toLocaleString() ?? "Unmeasured"}{" "}
                        views · {formatOpportunityDate(video.publishedAt)}
                      </p>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>

          {canSeeCoverage && <SourceCoverage record={record} />}
        </div>

        <aside className="border-t border-border-subtle bg-surface-sunken px-5 py-8 lg:border-l lg:border-t-0 lg:px-6 lg:py-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
            Opportunity reading
          </p>
          <p className="mt-3 text-2xl font-semibold text-text-primary">
            Market potential:{" "}
            {opportunityPotentialLabel(
              market?.potentialBand ?? "insufficient_data",
            )}
          </p>
          <p className="mt-3 text-sm font-semibold text-text-secondary">
            {opportunityConfidenceLabel(
              market?.confidence ?? record.result.confidence,
            )}
          </p>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">
            {opportunityConfidenceExplanation(
              market?.confidence ?? record.result.confidence,
            )}
          </p>

          <section className="mt-9 border-t border-border-muted pt-7">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-accent-primary" />
              <h2 className="text-sm font-semibold text-text-primary">
                Team activity
              </h2>
            </div>
            <div className="mt-4 space-y-4">
              {record.teamActivity.length === 0 ? (
                <p className="text-xs leading-5 text-text-tertiary">
                  No teammate has started research yet.
                </p>
              ) : (
                record.teamActivity.slice(0, 12).map((activity, index) => (
                  <div
                    key={`${activity.occurredAt}:${index}`}
                    className="flex gap-3"
                  >
                    <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                    <p className="text-xs leading-5 text-text-secondary">
                      <span className="font-medium text-text-primary">
                        {activity.userDisplay}
                      </span>{" "}
                      {activityLabel(activity.activityType)}
                      <span className="block text-text-muted">
                        {formatOpportunityDate(activity.occurredAt)}
                      </span>
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="mt-9 border-t border-border-muted pt-7">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-accent-primary" />
              <h2 className="text-sm font-semibold text-text-primary">
                Prior appearances
              </h2>
            </div>
            <div className="mt-4 space-y-5">
              {record.previousAppearances.length === 0 ? (
                <p className="text-xs text-text-tertiary">
                  This is the first time this game has appeared in your brief.
                </p>
              ) : (
                record.previousAppearances.map((appearance) => (
                  <Link
                    key={appearance.resultId}
                    href={`/opportunities/games/${appid}?result=${appearance.resultId}`}
                    className="block border-l border-border-prominent pl-3"
                  >
                    <p className="text-xs font-medium text-text-primary">
                      {resultLabel(appearance.eventLabel)}
                    </p>
                    <p className="mt-1 text-[10px] text-text-muted">
                      {formatOpportunityDate(appearance.createdAt)}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>

          {record.missingEvidence.length > 0 && (
            <section className="mt-9 border-t border-border-muted pt-7">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Missing when this brief was evaluated
              </p>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                At{" "}
                {formatOpportunityDate(record.evidenceResolution.evaluatedAt)},
                this saved brief did not have{" "}
                {record.missingEvidence
                  .map(opportunityFieldLabel)
                  .join(", ")
                  .toLocaleLowerCase()}
                .
              </p>
              {record.evidenceResolution.previouslyMissingNowAvailable.length >
                0 && (
                <div className="mt-4 rounded-lg border border-semantic-success/20 bg-semantic-success-muted p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                    <Check className="h-3.5 w-3.5 text-semantic-success" />
                    Available now
                  </div>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">
                    {record.evidenceResolution.previouslyMissingNowAvailable
                      .map((item) => opportunityFieldLabel(item.field))
                      .join(", ")}{" "}
                    {record.evidenceResolution.previouslyMissingNowAvailable
                      .length === 1
                      ? "has"
                      : "have"}{" "}
                    since been resolved from current Steam evidence. The
                    original brief remains unchanged.
                  </p>
                </div>
              )}
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}

function MarketMetricRow({
  current,
  distribution,
  name,
}: {
  current: number | string | null;
  distribution: {
    measured: number;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p90: number | null;
  };
  name: string;
}) {
  return (
    <div className="grid gap-4 py-5 md:grid-cols-[minmax(180px,1fr)_repeat(3,minmax(120px,0.7fr))]">
      <div>
        <p className="text-sm font-semibold text-text-primary">
          {opportunityMetricLabel(name)}
        </p>
        <p className="mt-1 text-xs leading-5 text-text-tertiary">
          {distribution.measured} comparable{" "}
          {distribution.measured === 1 ? "game has" : "games have"} enough data
          for this measure.
        </p>
      </div>
      <MetricBenchmark label="Selected game" metric={name} value={current} />
      <MetricBenchmark
        label={`Median among ${distribution.measured} comparable games`}
        metric={name}
        value={distribution.p50}
      />
      <MetricBenchmark
        label="Top-quarter benchmark"
        metric={name}
        value={distribution.p75}
      />
    </div>
  );
}

function MetricBenchmark({
  label,
  metric,
  value,
}: {
  label: string;
  metric: string;
  value: number | string | null;
}) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums text-text-primary">
        {formatOpportunityMetricValue(metric, value)}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-text-muted">{label}</p>
    </div>
  );
}

function SourceCoverage({ record }: { record: OpportunityGameRecord }) {
  return (
    <details className="mt-12 border-y border-border-muted py-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-text-tertiary transition hover:text-text-primary">
        <Check className="h-4 w-4" />
        Source coverage
      </summary>
      <div className="mt-4 divide-y divide-border-subtle">
        {record.evidence.map((evidence) => (
          <div
            key={`${evidence.label}:${evidence.source}`}
            className="grid gap-1 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <span className="font-medium text-text-primary">
              {opportunityMetricLabel(evidence.label)}
            </span>
            <span className="text-text-tertiary sm:text-right">
              {evidence.confidence === "high"
                ? "Well covered"
                : "Partial coverage"}
              {evidence.sourceAt
                ? ` · Updated ${formatOpportunityDate(evidence.sourceAt)}`
                : ""}
            </span>
          </div>
        ))}
        {record.evidence.length === 0 && (
          <p className="py-3 text-xs text-text-tertiary">
            Supporting game information is still being collected.
          </p>
        )}
      </div>
    </details>
  );
}

function ActionButton({
  active = false,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: typeof Flag;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
        active
          ? "border-accent-primary/30 bg-accent-primary-muted text-accent-primary"
          : "border-border-muted bg-surface text-text-secondary hover:border-border-prominent hover:text-text-primary"
      } disabled:cursor-wait disabled:opacity-50`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function SectionHeader({
  icon: Icon,
  kicker,
  title,
}: {
  icon: typeof BarChart3;
  kicker: string;
  title: string;
}) {
  return (
    <div className="mb-5 mt-12 flex items-end justify-between gap-4 border-b border-border-muted pb-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
          {kicker}
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">
          {title}
        </h2>
      </div>
      <Icon className="h-4 w-4 text-text-muted" />
    </div>
  );
}

type RuleOutcome = {
  clauseOutcomes: Array<{
    actualValue?: unknown;
    comparisonValue?: unknown;
    field: OpportunityRuleField;
    operator?: OpportunityRuleOperator;
    state: "true" | "false" | "unknown";
  }>;
  groupId: string;
  label: string;
  state: "true" | "false" | "unknown";
};

function RuleOutcomeColumn({
  context,
  label,
  outcomes,
}: {
  context: "dealbreaker" | "matched" | "strength";
  label: string;
  outcomes: RuleOutcome[];
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <div className="mt-3 space-y-4">
        {outcomes.length === 0 ? (
          <p className="text-xs leading-5 text-text-muted">
            {context === "dealbreaker"
              ? "No dealbreakers were configured."
              : context === "strength"
                ? "No additional strengths were configured."
                : "No must-have criteria were configured."}
          </p>
        ) : (
          outcomes.map((outcome) => (
            <div key={outcome.groupId}>
              <p className="text-xs font-semibold text-text-primary">
                {outcome.label}
              </p>
              <div className="mt-2 space-y-2">
                {outcome.clauseOutcomes.map((clause, index) => {
                  const positive =
                    context === "dealbreaker"
                      ? clause.state === "false"
                      : clause.state === "true";
                  return (
                    <div
                      key={`${clause.field}:${index}`}
                      className="flex items-start gap-2"
                    >
                      {clause.state === "unknown" ? (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-semantic-warning" />
                      ) : positive ? (
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-semantic-success" />
                      ) : (
                        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
                      )}
                      <p className="text-xs leading-5 text-text-secondary">
                        {describeOpportunityRuleClause(clause, context)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
