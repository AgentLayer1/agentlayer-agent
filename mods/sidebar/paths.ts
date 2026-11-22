// Pure, so the contract test can hold it to the plugin's rule (src/cmux/recent.ts isRecentPath), which it copies.

const EXTENSIONS = ['.md', '.html', '.pdf', '.csv', '.txt', '.png', '.jpg'];
const ROOT_FILES = ['USER.md', 'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'roadmap.html'];
const GENERATED = ['projects/TASKS.md', 'reports/index.md', 'reports/pinned.md'];
const DAILY_MEMORY = /^\d{4}-\d{2}-\d{2}\.md$/;

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
};

/**
 * Whether a file at this home-relative path is one the sidebar's Recent lists, so writing it is worth a refresh.
 */
export const showsInRecent = (inHome: string): boolean => {
  const parts = inHome.split('/');
  const [top = '', second = '', third = ''] = parts;
  const name = parts.at(-1) ?? '';
  if (
    parts.some((part) => part.startsWith('.') || part === 'node_modules') ||
    !EXTENSIONS.includes(extensionOf(name)) ||
    GENERATED.includes(inHome)
  ) {
    return false;
  }
  if (parts.length === 1) {
    return ROOT_FILES.includes(inHome);
  }
  if (top === 'projects') {
    return true;
  }
  if (top === 'reports') {
    return parts.length > 2 && second !== 'captures';
  }
  if (top === 'knowledge') {
    return (
      parts.length === 3 &&
      (second === 'user' ||
        second === 'concepts' ||
        (second === 'memory' && (third === 'index.md' || DAILY_MEMORY.test(third))))
    );
  }
  return top === 'extensions' && second === 'skills' && parts.length === 3 && extensionOf(name) === '.md';
};
