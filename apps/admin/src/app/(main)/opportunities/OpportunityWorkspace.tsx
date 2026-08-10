"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CircleDot,
  Copy,
  Filter,
  FlaskConical,
  Image as ImageIcon,
  Info,
  Mail,
  Plus,
  RefreshCw,
  Rows3,
  Slack,
  Target,
  Users,
} from "lucide-react";

import { EditorialDailyBrief } from "./EditorialDailyBrief";
import { ProfileBuilder } from "./ProfileBuilder";
import {
  formatOpportunityDate,
  opportunityConfidenceExplanation,
  opportunityConfidenceLabel,
  opportunityPost,
  opportunityPotentialLabel,
  opportunityStrengthLabel,
  opportunityWhyItMatters,
} from "./lib/api";
import type {
  OpportunityBootstrap,
  OpportunityDailyBriefIssue,
  OpportunityProfileDetail,
  OpportunityResultLabel,
  OpportunityResultPage,
  OpportunityResultSummary,
} from "./lib/types";
import {
  parseOpportunityEventFilter,
  parseOpportunityWorkspaceTab,
  type OpportunityWorkspaceTab,
} from "./lib/workspace-query";
import { isOpportunityPriorityV2PresentationEnabled } from "./lib/feature-controls";
import {
  opportunityPriorityLabel,
  opportunityResultDescription,
  opportunityResultSections,
  opportunityVisibleReviewReasons,
} from "./lib/review-priority-presentation";

type ProfilesView = "catalog" | "loading" | "editor";

function presetMarketLabel(state: string | null): string {
  const labels: Record<string, string> = {
    active: "Steady",
    cooling: "Cooling",
    growing: "Growing",
    insufficient_data: "Developing",
    quiet: "Quiet",
    surging: "Surging",
  };
  return labels[state ?? ""] ?? "Developing";
}

function briefStatusLabel(
  status: OpportunityBootstrap["dailyOverview"]["status"],
): string {
  return {
    empty: "Complete",
    failed: "Needs attention",
    not_run: "Waiting for first brief",
    ready: "Ready",
    running: "Updating",
  }[status];
}

function profileStatusLabel(status: string): string {
  return (
    {
      archived: "Archived",
      draft: "Draft",
      enabled: "Active",
      paused: "Paused",
    }[status] ?? "Saved"
  );
}

function sourceStatusLabel(status: string): string {
  return (
    {
      blocked: "Unavailable",
      delayed: "Delayed",
      healthy: "Current",
    }[status] ?? "Checking"
  );
}

function marketHealthLabel(status: string): string {
  return (
    {
      active: "Steady",
      cooling: "Cooling",
      growing: "Growing",
      insufficient_data: "Still developing",
      quiet: "Quiet",
      surging: "Surging",
    }[status] ?? "Updated"
  );
}

