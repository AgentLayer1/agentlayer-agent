import type { On } from 'claude-code';

import { agentRowBody } from './row';

export const registerAgents = (on: On): void => {
  // Terminal only: the body's colours are ANSI, and the other surfaces draw a richer row of their own.
  // A body that arrives set comes from the person's own settings, which outrank the plugin's.
  on('ui.render', { component: 'AgentRow', surface: 'terminal' }, (_$, e, next) =>
    e.props.body === undefined
      ? next({ ...e, props: { ...e.props, body: agentRowBody(e.props) } })
      : next(e)
  );
};
