# Gateway web UX - diagnosis and redesign plan

> Status: DRAFT / plan (pre-implementation). Scope: the gateway's server-rendered
> browser surface (`packages/gateway/src/web.ts` + `views.ts`). Written before the
> design/UX pass so the redesign follows a plan, not ad-hoc edits. Styling stack is
> already decided: server-rendered HTML + Tailwind v4 + Primer tokens (see the
> web-UI project decision). This doc decides *information architecture and feature
> placement*, not the visual token system.

## 1. Why this doc

Functionally the control-plane is complete (slices S1-S4 live). But the UI grew by
stacking every feature onto one `/account` page, so the page is now a ~1500px
single-column dump (identity + personal memory + workspaces + keys + connect). Two
consequences follow:

- it reads as dense and unstructured (the "getting ugly" complaint), and
- several already-implemented capabilities have **no UI at all**, because a flat
  page has nowhere to put per-workspace management.

So before styling, we fix the *structure*: what pages exist, and which feature
lives where.

## 2. Current state (as deployed, S4)

### 2.1 Routes that render HTML

| Route | Purpose | State |
|---|---|---|
| `GET /` | landing | done |
| `GET /docs` | single quickstart page | minimal (one page, no sidebar/registry) |
| `GET /account` | **single stacked page**: identity + personal + workspaces + keys + connect | done but overloaded |
| `GET /account/login` `/logout` | OAuth entry / clear cookie | done |
| `POST /account/workspaces` | create workspace | done |
| `POST /account/workspaces/:id/invite` | mint invite (defaults only) | done |
| `POST /account/workspaces/:id/leave` | self-leave | done |
| `POST /account/keys` | mint key | done |
| `POST /account/keys/:id/revoke` | revoke key | done |
| `GET /oauth/callback` | shared OAuth return | done |
| `GET /join?token=` | invite landing | done |
| `/admin` | operator dashboard | placeholder only (503 / "coming soon") |

### 2.2 Features on `/account` today

1. Identity line (signed in as, sign out link)
2. Personal memory card (psm_ id)
3. Workspaces table (name / id / role / kind / members) + Create form + per-row
   Invite (mint -> one-time joinUrl) + Leave
4. API keys table (prefix / label / scope / last-used / revoke) + Generate form
   (per-workspace scope checkboxes + read-only)
5. Connect-a-machine command block

## 3. Implemented vs surfaced (the gap)

The control-plane API is richer than the UI exposes. This is the core finding.

| Capability | API | UI today | Notes |
|---|---|---|---|
| Personal store discovery | done | shown (Overview) | ok |
| Key issue / list / revoke / scope | done | shown | ok |
| Workspace create / list | done | shown | ok |
| Workspace **roster** (members) | done (`GET /v1/workspaces/:id`) | **none** | no place to show members |
| Invite **mint** | done | partial (defaults only) | no maxUses / expiry control |
| Invite **list** | done (`GET .../invites`) | **none** | owner cannot see active invites |
| Invite **revoke** | done (`DELETE .../invites/:id`) | **none** | fire-and-forget only |
| Member **role change** / ownership transfer | done (`PATCH .../members/:id`) | **none** | |
| Member **remove (other)** | done (`DELETE .../members/:id`) | **none** | only self-leave is in UI |
| Workspace **delete** | done (`DELETE /v1/workspaces/:id`) | **none** | only Leave (409 for last owner) |
| Workspace **rename** | **no API** | none | genuinely missing |
| Operator dashboard | none | placeholder | S5, optional |

Reading: everything under "UI today = none" is **built and tested at the API
layer** and just needs a surface. The one true gap is workspace rename (no API).

## 4. Root problems

1. **No workspace detail page.** A workspace is a rich object (members, roles,
   invites, settings), but the UI treats it as a table row with two buttons. There
   is nowhere to manage members or invites, so those endpoints are unreachable from
   a browser. This is the biggest structural miss.
