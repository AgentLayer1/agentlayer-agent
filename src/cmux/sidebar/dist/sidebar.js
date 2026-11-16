/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac: who needs you, and a tap to what each one keeps.
 *
 * Open      cmux right-sidebar set custom agentlayer
 * Check     cmux sidebar validate agentlayer
 *
 * Built from src/cmux/sidebar/ in the agentlayer plugin, where the comments explaining the code live.
 */

// src/cmux/sidebar/main.ts
sidebar(() => VStack({ spacing: 8 }, [Text("AgentLayer").font(13).weight("semibold")]).padding(12));
