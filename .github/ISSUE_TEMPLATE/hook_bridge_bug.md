---
name: Hook bridge bug
about: Hermes hook bridge did not behave as expected
title: "[Bridge] "
labels: bridge, bug
---

## Environment

- OS:
- Node.js version:
- Hermes version or install type:
- Shell: Windows CMD / PowerShell / Git Bash / Linux shell

## Hook Event

```text
pre_llm_call / transform_llm_output / post_tool_call / other
```

## What Happened

```text
describe the behavior
```

## Bridge Status

If safe to share, paste sanitized output from:

```text
audit/.bridge_status.json
```

## Checks

```bash
node guard.mjs manifest check
node guard.mjs rules validate
node --test
```

## Notes

Do not include private conversation content, tokens, secrets, or personal data.
