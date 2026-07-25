# Baseline targeted test

Command:

```text
cd services/pics-service
PYTHONPATH=. pytest tests/test_durable_work.py -q
```

Result before the fix:

```text
14 passed, 1 warning in 0.30s
```

The warning is the existing Pydantic class-based configuration deprecation.
No existing test asserts retry-before-pending ordering.
