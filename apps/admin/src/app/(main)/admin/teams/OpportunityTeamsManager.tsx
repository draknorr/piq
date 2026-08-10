"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  UserMinus,
  UserPlus,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface TeamMember {
  displayName: string | null;
  email: string;
  joinedAt: string;
  status: "active" | "removed";
  userId: string;
}

interface OpportunityTeam {
  createdAt: string;
  id: string;
  members: TeamMember[];
  name: string;
  slug: string;
  status: "active" | "archived";
  updatedAt: string;
}

interface UserSearchResult {
  email: string;
  fullName: string | null;
  id: string;
}

async function responseError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? "PublisherIQ could not update opportunity teams.";
}

export function OpportunityTeamsManager() {
  const [teams, setTeams] = useState<OpportunityTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [memberQueries, setMemberQueries] = useState<Record<string, string>>(
    {},
  );
  const [searchResults, setSearchResults] = useState<
    Record<string, UserSearchResult[]>
  >({});
  const [searchTargetTeamId, setSearchTargetTeamId] = useState<string | null>(
    null,
  );
  const [searchingTeam, setSearchingTeam] = useState<string | null>(null);

  const activeTeamCount = useMemo(
    () => teams.filter((team) => team.status === "active").length,
    [teams],
  );
  const activeMemberCount = useMemo(
    () =>
      teams.reduce(
        (total, team) =>
          total +
          team.members.filter((member) => member.status === "active").length,
        0,
      ),
    [teams],
  );

  const loadTeams = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/opportunity-teams", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const nextTeams = (await response.json()) as OpportunityTeam[];
      setTeams(nextTeams);
      setDraftNames(
        Object.fromEntries(nextTeams.map((team) => [team.id, team.name])),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load teams.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTeams();
  }, []);

  useEffect(() => {
    if (!searchTargetTeamId) return;
    const teamId = searchTargetTeamId;
    const query = memberQueries[teamId] ?? "";
    if (query.trim().length < 2) {
      setSearchResults((current) => ({ ...current, [teamId]: [] }));
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchingTeam(teamId);
      try {
        const response = await fetch(
          `/api/admin/opportunity-teams?query=${encodeURIComponent(query.trim())}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(await responseError(response));
        const payload = (await response.json()) as {
          users: UserSearchResult[];
        };
        setSearchResults((current) => ({
          ...current,
          [teamId]: payload.users,
        }));
      } catch (searchError) {
        if (
          searchError instanceof DOMException &&
          searchError.name === "AbortError"
        ) {
          return;
        }
        setError(
          searchError instanceof Error
            ? searchError.message
            : "Unable to search users.",
        );
      } finally {
        setSearchingTeam((current) => (current === teamId ? null : current));
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [memberQueries, searchTargetTeamId]);

  const mutate = async (
    key: string,
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<void> => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/opportunity-teams", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error(await responseError(response));
      setMessage(successMessage);
      await loadTeams();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Unable to update teams.",
      );
    } finally {
      setBusy(null);
    }
  };

  const createTeam = async (): Promise<void> => {
    const name = newTeamName.trim();
    if (!name) return;
    await mutate(
      "create",
      { name, operation: "create" },
      `${name} was created.`,
    );
    setNewTeamName("");
  };

  const addMember = async (
    team: OpportunityTeam,
    user: UserSearchResult,
  ): Promise<void> => {
    await mutate(
      `add:${team.id}:${user.id}`,
      { email: user.email, operation: "add-member", teamId: team.id },
      `${user.fullName ?? user.email} was added to ${team.name}.`,
    );
    setMemberQueries((current) => ({ ...current, [team.id]: "" }));
    setSearchResults((current) => ({ ...current, [team.id]: [] }));
    setSearchTargetTeamId(null);
  };

  if (loading && teams.length === 0) {
    return (
      <div className="grid min-h-64 place-items-center rounded-xl border border-border-subtle bg-surface-raised">
        <div className="text-center">
          <RefreshCw className="mx-auto h-5 w-5 animate-spin text-accent-primary" />
          <p className="mt-3 text-body-sm text-text-secondary">Loading teams</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-px overflow-hidden rounded-xl border border-border-muted bg-border-muted sm:grid-cols-3">
        <TeamMetric label="Active teams" value={activeTeamCount} />
        <TeamMetric label="Active members" value={activeMemberCount} />
        <TeamMetric label="Membership rule" value="One team" />
      </section>

      {(error || message) && (
        <div
          className={`border-l-2 px-4 py-3 text-body-sm ${
            error
              ? "border-semantic-error bg-semantic-error-muted text-semantic-error"
              : "border-semantic-success bg-semantic-success-muted text-text-secondary"
          }`}
          role="status"
        >
          {error ?? message}
        </div>
      )}

      <section className="rounded-xl border border-border-subtle bg-surface-raised p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-accent-primary" />
          <h2 className="text-subheading text-text-primary">Create a team</h2>
        </div>
        <p className="mt-2 text-body-sm text-text-tertiary">
          Team names and slugs are unique, regardless of capitalization.
        </p>
        <form
          className="mt-4 flex max-w-xl flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void createTeam();
          }}
        >
          <Input
            aria-label="Team name"
            onChange={(event) => setNewTeamName(event.target.value)}
            placeholder="Team name, for example Tenon"
            value={newTeamName}
          />
          <Button
            className="shrink-0"
            disabled={!newTeamName.trim()}
            isLoading={busy === "create"}
            type="submit"
          >
            Create team
          </Button>
        </form>
      </section>

      {teams.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border-muted bg-surface-raised px-6 py-14 text-center">
          <UsersRound className="mx-auto h-7 w-7 text-accent-primary" />
          <h2 className="mt-4 text-subheading text-text-primary">
            No teams yet
          </h2>
          <p className="mt-2 text-body-sm text-text-tertiary">
            Create Tenon above, then search for existing PublisherIQ members.
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          {teams.map((team) => {
            const activeMembers = team.members.filter(
              (member) => member.status === "active",
            );
            const removedCount = team.members.length - activeMembers.length;
            const existingIds = new Set(
              activeMembers.map((member) => member.userId),
            );
            const candidates = (searchResults[team.id] ?? []).filter(
              (candidate) => !existingIds.has(candidate.id),
            );
            return (
              <article
                key={team.id}
                className="overflow-hidden rounded-xl border border-border-subtle bg-surface-raised"
              >
                <header className="flex flex-col gap-4 border-b border-border-subtle px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-text-primary">
                        {team.name}
                      </h2>
                      <Badge
                        variant={
                          team.status === "active" ? "success" : "default"
                        }
                      >
                        {team.status === "active" ? "Active" : "Archived"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-caption text-text-muted">
                      /{team.slug} · {activeMembers.length} active{" "}
                      {activeMembers.length === 1 ? "member" : "members"}
                      {removedCount > 0 ? ` · ${removedCount} removed` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      aria-label={`Rename ${team.name}`}
                      disabled={team.status === "archived"}
                      onChange={(event) =>
                        setDraftNames((current) => ({
                          ...current,
                          [team.id]: event.target.value,
                        }))
                      }
                      value={draftNames[team.id] ?? team.name}
                    />
                    <Button
                      disabled={
                        team.status === "archived" ||
                        !draftNames[team.id]?.trim() ||
                        draftNames[team.id]?.trim() === team.name
                      }
                      isLoading={busy === `rename:${team.id}`}
                      onClick={() =>
                        void mutate(
                          `rename:${team.id}`,
                          {
                            name: draftNames[team.id]?.trim(),
                            operation: "rename",
                            teamId: team.id,
                          },
                          "Team renamed.",
                        )
                      }
                      type="button"
                      variant="secondary"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </Button>
                    <Button
                      isLoading={busy === `status:${team.id}`}
                      onClick={() =>
                        void mutate(
                          `status:${team.id}`,
                          {
                            operation:
                              team.status === "active" ? "archive" : "restore",
                            teamId: team.id,
                          },
                          team.status === "active"
                            ? `${team.name} was archived. Shared access is revoked.`
                            : `${team.name} was restored.`,
                        )
                      }
                      type="button"
                      variant={
                        team.status === "active" ? "danger" : "secondary"
                      }
                    >
                      {team.status === "active" ? (
                        <Archive className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {team.status === "active" ? "Archive" : "Restore"}
                    </Button>
                  </div>
                </header>

                <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
                  <section className="px-5 py-5">
                    <h3 className="text-sm font-semibold text-text-primary">
                      Members
                    </h3>
                    <div className="mt-3 divide-y divide-border-subtle border-y border-border-subtle">
                      {activeMembers.length === 0 ? (
                        <p className="py-5 text-body-sm text-text-tertiary">
                          This team has no active members.
                        </p>
                      ) : (
                        activeMembers.map((member) => (
                          <div
                            key={member.userId}
                            className="flex items-center justify-between gap-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-body-sm font-medium text-text-primary">
                                {member.displayName ?? member.email}
                              </p>
                              <p className="truncate text-caption text-text-tertiary">
                                {member.email}
                              </p>
                            </div>
                            <Button
                              aria-label={`Remove ${member.email} from ${team.name}`}
                              isLoading={
                                busy === `remove:${team.id}:${member.userId}`
                              }
                              onClick={() =>
                                void mutate(
                                  `remove:${team.id}:${member.userId}`,
                                  {
                                    email: member.email,
                                    operation: "remove-member",
                                    teamId: team.id,
                                    userId: member.userId,
                                  },
                                  `${member.displayName ?? member.email} was removed from ${team.name}.`,
                                )
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              Remove
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="border-t border-border-subtle bg-surface-sunken px-5 py-5 lg:border-l lg:border-t-0">
                    <div className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-accent-primary" />
                      <h3 className="text-sm font-semibold text-text-primary">
                        Add member
                      </h3>
                    </div>
                    <p className="mt-2 text-caption leading-5 text-text-tertiary">
                      Search existing PublisherIQ accounts by name or email.
                    </p>
                    <Input
                      className="mt-3"
                      disabled={team.status === "archived"}
                      leftIcon={
                        searchingTeam === team.id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )
                      }
                      onChange={(event) => {
                        setSearchTargetTeamId(team.id);
                        setMemberQueries((current) => ({
                          ...current,
                          [team.id]: event.target.value,
                        }));
                      }}
                      placeholder="Search name or email"
                      value={memberQueries[team.id] ?? ""}
                    />
                    <div className="mt-3 space-y-2">
                      {candidates.map((candidate) => (
                        <button
                          key={candidate.id}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-left transition hover:border-border-prominent"
                          disabled={busy !== null}
                          onClick={() => void addMember(team, candidate)}
                          type="button"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-body-sm font-medium text-text-primary">
                              {candidate.fullName ?? candidate.email}
                            </span>
                            <span className="block truncate text-caption text-text-tertiary">
                              {candidate.email}
                            </span>
                          </span>
                          <Plus className="h-4 w-4 shrink-0 text-accent-primary" />
                        </button>
                      ))}
                      {(memberQueries[team.id]?.trim().length ?? 0) >= 2 &&
                        searchingTeam !== team.id &&
                        candidates.length === 0 && (
                          <p className="py-2 text-caption leading-5 text-text-tertiary">
                            No eligible account found. Use the existing
                            invitation workflow first if this person has not
                            joined PublisherIQ.
                          </p>
                        )}
                    </div>
                  </section>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-surface-raised px-5 py-4">
      <p className="text-xl font-semibold tabular-nums text-text-primary">
        {value}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
        {label}
      </p>
    </div>
  );
}
