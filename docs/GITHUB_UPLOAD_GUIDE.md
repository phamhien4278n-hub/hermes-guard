# GitHub Upload Guide

This guide is for the first public upload.

## What To Upload

Upload the contents of:

```text
hermes_guard_open_source_v1.7.9/
```

Do not upload the parent workspace, historical `outputs/`, or old version zip files.

## Do Not Upload

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

These are ignored by `.gitignore`, but check before pushing.

## Suggested Repository Settings

Repository name:

```text
hermes-guard
```

Description:

```text
CLI-first external guardrail and audit layer for Hermes and other LLM agents.
```

Topics:

```text
llm
guardrails
ai-safety
cli
audit
hermes
agents
nodejs
```

Visibility:

```text
Public
```

License:

```text
AGPL-3.0
```

## First Push Checklist

```bash
node guard.mjs manifest check
node guard.mjs rules validate
node --test
```

Then:

```bash
git init
git add .
git status
git commit -m "Initial open source release v1.7.9"
git branch -M main
git remote add origin https://github.com/OWNER/hermes-guard.git
git push -u origin main
```

Replace `OWNER` with the GitHub account or organization.

## Recommended First Release

Create a GitHub release:

```text
v1.7.9
```

Release title:

```text
Hermes Guard v1.7.9 - first open-source snapshot
```

Release notes:

```text
- CLI-first Guard runtime
- bilingual normal-user panel
- Hermes hook bridge
- deployment manifest check
- numeric/source/completion/future-commitment rules
- Chinese response claim rules
- audit health and maintenance commands
- 48 passing tests
```
