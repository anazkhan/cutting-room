import "dotenv/config";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const MODEL = "claude-opus-5";

// ---------------- storage ----------------

const EMPTY_STORE = { pipeline: [], scripts: [], swipe: [], newsdesk: [] };

async function loadStore() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    return { ...EMPTY_STORE, ...JSON.parse(raw) };
  } catch {
    return structuredClone(EMPTY_STORE);
  }
}

let store = await loadStore();
let saveQueue = Promise.resolve();

function persist() {
  saveQueue = saveQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
  });
  return saveQueue;
}

function newest(list) {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------- Claude client ----------------

// Always construct the client — the SDK resolves credentials itself, in order:
// ANTHROPIC_API_KEY -> ANTHROPIC_AUTH_TOKEN -> an active `ant auth login` OAuth
// profile -> a couple of enterprise-only fallbacks. So this also picks up a
// Claude Code / Pro-Max login on this machine with no key in .env at all.
// Construction never fails just because credentials are missing — only a real
// call does, so we surface that at call time instead of guessing upfront.
const client = new Anthropic();

function authErrorMessage(err) {
  const looksLikeAuthIssue =
    err instanceof Anthropic.AuthenticationError ||
    /authentication|api.?key|auth.?token/i.test(err.message || "");
  if (looksLikeAuthIssue) {
    return "No Claude credentials found. Either set ANTHROPIC_API_KEY in .env, or run `ant auth login` in your terminal to use your Claude Code / Pro-Max login — then restart the server.";
  }
  return err.message || "Something went wrong talking to Claude.";
}

function parseLenientJSON(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const start = Math.min(
    ...["{", "["].map((c) => (text.indexOf(c) === -1 ? Infinity : text.indexOf(c))),
  );
  const endBrace = text.lastIndexOf("}");
  const endBracket = text.lastIndexOf("]");
  const end = Math.max(endBrace, endBracket);
  if (Number.isFinite(start) && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  throw new Error("Could not find valid JSON in the model's reply.");
}

async function askClaude({ system, user, useWebTools }) {
  const tools = useWebTools
    ? [
        { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
      ]
    : undefined;

  let messages = [{ role: "user", content: user }];
  let response;
  for (let i = 0; i < 4; i++) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
      ...(tools ? { tools } : {}),
      messages,
    });
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude returned no text — try again.");
  return textBlock.text;
}

// ---------------- content-strategy prompt logic ----------------

const CREATOR_VOICE =
  "You are scripting a single-cut talking-head Instagram Reel for a solo founder. He is bad at memorizing long scripts, so break the topic into short, filmable single sentences. Voice: personal, energetic, a founder thinking out loud about AI, tech and startups, filming at home or on a walk — never corporate. He may be building a SaaS product called Yorki (a WhatsApp/website/Instagram sales assistant for Indian and GCC small businesses) — weave it in ONLY if the topic and context call for it, as a real story, never a pitch.";
const YORKI_VOICE =
  "You are scripting a single-cut talking-head or voiceover Reel for Yorki's official Instagram business account. Yorki is a sales-assistant SaaS for Indian and GCC small businesses: it answers customer questions on the business's website, Instagram and WhatsApp using RAG, classifies each lead hot/warm/cold, and notifies the owner on WhatsApp. Voice: professional, calm, proof-led — speaking to a small business owner who is skeptical of hype and short on time.";
const REPLY_SPEC =
  '\n\nReturn: a HOOK (one sentence, spoken straight to camera, must earn the first 2 seconds), 4 to 6 BEATS (each one simple complete sentence under about 15 words, plain conversational English, each filmable as its own single cut so a flubbed take only costs a reshoot of that one sentence), and a CTA (one closing sentence).\nReply with ONLY JSON in this exact shape: {"hook": string, "beats": string[], "cta": string}';
const MESSY_INPUT_NOTE =
  "\n\nNote: the user's own words below may be rough, broken, rambling, half-explained or out of order — often dictated by voice, not written. That is expected. Find the actual idea inside it and extract the core insight; do not treat grammar slips, false starts or disorganization as meaningful, and do not just lightly edit the phrasing — rebuild it as clean, confident, correct spoken sentences a viewer can follow.";

function buildBreakdownPrompt(account, mode, sourceText, context) {
  const voice = account === "creator" ? CREATOR_VOICE : YORKI_VOICE;
  let body;
  if (mode === "remix") {
    body =
      "\n\nThe user was inspired by another creator's Instagram Reel and wants to remix the IDEA in their own voice — never copy it. Here is what they captured about that reel (a caption, a transcript, or their own description of it):\n" +
      sourceText +
      (context ? "\n\nTheir angle — what this should become for them: " + context : "") +
      "\n\nStudy only the reel's structural pattern (its hook style, its pacing, how it builds) and write ENTIRELY NEW content on the user's own topic and in their own words — not a paraphrase of the source." +
      MESSY_INPUT_NOTE;
  } else if (mode === "news") {
    body =
      "\n\nThe user wants to turn a real news item or trending topic into an Instagram Reel — make it as interesting as possible, never a dry recap. Here is what they have so far:\n" +
      sourceText +
      (context ? "\n\nTheir angle — why this matters to them or their audience: " + context : "") +
      "\n\nFind the single most surprising, useful or high-stakes angle in it and build the hook around THAT, not the headline. Stay strictly factual to what is given here — do NOT invent statistics, quotes, dates or details that were not provided." +
      MESSY_INPUT_NOTE;
  } else {
    body = "\n\nTopic: " + sourceText + (context ? "\nContext to use: " + context : "") + MESSY_INPUT_NOTE;
  }
  return voice + body + REPLY_SPEC;
}

const RESEARCH_SYSTEM = `You are a research assistant for an Instagram content-ops tool. You investigate a topic or URL using web search and web fetch, and hand back a single verified, interesting story a founder can turn into a Reel.

Rules:
- If the input looks like a URL, fetch that exact page and base your answer on it.
- Otherwise, search for current, credible sources and pick the single most interesting, verifiable angle — prefer specific, recent, surprising stories over generic trend pieces.
- Do NOT invent facts, numbers, quotes, or dates that don't appear in a search result or fetched page. If you can't verify something, leave it out.
- Reply with ONLY a JSON object, no other text, in this exact shape:
{"headline": string, "sourceLink": string, "facts": string, "angle": string, "sources": [{"title": string, "url": string}]}
Where "sourceLink" is the real URL of your primary/best source, "facts" is 2-4 sentences of verified facts, "angle" is one sentence on why this could make a good Instagram Reel, and "sources" lists up to 4 other relevant sources you found (empty array if none).`;

// ---------------- app ----------------

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => {
  res.json({
    pipeline: newest(store.pipeline),
    scripts: newest(store.scripts),
    swipe: newest(store.swipe),
    newsdesk: newest(store.newsdesk),
  });
});

