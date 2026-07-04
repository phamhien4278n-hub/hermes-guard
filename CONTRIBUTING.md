# Contributing

Thanks for helping improve Hermes Guard.

## Before You Start

Run the checks:

```bash
node guard.mjs manifest check
node guard.mjs rules validate
node --test
```

If you change a manifest-tracked file, update `VERSION_MANIFEST.json`.

Tracked files include:

```text
guard.mjs
hermes_hook_bridge.mjs
cli_panel.mjs
rules.json
rules.d/*.json
START_HERE.bat
START_CLI_PANEL.bat
CHECK_SYSTEM.bat
```

## Good First Contributions

- Add targeted rules for real missed cases.
- Add tests for false negatives and false positives.
- Improve documentation for normal users.
- Improve Hermes hook examples.

## Rule Changes

Every rule change should include:

- a clear rule id
- an explanation
- at least one test for a real example
- a check that normal text does not trigger unnecessarily

Prefer focused rules over broad catch-all patterns.

## Evidence Model Changes

Evidence behavior is safety-sensitive. Changes should include tests for:

- unsupported claim remains blocked without evidence
- related evidence can support a claim
- unrelated evidence cannot support a claim
- failed tool calls do not satisfy claims

## Pull Request Checklist

- [ ] `node guard.mjs manifest check`
- [ ] `node guard.mjs rules validate`
- [ ] `node --test`
- [ ] no `audit/`, `tmp_*`, or local logs committed
- [ ] README/docs updated if behavior changed
