# PublisherIQ

Steam analytics platform for browsing games and companies, tracking change intelligence, and querying the catalog through an AI chat interface.

## Current Platform Model

- **TigerData (Timescale) + R2** are primary for accepted product-data writes, Tiger-backed admin product reads, and the contract-serving read plane.
- **Supabase Postgres** remains the auth/session/user-control authority plus retained reference and legacy exceptions.
- **Cube.js** remains in the stack for legacy and compatibility analytics paths that have not moved onto Tiger-backed contracts yet.
- **TypeScript workers** and the **PICS service** ingest, normalize, and project accepted source data into TigerData/R2 where the writer path is enabled; retained source/legacy flows still use Supabase where documented.
- **`@publisheriq/youtube`** adds Steam-scoped YouTube discovery, refresh, and daily rollup capture directly into TigerData for the chat coverage surface.

## Current Highlights

- **Change Feed** at `/changes` for grouped storefront, PICS, media, and news activity with health states
- **Games + Companies analytics** with Tiger-backed advanced filters, saved views, compare, and export
- **Unreleased Games tracker** at `/unreleased` for upcoming games, media readiness, timelines, news, Opportunity Score, and watch workflows
- **Insights dashboard** for top games, newest releases, and personalized monitoring
- **AI chat** backed by the Tiger query-api, streaming responses, and current change/news contract families
- **Per-game YouTube coverage in chat** for latest videos, creator coverage, top videos, growth, content mix, and cadence
- **OTP-first auth** with waitlist approval, `?next=` redirects, and hardened callback handling
- **Tiger contract surface** for entity resolution, catalog discovery, momentum discovery, semantic search, change analysis, news search, YouTube coverage, user context, and result continuation

## Quick Start

```bash
pnpm install
pnpm build
pnpm --filter @publisheriq/admin dev
```

The admin dashboard runs on `http://localhost:3001`.

For local contract-backed chat and search, also run:

```bash
pnpm --filter @publisheriq/data-plane build
pnpm --filter @publisheriq/query-api dev
```

By default, local admin development can point at `http://127.0.0.1:4318` for `QUERY_API_BASE_URL`. Deployed Vercel environments must set an explicit HTTPS `QUERY_API_BASE_URL`.

## Key Commands

```bash
pnpm build
pnpm lint
pnpm check-types

pnpm --filter @publisheriq/admin dev
pnpm --filter @publisheriq/query-api dev

pnpm --filter @publisheriq/ingestion applist-sync
pnpm --filter @publisheriq/ingestion storefront-sync
pnpm --filter @publisheriq/ingestion change-intel-worker
pnpm --filter @publisheriq/ingestion repair-storefront-authority

pnpm youtube:seed-routing
pnpm youtube:sync-discovery
pnpm youtube:sync-refresh

cd services/pics-service && pytest
```

Tiger refresh and parity commands are documented in:
- `apps/query-api/README.md`
- `packages/data-plane/README.md`
- `docs/developer-guide/deployment/tiger-chat-production.md`

## Documentation

Start with [docs/START-HERE.md](docs/START-HERE.md).

| Area | Path |
|------|------|
| Documentation index | [docs/README.md](docs/README.md) |
| Latest release | [docs/releases/v2.14-unreleased-games.md](docs/releases/v2.14-unreleased-games.md) |
| User guides | [docs/user-guide/](docs/user-guide/) |
| Admin guides | [docs/admin-guide/](docs/admin-guide/) |
| Developer guides | [docs/developer-guide/](docs/developer-guide/) |
| API docs | [docs/api/](docs/api/) |
| Reference docs | [docs/reference/](docs/reference/) |
| Release notes | [docs/releases/](docs/releases/) |

## Monorepo Layout

```text
publisheriq/
├── apps/admin/              # Next.js 15 dashboard
├── apps/query-api/          # Tiger-backed contract service
├── packages/data-plane/     # Query contracts, Tiger SQL, and sync scripts
├── packages/database/       # Supabase client + generated types
├── packages/ingestion/      # Steam clients, workers, change-intel runtime
├── packages/youtube/        # Steam-scoped YouTube collector and rollups
├── packages/shared/         # Shared utilities and logger
├── packages/cube/           # Cube.js semantic layer
├── services/pics-service/   # Python PICS microservice
├── supabase/migrations/     # Supabase schema and RPC migrations
└── docs/                    # Canonical documentation
```

## Runtime Ownership

| Surface | Primary Read Path | Primary Store |
|---------|-------------------|---------------|
| `/chat` supported contract families | Admin route -> `query-api` | TigerData |
| `/chat` YouTube coverage for one tracked game | Admin route -> `query-api` | TigerData |
| Chat logging, auth, credits | Admin route -> Supabase | Supabase |
| `/apps` | Admin server -> TigerData | TigerData |
| `/companies` | Admin server -> TigerData | TigerData |
| `/unreleased` | Admin server -> TigerData projection | TigerData |
| `/changes` | Supabase RPCs + projections | Supabase |
| `/admin` | Supabase RPCs + tables | Supabase |
| Legacy/compat analytics | Cube.js | Supabase |

## Core Routes

- `/dashboard` - home dashboard
- `/chat` - AI query interface
- `/insights` - top, newest, trending, and personalized views
- `/changes` - change feed and Steam news monitoring
- `/apps` - game analytics
- `/unreleased` - upcoming games and publisher opportunity tracker
- `/companies` - unified company analytics
- `/admin` - admin system status
- `/updates` - in-app patch notes

## License

Private.
