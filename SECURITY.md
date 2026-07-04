# Security Policy

## Supported Version

The first open-source-supported version is:

```text
v1.7.9
```

## Reporting A Vulnerability

Please open a private security advisory if GitHub Security Advisories are enabled.

If private advisories are not available, open an issue with:

- a short title
- affected version
- minimal reproduction steps
- expected behavior
- actual behavior
- whether the issue causes a false negative, false positive, data leak, or denial of service

Do not include private audit logs, personal files, API keys, tokens, or sensitive conversation exports in public issues.

## Security Goals

Hermes Guard tries to reduce:

- unsupported completion claims
- unsupported source claims
- unsupported benchmark or score claims
- silent hook failure
- evidence pollution
- audit corruption being silently ignored

## Non-Goals

Hermes Guard does not:

- prove that a claim is true
- replace human review
- sandbox untrusted code
- protect secrets by itself
- guarantee perfect semantic detection

## Local Data

Hermes Guard stores local audit data under:

```text
audit/
```

Do not commit this directory.

Before sharing logs, review them for:

- personal data
- private file paths
- source code
- credentials
- conversation content
