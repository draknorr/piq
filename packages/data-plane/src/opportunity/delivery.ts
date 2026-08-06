import type { Pool, PoolClient, QueryResultRow } from "pg";

import { OpportunityDestinationCipher } from "./delivery-secrets.js";
import {
  buildOpportunityDailyBriefIssue,
  emptyOpportunityEventCounts,
} from "./brief.js";
import type {
  OpportunityBriefProfileStats,
  OpportunityConfidence,
  OpportunityGameDescription,
  OpportunityPotentialBand,
  OpportunityProfileSummary,
  OpportunityReviewPrioritySummary,
  OpportunityResultLabel,
  OpportunityResultSummary,
} from "./types.js";
import {
  cleanOpportunityEvidence,
  decodeOpportunityText,
  opportunityChangeSummary,
} from "./intelligence.js";
import { presentOpportunityChanges } from "./repository.js";
import { opportunityPersistedResultContentSafetySql } from "./sql-compiler.js";
import {
  DISABLED_OPPORTUNITY_WORKSPACE_FEATURE_CONTROL,
  isOpportunityWorkspaceFeatureEnabled,
  type OpportunityWorkspaceFeatureControl,
} from "./feature-controls.js";

export interface OpportunityDeliveryResult {
  appid: number;
  changeSummary: string;
  confidence?: OpportunityConfidence;
  createdAt?: string;
  eventLabel: OpportunityResultLabel;
  gameDescription?: OpportunityGameDescription | null;
  headerImageUrl?: string | null;
  id: string;
  marketPotential: OpportunityPotentialBand;
  matchedProfiles?: Array<{ id: string; name: string }>;
  name: string;
  reviewPriority?: OpportunityReviewPrioritySummary | null;
  score: number | null;
  screenshotThumbnailUrl?: string | null;
  strongestEvidence: string[];
  whyNow: string;
}

export interface OpportunityDeliveryWork {
  availableResultCount: number;
  channel: "email" | "slack";
  deliveryKind: "daily_digest" | "immediate_full_match";
  destinationCiphertext: string;
  id: string;
  idempotencyKey: string;
  overviewUrl: string;
  profiles?: OpportunityProfileSummary[];
  renderedContentVersion?: "opportunity-digest/v1" | "opportunity-digest/v2";
  results: OpportunityDeliveryResult[];
  windowEnd?: string | null;
  windowStart?: string | null;
  workspaceId: string;
}

export interface OpportunityDeliveryProvider {
  sendEmail(params: {
    html: string;
    idempotencyKey: string;
    subject: string;
    text: string;
    to: string;
  }): Promise<string>;
  sendSlack(params: {
    blocks: Array<Record<string, unknown>>;
    fallbackText: string;
    webhookUrl: string;
  }): Promise<string>;
}

interface ClaimedDeliveryRow extends QueryResultRow {
  channel: OpportunityDeliveryWork["channel"];
  delivery_kind: OpportunityDeliveryWork["deliveryKind"];
  destination_ciphertext: string | null;
  id: string;
  idempotency_key: string;
  profile_id: string | null;
  rendered_content_version: "opportunity-digest/v1" | "opportunity-digest/v2";
  rendered_payload: {
    availableResultCount?: number;
    canonicalOverviewUrl?: string;
    windowEnd?: string;
    windowStart?: string;
  };
  user_id: string;
  workspace_id: string;
}

interface HydratedDeliveryProfile {
  current_version: number | null;
  description: string | null;
  id: string;
  immediate_full_match_enabled: boolean;
  local_delivery_time: string;
  name: string;
  next_evaluation_at: string | null;
  source_preset_name: string | null;
  status: OpportunityProfileSummary["status"];
  timezone: string;
  updated_at: string;
}

interface HydratedDeliveryResult {
  appid: number;
  change: OpportunityResultSummary["change"];
  confidence: OpportunityConfidence;
  created_at: string;
  event_label: OpportunityResultLabel;
  game_description: OpportunityGameDescription | null;
  header_image_url: string | null;
  id: string;
  market_potential: OpportunityPotentialBand;
  matched_profiles: Array<{ id: string; name: string }>;
  name: string;
  review_priority: OpportunityReviewPrioritySummary | null;
  score: number | string | null;
  screenshot_thumbnail_url: string | null;
  strongest_evidence: string[];
  why_now: string;
}

interface HydratedDeliveryRow extends QueryResultRow {
  delivery_id: string;
  profiles: HydratedDeliveryProfile[];
  results: HydratedDeliveryResult[];
}

export class OpportunityDeliveryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OpportunityDeliveryError";
  }
}

