# Getting Started

This guide covers the current PublisherIQ entry flow, main routes, and the fastest way to get useful data into a local environment.

## 1. Start the App

```bash
pnpm install
pnpm build
pnpm --filter @publisheriq/admin dev
```

Open `http://localhost:3001`.

## 2. Sign In

PublisherIQ uses invite-only, OTP-first authentication.

1. Go to `/login`
2. Enter your approved email address
3. Wait for the 8-digit code
4. Enter the code within 10 minutes
5. You will be redirected to the page you originally requested through `?next=...`

If your email is not approved yet, use `/waitlist`.

## 3. Learn the Main Routes

| Route | What it is for |
|------|----------------|
| `/dashboard` | Signed-in home page |
| `/chat` | AI query interface |
| `/insights` | Top, newest, trending, and personalized views |
| `/changes` | Unified Steam change feed and news activity |
| `/apps` | Games analytics |
| `/unreleased` | Upcoming games and publisher opportunity tracker |
| `/companies` | Unified publishers/developers analytics |
| `/account` | Profile and credit balance |
| `/admin` | Admin-only system status |
| `/updates` | In-app patch notes |

## 4. Seed Core Data

For a local or fresh environment, these are the most useful first runs:

```bash
pnpm --filter @publisheriq/ingestion applist-sync
pnpm --filter @publisheriq/ingestion steamspy-sync
pnpm --filter @publisheriq/ingestion storefront-sync
pnpm --filter @publisheriq/ingestion reviews-sync
pnpm --filter @publisheriq/ingestion histogram-sync
pnpm --filter @publisheriq/ingestion calculate-trends
```

Optional change-intelligence workflows:

```bash
pnpm --filter @publisheriq/ingestion app-change-hints
pnpm --filter @publisheriq/ingestion change-intel-worker
```

If you want the newest change-intelligence surfaces to stay current, keep both `app-change-hints` and `change-intel-worker` running in addition to the warehouse syncs.

## 5. Sanity-Check the Product

After the app is running and you have data:

- open `/apps` and confirm games load
- open `/unreleased` and confirm upcoming games load when the Tiger projection is present
- open `/companies` and confirm company metrics load
- open `/changes` and confirm the feed and news tabs populate when the change-intel surfaces are present
- open `/chat` and ask a simple warehouse question

## 6. What to Read Next

- [Change Feed](./change-feed.md)
- [Games Page](./games-page.md)
- [Unreleased Games](./unreleased-games.md)
- [Companies Page](./companies-page.md)
- [Chat Interface](./chat-interface.md)
- [Account](./account.md)
- [Developer Setup](../developer-guide/setup.md)
