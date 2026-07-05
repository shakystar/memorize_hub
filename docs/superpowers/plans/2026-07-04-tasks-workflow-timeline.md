# Tasks 워크플로우 타임라인 (Gantt + 선후행 화살표) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks 탭에 시간축 기반 Gantt 뷰를 추가한다 — 각 task는 세그먼트 막대(대기|작업), dependsOn은 막대 사이 화살표.

**Architecture:** 읽기 표면 수직 슬라이스. replica `readTasks`가 `dependsOn`/`createdAt`을 실어 보내고 이벤트 로그에서 `startedAt`(첫 in_progress)을 유도한다. gateway는 통과(무변경). web은 순수 헬퍼(세그먼트/위상정렬/시간스케일)로 계산하고 손수 짠 SVG로 렌더한다.

**Tech Stack:** TypeScript, Node(replica), React 19 + SVG(web), vitest.

## Global Constraints

- **relay 무변경, gateway 무변경, 도메인/이벤트 스키마 무변경** — 읽기 표면 안에서만.
- **읽기 전용** — 이 뷰는 status/dependsOn을 편집하지 않는다.
- 와이어 필드는 빈 값이면 **생략**(기존 규칙: `[]`/`''`는 안 보냄).
- terminal status = `done` | `cancelled`.
- 화살표 도착 앵커 = `startedAt ?? createdAt`.
- 차트 라이브러리 도입 금지 — 손수 짠 SVG.
- vitest 버전은 `^4.1.4`(replica와 동일).
- 설계 권위: `docs/superpowers/specs/2026-07-04-tasks-workflow-timeline-design.md`.

---

### Task 1: replica `readTasks` — dependsOn/createdAt 전달 + startedAt 유도

**Files:**
- Modify: `packages/replica/src/tasks.ts`
- Test: `packages/replica/tests/unit/tasks.test.ts`

**Interfaces:**
- Produces (와이어): `TaskBoardItem`에 `createdAt: string`, `startedAt?: string`, `dependsOn?: string[]` 추가.

- [ ] **Step 1: 새 유도 동작의 failing 테스트 작성**

`packages/replica/tests/unit/tasks.test.ts`의 기존 `describe('readTasks', ...)` 안에 아래 두 케이스를 추가한다. `remoteEvents`(기존 픽스처)는 건드리지 않고 자체 픽스처를 쓴다. 파일 상단 import에 이미 있는 `event` 헬퍼는 `remoteEvents` 내부 지역 함수이므로, 아래 테스트는 자체적으로 최소 이벤트 배열을 만든다(같은 `fakeHub` 재사용).

```ts
  it('derives createdAt, startedAt (first in_progress) and dependsOn', async () => {
    const storeId = serverStoreId(WSP);
    const t0 = '2026-07-03T00:00:00.000Z';
    const t1 = '2026-07-03T00:01:00.000Z';
    const t2 = '2026-07-03T00:02:00.000Z';
    const t3 = '2026-07-03T00:03:00.000Z';
    const ev = (
      id: string, type: DomainEvent['type'], at: string, payload: unknown,
      scope?: { scopeType: DomainEvent['scopeType']; scopeId: string },
    ): DomainEvent => ({
      id, schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: at, updatedAt: at, type,
      projectId: storeId, scopeType: scope?.scopeType ?? 'project',
      scopeId: scope?.scopeId ?? storeId, actor: 'user',
      writer: ACC, sourceProjectId: 'proj_alice_laptop',
      payload: payload as DomainEvent['payload'],
    });
    const events: DomainEvent[] = [
      ev('e0', 'project.created', t0, {
        id: storeId, schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: t0, updatedAt: t0,
        title: 'T', summary: 's', goals: [], status: 'active', rootPath: `hub://${WSP}`,
        importedContextCount: 0, activeWorkstreamIds: [], activeTaskIds: [],
        acceptedDecisionIds: [], ruleIds: [],
      }),
      // task_pre created first (predecessor)
      ev('e1', 'task.created', t1, {
        ...baseTask(storeId, 'task_pre', 'Predecessor', t1),
      }, { scopeType: 'task', scopeId: 'task_pre' }),
      // task_active created with a dependsOn edge, then in_progress at t2, done at t3
      ev('e2', 'task.created', t1, {
        ...baseTask(storeId, 'task_active', 'Active work', t1), dependsOn: ['task_pre'],
      }, { scopeType: 'task', scopeId: 'task_active' }),
      ev('e3', 'task.updated', t2, { id: 'task_active', status: 'in_progress', updatedAt: t2 },
        { scopeType: 'task', scopeId: 'task_active' }),
      ev('e4', 'task.updated', t3, { id: 'task_active', status: 'done', updatedAt: t3 },
        { scopeType: 'task', scopeId: 'task_active' }),
    ];

    const result = await readTasks({
      hubUrl: 'http://hub.fake', apiKey: 'mzk_fake', workspaceId: WSP,
      fetchImpl: fakeHub(events),
    });

    const active = result.items.find((i) => i.id === 'task_active');
    expect(active).toMatchObject({
      createdAt: t1,
      startedAt: t2,       // first in_progress transition
      at: t3,              // last transition (done)
      status: 'done',
      dependsOn: ['task_pre'],
    });

    const pre = result.items.find((i) => i.id === 'task_pre');
    expect(pre?.createdAt).toBe(t1);
    expect(pre).not.toHaveProperty('startedAt');   // never entered in_progress
    expect(pre).not.toHaveProperty('dependsOn');   // empty -> omitted
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm --filter @shakystar/memorize-hub-replica test -- tasks`
Expected: FAIL — `active`가 `createdAt`/`startedAt`/`dependsOn` 프로퍼티를 안 가짐.

- [ ] **Step 3: `TaskBoardItem` 인터페이스에 필드 추가**

`packages/replica/src/tasks.ts`의 `export interface TaskBoardItem` 안, `at` 아래에 추가:

```ts
  /** Last transition timestamp (the Task row's updatedAt). */
  at: string;
  /** Creation timestamp (the Task row's createdAt) — the wait-segment start. */
  createdAt: string;
  /** First `in_progress` transition, mined from the event log. Absent if the task never started. */
  startedAt?: string;
  /** Predecessor task ids (Task.dependsOn). Omitted when empty. */
  dependsOn?: string[];
