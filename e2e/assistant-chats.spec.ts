import { expect, test, type Page, type Route } from '@playwright/test';
import { chat, chatParamsFromRequestBody, convertMessagesToModelMessages, EventType, maxIterations, toServerSentEventsResponse, type AdapterYieldChunk, type DefaultMessageMetadataByModality, type ModelMessage, type TextOptions } from '@tanstack/ai';
import { BaseTextAdapter, type StructuredOutputOptions } from '@tanstack/ai/adapters';
import { TOOL_DEFINITIONS } from '../src/assistant/tools';

// The assistant panel against a scripted backend: TanStack's real chat() and SSE encoding run here in
// the test with a fake model, so the browser gets exactly what the dev server would send. No Claude.
//   "slow …"   answers after 6 s          "think …"  reasons first, then answers
//   "look …"   calls set_look, then answers on the continuation

const text = (m: ModelMessage | undefined) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m!.content.map((p) => ('content' in p && typeof p.content === 'string' ? p.content : '')).join('') : '');

class ScriptedModel extends BaseTextAdapter<string, Record<string, never>, readonly ['text'], DefaultMessageMetadataByModality> {
  readonly name = 'scripted';
  constructor() { super({}, 'scripted-model'); }
  structuredOutput(_o: StructuredOutputOptions<Record<string, never>>): Promise<never> { return Promise.reject(new Error('no')); }
  async *chatStream(o: TextOptions<Record<string, never>>): AsyncIterable<AdapterYieldChunk> {
    const model = this.model, now = Date.now(), runId = o.runId ?? 'r', threadId = o.threadId ?? 't';
    const last = o.messages.at(-1);
    const typed = text([...o.messages].reverse().find((m) => m.role === 'user')).split('\n').at(-1)!;
    yield { type: EventType.RUN_STARTED, runId, threadId, model, timestamp: now };
    if (typed.startsWith('slow')) await new Promise((r) => setTimeout(r, 6000));   // long enough to still run after the second chat's round trip
    if (typed.startsWith('look') && last?.role !== 'tool') {
      const input = { hue: 0.42 };
      yield { type: EventType.TOOL_CALL_START, toolCallId: 'call-look', toolCallName: 'set_look', toolName: 'set_look', model, timestamp: now };
      yield { type: EventType.TOOL_CALL_ARGS, toolCallId: 'call-look', model, timestamp: now, delta: JSON.stringify(input), args: JSON.stringify(input) };
      yield { type: EventType.TOOL_CALL_END, toolCallId: 'call-look', toolCallName: 'set_look', toolName: 'set_look', model, timestamp: now, input };
      yield { type: EventType.RUN_FINISHED, runId, threadId, model, timestamp: now, finishReason: 'tool_calls', usage: { promptTokens: 3000, completionTokens: 40, totalTokens: 3040, promptTokensDetails: { cachedTokens: 2500 } } };
      return;
    }
    if (typed.startsWith('think')) {
      yield { type: EventType.REASONING_START, messageId: 'th', model, timestamp: now };
      yield { type: EventType.REASONING_MESSAGE_START, messageId: 'th', role: 'reasoning', model, timestamp: now };
      yield { type: EventType.REASONING_MESSAGE_CONTENT, messageId: 'th', delta: 'The user wants **depth**. I will consider the spiral first.', model, timestamp: now };
      yield { type: EventType.REASONING_MESSAGE_END, messageId: 'th', model, timestamp: now };
      yield { type: EventType.REASONING_END, messageId: 'th', model, timestamp: now };
    }
    const reply = last?.role === 'tool' ? 'Shifted the hue.' : `Reply to: ${typed}`;
    yield { type: EventType.TEXT_MESSAGE_START, messageId: `m-${now}`, role: 'assistant', model, timestamp: now };
    yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: `m-${now}`, delta: `${reply}\n\nFOLLOW-UPS: ["Make it slower"]`, model, timestamp: now };
    yield { type: EventType.TEXT_MESSAGE_END, messageId: `m-${now}`, model, timestamp: now };
    yield { type: EventType.RUN_FINISHED, runId, threadId, model, timestamp: now, finishReason: 'stop', usage: { promptTokens: 1200, completionTokens: 30, totalTokens: 1230 } };
  }
}

interface Seen { body: { forwardedProps?: Record<string, unknown> }; typed: string }

