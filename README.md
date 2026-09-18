# ARKY Backend API

The Express service behind the chat on gk-edge.com and behind the contact and demo forms. This directory is its own git
repository (`GK-Edge/arky_backend`); the site that calls it lives in the parent directory and is deployed separately.

## Deployment

- **Host:** Render, at `https://arky-backend.onrender.com`, which redeploys on a push to `main`.
- **Entry file:** `server.js`. **Node:** 20.x or 22.x. **Start:** `npm start`.
- The free tier sleeps after ~15 minutes idle. The service pings itself every 14 minutes, and the site also pings it when
  a visitor loads a page, so the first question rarely pays for the cold start.

## Environment variables

| Variable | Used for |
| --- | --- |
| `GEMINI_API_KEY` | the chat endpoints |
| `RESEND_API_KEY` | sending contact and demo submissions by email |

Locally, both are read from `.env.local` in the parent directory.

## Endpoints

| Route | What it does |
| --- | --- |
| `GET /` | health check; also reports the knowledge base size and whether it is being sent whole or retrieved from |
| `POST /api/chat` | one request, one complete answer |
| `POST /api/chat/stream` | the same answer as server-sent events: `delta`, then `done`, or `error` |
| `POST /api/contact` | emails the contact and demo forms to info@gk-edge.com through Resend |

Chat takes `{ message, mode, history }`. `mode` is `site_copilot` for the website assistant (the site always sends this)
or `demo` for the ARKY product persona. A message is capped at 2000 characters, history at the last 8 turns, and the
model call at 45 seconds with one retry when the upstream reports a transient failure.

Rate limits: 10 chat requests per minute per IP, 3 form submissions per 3 minutes. Requests from localhost skip both.

## What ARKY answers from

`knowledgebase.md` is the single source of truth: the site map, what each page is for, contact routes, the published
FAQs, careers, a Greek-to-English glossary, and the claims ARKY must never make. To change what ARKY knows, edit that
file and deploy; nothing else needs to change.

`knowledge.js` turns it into context for the model. It parses the file into sections by heading, folds Greek and
accents, drops stop words in both languages, and scores sections with BM25 so a rare word counts and a common one does
not. While the file fits in `WHOLE_BASE_LIMIT` characters it is sent whole, which no retrieval can beat; past that,
retrieval selects the best sections up to a budget. The glossary translates a Greek question into the English terms the
content uses, and is never returned as an answer itself.

**The compliance rule stands:** the system prompts and the knowledge base must keep prohibiting any claim of GDPR,
SOC 2 or ISO 27001 compliance until the certifications actually exist.

## Tests

```bash
npm test        # node --test, no dependencies
```

They cover tokenizing, Greek folding, section parsing, ranking against the real knowledge base, the whole-base
threshold, and the budget. Run them after editing `knowledge.js` or restructuring `knowledgebase.md`.

## Workflow

```bash
cd backend
npm test
git add .
git commit -m "update backend"
git push origin main   # triggers the Render deploy
```