```

- [ ] **Step 4: `toBoardItem`에 startedAt 파라미터 + 필드 방출**

`toBoardItem` 시그니처와 반환을 수정:

```ts
function toBoardItem(
  storeId: string,
  task: Task,
  lastEvent: DomainEvent | undefined,
  handoffs: Map<string, Handoff>,
  startedAt: string | undefined,
): TaskBoardItem {
  const writer = lastEvent?.writer;
  const sourceProjectId = lastEvent?.sourceProjectId;
  const handoff = task.latestHandoffId ? handoffs.get(task.latestHandoffId) : undefined;
  return {
    id: task.id,
    at: task.updatedAt,
    createdAt: task.createdAt,
    member: writer ?? sourceProjectId ?? storeId,
    ...(startedAt ? { startedAt } : {}),
    ...(task.dependsOn.length ? { dependsOn: task.dependsOn } : {}),
    ...(writer ? { writer } : {}),
    ...(sourceProjectId
      ? { sourceProjectId, sourceProjectLabel: sourceProjectId }
      : {}),
    title: task.title,
    status: task.status,
    priority: task.priority,
    ownerType: task.ownerType,
    ...(task.description ? { description: task.description } : {}),
    ...(task.goal ? { goal: task.goal } : {}),
    ...(nonEmpty(task.acceptanceCriteria) ? { acceptanceCriteria: task.acceptanceCriteria } : {}),
    ...(nonEmpty(task.openQuestions) ? { openQuestions: task.openQuestions } : {}),
    ...(nonEmpty(task.riskNotes) ? { riskNotes: task.riskNotes } : {}),
    ...(handoff
      ? {
          handoff: {
            summary: handoff.summary,
            nextAction: handoff.nextAction,
            ...(nonEmpty(handoff.doneItems) ? { doneItems: handoff.doneItems } : {}),
            ...(nonEmpty(handoff.remainingItems)
              ? { remainingItems: handoff.remainingItems }
              : {}),
          },
        }
      : {}),
  };
}
```

- [ ] **Step 5: `readTasks`에서 startedAt 유도 + 전달**

`readTasks`의 이벤트 스캔 루프를 수정한다. `lastTaskEvent`를 채우는 `for` 루프 위에 map을 추가하고 루프 안에서 채운다:

```ts
  const events = await readEvents(storeId);
  const lastTaskEvent = new Map<string, DomainEvent>();
  const firstInProgressAt = new Map<string, string>();
  const handoffs = new Map<string, Handoff>();
  for (const event of events) {
    const taskId = taskIdOfEvent(event);
    if (taskId) {
      lastTaskEvent.set(taskId, event);
      const status = (event.payload as { status?: unknown }).status;
      if (status === 'in_progress' && !firstInProgressAt.has(taskId)) {
        firstInProgressAt.set(taskId, event.createdAt);
      }
    }
    if (event.type === 'handoff.created') {
      const handoff = event.payload as Handoff;
      if (typeof handoff.id === 'string') handoffs.set(handoff.id, handoff);
    }
  }

  const items = listTasks(storeId, {}, 'union')
    .map((task) =>
      toBoardItem(storeId, task, lastTaskEvent.get(task.id), handoffs, firstInProgressAt.get(task.id)),
    )
    .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id < b.id ? -1 : 1));
