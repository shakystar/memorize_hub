#!/usr/bin/env bash
# memorize Hub — Docker convergence + latency sandbox.
#
# Two isolated containers (mzA, mzB) act as two machines that sync one memorize
# project through a Hub over the network. This proves async (poll-on-boundary)
# cross-machine convergence and measures push/pull latency against a real Hub.
#
# Requires Docker (e.g. inside WSL: `service docker start` then run this).
#
#   ./run.sh build                              # build the replica image
#   ./run.sh init                               # A creates a project; prints its id
#   #   ...operator approves a key for that id at <HUB>/admin, copies the mzk_ key...
#   ./run.sh converge <PROJECT> <KEY>           # A<->B bidirectional + convergence assert
#   ./run.sh latency  <PROJECT> <KEY> [ROUNDS]  # push/pull latency in ms (default 5)
#   ./run.sh clean                              # remove containers + image
#
# HUB defaults to the public deployment; override with `HUB=https://… ./run.sh …`.
set -euo pipefail

IMAGE=mz-replica
A=mzA
B=mzB
HUB="${HUB:-https://memorize-hub-shakystar.fly.dev}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ensure_docker() {
  service docker start >/dev/null 2>&1 || true
  for _ in $(seq 1 15); do docker info >/dev/null 2>&1 && return 0; sleep 1; done
  echo "dockerd is not available" >&2
  exit 1
}

up() {
  ensure_docker
  for c in "$A" "$B"; do
    if docker inspect "$c" >/dev/null 2>&1; then
      docker start "$c" >/dev/null
    else
      docker run -d --name "$c" "$IMAGE" sleep infinity >/dev/null
    fi
  done
}

# Sorted ids of replicated (non-sync.*) events in a container's project db.
# Local `sync.*` bookkeeping never crosses the wire, so it is excluded — the
# replicated set is what must match across machines.
replicated_ids() { # $1=container $2=project
  docker exec -i "$1" node --experimental-sqlite -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const rows = db.prepare("select id from events where type not like \x27sync.%\x27 order by id").all();
    for (const r of rows) console.log(r.id);
  ' "/root/.memorize/projects/$2/memorize.db" 2>/dev/null
}

cmd_build() { ensure_docker; docker build -t "$IMAGE" "$here"; }

cmd_clean() {
  ensure_docker
  docker rm -f "$A" "$B" >/dev/null 2>&1 || true
  docker rmi "$IMAGE" >/dev/null 2>&1 || true
  echo "cleaned"
}

cmd_init() {
  up
  docker exec -i "$A" bash -s <<'STEP'
cd /work && mkdir -p proj && cd proj
memorize project init
STEP
  echo
  echo "Approve a key for the project id above at $HUB/admin, then:"
  echo "  $0 converge <PROJECT> <KEY>"
}

cmd_converge() {
  local PROJECT="$1" KEY="$2"
  up
  echo "== A: task + push =="
  docker exec -i "$A" bash -s "$HUB" "$KEY" <<'STEP'
cd /work/proj
memorize task create "Task from A sandbox" >/dev/null
memorize project sync --push --remote-url "$1" --token "$2"
STEP
  echo "== B: bind + pull + task + push =="
  docker exec -i "$B" bash -s "$HUB" "$KEY" "$PROJECT" <<'STEP'
mkdir -p /work/cloneB && cd /work/cloneB
memorize project clone "$3" --remote-url "$1" --token "$2" >/dev/null 2>&1 || true
memorize project sync --pull --remote-url "$1" --token "$2"
memorize task create "Task from B sandbox" >/dev/null
memorize project sync --push --remote-url "$1" --token "$2"
STEP
  echo "== A: pull =="
  docker exec -i "$A" bash -s "$HUB" "$KEY" <<'STEP'
cd /work/proj
memorize project sync --pull --remote-url "$1" --token "$2"
STEP
  echo "== convergence check =="
  local idsA idsB
  idsA="$(replicated_ids "$A" "$PROJECT")"
  idsB="$(replicated_ids "$B" "$PROJECT")"
  if [ -n "$idsA" ] && [ "$idsA" = "$idsB" ]; then
    echo "CONVERGED: $(printf '%s\n' "$idsA" | wc -l) replicated events identical on A and B"
  else
    echo "DIVERGED"
    diff <(printf '%s\n' "$idsA") <(printf '%s\n' "$idsB") || true
    exit 1
  fi
}

cmd_latency() {
  local PROJECT="$1" KEY="$2" ROUNDS="${3:-5}"
  up
  # Ensure B is bound + caught up before timing.
  docker exec -i "$B" bash -s "$HUB" "$KEY" "$PROJECT" <<'STEP'
mkdir -p /work/cloneB && cd /work/cloneB
memorize project clone "$3" --remote-url "$1" --token "$2" >/dev/null 2>&1 || true
memorize project sync --pull --remote-url "$1" --token "$2" >/dev/null 2>&1 || true
STEP
  echo "Hub: $HUB   rounds: $ROUNDS   (round 0 = warmup, discarded)"
  local total_push=0 total_pull=0 n=0
  for i in $(seq 0 "$ROUNDS"); do
    local marker="lat-$i-$RANDOM" push_ms pull_ms
    push_ms="$(docker exec -i "$A" bash -s "$HUB" "$KEY" "$marker" <<'STEP'
cd /work/proj
memorize task create "$3" >/dev/null
t0=$(date +%s%3N)
memorize project sync --push --remote-url "$1" --token "$2" >/dev/null
t1=$(date +%s%3N)
echo $((t1 - t0))
STEP
)"
    pull_ms="$(docker exec -i "$B" bash -s "$HUB" "$KEY" <<'STEP'
cd /work/cloneB
t0=$(date +%s%3N)
memorize project sync --pull --remote-url "$1" --token "$2" >/dev/null
t1=$(date +%s%3N)
echo $((t1 - t0))
STEP
)"
    if [ "$i" -eq 0 ]; then
      echo "warmup: push=${push_ms}ms pull=${pull_ms}ms (discarded)"
      continue
    fi
    echo "round $i: push=${push_ms}ms pull=${pull_ms}ms total=$((push_ms + pull_ms))ms"
    total_push=$((total_push + push_ms)); total_pull=$((total_pull + pull_ms)); n=$((n + 1))
  done
  echo "----"
  echo "avg over $n rounds: push=$((total_push / n))ms pull=$((total_pull / n))ms total=$(((total_push + total_pull) / n))ms"
}

case "${1:-}" in
  build) cmd_build ;;
  init) cmd_init ;;
  converge) shift; cmd_converge "$@" ;;
  latency) shift; cmd_latency "$@" ;;
  clean) cmd_clean ;;
  *) echo "usage: $0 {build|init|converge <proj> <key>|latency <proj> <key> [rounds]|clean}" >&2; exit 2 ;;
esac
