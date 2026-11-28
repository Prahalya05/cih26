# DPDP Act 2023 Compliance Checklist (Pilot Template)

Fill in all `[PLACEHOLDER]` fields with the pilot NGO / Data Fiduciary details before onboarding real students.

---

## 1. Privacy Notice (English / Tamil / Hindi Template)

- **Data Fiduciary:** `[Organisation Legal Name]`
- **Contact / Address:** `[Registered Office Address]`
- **Purpose of Processing:** Career guidance, skill assessment, scheme eligibility checking, and optional employer/funder verification.
- **Data Collected:**
  - Student name, guardian name, and phone number (encrypted at rest in `student_private` using `pgcrypto` + `PII_KEY`; never exposed to analytics roles or AI prompts).
  - Pseudonymous assessment events, rubric scores, and self-declared facts (income band, category, gender stored on-device and in ZK credentials).
- **Data Never Collected:** Aadhaar numbers, bank account details, contact lists, raw GPS coordinates, raw voice audio, or unblurred face videos.
- **Student / Guardian Rights:**
  - **Withdraw consent:** Toggle off in the **Privacy** screen (stops two-way sync immediately).
  - **Erase all data:** `DELETE /v2/student/{id}` permanently removes all student records, keeping only an anonymous daily deletion count (`deletion_count`).
  - **Grievance redressal:** Contact the Grievance Officer listed below.

---

## 2. Verifiable Parental Consent (DPDP Section 9 — Children's Data)

- [ ] Under-18 (or unknown birth year) students use `paper_form` signed by a parent/guardian OR teacher-initiated `guardian_otp` verified against a phone number distinct from the student's own account.
- [ ] No behavioural tracking, profiling, or targeted advertising SDKs (`scripts/check_privacy.py` passes in CI).
- [ ] Under-18 profiles can never be published as `public` (`rule.publish`).

---

## 3. Grievance Officer

| Field | Details |
| :--- | :--- |
| **Name** | `[Full Name]` |
| **Designation** | `[Data Protection / Grievance Officer]` |
| **Email** | `[grievance@organisation.org]` |
| **Phone** | `[+91-XXXXXXXXXX]` |
| **Office Address** | `[Street, District, State, PIN]` |
| **Acknowledgement SLA** | Within `24 hours` of receipt |
| **Resolution SLA** | Within `15 days` (or statutory DPDP limit) |

---

## 4. 72-Hour Data Breach Procedure

1. **Hour 0–4 (Detection & Containment):**
   - Revoke compromised `ADMIN_TOKEN`, `AUTH_SECRET`, `PII_KEY`, `ZK_ISSUER_KEY`, or device tokens (`POST /v2/logout` / `device.revoked_at`).
   - Snapshot server logs and Postgres audit state without logging student PII.
2. **Hour 4–24 (Impact Assessment):**
   - Identify affected schools, tables, and whether encrypted `student_private` (`name_enc`, `phone_enc`, `guardian_name_enc`) or `PII_KEY` was exposed.
3. **Within 72 Hours (Statutory Notification):**
   - Notify the **Data Protection Board of India** (and CERT-In if applicable) with:
     - Nature and timeline of breach: `[Summary]`
     - Categories and approximate count of affected students: `[Count]`
     - Contact details of Grievance Officer: `[Name, Email, Phone]`
     - Containment and remediation actions taken: `[Actions]`
   - Notify affected students, parents/guardians, and partner schools in Tamil, Hindi, and English.
4. **Post-Incident (Day 4–14):**
   - Rotate all keys, run `scripts/check_privacy.py` and security audit, and document root cause.

---

## 5. Data Retention & Deletion Schedule

| Data Category | Storage Location | Retention Period | Deletion Mechanism |
| :--- | :--- | :--- | :--- |
| Student & guardian PII (`student_private`) | Postgres (`pgcrypto` encrypted) | `[Active pilot + 12 months]` or until withdrawal | `DELETE /v2/student/{id}` (cascades immediately) |
| Evidence events & skill state | Postgres + phone IndexedDB | `[Active pilot + 12 months]` | `DELETE /v2/student/{id}` |
| Buyer confirmation records | Postgres (`evidence_event`) | `365 days` (shown on `ConfirmJob` notice) | Scheduled purge / `DELETE /v2/student/{id}` |
| Guardian / buyer phone OTP HMACs | Postgres (`guardian_otp`, `confirm_token`) | OTP expires in `10 minutes`; token in `7 days` | `DELETE /v2/student/{id}` / expiry cleanup |
| Anonymous deletion counts | Postgres (`deletion_count`) | Indefinite (aggregate count only, zero PII) | N/A (non-personal) |
| Pilot end-of-life wipe | All environments | Within `[30 days]` of pilot close | Export aggregate metrics, then purge student tables |
