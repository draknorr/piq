# Post-fix validation

## Targeted regression suite

```text
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. pytest \
  tests/test_durable_promotion.py \
  tests/test_operations_relationship_sync.py -q
```

Result before the final insertion-path test:

```text
21 passed, 1 warning in 0.60s
```

The final complete suite includes all `22` tests in this targeted selection.

## Complete PICS suite

```text
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. pytest -q
```

Result:

```text
108 passed, 1 warning in 1.01s
```

The warning is the pre-existing Pydantic class-based config deprecation.

## Static validation

- Black check on the three changed Python files: passed.
- Ruff check on the three changed Python files: passed.
- Targeted mypy with skipped imports on the resolver and its tests: passed.
- Python compilation for `src` and `tests`: passed.
- `git diff --check`: passed.

Repository-wide Ruff reports `111` pre-existing findings in unchanged files.
Repository-wide mypy reports `25` pre-existing errors in `9` files. Neither
baseline was expanded into this contained repair.
