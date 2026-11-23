# Jijñāsu Saṁvāda

Ask a question about the Bhagavad Gita and get an answer drawn only from Swami Anish Chaitanya's talks, with a link to every moment in the videos where he speaks about it.

[Playlist on YouTube](https://www.youtube.com/playlist?list=PLZjoPv4SqEAXVvoHg7EueLBINTFAhkzyp)

## What it covers

As of 23 November 2026: 138 episodes, about 188 hours and 1.6 million words of talks. That is Gita Chapters 1 to 3 in full, the start of Chapter 4, and a few talks on other topics (Ram Charit Manas, Chatushloki Bhagavat, Vishnu Sahasranama and others). The live numbers are computed from the transcripts on every build and shown on the home page.

The text is YouTube's automatic captions, so Sanskrit words are often misspelled. The answer is a guide to the talks, not a substitute for listening to them.

## How it works

1. **Search.** The question is searched in a SQLite FTS5 index of the transcripts (28,228 passages as of 23 November 2026).
   - *Sanskrit spellings.* Captions write "nishkama" as nishkam, nishkm or "nish karma", and "sthitaprajna" as "stitta pragya". Every word in the transcripts is reduced to a sound key, and a query word matches any caption word whose key is close to its own, including words the captions split in two.
   - *Verse numbers.* "2.47" or "chapter 3 verse 27" narrows the search to the episodes whose titles cover that verse.
2. **Answer.** Up to 16 passages go to Gemini (`gemini-flash-lite-latest`), which may search again with other words, then writes an answer that cites passages by number. Earlier questions in the conversation are sent along, so follow-ups work.
3. **Moments.** Every passage found is listed beside the answer, grouped by episode, each linking to that second of the video. "Show more moments" widens the list to 40.

If the AI is unavailable (for example the free daily quota is used up), the moments are still shown.

## Files

| Path | Purpose |
| --- | --- |
| `public/index.html` | The whole interface (no framework) |
| `api/ask.js` | Search + Gemini, streamed to the page |
| `api/search.js` | Search only, for "Show more moments" |
| `lib/search.mjs`, `lib/text.mjs` | Spelling-tolerant search |
| `scripts/build-index.mjs` | Builds the index from `data/` on every deploy |
| `data/ep_NNN.json` | One transcript per episode |
| `ingest.py` | Downloads captions for new playlist episodes |
| `.github/workflows/update-episodes.yml` | Checks for new episodes every Monday. YouTube blocks GitHub's servers, so a red run means new episodes are waiting |
| `update.bat` | Downloads and publishes new episodes; double-click on Windows |

`app.py`, `build_index.py`, `requirements.txt` and `gita_search.db` are the earlier Streamlit version, kept so that app keeps running until this one replaces it.

## Run it locally

Needs Node.js 22.

```
npm install
npm run build
set GEMINI_API_KEY=your-key      (PowerShell: $env:GEMINI_API_KEY="your-key")
npm run dev
```

Then open http://localhost:3000.

## Deploy

Hosted on Vercel's free tier at https://jijnasu-samvada.vercel.app. Vercel runs `npm run build` on every push to `main`, which rebuilds the index, so adding an episode only means adding its JSON file to `data/`. The one setting needed is the environment variable `GEMINI_API_KEY`.
