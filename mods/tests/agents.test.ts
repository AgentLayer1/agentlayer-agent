import { describe, expect, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import type { AgentInfo, On } from 'claude-code';

const plain = (text = ''): string => text.replace(/\x1b\[[0-9;]*m/g, '');

const agent = (overrides: Partial<AgentInfo> = {}): AgentInfo => ({
  id: 'agent-1',
  description: 'map the repo',
  type: 'Explore',
  status: 'running',
  kind: 'local_agent',
  taskStatus: 'running',
  label: 'Running',
  startTime: 0,
  cwd: '/fixture/home',
  contextWindowSize: 200_000,
  tokenCount: 50_000,
  tokenSamples: [],
  hasRow: true,
  concurrent: 1,
  depth: 1,
  isBackgroundEnabled: true,
  ...overrides
});

interface Drawn {
  body?: string;
  isHidden: boolean;
}

const drawnRows = (on: On): Drawn[] => {
  const rows: Drawn[] = [];
  on('ui.render', { component: 'AgentRow' }, (_$, e) => {
    rows.push({ body: e.props.body, isHidden: e.props.isHidden });
    return { type: 'Box' as const };
  });
  return rows;
};

const drawRow = (
  $: Engine,
  info: AgentInfo,
  extra: { columns?: number; body?: string; isHidden?: boolean } = {},
  surface: 'terminal' | 'desktop' = 'terminal'
) =>
  $.ui.render({
    surface,
    component: 'AgentRow',
    requestId: info.id,
    props: { ...info, rowIds: [info.id], isHidden: false, ...extra }
  });

describe('agent rows', () => {
  test('a row shows the name, what the agent is doing and its context as a bar', async ($, on) => {
    const rows = drawnRows(on);
    await drawRow($, agent({ name: 'scout' }));
    expect(plain(rows[0]?.body)).toBe('scout · map the repo · ██⣿⣿⣿⣿⣿⣿ 25%');
  });

  test('an unnamed agent goes by its type, and one with no window size by its token count', async ($, on) => {
    const rows = drawnRows(on);
    await drawRow($, agent({ contextWindowSize: undefined, tokenCount: 12_345 }));
    expect(plain(rows[0]?.body)).toBe('Explore · map the repo · 12.3k tok');
  });

  test('only the description is cut to the row width', async ($, on) => {
    const rows = drawnRows(on);
    await drawRow($, agent({ description: 'a description that runs well past the row', tokenCount: 2_000 }), {
      columns: 40
    });
    expect(plain(rows[0]?.body)).toBe('Explore · a description t… · █⣿⣿⣿⣿⣿⣿⣿ 1%');
    expect(plain(rows[0]?.body).length).toBeLessThanOrEqual(40);
  });

  test("a body the person's settings set stands, and hiding is left alone", async ($, on) => {
    const rows = drawnRows(on);
    await drawRow($, agent(), { body: 'their own row', isHidden: true });
    expect(rows).toEqual([{ body: 'their own row', isHidden: true }]);
  });

  test('the desktop keeps its own row', async ($, on) => {
    const rows = drawnRows(on);
    await drawRow($, agent({ name: 'scout' }), {}, 'desktop');
    expect(rows).toEqual([{ body: undefined, isHidden: false }]);
  });
});
