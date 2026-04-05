# Steam User Data Access And Scraping Research

> Research memo for PublisherIQ.
> Last updated: March 30, 2026

## Executive Summary

This memo answers a specific question: if you control the Steamworks account for a game, what user and community data can you officially access, what can you scrape from public Steam surfaces, and how far could you go in building user profiles?

Bottom line:

- If you own the game in Steamworks, Valve gives you strong aggregate business and marketing data for your own app, not a CRM-style list of all users.
- Official owner-only surfaces include wishlist history, regional and platform wishlist breakdowns, store and platform traffic reports, UTM campaign analytics, follower counts, event visibility stats, playtest signup and grant controls, moderation views for your community hub, and publisher-key API methods tied to operating your own game.
- Steam does **not** officially expose a first-party list of who wishlisted your game, a complete roster of all owners, or a general export of all followers for your game.
- Public Steam community surfaces expose a meaningful amount of user-generated content: reviews, review-author SteamIDs, forum threads and posts, announcement pages, comments, Workshop items, Workshop comments, curator pages, public group member pages, and public profile sections.
- A per-user profile graph across other games is only partially possible. It depends on discovering a user's SteamID first and then on that user's privacy settings. It is technically feasible in a narrow, public-data sense, but incomplete and high-risk as a product feature.

## Direct Answers

### Could I scrape community pages?

Yes, for pages that are already public.

The practical public surfaces are:

- app community hubs
- discussion indexes and threads
- reviews and the public review API
- announcement / news pages
- announcement comments
- Workshop item pages and comments
- curator pages
- public group pages and member lists
- public player profile pages

These are ordinary web pages or public endpoints. Steam also documents some public APIs such as the review list endpoint. The main limits are pagination, rate limits where documented, anti-abuse expectations, and user privacy settings.

### Could I collect usernames of forum posters?

Yes, on public discussion pages.

Steam community hubs and discussion threads show public persona names alongside thread and post content. If you own the game, moderation tools also expose reported posts inside your community hub. This is user-level content, but it is limited to the visible discussion surfaces you crawl.

### Could I get wishlist users?

Not through any supported owner-facing Steamworks surface.

Steamworks Wishlist Reporting gives you history of additions, purchases, and deletions, plus regional and platform breakdowns. It does **not** expose a list of user accounts who wishlisted the game.

The only indirect path would be broad crawling of public user profiles and public wishlist pages, then checking whether a specific game appears there. That is not a game-centric wishlist audience feed, would never be complete, and is exactly the kind of profiling-heavy workflow that should be treated as high-risk.

### Could I grab all users and all the content they post?

No, not completely.

You can collect all content that is publicly visible on the surfaces you crawl and successfully paginate, but there is no single public index for all Steam users or all Steam content. Steam privacy settings hide many profile surfaces, some content only exists behind product-specific pages, and not every user or contribution is discoverable from one place.

For a specific game, you can get much closer on public reviews, public discussions, public Workshop content, and public announcement comments. For Steam as a whole, "all users and all content" is not realistic.

### Could I build profiles from those users by looking at their other games?

Partially, yes. Reliably and safely, no.

The feasible path is:

1. Discover a user from a public surface such as a review, discussion post, Workshop item, or public profile link.
2. Resolve or store the user's SteamID.
3. Pull whatever that user has made public through their profile or Steamworks API-exposed profile data.

What you may be able to see for a public profile includes:

- persona name and avatar
- owned games
- review counts and review pages
- badges
- friends
- groups
- recent activity
- sometimes wishlist visibility

What blocks completeness:

- many profiles are private or friends-only
- not every relevant field is public
- your owner-only data for your game does not automatically grant visibility into a user's activity in other games
- Valve's privacy policy and API terms make broad user-level profiling a poor fit for a commercial intelligence product

For PublisherIQ, the safer direction is aggregate cohort analysis and public-content monitoring, not individual dossiers.

## Official Owner-Only Surfaces

