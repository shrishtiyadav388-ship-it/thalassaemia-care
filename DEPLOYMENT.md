# Deployment and recovery

## Current delivery

The app runs locally with fictional records. A public deployment suitable for real health records is not included. This Node/SQLite server does not run on GitHub Pages or a static-only host.

## Production configuration

Use a reviewed Node 24 host with a persistent private volume and a TLS reverse proxy. Set:

- `NODE_ENV=production`
- `HOST=127.0.0.1` behind a reverse proxy, or the appropriate private interface in a container
- `PORT=4317` or your assigned port
- `APP_ORIGIN=https://your-chosen-domain` (exact origin, no trailing slash)
- `DATA_DIR` to a persistent private directory outside the source checkout
- `DATA_KEY` to a securely generated 32-byte key represented as 64 hexadecimal characters
- `REGISTRATION_INVITE` to a long random invitation shared privately with intended users
- `PRIVACY_CONTACT` to the operator's published contact for privacy questions
- `PATIENT_RELEASE_REVIEWED=true` only after completing RELEASE-CHECKLIST.md
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` for Web Push. The subject must be a real operator mailto: contact or HTTPS contact URL.

Never put the key or invitation in public code, deployment logs, or URLs. HTTPS termination is provided by the reverse proxy, not this HTTP server. Keep the server off the public network except through the proxy. Use one application instance and a local persistent SQLite filesystem, not an ephemeral filesystem or a shared network database volume.

The production switch enforces configuration requirements; it is not approval to use real patient records. Complete SECURITY.md and RELEASE-CHECKLIST.md first. The Dockerfile is a deployment starting point and has not been container-tested here.

Generate production push keys once with `node scripts/generate-push-keys.mjs /private/push-keys.json`, then store their values in host secrets and protect the private file. Keep the server running for the scheduler. Monitoring must alert the operator about outages and failed reminders. A late server restart does not replay reminders older than the 15-minute grace window.

## Database backup

Create the destination's private parent directory first. Use the included SQLite backup helper rather than copying an active WAL database file:

```sh
node scripts/backup.mjs /private/data/care.sqlite /private/backups/care-backup.sqlite
```

The destination must not already exist. Protect the backup as sensitive data. Back up the encryption key independently; a database backup without its original key cannot recover the health-record payloads. Set and verify an operator-owned backup schedule, retention period, and restore drill before patient reliance.

## Restore drill

1. Stop the application.
2. Create a new empty private data directory; do not overwrite the current database.
3. Copy the SQLite backup into the new directory as `care.sqlite`.
4. Configure the original encryption key, the new data directory, and a private test origin.
5. Start a private instance, sign in with a test account, and verify records and exports.
6. Invalidate restored sessions before exposing a recovered production instance; restored session rows may still contain unexpired sessions.
7. Resume service only after the recovered records, account ownership, and key handling have been verified.

The automated test checks persistence and the backup snapshot using fictional data. A full operator recovery drill and production backup service remain deployment responsibilities.
