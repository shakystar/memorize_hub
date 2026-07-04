import { describe, expect, it } from 'vitest';

import { parse, toPath, type Route } from '../../src/lib/use-app-location';

describe('parse', () => {
  it('bare /app → workspace, null id, timeline', () => {
    expect(parse('/app')).toEqual({ view: 'workspace', workspaceId: null, tab: 'timeline' });
  });

  it('/app/ trailing slash → same default', () => {
    expect(parse('/app/')).toEqual({ view: 'workspace', workspaceId: null, tab: 'timeline' });
  });

  it('/app/personal → personal', () => {
    expect(parse('/app/personal')).toEqual({ view: 'personal' });
  });

  it('/app/:id with no tab → timeline', () => {
    expect(parse('/app/wsp_abc')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'timeline',
    });
  });

  it('/app/:id/:tab → that tab', () => {
    expect(parse('/app/wsp_abc/tasks')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'tasks',
    });
  });

  it('unknown tab → normalized to timeline', () => {
    expect(parse('/app/wsp_abc/bogus')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'timeline',
    });
  });

  it('connect is a valid tab segment', () => {
    expect(parse('/app/wsp_abc/connect')).toEqual({
      view: 'workspace',
      workspaceId: 'wsp_abc',
      tab: 'connect',
    });
  });
});

describe('toPath', () => {
  it('personal', () => {
    expect(toPath({ view: 'personal' })).toBe('/app/personal');
  });

  it('null workspaceId → bare /app', () => {
    expect(toPath({ view: 'workspace', workspaceId: null, tab: 'timeline' })).toBe('/app');
  });

  it('id + tab always explicit (even timeline)', () => {
    expect(toPath({ view: 'workspace', workspaceId: 'wsp_abc', tab: 'timeline' })).toBe(
      '/app/wsp_abc/timeline',
    );
  });
});

describe('round-trip parse ∘ toPath', () => {
  it('is identity for concrete routes', () => {
    const routes: Route[] = [
      { view: 'personal' },
      { view: 'workspace', workspaceId: 'wsp_abc', tab: 'tasks' },
      { view: 'workspace', workspaceId: 'wsp_xyz', tab: 'connect' },
    ];
    for (const r of routes) expect(parse(toPath(r))).toEqual(r);
  });
});
