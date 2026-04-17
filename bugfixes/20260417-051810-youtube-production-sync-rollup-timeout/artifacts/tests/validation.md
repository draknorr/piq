# Validation

## Code Validation

Commands run locally:

```bash
pnpm --filter @publisheriq/youtube check-types
pnpm --filter @publisheriq/youtube lint
pnpm --filter @publisheriq/youtube test
```

Results:

- `check-types`: passed
- `lint`: passed
- `test`: passed (`7` tests, `0` failures)

## Runtime Validation

- The set-based replacement query matched the old 30-day rollup result set with
  `diff_rows = 0`.
- The replacement query completed inside the existing `15s` statement timeout in
  read-only production validation.