| Surface | Access path | What you can see | User-level or aggregate | User identifiers exposed | What you cannot get | PublisherIQ fit |
| --- | --- | --- | --- | --- | --- | --- |
| Wishlist reporting | Steamworks Sales & Activation Reports Portal | History of wishlist additions, purchases, deletions; regional wishlist counts; platform-specific wishlisting; CSV fields such as `DateLocal` and `MonthCohort` | Aggregate | None | No list of who wishlisted | High for demand and conversion analysis |
| Store and platform traffic reporting | Steamworks traffic reports | Impressions, visits, and other traffic breakdowns for your app and landing pages | Aggregate | None | No visitor-level export | High for campaign and merchandising analysis |
| UTM analytics | Steamworks UTM Analytics | Visits and conversion performance for tagged external campaigns | Aggregate | None | No clickstream or user list | High for campaign attribution |
| Followers | Steamworks Followers reporting / app community admin | Follower counts and follower trend context for your game's official group presence | Aggregate | None officially surfaced in docs | No supported follower-user export | Medium for audience-size tracking |
| Event visibility stats | Steam Events & Announcements reporting | Unique logged-in users who saw or clicked an event, broken down by location on Steam | Aggregate | None | No list of who saw or clicked | High for launch / update comms analysis |
| Playtest controls | Steam Playtest dashboard | Signup flow, pending-interest pool, batched access grants, country targeting, friend invites, and direct-key distribution controls | Mixed, but operational rather than analytics-first | Steam knows the users you grant access to, but the docs do not present this as a bulk audience export surface | No general marketing-grade user export | Medium for owned-game ops, weak for competitor intelligence |
| Community moderation | Steamworks community moderation tools | Reported posts, report descriptions, moderation queues, thread management tools, hidden reported-posts forum | User-level for your own hub | Persona names on the moderated content | No cross-Steam user export | Medium for community operations |
| Publisher-key ownership methods | `ISteamUser` and related Steamworks Web APIs | Per-user ownership checks for your app, ownership state, Family Sharing owner, deletion feed for accounts that owned your app before deletion | User-level, targeted | SteamID for specific checks and deletion workflows | No full owner roster dump | Medium for app operations and compliance |
| Game-implemented Steamworks systems | Steamworks API / Web API for your own game | Depending on implementation: leaderboard data, achievements, progress, matchmaking, inventory, and support-related user data | User-level | SteamID and game-specific records | No right to see other games' private data | High for game ops, low for market intel |

## Public And Publicly Scrapeable Surfaces

| Surface | Access path | What is public | User-level or aggregate | User identifiers exposed | Main limit | PublisherIQ fit |
| --- | --- | --- | --- | --- | --- | --- |
| Review API and review pages | Public review endpoint and Steam review pages | Review text, timestamps, helpfulness, purchase flags, comment counts, and author block with SteamID and playtime metadata | User-level | SteamID plus visible review author identity on page | Limited to reviews that exist for that app; paginated | High for public-content and reviewer-pattern analysis |
| Community hub discussions | Public app discussion pages and threads | Thread titles, public persona names, post text, timestamps, pinned topics, forum structure | User-level | Persona names and profile links | Only visible threads/posts; no universal index | High for community monitoring |
| App community hub | Public app hub page | Tabs for discussions, news, guides, reviews, screenshots, artwork, broadcasts, videos | Mixed | Visible public content only | A directory, not a full user list | High as a crawl entrypoint |
| Announcements / news pages | Public community news pages and Steam news APIs | Titles, bodies, dates, feeds, related links; some pages expose RSS links | Mostly content-level | Author / poster context depends on page | Good for official comms only, not user behavior | High for change tracking |
| Announcement comments | Public community event comment pages | Comment text, persona names, timestamps | User-level | Persona names and profile links | Only comments on that announcement | Medium for community sentiment |
| Workshop items | Public Workshop pages and `IPublishedFileService/QueryFiles` | Item metadata, creator, tags, pagination, popularity counters, previews | User-level for creators; aggregate counters for item popularity | Creator identity, published file id | Subscriber identities are not generally exposed | Medium for modding-community signals |
| Workshop comments | Public Workshop comment pages | Comment text, persona names, timestamps | User-level | Persona names and profile links | Only visible comments on the crawled item | Medium for community monitoring |
| Curator pages | Public curator pages on the Steam store | Curator identity, recommendation text, app coverage, follower count, recommendation counts | User-level at curator-account level | Curator page identity | Only curator-facing content, not end-user activity | Medium for influencer / curator monitoring |
| Public group pages and member lists | Public Steam Community group pages | Group identity, member counts, public member-list pages on many groups | User-level where the group exposes a member page | Persona names and profile links | Not every relevant audience is a public group; game followers are not guaranteed to map cleanly to a scrapeable member list | Low to medium; use cautiously |
| Public player profiles | Public Steam Community profile pages | Persona, avatar, owned-game counts, reviews, friends, groups, badges, recent activity, comments, and sometimes wishlist visibility | User-level | SteamID / vanity URL, persona name | Entirely constrained by profile privacy | High-risk; only partial enrichment |

## What This Means By Question

### 1. Owner access is strong for aggregate commercial data

If you control the game in Steamworks, you can answer questions like:

- How many wishlists did we gain by day, region, and platform preference?
- Which UTM-tagged campaign drove visits and downstream conversions?
- How many unique logged-in users saw or clicked our announcement?
- How much store traffic did a release, sale, or campaign generate?

