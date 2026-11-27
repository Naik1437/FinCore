# FinCore Assessment Evidence Index

| Assessment | Implementation | Tests / verified result | Documentation / remaining evidence |
|---|---|---|---|
| 01 | `apps/web/src/app`, `apps/web/src/components` | `apps/web/src/__tests__/dashboard.test.tsx`, Playwright journey | `README.md`; attach workflow/video evidence |
| 02 | `apps/api/src/routes`, validation middleware | `apps/api/src/__tests__/assessment02.test.ts` | `docs/openapi.json`, Postman collection |
| 03 | `scripts/init-db/02-assessment03-ledger-engine.sql`, `consistencyEngine.ts` | `assessment03.test.ts`, reconciliation output | `docs/ARCHITECTURE.md` |
| 04 | `auth.ts`, `middleware/auth.ts`, auth routes | `assessment04.test.ts`, MFA/RBAC tests | `docs/SUBMISSION_CHECKLIST.md`; MFA is simulated |
| 05 | `services/analytics/app/calculations` | `services/analytics/tests/test_calculations.py` | `README.md`; attach CI artifact |
| 06 | `services/analytics/app/risk`, FastAPI routes | `test_risk.py` | `README.md`; attach CI artifact |
| 07 | `apps/api/src/services/consistencyEngine.ts` | `assessment07.test.ts` | `docs/ARCHITECTURE.md` |
| 08 | `stripeAdapter.ts`, `paymentProvider.ts`, `notificationService.ts` | `assessment08.test.ts` | `docs/PROVIDER_EVIDENCE_RUNBOOK.md`; live webhook/delivery evidence pending |
| 09 | Dockerfiles and `docker-compose.yml` | `assessment09.test.ts`, CI container job | Attach Docker health output |
| 10 | `.github/CODEOWNERS`, PR template, governance docs | `assessment10.test.ts` | `docs/GIT_GOVERNANCE.md`; tag/approval records pending |
| 11 | `.github/workflows/ci.yml` | CI run and uploaded artifacts | Real staging/production deployment and rollback remain pending |
| 12 | API, ledger and failure-path tests | `assessment12.test.ts`, CI financial gates | Attach JUnit artifacts |
| 13 | `docs/openapi.json`, Postman collection | `assessment13.test.ts` | Contract review/sign-off pending |
| 14 | `scripts/backup.sh`, `restore.sh`, `docker/nginx.conf` | `assessment14.test.ts`, restore-drill output | Permanent HTTPS, monitoring and retained recovery evidence pending |
| 15 | incident routes, reconciliation and RCA docs | `assessment15.test.ts` | `docs/INCIDENT_POSTMORTEM_RCA.md`; attach incident timeline/video |

## Missing submission artifacts

- Final CI URL and downloadable test artifacts.
- Docker health/connectivity capture for all services.
- Release tag, commit SHA, dual-approval and migration-review records.
- Real staging deployment, approval and rollback evidence, or evaluator-approved waiver.
- Permanent HTTPS/DNS/certificate and monitoring evidence.
- Stripe live webhook delivery and Twilio final delivery evidence.
- Backup encryption and isolated restore logs with redacted secrets.
- Architecture/ER/data-flow diagrams in submission-readable form.
- Final demonstration recording and known-limitations statement.

## Executable deployment evidence

These commands require real operator-supplied environment URLs and never substitute
echo-only simulations for deployment evidence:

```bash
bash scripts/create_release_manifest.sh release-manifest.txt
BASE_URL=https://staging.example EXPECTED_VERSION="$GIT_SHA" \
  bash scripts/verify_staging.sh

# After the operator performs rollback to a known release:
BASE_URL=https://staging.example EXPECTED_VERSION="$ROLLBACK_SHA" \
  bash scripts/verify_rollback.sh
```

The existing CI staging/production jobs remain intentionally non-deploying until a
real deployment executor, protected environment secrets, approval rules and rollback
target are supplied. Their successful completion must not be described as deployment
evidence.
