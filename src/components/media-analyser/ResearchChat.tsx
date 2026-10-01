
import { useRef, useState, useEffect } from "react";

type ChatModel = "opus" | "fable";
interface GenImage { url: string; caption?: string }
interface Msg { role: "user" | "assistant"; content: string; sources?: { url: string; title: string }[]; images?: GenImage[]; status?: string }

const MODELS: { id: ChatModel; label: string; sub: string }[] = [
  { id: "opus", label: "Opus", sub: "claude-opus-5" },
  { id: "fable", label: "Fable", sub: "claude-fable-5-1" },
];

export function ResearchChat() {
  const [model, setModel] = useState<ChatModel>("opus");
  const [productUrl, setProductUrl] = useState("");
  const [prodCtx, setProdCtx] = useState("");
  const [prodLoadedUrl, setProdLoadedUrl] = useState("");
  const [prodTitle, setProdTitle] = useState("");
  const [prodLoading, setProdLoading] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  // Scrape the product once when a link is set (or changed), so the chat is grounded in it.
  const ensureProduct = async (): Promise<string> => {
    const url = productUrl.trim();
    if (!url) return "";
    if (prodLoadedUrl === url && prodCtx) return prodCtx;
    setProdLoading(true);
    try {
      const r = await fetch("/api/media-analyser/ugc-ads-fetch-product", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const d = (await r.json().catch(() => ({}))) as { title?: string; brand?: string; price?: string; description?: string; bullets?: string[]; error?: string };
      if (!r.ok) throw new Error(d.error || "Could not read that product page.");
      const ctx = [
        d.title && `Title: ${d.title}`,
        d.brand && `Brand: ${d.brand}`,
        d.price && `Price: ${d.price}`,
        d.description && `Description: ${String(d.description).slice(0, 800)}`,
        Array.isArray(d.bullets) && d.bullets.length ? `Key features:\n- ${d.bullets.slice(0, 10).join("\n- ")}` : "",
      ].filter(Boolean).join("\n");
      setProdCtx(ctx); setProdLoadedUrl(url); setProdTitle(d.title || d.brand || url);
      return ctx;
    } catch (e) {
      setErr(`Product link: ${e instanceof Error ? e.message : e} — chatting without scraped context (the bot can still web-fetch it).`);
      setProdLoadedUrl(url); setProdTitle(""); setProdCtx("");
      return "";
    } finally { setProdLoading(false); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setErr(""); setInput("");
    const needsProduct = !!productUrl.trim() && prodLoadedUrl !== productUrl.trim();
    const nextMsgs: Msg[] = [...msgs, { role: "user", content: text }, { role: "assistant", content: "", status: needsProduct ? "Reading the product…" : "Thinking…" }];
    setMsgs(nextMsgs);
    setBusy(true);
    const ctx = await ensureProduct();
    // Send prior turns + this user message; drop the empty assistant placeholder and any blanks.
    const payloadMsgs = [...msgs, { role: "user" as const, content: text }]
      .filter(m => m.content && m.content.trim())
      .map(m => ({ role: m.role, content: m.content }));
    try {
      const res = await fetch("/api/media-analyser/research-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payloadMsgs, model, productUrl: productUrl.trim(), productContext: ctx }),
      });
      if (!res.ok || !res.body) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "Request failed"); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      const patch = (fn: (m: Msg) => Msg) => setMsgs(cur => cur.map((m, i) => i === cur.length - 1 ? fn(m) : m));
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
          let ev: { type: string; text?: string; message?: string; items?: { url: string; title: string }[]; url?: string; caption?: string };
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === "text") patch(m => ({ ...m, content: m.content + (ev.text || ""), status: undefined }));
          else if (ev.type === "status") patch(m => ({ ...m, status: ev.text }));
          else if (ev.type === "image" && ev.url) patch(m => ({ ...m, images: [...(m.images || []), { url: ev.url!, caption: ev.caption }], status: undefined }));
          else if (ev.type === "sources") patch(m => ({ ...m, sources: [...(m.sources || []), ...(ev.items || [])].filter((s, i, a) => a.findIndex(x => x.url === s.url) === i) }));
          else if (ev.type === "error") { patch(m => ({ ...m, status: undefined })); setErr(ev.message || "Something went wrong"); }
        }
      }
      patch(m => ({ ...m, status: undefined }));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      setMsgs(cur => cur.map((m, i) => i === cur.length - 1 ? { ...m, status: undefined } : m));
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] min-h-[520px]">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-line">
        <div className="inline-flex rounded-md border border-line overflow-hidden text-[11px]">
          {MODELS.map(m => (
            <button key={m.id} type="button" onClick={() => setModel(m.id)} disabled={busy}
              className={`px-3 py-1.5 transition-colors disabled:opacity-50 ${model === m.id ? "bg-accent text-white" : "bg-surface text-fg-dim hover:bg-accent-soft/40"}`}>
              <span className="font-semibold">{m.label}</span> <span className={model === m.id ? "text-white/70" : "text-fg-mute"}>· {m.sub}</span>
            </button>
          ))}
        </div>
        <input value={productUrl} onChange={e => setProductUrl(e.target.value)} placeholder="Product / brand link (optional context)"
          className="flex-1 min-w-[200px] text-xs rounded-md border border-line px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40" />
        {msgs.length > 0 && <button onClick={() => { setMsgs([]); setErr(""); }} className="text-[11px] text-fg-mute border border-line rounded-md px-2.5 py-1.5 hover:bg-surface-2">New chat</button>}
      </div>

      {/* Product-context status */}
      {productUrl.trim() && (
        <div className="pt-2 text-[11px]">
          {prodLoading
            ? <span className="text-fg-mute inline-flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-accent/50 border-t-transparent rounded-full animate-spin" />Reading the product page…</span>
            : prodLoadedUrl === productUrl.trim()
              ? (prodCtx ? <span className="text-accent">✓ Product loaded{prodTitle ? `: ${prodTitle.slice(0, 70)}` : ""} — answers are grounded in it.</span>
                         : <span className="text-fg-mute">Couldn&apos;t scrape this link; the bot will web-fetch it as needed.</span>)
              : <span className="text-fg-mute">Product link set — it loads on your next message.</span>}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {msgs.length === 0 && (
          <div className="h-full grid place-items-center text-center px-6">
            <div className="max-w-md space-y-2">
              <p className="text-sm font-semibold text-fg">Research Chat</p>
              <p className="text-[13px] text-fg-dim leading-relaxed">Ask anything, or ask it to <b>generate images</b> — it can create posts, carousels and ad creatives with Seedream. Paste a product link above for context, then research its market/competitors or design visuals for it.</p>
              <div className="flex flex-wrap gap-2 justify-center pt-1">
                {["Create a 6-slide carousel for this product", "Design an Instagram ad creative for this", "Summarise recent reviews and sentiment"].map(s => (
                  <button key={s} onClick={() => setInput(s)} className="text-[11px] text-accent border border-accent/40 rounded-full px-3 py-1 hover:bg-accent-soft">{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${m.role === "user" ? "bg-accent text-white" : "bg-surface border border-line text-fg"}`}>
              {m.role === "assistant" && m.status && <p className="text-[11px] text-fg-mute flex items-center gap-1.5 mb-1"><span className="w-3 h-3 border-2 border-accent/50 border-t-transparent rounded-full animate-spin" />{m.status}</p>}
              {m.content
                ? m.role === "assistant"
                  ? <div className="prose-chat" dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
                  : <span className="whitespace-pre-wrap">{m.content}</span>
                : (!m.status && !(m.images && m.images.length) && <span className="text-fg-mute">…</span>)}
              {m.images && m.images.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {m.images.map((im, j) => (
                    <a key={j} href={im.url} target="_blank" rel="noreferrer" className="block group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.url} alt={im.caption || `Generated image ${j + 1}`} className="w-full rounded-lg border border-line bg-black object-cover" />
                      {im.caption && <span className="block text-[10px] text-fg-mute mt-0.5 leading-snug">{im.caption}</span>}
                    </a>
                  ))}
                </div>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="mt-2 pt-2 border-t border-line/70">
                  <p className="text-[10px] uppercase tracking-wide text-fg-mute mb-1">Sources</p>
                  <div className="flex flex-col gap-0.5">
                    {m.sources.slice(0, 12).map((s, j) => (
                      <a key={j} href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline truncate">{j + 1}. {s.title}</a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {err && <p className="text-xs text-alert pb-2">⚠ {err}</p>}

      {/* Composer */}
      <div className="border-t border-line pt-3 flex items-end gap-2">
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={1} disabled={busy}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`Ask ${model === "opus" ? "Opus 5" : "Fable 5.1"} to research something…`}
          className="flex-1 resize-none text-[13px] rounded-lg border border-line px-3 py-2.5 max-h-40 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
        <button onClick={send} disabled={busy || !input.trim()} className="text-xs font-medium text-white bg-accent rounded-lg px-4 py-2.5 disabled:opacity-40">{busy ? "…" : "Send"}</button>
      </div>
    </div>
  );
}

/** Minimal, safe Markdown → HTML for chat (headings, bold, italic, inline code, code blocks, links, lists). */
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const out: string[] = []; let inList = false, inCode = false; const code: string[] = [];
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of md.split("\n")) {
    if (raw.trim().startsWith("```")) {
      if (inCode) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code.length = 0; inCode = false; } else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { code.push(raw); continue; }
    const line = raw.trimEnd(); let m: RegExpMatchArray | null;
    if (!line.trim()) { closeList(); continue; }
    if ((m = line.match(/^#{1,3}\s+(.*)/))) { closeList(); out.push(`<h4>${inline(m[1])}</h4>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(m[1])}</li>`); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  if (inCode && code.length) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  closeList();
  return out.join("");
}
