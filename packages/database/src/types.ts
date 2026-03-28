export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alert_detection_state: {
        Row: {
          ccu_7d_avg: number | null
          ccu_7d_max: number | null
          ccu_7d_min: number | null
          ccu_prev_value: number | null
          discount_percent_prev: number | null
          entity_id: number
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: number
          positive_ratio_prev: number | null
          price_cents_prev: number | null
          review_velocity_7d_avg: number | null
          total_reviews_prev: number | null
          trend_30d_direction_prev: string | null
          updated_at: string
        }
        Insert: {
          ccu_7d_avg?: number | null
          ccu_7d_max?: number | null
          ccu_7d_min?: number | null
          ccu_prev_value?: number | null
          discount_percent_prev?: number | null
          entity_id: number
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: number
          positive_ratio_prev?: number | null
          price_cents_prev?: number | null
          review_velocity_7d_avg?: number | null
          total_reviews_prev?: number | null
          trend_30d_direction_prev?: string | null
          updated_at?: string
        }
        Update: {
          ccu_7d_avg?: number | null
          ccu_7d_max?: number | null
          ccu_7d_min?: number | null
          ccu_prev_value?: number | null
          discount_percent_prev?: number | null
          entity_id?: number
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: number
          positive_ratio_prev?: number | null
          price_cents_prev?: number | null
          review_velocity_7d_avg?: number | null
          total_reviews_prev?: number | null
          trend_30d_direction_prev?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      app_capture_queue: {
        Row: {
          appid: number
          attempts: number
          available_at: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          id: number
          last_error: string | null
          payload: Json
          priority: number
          source: Database["public"]["Enums"]["app_capture_source"]
          status: Database["public"]["Enums"]["app_capture_status"]
          trigger_cursor: string
          trigger_reason: string
          worker_id: string | null
        }
        Insert: {
          appid: number
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: number
          last_error?: string | null
          payload?: Json
          priority?: number
          source: Database["public"]["Enums"]["app_capture_source"]
          status?: Database["public"]["Enums"]["app_capture_status"]
          trigger_cursor?: string
          trigger_reason: string
          worker_id?: string | null
        }
        Update: {
          appid?: number
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: number
          last_error?: string | null
          payload?: Json
          priority?: number
          source?: Database["public"]["Enums"]["app_capture_source"]
          status?: Database["public"]["Enums"]["app_capture_status"]
          trigger_cursor?: string
          trigger_reason?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_capture_queue_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_capture_queue_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_capture_queue_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_capture_queue_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      app_categories: {
        Row: {
          appid: number
          category_id: number
          created_at: string | null
        }
        Insert: {
          appid: number
          category_id: number
          created_at?: string | null
        }
        Update: {
          appid?: number
          category_id?: number
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_categories_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_categories_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_categories_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_categories_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "steam_categories"
            referencedColumns: ["category_id"]
          },
        ]
      }
      app_change_events: {
        Row: {
          after_value: Json | null
          appid: number
          before_value: Json | null
          change_type: Database["public"]["Enums"]["app_change_type"]
          context: Json
          created_at: string
          id: number
          media_version_id: number | null
          news_item_gid: string | null
          occurred_at: string
          related_snapshot_id: number | null
          source: Database["public"]["Enums"]["app_change_source"]
          source_snapshot_id: number | null
          trigger_cursor: string | null
        }
        Insert: {
          after_value?: Json | null
          appid: number
          before_value?: Json | null
          change_type: Database["public"]["Enums"]["app_change_type"]
          context?: Json
          created_at?: string
          id?: number
          media_version_id?: number | null
          news_item_gid?: string | null
          occurred_at?: string
          related_snapshot_id?: number | null
          source: Database["public"]["Enums"]["app_change_source"]
          source_snapshot_id?: number | null
          trigger_cursor?: string | null
        }
        Update: {
          after_value?: Json | null
          appid?: number
          before_value?: Json | null
          change_type?: Database["public"]["Enums"]["app_change_type"]
          context?: Json
          created_at?: string
          id?: number
          media_version_id?: number | null
          news_item_gid?: string | null
          occurred_at?: string
          related_snapshot_id?: number | null
          source?: Database["public"]["Enums"]["app_change_source"]
          source_snapshot_id?: number | null
          trigger_cursor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_change_events_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_change_events_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_change_events_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_change_events_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_change_events_media_version_id_fkey"
            columns: ["media_version_id"]
            isOneToOne: false
            referencedRelation: "app_media_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_change_events_news_item_gid_fkey"
            columns: ["news_item_gid"]
            isOneToOne: false
            referencedRelation: "steam_news_items"
            referencedColumns: ["gid"]
          },
          {
            foreignKeyName: "app_change_events_related_snapshot_id_fkey"
            columns: ["related_snapshot_id"]
            isOneToOne: false
            referencedRelation: "app_source_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_change_events_source_snapshot_id_fkey"
            columns: ["source_snapshot_id"]
            isOneToOne: false
            referencedRelation: "app_source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      app_developers: {
        Row: {
          appid: number
          developer_id: number
        }
        Insert: {
          appid: number
          developer_id: number
        }
        Update: {
          appid?: number
          developer_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_developers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_developers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_developers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_developers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_developers_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_dlc: {
        Row: {
          created_at: string | null
          dlc_appid: number
          parent_appid: number
          source: string
        }
        Insert: {
          created_at?: string | null
          dlc_appid: number
          parent_appid: number
          source?: string
        }
        Update: {
          created_at?: string | null
          dlc_appid?: number
          parent_appid?: number
          source?: string
        }
        Relationships: []
      }
      app_franchises: {
        Row: {
          appid: number
          created_at: string | null
          franchise_id: number
        }
        Insert: {
          appid: number
          created_at?: string | null
          franchise_id: number
        }
        Update: {
          appid?: number
          created_at?: string | null
          franchise_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_franchises_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_franchises_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_franchises_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_franchises_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_franchises_franchise_id_fkey"
            columns: ["franchise_id"]
            isOneToOne: false
            referencedRelation: "franchises"
            referencedColumns: ["id"]
          },
        ]
      }
      app_genres: {
        Row: {
          appid: number
          created_at: string | null
          genre_id: number
          is_primary: boolean | null
        }
        Insert: {
          appid: number
          created_at?: string | null
          genre_id: number
          is_primary?: boolean | null
        }
        Update: {
          appid?: number
          created_at?: string | null
          genre_id?: number
          is_primary?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "app_genres_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_genres_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_genres_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_genres_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "steam_genres"
            referencedColumns: ["genre_id"]
          },
        ]
      }
      app_hero_asset_versions: {
        Row: {
          appid: number
          asset_kind: string
          content_hash: string
          content_length: number
          created_at: string
          first_seen_at: string
          height: number | null
          id: string
          last_seen_at: string
          mime_type: string | null
          object_key: string
          source_url: string
          width: number | null
        }
        Insert: {
          appid: number
          asset_kind: string
          content_hash: string
          content_length: number
          created_at?: string
          first_seen_at?: string
          height?: number | null
          id: string
          last_seen_at?: string
          mime_type?: string | null
          object_key: string
          source_url: string
          width?: number | null
        }
        Update: {
          appid?: number
          asset_kind?: string
          content_hash?: string
          content_length?: number
          created_at?: string
          first_seen_at?: string
          height?: number | null
          id?: string
          last_seen_at?: string
          mime_type?: string | null
          object_key?: string
          source_url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_hero_asset_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_hero_asset_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_hero_asset_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_hero_asset_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      app_media_versions: {
        Row: {
          appid: number
          content_hash: string
          created_at: string
          first_seen_at: string
          hero_assets: Json
          id: number
          last_seen_at: string
          previous_version_id: number | null
          screenshots: Json
          storefront_snapshot_id: number | null
          trailers: Json
        }
        Insert: {
          appid: number
          content_hash: string
          created_at?: string
          first_seen_at?: string
          hero_assets?: Json
          id?: number
          last_seen_at?: string
          previous_version_id?: number | null
          screenshots?: Json
          storefront_snapshot_id?: number | null
          trailers?: Json
        }
        Update: {
          appid?: number
          content_hash?: string
          created_at?: string
          first_seen_at?: string
          hero_assets?: Json
          id?: number
          last_seen_at?: string
          previous_version_id?: number | null
          screenshots?: Json
          storefront_snapshot_id?: number | null
          trailers?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_media_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_media_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_media_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_media_versions_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_media_versions_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "app_media_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_media_versions_storefront_snapshot_id_fkey"
            columns: ["storefront_snapshot_id"]
            isOneToOne: false
            referencedRelation: "app_source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      app_publishers: {
        Row: {
          appid: number
          publisher_id: number
        }
        Insert: {
          appid: number
          publisher_id: number
        }
        Update: {
          appid?: number
          publisher_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_publishers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_publishers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_publishers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_publishers_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_publishers_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_source_snapshots: {
        Row: {
          appid: number
          content_hash: string
          created_at: string
          first_seen_at: string
          id: number
          last_seen_at: string
          observed_at: string
          previous_snapshot_id: number | null
          snapshot_data: Json
          source: Database["public"]["Enums"]["app_snapshot_source"]
          trigger_cursor: string | null
          trigger_reason: string
        }
        Insert: {
          appid: number
          content_hash: string
          created_at?: string
          first_seen_at?: string
          id?: number
          last_seen_at?: string
          observed_at?: string
          previous_snapshot_id?: number | null
          snapshot_data?: Json
          source: Database["public"]["Enums"]["app_snapshot_source"]
          trigger_cursor?: string | null
          trigger_reason: string
        }
        Update: {
          appid?: number
          content_hash?: string
          created_at?: string
          first_seen_at?: string
          id?: number
          last_seen_at?: string
          observed_at?: string
          previous_snapshot_id?: number | null
          snapshot_data?: Json
          source?: Database["public"]["Enums"]["app_snapshot_source"]
          trigger_cursor?: string | null
          trigger_reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_source_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_source_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_source_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_source_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_source_snapshots_previous_snapshot_id_fkey"
            columns: ["previous_snapshot_id"]
            isOneToOne: false
            referencedRelation: "app_source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      app_steam_deck: {
        Row: {
          appid: number
          category: Database["public"]["Enums"]["steam_deck_category"]
          test_timestamp: string | null
          tested_build_id: string | null
          tests: Json | null
          updated_at: string | null
        }
        Insert: {
          appid: number
          category?: Database["public"]["Enums"]["steam_deck_category"]
          test_timestamp?: string | null
          tested_build_id?: string | null
          tests?: Json | null
          updated_at?: string | null
        }
        Update: {
          appid?: number
          category?: Database["public"]["Enums"]["steam_deck_category"]
          test_timestamp?: string | null
          tested_build_id?: string | null
          tests?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_steam_deck_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_steam_deck_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_steam_deck_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_steam_deck_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      app_steam_tags: {
        Row: {
          appid: number
          created_at: string | null
          rank: number | null
          tag_id: number
        }
        Insert: {
          appid: number
          created_at?: string | null
          rank?: number | null
          tag_id: number
        }
        Update: {
          appid?: number
          created_at?: string | null
          rank?: number | null
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_steam_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_steam_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_steam_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_steam_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_steam_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "steam_tags"
            referencedColumns: ["tag_id"]
          },
        ]
      }
      app_tags: {
        Row: {
          appid: number
          tag: string
          vote_count: number | null
        }
        Insert: {
          appid: number
          tag: string
          vote_count?: number | null
        }
        Update: {
          appid?: number
          tag?: string
          vote_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_tags_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      app_trends: {
        Row: {
          appid: number
          ccu_trend_7d_pct: number | null
          current_positive_ratio: number | null
          previous_positive_ratio: number | null
          review_velocity_30d: number | null
          review_velocity_7d: number | null
          trend_30d_change_pct: number | null
          trend_30d_direction:
            | Database["public"]["Enums"]["trend_direction"]
            | null
          trend_90d_change_pct: number | null
          trend_90d_direction:
            | Database["public"]["Enums"]["trend_direction"]
            | null
          updated_at: string | null
        }
        Insert: {
          appid: number
          ccu_trend_7d_pct?: number | null
          current_positive_ratio?: number | null
          previous_positive_ratio?: number | null
          review_velocity_30d?: number | null
          review_velocity_7d?: number | null
          trend_30d_change_pct?: number | null
          trend_30d_direction?:
            | Database["public"]["Enums"]["trend_direction"]
            | null
          trend_90d_change_pct?: number | null
          trend_90d_direction?:
            | Database["public"]["Enums"]["trend_direction"]
            | null
          updated_at?: string | null
        }
        Update: {
          appid?: number
          ccu_trend_7d_pct?: number | null
          current_positive_ratio?: number | null
          previous_positive_ratio?: number | null
          review_velocity_30d?: number | null
          review_velocity_7d?: number | null
          trend_30d_change_pct?: number | null
          trend_30d_direction?:
            | Database["public"]["Enums"]["trend_direction"]
            | null
          trend_90d_change_pct?: number | null
          trend_90d_direction?:
            | Database["public"]["Enums"]["trend_direction"]
            | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_trends_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_trends_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_trends_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "app_trends_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      apps: {
        Row: {
          app_state: string | null
          appid: number
          content_descriptors: Json | null
          controller_support: string | null
          created_at: string | null
          current_build_id: string | null
          current_discount_percent: number | null
          current_price_cents: number | null
          has_developer_info: boolean | null
          has_workshop: boolean | null
          homepage_url: string | null
          is_delisted: boolean | null
          is_free: boolean | null
          is_released: boolean | null
          languages: Json | null
          last_content_update: string | null
          last_seen_in_steam_applist_at: string | null
          metacritic_score: number | null
          metacritic_url: string | null
          name: string
          parent_appid: number | null
          pics_review_percentage: number | null
          pics_review_score: number | null
          platforms: string | null
          release_date: string | null
          release_date_raw: string | null
          release_state: string | null
          store_asset_mtime: string | null
          type: Database["public"]["Enums"]["app_type"] | null
          updated_at: string | null
        }
        Insert: {
          app_state?: string | null
          appid: number
          content_descriptors?: Json | null
          controller_support?: string | null
          created_at?: string | null
          current_build_id?: string | null
          current_discount_percent?: number | null
          current_price_cents?: number | null
          has_developer_info?: boolean | null
          has_workshop?: boolean | null
          homepage_url?: string | null
          is_delisted?: boolean | null
          is_free?: boolean | null
          is_released?: boolean | null
          languages?: Json | null
          last_content_update?: string | null
          last_seen_in_steam_applist_at?: string | null
          metacritic_score?: number | null
          metacritic_url?: string | null
          name: string
          parent_appid?: number | null
          pics_review_percentage?: number | null
          pics_review_score?: number | null
          platforms?: string | null
          release_date?: string | null
          release_date_raw?: string | null
          release_state?: string | null
          store_asset_mtime?: string | null
          type?: Database["public"]["Enums"]["app_type"] | null
          updated_at?: string | null
        }
        Update: {
          app_state?: string | null
          appid?: number
          content_descriptors?: Json | null
          controller_support?: string | null
          created_at?: string | null
          current_build_id?: string | null
          current_discount_percent?: number | null
          current_price_cents?: number | null
          has_developer_info?: boolean | null
          has_workshop?: boolean | null
          homepage_url?: string | null
          is_delisted?: boolean | null
          is_free?: boolean | null
          is_released?: boolean | null
          languages?: Json | null
          last_content_update?: string | null
          last_seen_in_steam_applist_at?: string | null
          metacritic_score?: number | null
          metacritic_url?: string | null
          name?: string
          parent_appid?: number | null
          pics_review_percentage?: number | null
          pics_review_score?: number | null
          platforms?: string | null
          release_date?: string | null
          release_date_raw?: string | null
          release_state?: string | null
          store_asset_mtime?: string | null
          type?: Database["public"]["Enums"]["app_type"] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ccu_snapshots: {
        Row: {
          appid: number
          ccu_tier: number
          id: number
          player_count: number
          snapshot_time: string
        }
        Insert: {
          appid: number
          ccu_tier: number
          id?: number
          player_count: number
          snapshot_time?: string
        }
        Update: {
          appid?: number
          ccu_tier?: number
          id?: number
          player_count?: number
          snapshot_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "ccu_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "ccu_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "ccu_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "ccu_snapshots_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      ccu_tier_assignments: {
        Row: {
          appid: number
          ccu_fetch_status: string | null
          ccu_growth_30d_percent: number | null
          ccu_growth_7d_percent: number | null
          ccu_skip_until: string | null
          ccu_tier: number
          last_ccu_synced: string | null
          last_tier_change: string | null
          recent_peak_ccu: number | null
          release_rank: number | null
          tier_reason: string | null
          updated_at: string | null
        }
        Insert: {
          appid: number
          ccu_fetch_status?: string | null
          ccu_growth_30d_percent?: number | null
          ccu_growth_7d_percent?: number | null
          ccu_skip_until?: string | null
          ccu_tier?: number
          last_ccu_synced?: string | null
          last_tier_change?: string | null
          recent_peak_ccu?: number | null
          release_rank?: number | null
          tier_reason?: string | null
          updated_at?: string | null
        }
        Update: {
          appid?: number
          ccu_fetch_status?: string | null
          ccu_growth_30d_percent?: number | null
          ccu_growth_7d_percent?: number | null
          ccu_skip_until?: string | null
          ccu_tier?: number
          last_ccu_synced?: string | null
          last_tier_change?: string | null
          recent_peak_ccu?: number | null
          release_rank?: number | null
          tier_reason?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ccu_tier_assignments_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "ccu_tier_assignments_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "ccu_tier_assignments_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "ccu_tier_assignments_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      chat_query_logs: {
        Row: {
          answer_contract_summary: Json | null
          chat_family: string | null
          created_at: string | null
          guardrail_trace: Json | null
          id: string
          input_tokens: number | null
          iteration_count: number | null
          output_tokens: number | null
          query_text: string
          quality_flags: string[] | null
          reservation_id: string | null
          response_length: number | null
          session_context_summary: Json | null
          timing_llm_ms: number | null
          timing_tools_ms: number | null
          timing_total_ms: number | null
          tool_count: number | null
          tool_credits_used: number | null
          tool_names: string[] | null
          total_credits_charged: number | null
          user_id: string | null
        }
        Insert: {
          answer_contract_summary?: Json | null
          chat_family?: string | null
          created_at?: string | null
          guardrail_trace?: Json | null
          id?: string
          input_tokens?: number | null
          iteration_count?: number | null
          output_tokens?: number | null
          query_text: string
          quality_flags?: string[] | null
          reservation_id?: string | null
          response_length?: number | null
          session_context_summary?: Json | null
          timing_llm_ms?: number | null
          timing_tools_ms?: number | null
          timing_total_ms?: number | null
          tool_count?: number | null
          tool_credits_used?: number | null
          tool_names?: string[] | null
          total_credits_charged?: number | null
          user_id?: string | null
        }
        Update: {
          answer_contract_summary?: Json | null
          chat_family?: string | null
          created_at?: string | null
          guardrail_trace?: Json | null
          id?: string
          input_tokens?: number | null
          iteration_count?: number | null
          output_tokens?: number | null
          query_text?: string
          quality_flags?: string[] | null
          reservation_id?: string | null
          response_length?: number | null
          session_context_summary?: Json | null
          timing_llm_ms?: number | null
          timing_tools_ms?: number | null
          timing_total_ms?: number | null
          tool_count?: number | null
          tool_credits_used?: number | null
          tool_names?: string[] | null
          total_credits_charged?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_query_logs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "credit_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_query_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_reservations: {
        Row: {
          actual_amount: number | null
          created_at: string
          finalized_at: string | null
          id: string
          reserved_amount: number
          status: Database["public"]["Enums"]["credit_reservation_status"]
          user_id: string
        }
        Insert: {
          actual_amount?: number | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          reserved_amount: number
          status?: Database["public"]["Enums"]["credit_reservation_status"]
          user_id: string
        }
        Update: {
          actual_amount?: number | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          reserved_amount?: number
          status?: Database["public"]["Enums"]["credit_reservation_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_reservations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          admin_user_id: string | null
          amount: number
          balance_after: number
          created_at: string
          description: string | null
          id: string
          input_tokens: number | null
          output_tokens: number | null
          reservation_id: string | null
          tool_credits: number | null
          transaction_type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id: string
        }
        Insert: {
          admin_user_id?: string | null
          amount: number
          balance_after: number
          created_at?: string
          description?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          reservation_id?: string | null
          tool_credits?: number | null
          transaction_type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id: string
        }
        Update: {
          admin_user_id?: string | null
          amount?: number
          balance_after?: number
          created_at?: string
          description?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          reservation_id?: string | null
          tool_credits?: number | null
          transaction_type?: Database["public"]["Enums"]["credit_transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_metrics: {
        Row: {
          appid: number
          average_playtime_2weeks: number | null
          average_playtime_forever: number | null
          ccu_peak: number | null
          ccu_source: string | null
          discount_percent: number | null
          id: number
          metric_date: string
          negative_reviews: number | null
          owners_max: number | null
          owners_min: number | null
          positive_reviews: number | null
          price_cents: number | null
          recent_negative: number | null
          recent_positive: number | null
          recent_score_desc: string | null
          recent_total_reviews: number | null
          review_score: number | null
          review_score_desc: string | null
          total_reviews: number | null
        }
        Insert: {
          appid: number
          average_playtime_2weeks?: number | null
          average_playtime_forever?: number | null
          ccu_peak?: number | null
          ccu_source?: string | null
          discount_percent?: number | null
          id?: number
          metric_date: string
          negative_reviews?: number | null
          owners_max?: number | null
          owners_min?: number | null
          positive_reviews?: number | null
          price_cents?: number | null
          recent_negative?: number | null
          recent_positive?: number | null
          recent_score_desc?: string | null
          recent_total_reviews?: number | null
          review_score?: number | null
          review_score_desc?: string | null
          total_reviews?: number | null
        }
        Update: {
          appid?: number
          average_playtime_2weeks?: number | null
          average_playtime_forever?: number | null
          ccu_peak?: number | null
          ccu_source?: string | null
          discount_percent?: number | null
          id?: number
          metric_date?: string
          negative_reviews?: number | null
          owners_max?: number | null
          owners_min?: number | null
          positive_reviews?: number | null
          price_cents?: number | null
          recent_negative?: number | null
          recent_positive?: number | null
          recent_score_desc?: string | null
          recent_total_reviews?: number | null
          review_score?: number | null
          review_score_desc?: string | null
          total_reviews?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      dashboard_stats_cache: {
        Row: {
          apps_count: number | null
          categories_count: number | null
          developers_count: number | null
          franchises_count: number | null
          genres_count: number | null
          id: string
          parent_app_count: number | null
          pics_synced: number | null
          publishers_count: number | null
          tags_count: number | null
          updated_at: string | null
        }
        Insert: {
          apps_count?: number | null
          categories_count?: number | null
          developers_count?: number | null
          franchises_count?: number | null
          genres_count?: number | null
          id?: string
          parent_app_count?: number | null
          pics_synced?: number | null
          publishers_count?: number | null
          tags_count?: number | null
          updated_at?: string | null
        }
        Update: {
          apps_count?: number | null
          categories_count?: number | null
          developers_count?: number | null
          franchises_count?: number | null
          genres_count?: number | null
          id?: string
          parent_app_count?: number | null
          pics_synced?: number | null
          publishers_count?: number | null
          tags_count?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      developers: {
        Row: {
          created_at: string | null
          embedding_hash: string | null
          first_game_release_date: string | null
          game_count: number | null
          id: number
          last_embedding_sync: string | null
          name: string
          normalized_name: string
          steam_vanity_url: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          embedding_hash?: string | null
          first_game_release_date?: string | null
          game_count?: number | null
          id?: number
          last_embedding_sync?: string | null
          name: string
          normalized_name: string
          steam_vanity_url?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          embedding_hash?: string | null
          first_game_release_date?: string | null
          game_count?: number | null
          id?: number
          last_embedding_sync?: string | null
          name?: string
          normalized_name?: string
          steam_vanity_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      franchises: {
        Row: {
          created_at: string | null
          id: number
          name: string
          normalized_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          name: string
          normalized_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          name?: string
          normalized_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pics_sync_state: {
        Row: {
          id: number
          last_change_number: number
          updated_at: string | null
        }
        Insert: {
          id?: number
          last_change_number?: number
          updated_at?: string | null
        }
        Update: {
          id?: number
          last_change_number?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      publishers: {
        Row: {
          created_at: string | null
          embedding_hash: string | null
          first_game_release_date: string | null
          game_count: number | null
          id: number
          last_embedding_sync: string | null
          name: string
          normalized_name: string
          steam_vanity_url: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          embedding_hash?: string | null
          first_game_release_date?: string | null
          game_count?: number | null
          id?: number
          last_embedding_sync?: string | null
          name: string
          normalized_name: string
          steam_vanity_url?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          embedding_hash?: string | null
          first_game_release_date?: string | null
          game_count?: number | null
          id?: number
          last_embedding_sync?: string | null
          name?: string
          normalized_name?: string
          steam_vanity_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      rate_limit_state: {
        Row: {
          hour_window_start: string
          minute_window_start: string
          requests_this_hour: number
          requests_this_minute: number
          updated_at: string
          user_id: string
        }
        Insert: {
          hour_window_start?: string
          minute_window_start?: string
          requests_this_hour?: number
          requests_this_minute?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          hour_window_start?: string
          minute_window_start?: string
          requests_this_hour?: number
          requests_this_minute?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      review_deltas: {
        Row: {
          appid: number
          created_at: string | null
          daily_velocity: number | null
          delta_date: string
          hours_since_last_sync: number | null
          id: number
          is_interpolated: boolean
          negative_added: number
          positive_added: number
          positive_reviews: number
          review_score: number | null
          review_score_desc: string | null
          reviews_added: number
          total_reviews: number
        }
        Insert: {
          appid: number
          created_at?: string | null
          daily_velocity?: number | null
          delta_date: string
          hours_since_last_sync?: number | null
          id?: number
          is_interpolated?: boolean
          negative_added?: number
          positive_added?: number
          positive_reviews: number
          review_score?: number | null
          review_score_desc?: string | null
          reviews_added?: number
          total_reviews: number
        }
        Update: {
          appid?: number
          created_at?: string | null
          daily_velocity?: number | null
          delta_date?: string
          hours_since_last_sync?: number | null
          id?: number
          is_interpolated?: boolean
          negative_added?: number
          positive_added?: number
          positive_reviews?: number
          review_score?: number | null
          review_score_desc?: string | null
          reviews_added?: number
          total_reviews?: number
        }
        Relationships: [
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      review_histogram: {
        Row: {
          appid: number
          fetched_at: string | null
          id: number
          month_start: string
          recommendations_down: number
          recommendations_up: number
        }
        Insert: {
          appid: number
          fetched_at?: string | null
          id?: number
          month_start: string
          recommendations_down: number
          recommendations_up: number
        }
        Update: {
          appid?: number
          fetched_at?: string | null
          id?: number
          month_start?: string
          recommendations_down?: number
          recommendations_up?: number
        }
        Relationships: [
          {
            foreignKeyName: "review_histogram_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_histogram_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_histogram_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_histogram_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      steam_categories: {
        Row: {
          category_id: number
          created_at: string | null
          description: string | null
          name: string
        }
        Insert: {
          category_id: number
          created_at?: string | null
          description?: string | null
          name: string
        }
        Update: {
          category_id?: number
          created_at?: string | null
          description?: string | null
          name?: string
        }
        Relationships: []
      }
      steam_genres: {
        Row: {
          created_at: string | null
          genre_id: number
          name: string
        }
        Insert: {
          created_at?: string | null
          genre_id: number
          name: string
        }
        Update: {
          created_at?: string | null
          genre_id?: number
          name?: string
        }
        Relationships: []
      }
      steam_news_items: {
        Row: {
          appid: number
          author: string | null
          created_at: string
          feedlabel: string | null
          feedname: string | null
          first_seen_at: string
          gid: string
          last_seen_at: string
          published_at: string | null
          updated_at: string
          url: string
        }
        Insert: {
          appid: number
          author?: string | null
          created_at?: string
          feedlabel?: string | null
          feedname?: string | null
          first_seen_at?: string
          gid: string
          last_seen_at?: string
          published_at?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          appid?: number
          author?: string | null
          created_at?: string
          feedlabel?: string | null
          feedname?: string | null
          first_seen_at?: string
          gid?: string
          last_seen_at?: string
          published_at?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "steam_news_items_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "steam_news_items_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "steam_news_items_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "steam_news_items_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      steam_news_versions: {
        Row: {
          content_hash: string
          contents: string | null
          created_at: string
          first_seen_at: string
          gid: string
          id: number
          last_seen_at: string
          normalized_payload: Json
          previous_version_id: number | null
          title: string | null
          url: string
        }
        Insert: {
          content_hash: string
          contents?: string | null
          created_at?: string
          first_seen_at?: string
          gid: string
          id?: number
          last_seen_at?: string
          normalized_payload?: Json
          previous_version_id?: number | null
          title?: string | null
          url: string
        }
        Update: {
          content_hash?: string
          contents?: string | null
          created_at?: string
          first_seen_at?: string
          gid?: string
          id?: number
          last_seen_at?: string
          normalized_payload?: Json
          previous_version_id?: number | null
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "steam_news_versions_gid_fkey"
            columns: ["gid"]
            isOneToOne: false
            referencedRelation: "steam_news_items"
            referencedColumns: ["gid"]
          },
          {
            foreignKeyName: "steam_news_versions_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "steam_news_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      steam_tags: {
        Row: {
          created_at: string | null
          name: string
          tag_id: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          name: string
          tag_id: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          name?: string
          tag_id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          batch_size: number | null
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          github_run_id: string | null
          id: string
          items_created: number | null
          items_failed: number | null
          items_processed: number | null
          items_skipped: number | null
          items_succeeded: number | null
          items_updated: number | null
          job_type: string
          started_at: string | null
          status: string | null
        }
        Insert: {
          batch_size?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          github_run_id?: string | null
          id?: string
          items_created?: number | null
          items_failed?: number | null
          items_processed?: number | null
          items_skipped?: number | null
          items_succeeded?: number | null
          items_updated?: number | null
          job_type: string
          started_at?: string | null
          status?: string | null
        }
        Update: {
          batch_size?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          github_run_id?: string | null
          id?: string
          items_created?: number | null
          items_failed?: number | null
          items_processed?: number | null
          items_skipped?: number | null
          items_succeeded?: number | null
          items_updated?: number | null
          job_type?: string
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      sync_status: {
        Row: {
          appid: number
          consecutive_errors: number | null
          embedding_hash: string | null
          is_syncable: boolean | null
          last_activity_at: string | null
          last_embedding_sync: string | null
          last_error_at: string | null
          last_error_message: string | null
          last_error_source: Database["public"]["Enums"]["sync_source"] | null
          last_histogram_sync: string | null
          last_known_total_reviews: number | null
          last_media_sync: string | null
          last_news_sync: string | null
          last_pics_sync: string | null
          last_price_sync: string | null
          last_reviews_sync: string | null
          last_steamspy_individual_fetch: string | null
          last_steamspy_sync: string | null
          last_storefront_sync: string | null
          next_reviews_sync: string | null
          next_sync_after: string | null
          pics_change_number: number | null
          priority_calculated_at: string | null
          priority_score: number | null
          refresh_tier: Database["public"]["Enums"]["refresh_tier"] | null
          review_velocity_tier: string | null
          reviews_interval_hours: number | null
          steam_last_modified: number | null
          steam_price_change_number: number | null
          steamspy_available: boolean | null
          storefront_accessible: boolean | null
          sync_interval_hours: number | null
          velocity_7d: number | null
          velocity_calculated_at: string | null
        }
        Insert: {
          appid: number
          consecutive_errors?: number | null
          embedding_hash?: string | null
          is_syncable?: boolean | null
          last_activity_at?: string | null
          last_embedding_sync?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          last_error_source?: Database["public"]["Enums"]["sync_source"] | null
          last_histogram_sync?: string | null
          last_known_total_reviews?: number | null
          last_media_sync?: string | null
          last_news_sync?: string | null
          last_pics_sync?: string | null
          last_price_sync?: string | null
          last_reviews_sync?: string | null
          last_steamspy_individual_fetch?: string | null
          last_steamspy_sync?: string | null
          last_storefront_sync?: string | null
          next_reviews_sync?: string | null
          next_sync_after?: string | null
          pics_change_number?: number | null
          priority_calculated_at?: string | null
          priority_score?: number | null
          refresh_tier?: Database["public"]["Enums"]["refresh_tier"] | null
          review_velocity_tier?: string | null
          reviews_interval_hours?: number | null
          steam_last_modified?: number | null
          steam_price_change_number?: number | null
          steamspy_available?: boolean | null
          storefront_accessible?: boolean | null
          sync_interval_hours?: number | null
          velocity_7d?: number | null
          velocity_calculated_at?: string | null
        }
        Update: {
          appid?: number
          consecutive_errors?: number | null
          embedding_hash?: string | null
          is_syncable?: boolean | null
          last_activity_at?: string | null
          last_embedding_sync?: string | null
          last_error_at?: string | null
          last_error_message?: string | null
          last_error_source?: Database["public"]["Enums"]["sync_source"] | null
          last_histogram_sync?: string | null
          last_known_total_reviews?: number | null
          last_media_sync?: string | null
          last_news_sync?: string | null
          last_pics_sync?: string | null
          last_price_sync?: string | null
          last_reviews_sync?: string | null
          last_steamspy_individual_fetch?: string | null
          last_steamspy_sync?: string | null
          last_storefront_sync?: string | null
          next_reviews_sync?: string | null
          next_sync_after?: string | null
          pics_change_number?: number | null
          priority_calculated_at?: string | null
          priority_score?: number | null
          refresh_tier?: Database["public"]["Enums"]["refresh_tier"] | null
          review_velocity_tier?: string | null
          reviews_interval_hours?: number | null
          steam_last_modified?: number | null
          steam_price_change_number?: number | null
          steamspy_available?: boolean | null
          storefront_accessible?: boolean | null
          sync_interval_hours?: number | null
          velocity_7d?: number | null
          velocity_calculated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_status_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "sync_status_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "sync_status_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "sync_status_appid_fkey"
            columns: ["appid"]
            isOneToOne: true
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      user_alert_preferences: {
        Row: {
          alert_ccu_drop: boolean
          alert_ccu_spike: boolean
          alert_milestone: boolean
          alert_new_release: boolean
          alert_price_change: boolean
          alert_review_surge: boolean
          alert_sentiment_shift: boolean
          alert_trend_reversal: boolean
          alerts_enabled: boolean
          ccu_sensitivity: number
          created_at: string
          email_digest_enabled: boolean
          email_digest_frequency: string | null
          review_sensitivity: number
          sentiment_sensitivity: number
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_ccu_drop?: boolean
          alert_ccu_spike?: boolean
          alert_milestone?: boolean
          alert_new_release?: boolean
          alert_price_change?: boolean
          alert_review_surge?: boolean
          alert_sentiment_shift?: boolean
          alert_trend_reversal?: boolean
          alerts_enabled?: boolean
          ccu_sensitivity?: number
          created_at?: string
          email_digest_enabled?: boolean
          email_digest_frequency?: string | null
          review_sensitivity?: number
          sentiment_sensitivity?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_ccu_drop?: boolean
          alert_ccu_spike?: boolean
          alert_milestone?: boolean
          alert_new_release?: boolean
          alert_price_change?: boolean
          alert_review_surge?: boolean
          alert_sentiment_shift?: boolean
          alert_trend_reversal?: boolean
          alerts_enabled?: boolean
          ccu_sensitivity?: number
          created_at?: string
          email_digest_enabled?: boolean
          email_digest_frequency?: string | null
          review_sensitivity?: number
          sentiment_sensitivity?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_alert_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          change_percent: number | null
          created_at: string
          current_value: number | null
          dedup_key: string
          description: string
          id: string
          is_read: boolean
          metric_name: string | null
          pin_id: string
          previous_value: number | null
          read_at: string | null
          severity: Database["public"]["Enums"]["alert_severity"]
          source_data: Json | null
          title: string
          user_id: string
        }
        Insert: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          change_percent?: number | null
          created_at?: string
          current_value?: number | null
          dedup_key: string
          description: string
          id?: string
          is_read?: boolean
          metric_name?: string | null
          pin_id: string
          previous_value?: number | null
          read_at?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          source_data?: Json | null
          title: string
          user_id: string
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["alert_type"]
          change_percent?: number | null
          created_at?: string
          current_value?: number | null
          dedup_key?: string
          description?: string
          id?: string
          is_read?: boolean
          metric_name?: string | null
          pin_id?: string
          previous_value?: number | null
          read_at?: string | null
          severity?: Database["public"]["Enums"]["alert_severity"]
          source_data?: Json | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_alerts_pin_id_fkey"
            columns: ["pin_id"]
            isOneToOne: false
            referencedRelation: "user_pins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_pin_alert_settings: {
        Row: {
          alert_ccu_drop: boolean | null
          alert_ccu_spike: boolean | null
          alert_milestone: boolean | null
          alert_new_release: boolean | null
          alert_price_change: boolean | null
          alert_review_surge: boolean | null
          alert_sentiment_shift: boolean | null
          alert_trend_reversal: boolean | null
          alerts_enabled: boolean
          ccu_sensitivity: number | null
          created_at: string
          pin_id: string
          review_sensitivity: number | null
          sentiment_sensitivity: number | null
          updated_at: string
          use_custom_settings: boolean
        }
        Insert: {
          alert_ccu_drop?: boolean | null
          alert_ccu_spike?: boolean | null
          alert_milestone?: boolean | null
          alert_new_release?: boolean | null
          alert_price_change?: boolean | null
          alert_review_surge?: boolean | null
          alert_sentiment_shift?: boolean | null
          alert_trend_reversal?: boolean | null
          alerts_enabled?: boolean
          ccu_sensitivity?: number | null
          created_at?: string
          pin_id: string
          review_sensitivity?: number | null
          sentiment_sensitivity?: number | null
          updated_at?: string
          use_custom_settings?: boolean
        }
        Update: {
          alert_ccu_drop?: boolean | null
          alert_ccu_spike?: boolean | null
          alert_milestone?: boolean | null
          alert_new_release?: boolean | null
          alert_price_change?: boolean | null
          alert_review_surge?: boolean | null
          alert_sentiment_shift?: boolean | null
          alert_trend_reversal?: boolean | null
          alerts_enabled?: boolean
          ccu_sensitivity?: number | null
          created_at?: string
          pin_id?: string
          review_sensitivity?: number | null
          sentiment_sensitivity?: number | null
          updated_at?: string
          use_custom_settings?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "user_pin_alert_settings_pin_id_fkey"
            columns: ["pin_id"]
            isOneToOne: true
            referencedRelation: "user_pins"
            referencedColumns: ["id"]
          },
        ]
      }
      user_pins: {
        Row: {
          display_name: string
          entity_id: number
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          pin_order: number | null
          pinned_at: string
          user_id: string
        }
        Insert: {
          display_name: string
          entity_id: number
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          pin_order?: number | null
          pinned_at?: string
          user_id: string
        }
        Update: {
          display_name?: string
          entity_id?: number
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          pin_order?: number | null
          pinned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_pins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          credit_balance: number
          email: string
          full_name: string | null
          id: string
          organization: string | null
          role: Database["public"]["Enums"]["user_role"]
          total_credits_used: number
          total_messages_sent: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_balance?: number
          email: string
          full_name?: string | null
          id: string
          organization?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          total_credits_used?: number
          total_messages_sent?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_balance?: number
          email?: string
          full_name?: string | null
          id?: string
          organization?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          total_credits_used?: number
          total_messages_sent?: number
          updated_at?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          full_name: string
          how_i_plan_to_use: string | null
          id: string
          initial_credits: number
          invite_sent_at: string | null
          organization: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["waitlist_status"]
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          how_i_plan_to_use?: string | null
          id?: string
          initial_credits?: number
          invite_sent_at?: string | null
          organization?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          how_i_plan_to_use?: string | null
          id?: string
          initial_credits?: number
          invite_sent_at?: string | null
          organization?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["waitlist_status"]
        }
        Relationships: []
      }
    }
    Views: {
      app_filter_data: {
        Row: {
          active_player_pct: number | null
          appid: number | null
          category_ids: number[] | null
          days_live: number | null
          developer_id: number | null
          developer_name: string | null
          genre_ids: number[] | null
          has_workshop: boolean | null
          hype_duration: number | null
          momentum_score: number | null
          platform_array: string[] | null
          publisher_avg_score: number | null
          publisher_game_count: number | null
          publisher_id: number | null
          publisher_name: string | null
          review_rate: number | null
          sentiment_delta: number | null
          steam_deck_category:
            | Database["public"]["Enums"]["steam_deck_category"]
            | null
          tag_ids: number[] | null
          value_score: number | null
          velocity_acceleration: number | null
          vs_publisher_avg: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_developers_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_publishers_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_game_metrics: {
        Row: {
          appid: number | null
          ccu: number | null
          current_price_cents: number | null
          developer_id: number | null
          developer_name: string | null
          game_name: string | null
          owners: number | null
          positive_reviews: number | null
          release_date: string | null
          release_year: number | null
          revenue_estimate_cents: number | null
          review_score: number | null
          total_reviews: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_developers_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_metrics: {
        Row: {
          avg_review_score: number | null
          best_steam_deck_category:
            | Database["public"]["Enums"]["steam_deck_category"]
            | null
          category_ids: number[] | null
          ccu_growth_30d_percent: number | null
          ccu_growth_7d_percent: number | null
          computed_at: string | null
          developer_id: number | null
          developer_name: string | null
          estimated_weekly_hours: number | null
          game_count: number | null
          games_released_last_year: number | null
          games_trending_down: number | null
          games_trending_stable: number | null
          games_trending_up: number | null
          genre_ids: number[] | null
          is_trending: boolean | null
          platform_array: string[] | null
          positive_reviews: number | null
          revenue_estimate_cents: number | null
          review_velocity_30d: number | null
          review_velocity_7d: number | null
          tag_ids: number[] | null
          total_ccu: number | null
          total_owners: number | null
          total_reviews: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_developers_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_year_metrics: {
        Row: {
          avg_review_score: number | null
          developer_id: number | null
          developer_name: string | null
          earliest_release: string | null
          game_count: number | null
          latest_release: string | null
          release_year: number | null
          revenue_estimate_cents: number | null
          total_ccu: number | null
          total_owners: number | null
          total_reviews: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_developers_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "developers"
            referencedColumns: ["id"]
          },
        ]
      }
      latest_daily_metrics: {
        Row: {
          appid: number | null
          average_playtime_2weeks: number | null
          average_playtime_forever: number | null
          ccu_peak: number | null
          ccu_source: string | null
          discount_percent: number | null
          estimated_weekly_hours: number | null
          metric_date: string | null
          negative_reviews: number | null
          owners_max: number | null
          owners_midpoint: number | null
          owners_min: number | null
          positive_percentage: number | null
          positive_reviews: number | null
          price_cents: number | null
          review_score: number | null
          review_score_desc: string | null
          total_reviews: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      monthly_game_metrics: {
        Row: {
          appid: number | null
          estimated_monthly_hours: number | null
          game_name: string | null
          month: string | null
          month_num: number | null
          monthly_ccu_sum: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "daily_metrics_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
      mv_apps_aggregate_stats: {
        Row: {
          app_type: string | null
          avg_ccu: number | null
          avg_momentum: number | null
          avg_score: number | null
          avg_value_score: number | null
          sentiment_declining_count: number | null
          sentiment_improving_count: number | null
          total_games: number | null
          trending_down_count: number | null
          trending_up_count: number | null
        }
        Relationships: []
      }
      mv_category_counts: {
        Row: {
          app_count: number | null
          app_type: string | null
          category_id: number | null
          category_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "steam_categories"
            referencedColumns: ["category_id"]
          },
        ]
      }
      mv_ccu_tier_counts: {
        Row: {
          app_count: number | null
          app_type: string | null
          ccu_tier: number | null
        }
        Relationships: []
      }
      mv_genre_counts: {
        Row: {
          app_count: number | null
          app_type: string | null
          genre_id: number | null
          genre_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "steam_genres"
            referencedColumns: ["genre_id"]
          },
        ]
      }
      mv_steam_deck_counts: {
        Row: {
          app_count: number | null
          app_type: string | null
          steam_deck_category: string | null
        }
        Relationships: []
      }
      mv_tag_counts: {
        Row: {
          app_count: number | null
          app_type: string | null
          tag_id: number | null
          tag_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_steam_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "steam_tags"
            referencedColumns: ["tag_id"]
          },
        ]
      }
      mv_velocity_tier_counts: {
        Row: {
          app_count: number | null
          app_type: string | null
          velocity_tier: string | null
        }
        Relationships: []
      }
      publisher_game_metrics: {
        Row: {
          appid: number | null
          ccu: number | null
          current_price_cents: number | null
          game_name: string | null
          owners: number | null
          positive_reviews: number | null
          publisher_id: number | null
          publisher_name: string | null
          release_date: string | null
          release_year: number | null
          revenue_estimate_cents: number | null
          review_score: number | null
          total_reviews: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_publishers_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      publisher_metrics: {
        Row: {
          avg_review_score: number | null
          best_steam_deck_category:
            | Database["public"]["Enums"]["steam_deck_category"]
            | null
          category_ids: number[] | null
          ccu_growth_30d_percent: number | null
          ccu_growth_7d_percent: number | null
          computed_at: string | null
          estimated_weekly_hours: number | null
          game_count: number | null
          games_released_last_year: number | null
          games_trending_down: number | null
          games_trending_stable: number | null
          games_trending_up: number | null
          genre_ids: number[] | null
          is_trending: boolean | null
          platform_array: string[] | null
          positive_reviews: number | null
          publisher_id: number | null
          publisher_name: string | null
          revenue_estimate_cents: number | null
          review_velocity_30d: number | null
          review_velocity_7d: number | null
          tag_ids: number[] | null
          total_ccu: number | null
          total_owners: number | null
          total_reviews: number | null
          unique_developers: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_publishers_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      publisher_year_metrics: {
        Row: {
          avg_review_score: number | null
          earliest_release: string | null
          game_count: number | null
          latest_release: string | null
          publisher_id: number | null
          publisher_name: string | null
          release_year: number | null
          revenue_estimate_cents: number | null
          total_ccu: number | null
          total_owners: number | null
          total_reviews: number | null
        }
        Relationships: [
          {
            foreignKeyName: "app_publishers_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      review_velocity_stats: {
        Row: {
          actual_sync_count: number | null
          appid: number | null
          last_delta_date: string | null
          reviews_added_30d: number | null
          reviews_added_7d: number | null
          velocity_30d: number | null
          velocity_7d: number | null
          velocity_tier: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "app_filter_data"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "developer_game_metrics"
            referencedColumns: ["appid"]
          },
          {
            foreignKeyName: "review_deltas_appid_fkey"
            columns: ["appid"]
            isOneToOne: false
            referencedRelation: "publisher_game_metrics"
            referencedColumns: ["appid"]
          },
        ]
      }
    }
    Functions: {
      admin_adjust_credits: {
        Args: {
          p_admin_id: string
          p_amount: number
          p_description: string
          p_user_id: string
        }
        Returns: {
          new_balance: number
          success: boolean
        }[]
      }
      admin_adjust_user_credits: {
        Args: { p_amount: number; p_description: string; p_user_id: string }
        Returns: {
          new_balance: number
          success: boolean
        }[]
      }
      aggregate_daily_ccu_peaks: {
        Args: { target_date?: string }
        Returns: number
      }
      batch_update_prices: {
        Args: { p_appids: number[]; p_discounts: number[]; p_prices: number[] }
        Returns: number
      }
      check_and_increment_rate_limit: {
        Args: { p_user_id: string }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
        }[]
      }
      claim_app_capture_queue: {
        Args: {
          p_limit?: number
          p_sources: Database["public"]["Enums"]["app_capture_source"][]
          p_worker_id: string
        }
        Returns: {
          appid: number
          attempts: number
          available_at: string
          id: number
          payload: Json
          priority: number
          source: Database["public"]["Enums"]["app_capture_source"]
          trigger_cursor: string
          trigger_reason: string
        }[]
      }
      cleanup_old_ccu_snapshots: { Args: never; Returns: number }
      cleanup_old_chat_logs: { Args: never; Returns: number }
      cleanup_stale_reservations: { Args: never; Returns: number }
      complete_app_capture_queue: {
        Args: {
          p_error?: string
          p_ids: number[]
          p_status?: Database["public"]["Enums"]["app_capture_status"]
        }
        Returns: number
      }
      enqueue_app_capture_queue: { Args: { p_jobs?: Json }; Returns: number }
      execute_readonly_query: { Args: { query_text: string }; Returns: Json }
      finalize_credits: {
        Args: {
          p_actual_amount: number
          p_description?: string
          p_input_tokens?: number
          p_output_tokens?: number
          p_reservation_id: string
          p_tool_credits?: number
        }
        Returns: {
          new_balance: number
          refunded: number
          success: boolean
        }[]
      }
      get_app_change_feed: {
        Args: {
          p_appid: number
          p_from?: string
          p_limit?: number
          p_to?: string
        }
        Returns: {
          after_value: Json
          app_name: string
          appid: number
          baseline_30d: Json
          baseline_7d: Json
          before_value: Json
          change_type: Database["public"]["Enums"]["app_change_type"]
          context: Json
          event_id: number
          media_version_id: number
          news_item_gid: string
          occurred_at: string
          related_snapshot_id: number
          response_1d: Json
          response_30d: Json
          response_7d: Json
          source: string
          source_snapshot_id: number
        }[]
      }
      get_app_sparkline_data: {
        Args: { p_appids: number[]; p_days?: number }
        Returns: {
          appid: number
          sparkline_data: Json
        }[]
      }
      get_apps_aggregate_stats: {
        Args: {
          p_categories?: number[]
          p_ccu_tier?: number
          p_controller?: string
          p_developer_search?: string
          p_early_access?: boolean
          p_genre_mode?: string
          p_genres?: number[]
          p_has_workshop?: boolean
          p_is_free?: boolean
          p_max_age?: number
          p_max_ccu?: number
          p_max_growth_30d?: number
          p_max_growth_7d?: number
          p_max_hype?: number
          p_max_momentum?: number
          p_max_owners?: number
          p_max_playtime?: number
          p_max_price?: number
          p_max_reviews?: number
          p_max_score?: number
          p_max_sentiment_delta?: number
          p_min_active_pct?: number
          p_min_age?: number
          p_min_ccu?: number
          p_min_discount?: number
          p_min_growth_30d?: number
          p_min_growth_7d?: number
          p_min_hype?: number
          p_min_momentum?: number
          p_min_owners?: number
          p_min_playtime?: number
          p_min_price?: number
          p_min_review_rate?: number
          p_min_reviews?: number
          p_min_score?: number
          p_min_sentiment_delta?: number
          p_min_value_score?: number
          p_min_vs_publisher?: number
          p_platform_mode?: string
          p_platforms?: string[]
          p_publisher_search?: string
          p_publisher_size?: string
          p_release_year?: number
          p_search?: string
          p_self_published?: boolean
          p_steam_deck?: string
          p_tag_mode?: string
          p_tags?: number[]
          p_type?: string
          p_velocity_tier?: string
        }
        Returns: {
          avg_ccu: number
          avg_momentum: number
          avg_score: number
          avg_value_score: number
          sentiment_declining_count: number
          sentiment_improving_count: number
          total_games: number
          trending_down_count: number
          trending_up_count: number
        }[]
      }
      get_apps_by_ids: {
        Args: { p_appids: number[] }
        Returns: {
          active_player_pct: number
          appid: number
          average_playtime_2weeks: number
          average_playtime_forever: number
          ccu_growth_30d_percent: number
          ccu_growth_7d_percent: number
          ccu_peak: number
          ccu_tier: number
          controller_support: string
          current_discount_percent: number
          data_updated_at: string
          days_live: number
          developer_id: number
          developer_name: string
          hype_duration: number
          is_delisted: boolean
          is_free: boolean
          metric_date: string
          momentum_score: number
          name: string
          owners_max: number
          owners_midpoint: number
          owners_min: number
          platforms: string
          positive_percentage: number
          positive_reviews: number
          price_cents: number
          publisher_game_count: number
          publisher_id: number
          publisher_name: string
          release_date: string
          release_state: string
          review_rate: number
          review_score: number
          sentiment_delta: number
          steam_deck_category: string
          total_reviews: number
          type: string
          value_score: number
          velocity_30d: number
          velocity_7d: number
          velocity_acceleration: number
          velocity_tier: string
          vs_publisher_avg: number
        }[]
      }
      get_apps_filter_option_counts: {
        Args: {
          p_filter_type: string
          p_min_ccu?: number
          p_min_owners?: number
          p_min_reviews?: number
          p_min_score?: number
          p_type?: string
        }
        Returns: {
          app_count: number
          option_id: number
          option_name: string
        }[]
      }
      get_apps_for_embedding: {
        Args: { p_limit?: number }
        Returns: {
          appid: number
          average_playtime_forever: number
          categories: string[]
          ccu_growth_30d: number
          ccu_growth_7d: number
          ccu_peak: number
          content_descriptors: Json
          controller_support: string
          current_price_cents: number
          developer_ids: number[]
          developers: string[]
          franchise_ids: number[]
          franchise_names: string[]
          genres: string[]
          historical_review_pct: number
          is_delisted: boolean
          is_free: boolean
          is_released: boolean
          language_count: number
          metacritic_score: number
          name: string
          owners_min: number
          pics_review_percentage: number
          pics_review_score: number
          platforms: string
          primary_genre: string
          publisher_ids: number[]
          publishers: string[]
          recent_review_pct: number
          release_date: string
          sentiment_delta: number
          steam_deck_category: string
          steamspy_tags: string[]
          tags: string[]
          total_reviews: number
          trend_30d_direction: string
          type: string
          updated_at: string
          velocity_7d: number
          velocity_acceleration: number
          velocity_tier: string
        }[]
      }
      get_apps_for_embedding_by_ids: {
        Args: { p_appids: number[] }
        Returns: {
          appid: number
          average_playtime_forever: number
          categories: string[]
          ccu_growth_30d: number
          ccu_growth_7d: number
          ccu_peak: number
          content_descriptors: Json
          controller_support: string
          current_price_cents: number
          developer_ids: number[]
          developers: string[]
          franchise_ids: number[]
          franchise_names: string[]
          genres: string[]
          historical_review_pct: number
          is_delisted: boolean
          is_free: boolean
          is_released: boolean
          language_count: number
          metacritic_score: number
          name: string
          owners_min: number
          pics_review_percentage: number
          pics_review_score: number
          platforms: string
          primary_genre: string
          publisher_ids: number[]
          publishers: string[]
          recent_review_pct: number
          release_date: string
          sentiment_delta: number
          steam_deck_category: string
          steamspy_tags: string[]
          tags: string[]
          total_reviews: number
          trend_30d_direction: string
          type: string
          updated_at: string
          velocity_7d: number
          velocity_acceleration: number
          velocity_tier: string
        }[]
      }
      get_apps_for_reviews_sync: {
        Args: { p_limit?: number }
        Returns: {
          appid: number
          hours_overdue: number
          last_known_total_reviews: number
          priority_score: number
          velocity_tier: string
        }[]
      }
      get_apps_for_sync: {
        Args: {
          p_limit?: number
          p_source: Database["public"]["Enums"]["sync_source"]
        }
        Returns: {
          appid: number
          priority_score: number
        }[]
      }
      get_apps_for_sync_partitioned: {
        Args: {
          p_limit: number
          p_partition_count: number
          p_partition_id: number
          p_source: Database["public"]["Enums"]["sync_source"]
        }
        Returns: {
          appid: number
          priority_score: number
        }[]
      }
      get_apps_with_filters: {
        Args: {
          p_categories?: number[]
          p_ccu_tier?: number
          p_controller?: string
          p_developer_search?: string
          p_early_access?: boolean
          p_genre_mode?: string
          p_genres?: number[]
          p_has_workshop?: boolean
          p_is_free?: boolean
          p_limit?: number
          p_max_age?: number
          p_max_ccu?: number
          p_max_growth_30d?: number
          p_max_growth_7d?: number
          p_max_hype?: number
          p_max_momentum?: number
          p_max_owners?: number
          p_max_playtime?: number
          p_max_price?: number
          p_max_reviews?: number
          p_max_score?: number
          p_max_sentiment_delta?: number
          p_min_active_pct?: number
          p_min_age?: number
          p_min_ccu?: number
          p_min_discount?: number
          p_min_growth_30d?: number
          p_min_growth_7d?: number
          p_min_hype?: number
          p_min_momentum?: number
          p_min_owners?: number
          p_min_playtime?: number
          p_min_price?: number
          p_min_review_rate?: number
          p_min_reviews?: number
          p_min_score?: number
          p_min_sentiment_delta?: number
          p_min_value_score?: number
          p_min_vs_publisher?: number
          p_offset?: number
          p_platform_mode?: string
          p_platforms?: string[]
          p_publisher_search?: string
          p_publisher_size?: string
          p_release_year?: number
          p_search?: string
          p_self_published?: boolean
          p_sort_field?: string
          p_sort_order?: string
          p_steam_deck?: string
          p_tag_mode?: string
          p_tags?: number[]
          p_type?: string
          p_velocity_tier?: string
        }
        Returns: {
          active_player_pct: number
          appid: number
          average_playtime_2weeks: number
          average_playtime_forever: number
          ccu_growth_30d_percent: number
          ccu_growth_7d_percent: number
          ccu_peak: number
          ccu_tier: number
          controller_support: string
          current_discount_percent: number
          data_updated_at: string
          days_live: number
          developer_id: number
          developer_name: string
          hype_duration: number
          is_free: boolean
          metric_date: string
          momentum_score: number
          name: string
          owners_max: number
          owners_midpoint: number
          owners_min: number
          platforms: string
          positive_percentage: number
          positive_reviews: number
          price_cents: number
          publisher_game_count: number
          publisher_id: number
          publisher_name: string
          release_date: string
          release_state: string
          review_rate: number
          review_score: number
          sentiment_delta: number
          steam_deck_category: string
          total_reviews: number
          type: string
          value_score: number
          velocity_30d: number
          velocity_7d: number
          velocity_acceleration: number
          velocity_tier: string
          vs_publisher_avg: number
        }[]
      }
      get_change_feed_activity: {
        Args: {
          p_app_types?: string[]
          p_cursor_activity_id?: string
          p_cursor_score?: number
          p_cursor_time?: string
          p_days?: number
          p_limit?: number
          p_mode?: string
          p_search?: string
          p_signal_families?: string[]
          p_sort?: string
          p_view?: string
        }
        Returns: {
          activity_id: string
          activity_kind: string
          app_name: string
          app_type: string
          appid: number
          external_url: string
          facts: string[]
          has_before_after: boolean
          headline: string
          highlight_labels: string[]
          is_released: boolean
          occurred_at: string
          related_announcement_count: number
          release_date: string
          signal_families: string[]
          sort_score: number
          story_kind: string
          summary: string
        }[]
      }
      get_change_feed_burst_detail: {
        Args: { p_burst_id: string }
        Returns: {
          app_name: string
          app_type: string
          appid: number
          burst_ended_at: string
          burst_id: string
          burst_started_at: string
          change_type_count: number
          effective_at: string
          event_count: number
          events: Json
          has_related_news: boolean
          headline_change_types: string[]
          impact: Json
          is_released: boolean
          related_news: Json
          related_news_count: number
          release_date: string
          source_set: string[]
        }[]
      }
      get_change_feed_bursts: {
        Args: {
          p_app_types?: string[]
          p_cursor_burst_id?: string
          p_cursor_time?: string
          p_days?: number
          p_limit?: number
          p_preset?: string
          p_search?: string
          p_source_filter?: string[]
        }
        Returns: {
          app_name: string
          app_type: string
          appid: number
          burst_ended_at: string
          burst_id: string
          burst_started_at: string
          change_type_count: number
          effective_at: string
          event_count: number
          has_related_news: boolean
          headline_change_types: string[]
          is_released: boolean
          related_news_count: number
          release_date: string
          source_set: string[]
        }[]
      }
      get_change_feed_news: {
        Args: {
          p_app_types?: string[]
          p_cursor_gid?: string
          p_cursor_time?: string
          p_days?: number
          p_limit?: number
          p_search?: string
        }
        Returns: {
          app_name: string
          app_type: string
          appid: number
          feedlabel: string
          feedname: string
          first_seen_at: string
          gid: string
          published_at: string
          title: string
          url: string
        }[]
      }
      get_change_window_metrics: {
        Args: { p_appid: number; p_end: string; p_start: string }
        Returns: Json
      }
      get_catalog_control_stats: {
        Args: never
        Returns: {
          current_catalog_apps: number
          historical_retained_apps: number
          latest_applist_completed_at: string | null
          latest_applist_started_at: string | null
          latest_live_app_count: number
          live_only_missing: number
          stale_running_applist_jobs: number
        }[]
      }
      get_companies_aggregate_stats: {
        Args: {
          p_categories?: number[]
          p_genre_mode?: string
          p_genres?: number[]
          p_max_ccu?: number
          p_max_games?: number
          p_max_growth_30d?: number
          p_max_growth_7d?: number
          p_max_hours?: number
          p_max_owners?: number
          p_max_revenue?: number
          p_max_reviews?: number
          p_max_score?: number
          p_min_ccu?: number
          p_min_games?: number
          p_min_growth_30d?: number
          p_min_growth_7d?: number
          p_min_hours?: number
          p_min_owners?: number
          p_min_revenue?: number
          p_min_reviews?: number
          p_min_score?: number
          p_platform_mode?: string
          p_platforms?: string[]
          p_relationship?: string
          p_search?: string
          p_status?: string
          p_steam_deck?: string
          p_tags?: number[]
          p_type?: string
        }
        Returns: {
          avg_review_score: number
          total_ccu: number
          total_companies: number
          total_games: number
          total_owners: number
          total_revenue: number
        }[]
      }
      get_companies_with_filters: {
        Args: {
          p_categories?: number[]
          p_genre_mode?: string
          p_genres?: number[]
          p_limit?: number
          p_max_ccu?: number
          p_max_games?: number
          p_max_growth_30d?: number
          p_max_growth_7d?: number
          p_max_hours?: number
          p_max_owners?: number
          p_max_revenue?: number
          p_max_reviews?: number
          p_max_score?: number
          p_min_ccu?: number
          p_min_games?: number
          p_min_growth_30d?: number
          p_min_growth_7d?: number
          p_min_hours?: number
          p_min_owners?: number
          p_min_revenue?: number
          p_min_reviews?: number
          p_min_score?: number
          p_offset?: number
          p_period?: string
          p_platform_mode?: string
          p_platforms?: string[]
          p_relationship?: string
          p_search?: string
          p_sort_by?: string
          p_sort_order?: string
          p_status?: string
          p_steam_deck?: string
          p_tags?: number[]
          p_type?: string
        }
        Returns: {
          avg_review_score: number
          ccu_growth_30d_percent: number
          ccu_growth_7d_percent: number
          data_updated_at: string
          estimated_weekly_hours: number
          external_partner_count: number
          first_release_date: string
          game_count: number
          games_trending_down: number
          games_trending_up: number
          id: number
          is_self_published: boolean
          latest_release_date: string
          name: string
          positive_reviews: number
          revenue_estimate_cents: number
          review_velocity_30d: number
          review_velocity_7d: number
          steam_vanity_url: string
          total_ccu: number
          total_owners: number
          total_reviews: number
          type: string
          unique_developers: number
          works_with_external_devs: boolean
          years_active: number
        }[]
      }
      get_company_sparkline_data: {
        Args: { p_company_id: number; p_company_type: string; p_days?: number }
        Returns: {
          day: string
          peak_ccu: number
          total_ccu: number
        }[]
      }
      get_credit_balance: { Args: { p_user_id: string }; Returns: number }
      get_developer_stats: { Args: never; Returns: Json }
      get_developers_for_embedding: {
        Args: { p_limit?: number }
        Returns: {
          avg_review_percentage: number
          first_game_release_date: string
          game_count: number
          id: number
          is_indie: boolean
          name: string
          platforms_supported: string[]
          top_game_appids: number[]
          top_game_names: string[]
          top_genres: string[]
          top_tags: string[]
          total_reviews: number
        }[]
      }
      get_developers_needing_embedding: {
        Args: { p_limit?: number }
        Returns: {
          avg_review_percentage: number
          first_game_release_date: string
          game_count: number
          id: number
          is_indie: boolean
          name: string
          platforms_supported: string[]
          top_game_appids: number[]
          top_game_names: string[]
          top_genres: string[]
          top_tags: string[]
          total_reviews: number
        }[]
      }
      get_developers_with_metrics: {
        Args: {
          p_limit?: number
          p_min_ccu?: number
          p_min_games?: number
          p_min_owners?: number
          p_min_score?: number
          p_offset?: number
          p_search?: string
          p_sort_field?: string
          p_sort_order?: string
          p_status?: string
        }
        Returns: {
          computed_at: string
          estimated_revenue_usd: number
          first_game_release_date: string
          game_count: number
          games_released_last_year: number
          games_trending_down: number
          games_trending_up: number
          id: number
          max_ccu_peak: number
          name: string
          normalized_name: string
          steam_vanity_url: string
          total_ccu_peak: number
          total_owners_max: number
          total_owners_min: number
          total_reviews: number
          weighted_review_score: number
        }[]
      }
      get_filter_option_counts: {
        Args: {
          p_company_type?: string
          p_filter_type: string
          p_min_games?: number
          p_min_revenue?: number
          p_status?: string
        }
        Returns: {
          company_count: number
          option_id: number
          option_name: string
        }[]
      }
      get_fully_completed_apps_count: {
        Args: never
        Returns: number
      }
      get_game_momentum: {
        Args: { p_appid: number }
        Returns: {
          ccu_growth_30d: number
          ccu_growth_7d: number
          velocity_7d: number
          velocity_acceleration: number
        }[]
      }
      get_histogram_appids:
        | {
            Args: never
            Returns: {
              appid: number
            }[]
          }
        | {
            Args: { p_limit?: number; p_offset?: number }
            Returns: {
              appid: number
            }[]
          }
      get_pics_data_stats: {
        Args: never
        Returns: {
          total_apps: number
          with_categories: number
          with_franchises: number
          with_genres: number
          with_parent_app: number
          with_pics_sync: number
          with_tags: number
        }[]
      }
      get_pinned_entities_with_metrics: {
        Args: never
        Returns: {
          alert_ccu_drop: boolean
          alert_ccu_spike: boolean
          alert_milestone: boolean
          alert_new_release: boolean
          alert_price_change: boolean
          alert_review_surge: boolean
          alert_sentiment_shift: boolean
          alert_trend_reversal: boolean
          alerts_enabled: boolean
          ccu_7d_avg: number
          ccu_current: number
          discount_percent: number
          display_name: string
          entity_id: number
          entity_type: Database["public"]["Enums"]["entity_type"]
          pin_id: string
          positive_ratio: number
          price_cents: number
          review_velocity: number
          sensitivity_ccu: number
          sensitivity_review: number
          sensitivity_sentiment: number
          total_reviews: number
          trend_30d_direction: string
          user_id: string
        }[]
      }
      get_priority_distribution: {
        Args: never
        Returns: {
          high: number
          low: number
          medium: number
          minimal: number
          normal_priority: number
        }[]
      }
      get_publisher_stats: { Args: never; Returns: Json }
      get_publishers_for_embedding: {
        Args: { p_limit?: number }
        Returns: {
          avg_review_percentage: number
          first_game_release_date: string
          game_count: number
          id: number
          name: string
          platforms_supported: string[]
          top_game_appids: number[]
          top_game_names: string[]
          top_genres: string[]
          top_tags: string[]
          total_reviews: number
        }[]
      }
      get_publishers_needing_embedding: {
        Args: { p_limit?: number }
        Returns: {
          avg_review_percentage: number
          first_game_release_date: string
          game_count: number
          id: number
          name: string
          platforms_supported: string[]
          top_game_appids: number[]
          top_game_names: string[]
          top_genres: string[]
          top_tags: string[]
          total_reviews: number
        }[]
      }
      get_publishers_with_metrics: {
        Args: {
          p_limit?: number
          p_min_ccu?: number
          p_min_developers?: number
          p_min_games?: number
          p_min_owners?: number
          p_min_score?: number
          p_offset?: number
          p_search?: string
          p_sort_field?: string
          p_sort_order?: string
          p_status?: string
        }
        Returns: {
          computed_at: string
          estimated_revenue_usd: number
          first_game_release_date: string
          game_count: number
          games_released_last_year: number
          games_trending_down: number
          games_trending_up: number
          id: number
          max_ccu_peak: number
          name: string
          normalized_name: string
          steam_vanity_url: string
          total_ccu_peak: number
          total_owners_max: number
          total_owners_min: number
          total_reviews: number
          unique_developers: number
          weighted_review_score: number
        }[]
      }
      get_queue_status: {
        Args: never
        Returns: {
          due_in_1_hour: number
          due_in_24_hours: number
          due_in_6_hours: number
          overdue: number
        }[]
      }
      get_recent_app_changes: {
        Args: {
          p_days?: number
          p_limit?: number
          p_types?: Database["public"]["Enums"]["app_change_type"][]
        }
        Returns: {
          after_value: Json
          app_name: string
          appid: number
          baseline_30d: Json
          baseline_7d: Json
          before_value: Json
          change_type: Database["public"]["Enums"]["app_change_type"]
          context: Json
          event_id: number
          media_version_id: number
          news_item_gid: string
          occurred_at: string
          related_snapshot_id: number
          response_1d: Json
          response_30d: Json
          response_7d: Json
          source: string
          source_snapshot_id: number
        }[]
      }
      get_sentiment_trajectory: {
        Args: { p_appid: number }
        Returns: {
          historical_review_pct: number
          recent_review_pct: number
          sentiment_delta: number
        }[]
      }
      get_source_completion_stats: {
        Args: never
        Returns: {
          source: string
          stale_apps: number
          synced_apps: number
          total_apps: number
        }[]
      }
      get_steamspy_individual_fetch_candidates: {
        Args: { p_limit?: number; p_min_reviews?: number }
        Returns: {
          appid: number
          name: string
          total_reviews: number
        }[]
      }
      get_storage_bucket_usage_bytes: {
        Args: { p_bucket_id: string }
        Returns: number
      }
      get_tier3_games_partitioned: {
        Args: {
          p_limit: number
          p_partition_count: number
          p_partition_id: number
        }
        Returns: {
          appid: number
        }[]
      }
      get_unsynced_app_ids: {
        Args: never
        Returns: {
          appid: number
        }[]
      }
      get_user_pins_with_metrics: {
        Args: { p_user_id: string }
        Returns: {
          ccu_change_pct: number
          ccu_current: number
          discount_percent: number
          display_name: string
          entity_id: number
          entity_type: Database["public"]["Enums"]["entity_type"]
          pin_id: string
          pin_order: number
          pinned_at: string
          positive_pct: number
          price_cents: number
          review_velocity: number
          total_reviews: number
          trend_direction: string
        }[]
      }
      interpolate_all_review_deltas: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: {
          apps_processed: number
          total_interpolated: number
        }[]
      }
      interpolate_review_deltas: {
        Args: { p_appid: number; p_end_date?: string; p_start_date?: string }
        Returns: number
      }
      interpolate_review_deltas_batch: {
        Args: {
          p_after_appid?: number
          p_app_limit?: number
          p_end_date?: string
          p_start_date?: string
        }
        Returns: {
          apps_processed: number
          has_more: boolean
          last_appid: number
          total_interpolated: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      mark_apps_embedded: {
        Args: { p_appids: number[]; p_hashes: string[] }
        Returns: undefined
      }
      mark_developers_embedded: {
        Args: { p_hashes: string[]; p_ids: number[] }
        Returns: undefined
      }
      mark_publishers_embedded: {
        Args: { p_hashes: string[]; p_ids: number[] }
        Returns: undefined
      }
      recalculate_ccu_tiers: {
        Args: never
        Returns: {
          tier1_count: number
          tier2_count: number
          tier3_count: number
        }[]
      }
      refresh_all_metrics_views: { Args: never; Returns: undefined }
      refresh_dashboard_stats: { Args: never; Returns: undefined }
      refresh_entity_metrics: { Args: never; Returns: undefined }
      refresh_filter_count_views: { Args: never; Returns: undefined }
      refresh_latest_daily_metrics: { Args: never; Returns: undefined }
      refresh_materialized_view: {
        Args: { view_name: string }
        Returns: undefined
      }
      refresh_monthly_game_metrics: { Args: never; Returns: undefined }
      refresh_review_velocity_stats: { Args: never; Returns: undefined }
      refund_reservation: {
        Args: { p_reservation_id: string }
        Returns: {
          new_balance: number
          refunded: number
          success: boolean
        }[]
      }
      replace_app_categories: {
        Args: { p_appid: number; p_category_ids: number[] }
        Returns: undefined
      }
      replace_app_genres: {
        Args: {
          p_appid: number
          p_genre_ids: number[]
          p_primary_genre_id?: number
        }
        Returns: undefined
      }
      replace_app_steam_tags: {
        Args: { p_appid: number; p_tag_ids: number[] }
        Returns: undefined
      }
      reserve_credits: {
        Args: { p_amount: number; p_user_id: string }
        Returns: string
      }
      search_developers_fuzzy: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          game_count: number
          id: number
          is_exact_match: boolean
          name: string
          similarity_score: number
        }[]
      }
      search_games_fuzzy: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          appid: number
          is_exact_match: boolean
          is_free: boolean
          name: string
          positive_percentage: number
          release_date: string
          similarity_score: number
          total_reviews: number
        }[]
      }
      search_publishers_fuzzy: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          game_count: number
          id: number
          is_exact_match: boolean
          name: string
          similarity_score: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_alert_detection_state: {
        Args: {
          p_ccu_7d_avg?: number
          p_ccu_7d_max?: number
          p_ccu_7d_min?: number
          p_ccu_prev_value?: number
          p_discount_percent_prev?: number
          p_entity_id: number
          p_entity_type: Database["public"]["Enums"]["entity_type"]
          p_positive_ratio_prev?: number
          p_price_cents_prev?: number
          p_review_velocity_7d_avg?: number
          p_total_reviews_prev?: number
          p_trend_30d_direction_prev?: string
        }
        Returns: undefined
      }
      update_review_velocity_tiers: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      update_user_profile: {
        Args: { p_full_name?: string; p_organization?: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      upsert_developer: { Args: { p_name: string }; Returns: number }
      upsert_franchise: { Args: { p_name: string }; Returns: number }
      upsert_publisher: { Args: { p_name: string }; Returns: number }
      upsert_steam_tag: {
        Args: { p_name: string; p_tag_id: number }
        Returns: number
      }
      upsert_storefront_app: {
        Args: {
          p_appid: number
          p_current_discount_percent: number
          p_current_price_cents: number
          p_developers: string[]
          p_dlc_appids?: number[]
          p_has_workshop: boolean
          p_is_delisted: boolean
          p_is_free: boolean
          p_is_released: boolean
          p_name: string
          p_parent_appid?: number
          p_publishers: string[]
          p_release_date: string
          p_release_date_raw: string
          p_type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      alert_severity: "low" | "medium" | "high"
      alert_type:
        | "ccu_spike"
        | "ccu_drop"
        | "trend_reversal"
        | "review_surge"
        | "sentiment_shift"
        | "price_change"
        | "new_release"
        | "milestone"
      app_capture_source: "storefront" | "news" | "hero_asset" | "projection_refresh"
      app_capture_status:
        | "queued"
        | "claimed"
        | "completed"
        | "failed"
        | "dead_letter"
      app_change_source: "storefront" | "pics" | "news" | "media"
      app_change_type:
        | "description_rewrite"
        | "short_description_rewrite"
        | "release_date_text_change"
        | "price_change"
        | "discount_start"
        | "discount_end"
        | "tags_added"
        | "tags_removed"
        | "genres_changed"
        | "categories_changed"
        | "languages_changed"
        | "platforms_changed"
        | "controller_support_changed"
        | "steam_deck_status_changed"
        | "publisher_association_changed"
        | "developer_association_changed"
        | "dlc_references_changed"
        | "package_references_changed"
        | "build_id_changed"
        | "last_content_update_changed"
        | "news_published"
        | "news_edited"
        | "capsule_url_changed"
        | "header_url_changed"
        | "background_url_changed"
        | "screenshot_added"
        | "screenshot_removed"
        | "screenshot_reordered"
        | "trailer_added"
        | "trailer_removed"
        | "trailer_reordered"
        | "trailer_thumbnail_changed"
      app_snapshot_source: "storefront" | "pics"
      app_type:
        | "game"
        | "dlc"
        | "demo"
        | "mod"
        | "video"
        | "hardware"
        | "music"
        | "episode"
        | "tool"
        | "application"
        | "series"
        | "advertising"
      credit_reservation_status: "pending" | "finalized" | "refunded"
      credit_transaction_type:
        | "signup_bonus"
        | "admin_grant"
        | "admin_deduct"
        | "chat_usage"
        | "refund"
      entity_type: "game" | "publisher" | "developer"
      refresh_tier: "active" | "moderate" | "dormant" | "dead"
      steam_deck_category: "unknown" | "unsupported" | "playable" | "verified"
      sync_source:
        | "steamspy"
        | "storefront"
        | "reviews"
        | "histogram"
        | "scraper"
        | "pics"
        | "news"
        | "hero_asset"
        | "change_hints"
      trend_direction: "up" | "down" | "stable"
      user_role: "user" | "admin"
      waitlist_status: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_severity: ["low", "medium", "high"],
      alert_type: [
        "ccu_spike",
        "ccu_drop",
        "trend_reversal",
        "review_surge",
        "sentiment_shift",
        "price_change",
        "new_release",
        "milestone",
      ],
      app_capture_source: ["storefront", "news", "hero_asset", "projection_refresh"],
      app_capture_status: [
        "queued",
        "claimed",
        "completed",
        "failed",
        "dead_letter",
      ],
      app_change_source: ["storefront", "pics", "news", "media"],
      app_change_type: [
        "description_rewrite",
        "short_description_rewrite",
        "release_date_text_change",
        "price_change",
        "discount_start",
        "discount_end",
        "tags_added",
        "tags_removed",
        "genres_changed",
        "categories_changed",
        "languages_changed",
        "platforms_changed",
        "controller_support_changed",
        "steam_deck_status_changed",
        "publisher_association_changed",
        "developer_association_changed",
        "dlc_references_changed",
        "package_references_changed",
        "build_id_changed",
        "last_content_update_changed",
        "news_published",
        "news_edited",
        "capsule_url_changed",
        "header_url_changed",
        "background_url_changed",
        "screenshot_added",
        "screenshot_removed",
        "screenshot_reordered",
        "trailer_added",
        "trailer_removed",
        "trailer_reordered",
        "trailer_thumbnail_changed",
      ],
      app_snapshot_source: ["storefront", "pics"],
      app_type: [
        "game",
        "dlc",
        "demo",
        "mod",
        "video",
        "hardware",
        "music",
        "episode",
        "tool",
        "application",
        "series",
        "advertising",
      ],
      credit_reservation_status: ["pending", "finalized", "refunded"],
      credit_transaction_type: [
        "signup_bonus",
        "admin_grant",
        "admin_deduct",
        "chat_usage",
        "refund",
      ],
      entity_type: ["game", "publisher", "developer"],
      refresh_tier: ["active", "moderate", "dormant", "dead"],
      steam_deck_category: ["unknown", "unsupported", "playable", "verified"],
      sync_source: [
        "steamspy",
        "storefront",
        "reviews",
        "histogram",
        "scraper",
        "pics",
        "news",
        "hero_asset",
        "change_hints",
      ],
      trend_direction: ["up", "down", "stable"],
      user_role: ["user", "admin"],
      waitlist_status: ["pending", "approved", "rejected"],
    },
  },
} as const
