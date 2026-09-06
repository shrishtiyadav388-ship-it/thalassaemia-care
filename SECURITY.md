# Security and patient-data handling

This release is a development foundation. No claim of legal compliance, independent security audit, or clinical validation is made.

## Implemented

- Passwords use scrypt with individual random salts. Sessions use hashed random tokens, HttpOnly/SameSite=Strict cookies, an eight-hour absolute expiry, and a 30-minute server-side idle limit. The browser locks after 15 minutes of inactivity.
- Recovery codes have 192 bits of randomness, are stored as hashes, and rotate after use or password change. Recovery revokes all sessions and browser subscriptions.
- Mutations require the configured request origin and a session-specific CSRF token. Authentication attempts are rate-limited per account name and connection address.
- Every record operation and export checks server-side ownership. Concurrent edits require the latest revision.
- Record payloads (including display names, clinical data, notes, and lab values) are encrypted with AES-256-GCM and bound to their account, record ID, and type using authenticated additional data.
- Usernames, password salts/hashes, record types, record/account IDs, and session metadata are not field-encrypted. Use non-identifying usernames where possible. Protect the entire storage volume and backups.
- There are no analytics or third-party fonts. Fictional sample fixtures are clearly labelled. Optional browser subscriptions and encrypted generic push messages use browser providers; subscription payloads are encrypted at rest. Outbound endpoints are restricted to supported provider domains to prevent arbitrary server requests.
- Production startup requires encryption and push keys, invitation configuration, an HTTPS origin, a privacy contact, and an explicit operator review flag. The flag does not certify safety or compliance. Development is loopback-only.

## Before real-patient rollout

Review the hosting provider, intended region, relevant data-protection requirements, key management, retention, privacy notice, incident handling, and clinical content. Test end-to-end authorization, mobile/keyboard/accessibility behavior, backup restoration, session expiry, operational monitoring, and reminder behavior on actual supported calendars.

Use a TLS reverse proxy and restrict direct access to the application server. Secure the host, mount data privately, keep the encryption key outside the database volume, restrict file permissions, and use encrypted disks and encrypted backups. Windows deployments require explicit NTFS ACL review; Node's Unix file mode arguments alone do not enforce those ACLs.

There is no MFA, email recovery, key-rotation tooling, or automatic database-backup service. Rate limits are in memory and reset on server restart. One instance is supported. Schema version 2 adds account recovery, consent declarations, and inactivity tracking. Reminder tables are created idempotently. Plan reviewed migrations before future schema changes.

The reminder worker stores delivery metadata for seven days while running. Timing, status, record IDs and endpoint hashes are metadata, not encrypted clinical payloads. Jobs use retries and stable display tags, not an exactly-once delivery guarantee. A provider acceptance is distinct from browser display acknowledgement and neither proves a person saw the message. Real-device verification is still required.

The initial India-focused release accepts only adults managing their own records, with recorded privacy-notice and adult declarations. This is not identity/age verification or a guardian-consent implementation. Do not onboard children until the appropriate flow is implemented and reviewed.

Account deletion removes active account rows and records. It cannot recall exported files or calendar copies, and administrator backups require a documented expiry/deletion policy. SQLite secure_delete is enabled, but forensic erasure from host disks, WAL history, filesystem snapshots, or backups is not guaranteed. Prefer encrypted storage and properly managed key lifecycles.

Report security issues privately to the repository owner without posting patient data, credentials, or exploitable details in public issues.