// ---- pipeline ----
app.post("/api/pipeline", async (req, res) => {
  const { title, account, pillar, status } = req.body || {};
  if (!title || !account) return res.status(400).json({ error: "invalid_argument", message: "title and account are required." });
  const item = { id: randomUUID(), title, account, pillar: pillar || "", status: status || "idea", createdAt: Date.now() };
  store.pipeline.push(item);
  await persist();
  res.status(201).json(item);
});

app.patch("/api/pipeline/:id", async (req, res) => {
  const item = store.pipeline.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "not_found" });
  if (req.body?.status) item.status = req.body.status;
  await persist();
  res.json(item);
});

app.delete("/api/pipeline/:id", async (req, res) => {
  store.pipeline = store.pipeline.filter((x) => x.id !== req.params.id);
  await persist();
  res.status(204).end();
});

// ---- swipe file ----
app.post("/api/swipe", async (req, res) => {
  const { handle, niche, note } = req.body || {};
  if (!handle) return res.status(400).json({ error: "invalid_argument", message: "handle is required." });
  const item = { id: randomUUID(), handle, niche: niche || "", note: note || "", createdAt: Date.now() };
  store.swipe.push(item);
  await persist();
  res.status(201).json(item);
});

app.delete("/api/swipe/:id", async (req, res) => {
  store.swipe = store.swipe.filter((x) => x.id !== req.params.id);
  await persist();
  res.status(204).end();
});