2. **One overloaded page.** Four unrelated concerns share one scroll; no hierarchy.
3. **Invite is fire-and-forget.** Mint shows a URL once; no list/revoke, so owners
   lose track of live invites.
4. **Cross-concern bleed.** Key-scope checkboxes list raw workspace ids inside the
   key form - workspace identity belongs on the workspace surface.
5. **Chrome gaps.** Header is a plain handle + link (no avatar/menu); content is
   narrow (max-w-3xl) with large empty margins ill-suited to a settings layout.

## 5. Proposed information architecture

GitHub-settings pattern: a left sidebar inside `/account`, each item a real page.
Widen the settings shell (max-w-5xl). Header gets an avatar + dropdown menu.

```
/account                     Overview   -> identity, personal memory, connect quickstart
/account/workspaces          Workspaces -> list (table) + create; row -> detail
/account/workspaces/:id      Detail     -> the NEW page (see 5.1)
/account/keys                API keys   -> list + generate (scope by workspace)
```

Header dropdown (avatar): Overview / Workspaces / API keys / Sign out.

### 5.1 Workspace detail page (`/account/workspaces/:id`) - the missing surface

Sections on one focused page, gated by the caller's role:

- **Members** (any member sees; owner manages): roster with role. Owner gets
  per-member `Make owner` / `Make member` (ownership transfer) and `Remove`.
  Last-owner actions surface the 409 as an inline message.
- **Invites** (owner): list active invites (uses / expiry / created), `Revoke`
  each, and a `Create invite` form with optional maxUses + expiry.
- **Settings**: `Leave` (any member; last owner blocked with guidance), `Delete
  workspace` (owner; destructive confirm). `Rename` deferred until an API exists.

This page surfaces roster + member-management + invite-list/revoke + delete - all
already implemented - with zero new backend except rename.

## 6. Feature placement (target)

| Feature | Page | New work |
|---|---|---|
| Identity, sign out | header dropdown + Overview | move |
| Personal memory id | Overview | move |
| Connect a machine | Overview | move |
| Key list / generate / revoke | API keys | move |
| Workspace list / create | Workspaces | move |
| Workspace row -> detail link | Workspaces | new link |
| Roster + member management | Workspace detail | **new UI over existing API** |
| Invite list / mint (+opts) / revoke | Workspace detail | **new UI over existing API** |
| Leave / delete workspace | Workspace detail (Settings) | **new UI over existing API** |
| Rename workspace | Workspace detail (Settings) | needs new API (deferred) |

## 7. Phased plan

- **D1 - shell + split (no new features).** Header avatar dropdown; widen; settings
  sidebar; split `/account` into Overview / Workspaces / API keys, moving existing
  features unchanged. Fixes the density complaint with zero backend change.
  Deployable + screenshot-verifiable on its own.
- **D2 - workspace detail page.** Add `/account/workspaces/:id` with Members,
  Invites, Settings, plus the matching `/account/...` POST actions that call the
  already-tested control-plane DAL. Surfaces roster + member admin + invite
  management + delete.
- **D3 - deferred, explicit.** Invite maxUses/expiry inputs (if not folded into
  D2), workspace rename (new API `PATCH /v1/workspaces/:id`), `/admin` operator
  dashboard (S5), and a real `/docs` registry. Each is a separate opt-in.

Each phase ships as its own visual-first slice (build -> screenshot -> deploy),
same cadence as S1-S4.

## 8. Decisions (signed off 2026-07-01)

1. **Scope = D1 + D2.** D3 (rename, /admin, docs registry) is out of this pass, so
   the redesign lands with **no new wire endpoints** - it only surfaces already
   implemented + tested control-plane APIs.
2. **Detail page shape = stacked sections** (Members / Invites / Settings on one
   page). Sub-tabs only if it later grows.
3. **Rename API deferred to D3.** `PATCH /v1/workspaces/:id` is the sole missing
   backend and is intentionally left out of this pass (not a scope cut - a
   sequencing choice).
4. **Delete vs Leave**: both live on the detail Settings section; Delete is
   owner-only and destructive (needs a confirm step).