export function OpportunityWorkspace() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<OpportunityBootstrap | null>(null);
  const [tab, setTab] = useState<OpportunityWorkspaceTab>(() =>
    parseOpportunityWorkspaceTab(searchParams.get("tab")),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<OpportunityDailyBriefIssue | null>(null);
  const [briefLoading, setBriefLoading] = useState(true);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [listResults, setListResults] = useState<OpportunityResultSummary[]>(
    [],
  );
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [listHasMore, setListHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [profilesView, setProfilesView] = useState<ProfilesView>("catalog");
  const [profileDetail, setProfileDetail] =
    useState<OpportunityProfileDetail | null>(null);
  const profileRequestId = useRef(0);
  const briefRequestId = useRef(0);
  const listRequestId = useRef(0);
  const workspaceContentRef = useRef<HTMLElement>(null);
  const requestedRunId = searchParams.get("run");
  const selectedProfileId = searchParams.get("profile");
  const selectedEvent = parseOpportunityEventFilter(searchParams.get("event"));
  const sharedAccess = brief?.access?.scope === "team" ? brief.access : null;

  const replaceQuery = (updates: Record<string, string | null>) => {
    const query = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        query.set(key, value);
      } else {
        query.delete(key);
      }
    });
    const suffix = query.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, {
      scroll: false,
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await opportunityPost<OpportunityBootstrap>("bootstrap"));
    } catch {
      setError(
        "PublisherIQ could not load your sourcing brief. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const loadBrief = async () => {
    const requestId = briefRequestId.current + 1;
    briefRequestId.current = requestId;
    setBriefLoading(true);
    setBriefError(null);
    try {
      const nextBrief = await opportunityPost<OpportunityDailyBriefIssue>(
        "daily-brief",
        {
          runId: requestedRunId,
        },
      );
      if (briefRequestId.current !== requestId) {
        return;
      }
      setBrief(nextBrief);
    } catch {
      if (briefRequestId.current !== requestId) {
        return;
      }
      setBriefError(
        requestedRunId
          ? "This Daily Brief is unavailable or no longer belongs to this workspace."
          : "PublisherIQ could not prepare today’s Daily Brief. Please try again.",
      );
      setBrief(null);
    } finally {
      if (briefRequestId.current === requestId) {
        setBriefLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadBrief();
  }, [requestedRunId]);

  useEffect(() => {
    setTab(parseOpportunityWorkspaceTab(searchParams.get("tab")));
  }, [searchParams]);

  useEffect(() => {
    if (!sharedAccess || tab === "daily-brief" || tab === "profile-lists") {
      return;
    }
    setTab("daily-brief");
    replaceQuery({ profile: null, tab: "daily-brief" });
  }, [sharedAccess, tab]);

  const loadResultPage = async (append: boolean) => {
    const runId = brief?.runId;
    if (!runId) {
      return;
    }
    const requestId = listRequestId.current + 1;
    listRequestId.current = requestId;
    setListLoading(true);
    setListError(null);
    try {
      const page = await opportunityPost<OpportunityResultPage>(
        "list-results",
        {
          cursor: append ? listCursor : null,
          eventLabel: selectedEvent,
          profileId: sharedAccess ? null : selectedProfileId,
          runId,
        },
      );
      if (listRequestId.current !== requestId) {
        return;
      }
      setListResults((current) =>
        append ? [...current, ...page.results] : page.results,
      );
      setListCursor(page.nextCursor);
      setListHasMore(page.hasMore);
    } catch {
      if (listRequestId.current !== requestId) {
        return;
      }
      setListError(
        "PublisherIQ could not load this profile list. Please try again.",
      );
      if (!append) {
        setListResults([]);
      }
    } finally {
      if (listRequestId.current === requestId) {
        setListLoading(false);
      }
    }
  };

  useEffect(() => {
    if (tab !== "profile-lists" || !brief?.runId) {
      return;
    }
    setListResults([]);
    setListCursor(null);
    setListHasMore(false);
    void loadResultPage(false);
  }, [tab, brief?.runId, selectedProfileId, selectedEvent]);

  const closeProfileEditor = () => {
    profileRequestId.current += 1;
    setProfileDetail(null);
    setProfilesView("catalog");
  };

  const revealProfilesContent = () => {
    requestAnimationFrame(() => {
      workspaceContentRef.current?.scrollIntoView({ block: "start" });
    });
  };

  const selectTab = (nextTab: OpportunityWorkspaceTab) => {
    if (nextTab !== "profiles") {
      closeProfileEditor();
    }
    setTab(nextTab);
    replaceQuery({ tab: nextTab });
  };

  const openProfile = async (profileId: string) => {
    const requestId = profileRequestId.current + 1;
    profileRequestId.current = requestId;
    selectTab("profiles");
    setProfileDetail(null);
    setProfilesView("loading");
    setError(null);
    revealProfilesContent();
    try {
      const detail = await opportunityPost<OpportunityProfileDetail>(
        "get-profile",
        { profileId },
      );
      if (profileRequestId.current !== requestId) {
        return;
      }
      setProfileDetail(detail);
      setProfilesView("editor");
    } catch {
      if (profileRequestId.current !== requestId) {
        return;
      }
      setProfilesView("catalog");
      setError("PublisherIQ could not open this profile. Please try again.");
    }
  };

  const startProfile = () => {
    profileRequestId.current += 1;
    selectTab("profiles");
    setProfileDetail(null);
    setProfilesView("editor");
    setError(null);
    revealProfilesContent();
  };

  const clonePreset = async (presetId: string, name: string) => {
    const requestId = profileRequestId.current + 1;
    let cloned = false;
    profileRequestId.current = requestId;
    selectTab("profiles");
    setProfileDetail(null);
    setProfilesView("loading");
    setError(null);
    revealProfilesContent();
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
      cloned = true;
      await load();
      const detail = await opportunityPost<OpportunityProfileDetail>(
        "get-profile",
        { profileId: version.profileId },
      );
      if (profileRequestId.current !== requestId) {
        return;
      }
      setProfileDetail(detail);
      setProfilesView("editor");
    } catch {
      if (profileRequestId.current !== requestId) {
        return;
      }
      setProfilesView("catalog");
      setError(
        cloned
          ? "The preset was cloned, but PublisherIQ could not open the new profile."
          : "PublisherIQ could not copy this preset. Please try again.",
      );
    }
  };

  const saved = async (profileId: string) => {
    const requestId = profileRequestId.current + 1;
    profileRequestId.current = requestId;
    await load();
    try {
      const detail = await opportunityPost<OpportunityProfileDetail>(
        "get-profile",
        { profileId },
      );
      if (profileRequestId.current !== requestId) {
        return;
      }
      setProfileDetail(detail);
      setProfilesView("editor");
    } catch {
      if (profileRequestId.current !== requestId) {
        return;
      }
      setError(
        "Your profile was saved, but PublisherIQ could not refresh the workshop.",
      );
    }
  };

  const profileStatusChanged = async (
    profileId: string,
    status: "enabled" | "paused" | "archived",
  ) => {
    const requestId = profileRequestId.current + 1;
    profileRequestId.current = requestId;
    await load();
    if (profileRequestId.current !== requestId) {
      return;
    }
    if (status === "archived") {
      closeProfileEditor();
      return;
    }
    try {
      const detail = await opportunityPost<OpportunityProfileDetail>(
        "get-profile",
        { profileId },
      );
      if (profileRequestId.current !== requestId) {
        return;
      }
      setProfileDetail(detail);
      setProfilesView("editor");
    } catch {
      if (profileRequestId.current !== requestId) {
        return;
      }
      setError(
        "The profile status changed, but PublisherIQ could not refresh the workshop.",
      );
    }
  };

  const resultCount =
    brief?.availableResultCount ?? data?.dailyOverview.matchedCount ?? 0;
  const activeProfiles =
    data?.profiles.filter((profile) => profile.status === "enabled").length ??
    0;
  const highConfidenceResults = brief?.highConfidenceCount ?? 0;

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
            Daily Intelligence Desk
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
  const presentReviewPriorityV2 = isOpportunityPriorityV2PresentationEnabled(
    data.workspace.id,
  );

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
                Daily Intelligence Desk
              </h1>
            </div>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border-muted bg-border-muted">
              <DispatchMetric label="Today" value={String(resultCount)} />
              <DispatchMetric
                label={sharedAccess ? "Shared by" : "Live profiles"}
                value={
                  sharedAccess
                    ? sharedAccess.sourceUserDisplay?.split(" ")[0] || "Team"
                    : String(activeProfiles)
                }
              />
              <DispatchMetric
                label="High confidence"
                value={String(highConfidenceResults)}
              />
            </div>
          </div>

          {sharedAccess && (
            <div className="mt-6 flex flex-col gap-3 border-l-2 border-accent-primary bg-accent-primary-muted/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  Shared by {sharedAccess.sourceUserDisplay ?? "a teammate"} · {sharedAccess.team?.name ?? "your team"}
                </p>
                <p className="mt-1 text-xs leading-5 text-text-tertiary">
                  This is the exact shared report. Your tracking, dismissal, and ignore choices remain personal.
                </p>
              </div>
              <Link
                href="/opportunities"
                prefetch={false}
                className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-accent-primary hover:text-accent-primary-hover"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                My tracker
              </Link>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between gap-4">
            <nav
              className="flex min-w-0 gap-1 overflow-x-auto"
              aria-label="Opportunity area"
            >
              {(
                [
                  ["daily-brief", "Daily Brief", BookOpen],
                  ["profile-lists", "Profile Lists", Rows3],
                  ["profiles", "Profiles & presets", Filter],
                  ["delivery", "Delivery", Bell],
                ] as const
              )
                .filter(([value]) =>
                  sharedAccess
                    ? value === "daily-brief" || value === "profile-lists"
                    : true,
                )
                .map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => selectTab(value)}
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
            {!sharedAccess && profilesView === "catalog" && (
              <button
                type="button"
                onClick={startProfile}
                className="hidden items-center gap-2 rounded-lg bg-accent-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-accent-primary-hover sm:inline-flex"
              >
                <Plus className="h-4 w-4" />
                New profile
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="border-b border-semantic-warning/20 bg-semantic-warning-muted px-5 py-2.5 text-center text-xs text-semantic-warning">
          {error}
        </div>
      )}

      <main ref={workspaceContentRef} className="mx-auto max-w-[1500px]">
        {tab === "daily-brief" && (
          <EditorialDailyBrief
            error={briefError}
            issue={brief}
            loading={briefLoading}
            onRetry={() => void loadBrief()}
            presentReviewPriorityV2={presentReviewPriorityV2}
          />
        )}
        {tab === "profile-lists" && (
          <ProfileLists
            data={data}
            error={listError}
            event={selectedEvent}
            hasMore={listHasMore}
            issue={brief}
            loading={listLoading}
            onEventChanged={(value) =>
              replaceQuery({ event: value, tab: "profile-lists" })
            }
            onLoadMore={() => void loadResultPage(true)}
            onProfileChanged={(value) =>
              replaceQuery({ profile: value, tab: "profile-lists" })
            }
            onRetry={() => void loadResultPage(false)}
            presentReviewPriorityV2={presentReviewPriorityV2}
            profileId={selectedProfileId}
            results={listResults}
            sharedAccess={sharedAccess}
          />
        )}
        {!sharedAccess && tab === "profiles" && profilesView === "catalog" && (
          <ProfilesDesk
            data={data}
            onClone={clonePreset}
            onNew={startProfile}
            onOpen={openProfile}
          />
        )}
        {!sharedAccess && tab === "profiles" && profilesView === "loading" && (
          <ProfileWorkshopLoading onBack={closeProfileEditor} />
        )}
        {!sharedAccess && tab === "profiles" && profilesView === "editor" && (
          <ProfileBuilder
            key={profileDetail?.currentVersionDetail.id ?? "new"}
            defaultLocalDeliveryTime={data.profiles[0]?.localDeliveryTime}
            defaultTimezone={data.profiles[0]?.timezone}
            initialProfile={profileDetail}
            onClose={closeProfileEditor}
            onSaved={saved}
            onStatusChanged={profileStatusChanged}
            presentReviewPriorityV2={presentReviewPriorityV2}
          />
        )}
        {!sharedAccess && tab === "delivery" && (
          <DeliveryDesk data={data} onChanged={load} />
        )}
      </main>
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

function ProfileWorkshopLoading({ onBack }: { onBack: () => void }) {
  return (
    <section
      className="min-h-[72vh] bg-surface-raised pt-16 md:pt-0"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="sticky top-16 z-10 flex items-center gap-4 border-b border-border-subtle bg-surface-raised/95 px-5 py-4 backdrop-blur md:top-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to Profiles & Presets"
          className="inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">
            Back to Profiles &amp; presets
          </span>
          <span className="sm:hidden">Back</span>
        </button>
        <div className="h-7 w-px bg-border-muted" aria-hidden="true" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
            Profile workshop
          </p>
          <p className="mt-1 text-sm font-semibold text-text-primary">
            Opening profile
          </p>
        </div>
      </div>
      <div className="grid min-h-[520px] place-items-center px-5 py-16">
        <div className="text-center">
          <RefreshCw className="mx-auto h-5 w-5 animate-spin text-accent-primary" />
          <p className="mt-4 text-sm font-medium text-text-primary">
            Preparing your profile
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            Loading its latest criteria and delivery settings.
          </p>
        </div>
      </div>
    </section>
  );
}

function ProfileLists({
  data,
  error,
  event,
  hasMore,
  issue,
  loading,
  onEventChanged,
  onLoadMore,
  onProfileChanged,
  onRetry,
  presentReviewPriorityV2,
  profileId,
  results,
  sharedAccess,
}: {
  data: OpportunityBootstrap;
  error: string | null;
  event: OpportunityResultLabel | null;
  hasMore: boolean;
  issue: OpportunityDailyBriefIssue | null;
  loading: boolean;
  onEventChanged: (value: string | null) => void;
  onLoadMore: () => void;
  onProfileChanged: (value: string | null) => void;
  onRetry: () => void;
  presentReviewPriorityV2: boolean;
  profileId: string | null;
  results: OpportunityResultSummary[];
  sharedAccess: NonNullable<OpportunityDailyBriefIssue["access"]> | null;
}) {
  const groups: OpportunityBootstrap["dailyOverview"]["groups"] = {
    materiallyChanged: results.filter(
      (result) => result.eventLabel === "materially_changed",
    ),
    newlyDiscovered: results.filter(
      (result) => result.eventLabel === "newly_discovered",
    ),
    newlyQualified: results.filter(
      (result) => result.eventLabel === "newly_qualified",
    ),
    newlyReleased: results.filter(
      (result) => result.eventLabel === "newly_released",
    ),
    trackedUpdates: results.filter(
      (result) => result.eventLabel === "tracked_update",
    ),
  };
  const resultSections = opportunityResultSections({
    groups,
    presentReviewPriorityV2,
    results,
  });
  const selectedProfile = data.profiles.find(
    (profile) => profile.id === profileId,
  );
  const hasResults = results.length > 0;
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_310px]">
      <div className="min-w-0 px-5 py-7 md:px-8 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-muted pb-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              Complete sourcing record
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
              {selectedProfile
                ? `${selectedProfile.name} matches`
                : "Profile Lists"}
            </h2>
            <p className="mt-2 text-sm text-text-tertiary">
              {issue?.windowStart && issue.windowEnd
                ? `Changes observed from ${formatOpportunityDate(issue.windowStart)} through ${formatOpportunityDate(issue.windowEnd)}`
                : "Review every game behind the latest Daily Brief."}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border-muted px-3 py-1.5 text-xs text-text-secondary">
            <CircleDot
              className={`h-3.5 w-3.5 ${
                issue?.status === "failed"
                  ? "text-semantic-error"
                  : issue?.status === "running"
                    ? "animate-pulse text-semantic-warning"
                    : "text-semantic-success"
              }`}
            />
            {briefStatusLabel(issue?.status ?? "not_run")}
          </div>
        </div>

        <div
          className={`grid gap-4 border-b border-border-subtle py-5 ${sharedAccess ? "" : "sm:grid-cols-2"}`}
        >
          {!sharedAccess && <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Profile
            </span>
            <select
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-muted bg-surface-raised px-3 text-sm text-text-primary outline-none focus:border-accent-primary"
              onChange={(change) =>
                onProfileChanged(change.target.value || null)
              }
              value={profileId ?? ""}
            >
              <option value="">All profiles</option>
              {data.profiles
                .filter((profile) => profile.status !== "archived")
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </select>
          </label>}
          <label>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              Event
            </span>
            <select
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-muted bg-surface-raised px-3 text-sm text-text-primary outline-none focus:border-accent-primary"
              onChange={(change) => onEventChanged(change.target.value || null)}
              value={event ?? ""}
            >
              <option value="">All events</option>
              <option value="newly_discovered">New discoveries</option>
              <option value="newly_released">Newly released</option>
              <option value="newly_qualified">Newly qualified</option>
              <option value="materially_changed">Material changes</option>
              <option value="tracked_update">Tracked updates</option>
            </select>
          </label>
        </div>

        {error && !hasResults ? (
          <div className="grid min-h-[360px] place-items-center">
            <div className="max-w-md text-center">
              <RefreshCw className="mx-auto h-6 w-6 text-semantic-warning" />
              <h3 className="mt-4 text-lg font-semibold text-text-primary">
                This list could not be loaded
              </h3>
              <p className="mt-2 text-sm leading-6 text-text-tertiary">
                {error}
              </p>
              <button
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-semibold text-white"
                onClick={onRetry}
                type="button"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Profile Lists
              </button>
            </div>
          </div>
        ) : loading && !hasResults ? (
          <div className="space-y-3 py-8" aria-live="polite" aria-busy="true">
            <p className="sr-only">Loading opportunities</p>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="grid min-h-36 animate-pulse grid-cols-[112px_1fr] gap-4 border-b border-border-subtle py-4"
              >
                <div className="rounded-md bg-surface-elevated" />
                <div className="space-y-3 py-1">
                  <div className="h-4 w-2/5 rounded bg-surface-elevated" />
                  <div className="h-3 w-full rounded bg-surface-elevated" />
                  <div className="h-3 w-4/5 rounded bg-surface-elevated" />
                </div>
              </div>
            ))}
          </div>
        ) : !hasResults ? (
          <div className="grid min-h-[420px] place-items-center">
            <div className="max-w-md text-center">
              <FlaskConical className="mx-auto h-7 w-7 text-accent-primary" />
              <h3 className="mt-5 text-xl font-semibold text-text-primary">
                {issue?.status === "not_run"
                  ? "Start with a maintained preset"
                  : "No games match these list filters"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-text-tertiary">
                {issue?.status === "not_run"
                  ? "Enable a sourcing profile to begin evaluating Steam games for review."
                  : "Try another profile or event type. Enabled profiles will keep watching Steam for meaningful changes."}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {resultSections.map((section) => (
              <ResultSection
                key={section.key}
                kicker={section.kicker}
                presentReviewPriorityV2={presentReviewPriorityV2}
                results={section.results}
                title={section.title}
              />
            ))}
            {hasMore && (
              <button
                className="flex min-h-11 w-full items-center justify-center gap-2 border-y border-border-muted py-3 text-sm font-semibold text-text-secondary transition hover:bg-surface-elevated/50 hover:text-accent-primary disabled:opacity-50"
                disabled={loading}
                onClick={onLoadMore}
                type="button"
              >
                {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
                {loading ? "Loading more matches" : "Load 25 more"}
              </button>
            )}
            {error && (
              <p className="text-center text-xs text-semantic-warning">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
      {sharedAccess ? (
        <SharedBriefRail access={sharedAccess} />
      ) : (
        <BriefRail data={data} />
      )}
    </div>
  );
}

function SharedBriefRail({
  access,
}: {
  access: NonNullable<OpportunityDailyBriefIssue["access"]>;
}) {
  return (
    <aside className="border-t border-border-subtle bg-surface-sunken px-5 py-7 lg:border-l lg:border-t-0 lg:px-6 lg:py-10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
        Team report
      </p>
      <h3 className="mt-3 text-lg font-semibold text-text-primary">
        {access.team?.name ?? "Your team"}
      </h3>
      <p className="mt-2 text-sm leading-6 text-text-secondary">
        Shared by {access.sourceUserDisplay ?? "a teammate"}. This view includes the report’s game analysis while keeping personal profile and delivery details private.
      </p>
      <Link
        href="/opportunities"
        prefetch={false}
        className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-accent-primary hover:text-accent-primary-hover"
      >
        <ArrowLeft className="h-4 w-4" />
        Return to my tracker
      </Link>
    </aside>
  );
}

function ResultSection({
  kicker,
  presentReviewPriorityV2,
  results,
  title,
}: {
  kicker: string;
  presentReviewPriorityV2: boolean;
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
        {results.map((result) =>
          presentReviewPriorityV2 ? (
            <OpportunityResultCard key={result.id} result={result} />
          ) : (
            <LegacyOpportunityResultCard key={result.id} result={result} />
          ),
        )}
      </div>
    </section>
  );
}

function LegacyOpportunityResultCard({
  result,
}: {
  result: OpportunityResultSummary;
}) {
  return (
    <Link
      href={`/opportunities/games/${result.appid}?result=${result.id}`}
      prefetch={false}
      className={`group my-px block rounded-lg px-2 py-4 transition sm:grid sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-3 xl:grid-cols-[132px_minmax(0,1fr)_150px_24px] xl:gap-5 ${
        result.triggeredByMediaAddition
          ? "bg-accent-primary-muted/35 ring-1 ring-inset ring-accent-primary/40 hover:bg-accent-primary-muted/50"
          : "hover:bg-surface-elevated/45"
      }`}
    >
      <OpportunityResultImage result={result} />
      <div className="min-w-0">
        <h4 className="min-w-0 truncate text-base font-semibold text-text-primary">
          {result.name}
        </h4>
        <p className="mt-2 max-w-3xl text-base font-medium leading-6 text-text-primary">
          {result.changeSummary}
        </p>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-text-secondary">
          {opportunityWhyItMatters(result)}
        </p>
        {result.matchedProfiles.length > 0 && (
          <p className="mt-3 text-xs text-text-tertiary">
            <span className="font-semibold text-text-secondary">
              Matches your sourcing profile:
            </span>{" "}
            {result.matchedProfiles.map((profile) => profile.name).join(", ")}
          </p>
        )}
      </div>
      <div className="clear-both flex flex-wrap gap-x-5 gap-y-2 pt-3 sm:col-start-2 sm:pt-0 xl:col-start-auto xl:block xl:space-y-3 xl:text-right">
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
        className="mt-1 hidden h-4 w-4 text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent-primary xl:block"
      />
    </Link>
  );
}

function OpportunityResultCard({
  result,
}: {
  result: OpportunityResultSummary;
}) {
  const visibleProfiles = result.matchedProfiles.slice(0, 2);
  const extraProfiles = Math.max(
    0,
    result.matchedProfiles.length - visibleProfiles.length,
  );
  return (
    <article
      className={`group relative my-px rounded-lg px-2 py-4 transition sm:grid sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-3 xl:grid-cols-[132px_minmax(0,1fr)_190px_24px] xl:gap-5 ${
        result.triggeredByMediaAddition
          ? "bg-accent-primary-muted/35 ring-1 ring-inset ring-accent-primary/40 hover:bg-accent-primary-muted/50"
          : "hover:bg-surface-elevated/45"
      }`}
    >
      <Link
        aria-label={`Open opportunity record for ${result.name}`}
        href={`/opportunities/games/${result.appid}?result=${result.id}`}
        prefetch={false}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
      />
      <div className="pointer-events-none relative z-[1]">
        <OpportunityResultImage result={result} />
      </div>
      <div className="pointer-events-none relative z-[1] min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-base font-semibold text-text-primary">
            {result.name}
          </h4>
          {result.triggeredByMediaAddition && (
            <span className="shrink-0 rounded-full border border-accent-primary/30 bg-accent-primary-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-accent-primary">
              New media
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-text-secondary">
          {opportunityResultDescription(result)}
        </p>
        {result.reviewPriority ? (
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-text-primary">
            {opportunityVisibleReviewReasons(result).map((reason) => (
              <li
                key={reason}
                className="before:mr-1.5 before:text-accent-primary before:content-['•']"
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-semantic-warning">
            Legacy result — review priority will appear after the next natural
            evaluation.
          </p>
        )}
        {result.matchedProfiles.length > 0 && (
          <p className="mt-3 text-xs text-text-tertiary">
            <span className="font-semibold text-text-secondary">Matches:</span>{" "}
            {visibleProfiles.map((profile) => profile.name).join(", ")}
            {extraProfiles > 0 ? ` +${extraProfiles} profiles` : ""}
          </p>
        )}
      </div>
      <div className="relative z-[2] clear-both flex flex-wrap gap-x-5 gap-y-2 pt-3 sm:col-start-2 sm:pt-0 xl:col-start-auto xl:block xl:space-y-3 xl:text-right">
        <div className="pointer-events-none">
          <p className="text-sm font-semibold text-text-primary">
            {opportunityPriorityLabel(result)}
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            {opportunityPotentialLabel(result.marketPotential)}
          </p>
        </div>
        <OpportunityConfidenceDisclosure result={result} />
      </div>
      <ArrowRight
        aria-hidden="true"
        className="pointer-events-none relative z-[1] mt-1 hidden h-4 w-4 text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent-primary xl:block"
      />
    </article>
  );
}

function OpportunityConfidenceDisclosure({
  result,
}: {
  result: OpportunityResultSummary;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const confidence = result.reviewPriority?.confidence;
  const popoverId = `opportunity-confidence-${result.id}`;

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className="pointer-events-auto relative xl:ml-auto">
      <button
        ref={buttonRef}
        type="button"
        aria-controls={popoverId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-muted bg-surface-raised px-2.5 py-1 text-xs font-semibold text-text-secondary outline-none hover:border-border-prominent focus-visible:ring-2 focus-visible:ring-accent-primary"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        {confidence
          ? confidence.label === "high"
            ? "High confidence"
            : confidence.label === "limited"
              ? "Limited evidence"
              : "Directional evidence"
          : opportunityConfidenceLabel(result.confidence)}
      </button>
      {open && (
        <div
          id={popoverId}
          role="status"
          className="absolute right-0 top-10 z-20 w-72 rounded-lg border border-border-muted bg-surface-raised p-3 text-left text-xs leading-5 text-text-secondary shadow-lg"
        >
          {confidence
            ? confidence.label === "high"
              ? "The applicable profile, market, and game evidence is complete and current."
              : confidence.label === "limited"
                ? "One or more applicable inputs are unavailable, stale, or conflicting."
                : "This evidence is directional; post-release traction may not be expected yet."
            : opportunityConfidenceExplanation(result.confidence)}
          {confidence && (
            <p className="mt-2 text-text-muted">
              {confidence.presentCount}/{confidence.applicableCount} applicable
              inputs present
              {confidence.staleCount ? ` · ${confidence.staleCount} stale` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function OpportunityResultImage({
  result,
}: {
  result: OpportunityResultSummary;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative float-left mr-4 aspect-[460/215] w-24 self-start overflow-hidden rounded-md border border-border-subtle bg-surface-elevated sm:float-none sm:mr-0 sm:w-full">
      {result.headerImageUrl && !failed ? (
        <img
          alt={`${result.name} Steam header art`}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
          src={result.headerImageUrl}
        />
      ) : (
        <span className="grid h-full place-items-center text-text-muted">
          <ImageIcon className="h-4 w-4" />
          <span className="sr-only">Steam art unavailable</span>
        </span>
      )}
      <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow-sm">
        {result.rank ? String(result.rank).padStart(2, "0") : "—"}
      </span>
    </div>
  );
}

function BriefRail({ data }: { data: OpportunityBootstrap }) {
  const canSeeCoverage =
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
      {canSeeCoverage && (
        <details className="mt-8 border-t border-border-muted pt-7">
          <summary className="cursor-pointer text-xs font-semibold text-text-tertiary transition hover:text-text-primary">
            Coverage status
          </summary>
          <div className="mt-4 space-y-3">
            {data.sourceHealth.map((source) => (
              <div
                key={source.source}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate text-xs text-text-secondary">
                  {source.label}
                </span>
                <span className="text-[10px] uppercase text-text-muted">
                  {sourceStatusLabel(source.state)}
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
                          ? `${marketHealthLabel(change.priorState)} → ${marketHealthLabel(change.state)}`
                          : marketHealthLabel(change.state)}
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
  onClone,
  onNew,
  onOpen,
}: {
  data: OpportunityBootstrap;
  onClone: (presetId: string, name: string) => Promise<void>;
  onNew: () => void;
  onOpen: (profileId: string) => Promise<void>;
}) {
  return (
    <div className="px-5 py-8 md:px-8 md:py-10">
      <div className="flex flex-col gap-5 border-b border-border-muted pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
            Profiles &amp; presets
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
            Shape what reaches your brief
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-tertiary">
            Refine a personal sourcing profile or start from a maintained
            PublisherIQ strategy.
          </p>
        </div>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-accent-primary px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-primary-hover"
        >
          <Plus className="h-4 w-4" />
          Build from scratch
        </button>
      </div>

      <div className="mt-10 space-y-12">
        <section aria-labelledby="personal-profiles-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3
                id="personal-profiles-heading"
                className="text-lg font-semibold text-text-primary"
              >
                Your profiles
              </h3>
              <p className="mt-1 text-xs leading-5 text-text-tertiary">
                Personal criteria, delivery timing, and current status.
              </p>
            </div>
            <span className="text-xs tabular-nums text-text-muted">
              {data.profiles.length} saved
            </span>
          </div>
          <div className="mt-4 divide-y divide-border-subtle border-y border-border-muted">
            {data.profiles.length === 0 ? (
              <div className="py-10">
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
                  className="group grid w-full gap-4 px-1 py-4 text-left transition hover:bg-surface-elevated/50 sm:px-3 md:grid-cols-[minmax(0,1.35fr)_minmax(150px,0.55fr)_minmax(210px,0.75fr)_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          profile.status === "enabled"
                            ? "bg-semantic-success-muted text-semantic-success-text"
                            : "bg-surface-sunken text-text-tertiary"
                        }`}
                      >
                        {profileStatusLabel(profile.status)}
                      </span>
                      <h3 className="text-base font-semibold text-text-primary">
                        {profile.name}
                      </h3>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-text-tertiary">
                      {profile.description || "No research note"}
                    </p>
                  </div>
                  <CatalogFact
                    label="Origin"
                    value={
                      profile.sourcePresetName
                        ? `Based on ${profile.sourcePresetName}`
                        : "Custom profile"
                    }
                  />
                  <CatalogFact
                    label="Delivery"
                    value={`Daily at ${profile.localDeliveryTime}`}
                    detail={
                      profile.nextEvaluationAt
                        ? `Next ${formatOpportunityDate(profile.nextEvaluationAt)} · ${profile.timezone}`
                        : `Not scheduled · ${profile.timezone}`
                    }
                  />
                  <ArrowRight
                    className="h-4 w-4 justify-self-end text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent-primary"
                    aria-hidden="true"
                  />
                </button>
              ))
            )}
          </div>
        </section>

        <section aria-labelledby="preset-library-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3
                id="preset-library-heading"
                className="text-lg font-semibold text-text-primary"
              >
                Preset library
              </h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-text-tertiary">
                PublisherIQ-maintained starting points. Cloning creates a draft
                and leaves alerts off.
              </p>
            </div>
            <span className="text-xs tabular-nums text-text-muted">
              {data.presets.length} maintained
            </span>
          </div>
          <div className="mt-4 divide-y divide-border-subtle border-y border-border-muted">
            {data.presets.map((preset) => (
              <article
                key={preset.id}
                className="group grid gap-4 px-1 py-4 transition hover:bg-surface-elevated/50 sm:px-3 md:grid-cols-[minmax(0,1.35fr)_minmax(150px,0.55fr)_minmax(210px,0.75fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          preset.healthState === "surging"
                            ? "bg-accent-primary"
                            : preset.healthState === "growing"
                              ? "bg-semantic-success"
                              : "bg-border-prominent"
                        }`}
                        aria-hidden="true"
                      />
                      {preset.healthUnavailableReason === "unreleased_only"
                        ? "Health pending"
                        : presetMarketLabel(preset.healthState)}
                    </span>
                    <h3 className="text-base font-semibold text-text-primary">
                      {preset.name}
                    </h3>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-text-tertiary">
                    {preset.description}
                  </p>
                </div>
                <CatalogFact
                  label="Source"
                  value="PublisherIQ maintained"
                  detail={`Version ${preset.version}`}
                />
                <CatalogFact
                  label="Criteria"
                  value={preset.ruleSummary[0] ?? "No summary available"}
                  detail={
                    preset.ruleSummary.length > 1
                      ? `+${preset.ruleSummary.length - 1} more`
                      : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => onClone(preset.id, preset.name)}
                  className="inline-flex items-center justify-center gap-2 justify-self-start rounded-md border border-border-muted px-3 py-2 text-sm font-semibold text-accent-primary transition hover:border-accent-primary/35 hover:bg-accent-primary-muted md:justify-self-end"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Clone
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CatalogFact({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </p>
      <p className="mt-1 line-clamp-1 text-xs font-medium leading-5 text-text-secondary">
        {value}
      </p>
      {detail && (
        <p className="line-clamp-1 text-[11px] leading-4 text-text-muted">
          {detail}
        </p>
      )}
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
    } catch {
      setMessage("PublisherIQ could not update delivery. Please try again.");
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
                Only games newly identified on Steam.
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
