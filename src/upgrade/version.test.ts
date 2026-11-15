import { describe, expect, test } from 'bun:test';
import { parseChangelogText, releasesBetween } from '@/upgrade/version';

const CHANGELOG = `# Changelog

## [1.2.0] - 2026-12-01

### Changed
- Reports move.

### Upgrade
- \`script: required\` — run the reports move.
- \`template/AGENTS.md: optional\` — new Workflow line.

## [1.1.0] - 2026-11-20

### Upgrade
None — code-only, no bun install or HOME changes.

## [1.0.0] - 2026-11-14

### Upgrade
- \`deps: required\` — run bun install.
`;

describe('parseChangelogText', () => {
  test('reads each release, newest first, with its upgrade actions', () => {
    const entries = parseChangelogText(CHANGELOG);
    expect(entries.map((entry) => entry.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
    expect(entries[0]?.date).toBe('2026-12-01');
    expect(entries[0]?.upgrade).toEqual([
      { kind: 'script', severity: 'required', note: 'run the reports move.' },
      { kind: 'template/AGENTS.md', severity: 'optional', note: 'new Workflow line.' }
    ]);
    expect(entries[1]?.upgrade).toEqual([]);
  });
});

describe('releasesBetween', () => {
  const entries = parseChangelogText(CHANGELOG);
  test('counts the releases after the baseline up to the installed version', () => {
    expect(releasesBetween(entries, '1.0.0', '1.2.0')).toBe(2);
    expect(releasesBetween(entries, '1.1.0', '1.2.0')).toBe(1);
    expect(releasesBetween(entries, '0.9.4', '1.1.0')).toBe(2);
  });

  test('is at least one, since a baseline below the installed version is always behind', () => {
    expect(releasesBetween([], '0.9.4', '1.0.0')).toBe(1);
  });
});
