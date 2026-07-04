# Hermes Hook Bridge

Hermes Guard ships a bridge for Hermes shell hooks.

## Files

```text
hermes_hook_bridge.mjs
hermes-hook-bridge.cmd
hermes-hook-bridge.sh
```

## Windows

Use:

```bat
hermes-hook-bridge.cmd
```

The `.cmd` launcher sets `HERMES_GUARD_AUDIT_DIR` to the local `audit` directory when not already set.

## Git Bash / Linux

Use:

```bash
./hermes-hook-bridge.sh
```

## Supported Hook Events

The bridge handles:

```text
pre_llm_call
transform_llm_output
post_llm_call
post_tool_call
on_session_start
on_session_end
on_session_finalize
```

## Runtime Status

The bridge writes:

```text
audit/.current_session
audit/.bridge_status.json
audit/.bridge_events.jsonl
```

`guard health` reads bridge status and reports:

```text
bridge_unhealthy
bridge_stale
```

## Tool Evidence

The bridge maps tools to evidence kinds:

```text
web/browser/fetch -> web_verified
read/view/skill   -> file_read
write/edit        -> file_write
test command      -> test_passed
terminal/shell    -> command_run
unknown           -> command_run
```

Unknown tools are not promoted to `manual_review`.

Manual review should be created only by explicit human action.

## Timeout

Bridge calls to `guard.mjs` use:

```text
HERMES_GUARD_TIMEOUT_MS=10000
```

Override it if needed:

```bash
HERMES_GUARD_TIMEOUT_MS=15000 ./hermes-hook-bridge.sh
```
