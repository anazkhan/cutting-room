#!/usr/bin/env python3
"""
edit_reel.py — transcribe a talking-head video, tighten its pacing by trimming
dead air between words, and burn in styled, trendy captions.

Usage:
    python3 edit_reel.py INPUT.mp4 OUTPUT.mp4 [options]

Options:
    --no-trim              Skip the silence-trim pass (keep original pacing).
    --trim-threshold S      Gaps longer than this many seconds get shortened (default 0.6).
    --trim-keep S           How much of each long gap to keep, for breathing room (default 0.12).
    --caption-style NAME     One of: bold-center (default), karaoke.
    --font-size N            Caption font size (default 64).
    --margin-v N             Vertical margin from the bottom, in pixels (default 180).
    --model NAME             faster-whisper model size: tiny/base/small/medium (default small).
    --keep-work-dir          Don't delete the temporary working directory (for debugging).

Everything happens locally (faster-whisper + ffmpeg) — no API key, no network
call for the actual processing, only the one-time model download on first run.
"""
import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def run(cmd, **kw):
    result = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(map(str, cmd))}\n--- stderr ---\n{result.stderr[-4000:]}"
        )
    return result


def ffprobe_duration(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)])
    return float(r.stdout.strip())


def extract_audio(video_path, audio_path):
    run(["ffmpeg", "-y", "-i", str(video_path), "-ac", "1", "-ar", "16000", "-vn", str(audio_path), "-loglevel", "error"])


def transcribe(audio_path, model_name):
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(audio_path), word_timestamps=True, language="en", vad_filter=True)

    words = []
    for seg in segments:
        if not seg.words:
            continue
        for w in seg.words:
            text = w.word.strip()
            if text:
                words.append({"word": text, "start": w.start, "end": w.end})
    return words, info


def build_cut_plan(words, total_duration, threshold, keep):
    """
    Decide which spans of the ORIGINAL timeline to keep, by shortening any gap
    between consecutive words (or before the first / after the last word) that
    exceeds `threshold` seconds down to `keep` seconds. Never touches a word
    itself — only dead air between them — so no spoken content is ever cut.
    Returns a list of (orig_start, orig_end) segments to keep, in order.
    """
    if not words:
        return [(0.0, total_duration)]

    keep_segments = []
    cursor = 0.0

    def flush_gap(gap_start, gap_end):
        gap_len = gap_end - gap_start
        if gap_len > threshold:
            # keep a small buffer of the gap on both ends for natural breathing room
            keep_segments.append((cursor, gap_start + keep / 2))
            return gap_end - keep / 2
        return cursor  # no change; caller keeps extending

    # leading silence before first word
    first_start = words[0]["start"]
    if first_start > threshold:
        keep_segments.append((0.0, min(first_start, keep)))
        cursor = first_start
    else:
        cursor = 0.0

    for i in range(len(words) - 1):
        gap_start = words[i]["end"]
        gap_end = words[i + 1]["start"]
        gap_len = gap_end - gap_start
        if gap_len > threshold:
            keep_segments.append((cursor, gap_start + keep / 2))
            cursor = gap_end - keep / 2

    # trailing silence after the last word
    last_end = words[-1]["end"]
    trailing = total_duration - last_end
    if trailing > threshold:
        keep_segments.append((cursor, last_end + keep / 2))
    else:
        keep_segments.append((cursor, total_duration))

    # merge any overlapping/adjacent segments defensively
    merged = []
    for seg in keep_segments:
        if merged and seg[0] <= merged[-1][1] + 0.01:
            merged[-1] = (merged[-1][0], max(merged[-1][1], seg[1]))
        else:
            merged.append(seg)
    return merged


def remap_word_times(words, keep_segments):
    """Shift each word's start/end onto the NEW (post-trim) timeline."""
    new_words = []
    offset = 0.0
    seg_idx = 0
    cum_removed = 0.0
    boundaries = []
    running = 0.0
    for seg_start, seg_end in keep_segments:
        boundaries.append((seg_start, seg_end, running))
        running += seg_end - seg_start

    def map_time(t):
        for seg_start, seg_end, new_offset in boundaries:
            if seg_start <= t <= seg_end:
                return new_offset + (t - seg_start)
        # fall back: clamp to nearest segment
        if t < boundaries[0][0]:
            return 0.0
        return boundaries[-1][2] + (boundaries[-1][1] - boundaries[-1][0])

    for w in words:
        new_words.append({"word": w["word"], "start": map_time(w["start"]), "end": map_time(w["end"])})
    return new_words