function numberValue(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class OpportunityDeliveryRepository {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(
    workerId: string,
    limit: number,
  ): Promise<OpportunityDeliveryWork[]> {
    const bounded = Math.max(1, Math.min(50, Math.floor(limit)));
    return this.transaction(async (client) => {
      const claimed = await client.query<ClaimedDeliveryRow>(
        `
          WITH claims AS (
            SELECT delivery.id
            FROM opportunity.deliveries delivery
            WHERE (
                delivery.status IN ('pending', 'retrying')
                AND delivery.scheduled_for <= now()
                AND delivery.next_attempt_at <= now()
              )
              OR (
                delivery.status = 'claimed'
                AND delivery.claim_expires_at < now()
              )
            ORDER BY delivery.scheduled_for, delivery.created_at, delivery.id
            LIMIT $2
            FOR UPDATE SKIP LOCKED
          )
          UPDATE opportunity.deliveries delivery
          SET status = 'claimed',
              attempts = delivery.attempts + 1,
              claimed_at = now(),
              claim_expires_at = now() + interval '5 minutes',
              worker_id = $1,
              updated_at = now()
          FROM claims
          WHERE delivery.id = claims.id
          RETURNING
            delivery.id,
            delivery.workspace_id,
            delivery.user_id,
            delivery.channel,
            delivery.delivery_kind,
            delivery.idempotency_key,
            delivery.rendered_content_version,
            delivery.rendered_payload,
            (
              SELECT preference.profile_id
              FROM opportunity.channel_preferences preference
              WHERE preference.id = delivery.preference_id
            ) AS profile_id,
            (
              SELECT preference.destination_ciphertext
              FROM opportunity.channel_preferences preference
              WHERE preference.id = delivery.preference_id
            ) AS destination_ciphertext
        `,
        [workerId, bounded],
      );
      for (const row of claimed.rows) {
        if (!row.destination_ciphertext) {
          throw new OpportunityDeliveryError(
            `Delivery ${row.id} has no encrypted destination.`,
            "destination_missing",
            false,
          );
        }
      }
      if (claimed.rows.length === 0) {
        return [];
      }
      const hydrated = await client.query<HydratedDeliveryRow>(
        `
          WITH selected_deliveries AS MATERIALIZED (
            SELECT
              delivery.id,
              delivery.result_ids,
              preference.profile_id,
              delivery.user_id,
              delivery.workspace_id
            FROM opportunity.deliveries delivery
            LEFT JOIN opportunity.channel_preferences preference
              ON preference.id = delivery.preference_id
            WHERE delivery.id = ANY($1::uuid[])
          ),
          selected_results AS MATERIALIZED (
            SELECT
              delivery.id AS delivery_id,
              selected.result_id,
              selected.position
            FROM selected_deliveries delivery
            CROSS JOIN LATERAL unnest(delivery.result_ids)
              WITH ORDINALITY AS selected(result_id, position)
            JOIN opportunity.results result
              ON result.id = selected.result_id
            JOIN legacy.apps content_safety_app
              ON content_safety_app.appid = result.appid
              AND ${opportunityPersistedResultContentSafetySql(
                "result",
                "content_safety_app",
              )}
            WHERE selected.position <= 100
          ),
          profile_matches AS MATERIALIZED (
            SELECT
              selected.result_id,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object('id', profile.id, 'name', profile.name)
                  ORDER BY profile.name, profile.id
                ) FILTER (WHERE profile.id IS NOT NULL),
                '[]'::jsonb
              ) AS matched_profiles
            FROM (
              SELECT DISTINCT result_id
              FROM selected_results
            ) selected
            LEFT JOIN opportunity.result_profile_matches match
              ON match.result_id = selected.result_id
            LEFT JOIN opportunity.profiles profile ON profile.id = match.profile_id
            GROUP BY selected.result_id
          ),
          result_payload AS MATERIALIZED (
            SELECT
              selected.delivery_id,
              jsonb_agg(
                jsonb_build_object(
                  'id', result.id,
                  'appid', result.appid,
                  'name', app.name,
                  'change', CASE WHEN material.id IS NULL THEN NULL ELSE
                    jsonb_build_object(
                      'eventType', material.event_type,
                      'signalFamily', material.signal_family,
                      'effectiveAt', material.effective_at,
                      'observedAt', material.observed_at,
                      'confidence', material.confidence,
                      'affectedRuleFields', material.affected_rule_fields,
                      'before', material.before_summary,
                      'after', material.after_summary
                    )
                  END,
                  'event_label', result.event_label,
                  'score', result.score,
                  'confidence', result.confidence,
                  'created_at', result.created_at,
                  'game_description', result.evidence_summary->'gameDescription',
                  'review_priority', result.evidence_summary->'reviewPriorityV2',
                  'header_image_url', selected_media.hero_assets->>'header',
                  'screenshot_thumbnail_url',
                    selected_media.screenshots->0->>'thumbnailUrl',
                  'matched_profiles', profile_matches.matched_profiles,
                  'market_potential', COALESCE(
                    market.potential_band,
                    'insufficient_data'
                  ),
                  'why_now', COALESCE(
                    result.why_now->>'summary',
                    result.event_label
                  ),
                  'strongest_evidence',
                    COALESCE(result.evidence_summary->'strongest', '[]'::jsonb)
                )
                ORDER BY selected.position
              ) AS results
            FROM selected_results selected
            JOIN opportunity.results result ON result.id = selected.result_id
            JOIN legacy.apps app ON app.appid = result.appid
            LEFT JOIN opportunity.material_events material
              ON material.id = result.material_event_id
            LEFT JOIN opportunity.market_context_snapshots market
              ON market.id = result.market_context_snapshot_id
            LEFT JOIN profile_matches
              ON profile_matches.result_id = result.id
            LEFT JOIN LATERAL (
              SELECT media.hero_assets, media.screenshots
              FROM docs.app_media_versions media
              WHERE media.appid = result.appid
              ORDER BY media.first_seen_at DESC, media.id DESC
              LIMIT 1
            ) selected_media ON true
            GROUP BY selected.delivery_id
          ),
          profile_payload AS MATERIALIZED (
            SELECT
              delivery.id AS delivery_id,
              jsonb_agg(
                jsonb_build_object(
                  'id', profile.id,
                  'name', profile.name,
                  'description', profile.description,
                  'status', profile.status,
                  'timezone', profile.timezone,
                  'local_delivery_time',
                    to_char(profile.local_delivery_time, 'HH24:MI'),
                  'immediate_full_match_enabled',
                    profile.immediate_full_match_enabled,
                  'next_evaluation_at', profile.next_evaluation_at,
                  'updated_at', profile.updated_at,
                  'current_version', version.version,
                  'source_preset_name', preset.name
                )
                ORDER BY profile.updated_at DESC, profile.id
              ) FILTER (WHERE profile.id IS NOT NULL) AS profiles
            FROM selected_deliveries delivery
            LEFT JOIN opportunity.profiles profile
              ON profile.workspace_id = delivery.workspace_id
             AND profile.owner_user_id = delivery.user_id
             AND profile.status <> 'archived'
             AND (
               delivery.profile_id IS NULL
               OR profile.id = delivery.profile_id
             )
            LEFT JOIN opportunity.profile_versions version
              ON version.id = profile.current_version_id
            LEFT JOIN opportunity.presets preset
              ON preset.id = profile.source_preset_id
            GROUP BY delivery.id
          )
          SELECT
            delivery.id AS delivery_id,
            COALESCE(result_payload.results, '[]'::jsonb) AS results,
            COALESCE(profile_payload.profiles, '[]'::jsonb) AS profiles
          FROM selected_deliveries delivery
          LEFT JOIN result_payload
            ON result_payload.delivery_id = delivery.id
          LEFT JOIN profile_payload
            ON profile_payload.delivery_id = delivery.id
          ORDER BY delivery.id
        `,
        [claimed.rows.map((row) => row.id)],
      );
      const hydrationByDelivery = new Map(
        hydrated.rows.map((row) => [row.delivery_id, row]),
      );
      const allResults = hydrated.rows.flatMap((row) => row.results);
      const allPresentedChanges = await presentOpportunityChanges(
        client,
        allResults.map((result) => result.change),
        allResults.map((result) => result.event_label),
      );
      const presentedChangeByResultId = new Map(
        allResults.map((result, index) => [
          result.id,
          allPresentedChanges[index] ?? null,
        ]),
      );
      return claimed.rows.map((row) => {
        const hydration = hydrationByDelivery.get(row.id) ?? {
          delivery_id: row.id,
          profiles: [],
          results: [],
        };
        return {
          availableResultCount:
            row.rendered_payload.availableResultCount ??
            hydration.results.length,
          channel: row.channel,
          deliveryKind: row.delivery_kind,
          destinationCiphertext: row.destination_ciphertext!,
          id: row.id,
          idempotencyKey: row.idempotency_key,
          overviewUrl: row.rendered_payload.canonicalOverviewUrl ?? "",
          profiles: hydration.profiles.map((profile) => ({
            currentVersion: profile.current_version,
            description: profile.description,
            id: profile.id,
            immediateFullMatchEnabled: profile.immediate_full_match_enabled,
            localDeliveryTime: profile.local_delivery_time,
            name: decodeOpportunityText(profile.name),
            nextEvaluationAt: profile.next_evaluation_at
              ? new Date(profile.next_evaluation_at).toISOString()
              : null,
            sourcePresetName: profile.source_preset_name,
            status: profile.status,
            timezone: profile.timezone,
            updatedAt: new Date(profile.updated_at).toISOString(),
          })),
          renderedContentVersion: row.rendered_content_version,
          results: hydration.results.map((result) => {
            const changeSummary = opportunityChangeSummary(
              presentedChangeByResultId.get(result.id) ?? null,
              result.event_label,
            );
            return {
              appid: result.appid,
              changeSummary,
              confidence: result.confidence,
              createdAt: new Date(result.created_at).toISOString(),
              eventLabel: result.event_label,
              gameDescription: result.game_description,
              headerImageUrl: result.header_image_url,
              id: result.id,
              marketPotential: result.market_potential,
              matchedProfiles: result.matched_profiles ?? [],
              name: decodeOpportunityText(result.name),
              reviewPriority: result.review_priority,
              score: numberValue(result.score),
              screenshotThumbnailUrl: result.screenshot_thumbnail_url,
              strongestEvidence: cleanOpportunityEvidence(
                result.strongest_evidence,
                changeSummary,
              ),
              whyNow: decodeOpportunityText(result.why_now),
            };
          }),
          windowEnd: row.rendered_payload.windowEnd ?? null,
          windowStart: row.rendered_payload.windowStart ?? null,
          workspaceId: row.workspace_id,
        };
      });
    });
  }

  async complete(params: {
    deliveryId: string;
    providerMessageId: string;
    workerId: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE opportunity.deliveries
        SET status = 'sent',
            provider_message_id = $3,
            sent_at = now(),
            claim_expires_at = NULL,
            updated_at = now()
        WHERE id = $1
          AND worker_id = $2
          AND status = 'claimed'
      `,
      [params.deliveryId, params.workerId, params.providerMessageId],
    );
  }

  async fail(params: {
    code: string;
    deliveryId: string;
    error: string;
    retryable: boolean;
    workerId: string;
  }): Promise<void> {
    await this.pool.query(
      `
        UPDATE opportunity.deliveries
        SET status = CASE
              WHEN NOT $5 OR attempts >= max_attempts THEN 'dead_letter'
              ELSE 'retrying'
            END,
            next_attempt_at = now() + (
              LEAST(360, POWER(2, LEAST(attempts, 8))) * interval '1 minute'
            ),
            last_error_code = $3,
            last_error_message = left($4, 2000),
            claim_expires_at = NULL,
            worker_id = NULL,
            updated_at = now()
        WHERE id = $1
          AND worker_id = $2
          AND status = 'claimed'
      `,
      [
        params.deliveryId,
        params.workerId,
        params.code,
        params.error,
        params.retryable,
      ],
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeSlackMrkdwn(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function resultLabel(value: OpportunityResultLabel): string {
  return {
    materially_changed: "Commercial change",
    newly_discovered: "New discovery",
    newly_qualified: "New match",
    newly_released: "Newly released",
    tracked_update: "Tracked update",
  }[value];
}

function potentialLabel(value: OpportunityPotentialBand): string {
  return {
    developing: "Developing",
    insufficient_data: "Too early to size",
    large_but_competitive: "Large, competitive market",
    limited: "Selective",
    meaningful: "Meaningful",
  }[value];
}

function normalizedDeliveryPresentationText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function distinctReviewReasons(
  reasons: string[],
  marketPotential: OpportunityPotentialBand,
): string[] {
  const marketLabel = normalizedDeliveryPresentationText(
    potentialLabel(marketPotential),
  );
  return reasons.filter(
    (reason) => normalizedDeliveryPresentationText(reason) !== marketLabel,
  );
}

function renderOpportunityDeliveryV1(work: OpportunityDeliveryWork): {
  html: string;
  slackBlocks: Array<Record<string, unknown>>;
  subject: string;
  text: string;
} {
  const immediate = work.deliveryKind === "immediate_full_match";
  const subject = immediate
    ? `New Steam match${work.results[0] ? `: ${decodeOpportunityText(work.results[0].name)}` : ""}`
    : work.results.length > 0
      ? `${work.results.length} ${work.results.length === 1 ? "game" : "games"} to review in Daily Intelligence Desk`
      : "No new games in Daily Intelligence Desk today";
  const header = immediate
    ? "A new game matches your sourcing criteria."
    : work.results.length > 0
      ? `${work.results.length} ${work.results.length === 1 ? "game is" : "games are"} worth reviewing today.`
      : "No new games matched your criteria today.";
  const truncationNotice =
    work.availableResultCount > work.results.length
      ? `Showing the top ${work.results.length} of ${work.availableResultCount} results. Open PublisherIQ for the complete brief.`
      : null;
  const resultText = work.results.map((result, index) => {
    const link = `${work.overviewUrl.replace(/\?.*$/, "")}/games/${result.appid}?result=${result.id}`;
    const name = decodeOpportunityText(result.name);
    const summary = decodeOpportunityText(result.changeSummary);
    const evidence = result.strongestEvidence
      .slice(0, 3)
      .map(decodeOpportunityText)
      .join("; ");
    return [
      `${index + 1}. ${name} — ${resultLabel(result.eventLabel)}`,
      summary,
      ...(evidence ? [`Matched criteria and evidence: ${evidence}`] : []),
      `Market potential: ${potentialLabel(result.marketPotential)}`,
      link,
    ].join("\n");
  });
  const text = [
    header,
    ...(truncationNotice ? [truncationNotice] : []),
    "",
    ...resultText.flatMap((result) => [result, ""]),
    `Open the complete brief: ${work.overviewUrl}`,
  ].join("\n");
  const cards = work.results
    .map((result) => {
      const link = `${work.overviewUrl.replace(/\?.*$/, "")}/games/${result.appid}?result=${result.id}`;
      const name = decodeOpportunityText(result.name);
      const summary = decodeOpportunityText(result.changeSummary);
      const evidence = result.strongestEvidence
        .slice(0, 3)
        .map(decodeOpportunityText)
        .join("; ");
      return `
        <article style="border:1px solid #dbe4ea;border-radius:12px;padding:16px;margin:12px 0">
          <h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(name)}</h2>
          <p style="margin:0 0 8px;color:#475569">${escapeHtml(resultLabel(result.eventLabel))} · ${escapeHtml(potentialLabel(result.marketPotential))} market potential</p>
          <p style="margin:0 0 12px">${escapeHtml(summary)}</p>
          ${evidence ? `<p style="margin:0 0 12px;color:#475569"><strong>Matched criteria and evidence:</strong> ${escapeHtml(evidence)}</p>` : ""}
          <a href="${escapeHtml(link)}" style="color:#0f766e;font-weight:600">View full analysis</a>
        </article>`;
    })
    .join("");
  const html = `
    <main style="font-family:Inter,Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0f766e">PublisherIQ · Daily Intelligence Desk</p>
      <h1 style="font-size:26px;line-height:1.2">${escapeHtml(header)}</h1>
      ${cards}
      ${
        truncationNotice
          ? `<p style="margin-top:20px;color:#475569">${escapeHtml(truncationNotice)}</p>`
          : ""
      }
      <p style="margin-top:24px"><a href="${escapeHtml(work.overviewUrl)}" style="color:#0f766e;font-weight:600">Open Daily Intelligence Desk</a></p>
    </main>`;
  const slackBlocks: Array<Record<string, unknown>> = [
    {
      text: {
        text: `*${header}*\n<${work.overviewUrl}|Open Daily Intelligence Desk>`,
        type: "mrkdwn",
      },
      type: "section",
    },
    ...(truncationNotice
      ? [
          {
            text: { text: truncationNotice, type: "mrkdwn" },
            type: "context",
          },
        ]
      : []),
    ...work.results.flatMap((result) => {
      const link = `${work.overviewUrl.replace(/\?.*$/, "")}/games/${result.appid}?result=${result.id}`;
      const name = decodeOpportunityText(result.name);
      const summary = decodeOpportunityText(result.changeSummary);
      const evidence = result.strongestEvidence
        .slice(0, 3)
        .map(decodeOpportunityText)
        .join("; ");
      return [
        { type: "divider" },
        {
          text: {
            text: `*<${link}|${escapeSlackMrkdwn(name)}>* · ${resultLabel(result.eventLabel)}\n${escapeSlackMrkdwn(summary)}${evidence ? `\n*Matched criteria and evidence:* ${escapeSlackMrkdwn(evidence)}` : ""}\n_${potentialLabel(result.marketPotential)} market potential_`,
            type: "mrkdwn",
          },
          type: "section",
        },
      ];
    }),
  ];
  return { html, slackBlocks, subject, text };
}

function deliveryGameUrl(
  work: OpportunityDeliveryWork,
  result: OpportunityDeliveryResult,
): string {
  return `${work.overviewUrl.replace(/\?.*$/, "")}/games/${result.appid}?result=${result.id}`;
}

function safeRemoteImage(value: string | null | undefined): string | null {
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

function deliveryProfiles(
  work: OpportunityDeliveryWork,
): OpportunityProfileSummary[] {
  if (work.profiles && work.profiles.length > 0) {
    return work.profiles;
  }
  const profiles = new Map<string, { id: string; name: string }>();
  work.results.forEach((result) =>
    result.matchedProfiles?.forEach((profile) =>
      profiles.set(profile.id, profile),
    ),
  );
  return Array.from(profiles.values()).map((profile) => ({
    currentVersion: null,
    description: null,
    id: profile.id,
    immediateFullMatchEnabled: false,
    localDeliveryTime: "09:00",
    name: profile.name,
    nextEvaluationAt: null,
    sourcePresetName: null,
    status: "enabled",
    timezone: "UTC",
    updatedAt: work.windowEnd ?? new Date(0).toISOString(),
  }));
}

function deliveryProfileStats(
  work: OpportunityDeliveryWork,
  profiles: OpportunityProfileSummary[],
): OpportunityBriefProfileStats[] {
  return profiles.map((profile) => {
    const matches = work.results.filter((result) =>
      result.matchedProfiles?.some((match) => match.id === profile.id),
    );
    const eventCounts = emptyOpportunityEventCounts();
    matches.forEach((result) => {
      eventCounts[result.eventLabel] += 1;
    });
    const top = matches[0] ?? null;
    return {
      eventCounts,
      highConfidenceCount: matches.filter(
        (result) => result.confidence === "high",
      ).length,
      profileId: profile.id,
      resultCount: matches.length,
      topResult: top
        ? { appid: top.appid, name: top.name, resultId: top.id }
        : null,
    };
  });
}

function renderOpportunityDeliveryV2(
  work: OpportunityDeliveryWork,
  presentReviewPriorityV2: boolean,
): {
  html: string;
  slackBlocks: Array<Record<string, unknown>>;
  subject: string;
  text: string;
} {
  const profiles = deliveryProfiles(work);
  const summaries: OpportunityResultSummary[] = work.results.map(
    (result, index) => ({
      appid: result.appid,
      change: null,
      changeSummary: result.changeSummary,
      confidence: result.confidence ?? "directional",
      createdAt:
        result.createdAt ?? work.windowEnd ?? new Date(0).toISOString(),
      eventFingerprint: `delivery:${result.id}`,
      eventLabel: result.eventLabel,
      gameDescription: result.gameDescription ?? null,
      headerImageUrl: result.headerImageUrl ?? null,
      id: result.id,
      marketPotential: result.marketPotential,
      matchedProfiles: result.matchedProfiles ?? [],
      name: result.name,
      rank: index + 1,
      rankComponents: {
        evidenceQuality: 0,
        marketMomentum: 0,
        peerPosition: 0,
        signalStrength: 0,
        userFit: 0,
      },
      reviewPriority: result.reviewPriority ?? null,
      score: result.score,
      screenshotThumbnailUrl: result.screenshotThumbnailUrl ?? null,
      strongestEvidence: result.strongestEvidence,
      triggeredByMediaAddition: false,
      whyNow: result.whyNow,
    }),
  );
  const issue = buildOpportunityDailyBriefIssue({
    availableResultCount: work.availableResultCount,
    coverageWarnings: [],
    featuredCandidates: summaries,
    featuredLimit: 100,
    highConfidenceCount: summaries.filter(
      (result) => result.confidence === "high",
    ).length,
    issueDate: work.windowEnd ?? null,
    newerRunUpdating: false,
    profiles,
    profilesEvaluated: profiles.filter(
      (profile) => profile.status === "enabled",
    ).length,
    profileStats: deliveryProfileStats(work, profiles),
    runId: null,
    status: summaries.length > 0 ? "ready" : "empty",
    useReviewPriorityCopy: presentReviewPriorityV2,
    windowEnd: work.windowEnd ?? null,
    windowStart: work.windowStart ?? null,
  });
  const truncationNotice =
    work.availableResultCount > issue.featuredGames.length
      ? `Showing the top ${issue.featuredGames.length} of ${work.availableResultCount} results. Open PublisherIQ for the complete brief.`
      : null;
  const subject = `Daily Brief: ${issue.headline}`;
  const profileText = issue.profileDispatches.map(
    (profile) => `${profile.name}: ${profile.summary}`,
  );
  const resultText = issue.featuredGames.map((result, index) => {
    const source = work.results.find(
      (candidate) => candidate.id === result.id,
    )!;
    const v2Reasons = source.reviewPriority
      ? distinctReviewReasons(
          source.reviewPriority.reasons,
          result.marketPotential,
        )
      : [];
    return [
      `${index + 1}. ${decodeOpportunityText(result.name)} — ${resultLabel(result.eventLabel)}`,
      decodeOpportunityText(
        presentReviewPriorityV2
          ? (source.gameDescription?.text ??
              "Steam has not provided a short description for this game yet.")
          : result.changeSummary,
      ),
      ...(presentReviewPriorityV2 && v2Reasons.length
        ? [v2Reasons.join(" · ")]
        : [decodeOpportunityText(source.whyNow)]),
      `Market potential: ${potentialLabel(result.marketPotential)}`,
      deliveryGameUrl(work, source),
    ].join("\n");
  });
  const text = [
    issue.headline,
    issue.dek,
    ...(truncationNotice ? [truncationNotice] : []),
    "",
    ...profileText,
    "",
    ...resultText.flatMap((result) => [result, ""]),
    `Open the complete Daily Brief: ${work.overviewUrl}`,
  ].join("\n");

  const richGames = issue.featuredGames.slice(0, 4);
  const compactGames = issue.featuredGames.slice(4);
  const richHtml = richGames
    .map((result, index) => {
      const source = work.results.find(
        (candidate) => candidate.id === result.id,
      )!;
      const link = deliveryGameUrl(work, source);
      const image = safeRemoteImage(
        index === 0
          ? (result.headerImageUrl ?? result.screenshotThumbnailUrl)
          : (result.screenshotThumbnailUrl ?? result.headerImageUrl),
      );
      const description = decodeOpportunityText(
        presentReviewPriorityV2
          ? (source.gameDescription?.text ??
              "Steam has not provided a short description for this game yet.")
          : result.changeSummary,
      );
      const v2Reasons = source.reviewPriority
        ? distinctReviewReasons(
            source.reviewPriority.reasons,
            result.marketPotential,
          )
        : [];
      const reasons =
        presentReviewPriorityV2 && v2Reasons.length
          ? v2Reasons.join(" · ")
          : decodeOpportunityText(source.whyNow);
      return `
        <article style="border-top:1px solid #dfd8ce;padding:24px 0">
          ${image ? `<a href="${escapeHtml(link)}"><img src="${escapeHtml(image)}" width="632" alt="${escapeHtml(decodeOpportunityText(result.name))} Steam artwork" style="display:block;width:100%;height:auto;border-radius:8px;margin-bottom:16px" /></a>` : `<div style="display:block;background:#f1ebe3;border:1px solid #dfd8ce;border-radius:8px;color:#8b7468;font-size:11px;font-weight:700;letter-spacing:.12em;margin-bottom:16px;padding:42px 16px;text-align:center;text-transform:uppercase">PublisherIQ watch desk · Artwork unavailable</div>`}
          <p style="margin:0 0 8px;color:#c4513f;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${index === 0 ? "Lead opportunity" : resultLabel(result.eventLabel)}</p>
          <h2 style="font-size:${index === 0 ? "26px" : "20px"};line-height:1.2;margin:0 0 8px;color:#211d1a">${escapeHtml(decodeOpportunityText(result.name))}</h2>
          <p style="font-size:16px;line-height:1.6;margin:0 0 8px;color:#3f3a35">${escapeHtml(description)}</p>
          <p style="font-size:13px;line-height:1.5;margin:0 0 12px;color:#6b625a">${escapeHtml(reasons)}</p>
          <p style="font-size:12px;line-height:1.5;margin:0 0 12px;color:#6b625a">Market potential: ${escapeHtml(potentialLabel(result.marketPotential))}</p>
          <a href="${escapeHtml(link)}" style="color:#c4513f;font-weight:700;text-decoration:none">Read the full game profile →</a>
        </article>`;
    })
    .join("");
  const compactHtml = compactGames
    .map((result) => {
      const source = work.results.find(
        (candidate) => candidate.id === result.id,
      )!;
      const description = decodeOpportunityText(
        presentReviewPriorityV2
          ? (source.gameDescription?.text ??
              "Steam has not provided a short description for this game yet.")
          : result.changeSummary,
      );
      return `<li style="margin:0;padding:12px 0;border-top:1px solid #eee8df"><a href="${escapeHtml(deliveryGameUrl(work, source))}" style="color:#211d1a;font-weight:700;text-decoration:none">${escapeHtml(decodeOpportunityText(result.name))}</a><br/><span style="color:#6b625a;font-size:13px">${escapeHtml(description)}</span></li>`;
    })
    .join("");
  const profileHtml = issue.profileDispatches
    .map(
      (profile) =>
        `<tr><td style="padding:12px 0;border-top:1px solid #eee8df"><strong>${escapeHtml(profile.name)}</strong><br/><span style="color:#6b625a;font-size:13px;line-height:1.5">${escapeHtml(profile.summary)}</span></td></tr>`,
    )
    .join("");
  const html = `
    <main style="font-family:'DM Sans',Arial,sans-serif;max-width:680px;margin:0 auto;padding:28px 24px;background:#fbf8f3;color:#211d1a">
      <p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#c4513f;font-weight:700;margin:0 0 18px">PublisherIQ · Daily Brief</p>
      <h1 style="font-family:Georgia,serif;font-size:36px;line-height:1.05;letter-spacing:-.025em;margin:0 0 16px">${escapeHtml(issue.headline)}</h1>
      <p style="font-size:17px;line-height:1.65;color:#514a43;margin:0 0 28px">${escapeHtml(issue.dek)}</p>
      ${richHtml}
      ${compactHtml ? `<h2 style="font-size:16px;margin:30px 0 0">Also worth opening</h2><ul style="list-style:none;margin:8px 0 0;padding:0">${compactHtml}</ul>` : ""}
      <h2 style="font-size:16px;margin:32px 0 8px">Profile dispatches</h2>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${profileHtml}</table>
      ${truncationNotice ? `<p style="margin-top:24px;color:#6b625a;font-size:13px">${escapeHtml(truncationNotice)}</p>` : ""}
      <p style="margin-top:28px"><a href="${escapeHtml(work.overviewUrl)}" style="display:inline-block;background:#c4513f;color:#fff;padding:12px 18px;border-radius:6px;font-weight:700;text-decoration:none">Open the complete Daily Brief</a></p>
    </main>`;

  const slackBlocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: issue.headline.slice(0, 150),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${escapeSlackMrkdwn(issue.dek)}\n<${work.overviewUrl}|Open the complete Daily Brief>`,
      },
    },
    ...(truncationNotice
      ? [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: truncationNotice }],
          },
        ]
      : []),
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Profile dispatches*\n${issue.profileDispatches
          .map(
            (profile) =>
              `*${escapeSlackMrkdwn(profile.name)}* — ${escapeSlackMrkdwn(profile.summary)}`,
          )
          .join("\n")}`.slice(0, 3000),
      },
    },
    ...issue.featuredGames.slice(0, 3).map((result) => {
      const source = work.results.find(
        (candidate) => candidate.id === result.id,
      )!;
      const image = safeRemoteImage(
        result.screenshotThumbnailUrl ?? result.headerImageUrl,
      );
      const description = decodeOpportunityText(
        presentReviewPriorityV2
          ? (source.gameDescription?.text ??
              "Steam has not provided a short description for this game yet.")
          : result.changeSummary,
      );
      const v2Reasons = source.reviewPriority
        ? distinctReviewReasons(
            source.reviewPriority.reasons,
            result.marketPotential,
          )
        : [];
      const reasons =
        presentReviewPriorityV2 && v2Reasons.length
          ? v2Reasons.join(" · ")
          : decodeOpportunityText(source.whyNow);
      return {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${deliveryGameUrl(work, source)}|${escapeSlackMrkdwn(decodeOpportunityText(result.name))}>* · ${resultLabel(result.eventLabel)}\n${escapeSlackMrkdwn(description)}\n_${escapeSlackMrkdwn(reasons)}_\nMarket potential: ${escapeSlackMrkdwn(potentialLabel(result.marketPotential))}`,
        },
        ...(image
          ? {
              accessory: {
                type: "image",
                image_url: image,
                alt_text:
                  `${decodeOpportunityText(result.name)} Steam artwork`.slice(
                    0,
                    2000,
                  ),
              },
            }
          : {}),
      };
    }),
  ];
  const remaining = issue.featuredGames.slice(3);
  for (let index = 0; index < remaining.length; index += 10) {
    const batch = remaining.slice(index, index + 10);
    slackBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: batch
          .map((result) => {
            const source = work.results.find(
              (candidate) => candidate.id === result.id,
            )!;
            return `• <${deliveryGameUrl(work, source)}|${escapeSlackMrkdwn(decodeOpportunityText(result.name))}> — ${resultLabel(result.eventLabel)}`;
          })
          .join("\n")
          .slice(0, 3000),
      },
    });
  }
  return { html, slackBlocks, subject, text };
}

