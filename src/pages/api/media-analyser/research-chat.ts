/** Research Chat — a research chatbot that can also GENERATE IMAGES. Streams SSE.
 *
 *  TEMPORARY (demo): the LLM is routed through the OpenAI API (default gpt-4o) because the
 *  Anthropic org is over its usage cap and Gemini/OpenRouter are out of credit. On top of plain
 *  chat, the model has a `generate_image` tool: when the user asks to create/design an image,
 *  carousel, ad creative or mockup, the model calls it and the server renders the image with
 *  ByteDance Seedream (ARK → FAL fallback) and streams it back inline.
 *  Revert to the Anthropic path (with native web_search/web_fetch) once the ANTHROPIC_API_KEY
 *  workspace limit is raised. */
import type { NextApiRequest, NextApiResponse } from "next";
import { generateImageWithNanoBananaPro } from "@/lib/media-analyser/fal";
import { researchTopic, firecrawlScrape } from "@/lib/media-analyser/ugc-new/research";

export const config = { maxDuration: 300 };

export type ChatModel = "opus" | "fable";
interface ChatMsg { role: "user" | "assistant"; content: string }

type Aspect = "9:16" | "1:1" | "16:9" | "4:5";

const SYSTEM = (productUrl: string, productContext: string) => [
  "You are a sharp, helpful research + creative assistant embedded in an e-commerce intelligence app.",
  "Think it through, be accurate and concrete, and format cleanly in Markdown. Be honest about uncertainty.",
  "You have LIVE WEB ACCESS via tools: web_search (search the web) and web_fetch (read a URL). For ANYTHING factual, time-sensitive, competitive, or about a specific product/brand/company — reviews, sentiment, competitors, pricing, market — you MUST web_search first (and web_fetch the best results to read them) BEFORE answering. NEVER say you lack real-time access, and NEVER invent competitors, reviews, or numbers — if you don't know, search. Cite the sources you used inline.",
  "You can also GENERATE REAL IMAGES with the generate_image tool (a Seedream image model). When the user asks to create/design/generate an image, carousel, ad creative, post, mockup or any visual, CALL generate_image — once per image (e.g. 4-6 calls for a carousel). Write a rich, self-contained prompt for each (subject, scene, style, composition, lighting) plus a short caption, then briefly summarise. Do NOT just describe images in text when the user wants them made — actually call the tool.",
  productContext
    ? `\n\nPRODUCT CONTEXT — the user is chatting about this specific product. Treat these scraped details as ground truth for the product itself, and web_search to go deeper (reviews, competitors, pricing, market):\n${productContext}${productUrl ? `\nProduct URL: ${productUrl}` : ""}`
    : (productUrl ? `\n\nThe user is working with this link: ${productUrl} — web_fetch it when relevant.` : ""),
].filter(Boolean).join(" ");

