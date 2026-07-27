# Route and API Regression Closeout

Status captured on 2026-07-27 UTC against production
`https://www.publisheriq.app`.

## Public and unauthenticated contracts

A clean unauthenticated HTTP sweep produced:

| Contract        | Routes                                                                                                                 | Result                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Public pages    | `/`, `/login`, `/waitlist`                                                                                             | `200`                                         |
| Protected pages | `/dashboard`, `/apps`, `/companies`, `/unreleased`, `/insights`, `/changes`, `/chat`, `/youtube`, `/account`, `/admin` | `307` to the exact `/login?next=%2F...` route |
| Protected APIs  | `/api/apps`, `/api/change-feed/activity`, `/api/change-feed/status`, `/api/pins`, `/api/alerts`                        | `401`                                         |

No unexpected `5xx` response occurred.

## Authenticated production checks

The existing authenticated browser session exercised the following read-only
or navigation behavior:

| Surface             | Evidence                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard           | Current cards and navigation rendered.                                                                                                                        |
| Apps                | Populated 50-row Tiger v2 table, 127.3K Games count, metrics, sorting controls, app links, and app detail `/apps/730` rendered.                               |
| Apps filter         | `Free` produced `/apps?filters=free&isFree=true`, a 21.2K Games count, 21K filtered results, and Free-priced rows; clearing it restored `/apps`.              |
| Publishers          | Populated table rendered; Valve navigated to `/publishers/1527` with summary, review, games, network, taxonomy, platform, and portfolio data.                 |
| Developers          | Populated table rendered; Valve navigated to `/developers/1530` with summary and games data.                                                                  |
| Unreleased          | Current 50-row table rendered with 50,585 tracked games and current source/activity columns.                                                                  |
| Unreleased filter   | `Launch 30d` produced `/unreleased?sort=release_date&order=asc&releaseStatus=dated_future&maxDaysUntilRelease=30` and 50 visible rows sorted by release date. |
| Unreleased detail   | The first result opened a populated detail dialog with overview, media, timeline, news, App, Steam, publisher, and developer navigation.                      |
| Unreleased timeline | Populated Storefront, PICS, Media, and News history rendered, including the `Load more` contract.                                                             |
| Insights            | 30-day Top Games and trend data rendered from Tiger.                                                                                                          |
| Change Feed         | Capture reported healthy, 25 rows rendered, and the first activity inspector displayed its detail sections.                                                   |
| Chat                | Composer loaded enabled with current entity affordances. No message was sent because that would consume credits and create logs.                              |
| YouTube Pulse       | Current list rendered; `View all videos` opened a populated inspector with external YouTube links and no hydration error.                                     |
| Account             | Account display and enabled Sign out control rendered. Sign out was not invoked.                                                                              |
| Admin               | Current Tiger product, PICS, Alert Detection, and Histogram job panels rendered.                                                                              |

No browser error was reported during the final Apps, Companies, developer,
publisher, or Unreleased interaction sweep. The app-detail chart emitted only
transient Recharts width warnings, not runtime errors.

The Unreleased `Export Visible` button was enabled and invoked. Its implementation
uses a client-created Blob download, which the connected browser harness did
not surface as a download event. The deterministic CSV generator remains
covered by its passing unit tests, but this record does not overclaim capture
of the downloaded file.

## Repaired route gaps and production deployment

PR #81 merged at commit
`149472cbd86554ab3d5568f6d75da8707de9b10e`. Its production Vercel
deployment completed at `2026-07-27T05:00:17Z`, and the concurrently triggered
Query API Railway deployment completed at `05:00:09Z`.

Authenticated production verification after deployment found:

- `/apps` rendered `Showing 1–50 of 126,993`, `Page 1 of 2,540`, disabled
  Previous, and enabled Next;
- activating Next produced `/apps?offset=50`, `Showing 51–100 of 126,993`,
  `Page 2 of 2,540`, and enabled both directions;
- applying `Free` from page 2 removed the offset and produced
  `/apps?filters=free&isFree=true`, `Showing 1–50 of 21,089`, and
  `Page 1 of 422`; and
- Admin rendered current Tiger/PICS health and the latest jobs without a
  browser error.

PR #81 also centralized the Admin Actions URL on
`https://github.com/draknorr/piq/actions/runs/<id>`. Its two helper tests pass
and the production bundle is deployed. None of the latest 15 visible job rows
had a `github_run_id`, so the conditional external link was not rendered and
this record does not overclaim a production click.

The production page-2 smoke exposed one final presentation gap: the visible
range was global, but the `#` column restarted at 1–50. PR #82 passes the page
offset into both desktop and mobile ranks so page 2 renders 51–100. All 266
Admin tests and the optimized production build pass; production deployment and
one final rank smoke remain.

## Intentionally open mutation and authorization checks

The following tests require a disposable user or records and remain open:

- pin creation, update, alert-setting change, and removal;
- alert read state, preferences, and delivered-alert counts with an
  alert-enabled pin;
- pinned-item mutations in Insights;
- account sign-out and session restoration;
- non-admin role-negative Admin access; and
- Chat message execution where credit and log mutations are expected.

Existing production records were not repurposed for these tests. The
preparation closeout must either receive an approved disposable-record strategy
or continue to label these branches unverified.
