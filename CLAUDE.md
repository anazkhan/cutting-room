# CLAUDE.md

Guidance for Claude Code (and any future Claude session) working in this repo. This file is self-contained — you shouldn't need to open anything else to understand the system, though `docs/instructions.md` has the same detail in cold-start setup form and the `README.md` is the user-facing version.

## What this project is

**The Cutting Room** — a personal content-ops + video-editing system for the repo owner's two Instagram accounts:

- **@anaz (creator)** — personal account about AI, tech and startups, India/GCC-angled where possible.
- **@yorki (business)** — a SaaS product: an AI sales assistant for Indian/GCC small businesses. It answers customer questions on a business's website / Instagram / WhatsApp via RAG, classifies each lead hot/warm/cold, and notifies the owner on WhatsApp. When this comes up in scripts, treat it as a real story, never a pitch.

The system has **three parts**:

1. **This repo** — a local Node/Express app (the real, network-capable version of the tool).
2. **A published Claude Artifact** — a sandboxed browser copy of the same tool (cannot touch the network or video files).
3. **Two Claude Code skills** in `claude-skills/` — instruction sets that do the things the sandboxed artifact can't (live research, real video editing).

## 1. The Cutting Room app (this repo)

A local Node/Express server + single-page frontend. Four conceptual areas:

- **Overview** — strategy reference (creator vs Yorki tone/pillars).
- **Script Studio** — AI script breakdowns (hook + cue-card "beats" + CTA), with three modes: `new` idea, `remix` a reel, `news`/trending. Supports voice dictation in the browser. Saving a script also drops a card into the Pipeline.
- **News Desk** — live web research via Claude's `web_search` / `web_fetch` tools (the thing the artifact can't do).
- **Pipeline** — a content board (idea → scripted → …).
- **Swipe File** — creators to watch.

### Run it

```
npm install
npm start          # node server.mjs → http://localhost:3000
```

### Credentials (pick one)

The app runs with **no credentials** — only Script Studio's "Break it down" and News Desk's "Research this" need Claude; everything else is local JSON.

- **Claude Code / Pro-Max login** — if logged in on this machine (`ant auth status`; `ant auth login` if not), the server picks it up automatically. Usage counts against the normal subscription.
- **`ANTHROPIC_API_KEY`** in `.env` (copy from `.env.example`) — a separate, pay-per-token Developer Platform key from console.anthropic.com. **This is billed separately and is NOT covered by a Pro/Max subscription.** Don't conflate the two when explaining cost.

