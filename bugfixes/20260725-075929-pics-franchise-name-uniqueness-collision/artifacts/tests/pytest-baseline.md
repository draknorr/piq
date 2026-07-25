# Pre-fix PICS test baseline

Command:

```text
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. pytest \
  tests/test_durable_promotion.py \
  tests/test_operations_relationship_sync.py -q
```

Result:

```text
16 passed, 1 warning in 0.96s
```

The warning is the pre-existing Pydantic class-based config deprecation.
