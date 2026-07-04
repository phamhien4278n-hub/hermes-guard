# Notes For Hermes Agents

When helping maintain this repository:

1. Run checks before claiming success.
2. Do not claim files were changed unless tool output confirms it.
3. Do not treat old evidence as support for a new unrelated claim.
4. Do not commit audit logs, temporary files, or private conversation exports.
5. If changing rules, add tests.
6. If changing manifest-tracked files, update `VERSION_MANIFEST.json`.

Useful commands:

```bash
node guard.mjs manifest check
node guard.mjs rules validate
node --test
node guard.mjs check-response --format readable --response "MMLU-Pro 92.3%"
node guard.mjs audit gc --days 30
```

Project boundary:

```text
Hermes Guard is a local guardrail and audit layer.
It is not a fact database, truth oracle, or sandbox.
```
