# Peoplework HRMS — implementation baseline

This repository is a runnable, responsive web HRMS foundation with fictional demo data. It is designed for a firm (tenant) that owns multiple companies and branches. The UI is only a convenience layer: every protected record is scoped again in the API and PostgreSQL row-level security (RLS).

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The development login page offers clearly marked fictional demo accounts. All use the displayed demo password. Development data is stored locally in `.data/`; it is ignored by Git.

```bash
npm test          # 49 backend/security tests
npm run test:ui   # 8 Chrome user-journey tests
npm run build
```

## Implemented now

| Area | Delivered behaviour |
|---|---|
| Tenancy and scope | Tenant → company → branch data model; firm, company, HR, manager and employee role scopes. Company A cannot list, fetch, update or export Company B records. |
| People and masters | Employee directory; dynamic master-data records; employment type, policy and salary assignment with effective dates. |
| Leave and policy | Versioned, immutable published policies; company/branch/effective-date/employment-type resolution; allowance and overlap checks; separation from policy visibility. |
| Attendance | Manual audited punches plus signed biometric event ingestion with device-bound location, nonce replay protection and idempotency. |
| Payroll | Integer-paise salary snapshots, company-period uniqueness, draft → review → two-person lock. This is **not** statutory/payroll-payment ready yet. |
| Other modules | Usable scoped registers for performance, learning, canteen, contractors, gate passes, exits and support tickets. |
| Support assistant | Curated product help with citations and escalation. It does not send prompts to OpenAI. An operator may configure a private local model only to rephrase a vetted article. |

## Security model

- Passwords use salted `scrypt`; sessions are server-side, hashed, HttpOnly and SameSite=Strict.
- Every write requires same-origin validation and a per-session CSRF token. The API accepts JSON only; fields are strict allow-lists.
- API route checks reject changed query scopes, identifiers and methods. Parameterized SQL is used throughout.
- PostgreSQL RLS uses the authenticated actor set transaction-locally; direct, unfiltered SQL is tested to return only permitted rows. Composite foreign keys prevent crossing company and branch scopes.
- Security headers, no-store API responses, CSP, rate limits and request-size limits are configured. Production requires HTTPS.
- Audit records are append-only for the runtime role. Published policies and locked payroll cannot be edited.
- Biometric payloads require HMAC-SHA256 over timestamp, nonce and raw request; events are tied to a registered device and its company/branch, and are replay/idempotency protected.

No software can honestly promise zero vulnerabilities. Before a live rollout, perform independent penetration testing, dependency scanning in CI, threat-model review, database backup/restore drill and a legal/compliance review for local payroll/tax rules.

## Production deployment

Use a managed PostgreSQL service and a container runtime on AWS, OCI or GCP. The recommended path for an initial firm is:

```text
Users / Mobile web / STARLINK device
             │ HTTPS
       WAF + load balancer
             │
     Peoplework application containers
        │        │        │
 PostgreSQL  object storage  queue/worker (next phase)
     private network; monitoring, alerts and backups
```

The browser and device can access only the HTTPS edge. PostgreSQL is private. Store documents in private object storage and issue short-lived, scope-checked download/upload URLs; document storage is the next implementation item, not a completed feature in this baseline.

Use [compose.production.example.yml](compose.production.example.yml) as an illustrative single-app container configuration. It deliberately expects secrets from the platform. Run schema migrations with a separate migration owner (`MIGRATION_DATABASE_URL`); runtime uses a non-owner, non-superuser login (`DATABASE_URL`). Do not run demo mode in production.

### Cloud choice and indicative hosting

OCI is usually the value option for a 90–300 employee first deployment; AWS is strongest when the customer already uses AWS or needs broad managed-service integrations; GCP is appropriate for a Google-first organization. Start with 2 app instances (1 vCPU / 2 GB each), managed PostgreSQL (2 vCPU / 4–8 GB), private object storage, WAF/CDN, daily backups and monitoring. Exact monthly spend depends on region, retention, bandwidth and support plan, so obtain a current calculator quote before committing. A demo can use the local preview or a short-lived free/credit tier, but never place real HR/biometric data on a free public deployment.

## Known implementation boundaries

This is a strong working baseline, not the complete commercial HRMS scope. Before go-live, implement and validate statutory tax/PF/ESI/TDS, payroll proration and bank files, multi-stage workflows, native Android/iOS app, document storage, notifications, device provisioning/secret rotation, SSO/MFA, scheduled backups/DR automation, observability pipeline and the detailed workflows for PMS/training/canteen/exit/gate passes. The test report gives the current exact status.
