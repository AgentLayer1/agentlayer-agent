import { expect, test } from 'bun:test';
import { homeEntry } from './entry';
import { mergeHomes, newerCode, orderHomes, parseSidebar, renderSidebar } from './file';
import { NOVA, NOVA_HOME, SCOUT, SCOUT_HOME } from './preview/fixture';

const NOVA_ENTRY = homeEntry(NOVA_HOME, NOVA);
const SCOUT_ENTRY = homeEntry(SCOUT_HOME, SCOUT);
const anyHome = () => true;
const BUNDLE = '/*\n * AgentLayer · cmux sidebar\n */\nsidebar(() => Text("x"));\n';

test('a rendered sidebar reads back as the same parts', () => {
  const parts = { version: '1.2.0', homes: { [NOVA_HOME]: NOVA_ENTRY }, bundle: BUNDLE };
  expect(parseSidebar(renderSidebar(parts))).toEqual(parts);
});

test('a file the writer didn’t produce reads as nothing', () => {
  const good = renderSidebar({ version: '1.2.0', homes: {}, bundle: BUNDLE });
  expect(parseSidebar('')).toBeNull();
  expect(parseSidebar(BUNDLE)).toBeNull();
  expect(parseSidebar(good.replace('const DATA = {', 'const DATA = {{'))).toBeNull();
  expect(parseSidebar(good.replace('{"homes":{}}', '{"homes":[]}'))).toBeNull();
});

test('each home puts in only its own entry, a new home joins last, and a rewrite keeps every home in its place', () => {
  const scoutFirst = mergeHomes(null, SCOUT_HOME, SCOUT_ENTRY, anyHome);
  const both = mergeHomes({ version: '1.0.0', homes: scoutFirst, bundle: BUNDLE }, NOVA_HOME, NOVA_ENTRY, anyHome);
  expect(Object.keys(both)).toEqual([SCOUT_HOME, NOVA_HOME]);
  const renamed = { ...SCOUT_ENTRY, name: 'Scout II' };
  const rewritten = mergeHomes({ version: '1.0.0', homes: both, bundle: BUNDLE }, SCOUT_HOME, renamed, anyHome);
  expect(Object.entries(rewritten)).toEqual([
    [SCOUT_HOME, renamed],
    [NOVA_HOME, NOVA_ENTRY]
  ]);
});

test('an order puts the named agents first, by name in any case or by folder, and the rest keep their order', () => {
  const ADA_HOME = '/tmp/agents/Ada';
  const ada = { ...NOVA_ENTRY, name: 'Ada' };
  const homes = { [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: SCOUT_ENTRY, [ADA_HOME]: ada };
  const order = (picks: string[]) => {
    const result = orderHomes(homes, picks);
    return result.ok ? Object.keys(result.homes) : result.unmatched;
  };
  expect(order(['ada', 'Nova', 'Scout'])).toEqual([ADA_HOME, NOVA_HOME, SCOUT_HOME]);
  expect(order([SCOUT_HOME])).toEqual([SCOUT_HOME, NOVA_HOME, ADA_HOME]);
  expect(order(['Scout', 'scout'])).toEqual([SCOUT_HOME, NOVA_HOME, ADA_HOME]);
  expect(order(['Scout', 'Bea'])).toEqual(['Bea']);
  expect(orderHomes({ ...homes, '/tmp/agents/Ada2': ada }, ['Ada'])).toEqual({ ok: false, unmatched: ['Ada'] });
});

test('a home whose folder is gone drops out, and a null entry takes the home out', () => {
  const current = {
    version: '1.0.0',
    homes: { [NOVA_HOME]: NOVA_ENTRY, [SCOUT_HOME]: SCOUT_ENTRY },
    bundle: BUNDLE
  };
  expect(mergeHomes(current, NOVA_HOME, NOVA_ENTRY, (path) => path === NOVA_HOME)).toEqual({
    [NOVA_HOME]: NOVA_ENTRY
  });
  expect(mergeHomes(current, NOVA_HOME, null, anyHome)).toEqual({ [SCOUT_HOME]: SCOUT_ENTRY });
});

test('the newer plugin’s code wins, so an older plugin never downgrades the sidebar', () => {
  const installed = { version: '1.3.0', homes: {}, bundle: 'newer' };
  expect(newerCode(installed, { version: '1.2.9', bundle: 'older' })).toEqual(installed);
  expect(newerCode(installed, { version: '1.4.0', bundle: 'newest' })).toEqual({ version: '1.4.0', bundle: 'newest' });
  expect(newerCode(null, { version: '1.0.0', bundle: 'first' })).toEqual({ version: '1.0.0', bundle: 'first' });
});

test('a title holding a Unicode line or paragraph separator still reads back', () => {
  const pasted = { ...NOVA_ENTRY, name: 'Nova\u2028II\u2029' };
  const parts = { version: '1.2.0', homes: { [NOVA_HOME]: pasted }, bundle: BUNDLE };
  expect(parseSidebar(renderSidebar(parts))).toEqual(parts);
});
