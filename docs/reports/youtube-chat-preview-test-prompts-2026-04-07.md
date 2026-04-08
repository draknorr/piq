# YouTube Chat Preview Test Prompts

As of 2026-04-07

Use these after:

1. running the preview mirror
2. running `pnpm --filter @publisheriq/youtube verify-preview-mirror`
3. confirming `CHAT_TIGER_YOUTUBE_ENABLED=true` in preview and `false` in production

The local verifier accepts `TIGER_PREVIEW_URL` and `TIGER_PRODUCTION_URL` from `.env.tiger.local`, so it can run without extra env exports.

These prompts are intentionally limited to the v1 surface that is now implemented behind the server-side flag.

## Core Success Cases

- `What are the latest YouTube videos for ARC Raiders?`
- `Which creators are covering Palworld on YouTube right now?`
- `What are the biggest YouTube videos for Baldur's Gate 3 right now?`
- `Which Hollow Knight YouTube videos are growing fastest in the last 1 day?`
- `What does the YouTube content mix look like for Resident Evil 2?`
- `How many new YouTube videos and distinct upload channels did Destiny 2 get in the last 7 days?`

## Format-Specific Cases

- `Show me the newest shorts for ARC Raiders on YouTube.`
- `Show me the latest live or recent live YouTube videos for Palworld.`
- `What are the biggest standard YouTube videos for Baldur's Gate 3 right now?`

## Trust / Safety Cases

- `What are the latest YouTube videos for MENACE?`
  Expected: blocked explanation due to current title precision risk.
- `What are the latest YouTube videos for Forager?`
  Expected: blocked explanation due to current title precision risk.
- `What are the latest YouTube videos for ARC Raiders?`
  Expected in preview after mirror: successful YouTube answer.

## Regression Checks

- `What are the latest videos for ARC Raiders?`
  Expected: should not silently route to YouTube.
- `What are the top indie games currently?`
  Expected: existing non-YouTube Tiger behavior.
- `Show Counter-Strike 2 CCU over time.`
  Expected: existing metric-history behavior.
- `What changed for Hades II this week?`
  Expected: existing Steam change-explanation behavior.
