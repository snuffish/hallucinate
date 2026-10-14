// The assistant ends each reply with one line of suggested next requests, in a fixed form the
// system prompt asks for:   FOLLOW-UPS: ["Make the glow pulse with the bass", "…"]
// The panel strips that line from the reply and shows the suggestions as buttons.

import { z } from 'zod';

export const FOLLOW_UPS_MARKER = 'FOLLOW-UPS:';
const FollowUpsSchema = z.array(z.string().trim().min(1).max(120)).max(5);
const LINE = /^[ \t]*FOLLOW-UPS:[ \t]*(\[[\s\S]*?\])?[ \t]*$/m;

export interface SplitReply {
  text: string;            // the reply without the follow-ups line
  followUps: string[];     // parsed suggestions (empty while streaming or when malformed)
}

// Splits a reply into the text to render and the follow-up suggestions. While the line is still
// streaming in, the partial marker is hidden too, so nothing flickers.
export function splitFollowUps(reply: string): SplitReply {
  const at = reply.search(/^[ \t]*FOLLOW-UPS:/m);
  if (at < 0) return { text: reply, followUps: [] };
  const text = reply.slice(0, at).replace(/\s+$/, '');
  const m = LINE.exec(reply.slice(at));
  if (!m?.[1]) return { text, followUps: [] };
  try {
    const parsed = FollowUpsSchema.safeParse(JSON.parse(m[1]));
    return { text, followUps: parsed.success ? dedupe(parsed.data) : [] };
  } catch {
    return { text, followUps: [] };
  }
}

const dedupe = (list: string[]) => [...new Set(list.map((s) => s.trim()))].filter(Boolean);
