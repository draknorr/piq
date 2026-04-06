# Streaming API

The chat system uses Server-Sent Events (SSE) for real-time responses.

**Endpoint**: `POST /api/chat/stream`

**Source File**: `apps/admin/src/app/api/chat/stream/route.ts`

---

## Request Format

```bash
POST /api/chat/stream
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "What are the top games by CCU?" }
  ],
  "sessionContext": null
}
```

`sessionContext` is optional. When present, it carries the compact follow-up summary for the current browser chat session:

- resolved entities
- active constraints
- the current candidate set
- the last answer state

The client should resend this context on the next turn when it is available.

---

## Event Types

The stream emits JSON events in `data: {...}\n\n` format:

| Event | Description |
|-------|-------------|
| `text_delta` | Incremental text chunk from the model |
| `tool_start` | Tool call initiated |
| `tool_result` | Tool execution completed |
| `message_end` | Response complete with timing, debug, execution, and turn summary data |
| `error` | Error occurred |

---

## Event Schemas

**Type Definitions**: `apps/admin/src/lib/llm/streaming-types.ts`

### TextDeltaEvent

```typescript
interface TextDeltaEvent {
  type: 'text_delta';
  delta: string;
}
```

### ToolStartEvent

```typescript
interface ToolStartEvent {
  type: 'tool_start';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

### ToolResultEvent

```typescript
interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: { success: boolean; error?: string; [key: string]: any };
  timing: { executionMs: number };
}
```

### MessageEndEvent

```typescript
interface MessageEndEvent {
  type: 'message_end';
  timing: {
    llmMs: number;
    toolsMs: number;
    totalMs: number;
  };
  debug?: {
    iterations: number;
    textDeltaCount: number;
    totalChars: number;
    toolCallCount: number;
    lastIterationHadText: boolean;
  };
  quality?: ChatTurnQualityInfo;
  sessionContext?: SessionChatContext | null;
  executionTrace?: ChatExecutionTraceEntry[];
  followUpSuggestions?: QuerySuggestion[];
  renderData?: ChatRenderData;
  tigerPrimary?: TigerPrimaryInfo;
  tigerShadow?: TigerShadowInfo;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  creditsCharged?: number;
}
```

What those fields mean:

- `debug` is the stream-level performance summary.
- `quality` carries the turn-level guardrail and contract summary.
- `sessionContext` is the compact carry-forward state for the next browser turn.
- `executionTrace` records backend usage, data sources, and migration disposition for the turn.
- `followUpSuggestions` contains generated next-step prompts when available.
- `tigerPrimary` and `tigerShadow` summarize Tiger routing decisions when the turn used the system contracts.
- `usage` and `creditsCharged` are returned when token accounting is available.

---

## Tool Loop

The streaming API uses a maximum of 5 tool iterations:

1. Send the user message to the model
2. Execute any requested tools
3. Send tool results back to the model
4. Repeat until the model produces final text or the limit is reached
5. Emit `message_end` with timing and debug data

If the limit is reached without a final response, the route emits a fallback message explaining that the request should be rephrased or narrowed.

When quality capture is enabled, the same completion event also includes the session context that should be sent back on the next turn.

---

## Entity Links

Tool results are pre-formatted before they are sent back to the model so the model can copy links directly into its answer.

Link formats:

| Entity Type | Format |
|-------------|--------|
| Game | `[Name](game:APPID)` |
| Developer | `[Name](/developers/ID)` |
| Publisher | `[Name](/publishers/ID)` |

---

## Example Client

```javascript
const response = await fetch('/api/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Top games by CCU' }],
    sessionContext: null,
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n\n');

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;

    const event = JSON.parse(line.slice(6));
    switch (event.type) {
      case 'text_delta':
        console.log(event.delta);
        break;
      case 'tool_start':
        console.log(`Calling ${event.name}...`);
        break;
      case 'message_end':
        console.log(`Done in ${event.timing.totalMs}ms`);
        break;
    }
  }
}
```

---

## Related Documentation

- [Chat Interface Guide](../user-guide/chat-interface.md)
- [Chat Data System](../developer-guide/architecture/chat-data-system.md)
- [Internal API](./internal-api.md)
