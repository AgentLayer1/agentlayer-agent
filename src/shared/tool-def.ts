import type { z } from 'zod';

/**
 * MCP tool definition. `inputSchema` is a Zod raw shape (object of zod types,
 * NOT a wrapped `z.object`). The SDK converts it to JSON Schema for clients
 * automatically. Handler args are inferred from the shape.
 */
export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  /** MCP `_meta` published with the tool; `anthropic/maxResultSizeChars` lifts Claude Code's per-result cap. */
  meta?: Record<string, unknown>;
  /**
   * Runs only behind an approval prompt: the server refuses the call while the home's
   * `permissions.ask` lacks the tool, since auto mode would otherwise approve it unseen.
   */
  askOnly?: true;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

/** Helper to declare a typed tool while preserving the shape's inference. */
export const defineTool = <Shape extends z.ZodRawShape>(def: ToolDef<Shape>): ToolDef => def as unknown as ToolDef;
