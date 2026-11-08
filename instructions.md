# Instructions for Claude — The Cutting Room system

Read this file first if you're picking up this project cold (a fresh terminal, a new machine, a new Claude Code session). It's written so a Claude running locally in a terminal can set everything up and understand the whole system without needing to re-derive any of this from scratch.

## What this is

A personal content-ops + video-editing system for two Instagram accounts belonging to the repo owner:

- **@anaz (creator)** — personal account about AI, tech and startups, India/GCC-angled where possible.
- **@yorki (business)** — a SaaS product: an AI sales assistant for Indian/GCC small businesses. It answers customer questions on a business's website/Instagram/WhatsApp via RAG, classifies each lead hot/warm/cold, and notifies the owner on WhatsApp.

The system has three parts, described below in the order to set them up.

## 1. The Cutting Room app (this repo)

A local Node/Express server + single-page frontend: strategy reference (Overview tab), an AI script studio (hook + cue-card breakdowns, voice dictation, three modes: new idea / remix a reel / news-trending), a News Desk (real live web research via Claude's `web_search`/`web_fetch` tools), a content pipeline board, and a swipe file of creators to watch.

**Setup:**
```
npm install
npm start
```
Open `http://localhost:3000`.

**Credentials** — pick one, see the root `README.md` for the full explanation:
- Nothing to set up at all if Claude Code is already logged in on this machine (`ant auth status` to check, `ant auth login` if not) — the server picks that up automatically, and usage counts against the normal Claude subscription, not a separate bill.
- Or set `ANTHROPIC_API_KEY` in `.env` (copy from `.env.example`) — a separate, pay-per-token Developer Platform key from console.anthropic.com. This is **not** covered by a Claude Pro/Max subscription; it's a different product with its own billing. Don't confuse the two when explaining cost to the user.

Without either, the app still runs — only "Break it down with Claude" and "Research this (live)" need credentials; everything else (the pipeline board, swipe file) is just local JSON storage at `data/store.json` (gitignored, not shared).

## 2. The Claude Artifact version (a second, independent copy)

There's also a published Claude Artifact version of this same tool at:

    https://claude.ai/code/artifact/d31d55ca-c7b2-48ea-a968-6b5435aaad7d

It's the same four tabs conceptually, but runs inside Claude's sandboxed artifact runtime instead of a local server. Important: **it cannot fetch URLs or search the web at all** — that's a hard platform sandbox limit, not a bug. Its News Desk only gets populated when a Claude session (this repo's `/content` skill, or a chat request) researches something externally and writes the result into its database via the Artifact tool's `write_db`. The local app in this repo exists specifically because the artifact can't do that research itself.

Don't try to make the artifact fetch URLs directly — it was already established (the long way) that this isn't possible. If asked, route research requests through the local app's News Desk, or through the `/content` skill below, which writes into *this* artifact's database either way.

## 3. Claude Code skills (`claude-skills/`)

