
import { useState } from "react";
import type { AgentReadyUpdate } from "@/lib/media-analyser/api-types";
import type { CanonicalProduct, VisibilityScore, MeasurementReport, AgentSuggestion } from "@/lib/media-analyser/agent-ready/types";

const PHASES = [
  { key: "scraping", label: "Scrape" }, { key: "enrich-text", label: "Enrich·text" },
  { key: "enrich-vision", label: "Enrich·vision" }, { key: "schema", label: "Feeds" },
  { key: "score", label: "Score" }, { key: "measure", label: "Measure" },
] as const;

type Tab = "score" | "attributes" | "schema" | "measure" | "agent";

const gradeColor = (g: string) => g === "A" ? "text-emerald-600" : g === "B" ? "text-lime-600" : g === "C" ? "text-amber-600" : "text-red-500";
const statusDot = (s: string) => s === "pass" ? "bg-emerald-500" : s === "warn" ? "bg-amber-500" : "bg-red-500";

function Copyable({ label, obj }: { label: string; obj: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(obj, null, 2);
  return (
    <div className="rounded-lg border border-line overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 border-b border-line">
        <span className="text-[11px] font-semibold text-fg-mute">{label}</span>
        <button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className="text-[11px] text-accent hover:underline">{copied ? "Copied ✓" : "Copy"}</button>
      </div>
      <pre className="text-[11px] leading-relaxed p-3 overflow-auto max-h-80 bg-surface">{text}</pre>
    </div>
  );
}

export function AgentReady() {
  const [url, setUrl] = useState("");
  const [measure, setMeasure] = useState(true);
  const [running, setRunning] = useState(false);
  const [activePhase, setActivePhase] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState("");

  const [canonical, setCanonical] = useState<CanonicalProduct | null>(null);
  const [schemaOrg, setSchemaOrg] = useState<Record<string, unknown> | null>(null);
  const [agentFeed, setAgentFeed] = useState<Record<string, unknown> | null>(null);
  const [visibility, setVisibility] = useState<VisibilityScore | null>(null);
  const [measurement, setMeasurement] = useState<MeasurementReport | null>(null);
  const [tab, setTab] = useState<Tab>("score");

  // session catalog for the agent-facing query layer
  const [catalog, setCatalog] = useState<CanonicalProduct[]>([]);
  const [aq, setAq] = useState("");
  const [aqRunning, setAqRunning] = useState(false);
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  const [aqErr, setAqErr] = useState("");

  const runAudit = async () => {
    if (running || !url.trim()) return;
    setRunning(true); setErr(""); setLog([]); setActivePhase("scraping");
    setCanonical(null); setSchemaOrg(null); setAgentFeed(null); setVisibility(null); setMeasurement(null); setTab("score");
    try {
      const res = await fetch("/api/media-analyser/agent-ready-audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim(), measure }) });
      if (!res.ok || !res.body) { const e = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(e.error ?? "Request failed"); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      let finalCanonical: CanonicalProduct | null = null;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find(l => l.startsWith("data: ")); if (!line) continue;
          let u: AgentReadyUpdate; try { u = JSON.parse(line.slice(6)); } catch { continue; }
          if (u.phase === "error") { setErr(u.message ?? "Audit failed"); continue; }
          setActivePhase(u.phase);
          if (u.message) setLog(l => [...l, `${PHASES.find(x => x.key === u.phase)?.label ?? u.phase}: ${u.message}`]);
          if (u.canonical) { setCanonical(u.canonical); finalCanonical = u.canonical; }
          if (u.schemaOrg) setSchemaOrg(u.schemaOrg);
          if (u.agentFeed) setAgentFeed(u.agentFeed);
          if (u.visibility) setVisibility(u.visibility);
          if (u.measurement) setMeasurement(u.measurement);
        }
      }
      if (finalCanonical) setCatalog(c => [finalCanonical!, ...c.filter(x => x.sourceUrl !== finalCanonical!.sourceUrl)].slice(0, 20));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false); setActivePhase("");
    }
  };

  const askAgent = async () => {
    if (aqRunning || !aq.trim() || !catalog.length) return;
    setAqRunning(true); setAqErr(""); setSuggestion(null);
    try {
      const res = await fetch("/api/media-analyser/agent-ready-query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: aq.trim(), catalog }) });
      const data = (await res.json().catch(() => ({}))) as AgentSuggestion & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Query failed");
      setSuggestion(data);
    } catch (e) { setAqErr(String(e instanceof Error ? e.message : e)); }
    finally { setAqRunning(false); }
  };

  const canRun = !!url.trim() && !running;
  const hasOutput = !!visibility || !!canonical;
  const imgAttrs = canonical?.attributes.filter(a => a.source !== "text").length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-fg flex items-center gap-2 flex-wrap">Agent-Ready Commerce
          <span className="text-[10px] font-semibold text-accent bg-accent-soft px-1.5 py-0.5 rounded-full">data + agent + measurement</span>
        </h2>
        <p className="text-xs text-fg-dim mt-0.5">Make a product legible to AI shopping agents: scrape → enrich (text + image) → schema.org/agent-feed → an <b>Agent Visibility Score</b>, a before/after selection-rate test, and a live agent-query endpoint.</p>
      </div>

      {/* input */}
      <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={url} onChange={e => setUrl(e.target.value)} disabled={running} placeholder="Product URL (Amazon, Flipkart, Myntra, Nykaa, Croma, or brand site)"
            onKeyDown={e => { if (e.key === "Enter") runAudit(); }}
            className="flex-1 min-w-[260px] text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
          <label className="flex items-center gap-1.5 text-[11px] text-fg-mute select-none"><input type="checkbox" checked={measure} onChange={e => setMeasure(e.target.checked)} disabled={running} /> before/after test</label>
          <button onClick={runAudit} disabled={!canRun} className={`text-xs font-medium rounded-md px-4 py-2 ${!canRun ? "bg-surface-2 text-fg-mute cursor-not-allowed" : "bg-accent text-white hover:opacity-90"}`}>{running ? "Auditing…" : "Run audit"}</button>
        </div>
      </div>

      {/* progress */}
      {(running || log.length > 0) && (
        <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <div className="flex flex-wrap gap-1.5">{PHASES.map(p => {
            const done = log.some(l => l.startsWith(p.label)) && activePhase !== p.key;
            const active = activePhase === p.key;
            return <span key={p.key} className={`text-[10px] px-2 py-0.5 rounded-full border ${active ? "border-accent bg-accent-soft text-accent" : done ? "border-accent-2/40 bg-accent-2-soft text-accent-2" : "border-line text-fg-mute"}`}>{active && <span className="inline-block w-2 h-2 mr-1 border border-accent border-t-transparent rounded-full animate-spin align-middle" />}{p.label}</span>;
          })}</div>
          <pre className="text-[11px] leading-relaxed text-fg-dim whitespace-pre-wrap max-h-40 overflow-auto">{log.join("\n")}</pre>
        </div>
      )}

      {err && <p className="text-xs text-alert">⚠ {err}</p>}

      {/* output */}
      {hasOutput && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="flex flex-wrap gap-1 border-b border-line px-2 pt-2 bg-surface-2">
            {([["score", "Score"], ["attributes", "Canonical"], ["schema", "Feeds"], ["measure", "Measurement"], ["agent", "Agent API"]] as [Tab, string][]).map(([t, lbl]) => (
              <button key={t} onClick={() => setTab(t)} className={`text-[11px] px-3 py-1.5 rounded-t-md ${tab === t ? "bg-surface text-fg font-semibold border border-line border-b-transparent" : "text-fg-mute hover:text-fg"}`}>{lbl}</button>
            ))}
          </div>
          <div className="p-4">
            {/* SCORE */}
            {tab === "score" && visibility && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className={`text-4xl font-bold ${gradeColor(visibility.grade)}`}>{visibility.score}<span className="text-lg text-fg-mute">/100</span></div>
                  <div><div className={`text-lg font-bold ${gradeColor(visibility.grade)}`}>Grade {visibility.grade}</div><p className="text-[11px] text-fg-dim">{visibility.summary}</p></div>
                </div>
                <div className="space-y-2">{visibility.dimensions.map(d => (
                  <div key={d.key} className="text-xs">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${statusDot(d.status)}`} />{d.label}</span>
                      <span className="text-fg-mute">{d.score}/{d.max}</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full mt-1 overflow-hidden"><div className={`h-full ${statusDot(d.status)}`} style={{ width: `${(d.score / d.max) * 100}%` }} /></div>
                    {d.gap && <p className="text-[10.5px] text-fg-mute mt-0.5">{d.gap} <span className="text-accent">→ {d.fix}</span></p>}
                  </div>
                ))}</div>
              </div>
            )}

            {/* CANONICAL */}
            {tab === "attributes" && canonical && (
              <div className="space-y-3 text-xs">
                <p className="text-fg-dim">{canonical.title} {canonical.category && <span className="text-fg-mute">· {canonical.category}</span>} {canonical.price && <span className="text-fg-mute">· {canonical.price}</span>}</p>
                <div>
                  <p className="text-[11px] font-semibold text-fg-mute mb-1">Attributes ({canonical.attributes.length}, {imgAttrs} from images)</p>
                  <div className="flex flex-wrap gap-1.5">{canonical.attributes.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5">
                      <span className="font-medium text-fg">{a.key}:</span> <span className="text-fg-dim">{a.value}</span>
                      {a.source !== "text" && <span title="from image" className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
                    </span>
                  ))}</div>
                </div>
                {canonical.materials.length > 0 && <p><span className="font-semibold text-fg">Materials:</span> <span className="text-fg-dim">{canonical.materials.join(", ")}</span></p>}
                {canonical.colorway.length > 0 && <p><span className="font-semibold text-fg">Colourway:</span> <span className="text-fg-dim">{canonical.colorway.join(", ")}</span></p>}
                {canonical.sizing.availableSizes.length > 0 && <p><span className="font-semibold text-fg">Sizes ({canonical.sizing.system}):</span> <span className="text-fg-dim">{canonical.sizing.availableSizes.join(", ")}</span></p>}
                {canonical.useCaseTags.length > 0 && <p><span className="font-semibold text-fg">Use-cases:</span> <span className="text-fg-dim">{canonical.useCaseTags.join(", ")}</span></p>}
                {canonical.stylingContext.length > 0 && <p><span className="font-semibold text-fg">Styling context (image):</span> <span className="text-fg-dim">{canonical.stylingContext.join(", ")}</span></p>}
              </div>
            )}

            {/* FEEDS */}
            {tab === "schema" && (
              <div className="space-y-3">
                {schemaOrg && <Copyable label="schema.org/Product (JSON-LD)" obj={schemaOrg} />}
                {agentFeed && <Copyable label="Agent-commerce feed (draft · UCP/ACP/AP2 adapter)" obj={agentFeed} />}
              </div>
            )}

            {/* MEASUREMENT */}
            {tab === "measure" && (
              measurement ? (
                <div className="space-y-3 text-xs">
                  <div className="flex flex-wrap gap-4">
                    <div><div className="text-[10px] text-fg-mute uppercase">Selection rate</div><div className="text-lg font-bold text-fg">{measurement.preRate}% → <span className="text-emerald-600">{measurement.postRate}%</span> <span className={`text-sm ${measurement.deltaRate >= 0 ? "text-emerald-600" : "text-red-500"}`}>({measurement.deltaRate >= 0 ? "+" : ""}{measurement.deltaRate} pts)</span></div></div>
                    <div><div className="text-[10px] text-fg-mute uppercase">Avg confidence</div><div className="text-lg font-bold text-fg">{measurement.preAvgConfidence} → <span className="text-emerald-600">{measurement.postAvgConfidence}</span></div></div>
                  </div>
                  <div className="space-y-1.5">{measurement.rows.map((r, i) => (
                    <div key={i} className="rounded-md border border-line p-2">
                      <p className="text-fg">“{r.query}”</p>
                      <div className="flex gap-4 mt-1 text-[11px]">
                        <span className={r.pre.surfaced ? "text-emerald-600" : "text-red-500"}>pre: {r.pre.surfaced ? "surfaced" : "missed"} ({r.pre.confidence})</span>
                        <span className={r.post.surfaced ? "text-emerald-600" : "text-red-500"}>post: {r.post.surfaced ? "surfaced" : "missed"} ({r.post.confidence})</span>
                      </div>
                    </div>
                  ))}</div>
                  <p className="text-[10.5px] text-fg-mute">Methodology: identical queries run against a real LLM shopping agent (Gemini); only the product data changes (raw scrape vs enriched). A stand-in for live ChatGPT/Gemini Shopping selection.</p>
                </div>
              ) : <p className="text-xs text-fg-mute">Measurement was skipped for this run.</p>
            )}

            {/* AGENT API */}
            {tab === "agent" && (
              <div className="space-y-3 text-xs">
                <p className="text-fg-dim">Ask the decision layer for the best product across your session catalog ({catalog.length} enriched product{catalog.length === 1 ? "" : "s"}). This calls the same <code className="text-accent">POST /api/agent-ready/query</code> a shopping agent would.</p>
                <div className="flex gap-2">
                  <input value={aq} onChange={e => setAq(e.target.value)} disabled={aqRunning || !catalog.length} placeholder='e.g. "durable everyday bottle under $30 that keeps drinks cold"'
                    onKeyDown={e => { if (e.key === "Enter") askAgent(); }}
                    className="flex-1 text-xs rounded-md border border-line px-2 py-2 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50" />
                  <button onClick={askAgent} disabled={aqRunning || !aq.trim() || !catalog.length} className="text-xs font-medium rounded-md px-3 py-2 bg-accent text-white disabled:opacity-40">{aqRunning ? "Querying…" : "Ask agent"}</button>
                </div>
                {aqErr && <p className="text-alert">⚠ {aqErr}</p>}
                {suggestion && (
                  <div className="rounded-md border border-accent/30 bg-accent-soft/30 p-3 space-y-2">
                    <p className="text-fg">{suggestion.answer}</p>
                    {suggestion.best && <p className="text-[11px] text-fg-mute">Best match: <span className="text-fg font-medium">{suggestion.best.title}</span> · score {suggestion.best.score}</p>}
                    {suggestion.ranked.length > 1 && <div className="text-[11px] text-fg-mute">Ranked: {suggestion.ranked.slice(0, 5).map(r => `${r.title} (${r.score})`).join(" · ")}</div>}
                  </div>
                )}
                <Copyable label="curl — the agent-facing endpoint" obj={{ endpoint: "POST /api/agent-ready/query", body: { query: "<constraint>", catalog: "<CanonicalProduct[]>" } }} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
