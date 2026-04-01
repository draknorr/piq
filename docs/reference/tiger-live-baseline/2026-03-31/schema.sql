--
-- PostgreSQL database dump
--

\restrict maVkRWOnRfbx7CVH4xHwzncQP3hTiPrNmfnKXesDcP1heXOQfRLz1k07uxeCPc1

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: pg_cron; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;


--
-- Name: EXTENSION pg_cron; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_cron IS 'Job scheduler for PostgreSQL';


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: supabase_migrations; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA supabase_migrations;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;


--
-- Name: EXTENSION pg_graphql; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_graphql IS 'pg_graphql: GraphQL support';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: alert_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_severity AS ENUM (
    'low',
    'medium',
    'high'
);


--
-- Name: alert_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_type AS ENUM (
    'ccu_spike',
    'ccu_drop',
    'trend_reversal',
    'review_surge',
    'sentiment_shift',
    'price_change',
    'new_release',
    'milestone'
);


--
-- Name: app_capture_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_capture_source AS ENUM (
    'storefront',
    'news',
    'hero_asset',
    'projection_refresh'
);


--
-- Name: app_capture_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_capture_status AS ENUM (
    'queued',
    'claimed',
    'completed',
    'failed',
    'dead_letter'
);


--
-- Name: app_change_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_change_source AS ENUM (
    'storefront',
    'pics',
    'news',
    'media'
);


--
-- Name: app_change_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_change_type AS ENUM (
    'description_rewrite',
    'short_description_rewrite',
    'release_date_text_change',
    'price_change',
    'discount_start',
    'discount_end',
    'tags_added',
    'tags_removed',
    'genres_changed',
    'categories_changed',
    'languages_changed',
    'platforms_changed',
    'controller_support_changed',
    'steam_deck_status_changed',
    'publisher_association_changed',
    'developer_association_changed',
    'dlc_references_changed',
    'package_references_changed',
    'build_id_changed',
    'last_content_update_changed',
    'news_published',
    'news_edited',
    'capsule_url_changed',
    'header_url_changed',
    'background_url_changed',
    'screenshot_added',
    'screenshot_removed',
    'screenshot_reordered',
    'trailer_added',
    'trailer_removed',
    'trailer_reordered',
    'trailer_thumbnail_changed'
);


--
-- Name: app_snapshot_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_snapshot_source AS ENUM (
    'storefront',
    'pics'
);


--
-- Name: app_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_type AS ENUM (
    'game',
    'dlc',
    'demo',
    'mod',
    'video',
    'hardware',
    'music',
    'episode',
    'tool',
    'application',
    'series',
    'advertising'
);


--
-- Name: credit_reservation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credit_reservation_status AS ENUM (
    'pending',
    'finalized',
    'refunded'
);


--
-- Name: credit_transaction_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credit_transaction_type AS ENUM (
    'signup_bonus',
    'admin_grant',
    'admin_deduct',
    'chat_usage',
    'refund'
);


--
-- Name: entity_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.entity_type AS ENUM (
    'game',
    'publisher',
    'developer'
);


--
-- Name: refresh_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.refresh_tier AS ENUM (
    'active',
    'moderate',
    'dormant',
    'dead'
);


--
-- Name: steam_deck_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.steam_deck_category AS ENUM (
    'unknown',
    'unsupported',
    'playable',
    'verified'
);


--
-- Name: sync_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sync_source AS ENUM (
    'steamspy',
    'storefront',
    'reviews',
    'histogram',
    'scraper',
    'pics',
    'news',
    'hero_asset',
    'change_hints'
);


--
-- Name: trend_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.trend_direction AS ENUM (
    'up',
    'down',
    'stable'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'user',
    'admin'
);


--
-- Name: waitlist_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.waitlist_status AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


--
-- Name: acquire_api_rate_token(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.acquire_api_rate_token(p_source text, p_worker_id text DEFAULT NULL::text) RETURNS TABLE(granted boolean, wait_ms integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_available_tokens NUMERIC;
    v_max_tokens NUMERIC;
    v_refill_rate NUMERIC;
    v_last_refill_at TIMESTAMPTZ;
    v_elapsed_seconds NUMERIC;
    v_refilled_tokens NUMERIC;
    v_wait_ms INTEGER;
BEGIN
    INSERT INTO api_rate_limit_state (
        source,
        available_tokens,
        max_tokens,
        refill_rate_per_second,
        last_refill_at,
        updated_at,
        last_worker_id
    )
    VALUES (
        p_source,
        1,
        1,
        1,
        v_now,
        v_now,
        p_worker_id
    )
    ON CONFLICT (source) DO NOTHING;

    SELECT
        available_tokens,
        max_tokens,
        refill_rate_per_second,
        last_refill_at
    INTO
        v_available_tokens,
        v_max_tokens,
        v_refill_rate,
        v_last_refill_at
    FROM api_rate_limit_state
    WHERE source = p_source
    FOR UPDATE;

    IF v_max_tokens IS NULL OR v_max_tokens < 1 THEN
        v_max_tokens := 1;
    END IF;

    IF v_refill_rate IS NULL OR v_refill_rate <= 0 THEN
        v_refill_rate := 1;
    END IF;

    IF v_available_tokens IS NULL THEN
        v_available_tokens := v_max_tokens;
    END IF;

    IF v_last_refill_at IS NULL THEN
        v_last_refill_at := v_now;
    END IF;

    v_elapsed_seconds := GREATEST(EXTRACT(EPOCH FROM (v_now - v_last_refill_at)), 0);
    v_refilled_tokens := LEAST(v_max_tokens, v_available_tokens + (v_elapsed_seconds * v_refill_rate));

    IF v_refilled_tokens >= 1 THEN
        UPDATE api_rate_limit_state
        SET
            available_tokens = v_refilled_tokens - 1,
            max_tokens = v_max_tokens,
            refill_rate_per_second = v_refill_rate,
            last_refill_at = v_now,
            updated_at = v_now,
            last_worker_id = p_worker_id
        WHERE source = p_source;

        RETURN QUERY SELECT TRUE, 0;
        RETURN;
    END IF;

    v_wait_ms := CEIL(((1 - v_refilled_tokens) / v_refill_rate) * 1000)::INTEGER;

    UPDATE api_rate_limit_state
    SET
        available_tokens = v_refilled_tokens,
        max_tokens = v_max_tokens,
        refill_rate_per_second = v_refill_rate,
        last_refill_at = v_now,
        updated_at = v_now,
        last_worker_id = p_worker_id
    WHERE source = p_source;

    RETURN QUERY SELECT FALSE, GREATEST(v_wait_ms, 1);
END;
$$;


--
-- Name: FUNCTION acquire_api_rate_token(p_source text, p_worker_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.acquire_api_rate_token(p_source text, p_worker_id text) IS 'Attempt to consume one shared API token for a source. Returns granted=false with wait_ms when the caller should retry later.';


--
-- Name: admin_adjust_credits(uuid, uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_adjust_credits(p_admin_id uuid, p_user_id uuid, p_amount integer, p_description text) RETURNS TABLE(success boolean, new_balance integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL OR v_caller_id != p_admin_id THEN
    RETURN QUERY SELECT FALSE, 0::INTEGER;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.admin_adjust_user_credits(p_user_id, p_amount, p_description);
END;
$$;


--
-- Name: admin_adjust_user_credits(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_adjust_user_credits(p_user_id uuid, p_amount integer, p_description text) RETURNS TABLE(success boolean, new_balance integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
  v_admin_role user_role;
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_type credit_transaction_type;
BEGIN
  v_admin_id := auth.uid();

  IF v_admin_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::INTEGER;
    RETURN;
  END IF;

  SELECT role INTO v_admin_role
  FROM public.user_profiles
  WHERE id = v_admin_id;

  IF v_admin_role IS NULL OR v_admin_role != 'admin' THEN
    RETURN QUERY SELECT FALSE, 0::INTEGER;
    RETURN;
  END IF;

  SELECT credit_balance INTO v_current_balance
  FROM public.user_profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::INTEGER;
    RETURN;
  END IF;

  v_new_balance := GREATEST(0, v_current_balance + p_amount);
  v_type := CASE
    WHEN p_amount >= 0 THEN 'admin_grant'::credit_transaction_type
    ELSE 'admin_deduct'::credit_transaction_type
  END;

  UPDATE public.user_profiles
  SET credit_balance = v_new_balance,
      updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.credit_transactions (
    user_id, amount, balance_after, transaction_type, description, admin_user_id
  )
  VALUES (
    p_user_id,
    p_amount,
    v_new_balance,
    v_type,
    p_description,
    v_admin_id
  );

  RETURN QUERY SELECT TRUE, v_new_balance;
END;
$$;


--
-- Name: FUNCTION admin_adjust_user_credits(p_user_id uuid, p_amount integer, p_description text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.admin_adjust_user_credits(p_user_id uuid, p_amount integer, p_description text) IS 'Adjust user credits for the authenticated admin caller only. Uses auth.uid() internally.';


--
-- Name: aggregate_daily_ccu_peaks(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.aggregate_daily_ccu_peaks(target_date date DEFAULT (CURRENT_DATE - '1 day'::interval)) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  aggregated_count INTEGER;
BEGIN
  -- Aggregate max CCU from snapshots for the target date into daily_metrics
  INSERT INTO daily_metrics (appid, metric_date, ccu_peak, ccu_source)
  SELECT
    appid,
    target_date,
    MAX(player_count) as ccu_peak,
    'steam_api' as ccu_source
  FROM ccu_snapshots
  WHERE snapshot_time >= target_date
    AND snapshot_time < target_date + INTERVAL '1 day'
  GROUP BY appid
  ON CONFLICT (appid, metric_date) DO UPDATE SET
    ccu_peak = GREATEST(COALESCE(daily_metrics.ccu_peak, 0), EXCLUDED.ccu_peak),
    ccu_source = CASE
      WHEN EXCLUDED.ccu_peak > COALESCE(daily_metrics.ccu_peak, 0)
      THEN 'steam_api'
      ELSE daily_metrics.ccu_source
    END;

  GET DIAGNOSTICS aggregated_count = ROW_COUNT;
  RETURN aggregated_count;
END;
$$;


--
-- Name: FUNCTION aggregate_daily_ccu_peaks(target_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.aggregate_daily_ccu_peaks(target_date date) IS 'Aggregates hourly CCU snapshots to daily peaks. Run nightly before cleanup.';


--
-- Name: batch_update_prices(integer[], integer[], integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.batch_update_prices(p_appids integer[], p_prices integer[], p_discounts integer[]) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- Validate arrays have same length
  IF array_length(p_appids, 1) IS DISTINCT FROM array_length(p_prices, 1) OR
     array_length(p_appids, 1) IS DISTINCT FROM array_length(p_discounts, 1) THEN
    RAISE EXCEPTION 'All input arrays must have the same length';
  END IF;

  -- Bulk update prices
  WITH price_data AS (
    SELECT
      unnest(p_appids) as appid,
      unnest(p_prices) as price,
      unnest(p_discounts) as discount
  )
  UPDATE apps a SET
    current_price_cents = pd.price,
    current_discount_percent = pd.discount,
    updated_at = NOW()
  FROM price_data pd
  WHERE a.appid = pd.appid;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Update last_price_sync timestamp for these apps
  UPDATE sync_status SET
    last_price_sync = NOW()
  WHERE appid = ANY(p_appids);

  RETURN v_updated;
END;
$$;


--
-- Name: FUNCTION batch_update_prices(p_appids integer[], p_prices integer[], p_discounts integer[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.batch_update_prices(p_appids integer[], p_prices integer[], p_discounts integer[]) IS 'Bulk update prices for multiple apps in a single transaction. Returns number of updated rows.';


--
-- Name: change_burst_id(integer, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_burst_id(p_appid integer, p_burst_started_at timestamp with time zone, p_burst_ended_at timestamp with time zone) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT FORMAT(
    '%s:%s:%s',
    p_appid,
    TO_CHAR(p_burst_started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"'),
    TO_CHAR(p_burst_ended_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"')
  );
$$;


--
-- Name: change_signal_sort_rank(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_signal_sort_rank(p_signal_family text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE COALESCE(p_signal_family, '')
    WHEN 'release' THEN 1
    WHEN 'pricing' THEN 2
    WHEN 'store-page' THEN 3
    WHEN 'media' THEN 4
    WHEN 'taxonomy' THEN 5
    WHEN 'platform' THEN 6
    WHEN 'announcement' THEN 7
    WHEN 'build' THEN 8
    ELSE 99
  END;
$$;


--
-- Name: change_story_kind(text[], boolean, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_story_kind(p_signal_families text[], p_is_released boolean, p_release_date date) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT CASE
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['release']::TEXT[]
      OR p_is_released = FALSE
      OR (
        p_release_date IS NOT NULL
        AND p_release_date >= CURRENT_DATE - 30
      )
      THEN 'release-prep'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['pricing']::TEXT[]
      THEN 'commercial-move'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['store-page', 'media']::TEXT[]
      THEN 'store-refresh'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['taxonomy']::TEXT[]
      THEN 'positioning-shift'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['platform']::TEXT[]
      THEN 'platform-expansion'
    WHEN COALESCE(p_signal_families, ARRAY[]::TEXT[]) && ARRAY['build']::TEXT[]
      THEN 'build-activity'
    ELSE 'general-update'
  END;
$$;


--
-- Name: change_type_label(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_type_label(p_change_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE COALESCE(p_change_type, '')
    WHEN 'description_rewrite' THEN 'Store description'
    WHEN 'short_description_rewrite' THEN 'Short description'
    WHEN 'release_date_text_change' THEN 'Release timing'
    WHEN 'price_change' THEN 'Price'
    WHEN 'discount_start' THEN 'Discount'
    WHEN 'discount_end' THEN 'Discount'
    WHEN 'tags_added' THEN 'Tags'
    WHEN 'tags_removed' THEN 'Tags'
    WHEN 'genres_changed' THEN 'Genres'
    WHEN 'categories_changed' THEN 'Categories'
    WHEN 'languages_changed' THEN 'Languages'
    WHEN 'platforms_changed' THEN 'Platforms'
    WHEN 'controller_support_changed' THEN 'Controller support'
    WHEN 'steam_deck_status_changed' THEN 'Steam Deck'
    WHEN 'publisher_association_changed' THEN 'Publisher'
    WHEN 'developer_association_changed' THEN 'Developer'
    WHEN 'dlc_references_changed' THEN 'DLC'
    WHEN 'package_references_changed' THEN 'Packages'
    WHEN 'build_id_changed' THEN 'Build'
    WHEN 'last_content_update_changed' THEN 'Content update'
    WHEN 'capsule_url_changed' THEN 'Capsule art'
    WHEN 'header_url_changed' THEN 'Header art'
    WHEN 'background_url_changed' THEN 'Background art'
    WHEN 'screenshot_added' THEN 'Screenshots'
    WHEN 'screenshot_removed' THEN 'Screenshots'
    WHEN 'screenshot_reordered' THEN 'Screenshots'
    WHEN 'trailer_added' THEN 'Trailer'
    WHEN 'trailer_removed' THEN 'Trailer'
    WHEN 'trailer_reordered' THEN 'Trailer'
    WHEN 'trailer_thumbnail_changed' THEN 'Trailer art'
    ELSE INITCAP(REPLACE(COALESCE(p_change_type, 'activity'), '_', ' '))
  END;
$$;


--
-- Name: change_type_signal_family(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.change_type_signal_family(p_change_type text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE COALESCE(p_change_type, '')
    WHEN 'release_date_text_change' THEN 'release'
    WHEN 'price_change' THEN 'pricing'
    WHEN 'discount_start' THEN 'pricing'
    WHEN 'discount_end' THEN 'pricing'
    WHEN 'dlc_references_changed' THEN 'pricing'
    WHEN 'package_references_changed' THEN 'pricing'
    WHEN 'description_rewrite' THEN 'store-page'
    WHEN 'short_description_rewrite' THEN 'store-page'
    WHEN 'capsule_url_changed' THEN 'media'
    WHEN 'header_url_changed' THEN 'media'
    WHEN 'background_url_changed' THEN 'media'
    WHEN 'screenshot_added' THEN 'media'
    WHEN 'screenshot_removed' THEN 'media'
    WHEN 'screenshot_reordered' THEN 'media'
    WHEN 'trailer_added' THEN 'media'
    WHEN 'trailer_removed' THEN 'media'
    WHEN 'trailer_reordered' THEN 'media'
    WHEN 'trailer_thumbnail_changed' THEN 'media'
    WHEN 'tags_added' THEN 'taxonomy'
    WHEN 'tags_removed' THEN 'taxonomy'
    WHEN 'genres_changed' THEN 'taxonomy'
    WHEN 'categories_changed' THEN 'taxonomy'
    WHEN 'publisher_association_changed' THEN 'taxonomy'
    WHEN 'developer_association_changed' THEN 'taxonomy'
    WHEN 'languages_changed' THEN 'platform'
    WHEN 'platforms_changed' THEN 'platform'
    WHEN 'controller_support_changed' THEN 'platform'
    WHEN 'steam_deck_status_changed' THEN 'platform'
    WHEN 'news_published' THEN 'announcement'
    WHEN 'news_edited' THEN 'announcement'
    WHEN 'build_id_changed' THEN 'build'
    WHEN 'last_content_update_changed' THEN 'build'
    ELSE 'store-page'
  END;
$$;


--
-- Name: check_and_increment_rate_limit(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_and_increment_rate_limit(p_user_id uuid) RETURNS TABLE(allowed boolean, retry_after_seconds integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_caller_id UUID;
    v_now TIMESTAMPTZ := NOW();
    v_minute_limit INTEGER := 20;   -- 20 requests per minute
    v_hour_limit INTEGER := 200;    -- 200 requests per hour
    v_state rate_limit_state%ROWTYPE;
    v_requests_minute INTEGER;
    v_requests_hour INTEGER;
    v_minute_start TIMESTAMPTZ;
    v_hour_start TIMESTAMPTZ;
BEGIN
    -- SECURITY FIX: Validate the caller is the user they claim to be
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL OR v_caller_id != p_user_id THEN
        RETURN QUERY SELECT FALSE, 0::INTEGER;
        RETURN;
    END IF;

    -- Get current state with lock (or create if missing)
    SELECT * INTO v_state
    FROM rate_limit_state
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Create state if missing
        INSERT INTO rate_limit_state (user_id)
        VALUES (p_user_id)
        RETURNING * INTO v_state;
    END IF;

    -- Calculate window resets
    v_minute_start := v_state.minute_window_start;
    v_hour_start := v_state.hour_window_start;
    v_requests_minute := v_state.requests_this_minute;
    v_requests_hour := v_state.requests_this_hour;

    -- Reset minute window if expired
    IF v_minute_start < v_now - INTERVAL '1 minute' THEN
        v_requests_minute := 0;
        v_minute_start := v_now;
    END IF;

    -- Reset hour window if expired
    IF v_hour_start < v_now - INTERVAL '1 hour' THEN
        v_requests_hour := 0;
        v_hour_start := v_now;
    END IF;

    -- Check minute limit
    IF v_requests_minute >= v_minute_limit THEN
        RETURN QUERY SELECT FALSE,
            EXTRACT(EPOCH FROM (v_minute_start + INTERVAL '1 minute' - v_now))::INTEGER;
        RETURN;
    END IF;

    -- Check hour limit
    IF v_requests_hour >= v_hour_limit THEN
        RETURN QUERY SELECT FALSE,
            EXTRACT(EPOCH FROM (v_hour_start + INTERVAL '1 hour' - v_now))::INTEGER;
        RETURN;
    END IF;

    -- Increment counters atomically
    UPDATE rate_limit_state
    SET requests_this_minute = v_requests_minute + 1,
        requests_this_hour = v_requests_hour + 1,
        minute_window_start = v_minute_start,
        hour_window_start = v_hour_start,
        updated_at = v_now
    WHERE user_id = p_user_id;

    RETURN QUERY SELECT TRUE, 0::INTEGER;
END;
$$;


--
-- Name: claim_app_capture_queue(public.app_capture_source[], text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_app_capture_queue(p_sources public.app_capture_source[], p_worker_id text, p_limit integer DEFAULT 50) RETURNS TABLE(id bigint, appid integer, source public.app_capture_source, priority integer, trigger_reason text, trigger_cursor text, payload jsonb, attempts integer, available_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT q.id
    FROM app_capture_queue q
    WHERE q.status = 'queued'
      AND q.available_at <= NOW()
      AND q.source = ANY (p_sources)
    ORDER BY q.priority DESC, q.available_at ASC, q.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(COALESCE(p_limit, 50), 500)
  )
  UPDATE app_capture_queue q
  SET status = 'claimed',
      worker_id = p_worker_id,
      claimed_at = NOW(),
      attempts = q.attempts + 1
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.id, q.appid, q.source, q.priority, q.trigger_reason, q.trigger_cursor, q.payload, q.attempts, q.available_at;
END;
$$;


--
-- Name: claim_app_capture_work(public.app_capture_source[], text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_app_capture_work(p_sources public.app_capture_source[], p_worker_id text, p_limit integer DEFAULT 50) RETURNS TABLE(id bigint, appid integer, source public.app_capture_source, priority integer, trigger_reason text, trigger_cursor text, payload jsonb, attempts integer, available_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT w.id
    FROM app_capture_work_state w
    WHERE w.source = ANY (p_sources)
      AND w.dirty_since IS NOT NULL
      AND w.claimed_at IS NULL
      AND w.dead_lettered_at IS NULL
      AND w.next_available_at <= NOW()
    ORDER BY w.priority DESC, w.dirty_since ASC, w.last_dirty_at ASC, w.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(COALESCE(p_limit, 50), 500)
  )
  UPDATE app_capture_work_state w
  SET claimed_at = NOW(),
      worker_id = p_worker_id,
      attempts = w.attempts + 1,
      updated_at = NOW()
  FROM candidates c
  WHERE w.id = c.id
  RETURNING
    w.id,
    w.appid,
    w.source,
    w.priority,
    w.latest_trigger_reason,
    w.latest_trigger_cursor,
    w.payload,
    w.attempts,
    w.next_available_at;
END;
$$;


--
-- Name: claim_apps_for_reviews_sync(text, integer, integer, integer, integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_apps_for_reviews_sync(p_worker_id text, p_limit integer DEFAULT 100, p_claim_ttl_minutes integer DEFAULT 15, p_launch_limit integer DEFAULT 25, p_change_limit integer DEFAULT 20, p_active_limit integer DEFAULT 35, p_backfill_limit integer DEFAULT 19, p_unknown_limit integer DEFAULT 1) RETURNS TABLE(appid integer, lane text, priority_score integer, velocity_tier text, hours_overdue numeric, last_known_total_reviews integer, last_reviews_sync timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_requested_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
    v_claim_ttl_minutes INTEGER := GREATEST(1, LEAST(COALESCE(p_claim_ttl_minutes, 15), 240));
    v_total_weight INTEGER := GREATEST(
        COALESCE(p_launch_limit, 0)
        + COALESCE(p_change_limit, 0)
        + COALESCE(p_active_limit, 0)
        + COALESCE(p_backfill_limit, 0)
        + COALESCE(p_unknown_limit, 0),
        1
    );
    v_launch_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_launch_limit, 0) / v_total_weight)::INTEGER;
    v_change_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_change_limit, 0) / v_total_weight)::INTEGER;
    v_active_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_active_limit, 0) / v_total_weight)::INTEGER;
    v_backfill_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_backfill_limit, 0) / v_total_weight)::INTEGER;
    v_unknown_quota INTEGER := FLOOR(v_requested_limit::NUMERIC * COALESCE(p_unknown_limit, 0) / v_total_weight)::INTEGER;
    v_seed_limit INTEGER := LEAST(GREATEST(v_requested_limit * 20, 500), 2000);
    v_override_seed_limit INTEGER := LEAST(GREATEST(v_requested_limit * 4, 100), 400);
    v_expired_seed_limit INTEGER := LEAST(GREATEST((v_seed_limit + 3) / 4, 100), 500);
BEGIN
    RETURN QUERY
    WITH override_seed AS (
        SELECT s.appid
        FROM sync_status s
        WHERE s.is_syncable = TRUE
          AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
          AND (s.reviews_claim_expires_at IS NULL OR s.reviews_claim_expires_at <= v_now)
          AND s.reviews_priority_override_until IS NOT NULL
          AND s.reviews_priority_override_until > v_now
          AND s.reviews_priority_override_bucket IS NOT NULL
        ORDER BY
            COALESCE(s.reviews_priority_override_score, 0) DESC,
            s.next_reviews_sync ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            s.appid ASC
        LIMIT v_override_seed_limit
    ),
    due_seed_unclaimed AS (
        SELECT s.appid
        FROM sync_status s
        LEFT JOIN apps a ON a.appid = s.appid
        LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND s.reviews_claim_expires_at IS NULL
          AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
          AND NOT (
            a.release_date > CURRENT_DATE + INTERVAL '7 days'
            AND COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) = 0
            AND NOT (
                s.reviews_priority_override_until IS NOT NULL
                AND s.reviews_priority_override_until > v_now
                AND s.reviews_priority_override_bucket IS NOT NULL
            )
          )
        ORDER BY
            s.next_reviews_sync ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            s.appid ASC
        LIMIT v_seed_limit
    ),
    due_seed_expired AS (
        SELECT s.appid
        FROM sync_status s
        LEFT JOIN apps a ON a.appid = s.appid
        LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND s.reviews_claim_expires_at <= v_now
          AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
          AND NOT (
            a.release_date > CURRENT_DATE + INTERVAL '7 days'
            AND COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) = 0
            AND NOT (
                s.reviews_priority_override_until IS NOT NULL
                AND s.reviews_priority_override_until > v_now
                AND s.reviews_priority_override_bucket IS NOT NULL
            )
          )
        ORDER BY
            s.reviews_claim_expires_at ASC,
            s.next_reviews_sync ASC NULLS FIRST,
            COALESCE(s.priority_score, 0) DESC,
            s.appid ASC
        LIMIT v_expired_seed_limit
    ),
    seed_appids AS (
        SELECT override_seed.appid
        FROM override_seed
        UNION
        SELECT due_seed_unclaimed.appid
        FROM due_seed_unclaimed
        UNION
        SELECT due_seed_expired.appid
        FROM due_seed_expired
    ),
    candidate_pool AS (
        SELECT
            s.appid,
            CASE
                WHEN s.reviews_priority_override_until IS NOT NULL
                     AND s.reviews_priority_override_until > v_now
                     AND s.reviews_priority_override_bucket IS NOT NULL
                THEN s.reviews_priority_override_bucket
                WHEN COALESCE(a.is_released, FALSE) = TRUE
                     AND (a.release_date IS NULL OR a.release_date >= CURRENT_DATE - INTERVAL '7 days')
                THEN 'launch_critical'
                WHEN COALESCE(s.review_velocity_tier, 'unknown') IN ('high', 'medium')
                     OR COALESCE(s.velocity_7d, 0) >= 1
                THEN 'active_reviews'
                WHEN COALESCE(s.priority_score, 0) >= 50
                     OR COALESCE(s.last_known_total_reviews, 0) >= 1000
                THEN 'important_backfill'
                ELSE 'unknown_sweep'
            END::TEXT AS lane,
            COALESCE(s.priority_score, 0)::INTEGER AS priority_score,
            COALESCE(s.review_velocity_tier, 'unknown')::TEXT AS velocity_tier,
            (EXTRACT(EPOCH FROM (v_now - COALESCE(s.next_reviews_sync, v_now))) / 3600.0)::DECIMAL AS hours_overdue,
            s.last_known_total_reviews,
            s.last_reviews_sync,
            COALESCE(s.reviews_priority_override_score, 0)::INTEGER AS sort_override_score,
            CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END AS sort_never_synced,
            COALESCE(s.next_reviews_sync, s.last_reviews_sync, v_now) AS sort_due_at,
            COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0)::INTEGER AS sort_total_reviews
        FROM sync_status s
        JOIN seed_appids seed ON seed.appid = s.appid
        LEFT JOIN apps a ON a.appid = s.appid
        LEFT JOIN latest_daily_metrics ldm ON ldm.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= v_now)
          AND (s.reviews_claim_expires_at IS NULL OR s.reviews_claim_expires_at <= v_now)
          AND NOT (
            a.release_date > CURRENT_DATE + INTERVAL '7 days'
            AND COALESCE(ldm.total_reviews, s.last_known_total_reviews, 0) = 0
            AND NOT (
                s.reviews_priority_override_until IS NOT NULL
                AND s.reviews_priority_override_until > v_now
                AND s.reviews_priority_override_bucket IS NOT NULL
            )
          )
        FOR UPDATE OF s SKIP LOCKED
    ),
    ranked AS (
        SELECT
            cp.*,
            ROW_NUMBER() OVER (
                PARTITION BY cp.lane
                ORDER BY
                    cp.sort_override_score DESC,
                    cp.sort_never_synced ASC,
                    cp.sort_due_at ASC NULLS FIRST,
                    cp.priority_score DESC,
                    cp.sort_total_reviews DESC,
                    cp.appid ASC
            ) AS lane_rank
        FROM candidate_pool cp
    ),
    primary_claims AS (
        SELECT r.*
        FROM ranked r
        WHERE (r.lane = 'launch_critical' AND r.lane_rank <= v_launch_quota)
           OR (r.lane = 'change_critical' AND r.lane_rank <= v_change_quota)
           OR (r.lane = 'active_reviews' AND r.lane_rank <= v_active_quota)
           OR (r.lane = 'important_backfill' AND r.lane_rank <= v_backfill_quota)
           OR (r.lane = 'unknown_sweep' AND r.lane_rank <= v_unknown_quota)
    ),
    primary_count AS (
        SELECT COUNT(*) AS count
        FROM primary_claims
    ),
    reallocated_claims AS (
        SELECT r.*
        FROM ranked r
        WHERE NOT EXISTS (
            SELECT 1
            FROM primary_claims pc
            WHERE pc.appid = r.appid
        )
        ORDER BY
            CASE r.lane
                WHEN 'launch_critical' THEN 0
                WHEN 'change_critical' THEN 1
                WHEN 'active_reviews' THEN 2
                WHEN 'important_backfill' THEN 3
                ELSE 4
            END,
            r.sort_override_score DESC,
            r.sort_never_synced ASC,
            r.sort_due_at ASC NULLS FIRST,
            r.priority_score DESC,
            r.sort_total_reviews DESC,
            r.appid ASC
        LIMIT GREATEST(v_requested_limit - (SELECT count FROM primary_count), 0)
    ),
    selected AS (
        SELECT * FROM primary_claims
        UNION ALL
        SELECT * FROM reallocated_claims
    )
    UPDATE sync_status s
    SET
        reviews_claimed_by = p_worker_id,
        reviews_claimed_at = v_now,
        reviews_claim_expires_at = v_now + make_interval(mins => v_claim_ttl_minutes)
    FROM selected sel
    WHERE s.appid = sel.appid
    RETURNING
        s.appid,
        sel.lane,
        sel.priority_score,
        sel.velocity_tier,
        sel.hours_overdue,
        sel.last_known_total_reviews,
        sel.last_reviews_sync;
END;
$$;


--
-- Name: FUNCTION claim_apps_for_reviews_sync(p_worker_id text, p_limit integer, p_claim_ttl_minutes integer, p_launch_limit integer, p_change_limit integer, p_active_limit integer, p_backfill_limit integer, p_unknown_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.claim_apps_for_reviews_sync(p_worker_id text, p_limit integer, p_claim_ttl_minutes integer, p_launch_limit integer, p_change_limit integer, p_active_limit integer, p_backfill_limit integer, p_unknown_limit integer) IS 'Claim due apps for reviews sync from a bounded sync_status seed with future-dated zero-review titles suppressed outside override paths.';


--
-- Name: cleanup_old_ccu_snapshots(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_ccu_snapshots() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete snapshots older than 30 days
  -- Daily aggregates should already exist in daily_metrics from nightly aggregation
  DELETE FROM ccu_snapshots
  WHERE snapshot_time < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


--
-- Name: FUNCTION cleanup_old_ccu_snapshots(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cleanup_old_ccu_snapshots() IS 'Removes CCU snapshots older than 30 days. Run after ensuring daily_metrics has aggregated peaks.';


--
-- Name: cleanup_old_chat_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_chat_logs() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM chat_query_logs
    WHERE created_at < NOW() - INTERVAL '7 days';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;


--
-- Name: cleanup_stale_reservations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_stale_reservations() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_count INTEGER := 0;
    v_reservation RECORD;
BEGIN
    -- Find and refund stale reservations
    FOR v_reservation IN
        SELECT id FROM credit_reservations
        WHERE status = 'pending'
        AND created_at < NOW() - INTERVAL '1 hour'
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM refund_reservation(v_reservation.id);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;


--
-- Name: complete_app_capture_queue(bigint[], public.app_capture_status, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_app_capture_queue(p_ids bigint[], p_status public.app_capture_status DEFAULT 'completed'::public.app_capture_status, p_error text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'queued', 'dead_letter') THEN
    RAISE EXCEPTION 'Unsupported queue completion status: %', p_status;
  END IF;

  UPDATE app_capture_queue
  SET status = p_status,
      last_error = CASE WHEN p_status = 'completed' THEN NULL ELSE p_error END,
      worker_id = CASE WHEN p_status = 'queued' THEN NULL ELSE worker_id END,
      claimed_at = CASE WHEN p_status = 'queued' THEN NULL ELSE claimed_at END,
      completed_at = CASE WHEN p_status IN ('completed', 'failed', 'dead_letter') THEN NOW() ELSE NULL END,
      available_at = CASE WHEN p_status = 'queued' THEN NOW() ELSE available_at END
  WHERE id = ANY (p_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


--
-- Name: complete_app_capture_work(bigint[], public.app_capture_status, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_app_capture_work(p_ids bigint[], p_status public.app_capture_status DEFAULT 'completed'::public.app_capture_status, p_error text DEFAULT NULL::text, p_cooldown_hours integer DEFAULT 6) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_cooldown INTERVAL := make_interval(hours => GREATEST(COALESCE(p_cooldown_hours, 6), 1));
  v_updated INTEGER;
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'queued', 'dead_letter') THEN
    RAISE EXCEPTION 'Unsupported work completion status: %', p_status;
  END IF;

  UPDATE app_capture_work_state
  SET last_error = CASE WHEN p_status = 'completed' THEN NULL ELSE p_error END,
      worker_id = NULL,
      claimed_at = NULL,
      dead_lettered_at = CASE
        WHEN p_status = 'dead_letter' THEN v_now
        WHEN p_status IN ('completed', 'queued') THEN NULL
        ELSE dead_lettered_at
      END,
      last_completed_at = CASE
        WHEN p_status = 'completed' THEN v_now
        ELSE last_completed_at
      END,
      next_available_at = CASE
        WHEN p_status = 'completed' THEN v_now + v_cooldown
        WHEN p_status = 'queued' THEN v_now
        ELSE next_available_at
      END,
      dirty_since = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at
          THEN last_dirty_at
        WHEN p_status IN ('completed', 'dead_letter', 'failed')
          THEN NULL
        ELSE dirty_since
      END,
      last_dirty_at = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at
          THEN last_dirty_at
        WHEN p_status IN ('completed', 'dead_letter', 'failed')
          THEN NULL
        ELSE last_dirty_at
      END,
      payload = CASE
        WHEN p_status = 'completed'
          AND last_dirty_at IS NOT NULL
          AND claimed_at IS NOT NULL
          AND last_dirty_at > claimed_at
          THEN payload
        WHEN p_status IN ('completed', 'dead_letter', 'failed')
          THEN '{}'::JSONB
        ELSE payload
      END,
      attempts = CASE
        WHEN p_status = 'completed' THEN 0
        ELSE attempts
      END,
      updated_at = v_now
  WHERE id = ANY (p_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


--
-- Name: delete_steam_news_search_projection_for_gids(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_steam_news_search_projection_for_gids(p_gids text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  normalized_gids TEXT[];
  deleted_count INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO normalized_gids
  FROM (
    SELECT DISTINCT NULLIF(BTRIM(gid), '') AS gid
    FROM unnest(COALESCE(p_gids, ARRAY[]::TEXT[])) AS gid
    WHERE NULLIF(BTRIM(gid), '') IS NOT NULL
  ) deduped;

  IF CARDINALITY(normalized_gids) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.steam_news_search_projection
  WHERE gid = ANY (normalized_gids);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


--
-- Name: FUNCTION delete_steam_news_search_projection_for_gids(p_gids text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_steam_news_search_projection_for_gids(p_gids text[]) IS 'Deletes lean news topic-search projection rows for the provided gids.';


--
-- Name: detect_developer_new_release_alert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_developer_new_release_alert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_pin RECORD;
    v_app_name TEXT;
    v_dedup_key TEXT;
BEGIN
    -- Get the app name
    SELECT name INTO v_app_name FROM apps WHERE appid = NEW.appid;

    -- Find users who pinned this developer and have new_release alerts enabled
    FOR v_pin IN
        SELECT p.id as pin_id, p.user_id, p.display_name
        FROM user_pins p
        LEFT JOIN user_alert_preferences pref ON p.user_id = pref.user_id
        WHERE p.entity_type = 'developer'
          AND p.entity_id = NEW.developer_id
          AND COALESCE(pref.alerts_enabled, TRUE) = TRUE
          AND COALESCE(pref.alert_new_release, TRUE) = TRUE
    LOOP
        v_dedup_key := v_pin.user_id || ':developer:' || NEW.developer_id || ':new_release:' || CURRENT_DATE;

        INSERT INTO user_alerts (
            user_id,
            pin_id,
            alert_type,
            severity,
            title,
            description,
            metric_name,
            dedup_key,
            source_data
        ) VALUES (
            v_pin.user_id,
            v_pin.pin_id,
            'new_release',
            'high',
            'New Release: ' || COALESCE(v_app_name, 'Unknown Game'),
            v_pin.display_name || ' released: ' || COALESCE(v_app_name, 'Unknown Game'),
            'appid',
            v_dedup_key,
            jsonb_build_object('appid', NEW.appid, 'app_name', v_app_name, 'developer_id', NEW.developer_id)
        )
        ON CONFLICT (dedup_key) DO NOTHING;
    END LOOP;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION detect_developer_new_release_alert(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.detect_developer_new_release_alert() IS 'Creates new_release alerts when a game is linked to a pinned developer';


--
-- Name: detect_price_change_alert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_price_change_alert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_pin RECORD;
    v_dedup_key TEXT;
    v_title TEXT;
    v_effective_price_change BOOLEAN;
BEGIN
    -- Skip if price and discount are unchanged
    IF OLD.current_price_cents = NEW.current_price_cents
       AND COALESCE(OLD.current_discount_percent, 0) = COALESCE(NEW.current_discount_percent, 0) THEN
        RETURN NEW;
    END IF;

    -- Find all users who pinned this game with merged price alert settings
    FOR v_pin IN
        SELECT
            p.id as pin_id,
            p.user_id,
            p.display_name,
            -- Compute effective alert_price_change
            CASE
                WHEN ps.use_custom_settings = TRUE AND ps.alert_price_change IS NOT NULL
                THEN ps.alert_price_change
                ELSE COALESCE(pref.alert_price_change, TRUE)
            END as effective_alert_price_change,
            -- Check if pin-level alerts are enabled
            CASE
                WHEN ps.use_custom_settings = TRUE
                THEN COALESCE(ps.alerts_enabled, TRUE)
                ELSE TRUE
            END as pin_alerts_enabled
        FROM user_pins p
        LEFT JOIN user_alert_preferences pref ON p.user_id = pref.user_id
        LEFT JOIN user_pin_alert_settings ps ON p.id = ps.pin_id
        WHERE p.entity_type = 'game'
          AND p.entity_id = NEW.appid
          AND COALESCE(pref.alerts_enabled, TRUE) = TRUE
    LOOP
        -- Skip if pin-level alerts disabled or price_change alert type disabled
        IF NOT v_pin.pin_alerts_enabled OR NOT v_pin.effective_alert_price_change THEN
            CONTINUE;
        END IF;

        v_dedup_key := v_pin.user_id || ':game:' || NEW.appid || ':price_change:' || CURRENT_DATE;

        -- Determine alert title based on change type
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

        -- Insert alert (ignore if duplicate key)
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
$$;


--
-- Name: FUNCTION detect_price_change_alert(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.detect_price_change_alert() IS 'Real-time trigger: creates price_change alerts respecting per-pin settings';


--
-- Name: detect_publisher_new_release_alert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_publisher_new_release_alert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_pin RECORD;
    v_app_name TEXT;
    v_dedup_key TEXT;
BEGIN
    -- Get the app name
    SELECT name INTO v_app_name FROM apps WHERE appid = NEW.appid;

    -- Find users who pinned this publisher and have new_release alerts enabled
    FOR v_pin IN
        SELECT p.id as pin_id, p.user_id, p.display_name
        FROM user_pins p
        LEFT JOIN user_alert_preferences pref ON p.user_id = pref.user_id
        WHERE p.entity_type = 'publisher'
          AND p.entity_id = NEW.publisher_id
          AND COALESCE(pref.alerts_enabled, TRUE) = TRUE
          AND COALESCE(pref.alert_new_release, TRUE) = TRUE
    LOOP
        v_dedup_key := v_pin.user_id || ':publisher:' || NEW.publisher_id || ':new_release:' || CURRENT_DATE;

        INSERT INTO user_alerts (
            user_id,
            pin_id,
            alert_type,
            severity,
            title,
            description,
            metric_name,
            dedup_key,
            source_data
        ) VALUES (
            v_pin.user_id,
            v_pin.pin_id,
            'new_release',
            'high',
            'New Release: ' || COALESCE(v_app_name, 'Unknown Game'),
            v_pin.display_name || ' released: ' || COALESCE(v_app_name, 'Unknown Game'),
            'appid',
            v_dedup_key,
            jsonb_build_object('appid', NEW.appid, 'app_name', v_app_name, 'publisher_id', NEW.publisher_id)
        )
        ON CONFLICT (dedup_key) DO NOTHING;
    END LOOP;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION detect_publisher_new_release_alert(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.detect_publisher_new_release_alert() IS 'Creates new_release alerts when a game is linked to a pinned publisher';


--
-- Name: enqueue_app_capture_queue(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_app_capture_queue(p_jobs jsonb DEFAULT '[]'::jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  WITH normalized_jobs AS (
    SELECT
      (job->>'appid')::INTEGER AS appid,
      (job->>'source')::app_capture_source AS source,
      job->>'trigger_reason' AS trigger_reason,
      COALESCE(job->>'trigger_cursor', '') AS trigger_cursor,
      COALESCE((job->>'priority')::INTEGER, 100) AS priority,
      COALESCE(job->'payload', '{}'::jsonb) AS payload,
      COALESCE((job->>'available_at')::TIMESTAMPTZ, NOW()) AS available_at
    FROM jsonb_array_elements(COALESCE(p_jobs, '[]'::jsonb)) AS job
  ),
  inserted AS (
    INSERT INTO app_capture_queue (
      appid,
      source,
      status,
      priority,
      trigger_reason,
      trigger_cursor,
      payload,
      available_at
    )
    SELECT
      appid,
      source,
      'queued',
      priority,
      trigger_reason,
      trigger_cursor,
      payload,
      available_at
    FROM normalized_jobs
    WHERE appid IS NOT NULL
      AND source IS NOT NULL
      AND trigger_reason IS NOT NULL
    ON CONFLICT (appid, source, trigger_cursor)
      WHERE status IN ('queued', 'claimed')
      DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted
  FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;


--
-- Name: execute_readonly_query(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execute_readonly_query(query_text text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  result JSONB;
  normalized_query TEXT;
BEGIN
  normalized_query := UPPER(TRIM(query_text));

  IF NOT (normalized_query LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  IF normalized_query ~ '\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|EXECUTE|CALL|COPY|VACUUM|ANALYZE|LOCK)\b' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  IF normalized_query ~ '\b(INFORMATION_SCHEMA|PG_CATALOG)\b'
     OR normalized_query ~ '\bAUTH\.'
     OR normalized_query ~ '\bSTORAGE\.'
     OR normalized_query ~ '\b(USER_PROFILES|WAITLIST|CREDIT_TRANSACTIONS|CREDIT_RESERVATIONS|RATE_LIMIT_STATE|CHAT_QUERY_LOGS|USER_PINS|USER_ALERTS|USER_ALERT_PREFERENCES|USER_PIN_ALERT_SETTINGS|ALERT_DETECTION_STATE)\b' THEN
    RAISE EXCEPTION 'Query references restricted relations';
  END IF;

  EXECUTE
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) ' ||
    'FROM (SELECT * FROM (' || query_text || ') AS q LIMIT 50) AS t'
    INTO result;

  RETURN result;
END;
$$;


--
-- Name: FUNCTION execute_readonly_query(query_text text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.execute_readonly_query(query_text text) IS 'Safely execute read-only SQL queries for the chat feature behind a server-only service-role boundary.';


--
-- Name: finalize_credits(uuid, integer, text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_credits(p_reservation_id uuid, p_actual_amount integer, p_description text DEFAULT NULL::text, p_input_tokens integer DEFAULT NULL::integer, p_output_tokens integer DEFAULT NULL::integer, p_tool_credits integer DEFAULT NULL::integer) RETURNS TABLE(success boolean, refunded integer, new_balance integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_caller_id UUID;
    v_reservation RECORD;
    v_refund_amount INTEGER;
    v_new_balance INTEGER;
BEGIN
    v_caller_id := auth.uid();

    -- Get and lock the reservation
    SELECT r.*, u.credit_balance
    INTO v_reservation
    FROM credit_reservations r
    JOIN user_profiles u ON u.id = r.user_id
    WHERE r.id = p_reservation_id AND r.status = 'pending'
    FOR UPDATE OF r, u;

    IF v_reservation IS NULL THEN
        RETURN QUERY SELECT FALSE, 0::INTEGER, 0::INTEGER;
        RETURN;
    END IF;

    -- SECURITY FIX: Verify the reservation belongs to the caller
    IF v_caller_id IS NULL OR v_caller_id != v_reservation.user_id THEN
        RETURN QUERY SELECT FALSE, 0::INTEGER, 0::INTEGER;
        RETURN;
    END IF;

    -- Calculate refund (if actual < reserved)
    v_refund_amount := GREATEST(0, v_reservation.reserved_amount - p_actual_amount);

    -- Refund excess to balance
    UPDATE user_profiles
    SET credit_balance = credit_balance + v_refund_amount,
        total_credits_used = total_credits_used + p_actual_amount,
        total_messages_sent = total_messages_sent + 1,
        updated_at = NOW()
    WHERE id = v_reservation.user_id
    RETURNING credit_balance INTO v_new_balance;

    -- Mark reservation as finalized
    UPDATE credit_reservations
    SET status = 'finalized',
        actual_amount = p_actual_amount,
        finalized_at = NOW()
    WHERE id = p_reservation_id;

    -- Create transaction record
    INSERT INTO credit_transactions (
        user_id, amount, balance_after, transaction_type, description,
        input_tokens, output_tokens, tool_credits, reservation_id
    )
    VALUES (
        v_reservation.user_id,
        -p_actual_amount,
        v_new_balance,
        'chat_usage',
        COALESCE(p_description, 'Chat usage'),
        p_input_tokens,
        p_output_tokens,
        p_tool_credits,
        p_reservation_id
    );

    RETURN QUERY SELECT TRUE, v_refund_amount, v_new_balance;
END;
$$;


--
-- Name: get_app_change_feed(integer, timestamp with time zone, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_app_change_feed(p_appid integer, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 100) RETURNS TABLE(appid integer, app_name text, event_id bigint, source text, change_type public.app_change_type, occurred_at timestamp with time zone, before_value jsonb, after_value jsonb, context jsonb, source_snapshot_id bigint, related_snapshot_id bigint, media_version_id bigint, news_item_gid text, baseline_7d jsonb, baseline_30d jsonb, response_1d jsonb, response_7d jsonb, response_30d jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH request_window AS (
    SELECT
      COALESCE(p_to, NOW()) AS effective_to,
      GREATEST(COALESCE(p_limit, 100), 1) AS requested_limit
  ),
  bounded_window AS (
    SELECT
      GREATEST(
        COALESCE(p_from, rw.effective_to - INTERVAL '30 days'),
        rw.effective_to - INTERVAL '365 days'
      ) AS effective_from,
      rw.effective_to,
      LEAST(rw.requested_limit, 100) AS effective_limit
    FROM request_window rw
  ),
  base AS (
    SELECT
      e.appid,
      a.name AS app_name,
      e.id AS event_id,
      e.source,
      e.change_type,
      e.occurred_at,
      e.before_value,
      e.after_value,
      e.context,
      e.source_snapshot_id,
      e.related_snapshot_id,
      e.media_version_id,
      e.news_item_gid
    FROM bounded_window bw
    JOIN app_change_events e
      ON e.appid = p_appid
     AND e.occurred_at >= bw.effective_from
     AND e.occurred_at <= bw.effective_to
    JOIN apps a ON a.appid = e.appid
    ORDER BY e.occurred_at DESC
    LIMIT (SELECT effective_limit FROM bounded_window)
  )
  SELECT
    b.appid,
    b.app_name,
    b.event_id,
    b.source,
    b.change_type,
    b.occurred_at,
    b.before_value,
    b.after_value,
    b.context,
    b.source_snapshot_id,
    b.related_snapshot_id,
    b.media_version_id,
    b.news_item_gid,
    get_change_window_metrics(b.appid, b.occurred_at - INTERVAL '7 days', b.occurred_at),
    get_change_window_metrics(b.appid, b.occurred_at - INTERVAL '30 days', b.occurred_at),
    get_change_window_metrics(b.appid, b.occurred_at, b.occurred_at + INTERVAL '1 day'),
    get_change_window_metrics(b.appid, b.occurred_at, b.occurred_at + INTERVAL '7 days'),
    get_change_window_metrics(b.appid, b.occurred_at, b.occurred_at + INTERVAL '30 days')
  FROM base b
  ORDER BY b.occurred_at DESC;
$$;


--
-- Name: FUNCTION get_app_change_feed(p_appid integer, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_app_change_feed(p_appid integer, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer) IS 'Returns a bounded per-app change timeline. The effective lookback window is capped at 365 days and the result limit is capped at 100.';


--
-- Name: get_app_sparkline_data(integer[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_app_sparkline_data(p_appids integer[], p_days integer DEFAULT 7) RETURNS TABLE(appid integer, sparkline_data jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH daily_peaks AS (
    SELECT
      cs.appid,
      DATE(cs.snapshot_time) AS snapshot_date,
      MAX(cs.player_count) AS peak_ccu
    FROM ccu_snapshots cs
    WHERE cs.appid = ANY(p_appids)
      AND cs.snapshot_time > NOW() - (p_days || ' days')::INTERVAL
    GROUP BY cs.appid, DATE(cs.snapshot_time)
  )
  SELECT
    dp.appid,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'date', dp.snapshot_date,
        'ccu', dp.peak_ccu
      ) ORDER BY dp.snapshot_date
    ) AS sparkline_data
  FROM daily_peaks dp
  GROUP BY dp.appid;
END;
$$;


--
-- Name: FUNCTION get_app_sparkline_data(p_appids integer[], p_days integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_app_sparkline_data(p_appids integer[], p_days integer) IS 'Returns daily CCU peak data for sparkline visualization';


--
-- Name: get_apps_aggregate_stats(text, text, integer, integer, bigint, bigint, integer, integer, integer, integer, integer, integer, integer, integer, boolean, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, integer[], text, integer[], text, integer[], boolean, text[], text, text, text, integer, integer, integer, boolean, integer, integer, text, text, boolean, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_aggregate_stats(p_type text DEFAULT 'game'::text, p_search text DEFAULT NULL::text, p_min_ccu integer DEFAULT NULL::integer, p_max_ccu integer DEFAULT NULL::integer, p_min_owners bigint DEFAULT NULL::bigint, p_max_owners bigint DEFAULT NULL::bigint, p_min_reviews integer DEFAULT NULL::integer, p_max_reviews integer DEFAULT NULL::integer, p_min_score integer DEFAULT NULL::integer, p_max_score integer DEFAULT NULL::integer, p_min_price integer DEFAULT NULL::integer, p_max_price integer DEFAULT NULL::integer, p_min_playtime integer DEFAULT NULL::integer, p_max_playtime integer DEFAULT NULL::integer, p_is_free boolean DEFAULT NULL::boolean, p_min_discount integer DEFAULT NULL::integer, p_min_growth_7d numeric DEFAULT NULL::numeric, p_max_growth_7d numeric DEFAULT NULL::numeric, p_min_growth_30d numeric DEFAULT NULL::numeric, p_max_growth_30d numeric DEFAULT NULL::numeric, p_min_momentum numeric DEFAULT NULL::numeric, p_max_momentum numeric DEFAULT NULL::numeric, p_min_sentiment_delta numeric DEFAULT NULL::numeric, p_max_sentiment_delta numeric DEFAULT NULL::numeric, p_velocity_tier text DEFAULT NULL::text, p_min_active_pct numeric DEFAULT NULL::numeric, p_min_review_rate numeric DEFAULT NULL::numeric, p_min_value_score numeric DEFAULT NULL::numeric, p_min_vs_publisher numeric DEFAULT NULL::numeric, p_genres integer[] DEFAULT NULL::integer[], p_genre_mode text DEFAULT 'any'::text, p_tags integer[] DEFAULT NULL::integer[], p_tag_mode text DEFAULT 'any'::text, p_categories integer[] DEFAULT NULL::integer[], p_has_workshop boolean DEFAULT NULL::boolean, p_platforms text[] DEFAULT NULL::text[], p_platform_mode text DEFAULT 'any'::text, p_steam_deck text DEFAULT NULL::text, p_controller text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_release_year integer DEFAULT NULL::integer, p_early_access boolean DEFAULT NULL::boolean, p_min_hype integer DEFAULT NULL::integer, p_max_hype integer DEFAULT NULL::integer, p_publisher_search text DEFAULT NULL::text, p_developer_search text DEFAULT NULL::text, p_self_published boolean DEFAULT NULL::boolean, p_publisher_size text DEFAULT NULL::text, p_ccu_tier integer DEFAULT NULL::integer) RETURNS TABLE(total_games bigint, avg_ccu numeric, avg_score numeric, avg_momentum numeric, trending_up_count integer, trending_down_count integer, sentiment_improving_count integer, sentiment_declining_count integer, avg_value_score numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH base_apps AS (
    SELECT
      a.appid,
      COALESCE(ldm.ccu_peak, 0)::INT AS ccu_peak,
      ldm.review_score::INT,
      ldm.price_cents::INT,
      ldm.average_playtime_forever::INT,
      COALESCE(a.current_discount_percent, 0)::INT AS current_discount_percent,
      ct.ccu_growth_7d_percent,
      ct.ccu_growth_30d_percent,
      ct.ccu_tier,
      afd.momentum_score,
      afd.sentiment_delta,
      afd.value_score,
      afd.active_player_pct,
      afd.review_rate,
      afd.vs_publisher_avg,
      afd.days_live,
      afd.hype_duration,
      afd.genre_ids,
      afd.tag_ids,
      afd.category_ids,
      afd.has_workshop AS afd_has_workshop,
      afd.platform_array,
      afd.steam_deck_category,
      afd.publisher_name,
      afd.developer_name,
      afd.publisher_game_count,
      rvs.velocity_tier
    FROM apps a
    INNER JOIN app_filter_data afd ON afd.appid = a.appid
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
    LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
    WHERE a.is_released = TRUE AND a.is_delisted = FALSE
      AND (p_type = 'all' OR a.type::TEXT = p_type)
      AND (p_search IS NULL OR a.name ILIKE '%' || p_search || '%')
      AND (p_is_free IS NULL OR a.is_free = p_is_free)
  ),
  filtered AS (
    SELECT ba.*
    FROM base_apps ba
    WHERE
      (p_min_ccu IS NULL OR ba.ccu_peak >= p_min_ccu)
      AND (p_max_ccu IS NULL OR ba.ccu_peak <= p_max_ccu)
      AND (p_min_owners IS NULL OR ba.ccu_peak >= p_min_owners)
      AND (p_max_owners IS NULL OR ba.ccu_peak <= p_max_owners)
      AND (p_min_reviews IS NULL OR ba.review_score >= p_min_reviews)
      AND (p_max_reviews IS NULL OR ba.review_score <= p_max_reviews)
      AND (p_min_score IS NULL OR ba.review_score >= p_min_score)
      AND (p_max_score IS NULL OR ba.review_score <= p_max_score)
      AND (p_min_price IS NULL OR ba.price_cents >= p_min_price)
      AND (p_max_price IS NULL OR ba.price_cents <= p_max_price)
      AND (p_min_playtime IS NULL OR ba.average_playtime_forever >= p_min_playtime)
      AND (p_max_playtime IS NULL OR ba.average_playtime_forever <= p_max_playtime)
      AND (p_min_discount IS NULL OR ba.current_discount_percent >= p_min_discount)
      AND (p_min_growth_7d IS NULL OR ba.ccu_growth_7d_percent >= p_min_growth_7d)
      AND (p_max_growth_7d IS NULL OR ba.ccu_growth_7d_percent <= p_max_growth_7d)
      AND (p_min_growth_30d IS NULL OR ba.ccu_growth_30d_percent >= p_min_growth_30d)
      AND (p_max_growth_30d IS NULL OR ba.ccu_growth_30d_percent <= p_max_growth_30d)
      AND (p_min_momentum IS NULL OR ba.momentum_score >= p_min_momentum)
      AND (p_max_momentum IS NULL OR ba.momentum_score <= p_max_momentum)
      AND (p_min_sentiment_delta IS NULL OR ba.sentiment_delta >= p_min_sentiment_delta)
      AND (p_max_sentiment_delta IS NULL OR ba.sentiment_delta <= p_max_sentiment_delta)
      AND (p_velocity_tier IS NULL OR ba.velocity_tier = p_velocity_tier)
      AND (p_min_active_pct IS NULL OR ba.active_player_pct >= p_min_active_pct)
      AND (p_min_review_rate IS NULL OR ba.review_rate >= p_min_review_rate)
      AND (p_min_value_score IS NULL OR ba.value_score >= p_min_value_score)
      AND (p_min_vs_publisher IS NULL OR ba.vs_publisher_avg >= p_min_vs_publisher)
      AND (p_genres IS NULL
        OR (p_genre_mode = 'any' AND ba.genre_ids && p_genres)
        OR (p_genre_mode = 'all' AND ba.genre_ids @> p_genres)
      )
      AND (p_tags IS NULL
        OR (p_tag_mode = 'any' AND ba.tag_ids && p_tags)
        OR (p_tag_mode = 'all' AND ba.tag_ids @> p_tags)
      )
      AND (p_categories IS NULL OR ba.category_ids && p_categories)
      AND (p_has_workshop IS NULL
        OR (p_has_workshop = TRUE AND ba.afd_has_workshop = TRUE)
        OR (p_has_workshop = FALSE AND (ba.afd_has_workshop = FALSE OR ba.afd_has_workshop IS NULL))
      )
      AND (p_platforms IS NULL
        OR (p_platform_mode = 'any' AND ba.platform_array && p_platforms)
        OR (p_platform_mode = 'all' AND ba.platform_array @> p_platforms)
      )
      AND (p_steam_deck IS NULL
        OR (p_steam_deck = 'verified' AND ba.steam_deck_category = 'verified')
        OR (p_steam_deck = 'playable' AND ba.steam_deck_category IN ('verified', 'playable'))
        OR (p_steam_deck = 'any' AND ba.steam_deck_category IS NOT NULL)
      )
      -- Controller filter skipped in stats (not in app_filter_data)
      AND (p_min_age IS NULL OR ba.days_live >= p_min_age)
      AND (p_max_age IS NULL OR ba.days_live <= p_max_age)
      AND (p_min_hype IS NULL OR ba.hype_duration >= p_min_hype)
      AND (p_max_hype IS NULL OR ba.hype_duration <= p_max_hype)
      AND (p_publisher_search IS NULL OR ba.publisher_name ILIKE '%' || p_publisher_search || '%')
      AND (p_developer_search IS NULL OR ba.developer_name ILIKE '%' || p_developer_search || '%')
      AND (p_self_published IS NULL
        OR (p_self_published = TRUE AND LOWER(TRIM(ba.publisher_name)) = LOWER(TRIM(ba.developer_name)))
        OR (p_self_published = FALSE AND (
            ba.publisher_name IS NULL
            OR ba.developer_name IS NULL
            OR LOWER(TRIM(ba.publisher_name)) <> LOWER(TRIM(ba.developer_name))
        ))
      )
      AND (p_publisher_size IS NULL
        OR (p_publisher_size = 'indie' AND ba.publisher_game_count < 5)
        OR (p_publisher_size = 'mid' AND ba.publisher_game_count >= 5 AND ba.publisher_game_count < 20)
        OR (p_publisher_size = 'major' AND ba.publisher_game_count >= 20)
      )
      AND (p_ccu_tier IS NULL OR ba.ccu_tier = p_ccu_tier)
  )
  SELECT
    COUNT(*)::BIGINT AS total_games,
    ROUND(AVG(f.ccu_peak), 0)::DECIMAL AS avg_ccu,
    ROUND(AVG(f.review_score), 1)::DECIMAL AS avg_score,
    ROUND(AVG(f.momentum_score), 2)::DECIMAL AS avg_momentum,
    COUNT(*) FILTER (WHERE f.ccu_growth_7d_percent >= 10)::INT AS trending_up_count,
    COUNT(*) FILTER (WHERE f.ccu_growth_7d_percent <= -10)::INT AS trending_down_count,
    COUNT(*) FILTER (WHERE f.sentiment_delta >= 3)::INT AS sentiment_improving_count,
    COUNT(*) FILTER (WHERE f.sentiment_delta <= -3)::INT AS sentiment_declining_count,
    ROUND(AVG(f.value_score), 2)::DECIMAL AS avg_value_score
  FROM filtered f;
END;
$$;


--
-- Name: get_apps_by_ids(integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_by_ids(p_appids integer[]) RETURNS TABLE(appid integer, name text, type text, is_free boolean, is_delisted boolean, ccu_peak integer, owners_min bigint, owners_max bigint, owners_midpoint bigint, total_reviews integer, positive_reviews integer, review_score integer, positive_percentage numeric, price_cents integer, current_discount_percent integer, average_playtime_forever integer, average_playtime_2weeks integer, ccu_growth_7d_percent numeric, ccu_growth_30d_percent numeric, ccu_tier integer, velocity_7d numeric, velocity_30d numeric, velocity_tier text, sentiment_delta numeric, momentum_score numeric, velocity_acceleration numeric, active_player_pct numeric, review_rate numeric, value_score numeric, vs_publisher_avg numeric, release_date date, days_live integer, hype_duration integer, release_state text, platforms text, steam_deck_category text, controller_support text, publisher_id integer, publisher_name text, publisher_game_count integer, developer_id integer, developer_name text, metric_date date, data_updated_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.appid,
    a.name,
    a.type::TEXT,
    a.is_free,
    a.is_delisted,
    COALESCE(ldm.ccu_peak, 0)::INT AS ccu_peak,
    COALESCE(ldm.owners_min, 0)::BIGINT AS owners_min,
    COALESCE(ldm.owners_max, 0)::BIGINT AS owners_max,
    COALESCE(ldm.owners_midpoint, 0)::BIGINT AS owners_midpoint,
    COALESCE(ldm.total_reviews, 0)::INT AS total_reviews,
    COALESCE(ldm.positive_reviews, 0)::INT AS positive_reviews,
    ldm.review_score::INT,
    ldm.positive_percentage::DECIMAL,
    ldm.price_cents::INT,
    COALESCE(a.current_discount_percent, 0)::INT AS current_discount_percent,
    ldm.average_playtime_forever::INT,
    ldm.average_playtime_2weeks::INT,
    -- Growth (pre-computed in ccu_tier_assignments)
    ct.ccu_growth_7d_percent::DECIMAL,
    ct.ccu_growth_30d_percent::DECIMAL,
    ct.ccu_tier::INT,
    -- Velocity (from review_velocity_stats)
    COALESCE(rvs.velocity_7d, 0)::DECIMAL AS velocity_7d,
    COALESCE(rvs.velocity_30d, 0)::DECIMAL AS velocity_30d,
    rvs.velocity_tier::TEXT,
    -- PRE-COMPUTED metrics from app_filter_data
    afd.sentiment_delta::DECIMAL,
    afd.momentum_score::DECIMAL,
    afd.velocity_acceleration::DECIMAL,
    afd.active_player_pct::DECIMAL,
    afd.review_rate::DECIMAL,
    afd.value_score::DECIMAL,
    afd.vs_publisher_avg::DECIMAL,
    -- Release info
    a.release_date,
    afd.days_live::INT,
    afd.hype_duration::INT,
    a.release_state,
    -- Platform info
    a.platforms,
    afd.steam_deck_category::TEXT,
    a.controller_support,
    -- Publisher/Developer from app_filter_data
    afd.publisher_id,
    afd.publisher_name,
    afd.publisher_game_count,
    afd.developer_id,
    afd.developer_name,
    -- Timestamps
    ldm.metric_date,
    ct.updated_at AS data_updated_at
  FROM apps a
  LEFT JOIN app_filter_data afd ON afd.appid = a.appid
  LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
  LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
  LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
  WHERE a.appid = ANY(p_appids);
END;
$$;


--
-- Name: FUNCTION get_apps_by_ids(p_appids integer[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_apps_by_ids(p_appids integer[]) IS 'Fetch specific apps by ID for compare mode. Consolidates 5 sequential queries into 1 round-trip. Returns same columns as get_apps_with_filters.';


--
-- Name: get_apps_filter_option_counts(text, text, integer, integer, integer, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_filter_option_counts(p_filter_type text, p_type text DEFAULT 'game'::text, p_min_ccu integer DEFAULT NULL::integer, p_min_reviews integer DEFAULT NULL::integer, p_min_score integer DEFAULT NULL::integer, p_min_owners bigint DEFAULT NULL::bigint) RETURNS TABLE(option_id integer, option_name text, app_count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_has_metric_filters BOOLEAN;
BEGIN
  v_has_metric_filters := (
    p_min_ccu IS NOT NULL
    OR p_min_reviews IS NOT NULL
    OR p_min_score IS NOT NULL
    OR p_min_owners IS NOT NULL
  );

  IF p_filter_type = 'genre' THEN
    IF v_has_metric_filters THEN
      RETURN QUERY
      SELECT
        ag.genre_id::INT AS option_id,
        sg.name::TEXT AS option_name,
        COUNT(*)::BIGINT AS app_count
      FROM public.app_genres ag
      JOIN public.steam_genres sg ON sg.genre_id = ag.genre_id
      JOIN public.apps a ON a.appid = ag.appid
      LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
      WHERE a.is_released = TRUE
        AND a.is_delisted = FALSE
        AND (p_type = 'all' OR a.type::TEXT = p_type)
        AND (p_min_ccu IS NULL OR ldm.ccu_peak >= p_min_ccu)
        AND (p_min_reviews IS NULL OR ldm.total_reviews >= p_min_reviews)
        AND (p_min_score IS NULL OR ldm.review_score >= p_min_score)
        AND (p_min_owners IS NULL OR ldm.owners_midpoint >= p_min_owners)
      GROUP BY ag.genre_id, sg.name
      ORDER BY app_count DESC, option_name;
    ELSE
      IF p_type = 'all' THEN
        RETURN QUERY
        SELECT
          mv.genre_id::INT AS option_id,
          mv.genre_name::TEXT AS option_name,
          SUM(mv.app_count)::BIGINT AS app_count
        FROM public.mv_genre_counts mv
        GROUP BY mv.genre_id, mv.genre_name
        ORDER BY app_count DESC, option_name;
      ELSE
        RETURN QUERY
        SELECT
          mv.genre_id::INT AS option_id,
          mv.genre_name::TEXT AS option_name,
          mv.app_count::BIGINT
        FROM public.mv_genre_counts mv
        WHERE mv.app_type = p_type
        ORDER BY mv.app_count DESC, mv.genre_name;
      END IF;
    END IF;

  ELSIF p_filter_type = 'tag' THEN
    IF v_has_metric_filters THEN
      RETURN QUERY
      SELECT
        ast.tag_id::INT AS option_id,
        st.name::TEXT AS option_name,
        COUNT(*)::BIGINT AS app_count
      FROM public.app_steam_tags ast
      JOIN public.steam_tags st ON st.tag_id = ast.tag_id
      JOIN public.apps a ON a.appid = ast.appid
      LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
      WHERE a.is_released = TRUE
        AND a.is_delisted = FALSE
        AND (p_type = 'all' OR a.type::TEXT = p_type)
        AND (p_min_ccu IS NULL OR ldm.ccu_peak >= p_min_ccu)
        AND (p_min_reviews IS NULL OR ldm.total_reviews >= p_min_reviews)
        AND (p_min_score IS NULL OR ldm.review_score >= p_min_score)
        AND (p_min_owners IS NULL OR ldm.owners_midpoint >= p_min_owners)
      GROUP BY ast.tag_id, st.name
      ORDER BY app_count DESC, option_name
      LIMIT 150;
    ELSE
      IF p_type = 'all' THEN
        RETURN QUERY
        SELECT
          mv.tag_id::INT AS option_id,
          mv.tag_name::TEXT AS option_name,
          SUM(mv.app_count)::BIGINT AS app_count
        FROM public.mv_tag_counts mv
        GROUP BY mv.tag_id, mv.tag_name
        ORDER BY app_count DESC, option_name
        LIMIT 150;
      ELSE
        RETURN QUERY
        SELECT
          mv.tag_id::INT AS option_id,
          mv.tag_name::TEXT AS option_name,
          mv.app_count::BIGINT
        FROM public.mv_tag_counts mv
        WHERE mv.app_type = p_type
        ORDER BY mv.app_count DESC, mv.tag_name
        LIMIT 150;
      END IF;
    END IF;

  ELSIF p_filter_type = 'category' THEN
    IF v_has_metric_filters THEN
      RETURN QUERY
      SELECT
        ac.category_id::INT AS option_id,
        sc.name::TEXT AS option_name,
        COUNT(*)::BIGINT AS app_count
      FROM public.app_categories ac
      JOIN public.steam_categories sc ON sc.category_id = ac.category_id
      JOIN public.apps a ON a.appid = ac.appid
      LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
      WHERE a.is_released = TRUE
        AND a.is_delisted = FALSE
        AND (p_type = 'all' OR a.type::TEXT = p_type)
        AND (p_min_ccu IS NULL OR ldm.ccu_peak >= p_min_ccu)
        AND (p_min_reviews IS NULL OR ldm.total_reviews >= p_min_reviews)
        AND (p_min_score IS NULL OR ldm.review_score >= p_min_score)
        AND (p_min_owners IS NULL OR ldm.owners_midpoint >= p_min_owners)
      GROUP BY ac.category_id, sc.name
      ORDER BY app_count DESC, option_name;
    ELSE
      IF p_type = 'all' THEN
        RETURN QUERY
        SELECT
          mv.category_id::INT AS option_id,
          mv.category_name::TEXT AS option_name,
          SUM(mv.app_count)::BIGINT AS app_count
        FROM public.mv_category_counts mv
        GROUP BY mv.category_id, mv.category_name
        ORDER BY app_count DESC, option_name;
      ELSE
        RETURN QUERY
        SELECT
          mv.category_id::INT AS option_id,
          mv.category_name::TEXT AS option_name,
          mv.app_count::BIGINT
        FROM public.mv_category_counts mv
        WHERE mv.app_type = p_type
        ORDER BY mv.app_count DESC, mv.category_name;
      END IF;
    END IF;

  ELSIF p_filter_type = 'steam_deck' THEN
    IF v_has_metric_filters THEN
      RETURN QUERY
      SELECT
        ROW_NUMBER() OVER (ORDER BY asd.category)::INT AS option_id,
        asd.category::TEXT AS option_name,
        COUNT(*)::BIGINT AS app_count
      FROM public.app_steam_deck asd
      JOIN public.apps a ON a.appid = asd.appid
      LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
      WHERE a.is_released = TRUE
        AND a.is_delisted = FALSE
        AND (p_type = 'all' OR a.type::TEXT = p_type)
        AND (p_min_ccu IS NULL OR ldm.ccu_peak >= p_min_ccu)
        AND (p_min_reviews IS NULL OR ldm.total_reviews >= p_min_reviews)
        AND (p_min_score IS NULL OR ldm.review_score >= p_min_score)
        AND (p_min_owners IS NULL OR ldm.owners_midpoint >= p_min_owners)
        AND asd.category IS NOT NULL
      GROUP BY asd.category
      ORDER BY app_count DESC;
    ELSE
      IF p_type = 'all' THEN
        RETURN QUERY
        SELECT
          ROW_NUMBER() OVER (ORDER BY mv.steam_deck_category)::INT AS option_id,
          mv.steam_deck_category::TEXT AS option_name,
          SUM(mv.app_count)::BIGINT AS app_count
        FROM public.mv_steam_deck_counts mv
        GROUP BY mv.steam_deck_category
        ORDER BY app_count DESC;
      ELSE
        RETURN QUERY
        SELECT
          ROW_NUMBER() OVER (ORDER BY mv.steam_deck_category)::INT AS option_id,
          mv.steam_deck_category::TEXT AS option_name,
          mv.app_count::BIGINT
        FROM public.mv_steam_deck_counts mv
        WHERE mv.app_type = p_type
        ORDER BY mv.app_count DESC;
      END IF;
    END IF;

  ELSIF p_filter_type = 'ccu_tier' THEN
    IF v_has_metric_filters THEN
      RETURN QUERY
      SELECT
        ct.ccu_tier::INT AS option_id,
        CASE ct.ccu_tier
          WHEN 1 THEN 'Hot (Tier 1)'
          WHEN 2 THEN 'Active (Tier 2)'
          WHEN 3 THEN 'Quiet (Tier 3)'
        END::TEXT AS option_name,
        COUNT(*)::BIGINT AS app_count
      FROM public.ccu_tier_assignments ct
      JOIN public.apps a ON a.appid = ct.appid
      LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
      WHERE a.is_released = TRUE
        AND a.is_delisted = FALSE
        AND (p_type = 'all' OR a.type::TEXT = p_type)
        AND (p_min_ccu IS NULL OR ldm.ccu_peak >= p_min_ccu)
        AND (p_min_reviews IS NULL OR ldm.total_reviews >= p_min_reviews)
        AND (p_min_score IS NULL OR ldm.review_score >= p_min_score)
        AND (p_min_owners IS NULL OR ldm.owners_midpoint >= p_min_owners)
      GROUP BY ct.ccu_tier
      ORDER BY ct.ccu_tier;
    ELSE
      IF p_type = 'all' THEN
        RETURN QUERY
        SELECT
          mv.ccu_tier::INT AS option_id,
          CASE mv.ccu_tier
            WHEN 1 THEN 'Hot (Tier 1)'
            WHEN 2 THEN 'Active (Tier 2)'
            WHEN 3 THEN 'Quiet (Tier 3)'
          END::TEXT AS option_name,
          SUM(mv.app_count)::BIGINT AS app_count
        FROM public.mv_ccu_tier_counts mv
        GROUP BY mv.ccu_tier
        ORDER BY mv.ccu_tier;
      ELSE
        RETURN QUERY
        SELECT
          mv.ccu_tier::INT AS option_id,
          CASE mv.ccu_tier
            WHEN 1 THEN 'Hot (Tier 1)'
            WHEN 2 THEN 'Active (Tier 2)'
            WHEN 3 THEN 'Quiet (Tier 3)'
          END::TEXT AS option_name,
          mv.app_count::BIGINT
        FROM public.mv_ccu_tier_counts mv
        WHERE mv.app_type = p_type
        ORDER BY mv.ccu_tier;
      END IF;
    END IF;

  ELSIF p_filter_type = 'velocity_tier' THEN
    IF v_has_metric_filters THEN
      RETURN QUERY
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY CASE rvs.velocity_tier
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            WHEN 'dormant' THEN 4
          END
        )::INT AS option_id,
        rvs.velocity_tier::TEXT AS option_name,
        COUNT(*)::BIGINT AS app_count
      FROM public.review_velocity_stats rvs
      JOIN public.apps a ON a.appid = rvs.appid
      LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
      WHERE a.is_released = TRUE
        AND a.is_delisted = FALSE
        AND (p_type = 'all' OR a.type::TEXT = p_type)
        AND (p_min_ccu IS NULL OR ldm.ccu_peak >= p_min_ccu)
        AND (p_min_reviews IS NULL OR ldm.total_reviews >= p_min_reviews)
        AND (p_min_score IS NULL OR ldm.review_score >= p_min_score)
        AND (p_min_owners IS NULL OR ldm.owners_midpoint >= p_min_owners)
        AND rvs.velocity_tier IS NOT NULL
      GROUP BY rvs.velocity_tier
      ORDER BY CASE rvs.velocity_tier
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
        WHEN 'dormant' THEN 4
      END;
    ELSE
      IF p_type = 'all' THEN
        RETURN QUERY
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY CASE mv.velocity_tier
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 3
              WHEN 'dormant' THEN 4
            END
          )::INT AS option_id,
          mv.velocity_tier::TEXT AS option_name,
          SUM(mv.app_count)::BIGINT AS app_count
        FROM public.mv_velocity_tier_counts mv
        GROUP BY mv.velocity_tier
        ORDER BY CASE mv.velocity_tier
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          WHEN 'dormant' THEN 4
        END;
      ELSE
        RETURN QUERY
        SELECT
          ROW_NUMBER() OVER (
            ORDER BY CASE mv.velocity_tier
              WHEN 'high' THEN 1
              WHEN 'medium' THEN 2
              WHEN 'low' THEN 3
              WHEN 'dormant' THEN 4
            END
          )::INT AS option_id,
          mv.velocity_tier::TEXT AS option_name,
          mv.app_count::BIGINT
        FROM public.mv_velocity_tier_counts mv
        WHERE mv.app_type = p_type
        ORDER BY CASE mv.velocity_tier
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
          WHEN 'dormant' THEN 4
        END;
      END IF;
    END IF;

  ELSE
    RETURN;
  END IF;
END;
$$;


--
-- Name: FUNCTION get_apps_filter_option_counts(p_filter_type text, p_type text, p_min_ccu integer, p_min_reviews integer, p_min_score integer, p_min_owners bigint); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_apps_filter_option_counts(p_filter_type text, p_type text, p_min_ccu integer, p_min_reviews integer, p_min_score integer, p_min_owners bigint) IS 'Optimized filter option counts with a direct Steam Deck slow-path fix for app_steam_deck.category.';


--
-- Name: get_apps_for_embedding(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_for_embedding(p_limit integer DEFAULT 100) RETURNS TABLE(appid integer, name text, type text, is_free boolean, current_price_cents integer, release_date date, platforms text, controller_support text, pics_review_score smallint, pics_review_percentage smallint, steam_deck_category text, is_released boolean, is_delisted boolean, developers text[], publishers text[], genres text[], tags text[], categories text[], franchise_ids integer[], developer_ids integer[], publisher_ids integer[], updated_at timestamp with time zone, total_reviews integer, owners_min integer, ccu_peak integer, average_playtime_forever integer, metacritic_score smallint, content_descriptors jsonb, language_count integer, trend_30d_direction text, velocity_tier text, franchise_names text[], steamspy_tags text[], primary_genre text, ccu_growth_7d numeric, ccu_growth_30d numeric, velocity_7d numeric, velocity_acceleration numeric, recent_review_pct numeric, historical_review_pct numeric, sentiment_delta numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH
    filtered_apps AS (
        SELECT a.appid as aid
        FROM apps a
        JOIN sync_status s ON a.appid = s.appid
        WHERE s.is_syncable = TRUE
          AND a.type IN ('game', 'dlc', 'demo', 'mod')
          AND a.is_delisted = FALSE
          AND (
            s.last_embedding_sync IS NULL
            OR a.updated_at > s.last_embedding_sync
          )
          AND a.name IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM app_steam_tags ast WHERE ast.appid = a.appid)
            OR EXISTS (SELECT 1 FROM app_genres ag WHERE ag.appid = a.appid)
            OR a.type != 'game'
          )
        ORDER BY
          CASE WHEN s.last_embedding_sync IS NULL THEN 0 ELSE 1 END,
          s.priority_score DESC
        LIMIT p_limit
    ),
    app_devs AS (
        SELECT ad.appid as aid, array_agg(d.name ORDER BY d.name) as dev_names
        FROM app_developers ad
        JOIN developers d ON d.id = ad.developer_id
        WHERE ad.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY ad.appid
    ),
    app_pubs AS (
        SELECT ap.appid as aid, array_agg(p.name ORDER BY p.name) as pub_names
        FROM app_publishers ap
        JOIN publishers p ON p.id = ap.publisher_id
        WHERE ap.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY ap.appid
    ),
    app_genres_agg AS (
        SELECT ag.appid as aid, array_agg(sg.name ORDER BY ag.is_primary DESC, sg.name) as genre_names
        FROM app_genres ag
        JOIN steam_genres sg ON sg.genre_id = ag.genre_id
        WHERE ag.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY ag.appid
    ),
    app_primary_genre AS (
        SELECT ag.appid as aid, sg.name as primary_genre_name
        FROM app_genres ag
        JOIN steam_genres sg ON sg.genre_id = ag.genre_id
        WHERE ag.appid IN (SELECT fa.aid FROM filtered_apps fa)
          AND ag.is_primary = TRUE
    ),
    app_tags_agg AS (
        SELECT ast.appid as aid, array_agg(st.name ORDER BY ast.rank) as tag_names
        FROM (
            SELECT ast_inner.appid, ast_inner.tag_id, ast_inner.rank
            FROM app_steam_tags ast_inner
            WHERE ast_inner.appid IN (SELECT fa.aid FROM filtered_apps fa)
              AND ast_inner.rank <= 15
        ) ast
        JOIN steam_tags st ON st.tag_id = ast.tag_id
        GROUP BY ast.appid
    ),
    app_steamspy_tags AS (
        SELECT at.appid as aid, array_agg(at.tag ORDER BY at.vote_count DESC) as ss_tags
        FROM (
            SELECT app_tags.appid, app_tags.tag, app_tags.vote_count,
                   ROW_NUMBER() OVER (PARTITION BY app_tags.appid ORDER BY app_tags.vote_count DESC) as rn
            FROM app_tags
            WHERE app_tags.appid IN (SELECT fa.aid FROM filtered_apps fa)
        ) at
        WHERE at.rn <= 10
        GROUP BY at.appid
    ),
    app_cats AS (
        SELECT ac.appid as aid, array_agg(sc.name ORDER BY sc.name) as cat_names
        FROM app_categories ac
        JOIN steam_categories sc ON sc.category_id = ac.category_id
        WHERE ac.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY ac.appid
    ),
    app_franchises_ids AS (
        SELECT af.appid as aid, array_agg(af.franchise_id) as fran_ids
        FROM app_franchises af
        WHERE af.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY af.appid
    ),
    app_franchise_names AS (
        SELECT af.appid as aid, array_agg(DISTINCT f.name) as fran_names
        FROM app_franchises af
        JOIN franchises f ON f.id = af.franchise_id
        WHERE af.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY af.appid
    ),
    app_dev_ids AS (
        SELECT ad.appid as aid, array_agg(ad.developer_id) as dev_ids
        FROM app_developers ad
        WHERE ad.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY ad.appid
    ),
    app_pub_ids AS (
        SELECT ap.appid as aid, array_agg(ap.publisher_id) as pub_ids
        FROM app_publishers ap
        WHERE ap.appid IN (SELECT fa.aid FROM filtered_apps fa)
        GROUP BY ap.appid
    ),
    app_metrics AS (
        SELECT
            ldm.appid as aid,
            ldm.total_reviews,
            ldm.owners_min,
            ldm.ccu_peak
        FROM latest_daily_metrics ldm
        WHERE ldm.appid IN (SELECT fa.aid FROM filtered_apps fa)
    ),
    app_playtime AS (
        SELECT DISTINCT ON (dm.appid)
            dm.appid as aid,
            dm.average_playtime_forever
        FROM daily_metrics dm
        WHERE dm.appid IN (SELECT fa.aid FROM filtered_apps fa)
        ORDER BY dm.appid, dm.metric_date DESC
    ),
    app_trend AS (
        SELECT
            at.appid as aid,
            at.trend_30d_direction::TEXT as trend_dir
        FROM app_trends at
        WHERE at.appid IN (SELECT fa.aid FROM filtered_apps fa)
    ),
    app_velocity AS (
        SELECT
            rvs.appid as aid,
            rvs.velocity_tier,
            rvs.velocity_7d as vel_7d,
            rvs.velocity_30d as vel_30d
        FROM review_velocity_stats rvs
        WHERE rvs.appid IN (SELECT fa.aid FROM filtered_apps fa)
    ),
    -- NEW: CCU momentum calculations (inline for batch efficiency)
    ccu_7d_avg AS (
        SELECT cs.appid as aid, AVG(cs.player_count)::NUMERIC as avg_ccu
        FROM ccu_snapshots cs
        WHERE cs.appid IN (SELECT fa.aid FROM filtered_apps fa)
          AND cs.snapshot_time > NOW() - INTERVAL '7 days'
        GROUP BY cs.appid
    ),
    ccu_prev_7d_avg AS (
        SELECT cs.appid as aid, AVG(cs.player_count)::NUMERIC as avg_ccu
        FROM ccu_snapshots cs
        WHERE cs.appid IN (SELECT fa.aid FROM filtered_apps fa)
          AND cs.snapshot_time > NOW() - INTERVAL '14 days'
          AND cs.snapshot_time <= NOW() - INTERVAL '7 days'
        GROUP BY cs.appid
    ),
    ccu_30d_avg AS (
        SELECT cs.appid as aid, AVG(cs.player_count)::NUMERIC as avg_ccu
        FROM ccu_snapshots cs
        WHERE cs.appid IN (SELECT fa.aid FROM filtered_apps fa)
          AND cs.snapshot_time > NOW() - INTERVAL '30 days'
        GROUP BY cs.appid
    ),
    app_momentum AS (
        SELECT
            fa.aid,
            -- CCU growth 7d: week-over-week change
            CASE
                WHEN p7.avg_ccu IS NOT NULL AND p7.avg_ccu > 0
                THEN ROUND(((c7.avg_ccu - p7.avg_ccu) / p7.avg_ccu) * 100, 1)
                ELSE NULL
            END AS ccu_growth_7d,
            -- CCU growth 30d: deviation from 30-day baseline
            CASE
                WHEN c30.avg_ccu IS NOT NULL AND c30.avg_ccu > 0
                THEN ROUND(((c7.avg_ccu - c30.avg_ccu) / c30.avg_ccu) * 100, 1)
                ELSE NULL
            END AS ccu_growth_30d
        FROM filtered_apps fa
        LEFT JOIN ccu_7d_avg c7 ON c7.aid = fa.aid
        LEFT JOIN ccu_prev_7d_avg p7 ON p7.aid = fa.aid
        LEFT JOIN ccu_30d_avg c30 ON c30.aid = fa.aid
    ),
    -- NEW: Sentiment trajectory calculations
    app_sentiment AS (
        SELECT
            dm.appid as aid,
            -- Recent review percentage (30-day)
            CASE
                WHEN dm.recent_total_reviews IS NOT NULL AND dm.recent_total_reviews > 0
                THEN ROUND((dm.recent_positive::NUMERIC / dm.recent_total_reviews) * 100, 1)
                ELSE NULL
            END AS recent_review_pct,
            -- Historical review percentage (all-time)
            CASE
                WHEN dm.total_reviews IS NOT NULL AND dm.total_reviews > 0
                THEN ROUND((dm.positive_reviews::NUMERIC / dm.total_reviews) * 100, 1)
                ELSE NULL
            END AS historical_review_pct
        FROM (
            SELECT DISTINCT ON (dm_inner.appid)
                dm_inner.appid,
                dm_inner.recent_positive,
                dm_inner.recent_total_reviews,
                dm_inner.positive_reviews,
                dm_inner.total_reviews
            FROM daily_metrics dm_inner
            WHERE dm_inner.appid IN (SELECT fa.aid FROM filtered_apps fa)
            ORDER BY dm_inner.appid, dm_inner.metric_date DESC
        ) dm
    )
    SELECT
        a.appid,
        a.name,
        a.type::TEXT,
        a.is_free,
        a.current_price_cents,
        a.release_date,
        a.platforms,
        a.controller_support,
        a.pics_review_score,
        a.pics_review_percentage,
        asd.category::TEXT as steam_deck_category,
        a.is_released,
        a.is_delisted,
        COALESCE(ad.dev_names, '{}') as developers,
        COALESCE(apub.pub_names, '{}') as publishers,
        COALESCE(ag.genre_names, '{}') as genres,
        COALESCE(atag.tag_names, '{}') as tags,
        COALESCE(ac.cat_names, '{}') as categories,
        COALESCE(afr.fran_ids, '{}') as franchise_ids,
        COALESCE(adi.dev_ids, '{}') as developer_ids,
        COALESCE(api.pub_ids, '{}') as publisher_ids,
        a.updated_at,
        am.total_reviews,
        am.owners_min,
        am.ccu_peak,
        apt.average_playtime_forever,
        a.metacritic_score,
        a.content_descriptors,
        COALESCE((SELECT COUNT(*) FROM jsonb_object_keys(a.languages)), 0)::INT as language_count,
        atr.trend_dir as trend_30d_direction,
        av.velocity_tier,
        COALESCE(afn.fran_names, '{}') as franchise_names,
        COALESCE(asst.ss_tags, '{}') as steamspy_tags,
        apg.primary_genre_name as primary_genre,
        -- NEW: Momentum metrics
        mom.ccu_growth_7d,
        mom.ccu_growth_30d,
        av.vel_7d as velocity_7d,
        CASE
            WHEN av.vel_7d IS NOT NULL AND av.vel_30d IS NOT NULL
            THEN ROUND(av.vel_7d - av.vel_30d, 2)
            ELSE NULL
        END AS velocity_acceleration,
        -- NEW: Sentiment trajectory
        sent.recent_review_pct,
        sent.historical_review_pct,
        CASE
            WHEN sent.recent_review_pct IS NOT NULL AND sent.historical_review_pct IS NOT NULL
            THEN ROUND(sent.recent_review_pct - sent.historical_review_pct, 1)
            ELSE NULL
        END AS sentiment_delta
    FROM apps a
    JOIN filtered_apps fa ON fa.aid = a.appid
    LEFT JOIN app_steam_deck asd ON a.appid = asd.appid
    LEFT JOIN app_devs ad ON ad.aid = a.appid
    LEFT JOIN app_pubs apub ON apub.aid = a.appid
    LEFT JOIN app_genres_agg ag ON ag.aid = a.appid
    LEFT JOIN app_primary_genre apg ON apg.aid = a.appid
    LEFT JOIN app_tags_agg atag ON atag.aid = a.appid
    LEFT JOIN app_steamspy_tags asst ON asst.aid = a.appid
    LEFT JOIN app_cats ac ON ac.aid = a.appid
    LEFT JOIN app_franchises_ids afr ON afr.aid = a.appid
    LEFT JOIN app_franchise_names afn ON afn.aid = a.appid
    LEFT JOIN app_dev_ids adi ON adi.aid = a.appid
    LEFT JOIN app_pub_ids api ON api.aid = a.appid
    LEFT JOIN app_metrics am ON am.aid = a.appid
    LEFT JOIN app_playtime apt ON apt.aid = a.appid
    LEFT JOIN app_trend atr ON atr.aid = a.appid
    LEFT JOIN app_velocity av ON av.aid = a.appid
    LEFT JOIN app_momentum mom ON mom.aid = a.appid
    LEFT JOIN app_sentiment sent ON sent.aid = a.appid;
END;
$$;


--
-- Name: FUNCTION get_apps_for_embedding(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_apps_for_embedding(p_limit integer) IS 'Fetches apps needing embedding with enhanced metadata including momentum metrics and sentiment trajectory.
Sprint 2.3: Added ccu_growth_7d/30d, velocity_7d, velocity_acceleration, recent/historical_review_pct, sentiment_delta.';


--
-- Name: get_apps_for_embedding_by_ids(integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_for_embedding_by_ids(p_appids integer[]) RETURNS TABLE(appid integer, name text, type text, is_free boolean, current_price_cents integer, release_date date, platforms text, controller_support text, pics_review_score smallint, pics_review_percentage smallint, steam_deck_category text, is_released boolean, is_delisted boolean, developers text[], publishers text[], genres text[], tags text[], categories text[], franchise_ids integer[], developer_ids integer[], publisher_ids integer[], updated_at timestamp with time zone, total_reviews integer, owners_min integer, ccu_peak integer, average_playtime_forever integer, metacritic_score smallint, content_descriptors jsonb, language_count integer, trend_30d_direction text, velocity_tier text, franchise_names text[], steamspy_tags text[], primary_genre text, ccu_growth_7d numeric, ccu_growth_30d numeric, velocity_7d numeric, velocity_acceleration numeric, recent_review_pct numeric, historical_review_pct numeric, sentiment_delta numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH
    target_apps AS (
        SELECT unnest(p_appids) as aid
    ),
    app_devs AS (
        SELECT ad.appid as aid, array_agg(d.name ORDER BY d.name) as dev_names
        FROM app_developers ad
        JOIN developers d ON d.id = ad.developer_id
        WHERE ad.appid = ANY(p_appids)
        GROUP BY ad.appid
    ),
    app_pubs AS (
        SELECT ap.appid as aid, array_agg(p.name ORDER BY p.name) as pub_names
        FROM app_publishers ap
        JOIN publishers p ON p.id = ap.publisher_id
        WHERE ap.appid = ANY(p_appids)
        GROUP BY ap.appid
    ),
    app_genres_agg AS (
        SELECT ag.appid as aid, array_agg(sg.name ORDER BY ag.is_primary DESC, sg.name) as genre_names
        FROM app_genres ag
        JOIN steam_genres sg ON sg.genre_id = ag.genre_id
        WHERE ag.appid = ANY(p_appids)
        GROUP BY ag.appid
    ),
    app_primary_genre AS (
        SELECT ag.appid as aid, sg.name as primary_genre_name
        FROM app_genres ag
        JOIN steam_genres sg ON sg.genre_id = ag.genre_id
        WHERE ag.appid = ANY(p_appids)
          AND ag.is_primary = TRUE
    ),
    app_tags_agg AS (
        SELECT ast.appid as aid, array_agg(st.name ORDER BY ast.rank) as tag_names
        FROM app_steam_tags ast
        JOIN steam_tags st ON st.tag_id = ast.tag_id
        WHERE ast.appid = ANY(p_appids) AND ast.rank <= 15
        GROUP BY ast.appid
    ),
    app_steamspy_tags AS (
        SELECT at.appid as aid, array_agg(at.tag ORDER BY at.vote_count DESC) as ss_tags
        FROM (
            SELECT app_tags.appid, app_tags.tag, app_tags.vote_count,
                   ROW_NUMBER() OVER (PARTITION BY app_tags.appid ORDER BY app_tags.vote_count DESC) as rn
            FROM app_tags
            WHERE app_tags.appid = ANY(p_appids)
        ) at
        WHERE at.rn <= 10
        GROUP BY at.appid
    ),
    app_cats AS (
        SELECT ac.appid as aid, array_agg(sc.name ORDER BY sc.name) as cat_names
        FROM app_categories ac
        JOIN steam_categories sc ON sc.category_id = ac.category_id
        WHERE ac.appid = ANY(p_appids)
        GROUP BY ac.appid
    ),
    app_franchises_ids AS (
        SELECT af.appid as aid, array_agg(af.franchise_id) as fran_ids
        FROM app_franchises af
        WHERE af.appid = ANY(p_appids)
        GROUP BY af.appid
    ),
    app_franchise_names AS (
        SELECT af.appid as aid, array_agg(DISTINCT f.name) as fran_names
        FROM app_franchises af
        JOIN franchises f ON f.id = af.franchise_id
        WHERE af.appid = ANY(p_appids)
        GROUP BY af.appid
    ),
    app_dev_ids AS (
        SELECT ad.appid as aid, array_agg(ad.developer_id) as dev_ids
        FROM app_developers ad
        WHERE ad.appid = ANY(p_appids)
        GROUP BY ad.appid
    ),
    app_pub_ids AS (
        SELECT ap.appid as aid, array_agg(ap.publisher_id) as pub_ids
        FROM app_publishers ap
        WHERE ap.appid = ANY(p_appids)
        GROUP BY ap.appid
    ),
    app_metrics AS (
        SELECT
            ldm.appid as aid,
            ldm.total_reviews,
            ldm.owners_min,
            ldm.ccu_peak
        FROM latest_daily_metrics ldm
        WHERE ldm.appid = ANY(p_appids)
    ),
    app_playtime AS (
        SELECT DISTINCT ON (dm.appid)
            dm.appid as aid,
            dm.average_playtime_forever
        FROM daily_metrics dm
        WHERE dm.appid = ANY(p_appids)
        ORDER BY dm.appid, dm.metric_date DESC
    ),
    app_trend AS (
        SELECT
            at.appid as aid,
            at.trend_30d_direction::TEXT as trend_dir
        FROM app_trends at
        WHERE at.appid = ANY(p_appids)
    ),
    app_velocity AS (
        SELECT
            rvs.appid as aid,
            rvs.velocity_tier,
            rvs.velocity_7d as vel_7d,
            rvs.velocity_30d as vel_30d
        FROM review_velocity_stats rvs
        WHERE rvs.appid = ANY(p_appids)
    ),
    -- NEW: CCU momentum calculations
    ccu_7d_avg AS (
        SELECT cs.appid as aid, AVG(cs.player_count)::NUMERIC as avg_ccu
        FROM ccu_snapshots cs
        WHERE cs.appid = ANY(p_appids)
          AND cs.snapshot_time > NOW() - INTERVAL '7 days'
        GROUP BY cs.appid
    ),
    ccu_prev_7d_avg AS (
        SELECT cs.appid as aid, AVG(cs.player_count)::NUMERIC as avg_ccu
        FROM ccu_snapshots cs
        WHERE cs.appid = ANY(p_appids)
          AND cs.snapshot_time > NOW() - INTERVAL '14 days'
          AND cs.snapshot_time <= NOW() - INTERVAL '7 days'
        GROUP BY cs.appid
    ),
    ccu_30d_avg AS (
        SELECT cs.appid as aid, AVG(cs.player_count)::NUMERIC as avg_ccu
        FROM ccu_snapshots cs
        WHERE cs.appid = ANY(p_appids)
          AND cs.snapshot_time > NOW() - INTERVAL '30 days'
        GROUP BY cs.appid
    ),
    app_momentum AS (
        SELECT
            ta.aid,
            CASE
                WHEN p7.avg_ccu IS NOT NULL AND p7.avg_ccu > 0
                THEN ROUND(((c7.avg_ccu - p7.avg_ccu) / p7.avg_ccu) * 100, 1)
                ELSE NULL
            END AS ccu_growth_7d,
            CASE
                WHEN c30.avg_ccu IS NOT NULL AND c30.avg_ccu > 0
                THEN ROUND(((c7.avg_ccu - c30.avg_ccu) / c30.avg_ccu) * 100, 1)
                ELSE NULL
            END AS ccu_growth_30d
        FROM target_apps ta
        LEFT JOIN ccu_7d_avg c7 ON c7.aid = ta.aid
        LEFT JOIN ccu_prev_7d_avg p7 ON p7.aid = ta.aid
        LEFT JOIN ccu_30d_avg c30 ON c30.aid = ta.aid
    ),
    -- NEW: Sentiment trajectory calculations
    app_sentiment AS (
        SELECT
            dm.appid as aid,
            CASE
                WHEN dm.recent_total_reviews IS NOT NULL AND dm.recent_total_reviews > 0
                THEN ROUND((dm.recent_positive::NUMERIC / dm.recent_total_reviews) * 100, 1)
                ELSE NULL
            END AS recent_review_pct,
            CASE
                WHEN dm.total_reviews IS NOT NULL AND dm.total_reviews > 0
                THEN ROUND((dm.positive_reviews::NUMERIC / dm.total_reviews) * 100, 1)
                ELSE NULL
            END AS historical_review_pct
        FROM (
            SELECT DISTINCT ON (dm_inner.appid)
                dm_inner.appid,
                dm_inner.recent_positive,
                dm_inner.recent_total_reviews,
                dm_inner.positive_reviews,
                dm_inner.total_reviews
            FROM daily_metrics dm_inner
            WHERE dm_inner.appid = ANY(p_appids)
            ORDER BY dm_inner.appid, dm_inner.metric_date DESC
        ) dm
    )
    SELECT
        a.appid,
        a.name,
        a.type::TEXT,
        a.is_free,
        a.current_price_cents,
        a.release_date,
        a.platforms,
        a.controller_support,
        a.pics_review_score,
        a.pics_review_percentage,
        asd.category::TEXT as steam_deck_category,
        a.is_released,
        a.is_delisted,
        COALESCE(ad.dev_names, '{}') as developers,
        COALESCE(apub.pub_names, '{}') as publishers,
        COALESCE(ag.genre_names, '{}') as genres,
        COALESCE(atag.tag_names, '{}') as tags,
        COALESCE(ac.cat_names, '{}') as categories,
        COALESCE(afr.fran_ids, '{}') as franchise_ids,
        COALESCE(adi.dev_ids, '{}') as developer_ids,
        COALESCE(api.pub_ids, '{}') as publisher_ids,
        a.updated_at,
        am.total_reviews,
        am.owners_min,
        am.ccu_peak,
        apt.average_playtime_forever,
        a.metacritic_score,
        a.content_descriptors,
        COALESCE((SELECT COUNT(*) FROM jsonb_object_keys(a.languages)), 0)::INT as language_count,
        atr.trend_dir as trend_30d_direction,
        av.velocity_tier,
        COALESCE(afn.fran_names, '{}') as franchise_names,
        COALESCE(asst.ss_tags, '{}') as steamspy_tags,
        apg.primary_genre_name as primary_genre,
        -- NEW: Momentum metrics
        mom.ccu_growth_7d,
        mom.ccu_growth_30d,
        av.vel_7d as velocity_7d,
        CASE
            WHEN av.vel_7d IS NOT NULL AND av.vel_30d IS NOT NULL
            THEN ROUND(av.vel_7d - av.vel_30d, 2)
            ELSE NULL
        END AS velocity_acceleration,
        -- NEW: Sentiment trajectory
        sent.recent_review_pct,
        sent.historical_review_pct,
        CASE
            WHEN sent.recent_review_pct IS NOT NULL AND sent.historical_review_pct IS NOT NULL
            THEN ROUND(sent.recent_review_pct - sent.historical_review_pct, 1)
            ELSE NULL
        END AS sentiment_delta
    FROM apps a
    LEFT JOIN app_steam_deck asd ON a.appid = asd.appid
    LEFT JOIN app_devs ad ON ad.aid = a.appid
    LEFT JOIN app_pubs apub ON apub.aid = a.appid
    LEFT JOIN app_genres_agg ag ON ag.aid = a.appid
    LEFT JOIN app_primary_genre apg ON apg.aid = a.appid
    LEFT JOIN app_tags_agg atag ON atag.aid = a.appid
    LEFT JOIN app_steamspy_tags asst ON asst.aid = a.appid
    LEFT JOIN app_cats ac ON ac.aid = a.appid
    LEFT JOIN app_franchises_ids afr ON afr.aid = a.appid
    LEFT JOIN app_franchise_names afn ON afn.aid = a.appid
    LEFT JOIN app_dev_ids adi ON adi.aid = a.appid
    LEFT JOIN app_pub_ids api ON api.aid = a.appid
    LEFT JOIN app_metrics am ON am.aid = a.appid
    LEFT JOIN app_playtime apt ON apt.aid = a.appid
    LEFT JOIN app_trend atr ON atr.aid = a.appid
    LEFT JOIN app_velocity av ON av.aid = a.appid
    LEFT JOIN app_momentum mom ON mom.aid = a.appid
    LEFT JOIN app_sentiment sent ON sent.aid = a.appid
    WHERE a.appid = ANY(p_appids);
END;
$$;


--
-- Name: get_apps_for_reviews_sync(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_for_reviews_sync(p_limit integer DEFAULT 800) RETURNS TABLE(appid integer, priority_score integer, velocity_tier text, hours_overdue numeric, last_known_total_reviews integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.appid,
        s.priority_score,
        COALESCE(s.review_velocity_tier, 'unknown') as velocity_tier,
        EXTRACT(EPOCH FROM (NOW() - s.next_reviews_sync)) / 3600.0 as hours_overdue,
        s.last_known_total_reviews
    FROM sync_status s
    WHERE s.is_syncable = TRUE
      AND (s.next_reviews_sync IS NULL OR s.next_reviews_sync <= NOW())
    ORDER BY
        -- Prioritize never-synced apps
        CASE WHEN s.last_reviews_sync IS NULL THEN 0 ELSE 1 END,
        -- Then by velocity tier (high-velocity apps first)
        CASE s.review_velocity_tier
            WHEN 'high' THEN 0
            WHEN 'medium' THEN 1
            WHEN 'low' THEN 2
            WHEN 'dormant' THEN 3
            ELSE 4
        END,
        -- Then by how overdue they are
        s.next_reviews_sync ASC NULLS FIRST,
        -- Finally by general priority
        s.priority_score DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: FUNCTION get_apps_for_reviews_sync(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_apps_for_reviews_sync(p_limit integer) IS 'Get apps due for reviews sync, prioritized by velocity tier';


--
-- Name: get_apps_for_sync(public.sync_source, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_for_sync(p_source public.sync_source, p_limit integer DEFAULT 100) RETURNS TABLE(appid integer, priority_score integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT s.appid, s.priority_score
    FROM sync_status s
    WHERE s.is_syncable = TRUE
      AND CASE p_source
          WHEN 'steamspy' THEN
            s.last_steamspy_sync IS NULL
            OR s.last_steamspy_sync < NOW() - (COALESCE(s.sync_interval_hours, 24) || ' hours')::INTERVAL
          WHEN 'storefront' THEN
            (s.last_storefront_sync IS NULL
             OR s.last_storefront_sync < NOW() - (COALESCE(s.sync_interval_hours, 24) || ' hours')::INTERVAL)
            AND (s.storefront_accessible IS NULL OR s.storefront_accessible = TRUE)
          WHEN 'reviews' THEN
            s.last_reviews_sync IS NULL
            OR s.last_reviews_sync < NOW() - (COALESCE(s.sync_interval_hours, 24) || ' hours')::INTERVAL
          WHEN 'histogram' THEN
            s.last_histogram_sync IS NULL
            OR s.last_histogram_sync < NOW() - INTERVAL '7 days'
          ELSE TRUE
      END
    ORDER BY
      -- First priority: Apps with inconsistent release state (is_released but no date)
      -- These need immediate sync to capture release date
      CASE WHEN p_source = 'storefront' AND EXISTS (
        SELECT 1 FROM apps a
        WHERE a.appid = s.appid
          AND a.is_released = TRUE
          AND a.release_date IS NULL
          AND a.type = 'game'
          AND a.is_delisted = FALSE
      ) THEN 0 ELSE 1 END,
      -- Second priority: Never-synced apps
      CASE WHEN
        (p_source = 'storefront' AND s.last_storefront_sync IS NULL) OR
        (p_source = 'reviews' AND s.last_reviews_sync IS NULL) OR
        (p_source = 'steamspy' AND s.last_steamspy_sync IS NULL) OR
        (p_source = 'histogram' AND s.last_histogram_sync IS NULL)
      THEN 0 ELSE 1 END,
      -- Third: By priority score
      s.priority_score DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: FUNCTION get_apps_for_sync(p_source public.sync_source, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_apps_for_sync(p_source public.sync_source, p_limit integer) IS 'Returns apps due for sync. Prioritizes: 1) inconsistent release states (is_released but no date), 2) never-synced apps, 3) by priority score.';


--
-- Name: get_apps_for_sync_partitioned(public.sync_source, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_for_sync_partitioned(p_source public.sync_source, p_limit integer, p_partition_count integer, p_partition_id integer) RETURNS TABLE(appid integer, priority_score integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH eligible_apps AS (
    SELECT s.appid, s.priority_score,
           ROW_NUMBER() OVER (ORDER BY
             -- First priority: Apps with inconsistent release state
             CASE WHEN p_source = 'storefront' AND EXISTS (
               SELECT 1 FROM apps a
               WHERE a.appid = s.appid
                 AND a.is_released = TRUE
                 AND a.release_date IS NULL
                 AND a.type = 'game'
                 AND a.is_delisted = FALSE
             ) THEN 0 ELSE 1 END,
             -- Second priority: Never-synced apps
             CASE WHEN
               (p_source = 'storefront' AND s.last_storefront_sync IS NULL) OR
               (p_source = 'reviews' AND s.last_reviews_sync IS NULL) OR
               (p_source = 'steamspy' AND s.last_steamspy_sync IS NULL) OR
               (p_source = 'histogram' AND s.last_histogram_sync IS NULL)
             THEN 0 ELSE 1 END,
             -- Third: By priority score
             s.priority_score DESC
           ) as rn
    FROM sync_status s
    WHERE s.is_syncable = TRUE
      AND CASE p_source
          WHEN 'steamspy' THEN
            s.last_steamspy_sync IS NULL
            OR s.last_steamspy_sync < NOW() - (COALESCE(s.sync_interval_hours, 24) || ' hours')::INTERVAL
          WHEN 'storefront' THEN
            (s.last_storefront_sync IS NULL
             OR s.last_storefront_sync < NOW() - (COALESCE(s.sync_interval_hours, 24) || ' hours')::INTERVAL)
            AND (s.storefront_accessible IS NULL OR s.storefront_accessible = TRUE)
          WHEN 'reviews' THEN
            s.last_reviews_sync IS NULL
            OR s.last_reviews_sync < NOW() - (COALESCE(s.sync_interval_hours, 24) || ' hours')::INTERVAL
          WHEN 'histogram' THEN
            s.last_histogram_sync IS NULL
            OR s.last_histogram_sync < NOW() - INTERVAL '7 days'
          ELSE TRUE
      END
  )
  SELECT e.appid, e.priority_score
  FROM eligible_apps e
  WHERE (e.rn - 1) % p_partition_count = p_partition_id
  ORDER BY e.priority_score DESC
  LIMIT p_limit;
END;
$$;


--
-- Name: FUNCTION get_apps_for_sync_partitioned(p_source public.sync_source, p_limit integer, p_partition_count integer, p_partition_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_apps_for_sync_partitioned(p_source public.sync_source, p_limit integer, p_partition_count integer, p_partition_id integer) IS 'Returns apps due for sync, partitioned. Prioritizes: 1) inconsistent release states, 2) never-synced apps, 3) by priority score.';


--
-- Name: get_apps_with_filters(integer, integer, text, text, text, text, integer, integer, bigint, bigint, integer, integer, integer, integer, integer, integer, integer, integer, boolean, integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, integer[], text, integer[], text, integer[], boolean, text[], text, text, text, integer, integer, integer, boolean, integer, integer, text, text, boolean, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_apps_with_filters(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort_field text DEFAULT 'ccu_peak'::text, p_sort_order text DEFAULT 'desc'::text, p_type text DEFAULT 'game'::text, p_search text DEFAULT NULL::text, p_min_ccu integer DEFAULT NULL::integer, p_max_ccu integer DEFAULT NULL::integer, p_min_owners bigint DEFAULT NULL::bigint, p_max_owners bigint DEFAULT NULL::bigint, p_min_reviews integer DEFAULT NULL::integer, p_max_reviews integer DEFAULT NULL::integer, p_min_score integer DEFAULT NULL::integer, p_max_score integer DEFAULT NULL::integer, p_min_price integer DEFAULT NULL::integer, p_max_price integer DEFAULT NULL::integer, p_min_playtime integer DEFAULT NULL::integer, p_max_playtime integer DEFAULT NULL::integer, p_is_free boolean DEFAULT NULL::boolean, p_min_discount integer DEFAULT NULL::integer, p_min_growth_7d numeric DEFAULT NULL::numeric, p_max_growth_7d numeric DEFAULT NULL::numeric, p_min_growth_30d numeric DEFAULT NULL::numeric, p_max_growth_30d numeric DEFAULT NULL::numeric, p_min_momentum numeric DEFAULT NULL::numeric, p_max_momentum numeric DEFAULT NULL::numeric, p_min_sentiment_delta numeric DEFAULT NULL::numeric, p_max_sentiment_delta numeric DEFAULT NULL::numeric, p_velocity_tier text DEFAULT NULL::text, p_min_active_pct numeric DEFAULT NULL::numeric, p_min_review_rate numeric DEFAULT NULL::numeric, p_min_value_score numeric DEFAULT NULL::numeric, p_min_vs_publisher numeric DEFAULT NULL::numeric, p_genres integer[] DEFAULT NULL::integer[], p_genre_mode text DEFAULT 'any'::text, p_tags integer[] DEFAULT NULL::integer[], p_tag_mode text DEFAULT 'any'::text, p_categories integer[] DEFAULT NULL::integer[], p_has_workshop boolean DEFAULT NULL::boolean, p_platforms text[] DEFAULT NULL::text[], p_platform_mode text DEFAULT 'any'::text, p_steam_deck text DEFAULT NULL::text, p_controller text DEFAULT NULL::text, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_release_year integer DEFAULT NULL::integer, p_early_access boolean DEFAULT NULL::boolean, p_min_hype integer DEFAULT NULL::integer, p_max_hype integer DEFAULT NULL::integer, p_publisher_search text DEFAULT NULL::text, p_developer_search text DEFAULT NULL::text, p_self_published boolean DEFAULT NULL::boolean, p_publisher_size text DEFAULT NULL::text, p_ccu_tier integer DEFAULT NULL::integer) RETURNS TABLE(appid integer, name text, type text, is_free boolean, ccu_peak integer, owners_min bigint, owners_max bigint, owners_midpoint bigint, total_reviews integer, positive_reviews integer, review_score integer, positive_percentage numeric, price_cents integer, current_discount_percent integer, average_playtime_forever integer, average_playtime_2weeks integer, ccu_growth_7d_percent numeric, ccu_growth_30d_percent numeric, ccu_tier integer, velocity_7d numeric, velocity_30d numeric, velocity_tier text, sentiment_delta numeric, momentum_score numeric, velocity_acceleration numeric, active_player_pct numeric, review_rate numeric, value_score numeric, vs_publisher_avg numeric, release_date date, days_live integer, hype_duration integer, release_state text, platforms text, steam_deck_category text, controller_support text, publisher_id integer, publisher_name text, publisher_game_count integer, developer_id integer, developer_name text, metric_date date, data_updated_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  -- SINGLE PATH: All metrics pre-computed in app_filter_data
  -- No slow path needed - vs_publisher_avg is now in the materialized view
  RETURN QUERY
  WITH base_apps AS (
    SELECT
      a.appid,
      a.name,
      a.type::TEXT,
      a.is_free,
      COALESCE(ldm.ccu_peak, 0)::INT AS ccu_peak,
      COALESCE(ldm.owners_min, 0)::BIGINT AS owners_min,
      COALESCE(ldm.owners_max, 0)::BIGINT AS owners_max,
      COALESCE(ldm.owners_midpoint, 0)::BIGINT AS owners_midpoint,
      COALESCE(ldm.total_reviews, 0)::INT AS total_reviews,
      COALESCE(ldm.positive_reviews, 0)::INT AS positive_reviews,
      ldm.review_score::INT,
      ldm.positive_percentage::DECIMAL,
      ldm.price_cents::INT,
      COALESCE(a.current_discount_percent, 0)::INT AS current_discount_percent,
      ldm.average_playtime_forever::INT,
      ldm.average_playtime_2weeks::INT,
      -- Growth (from ccu_tier_assignments)
      ct.ccu_growth_7d_percent::DECIMAL,
      ct.ccu_growth_30d_percent::DECIMAL,
      ct.ccu_tier::INT,
      -- Velocity (from review_velocity_stats)
      COALESCE(rvs.velocity_7d, 0)::DECIMAL AS velocity_7d,
      COALESCE(rvs.velocity_30d, 0)::DECIMAL AS velocity_30d,
      rvs.velocity_tier::TEXT,
      -- Release info
      a.release_date,
      a.release_state,
      -- Platform info
      a.platforms,
      a.controller_support,
      -- Timestamps
      ldm.metric_date,
      ct.updated_at AS data_updated_at,
      -- PRE-COMPUTED from app_filter_data
      afd.genre_ids,
      afd.tag_ids,
      afd.category_ids,
      afd.has_workshop AS afd_has_workshop,
      afd.platform_array,
      afd.steam_deck_category::TEXT,
      afd.publisher_id,
      afd.publisher_name,
      afd.publisher_game_count,
      afd.developer_id,
      afd.developer_name,
      -- NEW: Pre-computed metrics from app_filter_data
      afd.vs_publisher_avg,
      afd.momentum_score,
      afd.sentiment_delta,
      afd.velocity_acceleration,
      afd.active_player_pct,
      afd.review_rate,
      afd.value_score,
      afd.days_live,
      afd.hype_duration
    FROM apps a
    INNER JOIN app_filter_data afd ON afd.appid = a.appid
    LEFT JOIN latest_daily_metrics ldm ON ldm.appid = a.appid
    LEFT JOIN ccu_tier_assignments ct ON ct.appid = a.appid
    LEFT JOIN review_velocity_stats rvs ON rvs.appid = a.appid
    WHERE a.is_released = TRUE AND a.is_delisted = FALSE
      AND (p_type = 'all' OR a.type::TEXT = p_type)
      AND (p_is_free IS NULL OR a.is_free = p_is_free)
  ),
  filtered AS (
    SELECT ba.*
    FROM base_apps ba
    WHERE
      -- Text search
      (p_search IS NULL OR ba.name ILIKE '%' || p_search || '%')
      -- Metric ranges
      AND (p_min_ccu IS NULL OR ba.ccu_peak >= p_min_ccu)
      AND (p_max_ccu IS NULL OR ba.ccu_peak <= p_max_ccu)
      AND (p_min_owners IS NULL OR ba.owners_midpoint >= p_min_owners)
      AND (p_max_owners IS NULL OR ba.owners_midpoint <= p_max_owners)
      AND (p_min_reviews IS NULL OR ba.total_reviews >= p_min_reviews)
      AND (p_max_reviews IS NULL OR ba.total_reviews <= p_max_reviews)
      AND (p_min_score IS NULL OR ba.review_score >= p_min_score)
      AND (p_max_score IS NULL OR ba.review_score <= p_max_score)
      AND (p_min_price IS NULL OR ba.price_cents >= p_min_price)
      AND (p_max_price IS NULL OR ba.price_cents <= p_max_price)
      AND (p_min_playtime IS NULL OR ba.average_playtime_forever >= p_min_playtime)
      AND (p_max_playtime IS NULL OR ba.average_playtime_forever <= p_max_playtime)
      -- NEW: Discount filter (Bug #2 fix)
      AND (p_min_discount IS NULL OR ba.current_discount_percent >= p_min_discount)
      -- Growth filters
      AND (p_min_growth_7d IS NULL OR ba.ccu_growth_7d_percent >= p_min_growth_7d)
      AND (p_max_growth_7d IS NULL OR ba.ccu_growth_7d_percent <= p_max_growth_7d)
      AND (p_min_growth_30d IS NULL OR ba.ccu_growth_30d_percent >= p_min_growth_30d)
      AND (p_max_growth_30d IS NULL OR ba.ccu_growth_30d_percent <= p_max_growth_30d)
      -- Pre-computed metric filters (now from app_filter_data)
      AND (p_min_momentum IS NULL OR ba.momentum_score >= p_min_momentum)
      AND (p_max_momentum IS NULL OR ba.momentum_score <= p_max_momentum)
      AND (p_min_sentiment_delta IS NULL OR ba.sentiment_delta >= p_min_sentiment_delta)
      AND (p_max_sentiment_delta IS NULL OR ba.sentiment_delta <= p_max_sentiment_delta)
      AND (p_velocity_tier IS NULL OR ba.velocity_tier = p_velocity_tier)
      AND (p_min_active_pct IS NULL OR ba.active_player_pct >= p_min_active_pct)
      AND (p_min_review_rate IS NULL OR ba.review_rate >= p_min_review_rate)
      AND (p_min_value_score IS NULL OR ba.value_score >= p_min_value_score)
      AND (p_min_vs_publisher IS NULL OR ba.vs_publisher_avg >= p_min_vs_publisher)
      -- Content filters (array operators)
      AND (p_genres IS NULL
        OR (p_genre_mode = 'any' AND ba.genre_ids && p_genres)
        OR (p_genre_mode = 'all' AND ba.genre_ids @> p_genres)
      )
      AND (p_tags IS NULL
        OR (p_tag_mode = 'any' AND ba.tag_ids && p_tags)
        OR (p_tag_mode = 'all' AND ba.tag_ids @> p_tags)
      )
      AND (p_categories IS NULL OR ba.category_ids && p_categories)
      AND (p_has_workshop IS NULL
        OR (p_has_workshop = TRUE AND ba.afd_has_workshop = TRUE)
        OR (p_has_workshop = FALSE AND (ba.afd_has_workshop = FALSE OR ba.afd_has_workshop IS NULL))
      )
      -- Platform filters
      AND (p_platforms IS NULL
        OR (p_platform_mode = 'any' AND ba.platform_array && p_platforms)
        OR (p_platform_mode = 'all' AND ba.platform_array @> p_platforms)
      )
      AND (p_steam_deck IS NULL
        OR (p_steam_deck = 'verified' AND ba.steam_deck_category = 'verified')
        OR (p_steam_deck = 'playable' AND ba.steam_deck_category IN ('verified', 'playable'))
        OR (p_steam_deck = 'any' AND ba.steam_deck_category IS NOT NULL)
      )
      AND (p_controller IS NULL
        OR (p_controller = 'full' AND ba.controller_support = 'full')
        OR (p_controller = 'partial' AND ba.controller_support IN ('full', 'partial'))
        OR (p_controller = 'any' AND ba.controller_support IS NOT NULL)
      )
      -- Release filters
      AND (p_min_age IS NULL OR ba.days_live >= p_min_age)
      AND (p_max_age IS NULL OR ba.days_live <= p_max_age)
      AND (p_release_year IS NULL OR EXTRACT(YEAR FROM ba.release_date) = p_release_year)
      AND (p_early_access IS NULL
        OR (p_early_access = TRUE AND ba.release_state = 'prerelease')
        OR (p_early_access = FALSE AND ba.release_state != 'prerelease')
      )
      AND (p_min_hype IS NULL OR ba.hype_duration >= p_min_hype)
      AND (p_max_hype IS NULL OR ba.hype_duration <= p_max_hype)
      -- Relationship filters
      AND (p_publisher_search IS NULL OR ba.publisher_name ILIKE '%' || p_publisher_search || '%')
      AND (p_developer_search IS NULL OR ba.developer_name ILIKE '%' || p_developer_search || '%')
      -- Bug #4 fix: selfPublished=false now works correctly
      AND (p_self_published IS NULL
        OR (p_self_published = TRUE AND LOWER(TRIM(ba.publisher_name)) = LOWER(TRIM(ba.developer_name)))
        OR (p_self_published = FALSE AND (
            ba.publisher_name IS NULL
            OR ba.developer_name IS NULL
            OR LOWER(TRIM(ba.publisher_name)) <> LOWER(TRIM(ba.developer_name))
        ))
      )
      AND (p_publisher_size IS NULL
        OR (p_publisher_size = 'indie' AND ba.publisher_game_count < 5)
        OR (p_publisher_size = 'mid' AND ba.publisher_game_count >= 5 AND ba.publisher_game_count < 20)
        OR (p_publisher_size = 'major' AND ba.publisher_game_count >= 20)
      )
      -- Activity filters
      AND (p_ccu_tier IS NULL OR ba.ccu_tier = p_ccu_tier)
  ),
  sorted AS (
    SELECT f.*
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort_order = 'desc' THEN
        CASE p_sort_field
          WHEN 'ccu_peak' THEN f.ccu_peak
          WHEN 'owners_midpoint' THEN f.owners_midpoint
          WHEN 'total_reviews' THEN f.total_reviews
          WHEN 'review_score' THEN f.review_score
          WHEN 'price_cents' THEN f.price_cents
          WHEN 'ccu_growth_7d_percent' THEN f.ccu_growth_7d_percent
          WHEN 'ccu_growth_30d_percent' THEN f.ccu_growth_30d_percent
          WHEN 'momentum_score' THEN f.momentum_score
          WHEN 'sentiment_delta' THEN f.sentiment_delta
          WHEN 'velocity_7d' THEN f.velocity_7d
          WHEN 'active_player_pct' THEN f.active_player_pct
          WHEN 'review_rate' THEN f.review_rate
          WHEN 'value_score' THEN f.value_score
          WHEN 'vs_publisher_avg' THEN f.vs_publisher_avg
          WHEN 'days_live' THEN f.days_live
          ELSE f.ccu_peak
        END
      END DESC NULLS LAST,
      CASE WHEN p_sort_order = 'asc' THEN
        CASE p_sort_field
          WHEN 'ccu_peak' THEN f.ccu_peak
          WHEN 'owners_midpoint' THEN f.owners_midpoint
          WHEN 'total_reviews' THEN f.total_reviews
          WHEN 'review_score' THEN f.review_score
          WHEN 'price_cents' THEN f.price_cents
          WHEN 'ccu_growth_7d_percent' THEN f.ccu_growth_7d_percent
          WHEN 'ccu_growth_30d_percent' THEN f.ccu_growth_30d_percent
          WHEN 'momentum_score' THEN f.momentum_score
          WHEN 'sentiment_delta' THEN f.sentiment_delta
          WHEN 'velocity_7d' THEN f.velocity_7d
          WHEN 'active_player_pct' THEN f.active_player_pct
          WHEN 'review_rate' THEN f.review_rate
          WHEN 'value_score' THEN f.value_score
          WHEN 'vs_publisher_avg' THEN f.vs_publisher_avg
          WHEN 'days_live' THEN f.days_live
          ELSE f.ccu_peak
        END
      END ASC NULLS LAST,
      -- Secondary sort for release_date
      CASE WHEN p_sort_field = 'release_date' AND p_sort_order = 'desc' THEN f.release_date END DESC NULLS LAST,
      CASE WHEN p_sort_field = 'release_date' AND p_sort_order = 'asc' THEN f.release_date END ASC NULLS LAST,
      -- Tertiary sort by name
      f.name ASC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    s.appid,
    s.name,
    s.type,
    s.is_free,
    s.ccu_peak,
    s.owners_min,
    s.owners_max,
    s.owners_midpoint,
    s.total_reviews,
    s.positive_reviews,
    s.review_score,
    s.positive_percentage,
    s.price_cents,
    s.current_discount_percent,
    s.average_playtime_forever,
    s.average_playtime_2weeks,
    s.ccu_growth_7d_percent,
    s.ccu_growth_30d_percent,
    s.ccu_tier,
    s.velocity_7d,
    s.velocity_30d,
    s.velocity_tier,
    s.sentiment_delta,
    s.momentum_score,
    s.velocity_acceleration,
    s.active_player_pct,
    s.review_rate,
    s.value_score,
    s.vs_publisher_avg,
    s.release_date,
    s.days_live,
    s.hype_duration,
    s.release_state,
    s.platforms,
    s.steam_deck_category,
    s.controller_support,
    s.publisher_id,
    s.publisher_name,
    s.publisher_game_count,
    s.developer_id,
    s.developer_name,
    s.metric_date,
    s.data_updated_at
  FROM sorted s;
END;
$$;


--
-- Name: get_catalog_control_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_catalog_control_stats() RETURNS TABLE(current_catalog_apps bigint, historical_retained_apps bigint, latest_live_app_count bigint, live_only_missing bigint, stale_running_applist_jobs bigint, latest_applist_started_at timestamp with time zone, latest_applist_completed_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH latest_successful_applist AS (
    SELECT
      j.started_at,
      j.completed_at,
      COALESCE(j.items_processed, 0)::BIGINT AS live_app_count
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'completed'
      AND COALESCE(j.items_failed, 0) = 0
    ORDER BY j.started_at DESC
    LIMIT 1
  )
  SELECT
    cc.current_catalog_count,
    GREATEST(dbx.db_app_count - cc.current_catalog_count, 0),
    COALESCE(latest_successful_applist.live_app_count, cc.current_catalog_count),
    GREATEST(
      COALESCE(latest_successful_applist.live_app_count, cc.current_catalog_count) - cc.current_catalog_count,
      0
    ),
    sj.stale_running_count,
    latest_successful_applist.started_at,
    latest_successful_applist.completed_at
  FROM (
    SELECT COUNT(*)::BIGINT AS current_catalog_count
    FROM public.get_current_catalog_appids()
  ) AS cc
  CROSS JOIN (
    SELECT COUNT(*)::BIGINT AS db_app_count
    FROM public.apps
  ) AS dbx
  CROSS JOIN (
    SELECT COUNT(*)::BIGINT AS stale_running_count
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'running'
      AND j.started_at < NOW() - INTERVAL '1 hour'
  ) AS sj
  LEFT JOIN latest_successful_applist ON TRUE;
$$;


--
-- Name: FUNCTION get_catalog_control_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_catalog_control_stats() IS 'Returns current-vs-historical catalog counts and applist control-plane health derived from the latest successful applist snapshot.';


--
-- Name: get_ccu_quality_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ccu_quality_stats() RETURNS TABLE(current_catalog_apps bigint, tier_assigned bigint, no_tier_assignment bigint, confirmed_positive bigint, confirmed_zero bigint, suspect_zero bigint, skipped bigint, invalid bigint, unavailable bigint, steam_api bigint, steamspy bigint, legacy_unknown bigint, updated_at timestamp with time zone, data_source text, is_approximate boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  cached_data RECORD;
BEGIN
  SELECT
    d.ccu_current_catalog_apps,
    d.ccu_tier_assigned,
    d.ccu_no_tier_assignment,
    d.ccu_confirmed_positive,
    d.ccu_confirmed_zero,
    d.ccu_suspect_zero,
    d.ccu_skipped,
    d.ccu_invalid,
    d.ccu_unavailable,
    d.ccu_steam_api,
    d.ccu_steamspy,
    d.ccu_legacy_unknown,
    d.ccu_quality_updated_at
  INTO cached_data
  FROM public.dashboard_stats_cache d
  WHERE d.id = 'main';

  IF cached_data IS NOT NULL
     AND cached_data.ccu_quality_updated_at IS NOT NULL
     AND COALESCE(cached_data.ccu_current_catalog_apps, 0) > 0 THEN
    RETURN QUERY
    SELECT
      COALESCE(cached_data.ccu_current_catalog_apps, 0)::BIGINT,
      COALESCE(cached_data.ccu_tier_assigned, 0)::BIGINT,
      COALESCE(cached_data.ccu_no_tier_assignment, 0)::BIGINT,
      COALESCE(cached_data.ccu_confirmed_positive, 0)::BIGINT,
      COALESCE(cached_data.ccu_confirmed_zero, 0)::BIGINT,
      COALESCE(cached_data.ccu_suspect_zero, 0)::BIGINT,
      COALESCE(cached_data.ccu_skipped, 0)::BIGINT,
      COALESCE(cached_data.ccu_invalid, 0)::BIGINT,
      COALESCE(cached_data.ccu_unavailable, 0)::BIGINT,
      COALESCE(cached_data.ccu_steam_api, 0)::BIGINT,
      COALESCE(cached_data.ccu_steamspy, 0)::BIGINT,
      COALESCE(cached_data.ccu_legacy_unknown, 0)::BIGINT,
      cached_data.ccu_quality_updated_at,
      'cache'::TEXT,
      FALSE;
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest_successful_applist AS (
    SELECT j.started_at
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'completed'
      AND COALESCE(j.items_failed, 0) = 0
    ORDER BY j.started_at DESC
    LIMIT 1
  ),
  catalog_ready AS (
    SELECT EXISTS(
      SELECT 1
      FROM public.apps a
      JOIN latest_successful_applist l
        ON a.last_seen_in_steam_applist_at = l.started_at
    ) AS ready
  ),
  catalog_appids AS MATERIALIZED (
    SELECT a.appid
    FROM public.apps a
    JOIN latest_successful_applist l
      ON a.last_seen_in_steam_applist_at = l.started_at
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = TRUE

    UNION ALL

    SELECT s.appid
    FROM public.sync_status s
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = FALSE
      AND s.is_syncable = TRUE
  ),
  ccu_rows AS MATERIALIZED (
    SELECT
      c.appid,
      (ct.appid IS NOT NULL) AS has_tier_assignment,
      ct.last_ccu_validation_state,
      ct.ccu_fetch_status,
      ct.ccu_skip_until,
      ldm.ccu_peak,
      ldm.ccu_source
    FROM catalog_appids c
    LEFT JOIN public.ccu_tier_assignments ct
      ON ct.appid = c.appid
    LEFT JOIN public.latest_daily_metrics ldm
      ON ldm.appid = c.appid
  ),
  resolved_rows AS MATERIALIZED (
    SELECT
      appid,
      has_tier_assignment,
      CASE
        WHEN last_ccu_validation_state = 'confirmed_positive' THEN 'confirmed_positive'
        WHEN last_ccu_validation_state = 'confirmed_zero' THEN 'confirmed_zero'
        WHEN last_ccu_validation_state = 'suspect_zero' THEN 'suspect_zero'
        WHEN ccu_fetch_status = 'invalid' AND ccu_skip_until > NOW() THEN 'skipped'
        WHEN ccu_fetch_status = 'invalid' THEN 'invalid'
        ELSE 'unavailable'
      END::TEXT AS ccu_confidence_state,
      ccu_peak,
      ccu_source
    FROM ccu_rows
  ),
  aggregated AS (
    SELECT
      COUNT(*)::BIGINT AS current_catalog_apps,
      COUNT(*) FILTER (WHERE has_tier_assignment)::BIGINT AS tier_assigned,
      COUNT(*) FILTER (WHERE NOT has_tier_assignment)::BIGINT AS no_tier_assignment,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_positive')::BIGINT AS confirmed_positive,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_zero')::BIGINT AS confirmed_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'suspect_zero')::BIGINT AS suspect_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'skipped')::BIGINT AS skipped,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'invalid')::BIGINT AS invalid,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'unavailable')::BIGINT AS unavailable,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steam_api')::BIGINT AS steam_api,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steamspy')::BIGINT AS steamspy,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source IS NULL)::BIGINT AS legacy_unknown
    FROM resolved_rows
  )
  SELECT
    aggregated.current_catalog_apps,
    aggregated.tier_assigned,
    aggregated.no_tier_assignment,
    aggregated.confirmed_positive,
    aggregated.confirmed_zero,
    aggregated.suspect_zero,
    aggregated.skipped,
    aggregated.invalid,
    aggregated.unavailable,
    aggregated.steam_api,
    aggregated.steamspy,
    aggregated.legacy_unknown,
    NOW() AS updated_at,
    'live'::TEXT AS data_source,
    FALSE AS is_approximate
  FROM aggregated;
END;
$$;


--
-- Name: FUNCTION get_ccu_quality_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_ccu_quality_stats() IS 'Returns current-catalog CCU quality counts from dashboard_stats_cache when available, otherwise computes them live using a single-pass aggregate.';


--
-- Name: get_change_feed_activity(integer, text, text, text[], text, text[], text, double precision, timestamp with time zone, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_change_feed_activity(p_days integer DEFAULT 7, p_view text DEFAULT 'overview'::text, p_mode text DEFAULT 'all'::text, p_app_types text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_signal_families text[] DEFAULT NULL::text[], p_sort text DEFAULT 'relevant'::text, p_cursor_score double precision DEFAULT NULL::double precision, p_cursor_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_activity_id text DEFAULT NULL::text, p_limit integer DEFAULT 50) RETURNS TABLE(activity_id text, activity_kind text, story_kind text, appid integer, app_name text, app_type text, is_released boolean, release_date date, occurred_at timestamp with time zone, headline text, summary text, facts text[], highlight_labels text[], signal_families text[], has_before_after boolean, related_announcement_count integer, external_url text, sort_score double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 7), 1) AS days,
      COALESCE(p_view, 'overview') AS requested_view,
      COALESCE(p_mode, 'all') AS requested_mode,
      COALESCE(p_sort, 'relevant') AS requested_sort,
      p_app_types AS requested_app_types,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      CASE
        WHEN p_signal_families IS NULL OR CARDINALITY(p_signal_families) = 0 THEN NULL::TEXT[]
        ELSE p_signal_families
      END AS requested_signal_families
  ),
  request_filters AS (
    SELECT
      rc.*,
      CASE
        WHEN rc.requested_signal_families IS NULL THEN
          CASE rc.requested_view
            WHEN 'commercial-moves' THEN ARRAY['pricing']::TEXT[]
            WHEN 'store-refreshes' THEN ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[]
            ELSE NULL::TEXT[]
          END
        ELSE ARRAY(
          SELECT DISTINCT family
          FROM unnest(rc.requested_signal_families) AS family
          WHERE family <> 'announcement'
            AND (
              rc.requested_view <> 'commercial-moves'
              OR family = 'pricing'
            )
            AND (
              rc.requested_view <> 'store-refreshes'
              OR family = ANY (ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[])
            )
          ORDER BY 1
        )
      END AS requested_change_families
    FROM request_config rc
  ),
  request_flags AS (
    SELECT
      rf.*,
      CASE
        WHEN rf.requested_mode NOT IN ('all', 'changes') THEN FALSE
        WHEN rf.requested_signal_families IS NOT NULL
          AND COALESCE(CARDINALITY(rf.requested_change_families), 0) = 0 THEN FALSE
        ELSE TRUE
      END AS allow_change_rows,
      CASE
        WHEN rf.requested_mode NOT IN ('all', 'announcements') THEN FALSE
        WHEN rf.requested_view NOT IN ('overview', 'all-activity') THEN FALSE
        WHEN rf.requested_signal_families IS NOT NULL
          AND NOT ('announcement' = ANY (rf.requested_signal_families)) THEN FALSE
        ELSE TRUE
      END AS allow_announcement_rows
    FROM request_filters rf
  ),
  classified_change_events AS (
    SELECT
      e.appid,
      a.name AS app_name,
      a.type::TEXT AS app_type,
      a.is_released,
      a.release_date,
      e.change_type::TEXT AS change_type,
      e.occurred_at,
      CASE
        WHEN e.change_type::TEXT = 'release_date_text_change' THEN 'release'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'price_change',
            'discount_start',
            'discount_end',
            'dlc_references_changed',
            'package_references_changed'
          ]::TEXT[]
        ) THEN 'pricing'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'description_rewrite',
            'short_description_rewrite'
          ]::TEXT[]
        ) THEN 'store-page'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'capsule_url_changed',
            'header_url_changed',
            'background_url_changed',
            'screenshot_added',
            'screenshot_removed',
            'screenshot_reordered',
            'trailer_added',
            'trailer_removed',
            'trailer_reordered',
            'trailer_thumbnail_changed'
          ]::TEXT[]
        ) THEN 'media'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'tags_added',
            'tags_removed',
            'genres_changed',
            'categories_changed',
            'publisher_association_changed',
            'developer_association_changed'
          ]::TEXT[]
        ) THEN 'taxonomy'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'languages_changed',
            'platforms_changed',
            'controller_support_changed',
            'steam_deck_status_changed'
          ]::TEXT[]
        ) THEN 'platform'
        WHEN e.change_type::TEXT = ANY (
          ARRAY[
            'build_id_changed',
            'last_content_update_changed'
          ]::TEXT[]
        ) THEN 'build'
        ELSE 'store-page'
      END AS signal_family,
      CASE e.change_type::TEXT
        WHEN 'description_rewrite' THEN 'Store description'
        WHEN 'short_description_rewrite' THEN 'Short description'
        WHEN 'release_date_text_change' THEN 'Release timing'
        WHEN 'price_change' THEN 'Price'
        WHEN 'discount_start' THEN 'Discount'
        WHEN 'discount_end' THEN 'Discount'
        WHEN 'tags_added' THEN 'Tags'
        WHEN 'tags_removed' THEN 'Tags'
        WHEN 'genres_changed' THEN 'Genres'
        WHEN 'categories_changed' THEN 'Categories'
        WHEN 'languages_changed' THEN 'Languages'
        WHEN 'platforms_changed' THEN 'Platforms'
        WHEN 'controller_support_changed' THEN 'Controller support'
        WHEN 'steam_deck_status_changed' THEN 'Steam Deck'
        WHEN 'publisher_association_changed' THEN 'Publisher'
        WHEN 'developer_association_changed' THEN 'Developer'
        WHEN 'dlc_references_changed' THEN 'DLC'
        WHEN 'package_references_changed' THEN 'Packages'
        WHEN 'build_id_changed' THEN 'Build'
        WHEN 'last_content_update_changed' THEN 'Content update'
        WHEN 'capsule_url_changed' THEN 'Capsule art'
        WHEN 'header_url_changed' THEN 'Header art'
        WHEN 'background_url_changed' THEN 'Background art'
        WHEN 'screenshot_added' THEN 'Screenshots'
        WHEN 'screenshot_removed' THEN 'Screenshots'
        WHEN 'screenshot_reordered' THEN 'Screenshots'
        WHEN 'trailer_added' THEN 'Trailer'
        WHEN 'trailer_removed' THEN 'Trailer'
        WHEN 'trailer_reordered' THEN 'Trailer'
        WHEN 'trailer_thumbnail_changed' THEN 'Trailer art'
        ELSE INITCAP(REPLACE(e.change_type::TEXT, '_', ' '))
      END AS highlight_label
    FROM app_change_events e
    JOIN apps a ON a.appid = e.appid
    CROSS JOIN request_flags rf
    WHERE rf.allow_change_rows
      AND e.source IN ('storefront', 'pics', 'media')
      AND e.occurred_at >= NOW() - make_interval(days => rf.days)
      AND (
        rf.requested_app_types IS NULL
        OR a.type::TEXT = ANY (rf.requested_app_types)
      )
      AND (
        rf.requested_search IS NULL
        OR a.name ILIKE '%' || rf.requested_search || '%'
      )
      AND (
        rf.requested_view <> 'launch-watch'
        OR a.is_released = FALSE
        OR (a.release_date IS NOT NULL AND a.release_date >= CURRENT_DATE - 30)
        OR e.change_type::TEXT = 'release_date_text_change'
      )
  ),
  filtered_change_events AS (
    SELECT cce.*
    FROM classified_change_events cce
    CROSS JOIN request_flags rf
    WHERE (
      rf.requested_change_families IS NULL
      OR cce.signal_family = ANY (rf.requested_change_families)
    )
  ),
  sequenced_changes AS (
    SELECT
      fce.*,
      CASE
        WHEN LAG(fce.occurred_at) OVER app_window IS NULL THEN 1
        WHEN fce.occurred_at - LAG(fce.occurred_at) OVER app_window > INTERVAL '90 minutes' THEN 1
        ELSE 0
      END AS starts_new_burst
    FROM filtered_change_events fce
    WINDOW app_window AS (PARTITION BY fce.appid ORDER BY fce.occurred_at)
  ),
  burst_members AS (
    SELECT
      sc.*,
      SUM(sc.starts_new_burst) OVER (
        PARTITION BY sc.appid
        ORDER BY sc.occurred_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS burst_number
    FROM sequenced_changes sc
  ),
  change_core AS (
    SELECT
      bm.appid,
      bm.app_name,
      bm.app_type,
      bm.is_released,
      bm.release_date,
      bm.burst_number,
      MIN(bm.occurred_at) AS burst_started_at,
      MAX(bm.occurred_at) AS occurred_at,
      COUNT(*)::INTEGER AS event_count,
      COUNT(DISTINCT bm.change_type)::INTEGER AS change_type_count,
      ARRAY_AGG(DISTINCT bm.change_type ORDER BY bm.change_type) AS change_types,
      ARRAY_AGG(DISTINCT bm.highlight_label ORDER BY bm.highlight_label)
        FILTER (WHERE bm.highlight_label IS NOT NULL) AS highlight_labels_raw,
      ARRAY_AGG(DISTINCT bm.signal_family)
        FILTER (WHERE bm.signal_family IS NOT NULL) AS signal_family_set
    FROM burst_members bm
    GROUP BY
      bm.appid,
      bm.app_name,
      bm.app_type,
      bm.is_released,
      bm.release_date,
      bm.burst_number
  ),
  change_enriched AS (
    SELECT
      'change:' ||
        FORMAT(
          '%s:%s:%s',
          cc.appid,
          TO_CHAR(cc.burst_started_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"'),
          TO_CHAR(cc.occurred_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS.MS"Z"')
        ) AS activity_id,
      'change'::TEXT AS activity_kind,
      cc.appid,
      cc.app_name,
      cc.app_type,
      cc.is_released,
      cc.release_date,
      cc.burst_started_at,
      cc.occurred_at,
      cc.event_count,
      cc.change_type_count,
      cc.change_types,
      COALESCE(
        ARRAY(
          SELECT family
          FROM unnest(
            ARRAY['release', 'pricing', 'store-page', 'media', 'taxonomy', 'platform', 'build']::TEXT[]
          ) AS family
          WHERE family = ANY (COALESCE(cc.signal_family_set, ARRAY[]::TEXT[]))
        ),
        ARRAY[]::TEXT[]
      ) AS signal_families,
      COALESCE(cc.highlight_labels_raw[1:4], ARRAY[]::TEXT[]) AS highlight_labels
    FROM change_core cc
  ),
  change_activity AS (
    SELECT
      ce.activity_id,
      ce.activity_kind,
      CASE
        WHEN ce.signal_families && ARRAY['release']::TEXT[]
          OR ce.is_released = FALSE
          OR (ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30)
          THEN 'release-prep'
        WHEN ce.signal_families && ARRAY['pricing']::TEXT[]
          THEN 'commercial-move'
        WHEN ce.signal_families && ARRAY['store-page', 'media']::TEXT[]
          THEN 'store-refresh'
        WHEN ce.signal_families && ARRAY['taxonomy']::TEXT[]
          THEN 'positioning-shift'
        WHEN ce.signal_families && ARRAY['platform']::TEXT[]
          THEN 'platform-expansion'
        WHEN ce.signal_families && ARRAY['build']::TEXT[]
          THEN 'build-activity'
        ELSE 'general-update'
      END AS story_kind,
      ce.appid,
      ce.app_name,
      ce.app_type,
      ce.is_released,
      ce.release_date,
      ce.occurred_at,
      CASE
        WHEN ce.change_types && ARRAY['release_date_text_change']::TEXT[]
          THEN 'Locked in more precise release timing'
        WHEN ce.signal_families && ARRAY['pricing']::TEXT[]
          THEN 'Adjusted pricing, packages, or monetization setup'
        WHEN ce.signal_families && ARRAY['store-page', 'media']::TEXT[]
          THEN 'Refreshed store presentation and merchandising'
        WHEN ce.signal_families && ARRAY['taxonomy']::TEXT[]
          THEN 'Shifted tags, genres, or positioning signals'
        WHEN ce.signal_families && ARRAY['platform']::TEXT[]
          THEN 'Expanded platform, language, or audience reach'
        WHEN ce.signal_families && ARRAY['build']::TEXT[]
          THEN 'Shipped a new build or content update'
        WHEN ce.change_type_count > 1
          THEN 'Multiple Steam changes landed together'
        ELSE 'Single Steam change detected'
      END AS headline,
      CASE
        WHEN ce.signal_families && ARRAY['build']::TEXT[]
          AND NOT (
            ce.signal_families && ARRAY['pricing', 'store-page', 'media', 'taxonomy', 'platform', 'release']::TEXT[]
          )
          THEN 'Grouped technical updates into one readable activity card.'
        ELSE 'Grouped recent Steam changes into one readable activity card.'
      END AS summary,
      ARRAY_REMOVE(
        ARRAY[
          CASE WHEN ce.is_released = FALSE THEN 'Upcoming title' END,
          CASE
            WHEN ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30
              THEN 'Released in the last 30 days'
          END,
          ce.event_count::TEXT || ' grouped updates',
          ce.change_type_count::TEXT || ' change types'
        ],
        NULL
      ) AS facts,
      ce.highlight_labels,
      ce.signal_families,
      TRUE AS has_before_after,
      0::INTEGER AS related_announcement_count,
      NULL::TEXT AS external_url,
      (
        CASE
          WHEN ce.signal_families && ARRAY['release']::TEXT[]
            OR ce.is_released = FALSE
            OR (ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30)
            THEN 42
          WHEN ce.signal_families && ARRAY['pricing']::TEXT[] THEN 38
          WHEN ce.signal_families && ARRAY['store-page', 'media']::TEXT[] THEN 32
          WHEN ce.signal_families && ARRAY['taxonomy']::TEXT[] THEN 30
          WHEN ce.signal_families && ARRAY['platform']::TEXT[] THEN 28
          WHEN ce.signal_families && ARRAY['build']::TEXT[] THEN 14
          ELSE 20
        END
        + ce.event_count * 6
        + ce.change_type_count * 4
      )::DOUBLE PRECISION AS relevance_score,
      (
        ce.event_count * 6
        + ce.change_type_count * 8
        + COALESCE(CARDINALITY(ce.highlight_labels), 0) * 4
      )::DOUBLE PRECISION AS magnitude_score,
      (
        CASE WHEN ce.signal_families && ARRAY['pricing']::TEXT[] THEN 80 ELSE 0 END
        + ce.event_count * 6
        + ce.change_type_count * 4
      )::DOUBLE PRECISION AS commercial_score,
      (
        CASE
          WHEN ce.signal_families && ARRAY['release']::TEXT[]
            OR ce.is_released = FALSE
            OR (ce.release_date IS NOT NULL AND ce.release_date >= CURRENT_DATE - 30)
            THEN 90
          ELSE 0
        END
        + ce.event_count * 4
      )::DOUBLE PRECISION AS launch_score
    FROM change_enriched ce
  ),
  recent_news AS (
    SELECT
      n.gid,
      n.appid,
      n.app_name,
      n.app_type,
      n.published_at,
      n.first_seen_at,
      n.title,
      n.feedlabel,
      n.feedname,
      n.url,
      COALESCE(n.published_at, n.first_seen_at) AS occurred_at
    FROM request_flags rf
    CROSS JOIN LATERAL get_change_feed_news(
      rf.days,
      rf.requested_app_types,
      rf.requested_search,
      NULL,
      NULL,
      LEAST(GREATEST(COALESCE(p_limit, 50), 50) * 10, 500)
    ) AS n
    WHERE rf.allow_announcement_rows
  ),
  announcement_activity AS (
    SELECT
      'announcement:' || rn.gid AS activity_id,
      'announcement'::TEXT AS activity_kind,
      'announcement'::TEXT AS story_kind,
      rn.appid,
      rn.app_name,
      rn.app_type,
      a.is_released,
      a.release_date,
      rn.occurred_at,
      COALESCE(rn.title, 'New Steam announcement published') AS headline,
      CASE
        WHEN rn.feedlabel IS NOT NULL AND rn.feedname IS NOT NULL
          THEN rn.app_name || ' published a Steam announcement in ' || rn.feedlabel || ' / ' || rn.feedname || '.'
        WHEN rn.feedlabel IS NOT NULL
          THEN rn.app_name || ' published a Steam announcement in ' || rn.feedlabel || '.'
        WHEN rn.feedname IS NOT NULL
          THEN rn.app_name || ' published a Steam announcement in ' || rn.feedname || '.'
        ELSE rn.app_name || ' published a new Steam announcement.'
      END AS summary,
      ARRAY_REMOVE(ARRAY[rn.feedlabel, rn.feedname], NULL) AS facts,
      ARRAY_REMOVE(ARRAY[rn.feedlabel, rn.feedname], NULL) AS highlight_labels,
      ARRAY['announcement']::TEXT[] AS signal_families,
      FALSE AS has_before_after,
      0::INTEGER AS related_announcement_count,
      rn.url AS external_url,
      16::DOUBLE PRECISION AS relevance_score,
      8::DOUBLE PRECISION AS magnitude_score,
      6::DOUBLE PRECISION AS commercial_score,
      CASE
        WHEN a.is_released = FALSE OR (a.release_date IS NOT NULL AND a.release_date >= CURRENT_DATE - 30)
          THEN 24::DOUBLE PRECISION
        ELSE 6::DOUBLE PRECISION
      END AS launch_score
    FROM recent_news rn
    JOIN apps a ON a.appid = rn.appid
    CROSS JOIN request_flags rf
    WHERE
      (
        rf.requested_view <> 'launch-watch'
        OR a.is_released = FALSE
        OR (a.release_date IS NOT NULL AND a.release_date >= CURRENT_DATE - 30)
      )
  ),
  combined AS (
    SELECT
      ca.activity_id,
      ca.activity_kind,
      ca.story_kind,
      ca.appid,
      ca.app_name,
      ca.app_type,
      ca.is_released,
      ca.release_date,
      ca.occurred_at,
      ca.headline,
      ca.summary,
      ca.facts,
      ca.highlight_labels,
      ca.signal_families,
      ca.has_before_after,
      ca.related_announcement_count,
      ca.external_url,
      CASE COALESCE(rf.requested_sort, 'relevant')
        WHEN 'newest' THEN EXTRACT(EPOCH FROM ca.occurred_at)
        WHEN 'biggest-change' THEN ca.magnitude_score
        WHEN 'most-commercial' THEN ca.commercial_score
        WHEN 'most-launch-relevant' THEN ca.launch_score
        ELSE ca.relevance_score
      END AS sort_score
    FROM change_activity ca
    CROSS JOIN request_flags rf

    UNION ALL

    SELECT
      aa.activity_id,
      aa.activity_kind,
      aa.story_kind,
      aa.appid,
      aa.app_name,
      aa.app_type,
      aa.is_released,
      aa.release_date,
      aa.occurred_at,
      aa.headline,
      aa.summary,
      aa.facts,
      aa.highlight_labels,
      aa.signal_families,
      aa.has_before_after,
      aa.related_announcement_count,
      aa.external_url,
      CASE COALESCE(rf.requested_sort, 'relevant')
        WHEN 'newest' THEN EXTRACT(EPOCH FROM aa.occurred_at)
        WHEN 'biggest-change' THEN aa.magnitude_score
        WHEN 'most-commercial' THEN aa.commercial_score
        WHEN 'most-launch-relevant' THEN aa.launch_score
        ELSE aa.relevance_score
      END AS sort_score
    FROM announcement_activity aa
    CROSS JOIN request_flags rf
  ),
  view_filtered AS (
    SELECT c.*
    FROM combined c
    CROSS JOIN request_flags rf
    WHERE (
      rf.requested_signal_families IS NULL
      OR c.signal_families && rf.requested_signal_families
    )
      AND CASE rf.requested_view
        WHEN 'launch-watch' THEN
          c.story_kind = 'release-prep'
          OR c.is_released = FALSE
          OR (c.release_date IS NOT NULL AND c.release_date >= CURRENT_DATE - 30)
        WHEN 'commercial-moves' THEN
          c.story_kind = 'commercial-move'
          OR c.signal_families && ARRAY['pricing']::TEXT[]
        WHEN 'store-refreshes' THEN
          c.story_kind IN ('store-refresh', 'positioning-shift', 'platform-expansion')
          OR c.signal_families && ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[]
        ELSE TRUE
      END
  )
  SELECT
    vf.activity_id,
    vf.activity_kind,
    vf.story_kind,
    vf.appid,
    vf.app_name,
    vf.app_type,
    vf.is_released,
    vf.release_date,
    vf.occurred_at,
    vf.headline,
    vf.summary,
    vf.facts,
    vf.highlight_labels,
    vf.signal_families,
    vf.has_before_after,
    vf.related_announcement_count,
    vf.external_url,
    vf.sort_score
  FROM view_filtered vf
  WHERE (
    p_cursor_score IS NULL
    OR p_cursor_time IS NULL
    OR p_cursor_activity_id IS NULL
    OR (vf.sort_score, vf.occurred_at, vf.activity_id) < (p_cursor_score, p_cursor_time, p_cursor_activity_id)
  )
  ORDER BY vf.sort_score DESC, vf.occurred_at DESC, vf.activity_id DESC
  LIMIT LEAST(COALESCE(p_limit, 50), 100);
$$;


--
-- Name: FUNCTION get_change_feed_activity(p_days integer, p_view text, p_mode text, p_app_types text[], p_search text, p_signal_families text[], p_sort text, p_cursor_score double precision, p_cursor_time timestamp with time zone, p_cursor_activity_id text, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_change_feed_activity(p_days integer, p_view text, p_mode text, p_app_types text[], p_search text, p_signal_families text[], p_sort text, p_cursor_score double precision, p_cursor_time timestamp with time zone, p_cursor_activity_id text, p_limit integer) IS 'Returns a unified activity-card stream for /changes, applying request filters before burst/news work for low-latency activity reads.';


--
-- Name: get_change_feed_burst_detail(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_change_feed_burst_detail(p_burst_id text) RETURNS TABLE(burst_id text, appid integer, app_name text, app_type text, is_released boolean, release_date date, burst_started_at timestamp with time zone, burst_ended_at timestamp with time zone, effective_at timestamp with time zone, event_count integer, source_set text[], headline_change_types text[], change_type_count integer, has_related_news boolean, related_news_count integer, events jsonb, related_news jsonb, impact jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH parsed AS (
    SELECT
      split_part(p_burst_id, ':', 1)::INTEGER AS appid,
      to_timestamp(split_part(p_burst_id, ':', 2), 'YYYYMMDD"T"HH24MISS.MS"Z"') AS burst_started_at,
      to_timestamp(split_part(p_burst_id, ':', 3), 'YYYYMMDD"T"HH24MISS.MS"Z"') AS burst_ended_at
  ),
  burst_events AS (
    SELECT
      e.id,
      e.appid,
      e.source,
      e.change_type,
      e.occurred_at,
      e.before_value,
      e.after_value,
      e.context,
      e.source_snapshot_id,
      e.related_snapshot_id,
      e.media_version_id,
      e.news_item_gid
    FROM app_change_events e
    JOIN parsed p ON p.appid = e.appid
    WHERE e.source IN ('storefront', 'pics', 'media')
      AND e.occurred_at >= p.burst_started_at
      AND e.occurred_at <= p.burst_ended_at
    ORDER BY e.occurred_at ASC, e.id ASC
  ),
  related_news_rows AS (
    SELECT
      n.gid,
      n.url,
      n.author,
      n.feedlabel,
      n.feedname,
      n.published_at,
      n.first_seen_at,
      lnv.title,
      lnv.contents,
      lnv.normalized_payload
    FROM steam_news_items n
    JOIN parsed p ON p.appid = n.appid
    LEFT JOIN LATERAL (
      SELECT
        v.title,
        v.contents,
        v.url,
        v.normalized_payload
      FROM steam_news_versions v
      WHERE v.gid = n.gid
      ORDER BY v.first_seen_at DESC
      LIMIT 1
    ) lnv ON TRUE
    WHERE COALESCE(n.published_at, n.first_seen_at) >= p.burst_started_at - INTERVAL '24 hours'
      AND COALESCE(n.published_at, n.first_seen_at) <= p.burst_ended_at + INTERVAL '24 hours'
    ORDER BY COALESCE(n.published_at, n.first_seen_at) DESC, n.gid DESC
  )
  SELECT
    p_burst_id AS burst_id,
    a.appid,
    a.name AS app_name,
    a.type::TEXT AS app_type,
    a.is_released,
    a.release_date,
    p.burst_started_at,
    p.burst_ended_at,
    p.burst_ended_at AS effective_at,
    COUNT(be.id)::INTEGER AS event_count,
    ARRAY(
      SELECT DISTINCT be_source.source::TEXT
      FROM burst_events be_source
      ORDER BY 1
    ) AS source_set,
    ARRAY(
      SELECT DISTINCT be_type.change_type::TEXT
      FROM burst_events be_type
      ORDER BY 1
      LIMIT 3
    ) AS headline_change_types,
    COUNT(DISTINCT be.change_type)::INTEGER AS change_type_count,
    EXISTS(SELECT 1 FROM related_news_rows) AS has_related_news,
    (SELECT COUNT(*)::INTEGER FROM related_news_rows) AS related_news_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'event_id', be.id,
          'source', be.source::TEXT,
          'change_type', be.change_type::TEXT,
          'occurred_at', be.occurred_at,
          'before_value', be.before_value,
          'after_value', be.after_value,
          'context', be.context,
          'source_snapshot_id', be.source_snapshot_id,
          'related_snapshot_id', be.related_snapshot_id,
          'media_version_id', be.media_version_id,
          'news_item_gid', be.news_item_gid
        )
        ORDER BY be.occurred_at ASC, be.id ASC
      ) FILTER (WHERE be.id IS NOT NULL),
      '[]'::JSONB
    ) AS events,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'gid', rnr.gid,
            'url', rnr.url,
            'author', rnr.author,
            'feedlabel', rnr.feedlabel,
            'feedname', rnr.feedname,
            'published_at', rnr.published_at,
            'first_seen_at', rnr.first_seen_at,
            'title', rnr.title,
            'contents', rnr.contents,
            'normalized_payload', rnr.normalized_payload
          )
          ORDER BY COALESCE(rnr.published_at, rnr.first_seen_at) DESC, rnr.gid DESC
        )
        FROM related_news_rows rnr
      ),
      '[]'::JSONB
    ) AS related_news,
    jsonb_build_object(
      'baseline_7d', get_change_window_metrics(a.appid, p.burst_started_at - INTERVAL '7 days', p.burst_started_at),
      'response_1d', get_change_window_metrics(a.appid, p.burst_ended_at, p.burst_ended_at + INTERVAL '1 day'),
      'response_7d', get_change_window_metrics(a.appid, p.burst_ended_at, p.burst_ended_at + INTERVAL '7 days')
    ) AS impact
  FROM parsed p
  JOIN apps a ON a.appid = p.appid
  LEFT JOIN burst_events be ON TRUE
  GROUP BY
    a.appid,
    a.name,
    a.type,
    a.is_released,
    a.release_date,
    p.burst_started_at,
    p.burst_ended_at;
$$;


--
-- Name: FUNCTION get_change_feed_burst_detail(p_burst_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_change_feed_burst_detail(p_burst_id text) IS 'Returns atomic events, related news, and lazy impact metrics for one grouped Change Feed burst.';


--
-- Name: get_change_feed_bursts(integer, text, text[], text, text[], timestamp with time zone, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_change_feed_bursts(p_days integer DEFAULT 7, p_preset text DEFAULT 'high_signal'::text, p_app_types text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_source_filter text[] DEFAULT NULL::text[], p_cursor_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_burst_id text DEFAULT NULL::text, p_limit integer DEFAULT 50) RETURNS TABLE(burst_id text, appid integer, app_name text, app_type text, is_released boolean, release_date date, effective_at timestamp with time zone, burst_started_at timestamp with time zone, burst_ended_at timestamp with time zone, event_count integer, source_set text[], headline_change_types text[], change_type_count integer, has_related_news boolean, related_news_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 7), 1) AS days,
      COALESCE(NULLIF(BTRIM(p_preset), ''), 'high_signal') AS requested_preset,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN NULL::TEXT[]
        ELSE p_app_types
      END AS requested_app_types,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      CASE
        WHEN p_source_filter IS NULL OR CARDINALITY(p_source_filter) = 0 THEN NULL::TEXT[]
        ELSE p_source_filter
      END AS requested_source_filter,
      LEAST(GREATEST(COALESCE(p_limit, 50), 1), 1000) AS requested_limit
  )
  SELECT
    cab.burst_id,
    cab.appid,
    cab.app_name,
    cab.app_type::TEXT,
    cab.is_released,
    cab.release_date,
    cab.effective_at,
    cab.burst_started_at,
    cab.burst_ended_at,
    cab.event_count,
    cab.source_set,
    cab.headline_change_types,
    cab.change_type_count,
    cab.has_related_news,
    cab.related_news_count
  FROM public.change_activity_bursts cab
  CROSS JOIN request_config rc
  WHERE cab.effective_at >= NOW() - make_interval(days => rc.days)
    AND (
      rc.requested_app_types IS NULL
      OR cab.app_type::TEXT = ANY (rc.requested_app_types)
    )
    AND (
      rc.requested_search IS NULL
      OR cab.app_name ILIKE '%' || rc.requested_search || '%'
    )
    AND (
      rc.requested_source_filter IS NULL
      OR cab.source_set && rc.requested_source_filter
    )
    AND CASE rc.requested_preset
      WHEN 'high_signal' THEN cab.include_in_high_signal
      WHEN 'upcoming_radar' THEN
        cab.include_in_high_signal
        AND (
          cab.is_released = FALSE
          OR (
            cab.release_date IS NOT NULL
            AND cab.release_date >= CURRENT_DATE - 30
          )
        )
      WHEN 'all_changes' THEN TRUE
      ELSE cab.include_in_high_signal
    END
    AND (
      p_cursor_time IS NULL
      OR p_cursor_burst_id IS NULL
      OR (cab.effective_at, cab.burst_id) < (p_cursor_time, p_cursor_burst_id)
    )
  ORDER BY cab.effective_at DESC, cab.burst_id DESC
  LIMIT (SELECT requested_limit FROM request_config);
$$;


--
-- Name: FUNCTION get_change_feed_bursts(p_days integer, p_preset text, p_app_types text[], p_search text, p_source_filter text[], p_cursor_time timestamp with time zone, p_cursor_burst_id text, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_change_feed_bursts(p_days integer, p_preset text, p_app_types text[], p_search text, p_source_filter text[], p_cursor_time timestamp with time zone, p_cursor_burst_id text, p_limit integer) IS 'Returns grouped non-news Steam change bursts for the admin Change Feed.';


--
-- Name: get_change_feed_news(integer, text[], text, timestamp with time zone, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_change_feed_news(p_days integer DEFAULT 7, p_app_types text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_cursor_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_gid text DEFAULT NULL::text, p_limit integer DEFAULT 50) RETURNS TABLE(gid text, appid integer, app_name text, app_type text, published_at timestamp with time zone, first_seen_at timestamp with time zone, title text, feedlabel text, feedname text, url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH recent_news AS (
    SELECT
      n.gid,
      n.appid,
      n.published_at,
      n.first_seen_at,
      n.feedlabel,
      n.feedname,
      n.url,
      COALESCE(n.published_at, n.first_seen_at) AS sort_time
    FROM steam_news_items n
    WHERE COALESCE(n.published_at, n.first_seen_at) >= NOW() - make_interval(days => GREATEST(COALESCE(p_days, 7), 1))
      AND (
        p_cursor_time IS NULL
        OR p_cursor_gid IS NULL
        OR (COALESCE(n.published_at, n.first_seen_at), n.gid) < (p_cursor_time, p_cursor_gid)
      )
  )
  SELECT
    rn.gid,
    rn.appid,
    a.name AS app_name,
    a.type::TEXT AS app_type,
    rn.published_at,
    rn.first_seen_at,
    lv.title,
    rn.feedlabel,
    rn.feedname,
    COALESCE(lv.url, rn.url) AS url
  FROM recent_news rn
  JOIN apps a ON a.appid = rn.appid
  LEFT JOIN LATERAL (
    SELECT
      v.title,
      v.url
    FROM steam_news_versions v
    WHERE v.gid = rn.gid
    ORDER BY v.first_seen_at DESC
    LIMIT 1
  ) lv ON TRUE
  WHERE (
    p_app_types IS NULL
    OR a.type::TEXT = ANY (p_app_types)
  )
    AND (
      p_search IS NULL
      OR a.name ILIKE '%' || p_search || '%'
      OR COALESCE(lv.title, '') ILIKE '%' || p_search || '%'
    )
  ORDER BY rn.sort_time DESC, rn.gid DESC
  LIMIT LEAST(COALESCE(p_limit, 50), 100);
$$;


--
-- Name: FUNCTION get_change_feed_news(p_days integer, p_app_types text[], p_search text, p_cursor_time timestamp with time zone, p_cursor_gid text, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_change_feed_news(p_days integer, p_app_types text[], p_search text, p_cursor_time timestamp with time zone, p_cursor_gid text, p_limit integer) IS 'Returns one row per Steam news item gid for the admin Change Feed news tab.';


--
-- Name: get_change_window_metrics(integer, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_change_window_metrics(p_appid integer, p_start timestamp with time zone, p_end timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_daily JSONB;
  v_reviews JSONB;
  v_ccu JSONB;
BEGIN
  SELECT jsonb_build_object(
    'days', COUNT(*),
    'avg_price_cents', AVG(dm.price_cents),
    'avg_discount_percent', AVG(dm.discount_percent),
    'max_total_reviews', MAX(dm.total_reviews),
    'avg_review_score', AVG(dm.review_score),
    'max_ccu_peak', MAX(dm.ccu_peak)
  )
  INTO v_daily
  FROM daily_metrics dm
  WHERE dm.appid = p_appid
    AND dm.metric_date BETWEEN p_start::date AND p_end::date;

  SELECT jsonb_build_object(
    'days', COUNT(*),
    'reviews_added', COALESCE(SUM(rd.reviews_added), 0),
    'positive_added', COALESCE(SUM(rd.positive_added), 0),
    'negative_added', COALESCE(SUM(rd.negative_added), 0),
    'avg_daily_velocity', AVG(rd.daily_velocity)
  )
  INTO v_reviews
  FROM review_deltas rd
  WHERE rd.appid = p_appid
    AND rd.delta_date BETWEEN p_start::date AND p_end::date;

  SELECT jsonb_build_object(
    'samples', COUNT(*),
    'avg_player_count', AVG(source_data.player_count),
    'max_player_count', MAX(source_data.player_count),
    'source', MAX(source_data.source_label)
  )
  INTO v_ccu
  FROM (
    SELECT cs.player_count, 'ccu_snapshots'::TEXT AS source_label
    FROM ccu_snapshots cs
    WHERE cs.appid = p_appid
      AND cs.snapshot_time BETWEEN p_start AND p_end

    UNION ALL

    SELECT dm.ccu_peak AS player_count, 'daily_metrics'::TEXT AS source_label
    FROM daily_metrics dm
    WHERE dm.appid = p_appid
      AND dm.metric_date BETWEEN p_start::date AND p_end::date
      AND NOT EXISTS (
        SELECT 1
        FROM ccu_snapshots cs
        WHERE cs.appid = p_appid
          AND cs.snapshot_time BETWEEN p_start AND p_end
      )
  ) source_data;

  RETURN jsonb_build_object(
    'daily_metrics', COALESCE(v_daily, '{}'::jsonb),
    'review_deltas', COALESCE(v_reviews, '{}'::jsonb),
    'ccu', COALESCE(v_ccu, '{}'::jsonb)
  );
END;
$$;


--
-- Name: get_chat_change_activity_candidates(integer, text, text, text[], text[], text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_chat_change_activity_candidates(p_days integer DEFAULT 30, p_view text DEFAULT 'overview'::text, p_sort text DEFAULT 'relevant'::text, p_app_types text[] DEFAULT NULL::text[], p_signal_families text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25) RETURNS TABLE(burst_id text, appid integer, app_name text, app_type text, is_released boolean, release_date date, effective_at timestamp with time zone, burst_started_at timestamp with time zone, burst_ended_at timestamp with time zone, event_count integer, source_set text[], headline_change_types text[], change_type_count integer, has_related_news boolean, related_news_count integer, signal_families text[], story_kind text, sort_score double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 30), 1) AS days,
      COALESCE(NULLIF(BTRIM(p_view), ''), 'overview') AS requested_view,
      COALESCE(NULLIF(BTRIM(p_sort), ''), 'relevant') AS requested_sort,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN NULL::TEXT[]
        ELSE p_app_types
      END AS requested_app_types,
      CASE
        WHEN p_signal_families IS NULL OR CARDINALITY(p_signal_families) = 0 THEN NULL::TEXT[]
        ELSE ARRAY(
          SELECT ranked.family
          FROM (
            SELECT DISTINCT family
            FROM unnest(p_signal_families) AS family
            WHERE family <> 'announcement'
          ) AS ranked
          ORDER BY public.change_signal_sort_rank(ranked.family), ranked.family
        )
      END AS requested_signal_families,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) AS requested_limit
  ),
  filtered AS (
    SELECT
      cab.*
    FROM public.change_activity_bursts cab
    CROSS JOIN request_config rc
    WHERE cab.effective_at >= NOW() - make_interval(days => rc.days)
      AND (
        rc.requested_app_types IS NULL
        OR cab.app_type::TEXT = ANY (rc.requested_app_types)
      )
      AND (
        rc.requested_search IS NULL
        OR cab.app_name ILIKE '%' || rc.requested_search || '%'
      )
      AND (
        rc.requested_signal_families IS NULL
        OR cab.signal_families && rc.requested_signal_families
      )
      AND CASE rc.requested_view
        WHEN 'launch-watch' THEN
          cab.is_released = FALSE
          OR (
            cab.release_date IS NOT NULL
            AND cab.release_date >= CURRENT_DATE - 30
          )
          OR cab.signal_families && ARRAY['release']::TEXT[]
        WHEN 'commercial-moves' THEN
          cab.signal_families && ARRAY['pricing']::TEXT[]
        WHEN 'store-refreshes' THEN
          cab.signal_families && ARRAY['store-page', 'media', 'taxonomy', 'platform']::TEXT[]
        ELSE TRUE
      END
  ),
  scored AS (
    SELECT
      f.*,
      CASE rc.requested_sort
        WHEN 'newest' THEN EXTRACT(EPOCH FROM f.effective_at)
        WHEN 'biggest-change' THEN (
          f.event_count * 6
          + f.change_type_count * 8
          + CARDINALITY(COALESCE(f.signal_families, ARRAY[]::TEXT[])) * 6
          + CASE WHEN f.has_related_news THEN 8 ELSE 0 END
        )::DOUBLE PRECISION
        WHEN 'most-commercial' THEN (
          CASE WHEN f.signal_families && ARRAY['pricing']::TEXT[] THEN 100 ELSE 0 END
          + f.related_news_count * 10
          + f.event_count * 4
          + f.change_type_count * 4
        )::DOUBLE PRECISION
        WHEN 'most-launch-relevant' THEN (
          CASE
            WHEN f.signal_families && ARRAY['release']::TEXT[]
              OR f.is_released = FALSE
              OR (
                f.release_date IS NOT NULL
                AND f.release_date >= CURRENT_DATE - 30
              )
              THEN 110
            ELSE 0
          END
          + f.related_news_count * 10
          + f.event_count * 4
        )::DOUBLE PRECISION
        ELSE (
          CASE f.story_kind
            WHEN 'release-prep' THEN 42
            WHEN 'commercial-move' THEN 38
            WHEN 'store-refresh' THEN 32
            WHEN 'positioning-shift' THEN 30
            WHEN 'platform-expansion' THEN 28
            WHEN 'build-activity' THEN 14
            ELSE 20
          END
          + f.event_count * 6
          + f.change_type_count * 4
          + f.related_news_count * 6
        )::DOUBLE PRECISION
      END AS sort_score
    FROM filtered f
    CROSS JOIN request_config rc
  )
  SELECT
    s.burst_id,
    s.appid,
    s.app_name,
    s.app_type::TEXT,
    s.is_released,
    s.release_date,
    s.effective_at,
    s.burst_started_at,
    s.burst_ended_at,
    s.event_count,
    s.source_set,
    s.headline_change_types,
    s.change_type_count,
    s.has_related_news,
    s.related_news_count,
    s.signal_families,
    s.story_kind,
    s.sort_score
  FROM scored s
  ORDER BY s.sort_score DESC, s.effective_at DESC, s.burst_id DESC
  LIMIT (SELECT requested_limit FROM request_config);
$$;


--
-- Name: get_chat_change_pattern_candidates(text, integer, text[], text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_chat_change_pattern_candidates(p_pattern text, p_days integer DEFAULT 30, p_app_types text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_limit integer DEFAULT 10) RETURNS TABLE(appid integer, app_name text, app_type text, is_released boolean, release_date date, latest_occurred_at timestamp with time zone, activity_ids text[], signal_families text[], story_kinds text[], announcement_count integer, change_count integer, positive_percentage double precision, total_reviews integer, ccu_peak integer, price_cents integer, discount_percent integer, review_velocity_7d double precision, review_velocity_30d double precision, trend_30d_direction text, ccu_trend_7d_pct double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH request_base AS (
    SELECT
      COALESCE(NULLIF(BTRIM(p_pattern), ''), 'generic') AS requested_pattern,
      LEAST(GREATEST(COALESCE(p_days, 30), 1), 180) AS days,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN NULL::TEXT[]
        ELSE p_app_types
      END AS requested_app_types,
      NULLIF(BTRIM(COALESCE(p_search, '')), '') AS requested_search,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1), 120) AS requested_limit
  ),
  request_config AS (
    SELECT
      rb.*,
      CASE
        WHEN rb.days <= 7 THEN 7
        WHEN rb.days <= 30 THEN 30
        WHEN rb.days <= 90 THEN 90
        ELSE 180
      END AS shortlist_window_days,
      CASE
        WHEN rb.requested_pattern = ANY (ARRAY['sustained_response', 'announcement_weak_response']::TEXT[])
          THEN LEAST(GREATEST(rb.requested_limit * 10, 60), 120)
        ELSE LEAST(GREATEST(rb.requested_limit * 20, 120), 300)
      END AS shortlist_limit,
      rb.requested_pattern = ANY (ARRAY['under_marketed', 'signable_candidate', 'rescue_candidate']::TEXT[])
        AS requires_live_metrics
    FROM request_base rb
  ),
  coarse_candidates AS (
    SELECT
      cpaw.*,
      CASE rc.requested_pattern
        WHEN 'marketing_push' THEN
          CASE
            WHEN cpaw.pricing_count > 0
              AND (cpaw.store_page_count + cpaw.media_count) > 0
              AND cpaw.announcement_count > 0
              THEN 170
                + LEAST(cpaw.change_count, 6) * 6
                + LEAST(cpaw.announcement_count, 6) * 8
                + LEAST(cpaw.store_page_count + cpaw.media_count, 6) * 6
            ELSE 0
          END
        WHEN 'relaunch_pattern' THEN
          CASE
            WHEN cpaw.pricing_count > 0
              AND (cpaw.store_page_count + cpaw.media_count) > 0
              AND (cpaw.release_count > 0 OR cpaw.announcement_count > 0)
              THEN 175
                + LEAST(cpaw.change_count, 6) * 6
                + LEAST(cpaw.announcement_count, 6) * 8
                + LEAST(cpaw.release_count, 4) * 10
            ELSE 0
          END
        WHEN 'update_tease' THEN
          CASE
            WHEN cpaw.announcement_count > 0
              AND (cpaw.store_page_count + cpaw.media_count) > 0
              AND cpaw.build_count = 0
              THEN 160
                + LEAST(cpaw.announcement_count, 6) * 8
                + LEAST(cpaw.store_page_count + cpaw.media_count, 6) * 6
            ELSE 0
          END
        WHEN 'under_marketed' THEN
          CASE
            WHEN cpaw.build_count > 0
              AND (cpaw.store_page_count + cpaw.media_count) = 0
              AND cpaw.announcement_count = 0
              THEN 140 + LEAST(cpaw.change_count, 8) * 4
            ELSE 0
          END
        WHEN 'signable_candidate' THEN
          CASE
            WHEN cpaw.build_count > 0
              AND (cpaw.store_page_count + cpaw.media_count) = 0
              THEN 140 + LEAST(cpaw.change_count, 8) * 4
            ELSE 0
          END
        WHEN 'rescue_candidate' THEN
          CASE
            WHEN cpaw.pricing_count > 0
              THEN 135 + LEAST(cpaw.pricing_count, 6) * 8 + LEAST(cpaw.change_count, 8) * 4
            ELSE 0
          END
        WHEN 'sustained_response' THEN
          CASE
            WHEN cpaw.announcement_count > 0 OR cpaw.change_count >= 2
              THEN 135
                + LEAST(cpaw.announcement_count, 6) * 8
                + LEAST(cpaw.change_count, 6) * 6
            ELSE 0
          END
        WHEN 'announcement_weak_response' THEN
          CASE
            WHEN cpaw.announcement_count > 0
              THEN 145
                + LEAST(cpaw.announcement_count, 6) * 8
                + LEAST(cpaw.change_count, 6) * 4
            ELSE 0
          END
        ELSE 100 + LEAST(cpaw.change_count, 8) * 5
      END AS coarse_score
    FROM public.change_pattern_app_windows cpaw
    CROSS JOIN request_config rc
    WHERE cpaw.window_days = rc.shortlist_window_days
      AND (
        rc.requested_app_types IS NULL
        OR cpaw.app_type::TEXT = ANY (rc.requested_app_types)
      )
      AND (
        rc.requested_search IS NULL
        OR cpaw.app_name ILIKE '%' || rc.requested_search || '%'
      )
  ),
  shortlisted AS (
    SELECT
      cc.appid,
      cc.coarse_score
    FROM coarse_candidates cc
    WHERE cc.coarse_score > 0
    ORDER BY cc.coarse_score DESC, cc.latest_occurred_at DESC, cc.appid DESC
    LIMIT (SELECT shortlist_limit FROM request_config)
  ),
  exact_window_rows AS (
    SELECT
      cpad.*
    FROM public.change_pattern_activity_days cpad
    JOIN shortlisted shortlist
      ON shortlist.appid = cpad.appid
    CROSS JOIN request_config rc
    WHERE cpad.activity_date >= CURRENT_DATE - GREATEST(rc.days - 1, 0)
  ),
  exact_base AS (
    SELECT
      ewr.appid,
      MAX(ewr.app_name) AS app_name,
      MAX(ewr.app_type) AS app_type,
      BOOL_OR(COALESCE(ewr.is_released, FALSE)) AS is_released,
      MAX(ewr.release_date) AS release_date,
      MAX(ewr.latest_occurred_at) AS latest_occurred_at,
      SUM(ewr.announcement_count)::INTEGER AS announcement_count,
      SUM(ewr.total_bursts)::INTEGER AS change_count,
      SUM(ewr.release_count)::INTEGER AS release_count,
      SUM(ewr.pricing_count)::INTEGER AS pricing_count,
      SUM(ewr.store_page_count)::INTEGER AS store_page_count,
      SUM(ewr.media_count)::INTEGER AS media_count,
      SUM(ewr.taxonomy_count)::INTEGER AS taxonomy_count,
      SUM(ewr.platform_count)::INTEGER AS platform_count,
      SUM(ewr.build_count)::INTEGER AS build_count,
      MAX(shortlist.coarse_score) AS coarse_score
    FROM exact_window_rows ewr
    JOIN shortlisted shortlist
      ON shortlist.appid = ewr.appid
    GROUP BY ewr.appid
  ),
  ranked_activity_ids AS (
    SELECT
      ranked.appid,
      ranked.burst_id,
      ROW_NUMBER() OVER (
        PARTITION BY ranked.appid
        ORDER BY ranked.latest_occurred_at DESC, ranked.activity_date DESC, ranked.ordinality, ranked.burst_id DESC
      ) AS burst_rank
    FROM (
      SELECT DISTINCT
        ewr.appid,
        ewr.activity_date,
        ewr.latest_occurred_at,
        burst.burst_id,
        burst.ordinality
      FROM exact_window_rows ewr
      CROSS JOIN LATERAL UNNEST(ewr.burst_ids) WITH ORDINALITY AS burst(burst_id, ordinality)
    ) AS ranked
  ),
  grouped_activity_ids AS (
    SELECT
      rai.appid,
      ARRAY_AGG(rai.burst_id ORDER BY rai.burst_rank) FILTER (WHERE rai.burst_rank <= 6) AS activity_ids
    FROM ranked_activity_ids rai
    GROUP BY rai.appid
  ),
  grouped_signal_families AS (
    SELECT
      ranked.appid,
      ARRAY_AGG(
        ranked.signal_family
        ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
      ) AS signal_families
    FROM (
      SELECT DISTINCT
        ewr.appid,
        signal_family
      FROM exact_window_rows ewr
      CROSS JOIN LATERAL UNNEST(ewr.signal_families) AS signal_family
    ) AS ranked
    GROUP BY ranked.appid
  ),
  grouped_story_kinds AS (
    SELECT
      ranked.appid,
      ARRAY_AGG(ranked.story_kind ORDER BY ranked.story_kind) AS story_kinds
    FROM (
      SELECT DISTINCT
        ewr.appid,
        story_kind
      FROM exact_window_rows ewr
      CROSS JOIN LATERAL UNNEST(ewr.story_kinds) AS story_kind
    ) AS ranked
    GROUP BY ranked.appid
  ),
  exact_grouped AS (
    SELECT
      eb.appid,
      eb.app_name,
      eb.app_type::TEXT AS app_type,
      eb.is_released,
      eb.release_date,
      eb.latest_occurred_at,
      COALESCE(gai.activity_ids, ARRAY[]::TEXT[]) AS activity_ids,
      COALESCE(gsf.signal_families, ARRAY[]::TEXT[]) AS signal_families,
      COALESCE(gsk.story_kinds, ARRAY[]::TEXT[]) AS story_kinds,
      eb.announcement_count,
      eb.change_count,
      eb.release_count,
      eb.pricing_count,
      eb.store_page_count,
      eb.media_count,
      eb.taxonomy_count,
      eb.platform_count,
      eb.build_count,
      eb.coarse_score
    FROM exact_base eb
    LEFT JOIN grouped_activity_ids gai
      ON gai.appid = eb.appid
    LEFT JOIN grouped_signal_families gsf
      ON gsf.appid = eb.appid
    LEFT JOIN grouped_story_kinds gsk
      ON gsk.appid = eb.appid
  ),
  metrics_joined AS (
    SELECT
      eg.*,
      CASE WHEN rc.requires_live_metrics THEN ldm.positive_percentage ELSE NULL END AS positive_percentage,
      CASE WHEN rc.requires_live_metrics THEN ldm.total_reviews ELSE NULL END AS total_reviews,
      CASE WHEN rc.requires_live_metrics THEN ldm.ccu_peak ELSE NULL END AS ccu_peak,
      CASE WHEN rc.requires_live_metrics THEN ldm.price_cents ELSE NULL END AS price_cents,
      CASE WHEN rc.requires_live_metrics THEN ldm.discount_percent ELSE NULL END AS discount_percent,
      CASE WHEN rc.requires_live_metrics THEN trends.review_velocity_7d ELSE NULL END AS review_velocity_7d,
      CASE WHEN rc.requires_live_metrics THEN trends.review_velocity_30d ELSE NULL END AS review_velocity_30d,
      CASE WHEN rc.requires_live_metrics THEN trends.trend_30d_direction ELSE NULL END AS trend_30d_direction,
      CASE WHEN rc.requires_live_metrics THEN trends.ccu_trend_7d_pct ELSE NULL END AS ccu_trend_7d_pct
    FROM exact_grouped eg
    CROSS JOIN request_config rc
    LEFT JOIN public.latest_daily_metrics ldm
      ON rc.requires_live_metrics
     AND ldm.appid = eg.appid
    LEFT JOIN public.app_trends trends
      ON rc.requires_live_metrics
     AND trends.appid = eg.appid
  ),
  scored AS (
    SELECT
      mj.*,
      CASE rc.requested_pattern
        WHEN 'marketing_push' THEN
          CASE
            WHEN mj.pricing_count > 0
              AND (mj.store_page_count + mj.media_count) > 0
              AND mj.announcement_count > 0
              THEN 170
                + LEAST(mj.change_count, 6) * 6
                + LEAST(mj.announcement_count, 6) * 8
                + LEAST(mj.store_page_count + mj.media_count, 6) * 6
            ELSE 0
          END
        WHEN 'relaunch_pattern' THEN
          CASE
            WHEN mj.pricing_count > 0
              AND (mj.store_page_count + mj.media_count) > 0
              AND (mj.release_count > 0 OR mj.announcement_count > 0)
              THEN 175
                + LEAST(mj.change_count, 6) * 6
                + LEAST(mj.announcement_count, 6) * 8
                + LEAST(mj.release_count, 4) * 10
            ELSE 0
          END
        WHEN 'update_tease' THEN
          CASE
            WHEN mj.announcement_count > 0
              AND (mj.store_page_count + mj.media_count) > 0
              AND mj.build_count = 0
              THEN 160
                + LEAST(mj.announcement_count, 6) * 8
                + LEAST(mj.store_page_count + mj.media_count, 6) * 6
            ELSE 0
          END
        WHEN 'under_marketed' THEN
          CASE
            WHEN mj.build_count > 0
              AND (mj.store_page_count + mj.media_count) = 0
              AND mj.announcement_count = 0
              THEN 150
                + CASE WHEN COALESCE(mj.positive_percentage, 0) >= 80 THEN 20 ELSE 0 END
                + CASE WHEN COALESCE(mj.total_reviews, 0) >= 200 THEN 15 ELSE 0 END
                + CASE WHEN COALESCE(mj.review_velocity_30d, 0) >= 1 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'signable_candidate' THEN
          CASE
            WHEN mj.build_count > 0
              AND (mj.store_page_count + mj.media_count) = 0
              THEN 145
                + CASE WHEN COALESCE(mj.positive_percentage, 0) >= 85 THEN 25 ELSE 0 END
                + CASE WHEN COALESCE(mj.total_reviews, 0) >= 300 THEN 20 ELSE 0 END
                + CASE WHEN COALESCE(mj.review_velocity_30d, 0) >= 1 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'rescue_candidate' THEN
          CASE
            WHEN mj.pricing_count > 0
              AND (
                mj.trend_30d_direction = 'down'
                OR COALESCE(mj.ccu_trend_7d_pct, 0) < 0
              )
              THEN 145
                + CASE WHEN COALESCE(mj.total_reviews, 0) >= 100 THEN 15 ELSE 0 END
                + CASE WHEN COALESCE(mj.positive_percentage, 0) >= 70 THEN 10 ELSE 0 END
            ELSE 0
          END
        WHEN 'sustained_response' THEN
          CASE
            WHEN mj.announcement_count > 0 OR mj.change_count >= 2
              THEN 135
                + LEAST(mj.announcement_count, 6) * 8
                + LEAST(mj.change_count, 6) * 6
            ELSE 0
          END
        WHEN 'announcement_weak_response' THEN
          CASE
            WHEN mj.announcement_count > 0
              THEN 145
                + LEAST(mj.announcement_count, 6) * 8
                + LEAST(mj.change_count, 6) * 4
            ELSE 0
          END
        ELSE 100 + LEAST(mj.change_count, 8) * 5
      END AS pattern_score
    FROM metrics_joined mj
    CROSS JOIN request_config rc
  )
  SELECT
    s.appid,
    s.app_name,
    s.app_type,
    s.is_released,
    s.release_date,
    s.latest_occurred_at,
    s.activity_ids,
    s.signal_families,
    s.story_kinds,
    s.announcement_count,
    s.change_count,
    s.positive_percentage,
    s.total_reviews,
    s.ccu_peak,
    s.price_cents,
    s.discount_percent,
    s.review_velocity_7d,
    s.review_velocity_30d,
    s.trend_30d_direction,
    s.ccu_trend_7d_pct
  FROM scored s
  WHERE s.pattern_score > 0
  ORDER BY
    s.pattern_score DESC,
    s.coarse_score DESC,
    s.latest_occurred_at DESC,
    COALESCE(s.total_reviews, 0) DESC,
    s.appid DESC
  LIMIT (SELECT requested_limit FROM request_config);
$$;


--
-- Name: get_chat_recent_news(integer[], integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_chat_recent_news(p_appids integer[] DEFAULT NULL::integer[], p_days integer DEFAULT 14, p_limit integer DEFAULT 6) RETURNS TABLE(gid text, appid integer, app_name text, app_type text, published_at timestamp with time zone, first_seen_at timestamp with time zone, title text, feedlabel text, feedname text, url text, contents text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH filtered_news AS (
    SELECT
      n.gid,
      n.appid,
      n.published_at,
      n.first_seen_at,
      n.feedlabel,
      n.feedname,
      n.url,
      COALESCE(n.published_at, n.first_seen_at) AS sort_time
    FROM steam_news_items n
    WHERE COALESCE(n.published_at, n.first_seen_at) >= NOW() - make_interval(days => GREATEST(COALESCE(p_days, 14), 1))
      AND (
        p_appids IS NULL
        OR n.appid = ANY (p_appids)
      )
    ORDER BY COALESCE(n.published_at, n.first_seen_at) DESC, n.gid DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 6), 1) * 2, 12)
  )
  SELECT
    fn.gid,
    fn.appid,
    a.name AS app_name,
    a.type::TEXT AS app_type,
    fn.published_at,
    fn.first_seen_at,
    lv.title,
    fn.feedlabel,
    fn.feedname,
    COALESCE(lv.url, fn.url) AS url,
    lv.contents
  FROM filtered_news fn
  JOIN apps a ON a.appid = fn.appid
  LEFT JOIN LATERAL (
    SELECT
      v.title,
      v.contents,
      v.url
    FROM steam_news_versions v
    WHERE v.gid = fn.gid
    ORDER BY v.first_seen_at DESC
    LIMIT 1
  ) lv ON TRUE
  ORDER BY fn.sort_time DESC, fn.gid DESC;
$$;


--
-- Name: FUNCTION get_chat_recent_news(p_appids integer[], p_days integer, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_chat_recent_news(p_appids integer[], p_days integer, p_limit integer) IS 'Returns a bounded recent-news digest with latest body text for chat summaries over one title or a small known set of titles.';


--
-- Name: get_companies_aggregate_stats(text, text, integer, integer, bigint, bigint, integer, integer, bigint, bigint, bigint, bigint, integer, integer, integer, integer, text, integer[], text, integer[], integer[], text, text[], text, numeric, numeric, numeric, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_companies_aggregate_stats(p_type text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_min_games integer DEFAULT NULL::integer, p_max_games integer DEFAULT NULL::integer, p_min_owners bigint DEFAULT NULL::bigint, p_max_owners bigint DEFAULT NULL::bigint, p_min_ccu integer DEFAULT NULL::integer, p_max_ccu integer DEFAULT NULL::integer, p_min_hours bigint DEFAULT NULL::bigint, p_max_hours bigint DEFAULT NULL::bigint, p_min_revenue bigint DEFAULT NULL::bigint, p_max_revenue bigint DEFAULT NULL::bigint, p_min_score integer DEFAULT NULL::integer, p_max_score integer DEFAULT NULL::integer, p_min_reviews integer DEFAULT NULL::integer, p_max_reviews integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_genres integer[] DEFAULT NULL::integer[], p_genre_mode text DEFAULT 'any'::text, p_tags integer[] DEFAULT NULL::integer[], p_categories integer[] DEFAULT NULL::integer[], p_steam_deck text DEFAULT NULL::text, p_platforms text[] DEFAULT NULL::text[], p_platform_mode text DEFAULT 'any'::text, p_min_growth_7d numeric DEFAULT NULL::numeric, p_max_growth_7d numeric DEFAULT NULL::numeric, p_min_growth_30d numeric DEFAULT NULL::numeric, p_max_growth_30d numeric DEFAULT NULL::numeric, p_relationship text DEFAULT NULL::text) RETURNS TABLE(total_companies bigint, total_games bigint, total_owners bigint, total_revenue bigint, avg_review_score numeric, total_ccu bigint)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_needs_relationship BOOLEAN;
BEGIN
  v_needs_relationship := (p_relationship IS NOT NULL);

  -- Fast path: No relationship filter
  IF NOT v_needs_relationship THEN
    RETURN QUERY
    WITH base AS (
      SELECT pm.game_count, pm.total_owners, pm.revenue_estimate_cents, pm.avg_review_score, pm.total_ccu,
             pm.estimated_weekly_hours, pm.total_reviews,
             pm.games_released_last_year, p.id, p.name, 'publisher'::TEXT AS type,
             pm.genre_ids, pm.tag_ids, pm.category_ids, pm.best_steam_deck_category
      FROM publishers p LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE (p_type = 'all' OR p_type = 'publisher') AND p.game_count > 0
      UNION ALL
      SELECT dm.game_count, dm.total_owners, dm.revenue_estimate_cents, dm.avg_review_score, dm.total_ccu,
             dm.estimated_weekly_hours, dm.total_reviews,
             dm.games_released_last_year, d.id, d.name, 'developer'::TEXT,
             dm.genre_ids, dm.tag_ids, dm.category_ids, dm.best_steam_deck_category
      FROM developers d LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE (p_type = 'all' OR p_type = 'developer') AND d.game_count > 0
    ),
    filtered AS (
      SELECT b.* FROM base b
      WHERE (p_search IS NULL OR b.name ILIKE '%' || p_search || '%')
        AND (p_min_games IS NULL OR b.game_count >= p_min_games)
        AND (p_max_games IS NULL OR b.game_count <= p_max_games)
        AND (p_min_owners IS NULL OR b.total_owners >= p_min_owners)
        AND (p_max_owners IS NULL OR b.total_owners <= p_max_owners)
        AND (p_min_ccu IS NULL OR b.total_ccu >= p_min_ccu)
        AND (p_max_ccu IS NULL OR b.total_ccu <= p_max_ccu)
        AND (p_min_hours IS NULL OR b.estimated_weekly_hours >= p_min_hours)
        AND (p_max_hours IS NULL OR b.estimated_weekly_hours <= p_max_hours)
        AND (p_min_revenue IS NULL OR b.revenue_estimate_cents >= p_min_revenue)
        AND (p_max_revenue IS NULL OR b.revenue_estimate_cents <= p_max_revenue)
        AND (p_min_score IS NULL OR b.avg_review_score >= p_min_score)
        AND (p_max_score IS NULL OR b.avg_review_score <= p_max_score)
        AND (p_min_reviews IS NULL OR b.total_reviews >= p_min_reviews)
        AND (p_max_reviews IS NULL OR b.total_reviews <= p_max_reviews)
        AND (p_status IS NULL
             OR (p_status = 'active' AND b.games_released_last_year > 0)
             OR (p_status = 'dormant' AND COALESCE(b.games_released_last_year, 0) = 0))
        AND (p_genres IS NULL OR (
          CASE p_genre_mode
            WHEN 'all' THEN b.genre_ids @> p_genres
            ELSE b.genre_ids && p_genres
          END
        ))
        AND (p_tags IS NULL OR b.tag_ids && p_tags)
        AND (p_categories IS NULL OR b.category_ids && p_categories)
        AND (p_steam_deck IS NULL OR (
          CASE p_steam_deck
            WHEN 'verified' THEN b.best_steam_deck_category = 'verified'
            WHEN 'playable' THEN b.best_steam_deck_category IN ('verified', 'playable')
            ELSE b.best_steam_deck_category IS NOT NULL
          END
        ))
    )
    SELECT COUNT(*)::BIGINT, COALESCE(SUM(f.game_count), 0)::BIGINT, COALESCE(SUM(f.total_owners), 0)::BIGINT,
           COALESCE(SUM(f.revenue_estimate_cents), 0)::BIGINT, ROUND(AVG(f.avg_review_score), 1)::DECIMAL,
           COALESCE(SUM(f.total_ccu), 0)::BIGINT
    FROM filtered f;

  -- Slow path: Relationship filter requires computing is_self_published per company
  ELSE
    RETURN QUERY
    WITH base AS (
      SELECT pm.game_count, pm.total_owners, pm.revenue_estimate_cents, pm.avg_review_score, pm.total_ccu,
             pm.estimated_weekly_hours, pm.total_reviews,
             pm.games_released_last_year, p.id, p.name, 'publisher'::TEXT AS type,
             pm.genre_ids, pm.tag_ids, pm.category_ids, pm.best_steam_deck_category
      FROM publishers p LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE (p_type = 'all' OR p_type = 'publisher') AND p.game_count > 0
      UNION ALL
      SELECT dm.game_count, dm.total_owners, dm.revenue_estimate_cents, dm.avg_review_score, dm.total_ccu,
             dm.estimated_weekly_hours, dm.total_reviews,
             dm.games_released_last_year, d.id, d.name, 'developer'::TEXT,
             dm.genre_ids, dm.tag_ids, dm.category_ids, dm.best_steam_deck_category
      FROM developers d LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE (p_type = 'all' OR p_type = 'developer') AND d.game_count > 0
    ),
    filtered AS (
      SELECT b.* FROM base b
      WHERE (p_search IS NULL OR b.name ILIKE '%' || p_search || '%')
        AND (p_min_games IS NULL OR b.game_count >= p_min_games)
        AND (p_max_games IS NULL OR b.game_count <= p_max_games)
        AND (p_min_owners IS NULL OR b.total_owners >= p_min_owners)
        AND (p_max_owners IS NULL OR b.total_owners <= p_max_owners)
        AND (p_min_ccu IS NULL OR b.total_ccu >= p_min_ccu)
        AND (p_max_ccu IS NULL OR b.total_ccu <= p_max_ccu)
        AND (p_min_hours IS NULL OR b.estimated_weekly_hours >= p_min_hours)
        AND (p_max_hours IS NULL OR b.estimated_weekly_hours <= p_max_hours)
        AND (p_min_revenue IS NULL OR b.revenue_estimate_cents >= p_min_revenue)
        AND (p_max_revenue IS NULL OR b.revenue_estimate_cents <= p_max_revenue)
        AND (p_min_score IS NULL OR b.avg_review_score >= p_min_score)
        AND (p_max_score IS NULL OR b.avg_review_score <= p_max_score)
        AND (p_min_reviews IS NULL OR b.total_reviews >= p_min_reviews)
        AND (p_max_reviews IS NULL OR b.total_reviews <= p_max_reviews)
        AND (p_status IS NULL
             OR (p_status = 'active' AND b.games_released_last_year > 0)
             OR (p_status = 'dormant' AND COALESCE(b.games_released_last_year, 0) = 0))
        AND (p_genres IS NULL OR (
          CASE p_genre_mode
            WHEN 'all' THEN b.genre_ids @> p_genres
            ELSE b.genre_ids && p_genres
          END
        ))
        AND (p_tags IS NULL OR b.tag_ids && p_tags)
        AND (p_categories IS NULL OR b.category_ids && p_categories)
        AND (p_steam_deck IS NULL OR (
          CASE p_steam_deck
            WHEN 'verified' THEN b.best_steam_deck_category = 'verified'
            WHEN 'playable' THEN b.best_steam_deck_category IN ('verified', 'playable')
            ELSE b.best_steam_deck_category IS NOT NULL
          END
        ))
    ),
    -- Compute relationship flags (same logic as main RPC slow path)
    with_relationships AS (
      SELECT f.*,
        CASE WHEN f.type = 'publisher' THEN
          NOT EXISTS (SELECT 1 FROM app_publishers ap JOIN publishers pub ON pub.id = ap.publisher_id
                      WHERE ap.publisher_id = f.id AND NOT EXISTS (
                        SELECT 1 FROM app_developers ad JOIN developers dev ON dev.id = ad.developer_id
                        WHERE ad.appid = ap.appid AND LOWER(TRIM(dev.name)) = LOWER(TRIM(pub.name))))
        ELSE NOT EXISTS (SELECT 1 FROM app_developers ad JOIN developers dev ON dev.id = ad.developer_id
                         WHERE ad.developer_id = f.id AND NOT EXISTS (
                           SELECT 1 FROM app_publishers ap JOIN publishers pub ON pub.id = ap.publisher_id
                           WHERE ap.appid = ad.appid AND LOWER(TRIM(pub.name)) = LOWER(TRIM(dev.name))))
        END AS is_self_pub,
        CASE WHEN f.type = 'publisher' THEN
          (SELECT COUNT(DISTINCT dev.id) FROM app_publishers ap
           JOIN app_developers ad ON ad.appid = ap.appid JOIN developers dev ON dev.id = ad.developer_id
           JOIN publishers pub ON pub.id = ap.publisher_id
           WHERE ap.publisher_id = f.id AND LOWER(TRIM(dev.name)) != LOWER(TRIM(pub.name)))::INT
        ELSE (SELECT COUNT(DISTINCT pub.id) FROM app_developers ad
              JOIN app_publishers ap ON ap.appid = ad.appid JOIN publishers pub ON pub.id = ap.publisher_id
              JOIN developers dev ON dev.id = ad.developer_id
              WHERE ad.developer_id = f.id AND LOWER(TRIM(pub.name)) != LOWER(TRIM(dev.name)))::INT
        END AS ext_partner_count
      FROM filtered f
    ),
    final_filtered AS (
      SELECT * FROM with_relationships wr
      WHERE (p_relationship = 'self_published' AND wr.is_self_pub = TRUE)
         OR (p_relationship = 'external_devs' AND wr.is_self_pub = FALSE AND wr.type = 'publisher')
         OR (p_relationship = 'multi_publisher' AND wr.ext_partner_count > 1 AND wr.type = 'developer')
    )
    SELECT COUNT(*)::BIGINT, COALESCE(SUM(ff.game_count), 0)::BIGINT, COALESCE(SUM(ff.total_owners), 0)::BIGINT,
           COALESCE(SUM(ff.revenue_estimate_cents), 0)::BIGINT, ROUND(AVG(ff.avg_review_score), 1)::DECIMAL,
           COALESCE(SUM(ff.total_ccu), 0)::BIGINT
    FROM final_filtered ff;
  END IF;
END;
$$;


--
-- Name: FUNCTION get_companies_aggregate_stats(p_type text, p_search text, p_min_games integer, p_max_games integer, p_min_owners bigint, p_max_owners bigint, p_min_ccu integer, p_max_ccu integer, p_min_hours bigint, p_max_hours bigint, p_min_revenue bigint, p_max_revenue bigint, p_min_score integer, p_max_score integer, p_min_reviews integer, p_max_reviews integer, p_status text, p_genres integer[], p_genre_mode text, p_tags integer[], p_categories integer[], p_steam_deck text, p_platforms text[], p_platform_mode text, p_min_growth_7d numeric, p_max_growth_7d numeric, p_min_growth_30d numeric, p_max_growth_30d numeric, p_relationship text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_companies_aggregate_stats(p_type text, p_search text, p_min_games integer, p_max_games integer, p_min_owners bigint, p_max_owners bigint, p_min_ccu integer, p_max_ccu integer, p_min_hours bigint, p_max_hours bigint, p_min_revenue bigint, p_max_revenue bigint, p_min_score integer, p_max_score integer, p_min_reviews integer, p_max_reviews integer, p_status text, p_genres integer[], p_genre_mode text, p_tags integer[], p_categories integer[], p_steam_deck text, p_platforms text[], p_platform_mode text, p_min_growth_7d numeric, p_max_growth_7d numeric, p_min_growth_30d numeric, p_max_growth_30d numeric, p_relationship text) IS 'Returns aggregate stats for filtered companies. Added relationship filter support (BUG #2 fix).
Note: Growth filters are placeholders - aggregate stats do not compute per-company growth.';


--
-- Name: get_companies_with_filters(text, text, text, text, integer, integer, integer, integer, bigint, bigint, integer, integer, bigint, bigint, bigint, bigint, integer, integer, integer, integer, numeric, numeric, numeric, numeric, text, integer[], text, integer[], integer[], text, text[], text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_companies_with_filters(p_type text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_sort_by text DEFAULT 'estimated_weekly_hours'::text, p_sort_order text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_min_games integer DEFAULT NULL::integer, p_max_games integer DEFAULT NULL::integer, p_min_owners bigint DEFAULT NULL::bigint, p_max_owners bigint DEFAULT NULL::bigint, p_min_ccu integer DEFAULT NULL::integer, p_max_ccu integer DEFAULT NULL::integer, p_min_hours bigint DEFAULT NULL::bigint, p_max_hours bigint DEFAULT NULL::bigint, p_min_revenue bigint DEFAULT NULL::bigint, p_max_revenue bigint DEFAULT NULL::bigint, p_min_score integer DEFAULT NULL::integer, p_max_score integer DEFAULT NULL::integer, p_min_reviews integer DEFAULT NULL::integer, p_max_reviews integer DEFAULT NULL::integer, p_min_growth_7d numeric DEFAULT NULL::numeric, p_max_growth_7d numeric DEFAULT NULL::numeric, p_min_growth_30d numeric DEFAULT NULL::numeric, p_max_growth_30d numeric DEFAULT NULL::numeric, p_period text DEFAULT 'all'::text, p_genres integer[] DEFAULT NULL::integer[], p_genre_mode text DEFAULT 'any'::text, p_tags integer[] DEFAULT NULL::integer[], p_categories integer[] DEFAULT NULL::integer[], p_steam_deck text DEFAULT NULL::text, p_platforms text[] DEFAULT NULL::text[], p_platform_mode text DEFAULT 'any'::text, p_status text DEFAULT NULL::text, p_relationship text DEFAULT NULL::text) RETURNS TABLE(id integer, name text, type text, game_count integer, total_owners bigint, total_ccu bigint, estimated_weekly_hours bigint, total_reviews bigint, positive_reviews bigint, avg_review_score smallint, revenue_estimate_cents bigint, games_trending_up integer, games_trending_down integer, ccu_growth_7d_percent numeric, ccu_growth_30d_percent numeric, review_velocity_7d numeric, review_velocity_30d numeric, is_self_published boolean, works_with_external_devs boolean, external_partner_count integer, first_release_date date, latest_release_date date, years_active integer, steam_vanity_url text, unique_developers integer, data_updated_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_needs_relationship BOOLEAN;
BEGIN
  v_needs_relationship := (p_relationship IS NOT NULL);

  -- Fast path: Use pre-computed metrics from materialized views
  IF NOT v_needs_relationship THEN
    RETURN QUERY
    WITH base_companies AS (
      SELECT
        p.id,
        p.name,
        'publisher'::TEXT AS type,
        p.game_count,
        COALESCE(pm.total_owners, 0)::BIGINT AS total_owners,
        COALESCE(pm.total_ccu, 0)::BIGINT AS total_ccu,
        COALESCE(pm.estimated_weekly_hours, 0)::BIGINT AS estimated_weekly_hours,
        COALESCE(pm.total_reviews, 0)::BIGINT AS total_reviews,
        COALESCE(pm.positive_reviews, 0)::BIGINT AS positive_reviews,
        pm.avg_review_score,
        COALESCE(pm.revenue_estimate_cents, 0)::BIGINT AS revenue_estimate_cents,
        COALESCE(pm.games_trending_up, 0)::INT AS games_trending_up,
        COALESCE(pm.games_trending_down, 0)::INT AS games_trending_down,
        COALESCE(pm.games_released_last_year, 0)::INT AS games_released_last_year,
        p.first_game_release_date,
        p.steam_vanity_url,
        COALESCE(pm.unique_developers, 0)::INT AS unique_developers,
        pm.computed_at AS data_updated_at,
        pm.genre_ids,
        pm.tag_ids,
        pm.category_ids,
        pm.best_steam_deck_category,
        pm.platform_array,
        pm.ccu_growth_7d_percent,
        pm.ccu_growth_30d_percent,
        pm.review_velocity_7d,
        pm.review_velocity_30d
      FROM publishers p
      LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE (p_type = 'all' OR p_type = 'publisher')
        AND p.game_count > 0

      UNION ALL

      SELECT
        d.id,
        d.name,
        'developer'::TEXT AS type,
        d.game_count,
        COALESCE(dm.total_owners, 0)::BIGINT AS total_owners,
        COALESCE(dm.total_ccu, 0)::BIGINT AS total_ccu,
        COALESCE(dm.estimated_weekly_hours, 0)::BIGINT AS estimated_weekly_hours,
        COALESCE(dm.total_reviews, 0)::BIGINT AS total_reviews,
        COALESCE(dm.positive_reviews, 0)::BIGINT AS positive_reviews,
        dm.avg_review_score,
        COALESCE(dm.revenue_estimate_cents, 0)::BIGINT AS revenue_estimate_cents,
        COALESCE(dm.games_trending_up, 0)::INT AS games_trending_up,
        COALESCE(dm.games_trending_down, 0)::INT AS games_trending_down,
        COALESCE(dm.games_released_last_year, 0)::INT AS games_released_last_year,
        d.first_game_release_date,
        d.steam_vanity_url,
        0::INT AS unique_developers,
        dm.computed_at AS data_updated_at,
        dm.genre_ids,
        dm.tag_ids,
        dm.category_ids,
        dm.best_steam_deck_category,
        dm.platform_array,
        dm.ccu_growth_7d_percent,
        dm.ccu_growth_30d_percent,
        dm.review_velocity_7d,
        dm.review_velocity_30d
      FROM developers d
      LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE (p_type = 'all' OR p_type = 'developer')
        AND d.game_count > 0
    ),
    filtered AS (
      SELECT bc.*
      FROM base_companies bc
      WHERE
        (p_search IS NULL OR bc.name ILIKE '%' || p_search || '%')
        AND (p_min_games IS NULL OR bc.game_count >= p_min_games)
        AND (p_max_games IS NULL OR bc.game_count <= p_max_games)
        AND (p_min_owners IS NULL OR bc.total_owners >= p_min_owners)
        AND (p_max_owners IS NULL OR bc.total_owners <= p_max_owners)
        AND (p_min_ccu IS NULL OR bc.total_ccu >= p_min_ccu)
        AND (p_max_ccu IS NULL OR bc.total_ccu <= p_max_ccu)
        AND (p_min_hours IS NULL OR bc.estimated_weekly_hours >= p_min_hours)
        AND (p_max_hours IS NULL OR bc.estimated_weekly_hours <= p_max_hours)
        AND (p_min_revenue IS NULL OR bc.revenue_estimate_cents >= p_min_revenue)
        AND (p_max_revenue IS NULL OR bc.revenue_estimate_cents <= p_max_revenue)
        AND (p_min_score IS NULL OR bc.avg_review_score >= p_min_score)
        AND (p_max_score IS NULL OR bc.avg_review_score <= p_max_score)
        AND (p_min_reviews IS NULL OR bc.total_reviews >= p_min_reviews)
        AND (p_max_reviews IS NULL OR bc.total_reviews <= p_max_reviews)
        AND (p_status IS NULL
             OR (p_status = 'active' AND bc.games_released_last_year > 0)
             OR (p_status = 'dormant' AND bc.games_released_last_year = 0))
        AND (p_genres IS NULL OR (
          CASE p_genre_mode
            WHEN 'all' THEN bc.genre_ids @> p_genres
            ELSE bc.genre_ids && p_genres
          END
        ))
        AND (p_tags IS NULL OR bc.tag_ids && p_tags)
        AND (p_categories IS NULL OR bc.category_ids && p_categories)
        AND (p_steam_deck IS NULL OR (
          CASE p_steam_deck
            WHEN 'verified' THEN bc.best_steam_deck_category = 'verified'
            WHEN 'playable' THEN bc.best_steam_deck_category IN ('verified', 'playable')
            ELSE bc.best_steam_deck_category IS NOT NULL
          END
        ))
        AND (p_platforms IS NULL OR (
          CASE p_platform_mode
            WHEN 'all' THEN bc.platform_array @> p_platforms
            ELSE bc.platform_array && p_platforms
          END
        ))
        AND (p_min_growth_7d IS NULL OR bc.ccu_growth_7d_percent >= p_min_growth_7d)
        AND (p_max_growth_7d IS NULL OR bc.ccu_growth_7d_percent <= p_max_growth_7d)
        AND (p_min_growth_30d IS NULL OR bc.ccu_growth_30d_percent >= p_min_growth_30d)
        AND (p_max_growth_30d IS NULL OR bc.ccu_growth_30d_percent <= p_max_growth_30d)
    ),
    sorted_paginated AS (
      SELECT f.*
      FROM filtered f
      ORDER BY
        CASE WHEN p_sort_order = 'asc' THEN
          CASE p_sort_by WHEN 'name' THEN f.name ELSE NULL END
        END ASC NULLS LAST,
        CASE WHEN p_sort_order = 'desc' THEN
          CASE p_sort_by WHEN 'name' THEN f.name ELSE NULL END
        END DESC NULLS LAST,
        CASE WHEN p_sort_order = 'asc' THEN
          CASE p_sort_by
            WHEN 'estimated_weekly_hours' THEN f.estimated_weekly_hours
            WHEN 'game_count' THEN f.game_count
            WHEN 'total_owners' THEN f.total_owners
            WHEN 'total_ccu' THEN f.total_ccu
            WHEN 'avg_review_score' THEN f.avg_review_score
            WHEN 'total_reviews' THEN f.total_reviews
            WHEN 'revenue_estimate_cents' THEN f.revenue_estimate_cents
            WHEN 'games_trending_up' THEN f.games_trending_up
            WHEN 'ccu_growth_7d' THEN f.ccu_growth_7d_percent
            WHEN 'ccu_growth_30d' THEN f.ccu_growth_30d_percent
            ELSE f.estimated_weekly_hours
          END
        END ASC NULLS LAST,
        CASE WHEN p_sort_order = 'desc' THEN
          CASE p_sort_by
            WHEN 'estimated_weekly_hours' THEN f.estimated_weekly_hours
            WHEN 'game_count' THEN f.game_count
            WHEN 'total_owners' THEN f.total_owners
            WHEN 'total_ccu' THEN f.total_ccu
            WHEN 'avg_review_score' THEN f.avg_review_score
            WHEN 'total_reviews' THEN f.total_reviews
            WHEN 'revenue_estimate_cents' THEN f.revenue_estimate_cents
            WHEN 'games_trending_up' THEN f.games_trending_up
            WHEN 'ccu_growth_7d' THEN f.ccu_growth_7d_percent
            WHEN 'ccu_growth_30d' THEN f.ccu_growth_30d_percent
            ELSE f.estimated_weekly_hours
          END
        END DESC NULLS LAST
      LIMIT p_limit OFFSET p_offset
    )
    SELECT
      sp.id,
      sp.name,
      sp.type,
      sp.game_count,
      sp.total_owners,
      sp.total_ccu,
      sp.estimated_weekly_hours,
      sp.total_reviews,
      sp.positive_reviews,
      sp.avg_review_score,
      sp.revenue_estimate_cents,
      sp.games_trending_up,
      sp.games_trending_down,
      sp.ccu_growth_7d_percent,
      sp.ccu_growth_30d_percent,
      sp.review_velocity_7d,
      sp.review_velocity_30d,
      NULL::BOOLEAN AS is_self_published,
      NULL::BOOLEAN AS works_with_external_devs,
      NULL::INT AS external_partner_count,
      sp.first_game_release_date AS first_release_date,
      NULL::DATE AS latest_release_date,
      EXTRACT(YEAR FROM AGE(CURRENT_DATE, sp.first_game_release_date))::INT AS years_active,
      sp.steam_vanity_url,
      sp.unique_developers,
      sp.data_updated_at
    FROM sorted_paginated sp;

  -- Slow path: Only for relationship filters
  ELSE
    RETURN QUERY
    WITH base_companies AS (
      SELECT
        p.id AS id,
        p.name AS name,
        'publisher'::TEXT AS type,
        p.game_count AS game_count,
        COALESCE(pm.total_owners, 0)::BIGINT AS total_owners,
        COALESCE(pm.total_ccu, 0)::BIGINT AS total_ccu,
        COALESCE(pm.estimated_weekly_hours, 0)::BIGINT AS estimated_weekly_hours,
        COALESCE(pm.total_reviews, 0)::BIGINT AS total_reviews,
        COALESCE(pm.positive_reviews, 0)::BIGINT AS positive_reviews,
        pm.avg_review_score AS avg_review_score,
        COALESCE(pm.revenue_estimate_cents, 0)::BIGINT AS revenue_estimate_cents,
        COALESCE(pm.games_trending_up, 0)::INT AS games_trending_up,
        COALESCE(pm.games_trending_down, 0)::INT AS games_trending_down,
        COALESCE(pm.games_released_last_year, 0)::INT AS games_released_last_year,
        p.first_game_release_date AS first_game_release_date,
        p.steam_vanity_url AS steam_vanity_url,
        COALESCE(pm.unique_developers, 0)::INT AS unique_developers,
        pm.computed_at AS data_updated_at,
        pm.genre_ids AS genre_ids,
        pm.tag_ids AS tag_ids,
        pm.category_ids AS category_ids,
        pm.best_steam_deck_category AS best_steam_deck_category,
        pm.platform_array AS platform_array,
        pm.ccu_growth_7d_percent AS ccu_growth_7d_percent,
        pm.ccu_growth_30d_percent AS ccu_growth_30d_percent,
        pm.review_velocity_7d AS review_velocity_7d,
        pm.review_velocity_30d AS review_velocity_30d
      FROM publishers p
      LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE (p_type = 'all' OR p_type = 'publisher') AND p.game_count > 0

      UNION ALL

      SELECT
        d.id AS id,
        d.name AS name,
        'developer'::TEXT AS type,
        d.game_count AS game_count,
        COALESCE(dm.total_owners, 0)::BIGINT AS total_owners,
        COALESCE(dm.total_ccu, 0)::BIGINT AS total_ccu,
        COALESCE(dm.estimated_weekly_hours, 0)::BIGINT AS estimated_weekly_hours,
        COALESCE(dm.total_reviews, 0)::BIGINT AS total_reviews,
        COALESCE(dm.positive_reviews, 0)::BIGINT AS positive_reviews,
        dm.avg_review_score AS avg_review_score,
        COALESCE(dm.revenue_estimate_cents, 0)::BIGINT AS revenue_estimate_cents,
        COALESCE(dm.games_trending_up, 0)::INT AS games_trending_up,
        COALESCE(dm.games_trending_down, 0)::INT AS games_trending_down,
        COALESCE(dm.games_released_last_year, 0)::INT AS games_released_last_year,
        d.first_game_release_date AS first_game_release_date,
        d.steam_vanity_url AS steam_vanity_url,
        0::INT AS unique_developers,
        dm.computed_at AS data_updated_at,
        dm.genre_ids AS genre_ids,
        dm.tag_ids AS tag_ids,
        dm.category_ids AS category_ids,
        dm.best_steam_deck_category AS best_steam_deck_category,
        dm.platform_array AS platform_array,
        dm.ccu_growth_7d_percent AS ccu_growth_7d_percent,
        dm.ccu_growth_30d_percent AS ccu_growth_30d_percent,
        dm.review_velocity_7d AS review_velocity_7d,
        dm.review_velocity_30d AS review_velocity_30d
      FROM developers d
      LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE (p_type = 'all' OR p_type = 'developer') AND d.game_count > 0
    ),
    filtered AS (
      SELECT bc.* FROM base_companies bc
      WHERE (p_search IS NULL OR bc.name ILIKE '%' || p_search || '%')
        AND (p_min_games IS NULL OR bc.game_count >= p_min_games)
        AND (p_max_games IS NULL OR bc.game_count <= p_max_games)
        AND (p_min_owners IS NULL OR bc.total_owners >= p_min_owners)
        AND (p_max_owners IS NULL OR bc.total_owners <= p_max_owners)
        AND (p_min_ccu IS NULL OR bc.total_ccu >= p_min_ccu)
        AND (p_max_ccu IS NULL OR bc.total_ccu <= p_max_ccu)
        AND (p_min_hours IS NULL OR bc.estimated_weekly_hours >= p_min_hours)
        AND (p_max_hours IS NULL OR bc.estimated_weekly_hours <= p_max_hours)
        AND (p_min_revenue IS NULL OR bc.revenue_estimate_cents >= p_min_revenue)
        AND (p_max_revenue IS NULL OR bc.revenue_estimate_cents <= p_max_revenue)
        AND (p_min_score IS NULL OR bc.avg_review_score >= p_min_score)
        AND (p_max_score IS NULL OR bc.avg_review_score <= p_max_score)
        AND (p_min_reviews IS NULL OR bc.total_reviews >= p_min_reviews)
        AND (p_max_reviews IS NULL OR bc.total_reviews <= p_max_reviews)
        AND (p_status IS NULL
             OR (p_status = 'active' AND bc.games_released_last_year > 0)
             OR (p_status = 'dormant' AND bc.games_released_last_year = 0))
        AND (p_genres IS NULL OR (
          CASE p_genre_mode
            WHEN 'all' THEN bc.genre_ids @> p_genres
            ELSE bc.genre_ids && p_genres
          END
        ))
        AND (p_tags IS NULL OR bc.tag_ids && p_tags)
        AND (p_categories IS NULL OR bc.category_ids && p_categories)
        AND (p_steam_deck IS NULL OR (
          CASE p_steam_deck
            WHEN 'verified' THEN bc.best_steam_deck_category = 'verified'
            WHEN 'playable' THEN bc.best_steam_deck_category IN ('verified', 'playable')
            ELSE bc.best_steam_deck_category IS NOT NULL
          END
        ))
        AND (p_platforms IS NULL OR (
          CASE p_platform_mode
            WHEN 'all' THEN bc.platform_array @> p_platforms
            ELSE bc.platform_array && p_platforms
          END
        ))
        AND (p_min_growth_7d IS NULL OR bc.ccu_growth_7d_percent >= p_min_growth_7d)
        AND (p_max_growth_7d IS NULL OR bc.ccu_growth_7d_percent <= p_max_growth_7d)
        AND (p_min_growth_30d IS NULL OR bc.ccu_growth_30d_percent >= p_min_growth_30d)
        AND (p_max_growth_30d IS NULL OR bc.ccu_growth_30d_percent <= p_max_growth_30d)
    ),
    with_relationships AS (
      SELECT f.*,
        CASE WHEN f.type = 'publisher' THEN
          NOT EXISTS (SELECT 1 FROM app_publishers ap JOIN publishers pub ON pub.id = ap.publisher_id
                      WHERE ap.publisher_id = f.id AND NOT EXISTS (
                        SELECT 1 FROM app_developers ad JOIN developers dev ON dev.id = ad.developer_id
                        WHERE ad.appid = ap.appid AND LOWER(TRIM(dev.name)) = LOWER(TRIM(pub.name))))
        ELSE NOT EXISTS (SELECT 1 FROM app_developers ad JOIN developers dev ON dev.id = ad.developer_id
                         WHERE ad.developer_id = f.id AND NOT EXISTS (
                           SELECT 1 FROM app_publishers ap JOIN publishers pub ON pub.id = ap.publisher_id
                           WHERE ap.appid = ad.appid AND LOWER(TRIM(pub.name)) = LOWER(TRIM(dev.name))))
        END AS is_self_pub,
        CASE WHEN f.type = 'publisher' THEN
          (SELECT COUNT(DISTINCT dev.id) FROM app_publishers ap
           JOIN app_developers ad ON ad.appid = ap.appid JOIN developers dev ON dev.id = ad.developer_id
           JOIN publishers pub ON pub.id = ap.publisher_id
           WHERE ap.publisher_id = f.id AND LOWER(TRIM(dev.name)) != LOWER(TRIM(pub.name)))::INT
        ELSE (SELECT COUNT(DISTINCT pub.id) FROM app_developers ad
              JOIN app_publishers ap ON ap.appid = ad.appid JOIN publishers pub ON pub.id = ap.publisher_id
              JOIN developers dev ON dev.id = ad.developer_id
              WHERE ad.developer_id = f.id AND LOWER(TRIM(pub.name)) != LOWER(TRIM(dev.name)))::INT
        END AS ext_partner_count,
        CASE WHEN f.type = 'publisher' THEN
          (SELECT MAX(a.release_date) FROM app_publishers ap JOIN apps a ON a.appid = ap.appid WHERE ap.publisher_id = f.id AND a.release_date IS NOT NULL)
        ELSE (SELECT MAX(a.release_date) FROM app_developers ad JOIN apps a ON a.appid = ad.appid WHERE ad.developer_id = f.id AND a.release_date IS NOT NULL)
        END AS latest_rel_date
      FROM filtered f
    ),
    final_filtered AS (
      SELECT * FROM with_relationships wr
      WHERE (p_relationship IS NULL
             OR (p_relationship = 'self_published' AND wr.is_self_pub = TRUE)
             OR (p_relationship = 'external_devs' AND wr.is_self_pub = FALSE AND wr.type = 'publisher')
             OR (p_relationship = 'multi_publisher' AND wr.ext_partner_count > 1 AND wr.type = 'developer'))
    )
    SELECT ff.id, ff.name, ff.type, ff.game_count, ff.total_owners, ff.total_ccu, ff.estimated_weekly_hours,
      ff.total_reviews, ff.positive_reviews, ff.avg_review_score, ff.revenue_estimate_cents,
      ff.games_trending_up, ff.games_trending_down, ff.ccu_growth_7d_percent, ff.ccu_growth_30d_percent,
      ff.review_velocity_7d, ff.review_velocity_30d,
      ff.is_self_pub, (ff.ext_partner_count > 0),
      ff.ext_partner_count, ff.first_game_release_date, ff.latest_rel_date,
      EXTRACT(YEAR FROM AGE(COALESCE(ff.latest_rel_date, CURRENT_DATE), ff.first_game_release_date))::INT,
      ff.steam_vanity_url, ff.unique_developers, ff.data_updated_at
    FROM final_filtered ff
    ORDER BY
      CASE WHEN p_sort_order = 'asc' THEN CASE p_sort_by WHEN 'name' THEN ff.name ELSE NULL END END ASC NULLS LAST,
      CASE WHEN p_sort_order = 'desc' THEN CASE p_sort_by WHEN 'name' THEN ff.name ELSE NULL END END DESC NULLS LAST,
      CASE WHEN p_sort_order = 'asc' THEN
        CASE p_sort_by
          WHEN 'estimated_weekly_hours' THEN ff.estimated_weekly_hours WHEN 'game_count' THEN ff.game_count
          WHEN 'total_owners' THEN ff.total_owners WHEN 'total_ccu' THEN ff.total_ccu
          WHEN 'avg_review_score' THEN ff.avg_review_score WHEN 'total_reviews' THEN ff.total_reviews
          WHEN 'revenue_estimate_cents' THEN ff.revenue_estimate_cents WHEN 'games_trending_up' THEN ff.games_trending_up
          WHEN 'ccu_growth_7d' THEN ff.ccu_growth_7d_percent WHEN 'ccu_growth_30d' THEN ff.ccu_growth_30d_percent
          ELSE ff.estimated_weekly_hours END
      END ASC NULLS LAST,
      CASE WHEN p_sort_order = 'desc' THEN
        CASE p_sort_by
          WHEN 'estimated_weekly_hours' THEN ff.estimated_weekly_hours WHEN 'game_count' THEN ff.game_count
          WHEN 'total_owners' THEN ff.total_owners WHEN 'total_ccu' THEN ff.total_ccu
          WHEN 'avg_review_score' THEN ff.avg_review_score WHEN 'total_reviews' THEN ff.total_reviews
          WHEN 'revenue_estimate_cents' THEN ff.revenue_estimate_cents WHEN 'games_trending_up' THEN ff.games_trending_up
          WHEN 'ccu_growth_7d' THEN ff.ccu_growth_7d_percent WHEN 'ccu_growth_30d' THEN ff.ccu_growth_30d_percent
          ELSE ff.estimated_weekly_hours END
      END DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset;
  END IF;
END;
$$;


--
-- Name: FUNCTION get_companies_with_filters(p_type text, p_search text, p_sort_by text, p_sort_order text, p_limit integer, p_offset integer, p_min_games integer, p_max_games integer, p_min_owners bigint, p_max_owners bigint, p_min_ccu integer, p_max_ccu integer, p_min_hours bigint, p_max_hours bigint, p_min_revenue bigint, p_max_revenue bigint, p_min_score integer, p_max_score integer, p_min_reviews integer, p_max_reviews integer, p_min_growth_7d numeric, p_max_growth_7d numeric, p_min_growth_30d numeric, p_max_growth_30d numeric, p_period text, p_genres integer[], p_genre_mode text, p_tags integer[], p_categories integer[], p_steam_deck text, p_platforms text[], p_platform_mode text, p_status text, p_relationship text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_companies_with_filters(p_type text, p_search text, p_sort_by text, p_sort_order text, p_limit integer, p_offset integer, p_min_games integer, p_max_games integer, p_min_owners bigint, p_max_owners bigint, p_min_ccu integer, p_max_ccu integer, p_min_hours bigint, p_max_hours bigint, p_min_revenue bigint, p_max_revenue bigint, p_min_score integer, p_max_score integer, p_min_reviews integer, p_max_reviews integer, p_min_growth_7d numeric, p_max_growth_7d numeric, p_min_growth_30d numeric, p_max_growth_30d numeric, p_period text, p_genres integer[], p_genre_mode text, p_tags integer[], p_categories integer[], p_steam_deck text, p_platforms text[], p_platform_mode text, p_status text, p_relationship text) IS 'Unified RPC for /companies page with 3-day growth windows and velocity metrics.';


--
-- Name: get_company_sparkline_data(integer, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_company_sparkline_data(p_company_id integer, p_company_type text, p_days integer DEFAULT 7) RETURNS TABLE(day date, total_ccu bigint, peak_ccu bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF p_company_type = 'publisher' THEN
    RETURN QUERY
    SELECT DATE(cs.snapshot_time), SUM(cs.player_count)::BIGINT, MAX(cs.player_count)::BIGINT
    FROM ccu_snapshots cs JOIN app_publishers ap ON ap.appid = cs.appid
    WHERE ap.publisher_id = p_company_id AND cs.snapshot_time > NOW() - (p_days || ' days')::INTERVAL
    GROUP BY DATE(cs.snapshot_time) ORDER BY DATE(cs.snapshot_time);
  ELSE
    RETURN QUERY
    SELECT DATE(cs.snapshot_time), SUM(cs.player_count)::BIGINT, MAX(cs.player_count)::BIGINT
    FROM ccu_snapshots cs JOIN app_developers ad ON ad.appid = cs.appid
    WHERE ad.developer_id = p_company_id AND cs.snapshot_time > NOW() - (p_days || ' days')::INTERVAL
    GROUP BY DATE(cs.snapshot_time) ORDER BY DATE(cs.snapshot_time);
  END IF;
END;
$$;


--
-- Name: FUNCTION get_company_sparkline_data(p_company_id integer, p_company_type text, p_days integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_company_sparkline_data(p_company_id integer, p_company_type text, p_days integer) IS 'Returns daily CCU for sparklines';


--
-- Name: get_credit_balance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_credit_balance(p_user_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role user_role;
BEGIN
    v_caller_id := auth.uid();

    -- Allow if requesting own balance
    IF v_caller_id = p_user_id THEN
        RETURN (SELECT credit_balance FROM user_profiles WHERE id = p_user_id);
    END IF;

    -- Allow if caller is admin
    SELECT role INTO v_caller_role FROM user_profiles WHERE id = v_caller_id;
    IF v_caller_role = 'admin' THEN
        RETURN (SELECT credit_balance FROM user_profiles WHERE id = p_user_id);
    END IF;

    -- Unauthorized
    RETURN NULL;
END;
$$;


--
-- Name: get_current_catalog_appids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_catalog_appids() RETURNS TABLE(appid integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH latest_successful_applist AS (
    SELECT j.started_at
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'completed'
      AND COALESCE(j.items_failed, 0) = 0
    ORDER BY j.started_at DESC
    LIMIT 1
  ),
  catalog_ready AS (
    SELECT EXISTS(
      SELECT 1
      FROM public.apps a
      JOIN latest_successful_applist l
        ON a.last_seen_in_steam_applist_at = l.started_at
    ) AS ready
  )
  SELECT a.appid
  FROM public.apps a
  JOIN latest_successful_applist l
    ON a.last_seen_in_steam_applist_at = l.started_at
  CROSS JOIN catalog_ready cr
  WHERE cr.ready = TRUE

  UNION

  SELECT s.appid
  FROM public.sync_status s
  CROSS JOIN catalog_ready cr
  WHERE cr.ready = FALSE
    AND s.is_syncable = TRUE;
$$;


--
-- Name: FUNCTION get_current_catalog_appids(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_current_catalog_appids() IS 'Returns appids in the current live catalog. Falls back to syncable apps until the first clean applist snapshot exists.';


--
-- Name: get_developer_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_developer_stats() RETURNS json
    LANGUAGE plpgsql
    AS $$
DECLARE
  result JSON;
  one_year_ago DATE := CURRENT_DATE - INTERVAL '1 year';
BEGIN
  SELECT json_build_object(
    'total', COUNT(*),
    'prolific', COUNT(*) FILTER (WHERE game_count >= 5),
    'recentlyActive', COUNT(*) FILTER (WHERE first_game_release_date >= one_year_ago)
  ) INTO result
  FROM developers;

  RETURN result;
END;
$$;


--
-- Name: FUNCTION get_developer_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_developer_stats() IS 'Returns developer counts (total, prolific, recently active) in a single query';


--
-- Name: get_developers_for_embedding(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_developers_for_embedding(p_limit integer DEFAULT 500) RETURNS TABLE(id integer, name text, game_count integer, first_game_release_date date, is_indie boolean, top_genres text[], top_tags text[], platforms_supported text[], total_reviews bigint, avg_review_percentage numeric, top_game_names text[], top_game_appids integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.name,
        d.game_count,
        d.first_game_release_date,
        -- Check if self-published (indie)
        EXISTS (
            SELECT 1
            FROM app_developers ad_check
            JOIN app_publishers ap_check ON ad_check.appid = ap_check.appid
            JOIN publishers pub_check ON ap_check.publisher_id = pub_check.id
            WHERE ad_check.developer_id = d.id AND pub_check.name = d.name
        ) as is_indie,
        -- Top genres
        ARRAY(
            SELECT sg.name
            FROM steam_genres sg
            JOIN app_genres ag_inner ON sg.genre_id = ag_inner.genre_id
            JOIN app_developers ad_inner ON ag_inner.appid = ad_inner.appid
            WHERE ad_inner.developer_id = d.id
            GROUP BY sg.name
            ORDER BY COUNT(*) DESC
            LIMIT 5
        ) as top_genres,
        -- Top tags
        ARRAY(
            SELECT st.name
            FROM steam_tags st
            JOIN app_steam_tags ast_inner ON st.tag_id = ast_inner.tag_id
            JOIN app_developers ad_inner ON ast_inner.appid = ad_inner.appid
            WHERE ad_inner.developer_id = d.id
            GROUP BY st.name
            ORDER BY COUNT(*) DESC
            LIMIT 10
        ) as top_tags,
        -- Platforms
        ARRAY(
            SELECT DISTINCT unnest(string_to_array(apps_inner.platforms, ','))
            FROM apps apps_inner
            JOIN app_developers ad_inner ON apps_inner.appid = ad_inner.appid
            WHERE ad_inner.developer_id = d.id AND apps_inner.platforms IS NOT NULL
        ) as platforms_supported,
        -- Total reviews
        COALESCE((
            SELECT SUM(COALESCE(dm_sub.reviews_total, 0))
            FROM app_developers ad_sub
            JOIN apps apps_sub ON ad_sub.appid = apps_sub.appid
            LEFT JOIN LATERAL (
                SELECT dm_inner.total_reviews as reviews_total FROM daily_metrics dm_inner
                WHERE dm_inner.appid = apps_sub.appid ORDER BY dm_inner.metric_date DESC LIMIT 1
            ) dm_sub ON TRUE
            WHERE ad_sub.developer_id = d.id
        ), 0) as total_reviews,
        -- Avg review percentage
        (
            SELECT AVG(apps_sub.pics_review_percentage)
            FROM app_developers ad_sub
            JOIN apps apps_sub ON ad_sub.appid = apps_sub.appid
            WHERE ad_sub.developer_id = d.id AND apps_sub.pics_review_percentage IS NOT NULL
        ) as avg_review_percentage,
        -- Top games
        ARRAY(
            SELECT apps_sub.name
            FROM app_developers ad_sub
            JOIN apps apps_sub ON ad_sub.appid = apps_sub.appid
            LEFT JOIN LATERAL (
                SELECT dm_inner.total_reviews as reviews_total FROM daily_metrics dm_inner
                WHERE dm_inner.appid = apps_sub.appid ORDER BY dm_inner.metric_date DESC LIMIT 1
            ) dm_sub ON TRUE
            WHERE ad_sub.developer_id = d.id AND apps_sub.type = 'game'
            ORDER BY COALESCE(dm_sub.reviews_total, 0) DESC
            LIMIT 10
        ) as top_game_names,
        ARRAY(
            SELECT apps_sub.appid
            FROM app_developers ad_sub
            JOIN apps apps_sub ON ad_sub.appid = apps_sub.appid
            LEFT JOIN LATERAL (
                SELECT dm_inner.total_reviews as reviews_total FROM daily_metrics dm_inner
                WHERE dm_inner.appid = apps_sub.appid ORDER BY dm_inner.metric_date DESC LIMIT 1
            ) dm_sub ON TRUE
            WHERE ad_sub.developer_id = d.id AND apps_sub.type = 'game'
            ORDER BY COALESCE(dm_sub.reviews_total, 0) DESC
            LIMIT 10
        ) as top_game_appids
    FROM developers d
    WHERE d.game_count > 0
    ORDER BY d.game_count DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: get_developers_needing_embedding(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_developers_needing_embedding(p_limit integer DEFAULT 100) RETURNS TABLE(id integer, name text, game_count integer, first_game_release_date date, is_indie boolean, top_genres text[], top_tags text[], platforms_supported text[], total_reviews bigint, avg_review_percentage numeric, top_game_names text[], top_game_appids integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Step 1: Filter to qualifying developers first (with LIMIT)
    -- Use 'did' alias to avoid conflict with RETURNS TABLE 'id' column
    filtered_devs AS (
        SELECT d.id as did
        FROM developers d
        WHERE d.game_count > 0
          AND (
            d.last_embedding_sync IS NULL
            OR d.updated_at > d.last_embedding_sync
          )
        ORDER BY
          CASE WHEN d.last_embedding_sync IS NULL THEN 0 ELSE 1 END,
          d.game_count DESC
        LIMIT p_limit
    ),
    -- Step 2: Pre-aggregate top genres for all filtered developers
    dev_genres AS (
        SELECT ad.developer_id as did, array_agg(DISTINCT sg.name) as genre_names
        FROM app_developers ad
        JOIN app_genres ag ON ag.appid = ad.appid
        JOIN steam_genres sg ON sg.genre_id = ag.genre_id
        WHERE ad.developer_id IN (SELECT fd.did FROM filtered_devs fd)
        GROUP BY ad.developer_id
    ),
    -- Step 3: Pre-aggregate top tags for all filtered developers
    dev_tags AS (
        SELECT ad.developer_id as did, array_agg(DISTINCT st.name) as tag_names
        FROM app_developers ad
        JOIN app_steam_tags ast ON ast.appid = ad.appid AND ast.rank <= 10
        JOIN steam_tags st ON st.tag_id = ast.tag_id
        WHERE ad.developer_id IN (SELECT fd.did FROM filtered_devs fd)
        GROUP BY ad.developer_id
    ),
    -- Step 4: Pre-aggregate platforms for all filtered developers
    dev_platforms AS (
        SELECT ad.developer_id as did, array_agg(DISTINCT plat.platform) as platforms
        FROM app_developers ad
        JOIN apps a ON a.appid = ad.appid
        CROSS JOIN LATERAL unnest(string_to_array(a.platforms, ',')) as plat(platform)
        WHERE ad.developer_id IN (SELECT fd.did FROM filtered_devs fd)
          AND a.platforms IS NOT NULL
        GROUP BY ad.developer_id
    ),
    -- Step 5: Pre-aggregate review stats for all filtered developers
    dev_reviews AS (
        SELECT ad.developer_id as did,
               AVG(a.pics_review_percentage) as avg_review
        FROM app_developers ad
        JOIN apps a ON a.appid = ad.appid
        WHERE ad.developer_id IN (SELECT fd.did FROM filtered_devs fd)
          AND a.pics_review_percentage IS NOT NULL
        GROUP BY ad.developer_id
    ),
    -- Step 6: Pre-aggregate top games for all filtered developers
    dev_games AS (
        SELECT ad.developer_id as did,
               array_agg(a.name ORDER BY a.appid) as game_names,
               array_agg(a.appid ORDER BY a.appid) as game_appids
        FROM app_developers ad
        JOIN apps a ON a.appid = ad.appid AND a.type = 'game'
        WHERE ad.developer_id IN (SELECT fd.did FROM filtered_devs fd)
        GROUP BY ad.developer_id
    ),
    -- Step 7: Check if developer is indie (self-published)
    dev_indie AS (
        SELECT d.id as did,
               EXISTS (
                 SELECT 1
                 FROM app_developers ad
                 JOIN app_publishers ap ON ad.appid = ap.appid
                 JOIN publishers pub ON ap.publisher_id = pub.id
                 WHERE ad.developer_id = d.id AND pub.name = d.name
                 LIMIT 1
               ) as is_indie_flag
        FROM developers d
        WHERE d.id IN (SELECT fd.did FROM filtered_devs fd)
    )
    -- Final SELECT: Join all pre-aggregated data
    SELECT
        d.id,
        d.name,
        d.game_count,
        d.first_game_release_date,
        COALESCE(di.is_indie_flag, FALSE) as is_indie,
        COALESCE((SELECT array_agg(x) FROM (SELECT unnest(dg.genre_names) LIMIT 5) t(x)), '{}') as top_genres,
        COALESCE((SELECT array_agg(x) FROM (SELECT unnest(dt.tag_names) LIMIT 10) t(x)), '{}') as top_tags,
        COALESCE((SELECT array_agg(trim(x)) FROM (SELECT unnest(dp.platforms) LIMIT 3) t(x)), '{}') as platforms_supported,
        0::BIGINT as total_reviews,  -- Simplified to avoid timeout
        dr.avg_review as avg_review_percentage,
        COALESCE(dga.game_names[1:10], '{}') as top_game_names,
        COALESCE(dga.game_appids[1:10], '{}') as top_game_appids
    FROM developers d
    JOIN filtered_devs fd ON fd.did = d.id
    LEFT JOIN dev_genres dg ON dg.did = d.id
    LEFT JOIN dev_tags dt ON dt.did = d.id
    LEFT JOIN dev_platforms dp ON dp.did = d.id
    LEFT JOIN dev_reviews dr ON dr.did = d.id
    LEFT JOIN dev_games dga ON dga.did = d.id
    LEFT JOIN dev_indie di ON di.did = d.id;
END;
$$;


--
-- Name: get_developers_with_metrics(text, bigint, bigint, smallint, integer, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_developers_with_metrics(p_search text DEFAULT NULL::text, p_min_owners bigint DEFAULT NULL::bigint, p_min_ccu bigint DEFAULT NULL::bigint, p_min_score smallint DEFAULT NULL::smallint, p_min_games integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_sort_field text DEFAULT 'game_count'::text, p_sort_order text DEFAULT 'desc'::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id integer, name text, normalized_name text, steam_vanity_url text, first_game_release_date date, game_count integer, total_owners_min bigint, total_owners_max bigint, total_ccu_peak bigint, max_ccu_peak integer, total_reviews bigint, weighted_review_score smallint, estimated_revenue_usd bigint, games_trending_up integer, games_trending_down integer, games_released_last_year integer, computed_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.name,
    d.normalized_name,
    d.steam_vanity_url,
    d.first_game_release_date,
    d.game_count,
    COALESCE(dm.total_owners, 0)::BIGINT AS total_owners_min,
    COALESCE(dm.total_owners, 0)::BIGINT AS total_owners_max,
    COALESCE(dm.total_ccu, 0)::BIGINT AS total_ccu_peak,
    COALESCE(dm.total_ccu, 0)::INTEGER AS max_ccu_peak,
    COALESCE(dm.total_reviews, 0)::BIGINT,
    CASE
      WHEN dm.avg_review_score IS NULL THEN NULL
      ELSE ROUND(dm.avg_review_score)::SMALLINT
    END AS weighted_review_score,
    COALESCE(ROUND(dm.revenue_estimate_cents::NUMERIC / 100), 0)::BIGINT AS estimated_revenue_usd,
    COALESCE(dm.games_trending_up, 0)::INTEGER,
    COALESCE(dm.games_trending_down, 0)::INTEGER,
    COALESCE(dm.games_released_last_year, 0)::INTEGER,
    dm.computed_at
  FROM public.developers d
  LEFT JOIN public.developer_metrics dm ON dm.developer_id = d.id
  WHERE
    (p_search IS NULL OR d.name ILIKE '%' || p_search || '%')
    AND (p_min_owners IS NULL OR COALESCE(dm.total_owners, 0) >= p_min_owners)
    AND (p_min_ccu IS NULL OR COALESCE(dm.total_ccu, 0) >= p_min_ccu)
    AND (
      p_min_score IS NULL
      OR COALESCE(ROUND(dm.avg_review_score), 0) >= p_min_score
    )
    AND (p_min_games IS NULL OR d.game_count >= p_min_games)
    AND (
      p_status IS NULL
      OR (p_status = 'active' AND COALESCE(dm.games_released_last_year, 0) > 0)
      OR (p_status = 'dormant' AND COALESCE(dm.games_released_last_year, 0) = 0)
    )
  ORDER BY
    CASE
      WHEN p_sort_order = 'asc' AND p_sort_field = 'name' THEN d.name
      ELSE NULL
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_order = 'desc' AND p_sort_field = 'name' THEN d.name
      ELSE NULL
    END DESC NULLS LAST,
    CASE
      WHEN p_sort_order = 'asc' AND p_sort_field = 'first_game_release_date' THEN d.first_game_release_date
      ELSE NULL
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_order = 'desc' AND p_sort_field = 'first_game_release_date' THEN d.first_game_release_date
      ELSE NULL
    END DESC NULLS LAST,
    CASE
      WHEN p_sort_order = 'asc' THEN
        CASE p_sort_field
          WHEN 'game_count' THEN d.game_count::NUMERIC
          WHEN 'total_owners_max' THEN COALESCE(dm.total_owners, 0)::NUMERIC
          WHEN 'total_ccu_peak' THEN COALESCE(dm.total_ccu, 0)::NUMERIC
          WHEN 'weighted_review_score' THEN COALESCE(ROUND(dm.avg_review_score), 0)::NUMERIC
          WHEN 'estimated_revenue_usd' THEN COALESCE(ROUND(dm.revenue_estimate_cents::NUMERIC / 100), 0)
          WHEN 'games_trending_up' THEN COALESCE(dm.games_trending_up, 0)::NUMERIC
          ELSE d.game_count::NUMERIC
        END
      ELSE NULL
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_order = 'desc' THEN
        CASE p_sort_field
          WHEN 'game_count' THEN d.game_count::NUMERIC
          WHEN 'total_owners_max' THEN COALESCE(dm.total_owners, 0)::NUMERIC
          WHEN 'total_ccu_peak' THEN COALESCE(dm.total_ccu, 0)::NUMERIC
          WHEN 'weighted_review_score' THEN COALESCE(ROUND(dm.avg_review_score), 0)::NUMERIC
          WHEN 'estimated_revenue_usd' THEN COALESCE(ROUND(dm.revenue_estimate_cents::NUMERIC / 100), 0)
          WHEN 'games_trending_up' THEN COALESCE(dm.games_trending_up, 0)::NUMERIC
          ELSE d.game_count::NUMERIC
        END
      ELSE NULL
    END DESC NULLS LAST,
    d.name ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


--
-- Name: FUNCTION get_developers_with_metrics(p_search text, p_min_owners bigint, p_min_ccu bigint, p_min_score smallint, p_min_games integer, p_status text, p_sort_field text, p_sort_order text, p_limit integer, p_offset integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_developers_with_metrics(p_search text, p_min_owners bigint, p_min_ccu bigint, p_min_score smallint, p_min_games integer, p_status text, p_sort_field text, p_sort_order text, p_limit integer, p_offset integer) IS 'Fetches developers with aggregated metrics, supporting server-side filtering and sorting';


--
-- Name: get_filter_option_counts(text, text, integer, bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_filter_option_counts(p_filter_type text, p_company_type text DEFAULT 'all'::text, p_min_games integer DEFAULT NULL::integer, p_min_revenue bigint DEFAULT NULL::bigint, p_status text DEFAULT NULL::text) RETURNS TABLE(option_id integer, option_name text, company_count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    SET statement_timeout TO '30s'
    AS $$
BEGIN
  -- GENRE filter
  IF p_filter_type = 'genre' THEN
    RETURN QUERY
    WITH valid_publishers AS (
      SELECT p.id FROM publishers p
      LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE p_company_type IN ('all', 'publisher')
        AND (p_min_games IS NULL OR p.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(pm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(pm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(pm.games_released_last_year, 0) = 0))
    ),
    valid_developers AS (
      SELECT d.id FROM developers d
      LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE p_company_type IN ('all', 'developer')
        AND (p_min_games IS NULL OR d.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(dm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(dm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(dm.games_released_last_year, 0) = 0))
    ),
    pub_counts AS (
      SELECT ag.genre_id, COUNT(DISTINCT ap.publisher_id) as cnt
      FROM app_genres ag
      JOIN app_publishers ap ON ap.appid = ag.appid
      WHERE ap.publisher_id IN (SELECT id FROM valid_publishers)
      GROUP BY ag.genre_id
    ),
    dev_counts AS (
      SELECT ag.genre_id, COUNT(DISTINCT ad.developer_id) as cnt
      FROM app_genres ag
      JOIN app_developers ad ON ad.appid = ag.appid
      WHERE ad.developer_id IN (SELECT id FROM valid_developers)
      GROUP BY ag.genre_id
    )
    SELECT sg.genre_id, sg.name, (COALESCE(pc.cnt, 0) + COALESCE(dc.cnt, 0))::BIGINT
    FROM steam_genres sg
    LEFT JOIN pub_counts pc ON pc.genre_id = sg.genre_id
    LEFT JOIN dev_counts dc ON dc.genre_id = sg.genre_id
    WHERE EXISTS (SELECT 1 FROM app_genres ag WHERE ag.genre_id = sg.genre_id)
    ORDER BY 3 DESC, 2;

  -- TAG filter
  ELSIF p_filter_type = 'tag' THEN
    RETURN QUERY
    WITH valid_publishers AS (
      SELECT p.id FROM publishers p
      LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE p_company_type IN ('all', 'publisher')
        AND (p_min_games IS NULL OR p.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(pm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(pm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(pm.games_released_last_year, 0) = 0))
    ),
    valid_developers AS (
      SELECT d.id FROM developers d
      LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE p_company_type IN ('all', 'developer')
        AND (p_min_games IS NULL OR d.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(dm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(dm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(dm.games_released_last_year, 0) = 0))
    ),
    pub_counts AS (
      SELECT ast.tag_id, COUNT(DISTINCT ap.publisher_id) as cnt
      FROM app_steam_tags ast
      JOIN app_publishers ap ON ap.appid = ast.appid
      WHERE ap.publisher_id IN (SELECT id FROM valid_publishers)
      GROUP BY ast.tag_id
    ),
    dev_counts AS (
      SELECT ast.tag_id, COUNT(DISTINCT ad.developer_id) as cnt
      FROM app_steam_tags ast
      JOIN app_developers ad ON ad.appid = ast.appid
      WHERE ad.developer_id IN (SELECT id FROM valid_developers)
      GROUP BY ast.tag_id
    )
    SELECT st.tag_id, st.name, (COALESCE(pc.cnt, 0) + COALESCE(dc.cnt, 0))::BIGINT
    FROM steam_tags st
    LEFT JOIN pub_counts pc ON pc.tag_id = st.tag_id
    LEFT JOIN dev_counts dc ON dc.tag_id = st.tag_id
    WHERE EXISTS (SELECT 1 FROM app_steam_tags ast WHERE ast.tag_id = st.tag_id)
    ORDER BY 3 DESC, 2
    LIMIT 50;

  -- CATEGORY filter
  ELSIF p_filter_type = 'category' THEN
    RETURN QUERY
    WITH valid_publishers AS (
      SELECT p.id FROM publishers p
      LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE p_company_type IN ('all', 'publisher')
        AND (p_min_games IS NULL OR p.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(pm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(pm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(pm.games_released_last_year, 0) = 0))
    ),
    valid_developers AS (
      SELECT d.id FROM developers d
      LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE p_company_type IN ('all', 'developer')
        AND (p_min_games IS NULL OR d.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(dm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(dm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(dm.games_released_last_year, 0) = 0))
    ),
    pub_counts AS (
      SELECT ac.category_id, COUNT(DISTINCT ap.publisher_id) as cnt
      FROM app_categories ac
      JOIN app_publishers ap ON ap.appid = ac.appid
      WHERE ap.publisher_id IN (SELECT id FROM valid_publishers)
      GROUP BY ac.category_id
    ),
    dev_counts AS (
      SELECT ac.category_id, COUNT(DISTINCT ad.developer_id) as cnt
      FROM app_categories ac
      JOIN app_developers ad ON ad.appid = ac.appid
      WHERE ad.developer_id IN (SELECT id FROM valid_developers)
      GROUP BY ac.category_id
    )
    SELECT sc.category_id, sc.name, (COALESCE(pc.cnt, 0) + COALESCE(dc.cnt, 0))::BIGINT
    FROM steam_categories sc
    LEFT JOIN pub_counts pc ON pc.category_id = sc.category_id
    LEFT JOIN dev_counts dc ON dc.category_id = sc.category_id
    WHERE EXISTS (SELECT 1 FROM app_categories ac WHERE ac.category_id = sc.category_id)
    ORDER BY 3 DESC, 2;

  -- STEAM_DECK filter
  ELSIF p_filter_type = 'steam_deck' THEN
    RETURN QUERY
    WITH valid_publishers AS (
      SELECT p.id FROM publishers p
      LEFT JOIN publisher_metrics pm ON pm.publisher_id = p.id
      WHERE p_company_type IN ('all', 'publisher')
        AND (p_min_games IS NULL OR p.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(pm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(pm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(pm.games_released_last_year, 0) = 0))
    ),
    valid_developers AS (
      SELECT d.id FROM developers d
      LEFT JOIN developer_metrics dm ON dm.developer_id = d.id
      WHERE p_company_type IN ('all', 'developer')
        AND (p_min_games IS NULL OR d.game_count >= p_min_games)
        AND (p_min_revenue IS NULL OR COALESCE(dm.revenue_estimate_cents, 0) >= p_min_revenue)
        AND (p_status IS NULL
             OR (p_status = 'active' AND COALESCE(dm.games_released_last_year, 0) > 0)
             OR (p_status = 'dormant' AND COALESCE(dm.games_released_last_year, 0) = 0))
    ),
    pub_counts AS (
      SELECT asd.category, COUNT(DISTINCT ap.publisher_id) as cnt
      FROM app_steam_deck asd
      JOIN app_publishers ap ON ap.appid = asd.appid
      WHERE ap.publisher_id IN (SELECT id FROM valid_publishers)
        AND asd.category IS NOT NULL
      GROUP BY asd.category
    ),
    dev_counts AS (
      SELECT asd.category, COUNT(DISTINCT ad.developer_id) as cnt
      FROM app_steam_deck asd
      JOIN app_developers ad ON ad.appid = asd.appid
      WHERE ad.developer_id IN (SELECT id FROM valid_developers)
        AND asd.category IS NOT NULL
      GROUP BY asd.category
    )
    SELECT
      CASE cat.category WHEN 'verified' THEN 1 WHEN 'playable' THEN 2 WHEN 'unsupported' THEN 3 ELSE 4 END,
      cat.category::TEXT,
      (COALESCE(pc.cnt, 0) + COALESCE(dc.cnt, 0))::BIGINT
    FROM (SELECT DISTINCT category FROM app_steam_deck WHERE category IS NOT NULL) cat
    LEFT JOIN pub_counts pc ON pc.category = cat.category
    LEFT JOIN dev_counts dc ON dc.category = cat.category
    ORDER BY 1;

  ELSE
    RETURN;
  END IF;
END;
$$;


--
-- Name: FUNCTION get_filter_option_counts(p_filter_type text, p_company_type text, p_min_games integer, p_min_revenue bigint, p_status text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_filter_option_counts(p_filter_type text, p_company_type text, p_min_games integer, p_min_revenue bigint, p_status text) IS 'Returns counts for filter dropdowns - optimized with aggregate queries';


--
-- Name: get_fully_completed_apps_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_fully_completed_apps_count() RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COUNT(*)::BIGINT
  FROM public.get_current_catalog_appids() c
  JOIN public.sync_status s ON s.appid = c.appid
  WHERE s.last_steamspy_sync IS NOT NULL
    AND s.last_storefront_sync IS NOT NULL
    AND s.last_reviews_sync IS NOT NULL
    AND s.last_histogram_sync IS NOT NULL;
$$;


--
-- Name: FUNCTION get_fully_completed_apps_count(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_fully_completed_apps_count() IS 'Returns the count of current-catalog apps that have synced all required Phase 3 admin data sources at least once.';


--
-- Name: get_game_momentum(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_game_momentum(p_appid integer) RETURNS TABLE(ccu_growth_7d numeric, ccu_growth_30d numeric, velocity_7d numeric, velocity_acceleration numeric)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_recent_7d_avg NUMERIC;
  v_prev_7d_avg NUMERIC;
  v_full_30d_avg NUMERIC;
  v_velocity_7d NUMERIC;
  v_velocity_30d NUMERIC;
BEGIN
  -- Calculate CCU averages from ccu_snapshots
  -- Recent 7 days average
  SELECT AVG(player_count)::NUMERIC
  INTO v_recent_7d_avg
  FROM ccu_snapshots
  WHERE appid = p_appid
    AND snapshot_time > NOW() - INTERVAL '7 days';

  -- Previous 7 days average (days 8-14)
  SELECT AVG(player_count)::NUMERIC
  INTO v_prev_7d_avg
  FROM ccu_snapshots
  WHERE appid = p_appid
    AND snapshot_time > NOW() - INTERVAL '14 days'
    AND snapshot_time <= NOW() - INTERVAL '7 days';

  -- Full 30 days average (baseline)
  SELECT AVG(player_count)::NUMERIC
  INTO v_full_30d_avg
  FROM ccu_snapshots
  WHERE appid = p_appid
    AND snapshot_time > NOW() - INTERVAL '30 days';

  -- Get velocity metrics from materialized view
  SELECT rvs.velocity_7d, rvs.velocity_30d
  INTO v_velocity_7d, v_velocity_30d
  FROM review_velocity_stats rvs
  WHERE rvs.appid = p_appid;

  -- Return calculated metrics
  RETURN QUERY SELECT
    -- CCU growth 7d: week-over-week change
    CASE
      WHEN v_prev_7d_avg IS NOT NULL AND v_prev_7d_avg > 0
      THEN ROUND(((v_recent_7d_avg - v_prev_7d_avg) / v_prev_7d_avg) * 100, 2)
      ELSE NULL
    END AS ccu_growth_7d,

    -- CCU growth 30d: deviation from 30-day baseline
    CASE
      WHEN v_full_30d_avg IS NOT NULL AND v_full_30d_avg > 0
      THEN ROUND(((v_recent_7d_avg - v_full_30d_avg) / v_full_30d_avg) * 100, 2)
      ELSE NULL
    END AS ccu_growth_30d,

    -- Review velocity (7-day average)
    v_velocity_7d AS velocity_7d,

    -- Velocity acceleration (positive = gaining reviews faster)
    CASE
      WHEN v_velocity_7d IS NOT NULL AND v_velocity_30d IS NOT NULL
      THEN ROUND(v_velocity_7d - v_velocity_30d, 4)
      ELSE NULL
    END AS velocity_acceleration;
END;
$$;


--
-- Name: FUNCTION get_game_momentum(p_appid integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_game_momentum(p_appid integer) IS 'Returns CCU growth and review velocity metrics for embedding enrichment.
ccu_growth_7d: % change week-over-week
ccu_growth_30d: % deviation from 30-day baseline
velocity_7d: reviews per day (7-day avg)
velocity_acceleration: velocity_7d - velocity_30d (positive = accelerating)';


--
-- Name: get_histogram_appids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_histogram_appids() RETURNS TABLE(appid integer)
    LANGUAGE sql STABLE
    AS $$
  SELECT DISTINCT appid FROM review_histogram ORDER BY appid;
$$;


--
-- Name: FUNCTION get_histogram_appids(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_histogram_appids() IS 'Returns distinct appids from review_histogram for trends calculation';


--
-- Name: get_histogram_appids(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_histogram_appids(p_limit integer DEFAULT 50000, p_offset integer DEFAULT 0) RETURNS TABLE(appid integer)
    LANGUAGE sql STABLE
    AS $$
  SELECT DISTINCT appid
  FROM review_histogram
  ORDER BY appid
  LIMIT p_limit
  OFFSET p_offset;
$$;


--
-- Name: FUNCTION get_histogram_appids(p_limit integer, p_offset integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_histogram_appids(p_limit integer, p_offset integer) IS 'Returns distinct appids from review_histogram with pagination for trends calculation';


--
-- Name: get_pics_data_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pics_data_stats() RETURNS TABLE(total_apps bigint, with_pics_sync bigint, with_categories bigint, with_genres bigint, with_tags bigint, with_franchises bigint, with_parent_app bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  cached_data RECORD;
BEGIN
  SELECT * INTO cached_data FROM public.dashboard_stats_cache WHERE id = 'main';

  IF cached_data IS NOT NULL AND cached_data.apps_count > 0 THEN
    RETURN QUERY
    SELECT
      cached_data.apps_count,
      cached_data.pics_synced,
      cached_data.categories_count,
      cached_data.genres_count,
      cached_data.tags_count,
      cached_data.franchises_count,
      cached_data.parent_app_count;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.get_current_catalog_appids()),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_pics_sync IS NOT NULL
    ),
    (
      SELECT COUNT(DISTINCT ac.appid)
      FROM public.app_categories ac
      JOIN public.get_current_catalog_appids() c ON c.appid = ac.appid
    ),
    (
      SELECT COUNT(DISTINCT ag.appid)
      FROM public.app_genres ag
      JOIN public.get_current_catalog_appids() c ON c.appid = ag.appid
    ),
    (
      SELECT COUNT(DISTINCT ast.appid)
      FROM public.app_steam_tags ast
      JOIN public.get_current_catalog_appids() c ON c.appid = ast.appid
    ),
    (
      SELECT COUNT(DISTINCT af.appid)
      FROM public.app_franchises af
      JOIN public.get_current_catalog_appids() c ON c.appid = af.appid
    ),
    (
      SELECT COUNT(*)
      FROM public.apps a
      JOIN public.get_current_catalog_appids() c ON c.appid = a.appid
      WHERE a.parent_appid IS NOT NULL
    );
END;
$$;


--
-- Name: get_pinned_entities_with_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pinned_entities_with_metrics() RETURNS TABLE(user_id uuid, pin_id uuid, entity_type public.entity_type, entity_id integer, display_name text, ccu_current integer, ccu_7d_avg integer, review_velocity numeric, positive_ratio numeric, total_reviews integer, price_cents integer, discount_percent integer, trend_30d_direction text, sensitivity_ccu numeric, sensitivity_review numeric, sensitivity_sentiment numeric, alerts_enabled boolean, alert_ccu_spike boolean, alert_ccu_drop boolean, alert_trend_reversal boolean, alert_review_surge boolean, alert_sentiment_shift boolean, alert_price_change boolean, alert_new_release boolean, alert_milestone boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.ccu_sensitivity IS NOT NULL
            THEN ps.ccu_sensitivity
            ELSE COALESCE(pref.ccu_sensitivity, 1.0)
        END as sensitivity_ccu,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.review_sensitivity IS NOT NULL
            THEN ps.review_sensitivity
            ELSE COALESCE(pref.review_sensitivity, 1.0)
        END as sensitivity_review,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.sentiment_sensitivity IS NOT NULL
            THEN ps.sentiment_sensitivity
            ELSE COALESCE(pref.sentiment_sensitivity, 1.0)
        END as sensitivity_sentiment,
        CASE
            WHEN COALESCE(pref.alerts_enabled, TRUE) = FALSE THEN FALSE
            WHEN ps.use_custom_settings = TRUE THEN COALESCE(ps.alerts_enabled, TRUE)
            ELSE TRUE
        END as alerts_enabled,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_ccu_spike IS NOT NULL
            THEN ps.alert_ccu_spike
            ELSE COALESCE(pref.alert_ccu_spike, TRUE)
        END as alert_ccu_spike,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_ccu_drop IS NOT NULL
            THEN ps.alert_ccu_drop
            ELSE COALESCE(pref.alert_ccu_drop, TRUE)
        END as alert_ccu_drop,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_trend_reversal IS NOT NULL
            THEN ps.alert_trend_reversal
            ELSE COALESCE(pref.alert_trend_reversal, TRUE)
        END as alert_trend_reversal,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_review_surge IS NOT NULL
            THEN ps.alert_review_surge
            ELSE COALESCE(pref.alert_review_surge, TRUE)
        END as alert_review_surge,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_sentiment_shift IS NOT NULL
            THEN ps.alert_sentiment_shift
            ELSE COALESCE(pref.alert_sentiment_shift, TRUE)
        END as alert_sentiment_shift,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_price_change IS NOT NULL
            THEN ps.alert_price_change
            ELSE COALESCE(pref.alert_price_change, TRUE)
        END as alert_price_change,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_new_release IS NOT NULL
            THEN ps.alert_new_release
            ELSE COALESCE(pref.alert_new_release, TRUE)
        END as alert_new_release,
        CASE
            WHEN ps.use_custom_settings = TRUE AND ps.alert_milestone IS NOT NULL
            THEN ps.alert_milestone
            ELSE COALESCE(pref.alert_milestone, TRUE)
        END as alert_milestone
    FROM user_pins p
    LEFT JOIN apps a ON p.entity_type = 'game' AND p.entity_id = a.appid
    LEFT JOIN latest_daily_metrics ldm ON p.entity_type = 'game' AND p.entity_id = ldm.appid
    LEFT JOIN app_trends at ON p.entity_type = 'game' AND p.entity_id = at.appid
    LEFT JOIN alert_detection_state ads ON p.entity_type = ads.entity_type AND p.entity_id = ads.entity_id
    LEFT JOIN user_alert_preferences pref ON p.user_id = pref.user_id
    LEFT JOIN user_pin_alert_settings ps ON p.id = ps.pin_id
    WHERE COALESCE(pref.alerts_enabled, TRUE) = TRUE;
END;
$$;


--
-- Name: FUNCTION get_pinned_entities_with_metrics(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_pinned_entities_with_metrics() IS 'Fetch all pinned entities with current metrics and merged alert settings for detection worker';


--
-- Name: get_priority_distribution(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_priority_distribution() RETURNS TABLE(high bigint, medium bigint, normal_priority bigint, low bigint, minimal bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE priority_score >= 150) as high,
    COUNT(*) FILTER (WHERE priority_score >= 100 AND priority_score < 150) as medium,
    COUNT(*) FILTER (WHERE priority_score >= 50 AND priority_score < 100) as normal_priority,
    COUNT(*) FILTER (WHERE priority_score >= 25 AND priority_score < 50) as low,
    COUNT(*) FILTER (WHERE priority_score < 25 OR priority_score IS NULL) as minimal
  FROM sync_status
  WHERE is_syncable = TRUE;
END;
$$;


--
-- Name: get_publisher_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_publisher_stats() RETURNS json
    LANGUAGE plpgsql
    AS $$
DECLARE
  result JSON;
  one_year_ago DATE := CURRENT_DATE - INTERVAL '1 year';
BEGIN
  SELECT json_build_object(
    'total', COUNT(*),
    'major', COUNT(*) FILTER (WHERE game_count >= 10),
    'recentlyActive', COUNT(*) FILTER (WHERE first_game_release_date >= one_year_ago)
  ) INTO result
  FROM publishers;

  RETURN result;
END;
$$;


--
-- Name: FUNCTION get_publisher_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_publisher_stats() IS 'Returns publisher counts (total, major, recently active) in a single query';


--
-- Name: get_publishers_for_embedding(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_publishers_for_embedding(p_limit integer DEFAULT 500) RETURNS TABLE(id integer, name text, game_count integer, first_game_release_date date, top_genres text[], top_tags text[], platforms_supported text[], total_reviews bigint, avg_review_percentage numeric, top_game_names text[], top_game_appids integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.name,
        p.game_count,
        p.first_game_release_date,
        -- Top genres across portfolio
        ARRAY(
            SELECT sg.name
            FROM steam_genres sg
            JOIN app_genres ag_inner ON sg.genre_id = ag_inner.genre_id
            JOIN app_publishers ap_inner ON ag_inner.appid = ap_inner.appid
            WHERE ap_inner.publisher_id = p.id
            GROUP BY sg.name
            ORDER BY COUNT(*) DESC
            LIMIT 5
        ) as top_genres,
        -- Top tags across portfolio
        ARRAY(
            SELECT st.name
            FROM steam_tags st
            JOIN app_steam_tags ast_inner ON st.tag_id = ast_inner.tag_id
            JOIN app_publishers ap_inner ON ast_inner.appid = ap_inner.appid
            WHERE ap_inner.publisher_id = p.id
            GROUP BY st.name
            ORDER BY COUNT(*) DESC
            LIMIT 10
        ) as top_tags,
        -- Platforms supported
        ARRAY(
            SELECT DISTINCT unnest(string_to_array(apps_inner.platforms, ','))
            FROM apps apps_inner
            JOIN app_publishers ap_inner ON apps_inner.appid = ap_inner.appid
            WHERE ap_inner.publisher_id = p.id AND apps_inner.platforms IS NOT NULL
        ) as platforms_supported,
        -- Total reviews
        COALESCE((
            SELECT SUM(COALESCE(dm_sub.reviews_total, 0))
            FROM app_publishers ap_sub
            JOIN apps apps_sub ON ap_sub.appid = apps_sub.appid
            LEFT JOIN LATERAL (
                SELECT dm_inner.total_reviews as reviews_total FROM daily_metrics dm_inner
                WHERE dm_inner.appid = apps_sub.appid
                ORDER BY dm_inner.metric_date DESC LIMIT 1
            ) dm_sub ON TRUE
            WHERE ap_sub.publisher_id = p.id
        ), 0) as total_reviews,
        -- Average review percentage
        (
            SELECT AVG(apps_sub.pics_review_percentage)
            FROM app_publishers ap_sub
            JOIN apps apps_sub ON ap_sub.appid = apps_sub.appid
            WHERE ap_sub.publisher_id = p.id AND apps_sub.pics_review_percentage IS NOT NULL
        ) as avg_review_percentage,
        -- Top games by reviews
        ARRAY(
            SELECT apps_sub.name
            FROM app_publishers ap_sub
            JOIN apps apps_sub ON ap_sub.appid = apps_sub.appid
            LEFT JOIN LATERAL (
                SELECT dm_inner.total_reviews as reviews_total FROM daily_metrics dm_inner
                WHERE dm_inner.appid = apps_sub.appid ORDER BY dm_inner.metric_date DESC LIMIT 1
            ) dm_sub ON TRUE
            WHERE ap_sub.publisher_id = p.id AND apps_sub.type = 'game'
            ORDER BY COALESCE(dm_sub.reviews_total, 0) DESC
            LIMIT 10
        ) as top_game_names,
        ARRAY(
            SELECT apps_sub.appid
            FROM app_publishers ap_sub
            JOIN apps apps_sub ON ap_sub.appid = apps_sub.appid
            LEFT JOIN LATERAL (
                SELECT dm_inner.total_reviews as reviews_total FROM daily_metrics dm_inner
                WHERE dm_inner.appid = apps_sub.appid ORDER BY dm_inner.metric_date DESC LIMIT 1
            ) dm_sub ON TRUE
            WHERE ap_sub.publisher_id = p.id AND apps_sub.type = 'game'
            ORDER BY COALESCE(dm_sub.reviews_total, 0) DESC
            LIMIT 10
        ) as top_game_appids
    FROM publishers p
    WHERE p.game_count > 0
    ORDER BY p.game_count DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: get_publishers_needing_embedding(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_publishers_needing_embedding(p_limit integer DEFAULT 100) RETURNS TABLE(id integer, name text, game_count integer, first_game_release_date date, top_genres text[], top_tags text[], platforms_supported text[], total_reviews bigint, avg_review_percentage numeric, top_game_names text[], top_game_appids integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH
    -- Step 1: Filter to qualifying publishers first (with LIMIT)
    -- Use 'pid' alias to avoid conflict with RETURNS TABLE 'id' column
    filtered_pubs AS (
        SELECT p.id as pid
        FROM publishers p
        WHERE p.game_count > 0
          AND (
            p.last_embedding_sync IS NULL
            OR p.updated_at > p.last_embedding_sync
          )
        ORDER BY
          CASE WHEN p.last_embedding_sync IS NULL THEN 0 ELSE 1 END,
          p.game_count DESC
        LIMIT p_limit
    ),
    -- Step 2: Pre-aggregate top genres for all filtered publishers
    pub_genres AS (
        SELECT ap.publisher_id as pid, array_agg(DISTINCT sg.name) as genre_names
        FROM app_publishers ap
        JOIN app_genres ag ON ag.appid = ap.appid
        JOIN steam_genres sg ON sg.genre_id = ag.genre_id
        WHERE ap.publisher_id IN (SELECT fp.pid FROM filtered_pubs fp)
        GROUP BY ap.publisher_id
    ),
    -- Step 3: Pre-aggregate top tags for all filtered publishers
    pub_tags AS (
        SELECT ap.publisher_id as pid, array_agg(DISTINCT st.name) as tag_names
        FROM app_publishers ap
        JOIN app_steam_tags ast ON ast.appid = ap.appid AND ast.rank <= 10
        JOIN steam_tags st ON st.tag_id = ast.tag_id
        WHERE ap.publisher_id IN (SELECT fp.pid FROM filtered_pubs fp)
        GROUP BY ap.publisher_id
    ),
    -- Step 4: Pre-aggregate platforms for all filtered publishers
    pub_platforms AS (
        SELECT ap.publisher_id as pid, array_agg(DISTINCT plat.platform) as platforms
        FROM app_publishers ap
        JOIN apps a ON a.appid = ap.appid
        CROSS JOIN LATERAL unnest(string_to_array(a.platforms, ',')) as plat(platform)
        WHERE ap.publisher_id IN (SELECT fp.pid FROM filtered_pubs fp)
          AND a.platforms IS NOT NULL
        GROUP BY ap.publisher_id
    ),
    -- Step 5: Pre-aggregate review stats for all filtered publishers
    pub_reviews AS (
        SELECT ap.publisher_id as pid,
               AVG(a.pics_review_percentage) as avg_review
        FROM app_publishers ap
        JOIN apps a ON a.appid = ap.appid
        WHERE ap.publisher_id IN (SELECT fp.pid FROM filtered_pubs fp)
          AND a.pics_review_percentage IS NOT NULL
        GROUP BY ap.publisher_id
    ),
    -- Step 6: Pre-aggregate top games for all filtered publishers
    pub_games AS (
        SELECT ap.publisher_id as pid,
               array_agg(a.name ORDER BY a.appid) as game_names,
               array_agg(a.appid ORDER BY a.appid) as game_appids
        FROM app_publishers ap
        JOIN apps a ON a.appid = ap.appid AND a.type = 'game'
        WHERE ap.publisher_id IN (SELECT fp.pid FROM filtered_pubs fp)
        GROUP BY ap.publisher_id
    )
    -- Final SELECT: Join all pre-aggregated data
    SELECT
        p.id,
        p.name,
        p.game_count,
        p.first_game_release_date,
        COALESCE((SELECT array_agg(x) FROM (SELECT unnest(pg.genre_names) LIMIT 5) t(x)), '{}') as top_genres,
        COALESCE((SELECT array_agg(x) FROM (SELECT unnest(pt.tag_names) LIMIT 10) t(x)), '{}') as top_tags,
        COALESCE((SELECT array_agg(trim(x)) FROM (SELECT unnest(pp.platforms) LIMIT 3) t(x)), '{}') as platforms_supported,
        0::BIGINT as total_reviews,  -- Simplified to avoid timeout
        pr.avg_review as avg_review_percentage,
        COALESCE(pga.game_names[1:10], '{}') as top_game_names,
        COALESCE(pga.game_appids[1:10], '{}') as top_game_appids
    FROM publishers p
    JOIN filtered_pubs fp ON fp.pid = p.id
    LEFT JOIN pub_genres pg ON pg.pid = p.id
    LEFT JOIN pub_tags pt ON pt.pid = p.id
    LEFT JOIN pub_platforms pp ON pp.pid = p.id
    LEFT JOIN pub_reviews pr ON pr.pid = p.id
    LEFT JOIN pub_games pga ON pga.pid = p.id;
END;
$$;


--
-- Name: get_publishers_with_metrics(text, bigint, bigint, smallint, integer, integer, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_publishers_with_metrics(p_search text DEFAULT NULL::text, p_min_owners bigint DEFAULT NULL::bigint, p_min_ccu bigint DEFAULT NULL::bigint, p_min_score smallint DEFAULT NULL::smallint, p_min_games integer DEFAULT NULL::integer, p_min_developers integer DEFAULT NULL::integer, p_status text DEFAULT NULL::text, p_sort_field text DEFAULT 'game_count'::text, p_sort_order text DEFAULT 'desc'::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id integer, name text, normalized_name text, steam_vanity_url text, first_game_release_date date, game_count integer, total_owners_min bigint, total_owners_max bigint, total_ccu_peak bigint, max_ccu_peak integer, total_reviews bigint, weighted_review_score smallint, estimated_revenue_usd bigint, games_trending_up integer, games_trending_down integer, games_released_last_year integer, unique_developers integer, computed_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.normalized_name,
    p.steam_vanity_url,
    p.first_game_release_date,
    p.game_count,
    COALESCE(pm.total_owners, 0)::BIGINT AS total_owners_min,
    COALESCE(pm.total_owners, 0)::BIGINT AS total_owners_max,
    COALESCE(pm.total_ccu, 0)::BIGINT AS total_ccu_peak,
    COALESCE(pm.total_ccu, 0)::INTEGER AS max_ccu_peak,
    COALESCE(pm.total_reviews, 0)::BIGINT,
    CASE
      WHEN pm.avg_review_score IS NULL THEN NULL
      ELSE ROUND(pm.avg_review_score)::SMALLINT
    END AS weighted_review_score,
    COALESCE(ROUND(pm.revenue_estimate_cents::NUMERIC / 100), 0)::BIGINT AS estimated_revenue_usd,
    COALESCE(pm.games_trending_up, 0)::INTEGER,
    COALESCE(pm.games_trending_down, 0)::INTEGER,
    COALESCE(pm.games_released_last_year, 0)::INTEGER,
    COALESCE(pm.unique_developers, 0)::INTEGER,
    pm.computed_at
  FROM public.publishers p
  LEFT JOIN public.publisher_metrics pm ON pm.publisher_id = p.id
  WHERE
    (p_search IS NULL OR p.name ILIKE '%' || p_search || '%')
    AND (p_min_owners IS NULL OR COALESCE(pm.total_owners, 0) >= p_min_owners)
    AND (p_min_ccu IS NULL OR COALESCE(pm.total_ccu, 0) >= p_min_ccu)
    AND (
      p_min_score IS NULL
      OR COALESCE(ROUND(pm.avg_review_score), 0) >= p_min_score
    )
    AND (p_min_games IS NULL OR p.game_count >= p_min_games)
    AND (p_min_developers IS NULL OR COALESCE(pm.unique_developers, 0) >= p_min_developers)
    AND (
      p_status IS NULL
      OR (p_status = 'active' AND COALESCE(pm.games_released_last_year, 0) > 0)
      OR (p_status = 'dormant' AND COALESCE(pm.games_released_last_year, 0) = 0)
    )
  ORDER BY
    CASE
      WHEN p_sort_order = 'asc' AND p_sort_field = 'name' THEN p.name
      ELSE NULL
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_order = 'desc' AND p_sort_field = 'name' THEN p.name
      ELSE NULL
    END DESC NULLS LAST,
    CASE
      WHEN p_sort_order = 'asc' AND p_sort_field = 'first_game_release_date' THEN p.first_game_release_date
      ELSE NULL
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_order = 'desc' AND p_sort_field = 'first_game_release_date' THEN p.first_game_release_date
      ELSE NULL
    END DESC NULLS LAST,
    CASE
      WHEN p_sort_order = 'asc' THEN
        CASE p_sort_field
          WHEN 'game_count' THEN p.game_count::NUMERIC
          WHEN 'total_owners_max' THEN COALESCE(pm.total_owners, 0)::NUMERIC
          WHEN 'total_ccu_peak' THEN COALESCE(pm.total_ccu, 0)::NUMERIC
          WHEN 'weighted_review_score' THEN COALESCE(ROUND(pm.avg_review_score), 0)::NUMERIC
          WHEN 'estimated_revenue_usd' THEN COALESCE(ROUND(pm.revenue_estimate_cents::NUMERIC / 100), 0)
          WHEN 'games_trending_up' THEN COALESCE(pm.games_trending_up, 0)::NUMERIC
          WHEN 'unique_developers' THEN COALESCE(pm.unique_developers, 0)::NUMERIC
          ELSE p.game_count::NUMERIC
        END
      ELSE NULL
    END ASC NULLS LAST,
    CASE
      WHEN p_sort_order = 'desc' THEN
        CASE p_sort_field
          WHEN 'game_count' THEN p.game_count::NUMERIC
          WHEN 'total_owners_max' THEN COALESCE(pm.total_owners, 0)::NUMERIC
          WHEN 'total_ccu_peak' THEN COALESCE(pm.total_ccu, 0)::NUMERIC
          WHEN 'weighted_review_score' THEN COALESCE(ROUND(pm.avg_review_score), 0)::NUMERIC
          WHEN 'estimated_revenue_usd' THEN COALESCE(ROUND(pm.revenue_estimate_cents::NUMERIC / 100), 0)
          WHEN 'games_trending_up' THEN COALESCE(pm.games_trending_up, 0)::NUMERIC
          WHEN 'unique_developers' THEN COALESCE(pm.unique_developers, 0)::NUMERIC
          ELSE p.game_count::NUMERIC
        END
      ELSE NULL
    END DESC NULLS LAST,
    p.name ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


--
-- Name: FUNCTION get_publishers_with_metrics(p_search text, p_min_owners bigint, p_min_ccu bigint, p_min_score smallint, p_min_games integer, p_min_developers integer, p_status text, p_sort_field text, p_sort_order text, p_limit integer, p_offset integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_publishers_with_metrics(p_search text, p_min_owners bigint, p_min_ccu bigint, p_min_score smallint, p_min_games integer, p_min_developers integer, p_status text, p_sort_field text, p_sort_order text, p_limit integer, p_offset integer) IS 'Fetches publishers with aggregated metrics, supporting server-side filtering and sorting';


--
-- Name: get_queue_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_queue_status() RETURNS TABLE(overdue bigint, due_in_1_hour bigint, due_in_6_hours bigint, due_in_24_hours bigint)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (
      WHERE last_storefront_sync IS NULL
      OR last_storefront_sync < NOW() - (COALESCE(sync_interval_hours, 24) || ' hours')::INTERVAL
    ) as overdue,
    COUNT(*) FILTER (
      WHERE last_storefront_sync IS NOT NULL
      AND last_storefront_sync >= NOW() - (COALESCE(sync_interval_hours, 24) || ' hours')::INTERVAL
      AND last_storefront_sync < NOW() - (COALESCE(sync_interval_hours, 24) || ' hours')::INTERVAL + INTERVAL '1 hour'
    ) as due_in_1_hour,
    COUNT(*) FILTER (
      WHERE last_storefront_sync IS NOT NULL
      AND last_storefront_sync >= NOW() - (COALESCE(sync_interval_hours, 24) || ' hours')::INTERVAL
      AND last_storefront_sync < NOW() - (COALESCE(sync_interval_hours, 24) || ' hours')::INTERVAL + INTERVAL '6 hours'
    ) as due_in_6_hours,
    COUNT(*) FILTER (
      WHERE last_storefront_sync IS NOT NULL
      AND last_storefront_sync >= NOW() - (COALESCE(sync_interval_hours, 24) || ' hours')::INTERVAL
      AND last_storefront_sync < NOW() - (COALESCE(sync_interval_hours, 24) || ' hours')::INTERVAL + INTERVAL '24 hours'
    ) as due_in_24_hours
  FROM sync_status
  WHERE is_syncable = TRUE
    AND (storefront_accessible IS NULL OR storefront_accessible = TRUE);
END;
$$;


--
-- Name: get_recent_app_changes(integer, public.app_change_type[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_recent_app_changes(p_days integer DEFAULT 30, p_types public.app_change_type[] DEFAULT NULL::public.app_change_type[], p_limit integer DEFAULT 100) RETURNS TABLE(appid integer, app_name text, event_id bigint, source text, change_type public.app_change_type, occurred_at timestamp with time zone, before_value jsonb, after_value jsonb, context jsonb, source_snapshot_id bigint, related_snapshot_id bigint, media_version_id bigint, news_item_gid text, baseline_7d jsonb, baseline_30d jsonb, response_1d jsonb, response_7d jsonb, response_30d jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH request_config AS (
    SELECT
      LEAST(GREATEST(COALESCE(p_days, 30), 1), 180) AS effective_days,
      LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100) AS effective_limit
  ),
  base AS (
    SELECT
      e.appid,
      a.name AS app_name,
      e.id AS event_id,
      e.source,
      e.change_type,
      e.occurred_at,
      e.before_value,
      e.after_value,
      e.context,
      e.source_snapshot_id,
      e.related_snapshot_id,
      e.media_version_id,
      e.news_item_gid
    FROM request_config rc
    JOIN app_change_events e
      ON e.occurred_at >= NOW() - make_interval(days => rc.effective_days)
    JOIN apps a ON a.appid = e.appid
    WHERE p_types IS NULL OR e.change_type = ANY (p_types)
    ORDER BY e.occurred_at DESC
    LIMIT (SELECT effective_limit FROM request_config)
  )
  SELECT
    b.appid,
    b.app_name,
    b.event_id,
    b.source,
    b.change_type,
    b.occurred_at,
    b.before_value,
    b.after_value,
    b.context,
    b.source_snapshot_id,
    b.related_snapshot_id,
    b.media_version_id,
    b.news_item_gid,
    get_change_window_metrics(b.appid, b.occurred_at - INTERVAL '7 days', b.occurred_at),
    get_change_window_metrics(b.appid, b.occurred_at - INTERVAL '30 days', b.occurred_at),
    get_change_window_metrics(b.appid, b.occurred_at, b.occurred_at + INTERVAL '1 day'),
    get_change_window_metrics(b.appid, b.occurred_at, b.occurred_at + INTERVAL '7 days'),
    get_change_window_metrics(b.appid, b.occurred_at, b.occurred_at + INTERVAL '30 days')
  FROM base b
  ORDER BY b.occurred_at DESC;
$$;


--
-- Name: FUNCTION get_recent_app_changes(p_days integer, p_types public.app_change_type[], p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_recent_app_changes(p_days integer, p_types public.app_change_type[], p_limit integer) IS 'Returns bounded recent change events across apps. The effective lookback window is capped at 180 days and the result limit is capped at 100.';


--
-- Name: get_sentiment_trajectory(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sentiment_trajectory(p_appid integer) RETURNS TABLE(recent_review_pct numeric, historical_review_pct numeric, sentiment_delta numeric)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_recent_positive INTEGER;
  v_recent_total INTEGER;
  v_positive INTEGER;
  v_total INTEGER;
  v_recent_pct NUMERIC;
  v_historical_pct NUMERIC;
BEGIN
  -- Get latest daily_metrics for the app
  SELECT
    dm.recent_positive,
    dm.recent_total_reviews,
    dm.positive_reviews,
    dm.total_reviews
  INTO
    v_recent_positive,
    v_recent_total,
    v_positive,
    v_total
  FROM daily_metrics dm
  WHERE dm.appid = p_appid
  ORDER BY dm.metric_date DESC
  LIMIT 1;

  -- Calculate percentages
  v_recent_pct := CASE
    WHEN v_recent_total IS NOT NULL AND v_recent_total > 0
    THEN ROUND((v_recent_positive::NUMERIC / v_recent_total) * 100, 2)
    ELSE NULL
  END;

  v_historical_pct := CASE
    WHEN v_total IS NOT NULL AND v_total > 0
    THEN ROUND((v_positive::NUMERIC / v_total) * 100, 2)
    ELSE NULL
  END;

  -- Return calculated metrics
  RETURN QUERY SELECT
    v_recent_pct AS recent_review_pct,
    v_historical_pct AS historical_review_pct,
    CASE
      WHEN v_recent_pct IS NOT NULL AND v_historical_pct IS NOT NULL
      THEN ROUND(v_recent_pct - v_historical_pct, 2)
      ELSE NULL
    END AS sentiment_delta;
END;
$$;


--
-- Name: FUNCTION get_sentiment_trajectory(p_appid integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_sentiment_trajectory(p_appid integer) IS 'Returns sentiment trajectory metrics for embedding enrichment.
recent_review_pct: positive % of reviews from last 30 days
historical_review_pct: positive % of all-time reviews
sentiment_delta: recent - historical (positive = improving sentiment)';


--
-- Name: get_source_completion_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_source_completion_stats() RETURNS TABLE(source text, total_apps bigint, synced_apps bigint, stale_apps bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_total BIGINT;
  v_steamspy_total BIGINT;
  v_one_day_ago TIMESTAMPTZ := NOW() - INTERVAL '1 day';
  v_seven_days_ago TIMESTAMPTZ := NOW() - INTERVAL '7 days';
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM public.get_current_catalog_appids();

  SELECT COUNT(*) INTO v_steamspy_total
  FROM public.get_current_catalog_appids() c
  JOIN public.sync_status s ON s.appid = c.appid
  WHERE s.steamspy_available IS NULL OR s.steamspy_available = TRUE;

  RETURN QUERY
  SELECT
    'steamspy'::TEXT,
    v_steamspy_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE (s.steamspy_available IS NULL OR s.steamspy_available = TRUE)
        AND s.last_steamspy_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE (s.steamspy_available IS NULL OR s.steamspy_available = TRUE)
        AND s.last_steamspy_sync IS NOT NULL
        AND s.last_steamspy_sync < v_one_day_ago
    )
  UNION ALL
  SELECT
    'storefront'::TEXT,
    v_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_storefront_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_storefront_sync IS NOT NULL
        AND s.last_storefront_sync < v_one_day_ago
    )
  UNION ALL
  SELECT
    'reviews'::TEXT,
    v_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_reviews_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_reviews_sync IS NOT NULL
        AND s.last_reviews_sync < v_one_day_ago
    )
  UNION ALL
  SELECT
    'histogram'::TEXT,
    v_total,
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_histogram_sync IS NOT NULL
    ),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_histogram_sync IS NOT NULL
        AND s.last_histogram_sync < v_seven_days_ago
    );
END;
$$;


--
-- Name: get_steamspy_individual_fetch_candidates(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_steamspy_individual_fetch_candidates(p_limit integer DEFAULT 100, p_min_reviews integer DEFAULT 1000) RETURNS TABLE(appid integer, total_reviews integer, name text)
    LANGUAGE plpgsql
    AS $$
  BEGIN
      RETURN QUERY
      SELECT
          s.appid,
          COALESCE(m.total_reviews, 0)::INTEGER as total_reviews,
          a.name
      FROM sync_status s
      JOIN apps a ON a.appid = s.appid
      LEFT JOIN latest_daily_metrics m ON m.appid = s.appid
      WHERE s.steamspy_available = FALSE
        AND s.last_steamspy_individual_fetch IS NULL
        AND s.is_syncable = TRUE
        AND COALESCE(m.total_reviews, 0) >= p_min_reviews
      ORDER BY COALESCE(m.total_reviews, 0) DESC
      LIMIT p_limit;
  END;
  $$;


--
-- Name: FUNCTION get_steamspy_individual_fetch_candidates(p_limit integer, p_min_reviews integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_steamspy_individual_fetch_candidates(p_limit integer, p_min_reviews integer) IS 'Returns high-priority apps for individual SteamSpy fetch, ordered by review count';


--
-- Name: get_storage_bucket_usage_bytes(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_storage_bucket_usage_bytes(p_bucket_id text) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'storage'
    AS $$
  SELECT COALESCE(SUM(((o.metadata->>'size'))::BIGINT), 0)
  FROM storage.objects o
  WHERE o.bucket_id = p_bucket_id;
$$;


--
-- Name: get_suspicious_zero_appids(integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_suspicious_zero_appids(p_appids integer[]) RETURNS integer[]
    LANGUAGE sql STABLE
    AS $$
  WITH selected_appids AS (
    SELECT DISTINCT unnest(COALESCE(p_appids, ARRAY[]::INTEGER[])) AS appid
  ),
  suspicious AS (
    SELECT sa.appid
    FROM selected_appids sa
    JOIN public.apps a ON a.appid = sa.appid
    WHERE a.release_date IS NOT NULL
      AND a.release_date >= CURRENT_DATE - 180

    UNION

    SELECT sa.appid
    FROM selected_appids sa
    JOIN public.latest_daily_metrics ldm ON ldm.appid = sa.appid
    WHERE COALESCE(ldm.total_reviews, 0) >= 1000

    UNION

    SELECT sa.appid
    FROM selected_appids sa
    WHERE EXISTS (
      SELECT 1
      FROM public.daily_metrics dm
      WHERE dm.appid = sa.appid
        AND dm.metric_date >= CURRENT_DATE - 30
        AND dm.ccu_peak > 0
      LIMIT 1
    )

    UNION

    SELECT sa.appid
    FROM selected_appids sa
    WHERE EXISTS (
      SELECT 1
      FROM public.ccu_snapshots cs
      WHERE cs.appid = sa.appid
        AND cs.snapshot_time >= NOW() - INTERVAL '30 days'
        AND cs.player_count > 0
      LIMIT 1
    )
  )
  SELECT COALESCE(array_agg(appid ORDER BY appid), ARRAY[]::INTEGER[])
  FROM suspicious;
$$;


--
-- Name: FUNCTION get_suspicious_zero_appids(p_appids integer[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_suspicious_zero_appids(p_appids integer[]) IS 'Returns suspicious-zero appids for CCU workers using existence checks over recent activity.';


--
-- Name: get_tier3_games_partitioned(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_tier3_games_partitioned(p_limit integer, p_partition_count integer, p_partition_id integer) RETURNS TABLE(appid integer)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  -- Validate partition parameters
  IF p_partition_count < 1 OR p_partition_id < 0 OR p_partition_id >= p_partition_count THEN
    RAISE EXCEPTION 'Invalid partition parameters: count=%, id=%', p_partition_count, p_partition_id;
  END IF;

  RETURN QUERY
  WITH eligible_games AS (
    -- Get all Tier 3 games ordered by last sync time (oldest first)
    -- Exclude games that are temporarily skipped (invalid appids)
    SELECT
      cta.appid,
      ROW_NUMBER() OVER (ORDER BY cta.last_ccu_synced ASC NULLS FIRST, cta.appid) as rn
    FROM ccu_tier_assignments cta
    WHERE cta.ccu_tier = 3
      AND (cta.ccu_skip_until IS NULL OR cta.ccu_skip_until < NOW())
  )
  SELECT e.appid::INTEGER
  FROM eligible_games e
  -- Use modulo to assign each row to a partition
  -- Row 0 → partition 0, Row 1 → partition 1, Row 2 → partition 2, Row 3 → partition 0, etc.
  WHERE ((e.rn - 1) % p_partition_count) = p_partition_id
  ORDER BY e.rn
  LIMIT p_limit;
END;
$$;


--
-- Name: FUNCTION get_tier3_games_partitioned(p_limit integer, p_partition_count integer, p_partition_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_tier3_games_partitioned(p_limit integer, p_partition_count integer, p_partition_id integer) IS 'Returns a partition slice of Tier 3 games for CCU sync. Used by parallel workers.';


--
-- Name: get_unsynced_app_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_unsynced_app_ids() RETURNS TABLE(appid integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT a.appid
    FROM apps a
    LEFT JOIN sync_status s ON a.appid = s.appid
    WHERE s.last_pics_sync IS NULL
    ORDER BY a.appid;
END;
$$;


--
-- Name: get_user_pins_with_metrics(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_pins_with_metrics(p_user_id uuid) RETURNS TABLE(pin_id uuid, entity_type public.entity_type, entity_id integer, display_name text, pin_order integer, pinned_at timestamp with time zone, ccu_current integer, ccu_change_pct numeric, total_reviews integer, positive_pct numeric, review_velocity numeric, trend_direction text, price_cents integer, discount_percent integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_caller_id UUID;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id != v_caller_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS pin_id,
    p.entity_type,
    p.entity_id,
    p.display_name,
    p.pin_order,
    p.pinned_at,
    ldm.ccu_peak AS ccu_current,
    at.trend_30d_change_pct AS ccu_change_pct,
    ldm.total_reviews,
    CASE
      WHEN ldm.total_reviews > 0
        THEN (ldm.positive_reviews::DECIMAL / ldm.total_reviews * 100)::DECIMAL(5,2)
      ELSE NULL
    END AS positive_pct,
    at.review_velocity_7d AS review_velocity,
    at.trend_30d_direction::TEXT AS trend_direction,
    a.current_price_cents AS price_cents,
    a.current_discount_percent AS discount_percent
  FROM public.user_pins p
  LEFT JOIN public.apps a ON p.entity_type = 'game' AND p.entity_id = a.appid
  LEFT JOIN public.latest_daily_metrics ldm ON p.entity_type = 'game' AND p.entity_id = ldm.appid
  LEFT JOIN public.app_trends at ON p.entity_type = 'game' AND p.entity_id = at.appid
  WHERE p.user_id = v_caller_id
  ORDER BY p.pin_order ASC, p.pinned_at DESC;
END;
$$;


--
-- Name: FUNCTION get_user_pins_with_metrics(p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_pins_with_metrics(p_user_id uuid) IS 'Fetch user pins with current metrics for dashboard display';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_initial_credits INTEGER;
    v_waitlist_entry RECORD;
BEGIN
    -- Look up waitlist entry for user data and credits
    SELECT full_name, organization, initial_credits
    INTO v_waitlist_entry
    FROM waitlist
    WHERE email = NEW.email AND status = 'approved'
    LIMIT 1;

    -- Use waitlist credits or default to 1000
    v_initial_credits := COALESCE(v_waitlist_entry.initial_credits, 1000);

    -- Create user profile with waitlist data
    INSERT INTO user_profiles (id, email, full_name, organization, credit_balance)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(v_waitlist_entry.full_name, ''),
        v_waitlist_entry.organization,
        v_initial_credits
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        organization = EXCLUDED.organization,
        credit_balance = EXCLUDED.credit_balance;

    -- Create initial credit transaction for audit trail
    INSERT INTO credit_transactions (
        user_id, amount, balance_after, transaction_type, description
    )
    VALUES (
        NEW.id,
        v_initial_credits,
        v_initial_credits,
        'signup_bonus',
        'Welcome bonus credits'
    )
    ON CONFLICT DO NOTHING;

    -- Initialize rate limit state
    INSERT INTO rate_limit_state (user_id)
    VALUES (NEW.id)
    ON CONFLICT DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to create user profile: %', SQLERRM;
    RETURN NEW;
END;
$$;


--
-- Name: interpolate_all_review_deltas(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.interpolate_all_review_deltas(p_start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), p_end_date date DEFAULT CURRENT_DATE) RETURNS TABLE(total_interpolated integer, apps_processed integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_total_interpolated INTEGER;
    v_apps_processed INTEGER;
BEGIN
    -- Use a CTE to find all gaps and generate interpolated values in a single query
    WITH actual_syncs AS (
        -- Get all actual (non-interpolated) sync points within the date range
        SELECT
            appid,
            delta_date,
            total_reviews,
            positive_reviews
        FROM review_deltas
        WHERE is_interpolated = FALSE
          AND delta_date BETWEEN p_start_date AND p_end_date
    ),

    with_next AS (
        -- Use LEAD to find the next sync point for each record
        SELECT
            appid,
            delta_date as prev_date,
            total_reviews as prev_total,
            positive_reviews as prev_positive,
            LEAD(delta_date) OVER (PARTITION BY appid ORDER BY delta_date) as next_date,
            LEAD(total_reviews) OVER (PARTITION BY appid ORDER BY delta_date) as next_total,
            LEAD(positive_reviews) OVER (PARTITION BY appid ORDER BY delta_date) as next_positive
        FROM actual_syncs
    ),

    gaps AS (
        -- Filter to only pairs with gaps (more than 1 day between syncs)
        SELECT
            appid,
            prev_date,
            prev_total,
            prev_positive,
            next_date,
            next_total,
            next_positive,
            (next_date - prev_date) as days_gap,
            -- Calculate daily change rates
            (next_total - prev_total)::DECIMAL / (next_date - prev_date) as daily_total_change,
            (next_positive - prev_positive)::DECIMAL / (next_date - prev_date) as daily_positive_change
        FROM with_next
        WHERE next_date IS NOT NULL
          AND (next_date - prev_date) > 1  -- Only gaps of 2+ days need interpolation
    ),

    interpolated_rows AS (
        -- Generate all missing dates using generate_series
        SELECT
            g.appid,
            gap_date::DATE as delta_date,
            -- Interpolate total_reviews with overflow protection
            -- LEAST() caps at INTEGER max to prevent overflow
            LEAST(
                2147483647,
                GREATEST(0, g.prev_total + ROUND(g.daily_total_change * (gap_date::DATE - g.prev_date)))
            )::INTEGER as total_reviews,
            -- Interpolate positive_reviews with overflow protection
            LEAST(
                2147483647,
                GREATEST(0, g.prev_positive + ROUND(g.daily_positive_change * (gap_date::DATE - g.prev_date)))
            )::INTEGER as positive_reviews,
            -- Calculate reviews_added (daily increment, clamped to 0-9999)
            -- Capped at 9999 to prevent daily_velocity overflow (NUMERIC(8,4) max)
            LEAST(9999, GREATEST(0, ROUND(g.daily_total_change)))::INTEGER as reviews_added,
            -- Calculate positive/negative added based on ratio (capped at 9999)
            CASE
                WHEN g.daily_total_change > 0 THEN
                    LEAST(9999, GREATEST(0, ROUND(g.daily_positive_change)))::INTEGER
                ELSE 0
            END as positive_added,
            CASE
                WHEN g.daily_total_change > 0 THEN
                    LEAST(9999, GREATEST(0, ROUND(g.daily_total_change - g.daily_positive_change)))::INTEGER
                ELSE 0
            END as negative_added
        FROM gaps g
        CROSS JOIN LATERAL generate_series(
            g.prev_date + 1,  -- Start day after previous sync
            g.next_date - 1,  -- End day before next sync
            '1 day'::INTERVAL
        ) as gap_date
    ),

    inserted AS (
        -- Bulk insert all interpolated rows
        INSERT INTO review_deltas (
            appid,
            delta_date,
            total_reviews,
            positive_reviews,
            review_score,
            reviews_added,
            positive_added,
            negative_added,
            hours_since_last_sync,
            is_interpolated
        )
        SELECT
            appid,
            delta_date,
            total_reviews,
            positive_reviews,
            NULL,  -- No review_score for interpolated
            reviews_added,
            positive_added,
            negative_added,
            24.0,  -- Normalized to 24 hours
            TRUE   -- Mark as interpolated
        FROM interpolated_rows
        ON CONFLICT (appid, delta_date) DO NOTHING
        RETURNING appid
    )

    -- Count results
    SELECT COUNT(*)::INTEGER, COUNT(DISTINCT appid)::INTEGER
    INTO v_total_interpolated, v_apps_processed
    FROM inserted;

    RETURN QUERY SELECT v_total_interpolated, v_apps_processed;
END;
$$;


--
-- Name: FUNCTION interpolate_all_review_deltas(p_start_date date, p_end_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.interpolate_all_review_deltas(p_start_date date, p_end_date date) IS 'Optimized bulk interpolation with INTEGER overflow protection (caps at 2,147,483,647)';


--
-- Name: interpolate_review_deltas(integer, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.interpolate_review_deltas(p_appid integer, p_start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), p_end_date date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_interpolated_count INTEGER;
BEGIN
    WITH actual_syncs AS (
        SELECT
            delta_date,
            total_reviews,
            positive_reviews,
            LEAD(delta_date) OVER (ORDER BY delta_date) as next_date,
            LEAD(total_reviews) OVER (ORDER BY delta_date) as next_total,
            LEAD(positive_reviews) OVER (ORDER BY delta_date) as next_positive
        FROM review_deltas
        WHERE appid = p_appid
          AND is_interpolated = FALSE
          AND delta_date BETWEEN p_start_date AND p_end_date
    ),

    gaps AS (
        SELECT
            delta_date as prev_date,
            total_reviews as prev_total,
            positive_reviews as prev_positive,
            next_date,
            next_total,
            next_positive,
            (next_date - delta_date) as days_gap,
            (next_total - total_reviews)::DECIMAL / (next_date - delta_date) as daily_total_change,
            (next_positive - positive_reviews)::DECIMAL / (next_date - delta_date) as daily_positive_change
        FROM actual_syncs
        WHERE next_date IS NOT NULL
          AND (next_date - delta_date) > 1
    ),

    interpolated_rows AS (
        SELECT
            gap_date::DATE as delta_date,
            -- Overflow protection with LEAST()
            LEAST(
                2147483647,
                GREATEST(0, g.prev_total + ROUND(g.daily_total_change * (gap_date::DATE - g.prev_date)))
            )::INTEGER as total_reviews,
            LEAST(
                2147483647,
                GREATEST(0, g.prev_positive + ROUND(g.daily_positive_change * (gap_date::DATE - g.prev_date)))
            )::INTEGER as positive_reviews,
            -- Capped at 9999 to prevent daily_velocity overflow
            LEAST(9999, GREATEST(0, ROUND(g.daily_total_change)))::INTEGER as reviews_added,
            CASE WHEN g.daily_total_change > 0 THEN LEAST(9999, GREATEST(0, ROUND(g.daily_positive_change)))::INTEGER ELSE 0 END as positive_added,
            CASE WHEN g.daily_total_change > 0 THEN LEAST(9999, GREATEST(0, ROUND(g.daily_total_change - g.daily_positive_change)))::INTEGER ELSE 0 END as negative_added
        FROM gaps g
        CROSS JOIN LATERAL generate_series(g.prev_date + 1, g.next_date - 1, '1 day'::INTERVAL) as gap_date
    ),

    inserted AS (
        INSERT INTO review_deltas (
            appid, delta_date, total_reviews, positive_reviews, review_score,
            reviews_added, positive_added, negative_added, hours_since_last_sync, is_interpolated
        )
        SELECT
            p_appid, delta_date, total_reviews, positive_reviews, NULL,
            reviews_added, positive_added, negative_added, 24.0, TRUE
        FROM interpolated_rows
        ON CONFLICT (appid, delta_date) DO NOTHING
        RETURNING 1
    )

    SELECT COUNT(*)::INTEGER INTO v_interpolated_count FROM inserted;

    RETURN v_interpolated_count;
END;
$$;


--
-- Name: FUNCTION interpolate_review_deltas(p_appid integer, p_start_date date, p_end_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.interpolate_review_deltas(p_appid integer, p_start_date date, p_end_date date) IS 'Fill gaps in review_deltas with interpolated values for a single app (with overflow protection)';


--
-- Name: interpolate_review_deltas_batch(date, date, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.interpolate_review_deltas_batch(p_start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), p_end_date date DEFAULT CURRENT_DATE, p_after_appid integer DEFAULT 0, p_app_limit integer DEFAULT 2000) RETURNS TABLE(total_interpolated integer, apps_processed integer, last_appid integer, has_more boolean)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_total_interpolated INTEGER := 0;
    v_apps_processed INTEGER := 0;
    v_last_appid INTEGER;
    v_has_more BOOLEAN := FALSE;
BEGIN
    WITH batch_appids AS (
        SELECT DISTINCT rd.appid
        FROM review_deltas rd
        WHERE rd.is_interpolated = FALSE
          AND rd.delta_date BETWEEN p_start_date AND p_end_date
          AND rd.appid > COALESCE(p_after_appid, 0)
        ORDER BY rd.appid
        LIMIT GREATEST(COALESCE(p_app_limit, 2000), 1)
    ),

    actual_syncs AS (
        SELECT
            rd.appid,
            rd.delta_date,
            rd.total_reviews,
            rd.positive_reviews
        FROM review_deltas rd
        JOIN batch_appids ba ON ba.appid = rd.appid
        WHERE rd.is_interpolated = FALSE
          AND rd.delta_date BETWEEN p_start_date AND p_end_date
    ),

    with_next AS (
        SELECT
            appid,
            delta_date AS prev_date,
            total_reviews AS prev_total,
            positive_reviews AS prev_positive,
            LEAD(delta_date) OVER (PARTITION BY appid ORDER BY delta_date) AS next_date,
            LEAD(total_reviews) OVER (PARTITION BY appid ORDER BY delta_date) AS next_total,
            LEAD(positive_reviews) OVER (PARTITION BY appid ORDER BY delta_date) AS next_positive
        FROM actual_syncs
    ),

    gaps AS (
        SELECT
            appid,
            prev_date,
            prev_total,
            prev_positive,
            next_date,
            next_total,
            next_positive,
            (next_date - prev_date) AS days_gap,
            (next_total - prev_total)::DECIMAL / (next_date - prev_date) AS daily_total_change,
            (next_positive - prev_positive)::DECIMAL / (next_date - prev_date) AS daily_positive_change
        FROM with_next
        WHERE next_date IS NOT NULL
          AND (next_date - prev_date) > 1
    ),

    interpolated_rows AS (
        SELECT
            g.appid,
            gap_date::DATE AS delta_date,
            LEAST(
                2147483647,
                GREATEST(0, g.prev_total + ROUND(g.daily_total_change * (gap_date::DATE - g.prev_date)))
            )::INTEGER AS total_reviews,
            LEAST(
                2147483647,
                GREATEST(0, g.prev_positive + ROUND(g.daily_positive_change * (gap_date::DATE - g.prev_date)))
            )::INTEGER AS positive_reviews,
            LEAST(9999, GREATEST(0, ROUND(g.daily_total_change)))::INTEGER AS reviews_added,
            CASE
                WHEN g.daily_total_change > 0 THEN
                    LEAST(9999, GREATEST(0, ROUND(g.daily_positive_change)))::INTEGER
                ELSE 0
            END AS positive_added,
            CASE
                WHEN g.daily_total_change > 0 THEN
                    LEAST(9999, GREATEST(0, ROUND(g.daily_total_change - g.daily_positive_change)))::INTEGER
                ELSE 0
            END AS negative_added
        FROM gaps g
        CROSS JOIN LATERAL generate_series(
            g.prev_date + 1,
            g.next_date - 1,
            '1 day'::INTERVAL
        ) AS gap_date
    ),

    missing_rows AS (
        SELECT ir.*
        FROM interpolated_rows ir
        WHERE NOT EXISTS (
            SELECT 1
            FROM review_deltas existing
            WHERE existing.appid = ir.appid
              AND existing.delta_date = ir.delta_date
        )
    ),

    inserted AS (
        INSERT INTO review_deltas (
            appid,
            delta_date,
            total_reviews,
            positive_reviews,
            review_score,
            reviews_added,
            positive_added,
            negative_added,
            hours_since_last_sync,
            is_interpolated
        )
        SELECT
            appid,
            delta_date,
            total_reviews,
            positive_reviews,
            NULL,
            reviews_added,
            positive_added,
            negative_added,
            24.0,
            TRUE
        FROM missing_rows
        ON CONFLICT (appid, delta_date) DO NOTHING
        RETURNING 1
    )

    SELECT
        COALESCE((SELECT COUNT(*)::INTEGER FROM inserted), 0),
        COALESCE((SELECT COUNT(*)::INTEGER FROM batch_appids), 0),
        (SELECT MAX(appid) FROM batch_appids)
    INTO v_total_interpolated, v_apps_processed, v_last_appid;

    IF v_last_appid IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM review_deltas rd
            WHERE rd.is_interpolated = FALSE
              AND rd.delta_date BETWEEN p_start_date AND p_end_date
              AND rd.appid > v_last_appid
        )
        INTO v_has_more;
    END IF;

    RETURN QUERY
    SELECT v_total_interpolated, v_apps_processed, v_last_appid, v_has_more;
END;
$$;


--
-- Name: FUNCTION interpolate_review_deltas_batch(p_start_date date, p_end_date date, p_after_appid integer, p_app_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.interpolate_review_deltas_batch(p_start_date date, p_end_date date, p_after_appid integer, p_app_limit integer) IS 'Interpolate review_deltas in appid batches to stay within Supabase RPC statement timeout';


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
$$;


--
-- Name: list_recent_change_activity_appids(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_recent_change_activity_appids(p_lookback_days integer DEFAULT 180, p_after_appid integer DEFAULT 0, p_limit integer DEFAULT 1000) RETURNS TABLE(appid integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT e.appid
  FROM public.app_change_events e
  WHERE e.source IN ('storefront', 'pics', 'media')
    AND e.occurred_at >= NOW() - make_interval(days => GREATEST(COALESCE(p_lookback_days, 180), 1))
    AND e.appid > GREATEST(COALESCE(p_after_appid, 0), 0)
  GROUP BY e.appid
  ORDER BY e.appid
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000);
$$;


--
-- Name: mark_app_capture_work_dirty(jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_app_capture_work_dirty(p_jobs jsonb DEFAULT '[]'::jsonb, p_cooldown_hours integer DEFAULT 6) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_cooldown INTERVAL := make_interval(hours => GREATEST(COALESCE(p_cooldown_hours, 6), 1));
  v_affected INTEGER;
BEGIN
  WITH normalized_jobs AS (
    SELECT
      (job->>'appid')::INTEGER AS appid,
      (job->>'source')::app_capture_source AS source,
      job->>'trigger_reason' AS trigger_reason,
      COALESCE(job->>'trigger_cursor', '') AS trigger_cursor,
      COALESCE((job->>'priority')::INTEGER, 100) AS priority,
      COALESCE(job->'payload', '{}'::jsonb) AS payload
    FROM jsonb_array_elements(COALESCE(p_jobs, '[]'::jsonb)) AS job
  ),
  upserted AS (
    INSERT INTO app_capture_work_state (
      appid,
      source,
      priority,
      latest_trigger_reason,
      latest_trigger_cursor,
      payload,
      dirty_since,
      last_dirty_at,
      next_available_at,
      dead_lettered_at,
      last_error,
      created_at,
      updated_at
    )
    SELECT
      appid,
      source,
      priority,
      trigger_reason,
      trigger_cursor,
      payload,
      v_now,
      v_now,
      v_now,
      NULL,
      NULL,
      v_now,
      v_now
    FROM normalized_jobs
    WHERE appid IS NOT NULL
      AND source IS NOT NULL
      AND trigger_reason IS NOT NULL
    ON CONFLICT (appid, source)
    DO UPDATE
    SET priority = GREATEST(app_capture_work_state.priority, EXCLUDED.priority),
        latest_trigger_reason = EXCLUDED.latest_trigger_reason,
        latest_trigger_cursor = EXCLUDED.latest_trigger_cursor,
        payload = CASE
          WHEN app_capture_work_state.source = 'projection_refresh'
            AND app_capture_work_state.dirty_since IS NOT NULL
            THEN public.merge_projection_refresh_payload(app_capture_work_state.payload, EXCLUDED.payload)
          ELSE EXCLUDED.payload
        END,
        dirty_since = COALESCE(app_capture_work_state.dirty_since, v_now),
        last_dirty_at = v_now,
        next_available_at = CASE
          WHEN app_capture_work_state.dirty_since IS NULL THEN GREATEST(
            v_now,
            COALESCE(app_capture_work_state.last_completed_at + v_cooldown, v_now)
          )
          ELSE app_capture_work_state.next_available_at
        END,
        dead_lettered_at = NULL,
        last_error = NULL,
        attempts = CASE
          WHEN app_capture_work_state.dead_lettered_at IS NOT NULL THEN 0
          ELSE app_capture_work_state.attempts
        END,
        worker_id = CASE
          WHEN app_capture_work_state.dead_lettered_at IS NOT NULL THEN NULL
          ELSE app_capture_work_state.worker_id
        END,
        claimed_at = CASE
          WHEN app_capture_work_state.dead_lettered_at IS NOT NULL THEN NULL
          ELSE app_capture_work_state.claimed_at
        END,
        updated_at = v_now
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_affected
  FROM upserted;

  RETURN COALESCE(v_affected, 0);
END;
$$;


--
-- Name: mark_apps_embedded(integer[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_apps_embedded(p_appids integer[], p_hashes text[]) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Update sync_status for all apps
    UPDATE sync_status s
    SET
        last_embedding_sync = NOW(),
        embedding_hash = p_hashes[array_position(p_appids, s.appid)]
    WHERE s.appid = ANY(p_appids);
END;
$$;


--
-- Name: mark_developers_embedded(integer[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_developers_embedded(p_ids integer[], p_hashes text[]) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE developers
    SET
        last_embedding_sync = NOW(),
        embedding_hash = p_hashes[array_position(p_ids, id)]
    WHERE id = ANY(p_ids);
END;
$$;


--
-- Name: mark_publishers_embedded(integer[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_publishers_embedded(p_ids integer[], p_hashes text[]) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE publishers
    SET
        last_embedding_sync = NOW(),
        embedding_hash = p_hashes[array_position(p_ids, id)]
    WHERE id = ANY(p_ids);
END;
$$;


--
-- Name: merge_projection_refresh_payload(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_projection_refresh_payload(p_existing jsonb, p_incoming jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  merged_payload JSONB := COALESCE(p_existing, '{}'::JSONB) || COALESCE(p_incoming, '{}'::JSONB);
  merged_news_gids TEXT[];
  merged_deleted_gids TEXT[];
BEGIN
  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO merged_news_gids
  FROM (
    SELECT gid
    FROM (
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_existing, '{}'::JSONB)->'news_gids') = 'array'
            THEN COALESCE(p_existing, '{}'::JSONB)->'news_gids'
          ELSE '[]'::JSONB
        END
      )
      UNION
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_incoming, '{}'::JSONB)->'news_gids') = 'array'
            THEN COALESCE(p_incoming, '{}'::JSONB)->'news_gids'
          ELSE '[]'::JSONB
        END
      )
    ) merged
    WHERE gid IS NOT NULL
    ORDER BY gid
    LIMIT 200
  ) deduped;

  IF CARDINALITY(merged_news_gids) > 0 THEN
    merged_payload := jsonb_set(merged_payload, '{news_gids}', to_jsonb(merged_news_gids), true);
  ELSE
    merged_payload := merged_payload - 'news_gids';
  END IF;

  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO merged_deleted_gids
  FROM (
    SELECT gid
    FROM (
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_existing, '{}'::JSONB)->'deleted_news_gids') = 'array'
            THEN COALESCE(p_existing, '{}'::JSONB)->'deleted_news_gids'
          ELSE '[]'::JSONB
        END
      )
      UNION
      SELECT DISTINCT NULLIF(BTRIM(value), '') AS gid
      FROM jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(COALESCE(p_incoming, '{}'::JSONB)->'deleted_news_gids') = 'array'
            THEN COALESCE(p_incoming, '{}'::JSONB)->'deleted_news_gids'
          ELSE '[]'::JSONB
        END
      )
    ) merged
    WHERE gid IS NOT NULL
    ORDER BY gid
    LIMIT 200
  ) deduped;

  IF CARDINALITY(merged_deleted_gids) > 0 THEN
    merged_payload := jsonb_set(merged_payload, '{deleted_news_gids}', to_jsonb(merged_deleted_gids), true);
  ELSE
    merged_payload := merged_payload - 'deleted_news_gids';
  END IF;

  RETURN merged_payload;
END;
$$;


--
-- Name: FUNCTION merge_projection_refresh_payload(p_existing jsonb, p_incoming jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.merge_projection_refresh_payload(p_existing jsonb, p_incoming jsonb) IS 'Merges gid batches for coalesced projection_refresh work-state rows so repeated news changes do not overwrite pending gid payloads.';


--
-- Name: normalize_steam_news_search_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_steam_news_search_text(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT NULLIF(
    BTRIM(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(COALESCE(p_value, ''), 'https?://[^[:space:]]+', ' ', 'gi'),
            '<[^>]+>',
            ' ',
            'g'
          ),
          E'[\\n\\r\\t]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;


--
-- Name: promote_reviews_sync(integer, text, integer, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_reviews_sync(p_appid integer, p_bucket text, p_score integer, p_reason text, p_until timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_until TIMESTAMPTZ := COALESCE(p_until, v_now + INTERVAL '2 hours');
    v_score INTEGER := GREATEST(COALESCE(p_score, 0), 0);
BEGIN
    IF p_bucket NOT IN (
        'launch_critical',
        'change_critical',
        'active_reviews',
        'important_backfill',
        'unknown_sweep'
    ) THEN
        RAISE EXCEPTION 'Unsupported reviews override bucket: %', p_bucket;
    END IF;

    INSERT INTO sync_status (
        appid,
        reviews_priority_override_bucket,
        reviews_priority_override_score,
        reviews_priority_override_reason,
        reviews_priority_override_until,
        next_reviews_sync
    )
    VALUES (
        p_appid,
        p_bucket,
        v_score,
        p_reason,
        v_until,
        v_now
    )
    ON CONFLICT (appid) DO UPDATE
    SET
        reviews_priority_override_bucket = CASE
            WHEN sync_status.reviews_priority_override_until IS NOT NULL
                 AND sync_status.reviews_priority_override_until > v_now
                 AND COALESCE(sync_status.reviews_priority_override_score, 0) > v_score
            THEN sync_status.reviews_priority_override_bucket
            ELSE EXCLUDED.reviews_priority_override_bucket
        END,
        reviews_priority_override_score = GREATEST(
            COALESCE(sync_status.reviews_priority_override_score, 0),
            v_score
        ),
        reviews_priority_override_reason = CASE
            WHEN sync_status.reviews_priority_override_until IS NOT NULL
                 AND sync_status.reviews_priority_override_until > v_now
                 AND COALESCE(sync_status.reviews_priority_override_score, 0) > v_score
            THEN sync_status.reviews_priority_override_reason
            ELSE EXCLUDED.reviews_priority_override_reason
        END,
        reviews_priority_override_until = GREATEST(
            COALESCE(sync_status.reviews_priority_override_until, v_now),
            v_until
        ),
        next_reviews_sync = LEAST(COALESCE(sync_status.next_reviews_sync, v_now), v_now);
END;
$$;


--
-- Name: FUNCTION promote_reviews_sync(p_appid integer, p_bucket text, p_score integer, p_reason text, p_until timestamp with time zone); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.promote_reviews_sync(p_appid integer, p_bucket text, p_score integer, p_reason text, p_until timestamp with time zone) IS 'Promote an app into a short-lived reviews scheduling lane and pull next_reviews_sync forward to now.';


--
-- Name: recalculate_ccu_tiers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalculate_ccu_tiers() RETURNS TABLE(tier1_count integer, tier2_count integer, tier3_count integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_tier1_count INT;
  v_tier2_count INT;
  v_tier3_count INT;
BEGIN
  -- Step 1: Calculate recent peak CCU for all games (last 7 days from snapshots)
  -- Falls back to daily_metrics if no snapshots exist yet
  CREATE TEMP TABLE recent_ccu ON COMMIT DROP AS
  SELECT
    COALESCE(s.appid, d.appid) as appid,
    GREATEST(COALESCE(s.peak_ccu, 0), COALESCE(d.peak_ccu, 0)) as recent_peak_ccu
  FROM (
    SELECT appid, MAX(player_count) as peak_ccu
    FROM ccu_snapshots
    WHERE snapshot_time > NOW() - INTERVAL '7 days'
    GROUP BY appid
  ) s
  FULL OUTER JOIN (
    SELECT appid, MAX(ccu_peak) as peak_ccu
    FROM daily_metrics
    WHERE metric_date > CURRENT_DATE - INTERVAL '7 days'
    GROUP BY appid
  ) d ON s.appid = d.appid;

  -- Step 2: Get release rankings (newest first)
  -- Include games with NULL release_date if is_released=TRUE
  -- These are potential fresh releases that need tracking
  CREATE TEMP TABLE release_ranks ON COMMIT DROP AS
  SELECT
    appid,
    ROW_NUMBER() OVER (
      ORDER BY
        -- NULL release dates go first (potential fresh releases needing sync)
        CASE WHEN release_date IS NULL THEN 0 ELSE 1 END,
        release_date DESC NULLS LAST,
        appid DESC
    ) as release_rank
  FROM apps
  WHERE type = 'game'
    AND is_released = TRUE
    AND is_delisted = FALSE
    AND (
      -- Include games released in the last year
      release_date >= CURRENT_DATE - INTERVAL '1 year'
      -- Also include games with no release date (potential fresh releases)
      OR release_date IS NULL
    );

  -- Step 3: Determine Tier 1 (top 500 by CCU)
  CREATE TEMP TABLE tier1_games ON COMMIT DROP AS
  SELECT appid
  FROM recent_ccu
  WHERE recent_peak_ccu > 0
  ORDER BY recent_peak_ccu DESC NULLS LAST
  LIMIT 500;

  -- Step 4: Determine Tier 2 (top 1000 newest releases NOT in Tier 1)
  CREATE TEMP TABLE tier2_games ON COMMIT DROP AS
  SELECT r.appid
  FROM release_ranks r
  WHERE r.appid NOT IN (SELECT appid FROM tier1_games)
  ORDER BY r.release_rank
  LIMIT 1000;

  -- Step 5: Calculate CCU growth percentages (RESTORED from Jan 17 migration)
  -- Uses 3-day windows instead of 7-day to work with limited snapshot history
  -- 3-day growth: (last 3 days avg - prior 3 days avg) / prior avg * 100
  -- 30-day growth: (last 3 days avg - 30-day baseline avg) / baseline avg * 100
  CREATE TEMP TABLE ccu_growth ON COMMIT DROP AS
  SELECT
    appid,
    -- 3-day growth: compare last 3 days to prior 3 days (days 3-6 ago)
    CASE
      WHEN prior_3d_avg IS NULL OR prior_3d_avg = 0 THEN NULL
      ELSE ROUND(((last_3d_avg - prior_3d_avg) / prior_3d_avg) * 100, 2)
    END AS growth_7d_pct,
    -- 30-day growth: compare last 3 days to full 30-day baseline
    CASE
      WHEN baseline_30d_avg IS NULL OR baseline_30d_avg = 0 THEN NULL
      ELSE ROUND(((last_3d_avg - baseline_30d_avg) / baseline_30d_avg) * 100, 2)
    END AS growth_30d_pct
  FROM (
    SELECT
      appid,
      AVG(player_count) FILTER (WHERE snapshot_time > NOW() - INTERVAL '3 days') AS last_3d_avg,
      AVG(player_count) FILTER (WHERE snapshot_time > NOW() - INTERVAL '6 days' AND snapshot_time <= NOW() - INTERVAL '3 days') AS prior_3d_avg,
      AVG(player_count) FILTER (WHERE snapshot_time > NOW() - INTERVAL '30 days') AS baseline_30d_avg
    FROM ccu_snapshots
    WHERE snapshot_time > NOW() - INTERVAL '30 days'
    GROUP BY appid
  ) growth_calcs;

  -- Step 6: Upsert all assignments for active games with growth data
  INSERT INTO ccu_tier_assignments (
    appid, ccu_tier, tier_reason, recent_peak_ccu, release_rank,
    ccu_growth_7d_percent, ccu_growth_30d_percent, updated_at
  )
  SELECT
    a.appid,
    CASE
      WHEN t1.appid IS NOT NULL THEN 1
      WHEN t2.appid IS NOT NULL THEN 2
      ELSE 3
    END as ccu_tier,
    CASE
      WHEN t1.appid IS NOT NULL THEN 'top_ccu'
      WHEN t2.appid IS NOT NULL THEN 'new_release'
      ELSE 'default'
    END as tier_reason,
    rc.recent_peak_ccu,
    rr.release_rank,
    cg.growth_7d_pct,
    cg.growth_30d_pct,
    NOW()
  FROM apps a
  LEFT JOIN tier1_games t1 ON a.appid = t1.appid
  LEFT JOIN tier2_games t2 ON a.appid = t2.appid
  LEFT JOIN recent_ccu rc ON a.appid = rc.appid
  LEFT JOIN release_ranks rr ON a.appid = rr.appid
  LEFT JOIN ccu_growth cg ON a.appid = cg.appid
  WHERE a.type = 'game' AND a.is_released = TRUE AND a.is_delisted = FALSE
  ON CONFLICT (appid) DO UPDATE SET
    ccu_tier = EXCLUDED.ccu_tier,
    tier_reason = EXCLUDED.tier_reason,
    recent_peak_ccu = EXCLUDED.recent_peak_ccu,
    release_rank = EXCLUDED.release_rank,
    ccu_growth_7d_percent = EXCLUDED.ccu_growth_7d_percent,
    ccu_growth_30d_percent = EXCLUDED.ccu_growth_30d_percent,
    last_tier_change = CASE
      WHEN ccu_tier_assignments.ccu_tier != EXCLUDED.ccu_tier
      THEN NOW()
      ELSE ccu_tier_assignments.last_tier_change
    END,
    updated_at = NOW();

  -- Get counts for return
  SELECT COUNT(*) INTO v_tier1_count FROM ccu_tier_assignments WHERE ccu_tier = 1;
  SELECT COUNT(*) INTO v_tier2_count FROM ccu_tier_assignments WHERE ccu_tier = 2;
  SELECT COUNT(*) INTO v_tier3_count FROM ccu_tier_assignments WHERE ccu_tier = 3;

  RETURN QUERY SELECT v_tier1_count, v_tier2_count, v_tier3_count;
END;
$$;


--
-- Name: FUNCTION recalculate_ccu_tiers(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.recalculate_ccu_tiers() IS 'Recalculates tier assignments and CCU growth percentages. Tier 1 = top 500 by 7-day peak CCU, Tier 2 = 1000 newest releases (including NULL release dates), Tier 3 = all others. Growth calculated using 3-day comparison windows from ccu_snapshots.';


--
-- Name: refresh_all_metrics_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_all_metrics_views() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY developer_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY publisher_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY developer_year_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY publisher_year_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY developer_game_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY publisher_game_metrics;
END;
$$;


--
-- Name: FUNCTION refresh_all_metrics_views(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_all_metrics_views() IS 'Refreshes all metrics materialized views. Call periodically to update aggregated stats.';


--
-- Name: refresh_ccu_quality_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_ccu_quality_stats() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  WITH latest_successful_applist AS (
    SELECT j.started_at
    FROM public.sync_jobs j
    WHERE j.job_type = 'applist'
      AND j.status = 'completed'
      AND COALESCE(j.items_failed, 0) = 0
    ORDER BY j.started_at DESC
    LIMIT 1
  ),
  catalog_ready AS (
    SELECT EXISTS(
      SELECT 1
      FROM public.apps a
      JOIN latest_successful_applist l
        ON a.last_seen_in_steam_applist_at = l.started_at
    ) AS ready
  ),
  catalog_appids AS MATERIALIZED (
    SELECT a.appid
    FROM public.apps a
    JOIN latest_successful_applist l
      ON a.last_seen_in_steam_applist_at = l.started_at
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = TRUE

    UNION ALL

    SELECT s.appid
    FROM public.sync_status s
    CROSS JOIN catalog_ready cr
    WHERE cr.ready = FALSE
      AND s.is_syncable = TRUE
  ),
  ccu_rows AS MATERIALIZED (
    SELECT
      c.appid,
      (ct.appid IS NOT NULL) AS has_tier_assignment,
      ct.last_ccu_validation_state,
      ct.ccu_fetch_status,
      ct.ccu_skip_until,
      ldm.ccu_peak,
      ldm.ccu_source
    FROM catalog_appids c
    LEFT JOIN public.ccu_tier_assignments ct
      ON ct.appid = c.appid
    LEFT JOIN public.latest_daily_metrics ldm
      ON ldm.appid = c.appid
  ),
  resolved_rows AS MATERIALIZED (
    SELECT
      appid,
      has_tier_assignment,
      CASE
        WHEN last_ccu_validation_state = 'confirmed_positive' THEN 'confirmed_positive'
        WHEN last_ccu_validation_state = 'confirmed_zero' THEN 'confirmed_zero'
        WHEN last_ccu_validation_state = 'suspect_zero' THEN 'suspect_zero'
        WHEN ccu_fetch_status = 'invalid' AND ccu_skip_until > NOW() THEN 'skipped'
        WHEN ccu_fetch_status = 'invalid' THEN 'invalid'
        ELSE 'unavailable'
      END::TEXT AS ccu_confidence_state,
      ccu_peak,
      ccu_source
    FROM ccu_rows
  ),
  aggregated AS (
    SELECT
      COUNT(*)::BIGINT AS current_catalog_apps,
      COUNT(*) FILTER (WHERE has_tier_assignment)::BIGINT AS tier_assigned,
      COUNT(*) FILTER (WHERE NOT has_tier_assignment)::BIGINT AS no_tier_assignment,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_positive')::BIGINT AS confirmed_positive,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'confirmed_zero')::BIGINT AS confirmed_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'suspect_zero')::BIGINT AS suspect_zero,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'skipped')::BIGINT AS skipped,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'invalid')::BIGINT AS invalid,
      COUNT(*) FILTER (WHERE ccu_confidence_state = 'unavailable')::BIGINT AS unavailable,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steam_api')::BIGINT AS steam_api,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source = 'steamspy')::BIGINT AS steamspy,
      COUNT(*) FILTER (WHERE ccu_peak IS NOT NULL AND ccu_source IS NULL)::BIGINT AS legacy_unknown
    FROM resolved_rows
  )
  INSERT INTO public.dashboard_stats_cache (
    id,
    ccu_current_catalog_apps,
    ccu_tier_assigned,
    ccu_no_tier_assignment,
    ccu_confirmed_positive,
    ccu_confirmed_zero,
    ccu_suspect_zero,
    ccu_skipped,
    ccu_invalid,
    ccu_unavailable,
    ccu_steam_api,
    ccu_steamspy,
    ccu_legacy_unknown,
    ccu_quality_updated_at
  )
  SELECT
    'main',
    aggregated.current_catalog_apps,
    aggregated.tier_assigned,
    aggregated.no_tier_assignment,
    aggregated.confirmed_positive,
    aggregated.confirmed_zero,
    aggregated.suspect_zero,
    aggregated.skipped,
    aggregated.invalid,
    aggregated.unavailable,
    aggregated.steam_api,
    aggregated.steamspy,
    aggregated.legacy_unknown,
    NOW()
  FROM aggregated
  ON CONFLICT (id) DO UPDATE SET
    ccu_current_catalog_apps = EXCLUDED.ccu_current_catalog_apps,
    ccu_tier_assigned = EXCLUDED.ccu_tier_assigned,
    ccu_no_tier_assignment = EXCLUDED.ccu_no_tier_assignment,
    ccu_confirmed_positive = EXCLUDED.ccu_confirmed_positive,
    ccu_confirmed_zero = EXCLUDED.ccu_confirmed_zero,
    ccu_suspect_zero = EXCLUDED.ccu_suspect_zero,
    ccu_skipped = EXCLUDED.ccu_skipped,
    ccu_invalid = EXCLUDED.ccu_invalid,
    ccu_unavailable = EXCLUDED.ccu_unavailable,
    ccu_steam_api = EXCLUDED.ccu_steam_api,
    ccu_steamspy = EXCLUDED.ccu_steamspy,
    ccu_legacy_unknown = EXCLUDED.ccu_legacy_unknown,
    ccu_quality_updated_at = EXCLUDED.ccu_quality_updated_at;
END;
$$;


--
-- Name: FUNCTION refresh_ccu_quality_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_ccu_quality_stats() IS 'Refreshes cached current-catalog admin CCU quality stats into dashboard_stats_cache.';


--
-- Name: refresh_change_activity_bursts_for_app(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_change_activity_bursts_for_app(p_appid integer, p_lookback_days integer DEFAULT 180) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_window_start TIMESTAMPTZ := NOW() - make_interval(days => GREATEST(COALESCE(p_lookback_days, 180), 1)) - INTERVAL '90 minutes';
  v_inserted INTEGER := 0;
BEGIN
  IF p_appid IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.change_activity_bursts
  WHERE appid = p_appid
    AND burst_ended_at >= v_window_start;

  WITH app_metadata AS (
    SELECT
      a.appid,
      a.name AS app_name,
      a.type AS app_type,
      a.is_released,
      a.release_date,
      COALESCE(ldm.total_reviews, 0) AS total_reviews,
      COALESCE(ldm.ccu_peak, 0) AS ccu_peak
    FROM public.apps a
    LEFT JOIN public.latest_daily_metrics ldm ON ldm.appid = a.appid
    WHERE a.appid = p_appid
  ),
  classified_events AS (
    SELECT
      e.id,
      e.appid,
      e.source::TEXT AS source,
      e.change_type::TEXT AS change_type,
      e.occurred_at,
      public.change_type_signal_family(e.change_type::TEXT) AS signal_family,
      public.change_type_label(e.change_type::TEXT) AS highlight_label
    FROM public.app_change_events e
    WHERE e.appid = p_appid
      AND e.source IN ('storefront', 'pics', 'media')
      AND e.occurred_at >= v_window_start
  ),
  sequenced AS (
    SELECT
      ce.*,
      CASE
        WHEN LAG(ce.occurred_at) OVER app_window IS NULL THEN 1
        WHEN ce.occurred_at - LAG(ce.occurred_at) OVER app_window > INTERVAL '90 minutes' THEN 1
        ELSE 0
      END AS starts_new_burst
    FROM classified_events ce
    WINDOW app_window AS (PARTITION BY ce.appid ORDER BY ce.occurred_at)
  ),
  burst_members AS (
    SELECT
      s.*,
      SUM(s.starts_new_burst) OVER (
        PARTITION BY s.appid
        ORDER BY s.occurred_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS burst_number
    FROM sequenced s
  ),
  source_stats AS (
    SELECT
      bm.appid,
      bm.burst_number,
      bm.source
    FROM burst_members bm
    GROUP BY bm.appid, bm.burst_number, bm.source
  ),
  change_type_stats AS (
    SELECT
      bm.appid,
      bm.burst_number,
      bm.change_type,
      bm.signal_family,
      bm.highlight_label,
      MAX(bm.occurred_at) AS last_seen_at
    FROM burst_members bm
    GROUP BY bm.appid, bm.burst_number, bm.change_type, bm.signal_family, bm.highlight_label
  ),
  burst_core AS (
    SELECT
      bm.appid,
      bm.burst_number,
      MIN(bm.occurred_at) AS burst_started_at,
      MAX(bm.occurred_at) AS burst_ended_at,
      COUNT(*)::INTEGER AS event_count,
      COUNT(DISTINCT bm.change_type)::INTEGER AS change_type_count,
      BOOL_OR(bm.change_type NOT IN ('build_id_changed', 'last_content_update_changed')) AS has_non_technical
    FROM burst_members bm
    GROUP BY bm.appid, bm.burst_number
  ),
  projection_rows AS (
    SELECT
      public.change_burst_id(am.appid, bc.burst_started_at, bc.burst_ended_at) AS burst_id,
      am.appid,
      am.app_name,
      am.app_type,
      am.is_released,
      am.release_date,
      bc.burst_ended_at AS effective_at,
      bc.burst_started_at,
      bc.burst_ended_at,
      bc.event_count,
      bc.change_type_count,
      ARRAY(
        SELECT ss.source
        FROM source_stats ss
        WHERE ss.appid = bc.appid
          AND ss.burst_number = bc.burst_number
        ORDER BY ss.source
      ) AS source_set,
      ARRAY(
        SELECT cts.change_type
        FROM change_type_stats cts
        WHERE cts.appid = bc.appid
          AND cts.burst_number = bc.burst_number
        ORDER BY cts.last_seen_at DESC, cts.change_type
      ) AS change_types,
      ARRAY(
        SELECT cts.change_type
        FROM change_type_stats cts
        WHERE cts.appid = bc.appid
          AND cts.burst_number = bc.burst_number
        ORDER BY public.change_signal_sort_rank(cts.signal_family), cts.last_seen_at DESC, cts.change_type
        LIMIT 3
      ) AS headline_change_types,
      ARRAY(
        SELECT cts.highlight_label
        FROM change_type_stats cts
        WHERE cts.appid = bc.appid
          AND cts.burst_number = bc.burst_number
        ORDER BY public.change_signal_sort_rank(cts.signal_family), cts.last_seen_at DESC, cts.highlight_label
        LIMIT 5
      ) AS highlight_labels,
      ARRAY(
        SELECT ranked.signal_family
        FROM (
          SELECT DISTINCT cts.signal_family
          FROM change_type_stats cts
          WHERE cts.appid = bc.appid
            AND cts.burst_number = bc.burst_number
        ) AS ranked
        ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
      ) AS signal_families,
      public.change_story_kind(
        ARRAY(
          SELECT ranked.signal_family
          FROM (
            SELECT DISTINCT cts.signal_family
            FROM change_type_stats cts
            WHERE cts.appid = bc.appid
              AND cts.burst_number = bc.burst_number
          ) AS ranked
          ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
        ),
        am.is_released,
        am.release_date
      ) AS story_kind,
      COALESCE(news_match.related_news_count, 0)::INTEGER AS related_news_count,
      COALESCE(news_match.related_news_count, 0) > 0 AS has_related_news,
      CASE
        WHEN bc.has_non_technical THEN TRUE
        WHEN am.is_released = FALSE THEN TRUE
        WHEN am.release_date IS NOT NULL AND am.release_date >= CURRENT_DATE - 30 THEN TRUE
        WHEN COALESCE(news_match.related_news_count, 0) > 0 THEN TRUE
        WHEN am.total_reviews >= 250 THEN TRUE
        WHEN am.ccu_peak >= 100 THEN TRUE
        ELSE FALSE
      END AS include_in_high_signal
    FROM burst_core bc
    JOIN app_metadata am ON am.appid = bc.appid
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS related_news_count
      FROM public.steam_news_items n
      WHERE n.appid = bc.appid
        AND COALESCE(n.published_at, n.first_seen_at) >= bc.burst_started_at - INTERVAL '24 hours'
        AND COALESCE(n.published_at, n.first_seen_at) <= bc.burst_ended_at + INTERVAL '24 hours'
    ) news_match ON TRUE
  ),
  inserted AS (
    INSERT INTO public.change_activity_bursts (
      burst_id,
      appid,
      app_name,
      app_type,
      is_released,
      release_date,
      effective_at,
      burst_started_at,
      burst_ended_at,
      event_count,
      change_type_count,
      source_set,
      change_types,
      headline_change_types,
      highlight_labels,
      signal_families,
      story_kind,
      has_related_news,
      related_news_count,
      include_in_high_signal,
      updated_at
    )
    SELECT
      pr.burst_id,
      pr.appid,
      pr.app_name,
      pr.app_type,
      pr.is_released,
      pr.release_date,
      pr.effective_at,
      pr.burst_started_at,
      pr.burst_ended_at,
      pr.event_count,
      pr.change_type_count,
      COALESCE(pr.source_set, ARRAY[]::TEXT[]),
      COALESCE(pr.change_types, ARRAY[]::TEXT[]),
      COALESCE(pr.headline_change_types, ARRAY[]::TEXT[]),
      COALESCE(pr.highlight_labels, ARRAY[]::TEXT[]),
      COALESCE(pr.signal_families, ARRAY[]::TEXT[]),
      pr.story_kind,
      pr.has_related_news,
      pr.related_news_count,
      pr.include_in_high_signal,
      NOW()
    FROM projection_rows pr
    ON CONFLICT (burst_id)
    DO UPDATE SET
      app_name = EXCLUDED.app_name,
      app_type = EXCLUDED.app_type,
      is_released = EXCLUDED.is_released,
      release_date = EXCLUDED.release_date,
      effective_at = EXCLUDED.effective_at,
      burst_started_at = EXCLUDED.burst_started_at,
      burst_ended_at = EXCLUDED.burst_ended_at,
      event_count = EXCLUDED.event_count,
      change_type_count = EXCLUDED.change_type_count,
      source_set = EXCLUDED.source_set,
      change_types = EXCLUDED.change_types,
      headline_change_types = EXCLUDED.headline_change_types,
      highlight_labels = EXCLUDED.highlight_labels,
      signal_families = EXCLUDED.signal_families,
      story_kind = EXCLUDED.story_kind,
      has_related_news = EXCLUDED.has_related_news,
      related_news_count = EXCLUDED.related_news_count,
      include_in_high_signal = EXCLUDED.include_in_high_signal,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted
  FROM inserted;

  RETURN COALESCE(v_inserted, 0);
END;
$$;


--
-- Name: refresh_change_pattern_activity_days_for_app(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_change_pattern_activity_days_for_app(p_appid integer, p_lookback_days integer DEFAULT 180) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_window_start TIMESTAMPTZ := NOW() - make_interval(days => GREATEST(COALESCE(p_lookback_days, 180), 1));
  v_inserted INTEGER := 0;
BEGIN
  IF p_appid IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.change_pattern_activity_days
  WHERE appid = p_appid
    AND activity_date >= (v_window_start AT TIME ZONE 'UTC')::DATE;

  WITH burst_window AS (
    SELECT
      cab.appid,
      cab.app_name,
      cab.app_type,
      cab.is_released,
      cab.release_date,
      cab.effective_at,
      cab.burst_id,
      cab.signal_families,
      cab.story_kind,
      cab.related_news_count
    FROM public.change_activity_bursts cab
    WHERE cab.appid = p_appid
      AND cab.effective_at >= v_window_start
  ),
  daily_base AS (
    SELECT
      bw.appid,
      (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
      MAX(bw.app_name) AS app_name,
      MAX(bw.app_type) AS app_type,
      BOOL_OR(COALESCE(bw.is_released, FALSE)) AS is_released,
      MAX(bw.release_date) AS release_date,
      MAX(bw.effective_at) AS latest_occurred_at,
      SUM(COALESCE(bw.related_news_count, 0))::INTEGER AS announcement_count,
      COUNT(*)::INTEGER AS total_bursts,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['release']::TEXT[])::INTEGER AS release_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['pricing']::TEXT[])::INTEGER AS pricing_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['store-page']::TEXT[])::INTEGER AS store_page_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['media']::TEXT[])::INTEGER AS media_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['taxonomy']::TEXT[])::INTEGER AS taxonomy_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['platform']::TEXT[])::INTEGER AS platform_count,
      COUNT(*) FILTER (WHERE bw.signal_families && ARRAY['build']::TEXT[])::INTEGER AS build_count
    FROM burst_window bw
    GROUP BY bw.appid, (bw.effective_at AT TIME ZONE 'UTC')::DATE
  ),
  daily_burst_ids AS (
    SELECT
      bw.appid,
      (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
      (ARRAY_AGG(bw.burst_id ORDER BY bw.effective_at DESC, bw.burst_id DESC))[1:8] AS burst_ids
    FROM burst_window bw
    GROUP BY bw.appid, (bw.effective_at AT TIME ZONE 'UTC')::DATE
  ),
  daily_signal_families AS (
    SELECT
      ranked.appid,
      ranked.activity_date,
      ARRAY_AGG(
        ranked.signal_family
        ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
      ) AS signal_families
    FROM (
      SELECT DISTINCT
        bw.appid,
        (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
        signal_family
      FROM burst_window bw
      CROSS JOIN LATERAL UNNEST(bw.signal_families) AS signal_family
    ) AS ranked
    GROUP BY ranked.appid, ranked.activity_date
  ),
  daily_story_kinds AS (
    SELECT
      ranked.appid,
      ranked.activity_date,
      ARRAY_AGG(ranked.story_kind ORDER BY ranked.story_kind) AS story_kinds
    FROM (
      SELECT DISTINCT
        bw.appid,
        (bw.effective_at AT TIME ZONE 'UTC')::DATE AS activity_date,
        bw.story_kind
      FROM burst_window bw
    ) AS ranked
    GROUP BY ranked.appid, ranked.activity_date
  ),
  upserted AS (
    INSERT INTO public.change_pattern_activity_days (
      appid,
      activity_date,
      app_name,
      app_type,
      is_released,
      release_date,
      latest_occurred_at,
      burst_ids,
      signal_families,
      story_kinds,
      announcement_count,
      total_bursts,
      release_count,
      pricing_count,
      store_page_count,
      media_count,
      taxonomy_count,
      platform_count,
      build_count
    )
    SELECT
      db.appid,
      db.activity_date,
      db.app_name,
      db.app_type,
      db.is_released,
      db.release_date,
      db.latest_occurred_at,
      COALESCE(dbi.burst_ids, ARRAY[]::TEXT[]),
      COALESCE(dsf.signal_families, ARRAY[]::TEXT[]),
      COALESCE(dst.story_kinds, ARRAY[]::TEXT[]),
      db.announcement_count,
      db.total_bursts,
      db.release_count,
      db.pricing_count,
      db.store_page_count,
      db.media_count,
      db.taxonomy_count,
      db.platform_count,
      db.build_count
    FROM daily_base db
    LEFT JOIN daily_burst_ids dbi
      ON dbi.appid = db.appid
     AND dbi.activity_date = db.activity_date
    LEFT JOIN daily_signal_families dsf
      ON dsf.appid = db.appid
     AND dsf.activity_date = db.activity_date
    LEFT JOIN daily_story_kinds dst
      ON dst.appid = db.appid
     AND dst.activity_date = db.activity_date
    ON CONFLICT (appid, activity_date) DO UPDATE
    SET
      app_name = EXCLUDED.app_name,
      app_type = EXCLUDED.app_type,
      is_released = EXCLUDED.is_released,
      release_date = EXCLUDED.release_date,
      latest_occurred_at = EXCLUDED.latest_occurred_at,
      burst_ids = EXCLUDED.burst_ids,
      signal_families = EXCLUDED.signal_families,
      story_kinds = EXCLUDED.story_kinds,
      announcement_count = EXCLUDED.announcement_count,
      total_bursts = EXCLUDED.total_bursts,
      release_count = EXCLUDED.release_count,
      pricing_count = EXCLUDED.pricing_count,
      store_page_count = EXCLUDED.store_page_count,
      media_count = EXCLUDED.media_count,
      taxonomy_count = EXCLUDED.taxonomy_count,
      platform_count = EXCLUDED.platform_count,
      build_count = EXCLUDED.build_count,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted
  FROM upserted;

  RETURN v_inserted;
END;
$$;


--
-- Name: refresh_change_pattern_app_windows_for_app(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_change_pattern_app_windows_for_app(p_appid integer, p_lookback_days integer DEFAULT 180) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_supported_lookback_days INTEGER := LEAST(GREATEST(COALESCE(p_lookback_days, 180), 1), 180);
  v_inserted INTEGER := 0;
BEGIN
  IF p_appid IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.change_pattern_app_windows
  WHERE appid = p_appid
    AND window_days <= v_supported_lookback_days;

  WITH window_config AS (
    SELECT window_days::INTEGER
    FROM UNNEST(ARRAY[7, 30, 90, 180]) AS window_days
    WHERE window_days <= v_supported_lookback_days
  ),
  daily_window AS (
    SELECT
      wc.window_days,
      cpad.*
    FROM window_config wc
    JOIN public.change_pattern_activity_days cpad
      ON cpad.appid = p_appid
     AND cpad.activity_date >= CURRENT_DATE - GREATEST(wc.window_days - 1, 0)
  ),
  window_base AS (
    SELECT
      dw.window_days,
      dw.appid,
      MAX(dw.app_name) AS app_name,
      MAX(dw.app_type) AS app_type,
      BOOL_OR(COALESCE(dw.is_released, FALSE)) AS is_released,
      MAX(dw.release_date) AS release_date,
      MAX(dw.latest_occurred_at) AS latest_occurred_at,
      SUM(dw.announcement_count)::INTEGER AS announcement_count,
      SUM(dw.total_bursts)::INTEGER AS change_count,
      SUM(dw.release_count)::INTEGER AS release_count,
      SUM(dw.pricing_count)::INTEGER AS pricing_count,
      SUM(dw.store_page_count)::INTEGER AS store_page_count,
      SUM(dw.media_count)::INTEGER AS media_count,
      SUM(dw.taxonomy_count)::INTEGER AS taxonomy_count,
      SUM(dw.platform_count)::INTEGER AS platform_count,
      SUM(dw.build_count)::INTEGER AS build_count
    FROM daily_window dw
    GROUP BY dw.window_days, dw.appid
  ),
  ranked_activity_ids AS (
    SELECT
      ranked.window_days,
      ranked.appid,
      ranked.burst_id,
      ROW_NUMBER() OVER (
        PARTITION BY ranked.window_days, ranked.appid
        ORDER BY ranked.latest_occurred_at DESC, ranked.activity_date DESC, ranked.ordinality, ranked.burst_id DESC
      ) AS burst_rank
    FROM (
      SELECT DISTINCT
        dw.window_days,
        dw.appid,
        dw.activity_date,
        dw.latest_occurred_at,
        burst.burst_id,
        burst.ordinality
      FROM daily_window dw
      CROSS JOIN LATERAL UNNEST(dw.burst_ids) WITH ORDINALITY AS burst(burst_id, ordinality)
    ) AS ranked
  ),
  window_activity_ids AS (
    SELECT
      rai.window_days,
      rai.appid,
      ARRAY_AGG(rai.burst_id ORDER BY rai.burst_rank) FILTER (WHERE rai.burst_rank <= 8) AS activity_ids
    FROM ranked_activity_ids rai
    GROUP BY rai.window_days, rai.appid
  ),
  window_signal_families AS (
    SELECT
      ranked.window_days,
      ranked.appid,
      ARRAY_AGG(
        ranked.signal_family
        ORDER BY public.change_signal_sort_rank(ranked.signal_family), ranked.signal_family
      ) AS signal_families
    FROM (
      SELECT DISTINCT
        dw.window_days,
        dw.appid,
        signal_family
      FROM daily_window dw
      CROSS JOIN LATERAL UNNEST(dw.signal_families) AS signal_family
    ) AS ranked
    GROUP BY ranked.window_days, ranked.appid
  ),
  window_story_kinds AS (
    SELECT
      ranked.window_days,
      ranked.appid,
      ARRAY_AGG(ranked.story_kind ORDER BY ranked.story_kind) AS story_kinds
    FROM (
      SELECT DISTINCT
        dw.window_days,
        dw.appid,
        story_kind
      FROM daily_window dw
      CROSS JOIN LATERAL UNNEST(dw.story_kinds) AS story_kind
    ) AS ranked
    GROUP BY ranked.window_days, ranked.appid
  ),
  upserted AS (
    INSERT INTO public.change_pattern_app_windows (
      appid,
      window_days,
      app_name,
      app_type,
      is_released,
      release_date,
      latest_occurred_at,
      activity_ids,
      signal_families,
      story_kinds,
      announcement_count,
      change_count,
      release_count,
      pricing_count,
      store_page_count,
      media_count,
      taxonomy_count,
      platform_count,
      build_count
    )
    SELECT
      wb.appid,
      wb.window_days,
      wb.app_name,
      wb.app_type,
      wb.is_released,
      wb.release_date,
      wb.latest_occurred_at,
      COALESCE(wai.activity_ids, ARRAY[]::TEXT[]),
      COALESCE(wsf.signal_families, ARRAY[]::TEXT[]),
      COALESCE(wsk.story_kinds, ARRAY[]::TEXT[]),
      wb.announcement_count,
      wb.change_count,
      wb.release_count,
      wb.pricing_count,
      wb.store_page_count,
      wb.media_count,
      wb.taxonomy_count,
      wb.platform_count,
      wb.build_count
    FROM window_base wb
    LEFT JOIN window_activity_ids wai
      ON wai.window_days = wb.window_days
     AND wai.appid = wb.appid
    LEFT JOIN window_signal_families wsf
      ON wsf.window_days = wb.window_days
     AND wsf.appid = wb.appid
    LEFT JOIN window_story_kinds wsk
      ON wsk.window_days = wb.window_days
     AND wsk.appid = wb.appid
    ON CONFLICT (appid, window_days) DO UPDATE
    SET
      app_name = EXCLUDED.app_name,
      app_type = EXCLUDED.app_type,
      is_released = EXCLUDED.is_released,
      release_date = EXCLUDED.release_date,
      latest_occurred_at = EXCLUDED.latest_occurred_at,
      activity_ids = EXCLUDED.activity_ids,
      signal_families = EXCLUDED.signal_families,
      story_kinds = EXCLUDED.story_kinds,
      announcement_count = EXCLUDED.announcement_count,
      change_count = EXCLUDED.change_count,
      release_count = EXCLUDED.release_count,
      pricing_count = EXCLUDED.pricing_count,
      store_page_count = EXCLUDED.store_page_count,
      media_count = EXCLUDED.media_count,
      taxonomy_count = EXCLUDED.taxonomy_count,
      platform_count = EXCLUDED.platform_count,
      build_count = EXCLUDED.build_count,
      updated_at = NOW()
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted
  FROM upserted;

  RETURN v_inserted;
END;
$$;


--
-- Name: refresh_dashboard_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_dashboard_stats() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  INSERT INTO public.dashboard_stats_cache (
    id,
    apps_count,
    publishers_count,
    developers_count,
    pics_synced,
    categories_count,
    genres_count,
    tags_count,
    franchises_count,
    parent_app_count,
    updated_at
  )
  SELECT
    'main',
    (SELECT COUNT(*) FROM public.get_current_catalog_appids()),
    (SELECT COUNT(*) FROM public.publishers),
    (SELECT COUNT(*) FROM public.developers),
    (
      SELECT COUNT(*)
      FROM public.get_current_catalog_appids() c
      JOIN public.sync_status s ON s.appid = c.appid
      WHERE s.last_pics_sync IS NOT NULL
    ),
    (
      SELECT COUNT(DISTINCT ac.appid)
      FROM public.app_categories ac
      JOIN public.get_current_catalog_appids() c ON c.appid = ac.appid
    ),
    (
      SELECT COUNT(DISTINCT ag.appid)
      FROM public.app_genres ag
      JOIN public.get_current_catalog_appids() c ON c.appid = ag.appid
    ),
    (
      SELECT COUNT(DISTINCT ast.appid)
      FROM public.app_steam_tags ast
      JOIN public.get_current_catalog_appids() c ON c.appid = ast.appid
    ),
    (
      SELECT COUNT(DISTINCT af.appid)
      FROM public.app_franchises af
      JOIN public.get_current_catalog_appids() c ON c.appid = af.appid
    ),
    (
      SELECT COUNT(*)
      FROM public.apps a
      JOIN public.get_current_catalog_appids() c ON c.appid = a.appid
      WHERE a.parent_appid IS NOT NULL
    ),
    NOW()
  ON CONFLICT (id) DO UPDATE SET
    apps_count = EXCLUDED.apps_count,
    publishers_count = EXCLUDED.publishers_count,
    developers_count = EXCLUDED.developers_count,
    pics_synced = EXCLUDED.pics_synced,
    categories_count = EXCLUDED.categories_count,
    genres_count = EXCLUDED.genres_count,
    tags_count = EXCLUDED.tags_count,
    franchises_count = EXCLUDED.franchises_count,
    parent_app_count = EXCLUDED.parent_app_count,
    updated_at = NOW();
$$;


--
-- Name: refresh_entity_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_entity_metrics() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Use CONCURRENTLY to avoid locking reads during refresh
  REFRESH MATERIALIZED VIEW CONCURRENTLY developer_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY publisher_metrics;
END;
$$;


--
-- Name: FUNCTION refresh_entity_metrics(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_entity_metrics() IS 'Refreshes both developer_metrics and publisher_metrics materialized views concurrently';


--
-- Name: refresh_filter_count_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_filter_count_views() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_tag_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_genre_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_category_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_steam_deck_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ccu_tier_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_velocity_tier_counts;
END;
$$;


--
-- Name: FUNCTION refresh_filter_count_views(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_filter_count_views() IS 'Refreshes all Games page filter count MVs. Called by pg_cron every 4h and GitHub Actions daily.';


--
-- Name: refresh_latest_daily_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_latest_daily_metrics() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY latest_daily_metrics;
END;
$$;


--
-- Name: refresh_materialized_view(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_materialized_view(view_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  view_exists BOOLEAN;
  old_timeout TEXT;
BEGIN
  -- Save current timeout and set to 5 minutes for refresh operations
  SELECT current_setting('statement_timeout') INTO old_timeout;
  SET LOCAL statement_timeout = '300000'; -- 5 minutes

  -- Check if the view exists
  SELECT EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = view_name
  ) INTO view_exists;

  IF NOT view_exists THEN
    RAISE EXCEPTION 'Materialized view % does not exist', view_name;
  END IF;

  -- Refresh the view concurrently (requires unique index)
  -- Falls back to non-concurrent refresh if concurrent fails
  BEGIN
    EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY ' || quote_ident(view_name);
  EXCEPTION WHEN OTHERS THEN
    -- If concurrent refresh fails (e.g., no unique index), try regular refresh
    EXECUTE 'REFRESH MATERIALIZED VIEW ' || quote_ident(view_name);
  END;

  -- Restore original timeout
  EXECUTE 'SET LOCAL statement_timeout = ' || quote_literal(old_timeout);
END;
$$;


--
-- Name: FUNCTION refresh_materialized_view(view_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_materialized_view(view_name text) IS 'Refreshes a materialized view with 5 minute timeout, preferring concurrent refresh when possible';


--
-- Name: refresh_monthly_game_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_monthly_game_metrics() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_game_metrics;
END;
$$;


--
-- Name: refresh_review_velocity_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_review_velocity_stats() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY review_velocity_stats;
END;
$$;


--
-- Name: FUNCTION refresh_review_velocity_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_review_velocity_stats() IS 'Refresh velocity stats view (concurrent, non-blocking)';


--
-- Name: refresh_steam_news_latest_projection_for_app(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_steam_news_latest_projection_for_app(p_appid integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN public.refresh_steam_news_search_projection_for_app(p_appid);
END;
$$;


--
-- Name: FUNCTION refresh_steam_news_latest_projection_for_app(p_appid integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_steam_news_latest_projection_for_app(p_appid integer) IS 'Compatibility wrapper that now refreshes the lean steam_news_search_projection for a single app.';


--
-- Name: refresh_steam_news_search_projection_for_app(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_steam_news_search_projection_for_app(p_appid integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  app_gids TEXT[];
  refreshed_count INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(n.gid ORDER BY n.gid), ARRAY[]::TEXT[])
  INTO app_gids
  FROM public.steam_news_items n
  WHERE n.appid = p_appid;

  IF CARDINALITY(app_gids) = 0 THEN
    DELETE FROM public.steam_news_search_projection
    WHERE appid = p_appid;
    RETURN 0;
  END IF;

  refreshed_count := public.upsert_steam_news_search_projection_for_gids(app_gids);

  DELETE FROM public.steam_news_search_projection projection
  WHERE projection.appid = p_appid
    AND NOT (projection.gid = ANY (app_gids));

  RETURN refreshed_count;
END;
$$;


--
-- Name: FUNCTION refresh_steam_news_search_projection_for_app(p_appid integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_steam_news_search_projection_for_app(p_appid integer) IS 'Rare full refresh path for one app''s lean news topic-search projection rows.';


--
-- Name: refund_reservation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refund_reservation(p_reservation_id uuid) RETURNS TABLE(success boolean, refunded integer, new_balance integer)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_caller_id UUID;
    v_reservation RECORD;
    v_new_balance INTEGER;
BEGIN
    v_caller_id := auth.uid();

    -- Get and lock the reservation
    SELECT r.*, u.credit_balance
    INTO v_reservation
    FROM credit_reservations r
    JOIN user_profiles u ON u.id = r.user_id
    WHERE r.id = p_reservation_id AND r.status = 'pending'
    FOR UPDATE OF r, u;

    IF v_reservation IS NULL THEN
        RETURN QUERY SELECT FALSE, 0::INTEGER, 0::INTEGER;
        RETURN;
    END IF;

    -- SECURITY FIX: Verify the reservation belongs to the caller
    IF v_caller_id IS NULL OR v_caller_id != v_reservation.user_id THEN
        RETURN QUERY SELECT FALSE, 0::INTEGER, 0::INTEGER;
        RETURN;
    END IF;

    -- Refund full amount
    UPDATE user_profiles
    SET credit_balance = credit_balance + v_reservation.reserved_amount,
        updated_at = NOW()
    WHERE id = v_reservation.user_id
    RETURNING credit_balance INTO v_new_balance;

    -- Mark reservation as refunded
    UPDATE credit_reservations
    SET status = 'refunded',
        actual_amount = 0,
        finalized_at = NOW()
    WHERE id = p_reservation_id;

    -- Create refund transaction record
    INSERT INTO credit_transactions (
        user_id, amount, balance_after, transaction_type, description, reservation_id
    )
    VALUES (
        v_reservation.user_id,
        v_reservation.reserved_amount,
        v_new_balance,
        'refund',
        'Server error refund',
        p_reservation_id
    );

    RETURN QUERY SELECT TRUE, v_reservation.reserved_amount, v_new_balance;
END;
$$;


--
-- Name: replace_app_categories(integer, integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_app_categories(p_appid integer, p_category_ids integer[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  WITH desired AS (
    SELECT DISTINCT category_id
    FROM unnest(COALESCE(p_category_ids, ARRAY[]::INTEGER[])) AS category_id
    WHERE category_id IS NOT NULL
  )
  INSERT INTO app_categories (appid, category_id)
  SELECT p_appid, desired.category_id
  FROM desired
  ON CONFLICT (appid, category_id) DO NOTHING;

  DELETE FROM app_categories existing
  WHERE existing.appid = p_appid
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_category_ids, ARRAY[]::INTEGER[])) AS desired_category_id(category_id)
      WHERE desired_category_id.category_id IS NOT NULL
        AND desired_category_id.category_id = existing.category_id
    );
END;
$$;


--
-- Name: replace_app_genres(integer, integer[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_app_genres(p_appid integer, p_genre_ids integer[], p_primary_genre_id integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  WITH desired AS (
    SELECT
      genre_id,
      COALESCE(genre_id = p_primary_genre_id, FALSE) AS is_primary
    FROM (
      SELECT DISTINCT genre_id
      FROM unnest(COALESCE(p_genre_ids, ARRAY[]::INTEGER[])) AS genre_id
      WHERE genre_id IS NOT NULL
    ) deduped
  )
  INSERT INTO app_genres (appid, genre_id, is_primary)
  SELECT p_appid, desired.genre_id, desired.is_primary
  FROM desired
  ON CONFLICT (appid, genre_id) DO UPDATE
  SET is_primary = EXCLUDED.is_primary
  WHERE app_genres.is_primary IS DISTINCT FROM EXCLUDED.is_primary;

  DELETE FROM app_genres existing
  WHERE existing.appid = p_appid
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_genre_ids, ARRAY[]::INTEGER[])) AS desired_genre_id(genre_id)
      WHERE desired_genre_id.genre_id IS NOT NULL
        AND desired_genre_id.genre_id = existing.genre_id
    );
END;
$$;


--
-- Name: replace_app_steam_tags(integer, integer[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_app_steam_tags(p_appid integer, p_tag_ids integer[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  WITH desired AS (
    SELECT DISTINCT ON (tag_id)
      tag_id,
      ordinality - 1 AS rank
    FROM unnest(COALESCE(p_tag_ids, ARRAY[]::INTEGER[])) WITH ORDINALITY AS desired_tag(tag_id, ordinality)
    WHERE tag_id IS NOT NULL
    ORDER BY tag_id, ordinality
  )
  INSERT INTO app_steam_tags (appid, tag_id, rank)
  SELECT p_appid, desired.tag_id, desired.rank
  FROM desired
  ON CONFLICT (appid, tag_id) DO UPDATE
  SET rank = EXCLUDED.rank
  WHERE app_steam_tags.rank IS DISTINCT FROM EXCLUDED.rank;

  DELETE FROM app_steam_tags existing
  WHERE existing.appid = p_appid
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p_tag_ids, ARRAY[]::INTEGER[])) AS desired_tag_id(tag_id)
      WHERE desired_tag_id.tag_id IS NOT NULL
        AND desired_tag_id.tag_id = existing.tag_id
    );
END;
$$;


--
-- Name: requeue_stale_app_capture_work(public.app_capture_source[], timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.requeue_stale_app_capture_work(p_sources public.app_capture_source[], p_claimed_before timestamp with time zone, p_limit integer DEFAULT 500) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  WITH stale AS (
    SELECT w.id
    FROM app_capture_work_state w
    WHERE w.source = ANY (p_sources)
      AND w.claimed_at IS NOT NULL
      AND w.dead_lettered_at IS NULL
      AND w.claimed_at < p_claimed_before
    ORDER BY w.claimed_at ASC, w.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(COALESCE(p_limit, 500), 500)
  )
  UPDATE app_capture_work_state w
  SET claimed_at = NULL,
      worker_id = NULL,
      next_available_at = NOW(),
      last_error = 'stale_claim_requeued',
      updated_at = NOW()
  FROM stale s
  WHERE w.id = s.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN COALESCE(v_updated, 0);
END;
$$;


--
-- Name: reserve_credits(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_credits(p_user_id uuid, p_amount integer) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_current_balance INTEGER;
    v_reservation_id UUID;
    v_caller_id UUID;
BEGIN
    -- SECURITY FIX: Validate the caller is the user they claim to be
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL OR v_caller_id != p_user_id THEN
        RETURN NULL;  -- Unauthorized
    END IF;

    -- Lock the user row and get current balance
    SELECT credit_balance INTO v_current_balance
    FROM user_profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF v_current_balance IS NULL THEN
        RETURN NULL;  -- User not found
    END IF;

    IF v_current_balance < p_amount THEN
        RETURN NULL;  -- Insufficient credits
    END IF;

    -- Deduct from balance
    UPDATE user_profiles
    SET credit_balance = credit_balance - p_amount,
        updated_at = NOW()
    WHERE id = p_user_id;

    -- Create reservation record
    INSERT INTO credit_reservations (user_id, reserved_amount, status)
    VALUES (p_user_id, p_amount, 'pending')
    RETURNING id INTO v_reservation_id;

    RETURN v_reservation_id;
END;
$$;


--
-- Name: search_developers_fuzzy(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_developers_fuzzy(p_query text, p_limit integer DEFAULT 5) RETURNS TABLE(id integer, name text, game_count integer, similarity_score real, is_exact_match boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_query TEXT;
  v_query_nospace TEXT;
BEGIN
  v_query := LOWER(TRIM(p_query));
  v_query_nospace := REPLACE(v_query, ' ', '');

  PERFORM set_config('pg_trgm.similarity_threshold', '0.3', true);

  RETURN QUERY
  SELECT
    d.id,
    d.name,
    d.game_count,
    GREATEST(
      similarity(LOWER(d.name), v_query),
      similarity(LOWER(REPLACE(d.name, ' ', '')), v_query_nospace)
    ) AS similarity_score,
    LOWER(d.name) ILIKE '%' || v_query || '%' AS is_exact_match
  FROM developers d
  WHERE
    d.game_count > 0
    AND (LOWER(d.name) % v_query OR LOWER(d.name) ILIKE '%' || v_query || '%')
  ORDER BY
    is_exact_match DESC,
    similarity_score DESC,
    d.game_count DESC
  LIMIT p_limit;
END;
$$;


--
-- Name: search_games_fuzzy(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_games_fuzzy(p_query text, p_limit integer DEFAULT 5) RETURNS TABLE(appid integer, name text, release_date date, is_free boolean, positive_percentage numeric, total_reviews integer, similarity_score real, is_exact_match boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_query TEXT;
  v_query_nospace TEXT;
BEGIN
  v_query := LOWER(TRIM(p_query));
  v_query_nospace := REPLACE(v_query, ' ', '');

  PERFORM set_config('pg_trgm.similarity_threshold', '0.3', true);

  RETURN QUERY
  SELECT
    a.appid,
    a.name,
    a.release_date,
    a.is_free,
    m.positive_percentage,
    m.total_reviews::INTEGER,
    GREATEST(
      similarity(LOWER(a.name), v_query),
      similarity(LOWER(REPLACE(a.name, ' ', '')), v_query_nospace)
    ) AS similarity_score,
    LOWER(a.name) ILIKE '%' || v_query || '%' AS is_exact_match
  FROM apps a
  LEFT JOIN latest_daily_metrics m ON m.appid = a.appid
  LEFT JOIN sync_status ss ON ss.appid = a.appid
  WHERE
    a.type = 'game'
    AND a.is_delisted = FALSE
    AND (ss.storefront_accessible IS NULL OR ss.storefront_accessible = TRUE)
    AND (COALESCE(m.total_reviews, 0) >= 10 OR LOWER(a.name) ILIKE '%' || v_query || '%')
    AND (LOWER(a.name) % v_query OR LOWER(a.name) ILIKE '%' || v_query || '%')
  ORDER BY
    is_exact_match DESC,
    similarity_score DESC,
    COALESCE(m.total_reviews, 0) DESC
  LIMIT p_limit;
END;
$$;


--
-- Name: search_publishers_fuzzy(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_publishers_fuzzy(p_query text, p_limit integer DEFAULT 5) RETURNS TABLE(id integer, name text, game_count integer, similarity_score real, is_exact_match boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_query TEXT;
  v_query_nospace TEXT;
BEGIN
  v_query := LOWER(TRIM(p_query));
  v_query_nospace := REPLACE(v_query, ' ', '');

  PERFORM set_config('pg_trgm.similarity_threshold', '0.3', true);

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.game_count,
    GREATEST(
      similarity(LOWER(p.name), v_query),
      similarity(LOWER(REPLACE(p.name, ' ', '')), v_query_nospace)
    ) AS similarity_score,
    LOWER(p.name) ILIKE '%' || v_query || '%' AS is_exact_match
  FROM publishers p
  WHERE
    p.game_count > 0
    AND (LOWER(p.name) % v_query OR LOWER(p.name) ILIKE '%' || v_query || '%')
  ORDER BY
    is_exact_match DESC,
    similarity_score DESC,
    p.game_count DESC
  LIMIT p_limit;
END;
$$;


--
-- Name: search_recent_news_topics(text, integer, integer, text, text[], integer[], text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_recent_news_topics(p_query text, p_days integer DEFAULT 30, p_limit integer DEFAULT 10, p_feed_scope text DEFAULT 'community_announcements'::text, p_app_types text[] DEFAULT ARRAY['game'::text], p_appids integer[] DEFAULT NULL::integer[], p_aliases text[] DEFAULT NULL::text[]) RETURNS TABLE(gid text, appid integer, app_name text, app_type text, published_at timestamp with time zone, first_seen_at timestamp with time zone, sort_time timestamp with time zone, feed_scope text, feedlabel text, feedname text, title text, url text, excerpt text, content_preview text, match_reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  normalized_aliases TEXT[];
  query_text TEXT;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_query, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A recent news topic query is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.steam_news_search_projection
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'news topic projection is not available yet. Backfill the search projection first.';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT LOWER(BTRIM(term))
    FROM unnest(COALESCE(p_aliases, ARRAY[]::TEXT[]) || ARRAY[p_query]) AS term
    WHERE NULLIF(BTRIM(term), '') IS NOT NULL
    ORDER BY 1
  )
  INTO normalized_aliases;

  SELECT string_agg(format('"%s"', replace(alias, '"', '')), ' OR ')
  INTO query_text
  FROM unnest(normalized_aliases) AS alias;

  RETURN QUERY
  WITH request_config AS (
    SELECT
      GREATEST(COALESCE(p_days, 30), 1) AS days,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1), 10) AS row_limit,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1) * 10, 100) AS shortlist_limit,
      CASE
        WHEN COALESCE(p_feed_scope, 'community_announcements') IN ('community_announcements', 'external_coverage', 'all')
          THEN COALESCE(p_feed_scope, 'community_announcements')
        ELSE 'community_announcements'
      END AS feed_scope,
      CASE
        WHEN p_app_types IS NULL OR CARDINALITY(p_app_types) = 0 THEN ARRAY['game']::TEXT[]
        ELSE p_app_types
      END AS app_types,
      normalized_aliases AS aliases,
      websearch_to_tsquery('english', COALESCE(query_text, format('"%s"', replace(BTRIM(p_query), '"', '')))) AS topic_query
  ),
  shortlisted_matches AS (
    SELECT
      projection.gid,
      projection.appid,
      current_app.type::TEXT AS app_type,
      projection.published_at,
      projection.first_seen_at,
      projection.sort_time,
      projection.feed_scope,
      projection.title,
      rc.aliases,
      rc.topic_query,
      ts_rank_cd(projection.search_document, rc.topic_query) AS ts_rank,
      EXISTS (
        SELECT 1
        FROM unnest(rc.aliases) AS alias
        WHERE LOWER(COALESCE(projection.title, '')) LIKE '%' || alias || '%'
      ) AS title_phrase_hit
    FROM public.steam_news_search_projection projection
    JOIN public.apps current_app ON current_app.appid = projection.appid
    CROSS JOIN request_config rc
    WHERE projection.sort_time >= NOW() - make_interval(days => rc.days)
      AND (
        rc.feed_scope = 'all'
        OR projection.feed_scope = rc.feed_scope
      )
      AND (
        rc.app_types IS NULL
        OR current_app.type::TEXT = ANY (rc.app_types)
      )
      AND (
        p_appids IS NULL
        OR projection.appid = ANY (p_appids)
      )
      AND projection.search_document @@ rc.topic_query
    ORDER BY
      title_phrase_hit DESC,
      ts_rank DESC,
      projection.sort_time DESC,
      projection.gid DESC
    LIMIT (SELECT shortlist_limit FROM request_config)
  ),
  enriched_matches AS (
    SELECT
      shortlist.gid,
      shortlist.appid,
      shortlist.app_type,
      shortlist.published_at,
      shortlist.first_seen_at,
      shortlist.sort_time,
      shortlist.feed_scope,
      shortlist.title,
      shortlist.aliases,
      shortlist.topic_query,
      shortlist.ts_rank,
      shortlist.title_phrase_hit,
      a.name AS app_name,
      n.feedlabel,
      n.feedname,
      COALESCE(lv.url, n.url) AS url,
      public.normalize_steam_news_search_text(lv.contents) AS body_text
    FROM shortlisted_matches shortlist
    JOIN public.apps a ON a.appid = shortlist.appid
    JOIN public.steam_news_items n ON n.gid = shortlist.gid
    LEFT JOIN LATERAL (
      SELECT
        v.contents,
        v.url
      FROM public.steam_news_versions v
      WHERE v.gid = shortlist.gid
      ORDER BY v.first_seen_at DESC, v.id DESC
      LIMIT 1
    ) lv ON TRUE
  ),
  ranked_matches AS (
    SELECT
      enriched.*,
      CONCAT_WS(' ', public.normalize_steam_news_search_text(enriched.title), enriched.body_text) AS excerpt_source,
      EXISTS (
        SELECT 1
        FROM unnest(enriched.aliases) AS alias
        WHERE LOWER(COALESCE(enriched.body_text, '')) LIKE '%' || alias || '%'
      ) AS body_phrase_hit
    FROM enriched_matches enriched
  )
  SELECT
    rm.gid,
    rm.appid,
    rm.app_name,
    rm.app_type,
    rm.published_at,
    rm.first_seen_at,
    rm.sort_time,
    rm.feed_scope,
    rm.feedlabel,
    rm.feedname,
    rm.title,
    rm.url,
    COALESCE(
      NULLIF(
        BTRIM(
          ts_headline(
            'english',
            COALESCE(rm.excerpt_source, ''),
            rm.topic_query,
            'StartSel=, StopSel=, MaxWords=24, MinWords=10, MaxFragments=2, FragmentDelimiter= … '
          )
        ),
        ''
      ),
      NULLIF(BTRIM(LEFT(COALESCE(rm.excerpt_source, ''), 260)), '')
    ) AS excerpt,
    NULLIF(BTRIM(LEFT(COALESCE(rm.excerpt_source, ''), 420)), '') AS content_preview,
    CASE
      WHEN rm.title_phrase_hit THEN 'matched title phrase'
      WHEN rm.body_phrase_hit THEN 'matched body phrase'
      ELSE 'matched topic terms'
    END AS match_reason
  FROM ranked_matches rm
  ORDER BY
    rm.title_phrase_hit DESC,
    rm.body_phrase_hit DESC,
    rm.ts_rank DESC,
    rm.sort_time DESC,
    rm.gid DESC
  LIMIT (SELECT row_limit FROM request_config);
END;
$$;


--
-- Name: FUNCTION search_recent_news_topics(p_query text, p_days integer, p_limit integer, p_feed_scope text, p_app_types text[], p_appids integer[], p_aliases text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_recent_news_topics(p_query text, p_days integer, p_limit integer, p_feed_scope text, p_app_types text[], p_appids integer[], p_aliases text[]) IS 'Searches recent stored Steam news text across many games for chat topic prompts using a lean gid-level search projection and body joins only for shortlisted rows.';


--
-- Name: update_alert_detection_state(public.entity_type, integer, integer, integer, integer, integer, numeric, numeric, integer, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_alert_detection_state(p_entity_type public.entity_type, p_entity_id integer, p_ccu_7d_avg integer DEFAULT NULL::integer, p_ccu_7d_max integer DEFAULT NULL::integer, p_ccu_7d_min integer DEFAULT NULL::integer, p_ccu_prev_value integer DEFAULT NULL::integer, p_review_velocity_7d_avg numeric DEFAULT NULL::numeric, p_positive_ratio_prev numeric DEFAULT NULL::numeric, p_total_reviews_prev integer DEFAULT NULL::integer, p_price_cents_prev integer DEFAULT NULL::integer, p_discount_percent_prev integer DEFAULT NULL::integer, p_trend_30d_direction_prev text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    INSERT INTO alert_detection_state (
        entity_type,
        entity_id,
        ccu_7d_avg,
        ccu_7d_max,
        ccu_7d_min,
        ccu_prev_value,
        review_velocity_7d_avg,
        positive_ratio_prev,
        total_reviews_prev,
        price_cents_prev,
        discount_percent_prev,
        trend_30d_direction_prev,
        updated_at
    ) VALUES (
        p_entity_type,
        p_entity_id,
        p_ccu_7d_avg,
        p_ccu_7d_max,
        p_ccu_7d_min,
        p_ccu_prev_value,
        p_review_velocity_7d_avg,
        p_positive_ratio_prev,
        p_total_reviews_prev,
        p_price_cents_prev,
        p_discount_percent_prev,
        p_trend_30d_direction_prev,
        NOW()
    )
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
        ccu_7d_avg = COALESCE(p_ccu_7d_avg, alert_detection_state.ccu_7d_avg),
        ccu_7d_max = COALESCE(p_ccu_7d_max, alert_detection_state.ccu_7d_max),
        ccu_7d_min = COALESCE(p_ccu_7d_min, alert_detection_state.ccu_7d_min),
        ccu_prev_value = COALESCE(p_ccu_prev_value, alert_detection_state.ccu_prev_value),
        review_velocity_7d_avg = COALESCE(p_review_velocity_7d_avg, alert_detection_state.review_velocity_7d_avg),
        positive_ratio_prev = COALESCE(p_positive_ratio_prev, alert_detection_state.positive_ratio_prev),
        total_reviews_prev = COALESCE(p_total_reviews_prev, alert_detection_state.total_reviews_prev),
        price_cents_prev = COALESCE(p_price_cents_prev, alert_detection_state.price_cents_prev),
        discount_percent_prev = COALESCE(p_discount_percent_prev, alert_detection_state.discount_percent_prev),
        trend_30d_direction_prev = COALESCE(p_trend_30d_direction_prev, alert_detection_state.trend_30d_direction_prev),
        updated_at = NOW();
END;
$$;


--
-- Name: FUNCTION update_alert_detection_state(p_entity_type public.entity_type, p_entity_id integer, p_ccu_7d_avg integer, p_ccu_7d_max integer, p_ccu_7d_min integer, p_ccu_prev_value integer, p_review_velocity_7d_avg numeric, p_positive_ratio_prev numeric, p_total_reviews_prev integer, p_price_cents_prev integer, p_discount_percent_prev integer, p_trend_30d_direction_prev text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_alert_detection_state(p_entity_type public.entity_type, p_entity_id integer, p_ccu_7d_avg integer, p_ccu_7d_max integer, p_ccu_7d_min integer, p_ccu_prev_value integer, p_review_velocity_7d_avg numeric, p_positive_ratio_prev numeric, p_total_reviews_prev integer, p_price_cents_prev integer, p_discount_percent_prev integer, p_trend_30d_direction_prev text) IS 'Updates baseline metrics for an entity. Used by alert detection worker.';


--
-- Name: update_alert_preferences_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_alert_preferences_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_developer_game_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_developer_game_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE developers
        SET game_count = game_count + 1
        WHERE id = NEW.developer_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE developers
        SET game_count = game_count - 1
        WHERE id = OLD.developer_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: update_publisher_game_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_publisher_game_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE publishers
        SET game_count = game_count + 1
        WHERE id = NEW.publisher_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE publishers
        SET game_count = game_count - 1
        WHERE id = OLD.publisher_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: update_review_velocity_tiers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_review_velocity_tiers() RETURNS TABLE(count integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_from_deltas INTEGER := 0;
    v_from_trends INTEGER := 0;
    v_from_no_signal INTEGER := 0;
BEGIN
    UPDATE sync_status s
    SET
        velocity_7d = rvs.velocity_7d,
        review_velocity_tier = rvs.velocity_tier,
        reviews_interval_hours = CASE rvs.velocity_tier
            WHEN 'high' THEN 4
            WHEN 'medium' THEN 12
            WHEN 'low' THEN 24
            ELSE 72
        END,
        velocity_calculated_at = NOW()
    FROM review_velocity_stats rvs
    WHERE s.appid = rvs.appid
      AND (
        s.velocity_7d IS DISTINCT FROM rvs.velocity_7d
        OR s.review_velocity_tier IS DISTINCT FROM rvs.velocity_tier
        OR s.reviews_interval_hours IS DISTINCT FROM CASE rvs.velocity_tier
            WHEN 'high' THEN 4
            WHEN 'medium' THEN 12
            WHEN 'low' THEN 24
            ELSE 72
        END
      );

    GET DIAGNOSTICS v_from_deltas = ROW_COUNT;

    UPDATE sync_status s
    SET
        velocity_7d = LEAST(GREATEST(COALESCE(at.review_velocity_7d, 0), 0), 9999.9999),
        review_velocity_tier = CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 'high'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 'medium'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 'low'
            ELSE 'dormant'
        END,
        reviews_interval_hours = CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 4
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 12
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 24
            ELSE 72
        END,
        velocity_calculated_at = NOW()
    FROM app_trends at
    WHERE s.appid = at.appid
      AND s.last_reviews_sync IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM review_velocity_stats rvs
          WHERE rvs.appid = s.appid
      )
      AND (
        s.velocity_7d IS DISTINCT FROM LEAST(GREATEST(COALESCE(at.review_velocity_7d, 0), 0), 9999.9999)
        OR s.review_velocity_tier IS DISTINCT FROM CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 'high'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 'medium'
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 'low'
            ELSE 'dormant'
        END
        OR s.reviews_interval_hours IS DISTINCT FROM CASE
            WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 4
            WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 12
            WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 24
            ELSE 72
        END
      );

    GET DIAGNOSTICS v_from_trends = ROW_COUNT;

    UPDATE sync_status s
    SET
        velocity_7d = 0,
        review_velocity_tier = 'dormant',
        reviews_interval_hours = 72,
        velocity_calculated_at = NOW()
    WHERE s.last_reviews_sync IS NOT NULL
      AND NOT EXISTS (
          SELECT 1
          FROM review_velocity_stats rvs
          WHERE rvs.appid = s.appid
      )
      AND NOT EXISTS (
          SELECT 1
          FROM app_trends at
          WHERE at.appid = s.appid
      )
      AND (
        s.velocity_7d IS DISTINCT FROM 0
        OR s.review_velocity_tier IS DISTINCT FROM 'dormant'
        OR s.reviews_interval_hours IS DISTINCT FROM 72
      );

    GET DIAGNOSTICS v_from_no_signal = ROW_COUNT;

    RETURN QUERY SELECT v_from_deltas + v_from_trends + v_from_no_signal;
END;
$$;


--
-- Name: FUNCTION update_review_velocity_tiers(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_review_velocity_tiers() IS 'Sync review velocity tiers to sync_status, clamping fallback app_trends velocities to fit numeric(8,4).';


--
-- Name: update_review_velocity_tiers_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_review_velocity_tiers_batch(p_limit integer DEFAULT 1000) RETURNS TABLE(updated_count integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_apply_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 1000), 5000));
    v_candidate_limit INTEGER := LEAST(v_apply_limit * 5, 25000);
BEGIN
    RETURN QUERY
    WITH desired_values AS (
        SELECT
            s.appid,
            s.velocity_7d AS current_velocity_7d,
            s.review_velocity_tier AS current_review_velocity_tier,
            s.reviews_interval_hours AS current_reviews_interval_hours,
            CASE
                WHEN rvs.appid IS NOT NULL THEN rvs.velocity_7d
                WHEN at.appid IS NOT NULL THEN LEAST(GREATEST(COALESCE(at.review_velocity_7d, 0), 0), 9999.9999)
                ELSE 0
            END::NUMERIC(8,4) AS desired_velocity_7d,
            CASE
                WHEN rvs.appid IS NOT NULL THEN rvs.velocity_tier
                WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 'high'
                WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 'medium'
                WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 'low'
                ELSE 'dormant'
            END::TEXT AS desired_review_velocity_tier,
            CASE
                WHEN rvs.appid IS NOT NULL AND rvs.velocity_tier = 'high' THEN 4
                WHEN rvs.appid IS NOT NULL AND rvs.velocity_tier = 'medium' THEN 12
                WHEN rvs.appid IS NOT NULL AND rvs.velocity_tier = 'low' THEN 24
                WHEN rvs.appid IS NOT NULL THEN 72
                WHEN COALESCE(at.review_velocity_7d, 0) >= 5 THEN 4
                WHEN COALESCE(at.review_velocity_7d, 0) >= 1 THEN 12
                WHEN COALESCE(at.review_velocity_7d, 0) >= 0.1 THEN 24
                ELSE 72
            END::INTEGER AS desired_reviews_interval_hours
        FROM sync_status s
        LEFT JOIN review_velocity_stats rvs ON rvs.appid = s.appid
        LEFT JOIN app_trends at ON at.appid = s.appid
        WHERE s.last_reviews_sync IS NOT NULL
    ),
    diff_candidates AS (
        SELECT
            dv.appid,
            dv.desired_velocity_7d,
            dv.desired_review_velocity_tier,
            dv.desired_reviews_interval_hours
        FROM desired_values dv
        WHERE dv.current_velocity_7d IS DISTINCT FROM dv.desired_velocity_7d
           OR dv.current_review_velocity_tier IS DISTINCT FROM dv.desired_review_velocity_tier
           OR dv.current_reviews_interval_hours IS DISTINCT FROM dv.desired_reviews_interval_hours
        ORDER BY dv.appid ASC
        LIMIT v_candidate_limit
    ),
    locked_candidates AS (
        SELECT s.appid
        FROM sync_status s
        JOIN diff_candidates dc ON dc.appid = s.appid
        ORDER BY s.appid ASC
        LIMIT v_apply_limit
        FOR UPDATE OF s SKIP LOCKED
    ),
    updated AS (
        UPDATE sync_status s
        SET
            velocity_7d = dc.desired_velocity_7d,
            review_velocity_tier = dc.desired_review_velocity_tier,
            reviews_interval_hours = dc.desired_reviews_interval_hours,
            velocity_calculated_at = NOW()
        FROM diff_candidates dc
        JOIN locked_candidates lc ON lc.appid = dc.appid
        WHERE s.appid = dc.appid
        RETURNING s.appid
    )
    SELECT COUNT(*)::INTEGER AS updated_count
    FROM updated;
END;
$$;


--
-- Name: FUNCTION update_review_velocity_tiers_batch(p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_review_velocity_tiers_batch(p_limit integer) IS 'Apply derived review velocity fields to sync_status in ordered SKIP LOCKED batches.';


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_user_profile(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_profile(p_full_name text DEFAULT NULL::text, p_organization text DEFAULT NULL::text) RETURNS TABLE(success boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Get the authenticated user's ID
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Not authenticated'::TEXT;
        RETURN;
    END IF;

    -- Update only the allowed columns
    UPDATE user_profiles
    SET
        full_name = COALESCE(p_full_name, full_name),
        organization = COALESCE(p_organization, organization),
        updated_at = NOW()
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Profile not found'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, 'Profile updated'::TEXT;
END;
$$;


--
-- Name: update_user_profile_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_profile_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: upsert_developer(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_developer(p_name text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id INTEGER;
    v_normalized TEXT;
BEGIN
    v_normalized := LOWER(TRIM(p_name));

    INSERT INTO developers (name, normalized_name)
    VALUES (TRIM(p_name), v_normalized)
    ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;


--
-- Name: upsert_franchise(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_franchise(p_name text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id INTEGER;
    v_normalized TEXT;
BEGIN
    v_normalized := LOWER(TRIM(p_name));

    INSERT INTO franchises (name, normalized_name)
    VALUES (TRIM(p_name), v_normalized)
    ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;


--
-- Name: upsert_publisher(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_publisher(p_name text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_id INTEGER;
    v_normalized TEXT;
BEGIN
    v_normalized := LOWER(TRIM(p_name));

    INSERT INTO publishers (name, normalized_name)
    VALUES (TRIM(p_name), v_normalized)
    ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;


--
-- Name: upsert_steam_news_search_projection_for_gids(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_steam_news_search_projection_for_gids(p_gids text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  normalized_gids TEXT[];
  upserted_count INTEGER := 0;
BEGIN
  SELECT COALESCE(array_agg(gid ORDER BY gid), ARRAY[]::TEXT[])
  INTO normalized_gids
  FROM (
    SELECT DISTINCT NULLIF(BTRIM(gid), '') AS gid
    FROM unnest(COALESCE(p_gids, ARRAY[]::TEXT[])) AS gid
    WHERE NULLIF(BTRIM(gid), '') IS NOT NULL
  ) deduped;

  IF CARDINALITY(normalized_gids) = 0 THEN
    RETURN 0;
  END IF;

  WITH latest_news AS (
    SELECT
      n.gid,
      n.appid,
      n.published_at,
      n.first_seen_at,
      COALESCE(n.published_at, n.first_seen_at) AS sort_time,
      CASE
        WHEN COALESCE(n.feedlabel, '') = 'Community Announcements' THEN 'community_announcements'
        ELSE 'external_coverage'
      END AS feed_scope,
      NULLIF(BTRIM(lv.title), '') AS title,
      setweight(to_tsvector('english', COALESCE(public.normalize_steam_news_search_text(lv.title), '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(public.normalize_steam_news_search_text(lv.contents), '')), 'B') AS search_document
    FROM unnest(normalized_gids) AS requested_gid
    JOIN public.steam_news_items n ON n.gid = requested_gid
    LEFT JOIN LATERAL (
      SELECT
        v.title,
        v.contents
      FROM public.steam_news_versions v
      WHERE v.gid = n.gid
      ORDER BY v.first_seen_at DESC, v.id DESC
      LIMIT 1
    ) lv ON TRUE
  )
  INSERT INTO public.steam_news_search_projection (
    gid,
    appid,
    published_at,
    first_seen_at,
    sort_time,
    feed_scope,
    title,
    search_document
  )
  SELECT
    gid,
    appid,
    published_at,
    first_seen_at,
    sort_time,
    feed_scope,
    title,
    search_document
  FROM latest_news
  ON CONFLICT (gid) DO UPDATE
  SET
    appid = EXCLUDED.appid,
    published_at = EXCLUDED.published_at,
    first_seen_at = EXCLUDED.first_seen_at,
    sort_time = EXCLUDED.sort_time,
    feed_scope = EXCLUDED.feed_scope,
    title = EXCLUDED.title,
    search_document = EXCLUDED.search_document;

  GET DIAGNOSTICS upserted_count = ROW_COUNT;

  DELETE FROM public.steam_news_search_projection projection
  WHERE projection.gid = ANY (normalized_gids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.steam_news_items n
      WHERE n.gid = projection.gid
    );

  RETURN upserted_count;
END;
$$;


--
-- Name: FUNCTION upsert_steam_news_search_projection_for_gids(p_gids text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.upsert_steam_news_search_projection_for_gids(p_gids text[]) IS 'Upserts lean news topic-search projection rows for the provided gids.';


--
-- Name: upsert_steam_tag(integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_steam_tag(p_tag_id integer, p_name text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO steam_tags (tag_id, name)
    VALUES (p_tag_id, p_name)
    ON CONFLICT (tag_id) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW();

    RETURN p_tag_id;
END;
$$;


--
-- Name: upsert_storefront_app(integer, text, text, boolean, boolean, date, text, boolean, integer, integer, boolean, text[], text[], integer[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_storefront_app(p_appid integer, p_name text, p_type text, p_is_free boolean, p_is_delisted boolean, p_release_date date, p_release_date_raw text, p_has_workshop boolean, p_current_price_cents integer, p_current_discount_percent integer, p_is_released boolean, p_developers text[], p_publishers text[], p_dlc_appids integer[] DEFAULT NULL::integer[], p_parent_appid integer DEFAULT NULL::integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_valid_parent BOOLEAN := FALSE;
  v_has_dev_or_pub BOOLEAN := FALSE;
  v_sanitized_price_cents INTEGER := CASE
    WHEN p_current_price_cents IS NULL THEN NULL
    WHEN p_current_price_cents < 0 THEN NULL
    WHEN p_current_price_cents > 50000 THEN NULL
    ELSE p_current_price_cents
  END;
BEGIN
  IF p_parent_appid IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM apps WHERE appid = p_parent_appid) INTO v_valid_parent;
  END IF;

  UPDATE apps SET
    name = p_name,
    type = p_type::app_type,
    is_free = p_is_free,
    is_delisted = p_is_delisted,
    release_date = p_release_date,
    release_date_raw = p_release_date_raw,
    has_workshop = p_has_workshop,
    current_price_cents = v_sanitized_price_cents,
    current_discount_percent = p_current_discount_percent,
    is_released = p_is_released,
    parent_appid = CASE
      WHEN v_valid_parent THEN p_parent_appid
      ELSE parent_appid
    END
  WHERE appid = p_appid;

  IF p_developers IS NOT NULL AND array_length(p_developers, 1) > 0 THEN
    WITH normalized_names AS (
      SELECT
        TRIM(dev_name) AS name,
        LOWER(TRIM(dev_name)) AS normalized_name
      FROM unnest(p_developers) AS dev_name
      WHERE dev_name IS NOT NULL AND TRIM(dev_name) != ''
    ),
    canonical_names AS (
      SELECT DISTINCT ON (normalized_name)
        name,
        normalized_name
      FROM normalized_names
      ORDER BY
        normalized_name,
        CASE WHEN name = initcap(normalized_name) THEN 0 ELSE 1 END,
        LENGTH(name),
        name
    ),
    dev_upserts AS (
      INSERT INTO developers (name, normalized_name)
      SELECT name, normalized_name
      FROM canonical_names
      ON CONFLICT (normalized_name) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id
    )
    INSERT INTO app_developers (appid, developer_id)
    SELECT p_appid, id
    FROM dev_upserts
    ON CONFLICT (appid, developer_id) DO NOTHING;

    SELECT EXISTS(
      SELECT 1
      FROM unnest(p_developers) AS dev_name
      WHERE dev_name IS NOT NULL AND TRIM(dev_name) != ''
    ) INTO v_has_dev_or_pub;
  END IF;

  IF p_publishers IS NOT NULL AND array_length(p_publishers, 1) > 0 THEN
    WITH normalized_names AS (
      SELECT
        TRIM(pub_name) AS name,
        LOWER(TRIM(pub_name)) AS normalized_name
      FROM unnest(p_publishers) AS pub_name
      WHERE pub_name IS NOT NULL AND TRIM(pub_name) != ''
    ),
    canonical_names AS (
      SELECT DISTINCT ON (normalized_name)
        name,
        normalized_name
      FROM normalized_names
      ORDER BY
        normalized_name,
        CASE WHEN name = initcap(normalized_name) THEN 0 ELSE 1 END,
        LENGTH(name),
        name
    ),
    pub_upserts AS (
      INSERT INTO publishers (name, normalized_name)
      SELECT name, normalized_name
      FROM canonical_names
      ON CONFLICT (normalized_name) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
      RETURNING id
    )
    INSERT INTO app_publishers (appid, publisher_id)
    SELECT p_appid, id
    FROM pub_upserts
    ON CONFLICT (appid, publisher_id) DO NOTHING;

    IF NOT v_has_dev_or_pub THEN
      SELECT EXISTS(
        SELECT 1
        FROM unnest(p_publishers) AS pub_name
        WHERE pub_name IS NOT NULL AND TRIM(pub_name) != ''
      ) INTO v_has_dev_or_pub;
    END IF;
  END IF;

  IF v_has_dev_or_pub THEN
    UPDATE apps SET has_developer_info = TRUE WHERE appid = p_appid;
  END IF;

  IF p_dlc_appids IS NOT NULL AND array_length(p_dlc_appids, 1) > 0 THEN
    INSERT INTO app_dlc (parent_appid, dlc_appid, source)
    SELECT DISTINCT p_appid, dlc_id, 'storefront'
    FROM unnest(p_dlc_appids) AS dlc_id
    ON CONFLICT (parent_appid, dlc_appid) DO UPDATE SET source = 'storefront';
  END IF;

  UPDATE sync_status SET
    storefront_accessible = TRUE,
    last_storefront_sync = NOW(),
    consecutive_errors = 0,
    last_error_source = NULL,
    last_error_message = NULL,
    last_error_at = NULL
  WHERE appid = p_appid;
END;
$$;


--
-- Name: FUNCTION upsert_storefront_app(p_appid integer, p_name text, p_type text, p_is_free boolean, p_is_delisted boolean, p_release_date date, p_release_date_raw text, p_has_workshop boolean, p_current_price_cents integer, p_current_discount_percent integer, p_is_released boolean, p_developers text[], p_publishers text[], p_dlc_appids integer[], p_parent_appid integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.upsert_storefront_app(p_appid integer, p_name text, p_type text, p_is_free boolean, p_is_delisted boolean, p_release_date date, p_release_date_raw text, p_has_workshop boolean, p_current_price_cents integer, p_current_discount_percent integer, p_is_released boolean, p_developers text[], p_publishers text[], p_dlc_appids integer[], p_parent_appid integer) IS 'Single-call storefront upsert with null-safe price handling and normalized developer/publisher dedupe.';


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS SETOF realtime.wal_rls
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
      with pub as (
        select
          concat_ws(
            ',',
            case when bool_or(pubinsert) then 'insert' else null end,
            case when bool_or(pubupdate) then 'update' else null end,
            case when bool_or(pubdelete) then 'delete' else null end
          ) as w2j_actions,
          coalesce(
            string_agg(
              realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
              ','
            ) filter (where ppt.tablename is not null and ppt.tablename not like '% %'),
            ''
          ) w2j_add_tables
        from
          pg_publication pp
          left join pg_publication_tables ppt
            on pp.pubname = ppt.pubname
        where
          pp.pubname = publication
        group by
          pp.pubname
        limit 1
      ),
      w2j as (
        select
          x.*, pub.w2j_add_tables
        from
          pub,
          pg_logical_slot_get_changes(
            slot_name, null, max_changes,
            'include-pk', 'true',
            'include-transaction', 'false',
            'include-timestamp', 'true',
            'include-type-oids', 'true',
            'format-version', '2',
            'actions', pub.w2j_actions,
            'add-tables', pub.w2j_add_tables
          ) x
      )
      select
        xyz.wal,
        xyz.is_rls_enabled,
        xyz.subscription_ids,
        xyz.errors
      from
        w2j,
        realtime.apply_rls(
          wal := w2j.data::jsonb,
          max_record_bytes := max_record_bytes
        ) xyz(wal, is_rls_enabled, subscription_ids, errors)
      where
        w2j.w2j_add_tables <> ''
        and xyz.subscription_ids[1] is not null
    $$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: delete_leaf_prefixes(text[], text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_rows_deleted integer;
BEGIN
    LOOP
        WITH candidates AS (
            SELECT DISTINCT
                t.bucket_id,
                unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        ),
        uniq AS (
             SELECT
                 bucket_id,
                 name,
                 storage.get_level(name) AS level
             FROM candidates
             WHERE name <> ''
             GROUP BY bucket_id, name
        ),
        leaf AS (
             SELECT
                 p.bucket_id,
                 p.name,
                 p.level
             FROM storage.prefixes AS p
                  JOIN uniq AS u
                       ON u.bucket_id = p.bucket_id
                           AND u.name = p.name
                           AND u.level = p.level
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM storage.objects AS o
                 WHERE o.bucket_id = p.bucket_id
                   AND o.level = p.level + 1
                   AND o.name COLLATE "C" LIKE p.name || '/%'
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM storage.prefixes AS c
                 WHERE c.bucket_id = p.bucket_id
                   AND c.level = p.level + 1
                   AND c.name COLLATE "C" LIKE p.name || '/%'
             )
        )
        DELETE
        FROM storage.prefixes AS p
            USING leaf AS l
        WHERE p.bucket_id = l.bucket_id
          AND p.name = l.name
          AND p.level = l.level;

        GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
        EXIT WHEN v_rows_deleted = 0;
    END LOOP;
END;
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts,1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_level(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_level(name text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
SELECT array_length(string_to_array("name", '/'), 1);
$$;


--
-- Name: get_prefix(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefix(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$_$;


--
-- Name: get_prefixes(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_prefixes(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_legacy_v1(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select path_tokens[$1] as folder
           from storage.objects
             where objects.name ilike $2 || $3 || ''%''
               and bucket_id = $4
               and array_length(objects.path_tokens, 1) <> $1
           group by folder
           order by folder ' || v_sort_order || '
     )
     (select folder as "name",
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[$1] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where objects.name ilike $2 || $3 || ''%''
       and bucket_id = $4
       and array_length(objects.path_tokens, 1) = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: alert_detection_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_detection_state (
    id bigint NOT NULL,
    entity_type public.entity_type NOT NULL,
    entity_id integer NOT NULL,
    ccu_7d_avg integer,
    ccu_7d_max integer,
    ccu_7d_min integer,
    ccu_prev_value integer,
    review_velocity_7d_avg numeric(8,4),
    positive_ratio_prev numeric(5,4),
    total_reviews_prev integer,
    price_cents_prev integer,
    discount_percent_prev integer,
    trend_30d_direction_prev text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE alert_detection_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.alert_detection_state IS 'Baseline metrics for each pinned entity, used for change detection';


--
-- Name: COLUMN alert_detection_state.ccu_7d_avg; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.alert_detection_state.ccu_7d_avg IS '7-day rolling average CCU, baseline for spike/drop detection';


--
-- Name: alert_detection_state_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.alert_detection_state_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: alert_detection_state_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.alert_detection_state_id_seq OWNED BY public.alert_detection_state.id;


--
-- Name: api_rate_limit_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_rate_limit_state (
    source text NOT NULL,
    available_tokens numeric NOT NULL,
    max_tokens numeric NOT NULL,
    refill_rate_per_second numeric NOT NULL,
    last_refill_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_worker_id text
);


--
-- Name: TABLE api_rate_limit_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.api_rate_limit_state IS 'Shared per-source API budget state used to coordinate rate limits across workers.';


--
-- Name: app_capture_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_capture_queue (
    id bigint NOT NULL,
    appid integer NOT NULL,
    source public.app_capture_source NOT NULL,
    status public.app_capture_status DEFAULT 'queued'::public.app_capture_status NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    trigger_reason text NOT NULL,
    trigger_cursor text DEFAULT ''::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    completed_at timestamp with time zone,
    worker_id text,
    last_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE app_capture_queue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_capture_queue IS 'Durable capture queue for storefront/news recaptures and hero asset archival.';


--
-- Name: app_capture_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_capture_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_capture_queue_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_capture_queue_id_seq OWNED BY public.app_capture_queue.id;


--
-- Name: app_capture_work_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_capture_work_state (
    id bigint NOT NULL,
    appid integer NOT NULL,
    source public.app_capture_source NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    latest_trigger_reason text NOT NULL,
    latest_trigger_cursor text DEFAULT ''::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    dirty_since timestamp with time zone,
    last_dirty_at timestamp with time zone,
    claimed_at timestamp with time zone,
    worker_id text,
    attempts integer DEFAULT 0 NOT NULL,
    next_available_at timestamp with time zone DEFAULT now() NOT NULL,
    last_completed_at timestamp with time zone,
    last_error text,
    dead_lettered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE app_capture_work_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_capture_work_state IS 'Coalesced dirty-state work tracker for storefront/news/projection_refresh/hero_asset capture. One live row per app/source.';


--
-- Name: app_capture_work_state_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_capture_work_state_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_capture_work_state_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_capture_work_state_id_seq OWNED BY public.app_capture_work_state.id;


--
-- Name: app_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_categories (
    appid integer NOT NULL,
    category_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE app_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_categories IS 'App to feature category relationships from PICS';


--
-- Name: app_change_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_change_events (
    id bigint NOT NULL,
    appid integer NOT NULL,
    source public.app_change_source NOT NULL,
    change_type public.app_change_type NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    source_snapshot_id bigint,
    related_snapshot_id bigint,
    media_version_id bigint,
    news_item_gid text,
    before_value jsonb,
    after_value jsonb,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    trigger_cursor text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE app_change_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_change_events IS 'Structured change feed derived from snapshot, media, and news version changes.';


--
-- Name: app_change_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_change_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_change_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_change_events_id_seq OWNED BY public.app_change_events.id;


--
-- Name: app_developers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_developers (
    appid integer NOT NULL,
    developer_id integer NOT NULL
);


--
-- Name: app_dlc; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_dlc (
    parent_appid integer NOT NULL,
    dlc_appid integer NOT NULL,
    source text DEFAULT 'pics'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE app_dlc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_dlc IS 'DLC parent-child relationships. FK constraints removed to handle sync order issues where DLC or parent may be processed first.';


--
-- Name: app_genres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_genres (
    appid integer NOT NULL,
    genre_id integer NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE app_genres; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_genres IS 'App to genre relationships from PICS';


--
-- Name: app_publishers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_publishers (
    appid integer NOT NULL,
    publisher_id integer NOT NULL
);


--
-- Name: app_steam_deck; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_steam_deck (
    appid integer NOT NULL,
    category public.steam_deck_category DEFAULT 'unknown'::public.steam_deck_category NOT NULL,
    test_timestamp timestamp with time zone,
    tested_build_id text,
    tests jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE app_steam_deck; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_steam_deck IS 'Steam Deck compatibility data from PICS';


--
-- Name: app_steam_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_steam_tags (
    appid integer NOT NULL,
    tag_id integer NOT NULL,
    rank integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE app_steam_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_steam_tags IS 'App to Steam tag relationships from PICS';


--
-- Name: app_trends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_trends (
    appid integer NOT NULL,
    trend_30d_direction public.trend_direction,
    trend_30d_change_pct numeric(6,2),
    trend_90d_direction public.trend_direction,
    trend_90d_change_pct numeric(6,2),
    current_positive_ratio numeric(5,4),
    previous_positive_ratio numeric(5,4),
    review_velocity_7d numeric(10,2),
    review_velocity_30d numeric(10,2),
    ccu_trend_7d_pct numeric(6,2),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: apps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apps (
    appid integer NOT NULL,
    name text NOT NULL,
    type public.app_type DEFAULT 'game'::public.app_type,
    is_free boolean DEFAULT false,
    release_date date,
    release_date_raw text,
    store_asset_mtime date,
    has_workshop boolean DEFAULT false,
    current_price_cents integer,
    current_discount_percent integer DEFAULT 0,
    is_released boolean DEFAULT true,
    is_delisted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    has_developer_info boolean DEFAULT false,
    controller_support text,
    pics_review_score smallint,
    pics_review_percentage smallint,
    metacritic_score smallint,
    metacritic_url text,
    platforms text,
    release_state text,
    parent_appid integer,
    homepage_url text,
    app_state text,
    last_content_update timestamp with time zone,
    current_build_id text,
    content_descriptors jsonb,
    languages jsonb,
    last_seen_in_steam_applist_at timestamp with time zone,
    CONSTRAINT check_reasonable_price CHECK (((current_price_cents IS NULL) OR (current_price_cents <= 50000)))
);


--
-- Name: COLUMN apps.store_asset_mtime; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.store_asset_mtime IS 'When Steam store page was created (from PICS store_asset_mtime)';


--
-- Name: COLUMN apps.has_developer_info; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.has_developer_info IS 'True if developer/publisher info has been fetched from Storefront API. Prevents redundant API calls.';


--
-- Name: COLUMN apps.controller_support; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.controller_support IS 'Controller support level: "full", "partial", or NULL';


--
-- Name: COLUMN apps.pics_review_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.pics_review_score IS 'Steam review score (1-9) from PICS';


--
-- Name: COLUMN apps.pics_review_percentage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.pics_review_percentage IS 'Positive review percentage (0-100) from PICS';


--
-- Name: COLUMN apps.platforms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.platforms IS 'Supported platforms: comma-separated (windows,macos,linux)';


--
-- Name: COLUMN apps.release_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.release_state IS 'PICS release state: released, prerelease, unavailable, etc.';


--
-- Name: COLUMN apps.parent_appid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.parent_appid IS 'Parent app ID for DLC, demos, mods';


--
-- Name: COLUMN apps.last_content_update; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.last_content_update IS 'Last content update from PICS depots';


--
-- Name: COLUMN apps.current_build_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.current_build_id IS 'Current build ID from PICS depots';


--
-- Name: COLUMN apps.content_descriptors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.content_descriptors IS 'Mature content descriptors as JSONB';


--
-- Name: COLUMN apps.languages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.languages IS 'Supported languages as JSONB';


--
-- Name: COLUMN apps.last_seen_in_steam_applist_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.apps.last_seen_in_steam_applist_at IS 'Timestamp token from the latest applist run that observed this app in Steam IStoreService/GetAppList.';


--
-- Name: ccu_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ccu_snapshots (
    id bigint NOT NULL,
    appid integer NOT NULL,
    snapshot_time timestamp with time zone DEFAULT now() NOT NULL,
    player_count integer NOT NULL,
    ccu_tier smallint NOT NULL
);


--
-- Name: TABLE ccu_snapshots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ccu_snapshots IS 'Hourly CCU snapshots for tiered tracking. Tier 1+2 games get hourly/2-hourly snapshots. Retained for 30 days.';


--
-- Name: COLUMN ccu_snapshots.ccu_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_snapshots.ccu_tier IS 'Tier at time of snapshot: 1=hourly (top CCU), 2=every 2h (new releases), 3=daily (all others)';


--
-- Name: ccu_tier_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ccu_tier_assignments (
    appid integer NOT NULL,
    ccu_tier smallint DEFAULT 3 NOT NULL,
    tier_reason text,
    last_tier_change timestamp with time zone DEFAULT now(),
    recent_peak_ccu integer,
    release_rank integer,
    updated_at timestamp with time zone DEFAULT now(),
    ccu_fetch_status text DEFAULT 'pending'::text,
    ccu_skip_until timestamp with time zone,
    last_ccu_synced timestamp with time zone,
    ccu_growth_7d_percent numeric,
    ccu_growth_30d_percent numeric,
    last_ccu_validation_state text,
    last_ccu_validation_at timestamp with time zone,
    CONSTRAINT chk_ccu_tier_assignments_last_ccu_validation_state CHECK (((last_ccu_validation_state IS NULL) OR (last_ccu_validation_state = ANY (ARRAY['confirmed_positive'::text, 'confirmed_zero'::text, 'suspect_zero'::text, 'invalid'::text, 'error'::text]))))
);


--
-- Name: TABLE ccu_tier_assignments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ccu_tier_assignments IS 'Current tier assignment for each game. Tier 1 = top 500 by CCU (hourly), Tier 2 = 1000 newest releases (every 2h), Tier 3 = all others (daily). Recalculated hourly.';


--
-- Name: COLUMN ccu_tier_assignments.recent_peak_ccu; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.recent_peak_ccu IS 'Maximum CCU in the last 7 days, used for Tier 1 ranking';


--
-- Name: COLUMN ccu_tier_assignments.release_rank; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.release_rank IS 'Release date rank (1 = newest), used for Tier 2 ranking';


--
-- Name: COLUMN ccu_tier_assignments.ccu_fetch_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.ccu_fetch_status IS 'Last CCU fetch result: pending (untested), valid (result:1), invalid (result:42)';


--
-- Name: COLUMN ccu_tier_assignments.ccu_skip_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.ccu_skip_until IS 'Skip CCU polling until this time (for invalid appids). NULL means do not skip.';


--
-- Name: COLUMN ccu_tier_assignments.last_ccu_synced; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.last_ccu_synced IS 'Timestamp of last successful CCU fetch. Used to order queries so oldest-synced games are fetched first, enabling rotation across multiple daily runs.';


--
-- Name: COLUMN ccu_tier_assignments.ccu_growth_7d_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.ccu_growth_7d_percent IS '3-day CCU growth: ((last 3 days avg - prior 3 days avg) / prior avg) * 100. Named 7d for backwards compatibility.';


--
-- Name: COLUMN ccu_tier_assignments.ccu_growth_30d_percent; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.ccu_growth_30d_percent IS '30-day CCU growth: ((last 7 days avg - 30-day baseline avg) / baseline avg) * 100';


--
-- Name: COLUMN ccu_tier_assignments.last_ccu_validation_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.last_ccu_validation_state IS 'Latest official Steam CCU validation outcome: confirmed_positive, confirmed_zero, suspect_zero, invalid, or error.';


--
-- Name: COLUMN ccu_tier_assignments.last_ccu_validation_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ccu_tier_assignments.last_ccu_validation_at IS 'Timestamp of the latest official Steam CCU validation outcome persisted for this app.';


--
-- Name: daily_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_metrics (
    id bigint NOT NULL,
    appid integer NOT NULL,
    metric_date date NOT NULL,
    owners_min integer,
    owners_max integer,
    ccu_peak integer,
    average_playtime_forever integer,
    average_playtime_2weeks integer,
    total_reviews integer,
    positive_reviews integer,
    negative_reviews integer,
    review_score smallint,
    review_score_desc text,
    recent_total_reviews integer,
    recent_positive integer,
    recent_negative integer,
    recent_score_desc text,
    price_cents integer,
    discount_percent smallint DEFAULT 0,
    ccu_source text,
    CONSTRAINT chk_ccu_source CHECK (((ccu_source IS NULL) OR (ccu_source = ANY (ARRAY['steamspy'::text, 'steam_api'::text]))))
);


--
-- Name: COLUMN daily_metrics.ccu_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.daily_metrics.ccu_source IS 'Source of CCU data: steam_api (exact from GetNumberOfCurrentPlayers) or steamspy (from SteamSpy sync). NULL for legacy data.';


--
-- Name: developers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.developers (
    id integer NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL,
    steam_vanity_url text,
    first_game_release_date date,
    game_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_embedding_sync timestamp with time zone,
    embedding_hash text
);


--
-- Name: COLUMN developers.last_embedding_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.developers.last_embedding_sync IS 'Timestamp of last successful embedding sync to Qdrant';


--
-- Name: COLUMN developers.embedding_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.developers.embedding_hash IS 'Hash of embedding source text to detect changes';


--
-- Name: latest_daily_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.latest_daily_metrics AS
 WITH latest_ccu AS (
         SELECT DISTINCT ON (daily_metrics.appid) daily_metrics.appid,
            daily_metrics.metric_date AS ccu_date,
            daily_metrics.ccu_peak,
            daily_metrics.ccu_source
           FROM public.daily_metrics
          WHERE (daily_metrics.ccu_peak IS NOT NULL)
          ORDER BY daily_metrics.appid, daily_metrics.metric_date DESC
        ), latest_reviews AS (
         SELECT DISTINCT ON (daily_metrics.appid) daily_metrics.appid,
            daily_metrics.total_reviews,
            daily_metrics.positive_reviews,
            daily_metrics.negative_reviews,
            daily_metrics.review_score,
            daily_metrics.review_score_desc
           FROM public.daily_metrics
          WHERE (daily_metrics.total_reviews IS NOT NULL)
          ORDER BY daily_metrics.appid, daily_metrics.metric_date DESC
        ), latest_owners AS (
         SELECT DISTINCT ON (daily_metrics.appid) daily_metrics.appid,
            daily_metrics.owners_min,
            daily_metrics.owners_max,
            daily_metrics.price_cents,
            daily_metrics.discount_percent,
            daily_metrics.average_playtime_forever,
            daily_metrics.average_playtime_2weeks
           FROM public.daily_metrics
          WHERE (daily_metrics.owners_min IS NOT NULL)
          ORDER BY daily_metrics.appid, daily_metrics.metric_date DESC
        ), weekly_ccu AS (
         SELECT daily_metrics.appid,
            sum(daily_metrics.ccu_peak) AS ccu_7d_sum
           FROM public.daily_metrics
          WHERE ((daily_metrics.metric_date >= (CURRENT_DATE - '7 days'::interval)) AND (daily_metrics.ccu_peak IS NOT NULL))
          GROUP BY daily_metrics.appid
        ), all_appids AS (
         SELECT DISTINCT daily_metrics.appid
           FROM public.daily_metrics
        )
 SELECT a.appid,
    c.ccu_date AS metric_date,
    o.owners_min,
    o.owners_max,
    COALESCE(((COALESCE(o.owners_min, 0) + COALESCE(o.owners_max, 0)) / 2), 0) AS owners_midpoint,
    c.ccu_peak,
    c.ccu_source,
    r.total_reviews,
    r.positive_reviews,
    r.negative_reviews,
    r.review_score,
    r.review_score_desc,
        CASE
            WHEN (r.total_reviews > 0) THEN round((((r.positive_reviews)::numeric * 100.0) / (r.total_reviews)::numeric), 1)
            ELSE NULL::numeric
        END AS positive_percentage,
    o.price_cents,
    o.discount_percent,
    o.average_playtime_forever,
    o.average_playtime_2weeks,
    (COALESCE(round(((((w.ccu_7d_sum * COALESCE(o.average_playtime_2weeks, 0)))::numeric / 2.0) / 60.0)), (0)::numeric))::bigint AS estimated_weekly_hours
   FROM ((((all_appids a
     LEFT JOIN latest_ccu c ON ((a.appid = c.appid)))
     LEFT JOIN latest_reviews r ON ((a.appid = r.appid)))
     LEFT JOIN latest_owners o ON ((a.appid = o.appid)))
     LEFT JOIN weekly_ccu w ON ((a.appid = w.appid)))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW latest_daily_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.latest_daily_metrics IS 'Pre-computed latest metrics per app. Coalesces across rows to get most recent non-NULL value for each column group (CCU, reviews, owners/price). Refresh with refresh_latest_daily_metrics()';


--
-- Name: publishers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publishers (
    id integer NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL,
    steam_vanity_url text,
    first_game_release_date date,
    game_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_embedding_sync timestamp with time zone,
    embedding_hash text
);


--
-- Name: COLUMN publishers.last_embedding_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.publishers.last_embedding_sync IS 'Timestamp of last successful embedding sync to Qdrant';


--
-- Name: COLUMN publishers.embedding_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.publishers.embedding_hash IS 'Hash of embedding source text to detect changes';


--
-- Name: review_deltas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_deltas (
    id bigint NOT NULL,
    appid integer NOT NULL,
    delta_date date NOT NULL,
    total_reviews integer NOT NULL,
    positive_reviews integer NOT NULL,
    review_score smallint,
    review_score_desc text,
    reviews_added integer DEFAULT 0 NOT NULL,
    positive_added integer DEFAULT 0 NOT NULL,
    negative_added integer DEFAULT 0 NOT NULL,
    hours_since_last_sync numeric(6,2),
    daily_velocity numeric(8,4) GENERATED ALWAYS AS (
CASE
    WHEN (hours_since_last_sync > (0)::numeric) THEN (((reviews_added)::numeric * 24.0) / hours_since_last_sync)
    ELSE (0)::numeric
END) STORED,
    is_interpolated boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE review_deltas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.review_deltas IS 'Daily review change tracking for trend visualization and velocity-based sync scheduling';


--
-- Name: COLUMN review_deltas.daily_velocity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.review_deltas.daily_velocity IS 'Computed daily review velocity (reviews_added normalized to 24h). Precision increased from (8,4) to (12,4) to handle high-velocity games.';


--
-- Name: COLUMN review_deltas.is_interpolated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.review_deltas.is_interpolated IS 'TRUE if this record was estimated between actual syncs, FALSE if from API';


--
-- Name: review_velocity_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.review_velocity_stats AS
 WITH recent_deltas AS (
         SELECT review_deltas.appid,
            review_deltas.delta_date,
            review_deltas.reviews_added,
            review_deltas.daily_velocity,
            review_deltas.is_interpolated,
            row_number() OVER (PARTITION BY review_deltas.appid ORDER BY review_deltas.delta_date DESC) AS rn
           FROM public.review_deltas
          WHERE (review_deltas.delta_date >= (CURRENT_DATE - '30 days'::interval))
        ), velocity_calcs AS (
         SELECT recent_deltas.appid,
            avg(recent_deltas.daily_velocity) FILTER (WHERE ((recent_deltas.rn <= 7) AND (NOT recent_deltas.is_interpolated))) AS velocity_7d,
            avg(recent_deltas.daily_velocity) FILTER (WHERE (NOT recent_deltas.is_interpolated)) AS velocity_30d,
            sum(recent_deltas.reviews_added) FILTER (WHERE (recent_deltas.rn <= 7)) AS reviews_added_7d,
            sum(recent_deltas.reviews_added) AS reviews_added_30d,
            max(recent_deltas.delta_date) AS last_delta_date,
            count(*) FILTER (WHERE (NOT recent_deltas.is_interpolated)) AS actual_sync_count
           FROM recent_deltas
          GROUP BY recent_deltas.appid
        )
 SELECT appid,
    (COALESCE(velocity_7d, (0)::numeric))::numeric(8,4) AS velocity_7d,
    (COALESCE(velocity_30d, (0)::numeric))::numeric(8,4) AS velocity_30d,
    (COALESCE(reviews_added_7d, (0)::bigint))::integer AS reviews_added_7d,
    (COALESCE(reviews_added_30d, (0)::bigint))::integer AS reviews_added_30d,
    last_delta_date,
    actual_sync_count,
        CASE
            WHEN (velocity_7d >= (5)::numeric) THEN 'high'::text
            WHEN (velocity_7d >= (1)::numeric) THEN 'medium'::text
            WHEN (velocity_7d >= 0.1) THEN 'low'::text
            ELSE 'dormant'::text
        END AS velocity_tier
   FROM velocity_calcs vc
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW review_velocity_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.review_velocity_stats IS 'Pre-computed review velocity stats for fast queries';


--
-- Name: publisher_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.publisher_metrics AS
 WITH latest_metrics AS (
         SELECT DISTINCT ON (dm.appid) dm.appid,
            dm.owners_min,
            dm.owners_max,
            dm.ccu_peak,
            dm.total_reviews,
            dm.positive_reviews,
            dm.negative_reviews,
            dm.review_score,
            dm.average_playtime_2weeks
           FROM public.daily_metrics dm
          ORDER BY dm.appid, dm.metric_date DESC
        ), weekly_ccu AS (
         SELECT daily_metrics.appid,
            sum(daily_metrics.ccu_peak) AS ccu_7d_sum
           FROM public.daily_metrics
          WHERE (daily_metrics.metric_date >= (CURRENT_DATE - '7 days'::interval))
          GROUP BY daily_metrics.appid
        ), publisher_apps AS (
         SELECT ap.publisher_id,
            a.appid,
            a.release_date,
            a.current_price_cents,
            lm.owners_min,
            lm.owners_max,
            lm.ccu_peak,
            lm.total_reviews,
            lm.positive_reviews,
            lm.negative_reviews,
            lm.review_score,
            lm.average_playtime_2weeks,
            wc.ccu_7d_sum,
            at.trend_30d_direction
           FROM ((((public.app_publishers ap
             JOIN public.apps a ON ((a.appid = ap.appid)))
             LEFT JOIN latest_metrics lm ON ((lm.appid = a.appid)))
             LEFT JOIN weekly_ccu wc ON ((wc.appid = a.appid)))
             LEFT JOIN public.app_trends at ON ((at.appid = a.appid)))
          WHERE ((a.type = 'game'::public.app_type) AND (a.is_delisted = false))
        ), publisher_developers AS (
         SELECT ap.publisher_id,
            (count(DISTINCT ad.developer_id))::integer AS unique_developers
           FROM (public.app_publishers ap
             JOIN public.app_developers ad ON ((ad.appid = ap.appid)))
          GROUP BY ap.publisher_id
        ), publisher_genres AS (
         SELECT ap.publisher_id,
            array_agg(DISTINCT ag.genre_id ORDER BY ag.genre_id) AS genre_ids
           FROM ((public.app_publishers ap
             JOIN public.apps a ON (((a.appid = ap.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_genres ag ON ((ag.appid = ap.appid)))
          GROUP BY ap.publisher_id
        ), publisher_tags AS (
         SELECT ap.publisher_id,
            array_agg(DISTINCT ast.tag_id ORDER BY ast.tag_id) AS tag_ids
           FROM ((public.app_publishers ap
             JOIN public.apps a ON (((a.appid = ap.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_steam_tags ast ON ((ast.appid = ap.appid)))
          GROUP BY ap.publisher_id
        ), publisher_categories AS (
         SELECT ap.publisher_id,
            array_agg(DISTINCT ac.category_id ORDER BY ac.category_id) AS category_ids
           FROM ((public.app_publishers ap
             JOIN public.apps a ON (((a.appid = ap.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_categories ac ON ((ac.appid = ap.appid)))
          GROUP BY ap.publisher_id
        ), publisher_steam_deck AS (
         SELECT DISTINCT ON (ap.publisher_id) ap.publisher_id,
            asd.category AS best_steam_deck_category
           FROM ((public.app_publishers ap
             JOIN public.apps a ON (((a.appid = ap.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_steam_deck asd ON ((asd.appid = ap.appid)))
          WHERE (asd.category = ANY (ARRAY['verified'::public.steam_deck_category, 'playable'::public.steam_deck_category]))
          ORDER BY ap.publisher_id,
                CASE asd.category
                    WHEN 'verified'::public.steam_deck_category THEN 1
                    WHEN 'playable'::public.steam_deck_category THEN 2
                    ELSE NULL::integer
                END
        ), publisher_platforms AS (
         SELECT ap.publisher_id,
            array_agg(DISTINCT platform.platform ORDER BY platform.platform) FILTER (WHERE ((platform.platform IS NOT NULL) AND (platform.platform <> ''::text))) AS platform_array
           FROM ((public.app_publishers ap
             JOIN public.apps a ON (((a.appid = ap.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             CROSS JOIN LATERAL unnest(string_to_array(a.platforms, ','::text)) platform(platform))
          WHERE ((a.platforms IS NOT NULL) AND (a.platforms <> ''::text))
          GROUP BY ap.publisher_id
        ), publisher_growth AS (
         SELECT ap.publisher_id,
            avg(cs.player_count) FILTER (WHERE (cs.snapshot_time > (now() - '3 days'::interval))) AS current_3d_avg,
            avg(cs.player_count) FILTER (WHERE ((cs.snapshot_time > (now() - '6 days'::interval)) AND (cs.snapshot_time <= (now() - '3 days'::interval)))) AS prior_3d_avg,
            avg(cs.player_count) FILTER (WHERE (cs.snapshot_time > (now() - '7 days'::interval))) AS baseline_7d_avg
           FROM ((public.app_publishers ap
             JOIN public.apps a ON (((a.appid = ap.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             LEFT JOIN public.ccu_snapshots cs ON (((cs.appid = ap.appid) AND (cs.snapshot_time > (now() - '7 days'::interval)))))
          GROUP BY ap.publisher_id
        ), publisher_velocity AS (
         SELECT ap.publisher_id,
            (sum(rvs.velocity_7d))::numeric(10,4) AS review_velocity_7d,
            (sum(rvs.velocity_30d))::numeric(10,4) AS review_velocity_30d
           FROM ((public.app_publishers ap
             JOIN public.apps a ON (((a.appid = ap.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             LEFT JOIN public.review_velocity_stats rvs ON ((rvs.appid = ap.appid)))
          GROUP BY ap.publisher_id
        )
 SELECT pa.publisher_id,
    p.name AS publisher_name,
    p.game_count,
    COALESCE(((sum(pa.owners_min) + sum(pa.owners_max)) / 2), (0)::bigint) AS total_owners,
    COALESCE(sum(pa.ccu_peak), (0)::bigint) AS total_ccu,
    (COALESCE(sum(((((COALESCE(pa.ccu_7d_sum, (0)::bigint) * COALESCE(pa.average_playtime_2weeks, 0)))::numeric / 2.0) / 60.0)), (0)::numeric))::bigint AS estimated_weekly_hours,
    COALESCE(sum(pa.total_reviews), (0)::bigint) AS total_reviews,
    COALESCE(sum(pa.positive_reviews), (0)::bigint) AS positive_reviews,
        CASE
            WHEN (sum(pa.total_reviews) > 0) THEN (round((((sum(pa.positive_reviews))::numeric / (sum(pa.total_reviews))::numeric) * (100)::numeric)))::smallint
            ELSE NULL::smallint
        END AS avg_review_score,
    (COALESCE(sum(((((COALESCE(pa.owners_min, 0) + COALESCE(pa.owners_max, 0)))::numeric / 2.0) * (COALESCE(pa.current_price_cents, 0))::numeric)), (0)::numeric))::bigint AS revenue_estimate_cents,
    (count(*) FILTER (WHERE (pa.trend_30d_direction = 'up'::public.trend_direction)) > 0) AS is_trending,
    (count(*) FILTER (WHERE (pa.trend_30d_direction = 'up'::public.trend_direction)))::integer AS games_trending_up,
    (count(*) FILTER (WHERE (pa.trend_30d_direction = 'down'::public.trend_direction)))::integer AS games_trending_down,
    (count(*) FILTER (WHERE (pa.trend_30d_direction = 'stable'::public.trend_direction)))::integer AS games_trending_stable,
    (count(*) FILTER (WHERE (pa.release_date >= (CURRENT_DATE - '1 year'::interval))))::integer AS games_released_last_year,
    COALESCE(pd.unique_developers, 0) AS unique_developers,
    pg.genre_ids,
    pt.tag_ids,
    pc.category_ids,
    psd.best_steam_deck_category,
    pp.platform_array,
        CASE
            WHEN (pgr.prior_3d_avg > (0)::numeric) THEN round((((pgr.current_3d_avg - pgr.prior_3d_avg) / pgr.prior_3d_avg) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS ccu_growth_7d_percent,
        CASE
            WHEN (pgr.baseline_7d_avg > (0)::numeric) THEN round((((pgr.current_3d_avg - pgr.baseline_7d_avg) / pgr.baseline_7d_avg) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS ccu_growth_30d_percent,
    COALESCE(pv.review_velocity_7d, (0)::numeric) AS review_velocity_7d,
    COALESCE(pv.review_velocity_30d, (0)::numeric) AS review_velocity_30d,
    now() AS computed_at
   FROM (((((((((publisher_apps pa
     JOIN public.publishers p ON ((p.id = pa.publisher_id)))
     LEFT JOIN publisher_developers pd ON ((pd.publisher_id = pa.publisher_id)))
     LEFT JOIN publisher_genres pg ON ((pg.publisher_id = pa.publisher_id)))
     LEFT JOIN publisher_tags pt ON ((pt.publisher_id = pa.publisher_id)))
     LEFT JOIN publisher_categories pc ON ((pc.publisher_id = pa.publisher_id)))
     LEFT JOIN publisher_steam_deck psd ON ((psd.publisher_id = pa.publisher_id)))
     LEFT JOIN publisher_platforms pp ON ((pp.publisher_id = pa.publisher_id)))
     LEFT JOIN publisher_growth pgr ON ((pgr.publisher_id = pa.publisher_id)))
     LEFT JOIN publisher_velocity pv ON ((pv.publisher_id = pa.publisher_id)))
  GROUP BY pa.publisher_id, p.name, p.game_count, pd.unique_developers, pg.genre_ids, pt.tag_ids, pc.category_ids, psd.best_steam_deck_category, pp.platform_array, pgr.current_3d_avg, pgr.prior_3d_avg, pgr.baseline_7d_avg, pv.review_velocity_7d, pv.review_velocity_30d
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW publisher_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.publisher_metrics IS 'Pre-computed publisher metrics with 3-day growth windows and review velocity. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY publisher_metrics';


--
-- Name: app_filter_data; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.app_filter_data AS
 WITH publisher_data AS (
         SELECT DISTINCT ON (ap.appid) ap.appid,
            ap.publisher_id,
            p.name AS publisher_name,
            p.game_count AS publisher_game_count
           FROM (public.app_publishers ap
             JOIN public.publishers p ON ((p.id = ap.publisher_id)))
          ORDER BY ap.appid, ap.publisher_id
        ), developer_data AS (
         SELECT DISTINCT ON (ad.appid) ad.appid,
            ad.developer_id,
            d.name AS developer_name
           FROM (public.app_developers ad
             JOIN public.developers d ON ((d.id = ad.developer_id)))
          ORDER BY ad.appid, ad.developer_id
        ), content_arrays AS (
         SELECT a.appid,
            COALESCE(array_agg(DISTINCT ag.genre_id) FILTER (WHERE (ag.genre_id IS NOT NULL)), ARRAY[]::integer[]) AS genre_ids,
            COALESCE(array_agg(DISTINCT ast.tag_id) FILTER (WHERE (ast.tag_id IS NOT NULL)), ARRAY[]::integer[]) AS tag_ids,
            COALESCE(array_agg(DISTINCT ac.category_id) FILTER (WHERE (ac.category_id IS NOT NULL)), ARRAY[]::integer[]) AS category_ids,
            (30 = ANY (array_agg(DISTINCT ac.category_id) FILTER (WHERE (ac.category_id IS NOT NULL)))) AS has_workshop,
            array_remove(ARRAY[
                CASE
                    WHEN (a.platforms ~~ '%windows%'::text) THEN 'windows'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (a.platforms ~~ '%macos%'::text) THEN 'macos'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (a.platforms ~~ '%linux%'::text) THEN 'linux'::text
                    ELSE NULL::text
                END], NULL::text) AS platform_array
           FROM (((public.apps a
             LEFT JOIN public.app_genres ag ON ((ag.appid = a.appid)))
             LEFT JOIN public.app_steam_tags ast ON ((ast.appid = a.appid)))
             LEFT JOIN public.app_categories ac ON ((ac.appid = a.appid)))
          WHERE ((a.is_released = true) AND (a.is_delisted = false))
          GROUP BY a.appid, a.platforms
        ), metrics_data AS (
         SELECT a.appid,
            a.is_free,
            a.release_date,
            a.store_asset_mtime,
            ldm.ccu_peak,
            ldm.owners_min,
            ldm.owners_max,
            ldm.owners_midpoint,
            ldm.total_reviews,
            ldm.positive_reviews,
            ldm.review_score,
            ldm.positive_percentage,
            ldm.price_cents,
            ldm.average_playtime_forever,
            ldm.average_playtime_2weeks,
            ct.ccu_growth_7d_percent,
            ct.ccu_growth_30d_percent,
            ct.ccu_tier,
            COALESCE(rvs.velocity_7d, (0)::numeric) AS velocity_7d,
            COALESCE(rvs.velocity_30d, (0)::numeric) AS velocity_30d,
            rvs.velocity_tier,
            atr.current_positive_ratio,
            atr.previous_positive_ratio
           FROM ((((public.apps a
             LEFT JOIN public.latest_daily_metrics ldm ON ((ldm.appid = a.appid)))
             LEFT JOIN public.ccu_tier_assignments ct ON ((ct.appid = a.appid)))
             LEFT JOIN public.review_velocity_stats rvs ON ((rvs.appid = a.appid)))
             LEFT JOIN public.app_trends atr ON ((atr.appid = a.appid)))
          WHERE ((a.is_released = true) AND (a.is_delisted = false))
        )
 SELECT ca.appid,
    ca.genre_ids,
    ca.tag_ids,
    ca.category_ids,
    ca.has_workshop,
    ca.platform_array,
    asd.category AS steam_deck_category,
    pd.publisher_id,
    pd.publisher_name,
    pd.publisher_game_count,
    dd.developer_id,
    dd.developer_name,
    pm.avg_review_score AS publisher_avg_score,
        CASE
            WHEN ((md.review_score IS NOT NULL) AND (pm.avg_review_score IS NOT NULL)) THEN ((md.review_score - pm.avg_review_score))::numeric
            ELSE NULL::numeric
        END AS vs_publisher_avg,
        CASE
            WHEN (md.ccu_growth_7d_percent IS NOT NULL) THEN round(((md.ccu_growth_7d_percent +
            CASE
                WHEN (md.velocity_30d > (0)::numeric) THEN (((md.velocity_7d - md.velocity_30d) / md.velocity_30d) * (100)::numeric)
                ELSE (0)::numeric
            END) / (2)::numeric), 2)
            ELSE NULL::numeric
        END AS momentum_score,
        CASE
            WHEN ((md.current_positive_ratio IS NOT NULL) AND (md.previous_positive_ratio IS NOT NULL)) THEN round(((md.current_positive_ratio - md.previous_positive_ratio) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS sentiment_delta,
        CASE
            WHEN ((md.velocity_7d IS NOT NULL) AND (md.velocity_30d IS NOT NULL)) THEN round((md.velocity_7d - md.velocity_30d), 4)
            ELSE NULL::numeric
        END AS velocity_acceleration,
        CASE
            WHEN ((md.owners_midpoint IS NULL) OR (md.owners_midpoint = 0)) THEN NULL::numeric
            ELSE round((((md.ccu_peak)::numeric / (md.owners_midpoint)::numeric) * (100)::numeric), 2)
        END AS active_player_pct,
        CASE
            WHEN ((md.owners_midpoint IS NULL) OR (md.owners_midpoint = 0)) THEN NULL::numeric
            ELSE round((((md.total_reviews)::numeric / (md.owners_midpoint)::numeric) * (1000)::numeric), 2)
        END AS review_rate,
        CASE
            WHEN (md.is_free OR (md.price_cents IS NULL) OR (md.price_cents = 0)) THEN NULL::numeric
            WHEN ((md.average_playtime_forever IS NULL) OR (md.average_playtime_forever = 0)) THEN NULL::numeric
            ELSE round((((md.average_playtime_forever)::numeric / (60)::numeric) / ((md.price_cents)::numeric / (100)::numeric)), 2)
        END AS value_score,
        CASE
            WHEN (md.release_date IS NOT NULL) THEN (CURRENT_DATE - md.release_date)
            ELSE NULL::integer
        END AS days_live,
        CASE
            WHEN ((md.release_date IS NOT NULL) AND (md.store_asset_mtime IS NOT NULL)) THEN (md.release_date - md.store_asset_mtime)
            ELSE NULL::integer
        END AS hype_duration
   FROM (((((content_arrays ca
     LEFT JOIN public.app_steam_deck asd ON ((asd.appid = ca.appid)))
     LEFT JOIN publisher_data pd ON ((pd.appid = ca.appid)))
     LEFT JOIN developer_data dd ON ((dd.appid = ca.appid)))
     LEFT JOIN metrics_data md ON ((md.appid = ca.appid)))
     LEFT JOIN public.publisher_metrics pm ON ((pm.publisher_id = pd.publisher_id)))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW app_filter_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.app_filter_data IS 'Pre-computed filter and metric data for apps page. Refreshed every 6 hours.
Contains:
- Content arrays (genres, tags, categories, platforms) for O(1) filtering
- Steam Deck category
- Publisher/Developer data (using DISTINCT ON instead of LATERAL)
- Pre-computed metrics: vs_publisher_avg, momentum_score, sentiment_delta,
  velocity_acceleration, active_player_pct, review_rate, value_score, days_live, hype_duration
This eliminates the slow path in get_apps_with_filters by pre-computing vs_publisher_avg.';


--
-- Name: app_franchises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_franchises (
    appid integer NOT NULL,
    franchise_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE app_franchises; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_franchises IS 'App to franchise relationships from PICS';


--
-- Name: app_hero_asset_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_hero_asset_versions (
    id uuid NOT NULL,
    appid integer NOT NULL,
    asset_kind text NOT NULL,
    source_url text NOT NULL,
    object_key text NOT NULL,
    content_hash text NOT NULL,
    mime_type text,
    content_length integer NOT NULL,
    width integer,
    height integer,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_hero_asset_versions_asset_kind_check CHECK ((asset_kind = ANY (ARRAY['header'::text, 'capsule'::text, 'background'::text])))
);


--
-- Name: TABLE app_hero_asset_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_hero_asset_versions IS 'Archived hero asset binaries and metadata stored in Supabase Storage, deduped by sha256 hash.';


--
-- Name: app_media_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_media_versions (
    id bigint NOT NULL,
    appid integer NOT NULL,
    storefront_snapshot_id bigint,
    content_hash text NOT NULL,
    hero_assets jsonb DEFAULT '{}'::jsonb NOT NULL,
    screenshots jsonb DEFAULT '[]'::jsonb NOT NULL,
    trailers jsonb DEFAULT '[]'::jsonb NOT NULL,
    previous_version_id bigint,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE app_media_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_media_versions IS 'Versioned media surface derived from storefront snapshots, including hero URLs and ordered screenshots/trailers.';


--
-- Name: app_media_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_media_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_media_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_media_versions_id_seq OWNED BY public.app_media_versions.id;


--
-- Name: app_source_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_source_snapshots (
    id bigint NOT NULL,
    appid integer NOT NULL,
    source public.app_snapshot_source NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash text NOT NULL,
    previous_snapshot_id bigint,
    trigger_reason text NOT NULL,
    trigger_cursor text,
    snapshot_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE app_source_snapshots; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.app_source_snapshots IS 'Normalized storefront and PICS snapshots. Raw payloads stay out of hot tables; only normalized JSONB is stored here.';


--
-- Name: app_source_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_source_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_source_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_source_snapshots_id_seq OWNED BY public.app_source_snapshots.id;


--
-- Name: app_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_tags (
    appid integer NOT NULL,
    tag text NOT NULL,
    vote_count integer DEFAULT 0
);


--
-- Name: ccu_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ccu_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ccu_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ccu_snapshots_id_seq OWNED BY public.ccu_snapshots.id;


--
-- Name: change_activity_bursts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_activity_bursts (
    burst_id text NOT NULL,
    appid integer NOT NULL,
    app_name text NOT NULL,
    app_type public.app_type,
    is_released boolean,
    release_date date,
    effective_at timestamp with time zone NOT NULL,
    burst_started_at timestamp with time zone NOT NULL,
    burst_ended_at timestamp with time zone NOT NULL,
    event_count integer NOT NULL,
    change_type_count integer NOT NULL,
    source_set text[] DEFAULT ARRAY[]::text[] NOT NULL,
    change_types text[] DEFAULT ARRAY[]::text[] NOT NULL,
    headline_change_types text[] DEFAULT ARRAY[]::text[] NOT NULL,
    highlight_labels text[] DEFAULT ARRAY[]::text[] NOT NULL,
    signal_families text[] DEFAULT ARRAY[]::text[] NOT NULL,
    story_kind text NOT NULL,
    has_related_news boolean DEFAULT false NOT NULL,
    related_news_count integer DEFAULT 0 NOT NULL,
    include_in_high_signal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE change_activity_bursts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.change_activity_bursts IS 'Projection table containing grouped per-app change bursts with denormalized metadata for chat and the Change Feed UI.';


--
-- Name: change_pattern_activity_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_pattern_activity_days (
    appid integer NOT NULL,
    activity_date date NOT NULL,
    app_name text NOT NULL,
    app_type public.app_type,
    is_released boolean,
    release_date date,
    latest_occurred_at timestamp with time zone NOT NULL,
    burst_ids text[] DEFAULT ARRAY[]::text[] NOT NULL,
    signal_families text[] DEFAULT ARRAY[]::text[] NOT NULL,
    story_kinds text[] DEFAULT ARRAY[]::text[] NOT NULL,
    announcement_count integer DEFAULT 0 NOT NULL,
    total_bursts integer DEFAULT 0 NOT NULL,
    release_count integer DEFAULT 0 NOT NULL,
    pricing_count integer DEFAULT 0 NOT NULL,
    store_page_count integer DEFAULT 0 NOT NULL,
    media_count integer DEFAULT 0 NOT NULL,
    taxonomy_count integer DEFAULT 0 NOT NULL,
    platform_count integer DEFAULT 0 NOT NULL,
    build_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE change_pattern_activity_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.change_pattern_activity_days IS 'App-day rollup of grouped change activity used for fast pattern/prospecting chat queries.';


--
-- Name: change_pattern_app_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_pattern_app_windows (
    appid integer NOT NULL,
    window_days integer NOT NULL,
    app_name text NOT NULL,
    app_type public.app_type,
    is_released boolean,
    release_date date,
    latest_occurred_at timestamp with time zone NOT NULL,
    activity_ids text[] DEFAULT ARRAY[]::text[] NOT NULL,
    signal_families text[] DEFAULT ARRAY[]::text[] NOT NULL,
    story_kinds text[] DEFAULT ARRAY[]::text[] NOT NULL,
    announcement_count integer DEFAULT 0 NOT NULL,
    change_count integer DEFAULT 0 NOT NULL,
    release_count integer DEFAULT 0 NOT NULL,
    pricing_count integer DEFAULT 0 NOT NULL,
    store_page_count integer DEFAULT 0 NOT NULL,
    media_count integer DEFAULT 0 NOT NULL,
    taxonomy_count integer DEFAULT 0 NOT NULL,
    platform_count integer DEFAULT 0 NOT NULL,
    build_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT change_pattern_app_windows_window_days_check CHECK ((window_days = ANY (ARRAY[7, 30, 90, 180])))
);


--
-- Name: TABLE change_pattern_app_windows; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.change_pattern_app_windows IS 'App-window rollup for broad change-pattern candidate shortlisting. Metrics stay live-joined after shortlist.';


--
-- Name: chat_query_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_query_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    query_text text NOT NULL,
    tool_names text[] DEFAULT '{}'::text[],
    tool_count integer DEFAULT 0,
    iteration_count integer DEFAULT 1,
    response_length integer DEFAULT 0,
    timing_llm_ms integer,
    timing_tools_ms integer,
    timing_total_ms integer,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    input_tokens integer,
    output_tokens integer,
    tool_credits_used integer,
    total_credits_charged integer,
    reservation_id uuid,
    chat_family text,
    quality_flags text[],
    session_context_summary jsonb,
    guardrail_trace jsonb,
    answer_contract_summary jsonb
);


--
-- Name: credit_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reserved_amount integer NOT NULL,
    actual_amount integer,
    status public.credit_reservation_status DEFAULT 'pending'::public.credit_reservation_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finalized_at timestamp with time zone
);


--
-- Name: credit_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    amount integer NOT NULL,
    balance_after integer NOT NULL,
    transaction_type public.credit_transaction_type NOT NULL,
    description text,
    input_tokens integer,
    output_tokens integer,
    tool_credits integer,
    admin_user_id uuid,
    reservation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_metrics_id_seq OWNED BY public.daily_metrics.id;


--
-- Name: dashboard_stats_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_stats_cache (
    id text DEFAULT 'main'::text NOT NULL,
    apps_count bigint DEFAULT 0,
    publishers_count bigint DEFAULT 0,
    developers_count bigint DEFAULT 0,
    pics_synced bigint DEFAULT 0,
    categories_count bigint DEFAULT 0,
    genres_count bigint DEFAULT 0,
    tags_count bigint DEFAULT 0,
    franchises_count bigint DEFAULT 0,
    parent_app_count bigint DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    ccu_current_catalog_apps bigint,
    ccu_tier_assigned bigint,
    ccu_no_tier_assignment bigint,
    ccu_confirmed_positive bigint,
    ccu_confirmed_zero bigint,
    ccu_suspect_zero bigint,
    ccu_skipped bigint,
    ccu_invalid bigint,
    ccu_unavailable bigint,
    ccu_steam_api bigint,
    ccu_steamspy bigint,
    ccu_legacy_unknown bigint,
    ccu_quality_updated_at timestamp with time zone
);


--
-- Name: COLUMN dashboard_stats_cache.ccu_current_catalog_apps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_current_catalog_apps IS 'Current catalog denominator used for cached admin CCU quality metrics.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_tier_assigned; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_tier_assigned IS 'Cached current-catalog apps that currently have a CCU tier assignment.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_no_tier_assignment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_no_tier_assignment IS 'Cached current-catalog apps that do not currently have a CCU tier assignment.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_confirmed_positive; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_confirmed_positive IS 'Cached current-catalog apps whose latest official CCU validation is confirmed_positive.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_confirmed_zero; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_confirmed_zero IS 'Cached current-catalog apps whose latest official CCU validation is confirmed_zero.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_suspect_zero; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_suspect_zero IS 'Cached current-catalog apps whose latest official CCU validation is suspect_zero.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_skipped; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_skipped IS 'Cached current-catalog apps currently in the invalid-but-skipped CCU state.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_invalid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_invalid IS 'Cached current-catalog apps currently in the invalid CCU state.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_unavailable; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_unavailable IS 'Cached current-catalog apps whose latest CCU quality state resolves to unavailable.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_steam_api; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_steam_api IS 'Cached current-catalog apps whose latest non-null CCU row is sourced from Steam API.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_steamspy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_steamspy IS 'Cached current-catalog apps whose latest non-null CCU row is sourced from SteamSpy.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_legacy_unknown; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_legacy_unknown IS 'Cached current-catalog apps whose latest non-null CCU row has null provenance.';


--
-- Name: COLUMN dashboard_stats_cache.ccu_quality_updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_stats_cache.ccu_quality_updated_at IS 'Timestamp when the cached admin CCU quality metrics were last refreshed.';


--
-- Name: developer_game_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.developer_game_metrics AS
 WITH latest_metrics AS (
         SELECT DISTINCT ON (dm.appid) dm.appid,
            dm.owners_min,
            dm.owners_max,
            dm.ccu_peak,
            dm.total_reviews,
            dm.positive_reviews,
            dm.review_score
           FROM public.daily_metrics dm
          ORDER BY dm.appid, dm.metric_date DESC
        )
 SELECT ad.developer_id,
    d.name AS developer_name,
    a.appid,
    a.name AS game_name,
    a.release_date,
    (EXTRACT(year FROM a.release_date))::integer AS release_year,
    a.current_price_cents,
    (COALESCE(((lm.owners_min + lm.owners_max) / 2), 0))::bigint AS owners,
    COALESCE(lm.ccu_peak, 0) AS ccu,
    COALESCE(lm.total_reviews, 0) AS total_reviews,
    COALESCE(lm.positive_reviews, 0) AS positive_reviews,
    COALESCE(lm.review_score, a.pics_review_score) AS review_score,
    (COALESCE(((((COALESCE(lm.owners_min, 0) + COALESCE(lm.owners_max, 0)))::numeric / 2.0) * (COALESCE(a.current_price_cents, 0))::numeric), (0)::numeric))::bigint AS revenue_estimate_cents
   FROM (((public.app_developers ad
     JOIN public.apps a ON ((a.appid = ad.appid)))
     JOIN public.developers d ON ((d.id = ad.developer_id)))
     LEFT JOIN latest_metrics lm ON ((lm.appid = a.appid)))
  WHERE ((a.type = 'game'::public.app_type) AND (a.is_delisted = false) AND (a.release_date IS NOT NULL))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW developer_game_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.developer_game_metrics IS 'Per-game metrics for each developer. Uses PICS review_score as fallback.';


--
-- Name: developer_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.developer_metrics AS
 WITH latest_metrics AS (
         SELECT DISTINCT ON (dm.appid) dm.appid,
            dm.owners_min,
            dm.owners_max,
            dm.ccu_peak,
            dm.total_reviews,
            dm.positive_reviews,
            dm.negative_reviews,
            dm.review_score,
            dm.average_playtime_2weeks
           FROM public.daily_metrics dm
          ORDER BY dm.appid, dm.metric_date DESC
        ), weekly_ccu AS (
         SELECT daily_metrics.appid,
            sum(daily_metrics.ccu_peak) AS ccu_7d_sum
           FROM public.daily_metrics
          WHERE (daily_metrics.metric_date >= (CURRENT_DATE - '7 days'::interval))
          GROUP BY daily_metrics.appid
        ), developer_apps AS (
         SELECT ad.developer_id,
            a.appid,
            a.release_date,
            a.current_price_cents,
            lm.owners_min,
            lm.owners_max,
            lm.ccu_peak,
            lm.total_reviews,
            lm.positive_reviews,
            lm.negative_reviews,
            lm.review_score,
            lm.average_playtime_2weeks,
            wc.ccu_7d_sum,
            at.trend_30d_direction
           FROM ((((public.app_developers ad
             JOIN public.apps a ON ((a.appid = ad.appid)))
             LEFT JOIN latest_metrics lm ON ((lm.appid = a.appid)))
             LEFT JOIN weekly_ccu wc ON ((wc.appid = a.appid)))
             LEFT JOIN public.app_trends at ON ((at.appid = a.appid)))
          WHERE ((a.type = 'game'::public.app_type) AND (a.is_delisted = false))
        ), developer_genres AS (
         SELECT ad.developer_id,
            array_agg(DISTINCT ag.genre_id ORDER BY ag.genre_id) AS genre_ids
           FROM ((public.app_developers ad
             JOIN public.apps a ON (((a.appid = ad.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_genres ag ON ((ag.appid = ad.appid)))
          GROUP BY ad.developer_id
        ), developer_tags AS (
         SELECT ad.developer_id,
            array_agg(DISTINCT ast.tag_id ORDER BY ast.tag_id) AS tag_ids
           FROM ((public.app_developers ad
             JOIN public.apps a ON (((a.appid = ad.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_steam_tags ast ON ((ast.appid = ad.appid)))
          GROUP BY ad.developer_id
        ), developer_categories AS (
         SELECT ad.developer_id,
            array_agg(DISTINCT ac.category_id ORDER BY ac.category_id) AS category_ids
           FROM ((public.app_developers ad
             JOIN public.apps a ON (((a.appid = ad.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_categories ac ON ((ac.appid = ad.appid)))
          GROUP BY ad.developer_id
        ), developer_steam_deck AS (
         SELECT DISTINCT ON (ad.developer_id) ad.developer_id,
            asd.category AS best_steam_deck_category
           FROM ((public.app_developers ad
             JOIN public.apps a ON (((a.appid = ad.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             JOIN public.app_steam_deck asd ON ((asd.appid = ad.appid)))
          WHERE (asd.category = ANY (ARRAY['verified'::public.steam_deck_category, 'playable'::public.steam_deck_category]))
          ORDER BY ad.developer_id,
                CASE asd.category
                    WHEN 'verified'::public.steam_deck_category THEN 1
                    WHEN 'playable'::public.steam_deck_category THEN 2
                    ELSE NULL::integer
                END
        ), developer_platforms AS (
         SELECT ad.developer_id,
            array_agg(DISTINCT platform.platform ORDER BY platform.platform) FILTER (WHERE ((platform.platform IS NOT NULL) AND (platform.platform <> ''::text))) AS platform_array
           FROM ((public.app_developers ad
             JOIN public.apps a ON (((a.appid = ad.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             CROSS JOIN LATERAL unnest(string_to_array(a.platforms, ','::text)) platform(platform))
          WHERE ((a.platforms IS NOT NULL) AND (a.platforms <> ''::text))
          GROUP BY ad.developer_id
        ), developer_growth AS (
         SELECT ad.developer_id,
            avg(cs.player_count) FILTER (WHERE (cs.snapshot_time > (now() - '3 days'::interval))) AS current_3d_avg,
            avg(cs.player_count) FILTER (WHERE ((cs.snapshot_time > (now() - '6 days'::interval)) AND (cs.snapshot_time <= (now() - '3 days'::interval)))) AS prior_3d_avg,
            avg(cs.player_count) FILTER (WHERE (cs.snapshot_time > (now() - '7 days'::interval))) AS baseline_7d_avg
           FROM ((public.app_developers ad
             JOIN public.apps a ON (((a.appid = ad.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             LEFT JOIN public.ccu_snapshots cs ON (((cs.appid = ad.appid) AND (cs.snapshot_time > (now() - '7 days'::interval)))))
          GROUP BY ad.developer_id
        ), developer_velocity AS (
         SELECT ad.developer_id,
            (sum(rvs.velocity_7d))::numeric(10,4) AS review_velocity_7d,
            (sum(rvs.velocity_30d))::numeric(10,4) AS review_velocity_30d
           FROM ((public.app_developers ad
             JOIN public.apps a ON (((a.appid = ad.appid) AND (a.type = 'game'::public.app_type) AND (a.is_delisted = false))))
             LEFT JOIN public.review_velocity_stats rvs ON ((rvs.appid = ad.appid)))
          GROUP BY ad.developer_id
        )
 SELECT da.developer_id,
    d.name AS developer_name,
    d.game_count,
    COALESCE(((sum(da.owners_min) + sum(da.owners_max)) / 2), (0)::bigint) AS total_owners,
    COALESCE(sum(da.ccu_peak), (0)::bigint) AS total_ccu,
    (COALESCE(sum(((((COALESCE(da.ccu_7d_sum, (0)::bigint) * COALESCE(da.average_playtime_2weeks, 0)))::numeric / 2.0) / 60.0)), (0)::numeric))::bigint AS estimated_weekly_hours,
    COALESCE(sum(da.total_reviews), (0)::bigint) AS total_reviews,
    COALESCE(sum(da.positive_reviews), (0)::bigint) AS positive_reviews,
        CASE
            WHEN (sum(da.total_reviews) > 0) THEN (round((((sum(da.positive_reviews))::numeric / (sum(da.total_reviews))::numeric) * (100)::numeric)))::smallint
            ELSE NULL::smallint
        END AS avg_review_score,
    (COALESCE(sum(((((COALESCE(da.owners_min, 0) + COALESCE(da.owners_max, 0)))::numeric / 2.0) * (COALESCE(da.current_price_cents, 0))::numeric)), (0)::numeric))::bigint AS revenue_estimate_cents,
    (count(*) FILTER (WHERE (da.trend_30d_direction = 'up'::public.trend_direction)) > 0) AS is_trending,
    (count(*) FILTER (WHERE (da.trend_30d_direction = 'up'::public.trend_direction)))::integer AS games_trending_up,
    (count(*) FILTER (WHERE (da.trend_30d_direction = 'down'::public.trend_direction)))::integer AS games_trending_down,
    (count(*) FILTER (WHERE (da.trend_30d_direction = 'stable'::public.trend_direction)))::integer AS games_trending_stable,
    (count(*) FILTER (WHERE (da.release_date >= (CURRENT_DATE - '1 year'::interval))))::integer AS games_released_last_year,
    dg.genre_ids,
    dt.tag_ids,
    dc.category_ids,
    dsd.best_steam_deck_category,
    dp.platform_array,
        CASE
            WHEN (dgr.prior_3d_avg > (0)::numeric) THEN round((((dgr.current_3d_avg - dgr.prior_3d_avg) / dgr.prior_3d_avg) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS ccu_growth_7d_percent,
        CASE
            WHEN (dgr.baseline_7d_avg > (0)::numeric) THEN round((((dgr.current_3d_avg - dgr.baseline_7d_avg) / dgr.baseline_7d_avg) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS ccu_growth_30d_percent,
    COALESCE(dv.review_velocity_7d, (0)::numeric) AS review_velocity_7d,
    COALESCE(dv.review_velocity_30d, (0)::numeric) AS review_velocity_30d,
    now() AS computed_at
   FROM ((((((((developer_apps da
     JOIN public.developers d ON ((d.id = da.developer_id)))
     LEFT JOIN developer_genres dg ON ((dg.developer_id = da.developer_id)))
     LEFT JOIN developer_tags dt ON ((dt.developer_id = da.developer_id)))
     LEFT JOIN developer_categories dc ON ((dc.developer_id = da.developer_id)))
     LEFT JOIN developer_steam_deck dsd ON ((dsd.developer_id = da.developer_id)))
     LEFT JOIN developer_platforms dp ON ((dp.developer_id = da.developer_id)))
     LEFT JOIN developer_growth dgr ON ((dgr.developer_id = da.developer_id)))
     LEFT JOIN developer_velocity dv ON ((dv.developer_id = da.developer_id)))
  GROUP BY da.developer_id, d.name, d.game_count, dg.genre_ids, dt.tag_ids, dc.category_ids, dsd.best_steam_deck_category, dp.platform_array, dgr.current_3d_avg, dgr.prior_3d_avg, dgr.baseline_7d_avg, dv.review_velocity_7d, dv.review_velocity_30d
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW developer_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.developer_metrics IS 'Pre-computed developer metrics with 3-day growth windows and review velocity. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY developer_metrics';


--
-- Name: developer_year_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.developer_year_metrics AS
 WITH latest_metrics AS (
         SELECT DISTINCT ON (dm.appid) dm.appid,
            dm.owners_min,
            dm.owners_max,
            dm.ccu_peak,
            dm.total_reviews,
            dm.positive_reviews,
            dm.review_score
           FROM public.daily_metrics dm
          ORDER BY dm.appid, dm.metric_date DESC
        ), developer_apps AS (
         SELECT ad.developer_id,
            a.release_date,
            (EXTRACT(year FROM a.release_date))::integer AS release_year,
            a.appid,
            a.current_price_cents,
            lm.owners_min,
            lm.owners_max,
            lm.ccu_peak,
            lm.total_reviews,
            lm.positive_reviews,
            lm.review_score
           FROM ((public.app_developers ad
             JOIN public.apps a ON ((a.appid = ad.appid)))
             LEFT JOIN latest_metrics lm ON ((lm.appid = a.appid)))
          WHERE ((a.type = 'game'::public.app_type) AND (a.is_delisted = false) AND (a.release_date IS NOT NULL))
        )
 SELECT da.developer_id,
    d.name AS developer_name,
    da.release_year,
    min(da.release_date) AS earliest_release,
    max(da.release_date) AS latest_release,
    (count(DISTINCT da.appid))::integer AS game_count,
    COALESCE(((sum(da.owners_min) + sum(da.owners_max)) / 2), (0)::bigint) AS total_owners,
    COALESCE(sum(da.ccu_peak), (0)::bigint) AS total_ccu,
    COALESCE(sum(da.total_reviews), (0)::bigint) AS total_reviews,
        CASE
            WHEN (sum(da.total_reviews) > 0) THEN (round((((sum(da.positive_reviews))::numeric / (sum(da.total_reviews))::numeric) * (100)::numeric)))::smallint
            ELSE NULL::smallint
        END AS avg_review_score,
    (COALESCE(sum(((((COALESCE(da.owners_min, 0) + COALESCE(da.owners_max, 0)))::numeric / 2.0) * (COALESCE(da.current_price_cents, 0))::numeric)), (0)::numeric))::bigint AS revenue_estimate_cents
   FROM (developer_apps da
     JOIN public.developers d ON ((d.id = da.developer_id)))
  GROUP BY da.developer_id, d.name, da.release_year
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW developer_year_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.developer_year_metrics IS 'Pre-computed developer metrics grouped by release year. Enables year-filtered queries. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY developer_year_metrics';


--
-- Name: developers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.developers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: developers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.developers_id_seq OWNED BY public.developers.id;


--
-- Name: franchises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.franchises (
    id integer NOT NULL,
    name text NOT NULL,
    normalized_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE franchises; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.franchises IS 'Game franchises/series from PICS associations';


--
-- Name: franchises_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.franchises_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: franchises_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.franchises_id_seq OWNED BY public.franchises.id;


--
-- Name: latest_ccu_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.latest_ccu_status AS
 SELECT a.appid,
        CASE
            WHEN (ct.last_ccu_validation_state = 'confirmed_positive'::text) THEN 'confirmed_positive'::text
            WHEN (ct.last_ccu_validation_state = 'confirmed_zero'::text) THEN 'confirmed_zero'::text
            WHEN (ct.last_ccu_validation_state = 'suspect_zero'::text) THEN 'suspect_zero'::text
            WHEN ((ct.ccu_fetch_status = 'invalid'::text) AND (ct.ccu_skip_until > now())) THEN 'skipped'::text
            WHEN (ct.ccu_fetch_status = 'invalid'::text) THEN 'invalid'::text
            ELSE 'unavailable'::text
        END AS ccu_confidence_state,
    ldm.ccu_source,
    ct.last_ccu_validation_state,
    ct.last_ccu_validation_at,
    ct.ccu_fetch_status,
    ct.ccu_skip_until,
    ct.last_ccu_synced,
    (ct.appid IS NOT NULL) AS has_tier_assignment
   FROM ((public.apps a
     LEFT JOIN public.ccu_tier_assignments ct ON ((ct.appid = a.appid)))
     LEFT JOIN public.latest_daily_metrics ldm ON ((ldm.appid = a.appid)));


--
-- Name: VIEW latest_ccu_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.latest_ccu_status IS 'Resolved latest/current CCU confidence state for each app, combining official validation outcome, fetch status, skip state, and CCU provenance.';


--
-- Name: monthly_game_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.monthly_game_metrics AS
 WITH monthly_data AS (
         SELECT daily_metrics.appid,
            (date_trunc('month'::text, (daily_metrics.metric_date)::timestamp with time zone))::date AS month,
            sum(daily_metrics.ccu_peak) AS monthly_ccu_sum,
            avg(daily_metrics.average_playtime_2weeks) AS avg_playtime_2weeks
           FROM public.daily_metrics
          WHERE (daily_metrics.metric_date >= '2024-01-01'::date)
          GROUP BY daily_metrics.appid, (date_trunc('month'::text, (daily_metrics.metric_date)::timestamp with time zone))
        )
 SELECT md.appid,
    md.month,
    (EXTRACT(year FROM md.month))::integer AS year,
    (EXTRACT(month FROM md.month))::integer AS month_num,
    md.monthly_ccu_sum,
    (COALESCE(round(((((md.monthly_ccu_sum)::numeric * COALESCE(md.avg_playtime_2weeks, (0)::numeric)) / 2.0) / 60.0)), (0)::numeric))::bigint AS estimated_monthly_hours,
    a.name AS game_name
   FROM (monthly_data md
     JOIN public.apps a ON ((a.appid = md.appid)))
  WHERE ((a.type = 'game'::public.app_type) AND (a.is_delisted = false))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW monthly_game_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.monthly_game_metrics IS 'Pre-computed monthly metrics per game including estimated_monthly_hours (ESTIMATE based on monthly CCU × avg playtime). Refresh with refresh_monthly_game_metrics()';


--
-- Name: mv_apps_aggregate_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_apps_aggregate_stats AS
 WITH base_data AS (
         SELECT (a.type)::text AS app_type,
            COALESCE(ldm.ccu_peak, 0) AS ccu_peak,
            ldm.review_score,
            ct.ccu_growth_7d_percent,
            (COALESCE(rvs.velocity_7d, (0)::numeric) - COALESCE(rvs.velocity_30d, (0)::numeric)) AS velocity_acceleration,
            atr.current_positive_ratio,
            atr.previous_positive_ratio,
            a.is_free,
            ldm.price_cents,
            ldm.average_playtime_forever
           FROM ((((public.apps a
             LEFT JOIN public.latest_daily_metrics ldm ON ((ldm.appid = a.appid)))
             LEFT JOIN public.ccu_tier_assignments ct ON ((ct.appid = a.appid)))
             LEFT JOIN public.review_velocity_stats rvs ON ((rvs.appid = a.appid)))
             LEFT JOIN public.app_trends atr ON ((atr.appid = a.appid)))
          WHERE ((a.is_released = true) AND (a.is_delisted = false))
        ), computed AS (
         SELECT bd.app_type,
            bd.ccu_peak,
            bd.review_score,
            bd.ccu_growth_7d_percent,
            bd.velocity_acceleration,
            bd.current_positive_ratio,
            bd.previous_positive_ratio,
            bd.is_free,
            bd.price_cents,
            bd.average_playtime_forever,
                CASE
                    WHEN (bd.ccu_growth_7d_percent IS NOT NULL) THEN ((bd.ccu_growth_7d_percent + COALESCE(bd.velocity_acceleration, (0)::numeric)) / (2)::numeric)
                    ELSE NULL::numeric
                END AS momentum_score,
                CASE
                    WHEN ((bd.current_positive_ratio IS NOT NULL) AND (bd.previous_positive_ratio IS NOT NULL)) THEN ((bd.current_positive_ratio - bd.previous_positive_ratio) * (100)::numeric)
                    ELSE NULL::numeric
                END AS sentiment_delta,
                CASE
                    WHEN (bd.is_free OR (bd.price_cents IS NULL) OR (bd.price_cents = 0)) THEN NULL::numeric
                    WHEN ((bd.average_playtime_forever IS NULL) OR (bd.average_playtime_forever = 0)) THEN NULL::numeric
                    ELSE (((bd.average_playtime_forever)::numeric / (60)::numeric) / ((bd.price_cents)::numeric / (100)::numeric))
                END AS value_score
           FROM base_data bd
        )
 SELECT app_type,
    count(*) AS total_games,
    round(avg(ccu_peak), 0) AS avg_ccu,
    round(avg(review_score), 1) AS avg_score,
    round(avg(momentum_score), 2) AS avg_momentum,
    (count(*) FILTER (WHERE (ccu_growth_7d_percent >= (10)::numeric)))::integer AS trending_up_count,
    (count(*) FILTER (WHERE (ccu_growth_7d_percent <= ('-10'::integer)::numeric)))::integer AS trending_down_count,
    (count(*) FILTER (WHERE (sentiment_delta >= (3)::numeric)))::integer AS sentiment_improving_count,
    (count(*) FILTER (WHERE (sentiment_delta <= ('-3'::integer)::numeric)))::integer AS sentiment_declining_count,
    round(avg(value_score), 2) AS avg_value_score
   FROM computed c
  GROUP BY app_type
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_apps_aggregate_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_apps_aggregate_stats IS 'Pre-computed aggregate statistics by app type. Refresh with refresh_filter_count_views()';


--
-- Name: steam_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_categories (
    category_id integer NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE steam_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.steam_categories IS 'Reference table for Steam feature categories';


--
-- Name: mv_category_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_category_counts AS
 SELECT (a.type)::text AS app_type,
    ac.category_id,
    sc.name AS category_name,
    count(*) AS app_count
   FROM ((public.app_categories ac
     JOIN public.steam_categories sc ON ((sc.category_id = ac.category_id)))
     JOIN public.apps a ON ((a.appid = ac.appid)))
  WHERE ((a.is_released = true) AND (a.is_delisted = false))
  GROUP BY a.type, ac.category_id, sc.name
  WITH NO DATA;


--
-- Name: mv_ccu_tier_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_ccu_tier_counts AS
 SELECT (a.type)::text AS app_type,
    ct.ccu_tier,
    count(*) AS app_count
   FROM (public.ccu_tier_assignments ct
     JOIN public.apps a ON ((a.appid = ct.appid)))
  WHERE ((a.is_released = true) AND (a.is_delisted = false))
  GROUP BY a.type, ct.ccu_tier
  WITH NO DATA;


--
-- Name: steam_genres; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_genres (
    genre_id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE steam_genres; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.steam_genres IS 'Reference table for Steam genre IDs';


--
-- Name: mv_genre_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_genre_counts AS
 SELECT (a.type)::text AS app_type,
    ag.genre_id,
    sg.name AS genre_name,
    count(*) AS app_count
   FROM ((public.app_genres ag
     JOIN public.steam_genres sg ON ((sg.genre_id = ag.genre_id)))
     JOIN public.apps a ON ((a.appid = ag.appid)))
  WHERE ((a.is_released = true) AND (a.is_delisted = false))
  GROUP BY a.type, ag.genre_id, sg.name
  WITH NO DATA;


--
-- Name: mv_steam_deck_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_steam_deck_counts AS
 SELECT (a.type)::text AS app_type,
    (asd.category)::text AS steam_deck_category,
    count(*) AS app_count
   FROM (public.app_steam_deck asd
     JOIN public.apps a ON ((a.appid = asd.appid)))
  WHERE ((a.is_released = true) AND (a.is_delisted = false) AND (asd.category IS NOT NULL))
  GROUP BY a.type, asd.category
  WITH NO DATA;


--
-- Name: steam_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_tags (
    tag_id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE steam_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.steam_tags IS 'Reference table mapping Steam tag IDs to names';


--
-- Name: mv_tag_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_tag_counts AS
 SELECT (a.type)::text AS app_type,
    ast.tag_id,
    st.name AS tag_name,
    count(*) AS app_count
   FROM ((public.app_steam_tags ast
     JOIN public.steam_tags st ON ((st.tag_id = ast.tag_id)))
     JOIN public.apps a ON ((a.appid = ast.appid)))
  WHERE ((a.is_released = true) AND (a.is_delisted = false))
  GROUP BY a.type, ast.tag_id, st.name
  WITH NO DATA;


--
-- Name: mv_velocity_tier_counts; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_velocity_tier_counts AS
 SELECT (a.type)::text AS app_type,
    rvs.velocity_tier,
    count(*) AS app_count
   FROM (public.review_velocity_stats rvs
     JOIN public.apps a ON ((a.appid = rvs.appid)))
  WHERE ((a.is_released = true) AND (a.is_delisted = false) AND (rvs.velocity_tier IS NOT NULL))
  GROUP BY a.type, rvs.velocity_tier
  WITH NO DATA;


--
-- Name: pics_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pics_sync_state (
    id integer DEFAULT 1 NOT NULL,
    last_change_number bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT single_row CHECK ((id = 1))
);


--
-- Name: TABLE pics_sync_state; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pics_sync_state IS 'Global PICS sync state tracking change numbers';


--
-- Name: publisher_game_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.publisher_game_metrics AS
 WITH latest_metrics AS (
         SELECT DISTINCT ON (dm.appid) dm.appid,
            dm.owners_min,
            dm.owners_max,
            dm.ccu_peak,
            dm.total_reviews,
            dm.positive_reviews,
            dm.review_score
           FROM public.daily_metrics dm
          ORDER BY dm.appid, dm.metric_date DESC
        )
 SELECT ap.publisher_id,
    p.name AS publisher_name,
    a.appid,
    a.name AS game_name,
    a.release_date,
    (EXTRACT(year FROM a.release_date))::integer AS release_year,
    a.current_price_cents,
    (COALESCE(((lm.owners_min + lm.owners_max) / 2), 0))::bigint AS owners,
    COALESCE(lm.ccu_peak, 0) AS ccu,
    COALESCE(lm.total_reviews, 0) AS total_reviews,
    COALESCE(lm.positive_reviews, 0) AS positive_reviews,
    COALESCE(lm.review_score, a.pics_review_score) AS review_score,
    (COALESCE(((((COALESCE(lm.owners_min, 0) + COALESCE(lm.owners_max, 0)))::numeric / 2.0) * (COALESCE(a.current_price_cents, 0))::numeric), (0)::numeric))::bigint AS revenue_estimate_cents
   FROM (((public.app_publishers ap
     JOIN public.apps a ON ((a.appid = ap.appid)))
     JOIN public.publishers p ON ((p.id = ap.publisher_id)))
     LEFT JOIN latest_metrics lm ON ((lm.appid = a.appid)))
  WHERE ((a.type = 'game'::public.app_type) AND (a.is_delisted = false) AND (a.release_date IS NOT NULL))
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW publisher_game_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.publisher_game_metrics IS 'Per-game metrics for each publisher. Uses PICS review_score as fallback.';


--
-- Name: publisher_year_metrics; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.publisher_year_metrics AS
 WITH latest_metrics AS (
         SELECT DISTINCT ON (dm.appid) dm.appid,
            dm.owners_min,
            dm.owners_max,
            dm.ccu_peak,
            dm.total_reviews,
            dm.positive_reviews,
            dm.review_score
           FROM public.daily_metrics dm
          ORDER BY dm.appid, dm.metric_date DESC
        ), publisher_apps AS (
         SELECT ap.publisher_id,
            a.release_date,
            (EXTRACT(year FROM a.release_date))::integer AS release_year,
            a.appid,
            a.current_price_cents,
            lm.owners_min,
            lm.owners_max,
            lm.ccu_peak,
            lm.total_reviews,
            lm.positive_reviews,
            lm.review_score
           FROM ((public.app_publishers ap
             JOIN public.apps a ON ((a.appid = ap.appid)))
             LEFT JOIN latest_metrics lm ON ((lm.appid = a.appid)))
          WHERE ((a.type = 'game'::public.app_type) AND (a.is_delisted = false) AND (a.release_date IS NOT NULL))
        )
 SELECT pa.publisher_id,
    p.name AS publisher_name,
    pa.release_year,
    min(pa.release_date) AS earliest_release,
    max(pa.release_date) AS latest_release,
    (count(DISTINCT pa.appid))::integer AS game_count,
    COALESCE(((sum(pa.owners_min) + sum(pa.owners_max)) / 2), (0)::bigint) AS total_owners,
    COALESCE(sum(pa.ccu_peak), (0)::bigint) AS total_ccu,
    COALESCE(sum(pa.total_reviews), (0)::bigint) AS total_reviews,
        CASE
            WHEN (sum(pa.total_reviews) > 0) THEN (round((((sum(pa.positive_reviews))::numeric / (sum(pa.total_reviews))::numeric) * (100)::numeric)))::smallint
            ELSE NULL::smallint
        END AS avg_review_score,
    (COALESCE(sum(((((COALESCE(pa.owners_min, 0) + COALESCE(pa.owners_max, 0)))::numeric / 2.0) * (COALESCE(pa.current_price_cents, 0))::numeric)), (0)::numeric))::bigint AS revenue_estimate_cents
   FROM (publisher_apps pa
     JOIN public.publishers p ON ((p.id = pa.publisher_id)))
  GROUP BY pa.publisher_id, p.name, pa.release_year
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW publisher_year_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.publisher_year_metrics IS 'Pre-computed publisher metrics grouped by release year. Enables year-filtered queries. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY publisher_year_metrics';


--
-- Name: publishers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.publishers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: publishers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.publishers_id_seq OWNED BY public.publishers.id;


--
-- Name: rate_limit_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_state (
    user_id uuid NOT NULL,
    requests_this_minute integer DEFAULT 0 NOT NULL,
    requests_this_hour integer DEFAULT 0 NOT NULL,
    minute_window_start timestamp with time zone DEFAULT now() NOT NULL,
    hour_window_start timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: review_deltas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.review_deltas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_deltas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.review_deltas_id_seq OWNED BY public.review_deltas.id;


--
-- Name: review_histogram; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_histogram (
    id bigint NOT NULL,
    appid integer NOT NULL,
    month_start date NOT NULL,
    recommendations_up integer NOT NULL,
    recommendations_down integer NOT NULL,
    fetched_at timestamp with time zone DEFAULT now()
);


--
-- Name: review_histogram_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.review_histogram_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: review_histogram_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.review_histogram_id_seq OWNED BY public.review_histogram.id;


--
-- Name: steam_news_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_news_items (
    gid text NOT NULL,
    appid integer NOT NULL,
    url text NOT NULL,
    author text,
    feedlabel text,
    feedname text,
    published_at timestamp with time zone,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE steam_news_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.steam_news_items IS 'Stable Steam news item records keyed by gid.';


--
-- Name: steam_news_search_projection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_news_search_projection (
    gid text NOT NULL,
    appid integer NOT NULL,
    published_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    sort_time timestamp with time zone NOT NULL,
    feed_scope text NOT NULL,
    title text,
    search_document tsvector NOT NULL
);


--
-- Name: TABLE steam_news_search_projection; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.steam_news_search_projection IS 'Lean recent-news topic-search projection. Stores only the fields needed for filtering and ranking; body text is loaded from source tables only for shortlisted gids.';


--
-- Name: steam_news_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.steam_news_versions (
    id bigint NOT NULL,
    gid text NOT NULL,
    content_hash text NOT NULL,
    title text,
    contents text,
    url text NOT NULL,
    previous_version_id bigint,
    normalized_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE steam_news_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.steam_news_versions IS 'Version history for Steam news items when normalized content changes.';


--
-- Name: steam_news_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.steam_news_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: steam_news_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.steam_news_versions_id_seq OWNED BY public.steam_news_versions.id;


--
-- Name: sync_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_type text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    status text DEFAULT 'running'::text,
    items_processed integer DEFAULT 0,
    items_succeeded integer DEFAULT 0,
    items_failed integer DEFAULT 0,
    batch_size integer,
    error_message text,
    github_run_id text,
    created_at timestamp with time zone DEFAULT now(),
    items_created integer DEFAULT 0,
    items_updated integer DEFAULT 0,
    items_skipped integer DEFAULT 0
);


--
-- Name: COLUMN sync_jobs.items_created; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_jobs.items_created IS 'Number of new records created during this job';


--
-- Name: COLUMN sync_jobs.items_updated; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_jobs.items_updated IS 'Number of existing records updated during this job';


--
-- Name: COLUMN sync_jobs.items_skipped; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_jobs.items_skipped IS 'Number of items skipped (no data available from API)';


--
-- Name: sync_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_status (
    appid integer NOT NULL,
    last_steamspy_sync timestamp with time zone,
    last_storefront_sync timestamp with time zone,
    last_reviews_sync timestamp with time zone,
    last_histogram_sync timestamp with time zone,
    priority_score integer DEFAULT 0,
    priority_calculated_at timestamp with time zone,
    next_sync_after timestamp with time zone DEFAULT now(),
    sync_interval_hours integer DEFAULT 24,
    consecutive_errors integer DEFAULT 0,
    last_error_source public.sync_source,
    last_error_message text,
    last_error_at timestamp with time zone,
    is_syncable boolean DEFAULT true,
    refresh_tier public.refresh_tier DEFAULT 'moderate'::public.refresh_tier,
    last_activity_at timestamp with time zone,
    last_pics_sync timestamp with time zone,
    pics_change_number bigint,
    storefront_accessible boolean DEFAULT true,
    steamspy_available boolean,
    last_embedding_sync timestamp with time zone,
    embedding_hash text,
    last_price_sync timestamp with time zone,
    next_reviews_sync timestamp with time zone DEFAULT now(),
    reviews_interval_hours integer DEFAULT 24,
    review_velocity_tier text DEFAULT 'unknown'::text,
    last_known_total_reviews integer,
    velocity_7d numeric(8,4) DEFAULT 0,
    velocity_calculated_at timestamp with time zone,
    last_steamspy_individual_fetch timestamp with time zone,
    steam_last_modified bigint,
    steam_price_change_number bigint,
    last_news_sync timestamp with time zone,
    last_media_sync timestamp with time zone,
    reviews_claimed_by text,
    reviews_claimed_at timestamp with time zone,
    reviews_claim_expires_at timestamp with time zone,
    reviews_priority_override_bucket text,
    reviews_priority_override_score integer,
    reviews_priority_override_reason text,
    reviews_priority_override_until timestamp with time zone,
    CONSTRAINT chk_review_velocity_tier CHECK ((review_velocity_tier = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'dormant'::text, 'unknown'::text]))),
    CONSTRAINT chk_reviews_priority_override_bucket CHECK (((reviews_priority_override_bucket IS NULL) OR (reviews_priority_override_bucket = ANY (ARRAY['launch_critical'::text, 'change_critical'::text, 'active_reviews'::text, 'important_backfill'::text, 'unknown_sweep'::text]))))
);


--
-- Name: COLUMN sync_status.refresh_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.refresh_tier IS 'Sync frequency tier: active (6-12hr), moderate (24-48hr), dormant (weekly), dead (monthly+)';


--
-- Name: COLUMN sync_status.last_activity_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_activity_at IS 'Last time app showed activity (new reviews, CCU changes). Used for dormancy detection.';


--
-- Name: COLUMN sync_status.last_pics_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_pics_sync IS 'Last successful PICS data sync';


--
-- Name: COLUMN sync_status.pics_change_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.pics_change_number IS 'Last processed PICS change number for incremental updates';


--
-- Name: COLUMN sync_status.last_embedding_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_embedding_sync IS 'Timestamp of last successful embedding sync to Qdrant';


--
-- Name: COLUMN sync_status.embedding_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.embedding_hash IS 'Hash of embedding source text to detect changes';


--
-- Name: COLUMN sync_status.next_reviews_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.next_reviews_sync IS 'Next scheduled time for reviews sync (velocity-based)';


--
-- Name: COLUMN sync_status.reviews_interval_hours; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_interval_hours IS 'Current sync interval: 4 (high), 12 (medium), 24 (low), 72 (dormant)';


--
-- Name: COLUMN sync_status.review_velocity_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.review_velocity_tier IS 'Velocity tier: high (>=5/day), medium (1-5), low (0.1-1), dormant (<0.1)';


--
-- Name: COLUMN sync_status.last_known_total_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_known_total_reviews IS 'Cached total_reviews for delta calculation';


--
-- Name: COLUMN sync_status.velocity_7d; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.velocity_7d IS '7-day average reviews per day';


--
-- Name: COLUMN sync_status.last_steamspy_individual_fetch; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_steamspy_individual_fetch IS 'When we last attempted individual SteamSpy fetch via appdetails endpoint';


--
-- Name: COLUMN sync_status.steam_last_modified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.steam_last_modified IS 'Latest IStoreService/GetAppList.last_modified hint observed for this app.';


--
-- Name: COLUMN sync_status.steam_price_change_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.steam_price_change_number IS 'Latest IStoreService/GetAppList.price_change_number hint observed for this app.';


--
-- Name: COLUMN sync_status.last_news_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_news_sync IS 'Last successful Steam News capture for this app.';


--
-- Name: COLUMN sync_status.last_media_sync; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.last_media_sync IS 'Last successful storefront media extraction for this app.';


--
-- Name: COLUMN sync_status.reviews_claimed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_claimed_by IS 'Worker id currently holding the reviews-sync lease.';


--
-- Name: COLUMN sync_status.reviews_claimed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_claimed_at IS 'When the current reviews-sync lease was acquired.';


--
-- Name: COLUMN sync_status.reviews_claim_expires_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_claim_expires_at IS 'Lease expiry for the current reviews-sync claim.';


--
-- Name: COLUMN sync_status.reviews_priority_override_bucket; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_priority_override_bucket IS 'Short-lived override lane for review scheduling: launch_critical, change_critical, active_reviews, important_backfill, unknown_sweep.';


--
-- Name: COLUMN sync_status.reviews_priority_override_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_priority_override_score IS 'Relative urgency score for the active review scheduling override.';


--
-- Name: COLUMN sync_status.reviews_priority_override_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_priority_override_reason IS 'Reason string describing why an app was promoted for review sync.';


--
-- Name: COLUMN sync_status.reviews_priority_override_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sync_status.reviews_priority_override_until IS 'Expiry timestamp for the current review scheduling override.';


--
-- Name: user_alert_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_alert_preferences (
    user_id uuid NOT NULL,
    alerts_enabled boolean DEFAULT true NOT NULL,
    email_digest_enabled boolean DEFAULT false NOT NULL,
    email_digest_frequency text DEFAULT 'daily'::text,
    ccu_sensitivity numeric(3,2) DEFAULT 1.0 NOT NULL,
    review_sensitivity numeric(3,2) DEFAULT 1.0 NOT NULL,
    sentiment_sensitivity numeric(3,2) DEFAULT 1.0 NOT NULL,
    alert_ccu_spike boolean DEFAULT true NOT NULL,
    alert_ccu_drop boolean DEFAULT true NOT NULL,
    alert_trend_reversal boolean DEFAULT true NOT NULL,
    alert_review_surge boolean DEFAULT true NOT NULL,
    alert_sentiment_shift boolean DEFAULT true NOT NULL,
    alert_price_change boolean DEFAULT true NOT NULL,
    alert_new_release boolean DEFAULT true NOT NULL,
    alert_milestone boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_alert_preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_alert_preferences IS 'User settings for alert sensitivity and delivery preferences';


--
-- Name: COLUMN user_alert_preferences.ccu_sensitivity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_alert_preferences.ccu_sensitivity IS 'Multiplier for CCU thresholds: 0.5=half, 1.0=default, 2.0=double';


--
-- Name: user_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    pin_id uuid NOT NULL,
    alert_type public.alert_type NOT NULL,
    severity public.alert_severity DEFAULT 'medium'::public.alert_severity NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    metric_name text,
    previous_value numeric,
    current_value numeric,
    change_percent numeric,
    dedup_key text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_data jsonb
);


--
-- Name: TABLE user_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_alerts IS 'System-generated alerts for pinned entities. Dedup_key prevents duplicate alerts per day.';


--
-- Name: COLUMN user_alerts.dedup_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_alerts.dedup_key IS 'Format: {user_id}:{entity_type}:{entity_id}:{alert_type}:{date}';


--
-- Name: COLUMN user_alerts.source_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_alerts.source_data IS 'Debug info: raw values at time of alert creation';


--
-- Name: user_pin_alert_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_pin_alert_settings (
    pin_id uuid NOT NULL,
    use_custom_settings boolean DEFAULT true NOT NULL,
    alerts_enabled boolean DEFAULT true NOT NULL,
    ccu_sensitivity numeric(3,2),
    review_sensitivity numeric(3,2),
    sentiment_sensitivity numeric(3,2),
    alert_ccu_spike boolean,
    alert_ccu_drop boolean,
    alert_trend_reversal boolean,
    alert_review_surge boolean,
    alert_sentiment_shift boolean,
    alert_price_change boolean,
    alert_new_release boolean,
    alert_milestone boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_pin_alert_settings_ccu_sensitivity_check CHECK (((ccu_sensitivity IS NULL) OR ((ccu_sensitivity >= 0.5) AND (ccu_sensitivity <= 2.0)))),
    CONSTRAINT user_pin_alert_settings_review_sensitivity_check CHECK (((review_sensitivity IS NULL) OR ((review_sensitivity >= 0.5) AND (review_sensitivity <= 2.0)))),
    CONSTRAINT user_pin_alert_settings_sentiment_sensitivity_check CHECK (((sentiment_sensitivity IS NULL) OR ((sentiment_sensitivity >= 0.5) AND (sentiment_sensitivity <= 2.0))))
);


--
-- Name: TABLE user_pin_alert_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_pin_alert_settings IS 'Per-pin alert overrides. NULL values inherit from user_alert_preferences.';


--
-- Name: COLUMN user_pin_alert_settings.use_custom_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_pin_alert_settings.use_custom_settings IS 'When FALSE, all overrides ignored and global settings apply';


--
-- Name: COLUMN user_pin_alert_settings.alerts_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_pin_alert_settings.alerts_enabled IS 'Per-pin master toggle - can disable alerts for just this entity';


--
-- Name: user_pins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_pins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    entity_type public.entity_type NOT NULL,
    entity_id integer NOT NULL,
    display_name text NOT NULL,
    pin_order integer DEFAULT 0,
    pinned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_pins; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_pins IS 'User-pinned entities (games, publishers, developers) for personalized dashboard';


--
-- Name: COLUMN user_pins.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_pins.display_name IS 'Cached entity name for quick display without joins';


--
-- Name: COLUMN user_pins.pin_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_pins.pin_order IS 'User-defined ordering for drag-and-drop reordering';


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    organization text,
    role public.user_role DEFAULT 'user'::public.user_role NOT NULL,
    credit_balance integer DEFAULT 0 NOT NULL,
    total_credits_used integer DEFAULT 0 NOT NULL,
    total_messages_sent integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_profiles_credit_balance_check CHECK ((credit_balance >= 0))
);


--
-- Name: waitlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    organization text,
    how_i_plan_to_use text,
    status public.waitlist_status DEFAULT 'pending'::public.waitlist_status NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    invite_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    initial_credits integer DEFAULT 1000 NOT NULL
);


--
-- Name: COLUMN waitlist.initial_credits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.waitlist.initial_credits IS 'Credits to grant on signup, set by admin during approval';


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
)
PARTITION BY RANGE (inserted_at);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: supabase_migrations; Owner: -
--

CREATE TABLE supabase_migrations.schema_migrations (
    version text NOT NULL,
    statements text[],
    name text
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: alert_detection_state id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_detection_state ALTER COLUMN id SET DEFAULT nextval('public.alert_detection_state_id_seq'::regclass);


--
-- Name: app_capture_queue id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_capture_queue ALTER COLUMN id SET DEFAULT nextval('public.app_capture_queue_id_seq'::regclass);


--
-- Name: app_capture_work_state id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_capture_work_state ALTER COLUMN id SET DEFAULT nextval('public.app_capture_work_state_id_seq'::regclass);


--
-- Name: app_change_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_change_events ALTER COLUMN id SET DEFAULT nextval('public.app_change_events_id_seq'::regclass);


--
-- Name: app_media_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_media_versions ALTER COLUMN id SET DEFAULT nextval('public.app_media_versions_id_seq'::regclass);


--
-- Name: app_source_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_source_snapshots ALTER COLUMN id SET DEFAULT nextval('public.app_source_snapshots_id_seq'::regclass);


--
-- Name: ccu_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ccu_snapshots ALTER COLUMN id SET DEFAULT nextval('public.ccu_snapshots_id_seq'::regclass);


--
-- Name: daily_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics ALTER COLUMN id SET DEFAULT nextval('public.daily_metrics_id_seq'::regclass);


--
-- Name: developers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developers ALTER COLUMN id SET DEFAULT nextval('public.developers_id_seq'::regclass);


--
-- Name: franchises id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.franchises ALTER COLUMN id SET DEFAULT nextval('public.franchises_id_seq'::regclass);


--
-- Name: publishers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publishers ALTER COLUMN id SET DEFAULT nextval('public.publishers_id_seq'::regclass);


--
-- Name: review_deltas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_deltas ALTER COLUMN id SET DEFAULT nextval('public.review_deltas_id_seq'::regclass);


--
-- Name: review_histogram id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_histogram ALTER COLUMN id SET DEFAULT nextval('public.review_histogram_id_seq'::regclass);


--
-- Name: steam_news_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_versions ALTER COLUMN id SET DEFAULT nextval('public.steam_news_versions_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: alert_detection_state alert_detection_state_entity_type_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_detection_state
    ADD CONSTRAINT alert_detection_state_entity_type_entity_id_key UNIQUE (entity_type, entity_id);


--
-- Name: alert_detection_state alert_detection_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_detection_state
    ADD CONSTRAINT alert_detection_state_pkey PRIMARY KEY (id);


--
-- Name: api_rate_limit_state api_rate_limit_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_rate_limit_state
    ADD CONSTRAINT api_rate_limit_state_pkey PRIMARY KEY (source);


--
-- Name: app_capture_queue app_capture_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_capture_queue
    ADD CONSTRAINT app_capture_queue_pkey PRIMARY KEY (id);


--
-- Name: app_capture_work_state app_capture_work_state_appid_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_capture_work_state
    ADD CONSTRAINT app_capture_work_state_appid_source_key UNIQUE (appid, source);


--
-- Name: app_capture_work_state app_capture_work_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_capture_work_state
    ADD CONSTRAINT app_capture_work_state_pkey PRIMARY KEY (id);


--
-- Name: app_categories app_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_categories
    ADD CONSTRAINT app_categories_pkey PRIMARY KEY (appid, category_id);


--
-- Name: app_change_events app_change_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_change_events
    ADD CONSTRAINT app_change_events_pkey PRIMARY KEY (id);


--
-- Name: app_developers app_developers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_developers
    ADD CONSTRAINT app_developers_pkey PRIMARY KEY (appid, developer_id);


--
-- Name: app_dlc app_dlc_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_dlc
    ADD CONSTRAINT app_dlc_pkey PRIMARY KEY (parent_appid, dlc_appid);


--
-- Name: app_franchises app_franchises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_franchises
    ADD CONSTRAINT app_franchises_pkey PRIMARY KEY (appid, franchise_id);


--
-- Name: app_genres app_genres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_genres
    ADD CONSTRAINT app_genres_pkey PRIMARY KEY (appid, genre_id);


--
-- Name: app_hero_asset_versions app_hero_asset_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hero_asset_versions
    ADD CONSTRAINT app_hero_asset_versions_pkey PRIMARY KEY (id);


--
-- Name: app_media_versions app_media_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_media_versions
    ADD CONSTRAINT app_media_versions_pkey PRIMARY KEY (id);


--
-- Name: app_publishers app_publishers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_publishers
    ADD CONSTRAINT app_publishers_pkey PRIMARY KEY (appid, publisher_id);


--
-- Name: app_source_snapshots app_source_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_source_snapshots
    ADD CONSTRAINT app_source_snapshots_pkey PRIMARY KEY (id);


--
-- Name: app_steam_deck app_steam_deck_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_steam_deck
    ADD CONSTRAINT app_steam_deck_pkey PRIMARY KEY (appid);


--
-- Name: app_steam_tags app_steam_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_steam_tags
    ADD CONSTRAINT app_steam_tags_pkey PRIMARY KEY (appid, tag_id);


--
-- Name: app_tags app_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_tags
    ADD CONSTRAINT app_tags_pkey PRIMARY KEY (appid, tag);


--
-- Name: app_trends app_trends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_trends
    ADD CONSTRAINT app_trends_pkey PRIMARY KEY (appid);


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (appid);


--
-- Name: ccu_snapshots ccu_snapshots_appid_snapshot_time_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ccu_snapshots
    ADD CONSTRAINT ccu_snapshots_appid_snapshot_time_key UNIQUE (appid, snapshot_time);


--
-- Name: ccu_snapshots ccu_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ccu_snapshots
    ADD CONSTRAINT ccu_snapshots_pkey PRIMARY KEY (id);


--
-- Name: ccu_tier_assignments ccu_tier_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ccu_tier_assignments
    ADD CONSTRAINT ccu_tier_assignments_pkey PRIMARY KEY (appid);


--
-- Name: change_activity_bursts change_activity_bursts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_activity_bursts
    ADD CONSTRAINT change_activity_bursts_pkey PRIMARY KEY (burst_id);


--
-- Name: change_pattern_activity_days change_pattern_activity_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_pattern_activity_days
    ADD CONSTRAINT change_pattern_activity_days_pkey PRIMARY KEY (appid, activity_date);


--
-- Name: change_pattern_app_windows change_pattern_app_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_pattern_app_windows
    ADD CONSTRAINT change_pattern_app_windows_pkey PRIMARY KEY (appid, window_days);


--
-- Name: chat_query_logs chat_query_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_query_logs
    ADD CONSTRAINT chat_query_logs_pkey PRIMARY KEY (id);


--
-- Name: credit_reservations credit_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_reservations
    ADD CONSTRAINT credit_reservations_pkey PRIMARY KEY (id);


--
-- Name: credit_transactions credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: daily_metrics daily_metrics_appid_metric_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_appid_metric_date_key UNIQUE (appid, metric_date);


--
-- Name: daily_metrics daily_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_pkey PRIMARY KEY (id);


--
-- Name: dashboard_stats_cache dashboard_stats_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_stats_cache
    ADD CONSTRAINT dashboard_stats_cache_pkey PRIMARY KEY (id);


--
-- Name: developers developers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developers
    ADD CONSTRAINT developers_name_key UNIQUE (name);


--
-- Name: developers developers_normalized_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developers
    ADD CONSTRAINT developers_normalized_name_key UNIQUE (normalized_name);


--
-- Name: developers developers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.developers
    ADD CONSTRAINT developers_pkey PRIMARY KEY (id);


--
-- Name: franchises franchises_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.franchises
    ADD CONSTRAINT franchises_name_key UNIQUE (name);


--
-- Name: franchises franchises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.franchises
    ADD CONSTRAINT franchises_pkey PRIMARY KEY (id);


--
-- Name: pics_sync_state pics_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pics_sync_state
    ADD CONSTRAINT pics_sync_state_pkey PRIMARY KEY (id);


--
-- Name: publishers publishers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publishers
    ADD CONSTRAINT publishers_name_key UNIQUE (name);


--
-- Name: publishers publishers_normalized_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publishers
    ADD CONSTRAINT publishers_normalized_name_key UNIQUE (normalized_name);


--
-- Name: publishers publishers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publishers
    ADD CONSTRAINT publishers_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_state rate_limit_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_state
    ADD CONSTRAINT rate_limit_state_pkey PRIMARY KEY (user_id);


--
-- Name: review_deltas review_deltas_appid_delta_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_deltas
    ADD CONSTRAINT review_deltas_appid_delta_date_key UNIQUE (appid, delta_date);


--
-- Name: review_deltas review_deltas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_deltas
    ADD CONSTRAINT review_deltas_pkey PRIMARY KEY (id);


--
-- Name: review_histogram review_histogram_appid_month_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_histogram
    ADD CONSTRAINT review_histogram_appid_month_start_key UNIQUE (appid, month_start);


--
-- Name: review_histogram review_histogram_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_histogram
    ADD CONSTRAINT review_histogram_pkey PRIMARY KEY (id);


--
-- Name: steam_categories steam_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_categories
    ADD CONSTRAINT steam_categories_pkey PRIMARY KEY (category_id);


--
-- Name: steam_genres steam_genres_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_genres
    ADD CONSTRAINT steam_genres_pkey PRIMARY KEY (genre_id);


--
-- Name: steam_news_items steam_news_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_items
    ADD CONSTRAINT steam_news_items_pkey PRIMARY KEY (gid);


--
-- Name: steam_news_search_projection steam_news_search_projection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_search_projection
    ADD CONSTRAINT steam_news_search_projection_pkey PRIMARY KEY (gid);


--
-- Name: steam_news_versions steam_news_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_versions
    ADD CONSTRAINT steam_news_versions_pkey PRIMARY KEY (id);


--
-- Name: steam_tags steam_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_tags
    ADD CONSTRAINT steam_tags_pkey PRIMARY KEY (tag_id);


--
-- Name: sync_jobs sync_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_jobs
    ADD CONSTRAINT sync_jobs_pkey PRIMARY KEY (id);


--
-- Name: sync_status sync_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_status
    ADD CONSTRAINT sync_status_pkey PRIMARY KEY (appid);


--
-- Name: user_alert_preferences user_alert_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alert_preferences
    ADD CONSTRAINT user_alert_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: user_alerts user_alerts_dedup_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_dedup_key_key UNIQUE (dedup_key);


--
-- Name: user_alerts user_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_pkey PRIMARY KEY (id);


--
-- Name: user_pin_alert_settings user_pin_alert_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pin_alert_settings
    ADD CONSTRAINT user_pin_alert_settings_pkey PRIMARY KEY (pin_id);


--
-- Name: user_pins user_pins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_pkey PRIMARY KEY (id);


--
-- Name: user_pins user_pins_user_id_entity_type_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_user_id_entity_type_entity_id_key UNIQUE (user_id, entity_type, entity_id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: waitlist waitlist_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_email_key UNIQUE (email);


--
-- Name: waitlist waitlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: supabase_migrations; Owner: -
--

ALTER TABLE ONLY supabase_migrations.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: idx_alert_state_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alert_state_entity ON public.alert_detection_state USING btree (entity_type, entity_id);


--
-- Name: idx_app_capture_queue_claimed_source_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_capture_queue_claimed_source_time ON public.app_capture_queue USING btree (source, claimed_at, id) WHERE (status = 'claimed'::public.app_capture_status);


--
-- Name: idx_app_capture_queue_dedupe_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_capture_queue_dedupe_active ON public.app_capture_queue USING btree (appid, source, trigger_cursor) WHERE (status = ANY (ARRAY['queued'::public.app_capture_status, 'claimed'::public.app_capture_status]));


--
-- Name: idx_app_capture_queue_queued_source_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_capture_queue_queued_source_priority ON public.app_capture_queue USING btree (source, priority DESC, available_at, id) WHERE (status = 'queued'::public.app_capture_status);


--
-- Name: idx_app_capture_queue_status_source_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_capture_queue_status_source_priority ON public.app_capture_queue USING btree (status, source, priority DESC, available_at, id);


--
-- Name: idx_app_capture_work_state_claimable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_capture_work_state_claimable ON public.app_capture_work_state USING btree (source, priority DESC, next_available_at, dirty_since, id) WHERE ((dirty_since IS NOT NULL) AND (claimed_at IS NULL) AND (dead_lettered_at IS NULL));


--
-- Name: idx_app_capture_work_state_claimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_capture_work_state_claimed ON public.app_capture_work_state USING btree (source, claimed_at, id) WHERE (claimed_at IS NOT NULL);


--
-- Name: idx_app_capture_work_state_dirty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_capture_work_state_dirty ON public.app_capture_work_state USING btree (source, dirty_since, id) WHERE ((dirty_since IS NOT NULL) AND (dead_lettered_at IS NULL));


--
-- Name: idx_app_categories_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_categories_category_id ON public.app_categories USING btree (category_id);


--
-- Name: idx_app_categories_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_categories_created_at ON public.app_categories USING btree (created_at);


--
-- Name: idx_app_change_events_appid_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_change_events_appid_time ON public.app_change_events USING btree (appid, occurred_at DESC);


--
-- Name: idx_app_change_events_source_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_change_events_source_time ON public.app_change_events USING btree (source, occurred_at DESC);


--
-- Name: idx_app_change_events_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_change_events_type_time ON public.app_change_events USING btree (change_type, occurred_at DESC);


--
-- Name: idx_app_developers_developer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_developers_developer_id ON public.app_developers USING btree (developer_id);


--
-- Name: idx_app_dlc_child; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_dlc_child ON public.app_dlc USING btree (dlc_appid);


--
-- Name: idx_app_dlc_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_dlc_parent ON public.app_dlc USING btree (parent_appid);


--
-- Name: idx_app_filter_data_active_player_pct; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_active_player_pct ON public.app_filter_data USING btree (active_player_pct) WHERE (active_player_pct IS NOT NULL);


--
-- Name: idx_app_filter_data_appid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_filter_data_appid ON public.app_filter_data USING btree (appid);


--
-- Name: idx_app_filter_data_category_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_category_ids ON public.app_filter_data USING gin (category_ids);


--
-- Name: idx_app_filter_data_genre_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_genre_ids ON public.app_filter_data USING gin (genre_ids);


--
-- Name: idx_app_filter_data_has_workshop; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_has_workshop ON public.app_filter_data USING btree (has_workshop) WHERE (has_workshop = true);


--
-- Name: idx_app_filter_data_momentum_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_momentum_score ON public.app_filter_data USING btree (momentum_score) WHERE (momentum_score IS NOT NULL);


--
-- Name: idx_app_filter_data_platform_array; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_platform_array ON public.app_filter_data USING gin (platform_array);


--
-- Name: idx_app_filter_data_publisher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_publisher_id ON public.app_filter_data USING btree (publisher_id) WHERE (publisher_id IS NOT NULL);


--
-- Name: idx_app_filter_data_sentiment_delta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_sentiment_delta ON public.app_filter_data USING btree (sentiment_delta) WHERE (sentiment_delta IS NOT NULL);


--
-- Name: idx_app_filter_data_steam_deck; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_steam_deck ON public.app_filter_data USING btree (steam_deck_category) WHERE (steam_deck_category IS NOT NULL);


--
-- Name: idx_app_filter_data_tag_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_tag_ids ON public.app_filter_data USING gin (tag_ids);


--
-- Name: idx_app_filter_data_value_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_value_score ON public.app_filter_data USING btree (value_score) WHERE (value_score IS NOT NULL);


--
-- Name: idx_app_filter_data_vs_publisher_avg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_filter_data_vs_publisher_avg ON public.app_filter_data USING btree (vs_publisher_avg) WHERE (vs_publisher_avg IS NOT NULL);


--
-- Name: idx_app_franchises_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_franchises_created_at ON public.app_franchises USING btree (created_at);


--
-- Name: idx_app_franchises_franchise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_franchises_franchise ON public.app_franchises USING btree (franchise_id);


--
-- Name: idx_app_genres_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_genres_created_at ON public.app_genres USING btree (created_at);


--
-- Name: idx_app_genres_genre_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_genres_genre_id ON public.app_genres USING btree (genre_id);


--
-- Name: idx_app_genres_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_genres_primary ON public.app_genres USING btree (appid) WHERE (is_primary = true);


--
-- Name: idx_app_hero_asset_versions_appid_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_hero_asset_versions_appid_time ON public.app_hero_asset_versions USING btree (appid, first_seen_at DESC);


--
-- Name: idx_app_hero_asset_versions_unique_content; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_app_hero_asset_versions_unique_content ON public.app_hero_asset_versions USING btree (appid, asset_kind, content_hash);


--
-- Name: idx_app_media_versions_appid_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_media_versions_appid_time ON public.app_media_versions USING btree (appid, first_seen_at DESC);


--
-- Name: idx_app_publishers_publisher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_publishers_publisher_id ON public.app_publishers USING btree (publisher_id);


--
-- Name: idx_app_source_snapshots_app_source_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_source_snapshots_app_source_time ON public.app_source_snapshots USING btree (appid, source, first_seen_at DESC);


--
-- Name: idx_app_source_snapshots_source_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_source_snapshots_source_time ON public.app_source_snapshots USING btree (source, first_seen_at DESC);


--
-- Name: idx_app_steam_deck_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_steam_deck_category ON public.app_steam_deck USING btree (category);


--
-- Name: idx_app_steam_tags_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_steam_tags_created_at ON public.app_steam_tags USING btree (created_at);


--
-- Name: idx_app_steam_tags_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_steam_tags_tag_id ON public.app_steam_tags USING btree (tag_id);


--
-- Name: idx_app_tags_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_tags_tag ON public.app_tags USING btree (tag);


--
-- Name: idx_app_trends_30d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_trends_30d ON public.app_trends USING btree (trend_30d_direction, trend_30d_change_pct DESC) WHERE (trend_30d_direction = 'up'::public.trend_direction);


--
-- Name: idx_app_trends_sentiment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_app_trends_sentiment ON public.app_trends USING btree (appid) INCLUDE (current_positive_ratio, previous_positive_ratio);


--
-- Name: INDEX idx_app_trends_sentiment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_app_trends_sentiment IS 'Covering index for sentiment delta calculation';


--
-- Name: idx_apps_embedding_filter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_embedding_filter ON public.apps USING btree (type, is_delisted) WHERE ((type = ANY (ARRAY['game'::public.app_type, 'dlc'::public.app_type, 'demo'::public.app_type, 'mod'::public.app_type])) AND (is_delisted = false));


--
-- Name: idx_apps_is_free; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_is_free ON public.apps USING btree (is_free) WHERE ((is_released = true) AND (is_delisted = false));


--
-- Name: INDEX idx_apps_is_free; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_apps_is_free IS 'Partial index on is_free for Free/Paid filter. Only covers released, non-delisted apps.';


--
-- Name: idx_apps_last_seen_in_steam_applist_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_last_seen_in_steam_applist_at ON public.apps USING btree (last_seen_in_steam_applist_at DESC NULLS LAST);


--
-- Name: idx_apps_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_name ON public.apps USING btree (name);


--
-- Name: idx_apps_name_lower_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_name_lower_trgm ON public.apps USING gin (lower(name) public.gin_trgm_ops);


--
-- Name: idx_apps_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_name_trgm ON public.apps USING gin (name public.gin_trgm_ops);


--
-- Name: INDEX idx_apps_name_trgm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_apps_name_trgm IS 'Trigram index for fast ILIKE text search on app names';


--
-- Name: idx_apps_needs_dev_info; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_needs_dev_info ON public.apps USING btree (appid) WHERE (has_developer_info = false);


--
-- Name: idx_apps_parent_appid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_parent_appid ON public.apps USING btree (parent_appid) WHERE (parent_appid IS NOT NULL);


--
-- Name: idx_apps_platforms; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_platforms ON public.apps USING btree (platforms) WHERE (platforms IS NOT NULL);


--
-- Name: idx_apps_release_date_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_release_date_desc ON public.apps USING btree (release_date DESC NULLS LAST) WHERE ((is_released = true) AND (is_delisted = false));


--
-- Name: INDEX idx_apps_release_date_desc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_apps_release_date_desc IS 'Release date index for new releases queries';


--
-- Name: idx_apps_released; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_released ON public.apps USING btree (is_released, is_delisted);


--
-- Name: idx_apps_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_type ON public.apps USING btree (type) WHERE (type = 'game'::public.app_type);


--
-- Name: idx_apps_type_released; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_apps_type_released ON public.apps USING btree (type, is_released, is_delisted) WHERE ((is_released = true) AND (is_delisted = false));


--
-- Name: INDEX idx_apps_type_released; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_apps_type_released IS 'Partial composite index for released, non-delisted apps by type. Optimizes the common WHERE clause in get_apps_with_filters.';


--
-- Name: idx_ccu_snapshots_appid_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_snapshots_appid_time ON public.ccu_snapshots USING btree (appid, snapshot_time DESC);


--
-- Name: idx_ccu_snapshots_tier_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_snapshots_tier_time ON public.ccu_snapshots USING btree (ccu_tier, snapshot_time DESC);


--
-- Name: idx_ccu_snapshots_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_snapshots_time ON public.ccu_snapshots USING btree (snapshot_time DESC);


--
-- Name: idx_ccu_tier_assignments_growth_30d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_assignments_growth_30d ON public.ccu_tier_assignments USING btree (ccu_growth_30d_percent DESC NULLS LAST);


--
-- Name: idx_ccu_tier_assignments_growth_7d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_assignments_growth_7d ON public.ccu_tier_assignments USING btree (ccu_growth_7d_percent DESC NULLS LAST);


--
-- Name: idx_ccu_tier_assignments_last_ccu_validation_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_assignments_last_ccu_validation_state ON public.ccu_tier_assignments USING btree (last_ccu_validation_state) WHERE (last_ccu_validation_state IS NOT NULL);


--
-- Name: idx_ccu_tier_assignments_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_assignments_tier ON public.ccu_tier_assignments USING btree (ccu_tier);


--
-- Name: INDEX idx_ccu_tier_assignments_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_ccu_tier_assignments_tier IS 'CCU tier index for tier-based filtering';


--
-- Name: idx_ccu_tier_assignments_tier1; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_assignments_tier1 ON public.ccu_tier_assignments USING btree (recent_peak_ccu DESC NULLS LAST) WHERE (ccu_tier = 1);


--
-- Name: idx_ccu_tier_assignments_tier2; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_assignments_tier2 ON public.ccu_tier_assignments USING btree (release_rank) WHERE (ccu_tier = 2);


--
-- Name: idx_ccu_tier_growth_7d_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_growth_7d_desc ON public.ccu_tier_assignments USING btree (ccu_growth_7d_percent DESC NULLS LAST) WHERE (ccu_growth_7d_percent IS NOT NULL);


--
-- Name: INDEX idx_ccu_tier_growth_7d_desc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_ccu_tier_growth_7d_desc IS 'CCU growth index for trending queries';


--
-- Name: idx_ccu_tier_last_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_last_synced ON public.ccu_tier_assignments USING btree (ccu_tier, last_ccu_synced NULLS FIRST) WHERE (ccu_tier = 3);


--
-- Name: idx_ccu_tier_skip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccu_tier_skip ON public.ccu_tier_assignments USING btree (ccu_skip_until) WHERE (ccu_tier = 3);


--
-- Name: idx_change_activity_bursts_app_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_app_name_trgm ON public.change_activity_bursts USING gin (app_name public.gin_trgm_ops);


--
-- Name: idx_change_activity_bursts_app_type_effective_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_app_type_effective_at ON public.change_activity_bursts USING btree (app_type, effective_at DESC, burst_id DESC);


--
-- Name: idx_change_activity_bursts_appid_effective_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_appid_effective_at ON public.change_activity_bursts USING btree (appid, effective_at DESC, burst_id DESC);


--
-- Name: idx_change_activity_bursts_effective_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_effective_at ON public.change_activity_bursts USING btree (effective_at DESC, burst_id DESC);


--
-- Name: idx_change_activity_bursts_headline_change_types; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_headline_change_types ON public.change_activity_bursts USING gin (headline_change_types);


--
-- Name: idx_change_activity_bursts_high_signal_effective_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_high_signal_effective_at ON public.change_activity_bursts USING btree (include_in_high_signal, effective_at DESC, burst_id DESC);


--
-- Name: idx_change_activity_bursts_release_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_release_date ON public.change_activity_bursts USING btree (release_date DESC);


--
-- Name: idx_change_activity_bursts_signal_families; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_signal_families ON public.change_activity_bursts USING gin (signal_families);


--
-- Name: idx_change_activity_bursts_story_kind_effective_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_activity_bursts_story_kind_effective_at ON public.change_activity_bursts USING btree (story_kind, effective_at DESC, burst_id DESC);


--
-- Name: idx_change_pattern_activity_days_activity_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_pattern_activity_days_activity_date ON public.change_pattern_activity_days USING btree (activity_date DESC, app_type, latest_occurred_at DESC, appid DESC);


--
-- Name: idx_change_pattern_activity_days_app_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_pattern_activity_days_app_name_trgm ON public.change_pattern_activity_days USING gin (app_name public.gin_trgm_ops);


--
-- Name: idx_change_pattern_activity_days_appid_activity_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_pattern_activity_days_appid_activity_date ON public.change_pattern_activity_days USING btree (appid, activity_date DESC);


--
-- Name: idx_change_pattern_app_windows_app_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_pattern_app_windows_app_name_trgm ON public.change_pattern_app_windows USING gin (app_name public.gin_trgm_ops);


--
-- Name: idx_change_pattern_app_windows_appid_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_pattern_app_windows_appid_window ON public.change_pattern_app_windows USING btree (appid, window_days);


--
-- Name: idx_change_pattern_app_windows_window_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_change_pattern_app_windows_window_latest ON public.change_pattern_app_windows USING btree (window_days, app_type, latest_occurred_at DESC, appid DESC);


--
-- Name: idx_chat_query_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_query_logs_created_at ON public.chat_query_logs USING btree (created_at DESC);


--
-- Name: idx_chat_query_logs_tool_names; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_query_logs_tool_names ON public.chat_query_logs USING gin (tool_names);


--
-- Name: idx_chat_query_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_query_logs_user_id ON public.chat_query_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_credit_reservations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_reservations_created ON public.credit_reservations USING btree (created_at DESC);


--
-- Name: idx_credit_reservations_user_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_reservations_user_pending ON public.credit_reservations USING btree (user_id) WHERE (status = 'pending'::public.credit_reservation_status);


--
-- Name: idx_credit_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_transactions_type ON public.credit_transactions USING btree (transaction_type);


--
-- Name: idx_credit_transactions_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_transactions_user_date ON public.credit_transactions USING btree (user_id, created_at DESC);


--
-- Name: idx_daily_metrics_appid_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_metrics_appid_date ON public.daily_metrics USING btree (appid, metric_date DESC);


--
-- Name: idx_daily_metrics_ccu_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_metrics_ccu_source ON public.daily_metrics USING btree (ccu_source) WHERE (ccu_source IS NOT NULL);


--
-- Name: idx_daily_metrics_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_metrics_date ON public.daily_metrics USING btree (metric_date);


--
-- Name: idx_developer_game_metrics_dev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_game_metrics_dev ON public.developer_game_metrics USING btree (developer_id);


--
-- Name: idx_developer_game_metrics_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_game_metrics_release ON public.developer_game_metrics USING btree (release_date DESC);


--
-- Name: idx_developer_game_metrics_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_developer_game_metrics_unique ON public.developer_game_metrics USING btree (developer_id, appid);


--
-- Name: idx_developer_game_metrics_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_game_metrics_year ON public.developer_game_metrics USING btree (release_year);


--
-- Name: idx_developer_metrics_category_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_category_ids ON public.developer_metrics USING gin (category_ids);


--
-- Name: idx_developer_metrics_ccu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_ccu ON public.developer_metrics USING btree (total_ccu DESC);


--
-- Name: idx_developer_metrics_genre_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_genre_ids ON public.developer_metrics USING gin (genre_ids);


--
-- Name: idx_developer_metrics_growth_30d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_growth_30d ON public.developer_metrics USING btree (ccu_growth_30d_percent DESC NULLS LAST);


--
-- Name: idx_developer_metrics_growth_7d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_growth_7d ON public.developer_metrics USING btree (ccu_growth_7d_percent DESC NULLS LAST);


--
-- Name: idx_developer_metrics_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_name ON public.developer_metrics USING btree (developer_name);


--
-- Name: idx_developer_metrics_owners; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_owners ON public.developer_metrics USING btree (total_owners DESC);


--
-- Name: idx_developer_metrics_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_developer_metrics_pk ON public.developer_metrics USING btree (developer_id);


--
-- Name: idx_developer_metrics_platforms; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_platforms ON public.developer_metrics USING gin (platform_array);


--
-- Name: idx_developer_metrics_revenue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_revenue ON public.developer_metrics USING btree (revenue_estimate_cents DESC);


--
-- Name: idx_developer_metrics_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_score ON public.developer_metrics USING btree (avg_review_score DESC NULLS LAST);


--
-- Name: idx_developer_metrics_steam_deck; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_steam_deck ON public.developer_metrics USING btree (best_steam_deck_category);


--
-- Name: idx_developer_metrics_tag_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_tag_ids ON public.developer_metrics USING gin (tag_ids);


--
-- Name: idx_developer_metrics_trending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_trending ON public.developer_metrics USING btree (games_trending_up DESC);


--
-- Name: idx_developer_metrics_velocity_30d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_velocity_30d ON public.developer_metrics USING btree (review_velocity_30d DESC NULLS LAST);


--
-- Name: idx_developer_metrics_velocity_7d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_velocity_7d ON public.developer_metrics USING btree (review_velocity_7d DESC NULLS LAST);


--
-- Name: idx_developer_metrics_weekly_hours; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_metrics_weekly_hours ON public.developer_metrics USING btree (estimated_weekly_hours DESC);


--
-- Name: idx_developer_year_metrics_game_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_year_metrics_game_count ON public.developer_year_metrics USING btree (game_count DESC);


--
-- Name: idx_developer_year_metrics_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_year_metrics_latest ON public.developer_year_metrics USING btree (latest_release DESC);


--
-- Name: idx_developer_year_metrics_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_year_metrics_name ON public.developer_year_metrics USING btree (developer_name);


--
-- Name: idx_developer_year_metrics_owners; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_year_metrics_owners ON public.developer_year_metrics USING btree (total_owners DESC);


--
-- Name: idx_developer_year_metrics_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_developer_year_metrics_pk ON public.developer_year_metrics USING btree (developer_id, release_year);


--
-- Name: idx_developer_year_metrics_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developer_year_metrics_year ON public.developer_year_metrics USING btree (release_year);


--
-- Name: idx_developers_embedding_needed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developers_embedding_needed ON public.developers USING btree (game_count DESC, last_embedding_sync NULLS FIRST) WHERE (game_count > 0);


--
-- Name: idx_developers_name_lower_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developers_name_lower_trgm ON public.developers USING gin (lower(name) public.gin_trgm_ops);


--
-- Name: idx_developers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developers_name_trgm ON public.developers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_developers_needs_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developers_needs_embedding ON public.developers USING btree (game_count DESC, last_embedding_sync NULLS FIRST) WHERE (game_count > 0);


--
-- Name: idx_developers_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_developers_normalized ON public.developers USING btree (normalized_name);


--
-- Name: idx_franchises_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_franchises_normalized ON public.franchises USING btree (normalized_name);


--
-- Name: idx_latest_daily_metrics_appid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_latest_daily_metrics_appid ON public.latest_daily_metrics USING btree (appid);


--
-- Name: idx_latest_daily_metrics_ccu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_latest_daily_metrics_ccu ON public.latest_daily_metrics USING btree (ccu_peak DESC NULLS LAST);


--
-- Name: idx_latest_daily_metrics_reviews; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_latest_daily_metrics_reviews ON public.latest_daily_metrics USING btree (total_reviews DESC NULLS LAST);


--
-- Name: idx_latest_daily_metrics_weekly_hours; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_latest_daily_metrics_weekly_hours ON public.latest_daily_metrics USING btree (estimated_weekly_hours DESC NULLS LAST);


--
-- Name: idx_monthly_game_metrics_hours; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_game_metrics_hours ON public.monthly_game_metrics USING btree (estimated_monthly_hours DESC);


--
-- Name: idx_monthly_game_metrics_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_game_metrics_month ON public.monthly_game_metrics USING btree (month DESC);


--
-- Name: idx_monthly_game_metrics_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_monthly_game_metrics_pk ON public.monthly_game_metrics USING btree (appid, month);


--
-- Name: idx_monthly_game_metrics_year_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_game_metrics_year_month ON public.monthly_game_metrics USING btree (year, month_num);


--
-- Name: idx_mv_apps_aggregate_stats_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_apps_aggregate_stats_pk ON public.mv_apps_aggregate_stats USING btree (app_type);


--
-- Name: idx_mv_category_counts_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_category_counts_pk ON public.mv_category_counts USING btree (app_type, category_id);


--
-- Name: idx_mv_category_counts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_category_counts_type ON public.mv_category_counts USING btree (app_type);


--
-- Name: idx_mv_ccu_tier_counts_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_ccu_tier_counts_pk ON public.mv_ccu_tier_counts USING btree (app_type, ccu_tier);


--
-- Name: idx_mv_genre_counts_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_genre_counts_pk ON public.mv_genre_counts USING btree (app_type, genre_id);


--
-- Name: idx_mv_genre_counts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_genre_counts_type ON public.mv_genre_counts USING btree (app_type);


--
-- Name: idx_mv_steam_deck_counts_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_steam_deck_counts_pk ON public.mv_steam_deck_counts USING btree (app_type, steam_deck_category);


--
-- Name: idx_mv_tag_counts_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_tag_counts_pk ON public.mv_tag_counts USING btree (app_type, tag_id);


--
-- Name: idx_mv_tag_counts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mv_tag_counts_type ON public.mv_tag_counts USING btree (app_type);


--
-- Name: idx_mv_velocity_tier_counts_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_velocity_tier_counts_pk ON public.mv_velocity_tier_counts USING btree (app_type, velocity_tier);


--
-- Name: idx_publisher_game_metrics_pub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_game_metrics_pub ON public.publisher_game_metrics USING btree (publisher_id);


--
-- Name: idx_publisher_game_metrics_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_game_metrics_release ON public.publisher_game_metrics USING btree (release_date DESC);


--
-- Name: idx_publisher_game_metrics_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_publisher_game_metrics_unique ON public.publisher_game_metrics USING btree (publisher_id, appid);


--
-- Name: idx_publisher_game_metrics_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_game_metrics_year ON public.publisher_game_metrics USING btree (release_year);


--
-- Name: idx_publisher_metrics_category_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_category_ids ON public.publisher_metrics USING gin (category_ids);


--
-- Name: idx_publisher_metrics_ccu; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_ccu ON public.publisher_metrics USING btree (total_ccu DESC);


--
-- Name: idx_publisher_metrics_developers; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_developers ON public.publisher_metrics USING btree (unique_developers DESC);


--
-- Name: idx_publisher_metrics_genre_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_genre_ids ON public.publisher_metrics USING gin (genre_ids);


--
-- Name: idx_publisher_metrics_growth_30d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_growth_30d ON public.publisher_metrics USING btree (ccu_growth_30d_percent DESC NULLS LAST);


--
-- Name: idx_publisher_metrics_growth_7d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_growth_7d ON public.publisher_metrics USING btree (ccu_growth_7d_percent DESC NULLS LAST);


--
-- Name: idx_publisher_metrics_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_name ON public.publisher_metrics USING btree (publisher_name);


--
-- Name: idx_publisher_metrics_owners; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_owners ON public.publisher_metrics USING btree (total_owners DESC);


--
-- Name: idx_publisher_metrics_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_publisher_metrics_pk ON public.publisher_metrics USING btree (publisher_id);


--
-- Name: idx_publisher_metrics_platforms; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_platforms ON public.publisher_metrics USING gin (platform_array);


--
-- Name: idx_publisher_metrics_revenue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_revenue ON public.publisher_metrics USING btree (revenue_estimate_cents DESC);


--
-- Name: idx_publisher_metrics_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_score ON public.publisher_metrics USING btree (avg_review_score DESC NULLS LAST);


--
-- Name: idx_publisher_metrics_steam_deck; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_steam_deck ON public.publisher_metrics USING btree (best_steam_deck_category);


--
-- Name: idx_publisher_metrics_tag_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_tag_ids ON public.publisher_metrics USING gin (tag_ids);


--
-- Name: idx_publisher_metrics_trending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_trending ON public.publisher_metrics USING btree (games_trending_up DESC);


--
-- Name: idx_publisher_metrics_velocity_30d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_velocity_30d ON public.publisher_metrics USING btree (review_velocity_30d DESC NULLS LAST);


--
-- Name: idx_publisher_metrics_velocity_7d; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_velocity_7d ON public.publisher_metrics USING btree (review_velocity_7d DESC NULLS LAST);


--
-- Name: idx_publisher_metrics_weekly_hours; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_metrics_weekly_hours ON public.publisher_metrics USING btree (estimated_weekly_hours DESC);


--
-- Name: idx_publisher_year_metrics_game_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_year_metrics_game_count ON public.publisher_year_metrics USING btree (game_count DESC);


--
-- Name: idx_publisher_year_metrics_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_year_metrics_latest ON public.publisher_year_metrics USING btree (latest_release DESC);


--
-- Name: idx_publisher_year_metrics_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_year_metrics_name ON public.publisher_year_metrics USING btree (publisher_name);


--
-- Name: idx_publisher_year_metrics_owners; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_year_metrics_owners ON public.publisher_year_metrics USING btree (total_owners DESC);


--
-- Name: idx_publisher_year_metrics_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_publisher_year_metrics_pk ON public.publisher_year_metrics USING btree (publisher_id, release_year);


--
-- Name: idx_publisher_year_metrics_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publisher_year_metrics_year ON public.publisher_year_metrics USING btree (release_year);


--
-- Name: idx_publishers_embedding_needed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publishers_embedding_needed ON public.publishers USING btree (game_count DESC, last_embedding_sync NULLS FIRST) WHERE (game_count > 0);


--
-- Name: idx_publishers_name_lower_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publishers_name_lower_trgm ON public.publishers USING gin (lower(name) public.gin_trgm_ops);


--
-- Name: idx_publishers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publishers_name_trgm ON public.publishers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_publishers_needs_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publishers_needs_embedding ON public.publishers USING btree (game_count DESC, last_embedding_sync NULLS FIRST) WHERE (game_count > 0);


--
-- Name: idx_publishers_normalized; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_publishers_normalized ON public.publishers USING btree (normalized_name);


--
-- Name: idx_review_deltas_appid_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_deltas_appid_date ON public.review_deltas USING btree (appid, delta_date DESC);


--
-- Name: idx_review_deltas_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_deltas_date ON public.review_deltas USING btree (delta_date DESC);


--
-- Name: idx_review_deltas_velocity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_deltas_velocity ON public.review_deltas USING btree (daily_velocity DESC) WHERE (is_interpolated = false);


--
-- Name: idx_review_histogram_appid_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_histogram_appid_month ON public.review_histogram USING btree (appid, month_start DESC);


--
-- Name: idx_review_velocity_stats_appid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_review_velocity_stats_appid ON public.review_velocity_stats USING btree (appid);


--
-- Name: idx_review_velocity_stats_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_velocity_stats_tier ON public.review_velocity_stats USING btree (velocity_tier, velocity_7d DESC);


--
-- Name: idx_rvs_velocity_7d_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rvs_velocity_7d_desc ON public.review_velocity_stats USING btree (velocity_7d DESC NULLS LAST) WHERE (velocity_7d > (0)::numeric);


--
-- Name: INDEX idx_rvs_velocity_7d_desc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_rvs_velocity_7d_desc IS 'Velocity index for high review activity queries';


--
-- Name: idx_rvs_velocity_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rvs_velocity_tier ON public.review_velocity_stats USING btree (velocity_tier) WHERE (velocity_tier IS NOT NULL);


--
-- Name: INDEX idx_rvs_velocity_tier; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_rvs_velocity_tier IS 'Velocity tier index for tier-based filtering';


--
-- Name: idx_steam_news_items_appid_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_items_appid_published ON public.steam_news_items USING btree (appid, published_at DESC NULLS LAST);


--
-- Name: idx_steam_news_items_appid_sort_time_gid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_items_appid_sort_time_gid ON public.steam_news_items USING btree (appid, COALESCE(published_at, first_seen_at) DESC, gid DESC);


--
-- Name: idx_steam_news_items_published_gid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_items_published_gid ON public.steam_news_items USING btree (published_at DESC NULLS LAST, gid DESC);


--
-- Name: idx_steam_news_items_sort_time_gid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_items_sort_time_gid ON public.steam_news_items USING btree (COALESCE(published_at, first_seen_at) DESC, gid DESC);


--
-- Name: idx_steam_news_search_projection_appid_sort_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_search_projection_appid_sort_time ON public.steam_news_search_projection USING btree (appid, sort_time DESC);


--
-- Name: idx_steam_news_search_projection_feed_scope_sort_time_gid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_search_projection_feed_scope_sort_time_gid ON public.steam_news_search_projection USING btree (feed_scope, sort_time DESC, gid DESC);


--
-- Name: idx_steam_news_search_projection_search_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_search_projection_search_document ON public.steam_news_search_projection USING gin (search_document);


--
-- Name: idx_steam_news_versions_gid_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_news_versions_gid_time ON public.steam_news_versions USING btree (gid, first_seen_at DESC);


--
-- Name: idx_steam_tags_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_steam_tags_name ON public.steam_tags USING btree (name);


--
-- Name: idx_sync_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_jobs_status ON public.sync_jobs USING btree (status) WHERE (status = 'running'::text);


--
-- Name: idx_sync_jobs_type_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_jobs_type_started ON public.sync_jobs USING btree (job_type, started_at DESC);


--
-- Name: idx_sync_status_change_hints; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_change_hints ON public.sync_status USING btree (steam_last_modified DESC NULLS LAST, steam_price_change_number DESC NULLS LAST);


--
-- Name: idx_sync_status_embedding_needed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_embedding_needed ON public.sync_status USING btree (priority_score DESC, last_embedding_sync NULLS FIRST) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_interval_storefront; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_interval_storefront ON public.sync_status USING btree (sync_interval_hours, last_storefront_sync, priority_score DESC) WHERE ((is_syncable = true) AND ((storefront_accessible IS NULL) OR (storefront_accessible = true)));


--
-- Name: idx_sync_status_news_media; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_news_media ON public.sync_status USING btree (last_news_sync, last_media_sync);


--
-- Name: idx_sync_status_next_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_next_sync ON public.sync_status USING btree (next_sync_after) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_pics; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_pics ON public.sync_status USING btree (last_pics_sync) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_price_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_price_sync ON public.sync_status USING btree (last_price_sync, priority_score DESC) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_priority ON public.sync_status USING btree (priority_score DESC) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_refresh_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_refresh_tier ON public.sync_status USING btree (refresh_tier);


--
-- Name: idx_sync_status_reviews_claim_lease; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_reviews_claim_lease ON public.sync_status USING btree (reviews_claim_expires_at, next_reviews_sync) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_reviews_claimable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_reviews_claimable ON public.sync_status USING btree (next_reviews_sync, review_velocity_tier, priority_score DESC) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_reviews_due_unclaimed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_reviews_due_unclaimed ON public.sync_status USING btree (next_reviews_sync, priority_score DESC, appid) WHERE ((is_syncable = true) AND (reviews_claim_expires_at IS NULL));


--
-- Name: idx_sync_status_reviews_override; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_reviews_override ON public.sync_status USING btree (reviews_priority_override_until, reviews_priority_override_bucket, reviews_priority_override_score DESC) WHERE (reviews_priority_override_until IS NOT NULL);


--
-- Name: idx_sync_status_reviews_sync; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_reviews_sync ON public.sync_status USING btree (next_reviews_sync, review_velocity_tier) WHERE (is_syncable = true);


--
-- Name: idx_sync_status_steamspy_available; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_steamspy_available ON public.sync_status USING btree (steamspy_available) WHERE (steamspy_available = false);


--
-- Name: idx_sync_status_steamspy_individual_candidates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_steamspy_individual_candidates ON public.sync_status USING btree (appid) WHERE ((steamspy_available = false) AND (last_steamspy_individual_fetch IS NULL));


--
-- Name: idx_sync_status_storefront_accessible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_storefront_accessible ON public.sync_status USING btree (storefront_accessible) WHERE (storefront_accessible = false);


--
-- Name: idx_sync_status_unembedded; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_status_unembedded ON public.sync_status USING btree (appid) WHERE ((is_syncable = true) AND (last_embedding_sync IS NULL));


--
-- Name: idx_user_alerts_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_alerts_user_date ON public.user_alerts USING btree (user_id, created_at DESC);


--
-- Name: idx_user_alerts_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_alerts_user_unread ON public.user_alerts USING btree (user_id, created_at DESC) WHERE (is_read = false);


--
-- Name: idx_user_pins_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_pins_entity ON public.user_pins USING btree (entity_type, entity_id);


--
-- Name: idx_user_pins_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_pins_user_id ON public.user_pins USING btree (user_id, pin_order);


--
-- Name: idx_user_profiles_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_profiles_email ON public.user_profiles USING btree (email);


--
-- Name: idx_user_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_profiles_role ON public.user_profiles USING btree (role);


--
-- Name: idx_waitlist_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_created_at ON public.waitlist USING btree (created_at DESC);


--
-- Name: idx_waitlist_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_email ON public.waitlist USING btree (email);


--
-- Name: idx_waitlist_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waitlist_status ON public.waitlist USING btree (status);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_key; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_key ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: users on_auth_user_created; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


--
-- Name: user_alert_preferences trigger_alert_preferences_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_alert_preferences_updated_at BEFORE UPDATE ON public.user_alert_preferences FOR EACH ROW EXECUTE FUNCTION public.update_alert_preferences_updated_at();


--
-- Name: app_developers trigger_app_developers_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_app_developers_count AFTER INSERT OR DELETE ON public.app_developers FOR EACH ROW EXECUTE FUNCTION public.update_developer_game_count();


--
-- Name: app_publishers trigger_app_publishers_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_app_publishers_count AFTER INSERT OR DELETE ON public.app_publishers FOR EACH ROW EXECUTE FUNCTION public.update_publisher_game_count();


--
-- Name: apps trigger_apps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_apps_updated_at BEFORE UPDATE ON public.apps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: app_developers trigger_developer_new_release; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_developer_new_release AFTER INSERT ON public.app_developers FOR EACH ROW EXECUTE FUNCTION public.detect_developer_new_release_alert();


--
-- Name: developers trigger_developers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_developers_updated_at BEFORE UPDATE ON public.developers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: user_pin_alert_settings trigger_pin_alert_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_pin_alert_settings_updated_at BEFORE UPDATE ON public.user_pin_alert_settings FOR EACH ROW EXECUTE FUNCTION public.update_alert_preferences_updated_at();


--
-- Name: apps trigger_price_change_alert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_price_change_alert AFTER UPDATE OF current_price_cents, current_discount_percent ON public.apps FOR EACH ROW EXECUTE FUNCTION public.detect_price_change_alert();


--
-- Name: app_publishers trigger_publisher_new_release; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_publisher_new_release AFTER INSERT ON public.app_publishers FOR EACH ROW EXECUTE FUNCTION public.detect_publisher_new_release_alert();


--
-- Name: publishers trigger_publishers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_publishers_updated_at BEFORE UPDATE ON public.publishers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: steam_news_items trigger_steam_news_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_steam_news_items_updated_at BEFORE UPDATE ON public.steam_news_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: user_profiles trigger_user_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_user_profile_updated_at();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: app_capture_queue app_capture_queue_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_capture_queue
    ADD CONSTRAINT app_capture_queue_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_capture_work_state app_capture_work_state_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_capture_work_state
    ADD CONSTRAINT app_capture_work_state_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_categories app_categories_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_categories
    ADD CONSTRAINT app_categories_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_categories app_categories_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_categories
    ADD CONSTRAINT app_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.steam_categories(category_id) ON DELETE CASCADE;


--
-- Name: app_change_events app_change_events_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_change_events
    ADD CONSTRAINT app_change_events_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_change_events app_change_events_media_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_change_events
    ADD CONSTRAINT app_change_events_media_version_id_fkey FOREIGN KEY (media_version_id) REFERENCES public.app_media_versions(id) ON DELETE SET NULL;


--
-- Name: app_change_events app_change_events_news_item_gid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_change_events
    ADD CONSTRAINT app_change_events_news_item_gid_fkey FOREIGN KEY (news_item_gid) REFERENCES public.steam_news_items(gid) ON DELETE SET NULL;


--
-- Name: app_change_events app_change_events_related_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_change_events
    ADD CONSTRAINT app_change_events_related_snapshot_id_fkey FOREIGN KEY (related_snapshot_id) REFERENCES public.app_source_snapshots(id) ON DELETE SET NULL;


--
-- Name: app_change_events app_change_events_source_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_change_events
    ADD CONSTRAINT app_change_events_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES public.app_source_snapshots(id) ON DELETE SET NULL;


--
-- Name: app_developers app_developers_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_developers
    ADD CONSTRAINT app_developers_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_developers app_developers_developer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_developers
    ADD CONSTRAINT app_developers_developer_id_fkey FOREIGN KEY (developer_id) REFERENCES public.developers(id) ON DELETE CASCADE;


--
-- Name: app_franchises app_franchises_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_franchises
    ADD CONSTRAINT app_franchises_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_franchises app_franchises_franchise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_franchises
    ADD CONSTRAINT app_franchises_franchise_id_fkey FOREIGN KEY (franchise_id) REFERENCES public.franchises(id) ON DELETE CASCADE;


--
-- Name: app_genres app_genres_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_genres
    ADD CONSTRAINT app_genres_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_genres app_genres_genre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_genres
    ADD CONSTRAINT app_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.steam_genres(genre_id) ON DELETE CASCADE;


--
-- Name: app_hero_asset_versions app_hero_asset_versions_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_hero_asset_versions
    ADD CONSTRAINT app_hero_asset_versions_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_media_versions app_media_versions_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_media_versions
    ADD CONSTRAINT app_media_versions_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_media_versions app_media_versions_previous_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_media_versions
    ADD CONSTRAINT app_media_versions_previous_version_id_fkey FOREIGN KEY (previous_version_id) REFERENCES public.app_media_versions(id) ON DELETE SET NULL;


--
-- Name: app_media_versions app_media_versions_storefront_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_media_versions
    ADD CONSTRAINT app_media_versions_storefront_snapshot_id_fkey FOREIGN KEY (storefront_snapshot_id) REFERENCES public.app_source_snapshots(id) ON DELETE SET NULL;


--
-- Name: app_publishers app_publishers_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_publishers
    ADD CONSTRAINT app_publishers_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_publishers app_publishers_publisher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_publishers
    ADD CONSTRAINT app_publishers_publisher_id_fkey FOREIGN KEY (publisher_id) REFERENCES public.publishers(id) ON DELETE CASCADE;


--
-- Name: app_source_snapshots app_source_snapshots_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_source_snapshots
    ADD CONSTRAINT app_source_snapshots_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_source_snapshots app_source_snapshots_previous_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_source_snapshots
    ADD CONSTRAINT app_source_snapshots_previous_snapshot_id_fkey FOREIGN KEY (previous_snapshot_id) REFERENCES public.app_source_snapshots(id) ON DELETE SET NULL;


--
-- Name: app_steam_deck app_steam_deck_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_steam_deck
    ADD CONSTRAINT app_steam_deck_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_steam_tags app_steam_tags_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_steam_tags
    ADD CONSTRAINT app_steam_tags_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_steam_tags app_steam_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_steam_tags
    ADD CONSTRAINT app_steam_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.steam_tags(tag_id) ON DELETE CASCADE;


--
-- Name: app_tags app_tags_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_tags
    ADD CONSTRAINT app_tags_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: app_trends app_trends_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_trends
    ADD CONSTRAINT app_trends_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: ccu_snapshots ccu_snapshots_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ccu_snapshots
    ADD CONSTRAINT ccu_snapshots_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: ccu_tier_assignments ccu_tier_assignments_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ccu_tier_assignments
    ADD CONSTRAINT ccu_tier_assignments_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: change_activity_bursts change_activity_bursts_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_activity_bursts
    ADD CONSTRAINT change_activity_bursts_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: change_pattern_activity_days change_pattern_activity_days_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_pattern_activity_days
    ADD CONSTRAINT change_pattern_activity_days_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: change_pattern_app_windows change_pattern_app_windows_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_pattern_app_windows
    ADD CONSTRAINT change_pattern_app_windows_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: chat_query_logs chat_query_logs_reservation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_query_logs
    ADD CONSTRAINT chat_query_logs_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES public.credit_reservations(id);


--
-- Name: chat_query_logs chat_query_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_query_logs
    ADD CONSTRAINT chat_query_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id);


--
-- Name: credit_reservations credit_reservations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_reservations
    ADD CONSTRAINT credit_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: credit_transactions credit_transactions_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES auth.users(id);


--
-- Name: credit_transactions credit_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: daily_metrics daily_metrics_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_metrics
    ADD CONSTRAINT daily_metrics_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: rate_limit_state rate_limit_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_state
    ADD CONSTRAINT rate_limit_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: review_deltas review_deltas_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_deltas
    ADD CONSTRAINT review_deltas_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: review_histogram review_histogram_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_histogram
    ADD CONSTRAINT review_histogram_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: steam_news_items steam_news_items_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_items
    ADD CONSTRAINT steam_news_items_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: steam_news_search_projection steam_news_search_projection_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_search_projection
    ADD CONSTRAINT steam_news_search_projection_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: steam_news_search_projection steam_news_search_projection_gid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_search_projection
    ADD CONSTRAINT steam_news_search_projection_gid_fkey FOREIGN KEY (gid) REFERENCES public.steam_news_items(gid) ON DELETE CASCADE;


--
-- Name: steam_news_versions steam_news_versions_gid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_versions
    ADD CONSTRAINT steam_news_versions_gid_fkey FOREIGN KEY (gid) REFERENCES public.steam_news_items(gid) ON DELETE CASCADE;


--
-- Name: steam_news_versions steam_news_versions_previous_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.steam_news_versions
    ADD CONSTRAINT steam_news_versions_previous_version_id_fkey FOREIGN KEY (previous_version_id) REFERENCES public.steam_news_versions(id) ON DELETE SET NULL;


--
-- Name: sync_status sync_status_appid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_status
    ADD CONSTRAINT sync_status_appid_fkey FOREIGN KEY (appid) REFERENCES public.apps(appid) ON DELETE CASCADE;


--
-- Name: user_alert_preferences user_alert_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alert_preferences
    ADD CONSTRAINT user_alert_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: user_alerts user_alerts_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.user_pins(id) ON DELETE CASCADE;


--
-- Name: user_alerts user_alerts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_alerts
    ADD CONSTRAINT user_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: user_pin_alert_settings user_pin_alert_settings_pin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pin_alert_settings
    ADD CONSTRAINT user_pin_alert_settings_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES public.user_pins(id) ON DELETE CASCADE;


--
-- Name: user_pins user_pins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_pins
    ADD CONSTRAINT user_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: waitlist waitlist_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_query_logs Admins can read all chat logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all chat logs" ON public.chat_query_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = 'admin'::public.user_role)))));


--
-- Name: user_profiles Admins can read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all profiles" ON public.user_profiles FOR SELECT USING (public.is_admin());


--
-- Name: credit_reservations Admins can read all reservations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all reservations" ON public.credit_reservations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = 'admin'::public.user_role)))));


--
-- Name: credit_transactions Admins can read all transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read all transactions" ON public.credit_transactions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = 'admin'::public.user_role)))));


--
-- Name: chat_query_logs Admins can read chat logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read chat logs" ON public.chat_query_logs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.user_profiles
  WHERE ((user_profiles.id = auth.uid()) AND (user_profiles.role = 'admin'::public.user_role)))));


--
-- Name: credit_transactions Admins can read credit_transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read credit_transactions" ON public.credit_transactions FOR SELECT USING (public.is_admin());


--
-- Name: waitlist Admins can read waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can read waitlist" ON public.waitlist FOR SELECT USING (public.is_admin());


--
-- Name: waitlist Admins can update waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update waitlist" ON public.waitlist FOR UPDATE USING (public.is_admin());


--
-- Name: app_categories Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_categories FOR SELECT USING (true);


--
-- Name: app_developers Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_developers FOR SELECT USING (true);


--
-- Name: app_franchises Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_franchises FOR SELECT USING (true);


--
-- Name: app_genres Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_genres FOR SELECT USING (true);


--
-- Name: app_publishers Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_publishers FOR SELECT USING (true);


--
-- Name: app_steam_deck Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_steam_deck FOR SELECT USING (true);


--
-- Name: app_steam_tags Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_steam_tags FOR SELECT USING (true);


--
-- Name: app_tags Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_tags FOR SELECT USING (true);


--
-- Name: app_trends Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.app_trends FOR SELECT USING (true);


--
-- Name: apps Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.apps FOR SELECT USING (true);


--
-- Name: daily_metrics Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.daily_metrics FOR SELECT USING (true);


--
-- Name: developers Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.developers FOR SELECT USING (true);


--
-- Name: franchises Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.franchises FOR SELECT USING (true);


--
-- Name: pics_sync_state Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.pics_sync_state FOR SELECT USING (true);


--
-- Name: publishers Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.publishers FOR SELECT USING (true);


--
-- Name: review_histogram Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.review_histogram FOR SELECT USING (true);


--
-- Name: steam_categories Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.steam_categories FOR SELECT USING (true);


--
-- Name: steam_genres Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.steam_genres FOR SELECT USING (true);


--
-- Name: steam_tags Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.steam_tags FOR SELECT USING (true);


--
-- Name: sync_jobs Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.sync_jobs FOR SELECT USING (true);


--
-- Name: sync_status Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.sync_status FOR SELECT USING (true);


--
-- Name: waitlist Public can insert waitlist; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can insert waitlist" ON public.waitlist FOR INSERT TO authenticated, anon WITH CHECK (true);


--
-- Name: user_pins Users can delete own pins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own pins" ON public.user_pins FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: user_pins Users can insert own pins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own pins" ON public.user_pins FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_alert_preferences Users can insert own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own preferences" ON public.user_alert_preferences FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_alerts Users can read own alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own alerts" ON public.user_alerts FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: chat_query_logs Users can read own chat logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own chat logs" ON public.chat_query_logs FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_pins Users can read own pins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own pins" ON public.user_pins FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_alert_preferences Users can read own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own preferences" ON public.user_alert_preferences FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.user_profiles FOR SELECT USING ((auth.uid() = id));


--
-- Name: rate_limit_state Users can read own rate limit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own rate limit" ON public.rate_limit_state FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: credit_reservations Users can read own reservations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own reservations" ON public.credit_reservations FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: credit_transactions Users can read own transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own transactions" ON public.credit_transactions FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_alerts Users can update own alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own alerts" ON public.user_alerts FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: user_pins Users can update own pins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own pins" ON public.user_pins FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: user_alert_preferences Users can update own preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own preferences" ON public.user_alert_preferences FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: user_profiles Users can update own profile safe columns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile safe columns" ON public.user_profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: user_pin_alert_settings Users manage own pin settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own pin settings" ON public.user_pin_alert_settings USING ((pin_id IN ( SELECT user_pins.id
   FROM public.user_pins
  WHERE (user_pins.user_id = auth.uid())))) WITH CHECK ((pin_id IN ( SELECT user_pins.id
   FROM public.user_pins
  WHERE (user_pins.user_id = auth.uid()))));


--
-- Name: app_capture_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_capture_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: app_capture_work_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_capture_work_state ENABLE ROW LEVEL SECURITY;

--
-- Name: app_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: app_change_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_change_events ENABLE ROW LEVEL SECURITY;

--
-- Name: app_developers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_developers ENABLE ROW LEVEL SECURITY;

--
-- Name: app_franchises; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_franchises ENABLE ROW LEVEL SECURITY;

--
-- Name: app_genres; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_genres ENABLE ROW LEVEL SECURITY;

--
-- Name: app_hero_asset_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_hero_asset_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: app_media_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_media_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: app_publishers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_publishers ENABLE ROW LEVEL SECURITY;

--
-- Name: app_source_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_source_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: app_steam_deck; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_steam_deck ENABLE ROW LEVEL SECURITY;

--
-- Name: app_steam_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_steam_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: app_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: app_trends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_trends ENABLE ROW LEVEL SECURITY;

--
-- Name: apps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_query_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_query_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: developers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.developers ENABLE ROW LEVEL SECURITY;

--
-- Name: franchises; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.franchises ENABLE ROW LEVEL SECURITY;

--
-- Name: pics_sync_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pics_sync_state ENABLE ROW LEVEL SECURITY;

--
-- Name: publishers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.publishers ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_state ENABLE ROW LEVEL SECURITY;

--
-- Name: review_histogram; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_histogram ENABLE ROW LEVEL SECURITY;

--
-- Name: steam_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.steam_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: steam_genres; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.steam_genres ENABLE ROW LEVEL SECURITY;

--
-- Name: steam_news_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.steam_news_items ENABLE ROW LEVEL SECURITY;

--
-- Name: steam_news_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.steam_news_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: steam_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.steam_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_status ENABLE ROW LEVEL SECURITY;

--
-- Name: user_alert_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_alert_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: user_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: user_pin_alert_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_pin_alert_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_pins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_pins ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: waitlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict maVkRWOnRfbx7CVH4xHwzncQP3hTiPrNmfnKXesDcP1heXOQfRLz1k07uxeCPc1

