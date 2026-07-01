# Workspace Contract Brief — what to define next, and what constrains it

Status: briefing / decision context, not the contract itself.
Audience: whoever extends the Hub wire contract for the workspace layer.
Written: 2026-07-01, from the memorize `docs/SoT/` set + the 3.0.0 plan.

> **Resolved (2026-07-01).** §6 Open Decision #1 was decided **hybrid** (typed
> gateway control-plane + opaque relay event log); the §5 field terms and §3
> constraints are captured in the Hub SoT set `docs/SoT/` (H020/H040/H050) and
> `PROTOCOL.md`. This brief remains the cross-repo rationale; the binding
> decisions now live there.

## Why this doc exists

The Hub already has a living wire contract (`../PROTOCOL.md`, v1) and a design
note for the un-contracted collaboration layer (`./JOIN_AND_MERGE.md`). Since
that note was written, the **memorize** repo produced a Source-of-Truth set
(`memorize/docs/SoT/`, 2026-07-01) that **decides** several questions
`JOIN_AND_MERGE.md` still lists as open.

This brief imports those decisions so the workspace contract is defined **once,
consistent with memorize**, instead of re-litigating settled questions or
inventing field names that will not match the client. It is the cross-repo
context a Hub-cwd session cannot see from this folder alone.

The dependency is scoped: memorize's **sync/account/workspace surface** consumes
Hub; memorize's local memory pipeline (the CLS two-layer work, Phase 1) does
**not** touch Hub at all. Only the surface below needs a shared contract.

## 1. Already contracted — do NOT redefine

These live in `../PROTOCOL.md` v1 and are done. Build on them, don't fork them.

- **Event transport** — `POST/GET /v1/projects/:id/events`, opaque append-only
  events, dedup by `event.id`, order-preserving, idempotent. The relay is a dumb
  store-and-forward queue and stays that way.
- **Personal store** — `GET /v1/account/personal-store` → `psm_…` id, then the
  same events route. Owner-only, unscoped-key-only, `psm_` namespace reserved.
- **Optional E2E payload envelope** — `{ __enc, kid, iv, ct, tag }`; relay treats
  `payload` as opaque either way. Key distribution is out-of-band in v1.

Note the tension with §4 below: the E2E envelope hides payloads from the relay,
but SoT-070 says the **workspace** surface is deliberately *not* E2E in v1
(server needs plaintext to consolidate shared memory). Personal/private replica
sync MAY stay E2E; workspace shared memory MUST NOT require it. The contract must
keep these two axes separate.

## 2. Still needs a contract — the workspace layer (plan M4–M8)

`JOIN_AND_MERGE.md` sketches this; nothing is wire-frozen yet. The surfaces:

- **Workspace lifecycle (control-plane)** — create workspace, membership,
  invite/join URLs. There is no `workspace` table or membership model today
  (JOIN_AND_MERGE "Current Gap").
- **Shared-memory event shape** — the published assertion with provenance
  (`workspace.memory.published` / `shared.memory.added` — the two sketches
  disagree; see §5) plus append-only lifecycle events (superseded / retracted /
  confirmed / tagged).
- **Shared retrieval** — how members pull the workspace projection into a
  separate channel (not merged into local project memory).
  **Clarification (2026-07-01, corrects an earlier ambiguity): "separate
  channel" / "not merged" is a provenance-distinguished *logical view*, NOT a
  separate physical store.** Per memorize SoT-040/060 the workspace union is
  replicated into the *same* physical `memorize.db` as local memory — each
  member's db holds a duplicate of the full union, and shared assertions stay
  distinguishable by `writer`/`sourceProjectId` and are never folded into local
  project memory as a single canonical value. "Separate" here means *not
  fused*, not *different file*. This brief is Hub-side context; the memorize
  client stores workspace union in the same db (SoT-040), routing by
  server-minted `wsp_` while `proj_` stays the local identity + provenance.
- **Shared tasks (later, M7)** — workspace-level task entities + local task links,
  no local task-state merge.

## 3. Constraints imported from memorize SoT — treat as decided

These are **Decisions** in `memorize/docs/SoT/` (valid until explicitly
superseded there). The workspace contract must obey them; do not re-open.

- **Identity is server-issued (SoT-020).** The server mints `accountId` (OAuth
  root), `personalStoreId`, `privateProjectStoreId`, `workspaceId`. `folderIdentity`
  (git origin / root commit / repo-relative path) is **only a discovery hint** —
  never a persistent or cross-account identity. **Git is not assumed**: the
  default linking path is explicit binding + workspace join(invite), and a
  workspace deliberately spans *heterogeneous* folders/stores (marketer +
  designer + dev) with no shared git. → Contract corollary: join is by
  Hub-issued `workspaceId` + invite URL; never key collaboration off content
  hashes. Invite URL is a **locator/invite, not a durable secret**.
- **Multiple accounts per machine (SoT-020).** Account-scoped stores are isolated
  per account. Auth on every workspace route is per-account; a key/token resolves
  to exactly one `accountId`.
- **v1 is at-rest, NOT E2E (SoT-070).** Server-side encryption at rest + access
  control. The server **is** the trust boundary and **reads** shared data —
  because shared-memory consolidation/recall runs server-side once for everyone.
  OAuth authenticates an account; it is **not** a decryption key. → Contract
  corollary: workspace shared memory travels as plaintext-to-server (at-rest
  encrypted), so the published shape's fields are server-visible by design.
- **Locality: shared channel is local-replicate by default (SoT-060).** Small,
  share-intended data replicates locally for zero read-latency + offline. The
  startup hot-path is **never** blocked on a network fetch; shared is additive,
  best-effort, degrades gracefully offline. Server does **ACL + coarse recall
  only**; the **client** does final ranking and the shared↔private blend. → Server
  query (cloud-MCP) model is the exception (huge corpus / per-query cancelable
  ACL), not the default. Plant a store-provider seam (local/remote) now.
