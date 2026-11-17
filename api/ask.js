// POST /api/ask  { question, history: [{ role: 'user' | 'assistant', text }] }
// Streams Server-Sent Events:
//   moments  { moments: [...], spellings }   every transcript passage found, numbered
//   text     { delta }                       the answer, as it is written
//   error    { message }
//   done     {}
import { search, episodeList } from '../lib/search.mjs';
import { streamTurn, GeminiError } from '../lib/gemini.mjs';

const MAX_ROUNDS = 3;            // model turns per question (searches + final answer)
const PER_SEARCH = 14;

const TOOL = [{
  name: 'search_transcripts',
  description: 'Search the talk transcripts. Returns numbered passages with episode and timestamp. Matching already tolerates misspelled Sanskrit, so use the standard spelling.',
  parameters: {
    type: 'OBJECT',
    properties: {
      queries: { type: 'ARRAY', items: { type: 'STRING' }, description: '1 to 3 short keyword queries (2-5 words each), each a different angle or synonym. Example: ["nishkama karma", "desireless action fruits"].' },
      chapter: { type: 'INTEGER', description: 'Only if the user asked about a specific Gita chapter.' },
      verse: { type: 'INTEGER', description: 'Only with chapter, if the user asked about a specific verse.' },
    },
    required: ['queries'],
  },
}];

function coverage() {
  const eps = episodeList();
  const ch = eps.filter((e) => e.chapter && e.v_to).sort((a, b) => b.chapter - a.chapter || b.v_to - a.v_to)[0];
  return `${eps.length} episodes, covering Bhagavad Gita Chapter 1 up to verse ${ch.chapter}.${ch.v_to}, plus a few talks on other topics`;
}

const system = () => `You are Jijnasu Samvada, a study companion for Swami Anish Chaitanya's Bhagavad Gita talks on YouTube (${coverage()}).

Rules:
- Answer ONLY from the numbered transcript passages you are given or that search_transcripts returns. Report what Swamiji says in the talks; do not add outside commentary. If the passages do not cover the question, say so plainly and mention what the talks cover so far.
- The passages are automatic captions, so Sanskrit words are often misspelled ("stitta pragya", "nish karma", "sodharma"). Work out the intended word and write it in standard transliteration (sthitaprajna, nishkama karma, svadharma).
- Cite by putting passage numbers in square brackets right after the sentence they support, like [3] or [2][7]. Cite every passage that genuinely supports the answer; when many passages are relevant, draw on many of them rather than two or three. Never cite a number you were not given.
- Never write URLs, timestamps or a "Sources" list. The app turns the numbers into links to the exact moment in the video.
- If the passages are thin, or the question is a follow-up, call search_transcripts before answering.
- Write 120 to 300 words in short paragraphs. Bold the key Sanskrit terms. No headings.`;

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const forModel = (ms) => ms.map((m) => `[${m.n}] (${m.title}, at ${mmss(m.start)}) ${m.context}`).join('\n\n');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = '';
  for await (const c of req) raw += c;
  return JSON.parse(raw || '{}');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
  let body;
  try { body = await readBody(req); } catch { res.statusCode = 400; return res.end('Bad JSON'); }
  const question = String(body.question || '').trim().slice(0, 600);
  if (!question) { res.statusCode = 400; return res.end('Empty question'); }
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
    .filter((h) => h && typeof h.text === 'string' && h.text.trim())
    .map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text.replace(/\s*\[\d+\]/g, '').slice(0, 2500) }] }));
  while (history.length && history[0].role !== 'user') history.shift();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const numbered = new Map();      // passage id -> citation number
  const register = (result) => {
    const fresh = [];
    for (const m of result.moments) {
      if (numbered.has(m.id)) continue;
      numbered.set(m.id, numbered.size + 1);
      fresh.push({ ...m, n: numbered.size });
    }
    if (fresh.length || Object.keys(result.spellings).length)
      send('moments', { moments: fresh.map(({ context, score, ...m }) => m), spellings: result.spellings });
    return fresh;
  };

  try {
    const followUp = history.length > 0;
    let first = [];
    if (!followUp) first = register(search(question, { limit: 16 }));

    const contents = [...history, {
      role: 'user',
      parts: [{ text: followUp ? question : `Question: ${question}\n\nTranscript passages:\n\n${forModel(first) || '(nothing found for these exact words; try search_transcripts with other words)'}` }],
    }];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS - 1;
      const { parts, calls } = await streamTurn({
        system: system(), contents,
        tools: last ? null : TOOL,
        forceTool: round === 0 && (followUp || !first.length),
        onText: (delta) => send('text', { delta }),
      });
      if (!calls.length) break;
      // Answer every function call from this turn in ONE message.
      contents.push({ role: 'model', parts });
      const replies = calls.map((call) => {
        const a = call.args || {};
        const queries = (Array.isArray(a.queries) ? a.queries : [a.queries || a.query || '']).filter(Boolean).slice(0, 3);
        const found = [];
        for (const q of queries) found.push(...register(search(String(q), { chapter: a.chapter || undefined, verse: a.verse || undefined, limit: Math.ceil(PER_SEARCH / queries.length) + 2 })));
        const reply = { name: call.name, response: { passages: forModel(found) || 'No new passages found.' } };
        if (call.id) reply.id = call.id;
        return { functionResponse: reply };
      });
      contents.push({ role: 'user', parts: replies });
    }
  } catch (e) {
    const quota = e instanceof GeminiError && e.status === 429;
    const noKey = e instanceof GeminiError && e.status === 0;
    console.error(e);
    send('error', {
      message: quota ? "Today's free AI quota is used up, so I can't write a summary right now. The moments below still come straight from the transcripts."
        : noKey ? 'The AI key is not configured yet (GEMINI_API_KEY). The moments below still come straight from the transcripts.'
        : 'The AI summary failed this time. The moments below still come straight from the transcripts. Please try again.',
    });
  }
  send('done', {});
  res.end();
}
