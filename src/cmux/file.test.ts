import { expect, test } from 'bun:test';
import { mergeHomes, newerCode, parseSidebar, renderSidebar } from './file';
import { fixtureEntry, NOVA, SCOUT } from './preview/fixture';

const NOVA_ENTRY = fixtureEntry(NOVA);
const SCOUT_ENTRY = fixtureEntry(SCOUT, 'agent');
const anyHome = () => true;
const BUNDLE = '/*\n * AgentLayer · cmux sidebar\n */\nsidebar(() => Text("x"));\n';

test('a rendered sidebar reads back as the same parts', () => {
  const parts = { version: '1.2.0', homes: { [NOVA.runtime.home]: NOVA_ENTRY }, bundle: BUNDLE };
  expect(parseSidebar(renderSidebar(parts))).toEqual(parts);
});

test('a file the writer didn’t produce reads as nothing', () => {
  const good = renderSidebar({ version: '1.2.0', homes: {}, bundle: BUNDLE });
  expect(parseSidebar('')).toBeNull();
  expect(parseSidebar(BUNDLE)).toBeNull();
  expect(parseSidebar(good.replace('const DATA = {', 'const DATA = {{'))).toBeNull();
  expect(parseSidebar(good.replace('{"homes":{}}', '{"homes":[]}'))).toBeNull();
});

test('each home puts in only its own entry, and the order homes write in doesn’t change the file', () => {
  const novaFirst = mergeHomes(null, NOVA.runtime.home, NOVA_ENTRY, anyHome);
  const both = mergeHomes(
    { version: '1.0.0', homes: novaFirst, bundle: BUNDLE },
    SCOUT.runtime.home,
    SCOUT_ENTRY,
    anyHome
  );
  const scoutFirst = mergeHomes(null, SCOUT.runtime.home, SCOUT_ENTRY, anyHome);
  const bothAgain = mergeHomes(
    { version: '1.0.0', homes: scoutFirst, bundle: BUNDLE },
    NOVA.runtime.home,
    NOVA_ENTRY,
    anyHome
  );
  expect(both).toEqual({ [NOVA.runtime.home]: NOVA_ENTRY, [SCOUT.runtime.home]: SCOUT_ENTRY });
  expect(renderSidebar({ version: '1.0.0', homes: bothAgain, bundle: BUNDLE })).toBe(
    renderSidebar({ version: '1.0.0', homes: both, bundle: BUNDLE })
  );
});

test('a home whose folder is gone drops out, and a null entry takes the home out', () => {
  const current = {
    version: '1.0.0',
    homes: { [NOVA.runtime.home]: NOVA_ENTRY, [SCOUT.runtime.home]: SCOUT_ENTRY },
    bundle: BUNDLE
  };
  expect(mergeHomes(current, NOVA.runtime.home, NOVA_ENTRY, (path) => path === NOVA.runtime.home)).toEqual({
    [NOVA.runtime.home]: NOVA_ENTRY
  });
  expect(mergeHomes(current, NOVA.runtime.home, null, anyHome)).toEqual({ [SCOUT.runtime.home]: SCOUT_ENTRY });
});

test('the newer plugin’s code wins, so an older plugin never downgrades the sidebar', () => {
  const installed = { version: '1.3.0', homes: {}, bundle: 'newer' };
  expect(newerCode(installed, { version: '1.2.9', bundle: 'older' })).toEqual(installed);
  expect(newerCode(installed, { version: '1.4.0', bundle: 'newest' })).toEqual({ version: '1.4.0', bundle: 'newest' });
  expect(newerCode(null, { version: '1.0.0', bundle: 'first' })).toEqual({ version: '1.0.0', bundle: 'first' });
});
