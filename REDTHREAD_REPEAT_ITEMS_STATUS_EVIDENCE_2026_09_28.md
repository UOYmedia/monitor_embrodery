---
title: "RedThread repeated-pattern machine status — implementation evidence"
tags: [redthread, monitor, repeat-items, verification]
status: active
created: 2026-09-28
---

Task authorization: Vu event `3f8094cd8705be57b3aa07d1b77ac9f41d0e863a88096e922198d91e8832fbd2`, thread `d69c13dfee99b045a834a446c81b6826a1fab65f75fd2f89eca35611816ac82b`, channel `f493dd90-ab85-45b2-931f-4805c48c98de`.

Worktree: `/Users/nguyenvu/Desktop/go/monitor_embrodery-worktrees/repeat-items-status-20260928`.
Branch: `vu/repeat-items-status`; fetched base `99c51f1940a09ae7c8ce92d9f04ce74380688ff1` (`origin/main`).

Behavior delivered:

- A positive per-design total can be lower than the repeated-run counter. Keep raw numbers and derive `floor(current / base)` item equivalents: 46,966 / 3,912 = 12; 46,944 / 3,912 = 12; 34,628 / 3,912 = 8. Residual stitches do not round up.
- Repeated running frames stay running. Repeated stopped frames use `dung-lap` / numeric 11, labeled “ĐÃ DỪNG”; they do not claim completion or an unfinished frame. Existing historical state codes 0–10 stay unchanged. Four Grafana source dashboards append mapping 11.
- Viewer and React display the inferred items as an estimate, with original current and mũi/mẫu; no percentage or ETA of an unknown full frame. Old/stale/offline and telemetry-error snapshots do not display derived items. Unknown/zero/invalid denominator is not divided. Invalid types and unsafe integers remain rejected at ingestion.
- Snapshot-based inference resets when counter or pattern changes; no hardcoded factor or persistent repeat configuration. Exact one-pattern equality retains existing completion semantics after reset, because available telemetry does not distinguish one-pattern work from a new repeat setup.
- Connector sends actual repeated `currentStitch`, `totalStitches: null` (unknown whole-frame total), and explanatory `statusNote`; stopped repeat maps PAUSED. Existing durable startup/gap/invalid-counter reset acknowledgement remains intact. No RedThread backend change or historical backfill.
- Production ledger remains based on independent odometer delta and physical-rate checks; inferred items are not booked as production. The old rule blocking a valid odometer merely because job counter spans repeats is removed.

Verification environment: macOS, Node `v22.22.2`, npm `10.9.7`, Python `3.14.0` in existing `/Users/nguyenvu/.buzz/.scratch/stitch-overrun-venv` (Crypto available). Locked dependencies installed with `npm ci` (97 packages, audit 0 vulnerabilities).

Required gate, on base above plus this branch's implementation working tree:

```sh
PATH=/Users/nguyenvu/.buzz/.scratch/stitch-overrun-venv/bin:$PATH npm run verify
```

Result: **PASS**. Vitest **81 files / 1,565 tests, zero skips**; connector **28 tests, zero skips**; oxlint, TypeScript + production build, bridge syntax **50 modules**, gateway archive/source consistency and offline Python suites passed.

- Python state self-check: **77/77**; Python/JS parity matrix: **4,504** cases; actual viewer-source test harness: **155/155**; standalone viewer state checks **33/33** (invoked by main suite).
- New regressions cover 46,966, 46,944, 34,628 and partial first repeat; running/stopped; explicit visible generic stop wording; no incomplete-pattern alert; stale derived values; zero/missing/invalid totals; safe integers; new pattern/reset; heartbeat startup clear then real counter delivery; independent odometer bookkeeping.
- Enum runner executes 11 Python test files. Two opt-in/environment tests remain explicitly skipped: production log durability (`test_ben_vung_live.py`, no live local broker log) and destructive production-process recovery (`test_tu_hoi_phuc.py`, no `DAHAO_CHO_PHEP_GIET=1`). Real workshop DST files are unavailable; synthetic DST tests passed. These are live-site checks, not the 18 accidental Crypto-dependent Vitest skips from the earlier incomplete run; all 18 were restored and passed in the final gate.
- Malformed-frame loopback tests passed **11/11**; broker state regression confirms raw counter increases still mean running above base, resets stop and changed pattern starts unknown.
- Test-only literal synthetic AES keys were removed after tests. Archive contains no broker secret file; package rebuilt with the non-secret config already present in the tracked previous archive. No new live secret copied into code or package.

Evidence output: `/private/tmp/repeat_verify_full.log` (temporary); final report and commit preserve results. Changed-file byte hashes after self-review: `/private/tmp/repeat_tested_hashes.sha256` (temporary). No runtime code changed after the passing full gate; only this report and explanatory README were finalized. No push, PR, main merge, server write or service restart performed by implementer. Parent owns independent browser/candidate review and live deployment decision.
