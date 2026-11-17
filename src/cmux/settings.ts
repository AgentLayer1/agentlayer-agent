import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mergeSettings } from '@/home/settings-scope';
import { isRecord } from '@/shared/json-block';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';
import { readText } from '@/shared/text';

const SETTINGS_FILES = ['ghostty', 'cmux'] as const;
type SettingsFile = (typeof SETTINGS_FILES)[number];

interface SettingDifference {
  key: string;
  yours: string;
  ours: string;
}

// The user pastes `paste` and runs `command` themselves; the checker never writes.
interface SettingsReport {
  status: 'create' | 'broken' | 'missing' | 'ok';
  missing: string[];
  different: SettingDifference[];
  summary: string;
  report: string[];
  command: string;
  paste: string;
}

interface Setting {
  key: string;
  value: string;
  line: string;
}

type Found = { kind: 'none'; why: string } | { kind: 'broken'; why: string } | { kind: 'compared' };

export const templatePath = (file: SettingsFile): string =>
  join(PLUGIN_SOURCE_ROOT, 'install', 'templates', file === 'ghostty' ? 'ghostty.config' : 'cmux.json');

// A path as a command shows it: ~/… when nothing needs quoting, else the full path in single quotes, as the guides do.
const showPath = (home: string, path: string): string =>
  /^[\w./@+-]+$/.test(path)
    ? path.startsWith(`${home}/`)
      ? `~${path.slice(home.length)}`
      : path
    : `'${path.replaceAll("'", "'\\''")}'`;

const differenceLines = (different: SettingDifference[]): string[] =>
  different.length
    ? [`Set differently, yours kept: ${different.map(({ key, yours, ours }) => `${key} (yours ${yours}, ours ${ours})`).join('; ')}.`]
    : [];

// The three outcomes every file shares: create it from the template, fix what can't be read, or add what's missing.
const reportFor = (
  found: Found,
  parts: {
    home: string;
    path: string;
    template: string;
    total: number;
    missing: string[];
    different: SettingDifference[];
    missingSteps: string[];
    afterMissing: string;
    command: string;
    paste: string;
  }
): SettingsReport => {
  const { home, path, template, total, missing, different } = parts;
  const shown = showPath(home, path);
  const base = {
    missing,
    different,
    summary: `${total - missing.length - different.length} of ${total} recommended settings already set · ${missing.length} missing · ${different.length} set differently`
  };
  if (found.kind === 'none') {
    return { ...base, status: 'create', report: [found.why], command: `mkdir -p ${showPath(home, dirname(path))} && pbpaste > ${shown}`, paste: template };
  }
  if (found.kind === 'broken') {
    return { status: 'broken', missing: [], different: [], summary: "the file can't be read", report: [found.why], command: '', paste: '' };
  }
  if (!missing.length) {
    return { ...base, status: 'ok', report: differenceLines(different), command: '', paste: '' };
  }
  return {
    ...base,
    status: 'missing',
    report: [`Missing from ${shown}: ${missing.join(', ')}.`, ...parts.missingSteps, ...differenceLines(different), parts.afterMissing],
    command: parts.command,
    paste: parts.paste
  };
};

// A keybind is one setting per key combination, so `keybind = cmd+t=new_tab` is keyed by `cmd+t`.
const ghosttySettings = (text: string): Setting[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const [name = '', ...rest] = line.split('=');
      const key = name.trim();
      const value = rest.join('=').trim();
      return key === 'keybind' ? { key: `keybind ${value.split('=')[0]?.trim() ?? value}`, value, line } : { key, value, line };
    });

const checkGhostty = (home: string): SettingsReport => {
  const templateText = readText(templatePath('ghostty'));
  const template = ghosttySettings(templateText);
  // Ghostty on a Mac reads both files, the Application Support one last, so its values win.
  const files = [join(home, '.config', 'ghostty', 'config'), join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')]
    .filter((path) => existsSync(path))
    .map((path) => ({ path, settings: ghosttySettings(readText(path)) }));
  const yours = new Map(files.flatMap(({ settings }) => settings.map((setting): [string, string] => [setting.key, setting.value])));
  const missing = template.filter(({ key }) => !yours.has(key));
  const path = files[0]?.path ?? join(home, '.config', 'ghostty', 'config');
  return reportFor(
    files.length ? { kind: 'compared' } : { kind: 'none', why: 'Ghostty has no settings file yet. The recommended one sets the font, the light and dark theme, splits and tabs, and a long scrollback.' },
    {
      home,
      path,
      template: templateText,
      total: template.length,
      missing: files.length ? missing.map(({ key }) => key) : template.map(({ key }) => key),
      different: template
        .filter(({ key, value }) => yours.has(key) && yours.get(key) !== value)
        .map(({ key, value }) => ({ key, yours: yours.get(key) ?? '', ours: value })),
      missingSteps: [],
      afterMissing: 'Then reload Ghostty with Cmd+Shift+comma.',
      command: `pbpaste >> ${showPath(home, path)}`,
      paste: `\n# From AgentLayer's recommended settings\n${missing.map(({ line }) => line).join('\n')}\n`
    }
  );
};

const parseJson = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const child = (parent: unknown, key: string): unknown => (isRecord(parent) ? parent[key] : undefined);

const entriesOf = (value: unknown): [string, unknown][] => (isRecord(value) ? Object.entries(value) : []);

const namesOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);

