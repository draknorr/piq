"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CircleDot,
  Image as ImageIcon,
  RefreshCw,
} from "lucide-react";

import {
  formatOpportunityDate,
  opportunityConfidenceLabel,
  opportunityPotentialLabel,
  opportunityStrengthLabel,
  opportunityWhyItMatters,
} from "./lib/api";
import type {
  OpportunityDailyBriefIssue,
  OpportunityResultSummary,
} from "./lib/types";
import {
  opportunityProfileDispatchSummary,
  opportunityPriorityLabel,
  opportunityResultDescription,
  opportunityVisibleReviewReasons,
} from "./lib/review-priority-presentation";

function issueDate(value: string | null): string {
  if (!value) {
    return "Latest issue";
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(new Date(value));
}

function gameUrl(game: OpportunityResultSummary): string {
  return `/opportunities/games/${game.appid}?result=${game.id}`;
}

function httpsImageUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function BriefImage({
  game,
  lead = false,
}: {
  game: OpportunityResultSummary;
  lead?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = httpsImageUrl(
    lead
      ? (game.headerImageUrl ?? game.screenshotThumbnailUrl)
      : (game.screenshotThumbnailUrl ?? game.headerImageUrl),
  );
  return (
    <div
      className={`relative overflow-hidden bg-surface-sunken ${
        lead ? "aspect-[920/430]" : "aspect-[16/9]"
      }`}
    >
      {src && !failed ? (
        <img
          alt={`${game.name} Steam artwork`}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.015]"
          height={lead ? 430 : 180}
          loading={lead ? "eager" : "lazy"}
          onError={() => setFailed(true)}
          src={src}
          width={lead ? 920 : 320}
        />
      ) : (
        <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_top_left,var(--color-accent-primary-muted),transparent_60%)] px-6 text-center">
          <div>
            <ImageIcon className="mx-auto h-5 w-5 text-accent-primary" />
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
              PublisherIQ watch desk
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingBrief() {
  return (
    <div className="grid min-h-[66vh] place-items-center px-5 py-16">
      <div className="text-center">
        <RefreshCw className="mx-auto h-5 w-5 animate-spin text-accent-primary" />
        <p className="mt-4 text-sm font-semibold text-text-primary">
          Preparing today’s edition
        </p>
        <p className="mt-1 text-xs text-text-tertiary">
          Reviewing profile matches and the evidence behind them.
        </p>
      </div>
    </div>
  );
}

export function EditorialDailyBrief({
  error,
  issue,
  loading,
  onRetry,
  presentReviewPriorityV2,
}: {
  error: string | null;
  issue: OpportunityDailyBriefIssue | null;
  loading: boolean;
  onRetry: () => void;
  presentReviewPriorityV2: boolean;
}) {
  if (loading && !issue) {
    return <LoadingBrief />;
  }
  if (!issue) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-5 py-16">
        <div className="max-w-md text-center">
          <BookOpen className="mx-auto h-7 w-7 text-accent-primary" />
          <h2 className="mt-5 text-xl font-semibold text-text-primary">
            Today’s edition could not be opened
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-tertiary">
            {error ?? "PublisherIQ could not load this Daily Brief."}
          </p>
          <button
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-primary-hover"
            onClick={onRetry}
            type="button"
          >
            <RefreshCw className="h-4 w-4" />
            Reload Daily Brief
          </button>
        </div>
      </div>
    );
  }

  const lead = issue.featuredGames[0] ?? null;
  const secondary = issue.featuredGames.slice(1, 4);
  const more = issue.featuredGames.slice(4);
  const activeDispatches = issue.profileDispatches.filter(
    (profile) => profile.status === "enabled",
  );

  return (
    <div className="bg-surface-raised">
      {issue.newerRunUpdating && (
        <div className="flex items-center justify-center gap-2 border-b border-semantic-warning/20 bg-semantic-warning-muted px-5 py-2.5 text-xs text-semantic-warning">
          <CircleDot className="h-3.5 w-3.5 animate-pulse" />A new edition is
          being prepared. This is the latest completed brief.
        </div>
      )}

      <div className="mx-auto max-w-[1440px] px-5 py-8 md:px-8 md:py-12">
        <header className="grid gap-8 border-b border-border-muted pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
              <span>PublisherIQ Daily Brief</span>
              <span className="h-px w-8 bg-border-muted" aria-hidden="true" />
              <span className="inline-flex items-center gap-1.5 text-text-muted">
                <CalendarDays className="h-3.5 w-3.5" />
                {issueDate(issue.issueDate)}
              </span>
            </div>
            <h2 className="mt-5 max-w-[18ch] text-[clamp(2.4rem,6vw,5.8rem)] font-medium leading-[0.92] tracking-[-0.055em] text-text-primary">
              {issue.headline}
            </h2>
            <p className="mt-6 max-w-[68ch] text-base leading-7 text-text-secondary md:text-lg md:leading-8">
              {issue.dek}
            </p>
          </div>
          <dl className="grid min-w-[290px] grid-cols-3 border-y border-border-muted lg:border-y-0 lg:border-l">
            {[
              ["Games", issue.availableResultCount],
              ["Profiles", activeDispatches.length],
              ["High confidence", issue.highConfidenceCount],
            ].map(([label, value]) => (
              <div className="px-4 py-4 lg:py-2" key={label}>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                  {label}
                </dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums text-text-primary">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </header>

        {!lead ? (
          <div className="grid min-h-[360px] place-items-center border-b border-border-muted py-16">
            <div className="max-w-lg text-center">
              <BookOpen className="mx-auto h-7 w-7 text-accent-primary" />
              <h3 className="mt-5 text-2xl font-semibold text-text-primary">
                {issue.status === "not_run"
                  ? "Enable a profile to publish your first issue"
                  : "The desk is quiet today"}
              </h3>
              <p className="mt-3 text-sm leading-6 text-text-tertiary">
                No new game crossed an enabled profile’s criteria in this
                coverage window. The watch desk will keep monitoring Steam.
              </p>
            </div>
          </div>
        ) : (
          <section className="grid border-b border-border-muted py-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)] lg:gap-10 lg:py-12">
            <Link
              className="group block min-w-0"
              href={gameUrl(lead)}
              prefetch={false}
            >
              <BriefImage game={lead} lead />
              <div className="mt-5 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-accent-primary">
                <span>Lead opportunity</span>
                <span className="text-text-muted">•</span>
                <span className="text-text-tertiary">
                  {presentReviewPriorityV2
                    ? opportunityPriorityLabel(lead)
                    : opportunityStrengthLabel(lead.score)}
                </span>
              </div>
              <h3 className="mt-3 max-w-[22ch] text-3xl font-semibold leading-[1.04] tracking-[-0.035em] text-text-primary md:text-4xl">
                {presentReviewPriorityV2 ? lead.name : lead.changeSummary}
              </h3>
              <p className="mt-4 max-w-[70ch] text-base leading-7 text-text-secondary">
                {presentReviewPriorityV2
                  ? opportunityResultDescription(lead)
                  : opportunityWhyItMatters(lead)}
              </p>
              {presentReviewPriorityV2 && lead.reviewPriority && (
                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-text-primary">
                  {opportunityVisibleReviewReasons(lead).map((reason) => (
                    <li
                      className="before:mr-1.5 before:text-accent-primary before:content-['•']"
                      key={reason}
                    >
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
                <span>{opportunityPotentialLabel(lead.marketPotential)}</span>
                <span>
                  {presentReviewPriorityV2 && lead.reviewPriority
                    ? {
                        directional: "Directional evidence",
                        high: "High confidence",
                        limited: "Limited evidence",
                      }[lead.reviewPriority.confidence.label]
                    : `${opportunityConfidenceLabel(lead.confidence)} evidence`}
                </span>
                {lead.matchedProfiles.length > 0 && (
                  <span>
                    Matches{" "}
                    {lead.matchedProfiles
                      .map((profile) => profile.name)
                      .join(", ")}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 font-semibold text-accent-primary">
                  Read full game profile
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>

            <div className="mt-10 divide-y divide-border-subtle border-y border-border-muted lg:mt-0 lg:border-t-0">
              {secondary.map((game, index) => (
                <Link
                  className="group grid gap-4 py-5 sm:grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[150px_minmax(0,1fr)]"
                  href={gameUrl(game)}
                  key={game.id}
                  prefetch={false}
                >
                  <BriefImage game={game} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-primary">
                      {String(index + 2).padStart(2, "0")} ·{" "}
                      {presentReviewPriorityV2
                        ? opportunityPriorityLabel(game)
                        : "On the desk"}
                    </p>
                    <h4 className="mt-2 text-lg font-semibold leading-5 text-text-primary">
                      {game.name}
                    </h4>
                    <p className="mt-2 line-clamp-3 text-sm leading-5 text-text-secondary">
                      {presentReviewPriorityV2
                        ? opportunityResultDescription(game)
                        : game.changeSummary}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-12 py-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)] lg:gap-16 lg:py-14">
          <section>
            <div className="flex items-end justify-between border-b border-border-muted pb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-primary">
                  Profile dispatches
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
                  {presentReviewPriorityV2
                    ? "What matched across your lists"
                    : "What moved across your lists"}
                </h3>
              </div>
              {issue.windowStart && issue.windowEnd && (
                <p className="hidden text-right text-xs leading-5 text-text-muted sm:block">
                  {formatOpportunityDate(issue.windowStart)}
                  <br />
                  through {formatOpportunityDate(issue.windowEnd)}
                </p>
              )}
            </div>
            <div className="divide-y divide-border-subtle">
              {issue.profileDispatches.map((profile) => (
                <article
                  className="grid gap-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto]"
                  key={profile.id}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-lg font-semibold text-text-primary">
                        {profile.name}
                      </h4>
                      <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
                        {profile.status === "enabled"
                          ? "Monitoring"
                          : profile.status}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[65ch] text-sm leading-6 text-text-secondary">
                      {presentReviewPriorityV2
                        ? opportunityProfileDispatchSummary(profile)
                        : profile.summary}
                    </p>
                    {profile.topResult && (
                      <Link
                        className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-accent-primary hover:text-accent-primary-hover"
                        href={`/opportunities/games/${profile.topResult.appid}?result=${profile.topResult.resultId}`}
                        prefetch={false}
                      >
                        Lead match: {profile.topResult.name}
                      </Link>
                    )}
                  </div>
                  <Link
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-center text-xs font-semibold text-text-secondary transition hover:text-accent-primary"
                    href={profile.listUrl}
                  >
                    View all matches
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </article>
              ))}
            </div>
          </section>

          <aside>
            {more.length > 0 && (
              <section>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-primary">
                  Also worth opening
                </p>
                <div className="mt-3 divide-y divide-border-subtle border-y border-border-muted">
                  {more.map((game, index) => (
                    <Link
                      className="group grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 py-4"
                      href={gameUrl(game)}
                      key={game.id}
                      prefetch={false}
                    >
                      <span className="text-xs tabular-nums text-text-muted">
                        {String(index + 5).padStart(2, "0")}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-text-primary">
                          {game.name}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs leading-5 text-text-tertiary">
                          {presentReviewPriorityV2
                            ? opportunityResultDescription(game)
                            : game.changeSummary}
                        </span>
                      </span>
                      <ArrowRight className="mt-0.5 h-4 w-4 text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent-primary" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <section className="mt-10 border-t border-border-muted pt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                Desk notes
              </p>
              <p className="mt-3 text-xs leading-5 text-text-tertiary">
                Editorial summaries are composed from observed Steam changes,
                profile criteria, market context, and evidence confidence. They
                do not predict commercial outcomes.
              </p>
              {issue.coverageWarnings.length > 0 && (
                <ul className="mt-4 space-y-2 text-xs leading-5 text-semantic-warning">
                  {issue.coverageWarnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
