# PublisherIQ Documentation

Choose the path that matches what you need today.

## I’m Using PublisherIQ

Start with:
- [User Guide](./user-guide/getting-started.md)
- [Change Feed Guide](./user-guide/change-feed.md)
- [Unreleased Games Guide](./user-guide/unreleased-games.md)
- [Account Guide](./user-guide/account.md)

## I’m Administering PublisherIQ

Start with:
- [Admin Guide Overview](./admin-guide/overview.md)
- [Dashboard Guide](./admin-guide/dashboard.md)
- [Troubleshooting](./admin-guide/troubleshooting.md)

## I’m Developing PublisherIQ

Start with:
- [Developer Setup](./developer-guide/setup.md)
- [System Overview](./developer-guide/architecture/overview.md)
- [TigerData Operating Model](./developer-guide/architecture/tigerdata-operating-model.md)
- [Query API README](../apps/query-api/README.md)
- [YouTube Collector README](../packages/youtube/README.md)

Current data-plane rule: Tiger/R2 are primary for accepted incoming ingestion and product-data paths and for the main Tiger-backed product reads. Supabase remains for auth/session/user-control surfaces, reference/legacy exceptions, and routes explicitly documented as retained.

## Quick Links

- [Latest Release Notes](./releases/v2.14-unreleased-games.md)
- [API Overview](./api/overview.md)
- [Reference Docs](./reference/)
