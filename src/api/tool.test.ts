import { describe, expect, test } from 'bun:test';
import { argsProblem, interpolateArgs, scrub } from './tool';

describe('interpolateArgs', () => {
  test('substitutes placeholders from the env map', () => {
    const args = ['-H', 'authorization: Bearer {{API_KEY}}', 'https://api.example.com'];
    expect(interpolateArgs(args, { API_KEY: 'sk-123456' })).toEqual([
      '-H',
      'authorization: Bearer sk-123456',
      'https://api.example.com'
    ]);
  });

  test('throws listing missing key names, never values', () => {
    expect(() => interpolateArgs(['{{MISSING_A}}', '{{MISSING_B}}'], { OTHER: 'x' })).toThrow(
      /MISSING_A, MISSING_B/
    );
  });

  test('empty value counts as missing', () => {
    expect(() => interpolateArgs(['{{EMPTY}}'], { EMPTY: '' })).toThrow(/EMPTY/);
  });

  test('args without placeholders pass through untouched', () => {
    expect(interpolateArgs(['-X', 'POST'], {})).toEqual(['-X', 'POST']);
  });
});

describe('scrub', () => {
  test('replaces every secret value with its placeholder', () => {
    const env = { API_KEY: 'sk-live-abcdef' };
    expect(scrub('authorization: Bearer sk-live-abcdef body sk-live-abcdef', env)).toBe(
      'authorization: Bearer {{API_KEY}} body {{API_KEY}}'
    );
  });

  test('longest value scrubs first so substrings cannot partially leak', () => {
    const env = { TOKEN: 'abc123', TOKEN_FULL: 'abc123-xyz789' };
    expect(scrub('value=abc123-xyz789', env)).toBe('value={{TOKEN_FULL}}');
  });

  test('short values (<4 chars) are not scrubbed to avoid mangling output', () => {
    expect(scrub('status 200 ok', { PORT: '200' })).toBe('status 200 ok');
  });
});

describe('argsProblem', () => {
  const URL_ARG = 'https://api.example.com/things';

  test("accepts the requests the api-collections skill drafts", () => {
    expect(argsProblem(['-X', 'POST', URL_ARG, '-H', 'authorization: Bearer x', '-d', '{"name":"x"}'])).toBeUndefined();
    expect(argsProblem(['-i', '-L', '--compressed', '-u', 'user:pass', '--max-redirs', '3', URL_ARG])).toBeUndefined();
    expect(argsProblem(['--json', '{"email":"ada@example.com"}', URL_ARG])).toBeUndefined();
    expect(argsProblem(['--data-urlencode', 'email=ada@example.com', '-G', URL_ARG])).toBeUndefined();
    expect(argsProblem(['--data-raw', '@literal', URL_ARG])).toBeUndefined();
  });

  test('refuses every flag it does not list, including the ones that write, read or send files', () => {
    const unlisted = ['-o', '-O', '-D', '-c', '-K', '-T', '-J', '-F', '-b', '-w', '--next', '-:', '--variable', '--config', '--output', '--url', '--proto', '--stderr', '--trace'];
    for (const flag of unlisted) {
      expect(argsProblem([flag, 'x', URL_ARG])).toContain("isn't a flag curl_run accepts");
    }
  });

  test('refuses bundled short flags and attached values, so every value is its own argument', () => {
    for (const arg of ['-sSL', '-oout.bin', '-d@notes.txt', '--request=POST', '--data=@notes.txt']) {
      expect(argsProblem([arg, URL_ARG])).toContain("isn't a flag curl_run accepts");
    }
  });

  test('refuses a value that would read a local file', () => {
    expect(argsProblem(['-d', '@/etc/hosts', URL_ARG])).toContain('a leading @ reads a file');
    expect(argsProblem(['-H', '@headers.txt', URL_ARG])).toContain('a leading @ reads a file');
    expect(argsProblem(['--json', '@-', URL_ARG])).toContain('a leading @ reads a file');
    expect(argsProblem(['--data-urlencode', 'q@notes.txt', URL_ARG])).toContain('name@file reads a file');
    expect(argsProblem(['--max-redirs', 'many', URL_ARG])).toContain('a number');
    expect(argsProblem([URL_ARG, '-X'])).toContain('-X takes a value');
  });

  test('takes exactly one http(s) URL', () => {
    expect(argsProblem(['-X', 'GET'])).toContain('exactly one URL');
    expect(argsProblem([URL_ARG, 'https://api.example.com/other'])).toContain('exactly one URL');
    for (const url of ['file:///etc/hosts', 'ftp://example.com/x', 'api.example.com/things', 'gopher://example.com']) {
      expect(argsProblem([url])).toContain('http:// or https://');
    }
  });
});
