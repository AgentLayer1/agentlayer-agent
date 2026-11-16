import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { CMUX_APP } from './app';

// cmux's runtime is GPL-licensed, so it is loaded from the installed app rather than vendored.
export const RUNTIME = join(
  CMUX_APP,
  'Contents',
  'Resources',
  'CmuxSwiftRenderUI_CmuxSwiftRenderUI.bundle',
  'Contents',
  'Resources',
  'SidebarRuntime.js'
);
export const hasRuntime = existsSync(RUNTIME);

type Op =
  | { op: 'create'; id: string; type: string }
  | { op: 'update'; id: string; key: string; value: unknown }
  | { op: 'children'; id: string; children: string[] }
  | { op: 'append'; id: string; child: string }
  | { op: 'remove'; id: string }
  | { op: 'root'; id: string };

/**
 * A call the sidebar made to cmux, as the runtime hands it to the host.
 */
export interface HostAction {
  kind: string;
  method?: string;
  params?: Record<string, string>;
}

interface SceneNode {
  type: string;
  props: Record<string, unknown>;
  children: string[];
}

/**
 * Mounts a built sidebar script on cmux's own runtime, with `data` as the host data cmux would send.
 */
export const mount = (script: string, data: Record<string, unknown> = {}) => {
  const nodes = new Map<string, SceneNode>();
  const scene = { root: '' };
  const actions: HostAction[] = [];
  const apply = (op: Op) => {
    const node = nodes.get(op.id);
    switch (op.op) {
      case 'create':
        nodes.set(op.id, { type: op.type, props: {}, children: [] });
        break;
      case 'update':
        if (node) {
          node.props[op.key] = op.value;
        }
        break;
      case 'children':
        if (node) {
          node.children = op.children;
        }
        break;
      case 'append':
        node?.children.push(op.child);
        break;
      case 'remove':
        nodes.delete(op.id);
        break;
      case 'root':
        scene.root = op.id;
        break;
    }
  };
  const context = createContext({
    __host_applyOps: (json: string) => (JSON.parse(json) as Op[]).forEach(apply),
    __host_action: (json: string) => actions.push(JSON.parse(json) as HostAction),
    __host_log: () => {},
    __host_clipboardWrite: () => false
  });
  runInContext(readFileSync(RUNTIME, 'utf8'), context);
  const setData = (next: Record<string, unknown>) =>
    Object.entries(next).forEach(([key, value]) => context.__setData(key, JSON.stringify(value)));
  setData(data);
  runInContext(script, context);

  const walk = (id: string): string[] => [id, ...(nodes.get(id)?.children ?? []).flatMap(walk)];
  const visibleTexts = () =>
    walk(scene.root)
      .map((id) => nodes.get(id))
      .filter((node) => node?.type === 'text')
      .map((node) => String(node?.props.text ?? ''))
      .filter(Boolean);
  const tappableHolding = (text: string) =>
    walk(scene.root)
      .filter((id) => nodes.get(id)?.props.tappable)
      .findLast((id) => walk(id).some((inner) => nodes.get(inner)?.props.text === text));
  const tap = (text: string): HostAction | undefined => {
    const id = tappableHolding(text);
    if (!id) {
      throw new Error(`nothing tappable shows "${text}"`);
    }
    const before = actions.length;
    context.__dispatch(id, 'tap', '');
    return actions.length > before ? actions.at(-1) : undefined;
  };
  return { visibleTexts, tap, setData, actions };
};
