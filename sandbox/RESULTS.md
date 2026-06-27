# Convergence & latency - measured runs

Records of real cross-machine sync through the deployed Hub, produced by
[`run.sh`](./run.sh). Append new runs; don't rewrite old ones.

---

## 2026-06-27 - first production measurement

**Setup**
- Hub: `https://memorize-hub-shakystar.fly.dev` (Fly.io, region `nrt`, single
  machine, `auto_stop_machines=stop` + `min_machines_running=0` -> idles to zero).
- Two machines = two Docker containers (`mzA`, `mzB`) running Docker Engine inside
  WSL2 (no Docker Desktop). Each: `@shakystar/memorize@2.4.0`, its own
  `MEMORIZE_ROOT`, reaching the Hub over the public internet (HTTPS).
- Key issued via the real operator flow: a `/beta` request approved at `/admin`.

**Convergence** - `run.sh converge` (A pushes, B clones + pushes back, A pulls):

| direction | result |
|---|---|
| A -> B | A push 3 events -> B clone pulled 3; B sees A's task |
| B -> A | B push 1 event -> A pull "1 new, 3 duplicates skipped" (dedup) |
| assert | **CONVERGED** - replicated event sets byte-identical on A and B |

Note A's raw event count (13) ≠ B's (11): the difference is local `sync.*`
bookkeeping, which intentionally never syncs. The **replicated** (non-`sync.*`)
sets match exactly - that is the convergence contract.

**Latency** - `run.sh latency ... 5` (push from A, then pull on B):

| round | push (ms) | pull (ms) | total (ms) |
|---|---|---|---|
| warmup (discarded) | 4263 | 3262 | - |
| 1 | 6576 | 2510 | 9086 |
| 2 | 2419 | 2604 | 5023 |
| 3 | 2803 | 2104 | 4907 |
| 4 | 1853 | 2247 | 4100 |
| 5 | 2380 | 1864 | 4244 |
| **avg (5)** | **3206** | **2265** | **5472** |

**Interpretation**
- Warm round-trip (push + pull) ≈ **4-5 s**; round 1 was ~9 s because the Fly
  machine had idled to zero and cold-started on first hit.
- The time is dominated by **memorize CLI process startup** (Node + better-sqlite3
  load + DB open per invocation) and the occasional **Fly cold start** - not Hub
  processing. Each number is full end-to-end `memorize project sync ...` wall time,
  i.e. what a user actually waits, not a bare HTTP round-trip.
- Lever if lower latency matters for the beta: `min_machines_running=1` removes
  cold starts (at the cost of an always-on machine). The CLI-startup floor is a
  memorize-client property, independent of the Hub.

Reproduce: `HUB=https://memorize-hub-shakystar.fly.dev ./run.sh latency <project> <key> 5`.
