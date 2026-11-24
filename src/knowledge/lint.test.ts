import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FOLDERS } from '@/config';
import { run } from './lint';

const article = (name: string, frontmatter: string): void => {
  const dir = join(FOLDERS.KNOWLEDGE, 'concepts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\n${frontmatter}\n---\n\n# ${name}\n\nBody text for ${name}.\n`);
};

describe('lint invalid frontmatter', () => {
  test('flags nested values and passes flat ones', async () => {
    article('acme-nested', 'title: Acme nested\nowner: { name: Ada }\nrepos:\n  - { name: acme, head: abc123 }');
    article('acme-flat', 'title: Acme flat\nsources: [raw/sessions/2026-01-01.md]\ncreated: 2026-01-01\ncount: 3');
    const summary = await run();
    const report = readFileSync(summary.reportPath, 'utf-8');
    expect(report).toContain('concepts/acme-nested.md frontmatter `owner:` holds nested data');
    expect(report).toContain('concepts/acme-nested.md frontmatter `repos:` holds nested data');
    expect(report).not.toContain('concepts/acme-flat.md frontmatter');
  });
});

describe('lint broken links', () => {
  test('resolves links to archived tasks and still flags missing ones', async () => {
    const archive = join(FOLDERS.PROJECTS, 'acme', 'tasks', 'archive');
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(archive, 'ac-001-retired-task.md'), '---\nid: ac-001\nstatus: done\n---\n');
    mkdirSync(join(FOLDERS.KNOWLEDGE, 'concepts'), { recursive: true });
    writeFileSync(
      join(FOLDERS.KNOWLEDGE, 'concepts', 'acme-links.md'),
      '---\ntitle: Acme links\n---\n\nSee [[ac-001-retired-task|ac-001]], [[ac-001]] and [[ac-999-never-filed]].\n'
    );
    const report = readFileSync((await run()).reportPath, 'utf-8');
    expect(report).not.toContain('[[ac-001-retired-task]] in concepts/acme-links.md');
    expect(report).not.toContain('[[ac-001]] in concepts/acme-links.md');
    expect(report).toContain('[[ac-999-never-filed]] in concepts/acme-links.md points to non-existent article');
  });
});

describe('lint backlinks', () => {
  test('a CRLF article with a See Also section gets the backlink under it, once', async () => {
    const concepts = join(FOLDERS.KNOWLEDGE, 'concepts');
    mkdirSync(concepts, { recursive: true });
    writeFileSync(join(concepts, 'acme-source.md'), '---\ntitle: Acme source\n---\n\nSee [[concepts/acme-target]].\n');
    writeFileSync(
      join(concepts, 'acme-target.md'),
      '---\r\ntitle: Acme target\r\n---\r\n\r\nBody.\r\n\r\n## See Also\r\n\r\n- [[concepts/acme-other]]\r\n'
    );
    await run({ fixMode: true });
    const target = readFileSync(join(concepts, 'acme-target.md'), 'utf-8');
    expect(target).toContain('acme-source');
    expect(target.match(/## See Also/g)).toHaveLength(1);
  });
});

describe('lint knowledge index', () => {
  test('flags an entry over one line and a permanent article the index never names', async () => {
    article('acme-listed', 'title: Acme listed');
    article('acme-unlisted', 'title: Acme unlisted');
    writeFileSync(
      join(FOLDERS.KNOWLEDGE, 'index.md'),
      `# Knowledge Index\n\n## Concepts\n\n- [[concepts/acme-listed]] — ${'a long recap '.repeat(30)}\n- [[concepts/acme-flat]] — short\n`
    );
    const report = readFileSync((await run()).reportPath, 'utf-8');
    expect(report).toContain('index.md has 1 entry over 200 chars');
    expect(report).toContain('concepts/acme-unlisted.md is not listed in index.md');
    expect(report).not.toContain('concepts/acme-listed.md is not listed');
  });
});

describe('lint memory budget', () => {
  const memoryIndex = (sections: Record<string, string>): void => {
    mkdirSync(join(FOLDERS.KNOWLEDGE, 'memory'), { recursive: true });
    writeFileSync(
      join(FOLDERS.KNOWLEDGE, 'memory', 'index.md'),
      `# Memory\n\n${Object.entries(sections)
        .map(([heading, body]) => `## ${heading}\n\n${body}\n`)
        .join('\n')}`
    );
  };
  const bullets = (count: number, chars = 20): string =>
    Array.from({ length: count }, (_unused, i) => `- ${String(i).padEnd(chars - 2, 'x')}`).join('\n');

  test('every section is held to its budget, and one the prompt never defined gets a default', async () => {
    memoryIndex({
      'Recent Decisions (Last Week)': bullets(16),
      'Key Context': bullets(1, 1_200),
      Learnings: bullets(1, 3_000),
      'Open Questions': bullets(8),
      'Daily Memory': bullets(2, 160),
      'Scratch Notes': bullets(1, 2_100)
    });
    const report = readFileSync((await run()).reportPath, 'utf-8');
    expect(report).toContain('§ Recent Decisions has 16 bullets (budget 15)');
    expect(report).toContain('§ Key Context is 1.2KB (budget 1KB)');
    expect(report).toContain('§ Open Questions has 8 bullets (budget 7)');
    expect(report).toContain('§ Daily Memory has 2 bullet(s) over 150 chars');
    expect(report).toContain('§ Scratch Notes is 2.1KB (budget 2KB)');
    expect(report).not.toContain('§ Learnings');
  });
});
