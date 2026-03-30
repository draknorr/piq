# Chat Query Examples

Curated examples for the PublisherIQ chat interface.

**Last Updated:** March 30, 2026

> Related docs:
> - [Chat Interface Guide](./chat-interface.md)
> - [Streaming API](../api/streaming-api.md)
> - [Chat Data System](../developer-guide/architecture/chat-data-system.md)

---

## Quick Reference

| Want to... | Use this kind of query |
|------------|------------------------|
| Look up one game | `lookup_games` first, then ask about that title |
| Compare similar games | `find_similar` |
| Find something by tags or concepts | `search_games` or `search_by_concept` |
| Find trending games | `discover_trending` or `screen_games` |
| Ask what changed on one title | `get_game_change_timeline` |
| Inspect the latest Steam news item | `get_recent_news_detail` |
| Summarize recent news for one or more titles | `get_recent_news_digest` |
| Search recent news by topic | `search_recent_news_topics` |
| Drill into one change card | `get_change_activity_detail` |
| Compare before and after | `compare_change_before_after` |
| Find marketing / launch patterns | `find_change_patterns` |

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

## 5. Company and Portfolio Questions

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

## 6. Combined Queries

These combine discovery, recent data, and change intelligence.

Examples:

- "Show me rising indie games with improving sentiment"
- "What recent Steam news did breakout games post?"
- "Which release-week launches also had major storefront changes?"
- "Find recent titles with strong CCU and a positive news cadence"
- "Show me games that look under-marketed but have good reviews"

---

## 7. Response Interpretation

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

## 8. Strong Prompt Patterns

- "What actually changed in the latest Steam news for [title]?"
- "What changed on [title] in the last 30/90 days?"
- "Summarize recent Steam news across [title A] and [title B]."
- "Show me games similar to [title] but less popular."
- "Find recent games that look like signable candidates."
- "Which games posted patch notes lately?"
- "What games have developer diaries in recent Steam news?"