export function renderOpportunityDelivery(
  work: OpportunityDeliveryWork,
  options: { presentReviewPriorityV2?: boolean } = {},
): {
  html: string;
  slackBlocks: Array<Record<string, unknown>>;
  subject: string;
  text: string;
} {
  return work.renderedContentVersion === "opportunity-digest/v2" &&
    work.deliveryKind === "daily_digest"
    ? renderOpportunityDeliveryV2(
        work,
        options.presentReviewPriorityV2 ?? false,
      )
    : renderOpportunityDeliveryV1(work);
}

export class OpportunityHttpDeliveryProvider implements OpportunityDeliveryProvider {
  constructor(
    private readonly options: {
      resendApiKey: string;
      resendFrom: string;
    },
  ) {}

  async sendEmail(params: {
    html: string;
    idempotencyKey: string;
    subject: string;
    text: string;
    to: string;
  }): Promise<string> {
    if (!this.options.resendApiKey || !this.options.resendFrom) {
      throw new OpportunityDeliveryError(
        "Email delivery requires RESEND_API_KEY and OPPORTUNITY_EMAIL_FROM.",
        "resend_not_configured",
        false,
      );
    }
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        body: JSON.stringify({
          from: this.options.resendFrom,
          html: params.html,
          subject: params.subject,
          text: params.text,
          to: [params.to],
        }),
        headers: {
          Authorization: `Bearer ${this.options.resendApiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": params.idempotencyKey,
        },
        method: "POST",
      });
    } catch (error) {
      throw new OpportunityDeliveryError(
        error instanceof Error ? error.message : String(error),
        "resend_network_error",
        true,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!response.ok || !body.id) {
      throw new OpportunityDeliveryError(
        body.message ?? `Resend returned HTTP ${response.status}.`,
        `resend_http_${response.status}`,
        response.status === 409 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }
    return body.id;
  }

  async sendSlack(params: {
    blocks: Array<Record<string, unknown>>;
    fallbackText: string;
    webhookUrl: string;
  }): Promise<string> {
    let response: Response;
    try {
      response = await fetch(params.webhookUrl, {
        body: JSON.stringify({
          blocks: params.blocks,
          text: params.fallbackText,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    } catch (error) {
      throw new OpportunityDeliveryError(
        `${error instanceof Error ? error.message : String(error)} Automatic retry is disabled because Slack incoming webhooks do not offer an idempotency key.`,
        "slack_ambiguous_network_error",
        false,
      );
    }
    const body = await response.text();
    if (!response.ok || body.trim() !== "ok") {
      throw new OpportunityDeliveryError(
        body || `Slack returned HTTP ${response.status}.`,
        `slack_http_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return `slack-webhook:${Date.now()}`;
  }
}

export class OpportunityDeliveryDispatcher {
  constructor(
    private readonly repository: OpportunityDeliveryRepository,
    private readonly cipher: OpportunityDestinationCipher,
    private readonly provider: OpportunityDeliveryProvider,
    private readonly workerId: string,
    private readonly presentationControl: OpportunityWorkspaceFeatureControl = DISABLED_OPPORTUNITY_WORKSPACE_FEATURE_CONTROL,
  ) {}