async function fakeBackend(page: Page, seen: Seen[] = []) {
  await page.route('**/api/assistant/info', (route) => route.fulfill({ json: { backend: 'api', model: 'scripted-model' } }));
  await page.route('**/api/assistant/new', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/assistant', async (route: Route) => {
    const body = route.request().postDataJSON();
    const params = await chatParamsFromRequestBody(body);
    const messages = convertMessagesToModelMessages(params.messages);
    seen.push({ body, typed: text([...messages].reverse().find((m) => m.role === 'user')) });
    const stream = chat({ adapter: new ScriptedModel(), messages, threadId: params.threadId, runId: params.runId, tools: [...TOOL_DEFINITIONS], agentLoopStrategy: maxIterations(2) });
    const res = toServerSentEventsResponse(stream);
    await route.fulfill({ status: 200, headers: Object.fromEntries(res.headers), body: await res.text() });
  });
  return seen;
}

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await expect(page.locator('#now')).toContainText('Demo beat');
  await page.keyboard.press('i');
  await expect(page.locator('#ai')).toBeVisible();
  await expect(page.locator('#ai-status')).toContainText('scripted-model');
}

async function send(page: Page, message: string) {
  await page.locator('#ai-input').fill(message);
  await page.locator('#ai-input').press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('kept')) { localStorage.removeItem('hallucinate.assistantChats'); localStorage.removeItem('hallucinate.assistantThinking'); indexedDB.deleteDatabase('hallucinate'); } sessionStorage.setItem('kept', '1'); });
});

test('assistant: two conversations at once; the bubble counts unread replies and peeks; history survives a reload', async ({ page }) => {
  await fakeBackend(page);
  await open(page);
  await send(page, 'slow first question');
  await expect(page.locator('#ai-send')).toHaveText('Stop');
  await page.locator('#ai-new').click();
  await expect(page.locator('#ai-chats-toggle strong')).toHaveText('New chat');
  await send(page, 'second question');
  await expect(page.locator('#ai-log .ai-text')).toContainText('Reply to: second question');
  await expect(page.locator('#ai-log .ai-followups button')).toHaveText('Make it slower');
  await expect(page.locator('#ai-usage')).toContainText('1.2k in · 30 out');
  await expect(page.locator('.ai-switcher-count')).toHaveText('1');           // the first one is still working

  // Close the panel while the first is still working: the ring turns, then a badge and a peek.
  await page.keyboard.press('Escape');
  await expect(page.locator('#assistant-bubble')).toHaveClass(/busy/);
  await expect(page.locator('#assistant-bubble .ai-bubble-badge')).toHaveText('1', { timeout: 12_000 });
  await expect(page.locator('#ai-peek')).toContainText('Reply to: slow first question');
  await expect(page.locator('#ai-peek')).toContainText('slow first question');
  await page.locator('#ai-peek .ai-peek-open').click();
  await expect(page.locator('#ai')).toBeVisible();
  await expect(page.locator('#ai-chats-toggle strong')).toHaveText('slow first question');
  await expect(page.locator('#ai-log .ai-text')).toContainText('Reply to: slow first question');
  await expect(page.locator('#assistant-bubble .ai-bubble-badge')).toHaveCount(0);

  // Both come back after a reload; search finds one; delete removes it.
  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('i');
  await expect(page.locator('#ai-log .ai-text')).toContainText('Reply to: slow first question');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('#ai-chat-search')).toBeFocused();
  await expect(page.locator('.ai-chat-row')).toHaveCount(2);
  await page.locator('#ai-chat-search').fill('second');
  await expect(page.locator('.ai-chat-row')).toHaveCount(1);
  await page.locator('.ai-chat-row').hover();
  await page.locator('.ai-chat-row [aria-label="Delete"]').click();
  await page.locator('.ai-chat-row .danger').click();
  await page.locator('#ai-chat-search').fill('');
  await expect(page.locator('.ai-chat-row')).toHaveCount(1);
  await expect(page.locator('.ai-chat-row')).toContainText('slow first question');
});

