"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { humanizeOpportunity, opportunityPost } from "./lib/api";
import type {
  OpportunityPreview,
  OpportunityProfileDetail,
  OpportunityRuleClause,
  OpportunityRuleField,
  OpportunityRuleGroup,
  OpportunityRuleOperator,
  OpportunityRuleSet,
  OpportunitySignalFamily,
} from "./lib/types";

const FIELD_OPTIONS: Array<{
  field: OpportunityRuleField;
  group: string;
  label: string;
  valueType: "boolean" | "number" | "string";
}> = [
  {
    field: "tags",
    group: "Positioning",
    label: "Steam tags",
    valueType: "string",
  },
  {
    field: "genres",
    group: "Positioning",
    label: "Genres",
    valueType: "string",
  },
  {
    field: "categories",
    group: "Positioning",
    label: "Features / categories",
    valueType: "string",
  },
  {
    field: "release_state",
    group: "Release",
    label: "Release state",
    valueType: "string",
  },
  {
    field: "is_released",
    group: "Release",
    label: "Is released",
    valueType: "boolean",
  },
  {
    field: "days_until_release",
    group: "Release",
    label: "Days until release",
    valueType: "number",
  },
  {
    field: "has_demo",
    group: "Product",
    label: "Has playable demo",
    valueType: "boolean",
  },
  {
    field: "platforms",
    group: "Product",
    label: "Platforms",
    valueType: "string",
  },
  {
    field: "controller_support",
    group: "Product",
    label: "Controller support",
    valueType: "string",
  },
  {
    field: "steam_deck",
    group: "Product",
    label: "Steam Deck status",
    valueType: "string",
  },
  {
    field: "languages",
    group: "Product",
    label: "Languages",
    valueType: "string",
  },
  {
    field: "price_cents",
    group: "Commercial",
    label: "Price (cents)",
    valueType: "number",
  },
  {
    field: "discount_percent",
    group: "Commercial",
    label: "Discount percent",
    valueType: "number",
  },
  {
    field: "is_free",
    group: "Commercial",
    label: "Free to play",
    valueType: "boolean",
  },
  {
    field: "self_published",
    group: "Company",
    label: "Self-published signal",
    valueType: "boolean",
  },
  {
    field: "no_publisher_listed",
    group: "Company",
    label: "No publisher listed",
    valueType: "boolean",
  },
  {
    field: "publisher_game_count",
    group: "Company",
    label: "Publisher game count",
    valueType: "number",
  },
  {
    field: "developer_game_count",
    group: "Company",
    label: "Developer game count",
    valueType: "number",
  },
  {
    field: "total_reviews",
    group: "Traction",
    label: "Total reviews",
    valueType: "number",
  },
  {
    field: "positive_percentage",
    group: "Traction",
    label: "Positive reviews (%)",
    valueType: "number",
  },
  {
    field: "reviews_added_7d",
    group: "Traction",
    label: "Reviews added (7d)",
    valueType: "number",
  },
  {
    field: "reviews_added_30d",
    group: "Traction",
    label: "Reviews added (30d)",
    valueType: "number",
  },
  {
    field: "ccu_peak",
    group: "Traction",
    label: "CCU peak",
    valueType: "number",
  },
  {
    field: "ccu_change_7d",
    group: "Traction",
    label: "CCU change (7d)",
    valueType: "number",
  },
  {
    field: "content_descriptors",
    group: "Policy",
    label: "Content descriptors",
    valueType: "string",
  },
];

const OPERATORS: OpportunityRuleOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "in",
  "not_in",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "between",
  "exists",
  "not_exists",
];

const SIGNALS: Array<{ label: string; value: OpportunitySignalFamily }> = [
  { label: "Release", value: "release" },
  { label: "Positioning", value: "taxonomy" },
  { label: "Pricing", value: "pricing" },
  { label: "Platforms", value: "platform" },
  { label: "Store page", value: "store-page" },
  { label: "Media", value: "media" },
  { label: "Builds", value: "build" },
  { label: "Announcements", value: "announcement" },
  { label: "Reviews", value: "reviews" },
  { label: "Player activity", value: "ccu" },
];

const EMPTY_RULES: OpportunityRuleSet = {
  excluded: [],
  preferred: [],
  required: [
    {
      clauses: [
        {
          field: "tags",
          id: "starter-tag",
          operator: "contains",
          value: "",
        },
      ],
      id: "starter-positioning",
      label: "Core positioning",
      operator: "all",
    },
  ],
  schemaVersion: "opportunity-rules/v1",
};

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function fieldMeta(field: OpportunityRuleField) {
  return (
    FIELD_OPTIONS.find((option) => option.field === field) ?? FIELD_OPTIONS[0]!
  );
}

