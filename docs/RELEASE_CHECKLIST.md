# Release Checklist

Use this checklist before publishing a release.

## Required Checks

```bash
node guard.mjs manifest check
node guard.mjs rules validate
node --test
```

Expected:

```text
manifest: ok
rules validate: ok
all tests pass
```

## File Hygiene

Confirm these are absent:

```text
audit/
tmp*/
tmp_*/
*.jsonl
*.state.json
*.evidence.jsonl
*.errors.jsonl
settings.json
cases/
*.zip
```

## Version Hygiene

Confirm versions align:

```text
guard.mjs
VERSION_MANIFEST.json
package.json
rules.json
rules.d/*.json
CHANGELOG.md
```

## Manifest Hygiene

If a manifest-tracked file changes, update `VERSION_MANIFEST.json`.

Manifest-tracked files:

```text
guard.mjs
hermes_hook_bridge.mjs
cli_panel.mjs
rules.json
rules.d/numeric_claims.json
rules.d/future_commitments.json
rules.d/chinese_response_claims.json
START_HERE.bat
START_CLI_PANEL.bat
CHECK_SYSTEM.bat
```