const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_, inner: unknown) =>
    isRecord(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner
  );

const shortValue = (value: unknown): string => {
  const command = child(value, 'command');
  return typeof command === 'string' ? command : stableJson(value);
};

const checkCmux = (home: string, applications: string): SettingsReport => {
  const path = join(home, '.config', 'cmux', 'cmux.json');
  const templateText = readText(templatePath('cmux'));
  const template = parseJson(templateText) ?? {};
  const text = existsSync(path) ? readText(path) : null;
  const yours = text === null ? {} : parseJson(text);
  const yourButtons = namesOf(child(child(child(yours, 'ui'), 'surfaceTabBar'), 'buttons'));
  const computerUse = child(child(template, 'computerUse'), 'enabled');

  const checks = [
    ...entriesOf(child(template, 'actions')).map(([name, ours]) => ({
      key: `${name} button`,
      ours,
      yours: child(child(yours, 'actions'), name),
      fragment: { actions: { [name]: ours } }
    })),
    // The tab bar merges as one list: yours, then ours.
    ...namesOf(child(child(child(template, 'ui'), 'surfaceTabBar'), 'buttons')).map((name) => ({
      key: `${name} in the tab bar`,
      ours: true,
      yours: yourButtons.includes(name) ? true : undefined,
      fragment: { ui: { surfaceTabBar: { buttons: [...yourButtons, name] } } }
    })),
    ...entriesOf(child(child(template, 'shortcuts'), 'bindings')).map(([name, ours]) => ({
      key: `${name} shortcut`,
      ours,
      // cmux writes null for a shortcut left at its default, so null counts as missing.
      yours: child(child(child(yours, 'shortcuts'), 'bindings'), name) ?? undefined,
      fragment: { shortcuts: { bindings: { [name]: ours } } }
    })),
    { key: 'computer use', ours: computerUse, yours: child(child(yours, 'computerUse'), 'enabled'), fragment: { computerUse: { enabled: computerUse } } }
  ];
  const missing = checks.filter((check) => check.yours === undefined);
  const shown = showPath(home, path);
  const editor = [applications, join(home, 'Applications')].some((folder) => existsSync(join(folder, 'CotEditor.app')));
  const found: Found =
    text === null
      ? { kind: 'none', why: 'cmux has no settings file yet. The recommended one adds a Claude Code button and a Manager button that opens the AgentLayer sidebar, plus a few shortcuts.' }
      : yours === null
        ? { kind: 'broken', why: `${shown} isn't valid JSON, so cmux ignores it. Fix it first, then check again.` }
        : { kind: 'compared' };
  return reportFor(found, {
    home,
    path,
    template: templateText,
    total: checks.length,
    missing: found.kind === 'compared' ? missing.map(({ key }) => key) : checks.map(({ key }) => key),
    different: checks
      .filter((check) => check.yours !== undefined && stableJson(check.yours) !== stableJson(check.ours))
      .map(({ key, yours: mine, ours }) => ({ key, yours: shortValue(mine), ours: shortValue(ours) })),
    missingSteps: [
      `Back the file up, open it in ${editor ? 'CotEditor' : 'a plain-text editor such as CotEditor (TextEdit can break JSON)'}, and merge in the fragment to paste: it holds only what is missing, and its tab bar line is your buttons plus ours.`
    ],
    afterMissing: 'Then reload from a cmux tab with: cmux reload-config',
    command: `cp ${shown} ${shown}.bak-$(date +%Y%m%d)${editor ? ` && open -a CotEditor ${shown}` : ''}`,
    paste: `${JSON.stringify(
      missing.reduce<Record<string, unknown>>((merged, check) => mergeSettings(merged, check.fragment), {}),
      null,
      2
    )}\n`
  });
};

/**
 * Read-only: compares a Mac's settings with `install/templates/`, and never writes either file.
 */
export const checkSettings = (file: SettingsFile, home = homedir(), applications = '/Applications'): SettingsReport =>
  file === 'ghostty' ? checkGhostty(home) : checkCmux(home, applications);

const isSettingsFile = (value: string | undefined): value is SettingsFile => SETTINGS_FILES.some((file) => file === value);

/**
 * `cmux settings --file=<ghostty|cmux> [--json]`. Without --json, exits 3 unless the file is complete.
 */
export const runSettingsCommand = (file: string | undefined, json: boolean): number => {
  if (!isSettingsFile(file)) {
    console.error(`Usage: cmux settings --file=<${SETTINGS_FILES.join('|')}> [--json]`);
    return 1;
  }
  const report = checkSettings(file);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log([report.summary, ...report.report, ...(report.command ? ['', report.command] : [])].join('\n'));
  if (report.paste) {
    console.log(`\nTo paste:\n${report.paste}`);
  }
  return report.status === 'ok' ? 0 : 3;
};