```

- [ ] **Step 6: 기존 테스트의 exact-match 갱신**

`createdAt`이 이제 모든 item에 실리므로, 기존 `legacy`의 `toEqual`(정확 일치)가 깨진다. `it('projects union tasks ...')`의 `expect(legacy).toEqual({...})`에 `createdAt`을 추가:

```ts
    expect(legacy).toEqual({
      id: 'task_legacy',
      at: '2026-07-03T00:02:00.000Z',
      createdAt: '2026-07-03T00:02:00.000Z',
      member: storeId,
      title: 'Old provenance-less task',
      status: 'todo',
      priority: 'medium',
      ownerType: 'unassigned',
    });
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm --filter @shakystar/memorize-hub-replica test -- tasks`
Expected: PASS (신규 케이스 + 갱신된 기존 케이스 모두).

- [ ] **Step 8: Commit**

```bash
git add packages/replica/src/tasks.ts packages/replica/tests/unit/tasks.test.ts
git commit -m "feat(replica): thread dependsOn+createdAt and derive startedAt in readTasks"
```

---

### Task 2: 와이어 계약 문서 갱신

**Files:**
- Modify: `docs/protocol/workspace.md` (tasks 응답 스키마, 현재 205-209행 부근)

**Interfaces:**
- Consumes: Task 1의 `TaskBoardItem` 신규 필드.

- [ ] **Step 1: tasks 응답 항목 스키마에 신규 필드 추가**

`GET /v1/workspaces/:workspaceId/tasks`의 Response `200` 항목 목록에 `createdAt`, `startedAt?`, `dependsOn?`를 넣는다. `"at"` 다음에 `"createdAt", "startedAt"?, "dependsOn"?,`를 추가:

```
Response `200`: `{ "storeId": "...", "pulled": {...}, "items": [ { "id", "at",
"createdAt", "startedAt"?, "dependsOn"?, "member", "writer"?, "sourceProjectId"?,
"sourceProjectLabel"?, "title", "status", "priority", "ownerType", "description"?,
"goal"?, "acceptanceCriteria"?, "openQuestions"?, "riskNotes"?,
"handoff"?: { "summary", "nextAction", "doneItems"?, "remainingItems"? } } ] }`.
```

바로 위 산문 문단 끝에 한 줄 덧붙인다:

```
`createdAt`/`startedAt`(첫 in_progress 전이, 이벤트 로그에서 유도)/`dependsOn`은
Tasks 워크플로우 타임라인 뷰(H060)를 위한 것으로, gateway는 손대지 않고 통과시킨다.
```

- [ ] **Step 2: Commit**

```bash
git add docs/protocol/workspace.md
git commit -m "docs(protocol): tasks response carries createdAt/startedAt/dependsOn"
```

---

### Task 3: web vitest 하니스 부트스트랩 + 타임라인 순수 헬퍼 (TDD)

**Files:**
- Create: `packages/web/vitest.config.ts`
- Modify: `packages/web/package.json` (vitest devDep + test/check 스크립트)
- Modify: `packages/web/src/lib/domain.ts` (`TaskEntry`에 신규 필드)
- Create: `packages/web/src/lib/tasks-timeline.ts`
- Test: `packages/web/tests/tasks-timeline.test.ts`

**Interfaces:**
- Consumes: web `TaskEntry`(+ Task 3에서 추가하는 필드).
- Produces:
  - `interface TimelineSegments { waitStart: number; waitEnd: number; workStart?: number; workEnd?: number; milestone: boolean; arrowAnchor: number }`
  - `computeSegments(task: TaskEntry, now: number): TimelineSegments`
  - `timeDomain(tasks: TaskEntry[], now: number): [number, number]`
  - `topoOrder(tasks: TaskEntry[]): TaskEntry[]`
  - `linearScale(domain: [number, number], range: [number, number]): (t: number) => number`

- [ ] **Step 1: vitest 부트스트랩 (config + package.json)**

Create `packages/web/vitest.config.ts`:

```ts
import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