test('assistant: a tool change, its turn usage, Undo told on the next message, typing while it works queues', async ({ page }) => {
  const seen = await fakeBackend(page);
  await open(page);
  await send(page, 'look warmer');
  await expect(page.locator('#ai-log .ai-tool.ok')).toContainText('Adjusted the look');
  await expect(page.locator('#ai-log .ai-text')).toContainText('Shifted the hue.');
  await expect(page.locator('#ai-log .ai-reply-usage')).toHaveText('4.2k in · 70 out · 60% cached');   // the tool call and the reply after it, one turn
  await page.locator('#ai-undo').click();
  await expect(page.locator('#ai-log .ai-note.pending')).toContainText('Undid: Adjusted the look');

  await send(page, 'slow and steady');
  await expect(page.locator('#ai-send')).toHaveText('Stop');
  await page.locator('#ai-input').fill('then this');
  await expect(page.locator('#ai-send')).toHaveText('Queue');
  await page.locator('#ai-input').press('Enter');
  await expect(page.locator('#ai-log .ai-msg.user.queued')).toHaveText(/then this/);
  await expect(page.locator('#ai-log .ai-text').last()).toContainText('Reply to: then this', { timeout: 10_000 });
  await expect(page.locator('#ai-log .ai-msg.user.queued')).toHaveCount(0);

  const undoTurn = seen.find((s) => s.typed.endsWith('slow and steady'))!;
  expect(undoTurn.typed).toMatch(/^\(The user pressed Undo and reverted your change: Adjusted the look\.\)\n\nslow and steady$/);
  expect(undoTurn.body.forwardedProps).toMatchObject({ continued: true });
  await expect(page.locator('#ai-log .ai-turn-user .ai-note')).toContainText('Undid: Adjusted the look');   // shown as a note, not as typed text
});

test('assistant: reasoning folds away, the 💭 toggle shows it and is remembered', async ({ page }) => {
  await fakeBackend(page);
  await open(page);
  await send(page, 'think about the spiral');
  await expect(page.locator('#ai-log .ai-text')).toContainText('Reply to: think about the spiral');
  const thinking = page.locator('#ai-log details.ai-thinking');
  await expect(thinking.locator('summary')).toContainText('Thought about it · 10 words');
  await expect(thinking.locator('.ai-thinking-body')).toBeHidden();
  await page.locator('#ai-thinking-toggle').click();
  await expect(thinking.locator('.ai-thinking-body strong')).toHaveText('depth');   // rendered as Markdown
  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('i');
  await expect(page.locator('#ai-thinking-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ai-log details.ai-thinking .ai-thinking-body')).toBeVisible();
});

test('assistant: a conversation saved mid-tool reopens with that call marked not run', async ({ page }) => {
  await fakeBackend(page);
  await open(page);
  await send(page, 'hello');
  await expect(page.locator('#ai-log .ai-text')).toContainText('Reply to: hello');
  // Make the stored transcript end with a tool call that never got its result (the tab closed while it ran).
  await page.evaluate(async () => {
    const index = JSON.parse(localStorage.getItem('hallucinate.assistantChats')!);
    const id = index.chats[0].id;
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('hallucinate'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const store = () => db.transaction('assistant-chats', 'readwrite').objectStore('assistant-chats');
    const rec = await new Promise<{ messages: { role: string; parts: unknown[] }[] }>((res) => { const g = store().get(`chat:${id}`); g.onsuccess = () => res(g.result); });
    rec.messages.push({ role: 'assistant', id: 'cut', parts: [{ type: 'tool-call', id: 'call-cut', name: 'write_scene_code', arguments: '{"scene":"Hyper Tunnel"}', input: { scene: 'Hyper Tunnel' }, state: 'input-complete' }] } as never);
    await new Promise((res) => { const p = store().put(rec, `chat:${id}`); p.onsuccess = res; });
    db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('i');
  await expect(page.locator('#ai-log .ai-tool.error')).toContainText('Editing Hyper Tunnel');
  await expect(page.locator('#ai-log .ai-tool.running')).toHaveCount(0);       // not a chip spinning forever
  await expect(page.locator('#ai-log .ai-tool.error')).toHaveAttribute('title', /app was closed/);
});

test('assistant: the panel resizes from its corner, keeps the size after a reload, double-click resets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });                 // room above the panel to grow into
  await fakeBackend(page);
  await open(page);
  const panel = page.locator('#ai');
  const before = (await panel.boundingBox())!;
  const grip = page.locator('#ai > .ai-grip');
  await expect(grip).toHaveClass(/tr/);                                        // the default spot grows up and right
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + 7, g.y + 7);
  await page.mouse.down();
  await page.mouse.move(g.x + 60, g.y - 20, { steps: 8 });
  await page.mouse.move(g.x + 120, g.y - 40, { steps: 8 });
  await page.mouse.up();
  const after = (await panel.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 100);
  expect(after.height).toBeGreaterThan(before.height + 30);
  expect(Math.abs(after.y + after.height - (before.y + before.height))).toBeLessThan(2);   // it grew upward: the bottom stayed

  await page.reload();
  await page.getByRole('button', { name: 'Play demo beat' }).click();
  await page.keyboard.press('i');
  const kept = (await panel.boundingBox())!;
  expect(Math.round(kept.width)).toBe(Math.round(after.width));
  await page.locator('#ai > .ai-grip').dblclick();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before.width));
});
