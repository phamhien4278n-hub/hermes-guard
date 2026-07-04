# Architecture

Hermes Guard is intentionally simple:

```text
LLM agent / hook
      |
      v
hermes_hook_bridge.mjs
      |
      v
guard.mjs
      |
      +-- rules.json + rules.d/*.json
      +-- audit/*.jsonl
      +-- audit/*.evidence.jsonl
      +-- audit/*.state.json
      +-- VERSION_MANIFEST.json
```

## Main Components

### guard.mjs

The core CLI runtime.

Responsibilities:

- wrap user messages with external guard context
- check assistant responses
- register evidence
- manage task objective
- report session state
- validate rules
- check deployment manifest
- maintain audit logs

### hermes_hook_bridge.mjs

Adapter for Hermes shell hooks.

Responsibilities:

- read hook JSON from stdin
- map Hermes hook events to Guard CLI commands
- write `.current_session`
- write `.bridge_status.json`
- expose visible warnings when Guard fails
- prevent failed tool calls from becoming passing evidence

### cli_panel.mjs

Bilingual text UI for normal users.

It wraps common CLI actions:

- health
- response check
- details
- sessions
- task
- evidence
- settings
- rules
- dashboard
- system check

### dashboard.mjs

Optional browser dashboard.

It is not required for hook or CLI operation.

## Data Files

Runtime files are local and should not be committed:

```text
audit/
settings.json
cases/
```

Deployment files are committed:

```text
VERSION_MANIFEST.json
rules.json
rules.d/*.json
```

## Safety Model

Hermes Guard is conservative:

- claims need evidence
- failed evidence does not count
- unrelated evidence should not support strict numeric claims
- hook failure should be visible
- corrupt audit lines should be reported

It is a guardrail, not a fact oracle.
