# Rule Library

Rules live in:

```text
rules.json
rules.d/*.json
```

The runtime merges them at startup.

## Validate Rules

```bash
node guard.mjs rules validate
```

## List Rules

```bash
node guard.mjs rules list --format text
```

## Add A Rule

```bash
node guard.mjs rules add \
  --kind response \
  --id my_rule \
  --patterns "foo|bar" \
  --risk medium \
  --instruction "Explain what this rule catches"
```

Custom rules are written to:

```text
rules.d/custom.json
```

## Response Rule Evidence

A response rule can require evidence:

```json
{
  "id": "example_rule",
  "risk": "high",
  "patterns": ["example"],
  "default_required_any": ["manual_review", "web_verified"],
  "instruction": "Explain the rule."
}
```

For strict numeric claims:

```json
{
  "evidence_policy": "strict_subject"
}
```

Strict subject matching requires evidence text to mention the relevant claim or topic.

## Current Rule Packs

```text
rules.json
rules.d/numeric_claims.json
rules.d/future_commitments.json
rules.d/chinese_response_claims.json
```

Covered examples:

```text
MMLU-Pro 92.3%
测试得分92.3%
成功率99.7%
文件已保存
搞定了
都搞完了
记下了
下次提醒
```

## Rule Design Advice

Prefer rules that are:

- specific
- explainable
- tested
- unlikely to catch ordinary harmless text

Avoid broad regular expressions that catch too much.