  async runOnce(limit = 10): Promise<number> {
    const deliveries = await this.repository.claim(this.workerId, limit);
    for (const delivery of deliveries) {
      try {
        const destination = this.cipher.decrypt(delivery.destinationCiphertext);
        const rendered = renderOpportunityDelivery(delivery, {
          presentReviewPriorityV2: isOpportunityWorkspaceFeatureEnabled(
            this.presentationControl,
            delivery.workspaceId,
          ),
        });
        const providerMessageId =
          delivery.channel === "email"
            ? await this.provider.sendEmail({
                html: rendered.html,
                idempotencyKey: delivery.idempotencyKey,
                subject: rendered.subject,
                text: rendered.text,
                to: destination,
              })
            : await this.provider.sendSlack({
                blocks: rendered.slackBlocks,
                fallbackText: rendered.text,
                webhookUrl: destination,
              });
        await this.repository.complete({
          deliveryId: delivery.id,
          providerMessageId,
          workerId: this.workerId,
        });
      } catch (error) {
        const deliveryError =
          error instanceof OpportunityDeliveryError
            ? error
            : new OpportunityDeliveryError(
                error instanceof Error ? error.message : String(error),
                "delivery_failed",
                false,
              );
        await this.repository.fail({
          code: deliveryError.code,
          deliveryId: delivery.id,
          error: deliveryError.message,
          retryable: deliveryError.retryable,
          workerId: this.workerId,
        });
      }
    }
    return deliveries.length;
  }
}
