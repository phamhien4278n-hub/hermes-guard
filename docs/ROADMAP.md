# Roadmap

Hermes Guard v1.7.9 is usable for daily local testing.

Future work should be driven by real misses and false positives.

## High Priority

### Claim ID Evidence Binding

Current evidence is session/task scoped with strict subject matching for numeric claims.

Future design:

```text
response_check -> claim_id
tool/evidence -> claim_id
later check -> only matching claim_id evidence can satisfy claim
```

### Cross-Process Locking

State writes are atomic, but simultaneous writers can still race.

Future work:

- lock file with timeout
- stale lock recovery
- cross-platform Windows/Git Bash behavior

## Medium Priority

### More Rule Packs

Potential packs:

- medical/legal/financial caution
- package/version claims
- ability claims
- causal claims
- memory claims

### False Positive Review

Collect real false positives and tune rules.

## Low Priority

### Release Automation

- generate manifest automatically
- generate zip release artifact
- run checks before tagging

### Dashboard Improvements

Dashboard is optional. Improvements should mirror CLI features and not become a hard dependency.
