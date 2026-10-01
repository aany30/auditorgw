/**
 * Claude Cohort Studio · Pen-Portrait dashboard.
 *
 * Turns a selected persona (+ brand analysis + cohort) into a rich single-page
 * "World + Persona" board — the same payload that then feeds script → video.
 * `PEN_SYSTEM` + `penUser()` drive the LLM (Fable); `renderPenPortraitHtml()`
 * renders the returned data as a self-contained HTML document (used in an
 * isolated iframe in the UI, and downloadable).
 */
import type { BrandAnalysis, Cohort, CohortPersona } from "./cohort-studio";

export interface PenPortrait {
  tag: string;
  title: string;
  tagline: string;
  heroQuote: string;
  glance: Record<string, string>;
  glanceQuote: string;
  look: { nanoBanana: string; seedream: string; poses: string[]; wardrobe: string[]; note: string };
  world: { motto: string; scenes: { label: string; caption: string }[]; facts: Record<string, string> };
  brands: Record<string, string[]>;
  interests: string[];
  media: Record<string, string>;
  decides: { careAbout: string; dontCareAbout: string; research: string; keyQuestions: string[] };
  day: { time: string; activity: string }[];
  tensions: { title: string; detail: string }[];
  means: { quote: string; checklist: string[]; productShot: string; productLine: string; signoff: string };
  footerWords: string[];
}

export const PEN_SYSTEM = `You are a consumer-insight strategist building a rich single-page PEN PORTRAIT DASHBOARD for a UGC/creative team, in a fixed house format. Ground everything in the brand facts and the persona given. Be vivid and specific to the target market (real cities, brands, apps, occasions — never generic). Return ONE minified JSON object EXACTLY in this shape (no markdown, no code fences, no commentary):
{
 "tag":"PEN PORTRAIT · <COHORT NAME, UPPERCASE>",
 "title":"The <2-4 word archetype name>",
 "tagline":"<one-line subtitle>",
 "heroQuote":"<a vivid first-person quote, ~15-25 words>",
 "glance":{"Name":"","Age":"","Location":"","Occupation":"","Family":"","Income":"","Home":"","Life stage":""},
 "glanceQuote":"<a short first-person quote about the category>",
 "look":{"nanoBanana":"<flowing Nano Banana image prompt paragraph with the product visible, ends with aspect ratio in words>","seedream":"<dense comma-separated Seedream prompt, ends with 4K, --ar 4:5>","poses":["Front · hero portrait","Side","Candid"],"wardrobe":["","","","",""],"note":"<one line on look/quality ethos>"},
 "world":{"motto":"<short motto>","scenes":[{"label":"","caption":""},{"label":"","caption":""},{"label":"","caption":""},{"label":"","caption":""}],"facts":{"Setting":"","Home":"","Kit / context":"","Occasions":""}},
 "brands":{"Tech & devices":["","",""],"Home & lifestyle":["","",""],"Fashion":["","",""],"Car":["",""],"Travel & leisure":["","",""],"Reading & wellness":["","",""]},
 "interests":["","","","","","","","",""],
 "media":{"Instagram":"","YouTube":"","WhatsApp":"","Google":"","Print":"","Streaming":""},
 "decides":{"careAbout":"","dontCareAbout":"","research":"","keyQuestions":["","",""]},
 "day":[{"time":"","activity":""},{"time":"","activity":""},{"time":"","activity":""},{"time":"","activity":""},{"time":"","activity":""},{"time":"","activity":""},{"time":"","activity":""}],
 "tensions":[{"title":"","detail":""},{"title":"","detail":""},{"title":"","detail":""},{"title":"","detail":""},{"title":"","detail":""}],
 "means":{"quote":"<what the brand means to them, first person>","checklist":["","","","",""],"productShot":"<one-line product-shot image prompt>","productLine":"<product line + where it lives in their life>","signoff":"<2-line sign-off separated by ' / '>"},
 "footerWords":["","",""]
}
Fill EVERY field. brands = real brands that fit this persona and market. Keep list items short (1-4 words). day = a realistic timeline with a brand-usage moment.`;

export function penUser(p: { analysis: BrandAnalysis; cohort: Cohort; persona: CohortPersona; country?: string; findings?: string }): string {
  const a = p.analysis;
  const market = (p.country && p.country.trim()) || a.targetAudience || "the brand's primary market";
  return [
    `BRAND: ${a.brandName} — ${a.products}`,
    `VISUAL IDENTITY: ${a.brandImage}`,
    `FEATURES: ${(a.features || []).join(" | ")}`,
    `TARGET MARKET: ${market}`,
    ``,
    `COHORT: ${p.cohort.name} — ${p.cohort.description}`,
    `PERSONA: ${p.persona.name} · ${[p.persona.gender, p.persona.ageRange, p.persona.ethnicity].filter(Boolean).join(", ")}`,
    `Description: ${p.persona.description}`,
    `Concern: ${p.persona.concern}`,
    `Angle: ${p.persona.angle}`,
    p.persona.traits ? `Casting traits: ${p.persona.traits}` : "",
    p.findings ? `\nREAL REVIEW FINDINGS (ground the tensions, decisions and what-the-brand-means):\n${p.findings.slice(0, 4000)}` : "",
    `\nBuild the full pen-portrait dashboard JSON now, authentic to ${market}.`,
  ].filter(Boolean).join("\n");
}