`packages/web/package.json` devDependencies에 `"vitest": "^4.1.4"` 추가. scripts에서 `test`와 `check`를 교체:

```json
    "test": "vitest run",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
```

그리고 워크스페이스에 vitest 설치:

Run: `pnpm --filter @shakystar/memorize-hub-web install` (또는 루트에서 `pnpm install`)

- [ ] **Step 2: `TaskEntry`에 신규 필드 추가**

`packages/web/src/lib/domain.ts`의 `interface TaskEntry`에서 `at` 아래에 추가:

```ts
  /** ISO-8601 timestamp of the last status transition. */
  at: string;
  /** ISO-8601 creation timestamp — the wait-segment start. */
  createdAt: string;
  /** ISO-8601 first `in_progress` transition; absent if the task never started. */
  startedAt?: string;
  /** Predecessor task ids. Omitted when empty. */
  dependsOn?: string[];
```

주석 상단의 "No due/start dates" 문장은 더 이상 참이 아니므로 갱신:

```
 * `createdAt`은 항상, `startedAt`은 in_progress를 거친 경우 실린다(타임라인 뷰용).
```

- [ ] **Step 3: 헬퍼 failing 테스트 작성**

Create `packages/web/tests/tasks-timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { TaskEntry } from '../src/lib/domain';
import { computeSegments, linearScale, timeDomain, topoOrder } from '../src/lib/tasks-timeline';

const ms = (iso: string) => Date.parse(iso);
const NOW = ms('2026-07-03T12:00:00.000Z');

function task(over: Partial<TaskEntry> & Pick<TaskEntry, 'id' | 'createdAt' | 'at' | 'status'>): TaskEntry {
  return {
    member: 'a@b.c', title: over.id, priority: 'medium', ownerType: 'agent',
    ...over,
  } as TaskEntry;
}

describe('computeSegments', () => {
  it('started + done: wait then work, no milestone', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      startedAt: '2026-07-03T02:00:00.000Z', at: '2026-07-03T05:00:00.000Z', status: 'done' });
    expect(computeSegments(t, NOW)).toEqual({
      waitStart: ms('2026-07-03T00:00:00.000Z'), waitEnd: ms('2026-07-03T02:00:00.000Z'),
      workStart: ms('2026-07-03T02:00:00.000Z'), workEnd: ms('2026-07-03T05:00:00.000Z'),
      milestone: false, arrowAnchor: ms('2026-07-03T02:00:00.000Z'),
    });
  });

  it('started + still running: work runs to now', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      startedAt: '2026-07-03T02:00:00.000Z', at: '2026-07-03T02:00:00.000Z', status: 'in_progress' });
    const s = computeSegments(t, NOW);
    expect(s.workStart).toBe(ms('2026-07-03T02:00:00.000Z'));
    expect(s.workEnd).toBe(NOW);
    expect(s.milestone).toBe(false);
  });

  it('never started + terminal: wait-only, milestone at end', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      at: '2026-07-03T03:00:00.000Z', status: 'done' });
    const s = computeSegments(t, NOW);
    expect(s.waitEnd).toBe(ms('2026-07-03T03:00:00.000Z'));
    expect(s.workStart).toBeUndefined();
    expect(s.milestone).toBe(true);
    expect(s.arrowAnchor).toBe(ms('2026-07-03T00:00:00.000Z')); // createdAt
  });

  it('never started + open (todo): wait runs to now, no milestone', () => {
    const t = task({ id: 't', createdAt: '2026-07-03T00:00:00.000Z',
      at: '2026-07-03T00:00:00.000Z', status: 'todo' });
    const s = computeSegments(t, NOW);
    expect(s.waitEnd).toBe(NOW);
    expect(s.milestone).toBe(false);
  });
});

describe('timeDomain', () => {
  it('spans min(createdAt) to max(end/now), min-width guarded', () => {
    const tasks = [
      task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T01:00:00.000Z', status: 'done' }),
      task({ id: 'b', createdAt: '2026-07-03T04:00:00.000Z', at: '2026-07-03T04:00:00.000Z', status: 'todo' }),
    ];
    const [lo, hi] = timeDomain(tasks, NOW);
    expect(lo).toBe(ms('2026-07-03T00:00:00.000Z'));
    expect(hi).toBe(NOW); // task b is open -> now is the max
  });

  it('all-same-instant gets a non-zero width', () => {
    const tasks = [task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z',
      at: '2026-07-03T00:00:00.000Z', status: 'done' })];
    const [lo, hi] = timeDomain(tasks, ms('2026-07-03T00:00:00.000Z'));
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('topoOrder', () => {
  it('places predecessors before successors, ties by createdAt', () => {
    const a = task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'done' });
    const b = task({ id: 'b', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'todo', dependsOn: ['a'] });
    expect(topoOrder([b, a]).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('is cycle-safe (no infinite loop, all nodes returned)', () => {
    const a = task({ id: 'a', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'todo', dependsOn: ['b'] });
    const b = task({ id: 'b', createdAt: '2026-07-03T00:00:00.000Z', at: '2026-07-03T00:00:00.000Z', status: 'todo', dependsOn: ['a'] });
    expect(topoOrder([a, b]).map((t) => t.id).sort()).toEqual(['a', 'b']);
  });
});

describe('linearScale', () => {
  it('maps domain endpoints to range endpoints', () => {
    const s = linearScale([0, 100], [0, 200]);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(100);
    expect(s(100)).toBe(200);
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm --filter @shakystar/memorize-hub-web test`
Expected: FAIL — `../src/lib/tasks-timeline` 모듈 없음.

