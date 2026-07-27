"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Database,
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
  Tag,
  Users,
  X,
  Youtube,
} from "lucide-react";

import {
  formatOpportunityDate,
  humanizeOpportunity,
  opportunityPost,
} from "../../lib/api";
import type { OpportunityGameRecord } from "../../lib/types";

function display(value: unknown): string {
  if (value === null || value === undefined) {
    return "Not available";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
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
      setError("This canonical record link is missing its result identity.");
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
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Record unavailable.",
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
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Action failed.",
      );
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
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Action failed.",
      );
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
          Daily brief
        </Link>
        <div className="mt-10 border-l-2 border-semantic-error pl-6">
          <h1 className="text-2xl font-semibold text-text-primary">
            Record unavailable
          </h1>
          <p className="mt-3 text-sm text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  const market = record.marketContext;
  const tracked = Boolean(record.userState.trackedAt);
  const researching = record.userState.researching;

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
            Daily opportunity brief
          </Link>
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
                {humanizeOpportunity(record.result.eventLabel)}
                <span className="text-text-muted">•</span>
                observed {formatOpportunityDate(record.result.createdAt)}
              </div>
              <h1 className="mt-3 max-w-4xl text-[clamp(2rem,5vw,4.2rem)] font-medium leading-[0.95] tracking-[-0.045em] text-text-primary">
                {record.app.name}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-tertiary">
                <span>
                  {record.app.developers.join(", ") || "Developer not listed"}
                </span>
                <span>→</span>
                <span>
                  {record.app.publishers.join(", ") || "Publisher not listed"}
                </span>
                <a
                  href={record.app.steamUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-accent-primary"
                >
                  Steam <ExternalLink className="h-3 w-3" />
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
                label={researching ? "Researching" : "Research"}
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
          <section className="grid gap-8 border-b border-border-muted pb-10 md:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Why now
              </p>
              <p className="mt-3 text-xl leading-8 text-text-primary">
                {record.result.whyNow}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {record.result.strongestEvidence.map((evidence) => (
                  <span
                    key={evidence}
                    className="rounded-full bg-accent-primary-muted px-3 py-1.5 text-xs font-medium text-accent-primary"
                  >
                    {evidence}
                  </span>
                ))}
              </div>
            </div>
            <div className="border-l border-border-muted pl-6">
              <p className="font-mono text-5xl tracking-tight text-text-primary">
                {record.rank.finalScore?.toFixed(1) ?? "—"}
              </p>
              <p className="mt-2 text-xs uppercase tracking-wide text-text-muted">
                explainable rank score
              </p>
              <p className="mt-5 text-xs leading-5 text-text-tertiary">
                {record.rank.rankingVersion}
              </p>
            </div>
          </section>

          <SectionHeader
            icon={BarChart3}
            kicker="Decomposed ranking"
            title="Every point has a named input"
          />
          <div className="grid gap-px overflow-hidden rounded-xl border border-border-muted bg-border-muted sm:grid-cols-5">
            {Object.entries(record.rank.components).map(([component, value]) =>
              typeof value === "number" ? (
                <div key={component} className="bg-surface-raised px-4 py-5">
                  <p className="font-mono text-2xl text-text-primary">
                    {(value * 100).toFixed(0)}
                  </p>
                  <p className="mt-2 text-[10px] uppercase leading-4 tracking-wide text-text-muted">
                    {humanizeOpportunity(component)}
                  </p>
                  <p className="mt-1 text-[10px] text-text-tertiary">
                    {Math.round((record.rank.weights[component] ?? 0) * 100)}%
                    weight
                  </p>
                </div>
              ) : null,
            )}
          </div>
          <ul className="mt-4 space-y-2">
            {record.rank.reasons.map((reason) => (
              <li
                key={reason}
                className="flex gap-2 text-sm leading-6 text-text-secondary"
              >
                <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-semantic-success" />
                {reason}
              </li>
            ))}
          </ul>

          <SectionHeader
            icon={ShieldCheck}
            kicker="Rule evidence"
            title="Why this game qualified"
          />
          <div className="space-y-5">
            {record.matchedProfiles.map((profile) => (
              <article
                key={profile.id}
                className="border-y border-border-subtle py-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-base font-semibold text-text-primary">
                    {profile.name}
                  </h3>
                  <div className="text-right">
                    <span className="rounded-full bg-semantic-success-muted px-2.5 py-1 text-[10px] font-semibold uppercase text-semantic-success-text">
                      eligible
                    </span>
                    <p className="mt-2 font-mono text-[10px] text-text-muted">
                      v{profile.profileVersion} ·{" "}
                      {profile.profileVersionId.slice(0, 8)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-5 md:grid-cols-3">
                  <RuleOutcomeColumn
                    label="Required"
                    outcomes={profile.ruleOutcomes.requiredOutcomes}
                  />
                  <RuleOutcomeColumn
                    label="Preferred"
                    outcomes={profile.ruleOutcomes.preferredOutcomes}
                  />
                  <RuleOutcomeColumn
                    label="Excluded"
                    outcomes={profile.ruleOutcomes.excludedOutcomes}
                  />
                </div>
              </article>
            ))}
          </div>

          <SectionHeader
            icon={Radar}
            kicker="Released-market comparables"
            title="The peer set behind market context"
          />
          {record.cohort ? (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
                <span>{record.cohort.members.length} released peers</span>
                <span>•</span>
                <span>
                  {Math.round(record.cohort.coverage * 100)}% measured coverage
                </span>
                <span>•</span>
                <span>Fallback tier {record.cohort.fallbackTier}</span>
                <span>•</span>
                <span>{record.cohort.confidence} confidence</span>
              </div>
              <div className="mt-5 overflow-x-auto border-y border-border-muted">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className="bg-surface-elevated text-[10px] uppercase tracking-wide text-text-muted">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Comparable</th>
                      <th className="px-3 py-2.5 font-semibold">
                        Why included
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        Reviews
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        30d added
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">
                        CCU peak
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
                        <td className="px-3 py-3 text-right font-mono text-text-secondary">
                          {member.totalReviews?.toLocaleString() ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-text-secondary">
                          {member.reviewsAdded30d?.toLocaleString() ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-text-secondary">
                          {member.ccuPeak?.toLocaleString() ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-text-tertiary">
              No responsible released-peer cohort was available.
            </p>
          )}

          <SectionHeader
            icon={History}
            kicker="Material change ledger"
            title="What PublisherIQ observed"
          />
          {record.recentChanges.length === 0 ? (
            <p className="text-sm text-text-tertiary">
              No material change record was available before this result.
            </p>
          ) : (
            <div className="divide-y divide-border-subtle border-y border-border-muted">
              {record.recentChanges.map((change) => (
                <article
                  key={change.eventFingerprint}
                  className="grid gap-3 py-4 md:grid-cols-[180px_minmax(0,1fr)]"
                >
                  <div>
                    <p className="text-xs font-semibold text-text-primary">
                      {humanizeOpportunity(change.eventType)}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">
                      {humanizeOpportunity(change.signalFamily)} ·{" "}
                      {Math.round(change.materiality * 100)}% materiality
                    </p>
                    <p className="mt-2 text-[10px] text-text-muted">
                      Observed {formatOpportunityDate(change.observedAt)}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg bg-surface-elevated px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Before
                      </p>
                      <p className="mt-1 break-words text-xs leading-5 text-text-secondary">
                        {display(change.before)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-accent-primary-muted px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-accent-primary">
                        After
                      </p>
                      <p className="mt-1 break-words text-xs leading-5 text-text-secondary">
                        {display(change.after)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          <div className="grid gap-8 lg:grid-cols-2">
            <section>
              <SectionHeader
                icon={Newspaper}
                kicker="Official source material"
                title="Recent Steam news"
              />
              {record.officialNews.length === 0 ? (
                <p className="text-sm leading-6 text-text-tertiary">
                  No official Steam news was linked to this title before the
                  result cutoff.
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
                kicker="Additive creator evidence"
                title="Recent matched videos"
              />
              <p className="mb-3 text-[10px] uppercase tracking-wide text-semantic-warning">
                Partial coverage · never treated as universal absence
              </p>
              {record.youtubeEvidence.videos.length === 0 ? (
                <p className="text-sm leading-6 text-text-tertiary">
                  No primary video match was available in the covered dataset.
                  This is not evidence that creator coverage is absent.
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

          <SectionHeader
            icon={Tag}
            kicker="Provenance ledger"
            title="Observed and derived evidence"
          />
          <div className="divide-y divide-border-subtle border-y border-border-muted">
            {record.evidence.map((evidence) => (
              <div
                key={`${evidence.label}:${evidence.source}`}
                className="grid gap-2 py-4 md:grid-cols-[170px_minmax(0,1fr)_170px]"
              >
                <div>
                  <p className="text-xs font-semibold text-text-primary">
                    {evidence.label}
                  </p>
                  <p className="mt-1 text-[10px] uppercase text-text-muted">
                    {humanizeOpportunity(evidence.evidenceClass)}
                  </p>
                </div>
                <p className="text-sm text-text-secondary">
                  {display(evidence.value)}
                </p>
                <div className="text-xs text-text-tertiary md:text-right">
                  <p>{evidence.source}</p>
                  <p className="mt-1">
                    {formatOpportunityDate(evidence.sourceAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <SectionHeader
            icon={Database}
            kicker="Reproduction contract"
            title="Versions, windows, and delivery history"
          />
          <div className="grid gap-px overflow-hidden rounded-xl border border-border-muted bg-border-muted md:grid-cols-3">
            <div className="bg-surface-raised p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Evaluation run
              </p>
              <p className="mt-3 text-sm font-medium text-text-primary">
                {humanizeOpportunity(record.provenance.run.kind)}
              </p>
              <p className="mt-2 text-xs leading-5 text-text-tertiary">
                {formatOpportunityDate(record.provenance.run.windowStart)}
                <br />
                through {formatOpportunityDate(record.provenance.run.windowEnd)}
              </p>
              <p className="mt-3 break-all font-mono text-[10px] text-text-muted">
                {record.provenance.run.id}
              </p>
            </div>
            <div className="bg-surface-raised p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Triggering event
              </p>
              {record.provenance.triggeringEvent ? (
                <>
                  <p className="mt-3 text-sm font-medium text-text-primary">
                    {humanizeOpportunity(
                      record.provenance.triggeringEvent.eventType,
                    )}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-text-tertiary">
                    Observed{" "}
                    {formatOpportunityDate(
                      record.provenance.triggeringEvent.observedAt,
                    )}
                    <br />
                    Effective{" "}
                    {formatOpportunityDate(
                      record.provenance.triggeringEvent.effectiveAt,
                    )}
                  </p>
                  <p className="mt-3 font-mono text-[10px] text-text-muted">
                    {record.provenance.triggeringEvent.registryVersion} ·{" "}
                    {record.provenance.triggeringEvent.classifierVersion}
                  </p>
                </>
              ) : (
                <p className="mt-3 text-xs text-text-tertiary">
                  No triggering event snapshot was linked.
                </p>
              )}
            </div>
            <div className="bg-surface-raised p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Calculation versions
              </p>
              <dl className="mt-3 space-y-2">
                {Object.entries(record.provenance.calculationVersions).map(
                  ([name, version]) => (
                    <div
                      key={name}
                      className="flex items-start justify-between gap-3 text-xs"
                    >
                      <dt className="text-text-tertiary">
                        {humanizeOpportunity(name)}
                      </dt>
                      <dd className="text-right font-mono text-text-secondary">
                        {version}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          </div>

          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <section className="border-y border-border-subtle py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Source timestamps
              </p>
              <dl className="mt-3 space-y-2">
                {Object.entries(record.provenance.sourceTimestamps).map(
                  ([source, timestamp]) => (
                    <div
                      key={source}
                      className="flex items-start justify-between gap-3 text-xs"
                    >
                      <dt className="text-text-tertiary">
                        {humanizeOpportunity(source)}
                      </dt>
                      <dd className="text-right text-text-secondary">
                        {formatOpportunityDate(timestamp)}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </section>
            <section className="border-y border-border-subtle py-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Delivery projections
              </p>
              {record.provenance.deliveries.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-text-tertiary">
                  Website record only; no channel projection is linked yet.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {record.provenance.deliveries.map((delivery, index) => (
                    <div
                      key={`${delivery.channel}:${delivery.createdAt}:${index}`}
                      className="flex items-start justify-between gap-3 text-xs"
                    >
                      <span className="text-text-secondary">
                        {humanizeOpportunity(delivery.channel)} ·{" "}
                        {humanizeOpportunity(delivery.deliveryKind)}
                      </span>
                      <span className="text-right text-text-tertiary">
                        {humanizeOpportunity(delivery.status)}
                        <br />
                        {formatOpportunityDate(
                          delivery.sentAt ?? delivery.createdAt,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        <aside className="border-t border-border-subtle bg-surface-sunken px-5 py-8 lg:border-l lg:border-t-0 lg:px-6 lg:py-10">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
            Market reading
          </p>
          <p className="mt-3 text-2xl font-semibold text-text-primary">
            {humanizeOpportunity(market?.potentialBand ?? "insufficient_data")}
          </p>
          <p className="mt-1 text-xs uppercase tracking-wide text-text-muted">
            directional potential · {market?.confidence ?? "directional"}{" "}
            confidence
          </p>
          {market && (
            <>
              <div className="mt-7 space-y-5">
                {Object.entries(market.distributions).map(
                  ([name, distribution]) => (
                    <div key={name}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">
                          {humanizeOpportunity(name)}
                        </span>
                        <span className="font-mono text-text-primary">
                          P75 {distribution.p75?.toLocaleString() ?? "—"}
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-text-muted">
                        {distribution.measured} measured · median{" "}
                        {distribution.p50?.toLocaleString() ?? "—"} · P90{" "}
                        {distribution.p90?.toLocaleString() ?? "—"}
                      </p>
                    </div>
                  ),
                )}
              </div>
              <ul className="mt-7 space-y-3 border-t border-border-muted pt-6">
                {market.explanation.map((explanation) => (
                  <li
                    key={explanation}
                    className="text-xs leading-5 text-text-secondary"
                  >
                    {explanation}
                  </li>
                ))}
              </ul>
            </>
          )}

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
                  Opening this record has placed your first viewed marker.
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
                      {humanizeOpportunity(activity.activityType)}
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
                  This is the first canonical appearance.
                </p>
              ) : (
                record.previousAppearances.map((appearance) => (
                  <Link
                    key={appearance.resultId}
                    href={`/opportunities/games/${appid}?result=${appearance.resultId}`}
                    className="block border-l border-border-prominent pl-3"
                  >
                    <p className="text-xs font-medium text-text-primary">
                      {humanizeOpportunity(appearance.eventLabel)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-tertiary">
                      {appearance.whyNow}
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
              <p className="text-[10px] font-semibold uppercase tracking-wide text-semantic-warning">
                Missing evidence
              </p>
              <p className="mt-2 text-xs leading-5 text-text-secondary">
                {record.missingEvidence.map(humanizeOpportunity).join(", ")}
              </p>
            </section>
          )}
        </aside>
      </main>
    </div>
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

function RuleOutcomeColumn({
  label,
  outcomes,
}: {
  label: string;
  outcomes: Array<{
    clauseOutcomes: Array<{
      explanation: string;
      field: string;
      state: "true" | "false" | "unknown";
    }>;
    groupId: string;
    label: string;
    state: "true" | "false" | "unknown";
  }>;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <div className="mt-3 space-y-3">
        {outcomes.length === 0 ? (
          <p className="text-xs italic text-text-muted">No rules</p>
        ) : (
          outcomes.map((outcome) => (
            <div key={outcome.groupId}>
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    outcome.state === "true"
                      ? "bg-semantic-success"
                      : outcome.state === "unknown"
                        ? "bg-semantic-warning"
                        : "bg-semantic-error"
                  }`}
                />
                <p className="text-xs font-medium text-text-primary">
                  {outcome.label}
                </p>
              </div>
              {outcome.clauseOutcomes.map((clause) => (
                <p
                  key={`${clause.field}:${clause.explanation}`}
                  className="mt-1 pl-3.5 text-[11px] leading-4 text-text-tertiary"
                >
                  {clause.explanation}
                </p>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
