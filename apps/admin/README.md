# Admin Dashboard

Next.js 15 dashboard for PublisherIQ.

## Overview

The dashboard provides:

- game and company analytics
- the `/changes` Change Feed
- Insights and personalization surfaces
- admin system-status pages, catalog control, and CCU quality
- OTP-first authentication and invite/waitlist flows

## Development

```bash
pnpm --filter @publisheriq/admin dev
pnpm --filter @publisheriq/admin build
pnpm --filter @publisheriq/admin start
pnpm --filter @publisheriq/admin lint
```

The development server runs on `http://localhost:3001`.

Browser smoke tests run from the repo root:

```bash
pnpm test:e2e
pnpm test:e2e:headed
```

The Playwright smoke suite targets `/chat` on the local admin dev server and mocks
`/api/chat/stream`, `/api/search`, and `/api/autocomplete/tags` so it stays deterministic.

For the main full prompt-quality pass against the local Tigerdata-backed stack, run:

```bash
pnpm chat-evals:full-blended-endpoint
```

That endpoint runner hits the same `/api/chat/stream` route the UI uses, normalizes the
assistant output into visible-like text for scoring, and writes ranked artifacts under
`/tmp/publisheriq-chat-evals/`. It expects your local admin server and local `query-api`
to already be running unless you pass `--origin` to another reachable target. The same
run now also writes tool/backend audit artifacts such as `prompt-tool-traces.json`,
`tool-usage-summary.json`, `backend-usage-summary.json`, and `migration-matrix.md` so you
can see which prompts still depend on legacy Supabase or Cube answer-path reads.

For a smaller UI-level smoke pass through the real `/chat` page, run:

```bash
pnpm chat-evals:full-blended-ui
```

## Important Routes

| Route | Purpose |
|-------|---------|
| `/` | Public landing page |
| `/login` | OTP-first login |
| `/waitlist` | Access request flow |
| `/dashboard` | Signed-in home dashboard |
| `/chat` | AI query interface |
| `/insights` | Top, newest, trending, and personalized insights |
| `/changes` | Steam Activity and Steam news |
| `/apps` | Games analytics |
| `/companies` | Unified publisher/developer browse surface |
| `/publishers/[id]` | Publisher detail page |
| `/developers/[id]` | Developer detail page |
| `/account` | Profile and credits |
| `/admin` | System status, catalog control, and CCU quality |
| `/admin/users` | User administration |
| `/admin/waitlist` | Waitlist review |
| `/admin/usage` | Credit usage analytics |
| `/updates` | In-app patch notes |

## Structure

```text
src/
├── app/
│   ├── (auth)/                  # Login + waitlist
│   ├── (main)/                  # Signed-in routes
│   │   ├── apps/                # Games page
│   │   ├── changes/             # Change Feed UI + server helpers
│   │   ├── companies/           # Unified companies page
│   │   ├── insights/            # Insights dashboard
│   │   └── admin/               # Admin pages
│   ├── api/                     # Internal route handlers
│   └── auth/                    # Auth callback + confirm handlers
├── components/                  # Shared UI and feature components
├── contexts/                    # Sidebar and theme context
├── hooks/                       # Client hooks
└── lib/                         # Auth, Supabase, LLM, search, and data helpers
```

## Auth and Environment

Required variables:

```bash
NEXT_PUBLIC_SITE_URL=https://www.publisheriq.app
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
```

Optional diagnostics:

```bash
NEXT_PUBLIC_AUTH_DEBUG=false
```

Notes:

- The login UI is OTP-first with 8-digit codes and a 10-minute expiry.
- Protected-route redirects use `?next=...`, not `?redirect=...`.
- `NEXT_PUBLIC_SITE_URL` is required for safe callback and redirect handling.

## Related Documentation

- [Documentation Index](../../docs/README.md)
- [Change Feed User Guide](../../docs/user-guide/change-feed.md)
- [Change Feed Developer Guide](../../docs/developer-guide/features/change-feed.md)
- [Admin Guide](../../docs/admin-guide/overview.md)
