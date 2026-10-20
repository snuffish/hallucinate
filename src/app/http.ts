// POSTs `body` as JSON, the way every /api handler expects it (server/guard.ts refuses other bodies).
export const postJSON = (url: string, body: unknown): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