- [ ] **Step 5: 헬퍼 구현**

Create `packages/web/src/lib/tasks-timeline.ts`:

```ts
import type { TaskEntry, TaskStatus } from './domain';

const TERMINAL: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'cancelled']);

export interface TimelineSegments {
  /** wait (todo) segment — always present. Epoch ms. */
  waitStart: number;
  waitEnd: number;
  /** work (in_progress) segment — present only when the task started. */
  workStart?: number;
  workEnd?: number;
  /** terminal with no work segment → render a ◇ marker at waitEnd. */
  milestone: boolean;
  /** where an incoming dependency arrow lands: startedAt ?? createdAt. Epoch ms. */
  arrowAnchor: number;
}

/** The task's right edge on the axis: last transition if terminal, else now. */
function endOf(task: TaskEntry, now: number): number {
  return TERMINAL.has(task.status) ? Date.parse(task.at) : now;
}

export function computeSegments(task: TaskEntry, now: number): TimelineSegments {
  const created = Date.parse(task.createdAt);
  const started = task.startedAt ? Date.parse(task.startedAt) : undefined;
  const end = endOf(task, now);
  const waitEnd = started ?? end;
  const milestone = started === undefined && TERMINAL.has(task.status);
  return {
    waitStart: created,
    waitEnd,
    ...(started !== undefined ? { workStart: started, workEnd: end } : {}),
    milestone,
    arrowAnchor: started ?? created,
  };
}

export function timeDomain(tasks: TaskEntry[], now: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of tasks) {
    lo = Math.min(lo, Date.parse(t.createdAt));
    hi = Math.max(hi, endOf(t, now));
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [now, now + 1];
  // Guard a zero-width domain so bars/scale never divide by zero.
  if (hi <= lo) hi = lo + 60_000;
  return [lo, hi];
}

/**
 * Predecessors before successors (arrows flow downward). Ties broken by
 * createdAt then id. DFS post-order; cycle-safe — a node already on the current
 * stack is skipped, and any node left unvisited by cycles is appended.
 */
export function topoOrder(tasks: TaskEntry[]): TaskEntry[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sorted = [...tasks].sort((a, b) =>
    a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : 1,
  );
  const out: TaskEntry[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (t: TaskEntry): void => {
    if (done.has(t.id) || onStack.has(t.id)) return;
    onStack.add(t.id);
    for (const depId of t.dependsOn ?? []) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    onStack.delete(t.id);
    done.add(t.id);
    out.push(t);
  };
  for (const t of sorted) visit(t);
  return out;
}

export function linearScale(
  domain: [number, number],
  range: [number, number],
): (t: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (t: number) => r0 + ((t - d0) / span) * (r1 - r0);
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm --filter @shakystar/memorize-hub-web test`
Expected: PASS (모든 헬퍼 케이스).

- [ ] **Step 7: Commit**

```bash
git add packages/web/vitest.config.ts packages/web/package.json packages/web/src/lib/domain.ts packages/web/src/lib/tasks-timeline.ts packages/web/tests/tasks-timeline.test.ts
git commit -m "feat(web): vitest harness + pure timeline helpers (segments/topo/scale)"
```

---

### Task 4: `TasksTimeline.tsx` — SVG Gantt 컴포넌트

**Files:**
- Create: `packages/web/src/components/canvas/TasksTimeline.tsx`

