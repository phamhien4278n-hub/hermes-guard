#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
SESSION_ID="${CLAUDE_CODE_SESSION_ID:-claude-code-default}"

node "$ROOT/guard.mjs" wrap --agent claude-code --session-id "$SESSION_ID" --stdin
