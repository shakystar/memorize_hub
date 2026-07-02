/**
 * Dev-only mock data for the memory canvas. The read-surface (headless
 * replica, H060) does not exist yet; this lets the canvas UI be designed and
 * reviewed against realistic domain-shaped data without it. Never active in a
 * production build (`import.meta.env.DEV` guard), and the UI badges mocked
 * content as such — live pages keep the honest "in development" empty states.
 */

import type { Me, Workspace } from './api';
import type { KnowledgeEntry, TimelineItem } from './domain';

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
  { id: 'evt_09', at: at(1, 14, 55), type: 'session.completed', agent: 'claude-code', ...kant },
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

/** The same team's consolidated knowledge: every kind, shared tags, one superseded, one retracted. */
export const MOCK_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'mem_01', at: at(1, 17, 2), kind: 'decision', salience: 9, tags: ['pricing'],
    text: 'Pricing page ships with three tiers; the enterprise tier is contact-only until quota enforcement lands.',
    ...myApp,
  },
  {
    id: 'mem_02', at: at(1, 17, 30), kind: 'decision', salience: 8, tags: ['schedule'],
    text: 'Launch date moves to the 15th — payment-provider review needs the buffer.',
    ...kant,
  },
  {
    id: 'mem_03', at: at(5, 11, 0), kind: 'decision', salience: 7, tags: ['brand'],
    text: 'Landing pages use illustrations, not photography, to match the brand guide.',
    superseded: { at: at(0, 9, 5), note: 'A/B test reversed this — photo variant won.' },
    ...mina,
  },
  {
    id: 'mem_04', at: at(0, 9, 5), kind: 'rationale', salience: 8, tags: ['brand', 'a-b-test'],
    text: 'Hero image A/B: photo variant beat illustration on every segment, so the brand guide drops the illustration rule for landing pages.',
    ...mina,
  },
  {
    id: 'mem_05', at: at(3, 16, 20), kind: 'rationale', salience: 6, tags: ['pricing'],
    text: 'Three tiers instead of four: user interviews showed the second mid tier read as filler and slowed the choice.',
    ...myApp,
  },
  {
    id: 'mem_06', at: at(0, 10, 12), kind: 'progress', salience: 6, tags: ['copy', 'checkout'],
    text: 'Checkout flow copy finalized; legal approved the refund wording.',
    ...myApp,
  },
  {
    id: 'mem_07', at: at(2, 18, 20), kind: 'progress', salience: 5, tags: ['analytics'],
    text: 'Signup funnel instrumented end to end; drop-off dashboards live.',
    ...myApp,
  },
  {
    id: 'mem_08', at: at(4, 14, 45), kind: 'progress', salience: 4, tags: ['checkout'],
    text: 'Old note that the beta waitlist gates signups — the gate was removed.',
    retracted: { at: at(1, 13, 10) },
    ...myWeb,
  },
  {
    id: 'mem_09', at: at(6, 10, 30), kind: 'decision', salience: 6, tags: ['copy'],
    text: 'Product name is written "Memorize Hub" — capitalized, two words — everywhere user-facing.',
    ...kant,
  },
];
