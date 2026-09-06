# Thalassaemia Care

**Your dreams matter. So do rest, support, and the days that feel harder.**

I made Thalassaemia Care from my own experience with thalassaemia. I wanted a kinder place to keep track of transfusions, medicines, appointments, and reports—so there is a little less to remember and more room for life.

— **Shrishti Yadav**

## The web application

A mobile-friendly personal care organizer with individual accounts, encrypted server-side records, and optional browser reminders. The first signed-in release is for adults in India managing their own care. A fictional sample dashboard is available without an account.

**Current status:** working development project; automated checks pass. Not yet approved for real-patient rollout, publicly hosted, or verified for real-device push delivery. Complete [the release checklist](RELEASE-CHECKLIST.md) before inviting patients. No compliance or clinical-safety certification is claimed.

## What it includes

- **Today:** the next future transfusion appointment entered from the care plan, latest hemoglobin, daily medicine checklist, and scheduled/overdue care.
- **Transfusions:** dates, location, hemoglobin before/after with units, transfused units, and notes.
- **Medicines:** prescribed daily schedules, taken/skipped logs, duplicate-dose-log prevention, and recent history.
- **Labs:** dated values, units and lab reference ranges, plus a hemoglobin trend for matching units.
- **Appointments and care notes:** clinic visits, planned transfusions, tests, clinician-identified deficiencies, and follow-ups.
- **Browser reminders:** opt-in, generic lock-screen copy, server-side scheduling, durable retry queue, cancellation checks, and a test button.
- **Calendar fallback:** neutral appointment downloads with one-day/one-hour alarms.
- **Personal records:** search, edit, delete, JSON download, and a printable visit summary.
- **Account security:** scrypt passwords, expiring sessions, inactivity locking, change password, a one-time recovery code, and deletion.
- **A human voice:** a founder's letter, kind daily encouragement, and reliable learning resources. No streaks, shame, or promises about medical outcomes.

## Run locally

Install Node.js 24 or newer, then:

```sh
npm ci --ignore-scripts
npm start
```

Open `http://127.0.0.1:4317` and choose **Explore a sample dashboard**, or create a development account using fictional records. Save your recovery code privately. It is shown only when issued; losing both your password and code can lock you out.

Development is loopback-only. Encrypted records and generated development keys live in the ignored `data/` directory. **Keeping keys beside the database is for development convenience, not production key separation.** The runtime dependency is the pinned `web-push` library and its lockfile dependencies.

## Browser reminders

Open **Preferences → Gentle reminders** after signing in. Enable the current browser and send a test. Reminders cover daily medicines, appointments one day and one hour before, and dated care notes at 9 am in the patient's chosen time zone. No medicine name, diagnosis, or lab value is put in the alert; the device may still display the site's identity.

The server must stay running and reachable. A provider accepting an alert is not proof that a patient saw it. The service worker can report that the browser accepted display; actual receipt still needs a device check. Offline devices, OS settings, denied permissions, expired subscriptions, and outages can delay or prevent reminders.

On supported iPhones/iPads, install the website to the Home Screen and open it there before enabling Web Push. Use HTTPS for deployment. A Node process running only on your laptop does not provide an always-on hosted reminder service.

Retries use a 15-minute grace window, stable notification tags, and at most five attempts. Duplicate delivery can still occur after an uncertain network outcome; browser tags reduce duplicate visible alerts. Reminders missed beyond the grace window are not sent as a late burst. Review Today after outages. Sign-out disables the current sign-in's subscriptions; recovery disables all subscriptions. Inactivity locking keeps existing generic reminders enabled.

Calendar files are independent copies: import them and verify alarm settings. Editing or deleting an appointment here does not update previously imported calendar events.

## Clinical boundaries

The next transfusion date is entered from the clinician's plan. Hemoglobin readings never calculate, postpone, or cancel it. This app does not interpret results, recommend supplements, change doses, or monitor emergencies. Ferritin is one part of iron monitoring. Iron chelation is different from taking iron supplements.

This version supports daily medicine schedules only. As-needed, weekly, alternating-dose regimens, child/guardian accounts, and clinician portals are not implemented. Do not change a prescription to fit the interface.

## Validate and build

```sh
npm test
npm run build
```

Automated checks cover account isolation, CSRF/origin checks, stale edits, duplicate doses, time zones, recovery-code rotation, encrypted persistence, backup snapshots, push destination restrictions, queue deduplication/retries, plan cancellation, display acknowledgements, and calendar output. Browser visual/accessibility testing and real-device push delivery remain release checks. Optional WebMCP navigation is feature-detected; a supported validation context was not available in this session.

The build puts the runnable application and package lock in `dist/`, excluding records and keys. Install production dependencies there before moving it to another machine.

## Hosting and GitHub

GitHub hosts the source. **GitHub Pages cannot run this application's account/database server.** Use a reviewed Node 24 host with a private persistent volume, an HTTPS reverse proxy, server secrets, and operator-managed backups. A Dockerfile is included but was not built in this environment.

Read [deployment and recovery](DEPLOYMENT.md), [security details](SECURITY.md), and [the release checklist](RELEASE-CHECKLIST.md). Never upload patient data, database backups, recovery codes, encryption keys, or private credentials to GitHub.

## Project layout

```text
server.mjs             HTTP API, accounts, encrypted SQLite persistence
lib/domain.mjs         Record validation, patient dates, calendar export
lib/reminders.mjs      Browser subscriptions and persistent reminder queue
public/               Responsive interface, supportive copy, service worker
tests/                Security, scheduling, and behavior checks
scripts/              Build and database backup helpers
```

## References

- [TIF: transfusion guidance](https://www.ncbi.nlm.nih.gov/books/NBK614240/)
- [TIF: iron overload and chelation](https://www.ncbi.nlm.nih.gov/books/NBK614244/)
- [TIF: lifestyle and quality of life](https://www.ncbi.nlm.nih.gov/books/NBK614233/)
- [WebKit: Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