// ---- news desk ----
app.post("/api/newsdesk", async (req, res) => {
  const { headline, sourceLink, facts, angle } = req.body || {};
  if (!headline) return res.status(400).json({ error: "invalid_argument", message: "headline is required." });
  const item = {
    id: randomUUID(),
    headline,
    sourceLink: sourceLink || "",
    facts: facts || "",
    angle: angle || "",
    createdAt: Date.now(),
  };
  store.newsdesk.push(item);
  await persist();
  res.status(201).json(item);
});

app.delete("/api/newsdesk/:id", async (req, res) => {
  store.newsdesk = store.newsdesk.filter((x) => x.id !== req.params.id);
  await persist();
  res.status(204).end();
});

// The live research endpoint — this is the part that can't run inside a sandboxed
// artifact: a real server, so a real web_search / web_fetch call to Claude.
app.post("/api/research", async (req, res) => {
  const input = (req.body?.input || "").trim();
  if (!input) return res.status(400).json({ error: "invalid_argument", message: "input is required." });
  try {
    const text = await askClaude({ system: RESEARCH_SYSTEM, user: input, useWebTools: true });
    const data = parseLenientJSON(text);
    res.json({
      headline: String(data.headline || ""),
      sourceLink: String(data.sourceLink || ""),
      facts: String(data.facts || ""),
      angle: String(data.angle || ""),
      sources: Array.isArray(data.sources) ? data.sources.slice(0, 4) : [],
    });
  } catch (err) {
    console.error("research failed:", err);
    res.status(502).json({ error: "research_failed", message: authErrorMessage(err) });
  }
});

// ---- script studio ----
app.post("/api/breakdown", async (req, res) => {
  const { account, mode, topic, context } = req.body || {};
  if (!topic) return res.status(400).json({ error: "invalid_argument", message: "topic is required." });
  try {
    const prompt = buildBreakdownPrompt(account === "yorki" ? "yorki" : "creator", mode, topic, context || "");
    const text = await askClaude({ system: undefined, user: prompt, useWebTools: false });
    const data = parseLenientJSON(text);
    res.json({
      hook: String(data.hook || ""),
      beats: Array.isArray(data.beats) ? data.beats.map(String) : [],
      cta: String(data.cta || ""),
    });
  } catch (err) {
    console.error("breakdown failed:", err);
    res.status(502).json({ error: "breakdown_failed", message: authErrorMessage(err) });
  }
});

app.post("/api/scripts", async (req, res) => {
  const { topic, account, mode, sourceLink, hook, beats, cta } = req.body || {};
  if (!topic) return res.status(400).json({ error: "invalid_argument", message: "topic is required." });
  const item = {
    id: randomUUID(),
    topic,
    account: account === "yorki" ? "yorki" : "creator",
    mode: mode || "new",
    sourceLink: sourceLink || "",
    hook: hook || "",
    beats: Array.isArray(beats) ? beats : [],
    cta: cta || "",
    createdAt: Date.now(),
  };
  store.scripts.push(item);
  const pillarByAccount = { creator: "AI", yorki: "PA" };
  store.pipeline.push({
    id: randomUUID(),
    title: topic.length > 70 ? topic.slice(0, 67).trim() + "…" : topic,
    account: item.account,
    pillar: pillarByAccount[item.account],
    status: "scripted",
    createdAt: Date.now(),
  });
  await persist();
  res.status(201).json(item);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Cutting Room running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("No ANTHROPIC_API_KEY set — will try your `ant auth login` credentials instead. If neither is set up, Script Studio and News Desk research will show an error explaining how to fix it.");
  }
});