You generally **cannot** answer:

- Which exact users wishlisted us?
- Who exactly clicked this announcement?
- Give me every follower's SteamID or email address.

### 2. Public scraping is strongest on content surfaces, not customer lists

The public web gives you the most leverage on:

- reviews
- forum discussions
- announcement comments
- Workshop items and comments
- public curator content
- public profiles

This means PublisherIQ could plausibly build:

- public community monitoring
- review-text topic extraction
- forum issue clustering
- public creator / curator relationship maps
- public-profile enrichment for a subset of discovered users

This does **not** mean PublisherIQ should try to build:

- a shadow CRM of Steam users
- a full wishlist-user graph
- a complete cross-game dossier for individual players

### 3. Profiling users across games is technically partial and strategically risky

There is a real technical path to limited public-profile enrichment:

- review author SteamID -> public profile -> owned games, reviews, groups, friends, activity
- Workshop creator profile -> same
- discussion profile link -> same

But the coverage problem is fundamental:

- if the profile is private, the graph collapses
- if the relevant section is hidden, enrichment stops
- if the user never posts publicly, there is nothing to anchor from

Even when technically possible, Valve's privacy policy is explicit that public profile data can be accessed automatically through the Steamworks API, while game developers and publishers get certain additional data only as it directly relates to operating the games they run. That is not a green light for broad commercial profiling.

## Recommended PublisherIQ Posture

### Safe to build

- Aggregate owner-only analytics for your own games
- Public community content monitoring for specific apps
- Review and discussion ingestion for text analysis
- Public curator and Workshop ecosystem monitoring
- Cohort and topic analysis that does not center individual users

### Possible but policy-sensitive

- Linking a review author or Workshop creator to their public profile
- Building profile enrichment only from data the user has made public
- Measuring overlap between public reviewers / posters across multiple apps

These should be opt-in internally, heavily rate-limited, and clearly separated from any lead-gen or outreach workflow.

### Not a good product direction

- Enumerating or selling wishlist-user lists
- Building a full per-user Steam graph for commercial targeting
- Treating follower counts as if they implied a supported follower-export API
- Using collected Steam identifiers for unsolicited outreach or direct marketing
- Claiming you can collect "all users" for a game unless you strictly mean all publicly visible authors on a bounded set of pages

## Source Notes

This memo relies on current official Steamworks documentation plus direct observation of public Steam community pages on March 30, 2026.

Official owner-only and policy sources:

- [Wishlist Reporting](https://partner.steamgames.com/doc/marketing/wishlist/reporting)
- [Store and Platform Traffic Reporting](https://partner.steamgames.com/doc/marketing/traffic_reporting)
- [UTM Analytics](https://partner.steamgames.com/doc/marketing/utm_analytics)
- [Followers](https://partner.steamgames.com/doc/marketing/followers)
- [Events and Announcements Visibility Stats Reporting](https://partner.steamgames.com/doc/marketing/event_tools/stats)
- [Steam Playtest](https://partner.steamgames.com/doc/features/playtest)
- [Community Moderation](https://partner.steamgames.com/doc/marketing/community_moderation)
- [Authentication using Web API Keys](https://partner.steamgames.com/doc/webapi_overview/auth)
- [ISteamUser Interface](https://partner.steamgames.com/doc/webapi/isteamuser)
- [IPublishedFileService Interface](https://partner.steamgames.com/doc/webapi/IPublishedFileService)
- [User Reviews - Get List](https://partner.steamgames.com/doc/store/getreviews)
- [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms)
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/)
- [Steam Privacy Policy](https://store.steampowered.com/privacy_agreement/)

Representative public-surface observations:

- [Example public app community hub](https://steamcommunity.com/app/3653590)
- [Example public Workshop comments page](https://steamcommunity.com/sharedfiles/filedetails/comments/2599784515)
- [Example public announcements listing](https://steamcommunity.com/groups/japanization/announcements/listing)
- [Example public Steam profile](https://steamcommunity.com/profiles/76561198027584758)
- [Example public Steam group members page](https://steamcommunity.com/groups/LXG2015/members)
- [Example public curator page](https://store.steampowered.com/curator/45031235-Best-free-hidden-gems-and-unique-game/?appid=1368340)

Important interpretation rules:

- `Official owner-only` means documented by Valve as a Steamworks or Steamworks Web API surface tied to the game you operate.
- `Public scrapeable` means visible on public pages or public endpoints today, not that Valve endorses broad scraping.
- `Observed but not guaranteed` applies to community pages where the behavior is visible now but not promised as a stable API contract.
- Steam's Web API terms are materially narrower than "anything technically visible is fair game"; they explicitly restrict use in advertising networks and direct marketing contexts.
