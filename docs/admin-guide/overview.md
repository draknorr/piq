# Admin Guide Overview

This guide covers the admin-only surfaces in PublisherIQ.

> Access requires an authenticated admin user. Protected-route redirects use `/login?next=...`.

## Quick Start

| Task | Route | Guide |
|------|-------|-------|
| Monitor system health | `/admin` | [Dashboard](./dashboard.md) |
| Review sync queue, catalog control, and PICS coverage | `/admin` | [Dashboard](./dashboard.md) |
| Manage users | `/admin/users` | [Dashboard](./dashboard.md#user-management) |
| Review waitlist requests | `/admin/waitlist` | [Dashboard](./dashboard.md#waitlist-management) |
| Review credit usage | `/admin/usage` | [Dashboard](./dashboard.md#usage-analytics) |
| Debug chat issues | `/admin` | [Chat Logs](./chat-logs.md) |
| Debug YouTube chat coverage | `/admin` | [Chat Logs](./chat-logs.md) |
| Troubleshoot auth or runtime issues | `/admin` | [Troubleshooting](./troubleshooting.md) |

## Admin Pages

### `/admin`

The main dashboard focuses on operational status:

- status bar
- data completion by source
- catalog control
- CCU quality
- sync queue health
- PICS service metrics
- sync errors
- recent jobs
- chat logs, including Tiger route families such as YouTube coverage

### `/admin/users`

- inspect user accounts
- change roles
- adjust credit balances

### `/admin/waitlist`

- approve or reject access requests
- review applicant metadata

### `/admin/usage`

- analyze credit consumption
- inspect top users and tool usage
- compare 7d, 30d, and 90d activity windows

## Common Workflows

| Workflow | Where to start |
|----------|----------------|
| New user cannot sign in | `/admin/waitlist` and [Troubleshooting](./troubleshooting.md) |
| User needs more credits | `/admin/users` |
| Queue or PICS health looks off | `/admin` |
| Chat feels slow or tool-heavy | `/admin` chat logs section |
| YouTube chat coverage looks wrong | `/admin` chat logs and [Troubleshooting](./troubleshooting.md) |

## Related Documentation

- [Dashboard Guide](./dashboard.md)
- [Chat Logs](./chat-logs.md)
- [Troubleshooting](./troubleshooting.md)
- [Admin Dashboard Architecture](../developer-guide/features/admin-dashboard.md)
