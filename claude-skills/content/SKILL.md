---
name: content
description: >-
  Research a link or trending topic and add it as a verified, sourced story to the News Desk of "The Cutting Room" — the user's content-ops tool for the @anaz creator and Yorki Instagram accounts. Invoked explicitly as /content followed by a link or topic. Also trigger on natural-language equivalents like "add this to News Desk", "research this for the news desk", or a message starting with "news desk".
---

# /content — research and add to News Desk

The user runs a Claude Artifact called "The Cutting Room" (a content-ops tool for two Instagram accounts) at:

    https://claude.ai/code/artifact/d31d55ca-c7b2-48ea-a968-6b5435aaad7d

That artifact is sandboxed and can't fetch URLs or search the web itself — that's the whole reason this skill exists. When the user runs `/content <argument>`, the argument is a URL or a topic/keywords string they want turned into a real, verified News Desk entry, without the back-and-forth of them explaining what they want each time.

## What the two accounts care about

- **Creator (@anaz)**: personal account about AI, tech and startups, India/GCC-angled where possible.
- **Yorki (@yorki)**: a SaaS product — an AI sales assistant for Indian/GCC small businesses that answers customers via RAG on their website/Instagram/WhatsApp, scores leads hot/warm/cold, and notifies the owner on WhatsApp. Relevant news: AI customer service, WhatsApp commerce, lead-gen, SMB digitization.

Use this to judge whether a story is worth adding at all, and to write the "angle" field below — not to filter stories to only one account. A story can be relevant to either or both.

## Steps

1. **Read the argument.** If nothing was passed, ask the user what to research rather than guessing.

2. **Investigate for real.**
   - If the argument is a link to Instagram, TikTok, Facebook, X/Twitter, LinkedIn, or another platform that gates content behind a login (or if you try to fetch any URL and get a login wall, a bot-block page, or basically nothing) — **stop and ask the user to paste the caption, transcript, or their own description of what's in it**, instead of guessing at content you can't actually see. A reel/post link almost never fetches cleanly; pretending it did and inventing plausible-sounding content would be worse than admitting you can't reach it. Once they paste something, treat that pasted text as the source material and continue from step 3.
   - Otherwise, if it looks like a normal article/news URL, fetch that exact page and base the entry on it.
   - If it's a topic/keywords rather than a link, search for current, credible sources and pick the single most interesting, verifiable angle — a specific recent story beats a generic trend piece.
   - Stay strictly factual throughout: don't invent statistics, quotes, dates, or specifics that don't appear in what you actually read or were given. If what you found is thin, write a shorter, honest entry rather than padding it with invented detail.

3. **Check for duplicates before adding.** Read the artifact's existing News Desk entries first:
   - Artifact tool, `action: "read_db"`, `db_op: "list"`, `collection: "newsdesk"`, `url` as above.
   - If a very similar headline or topic already exists from roughly the last couple of weeks, tell the user that instead of adding a duplicate — don't add it silently, and don't add it anyway.

4. **Add the entry.** Artifact tool, `action: "write_db"`, `db_op: "set"`, `collection: "newsdesk"`, `url` as above, a fresh `doc_id` (e.g. `"story_" + current epoch milliseconds`, get the timestamp via Bash: `date +%s%3N`), and this `data` shape:
   - `headline` (string) — punchy and specific, not a generic category label
   - `sourceLink` (string) — the real URL you fetched or found, never a search-results page
   - `facts` (string) — the concrete, verified material a scriptwriter would actually want: real numbers, a real quote, a named example, a specific date — not a vague summary of the topic. This is the raw material Script Studio's News/Trending mode later builds a hook out of, so favor specifics over general coverage; there's no fixed length, but pad nothing — every sentence must be something you actually verified, not filler to make the entry look fuller.
   - `angle` (string) — one sentence on why this matters to the creator account, to Yorki, or both — say which
   - `createdAt` (number) — the epoch milliseconds from Bash

5. **Confirm briefly.** Tell the user the headline and a one-line summary of what you added (or, if you skipped it as a duplicate, say that and point to the existing entry). No need to reproduce the full facts back to them — they can see it in News Desk, and pull it into Script Studio from there whenever they're ready to script it.

## What this does and doesn't guarantee

News Desk stores researched material, not a finished script — the hook-and-beats script comes from a separate step (Script Studio's News/Trending mode, in the artifact), which works best when the facts here are concrete rather than generic. Nothing about this pipeline can promise a reel "goes viral" — that depends on delivery, editing, and timing, none of which this touches. What it can do is make sure the raw material has a genuinely sharp, specific, verified hook buried in it somewhere, instead of a vague paraphrase of a headline — that's the most any research step can contribute to the odds.
