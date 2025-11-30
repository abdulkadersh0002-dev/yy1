# SignalsStrategy Recovery & Validation Plan

Comprehensive plan to verify every module, ensure real-data operation, and reorganize the codebase into a robust, intelligent structure.

## 1. Restore Safety Nets (Tests & CI)

- [x] Recreate unit tests for:
  - [x] `src/data/price-data-fetcher.js` (provider fallback, latency handling).
  - [x] `src/analyzers/*` (economic, news, technical pipelines).
  - [x] `src/engine/trading-engine.js` (signal orchestration and risk gate).
- [ ] Recreate integration tests for:
  - [x] REST API endpoints (`/api/healthz`, `/api/signal/generate`, `/api/health/providers`).
  - [x] WebSocket broadcast flow.
  - [x] Alerting pipeline (Alertmanager mock receivers, runbook link checker).
- [x] Wire the rebuilt tests into CI (`npm run test:unit`, `npm run test:integration`).
- [x] Add smoke tests for ETL/backtesting scripts (success exit + key metrics).

## 2. Verify Real-Data Operation

- [ ] Inventory provider API keys (Finnhub, Polygon, TwelveData) and store them via secure secrets mechanism.
- [ ] Run app with `ALLOW_SYNTHETIC_DATA=false` and confirm:
  - [ ] `/api/health/providers` reports real provider metrics.
  - [ ] `/metrics` exposes non-zero provider latency/quality gauges.
  - [ ] WebSocket diagnostics show live provider states.
- [ ] Capture logs to ensure no synthetic data fallback occurs.
- [ ] Exercise signal generation against real market pairs and review output accuracy.

## 3. Module Interaction Audit & Refactor

- [ ] Map every major module interaction (providers ↔ analyzers ↔ trading engine ↔ routing ↔ alerting).
- [ ] Identify oversized files:
  - [ ] Split `src/server.js` into `app/http.js`, `app/websocket.js`, `app/startup.js`.
  - [ ] Break `src/data/price-data-fetcher.js` into provider clients + orchestrator.
- [ ] Define clear interfaces/contracts between modules (e.g., provider client interface, analyzer result schema).
- [ ] Document data flow so each layer consumes/produces well-defined payloads.
- [ ] Ensure modules log structured telemetry and surface errors via Prometheus metrics.

## 4. Operational Validation (No Fake Data)

- [ ] Re-run GitHub Actions CI pipeline end-to-end:
  - [ ] Confirm docker build, lint, tests, Trivy scan, and Alertmanager smoke tests all pass.
  - [ ] Ensure Alertmanager runbook link checker succeeds with live docs.
- [ ] Deploy staging environment fed with real provider keys; monitor `/api/health` and Alertmanager for at least 24 hours.
- [ ] Verify ETL scripts operate on real historical sources (disable synthetic generators).
- [ ] Confirm runbooks and documentation reference current signals.

## 5. Documentation & Next Steps

- [ ] Rebuild documentation:
  - [ ] Architecture overview showing module interactions.
  - [ ] Runbook for provider outages, data-fetch viability, alert response.
  - [ ] Developer guide for running real-data environments safely.
- [ ] Capture gaps discovered during verification and prioritize fixes.
- [ ] Schedule recurring audits (monthly) to rerun this checklist.

### Execution Notes

- Prioritize restoring tests before structural refactors to gain safety.
- Record every real-data validation run (logs + metrics snapshots) for audit.
- Treat each unchecked item as blocking for “100/100 real-data readiness.”