- **E2E is deferred, demand-gated (SoT-070 / SoT-900).** Intended shape: envelope
  encryption (per-store DEK wrapped per enrolled device public key; server holds
  only wrapped DEKs + public keys). **Blocker to decide before building E2E =
  recovery policy** (single-device loss = permanent loss), pick one of offline
  recovery key / server-mediated / multi-device mutual recovery *first*. Not a v1
  concern, but don't design the workspace contract in a way that forecloses it.

## 4. Which JOIN_AND_MERGE open questions are now answered

| JOIN_AND_MERGE Q | Status after SoT |
| --- | --- |
| Q3 encrypt shared per workspace? | **Decided: no E2E in v1** (SoT-070, at-rest only). |
| Q5 verify repo identity across folders? | **Decided: don't** — `folderIdentity` is a hint, join is by invite; git not assumed (SoT-020). |
| Q6 Hub stores workspace metadata vs brokers opaque logs? | **Constrained**: server holds identity/ACL/coarse-recall; opaque relay stays dumb (SoT-020/060). The workspace control-plane lives in the **gateway**, not the relay. |
| Q8 shared retrieval opt-in per session vs always-on? | Still open, but SoT-060 forces: whatever the toggle, retrieval is client-side final-ranked and must not block startup. |
| Q1/Q2/Q4/Q7 (publishable kinds, manual/auto, conflict display, task model) | **Still genuinely open** — decide in the contract session. |

## 5. Soft coupling — the exact local field names the shape must carry

The shared-memory event references memorize's **local** entities. Those field
names are fixed by memorize Phase 0/1 code; the contract must carry them, not
rename them. The two design sketches disagree with each other AND with the code —
reconcile to the code + SoT-020 identity terms.

memorize local entities (source of the field names):

- `ConsolidatedMemory` (Phase 1, `src/domain/entities/memory.ts`): id `mem_…`,
  `projectId`, `kind` ∈ {`decision`,`rationale`,`progress`}, **`text`** (not
  "content"), **`salience`** 1–10 (not "confidence"), `sessionId?`,
  `sourceObservationIds[]`.
- `DomainEvent` provenance (Phase 0, `src/domain/events.ts`): **`writer`** (origin
  actor), **`sourceProjectId`** (origin store id). Optional, preserved across
  sync. This is the provenance backbone the shared shape should reuse.

Term reconciliation (canonical = code + SoT-020):

| Sketch field(s) | Canonical | Source |
| --- | --- | --- |
| `content` | **`text`** | memory.ts |
| `confidence` | **`salience`** (1–10) | memory.ts |
| `sourceUserId` | **`sourceAccountId`** | SoT-020 (`accountId`) |
| `repoIdentity` | **`folderIdentity`** | SoT-020 |
| `sourceLocalProjectId` | keep, = event `sourceProjectId` | events.ts provenance |
| `sourceEventId` | keep, = origin `DomainEvent.id` | events.ts |
| `sourceMemoryId` | keep, = `mem_…` id | memory.ts |

Fields the sketches add that have **no local backing yet** (contract-introduced,
flag them as such): `sourceDeviceId`, `visibility`, `tags`, `publishedAt`. Decide
whether these are gateway-assigned at publish time or need new local model.

## 6. The one decision that shapes everything — SoT-900 Open Decision #1

**Should private-project sync and workspace sync share the same transport
protocol, or should workspace use a typed gateway API from the start?**

- **Option A — reuse the opaque event relay** for workspace too (workspace is
  "just another `:id` event log"). Cheapest; matches the personal-store precedent
  exactly. But the relay stays dumb, so all workspace semantics (ACL beyond
  owner, membership, coarse recall, publish policy) must live in the gateway
  layered over opaque logs.
- **Option B — typed gateway API** for workspace from the start (first-class
  `workspace` / membership / publish / query endpoints). More work up front, but
  the gateway already owns identity+ACL and SoT-060 says the server does ACL +
  coarse recall — a typed surface fits that, and workspace is heterogeneous
  (multi-member, roles, per-member key wrapping later) in a way personal store is
  not.

SoT lean (not yet decided — this is the call to make): SoT-020/060 push toward
**B for the control-plane** (identity, membership, ACL, coarse recall are
server-typed responsibilities) while the **event/CRDT convergence** of shared
memory can still ride the Option-A opaque log underneath. I.e. likely a **hybrid**:
typed control-plane endpoints + opaque append-only shared-memory event log. Make
this explicit in the contract.

## 7. Boundary and where output lands

- The workspace session defines the **client↔Hub wire contract only** — it does
  not touch memorize internals or the Phase 1 local pipeline.
- **Wire additions → `../PROTOCOL.md`** (the authoritative contract; both sides
  implement it). Extend it, following its existing shape.
- **Rationale / any decision that supersedes an SoT stance → a supersede line in
  `memorize/docs/SoT/`** (append-and-supersede discipline; never rewrite in
  place). Contract body lives here, the "why" lives in SoT.
- Resolve SoT-900 Open Decision #1 first (§6); it gates the endpoint shape.

## Pointers

- `../PROTOCOL.md` — authoritative v1 wire contract (done surface).
- `./JOIN_AND_MERGE.md` — original workspace design note (pre-SoT).
- `memorize/docs/SoT/README.md` — index; 020 identity, 060 locality, 070
  security, 900 open decisions are the ones cited here.
- `memorize/docs/plans/2026-07-01-sync-workspace-source-of-truth.md` — M0–M8
  milestones + the 7 plan-level open decisions.
