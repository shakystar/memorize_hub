/**
 * Example data for the memory canvas, serving two roles:
 *
 * 1. Dev mock (`MOCK_ENABLED`, `import.meta.env.DEV`): design/review the
 *    canvas before the read surface (headless replica, H060) exists.
 * 2. Anonymous demo: signed-out visitors get this as a badged "Example
 *    workspace" instead of a login wall — the product is the landing page.
 *    This is the one sanctioned way example data ships in a production
 *    build; it must always be visibly badged, and signed-in live pages keep
 *    the honest "in development" empty states.
 */

import type { Me, Workspace } from './api';
import type { TaskEntry, TimelineItem } from './domain';

export const MOCK_ENABLED = import.meta.env.DEV;

/** Timestamp `d` days ago at local `h:m`, so day grouping always looks fresh. */
function at(d: number, h: number, m = 0): string {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, m, 0, 0);
  return t.toISOString();
}

export const MOCK_ME: Me = {
  accountId: 'acc_mock',
  email: 'you@example.com',
  personalStoreId: 'psm_mock_0000000000',
};

export const MOCK_WORKSPACES: Workspace[] = [
  {
    workspaceId: 'wsp_mock_launch',
    eventsUrl: '/v1/projects/wsp_mock_launch/events',
    role: 'owner',
    name: 'product-launch',
    inviteReachable: true,
    memberCount: 3,
  },
  {
    workspaceId: 'wsp_mock_notes',
    eventsUrl: '/v1/projects/wsp_mock_notes/events',
    role: 'owner',
    name: 'my-notes',
    inviteReachable: false,
    memberCount: 1,
  },
];

const myApp = {
  member: 'you@example.com', writer: 'claude-code',
  sourceProjectId: 'proj_mock_app', sourceProjectLabel: 'launch-app',
};
const myWeb = {
  member: 'you@example.com', writer: 'web',
  sourceProjectId: 'wsp_mock_launch', sourceProjectLabel: 'web',
};
const kant = {
  member: 'kant@example.com', writer: 'claude-code',
  sourceProjectId: 'proj_mock_site', sourceProjectLabel: 'landing-site',
};
const mina = {
  member: 'mina@example.com', writer: 'claude-desktop',
  sourceProjectId: 'proj_mock_brand', sourceProjectLabel: 'brand-guide',
};

/** A three-member team's last few days, mixing every feed item shape. */
export const MOCK_TIMELINE: TimelineItem[] = [
  {
    id: 'evt_02', at: at(0, 10, 12), type: 'memory.consolidated', kind: 'progress',
    text: 'Checkout flow copy finalized; legal approved the refund wording.',
    salience: 6, tags: ['copy', 'checkout'], ...myApp,
  },
  {
    id: 'evt_03', at: at(0, 9, 40), type: 'task.updated',
    title: 'Prepare launch-day social assets', status: 'handoff_ready', ...mina,
  },
  {
    id: 'evt_04', at: at(0, 9, 5), type: 'memory.consolidated', kind: 'rationale',
    text: 'Hero image A/B: photo variant beat illustration on every segment, so the brand guide drops the illustration rule for landing pages.',
    salience: 8, tags: ['brand', 'a-b-test'], ...mina,
  },
  {
    id: 'evt_06', at: at(1, 17, 30), type: 'decision.accepted',
    title: 'Launch date moves to the 15th — payment-provider review needs the buffer.', ...kant,
  },
  {
    id: 'evt_07', at: at(1, 17, 2), type: 'memory.consolidated', kind: 'decision',
    text: 'Pricing page ships with three tiers; the enterprise tier is contact-only until quota enforcement lands.',
    salience: 9, tags: ['pricing'], ...myApp,
  },
  {
    id: 'evt_08', at: at(1, 15, 20), type: 'handoff.created',
    title: 'Landing hero implementation -> whoever picks up the site session', ...kant,
  },
  { id: 'evt_09', at: at(1, 14, 55), type: 'session.paused', agent: 'claude-code', ...kant },
  { id: 'evt_15', at: at(1, 16, 40), type: 'session.resumed', agent: 'claude-code', ...kant },
  {
    id: 'evt_10', at: at(1, 13, 10), type: 'memory.retracted',
    text: 'Old note that the beta waitlist gates signups — the gate was removed.', ...myWeb,
  },
  { id: 'evt_11', at: at(2, 19, 45), type: 'task.created', title: 'Draft launch announcement email', ...mina },
  {
    id: 'evt_12', at: at(2, 18, 20), type: 'memory.consolidated', kind: 'progress',
    text: 'Signup funnel instrumented end to end; drop-off dashboards live.',
    salience: 5, tags: ['analytics'], ...myApp,
  },
  { id: 'evt_14', at: at(2, 9, 30), type: 'session.started', agent: 'claude-code', ...kant },
];