// ── HTML render (self-contained document for iframe / download) ───────────────
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pron = (gender?: string) => {
  const g = (gender || "").toLowerCase();
  if (g.startsWith("f") || g.includes("woman") || g.includes("female")) return { subj: "she", obj: "her", poss: "her", Poss: "Her" };
  if (g.startsWith("m") || g.includes("man") || g.includes("male")) return { subj: "he", obj: "him", poss: "his", Poss: "His" };
  return { subj: "they", obj: "them", poss: "their", Poss: "Their" };
};

export function renderPenPortraitHtml(d: PenPortrait, opts?: { brand?: string; productSub?: string; gender?: string }): string {
  const P = pron(opts?.gender);
  const brand = (opts?.brand || "BRAND").toUpperCase();
  const productSub = opts?.productSub || "";
  const tile = (label: string, cap?: string, h = 120) =>
    `<figure class="tile" style="--h:${h}px"><span class="tileLabel">${esc(label)}</span></figure>${cap ? `<p class="cap">${esc(cap)}</p>` : ""}`;
  const chip = (t: string) => `<span class="chip">${esc(t)}</span>`;
  const glance = d.glance || {};
  const glanceRows = Object.entries(glance).map(([k, v]) => `<div class="gRow"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  const brandRows = Object.entries(d.brands || {}).map(([k, v]) => `<div class="bRow"><span class="bCat">${esc(k)}</span><span class="bChips">${(v || []).map(chip).join("")}</span></div>`).join("");
  const mediaRows = Object.entries(d.media || {}).map(([k, v]) => `<div class="mRow"><span class="mK">${esc(k)}</span><span class="mV">${esc(v)}</span></div>`).join("");
  const dayRows = (d.day || []).map(x => `<div class="dRow"><span class="dT">${esc(x.time)}</span><span class="dA">${esc(x.activity)}</span></div>`).join("");
  const tensionRows = (d.tensions || []).map(x => `<div class="tItem"><span class="tDot"></span><div><b>${esc(x.title)}</b><p>${esc(x.detail)}</p></div></div>`).join("");
  const interestTiles = (d.interests || []).map(t => tile(t, "", 92)).join("");
  const worldScenes = (d.world?.scenes || []).map(s => tile(s.label, s.caption, 96)).join("");
  const worldFacts = Object.entries(d.world?.facts || {}).map(([k, v]) => `<div class="wFact"><b>${esc(k)}.</b> ${esc(v)}</div>`).join("");
  const wardrobe = (d.look?.wardrobe || []).map(chip).join("");
  const checklist = (d.means?.checklist || []).map(c => `<li>${esc(c)}</li>`).join("");
  const igFeed = Array.from({ length: 8 }, () => `<span class="igCell"></span>`).join("");
  const keyQ = (d.decides?.keyQuestions || []).map(q => `<li>${esc(q)}</li>`).join("");
  const poseTiles = (d.look?.poses || ["Front · hero portrait", "Side", "Candid"]).map(p => tile(p, "", 96)).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.title)} — ${esc(brand)} pen portrait</title>
<style>
  :root{--dgreen:#153025;--dgreen2:#1d3d2e;--mid:#2f6146;--sage:#e7efe7;--sage2:#dde8dd;--paper:#f4f7f2;--ink:#182219;--muted:#5c6b60;--copper:#b26a2c;--gold:#c6a24b;--line:#cdd8cd}
  *{box-sizing:border-box}
  body{margin:0;background:#e9eee8;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.45}
  .board{max-width:1240px;margin:0 auto;background:var(--paper)}
  .hd{background:linear-gradient(135deg,var(--dgreen),var(--dgreen2));color:#eaf2ea;padding:26px 32px;display:grid;grid-template-columns:1.6fr 1fr;gap:24px;align-items:start}
  .eyebrow{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);font-weight:700}
  .hTitle{font-family:Georgia,"Times New Roman",serif;font-size:40px;line-height:1.02;margin:8px 0 6px;font-weight:700;text-wrap:balance}
  .hTag{font-size:13.5px;color:#c9d8c9;max-width:52ch}
  .hRight{border-left:2px solid rgba(198,162,75,.5);padding-left:18px}
  .hQuote{font-family:Georgia,serif;font-style:italic;font-size:15px;color:#e6efe6}
  .mark{font-family:Georgia,serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-align:right;color:#fff;margin-bottom:2px}
  .markSub{font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);text-align:right}
  .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px;padding:18px}
  .card{background:#fff;border:1px solid var(--line);border-radius:5px;padding:14px 15px;grid-column:span 4;min-width:0}
  .cNum{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mid);border-bottom:1px solid var(--sage2);padding-bottom:7px;margin-bottom:11px;width:100%}
  .cNum b{background:var(--mid);color:#fff;width:19px;height:19px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none}
  .gRow{display:grid;grid-template-columns:80px 1fr;gap:8px;padding:3px 0;font-size:12.5px;border-bottom:1px dotted #e3e9e3}
  .gRow dt{color:var(--muted);font-weight:600;margin:0}.gRow dd{margin:0}
  .pull{font-family:Georgia,serif;font-style:italic;color:var(--mid);font-size:13.5px;margin-top:11px;border-left:3px solid var(--gold);padding-left:10px}
  .tile{margin:0;height:var(--h);border-radius:4px;position:relative;overflow:hidden;background:linear-gradient(135deg,#cfe0cf,#a9c6ac);background-image:linear-gradient(135deg,#cfe0cf,#a9c6ac),repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 8px,transparent 8px 16px);background-blend-mode:overlay}
  .tileLabel{position:absolute;left:8px;bottom:8px;background:var(--dgreen);color:#eaf2ea;font-size:10px;font-weight:700;padding:3px 7px;border-radius:3px;max-width:88%}
  .cap{font-size:10.5px;color:var(--muted);margin:5px 0 10px;line-height:1.35}
  .tiles3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .tiles2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .promptBox{background:var(--sage);border:1px solid var(--line);border-radius:4px;padding:9px 10px;font-size:10.5px;color:#2b3a2e;margin-bottom:9px}
  .promptBox b{display:block;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--copper);margin-bottom:3px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{background:var(--sage);border:1px solid var(--line);border-radius:3px;padding:3px 8px;font-size:11px;font-weight:600;color:#2b3a2e}
  .subLabel{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:11px 0 6px;font-weight:700}
  .note{font-size:11px;color:var(--muted);margin-top:9px;font-style:italic}
  .wFact{font-size:11.5px;margin-top:7px}.wFact b{color:var(--mid)}
  .motto{font-family:Georgia,serif;font-style:italic;color:var(--dgreen);font-size:14px;margin:2px 0 10px}
  .bRow{display:grid;grid-template-columns:104px 1fr;gap:8px;align-items:start;padding:5px 0;border-bottom:1px dotted #e3e9e3}
  .bCat{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding-top:3px}
  .bChips{display:flex;flex-wrap:wrap;gap:6px}
  .media{display:grid;grid-template-columns:1fr 96px;gap:12px}
  .mRow{display:grid;grid-template-columns:76px 1fr;gap:8px;font-size:11.5px;padding:4px 0;border-bottom:1px dotted #e3e9e3}
  .mK{font-weight:700;color:var(--mid)}
  .igLabel{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:6px}
  .igFeed{display:grid;grid-template-columns:1fr 1fr;gap:4px;border:2px solid var(--dgreen);border-radius:8px;padding:5px}
  .igCell{aspect-ratio:1;border-radius:2px;background:linear-gradient(135deg,#cfe0cf,#a9c6ac)}
  .dec{font-size:12px;margin:7px 0}.dec b{color:var(--mid)}
  .decList{margin:6px 0 0;padding-left:18px;font-size:12px}.decList li{margin:3px 0}
  .dRow{display:grid;grid-template-columns:66px 1fr;gap:10px;font-size:12px;padding:5px 0;border-bottom:1px dotted #e3e9e3}
  .dT{font-weight:700;color:var(--copper);font-variant-numeric:tabular-nums}
  .tItem{display:grid;grid-template-columns:14px 1fr;gap:9px;margin:9px 0;font-size:12px}
  .tItem b{color:var(--ink)}.tItem p{margin:2px 0 0;color:var(--muted);font-size:11.5px}
  .tDot{width:9px;height:9px;border-radius:50%;background:var(--copper);margin-top:4px}
  .means{grid-column:span 12;background:linear-gradient(135deg,var(--dgreen),var(--dgreen2));color:#eaf2ea;border:none;display:grid;grid-template-columns:1.3fr 1fr;gap:22px}
  .means .cNum{color:var(--gold);border-color:rgba(198,162,75,.35)}
  .means .cNum b{background:var(--gold);color:var(--dgreen)}
  .mQuote{font-family:Georgia,serif;font-style:italic;font-size:16px;line-height:1.4;margin:2px 0 14px}
  .check{list-style:none;margin:0;padding:0}
  .check li{position:relative;padding-left:24px;margin:8px 0;font-size:13px}
  .check li::before{content:"✓";position:absolute;left:0;top:0;color:var(--dgreen);background:var(--gold);width:17px;height:17px;border-radius:50%;font-size:11px;display:flex;align-items:center;justify-content:center;font-weight:800}
  .prodCard{background:rgba(255,255,255,.06);border:1px solid rgba(198,162,75,.3);border-radius:5px;padding:12px}
  .prodShot{font-size:11px;color:#cfe0cf;font-style:italic;margin-bottom:8px}
  .prodLine{font-size:11px;font-weight:700;letter-spacing:.03em;border-top:1px solid rgba(198,162,75,.3);padding-top:8px;color:#fff}
  .signoff{font-family:Georgia,serif;font-size:19px;line-height:1.25;margin-top:14px;color:#fff}
  .foot{background:var(--dgreen);color:var(--gold);display:flex;gap:24px;justify-content:center;padding:13px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:700;flex-wrap:wrap}
  @media(max-width:820px){.hd{grid-template-columns:1fr}.hRight{border-left:none;border-top:2px solid rgba(198,162,75,.5);padding:14px 0 0}.mark,.markSub{text-align:left}.grid{grid-template-columns:1fr}.card,.means{grid-column:auto}.means,.media{grid-template-columns:1fr}.hTitle{font-size:30px}}
</style></head><body>
<div class="board">
  <header class="hd">
    <div><div class="eyebrow">${esc(d.tag)}</div><h1 class="hTitle">${esc(d.title)}</h1><p class="hTag">${esc(d.tagline)}</p></div>
    <div class="hRight"><div class="mark">${esc(brand)}</div><div class="markSub">${esc(productSub)}</div><p class="hQuote">“${esc(d.heroQuote)}”</p></div>
  </header>
  <div class="grid">
    <section class="card"><div class="cNum"><b>1</b> At a glance</div><dl style="margin:0">${glanceRows}</dl><p class="pull">“${esc(d.glanceQuote)}”</p></section>
    <section class="card"><div class="cNum"><b>2</b> What ${P.subj} looks like</div><div class="promptBox"><b>Nano Banana prompt</b>${esc(d.look?.nanoBanana)}</div><div class="promptBox"><b>Seedream prompt</b>${esc(d.look?.seedream)}</div><div class="tiles3">${poseTiles}</div><div class="subLabel">Style &amp; wardrobe</div><div class="chips">${wardrobe}</div><p class="note">${esc(d.look?.note)}</p></section>
    <section class="card"><div class="cNum"><b>3</b> ${P.Poss} world</div><p class="motto">“${esc(d.world?.motto)}”</p><div class="tiles2">${worldScenes}</div><div style="margin-top:10px">${worldFacts}</div></section>
    <section class="card"><div class="cNum"><b>4</b> Brands ${P.subj} buys</div>${brandRows}</section>
    <section class="card"><div class="cNum"><b>5</b> Interests &amp; passions</div><div class="tiles3">${interestTiles}</div></section>
    <section class="card media"><div style="grid-column:1 / -1" class="cNum"><b>6</b> Media world</div><div>${mediaRows}</div><div><div class="igLabel">${P.Poss} feed</div><div class="igFeed">${igFeed}</div></div></section>
    <section class="card"><div class="cNum"><b>7</b> How ${P.subj} decides</div><p class="dec"><b>Cares about.</b> ${esc(d.decides?.careAbout)}</p><p class="dec"><b>Doesn't care about.</b> ${esc(d.decides?.dontCareAbout)}</p><p class="dec"><b>Researches.</b> ${esc(d.decides?.research)}</p><div class="subLabel">Key questions</div><ol class="decList">${keyQ}</ol></section>
    <section class="card"><div class="cNum"><b>8</b> A day in ${P.poss} life</div>${dayRows}</section>
    <section class="card"><div class="cNum"><b>9</b> Tensions &amp; needs</div>${tensionRows}</section>
    <section class="card means"><div><div class="cNum"><b>10</b> What ${esc(brand)} means to ${P.obj}</div><p class="mQuote">“${esc(d.means?.quote)}”</p><ul class="check">${checklist}</ul></div><div><div class="prodCard"><p class="prodShot">${esc(d.means?.productShot)}</p><p class="prodLine">${esc(d.means?.productLine)}</p></div><p class="signoff">${esc(d.means?.signoff).replace(/\s*\/\s*/g, "<br>")}</p></div></section>
  </div>
  <footer class="foot">${(d.footerWords || []).map(w => `<span>${esc(w)}</span>`).join("<span>·</span>")}</footer>
</div>
</body></html>`;
}
