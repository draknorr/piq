import type { Pool, PoolClient, QueryResultRow } from "pg";

import { OpportunityDestinationCipher } from "./delivery-secrets.js";
import type {
  OpportunityPotentialBand,
  OpportunityResultLabel,
  OpportunityResultSummary,
} from "./types.js";
import {
  cleanOpportunityEvidence,
  decodeOpportunityText,
  opportunityChangeSummary,
} from "./intelligence.js";
import { presentOpportunityChanges } from "./repository.js";

export interface OpportunityDeliveryResult {
  appid: number;
  changeSummary: string;
  eventLabel: OpportunityResultLabel;
  id: string;
  marketPotential: OpportunityPotentialBand;
  name: string;
  score: number | null;
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
  results: OpportunityDeliveryResult[];
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
  rendered_payload: {
    availableResultCount?: number;
    canonicalOverviewUrl?: string;
  };
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
            delivery.channel,
            delivery.delivery_kind,
            delivery.idempotency_key,
            delivery.rendered_payload,
            (
              SELECT preference.destination_ciphertext
              FROM opportunity.channel_preferences preference
              WHERE preference.id = delivery.preference_id
            ) AS destination_ciphertext
        `,
        [workerId, bounded],
      );
      const deliveries: OpportunityDeliveryWork[] = [];
      for (const row of claimed.rows) {
        if (!row.destination_ciphertext) {
          throw new OpportunityDeliveryError(
            `Delivery ${row.id} has no encrypted destination.`,
            "destination_missing",
            false,
          );
        }
        const results = await client.query<
          QueryResultRow & {
            appid: number;
            change: OpportunityResultSummary["change"];
            event_label: OpportunityResultLabel;
            id: string;
            market_potential: OpportunityPotentialBand;
            name: string;
            score: number | string | null;
            strongest_evidence: string[];
            why_now: string;
          }
        >(
          `
            SELECT
              result.id,
              result.appid,
              app.name,
              (
                SELECT jsonb_build_object(
                  'eventType', material.event_type,
                  'signalFamily', material.signal_family,
                  'effectiveAt', material.effective_at,
                  'observedAt', material.observed_at,
                  'confidence', material.confidence,
                  'affectedRuleFields', material.affected_rule_fields,
                  'before', material.before_summary,
                  'after', material.after_summary
                )
                FROM opportunity.material_events material
                WHERE material.id = result.material_event_id
                LIMIT 1
              ) AS change,
              result.event_label,
              result.score,
              COALESCE(
                market.potential_band,
                'insufficient_data'
              ) AS market_potential,
              COALESCE(
                result.why_now->>'summary',
                result.event_label
              ) AS why_now,
              COALESCE(
                ARRAY(
                  SELECT jsonb_array_elements_text(
                    COALESCE(result.evidence_summary->'strongest', '[]'::jsonb)
                  )
                ),
                '{}'::text[]
              ) AS strongest_evidence
            FROM opportunity.deliveries delivery
            CROSS JOIN LATERAL
              unnest(delivery.result_ids) WITH ORDINALITY AS selected(result_id, position)
            JOIN opportunity.results result ON result.id = selected.result_id
            JOIN legacy.apps app ON app.appid = result.appid
            LEFT JOIN opportunity.market_context_snapshots market
              ON market.id = result.market_context_snapshot_id
            WHERE delivery.id = $1
            ORDER BY selected.position
            LIMIT 100
          `,
          [row.id],
        );
        const presentedChanges = await presentOpportunityChanges(
          client,
          results.rows.map((result) => result.change),
          results.rows.map((result) => result.event_label),
        );
        deliveries.push({
          availableResultCount:
            row.rendered_payload.availableResultCount ?? results.rowCount ?? 0,
          channel: row.channel,
          deliveryKind: row.delivery_kind,
          destinationCiphertext: row.destination_ciphertext,
          id: row.id,
          idempotencyKey: row.idempotency_key,
          overviewUrl: row.rendered_payload.canonicalOverviewUrl ?? "",
          results: results.rows.map((result, index) => {
            const changeSummary = opportunityChangeSummary(
              presentedChanges[index] ?? null,
              result.event_label,
            );
            return {
              appid: result.appid,
              changeSummary,
              eventLabel: result.event_label,
              id: result.id,
              marketPotential: result.market_potential,
              name: decodeOpportunityText(result.name),
              score: numberValue(result.score),
              strongestEvidence: cleanOpportunityEvidence(
                result.strongest_evidence,
                changeSummary,
              ),
              whyNow: `${changeSummary} The game matches your sourcing criteria.`,
            };
          }),
        });
      }
      return deliveries;
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

export function renderOpportunityDelivery(work: OpportunityDeliveryWork): {
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
    return [
      `${index + 1}. ${name} — ${resultLabel(result.eventLabel)}`,
      summary,
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
      return `
        <article style="border:1px solid #dbe4ea;border-radius:12px;padding:16px;margin:12px 0">
          <h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(name)}</h2>
          <p style="margin:0 0 8px;color:#475569">${escapeHtml(resultLabel(result.eventLabel))} · ${escapeHtml(potentialLabel(result.marketPotential))} market potential</p>
          <p style="margin:0 0 12px">${escapeHtml(summary)}</p>
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
      return [
        { type: "divider" },
        {
          text: {
            text: `*<${link}|${escapeSlackMrkdwn(name)}>* · ${resultLabel(result.eventLabel)}\n${escapeSlackMrkdwn(summary)}\n_${potentialLabel(result.marketPotential)} market potential_`,
            type: "mrkdwn",
          },
          type: "section",
        },
      ];
    }),
  ];
  return { html, slackBlocks, subject, text };
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
  ) {}

  async runOnce(limit = 10): Promise<number> {
    const deliveries = await this.repository.claim(this.workerId, limit);
    for (const delivery of deliveries) {
      try {
        const destination = this.cipher.decrypt(delivery.destinationCiphertext);
        const rendered = renderOpportunityDelivery(delivery);
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
