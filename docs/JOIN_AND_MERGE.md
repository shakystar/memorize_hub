# Join and Merge Shared Workspace

Status: design issue note, not an implementation plan.

> **Superseded / concretized (2026-07-01).** The open questions here are resolved
> in `docs/SoT/` (H020 transport, H040 data model, H050 identifiers, H060
> read/write surface) and the wire contract in `PROTOCOL.md` (§Shared workspace).
> Kept for design context; read those for current decisions. Key resolutions: the
> shared store is a **server-minted `wsp_…`** (whole-DB union, provenance-tagged);
> **membership = publish** with owner/member roles; join by **revocable invite**;
> local `proj_` ids stay untouched as provenance.

## Problem

The current Hub sync model is a true-replica model:

1. One local memorize project already has a `projectId`.
2. That `projectId` becomes the remote id.
3. Other machines run `memorize project clone <projectId>`.
4. Every replica adopts the same project id.

That works when a team starts from one origin project. It does not handle the
common late-collaboration case:

1. Alice and Bob both work in the same Git repository on different machines.
2. Each has an existing local `memorize.db`.
3. Each local project has its own local `projectId` and event history.
4. Later they decide to collaborate and share useful memory.

Overwriting either local project id with a new Hub project id is risky. Existing
events already contain the old local identity. Rewriting append-only event logs
would break the event-sourcing model, and rebinding a populated local project to
another populated remote history is a diverged-history merge, not a clone.

## Product Goal

Support a flow where users can say:

1. Create a shared Hub workspace for this repository.
2. Connect my existing local memorize project to that workspace.
3. Invite collaborators.
4. Let every collaborator publish useful project memory.
5. Let agents retrieve both local memory and shared workspace memory while
   preserving who said what.

The goal is not to make every local database identical. The goal is to make a
shared collaboration surface that can be referenced safely by all participants.

## Proposed Direction

Keep local memory local. Add a shared workspace as a separate CRDT event log.

The shared workspace should receive publishable memory assertions from local
projects, with provenance preserved. A participant pulling shared memory should
not blindly import it as local memory. Instead, the client should keep or cache a
shared workspace projection and include it during retrieval with clear source
labels.

Conceptually:

```text
local project A
  local events
  local memories
  local tasks

local project B
  local events
  local memories
  local tasks

shared workspace W
  shared memories with source metadata
  shared decisions with source metadata
  shared tasks with member ownership
```

The important distinction:

- `localProjectId`: the existing local memorize project id.
- `hubWorkspaceId`: the shared workspace id created by Hub.
- `sourceId`: the source user, local project, device, and original event.

## Why Not Full DB Merge

Full merge is much harder because local project logs may contain conflicting
project roots, task states, decisions, sync state, and generated ids. CRDT set
merge can make events converge, but it does not decide which assertions are
true, current, relevant, or safe for another agent to trust.

For this feature, CRDT should solve transport convergence, not semantic truth.
Truth and usefulness need projection and retrieval policy.

## Shared Memory Shape

A first shared-memory event could look like this at the domain level:

```text
shared.memory.added
  workspaceId
  sharedMemoryId
  content
  kind
  sourceUserId
  sourceLocalProjectId
  sourceEventId
  sourceDeviceId
  repoIdentity
  createdAt
  observedAt
  confidence
  visibility
  tags
```

Follow-up events should be append-only:

```text
shared.memory.superseded
shared.memory.retracted
shared.memory.confirmed
shared.memory.tagged
```

Do not delete or rewrite the original assertion. Projection can hide retracted
or superseded memories by default while keeping the audit trail.

## Contamination Controls

This design avoids local storage contamination, but it does not automatically
avoid context contamination. Bad shared memory can still influence an agent if
retrieval ranks it too highly.

Controls needed:

1. Preserve provenance in every shared assertion.
2. Render shared memories separately from local facts.
3. Score local memory above shared memory unless the query clearly asks for team
   context.
4. Penalize stale, contradicted, or retracted shared memory.
5. Cluster duplicates instead of deleting them.
6. Never auto-publish personal memory.
7. Let users choose what categories are publishable.

The agent context should make source visible:

```text
Local project memory:
- ...

Shared workspace memory:
- Alice observed ...
- Bob decided ...
```

## Task Sharing

Tasks should not be merged as if every local task is a team task. A safer model
is:

- local task: private work tracking for one local project.
- shared task: workspace-level collaborative unit.
- local task link: a local task can reference a shared task.

Example:

```text
shared task
  id: sht_123
  title: Fix gateway auth flow
  owner: Alice
  assignees: Alice, Bob

Alice local task
  linkedSharedTaskId: sht_123
  local notes and agent state

Bob local task
  linkedSharedTaskId: sht_123
  local notes and agent state
```

This keeps personal agent workflow separate from team-visible work.

## Sync Flow Sketch

Possible later user flow:

1. User logs in to Hub.
2. User creates a shared workspace for a repository.
3. Hub shows a sync URL, similar to a Git clone URL.
4. User connects an existing local memorize project to the workspace.
5. Client stores a Hub-issued sync credential in the host credential store.
6. Client publishes selected local memories to the shared workspace log.
7. Collaborators join the same workspace.
8. Each collaborator pulls shared workspace memory into a separate shared
   projection, not into their local project memory.

API keys may still exist internally, but users should not need to manually copy
them for the main flow.

## Current Gap

The current Hub has users, API tokens, project ACL, and personal stores, but no
first-class `workspace` table or workspace membership model. The relay only
stores opaque per-id event logs. That is good for transport, but product-level
workspace semantics need to live above the relay, likely in the gateway and the
memorize client.

The current memorize client also treats `project clone` as true-replica adoption.
It intentionally refuses to clone into a directory already bound to a different
project id. A join-and-merge feature would need a new command and model, not a
change to `clone`.

## Open Questions

1. What memory kinds are safe to publish by default?
2. Should publishing be manual at first, policy-based, or automatic?
3. Should shared memories be encrypted per workspace?
4. How should conflicting shared memories be displayed?
5. How should repo identity be verified when users connect different folders?
6. Should the Hub store workspace metadata, or should it only broker opaque
   workspace logs?
7. What is the minimum task-sharing model that is useful without merging local
   task state?
8. Should shared workspace retrieval be opt-in per agent session or always part
   of project context?

## Initial Boundary

The safest first version is not full join-and-merge. It is:

1. Shared workspace creation.
2. Existing local project connects to the workspace.
3. Selected project memories and decisions can be published with source
   metadata.
4. Other members can retrieve those shared memories with source labels.
5. Local project ids, local event logs, and local task state remain unchanged.

This keeps the product value clear while avoiding the hardest database merge
problem.