**Interfaces:**
- Consumes: `computeSegments`, `timeDomain`, `topoOrder`, `linearScale` (Task 3); `TaskEntry` (domain).
- Produces: `export function TasksTimeline({ tasks, onSelect }: { tasks: TaskEntry[]; onSelect: (id: string) => void }): JSX.Element` — TasksTab이 `meEmail`을 안 받으므로(prop은 `tasks/badge/emptyState`뿐) timeline도 안 쓴다. v1은 me/other 좌우 구분 없음.

- [ ] **Step 1: 컴포넌트 작성**

Create `packages/web/src/components/canvas/TasksTimeline.tsx`:

```tsx
import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { TaskEntry, TaskStatus } from '@/lib/domain';
import { computeSegments, linearScale, timeDomain, topoOrder } from '@/lib/tasks-timeline';

/**
 * The Tasks workflow timeline: a hand-rolled SVG Gantt. X = real time; one row
 * per task; a segmented bar (wait = todo, work = in_progress); dependsOn drawn
 * as arrows whose head lands at the successor's `startedAt ?? createdAt` (the
 * point where actual work is/was gated). Read-only, theme-aware (currentColor).
 */

const ROW_H = 34;
const BAR_H = 14;
const LABEL_W = 180;
const PAD_X = 16;
const PAD_TOP = 28; // room for the time axis
const CHART_W = 720; // logical width; SVG scales responsively via viewBox

const STATUS_CLASS: Record<TaskStatus, string> = {
  todo: 'text-muted-foreground',
  in_progress: 'text-primary',
  handoff_ready: 'text-primary',
  blocked: 'text-destructive',
  done: 'text-muted-foreground',
  cancelled: 'text-muted-foreground',
};

export function TasksTimeline({
  tasks,
  onSelect,
}: {
  tasks: TaskEntry[];
  onSelect: (id: string) => void;
}) {
  const now = Date.now();
  const ordered = useMemo(() => topoOrder(tasks), [tasks]);
  const [lo, hi] = useMemo(() => timeDomain(tasks, now), [tasks, now]);
  const x = useMemo(() => linearScale([lo, hi], [LABEL_W + PAD_X, CHART_W - PAD_X]), [lo, hi]);

  const rowY = (i: number) => PAD_TOP + i * ROW_H + ROW_H / 2;
  const barY = (i: number) => rowY(i) - BAR_H / 2;
  const height = PAD_TOP + ordered.length * ROW_H + 8;

  const index = new Map(ordered.map((t, i) => [t.id, i]));
  const ticks = axisTicks(lo, hi);

  return (
    <div className="mx-auto w-full max-w-4xl overflow-x-auto px-6 pb-4 pt-4">
      <svg
        viewBox={`0 0 ${CHART_W} ${height}`}
        width="100%"
        role="img"
        aria-label="Tasks workflow timeline"
        className="min-w-[640px] text-foreground"
      >
        <defs>
          <marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" className="text-border" />
          </marker>
        </defs>

        {/* time axis */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} y1={PAD_TOP - 6} x2={x(t)} y2={height} className="stroke-border" strokeWidth={1} />
            <text x={x(t)} y={PAD_TOP - 12} textAnchor="middle" className="fill-muted-foreground text-[10px]">
              {axisLabel(t, hi - lo)}
            </text>
          </g>
        ))}

        {/* dependency arrows: predecessor bar-end -> successor arrowAnchor */}
        {ordered.flatMap((t) =>
          (t.dependsOn ?? [])
            .filter((depId) => index.has(depId))
            .map((depId) => {
              const from = ordered[index.get(depId)!];
              const fromSeg = computeSegments(from, now);
              const toSeg = computeSegments(t, now);
              const x1 = x(fromSeg.workEnd ?? fromSeg.waitEnd);
              const y1 = rowY(index.get(depId)!);
              const x2 = x(toSeg.arrowAnchor);
              const y2 = rowY(index.get(t.id)!);
              return (
                <path
                  key={`${depId}->${t.id}`}
                  d={`M${x1},${y1} C${x1 + 24},${y1} ${x2 - 24},${y2} ${x2},${y2}`}
                  className="fill-none stroke-border"
                  strokeWidth={1.5}
                  markerEnd="url(#dep-arrow)"
                />
              );
            }),
        )}

        {/* rows: label + segmented bar */}
        {ordered.map((t, i) => {
          const seg = computeSegments(t, now);
          const waitX = x(seg.waitStart);
          const waitW = Math.max(2, x(seg.waitEnd) - waitX);
          return (
            <g key={t.id} className="cursor-pointer" onClick={() => onSelect(t.id)}>
              <rect x={0} y={barY(i) - (ROW_H - BAR_H) / 2} width={CHART_W} height={ROW_H} className="fill-transparent hover:fill-secondary/40" />
              <text x={PAD_X} y={rowY(i)} dominantBaseline="middle" className={cn('text-xs', STATUS_CLASS[t.status])}>
                {clip(t.title)}
              </text>
              {/* wait segment (dashed/light) */}
              <rect x={waitX} y={barY(i)} width={waitW} height={BAR_H} rx={3}
                className="fill-secondary" />
              {/* work segment (solid, status-colored) */}
              {seg.workStart !== undefined && seg.workEnd !== undefined && (
                <rect x={x(seg.workStart)} y={barY(i)} width={Math.max(2, x(seg.workEnd) - x(seg.workStart))} height={BAR_H} rx={3}
                  className={cn(t.status === 'blocked' ? 'fill-destructive/70' : t.status === 'done' ? 'fill-muted-foreground' : 'fill-primary')} />
              )}
              {/* milestone marker for terminal-without-work */}
              {seg.milestone && (
                <rect x={x(seg.waitEnd) - 5} y={rowY(i) - 5} width={10} height={10}
                  transform={`rotate(45 ${x(seg.waitEnd)} ${rowY(i)})`}
                  className={cn(t.status === 'cancelled' ? 'fill-muted-foreground' : 'fill-primary')} />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function clip(s: string): string {
  return s.length > 26 ? `${s.slice(0, 25)}…` : s;
}

/** 3-5 evenly spaced ticks across the domain. */
function axisTicks(lo: number, hi: number): number[] {
  const n = 4;
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

/** Hour granularity under ~2 days, else month/day. */
function axisLabel(t: number, span: number): string {
  const d = new Date(t);
  if (span <= 2 * 86_400_000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
```