/** The same team's task board: every visible status, handoffs with next actions. */
export const MOCK_TASKS: TaskEntry[] = [
  {
    id: 'task_01', at: at(0, 9, 40), createdAt: at(1, 9, 0), startedAt: at(1, 10, 0),
    status: 'handoff_ready', priority: 'high',
    title: 'Prepare launch-day social assets', ownerType: 'agent',
    goal: 'Every channel has ready-to-post assets before launch morning.',
    description: 'Static banners, the animated teaser, and per-channel copy variants for the launch announcement.',
    acceptanceCriteria: [
      'Banner set exported for all four channels',
      'Teaser rendered at 1080p and approved by mina',
      'Copy variants reviewed against the brand guide',
    ],
    openQuestions: ['Do we localize the teaser captions for the KR audience at launch?'],
    handoff: {
      summary: 'All static assets exported; the animated teaser is storyboarded but not rendered.',
      nextAction: 'Render the teaser from the storyboard and drop it in the shared folder.',
      doneItems: ['Banner set exported', 'Copy variants drafted'],
      remainingItems: ['Teaser render', 'Final brand-guide pass'],
    },
    ...mina,
  },
  {
    id: 'task_02', at: at(1, 15, 20), createdAt: at(2, 12, 0), startedAt: at(2, 13, 0),
    status: 'handoff_ready', priority: 'medium',
    title: 'Landing hero implementation', ownerType: 'agent',
    goal: 'The landing hero matches the A/B winner pixel-for-pixel.',
    handoff: {
      summary: 'Hero layout matches the winning A/B variant; copy is placeholder.',
      nextAction: 'Swap in the final headline once legal clears it, then close.',
      doneItems: ['Layout implemented', 'Photo variant assets wired'],
      remainingItems: ['Final headline'],
    },
    ...kant,
  },
  {
    id: 'task_03', at: at(0, 10, 5), createdAt: at(0, 8, 30), startedAt: at(0, 9, 0),
    status: 'in_progress', priority: 'high',
    title: 'Wire pricing page to billing', ownerType: 'agent',
    goal: 'Choosing a tier on the pricing page creates a real subscription.',
    acceptanceCriteria: ['Checkout succeeds for both paid tiers', 'Webhook updates the account plan'],
    openQuestions: ['Trial length: 7 or 14 days?'],
    dependsOn: ['task_08'],
    ...myApp,
  },
  {
    id: 'task_04', at: at(0, 11, 30), createdAt: at(1, 8, 0), startedAt: at(0, 11, 0),
    status: 'in_progress', priority: 'medium',
    title: 'Draft launch announcement email', ownerType: 'human', ...mina,
  },
  {
    // Real task titles run long (agents write whole sentences) — this one
    // exists to exercise the card line-clamp.
    id: 'task_05', at: at(1, 9, 0), createdAt: at(1, 9, 0), status: 'todo', priority: 'medium',
    title:
      'Set up a status page for launch week: uptime badges for gateway + relay, incident template, and a subscribe-to-updates link surfaced from the footer of every page',
    ownerType: 'unassigned', ...myWeb,
  },
  {
    id: 'task_06', at: at(1, 8, 0), createdAt: at(1, 8, 0), status: 'todo', priority: 'low',
    title: 'Collect testimonial quotes from beta users', ownerType: 'unassigned',
    dependsOn: ['task_09'],
    ...kant,
  },
  {
    id: 'task_07', at: at(1, 16, 45), createdAt: at(2, 9, 0), startedAt: at(2, 9, 30),
    status: 'blocked', priority: 'high',
    title: 'Enable live payments', ownerType: 'agent',
    description: 'Flip the payment provider from test mode to live once their review clears.',
    riskNotes: [
      'Blocked on the payment-provider account review — compliance answers submitted, ETA unknown.',
      'Launch date already moved once for this; escalate if no answer by the 10th.',
    ],
    ...myApp,
  },
  {
    id: 'task_08', at: at(1, 17, 0), createdAt: at(2, 9, 0), startedAt: at(2, 9, 30),
    status: 'done', priority: 'high',
    title: 'Finalize checkout flow copy', ownerType: 'agent', ...myApp,
  },
  {
    id: 'task_09', at: at(2, 18, 30), createdAt: at(3, 8, 0), startedAt: at(3, 8, 30),
    status: 'done', priority: 'medium',
    title: 'Instrument the signup funnel', ownerType: 'agent', ...myApp,
  },
  {
    id: 'task_10', at: at(3, 12, 0), createdAt: at(4, 10, 0), status: 'cancelled', priority: 'low',
    title: 'Beta waitlist gate for signups', ownerType: 'agent', ...myWeb,
  },
];
