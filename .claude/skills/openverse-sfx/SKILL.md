---
name: openverse-sfx
description: >-
  Pull openly-licensed sound effects and music from Openverse (5M+ CC audio across Freesound, Jamendo, Wikimedia) to burn into a reel edit. Keyless official Creative Commons API. Trigger when a sound/SFX/music bed is needed and the local Real SFX library or earshot code-bank doesn't have the right real recording.
---

# openverse-sfx — openly-licensed sounds from the official Creative Commons API

Openverse (openverse.org, run by WordPress/Automattic for Creative Commons) indexes 5M+ openly-licensed audio files across Freesound, Jamendo, Wikimedia Commons and more. The API needs **no key** (optional registration raises rate limits). This is the deep well for a specific real recording when the bundled Real SFX UI cues or earshot's code-synth bank don't have it.

## Hard licensing rule (commercial reels)

This content goes into monetizable Instagram reels, so **only pull commercially-safe, ideally attribution-free licenses**:

- **Always filter** `license=cc0,pdm` (CC0 + Public Domain Mark) → free commercial use, **no attribution**. Prefer these.
- `by` (CC BY) is allowed commercially **but requires crediting the author** — only use if nothing in cc0/pdm fits, and record the attribution (title, author, source URL, license) so the user can credit it.
- **Never** use `nc` (non-commercial) or `nd` (no-derivatives) — both disqualify monetized reels.

## How to use it

1. **Search** (keyless):
   ```
   curl -fsSL "https://api.openverse.org/v1/audio/?q=QUERY&license=cc0,pdm&page_size=10" \
     -H "User-Agent: cutting-room/1.0"
   ```
   Useful params: `q` (e.g. `whoosh`, `riser`, `impact boom`, `camera shutter`, `notification pop`), `license`, `source=freesound,jamendo`, `page_size`, `length=short` (for SFX) / `long` (for music beds), `category=music|sound_effect`.

2. **Pick** a result. Each has: `title`, `license`, `url` (direct downloadable audio), `foreign_landing_url` (credit page), `creator`, `duration`.

3. **Download** the chosen file to the job's temp dir:
   ```
   curl -fsSL "<result.url>" -o /tmp/<job>/sfx_whoosh.mp3 -H "User-Agent: cutting-room/1.0"
   ```

4. **Audit before placing** — Openverse `url` is often a *preview* (lower bitrate). For a hero sound prefer the full file from `foreign_landing_url` when quality matters; for a quick layer the preview is fine. Run it through `earshot measure` (LUFS/peak/shape) to confirm it's the sound you want before committing — Claude can't hear, so measure, don't assume.

5. **Place it** with ffmpeg at the exact moment you decided in the edit (delay + mix under voice, ducked):
   ```
   ffmpeg -i reel.mp4 -i sfx_whoosh.mp3 -filter_complex \
     "[1:a]adelay=4200|4200,volume=0.6[sfx];[0:a][sfx]amix=inputs=2:normalize=0[a]" \
     -map 0:v -map "[a]" -c:v copy out.mp4
   ```
   (adjust `adelay` ms to the beat, `volume` to sit under the voice.)

## Where this fits among the sound tools

- **Real SFX** (local, 78 CC0 UI cues + your own library) — real recordings placed on the exact frame, keeps music/voice. First choice when a fitting recording is already indexed locally.
- **earshot** — gives Claude *ears* (`measure`, `describe`, `find`, `critique`) and a 252-sound **code-synth** bank (`sfx`, `kit`) that renders whooshes/hits/clicks deterministically with no network. First choice for clean synthetic motion-design hits and for *auditing* any sound.
- **openverse-sfx** (this) — the big online library for a *specific real recording* neither of the above has. Always license-filtered.

## Remember

- **Trending Instagram songs are NOT here and must NOT be burned in** — those are added inside the Instagram app from its licensed library (that's also where the algorithmic reach comes from). This skill is for SFX and royalty-free beds only.
- Register a free Openverse API client (`/v1/auth_tokens/register/`) only if rate limits bite — keyless is fine for normal use.
