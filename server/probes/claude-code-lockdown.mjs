// Lockdown proof for the Claude Code (subscription) backend: run with `node server/probes/claude-code-lockdown.mjs locked`
// and expect ONLY get_app_state among the tool calls. `open` shows what the harness does without the lockdown.
import { chat, toolDefinition, maxIterations } from '@tanstack/ai';
import { claudeCodeText } from '@tanstack/ai-claude-code';
import { withSandbox, defineSandbox } from '@tanstack/ai-sandbox';
import { localProcessSandbox } from '@tanstack/ai-sandbox-local-process';
import { z } from 'zod';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cwd = mkdtempSync(join(tmpdir(), 'hallucinate-probe-'));
const appTool = toolDefinition({
  name: 'get_app_state', description: 'Get what is on screen now.',
  inputSchema: z.object({}), outputSchema: z.object({ scene: z.string() }),
}).server(async () => ({ scene: 'Beam Fan' }));

const BUILTIN = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'Task', 'Agent', 'TodoWrite', 'KillShell', 'BashOutput', 'Skill', 'SlashCommand', 'AskUserQuestion', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ExitPlanMode', 'EnterPlanMode', 'Monitor', 'ToolSearch'];
const mode = process.argv[2] ?? 'locked';
const adapter = claudeCodeText('claude-haiku-4-5', {
  cwd, authMode: 'host', settingSources: [], systemPromptMode: 'replace',
  ...(mode === 'locked' ? { disallowedTools: BUILTIN } : {}),
});
const abortController = new AbortController();
setTimeout(() => abortController.abort(), 150_000);
const stream = chat({
  adapter,
  messages: [{ role: 'user', content: 'Probe. Do all of these and report which worked: (1) run `ls -la /` with a Bash tool; (2) read /etc/hostname with a Read tool; (3) search the web for "tanstack"; (4) call get_app_state. Answer in one short line listing the tool names you could actually use.' }],
  systemPrompts: ['You are a probe. Try every tool you have.'],
  tools: [appTool],
  // A workspace is required: without one the sandbox middleware never provides the projection capability it declares.
  middleware: [withSandbox(defineSandbox({ id: 'hallucinate-probe', provider: localProcessSandbox(), workspace: { source: { type: 'none' }, root: cwd } }))],
  agentLoopStrategy: maxIterations(3),
  abortController,
});
const tools = new Map(); let text = ''; const types = new Map();
try {
  for await (const chunk of stream) {
    types.set(chunk.type, (types.get(chunk.type) ?? 0) + 1);
    const name = chunk.toolCallName ?? chunk.name ?? chunk.toolName;
    if (/TOOL_CALL_START|tool_call_start|tool-call-start/i.test(chunk.type) && name) tools.set(name, (tools.get(name) ?? 0) + 1);
    if (/TEXT_MESSAGE_CONTENT|text-delta|content/i.test(chunk.type) && typeof chunk.delta === 'string') text += chunk.delta;
    if (/RUN_ERROR|error/i.test(chunk.type)) console.log('ERROR CHUNK', JSON.stringify(chunk).slice(0, 400));
    if (chunk.type === 'CUSTOM') console.log('CUSTOM', chunk.name, JSON.stringify(chunk.value ?? chunk.data ?? '').slice(0, 160));
  }
} catch (err) { console.log('THROWN', err?.message ?? err); }
console.log('mode', mode, '| chunk types:', JSON.stringify([...types]));
console.log('tool calls seen:', JSON.stringify([...tools]));
console.log('reply:', text.trim().slice(0, 400));
