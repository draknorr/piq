# Installation

This guide walks you through cloning and setting up PublisherIQ locally.

## 1. Clone the Repository

```bash
git clone https://github.com/yourusername/publisheriq.git
cd publisheriq
```

## 2. Install Dependencies

PublisherIQ uses pnpm workspaces to manage the monorepo.

```bash
# Install all dependencies
pnpm install
```

This installs dependencies for:
- `apps/admin` - Next.js dashboard
- `packages/data-plane` - TigerData contracts, bootstrap, and backfills
- `packages/database` - Supabase client
- `packages/ingestion` - Data workers
- `packages/youtube` - Steam-scoped YouTube collector and rollups
- `packages/shared` - Shared utilities

## 3. Build Packages

Build the shared packages that other apps depend on:

```bash
# Build all packages
pnpm build
```

## 4. Set Up Environment

Create environment files for local development:

```bash
# Copy example env file (if exists)
cp .env.example .env

# For the admin app
cp apps/admin/.env.example apps/admin/.env.local
```

See [Environment Setup](setup.md) for detailed configuration.

## 5. Set Up Database

### Apply Migrations

The live product database is defined in Supabase migrations. Apply them via the Supabase dashboard:

1. Go to your Supabase project
2. Navigate to **SQL Editor**
3. Run each migration file from `supabase/migrations/` in order

Migration files are numbered chronologically:
```
supabase/migrations/
├── 20240101000000_initial_schema.sql
├── 20240102000000_add_indexes.sql
└── ...
```

### Verify Schema

After applying migrations, verify the Supabase-side tables exist:
- `apps`
- `publishers`
- `developers`
- `daily_metrics`
- `review_histogram`
- `app_trends`
- `sync_status`
- `sync_jobs`

## 6. Verify Installation

Run type checking to ensure everything is set up correctly:

```bash
pnpm check-types
```

Start the development server:

```bash
pnpm --filter @publisheriq/admin dev
```

Visit [http://localhost:3001](http://localhost:3001) to see the dashboard.

For the local contract-backed chat stack, also run:

```bash
pnpm --filter @publisheriq/query-api dev
```

## Project Structure

After installation, your directory should look like:

```
publisheriq/
├── apps/
│   └── admin/              # Next.js dashboard
├── packages/
│   ├── data-plane/         # TigerData contracts, bootstrap, backfills
│   ├── database/           # Supabase client + types
│   ├── ingestion/          # API clients and workers
│   ├── youtube/            # YouTube collector and rollups
│   └── shared/             # Logger, errors, constants
├── services/
│   └── pics-service/       # Python PICS microservice
├── supabase/
│   └── migrations/         # Database schema
├── .github/
│   └── workflows/          # GitHub Actions
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## Troubleshooting

### pnpm install fails

```bash
# Clear pnpm cache
pnpm store prune

# Delete node_modules and reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

### Build fails with type errors

```bash
# Regenerate database types
pnpm --filter database generate

# Rebuild all packages
pnpm build
```

### Port 3000 already in use

```bash
# Use a different port
pnpm --filter @publisheriq/admin dev -- --port 3001
```

## Next Steps

1. [Environment Setup](setup.md) - Configure all environment variables
2. [Running Workers](workers/running-workers.md) - Run bounded sync and operator commands
3. [Getting Started](../user-guide/getting-started.md) - Validate the product routes locally
