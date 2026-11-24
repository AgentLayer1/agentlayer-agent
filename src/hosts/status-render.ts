import { CAPABILITIES, type Support } from '@/hosts/contract';
import type { HostsOverview, HostView, Integration } from '@/hosts/status';
import { ANSI, paint, stripAnsi } from '@/shared/ansi';
import { homedir } from 'node:os';

const MARK: Record<Support['level'], string> = {
  yes: paint('✓', ANSI.green),
  partial: paint('◐', ANSI.yellow),
  no: paint('✗', ANSI.red)
};

const HEALTH: Record<Integration, { dot: string; label: string }> = {
  ready: { dot: paint('●', ANSI.green), label: paint('ready', ANSI.green) },
  'needs-you': { dot: paint('●', ANSI.yellow), label: paint('needs you', ANSI.yellow) },
  'not-set-up': { dot: paint('○', ANSI.dim), label: paint('not set up', ANSI.dim) },
  'not-installed': { dot: paint('○', ANSI.dim), label: paint('not installed', ANSI.dim) }
};

const LABEL_WIDTH = 16;
const CELL_WIDTH = 8;
const KEY_WIDTH = 8;

const visible = (text: string): number => stripAnsi(text).length;
const padEnd = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - visible(text)));
const center = (text: string, width: number): string => {
  const gap = Math.max(0, width - visible(text));
  return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(Math.ceil(gap / 2));
};

const wrap = (text: string, width: number): string[] =>
  text.split(' ').reduce<string[]>((lines, word) => {
    const last = lines.at(-1);
    return last !== undefined && last.length + 1 + word.length <= width
      ? [...lines.slice(0, -1), `${last} ${word}`]
      : [...lines, word];
  }, []);

/** A labelled block: the key on its first line, every line after hung under the first. */
const field = (key: string, lines: string[]): string[] =>
  lines.map((line, index) => `  ${padEnd(index === 0 ? paint(key, ANSI.dim) : '', KEY_WIDTH)}${line}`);

const matrix = (hosts: HostView[]): string[] => {
  const row = (label: string, cells: string[]): string =>
    padEnd(label, LABEL_WIDTH) + cells.map((cell) => center(cell, CELL_WIDTH)).join('');
  const capabilities = CAPABILITIES.map(({ id, label }) =>
    row(
      label,
      hosts.map(({ host }) => MARK[host.capabilities[id].level])
    )
  );
  return [
    row(
      '',
      hosts.map(({ host }) => paint(host.column, ANSI.bold))
    ),
    ...capabilities,
    row(
      paint('Health', ANSI.bold),
      hosts.map(({ state }) => HEALTH[state].dot)
    ),
    '',
    paint(`${MARK.yes} yes  ${MARK.partial} partly  ${MARK.no} no`, ANSI.dim),
    paint(
      `${HEALTH.ready.dot} ready  ${HEALTH['needs-you'].dot} needs you  ${HEALTH['not-set-up'].dot} not set up`,
      ANSI.dim
    )
  ];
};

const section = (view: HostView, home: string | undefined, width: number): string[] => {
  const { host, cli, wired, state, todos } = view;
  const { dot, label } = HEALTH[state];
  const title = `${dot} ${paint(host.title, ANSI.bold)} `;
  const rule = paint('─'.repeat(Math.max(2, width - visible(title) - visible(label) - 1)), ANSI.dim);
  const heading = `${title}${rule} ${label}`;
  if (state === 'not-installed') {
    return [heading];
  }
  const textWidth = width - KEY_WIDTH - 2;
  const version =
    cli.installed === null
      ? paint('not installed', ANSI.yellow)
      : `${cli.state === 'outdated' ? paint(cli.installed, ANSI.yellow) : cli.installed}${paint(` (needs ${cli.floor}+)`, ANSI.dim)}`;
  const homeLine =
    home === undefined ? paint('no agent home here', ANSI.dim) : wired ? 'wired' : paint('not wired', ANSI.dim);
  const gaps = CAPABILITIES.flatMap(({ id, label: name }) => {
    const support = host.capabilities[id];
    return support.level === 'yes'
      ? []
      : wrap(`${name}: ${support.note}`, textWidth - 2).map(
          (line, index) => `${index === 0 ? MARK[support.level] : ' '} ${paint(line, ANSI.dim)}`
        );
  });
  const todoLines = todos.flatMap(({ text, commands }) => [
    ...wrap(text, textWidth - 2).map((line, index) => `${index === 0 ? paint('→', ANSI.yellow) : ' '} ${line}`),
    ...commands.map((command) => `  ${paint(`$ ${command}`, ANSI.cyan)}`)
  ]);
  return [
    heading,
    ...field('CLI', [version]),
    ...field('Home', [homeLine]),
    ...(gaps.length > 0 ? field('Gaps', gaps) : []),
    ...(todoLines.length > 0 ? field('To do', todoLines) : [])
  ];
};

const tilde = (path: string): string => {
  const user = homedir();
  return path === user || path.startsWith(`${user}/`) ? `~${path.slice(user.length)}` : path;
};

export interface RenderOptions {
  version: string;
  /** The terminal's width; sections fit it, the matrix stays narrow. */
  width: number;
  color: boolean;
}

/** The hosts overview for a terminal: the capability matrix, then one section per host. */
export const renderHosts = (overview: HostsOverview, { version, width, color }: RenderOptions): string => {
  const sectionWidth = Math.min(Math.max(width, 48), 72);
  const where = overview.home === undefined ? 'no agent home here' : tilde(overview.home);
  const lines = [
    `${paint('agentlayer', ANSI.bold)} ${version} ${paint('·', ANSI.dim)} ${where}`,
    '',
    ...matrix(overview.hosts),
    ...overview.hosts.flatMap((view) => ['', ...section(view, overview.home, sectionWidth)]),
    ...(overview.warnings.length > 0
      ? [
          '',
          ...overview.warnings.flatMap((warning) =>
            wrap(`! ${warning}`, sectionWidth).map((line) => paint(line, ANSI.dim))
          )
        ]
      : [])
  ];
  const text = lines.map((line) => line.trimEnd()).join('\n');
  return color ? text : stripAnsi(text);
};
