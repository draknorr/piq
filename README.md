# PublisherIQ

Steam analytics platform for browsing games and companies, tracking change intelligence, and querying the warehouse through an AI chat interface.

## Current Highlights

- **Change Feed** at `/changes` for grouped storefront, PICS, media, and news activity with health states
- **Games + Companies analytics** with advanced filters, saved views, compare, and export
- **Insights dashboard** for top games, newest releases, and personalized monitoring
- **AI chat** backed by Cube.js, Qdrant, streaming responses, and recent-news / change-intel tools
- **OTP-first auth** with waitlist approval, `?next=` redirects, and hardened callback handling
- **Change-intelligence runtime** across TypeScript workers, SQL read surfaces, app-capture work state, and the PICS service

## Quick Start

```bash
pnpm install
pnpm build
pnpm --filter @publisheriq/admin dev
```

The dashboard runs on `http://localhost:3001`.

## Key Commands

```bash
pnpm build
pnpm lint
pnpm check-types

pnpm --filter @publisheriq/admin dev

pnpm --filter @publisheriq/ingestion applist-sync
pnpm --filter @publisheriq/ingestion storefront-sync
pnpm --filter @publisheriq/ingestion change-intel-worker

cd services/pics-service && pytest
```

## Documentation

Start with [docs/START-HERE.md](docs/START-HERE.md).

| Area | Path |
|------|------|
| Documentation index | [docs/README.md](docs/README.md) |
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
├── packages/database/       # Supabase client + generated types
├── packages/ingestion/      # Steam clients, workers, change-intel runtime
├── packages/qdrant/         # Qdrant client + collection schemas
├── packages/shared/         # Shared utilities and logger
├── packages/cube/           # Cube.js semantic layer
├── services/pics-service/   # Python PICS microservice
├── supabase/migrations/     # Database migrations
└── docs/                    # Canonical documentation
```

## Core Routes

- `/dashboard` - home dashboard
- `/chat` - AI query interface
- `/insights` - top, newest, trending, and personalized views
- `/changes` - change feed and Steam news monitoring
- `/apps` - game analytics
- `/companies` - unified company analytics
- `/admin` - admin system status
- `/updates` - in-app patch notes

## License

Private.
