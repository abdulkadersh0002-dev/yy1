# Integration Test Restoration Plan

## Coverage Targets

1. **REST API Endpoints**
   - `/api/healthz`: basic health heartbeat returns 200 + status payload.
   - `/api/health/providers`: ensure structure includes provider availability snapshot and metrics.
   - `/api/signals`: bootstrap server in test mode, validate response schema and synthetic signal payloads.

2. **WebSocket Broadcast Flow**
   - Start server with in-memory transport.
   - Connect via WebSocket client, subscribe to diagnostics channel, assert receipt of module health broadcast.
   - Verify message schema (contains `type`, `timestamp`, `payload`).

3. **Alerting Pipeline**
   - Leverage existing Alertmanager smoke harness (`scripts/ci/mock-alert-receivers.mjs`).
   - Fire synthetic alerts via `amtool`, capture mock receiver output, assert Slack/ticket payloads plus runbook URL.
   - Reuse runbook link checker script during tests.

4. **ETL / Backtest Smoke Tests**
   - `scripts/etl/run-historical-warehouse.js`: run with sample config, confirm exit code 0, verify output file presence.
   - `scripts/backtest/run-backtests.js`: run with minimal dataset, check summary metrics in stdout.

## Implementation Steps

1. ✅ Create helper to boot Express server + WebSocket in test mode (`tests/helpers/test-server.js`).
2. ✅ Write REST API tests under `tests/integration/api/` covering `/api/healthz` and `/api/health/providers`.
3. ☐ Write WebSocket tests under `tests/integration/ws/` using `ws` client.
4. ☐ Script alerting regression using `tests/integration/alerting/alertmanager.test.js` invoking existing smoke harness.
5. ☐ Add ETL/backtest smoke tests under `tests/integration/scripts/` verifying process exit + key logs.
6. ☐ Update `package.json` `test:integration` command to run all `tests/integration/**/*.test.js` (already wired but confirm once suites expand).
7. ☐ Add CI job step to run integration suite after unit tests.
