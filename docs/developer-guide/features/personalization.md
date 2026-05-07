# Personalized Dashboard Architecture

This document provides a complete technical specification for the PublisherIQ personalized dashboard feature, including database schema, alert detection system, API routes, and UI components.

**Last Updated:** May 7, 2026

**Status:** Implemented (v2.4)

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [Database Schema](#database-schema)
3. [Alert Detection System](#alert-detection-system)
4. [API Routes](#api-routes)
5. [UI Components](#ui-components)
6. [Implementation Phases](#implementation-phases)
7. [Testing & Verification](#testing--verification)
8. [Implementation Notes](#implementation-notes)

---

## Feature Overview

### Problem Statement

PublisherIQ has 70K+ games with constantly updating metrics. Users (BI analysts, product managers) care about specific entities relevant to their work but currently must:
- Search/navigate to entities every session
- Manually check for changes
- Have no way to know when something interesting happens

### Solution

Let users **pin** entities (games, publishers, developers) to create a personalized dashboard. The system watches pinned entities and **surfaces changes automatically** via smart alerts. The `/unreleased` page uses the same `game` pins for its Watch button.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERACTIONS                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Pin Button  │  │ My Dashboard│  │ Alert Feed  │  │ Preferences │        │
│  │ (Detail pg) │  │ (Insights)  │  │ (Header)    │  │ (Settings)  │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼────────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
│  POST /api/pins    GET /api/pins/check    GET /api/alerts    PATCH /api/prefs│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATABASE (Supabase)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ user_pins   │  │ user_alerts │  │ user_alert_ │  │ alert_detection_    │ │
│  │             │  │             │  │ preferences │  │ state               │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼───────────────────────────────────────┼──────────┘
          │                │                                       │
          │                │                                       │
┌─────────┼────────────────┼───────────────────────────────────────┼──────────┐
│         │    ALERT DETECTION WORKER (GitHub Actions - Hourly)    │          │
│         │                │                                       │          │
│         ▼                ▼                                       ▼          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  1. Query pinned entities with current metrics (RPC function)       │    │
│  │  2. Compare against baseline state                                   │    │
│  │  3. Apply user sensitivity preferences                               │    │
│  │  4. Create alerts with dedup key                                     │    │
│  │  5. Update baseline state                                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          │ Real-time (Supabase Trigger)
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Price Change Detection: Trigger on apps.current_price_cents UPDATE         │
│  New Release Detection: Trigger on app_publishers/app_developers INSERT     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Middleware | GitHub Actions + Supabase triggers | Existing infrastructure, no new services |
| Pin storage | Single table with entity_type enum | Simpler queries, easier to extend |
| Deduplication | Daily composite key | Prevents spam, allows next-day re-alert |
| Folders | Deferred to v2 | Keep v1 simple, gather user feedback |
| Pub/Dev alerts | New releases only | Simpler scope, aggregate alerts in v2 |

---

## Database Schema

### Entity-Relationship Diagram

```
┌──────────────────┐         ┌──────────────────┐
│   user_profiles  │         │      apps        │
│   (existing)     │         │   (existing)     │
│──────────────────│         │──────────────────│
│ id (UUID) PK     │◄────┐   │ appid (INT) PK   │◄────┐
│ email            │     │   │ name             │     │
│ role             │     │   │ current_price... │     │
└──────────────────┘     │   └──────────────────┘     │
                         │                            │
                         │   ┌──────────────────┐     │
                         │   │   publishers     │     │
                         │   │   (existing)     │     │
                         │   │──────────────────│     │
                         │   │ id (INT) PK      │◄────┼────┐
                         │   │ name             │     │    │
                         │   └──────────────────┘     │    │
                         │                            │    │
                         │   ┌──────────────────┐     │    │
                         │   │   developers     │     │    │
                         │   │   (existing)     │     │    │
                         │   │──────────────────│     │    │
                         │   │ id (INT) PK      │◄────┼────┼────┐
                         │   │ name             │     │    │    │
                         │   └──────────────────┘     │    │    │
                         │                            │    │    │
┌────────────────────────┴────────────────────────────┴────┴────┴────┐
│                          user_pins (NEW)                            │
│─────────────────────────────────────────────────────────────────────│
│ id (UUID) PK                                                        │
│ user_id (UUID) FK → user_profiles.id                               │
│ entity_type ENUM ('game', 'publisher', 'developer')                │
│ entity_id (INT) - references apps.appid OR publishers.id OR dev.id │
│ display_name (TEXT) - cached entity name                           │
│ pin_order (INT) - for drag-and-drop                                │
│ pinned_at (TIMESTAMPTZ)                                            │
│ UNIQUE(user_id, entity_type, entity_id)                            │
└────────────────────────────────────────────────────────────────────┘
         │
         │ FK
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                        user_alerts (NEW)                            │
│─────────────────────────────────────────────────────────────────────│
│ id (UUID) PK                                                        │
│ user_id (UUID) FK → user_profiles.id                               │
│ pin_id (UUID) FK → user_pins.id                                    │
│ alert_type ENUM (see below)                                        │
│ severity ENUM ('low', 'medium', 'high')                            │
│ title (TEXT)                                                        │
│ description (TEXT)                                                  │
│ metric_name (TEXT) - 'ccu', 'reviews', 'price', etc.               │
│ previous_value (DECIMAL)                                            │
│ current_value (DECIMAL)                                             │
│ change_percent (DECIMAL)                                            │
│ dedup_key (TEXT) UNIQUE - prevents duplicate alerts                 │
│ is_read (BOOLEAN) DEFAULT FALSE                                     │
│ read_at (TIMESTAMPTZ)                                               │
│ created_at (TIMESTAMPTZ)                                            │
│ source_data (JSONB) - debugging info                                │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                   user_alert_preferences (NEW)                      │
│─────────────────────────────────────────────────────────────────────│
│ user_id (UUID) PK FK → user_profiles.id                            │
│ alerts_enabled (BOOLEAN) DEFAULT TRUE                               │
│ email_digest_enabled (BOOLEAN) DEFAULT FALSE                        │
│ email_digest_frequency (TEXT) - 'daily', 'weekly'                  │
│ ccu_sensitivity (DECIMAL) DEFAULT 1.0                               │
│ review_sensitivity (DECIMAL) DEFAULT 1.0                            │
│ sentiment_sensitivity (DECIMAL) DEFAULT 1.0                         │
│ alert_ccu_spike (BOOLEAN) DEFAULT TRUE                              │
│ alert_ccu_drop (BOOLEAN) DEFAULT TRUE                               │
│ alert_trend_reversal (BOOLEAN) DEFAULT TRUE                         │
│ alert_review_surge (BOOLEAN) DEFAULT TRUE                           │
│ alert_sentiment_shift (BOOLEAN) DEFAULT TRUE                        │
│ alert_price_change (BOOLEAN) DEFAULT TRUE                           │
│ alert_new_release (BOOLEAN) DEFAULT TRUE                            │
│ alert_milestone (BOOLEAN) DEFAULT TRUE                              │
│ created_at, updated_at (TIMESTAMPTZ)                                │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                  user_pin_alert_settings (NEW)                      │
│─────────────────────────────────────────────────────────────────────│
│ pin_id (UUID) PK FK → user_pins.id                                 │
│ use_custom_settings (BOOLEAN) DEFAULT FALSE                         │
│ alerts_enabled (BOOLEAN) - NULL = inherit from global              │
│ ccu_sensitivity (DECIMAL) - NULL = inherit                          │
│ review_sensitivity (DECIMAL) - NULL = inherit                       │
│ sentiment_sensitivity (DECIMAL) - NULL = inherit                    │
│ alert_ccu_spike through alert_milestone (BOOLEAN) - NULL = inherit │
│ created_at, updated_at (TIMESTAMPTZ)                                │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                    alert_detection_state (NEW)                      │
│─────────────────────────────────────────────────────────────────────│
│ id (BIGSERIAL) PK                                                   │
│ entity_type ENUM ('game', 'publisher', 'developer')                │
│ entity_id (INT)                                                     │
│ ccu_7d_avg (INT) - baseline for spike/drop detection               │
│ ccu_7d_max (INT)                                                    │
│ ccu_7d_min (INT)                                                    │
│ ccu_prev_value (INT)                                                │
│ review_velocity_7d_avg (DECIMAL)                                    │
│ positive_ratio_prev (DECIMAL)                                       │
│ total_reviews_prev (INT)                                            │
│ price_cents_prev (INT)                                              │
│ discount_percent_prev (INT)                                         │
│ trend_30d_direction_prev (TEXT)                                     │
│ updated_at (TIMESTAMPTZ)                                            │
│ UNIQUE(entity_type, entity_id)                                      │
└────────────────────────────────────────────────────────────────────┘
```

### SQL Migration

```sql
-- Migration: add_personalization.sql
-- Description: Add user pins, alerts, and preferences tables

-- Enums
CREATE TYPE entity_type AS ENUM ('game', 'publisher', 'developer');
CREATE TYPE alert_type AS ENUM (
    'ccu_spike',
    'ccu_drop',
    'trend_reversal',
    'review_surge',
    'sentiment_shift',
    'price_change',
    'new_release',
    'milestone'
);
CREATE TYPE alert_severity AS ENUM ('low', 'medium', 'high');

-- User Pins Table
CREATE TABLE user_pins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    entity_type entity_type NOT NULL,
    entity_id INTEGER NOT NULL,
    display_name TEXT NOT NULL,
    pin_order INTEGER DEFAULT 0,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(user_id, entity_type, entity_id)
);

CREATE INDEX idx_user_pins_user_id ON user_pins(user_id, pin_order);
CREATE INDEX idx_user_pins_entity ON user_pins(entity_type, entity_id);

-- User Alerts Table
CREATE TABLE user_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    pin_id UUID NOT NULL REFERENCES user_pins(id) ON DELETE CASCADE,
    alert_type alert_type NOT NULL,
    severity alert_severity NOT NULL DEFAULT 'medium',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    metric_name TEXT,
    previous_value DECIMAL,
    current_value DECIMAL,
    change_percent DECIMAL,
    dedup_key TEXT NOT NULL UNIQUE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_data JSONB
);

CREATE INDEX idx_user_alerts_user_unread ON user_alerts(user_id, created_at DESC)
    WHERE is_read = FALSE;
CREATE INDEX idx_user_alerts_user_date ON user_alerts(user_id, created_at DESC);

-- User Alert Preferences Table
CREATE TABLE user_alert_preferences (
    user_id UUID PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
    alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_digest_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    email_digest_frequency TEXT DEFAULT 'daily',
    ccu_sensitivity DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    review_sensitivity DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    sentiment_sensitivity DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    alert_ccu_spike BOOLEAN NOT NULL DEFAULT TRUE,
    alert_ccu_drop BOOLEAN NOT NULL DEFAULT TRUE,
    alert_trend_reversal BOOLEAN NOT NULL DEFAULT TRUE,
    alert_review_surge BOOLEAN NOT NULL DEFAULT TRUE,
    alert_sentiment_shift BOOLEAN NOT NULL DEFAULT TRUE,
    alert_price_change BOOLEAN NOT NULL DEFAULT TRUE,
    alert_new_release BOOLEAN NOT NULL DEFAULT TRUE,
    alert_milestone BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert Detection State Table
CREATE TABLE alert_detection_state (
    id BIGSERIAL PRIMARY KEY,
    entity_type entity_type NOT NULL,
    entity_id INTEGER NOT NULL,
    ccu_7d_avg INTEGER,
    ccu_7d_max INTEGER,
    ccu_7d_min INTEGER,
    ccu_prev_value INTEGER,
    review_velocity_7d_avg DECIMAL(8,4),
    positive_ratio_prev DECIMAL(5,4),
    total_reviews_prev INTEGER,
    price_cents_prev INTEGER,
    discount_percent_prev INTEGER,
    trend_30d_direction_prev TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(entity_type, entity_id)
);

CREATE INDEX idx_alert_state_entity ON alert_detection_state(entity_type, entity_id);

-- Row Level Security
ALTER TABLE user_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_alert_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own pins" ON user_pins
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own pins" ON user_pins
    FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own pins" ON user_pins
    FOR DELETE USING (user_id = auth.uid());
CREATE POLICY "Users can update own pins" ON user_pins
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can read own alerts" ON user_alerts
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can update own alerts" ON user_alerts
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can read own preferences" ON user_alert_preferences
    FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can manage own preferences" ON user_alert_preferences
    FOR ALL USING (user_id = auth.uid());
```

### RPC Functions

```sql
-- Function: get_pinned_entities_with_metrics
-- Efficiently fetches all pinned entities for alert processing

CREATE OR REPLACE FUNCTION get_pinned_entities_with_metrics()
RETURNS TABLE (
    user_id UUID,
    pin_id UUID,
    entity_type entity_type,
    entity_id INTEGER,
    display_name TEXT,
    ccu_current INTEGER,
    ccu_7d_avg INTEGER,
    review_velocity DECIMAL,
    positive_ratio DECIMAL,
    total_reviews INTEGER,
    price_cents INTEGER,
    discount_percent INTEGER,
    trend_30d_direction TEXT,
    sensitivity_ccu DECIMAL,
    sensitivity_review DECIMAL,
    sensitivity_sentiment DECIMAL,
    alerts_enabled BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.user_id,
        p.id as pin_id,
        p.entity_type,
        p.entity_id,
        p.display_name,
        CASE WHEN p.entity_type = 'game' THEN ldm.ccu_peak END as ccu_current,
        CASE WHEN p.entity_type = 'game' THEN ads.ccu_7d_avg END as ccu_7d_avg,
        CASE WHEN p.entity_type = 'game' THEN at.review_velocity_7d END as review_velocity,
        CASE WHEN p.entity_type = 'game' THEN
            CASE WHEN ldm.total_reviews > 0
                THEN ldm.positive_reviews::DECIMAL / ldm.total_reviews
                ELSE NULL
            END
        END as positive_ratio,
        CASE WHEN p.entity_type = 'game' THEN ldm.total_reviews END as total_reviews,
        CASE WHEN p.entity_type = 'game' THEN a.current_price_cents END as price_cents,
        CASE WHEN p.entity_type = 'game' THEN a.current_discount_percent END as discount_percent,
        CASE WHEN p.entity_type = 'game' THEN at.trend_30d_direction::TEXT END as trend_30d_direction,
        COALESCE(pref.ccu_sensitivity, 1.0) as sensitivity_ccu,
        COALESCE(pref.review_sensitivity, 1.0) as sensitivity_review,
        COALESCE(pref.sentiment_sensitivity, 1.0) as sensitivity_sentiment,
        COALESCE(pref.alerts_enabled, TRUE) as alerts_enabled
    FROM user_pins p
    LEFT JOIN apps a ON p.entity_type = 'game' AND p.entity_id = a.appid
    LEFT JOIN latest_daily_metrics ldm ON p.entity_type = 'game' AND p.entity_id = ldm.appid
    LEFT JOIN app_trends at ON p.entity_type = 'game' AND p.entity_id = at.appid
    LEFT JOIN alert_detection_state ads ON p.entity_type = ads.entity_type AND p.entity_id = ads.entity_id
    LEFT JOIN user_alert_preferences pref ON p.user_id = pref.user_id
    WHERE COALESCE(pref.alerts_enabled, TRUE) = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: get_user_pins_with_metrics
-- Get user's pins with current metrics for dashboard display

CREATE OR REPLACE FUNCTION get_user_pins_with_metrics(p_user_id UUID)
RETURNS TABLE (
    pin_id UUID,
    entity_type entity_type,
    entity_id INTEGER,
    display_name TEXT,
    pin_order INTEGER,
    pinned_at TIMESTAMPTZ,
    ccu_current INTEGER,
    ccu_change_pct DECIMAL,
    total_reviews INTEGER,
    positive_pct DECIMAL,
    review_velocity DECIMAL,
    trend_direction TEXT,
    price_cents INTEGER,
    discount_percent INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id as pin_id,
        p.entity_type,
        p.entity_id,
        p.display_name,
        p.pin_order,
        p.pinned_at,
        ldm.ccu_peak as ccu_current,
        at.trend_30d_change_pct as ccu_change_pct,
        ldm.total_reviews,
        CASE WHEN ldm.total_reviews > 0
            THEN (ldm.positive_reviews::DECIMAL / ldm.total_reviews * 100)::DECIMAL(5,2)
            ELSE NULL
        END as positive_pct,
        at.review_velocity_7d as review_velocity,
        at.trend_30d_direction::TEXT as trend_direction,
        a.current_price_cents as price_cents,
        a.current_discount_percent as discount_percent
    FROM user_pins p
    LEFT JOIN apps a ON p.entity_type = 'game' AND p.entity_id = a.appid
    LEFT JOIN latest_daily_metrics ldm ON p.entity_type = 'game' AND p.entity_id = ldm.appid
    LEFT JOIN app_trends at ON p.entity_type = 'game' AND p.entity_id = at.appid
    WHERE p.user_id = p_user_id
    ORDER BY p.pin_order ASC, p.pinned_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Alert Detection System

### Alert Types & Thresholds

| Alert Type | Trigger Condition | Default Threshold | Severity |
|------------|-------------------|-------------------|----------|
| `ccu_spike` | CCU > 7-day avg by threshold | +50% | Medium (High if >100%) |
| `ccu_drop` | CCU < 7-day avg by threshold | -50% | Medium (High if >75%) |
| `trend_reversal` | 30-day trend direction changed | Direction flip | Medium |
| `review_surge` | Velocity > normal by multiplier | 3x average | Medium (High if >5x) |
| `sentiment_shift` | Positive ratio changed | +/-5% | Medium |
| `price_change` | Price or discount changed | Any change | Low (High if >50% off) |
| `new_release` | Pinned pub/dev released new game | New app link | High |
| `milestone` | Review count crossed threshold | 10K, 100K, 1M | Medium (High if >100K) |

### Threshold Configuration

```typescript
// packages/shared/src/alert-thresholds.ts

export const ALERT_THRESHOLDS = {
  // CCU Spike/Drop
  CCU_CHANGE_PERCENT: 50,
  CCU_MIN_ABSOLUTE: 100,  // Ignore tiny games

  // Review Surge
  REVIEW_VELOCITY_MULTIPLIER: 3,
  REVIEW_MIN_DAILY: 5,

  // Sentiment Shift
  SENTIMENT_CHANGE_PERCENT: 5,
  SENTIMENT_MIN_REVIEWS: 50,

  // Milestones
  MILESTONES: [1000, 10000, 50000, 100000, 500000, 1000000],
} as const;
```

### Deduplication Strategy

**Key Format:** `{user_id}:{entity_type}:{entity_id}:{alert_type}:{date}`

Example: `abc123:game:730:ccu_spike:2026-01-11`

This ensures:
- Same alert type for same entity = max 1 per day per user
- Different alert types are independent
- Next day allows new alerts if condition persists
- Different users get independent alerts

### Worker Implementation

```typescript
// packages/ingestion/src/workers/alert-detection-worker.ts

import { createServiceClient } from '@publisheriq/database';
import { logger } from '@publisheriq/shared';
import { ALERT_THRESHOLDS } from '@publisheriq/shared/alert-thresholds';

const log = logger.child({ worker: 'alert-detection' });

async function main(): Promise<void> {
  const startTime = Date.now();
  const supabase = createServiceClient();

  log.info('Starting alert detection');

  // 1. Get all pinned entities with current metrics
  const { data: pinnedEntities, error } = await supabase
    .rpc('get_pinned_entities_with_metrics');

  if (error) {
    log.error('Failed to fetch pinned entities', { error });
    process.exit(1);
  }

  log.info('Fetched pinned entities', { count: pinnedEntities?.length ?? 0 });

  // 2. Get previous detection state
  const entityKeys = pinnedEntities?.map(e => `${e.entity_type}:${e.entity_id}`) ?? [];
  const { data: prevStates } = await supabase
    .from('alert_detection_state')
    .select('*');

  const stateMap = new Map(
    prevStates?.map(s => [`${s.entity_type}:${s.entity_id}`, s]) ?? []
  );

  // 3. Check each entity for alerts
  const alertsToCreate: AlertRecord[] = [];
  const stateUpdates: StateRecord[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (const entity of pinnedEntities ?? []) {
    if (!entity.alerts_enabled) continue;

    const stateKey = `${entity.entity_type}:${entity.entity_id}`;
    const prevState = stateMap.get(stateKey);

    // First time seeing this entity - create baseline
    if (!prevState) {
      stateUpdates.push(createInitialState(entity));
      continue;
    }

    // Check for CCU spike/drop (games only)
    if (entity.entity_type === 'game' && entity.ccu_current && prevState.ccu_7d_avg) {
      const ccuAlert = checkCcuChange(
        entity.ccu_current,
        prevState.ccu_7d_avg,
        entity.sensitivity_ccu
      );
      if (ccuAlert) {
        alertsToCreate.push({
          user_id: entity.user_id,
          pin_id: entity.pin_id,
          alert_type: ccuAlert.type,
          severity: ccuAlert.severity,
          title: ccuAlert.title,
          description: `${entity.display_name}: ${ccuAlert.description}`,
          metric_name: 'ccu',
          previous_value: prevState.ccu_7d_avg,
          current_value: entity.ccu_current,
          change_percent: ccuAlert.changePercent,
          dedup_key: `${entity.user_id}:${entity.entity_type}:${entity.entity_id}:${ccuAlert.type}:${today}`,
        });
      }
    }

    // Check for trend reversal
    if (entity.trend_30d_direction && prevState.trend_30d_direction_prev) {
      const trendAlert = checkTrendReversal(
        entity.trend_30d_direction,
        prevState.trend_30d_direction_prev
      );
      if (trendAlert) {
        alertsToCreate.push({
          user_id: entity.user_id,
          pin_id: entity.pin_id,
          alert_type: 'trend_reversal',
          severity: 'medium',
          title: trendAlert.title,
          description: `${entity.display_name}: ${trendAlert.description}`,
          dedup_key: `${entity.user_id}:${entity.entity_type}:${entity.entity_id}:trend_reversal:${today}`,
        });
      }
    }

    // ... additional checks for review_surge, sentiment_shift, milestone

    // Prepare state update
    stateUpdates.push({
      entity_type: entity.entity_type,
      entity_id: entity.entity_id,
      ccu_prev_value: entity.ccu_current,
      positive_ratio_prev: entity.positive_ratio,
      total_reviews_prev: entity.total_reviews,
      price_cents_prev: entity.price_cents,
      discount_percent_prev: entity.discount_percent,
      trend_30d_direction_prev: entity.trend_30d_direction,
      updated_at: new Date().toISOString(),
    });
  }

  // 4. Batch insert alerts (ignore duplicates)
  if (alertsToCreate.length > 0) {
    const { error: insertError } = await supabase
      .from('user_alerts')
      .upsert(alertsToCreate, {
        onConflict: 'dedup_key',
        ignoreDuplicates: true
      });

    if (insertError) {
      log.error('Failed to create alerts', { error: insertError });
    } else {
      log.info('Created alerts', { count: alertsToCreate.length });
    }
  }

  // 5. Update detection state
  if (stateUpdates.length > 0) {
    await supabase
      .from('alert_detection_state')
      .upsert(stateUpdates, { onConflict: 'entity_type,entity_id' });
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  log.info('Alert detection completed', {
    durationSeconds: duration,
    entitiesChecked: pinnedEntities?.length ?? 0,
    alertsCreated: alertsToCreate.length,
  });
}

main().catch(console.error);
```

### GitHub Actions Workflow

```yaml
# .github/workflows/alert-detection.yml

name: Alert Detection

on:
  schedule:
    # Run hourly, 15 minutes after CCU sync
    - cron: '15 * * * *'
  workflow_dispatch:

env:
  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}

jobs:
  detect:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages
        run: pnpm build

      - name: Detect alerts
        run: pnpm --filter @publisheriq/ingestion detect-alerts
        env:
          GITHUB_RUN_ID: ${{ github.run_id }}
```

### Real-time Price Change Trigger

```sql
-- Trigger for immediate price change detection

CREATE OR REPLACE FUNCTION detect_price_change_alert()
RETURNS TRIGGER AS $$
DECLARE
    v_pin RECORD;
    v_dedup_key TEXT;
    v_title TEXT;
BEGIN
    IF OLD.current_price_cents = NEW.current_price_cents
       AND COALESCE(OLD.current_discount_percent, 0) = COALESCE(NEW.current_discount_percent, 0) THEN
        RETURN NEW;
    END IF;

    FOR v_pin IN
        SELECT p.id as pin_id, p.user_id, p.display_name, pref.alert_price_change
        FROM user_pins p
        LEFT JOIN user_alert_preferences pref ON p.user_id = pref.user_id
        WHERE p.entity_type = 'game'
          AND p.entity_id = NEW.appid
          AND COALESCE(pref.alerts_enabled, TRUE) = TRUE
          AND COALESCE(pref.alert_price_change, TRUE) = TRUE
    LOOP
        v_dedup_key := v_pin.user_id || ':game:' || NEW.appid || ':price_change:' || CURRENT_DATE;

        IF COALESCE(NEW.current_discount_percent, 0) > COALESCE(OLD.current_discount_percent, 0) THEN
            v_title := 'Sale: ' || NEW.current_discount_percent || '% off';
        ELSIF COALESCE(NEW.current_discount_percent, 0) < COALESCE(OLD.current_discount_percent, 0)
              AND COALESCE(OLD.current_discount_percent, 0) > 0 THEN
            v_title := 'Sale Ended';
        ELSIF NEW.current_price_cents > OLD.current_price_cents THEN
            v_title := 'Price Increased';
        ELSE
            v_title := 'Price Decreased';
        END IF;

        INSERT INTO user_alerts (
            user_id, pin_id, alert_type, severity, title, description,
            metric_name, previous_value, current_value, dedup_key
        ) VALUES (
            v_pin.user_id,
            v_pin.pin_id,
            'price_change',
            CASE WHEN COALESCE(NEW.current_discount_percent, 0) >= 50 THEN 'high' ELSE 'low' END,
            v_title,
            v_pin.display_name || ': ' || v_title,
            'price_cents',
            OLD.current_price_cents,
            NEW.current_price_cents,
            v_dedup_key
        )
        ON CONFLICT (dedup_key) DO NOTHING;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_price_change_alert
    AFTER UPDATE OF current_price_cents, current_discount_percent ON apps
    FOR EACH ROW
    EXECUTE FUNCTION detect_price_change_alert();
```

---

## API Routes

### Pin Management

```typescript
// apps/admin/src/app/api/pins/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getUserWithProfile } from '@/lib/supabase/server';

// GET /api/pins - List user's pins
export async function GET() {
  const result = await getUserWithProfile();
  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .rpc('get_user_pins_with_metrics', { p_user_id: result.user.id });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/pins - Create a pin
export async function POST(request: NextRequest) {
  const result = await getUserWithProfile();
  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { entityType, entityId, displayName } = await request.json();

  if (!entityType || !entityId || !displayName) {
    return NextResponse.json(
      { error: 'entityType, entityId, and displayName are required' },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('user_pins')
    .insert({
      user_id: result.user.id,
      entity_type: entityType,
      entity_id: entityId,
      display_name: displayName,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Already pinned' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
```

```typescript
// apps/admin/src/app/api/pins/[id]/route.ts

// DELETE /api/pins/[id] - Remove a pin
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = await getUserWithProfile();
  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from('user_pins')
    .delete()
    .eq('id', params.id)
    .eq('user_id', result.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

### Alert Management

```typescript
// apps/admin/src/app/api/alerts/route.ts

// GET /api/alerts - List user's alerts
export async function GET(request: NextRequest) {
  const result = await getUserWithProfile();
  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unread') === 'true';
  const limit = parseInt(searchParams.get('limit') ?? '50');

  const supabase = createServerClient();
  let query = supabase
    .from('user_alerts')
    .select('*, user_pins(display_name, entity_type, entity_id)')
    .eq('user_id', result.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq('is_read', false);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
```

```typescript
// apps/admin/src/app/api/alerts/count/route.ts

// GET /api/alerts/count - Get unread count for badge
export async function GET() {
  const result = await getUserWithProfile();
  if (!result) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { count, error } = await supabase
    .from('user_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', result.user.id)
    .eq('is_read', false);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ count: count ?? 0 });
}
```

### Per-Pin Alert Settings

```typescript
// apps/admin/src/app/api/pins/[id]/alert-settings/route.ts

// GET /api/pins/[id]/alert-settings - Get settings with inheritance
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Returns:
  // - settings: Raw DB values (with NULLs for inherited fields)
  // - inherited: Global preferences
  // - effective: Merged values for display
}

// PUT /api/pins/[id]/alert-settings - Update per-pin overrides
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Updates user_pin_alert_settings table
  // NULL values = inherit from global preferences
}

// DELETE /api/pins/[id]/alert-settings - Reset to inherit all
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Removes custom settings, reverts to global defaults
}
```

**Response Structure:**
```json
{
  "settings": {
    "use_custom_settings": true,
    "alerts_enabled": null,      // null = inherit
    "ccu_sensitivity": 1.5,      // custom value
    "alert_ccu_spike": null      // null = inherit
  },
  "inherited": {
    "alerts_enabled": true,
    "ccu_sensitivity": 1.0,
    "alert_ccu_spike": true
  },
  "effective": {
    "alerts_enabled": true,      // inherited
    "ccu_sensitivity": 1.5,      // custom
    "alert_ccu_spike": true      // inherited
  }
}
```

---

## UI Components

### PinButton Component

```typescript
// apps/admin/src/components/PinButton.tsx

'use client';

import { useState, useTransition } from 'react';
import { Pin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PinButtonProps {
  entityType: 'game' | 'publisher' | 'developer';
  entityId: number;
  displayName: string;
  initialPinned?: boolean;
  initialPinId?: string;
}

export function PinButton({
  entityType,
  entityId,
  displayName,
  initialPinned = false,
  initialPinId,
}: PinButtonProps) {
  const [isPinned, setIsPinned] = useState(initialPinned);
  const [pinId, setPinId] = useState(initialPinId);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      if (isPinned && pinId) {
        // Unpin
        const res = await fetch(`/api/pins/${pinId}`, { method: 'DELETE' });
        if (res.ok) {
          setIsPinned(false);
          setPinId(undefined);
        }
      } else {
        // Pin
        const res = await fetch('/api/pins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType, entityId, displayName }),
        });
        if (res.ok) {
          const data = await res.json();
          setIsPinned(true);
          setPinId(data.id);
        }
      }
    });
  };

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body-sm font-medium',
        'transition-colors border',
        isPinned
          ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/30 hover:bg-accent-blue/20'
          : 'text-text-secondary hover:text-text-primary bg-surface-elevated hover:bg-surface-overlay border-border-subtle',
        isPending && 'opacity-50 cursor-not-allowed'
      )}
      title={isPinned ? 'Unpin from dashboard' : 'Pin to dashboard'}
    >
      <Pin className={cn('h-3.5 w-3.5', isPinned && 'fill-current')} />
      {isPinned ? 'Pinned' : 'Pin'}
    </button>
  );
}
```

### AlertBadge Component

```typescript
// apps/admin/src/components/alerts/AlertBadge.tsx

'use client';

import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AlertBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/alerts/count');
        if (res.ok) {
          const data = await res.json();
          setCount(data.count);
        }
      } catch (error) {
        console.error('Failed to fetch alert count:', error);
      }
    };

    fetchCount();
    // Poll every 60 seconds
    const interval = setInterval(fetchCount, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative">
      <Bell className="h-5 w-5 text-text-secondary" />
      {count > 0 && (
        <span
          className={cn(
            'absolute -top-1 -right-1 flex items-center justify-center',
            'min-w-[18px] h-[18px] px-1 rounded-full',
            'bg-accent-red text-white text-xs font-medium'
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </div>
  );
}
```

### MyDashboardTab Component

```typescript
// apps/admin/src/app/(main)/insights/components/MyDashboardTab.tsx

'use client';

import { useEffect, useState } from 'react';
import { TrendSparkline } from '@/components/data-display/Sparkline';
import { AlertFeed } from '@/components/alerts/AlertFeed';
import { formatNumber, formatPrice } from '@/lib/format';

interface PinnedEntity {
  pin_id: string;
  entity_type: 'game' | 'publisher' | 'developer';
  entity_id: number;
  display_name: string;
  ccu_current: number | null;
  ccu_change_pct: number | null;
  total_reviews: number | null;
  positive_pct: number | null;
  review_velocity: number | null;
  trend_direction: string | null;
  price_cents: number | null;
  discount_percent: number | null;
}

export function MyDashboardTab() {
  const [pins, setPins] = useState<PinnedEntity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPins = async () => {
      try {
        const res = await fetch('/api/pins');
        if (res.ok) {
          const data = await res.json();
          setPins(data);
        }
      } catch (error) {
        console.error('Failed to fetch pins:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchPins();
  }, []);

  if (loading) {
    return <div className="animate-pulse">Loading...</div>;
  }

  if (pins.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <p className="text-lg mb-2">No pinned items yet</p>
        <p className="text-body-sm">
          Pin games, publishers, or developers from their detail pages
          to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Recent Alerts */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Recent Alerts</h2>
        <AlertFeed limit={5} />
      </section>

      {/* Pinned Items Grid */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Pinned</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pins.map((pin) => (
            <PinnedCard key={pin.pin_id} pin={pin} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PinnedCard({ pin }: { pin: PinnedEntity }) {
  const href = pin.entity_type === 'game'
    ? `/apps/${pin.entity_id}`
    : pin.entity_type === 'publisher'
    ? `/publishers/${pin.entity_id}`
    : `/developers/${pin.entity_id}`;

  return (
    <a
      href={href}
      className="block p-4 rounded-lg bg-surface-elevated border border-border-subtle hover:border-accent-blue/50 transition-colors"
    >
      <div className="font-medium text-text-primary truncate mb-2">
        {pin.display_name}
      </div>

      {pin.entity_type === 'game' && (
        <div className="space-y-1 text-body-sm text-text-secondary">
          {pin.ccu_current !== null && (
            <div className="flex justify-between">
              <span>CCU</span>
              <span className="text-text-primary">
                {formatNumber(pin.ccu_current)}
                {pin.ccu_change_pct !== null && (
                  <span className={pin.ccu_change_pct >= 0 ? 'text-trend-up' : 'text-trend-down'}>
                    {' '}{pin.ccu_change_pct >= 0 ? '+' : ''}{pin.ccu_change_pct.toFixed(1)}%
                  </span>
                )}
              </span>
            </div>
          )}
          {pin.total_reviews !== null && (
            <div className="flex justify-between">
              <span>Reviews</span>
              <span className="text-text-primary">
                {formatNumber(pin.total_reviews)}
                {pin.positive_pct !== null && (
                  <span className="text-text-secondary"> ({pin.positive_pct.toFixed(0)}%)</span>
                )}
              </span>
            </div>
          )}
          {pin.price_cents !== null && (
            <div className="flex justify-between">
              <span>Price</span>
              <span className="text-text-primary">
                {pin.price_cents === 0 ? 'Free' : formatPrice(pin.price_cents)}
                {pin.discount_percent && pin.discount_percent > 0 && (
                  <span className="text-accent-green ml-1">-{pin.discount_percent}%</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </a>
  );
}
```

---

## Implementation Phases

### Phase 1: Database Schema
1. Create migration file with all tables, enums, indexes
2. Add RPC functions for efficient queries
3. Apply migration and verify schema
4. Regenerate TypeScript types

### Phase 2: API Routes
1. Implement pin CRUD routes
2. Implement alert listing and mark-read routes
3. Implement alert count endpoint
4. Implement preferences routes

### Phase 3: UI Components
1. Create PinButton component
2. Add pin buttons to entity detail pages
3. Create AlertBadge component
4. Add alert badge to sidebar/header

### Phase 4: Dashboard Tab
1. Create MyDashboardTab component
2. Add tab to InsightsTabs
3. Implement AlertFeed component
4. Style with existing design tokens

### Phase 5: Alert Detection
1. Create alert detection worker
2. Add thresholds to shared constants
3. Create GitHub Actions workflow
4. Add real-time price change trigger

---

## Testing & Verification

### Manual Testing Checklist

1. **Database Migration**
   - [ ] Tables created with correct constraints
   - [ ] RLS policies working (user can only see own data)
   - [ ] RPC functions returning expected data

2. **Pin Management**
   - [ ] Pin button appears on game detail page
   - [ ] Pin button appears on publisher detail page
   - [ ] Pin button appears on developer detail page
   - [ ] Clicking pin creates record in database
   - [ ] Clicking pinned button removes record
   - [ ] Pin state persists across page refreshes

3. **My Dashboard**
   - [ ] Tab appears in Insights page
   - [ ] Pinned items display with metrics
   - [ ] Empty state shows when no pins
   - [ ] Links navigate to correct detail pages

4. **Alert Detection**
   - [ ] Worker runs without errors
   - [ ] Alerts created for threshold breaches
   - [ ] Deduplication prevents duplicates
   - [ ] User preferences respected

5. **Alert Display**
   - [ ] Badge shows unread count
   - [ ] Alert feed displays recent alerts
   - [ ] Mark as read updates state
   - [ ] Severity colors correct

### SQL Verification Queries

```sql
-- Verify pin creation
SELECT * FROM user_pins WHERE user_id = 'your-user-id';

-- Verify alert detection
SELECT * FROM user_alerts ORDER BY created_at DESC LIMIT 10;

-- Verify dedup working
SELECT dedup_key, COUNT(*) FROM user_alerts GROUP BY dedup_key HAVING COUNT(*) > 1;

-- Verify preferences
SELECT * FROM user_alert_preferences WHERE user_id = 'your-user-id';
```

---

## File Reference

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDD_add_personalization.sql` | Database schema |
| `packages/shared/src/alert-thresholds.ts` | Threshold constants |
| `packages/ingestion/src/workers/alert-detection-worker.ts` | Detection logic |
| `.github/workflows/alert-detection.yml` | Scheduled job |
| `apps/admin/src/app/api/pins/route.ts` | Pin CRUD |
| `apps/admin/src/app/api/pins/[id]/route.ts` | Pin delete |
| `apps/admin/src/app/api/alerts/route.ts` | Alert listing |
| `apps/admin/src/app/api/alerts/count/route.ts` | Unread count |
| `apps/admin/src/app/api/alerts/mark-read/route.ts` | Mark read |
| `apps/admin/src/app/api/preferences/alerts/route.ts` | Preferences |
| `apps/admin/src/components/PinButton.tsx` | Pin button |
| `apps/admin/src/components/alerts/AlertBadge.tsx` | Badge component |
| `apps/admin/src/components/alerts/AlertFeed.tsx` | Alert list |
| `apps/admin/src/app/(main)/insights/components/MyDashboardTab.tsx` | Dashboard tab |

### Modified Files

| File | Change |
|------|--------|
| `apps/admin/src/app/(main)/apps/[appid]/page.tsx` | Add pin button |
| `apps/admin/src/app/(main)/publishers/[id]/page.tsx` | Add pin button |
| `apps/admin/src/app/(main)/developers/[id]/page.tsx` | Add pin button |
| `apps/admin/src/app/(main)/insights/InsightsTabs.tsx` | Add My Dashboard tab |
| `apps/admin/src/components/layout/Sidebar.tsx` | Add alert badge |
| `packages/ingestion/package.json` | Add detect-alerts script |

---

## Implementation Notes

This section documents deviations from the original design and implementation-specific details.

### API Route Changes

| Designed Route | Implemented Route | Notes |
|----------------|-------------------|-------|
| `POST /api/alerts/mark-read` | `POST /api/alerts/[id]/read` | RESTful pattern with alert ID in path |
| `PATCH /api/preferences/alerts` | `PUT /api/alerts/preferences` | Grouped under `/api/alerts` namespace |

### File Structure Changes

| Designed Location | Implemented Location | Notes |
|-------------------|---------------------|-------|
| `apps/admin/src/components/alerts/PinnedCard.tsx` | `apps/admin/src/app/(main)/insights/components/PinnedCard.tsx` | Co-located with MyDashboardTab |

### Type Safety Notes

The implementation uses `eslint-disable @typescript-eslint/no-explicit-any` in a few locations where the database tables and RPC functions are not yet in the generated types. These will be automatically resolved after applying the migrations and running:

```bash
pnpm --filter database generate
```

**Affected files:**
- `apps/admin/src/app/api/pins/route.ts` - RPC and table access
- `packages/ingestion/src/workers/alert-detection-worker.ts` - New table access

### Deferred Features (v2 Roadmap)

The following features have database support but no UI implementation:

| Feature | Database Support | UI Status |
|---------|------------------|-----------|
| Pin folders/organization | `pin_order` column | Not implemented |
| Email digest notifications | `email_digest_enabled` preference | Not implemented |
| Publisher/developer aggregate metrics | Schema supports | PinnedCard shows placeholder |
| Pin drag-and-drop reordering | `pin_order` column | Not implemented |

### Related Documentation

- [User Guide](../../user-guide/personalization.md) - How to use the feature
- [Release Notes](../../releases/v2.4-personalization.md) - Full changelog
