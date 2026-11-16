import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

/**
 * A text file with LF line endings, whatever it was saved with: Git for Windows checks files out
 * with CRLF by default, and editors on Windows keep or add it.
 */
export const readText = (path: string): string => toLf(readFileSync(path, 'utf-8'));

export const readTextAsync = async (path: string): Promise<string> => toLf(await readFile(path, 'utf-8'));

export const readTextIfExists = (path: string): string => (existsSync(path) ? readText(path) : '');

/** Flatten inline markdown (wikilinks, links, bold, italics, code) to plain text. */
export const stripMarkdown = (text: string): string =>
  text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

/** First plain paragraph of a markdown file (frontmatter + headings skipped). */
export const firstParagraph = (file: string): string => {
  try {
    const body = readFileSync(file, 'utf-8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const paragraph = body.split('\n').find((line) => line.trim() && !/^[#>\-*!|<\[]/.test(line.trim()));
    return paragraph ? stripMarkdown(paragraph.trim()) : '';
  } catch {
    return '';
  }
};

export const MARKDOWN_RE = /\.md$/;

/**
 * The markdown files directly in `dir`, sorted by name; none when it can't be read.
 */
export const listMarkdown = (dir: string, exclude: (name: string) => boolean = () => false): string[] => {
  try {
    return readdirSync(dir)
      .filter((name) => MARKDOWN_RE.test(name) && !exclude(name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
};
