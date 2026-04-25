# Process 7.1 / 7.2 Security Integration Notes

## Minimum GitHub Permissions (Least Privilege)

The integration validates and requires the following minimum scopes:

- `repo:status`
- `read:org`

Any token that does not include these scopes is rejected during setup.

## Secret Storage Policy

- GitHub PAT and JIRA API tokens are encrypted with AES-256-GCM in the application layer before persistence.
- Plain-text tokens are never stored in the database.
- The encryption key is loaded from `ENCRYPTION_KEY` environment variable (recommended source: Vault/Secrets Manager).

## Log Redaction Policy

Central log redaction masks:

- `ghp_...` token patterns
- `Authorization: Bearer ...`
- `Authorization: Basic ...`

Redacted values are persisted as `[REDACTED]`.

## Security Audit Events

Unauthorized provider access responses (`401` / `403`) and credential rotations are recorded as:

- `SECURITY_AUDIT`
- `CREDENTIAL_ROTATED`
