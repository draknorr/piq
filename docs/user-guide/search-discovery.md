# Search & Discovery Guide

This guide explains the main search and discovery styles available through PublisherIQ chat.

## Main Approaches

| Approach | Best For | Typical Tooling |
|----------|----------|-----------------|
| Structured analytics | Ranked lists, metrics, comparisons | `query_analytics` |
| Strict screening | Games-page style ranked discovery | `screen_games` |
| Trend discovery | Momentum and velocity questions | `discover_trending` |
| Concept search | Natural-language game ideas | `search_by_concept` |
| Similarity search | "Games like X" | `find_similar` |
| Change and news search | Recent Steam activity, announcements, before/after diffs | change-intel and recent-news tools |

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

These prompts use the newer change-intelligence and recent-news tools rather than the older discovery-only paths.

## Tips

- Use a specific title when you want detail about one game.
- Use ranking language like "top", "most players", or "highest momentum" when you want a strict screen.
- Use theme language when you want concept search.
- Use "recent news", "what changed", or "before and after" when your question is really about Steam activity rather than catalog metrics.

## Related Documentation

- [Chat Interface Guide](./chat-interface.md)
- [Chat Query Examples](./chat-query-examples.md)
- [Chat Data System](../developer-guide/architecture/chat-data-system.md)
