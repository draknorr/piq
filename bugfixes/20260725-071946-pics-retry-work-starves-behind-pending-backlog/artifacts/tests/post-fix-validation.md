# Post-fix validation

## Targeted durable-work suite

Command:

```text
cd services/pics-service
PYTHONPATH=. pytest tests/test_durable_work.py -q
```

Result:

```text
15 passed, 1 warning in 0.31s
```

The added test asserts:

1. lane order precedes priority;
2. priority precedes retry state;
3. retry state precedes `next_attempt_at`; and
4. the claim retains `FOR UPDATE OF work SKIP LOCKED`.

## Complete PICS suite

Command:

```text
cd services/pics-service
PYTHONPATH=. pytest -q
```

Result:

```text
102 passed, 1 warning in 1.03s
```

## Compilation and diff checks

Commands:

```text
cd services/pics-service
PYTHONPYCACHEPREFIX=<temporary-directory> python3 -m compileall -q src

cd ../..
git diff --check
```

Result: both passed.

The pytest warning is the existing Pydantic class-based configuration
deprecation in `src/config/settings.py`.

## Changed-file lint and format checks

Commands:

```text
cd services/pics-service
ruff check --no-cache src/database/durable_work.py tests/test_durable_work.py
black --check src/database/durable_work.py tests/test_durable_work.py
```

Result: both passed.

Repository-wide Ruff also ran and reported `116` existing violations outside
the changed lines. A targeted mypy run reported the existing
`dict_row = None` assignment issue at `src/database/durable_work.py:126`.
Those baseline issues are unrelated to the new ordering expression and were
not changed in this contained fix.
