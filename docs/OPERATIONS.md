# Operations

## Recommended Health Checks

```bash
node guard.mjs manifest check
node guard.mjs rules validate
node --test
```

or on Windows:

```text
CHECK_SYSTEM.bat
```

## Session Health

```bash
node guard.mjs health --agent hermes --session-id SESSION_ID
```

Important warnings:

```text
session_stale
bridge_unhealthy
bridge_stale
jsonl_parse_errors
unsupported_response_claims
```

## Audit Data

Audit files are stored in:

```text
audit/
```

Do not commit this directory.

## JSONL Parse Errors

Bad JSONL lines create sidecar files:

```text
SESSION.jsonl.errors.jsonl
SESSION.evidence.jsonl.errors.jsonl
```

These files are for diagnosis and should not be committed.

## Audit Cleanup

Dry-run:

```bash
node guard.mjs audit gc --days 30
```

Apply:

```bash
node guard.mjs audit gc --days 30 --apply true
```

The current `.current_session` target is preserved.

## Deployment Integrity

```bash
node guard.mjs manifest check
```

This catches partial upgrades, such as copying `guard.mjs` but missing `rules.d/numeric_claims.json`.
