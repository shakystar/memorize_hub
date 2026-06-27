# Convergence sandbox

Two isolated Docker containers (`mzA`, `mzB`) act as **two machines** that sync
one memorize project through a Hub over the network. It proves async
(poll-on-boundary) cross-machine convergence and measures push/pull latency
against a real Hub - without two physical machines.

```
mzA ──push──▶  Hub (https://...fly.dev)  ◀──pull── mzB
   each = a memorize@2.4.0 replica, its own MEMORIZE_ROOT, over HTTPS
```

## Prerequisites

Docker. No Docker Desktop needed - Docker Engine inside WSL works:

```bash
# from Windows, drive WSL's Docker as root (no password):
wsl -d <distro> -u root -- bash /mnt/c/dev/active/memorize_hub/sandbox/run.sh <cmd>
# or just run ./run.sh <cmd> from inside a shell that has Docker.
```

`HUB` defaults to the public deployment; override with `HUB=https://... ./run.sh ...`.

## Flow

```bash
./run.sh build                              # build the mz-replica image
./run.sh init                               # mzA creates a project -> prints its id
#   approve a key for that id at <HUB>/admin (operator step), copy the mzk_ key
./run.sh converge <PROJECT> <KEY>           # A↔B bidirectional + convergence assert
./run.sh latency  <PROJECT> <KEY> [ROUNDS]  # push/pull latency in ms (default 5)
./run.sh clean                              # remove containers + image
```

`converge` asserts the **replicated** event sets (everything except local
`sync.*` bookkeeping, which never crosses the wire) are byte-identical on both
machines. `latency` discards a warmup round, then averages push and pull times.

Key issuance is **manual by design** (operator approves at `/admin`) - the Hub is
operator-trusted; see [`../docs/DEPLOY.md`](../docs/DEPLOY.md). Recorded runs
live in [`RESULTS.md`](./RESULTS.md).
