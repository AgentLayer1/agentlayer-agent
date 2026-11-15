/**
 * curl_run — execute one curl request with collection-scoped secrets, returning
 * transcript-safe output.
 *
 * The api-collections skill AUTHORS requests; this tool is the one sanctioned
 * way to actually fire one (verify a draft, debug an endpoint). It runs inside
 * the MCP server so arbitrary hosts work (outside the Bash seatbelt), and it is
 * deliberately NEVER pre-granted — every call goes through a permission prompt.
 *
 * Secrets flow: args carry `{{KEY}}` placeholders, never values. The tool loads
 * the collection `.env` (readEnvFile — refuses the data-dir secret store), interpolates
 * placeholders into the child's argv, then SCRUBS every loaded value back out of
 * the output before returning, so what lands in the conversation is shareable:
 * `authorization: Bearer {{ACME_API_KEY}}`. Scrubbing covers the injected
 * credentials only — a response body can still contain sensitive API data.
 */
import { FOLDERS } from '@/config';
import { envWithoutSecrets, readEnvFile } from '@/shared/env';
import { defineTool, type ToolDef } from '@/shared/tool-def';
import { untrusted } from '@/shared/untrusted';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const MAX_OUTPUT_CHARS = 12_000;

interface ValueRule {
  ok: (value: string) => boolean;
  needs: string;
}

const TEXT: ValueRule = { ok: () => true, needs: 'a value' };
const INLINE: ValueRule = { ok: (value) => !value.startsWith('@'), needs: 'an inline value (a leading @ reads a file)' };
const INLINE_NAMED: ValueRule = { ok: (value) => !/^[^=]*@/.test(value), needs: 'an inline value (name@file reads a file)' };
const NUMBER: ValueRule = { ok: (value) => /^\d+(\.\d+)?$/.test(value), needs: 'a number' };

/**
 * The flags curl_run accepts, each with what its value may be (`null`: it takes none). Anything else is
 * refused, so a curl option nobody listed can never write, read or send a local file.
 */
const FLAGS: Readonly<Record<string, ValueRule | null>> = {
  '-X': TEXT,
  '--request': TEXT,
  '-u': TEXT,
  '--user': TEXT,
  '-A': TEXT,
  '--user-agent': TEXT,
  '-e': TEXT,
  '--referer': TEXT,
  '-H': INLINE,
  '--header': INLINE,
  '-d': INLINE,
  '--data': INLINE,
  '--data-raw': TEXT,
  '--data-binary': INLINE,
  '--json': INLINE,
  '--data-urlencode': INLINE_NAMED,
  '--max-redirs': NUMBER,
  '--connect-timeout': NUMBER,
  '-G': null,
  '--get': null,
  '-i': null,
  '--include': null,
  '-I': null,
  '--head': null,
  '-L': null,
  '--location': null,
  '-f': null,
  '--fail': null,
  '-v': null,
  '--verbose': null,
  '--compressed': null,
  '-k': null,
  '--insecure': null,
  '--http1.1': null,
  '--http2': null,
  '-s': null,
  '--silent': null,
  '-S': null,
  '--show-error': null
};

/**
 * Pinned on every run: `file://` and curl's other local protocols never fetch, redirects included, and
 * `--globoff` keeps `{a,b}` and `[1-9]` in the URL literal, so one URL is one request.
 */
const PINNED = ['--globoff', '--proto', '=http,https', '--proto-redir', '=http,https'];

const urlProblem = (urls: readonly string[]): string | undefined => {
  if (urls.length !== 1) {
    return `curl_run takes exactly one URL; it got ${urls.length}.`;
  }
  const protocol = URL.parse(urls[0] ?? '')?.protocol;
  return protocol === 'http:' || protocol === 'https:' ? undefined : 'The URL must be an http:// or https:// address.';
};

/**
 * Why curl_run refuses these (already filled-in) arguments, or undefined to run them: every flag must be one
 * it accepts, with its value as the next argument, and exactly one http(s) URL. The reason never quotes a value.
 */
export const argsProblem = (argv: readonly string[], urls: readonly string[] = []): string | undefined => {
  const [arg, ...rest] = argv;
  if (arg === undefined) {
    return urlProblem(urls);
  }
  if (!arg.startsWith('-')) {
    return argsProblem(rest, [...urls, arg]);
  }
  if (!Object.hasOwn(FLAGS, arg)) {
    return `${arg.split('=')[0]} isn't a flag curl_run accepts. It takes ${Object.keys(FLAGS).join(' ')}, each value as its own argument.`;
  }
  const rule = FLAGS[arg];
  if (!rule) {
    return argsProblem(rest, urls);
  }
  const [value, ...after] = rest;
  if (value === undefined || !rule.ok(value)) {
    return `${arg} takes ${rule.needs}.`;
  }
  return argsProblem(after, urls);
};

const PLACEHOLDER = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/** Interpolate `{{KEY}}` placeholders from the env map. Throws listing missing
 *  key NAMES (never values) so the error is transcript-safe too. */
