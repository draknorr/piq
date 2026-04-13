# Search & Discovery Guide

This guide explains the main search and discovery styles available through PublisherIQ chat.

## Main Approaches

| Approach | Best For | Typical Experience |
|----------|----------|--------------------|
| Structured analytics | Ranked lists, metrics, comparisons | Ask for a ranked answer with explicit filters |
| Strict screening | Games-page style ranked discovery | Ask for a market screen with sorting and filters |
| Trend discovery | Momentum and velocity questions | Ask what is accelerating, breaking out, or declining |
| Concept search | Natural-language game ideas | Describe the kind of game you want in plain English |
| Similarity search | "Games like X" | Ask for close matches to a title or company |
| Change and news search | Recent Steam activity, announcements, before/after diffs | Ask what changed, what was announced, or what the latest news says |
| YouTube coverage | Game-scoped YouTube activity | Ask for latest videos, creator coverage, growth, or content mix |

## Concept Search

Use concept search when you can describe what you want more easily than you can name tags.

### Examples

> "tactical roguelikes with deck building"

> "cozy farming games with crafting"

> "horror games with investigation elements"

> "fast-paced action games with pixel art"

You can combine these prompts with constraints such as price, review quality, release year, or Steam Deck support.

## Strict Screening

Use chat prompts that imply a ranked market screen when you want the same kind of answer you would expect from the `/apps` page.

### Good Fits

> "What free-to-play games have the most players right now?"

> "What horror games are gaining momentum?"

> "Show me games with improving sentiment"

> "Compare top roguelites by review velocity and CCU"

This path is best when the answer depends on ranking labels like CCU, momentum, velocity, or sentiment over a defined time window.

## Trend Discovery

Use trend discovery for broader momentum questions:

> "What games are trending right now?"

> "Show me games with accelerating reviews"

> "Find breaking out hidden gems"

> "Which games are declining this week?"

This is the lighter-weight path for momentum-oriented discovery when you do not need the stricter ranked-screen behavior.

## Similarity Search

Similarity search finds games, publishers, or developers close to a reference title or company.

### Examples

> "Games similar to Hades"

> "Games like Stardew Valley for Steam Deck"

> "Publishers similar to Devolver Digital"

> "Games like Hollow Knight but less popular"

Typical similarity filters include popularity, review quality, price, platforms, Steam Deck status, tags, genres, and release year.

## Tag And Genre Search

When you already know the tags, genres, or categories you want, ask directly:

> "Games with the Roguelike and Deck Building tags"

> "Linux games with Workshop support"

> "Action RPGs released in 2024"

You can also ask the system to discover matching tags or categories before running the actual search.

## Change And News Search

The current chat can also search recent Steam activity and Steam news:

> "What changed recently for ARC Raiders?"

> "Summarize the most meaningful recent Steam news across ARC Raiders and THE FINALS"

> "Which games posted developer diaries lately?"

> "Show me announcement-heavy games with weak downstream response"

These prompts use the change-intelligence and recent-news capabilities rather than the older discovery-only paths.

## YouTube Coverage

Use YouTube coverage when the question is about Steam-game-scoped video activity:

> "Show the latest YouTube videos for Hades II in the last 7 days"

> "Which creators cover ARC Raiders the most?"

> "Show top YouTube videos for Stardew Valley this month"

> "What does the YouTube content mix look like for Hades II?"

This path stays game-first:

- resolve the Steam game first
- choose a view such as `latest_videos`, `creator_coverage`, `top_videos`, `video_growth`, `content_mix`, or `cadence`
- narrow by window when you want a bounded recent slice

## Tips

- Use a specific title when you want detail about one game.
- Use ranking language like "top", "most players", or "highest momentum" when you want a strict screen.
- Use theme language when you want concept search.
- Use "recent news", "what changed", or "before and after" when your question is really about Steam activity rather than catalog metrics.
- Use YouTube-specific language when you want creator, video, or content-mix coverage rather than Steam news.

## Related Documentation

- [Chat Interface Guide](./chat-interface.md)
- [Chat Query Examples](./chat-query-examples.md)
- [Chat Data System](../developer-guide/architecture/chat-data-system.md)
