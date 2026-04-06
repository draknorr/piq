# @publisheriq/database

Supabase client factories, ingestion helpers, and TypeScript types for PublisherIQ.

## Overview

This package provides:
- pre-configured Supabase clients
- ingestion helper functions used by workers and repair scripts
- auto-generated TypeScript types from the Supabase schema
- type-safe Supabase database operations

## Installation

This is a workspace package, included automatically:

```json
{
  "dependencies": {
    "@publisheriq/database": "workspace:*"
  }
}
```

## Usage

### Server-Side (Service Role)

Use `createServiceClient()` for server-side operations with full Supabase access:

```typescript
import { createServiceClient } from '@publisheriq/database';

const supabase = createServiceClient();

const { data, error } = await supabase
  .from('apps')
  .select('*')
  .limit(10);
```

The package also exports the singleton-oriented `getServiceClient()` helper for worker and runtime code that wants to reuse a cached pool.

### Browser-Side (Anon Key)

Use `createBrowserClient()` for client-side operations with RLS:

```typescript
import { createBrowserClient } from '@publisheriq/database';

const supabase = createBrowserClient();
```

**Note:** Browser client requires RLS policies for data access.

## Types

Types are auto-generated from the Supabase schema:

```typescript
import type { Database } from '@publisheriq/database';

type App = Database['public']['Tables']['apps']['Row'];
type Publisher = Database['public']['Tables']['publishers']['Row'];
```

### Regenerating Types

When the database schema changes:

```bash
# Set your Supabase project ID
export SUPABASE_PROJECT_ID=xxx

# Generate types
pnpm --filter @publisheriq/database generate-types
```

This updates `src/types.ts` with the latest schema.

## Exports

```typescript
// Clients
export { createServiceClient } from './client';
export { createBrowserClient } from './client';

// Types
export type { Database } from './types';
```

## Environment Variables

Required for clients to function:

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...  # For service client
```

This package does not connect to TigerData directly. TigerData access lives in `@publisheriq/data-plane` and `apps/query-api`.

## Scripts

```bash
# Build package
pnpm --filter @publisheriq/database build

# Type check
pnpm --filter @publisheriq/database check-types

# Generate types from Supabase
pnpm --filter @publisheriq/database generate-types
```

## Project Structure

```
src/
├── index.ts     # Package exports
├── client.ts    # Supabase client factories
└── types.ts     # Auto-generated types
```

## Related Documentation

- [Database Schema](../../docs/developer-guide/architecture/database-schema.md)
- [Supabase Setup](../../docs/developer-guide/deployment/supabase.md)
