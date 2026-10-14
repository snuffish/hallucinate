// The autopilot plan: an ordered queue of show scenes with how many beats each one plays. The AI
// director writes it (as one atomic replace), the tempo clock executes it. Kept as a leaf module so
// the server (tool schemas) and the browser (studio) share one definition.

import { z } from 'zod';

export const MIN_STEP_BEATS = 8;
export const MAX_STEP_BEATS = 512;
export const DEFAULT_STEP_MAX_SECONDS = 90;   // a step moves on by wall clock when the beats never come
export const LIST_MAX_SECONDS = 90;           // the same safety net for the plain list-order autopilot

export const PlanStepSchema = z.object({
  cue: z.string().describe('The show scene to play: its id, or its exact name.'),
  beats: z.number().int().min(MIN_STEP_BEATS).max(MAX_STEP_BEATS).describe('How many beats it plays before the next step (8-512; 32 = 8 bars of 4/4).'),
  mode: z.enum(['cut', 'fade']).optional().describe('Transition into this step. Omit to keep the show\'s setting.'),
  seconds: z.number().min(0.2).max(8).optional().describe('Fade length in seconds for this step (0.2-8). Omit to keep the show\'s setting.'),
  maxSeconds: z.number().min(15).max(600).default(DEFAULT_STEP_MAX_SECONDS).describe('Wall-clock ceiling: move on after this many seconds even if the beats never come (no tempo, a breakdown).'),
});
export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema).min(1).max(64),
  note: z.string().max(160).default('').describe('One line on why this plan, shown to the user.'),
  loop: z.boolean().default(true).describe('Start over when the last step ends (true), or fall back to list order (false).'),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type Plan = z.infer<typeof PlanSchema>;
