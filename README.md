# The Cutting Room

Local content-ops app for the creator (@anaz) and Yorki Instagram accounts: strategy reference, an AI script studio (with voice dictation and live news research), a content pipeline, and a swipe file.

This is a real server, not a sandboxed page — so unlike the Claude Artifact version, the "Research this" button in News Desk genuinely fetches and verifies live web content, on demand, whenever you ask it to.

## Setup

1. **Install dependencies** (once):
   ```
   npm install
   ```

2. **Give it Claude credentials — pick one:**

   - **Use your Claude Code / Pro-Max login (no separate bill).** If you have Claude Code installed and are logged in on this machine — or just run `ant auth login` — you can skip `.env` entirely. The server picks up that login automatically and usage counts against your existing subscription instead of opening a separate pay-per-token account.
   - **Or use a standalone API key** (separate, pay-per-token billing at console.anthropic.com — not covered by a Pro/Max subscription):
     ```
     cp .env.example .env
     ```
     then set `ANTHROPIC_API_KEY` in `.env` to a key from https://console.anthropic.com/settings/keys.

   Either way, Overview / Pipeline / Swipe File work with no credentials at all — only Script Studio's "Break it down" and News Desk's "Research this" need one of the two above. If neither is set up, those two features show a clear error telling you which to add.

3. **Run it:**
   ```
   npm start
   ```
   Then open http://localhost:3000

## What costs money

Every "Break it down with Claude" and "Research this (live)" click makes a real Claude call — typically a fraction of a cent to a couple of cents each (research calls that use web search/fetch cost a bit more than a plain script breakdown). Everything else (saving ideas, the pipeline board, the swipe file) is free — it's just a local JSON file at `data/store.json`.

## How it's different from the Claude Artifact version

The artifact version (a published Claude Artifact) runs in a sandboxed browser tab with no network access, so "paste a link and research it" can only ever be simulated by asking Claude in chat to fetch things for you. This app runs a real Node server on your machine, so the News Desk's Research button calls Claude's `web_search` / `web_fetch` tools directly and gets a real, live answer back in the browser — no chat round-trip, no schedule, just click and wait ~10-30 seconds.

## Data

Everything you add (pipeline cards, saved scripts, swipe file entries, news stories) is stored in `data/store.json`. Back it up or move it if you reinstall — it's not committed to git (see `.gitignore`).

## Project layout

- `server.mjs` — Express server: static file serving + the API (`/api/state`, `/api/pipeline`, `/api/swipe`, `/api/newsdesk`, `/api/research`, `/api/breakdown`, `/api/scripts`)
- `public/index.html` — the whole frontend (one file, no build step)
- `data/store.json` — created automatically on first write
- `claude-skills/` — the Claude Code skills that pair with this app (see `instructions.md` at the repo root)
