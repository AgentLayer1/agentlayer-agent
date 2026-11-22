import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLUGIN_SOURCE_ROOT } from '@/shared/naming';

// A core takes its adapters from src/adapters.ts through its tool and command files, never by import.
const ADAPTER = /from '@\/(adapters|cmux\/|reports\/notes|desktop\/)/;

test.each(['proposals', 'notes', 'heartbeat', 'messages', 'sessions'])(
  'the %s core never imports an adapter',
  (domain) => {
    const dir = resolve(PLUGIN_SOURCE_ROOT, 'src', domain);
    const core = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !['tool.ts', 'command.ts'].includes(name)
    );
    expect(core.length).toBeGreaterThan(0);
    expect(core.filter((name) => ADAPTER.test(readFileSync(resolve(dir, name), 'utf-8')))).toEqual([]);
  }
);
