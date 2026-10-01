import { useState, useEffect, useCallback } from "react";
import { History } from "lucide-react";

function TabShell({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ma-wrapper space-y-6">
      <div className="space-y-1">
        <p className="text-[11px] font-mono uppercase tracking-widest text-blue-600">{eyebrow}</p>
        <h2 className="text-xl font-semibold text-gray-900 tracking-tight">{title}</h2>
        <p className="text-sm text-gray-500 max-w-2xl">{description}</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6">{children}</div>
    </div>
  );
}

// --- Intelligence ---

export function ResearchChatTab() {
  const { ResearchChat } = useLazy(() => import("@/components/media-analyser/ResearchChat"));
  return (
    <TabShell eyebrow="Intelligence" title="Research Chat"
      description="A full Claude chatbot that researches the web and answers with sources. Paste a product link for context, pick Opus 5 or Fable 5.1, and ask anything.">
      {ResearchChat ? <ResearchChat /> : <Spinner />}
    </TabShell>
  );
}

export function AgentReadyTab() {
  const { AgentReady } = useLazy(() => import("@/components/media-analyser/AgentReady"));
  return (
    <TabShell eyebrow="Intelligence" title="Agent-Ready Commerce"
      description="Make a product legible to AI shopping agents. Scrape a product URL, enrich it into a canonical schema.org-compliant record, score how agent-selectable it is, and query it through a live agent-facing endpoint.">
      {AgentReady ? <AgentReady /> : <Spinner />}
    </TabShell>
  );
}

// --- Creative Studio ---

export function AplusContentTab() {
  const { AplusContent } = useLazy(() => import("@/components/media-analyser/AplusContent"));
  return (
    <TabShell eyebrow="Creative Studio" title="A+ Content"
      description="Turn your product photos and verified facts into an ordered Amazon A+ page — a lifestyle hero, feature proof modules, a size infographic, a native comparison table and a brand closer.">
      {AplusContent ? <AplusContent /> : <Spinner />}
    </TabShell>
  );
}

export function InstaGridTab() {
  const { InstaGrid } = useLazy(() => import("@/components/media-analyser/InstaGrid"));
  return (
    <TabShell eyebrow="Creative Studio" title="Insta Grid"
      description="Fetch posts from an Instagram handle or upload your grid screenshots — we extract the feed's visual identity and generate new posts in 1:1, 4:5 and 9:16 that fit seamlessly alongside your existing content.">
      {InstaGrid ? <InstaGrid /> : <Spinner />}
    </TabShell>
  );
}

export function VibeCloneTab() {
  const { VibeClone } = useLazy(() => import("@/components/media-analyser/VibeClone"));
  return (
    <TabShell eyebrow="Creative Studio" title="Vibe Clone"
      description="Upload reference images — an AI agent reads each one's vibe and regenerates a polished, on-brand version.">
      {VibeClone ? <VibeClone /> : <Spinner />}
    </TabShell>
  );
}

export function VibeMatchTab() {
  const { VibeMatch } = useLazy(() => import("@/components/media-analyser/VibeMatch"));
  return (
    <TabShell eyebrow="Creative Studio" title="Vibe Match"
      description="Upload reference images from any brand and your product photos — we synthesise the combined aesthetic across all references and render your product in every scene variation of that vibe.">
      {VibeMatch ? <VibeMatch /> : <Spinner />}
    </TabShell>
  );
}

export function PersonasTab() {
  const { PersonaManager } = useLazy(() => import("@/components/media-analyser/PersonaManager"));
  return (
    <div className="ma-wrapper space-y-6">
      <div className="space-y-1">
        <p className="text-[11px] font-mono uppercase tracking-widest text-blue-600">Creative Studio</p>
        <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Characters &amp; Personas</h2>
        <p className="text-sm text-gray-500">
          Create, name and manage the reusable characters that appear in your reels. Add extra
          angles to any persona and reuse them across every UGC ad.
        </p>
      </div>
      {PersonaManager ? <PersonaManager /> : <Spinner />}
    </div>
  );
}

export function UGCAdsTab() {
  const { UGCAds } = useLazy(() => import("@/components/media-analyser/UGCAds"));
  return (
    <TabShell eyebrow="Creative Studio" title="UGC Ads"
      description="Upload your product, describe the ad, and review the 10–15 second script before a single frame is rendered. Approve it and we generate every scene's keyframe and animate them into a UGC-style video.">
      {UGCAds ? <UGCAds /> : <Spinner />}
    </TabShell>
  );
}

export function UGCNewTab() {
  const { UGCNew } = useLazy(() => import("@/components/media-analyser/UGCNew"));
  return (
    <TabShell eyebrow="Creative Studio" title="UGC New"
      description="A guided UGC video pipeline: research & creative brief → 3 script angles → AI persona with portrait → voiceover → a 15s vertical talking-head ad. Review and steer every stage.">
      {UGCNew ? <UGCNew /> : <Spinner />}
    </TabShell>
  );
}