The SDK resolves credentials itself (`ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → active `ant auth login` OAuth → enterprise fallbacks). Construction never fails on missing creds; only a real call does, and the server surfaces that as a clear error.

### Architecture

| File | Role |
|------|------|
| `server.mjs` | Express server: static serving + the whole API. ~310 lines, no build step. |
| `public/index.html` | The entire frontend — one file, no framework, no build. |
| `data/store.json` | Local persistence, created on first write. **Gitignored**, not committed. |
| `claude-skills/` | The paired Claude Code skills (see part 3). |

**API endpoints** (all in `server.mjs`):
- `GET  /api/state` — returns all four collections (pipeline, scripts, swipe, newsdesk), newest-first.
- `POST/PATCH/DELETE /api/pipeline[/:id]` — pipeline cards.
- `POST/DELETE /api/swipe[/:id]` — swipe file.
- `POST/DELETE /api/newsdesk[/:id]` — news stories (manual add).
- `POST /api/research` — the live research call (`web_search` + `web_fetch`, `useWebTools: true`). Returns `{headline, sourceLink, facts, angle, sources[]}`.
- `POST /api/breakdown` — script breakdown. Returns `{hook, beats[], cta}`.
- `POST /api/scripts` — saves a script and auto-creates a pipeline card at `status: "scripted"`.

**Key internals:**
- Storage is a single in-memory `store` object, persisted to `data/store.json` through a serialized `saveQueue` (writes never interleave).
- Model constant: `MODEL` at the top of `server.mjs`. Prompt-building logic (`CREATOR_VOICE`, `YORKI_VOICE`, `REPLY_SPEC`, `buildBreakdownPrompt`, `RESEARCH_SYSTEM`) lives there too — edit these to tune voice/output shape.
- `parseLenientJSON` tolerates fenced / wrapped model output; the model is asked for JSON-only but this is the safety net.
- `askClaude` loops up to 4× to handle `stop_reason: "pause_turn"` during web-tool use.

When editing: match the existing plain-ESM, no-dependency-churn style. The frontend is deliberately one hand-written HTML file — don't introduce a build step or framework without asking.

## 2. The Claude Artifact version (independent copy)

A published Claude Artifact of the same tool:

    https://claude.ai/code/artifact/d31d55ca-c7b2-48ea-a968-6b5435aaad7d

Same four tabs conceptually, but runs in Claude's sandboxed artifact runtime. **It cannot fetch URLs or search the web — ever. That's a hard platform sandbox limit, not a bug, and it's already been established the long way.** Its News Desk only fills up when a Claude session researches something externally and writes it in via the Artifact tool's `write_db`. This repo's local app exists precisely because the artifact can't do that research itself.

Don't try to make the artifact fetch URLs or wire a connector into its `mcp` capability without having actually observed a real call succeed through that exact path first. Route research through the local News Desk or the `/content` skill instead.

## 3. Claude Code skills (`claude-skills/`)

These are **not standalone software** — they're instruction sets a live Claude session follows. "Installing" means copying them into `~/.claude/skills/<name>/` (or they're already available if the user saved the `.skill` packages to their Claude profile).

```
mkdir -p ~/.claude/skills/content ~/.claude/skills/edit-reel/scripts
cp claude-skills/content/SKILL.md ~/.claude/skills/content/SKILL.md
cp claude-skills/edit-reel/SKILL.md ~/.claude/skills/edit-reel/SKILL.md
cp claude-skills/edit-reel/scripts/edit_reel.py ~/.claude/skills/edit-reel/scripts/edit_reel.py
```

### `/content <link or topic>`
Researches a link or trending topic with real web search/fetch and writes a verified, sourced entry into the **Artifact's** News Desk DB. Checks for duplicates first. Stays strictly factual — never invents numbers, quotes, or dates. Instagram/TikTok/etc. links can't be fetched (login-walled) — it asks the user to paste the caption/transcript instead of guessing. Full spec: `claude-skills/content/SKILL.md`.

### `/edit-reel INPUT.mp4 OUTPUT.mp4`
Real local video editing for talking-head Reels — **nothing is uploaded anywhere**:
1. Transcribes locally (`faster-whisper`, word-level timestamps, CPU, no API key).
2. Trims dead air between words to tighten pacing (never cuts spoken words).
3. Burns in styled captions — `bold-center` (default) or `karaoke` word-highlight.

Setup: `pip3 install faster-whisper` and ensure `ffmpeg` is installed (needs libass/libfreetype for captions — standard builds have these). First run only downloads the ~500MB model from Hugging Face; cached after, no network needed thereafter. Full spec + CLI options: `claude-skills/edit-reel/SKILL.md`.

**Honest limits — don't overpromise:** no sound-effect library (offer a crude synthesized placeholder or ask for a file), no motion graphics beyond the caption text, and nothing guarantees virality. Tightened pacing and readable captions measurably help retention — say exactly that, no more.

## Things learned the hard way — don't re-litigate

- **Pro/Max subscription vs API billing are different products.** Claude Code / claude.ai usage rides the subscription; a standalone `ANTHROPIC_API_KEY` or `ant auth login` token is Developer Platform usage, billed per token. `ant auth login` is a login *method*, not a way to spend subscription usage from a script. Get this right before calling anything "free."
- **The Claude Artifact cannot fetch URLs or browse, ever.** Sandbox restriction on all artifacts. Async/job-style connector tools (status + polling) don't fit the artifact's single-call contract.
- **Instagram/TikTok/X/LinkedIn/Facebook links can't be fetched by anything here** — login-walled. Always ask for a pasted caption/transcript rather than pretending a fetch worked.
- **This repo's GitHub remote may be behind what's described.** Earlier cloud sessions hit a git-proxy allowlist that only permitted pushing to pre-authorized repos, so work sometimes reached the user as a `.zip` instead of a real push. Verify with `git log` against the actual remote before assuming code is already on GitHub.
- **A restricted cloud sandbox's network policy isn't the user's policy.** On the user's own laptop, assume normal full internet access — the allowlist dance in the skills only applies to network-sandboxed cloud environments.

## Working agreement

- The owner records himself talking (he's bad at memorizing long scripts — that's *why* Script Studio breaks topics into short, independently-filmable single sentences). Keep that constraint in mind for any scripting work.
- Stay strictly factual in anything that becomes content — never invent stats, quotes, or dates.
- When genuinely in doubt about intent or a non-obvious choice, **ask** rather than guess.
