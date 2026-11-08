---
name: edit-reel
description: >-
  Edit a talking-head video the user hands over (a phone recording for the @anaz creator or Yorki Instagram account): transcribe it, tighten pacing by trimming dead air between words, and burn in styled captions, entirely locally (faster-whisper + ffmpeg, no API key, no upload to a third party). Trigger whenever the user attaches or references a video file and asks to edit it, add captions/subtitles, add sound effects, add motion graphics, tighten the pacing, or make it reel-ready — or invokes /edit-reel directly.
---

# /edit-reel — real video editing for talking-head Reels

This is the practical half of "make Cutting Room the best video tool I can use": the user records themselves talking on their phone, hands you the file, and you actually edit it — not a feature bolted onto the web artifact (which can't touch video files at all, sandboxed), but you, in a session with real file and `ffmpeg` access.

Read this whole file before running anything — the script bundled here (`scripts/edit_reel.py`) does the heavy lifting, but you still need to make judgment calls around it (which style fits the clip, whether trimming is too aggressive, what's realistic to promise).

## What this can actually do today

1. **Transcribe** the video locally with word-level timestamps (`faster-whisper`, runs on CPU, no internet needed after the one-time model download, no API key).
2. **Tighten pacing** by shortening gaps between words longer than a threshold (default 0.6s) down to a small natural pause (default 0.12s) — this never cuts a spoken word, only the dead air around it, so it's non-destructive to content. This is the single highest-value edit for talking-head content: it's what makes a raw phone recording feel "edited" at all.
3. **Burn in styled captions** — bold, centered, high-contrast text sized for phone screens, a few words on screen at a time (not a wall of text), in two styles:
   - `bold-center` (default): clean, all-caps, pops in per phrase.
   - `karaoke`: word-by-word highlight as it's spoken (the CapCut-style look), via ASS karaoke tags.

## What this does NOT do yet — be honest about this with the user

- **Sound effects**: there's no licensed sound-effect library bundled here. Don't silently skip a request for "add a whoosh here" — tell the user you'd need either a specific audio file from them, or that you can synthesize a simple generic tone/beep via ffmpeg (crude, not professional SFX) if they want that as a placeholder. Don't fabricate the impression that real foley/SFX got added.
- **Motion graphics beyond text**: no icon/lower-third/logo library exists here either. The caption styling itself is the "motion" layer for now (pop-in, karaoke highlight). If the user wants a specific graphic (an arrow, an emoji callout, a logo), ask what asset to use or whether to generate something simple with `drawtext`/`overlay` — don't promise After-Effects-level motion graphics from this alone.
- **Guaranteed virality**: tightened pacing and readable captions measurably help retention; nothing guarantees a video performs. Say so plainly if the user frames it that way — don't let "make it go viral" pass without the same honest caveat given earlier in this project.

## How to run it

First time only, this needs `pip3 install faster-whisper` and network access to download the transcription model (~500MB for the default `small` model, one-time, cached after). If this session's environment has a restricted network allowlist and the download gets blocked, the hosts that need to be reachable are `huggingface.co`, `cdn-lfs.huggingface.co`, `cas-server.xethub.hf.co`, and a regional CDN host that varies (seen so far: `us.aws.cdn.hf.co`) — check `get_environment`, and propose adding whatever host the proxy error actually names via `update_environment` (that call always prompts the user for approval first; never a blind retry). After the first successful run the model is cached locally and no further network access is needed for transcription itself.

```
python3 ~/.claude/skills/edit-reel/scripts/edit_reel.py INPUT.mp4 OUTPUT.mp4 [options]
```

Key options (see `--help` for the full list, or read the script's docstring):
- `--no-trim` — keep original pacing, captions only.
- `--trim-threshold` / `--trim-keep` — tune how aggressively dead air gets cut.
- `--caption-style bold-center|karaoke`
- `--font-size`, `--margin-v` — fit the account's visual style (check the Cutting Room artifact's Overview tab for the creator vs Yorki tone if that matters for this clip).
- `--model tiny|base|small|medium` — bigger is more accurate but slower; `small` (the default) is a good balance for short-form clips; drop to `base` if a clip is long and speed matters more than accuracy, or go to `medium` if a `small` pass produced visibly wrong words on a hard-to-hear clip.

## Workflow

1. **Get the file.** If the user references a video without attaching it, ask them to send the actual file (or a path to it) — don't proceed on a description of a video you haven't seen.
2. **Ask about style only if it matters** — which account it's for (affects tone, not the mechanics), whether they want the trim pass or just captions, which caption style. Don't interrogate over defaults that are already reasonable; just confirm the account/vibe if unclear and run with sensible defaults otherwise.
3. **Run the script.** Watch its stage-by-stage output — it tells you how many words it transcribed, how much dead air it removed, and where the output landed.
4. **Sanity-check before handing it back**: skim the transcript the script produced (it prints word count and detected language) for obvious garbage — a near-silent or music-only clip will transcribe badly; say so rather than handing back nonsense captions. If `ffprobe`-reported duration dropped by a huge fraction after trimming, that's worth a second look before calling it done — overly aggressive trimming on a clip with natural long pauses (e.g., for effect) can hurt more than help; `--no-trim` or a higher `--trim-threshold` is the fix.
5. **Hand back the file** and say plainly what was done (captions added, N seconds of dead air trimmed) and what wasn't (no SFX, no extra graphics) so expectations stay accurate.

## Notes for future you

- If the user keeps asking for the same unmet request (a specific SFX library, a specific graphic style), that's a signal to actually build that piece into this skill rather than keep explaining the gap each time — update this file and bundle whatever asset/script makes it real, the same way this version replaced "I can't do video editing" with an actual working pipeline.