function parseValue(
  raw: string,
  field: OpportunityRuleField,
  operator: OpportunityRuleOperator,
): OpportunityRuleClause["value"] {
  if (operator === "exists" || operator === "not_exists") {
    return undefined;
  }
  const valueType = fieldMeta(field).valueType;
  if (valueType === "boolean") {
    return raw === "true";
  }
  if (operator === "between") {
    return raw
      .split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite)
      .slice(0, 2);
  }
  if (operator === "in" || operator === "not_in") {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  if (valueType === "number") {
    const number = Number(raw);
    return Number.isFinite(number) ? number : 0;
  }
  return raw;
}

function displayValue(value: OpportunityRuleClause["value"]): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

interface ProfileBuilderProps {
  defaultLocalDeliveryTime?: string;
  defaultTimezone?: string;
  initialProfile?: OpportunityProfileDetail | null;
  onClose: () => void;
  onSaved: (profileId: string) => Promise<void>;
  onStatusChanged: (
    profileId: string,
    status: "enabled" | "paused" | "archived",
  ) => Promise<void>;
}

export function ProfileBuilder({
  defaultLocalDeliveryTime,
  defaultTimezone,
  initialProfile,
  onClose,
  onSaved,
  onStatusChanged,
}: ProfileBuilderProps) {
  const [name, setName] = useState(
    initialProfile?.name ?? "Untitled opportunity profile",
  );
  const [description, setDescription] = useState(
    initialProfile?.description ?? "",
  );
  const [rules, setRules] = useState<OpportunityRuleSet>(
    initialProfile?.currentVersionDetail.rules ?? EMPTY_RULES,
  );
  const [subscriptions, setSubscriptions] = useState<OpportunitySignalFamily[]>(
    initialProfile?.currentVersionDetail.eventSubscriptions ?? [
      "release",
      "taxonomy",
      "store-page",
      "reviews",
      "ccu",
    ],
  );
  const [immediate, setImmediate] = useState(
    initialProfile?.immediateFullMatchEnabled ?? false,
  );
  const [localDeliveryTime, setLocalDeliveryTime] = useState(
    initialProfile?.localDeliveryTime ?? defaultLocalDeliveryTime ?? "09:00",
  );
  const [preview, setPreview] = useState<OpportunityPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezone = useMemo(
    () =>
      initialProfile?.timezone ??
      defaultTimezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    [defaultTimezone, initialProfile?.timezone],
  );

  const updateSection = (
    section: "required" | "preferred" | "excluded",
    groups: OpportunityRuleGroup[],
  ) => setRules((current) => ({ ...current, [section]: groups }));

  const addGroup = (section: "required" | "preferred" | "excluded") => {
    const group: OpportunityRuleGroup = {
      clauses: [
        {
          field: "tags",
          id: id("rule"),
          operator: "contains",
          value: "",
        },
      ],
      id: id("group"),
      importance: section === "preferred" ? "medium" : undefined,
      label:
        section === "required"
          ? "Required condition"
          : section === "preferred"
            ? "Preference"
            : "Exclusion",
      operator: "all",
    };
    updateSection(section, [...rules[section], group]);
  };

  const runPreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      setPreview(
        await opportunityPost<OpportunityPreview>("preview-profile", {
          profileId: initialProfile?.id,
          rules,
        }),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Preview failed.",
      );
    } finally {
      setPreviewing(false);
    }
  };

  const save = async (enable: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        description,
        eventSubscriptions: subscriptions,
        immediateFullMatchEnabled: immediate,
        localDeliveryTime,
        name,
        rules,
        timezone,
      };
      const version = initialProfile
        ? await opportunityPost<{ profileId: string }>("save-profile", {
            ...payload,
            profileId: initialProfile.id,
          })
        : await opportunityPost<{ profileId: string }>("create-profile", {
            ...payload,
            enabled: enable,
          });
      if (initialProfile && enable && initialProfile.status !== "enabled") {
        await opportunityPost("set-profile-status", {
          profileId: initialProfile.id,
          status: "enabled",
        });
      }
      await onSaved(version.profileId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: "enabled" | "paused" | "archived") => {
    if (!initialProfile) {
      return;
    }
    if (
      status === "archived" &&
      !window.confirm(
        "Archive this profile? Its versions and historical results will be preserved.",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await opportunityPost("set-profile-status", {
        profileId: initialProfile.id,
        status,
      });
      await onStatusChanged(initialProfile.id, status);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Profile status update failed.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="min-h-[72vh] border-t border-border-subtle bg-surface-raised lg:border-l lg:border-t-0">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-surface-raised/95 px-5 py-4 backdrop-blur">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-primary">
            Profile workshop
          </p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">
            {initialProfile
              ? `Version ${initialProfile.currentVersion}`
              : "New profile"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-2 text-text-tertiary transition-colors hover:bg-surface-elevated hover:text-text-primary"
          aria-label="Close profile builder"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8 px-5 py-6 lg:px-7">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Profile name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-border-muted bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                Research intent
              </span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What should this profile uncover?"
                className="w-full rounded-lg border border-border-muted bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15"
              />
            </label>
          </div>

          {(
            [
              [
                "required",
                "Required",
                "Every group must pass. Unknown source values wait for readiness.",
              ],
              [
                "preferred",
                "Preferred",
                "These rank a match higher but never make it eligible alone.",
              ],
              [
                "excluded",
                "Excluded",
                "A positive match suppresses the game; unknown never excludes.",
              ],
            ] as const
          ).map(([section, title, detail]) => (
            <RuleSection
              key={section}
              detail={detail}
              groups={rules[section]}
              onChange={(groups) => updateSection(section, groups)}
              onAdd={() => addGroup(section)}
              section={section}
              title={title}
            />
          ))}

          <div className="border-t border-border-subtle pt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Reappearance signals
                </h3>
                <p className="mt-1 max-w-xl text-xs leading-5 text-text-tertiary">
                  Existing matches return only after a selected material event.
                  Rule-input changes still re-evaluate eligibility in the
                  background.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {SIGNALS.map((signal) => {
                const selected = subscriptions.includes(signal.value);
                return (
                  <button
                    key={signal.value}
                    type="button"
                    onClick={() =>
                      setSubscriptions((current) =>
                        selected
                          ? current.filter((value) => value !== signal.value)
                          : [...current, signal.value],
                      )
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      selected
                        ? "border-accent-primary/35 bg-accent-primary-muted text-accent-primary"
                        : "border-border-muted text-text-secondary hover:border-border-prominent"
                    }`}
                  >
                    {selected && <Check className="h-3 w-3" />}
                    {signal.label}
                  </button>
                );
              })}
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 border-t border-border-subtle pt-5">
              <input
                type="checkbox"
                checked={immediate}
                onChange={(event) => setImmediate(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-prominent accent-[var(--accent-primary)]"
              />
              <span>
                <span className="block text-sm font-medium text-text-primary">
                  Immediate new full-match alerts
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-text-tertiary">
                  Rare by design: first observation only, after every required
                  rule is known and passes.
                </span>
              </span>
            </label>
            <div className="mt-5 grid gap-3 border-t border-border-subtle pt-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-end">
              <label className="space-y-2">
                <span className="block text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  Personal daily brief time
                </span>
                <input
                  type="time"
                  value={localDeliveryTime}
                  onChange={(event) => setLocalDeliveryTime(event.target.value)}
                  className="w-full rounded-lg border border-border-muted bg-surface px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15"
                />
              </label>
              <p className="pb-2.5 text-xs leading-5 text-text-tertiary">
                Shared by all your enabled profiles in {timezone}. The first run
                starts immediately when you enable a profile.
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-semantic-error-muted px-3 py-2.5 text-sm text-semantic-error-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-5">
            <button
              type="button"
              onClick={runPreview}
              disabled={previewing}
              className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary transition hover:border-border-prominent disabled:opacity-50"
            >
              <Eye className="h-4 w-4" />
              {previewing ? "Evaluating catalog…" : "Preview profile"}
            </button>
            <button
              type="button"
              onClick={() => save(false)}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-text-secondary transition hover:bg-surface-elevated disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save draft
            </button>
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-primary-hover disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {saving ? "Saving…" : "Save & enable"}
            </button>
            {initialProfile?.status === "enabled" && (
              <button
                type="button"
                onClick={() => changeStatus("paused")}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg border border-border-muted px-4 py-2.5 text-sm font-semibold text-text-secondary transition hover:border-border-prominent disabled:opacity-50"
              >
                Pause profile
              </button>
            )}
            {initialProfile && initialProfile.status !== "archived" && (
              <button
                type="button"
                onClick={() => changeStatus("archived")}
                disabled={saving}
                className="ml-auto inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-semantic-error-text transition hover:bg-semantic-error-muted disabled:opacity-50"
              >
                Archive
              </button>
            )}
          </div>
        </div>

        <aside className="border-t border-border-subtle bg-surface-sunken px-5 py-6 xl:border-l xl:border-t-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            Live preview
          </p>
          {!preview ? (
            <div className="mt-8 border-l-2 border-border-prominent pl-4">
              <p className="text-sm font-medium text-text-primary">
                Test before enabling
              </p>
              <p className="mt-2 text-xs leading-5 text-text-tertiary">
                Preview uses the same tri-state rule engine as the daily worker
                and reports source coverage instead of treating missing evidence
                as false.
              </p>
            </div>
          ) : (
            <div className="mt-5 space-y-6">
              <div>
                <p className="font-mono text-4xl font-medium tracking-tight text-text-primary">
                  {preview.totalMatches.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">
                  current full matches across{" "}
                  {preview.evaluatedCatalogSize.toLocaleString()} games
                </p>
              </div>
              {preview.eliminationFunnel.length > 0 && (
                <div className="space-y-3">
                  {preview.eliminationFunnel.map((stage) => (
                    <div key={stage.groupId}>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate text-text-secondary">
                          {stage.label}
                        </span>
                        <span className="font-mono text-text-primary">
                          {stage.remaining.toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border-muted">
                        <div
                          className="h-full rounded-full bg-accent-primary"
                          style={{
                            width: `${Math.max(
                              2,
                              (100 * stage.remaining) /
                                Math.max(1, preview.evaluatedCatalogSize),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {preview.warnings.map((warning) => (
                <p
                  key={warning}
                  className="rounded-lg bg-semantic-warning-muted px-3 py-2.5 text-xs leading-5 text-semantic-warning"
                >
                  {warning}
                </p>
              ))}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  Representative matches
                </h4>
                <div className="mt-3 divide-y divide-border-subtle">
                  {preview.representativeMatches.slice(0, 6).map((match) => (
                    <div key={match.appid} className="py-3">
                      <p className="text-sm font-medium text-text-primary">
                        {match.name}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-text-tertiary">
                        {match.tags.slice(0, 4).join(" · ") ||
                          match.releaseState ||
                          "Steam app"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function RuleSection({
  detail,
  groups,
  onAdd,
  onChange,
  section,
  title,
}: {
  detail: string;
  groups: OpportunityRuleGroup[];
  onAdd: () => void;
  onChange: (groups: OpportunityRuleGroup[]) => void;
  section: "required" | "preferred" | "excluded";
  title: string;
}) {
  const update = (index: number, group: OpportunityRuleGroup) =>
    onChange(
      groups.map((current, groupIndex) =>
        groupIndex === index ? group : current,
      ),
    );

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">{detail}</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-accent-primary transition hover:bg-accent-primary-muted"
        >
          <Plus className="h-3.5 w-3.5" />
          Add group
        </button>
      </div>
      {groups.length === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 w-full border border-dashed border-border-prominent px-4 py-7 text-sm text-text-tertiary transition hover:border-accent-primary/50 hover:text-text-secondary"
        >
          No {section} groups. Add one if this profile needs it.
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          {groups.map((group, groupIndex) => (
            <div
              key={group.id}
              className="rounded-xl border border-border-muted bg-surface px-4 py-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={group.label}
                  onChange={(event) =>
                    update(groupIndex, { ...group, label: event.target.value })
                  }
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-text-primary outline-none"
                  aria-label={`${title} group name`}
                />
                {section === "preferred" && (
                  <select
                    value={group.importance ?? "medium"}
                    onChange={(event) =>
                      update(groupIndex, {
                        ...group,
                        importance: event.target.value as
                          | "low"
                          | "medium"
                          | "high",
                      })
                    }
                    className="rounded-md border border-border-muted bg-surface-raised px-2 py-1 text-xs text-text-secondary"
                  >
                    <option value="low">Low weight</option>
                    <option value="medium">Medium weight</option>
                    <option value="high">High weight</option>
                  </select>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onChange(groups.filter((_, index) => index !== groupIndex))
                  }
                  className="rounded-md p-1.5 text-text-muted transition hover:bg-semantic-error-muted hover:text-semantic-error"
                  aria-label={`Remove ${group.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="my-3 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  Match
                </span>
                <div className="inline-flex rounded-md bg-surface-elevated p-0.5">
                  {(["all", "any"] as const).map((operator) => (
                    <button
                      key={operator}
                      type="button"
                      onClick={() => update(groupIndex, { ...group, operator })}
                      className={`rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition ${
                        group.operator === operator
                          ? "bg-surface-raised text-text-primary shadow-xs"
                          : "text-text-muted"
                      }`}
                    >
                      {operator}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-text-muted">
                  of these rules
                </span>
              </div>
              <div className="space-y-2">
                {group.clauses.map((clause, clauseIndex) => (
                  <ClauseEditor
                    key={clause.id}
                    clause={clause}
                    canRemove={group.clauses.length > 1}
                    onChange={(nextClause) =>
                      update(groupIndex, {
                        ...group,
                        clauses: group.clauses.map((current, index) =>
                          index === clauseIndex ? nextClause : current,
                        ),
                      })
                    }
                    onRemove={() =>
                      update(groupIndex, {
                        ...group,
                        clauses: group.clauses.filter(
                          (_, index) => index !== clauseIndex,
                        ),
                      })
                    }
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  update(groupIndex, {
                    ...group,
                    clauses: [
                      ...group.clauses,
                      {
                        field: "tags",
                        id: id("rule"),
                        operator: "contains",
                        value: "",
                      },
                    ],
                  })
                }
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-text-tertiary transition hover:text-accent-primary"
              >
                <Plus className="h-3 w-3" />
                Add rule
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ClauseEditor({
  canRemove,
  clause,
  onChange,
  onRemove,
}: {
  canRemove: boolean;
  clause: OpportunityRuleClause;
  onChange: (clause: OpportunityRuleClause) => void;
  onRemove: () => void;
}) {
  const meta = fieldMeta(clause.field);
  const hasValue =
    clause.operator !== "exists" && clause.operator !== "not_exists";

  return (
    <div className="grid gap-2 rounded-lg bg-surface-raised p-2 md:grid-cols-[minmax(145px,1.2fr)_minmax(145px,1fr)_minmax(120px,1fr)_32px]">
      <label className="relative">
        <span className="sr-only">Field</span>
        <select
          value={clause.field}
          onChange={(event) => {
            const field = event.target.value as OpportunityRuleField;
            const nextMeta = fieldMeta(field);
            onChange({
              ...clause,
              field,
              value: nextMeta.valueType === "boolean" ? true : "",
            });
          }}
          className="h-9 w-full appearance-none rounded-md border border-border-subtle bg-surface px-2.5 pr-7 text-xs text-text-primary"
        >
          {Array.from(new Set(FIELD_OPTIONS.map((option) => option.group))).map(
            (group) => (
              <optgroup key={group} label={group}>
                {FIELD_OPTIONS.filter((option) => option.group === group).map(
                  (option) => (
                    <option key={option.field} value={option.field}>
                      {option.label}
                    </option>
                  ),
                )}
              </optgroup>
            ),
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-text-muted" />
      </label>
      <select
        value={clause.operator}
        onChange={(event) =>
          onChange({
            ...clause,
            operator: event.target.value as OpportunityRuleOperator,
          })
        }
        className="h-9 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-text-primary"
        aria-label="Comparison"
      >
        {OPERATORS.map((operator) => (
          <option key={operator} value={operator}>
            {humanizeOpportunity(operator)}
          </option>
        ))}
      </select>
      {hasValue ? (
        meta.valueType === "boolean" ? (
          <select
            value={String(clause.value ?? true)}
            onChange={(event) =>
              onChange({ ...clause, value: event.target.value === "true" })
            }
            className="h-9 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-text-primary"
            aria-label="Value"
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            type={
              meta.valueType === "number" && clause.operator !== "between"
                ? "number"
                : "text"
            }
            value={displayValue(clause.value)}
            onChange={(event) =>
              onChange({
                ...clause,
                value: parseValue(
                  event.target.value,
                  clause.field,
                  clause.operator,
                ),
              })
            }
            placeholder={clause.operator === "between" ? "min, max" : "Value"}
            className="h-9 min-w-0 rounded-md border border-border-subtle bg-surface px-2.5 text-xs text-text-primary outline-none focus:border-accent-primary"
            aria-label="Value"
          />
        )
      ) : (
        <div className="flex h-9 items-center px-2.5 text-xs italic text-text-muted">
          No value
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="flex h-9 w-8 items-center justify-center rounded-md text-text-muted transition hover:bg-semantic-error-muted hover:text-semantic-error disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
        aria-label="Remove rule"
        title={canRemove ? "Remove rule" : "A group needs at least one rule"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
