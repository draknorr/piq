/**
 * Chat-only cubes for richer game lookup and DLC relationship answers.
 *
 * These are additive semantic surfaces used by the chat interface so we can
 * improve lookup/discovery answer quality without changing existing page
 * contracts or RPC behavior.
 */

cube('GameCatalog', {
  sql: `
    SELECT
      a.appid,
      a.name,
      a.type,
      a.is_free,
      a.current_price_cents,
      a.current_discount_percent,
      a.release_date,
      a.release_state,
      a.is_released,
      a.parent_appid,
      a.platforms,
      a.controller_support,
      afd.publisher_id,
      afd.publisher_name,
      afd.developer_id,
      afd.developer_name,
      afd.steam_deck_category,
      ldm.metric_date,
      ldm.total_reviews,
      ldm.positive_percentage,
      ldm.owners_midpoint,
      ldm.ccu_peak,
      a.pics_review_percentage
    FROM apps a
    LEFT JOIN app_filter_data afd ON afd.appid = a.appid
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    WHERE a.type = 'game'
      AND a.is_delisted = false
  `,

  dimensions: {
    appid: {
      sql: `appid`,
      type: 'number',
      primaryKey: true,
    },
    name: {
      sql: `name`,
      type: 'string',
    },
    type: {
      sql: `type`,
      type: 'string',
    },
    isFree: {
      sql: `is_free`,
      type: 'boolean',
    },
    priceCents: {
      sql: `current_price_cents`,
      type: 'number',
    },
    priceDollars: {
      sql: `ROUND(current_price_cents / 100.0, 2)`,
      type: 'number',
    },
    discountPercent: {
      sql: `current_discount_percent`,
      type: 'number',
    },
    releaseDate: {
      sql: `release_date`,
      type: 'time',
    },
    releaseYear: {
      sql: `EXTRACT(YEAR FROM ${CUBE}.release_date)::INTEGER`,
      type: 'number',
    },
    releaseState: {
      sql: `release_state`,
      type: 'string',
    },
    isReleased: {
      sql: `is_released`,
      type: 'boolean',
    },
    parentAppid: {
      sql: `parent_appid`,
      type: 'number',
    },
    platforms: {
      sql: `platforms`,
      type: 'string',
    },
    hasWindows: {
      sql: `platforms LIKE '%windows%'`,
      type: 'boolean',
    },
    hasMac: {
      sql: `platforms LIKE '%macos%'`,
      type: 'boolean',
    },
    hasLinux: {
      sql: `platforms LIKE '%linux%'`,
      type: 'boolean',
    },
    controllerSupport: {
      sql: `controller_support`,
      type: 'string',
    },
    steamDeckCategory: {
      sql: `steam_deck_category`,
      type: 'string',
    },
    isSteamDeckVerified: {
      sql: `steam_deck_category = 'verified'`,
      type: 'boolean',
    },
    isSteamDeckPlayable: {
      sql: `steam_deck_category IN ('verified', 'playable')`,
      type: 'boolean',
    },
    publisherId: {
      sql: `publisher_id`,
      type: 'number',
    },
    publisherName: {
      sql: `publisher_name`,
      type: 'string',
    },
    developerId: {
      sql: `developer_id`,
      type: 'number',
    },
    developerName: {
      sql: `developer_name`,
      type: 'string',
    },
    metricDate: {
      sql: `metric_date`,
      type: 'time',
    },
    totalReviews: {
      sql: `total_reviews`,
      type: 'number',
    },
    positivePercentage: {
      sql: `positive_percentage`,
      type: 'number',
    },
    reviewPercentage: {
      sql: `COALESCE(positive_percentage, pics_review_percentage)`,
      type: 'number',
    },
    ownersMidpoint: {
      sql: `owners_midpoint`,
      type: 'number',
    },
    ccuPeak: {
      sql: `ccu_peak`,
      type: 'number',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
    avgPrice: {
      sql: `current_price_cents`,
      type: 'avg',
      filters: [{ sql: `${CUBE}.is_free = false` }],
    },
    avgReviewPercentage: {
      sql: `COALESCE(positive_percentage, pics_review_percentage)`,
      type: 'avg',
    },
    sumOwners: {
      sql: `owners_midpoint`,
      type: 'sum',
    },
    sumCcu: {
      sql: `ccu_peak`,
      type: 'sum',
    },
  },

  segments: {
    released: {
      sql: `${CUBE}.is_released = true`,
    },
    free: {
      sql: `${CUBE}.is_free = true`,
    },
    paid: {
      sql: `${CUBE}.is_free = false`,
    },
    onSale: {
      sql: `${CUBE}.current_discount_percent > 0`,
    },
    highlyRated: {
      sql: `COALESCE(${CUBE}.positive_percentage, ${CUBE}.pics_review_percentage) >= 80`,
    },
    veryPositive: {
      sql: `COALESCE(${CUBE}.positive_percentage, ${CUBE}.pics_review_percentage) >= 90`,
    },
    overwhelminglyPositive: {
      sql: `COALESCE(${CUBE}.positive_percentage, ${CUBE}.pics_review_percentage) >= 95`,
    },
    popular: {
      sql: `${CUBE}.total_reviews >= 1000`,
    },
    releasedThisYear: {
      sql: `EXTRACT(YEAR FROM ${CUBE}.release_date) = EXTRACT(YEAR FROM CURRENT_DATE)`,
    },
    lastYear: {
      sql: `${CUBE}.release_date >= CURRENT_DATE - INTERVAL '1 year'`,
    },
    last6Months: {
      sql: `${CUBE}.release_date >= CURRENT_DATE - INTERVAL '6 months'`,
    },
    last3Months: {
      sql: `${CUBE}.release_date >= CURRENT_DATE - INTERVAL '3 months'`,
    },
    steamDeckVerified: {
      sql: `${CUBE}.steam_deck_category = 'verified'`,
    },
    steamDeckPlayable: {
      sql: `${CUBE}.steam_deck_category IN ('verified', 'playable')`,
    },
  },
});

cube('PublisherRelationshipMetrics', {
  sql: `
    SELECT
      afd.publisher_id AS publisher_id,
      afd.publisher_name AS publisher_name,
      COUNT(DISTINCT a.appid) AS game_count,
      COALESCE(SUM(ldm.total_reviews), 0) AS total_reviews,
      ROUND(AVG(COALESCE(ldm.positive_percentage, a.pics_review_percentage))::numeric, 1) AS avg_review_percentage,
      COUNT(DISTINCT CASE
        WHEN COALESCE(ldm.total_reviews, 0) >= 1000 OR COALESCE(ldm.owners_midpoint, 0) >= 100000
        THEN a.appid
      END) AS hit_game_count,
      COUNT(DISTINCT CASE
        WHEN LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))
        THEN a.appid
      END) AS self_published_game_count,
      COUNT(DISTINCT CASE
        WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
        THEN afd.developer_id
      END) AS external_partner_count,
      BOOL_AND(LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))) AS is_self_published,
      (
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
          THEN afd.developer_id
        END) > 0
      ) AS works_with_external_devs
    FROM apps a
    INNER JOIN app_filter_data afd ON afd.appid = a.appid
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    WHERE a.type = 'game'
      AND a.is_delisted = false
      AND a.is_released = true
      AND afd.publisher_id IS NOT NULL
      AND afd.publisher_name IS NOT NULL
    GROUP BY afd.publisher_id, afd.publisher_name
  `,

  dimensions: {
    publisherId: {
      sql: `publisher_id`,
      type: 'number',
      primaryKey: true,
    },
    publisherName: {
      sql: `publisher_name`,
      type: 'string',
    },
    gameCount: {
      sql: `game_count`,
      type: 'number',
    },
    totalReviews: {
      sql: `total_reviews`,
      type: 'number',
    },
    avgReviewPercentage: {
      sql: `avg_review_percentage`,
      type: 'number',
    },
    hitGameCount: {
      sql: `hit_game_count`,
      type: 'number',
    },
    selfPublishedGameCount: {
      sql: `self_published_game_count`,
      type: 'number',
    },
    externalPartnerCount: {
      sql: `external_partner_count`,
      type: 'number',
    },
    isSelfPublished: {
      sql: `is_self_published`,
      type: 'boolean',
    },
    worksWithExternalDevs: {
      sql: `works_with_external_devs`,
      type: 'boolean',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
  },

  preAggregations: {
    relationshipList: {
      dimensions: [
        publisherId,
        publisherName,
        gameCount,
        totalReviews,
        avgReviewPercentage,
        hitGameCount,
        selfPublishedGameCount,
        externalPartnerCount,
        isSelfPublished,
        worksWithExternalDevs,
      ],
      refreshKey: {
        every: '6 hours',
      },
    },
  },
});

cube('DeveloperRelationshipMetrics', {
  sql: `
    SELECT
      afd.developer_id AS developer_id,
      afd.developer_name AS developer_name,
      COUNT(DISTINCT a.appid) AS game_count,
      COALESCE(SUM(ldm.total_reviews), 0) AS total_reviews,
      ROUND(AVG(COALESCE(ldm.positive_percentage, a.pics_review_percentage))::numeric, 1) AS avg_review_percentage,
      COUNT(DISTINCT CASE
        WHEN COALESCE(ldm.total_reviews, 0) >= 1000 OR COALESCE(ldm.owners_midpoint, 0) >= 100000
        THEN a.appid
      END) AS hit_game_count,
      COUNT(DISTINCT CASE
        WHEN LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))
        THEN a.appid
      END) AS self_published_game_count,
      COUNT(DISTINCT CASE
        WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
        THEN afd.publisher_id
      END) AS external_partner_count,
      BOOL_AND(LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))) AS is_self_published,
      (
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
          THEN afd.publisher_id
        END) > 0
      ) AS works_with_external_publishers
    FROM apps a
    INNER JOIN app_filter_data afd ON afd.appid = a.appid
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    WHERE a.type = 'game'
      AND a.is_delisted = false
      AND a.is_released = true
      AND afd.developer_id IS NOT NULL
      AND afd.developer_name IS NOT NULL
    GROUP BY afd.developer_id, afd.developer_name
  `,

  dimensions: {
    developerId: {
      sql: `developer_id`,
      type: 'number',
      primaryKey: true,
    },
    developerName: {
      sql: `developer_name`,
      type: 'string',
    },
    gameCount: {
      sql: `game_count`,
      type: 'number',
    },
    totalReviews: {
      sql: `total_reviews`,
      type: 'number',
    },
    avgReviewPercentage: {
      sql: `avg_review_percentage`,
      type: 'number',
    },
    hitGameCount: {
      sql: `hit_game_count`,
      type: 'number',
    },
    selfPublishedGameCount: {
      sql: `self_published_game_count`,
      type: 'number',
    },
    externalPartnerCount: {
      sql: `external_partner_count`,
      type: 'number',
    },
    isSelfPublished: {
      sql: `is_self_published`,
      type: 'boolean',
    },
    worksWithExternalPublishers: {
      sql: `works_with_external_publishers`,
      type: 'boolean',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
  },

  preAggregations: {
    relationshipList: {
      dimensions: [
        developerId,
        developerName,
        gameCount,
        totalReviews,
        avgReviewPercentage,
        hitGameCount,
        selfPublishedGameCount,
        externalPartnerCount,
        isSelfPublished,
        worksWithExternalPublishers,
      ],
      refreshKey: {
        every: '6 hours',
      },
    },
  },
});

cube('PublisherChatScreenMetrics', {
  sqlAlias: `pcs`,
  sql: `
    WITH publisher_core AS (
      SELECT
        p.id AS publisher_id,
        p.name AS publisher_name,
        p.game_count AS exact_game_count,
        TRIM(REGEXP_REPLACE(LOWER(p.name), '[^a-z0-9]+', ' ', 'g')) AS clean_name,
        REGEXP_REPLACE(
          TRIM(REGEXP_REPLACE(LOWER(p.name), '[^a-z0-9]+', ' ', 'g')),
          ' (inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|gmbh|sa|ag|kk|entertainment)$',
          ''
        ) AS core_name,
        (
          TRIM(REGEXP_REPLACE(LOWER(p.name), '[^a-z0-9]+', ' ', 'g')) ~
          ' (inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|gmbh|sa|ag|kk|entertainment)$'
        ) AS has_corporate_suffix
      FROM publishers p
    ),
    publisher_family AS (
      SELECT
        core_name,
        SUM(exact_game_count) AS core_family_game_count
      FROM publisher_core
      GROUP BY core_name
    ),
    publisher_aggregates AS (
      SELECT
        pc.publisher_id,
        pc.publisher_name,
        pc.exact_game_count,
        COUNT(DISTINCT a.appid) AS released_game_count,
        COUNT(DISTINCT CASE
          WHEN COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000
          THEN a.appid
        END) AS meaningful_game_count,
        COUNT(DISTINCT CASE
          WHEN COALESCE(ldm.total_reviews, 0) >= 1000 OR COALESCE(ldm.owners_midpoint, 0) >= 100000
          THEN a.appid
        END) AS hit_game_count,
        COALESCE(SUM(ldm.total_reviews), 0) AS total_reviews,
        ROUND(AVG(COALESCE(ldm.positive_percentage, a.pics_review_percentage))::numeric, 1) AS avg_review_percentage,
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))
          THEN a.appid
        END) AS self_published_game_count,
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
          THEN a.appid
        END) AS external_published_game_count,
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
          THEN afd.developer_id
        END) AS external_partner_count,
        COALESCE(BOOL_AND(LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))), false) AS is_self_published,
        COALESCE(pf.core_family_game_count, pc.exact_game_count) AS core_family_game_count,
        pc.has_corporate_suffix,
        EXISTS (
          SELECT 1
          FROM steam_tags st
          WHERE st.name = 'Indie'
            AND st.tag_id = ANY(COALESCE(pm.tag_ids, ARRAY[]::integer[]))
        ) AS has_indie_tag
      FROM publisher_core pc
      LEFT JOIN publisher_family pf ON pf.core_name = pc.core_name
      LEFT JOIN publisher_metrics pm ON pm.publisher_id = pc.publisher_id
      LEFT JOIN app_filter_data afd ON afd.publisher_id = pc.publisher_id
      LEFT JOIN apps a
        ON a.appid = afd.appid
        AND a.type = 'game'
        AND a.is_delisted = false
        AND a.is_released = true
      LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
      GROUP BY
        pc.publisher_id,
        pc.publisher_name,
        pc.exact_game_count,
        pf.core_family_game_count,
        pc.has_corporate_suffix,
        pm.tag_ids
    )
    SELECT
      *,
      ROUND((
        CASE WHEN is_self_published THEN 0.5 ELSE 0 END +
        CASE WHEN exact_game_count <= 5 THEN 0.2 ELSE 0 END +
        CASE WHEN core_family_game_count <= 5 THEN 0.2 ELSE 0 END +
        CASE WHEN has_corporate_suffix = false THEN 0.1 ELSE 0 END
      )::numeric, 2) AS indie_confidence,
      (
        (
          CASE WHEN is_self_published THEN 0.5 ELSE 0 END +
          CASE WHEN exact_game_count <= 5 THEN 0.2 ELSE 0 END +
          CASE WHEN core_family_game_count <= 5 THEN 0.2 ELSE 0 END +
          CASE WHEN has_corporate_suffix = false THEN 0.1 ELSE 0 END
        ) >= 0.8
      ) AS is_indie_chat,
      (external_partner_count > 0) AS works_with_external_partners,
      (
        is_self_published OR external_published_game_count <= 1
      ) AS mostly_self_published
    FROM publisher_aggregates
  `,

  dimensions: {
    publisherId: {
      sql: `publisher_id`,
      type: 'number',
      primaryKey: true,
    },
    publisherName: {
      sql: `publisher_name`,
      type: 'string',
    },
    exactGameCount: {
      sql: `exact_game_count`,
      type: 'number',
    },
    releasedGameCount: {
      sql: `released_game_count`,
      type: 'number',
    },
    meaningfulGameCount: {
      sql: `meaningful_game_count`,
      type: 'number',
    },
    hitGameCount: {
      sql: `hit_game_count`,
      type: 'number',
    },
    totalReviews: {
      sql: `total_reviews`,
      type: 'number',
    },
    avgReviewPercentage: {
      sql: `avg_review_percentage`,
      type: 'number',
    },
    selfPublishedGameCount: {
      sql: `self_published_game_count`,
      type: 'number',
    },
    externalPublishedGameCount: {
      sql: `external_published_game_count`,
      type: 'number',
    },
    externalPartnerCount: {
      sql: `external_partner_count`,
      type: 'number',
    },
    isSelfPublished: {
      sql: `is_self_published`,
      type: 'boolean',
    },
    coreFamilyGameCount: {
      sql: `core_family_game_count`,
      type: 'number',
    },
    hasCorporateSuffix: {
      sql: `has_corporate_suffix`,
      type: 'boolean',
    },
    hasIndieTag: {
      sql: `has_indie_tag`,
      type: 'boolean',
    },
    indieConfidence: {
      sql: `indie_confidence`,
      type: 'number',
    },
    isIndieChat: {
      sql: `is_indie_chat`,
      type: 'boolean',
    },
    worksWithExternalPartners: {
      sql: `works_with_external_partners`,
      type: 'boolean',
    },
    mostlySelfPublished: {
      sql: `mostly_self_published`,
      type: 'boolean',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
  },

  preAggregations: {
    screenList: {
      dimensions: [
        publisherId,
        publisherName,
        exactGameCount,
        releasedGameCount,
        meaningfulGameCount,
        hitGameCount,
        totalReviews,
        avgReviewPercentage,
        selfPublishedGameCount,
        externalPublishedGameCount,
        externalPartnerCount,
        isSelfPublished,
        coreFamilyGameCount,
        hasCorporateSuffix,
        hasIndieTag,
        indieConfidence,
        isIndieChat,
        worksWithExternalPartners,
        mostlySelfPublished,
      ],
      refreshKey: {
        every: '6 hours',
      },
    },
  },
});

cube('DeveloperChatScreenMetrics', {
  sqlAlias: `dcs`,
  sql: `
    WITH developer_core AS (
      SELECT
        d.id AS developer_id,
        d.name AS developer_name,
        d.game_count AS exact_game_count,
        TRIM(REGEXP_REPLACE(LOWER(d.name), '[^a-z0-9]+', ' ', 'g')) AS clean_name,
        REGEXP_REPLACE(
          TRIM(REGEXP_REPLACE(LOWER(d.name), '[^a-z0-9]+', ' ', 'g')),
          ' (inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|gmbh|sa|ag|kk|entertainment)$',
          ''
        ) AS core_name,
        (
          TRIM(REGEXP_REPLACE(LOWER(d.name), '[^a-z0-9]+', ' ', 'g')) ~
          ' (inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|gmbh|sa|ag|kk|entertainment)$'
        ) AS has_corporate_suffix
      FROM developers d
    ),
    developer_family AS (
      SELECT
        core_name,
        SUM(exact_game_count) AS core_family_game_count
      FROM developer_core
      GROUP BY core_name
    ),
    developer_aggregates AS (
      SELECT
        dc.developer_id,
        dc.developer_name,
        dc.exact_game_count,
        COUNT(DISTINCT a.appid) AS released_game_count,
        COUNT(DISTINCT CASE
          WHEN COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000
          THEN a.appid
        END) AS meaningful_game_count,
        COUNT(DISTINCT CASE
          WHEN COALESCE(ldm.total_reviews, 0) >= 1000 OR COALESCE(ldm.owners_midpoint, 0) >= 100000
          THEN a.appid
        END) AS hit_game_count,
        COALESCE(SUM(ldm.total_reviews), 0) AS total_reviews,
        ROUND(AVG(COALESCE(ldm.positive_percentage, a.pics_review_percentage))::numeric, 1) AS avg_review_percentage,
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))
          THEN a.appid
        END) AS self_published_game_count,
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
          THEN a.appid
        END) AS external_published_game_count,
        COUNT(DISTINCT CASE
          WHEN LOWER(TRIM(afd.publisher_name)) <> LOWER(TRIM(afd.developer_name))
          THEN afd.publisher_id
        END) AS external_partner_count,
        COALESCE(BOOL_AND(LOWER(TRIM(afd.publisher_name)) = LOWER(TRIM(afd.developer_name))), false) AS is_self_published,
        COALESCE(df.core_family_game_count, dc.exact_game_count) AS core_family_game_count,
        dc.has_corporate_suffix,
        EXISTS (
          SELECT 1
          FROM steam_tags st
          WHERE st.name = 'Indie'
            AND st.tag_id = ANY(COALESCE(dm.tag_ids, ARRAY[]::integer[]))
        ) AS has_indie_tag
      FROM developer_core dc
      LEFT JOIN developer_family df ON df.core_name = dc.core_name
      LEFT JOIN developer_metrics dm ON dm.developer_id = dc.developer_id
      LEFT JOIN app_filter_data afd ON afd.developer_id = dc.developer_id
      LEFT JOIN apps a
        ON a.appid = afd.appid
        AND a.type = 'game'
        AND a.is_delisted = false
        AND a.is_released = true
      LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
      GROUP BY
        dc.developer_id,
        dc.developer_name,
        dc.exact_game_count,
        df.core_family_game_count,
        dc.has_corporate_suffix,
        dm.tag_ids
    )
    SELECT
      *,
      ROUND((
        CASE WHEN is_self_published THEN 0.5 ELSE 0 END +
        CASE WHEN exact_game_count <= 5 THEN 0.2 ELSE 0 END +
        CASE WHEN core_family_game_count <= 5 THEN 0.2 ELSE 0 END +
        CASE WHEN has_corporate_suffix = false THEN 0.1 ELSE 0 END
      )::numeric, 2) AS indie_confidence,
      (
        (
          CASE WHEN is_self_published THEN 0.5 ELSE 0 END +
          CASE WHEN exact_game_count <= 5 THEN 0.2 ELSE 0 END +
          CASE WHEN core_family_game_count <= 5 THEN 0.2 ELSE 0 END +
          CASE WHEN has_corporate_suffix = false THEN 0.1 ELSE 0 END
        ) >= 0.8
      ) AS is_indie_chat,
      (external_partner_count > 0) AS works_with_external_partners,
      (
        is_self_published OR external_published_game_count <= 1
      ) AS mostly_self_published
    FROM developer_aggregates
  `,

  dimensions: {
    developerId: {
      sql: `developer_id`,
      type: 'number',
      primaryKey: true,
    },
    developerName: {
      sql: `developer_name`,
      type: 'string',
    },
    exactGameCount: {
      sql: `exact_game_count`,
      type: 'number',
    },
    releasedGameCount: {
      sql: `released_game_count`,
      type: 'number',
    },
    meaningfulGameCount: {
      sql: `meaningful_game_count`,
      type: 'number',
    },
    hitGameCount: {
      sql: `hit_game_count`,
      type: 'number',
    },
    totalReviews: {
      sql: `total_reviews`,
      type: 'number',
    },
    avgReviewPercentage: {
      sql: `avg_review_percentage`,
      type: 'number',
    },
    selfPublishedGameCount: {
      sql: `self_published_game_count`,
      type: 'number',
    },
    externalPublishedGameCount: {
      sql: `external_published_game_count`,
      type: 'number',
    },
    externalPartnerCount: {
      sql: `external_partner_count`,
      type: 'number',
    },
    isSelfPublished: {
      sql: `is_self_published`,
      type: 'boolean',
    },
    coreFamilyGameCount: {
      sql: `core_family_game_count`,
      type: 'number',
    },
    hasCorporateSuffix: {
      sql: `has_corporate_suffix`,
      type: 'boolean',
    },
    hasIndieTag: {
      sql: `has_indie_tag`,
      type: 'boolean',
    },
    indieConfidence: {
      sql: `indie_confidence`,
      type: 'number',
    },
    isIndieChat: {
      sql: `is_indie_chat`,
      type: 'boolean',
    },
    worksWithExternalPartners: {
      sql: `works_with_external_partners`,
      type: 'boolean',
    },
    mostlySelfPublished: {
      sql: `mostly_self_published`,
      type: 'boolean',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
  },

  preAggregations: {
    screenList: {
      dimensions: [
        developerId,
        developerName,
        exactGameCount,
        releasedGameCount,
        meaningfulGameCount,
        hitGameCount,
        totalReviews,
        avgReviewPercentage,
        selfPublishedGameCount,
        externalPublishedGameCount,
        externalPartnerCount,
        isSelfPublished,
        coreFamilyGameCount,
        hasCorporateSuffix,
        hasIndieTag,
        indieConfidence,
        isIndieChat,
        worksWithExternalPartners,
        mostlySelfPublished,
      ],
      refreshKey: {
        every: '6 hours',
      },
    },
  },
});

cube('PublisherChatWindowMetrics', {
  sqlAlias: `pcw`,
  sql: `
    WITH publisher_core AS (
      SELECT
        p.id AS publisher_id,
        p.name AS publisher_name,
        p.game_count AS exact_game_count
      FROM publishers p
    )
    SELECT
      pc.publisher_id,
      pc.publisher_name,
      pc.exact_game_count,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN a.appid
      END) AS games_released_last_30_days,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_30_days,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_30_days,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_30_days,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_30_days,

      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN a.appid
      END) AS games_released_last_3_months,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_3_months,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_3_months,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_3_months,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_3_months,

      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN a.appid
      END) AS games_released_last_6_months,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_6_months,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_6_months,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_6_months,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_6_months,

      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN a.appid
      END) AS games_released_last_year,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_year,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_year,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_year,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_year
    FROM publisher_core pc
    LEFT JOIN app_filter_data afd ON afd.publisher_id = pc.publisher_id
    LEFT JOIN apps a
      ON a.appid = afd.appid
      AND a.type = 'game'
      AND a.is_delisted = false
      AND a.is_released = true
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    GROUP BY pc.publisher_id, pc.publisher_name, pc.exact_game_count
  `,

  dimensions: {
    publisherId: {
      sql: `publisher_id`,
      type: 'number',
      primaryKey: true,
    },
    publisherName: {
      sql: `publisher_name`,
      type: 'string',
    },
    exactGameCount: {
      sql: `exact_game_count`,
      type: 'number',
    },
    gamesReleasedLast30Days: {
      sql: `games_released_last_30_days`,
      type: 'number',
    },
    meaningfulGamesReleasedLast30Days: {
      sql: `meaningful_games_released_last_30_days`,
      type: 'number',
    },
    totalReviewsLast30Days: {
      sql: `total_reviews_last_30_days`,
      type: 'number',
    },
    avgReviewPercentageLast30Days: {
      sql: `avg_review_percentage_last_30_days`,
      type: 'number',
    },
    minReviewPercentageLast30Days: {
      sql: `min_review_percentage_last_30_days`,
      type: 'number',
    },
    gamesReleasedLast3Months: {
      sql: `games_released_last_3_months`,
      type: 'number',
    },
    meaningfulGamesReleasedLast3Months: {
      sql: `meaningful_games_released_last_3_months`,
      type: 'number',
    },
    totalReviewsLast3Months: {
      sql: `total_reviews_last_3_months`,
      type: 'number',
    },
    avgReviewPercentageLast3Months: {
      sql: `avg_review_percentage_last_3_months`,
      type: 'number',
    },
    minReviewPercentageLast3Months: {
      sql: `min_review_percentage_last_3_months`,
      type: 'number',
    },
    gamesReleasedLast6Months: {
      sql: `games_released_last_6_months`,
      type: 'number',
    },
    meaningfulGamesReleasedLast6Months: {
      sql: `meaningful_games_released_last_6_months`,
      type: 'number',
    },
    totalReviewsLast6Months: {
      sql: `total_reviews_last_6_months`,
      type: 'number',
    },
    avgReviewPercentageLast6Months: {
      sql: `avg_review_percentage_last_6_months`,
      type: 'number',
    },
    minReviewPercentageLast6Months: {
      sql: `min_review_percentage_last_6_months`,
      type: 'number',
    },
    gamesReleasedLastYear: {
      sql: `games_released_last_year`,
      type: 'number',
    },
    meaningfulGamesReleasedLastYear: {
      sql: `meaningful_games_released_last_year`,
      type: 'number',
    },
    totalReviewsLastYear: {
      sql: `total_reviews_last_year`,
      type: 'number',
    },
    avgReviewPercentageLastYear: {
      sql: `avg_review_percentage_last_year`,
      type: 'number',
    },
    minReviewPercentageLastYear: {
      sql: `min_review_percentage_last_year`,
      type: 'number',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
  },

  preAggregations: {
    windowList: {
      dimensions: [
        publisherId,
        publisherName,
        exactGameCount,
        gamesReleasedLast30Days,
        meaningfulGamesReleasedLast30Days,
        totalReviewsLast30Days,
        avgReviewPercentageLast30Days,
        minReviewPercentageLast30Days,
        gamesReleasedLast3Months,
        meaningfulGamesReleasedLast3Months,
        totalReviewsLast3Months,
        avgReviewPercentageLast3Months,
        minReviewPercentageLast3Months,
        gamesReleasedLast6Months,
        meaningfulGamesReleasedLast6Months,
        totalReviewsLast6Months,
        avgReviewPercentageLast6Months,
        minReviewPercentageLast6Months,
        gamesReleasedLastYear,
        meaningfulGamesReleasedLastYear,
        totalReviewsLastYear,
        avgReviewPercentageLastYear,
        minReviewPercentageLastYear,
      ],
      refreshKey: {
        every: '6 hours',
      },
    },
  },
});

cube('DeveloperChatWindowMetrics', {
  sqlAlias: `dcw`,
  sql: `
    WITH developer_core AS (
      SELECT
        d.id AS developer_id,
        d.name AS developer_name,
        d.game_count AS exact_game_count
      FROM developers d
    )
    SELECT
      dc.developer_id,
      dc.developer_name,
      dc.exact_game_count,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN a.appid
      END) AS games_released_last_30_days,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_30_days,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_30_days,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_30_days,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '30 days'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_30_days,

      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN a.appid
      END) AS games_released_last_3_months,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_3_months,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_3_months,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_3_months,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '3 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_3_months,

      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN a.appid
      END) AS games_released_last_6_months,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_6_months,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_6_months,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_6_months,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '6 months'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_6_months,

      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN a.appid
      END) AS games_released_last_year,
      COUNT(DISTINCT CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
          AND (COALESCE(ldm.total_reviews, 0) >= 100 OR COALESCE(ldm.owners_midpoint, 0) >= 100000)
        THEN a.appid
      END) AS meaningful_games_released_last_year,
      COALESCE(SUM(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN COALESCE(ldm.total_reviews, 0)
        ELSE 0
      END), 0) AS total_reviews_last_year,
      ROUND(AVG(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS avg_review_percentage_last_year,
      ROUND(MIN(CASE
        WHEN a.release_date >= CURRENT_DATE - INTERVAL '1 year'
        THEN COALESCE(ldm.positive_percentage, a.pics_review_percentage)
      END)::numeric, 1) AS min_review_percentage_last_year
    FROM developer_core dc
    LEFT JOIN app_filter_data afd ON afd.developer_id = dc.developer_id
    LEFT JOIN apps a
      ON a.appid = afd.appid
      AND a.type = 'game'
      AND a.is_delisted = false
      AND a.is_released = true
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    GROUP BY dc.developer_id, dc.developer_name, dc.exact_game_count
  `,

  dimensions: {
    developerId: {
      sql: `developer_id`,
      type: 'number',
      primaryKey: true,
    },
    developerName: {
      sql: `developer_name`,
      type: 'string',
    },
    exactGameCount: {
      sql: `exact_game_count`,
      type: 'number',
    },
    gamesReleasedLast30Days: {
      sql: `games_released_last_30_days`,
      type: 'number',
    },
    meaningfulGamesReleasedLast30Days: {
      sql: `meaningful_games_released_last_30_days`,
      type: 'number',
    },
    totalReviewsLast30Days: {
      sql: `total_reviews_last_30_days`,
      type: 'number',
    },
    avgReviewPercentageLast30Days: {
      sql: `avg_review_percentage_last_30_days`,
      type: 'number',
    },
    minReviewPercentageLast30Days: {
      sql: `min_review_percentage_last_30_days`,
      type: 'number',
    },
    gamesReleasedLast3Months: {
      sql: `games_released_last_3_months`,
      type: 'number',
    },
    meaningfulGamesReleasedLast3Months: {
      sql: `meaningful_games_released_last_3_months`,
      type: 'number',
    },
    totalReviewsLast3Months: {
      sql: `total_reviews_last_3_months`,
      type: 'number',
    },
    avgReviewPercentageLast3Months: {
      sql: `avg_review_percentage_last_3_months`,
      type: 'number',
    },
    minReviewPercentageLast3Months: {
      sql: `min_review_percentage_last_3_months`,
      type: 'number',
    },
    gamesReleasedLast6Months: {
      sql: `games_released_last_6_months`,
      type: 'number',
    },
    meaningfulGamesReleasedLast6Months: {
      sql: `meaningful_games_released_last_6_months`,
      type: 'number',
    },
    totalReviewsLast6Months: {
      sql: `total_reviews_last_6_months`,
      type: 'number',
    },
    avgReviewPercentageLast6Months: {
      sql: `avg_review_percentage_last_6_months`,
      type: 'number',
    },
    minReviewPercentageLast6Months: {
      sql: `min_review_percentage_last_6_months`,
      type: 'number',
    },
    gamesReleasedLastYear: {
      sql: `games_released_last_year`,
      type: 'number',
    },
    meaningfulGamesReleasedLastYear: {
      sql: `meaningful_games_released_last_year`,
      type: 'number',
    },
    totalReviewsLastYear: {
      sql: `total_reviews_last_year`,
      type: 'number',
    },
    avgReviewPercentageLastYear: {
      sql: `avg_review_percentage_last_year`,
      type: 'number',
    },
    minReviewPercentageLastYear: {
      sql: `min_review_percentage_last_year`,
      type: 'number',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
  },

  preAggregations: {
    windowList: {
      dimensions: [
        developerId,
        developerName,
        exactGameCount,
        gamesReleasedLast30Days,
        meaningfulGamesReleasedLast30Days,
        totalReviewsLast30Days,
        avgReviewPercentageLast30Days,
        minReviewPercentageLast30Days,
        gamesReleasedLast3Months,
        meaningfulGamesReleasedLast3Months,
        totalReviewsLast3Months,
        avgReviewPercentageLast3Months,
        minReviewPercentageLast3Months,
        gamesReleasedLast6Months,
        meaningfulGamesReleasedLast6Months,
        totalReviewsLast6Months,
        avgReviewPercentageLast6Months,
        minReviewPercentageLast6Months,
        gamesReleasedLastYear,
        meaningfulGamesReleasedLastYear,
        totalReviewsLastYear,
        avgReviewPercentageLastYear,
        minReviewPercentageLastYear,
      ],
      refreshKey: {
        every: '6 hours',
      },
    },
  },
});

cube('DlcRelations', {
  sql: `
    SELECT
      CONCAT(d.parent_appid, '-', d.dlc_appid) AS relation_id,
      d.parent_appid,
      parent.name AS parent_name,
      d.dlc_appid,
      child.name AS dlc_name,
      child.type AS dlc_type,
      child.release_date AS dlc_release_date,
      child.is_released AS dlc_is_released,
      child.release_state AS dlc_release_state,
      d.source,
      d.created_at,
      child.appid IS NOT NULL AS child_metadata_available
    FROM app_dlc d
    LEFT JOIN apps parent ON parent.appid = d.parent_appid
    LEFT JOIN apps child ON child.appid = d.dlc_appid
  `,

  dimensions: {
    relationId: {
      sql: `relation_id`,
      type: 'string',
      primaryKey: true,
    },
    parentAppid: {
      sql: `parent_appid`,
      type: 'number',
    },
    parentName: {
      sql: `parent_name`,
      type: 'string',
    },
    dlcAppid: {
      sql: `dlc_appid`,
      type: 'number',
    },
    dlcName: {
      sql: `dlc_name`,
      type: 'string',
    },
    dlcType: {
      sql: `dlc_type`,
      type: 'string',
    },
    dlcReleaseDate: {
      sql: `dlc_release_date`,
      type: 'time',
    },
    dlcIsReleased: {
      sql: `dlc_is_released`,
      type: 'boolean',
    },
    dlcReleaseState: {
      sql: `dlc_release_state`,
      type: 'string',
    },
    source: {
      sql: `source`,
      type: 'string',
    },
    createdAt: {
      sql: `created_at`,
      type: 'time',
    },
    childMetadataAvailable: {
      sql: `child_metadata_available`,
      type: 'boolean',
    },
  },

  measures: {
    count: {
      type: 'count',
    },
  },

  segments: {
    metadataAvailable: {
      sql: `${CUBE}.child_metadata_available = true`,
    },
    missingMetadata: {
      sql: `${CUBE}.child_metadata_available = false`,
    },
  },
});
