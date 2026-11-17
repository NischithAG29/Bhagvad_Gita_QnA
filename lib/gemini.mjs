// Minimal streaming client for the Gemini API (no SDK, so nothing to install).
const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
export const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

export class GeminiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Streams one model turn. Calls onText(delta) for visible text as it arrives.
 * Returns { parts, calls }: the model's full turn (kept verbatim so it can be
 * sent back) and any function calls it made.
 */
export async function streamTurn({ system, contents, tools, forceTool, onText, signal }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError(0, 'GEMINI_API_KEY is not set.');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  };
  if (tools) {
    body.tools = [{ functionDeclarations: tools }];
    if (forceTool) body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
  }
  const r = await fetch(`${BASE}/models/${MODEL}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `Gemini returned ${r.status}`;
    try { msg = (await r.json()).error?.message || msg; } catch {}
    throw new GeminiError(r.status, msg);
  }
  const parts = [], calls = [];
  const dec = new TextDecoder();
  let buf = '';
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk; try { chunk = JSON.parse(data); } catch { return; }
    if (chunk.error) throw new GeminiError(chunk.error.code || 500, chunk.error.message || 'Gemini error');
    for (const p of chunk.candidates?.[0]?.content?.parts || []) {
      parts.push(p);
      if (p.functionCall) calls.push(p.functionCall);
      else if (p.text && !p.thought) onText?.(p.text);
    }
  };
  for await (const bytes of r.body) {
    buf += dec.decode(bytes, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).trimEnd()); buf = buf.slice(i + 1); }
  }
  if (buf.trim()) handle(buf.trim());
  return { parts, calls };
}