export function UGCPlaygroundTab() {
  const { UGCPlayground } = useLazy(() => import("@/components/media-analyser/UGCPlayground"));
  return (
    <TabShell eyebrow="Creative Studio" title="UGC Playground"
      description="Your experimentation sandbox — a private copy of the UGC New pipeline you can tweak freely without affecting the shipped pipelines.">
      {UGCPlayground ? <UGCPlayground /> : <Spinner />}
    </TabShell>
  );
}

export function MicroDramaTab() {
  const { MicroDrama } = useLazy(() => import("@/components/media-analyser/MicroDrama"));
  return (
    <TabShell eyebrow="Creative Studio" title="Micro Drama"
      description="Paste a script. The AI reads the whole thing and pulls out the cast → you generate each character → then it builds scenarios, scenes, and animates them into a short drama.">
      {MicroDrama ? <MicroDrama /> : <Spinner />}
    </TabShell>
  );
}

export function VideoAdsTab() {
  const { CloneUGC } = useLazy(() => import("@/components/media-analyser/CloneUGC"));
  return (
    <TabShell eyebrow="Creative Studio" title="Video Ads"
      description="Paste a link to a UGC ad you like and add your product. We watch it, clone its structure, pacing and creator energy, and render a fresh 15-second ad featuring your product.">
      {CloneUGC ? <CloneUGC /> : <Spinner />}
    </TabShell>
  );
}

export function LuxeAdsTab() {
  const { LuxeAds } = useLazy(() => import("@/components/media-analyser/LuxeAds"));
  return (
    <TabShell eyebrow="Creative Studio" title="Luxe Ads"
      description="Paste a link to a UGC ad you like and add your product. We watch it, clone its structure, pacing and creator energy, and render a fresh 15-second ad featuring your product.">
      {LuxeAds ? <LuxeAds /> : <Spinner />}
    </TabShell>
  );
}

export function VibeCloneUGCTab() {
  const { VibeCloneUGC } = useLazy(() => import("@/components/media-analyser/VibeCloneUGC"));
  return (
    <TabShell eyebrow="Creative Studio" title="Vibe Clone — UGC"
      description="Paste a reel and add your creator + product. We storyboard it, generate a photo for every shot with your model and product in the reel's vibe, animate each, and stitch them into a new reel.">
      {VibeCloneUGC ? <VibeCloneUGC /> : <Spinner />}
    </TabShell>
  );
}

export function TalkingAvatarTab() {
  const { TalkingAvatar } = useLazy(() => import("@/components/media-analyser/TalkingAvatar"));
  return (
    <div className="ma-wrapper">
      {TalkingAvatar ? <TalkingAvatar /> : <Spinner />}
    </div>
  );
}

export function CharacterReelTab() {
  const { CharacterReel } = useLazy(() => import("@/components/media-analyser/CharacterReel"));
  return (
    <TabShell eyebrow="Creative Studio" title="Character Reel"
      description="Upload a character photo, paste a script, pick a voice — and get a lip-synced speaking reel: your character filmed full-frame from multiple angles, saying your words, with burned-in captions.">
      {CharacterReel ? <CharacterReel /> : <Spinner />}
    </TabShell>
  );
}

export function VoiceCloneTab() {
  const { VoiceClone } = useLazy(() => import("@/components/media-analyser/VoiceClone"));
  return (
    <div className="ma-wrapper space-y-6">
      {VoiceClone ? <VoiceClone /> : <Spinner />}
    </div>
  );
}

// --- Archive ---

export function CreativesHistoryTab() {
  const [batches, setBatches] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const { GenerationHistory } = useLazy(() => import("@/components/media-analyser/GenerationHistory"));

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/media-analyser/generations?limit=50");
      if (res.ok) setBatches(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  return (
    <div className="ma-wrapper space-y-6">
      <div className="space-y-1">
        <p className="text-[11px] font-mono uppercase tracking-widest text-blue-600">Studio</p>
        <h2 className="text-xl font-semibold text-gray-900 tracking-tight">Creatives History</h2>
        <p className="text-sm text-gray-500">
          {loading ? "Loading..." : batches.length
            ? `${batches.length} recent generation${batches.length === 1 ? "" : "s"}`
            : "Generated creatives will appear here."}
        </p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 px-6">
        {loading ? <Spinner /> : GenerationHistory ? <GenerationHistory batches={batches as never} /> : <Spinner />}
      </div>
    </div>
  );
}

// --- Helpers ---

function Spinner() {
  return (
    <div className="flex items-center justify-center py-14">
      <div className="animate-spin w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  );
}

function useLazy<T extends Record<string, unknown>>(factory: () => Promise<T>) {
  const [mod, setMod] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    factory().then((m) => { if (!cancelled) setMod(m); });
    return () => { cancelled = true; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  return (mod ?? {}) as Partial<T>;
}
