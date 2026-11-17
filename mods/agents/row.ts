import type { AgentInfo } from 'claude-code';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const BAR_WIDTH = 8;

type AgentRowFacts = Pick<AgentInfo, 'type' | 'name' | 'description' | 'tokenCount' | 'contextWindowSize'> & {
  columns?: number;
};

// The main status line's scale (src/statusline/render.ts), so a subagent's bar reads like the footer's.
const usageColor = (percent: number): string => (percent < 50 ? GREEN : percent < 80 ? YELLOW : RED);

const contextBar = (percent: number): string => {
  const filled = percent > 0 ? Math.max(1, Math.floor((percent * BAR_WIDTH) / 100)) : 0;
  return `${usageColor(percent)}${'█'.repeat(filled)}${DIM}${'⣿'.repeat(BAR_WIDTH - filled)}${RESET}`;
};

const formatTokens = (count: number): string => (count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`);

const usage = ({ tokenCount, contextWindowSize }: AgentRowFacts): string => {
  if (contextWindowSize === undefined || contextWindowSize <= 0) {
    return `${formatTokens(tokenCount)} tok`;
  }
  const percent = Math.min(100, Math.floor((tokenCount * 100) / contextWindowSize));
  return `${contextBar(percent)} ${percent}%`;
};

const visibleLength = (text: string): number => text.replace(/\x1b\[[0-9;]*m/g, '').length;

/**
 * Name, what the agent is doing, and how much of its context it has used. Only the description is
 * cut to fit `columns`, so the usage always shows.
 */
export const agentRowBody = (agent: AgentRowFacts): string => {
  const { columns } = agent;
  const name = agent.name ?? agent.type;
  const tail = ` · ${usage(agent)}`;
  const room = columns === undefined ? Infinity : columns - visibleLength(`${name} · ${tail}`);
  const description = agent.description.trim();
  const shown =
    description.length <= room ? description : room < 2 ? '' : `${description.slice(0, room - 1).trimEnd()}…`;
  return shown ? `${name} · ${shown}${tail}` : `${name}${tail}`;
};