const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the LIVE web for up-to-date information (reviews, sentiment, competitors, pricing, market, news). Returns ranked results with titles, URLs and snippets. Use this BEFORE answering anything factual, competitive or time-sensitive — never guess or fabricate.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "A focused search query." } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch and read the full text of a specific URL (e.g. a promising web_search result, a review page, or the product page). Use to read details before summarising.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "An http(s) URL to read." } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate ONE real image with the Seedream image model. Call once per image (call it multiple times for a carousel/set). Returns the rendered image to the user automatically.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed, self-contained image prompt: subject, scene, style, composition, lighting, mood. Include the product/brand when relevant." },
          caption: { type: "string", description: "Short caption/label shown under the image (e.g. the slide headline)." },
          aspect: { type: "string", enum: ["9:16", "1:1", "16:9", "4:5"], description: "Aspect ratio. Default 1:1; use 9:16 for stories/reels, 4:5 for feed posts." },
        },
        required: ["prompt"],
      },
    },
  },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const key = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!key) return res.status(500).json({ error: "OPENAI_API_KEY is not configured (temporary demo routing)." });
  const falKey = process.env.FAL_KEY ?? "";

  const body = (req.body ?? {}) as { messages?: ChatMsg[]; model?: ChatModel; productUrl?: string; productContext?: string };
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-24)
    .map(m => ({ role: m.role, content: m.content }));
  if (!history.length) return res.status(400).json({ error: "No message." });
  const productUrl = String(body.productUrl ?? "").trim().slice(0, 500);
  const productContext = String(body.productContext ?? "").trim().slice(0, 4000);
  const model = (process.env.OPENAI_MODEL || "gpt-4o").trim();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("Connection", "keep-alive");

  const send = (o: unknown) => { res.write(`data: ${JSON.stringify(o)}\n\n`); };

  // Accumulator for a streamed tool_call (arguments arrive in fragments across chunks).
  interface AccToolCall { id: string; name: string; args: string }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: "system", content: SYSTEM(productUrl, productContext) }, ...history];
    let imagesMade = 0;

    for (let round = 0; round < 7; round++) {
      const fetchRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 4000, stream: true, messages, tools: TOOLS, tool_choice: "auto" }),
        signal: AbortSignal.timeout(700_000),
      });
      if (!fetchRes.ok || !fetchRes.body) {
        const errTxt = (await fetchRes.text().catch(() => "")).slice(0, 300);
        throw new Error(`OpenAI HTTP ${fetchRes.status}: ${errTxt}`);
      }

      const reader = fetchRes.body.getReader(); const dec = new TextDecoder();
      let buf = "", assistantText = "", finish = "";
      const toolAcc = new Map<number, AccToolCall>();
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop() ?? "";
        for (const line of parts) {
          const t = line.trim(); if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim(); if (!payload || payload === "[DONE]") continue;
          let ev: Record<string, unknown>; try { ev = JSON.parse(payload); } catch { continue; }
          const choice = (ev.choices as { delta?: Record<string, unknown>; finish_reason?: string }[] | undefined)?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finish = choice.finish_reason;
          const delta = choice.delta ?? {};
          if (typeof delta.content === "string" && delta.content) { assistantText += delta.content; send({ type: "text", text: delta.content }); }
          const tcs = delta.tool_calls as { index: number; id?: string; function?: { name?: string; arguments?: string } }[] | undefined;
          if (Array.isArray(tcs)) {
            for (const tc of tcs) {
              const acc = toolAcc.get(tc.index) ?? { id: "", name: "", args: "" };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
              toolAcc.set(tc.index, acc);
            }
          }
        }
      }

      // No tool calls → the model gave its final answer; we're done.
      if (finish !== "tool_calls" || toolAcc.size === 0) { send({ type: "done" }); res.end(); return; }

      // Record the assistant turn (with its tool calls) so results can be attached.
      const calls = [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
      messages.push({
        role: "assistant",
        content: assistantText || null,
        tool_calls: calls.map(c => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })),
      });

      // Execute each generate_image call → render on Seedream, stream the image back.
      for (const c of calls) {
        let toolResult = "done";
        if (c.name === "web_search") {
          let query = ""; try { query = String((JSON.parse(c.args || "{}") as { query?: string }).query ?? "").trim(); } catch { /* bad args */ }
          if (!query) toolResult = "No search query provided.";
          else {
            send({ type: "status", text: `Searching the web: ${query.slice(0, 50)}…` });
            const sources = await researchTopic(query, 5, 0);
            if (sources.length) {
              const items = sources.filter(s => s.url).map(s => ({ url: s.url as string, title: s.title || (s.url as string) }));
              if (items.length) send({ type: "sources", items });
              toolResult = sources.map((s, i) => `[${i + 1}] ${s.title ?? ""}\n${s.url ?? ""}\n${s.snippet ?? ""}`).join("\n\n").slice(0, 4000);
            } else toolResult = "No results found.";
          }
        } else if (c.name === "web_fetch") {
          let url = ""; try { url = String((JSON.parse(c.args || "{}") as { url?: string }).url ?? "").trim(); } catch { /* bad args */ }
          if (!/^https?:\/\//i.test(url)) toolResult = "Invalid or missing URL.";
          else {
            send({ type: "status", text: `Reading ${url.slice(0, 60)}…` });
            const md = await firecrawlScrape(url);
            toolResult = md ? md.slice(0, 6000) : "Could not read that page.";
          }
        } else if (c.name === "generate_image") {
          let prompt = "", caption = "", aspect: Aspect = "1:1";
          try { const a = JSON.parse(c.args || "{}") as { prompt?: string; caption?: string; aspect?: Aspect }; prompt = String(a.prompt ?? "").trim(); caption = String(a.caption ?? "").trim(); if (a.aspect) aspect = a.aspect; } catch { /* bad args */ }
          if (!falKey) { toolResult = "Image generation unavailable (FAL_KEY not configured)."; send({ type: "status", text: toolResult }); }
          else if (!prompt) { toolResult = "No prompt provided."; }
          else if (imagesMade >= 8) { toolResult = "Image limit reached for this message."; }
          else {
            send({ type: "status", text: `Generating image on Seedance/Seedream…${caption ? ` (${caption.slice(0, 40)})` : ""}` });
            try {
              const img = await generateImageWithNanoBananaPro(falKey, prompt, { aspect, provider: "ark" });
              imagesMade++;
              send({ type: "image", url: img.url, caption, prompt });
              toolResult = `Image generated and shown to the user${caption ? ` (caption: ${caption})` : ""}.`;
            } catch (e) {
              toolResult = `Image generation failed: ${e instanceof Error ? e.message : e}`;
              send({ type: "status", text: toolResult });
            }
          }
        }
        messages.push({ role: "tool", tool_call_id: c.id, content: toolResult });
      }
      // loop again so the model can summarise / continue after the images
    }
    send({ type: "done" });
  } catch (e) {
    send({ type: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
  return;
}
