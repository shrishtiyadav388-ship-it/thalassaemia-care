# Real-patient release gate — India

This repository contains a working application, not approval to handle patient records. Passing automated tests or setting an environment flag is not a substitute for review. A public deployment has not been made.

## Implemented in the development build

- Individual sign-in and server-side record ownership.
- Encrypted clinical-record and push-subscription payloads.
- Password hashing, recovery-code rotation, session expiry, and browser inactivity lock.
- CSRF/origin checks, bounded requests, restricted outbound push destinations, and authentication rate limits.
- Server-side reminder queue, deduplication, retries, schedule cancellation checks, and generic notification wording.
- Patient export, correction, deletion, privacy explanation, and recorded adult/notice declarations.
- Daily encouragement without outcome promises, shame, adherence streaks, or pressure to be positive.

## Required before inviting real patients

- [ ] Name the operator and publish a working privacy/grievance contact.
- [ ] Review applicable Indian data-protection requirements, commencement dates, and cross-border processing by browser push providers with a qualified reviewer.
- [ ] Confirm the initial adult, self-managed scope. Do not onboard children or guardian-managed records until an appropriate consent and authorization flow is reviewed. An adult declaration checkbox does not implement verified parental consent.
- [ ] Have a thalassaemia clinician review scheduling boundaries, medication workflows, missed-dose wording, lab units, and patient-facing copy.
- [ ] Select suitable hosting, private persistent storage, TLS, firewall rules, encrypted disks, secret storage, and operational access controls.
- [ ] Set private production data and VAPID keys and an invitation policy. Do not reuse development keys.
- [ ] Test backup, key recovery, retention, incident response, and deletion procedures, including backup copies.
- [ ] Test complete journeys on supported browsers, keyboard and assistive technology, mobile widths, and 200% text zoom.
- [ ] Prove notification delivery on actual Android/desktop browsers and supported iOS Home Screen installations. Include blocked permissions, logout, expired subscriptions, retries, and outages.
- [ ] Arrange monitoring of failed jobs, storage limits, downtime, patching, and security reports.
- [ ] Perform independent security review and decide whether MFA or additional identity/age controls are required.
- [ ] Pilot with a small consenting group after review and document remaining limitations.

Set `PATIENT_RELEASE_REVIEWED=true` only after the hosting operator completes this process. The flag records an operator decision; it does not certify compliance or clinical safety.

## Sources for the review

- [MeitY: Digital Personal Data Protection Act](https://www.meity.gov.in/content/digital-personal-data-protection-act-2023-dpdp-act)
- [MeitY: Acts and policies](https://www.meity.gov.in/documents/act-and-policies)
- [TIF: blood transfusion](https://www.ncbi.nlm.nih.gov/books/NBK614240/)
- [TIF: iron overload and chelation](https://www.ncbi.nlm.nih.gov/books/NBK614244/)
- [TIF: lifestyle and quality of life](https://www.ncbi.nlm.nih.gov/books/NBK614233/)
- [WebKit: Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