These are **not** standalone software — they're instruction sets a Claude Code session follows. They only work inside a live Claude session; "installing" them means getting the `SKILL.md` (and for edit-reel, the bundled script) into `~/.claude/skills/<name>/` for a given Claude installation, or saved to the user's account profile (via the `.skill` package files — if the user already clicked "Save skill" on those, they're already available in any Claude session they run, nothing to do).

If skills aren't showing up as available in a fresh session, set them up from the copies bundled in this repo:
```
mkdir -p ~/.claude/skills/content ~/.claude/skills/edit-reel/scripts
cp claude-skills/content/SKILL.md ~/.claude/skills/content/SKILL.md
cp claude-skills/edit-reel/SKILL.md ~/.claude/skills/edit-reel/SKILL.md
cp claude-skills/edit-reel/scripts/edit_reel.py ~/.claude/skills/edit-reel/scripts/edit_reel.py
```

### `/content <link or topic>`

Researches a link or trending topic (real web search/fetch — the thing the Claude Artifact itself can't do) and writes a verified, sourced entry into the Artifact's News Desk database. Full behavior is documented in `claude-skills/content/SKILL.md` — key points:
- Instagram/TikTok/etc. links can't be fetched (login-walled) — it asks the user to paste the caption/transcript instead of guessing.
- Checks for duplicates in News Desk before adding.
- Stays strictly factual — never invents numbers, quotes, or dates not actually found.

### `/edit-reel INPUT.mp4 OUTPUT.mp4`

Real video editing for talking-head Reels: transcribes locally (`faster-whisper`, no API key, nothing uploaded anywhere), trims dead air between words to tighten pacing, and burns in styled captions (bold-centered or karaoke word-highlight). Full behavior and CLI options are in `claude-skills/edit-reel/SKILL.md`.

**One-time setup on a new machine:**
```
pip3 install faster-whisper
```
Make sure `ffmpeg` is installed (`ffmpeg -version`; install via `brew install ffmpeg` / `apt install ffmpeg` / your OS's package manager if missing — it needs `libass` and `libfreetype` support for caption rendering, which standard builds include).

The **first run only** downloads the transcription model (~500MB for the default `small` size) from Hugging Face — needs a normal internet connection. This was a real fight to get working in a network-sandboxed cloud environment (had to allowlist `huggingface.co`, `cdn-lfs.huggingface.co`, `cas-server.xethub.hf.co`, and a regional CDN host that varies) — **on an unrestricted home/laptop connection this should just work with no extra steps.** After the first run, the model is cached locally (`~/.cache/huggingface`) and no further network access is needed.

**What it honestly can't do yet** (don't overpromise these to the user): no sound-effect library (ask for a file, or offer a crude synthesized placeholder), no motion graphics beyond the caption text itself, and no guarantee that any of this makes a video "go viral" — tightened pacing and readable captions measurably help retention; nothing can promise outcomes.

## Things learned the hard way — don't re-litigate these

- **Pro/Max subscription vs API billing are different products.** Claude Code and claude.ai usage rides the subscription. A standalone `ANTHROPIC_API_KEY` or `ant auth login` token is Developer Platform usage, billed separately per token — `ant auth login` is a more convenient *login method*, not a way to spend subscription usage from a script. Get this distinction right before telling the user something is "free."
- **The Claude Artifact cannot fetch URLs or browse, ever.** Not a bug, not fixable with cleverness — it's a sandbox restriction on all Claude Artifacts. Don't re-attempt wiring a connector (e.g. Apify) into the artifact's `mcp` capability without having actually observed a real call succeed through that exact path first — async/job-style connector tools (the kind that return a status and need polling) generally don't fit the artifact's single-call contract well, and guessing at it wastes everyone's time.
- **Instagram/TikTok/etc. links can't be fetched by anything here** — they're login-walled. Always ask for a pasted caption/transcript instead of pretending a fetch worked.
- **This repo's own GitHub remote may be behind what's described here.** Earlier sessions hit a recurring problem where a cloud session's git proxy only allows pushing to a pre-authorized repo list, so work sometimes only reached the user as a sent `.zip`/file rather than an actual push. Before assuming "the code is already on GitHub" because an earlier conversation said so, verify with `git log` against the actual remote — don't repeat that mistake.
- **A restricted cloud sandbox's network policy isn't the user's policy.** If a tool needs a host that's blocked, check `get_environment`/`update_environment`-equivalent tooling for this session type and propose the exact host before giving up — but this doesn't apply on a user's own laptop, which normally has full internet access.

## Quick start checklist for a totally fresh machine

1. `git clone` this repo, `cd` into it.
2. `npm install`, confirm `ant auth status` shows a login (or add an API key to `.env`).
3. `npm start`, open `http://localhost:3000` — confirm the Overview tab loads and "connected to local server" shows in the header.
4. Copy the two skills into `~/.claude/skills/` per the commands above (skip if already saved to the user's Claude profile).
5. `pip3 install faster-whisper`, confirm `ffmpeg -version` works.
6. Try `/content` with a real topic, and `/edit-reel` with a short test clip, to confirm both actually work end to end before telling the user it's ready.