def trim_video(input_path, output_path, keep_segments):
    """Cut `keep_segments` out of input_path and concatenate them, re-encoding once."""
    select_parts = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in keep_segments)
    vf = f"select='{select_parts}',setpts=N/FRAME_RATE/TB"
    af = f"aselect='{select_parts}',asetpts=N/SR/TB"
    run([
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", vf, "-af", af,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(output_path), "-loglevel", "error",
    ])


def ass_time(t):
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def group_words_into_cards(words, max_chars=26, max_words=4):
    """Group consecutive words into short on-screen caption cards (Reels-style: a few words at a time)."""
    cards = []
    cur = []
    cur_len = 0
    for w in words:
        wl = len(w["word"]) + 1
        if cur and (cur_len + wl > max_chars or len(cur) >= max_words):
            cards.append(cur)
            cur, cur_len = [], 0
        cur.append(w)
        cur_len += wl
    if cur:
        cards.append(cur)
    return cards


def build_ass(words, out_path, video_w, video_h, font_size, margin_v, style):
    cards = group_words_into_cards(words)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,{font_size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,{max(3, font_size // 16)},1,2,40,40,{margin_v},1
Style: Hot,DejaVu Sans,{font_size},&H0046B8E7,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,{max(3, font_size // 16)},1,2,40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for card in cards:
        start = ass_time(card[0]["start"])
        end = ass_time(card[-1]["end"] + 0.05)
        if style == "karaoke":
            text = "".join(f"{{\\k{max(1, int(round((w['end'] - w['start']) * 100)))}}}" + w["word"].upper() + " " for w in card).strip()
            line = f"Dialogue: 0,{start},{end},Hot,,0,0,0,,{{\\fad(60,60)}}{text}"
        else:
            text = " ".join(w["word"].upper() for w in card)
            line = f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\fad(60,60)}}{text}"
        lines.append(line)
    out_path.write_text("\n".join(lines), encoding="utf-8")


def burn_captions(input_path, ass_path, output_path):
    ass_escaped = str(ass_path).replace("\\", "/").replace(":", "\\:")
    run([
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", f"ass={ass_escaped}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy",
        str(output_path), "-loglevel", "error",
    ])


def get_video_dims(path):
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", str(path)])
    w, h = r.stdout.strip().split("x")
    return int(w), int(h)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--no-trim", action="store_true")
    ap.add_argument("--trim-threshold", type=float, default=0.6)
    ap.add_argument("--trim-keep", type=float, default=0.12)
    ap.add_argument("--caption-style", choices=["bold-center", "karaoke"], default="bold-center")
    ap.add_argument("--font-size", type=int, default=64)
    ap.add_argument("--margin-v", type=int, default=180)
    ap.add_argument("--model", default="small")
    ap.add_argument("--keep-work-dir", action="store_true")
    args = ap.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    if not input_path.exists():
        print(f"Input not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    work_dir = Path(tempfile.mkdtemp(prefix="edit_reel_"))
    try:
        print(f"[1/5] Extracting audio...")
        audio_path = work_dir / "audio.wav"
        extract_audio(input_path, audio_path)

        print(f"[2/5] Transcribing (model={args.model})...")
        words, info = transcribe(audio_path, args.model)
        if not words:
            print("No speech detected — nothing to caption.", file=sys.stderr)
            sys.exit(1)
        print(f"      {len(words)} words, detected language: {info.language} (p={info.language_probability:.2f})")

        total_duration = ffprobe_duration(input_path)
        current_video = input_path

        if not args.no_trim:
            print(f"[3/5] Trimming dead air (gaps > {args.trim_threshold}s)...")
            keep_segments = build_cut_plan(words, total_duration, args.trim_threshold, args.trim_keep)
            removed = total_duration - sum(e - s for s, e in keep_segments)
            if removed > 0.05:
                trimmed_path = work_dir / "trimmed.mp4"
                trim_video(input_path, trimmed_path, keep_segments)
                words = remap_word_times(words, keep_segments)
                current_video = trimmed_path
                print(f"      Removed {removed:.1f}s of dead air across {len(keep_segments)-1} cut(s). New length: {total_duration - removed:.1f}s")
            else:
                print("      Nothing worth trimming.")
        else:
            print("[3/5] Skipping trim (--no-trim).")

        print("[4/5] Building styled captions...")
        w, h = get_video_dims(current_video)
        ass_path = work_dir / "captions.ass"
        build_ass(words, ass_path, w, h, args.font_size, args.margin_v, args.caption_style)

        print("[5/5] Burning captions into final video...")
        burn_captions(current_video, ass_path, output_path)

        print(f"\nDone: {output_path}")
    finally:
        if args.keep_work_dir:
            print(f"(work dir kept at {work_dir})")
        else:
            shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
