# Peoplework reader and attendance setup (demo)

1. When the platform owner creates a company, choose **one reader** or **two readers**. Physical machine IDs are optional at this stage and only record the intended IDs; they do not activate a reader.
2. A firm, company, or HR administrator creates the branch, then uses **Organization → Bind face reader**. For one reader, choose `alternate`. For two readers, register one `in` and one `out` reader for each branch. Save the one-time HMAC signing key securely. Rebinding a branch/role rotates its credential and deactivates the old one.
3. Readers send signed `POST https://demo.ascommunications.xyz/api/biometric/events` requests. The server derives company, firm, branch, and punch role solely from the registered reader. Do not send a company or branch ID in the body.

Headers:

```text
Content-Type: application/json
x-device-id: <registered physical machine ID or Peoplework API device UUID>
x-timestamp: <current Unix time in milliseconds>
x-nonce: <unique 16–100 character alphanumeric/hyphen nonce>
x-signature: <hex HMAC-SHA256 of timestamp + "." + nonce + "." + exact raw JSON body, keyed by the one-time signing key>
```

Body example:

```json
{"employeeCode":"EMP001","occurredAt":"2026-09-25T09:00:00+05:30","eventId":"reader-unique-event-123"}
```

The body does **not** need `direction`. If supplied, it is ignored. The device and employee must belong to the same firm, company, and branch. `eventId` is idempotent per registered device; repeated deliveries are not counted twice. A five-minute timestamp window and nonce replay protection apply.

One-reader punches alternate IN, OUT, IN, OUT in chronological order for each employee's workday. Two-reader punches derive IN/OUT from their configured reader roles. The daily detail pairs completed IN→OUT sessions and sums their durations; it shows first IN, last OUT, each punch, and total work time. A published attendance policy may assign a day or night shift, including a shift that crosses midnight. The shift workday window begins four hours before its scheduled start and runs for 24 hours, so a post-midnight OUT is associated with the preceding night shift.

Policy thresholds are applied to paired work minutes: below the minimum is absent; from the minimum through the half-day maximum is half-day when enabled; above that through the short-day maximum is short-day when enabled; otherwise present. A group with `punchRequired=false` is present without punches unless an approved leave covers that date. Future dates and dates before the employee joined are not due. A scheduled lunch break reduces the configured shift hours, but actual worked time is **not** automatically reduced for lunch: it comes from the IN/OUT pairs. Late-after-grace and time above the scheduled shift are displayed for review; the latter is not automatically approved or paid as overtime.

This is a test integration contract. Before using a physical reader, verify its actual webhook format, clock synchronization, signing capability, secure secret provisioning, and retry behavior. If the reader cannot sign this format, use a branch-local adapter to translate and sign its events; never expose an unsigned public ingestion endpoint.
