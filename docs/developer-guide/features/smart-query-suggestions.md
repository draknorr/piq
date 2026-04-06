# Smart Query Suggestions Feature

**Implemented:** January 12, 2026
**Branch:** `personalization`
**Commit:** `055a072`

## Overview

Two complementary features help users write better queries in the chat interface:

1. **Type-Ahead Autocomplete** - Suggestions appear as you type
2. **Post-Response Suggestions** - Follow-up queries appear after the assistant responds

Both are pattern-based, with no LLM calls, so they stay fast and low-cost.

---

## Feature 1: Type-Ahead Autocomplete

### Architecture

```
User types "roguel..."
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  INSTANT (client-side, <50ms)                           │
│  - Filter query templates matching input                │
│  - Filter cached tags/genres                            │
└─────────────────────────────────────────────────────────┘
         │
         ▼ (after 150ms debounce)
┌─────────────────────────────────────────────────────────┐
│  ASYNC (API call to /api/search)                        │
│  - Search games/publishers/developers                   │
│  - Generate query suggestions from results              │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  COMBINED DROPDOWN                                      │
│  - Templates section                                    │
│  - Tags section                                         │
│  - Games section                                        │
│  - Publishers/Developers section                        │
└─────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `lib/chat/query-templates.ts` | Hardcoded query patterns, matching logic |
| `hooks/useAutocompleteData.ts` | Pre-fetch tags, localStorage cache (1h TTL) |
| `components/chat/AutocompleteDropdown.tsx` | Dropdown UI with grouped sections |
| `components/chat/ChatInput.tsx` | Input with autocomplete integration |
| `app/api/autocomplete/tags/route.ts` | API to fetch all tags/genres/categories |

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow Down/Up | Navigate suggestions |
| Enter | Select highlighted suggestion |
| Tab | Complete with top suggestion |
| Escape | Close dropdown |

### Data Flow

1. On chat page mount, `useAutocompleteData` checks localStorage
2. If cache expired, it fetches `/api/autocomplete/tags` and caches the result
3. User types, and the UI filters templates plus cached tag data immediately
4. After 150ms pause, the app performs a debounced fetch to `/api/search`
5. Results are combined and displayed in the dropdown

---

## Feature 2: Post-Response Suggestions

### Architecture

```
Assistant response completes
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Extract entities from tool results                     │
│  - Games (names, appids)                                │
│  - Publishers/Developers                                │
│  - Tags used in search                                  │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Generate suggestions by capability                     │
│  - similarity search → "Hidden gems like X"             │
│  - games search → "Trending X", "X on Steam Deck"      │
│  - trend discovery → "What's breaking out?"             │
│  - title lookup → "Games similar to X"                  │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Render 3-4 chips below assistant message               │
│  Click → Auto-submit query                              │
└─────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `lib/chat/suggestion-generator.ts` | Pattern-based suggestion generation |
| `components/chat/SuggestionChips.tsx` | Clickable chips UI |
| `components/chat/ChatMessage.tsx` | Integrates chips into message |
| `components/chat/ChatContainer.tsx` | Generates suggestions, handles clicks |

### Suggestion Patterns by Capability

| Capability | Suggestions Generated |
|-----------|----------------------|
| Similarity search | "Hidden gems like X", "Steam Deck games like X" |
| Games search | "Trending X games", "X on Steam Deck" |
| Concept search | "Add Steam Deck filter", "Find hidden gems" |
| Trend discovery | "What's breaking out?", "Tell me about X" |
| Title lookup | "Games similar to X", "More by developer" |
| Publisher lookup | "X's best rated games" |

---

## Cost & Performance

| Aspect | Autocomplete | Post-Response |
|--------|--------------|---------------|
| **LLM Cost** | $0 | $0 |
| **API Calls** | 1 pre-fetch + debounced search | 0 |
| **Latency** | <50ms (instant) + 150ms (async) | 0ms |
| **Storage** | ~50KB localStorage | None |

---

## Testing

1. Run `pnpm --filter @publisheriq/admin dev`
2. Navigate to `/chat`
3. Test autocomplete:
   - Focus input (empty) and verify example prompts
   - Type "roguel" and verify template suggestions
   - Type a game name and verify game-based suggestions
   - Use arrow keys, enter, tab, and escape
4. Test post-response suggestions:
   - Ask "Show me roguelike games"
   - Wait for response
   - Verify suggestion chips below the response
   - Click a chip to auto-submit

---

## Future Enhancements

- [ ] Track suggestion click analytics
- [ ] Personalize based on user query history
- [ ] Add "popular queries" section from chat_query_logs
- [ ] Cache recent entity searches in sessionStorage
