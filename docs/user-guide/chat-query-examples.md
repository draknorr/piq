# Chat Query Examples

Curated examples for the PublisherIQ chat interface.

**Last Updated:** April 13, 2026

> Related docs:
> - [Chat Interface Guide](./chat-interface.md)
> - [Streaming API](../api/streaming-api.md)
> - [Change Feed Guide](./change-feed.md)

---

## Quick Reference

| Want to... | Use this kind of query |
|------------|------------------------|
| Look up one game | Start with a title lookup, then ask about that title |
| Compare similar games | Ask for similar games |
| Find something by tags or concepts | Ask for a tag or concept search |
| Find trending games | Ask for a momentum screen or trending screen |
| Ask what changed on one title | Ask for a game timeline |
| Inspect the latest Steam news item | Ask for the latest news item |
| Summarize recent news for one or more titles | Ask for a news digest |
| Search recent news by topic | Ask for topic search |
| Check YouTube coverage for a game | Ask for a YouTube coverage view |
| Drill into one change card | Ask for change detail |
| Compare before and after | Ask for before/after comparison |
| Find marketing / launch patterns | Ask for change-pattern analysis |

---

## 1. Specific Game Lookups

Use these when you want facts about a single title.

Examples:

- "Tell me about Hades II"
- "What are the reviews for Elden Ring?"
- "Is Stardew Valley on Steam Deck?"
- "Does ARC Raiders have Workshop support?"

Good follow-up questions:

- "Show me the release date and current price"
- "What are the developer and publisher?"
- "What changed on this game in the last 90 days?"

---

## 2. Discovery and Ranking

Use these when you want a list, a comparison, or a discovery result.

Examples:

- "What are the top games by review score?"
- "Show me games similar to Hades but less popular"
- "Which free games are getting the most players right now?"
- "What games are breaking out this week?"
- "Find cozy farming games with crafting"
- "Show me Steam Deck verified roguelikes with at least 1,000 reviews"

More targeted prompts:

- "Games on sale with overwhelmingly positive reviews"
- "Action RPGs released in 2025"
- "Games with full controller support and strong reviews"
- "High-momentum indie games"

---

## 3. Change Intelligence

Use these for one-title change timelines, broader change feeds, and before/after analysis.

Examples:

- "What changed on Hades II in the last 90 days?"
- "Show me recent Steam activity for No Rest for the Wicked"
- "What changed before the last update?"
- "Compare the before and after for that announcement"
- "What are the biggest store-page changes in the last 30 days?"

Useful pattern prompts:

- "Find games that look like marketing pushes"
- "Show me signable candidates"
- "Find rescue candidates"
- "Which games had an announcement but weak downstream response?"

---

## 4. Recent Steam News

Use these when the question is specifically about stored Steam news content.

Examples:

- "What actually changed in the latest Steam news for ARC Raiders?"
- "Summarize recent Steam news for ARC Raiders"
- "Summarize recent Steam news across ARC Raiders and THE FINALS"
- "Which of those two titles had the most material recent Steam news change?"
- "What games have released developer diaries lately?"
- "Which games posted patch notes lately?"
- "What games mentioned a roadmap in recent Steam news?"

Notes:

- Ask for the latest news item when you want the newest post only.
- Ask for a digest when you want a bounded summary across one or a few titles.
- Ask for topic search when you care about content across many games rather than one named title.

---

## 5. YouTube Coverage

Use these when you want Steam-game-scoped YouTube activity, creator coverage, or content mix details.

Examples:

- "Show the latest YouTube videos for Hades II in the last 7 days"
- "Which creators cover ARC Raiders the most?"
- "Show top YouTube videos for Stardew Valley this month"
- "How is YouTube activity changing for Hades II?"
- "What does the YouTube content mix look like for ARC Raiders?"

Useful prompt patterns:

- "Show the latest YouTube videos for [game] in the last [window]."
- "Which creators are covering [game] the most?"
- "Show top YouTube videos for [game]."
- "Show video growth for [game] over the last [window]."
- "What does the YouTube content mix look like for [game]?"
- "Show the YouTube cadence for [game]."

Notes:

- Supported views are `latest_videos`, `creator_coverage`, `top_videos`, `video_growth`, `content_mix`, and `cadence`.
- Pagination applies to the list-style views and is exposed in the render data.
- `content_mix` and `cadence` are summary views and do not page.

---

## 6. Company and Portfolio Questions

Examples:

- "How many games has Valve published?"
- "Show me all games by Krafton"
- "Which publishers are similar to Devolver Digital?"
- "What developers have the strongest portfolios by review score?"
- "Find companies like Larian Studios"

Good follow-up questions:

- "Show me the top 10 titles first"
- "Compare them by review score and owners"
- "Which of these are self-published?"

---

## 7. Combined Queries

These combine discovery, recent data, and change intelligence.

Examples:

- "Show me rising indie games with improving sentiment"
- "What recent Steam news did breakout games post?"
- "Which release-week launches also had major storefront changes?"
- "Find recent titles with strong CCU and a positive news cadence"
- "Show me games that look under-marketed but have good reviews"

---

## 8. Response Interpretation

When chat answers well, you should usually see:

- linked titles in the text and tables
- a concise summary first
- supporting evidence in the query details panel
- timing and iteration data for troubleshooting

When the answer is thin or ambiguous, the route may:

- ask for clarification
- return a sparse-set warning
- return a bounded result and explain the limits

---

## 9. Strong Prompt Patterns

- "What actually changed in the latest Steam news for [title]?"
- "What changed on [title] in the last 30/90 days?"
- "Summarize recent Steam news across [title A] and [title B]."
- "Show me games similar to [title] but less popular."
- "Find recent games that look like signable candidates."
- "Which games posted patch notes lately?"
- "What games have developer diaries in recent Steam news?"
- "Show the latest YouTube videos for [game] in the last 7 days."
- "Which creators cover [game] the most?"
- "Show video growth for [game] over the last 30 days."