> 참고: v1 timeline은 me/other 좌우 구분을 하지 않으므로 `meEmail` prop을 두지 않는다(TasksTab도 안 받음). status 색상만으로 구분.

- [ ] **Step 2: 타입·린트 확인**

Run: `pnpm --filter @shakystar/memorize-hub-web typecheck && pnpm --filter @shakystar/memorize-hub-web lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/canvas/TasksTimeline.tsx
git commit -m "feat(web): TasksTimeline SVG gantt (segmented bars + dependency arrows)"
```

---

### Task 5: TasksTab 통합 + MOCK_TASKS 확장

**Files:**
- Modify: `packages/web/src/components/canvas/TasksTab.tsx`
- Modify: `packages/web/src/lib/mock.ts`

**Interfaces:**
- Consumes: `TasksTimeline` (Task 4).

- [ ] **Step 1: TasksTab에 timeline 뷰 배선**

`packages/web/src/components/canvas/TasksTab.tsx`:

1) import 추가(파일 상단 import 블록):

```tsx
import { TasksTimeline } from '@/components/canvas/TasksTimeline';
```

2) 뷰 상태 타입 확장:

```tsx
  const [view, setView] = useState<'board' | 'list' | 'timeline'>('board');
```

3) 토글 버튼 배열에 timeline 추가 — 기존:

```tsx
            {(['board', 'list'] as const).map((v) => (
```

를

```tsx
            {(['board', 'list', 'timeline'] as const).map((v) => (
```

로, 그리고 라벨 삼항을 확장:

```tsx
                {v === 'board' ? 'Board' : v === 'list' ? 'List' : 'Timeline'}
```

4) 뷰 렌더 분기에 timeline을 추가한다. 기존 board/list 렌더 블록(예: `{view === 'board' && ...}` / `{view === 'list' && ...}`)과 같은 자리에, `visible`과 `setSelectedId`를 그대로 넘긴다:

```tsx
        {view === 'timeline' && (
          <TasksTimeline tasks={visible} onSelect={setSelectedId} />
        )}
```

- [ ] **Step 2: MOCK_TASKS에 dependsOn + 타이밍 부여**

`packages/web/src/lib/mock.ts`의 `MOCK_TASKS` 항목 일부에 `createdAt`/`startedAt`/`dependsOn`을 추가한다. 기존 `at(day, hour, min)` 헬퍼를 재사용해 최소 두 개의 의존 체인과 다양한 상태를 만든다. 예를 들어 `task_02`(done 계열)와 `task_03`(in_progress)에:

```tsx
  // 예시: task_08(done) -> task_03(in_progress) -> task_02
  // task_08: 생성 후 곧 착수, 완료
  { ...task_08_기존, createdAt: at(0, 8, 0), startedAt: at(0, 8, 30) },
  // task_03: task_08에 의존, 진행중
  { ...task_03_기존, createdAt: at(0, 8, 0), startedAt: at(0, 10, 5), dependsOn: ['task_08'] },
  // task_02: task_03에 의존, todo(미착수)
  { ...task_02_기존, createdAt: at(0, 8, 0), dependsOn: ['task_03'] },
```

실제 편집 시엔 각 리터럴 객체에 필드를 인라인으로 더한다(위는 형태 예시). 최소 요구:
- 최소 1개 done 체인 선행(작업 세그먼트 있음),
- 최소 1개 in_progress(작업 세그먼트 열림, dependsOn 있음),
- 최소 1개 todo(대기만, dependsOn 있음, 화살표가 대기막대 좌단에 붙음),
- 모든 편집 task에 `createdAt` 필수(없으면 `computeSegments`가 NaN).

- [ ] **Step 3: 타입·린트 확인**

Run: `pnpm --filter @shakystar/memorize-hub-web check`
Expected: PASS (typecheck + lint + test).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/canvas/TasksTab.tsx packages/web/src/lib/mock.ts
git commit -m "feat(web): wire Timeline view into TasksTab + gantt mock fixtures"
```

---

### Task 6: 전체 검증

**Files:** (없음 — 검증 전용)

- [ ] **Step 1: 루트 전체 체크**

Run: `pnpm -r check`
Expected: PASS — relay/replica/gateway/web 모두 typecheck + lint + test green. (web test가 이제 vitest run.)

- [ ] **Step 2: 기존 gateway tasks e2e 회귀 확인**

Run: `pnpm --filter @shakystar/memorize-hub-gateway e2e`
Expected: PASS — 신규 필드(createdAt/startedAt/dependsOn)가 통과해도 기존 e2e가 green.

- [ ] **Step 3: 라이브 UI 검증 한계 기록**

SVG gantt의 실제 렌더·화살표·스크롤은 인증된 라이브 스택(Fly 배포 또는 로컬 gateway+OAuth+task 있는 워크스페이스)이 필요하다. 로컬 검증 인프라가 없으면 자동 검증은 `pnpm -r check`까지이고, 실 브라우저 확인은 별도 게이트로 남긴다(페이지네이션 task와 동일 한계). 이 사실을 PR 설명에 명시한다.

- [ ] **Step 4: 최종 상태 확인 후 PR 준비**

Run: `git log --oneline main..HEAD`
Expected: Task 1~5의 커밋이 순서대로. 브랜치 `feat/tasks-workflow-timeline`가 PR 준비 완료.

---

## Self-Review (작성자 체크)

**Spec coverage:** spec §2(와이어)→Task1/2/3, §3(replica 유도)→Task1, §4(뷰+앵커규칙)→Task4, §4.1(TasksTab 통합)→Task5, §4 mock→Task5, §5(테스트)→Task1/Task3/Task6, §6(파일영향)→전 task, §7(조율)→Global Constraints/Task1. 누락 없음.

**Placeholder scan:** Task5 mock은 "형태 예시"라 명시하되 최소 요구(4항목)를 구체 지정 — 편집 대상이 기존 리터럴이라 정확한 라인 대신 요구조건으로 못박음. 그 외 TBD/TODO 없음.

**Type consistency:** `TimelineSegments`/`computeSegments`/`timeDomain`/`topoOrder`/`linearScale` 시그니처가 Task3 정의와 Task4 소비에서 일치. `TaskBoardItem`(replica)와 `TaskEntry`(web)의 신규 필드명(`createdAt`/`startedAt`/`dependsOn`)이 Task1/2/3에서 동일. `arrowAnchor = startedAt ?? createdAt`가 spec §4.3과 Task3 구현·Task4 화살표 소비에서 일관.

---

## 구현 vs 계획 (2026-07-05 갱신)

Task 1~3(replica 배선·protocol·순수 헬퍼+테스트)은 계획대로. **Task 4(`TasksTimeline.tsx`)와
Task 5의 mock**은 계획의 "좌측 라벨 열 + SVG 막대" 대신, mock 대상 라이브 리뷰를 거쳐
**Notion Timeline식**(카드 막대·제목 우측 흘림·무한 양방향 팬·Today·화살표 상위 레이어)으로
전달됨 — 상세·근거는 **spec §8**. 순수 헬퍼/와이어/replica 로직은 무변경이라 계획의 테스트
전략(Task 3/Task 6)은 그대로 유효. `linearScale`은 최종 렌더에서 인라인 `xOf`로 대체되어
미사용이나 export·테스트는 유지(후속 정리 후보).
