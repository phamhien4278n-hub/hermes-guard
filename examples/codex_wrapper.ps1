param(
  [Parameter(Mandatory=$true)][string]$Message,
  [string]$SessionId = "codex-default"
)

$root = Split-Path -Parent $PSScriptRoot
node "$root\guard.mjs" wrap --agent codex --session-id $SessionId --message $Message
