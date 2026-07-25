# Reproduction: stale franchise normalization

The current Python normalizer:

```python
re.sub(r"\s+", " ", value.strip().lower())
```

converts:

```text
Defender's  Quest
```

to:

```text
defender's quest
```

The production row with the exact raw name instead stores:

```text
defender's  quest
```

Both Tiger writers insert the raw name and current normalized value with:

```sql
ON CONFLICT (normalized_name)
DO UPDATE SET name = EXCLUDED.name
```

Because the existing row matches `name` but not `normalized_name`, PostgreSQL
raises the unhandled `franchises_name_key` conflict. This is the exact
precondition recorded in the live retry row.

A local write reproduction was intentionally not run: the live read-only
constraint, row, relationship, and error evidence proves the failure without
starting or mutating a database.
