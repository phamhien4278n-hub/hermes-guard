# Changelog

## v1.7.9

Evidence-policy hardening release.

Highlights:

- Chinese completion and verification claims now require strict subject-matched evidence
- strict-subject matching now extracts Chinese claim phrases, not only English names and numbers
- regression coverage for the "old session evidence supports new completion claim" failure mode
- release metadata and deployment manifest updated for v1.7.9

## v1.7.8

First open-source-ready snapshot.

Highlights:

- deployment integrity manifest
- bilingual CLI panel
- Hermes hook bridge with timeout and health status
- strict subject matching for numeric benchmark claims
- Chinese numeric and completion/memory response rules
- JSONL parse error sidecar files
- audit cleanup command
- 48 passing automated tests

Private prototype history before v1.7.8 is intentionally summarized rather than published as separate releases.