export function interpolateArgs(args: string[], env: Record<string, string>): string[] {
  const missing = new Set<string>();
  const out = args.map((arg) =>
    arg.replace(PLACEHOLDER, (match, key: string) => {
      if (env[key] === undefined || env[key] === '') {
        missing.add(key);
        return match;
      }
      return env[key];
    })
  );
  if (missing.size > 0) {
    throw new Error(
      `Unresolved placeholders: ${[...missing].join(', ')}. Fill these keys in the collection .env (or pass envFile).`
    );
  }
  return out;
}

/** Replace every injected secret VALUE with `{{KEY}}` so output is shareable.
 *  Longest values first so overlapping secrets can't leave partial leaks.
 *  Values under 4 chars are skipped — too short to be a real secret, and
 *  scrubbing them would mangle ordinary output (status codes, short numbers). */
export function scrub(text: string, env: Record<string, string>): string {
  const entries = Object.entries(env)
    .filter(([, value]) => value.length >= 4)
    .sort(([, a], [, b]) => b.length - a.length);
  return entries.reduce((acc, [key, value]) => acc.replaceAll(value, `{{${key}}}`), text);
}

const tail = (text: string, limit: number): string =>
  text.length <= limit ? text : `… (truncated)\n${text.slice(-limit)}`;

/** First existing collection `.env` under the reports dir — bruno adapter first, then curl. */
function defaultEnvFile(reportsDir: string): string | undefined {
  const candidates = [resolve(reportsDir, 'api', 'bruno', '.env'), resolve(reportsDir, 'api', 'curl', '.env')];
  return candidates.find((path) => existsSync(path));
}

/** The placeholder keys the args actually reference — what the run injected. */
function referencedKeys(args: string[]): string[] {
  return [...new Set(args.flatMap((arg) => [...arg.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '')))];
}

export const tools: ToolDef[] = [
  defineTool({
    name: 'curl_run',
    description:
      'Fire ONE curl request with collection-scoped secrets, returning transcript-safe output. Args are curl arguments (no leading "curl"); reference secrets as {{KEY}} placeholders — the tool interpolates them from the collection .env (default: reports/api/bruno/.env, then reports/api/curl/.env; override with envFile) and scrubs every value back out of the returned command/output, so credentials never appear in the conversation. Response bodies are NOT scrubbed beyond that — prod data stays sensitive. It accepts exactly one http(s) URL and only these flags, each value as its own argument: -X/--request, -H/--header, -d/--data, --data-raw, --data-binary, --json, --data-urlencode, -u/--user, -A/--user-agent, -e/--referer, -G/--get, -i/--include, -I/--head, -L/--location, -f/--fail, -v/--verbose, -k/--insecure, --http1.1, --http2, --compressed, --max-redirs, --connect-timeout (-s and -S are already on); a value may not start with @ (curl would read a file), and the URL is never expanded ({a,b} and [1-9] stay literal). This tool is never pre-granted: each call prompts the operator. Use it to verify drafts from the api-collections skill or debug an endpoint — not as a general download tool.',
    inputSchema: {
      args: z
        .array(z.string())
        .min(1)
        .describe(
          'curl arguments, e.g. ["-X","POST","https://api.example.com/things","-H","authorization: Bearer {{ACME_API_KEY}}","-d","{\\"name\\":\\"x\\"}"]'
        ),
      envFile: z
        .string()
        .optional()
        .describe(
          'Path to the dotenv holding {{KEY}} values. Defaults to the personal collection .env (bruno, then curl adapter root).'
        ),
      timeoutSeconds: z.number().int().min(1).max(300).default(30).describe('curl --max-time, default 30')
    },
    askOnly: true,
    handler: async ({ args, envFile, timeoutSeconds }) => {
      const envPath = envFile ?? defaultEnvFile(FOLDERS.REPORTS);
      const env = envPath ? readEnvFile(envPath) : {};
      // Checked after {{KEY}} values are filled in, so a value can't turn into a flag, a file or another URL.
      const argv = interpolateArgs(args, env);
      const problem = argsProblem(argv);
      if (problem) {
        throw new Error(scrub(problem, env));
      }

      // Without the store's keys, so `--variable %NAME` can't read one; the collection's keys come in as {{KEY}}.
      const proc = Bun.spawn(['curl', '-sS', '--max-time', String(timeoutSeconds), ...argv, ...PINNED], {
        cwd: FOLDERS.HOME,
        env: envWithoutSecrets(),
        stdout: 'pipe',
        stderr: 'pipe'
      });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const exitCode = await proc.exited;

      const result = {
        exitCode,
        command: `curl ${args.join(' ')}`, // as given — placeholders intact, values never echoed
        envKeys: referencedKeys(args), // names only — the keys this request injected
        envFile: envPath ?? null,
        output: scrub(tail(`${stdout}${stderr}`.trim(), MAX_OUTPUT_CHARS), env)
      };
      return untrusted('curl', JSON.stringify(result, null, 2));
    }
  })
];
