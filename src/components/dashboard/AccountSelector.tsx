import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, LogOut, Link2, Unlink, AlertCircle, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/store/auth";

const GOOGLE_SVG = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const META_SVG = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const SNAP_SVG = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.206.793c.99 0 4.347.276 5.93 3.821.529 1.193.403 3.219.299 4.847l-.003.06c-.012.18-.022.345-.03.51.075.045.203.09.401.09.3-.016.659-.12 1.033-.301a.477.477 0 0 1 .718.447c-.003.2-.154.462-.469.667-.293.191-.678.369-1.08.503-.112.037-.208.087-.295.161-.065.054-.111.123-.145.198.033.197.116.42.255.633.396.611 1.028 1.136 1.726 1.402a.466.466 0 0 1 .242.707c-.143.309-.677.585-1.547.803-.2.049-.361.131-.468.256-.105.122-.177.284-.218.453-.077.317-.159.662-.476.834a.578.578 0 0 1-.298.088c-.128 0-.265-.04-.413-.086-.219-.068-.472-.144-.788-.144a2.38 2.38 0 0 0-.372.028c-.345.052-.736.247-1.189.49-.776.416-1.735.933-3.049.933-1.33 0-2.294-.523-3.078-.943-.443-.238-.825-.443-1.162-.494a2.42 2.42 0 0 0-.371-.027c-.332 0-.591.083-.808.149-.14.044-.264.082-.382.082a.617.617 0 0 1-.339-.102c-.29-.168-.372-.498-.448-.808-.042-.174-.116-.34-.224-.465-.108-.126-.272-.21-.474-.26-.859-.216-1.386-.49-1.53-.8a.49.49 0 0 1 .243-.712c.699-.265 1.33-.79 1.726-1.401.14-.213.222-.436.255-.633a.564.564 0 0 0-.145-.198 1.063 1.063 0 0 0-.295-.161c-.4-.134-.787-.312-1.08-.503-.315-.205-.466-.468-.47-.668a.482.482 0 0 1 .72-.447c.374.181.733.285 1.033.301.199 0 .326-.045.401-.09a31.03 31.03 0 0 1-.033-.57c-.104-1.628-.23-3.654.299-4.847C7.86 1.069 11.216.793 12.206.793z" />
  </svg>
);

interface PlatformRowProps {
  label: string;
  icon: React.ReactNode;
  color: string;
  connected: boolean;
  authenticated: boolean;
  activeId: string | null;
  options: { id: string; name: string }[];
  connectUrl: string;
  onDisconnect: () => void;
  onSwitch?: (id: string) => void;
  onClose: () => void;
  pasteLabel?: string;
  pasteHint?: string;
  onPasteId?: (id: string) => void;
}

function PlatformRow({
  label, icon, color, connected, authenticated, activeId, options, connectUrl,
  onDisconnect, onSwitch, onClose, pasteLabel, pasteHint, onPasteId,
}: PlatformRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMultiple = options.length > 1;
  const needsSelection = authenticated && !connected;

  return (
    <div className="border-b border-gray-50 last:border-b-0">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-7 h-7 rounded-full ${color} flex items-center justify-center flex-shrink-0`}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-gray-900">{label}</span>
              {connected ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                </span>
              ) : needsSelection ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                </span>
              ) : (
                <span className="inline-flex items-center text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">off</span>
              )}
            </div>
            {connected && activeId && (
              <div className="text-[11px] text-gray-500 truncate max-w-[140px] font-mono">
                {options.find((o) => o.id === activeId)?.name || activeId}
              </div>
            )}
            {needsSelection && (
              <div className="text-[10px] text-amber-600 font-medium">Select account</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {needsSelection && options.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-amber-600 hover:text-amber-800 font-semibold px-2 py-1 rounded hover:bg-amber-50"
            >
              Pick <ChevronDown className={`w-3 h-3 inline transition ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
          {connected && hasMultiple && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded hover:bg-blue-50"
            >
              Switch <ChevronDown className={`w-3 h-3 inline transition ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
          {(connected || authenticated) ? (
            <button
              onClick={onDisconnect}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"
              title={`Disconnect ${label}`}
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          ) : (
            <a
              href={connectUrl}
              onClick={onClose}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
            >
              <Link2 className="w-3 h-3" /> Connect
            </a>
          )}
        </div>
      </div>

      {/* Account picker — for both "needs selection" and "switch" states */}
      {expanded && options.length > 0 && (
        <div className="px-4 pb-2">
          <div className="bg-gray-50 rounded-lg p-1.5 space-y-0.5 max-h-48 overflow-y-auto">
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => { onSwitch?.(opt.id); setExpanded(false); }}
                className={`w-full text-left px-3 py-2 rounded-md text-xs transition flex items-center justify-between ${
                  activeId === opt.id
                    ? "bg-white shadow-sm text-gray-900 font-semibold"
                    : "text-gray-600 hover:bg-white hover:shadow-sm"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{opt.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{opt.id}</div>
                </div>
                {activeId === opt.id && <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0 ml-2" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Paste ID fallback when authenticated but no options available from OAuth */}
      {needsSelection && options.length === 0 && onPasteId && (
        <div className="px-4 pb-2.5">
          <div className="bg-amber-50 rounded-lg p-2.5">
            <div className="flex items-start gap-1.5 mb-1.5">
              <AlertCircle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
              <span className="text-[10px] text-amber-700">{pasteHint}</span>
            </div>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.target as HTMLFormElement).elements.namedItem("entityId") as HTMLInputElement;
                if (input.value.trim()) {
                  onPasteId(input.value.trim());
                }
              }}
            >
              <input
                name="entityId"
                placeholder={pasteLabel || "e.g. 1234567890"}
                className="flex-1 px-2.5 py-1.5 border border-amber-300 rounded-md text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
              <button type="submit" className="px-2.5 py-1.5 bg-amber-600 text-white rounded-md text-xs font-medium hover:bg-amber-700">
                Save
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── DV360 grouped-by-partner row ────────────────────────────── */

interface DV360RowProps {
  connected: boolean;
  authenticated: boolean;
  activeId: string | null;
  options: { id: string; name: string; partnerId?: string }[];
  partners: { id: string; name: string }[];
  onSwitch: (id: string) => void;
  onDisconnect: () => void;
  onClose: () => void;
  onPasteId: (id: string) => void;
}

function DV360Row({
  connected, authenticated, activeId, options, partners,
  onSwitch, onDisconnect, onClose, onPasteId,
}: DV360RowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMultiple = options.length > 1;
  const needsSelection = authenticated && !connected;

  // Group options by partner
  const grouped = partners.map((p) => ({
    partner: p,
    advertisers: options.filter((o) => o.partnerId === p.id),
  }));
  // Catch any options without a partnerId (legacy / paste-ID)
  const ungrouped = options.filter((o) => !o.partnerId);
  if (ungrouped.length > 0 && partners.length > 0) {
    grouped.push({ partner: { id: "_other", name: "Other" }, advertisers: ungrouped });
  }
  // If no partner info at all, show flat list
  const showGrouped = partners.length > 0 && grouped.some((g) => g.advertisers.length > 0);

  return (
    <div className="border-b border-gray-50 last:border-b-0">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <span className="text-emerald-600">{GOOGLE_SVG}</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-gray-900">DV360</span>
              {connected ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                </span>
              ) : needsSelection ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                </span>
              ) : (
                <span className="inline-flex items-center text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">off</span>
              )}
            </div>
            {connected && activeId && (
              <div className="text-[11px] text-gray-500 truncate max-w-[140px] font-mono">
                {options.find((o) => o.id === activeId)?.name || activeId}
              </div>
            )}
            {needsSelection && (
              <div className="text-[10px] text-amber-600 font-medium">Select account</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {needsSelection && options.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-amber-600 hover:text-amber-800 font-semibold px-2 py-1 rounded hover:bg-amber-50"
            >
              Pick <ChevronDown className={`w-3 h-3 inline transition ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
          {connected && hasMultiple && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded hover:bg-blue-50"
            >
              Switch <ChevronDown className={`w-3 h-3 inline transition ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
          {(connected || authenticated) ? (
            <button
              onClick={onDisconnect}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"
              title="Disconnect DV360"
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          ) : (
            <a
              href="/api/auth/google/start"
              onClick={onClose}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
            >
              <Link2 className="w-3 h-3" /> Connect
            </a>
          )}
        </div>
      </div>

      {/* Grouped advertiser picker */}
      {expanded && options.length > 0 && (
        <div className="px-4 pb-2">
          <div className="bg-gray-50 rounded-lg p-1.5 max-h-64 overflow-y-auto">
            {showGrouped ? (
              grouped.filter((g) => g.advertisers.length > 0).map((group) => (
                <div key={group.partner.id} className="mb-1 last:mb-0">
                  <div className="px-2.5 pt-2 pb-1 flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{group.partner.name}</span>
                    <span className="text-[9px] text-gray-400">{group.advertisers.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.advertisers.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => { onSwitch(opt.id); setExpanded(false); }}
                        className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition flex items-center justify-between ${
                          activeId === opt.id
                            ? "bg-white shadow-sm text-gray-900 font-semibold"
                            : "text-gray-600 hover:bg-white hover:shadow-sm"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{opt.name}</div>
                          <div className="text-[10px] text-gray-400 font-mono">{opt.id}</div>
                        </div>
                        {activeId === opt.id && <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0 ml-2" />}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="space-y-0.5">
                {options.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { onSwitch(opt.id); setExpanded(false); }}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition flex items-center justify-between ${
                      activeId === opt.id
                        ? "bg-white shadow-sm text-gray-900 font-semibold"
                        : "text-gray-600 hover:bg-white hover:shadow-sm"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{opt.name}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{opt.id}</div>
                    </div>
                    {activeId === opt.id && <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0 ml-2" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Paste ID fallback */}
      {needsSelection && options.length === 0 && (
        <div className="px-4 pb-2.5">
          <div className="bg-amber-50 rounded-lg p-2.5">
            <div className="flex items-start gap-1.5 mb-1.5">
              <AlertCircle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
              <span className="text-[10px] text-amber-700">Open displayvideo.google.com — the number after /a/ in the URL is your Advertiser ID.</span>
            </div>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.target as HTMLFormElement).elements.namedItem("entityId") as HTMLInputElement;
                if (input.value.trim()) onPasteId(input.value.trim());
              }}
            >
              <input
                name="entityId"
                placeholder="e.g. 1234567890"
                className="flex-1 px-2.5 py-1.5 border border-amber-300 rounded-md text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
              <button type="submit" className="px-2.5 py-1.5 bg-amber-600 text-white rounded-md text-xs font-medium hover:bg-amber-700">
                Save
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Google Ads grouped-by-MCC row ──────────────────────────── */

interface MccAccount {
  id: string;
  name: string;
  isManager: boolean;
  children?: { id: string; name: string }[];
}

interface GoogleAdsRowProps {
  connected: boolean;
  authenticated: boolean;
  activeId: string | null;
  mccAccounts: MccAccount[];
  flatOptions: { id: string; name: string; loginCustomerId?: string }[];
  onSwitch: (id: string, loginCustomerId?: string) => void;
  onDisconnect: () => void;
  onClose: () => void;
  onPasteId: (id: string) => void;
  onRefresh: () => void;
}

function GoogleAdsRow({
  connected, authenticated, activeId, mccAccounts, flatOptions,
  onSwitch, onDisconnect, onClose, onPasteId, onRefresh,
}: GoogleAdsRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedMcc, setExpandedMcc] = useState<Set<string>>(new Set());
  const needsSelection = authenticated && !connected;
  const hasAccounts = mccAccounts.length > 0 || flatOptions.length > 0;

  const activeName = (() => {
    if (!activeId) return null;
    for (const m of mccAccounts) {
      if (m.id === activeId) return m.name;
      for (const c of m.children || []) {
        if (c.id === activeId) return c.name;
      }
    }
    const flat = flatOptions.find((o) => o.id === activeId);
    return flat?.name || activeId;
  })();

  const toggleMcc = (id: string) => {
    setExpandedMcc((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="border-b border-gray-50 last:border-b-0">
      <div className="px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0">
            <span className="text-yellow-600">{GOOGLE_SVG}</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-gray-900">Google Ads</span>
              {connected ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                </span>
              ) : needsSelection ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                </span>
              ) : (
                <span className="inline-flex items-center text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">off</span>
              )}
            </div>
            {connected && activeName && (
              <div className="text-[11px] text-gray-500 truncate max-w-[140px]">
                {activeName}
              </div>
            )}
            {needsSelection && (
              <div className="text-[10px] text-amber-600 font-medium">Select account</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(needsSelection || connected) && hasAccounts && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className={`text-[11px] font-semibold px-2 py-1 rounded ${
                needsSelection
                  ? "text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                  : "text-blue-600 hover:text-blue-800 hover:bg-blue-50"
              }`}
            >
              {needsSelection ? "Pick" : "Switch"} <ChevronDown className={`w-3 h-3 inline transition ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
          {(connected || authenticated) && (
            <button
              onClick={onRefresh}
              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition"
              title="Refresh accounts"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {(connected || authenticated) ? (
            <button
              onClick={onDisconnect}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"
              title="Disconnect Google Ads"
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          ) : (
            <a
              href="/api/auth/google/start"
              onClick={onClose}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50"
            >
              <Link2 className="w-3 h-3" /> Connect
            </a>
          )}
        </div>
      </div>

      {/* Hierarchical MCC picker (falls back to flat list when hierarchy not loaded) */}
      {expanded && hasAccounts && (
        <div className="px-4 pb-2">
          <div className="bg-gray-50 rounded-lg p-1.5 max-h-72 overflow-y-auto">
            {mccAccounts.length > 0 ? (
              mccAccounts.map((acc) => {
                if (acc.isManager && acc.children && acc.children.length > 0) {
                  const isOpen = expandedMcc.has(acc.id);
                  return (
                    <div key={acc.id} className="mb-1 last:mb-0">
                      <button
                        onClick={() => toggleMcc(acc.id)}
                        className="w-full text-left px-2.5 pt-2 pb-1 flex items-center gap-1.5 hover:bg-gray-100 rounded-md transition"
                      >
                        <ChevronDown className={`w-3 h-3 text-gray-400 transition flex-shrink-0 ${isOpen ? "" : "-rotate-90"}`} />
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate">{acc.name}</span>
                        <span className="text-[9px] text-gray-400 flex-shrink-0">{acc.children.length}</span>
                      </button>
                      {isOpen && (
                        <div className="space-y-0.5 ml-2">
                          {acc.children.map((child) => (
                            <button
                              key={child.id}
                              onClick={() => { onSwitch(child.id, acc.id); setExpanded(false); }}
                              className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition flex items-center justify-between ${
                                activeId === child.id
                                  ? "bg-white shadow-sm text-gray-900 font-semibold"
                                  : "text-gray-600 hover:bg-white hover:shadow-sm"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="font-medium truncate">{child.name}</div>
                                <div className="text-[10px] text-gray-400 font-mono">{child.id}</div>
                              </div>
                              {activeId === child.id && <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0 ml-2" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                // Standalone leaf account (not under any MCC)
                return (
                  <button
                    key={acc.id}
                    onClick={() => { onSwitch(acc.id); setExpanded(false); }}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition flex items-center justify-between ${
                      activeId === acc.id
                        ? "bg-white shadow-sm text-gray-900 font-semibold"
                        : "text-gray-600 hover:bg-white hover:shadow-sm"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{acc.name}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{acc.id}</div>
                    </div>
                    {activeId === acc.id && <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0 ml-2" />}
                  </button>
                );
              })
            ) : (
              // Fallback: flat list from gadsCustomerOptions (hierarchy not loaded yet)
              flatOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => { onSwitch(opt.id, opt.loginCustomerId); setExpanded(false); }}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs transition flex items-center justify-between ${
                    activeId === opt.id
                      ? "bg-white shadow-sm text-gray-900 font-semibold"
                      : "text-gray-600 hover:bg-white hover:shadow-sm"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{opt.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{opt.id}</div>
                  </div>
                  {activeId === opt.id && <Check className="w-3.5 h-3.5 text-green-600 flex-shrink-0 ml-2" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Paste ID fallback */}
      {needsSelection && !hasAccounts && (
        <div className="px-4 pb-2.5">
          <div className="bg-amber-50 rounded-lg p-2.5">
            <div className="flex items-start gap-1.5 mb-1.5">
              <AlertCircle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
              <span className="text-[10px] text-amber-700">Open ads.google.com — the number in the top-right (e.g. 123-456-7890) is your Customer ID.</span>
            </div>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const input = (e.target as HTMLFormElement).elements.namedItem("entityId") as HTMLInputElement;
                if (input.value.trim()) onPasteId(input.value.trim().replace(/-/g, ""));
              }}
            >
              <input
                name="entityId"
                placeholder="e.g. 123-456-7890"
                className="flex-1 px-2.5 py-1.5 border border-amber-300 rounded-md text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
              <button type="submit" className="px-2.5 py-1.5 bg-amber-600 text-white rounded-md text-xs font-medium hover:bg-amber-700">
                Save
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main AccountSelector ────────────────────────────────────── */

interface AccountSelectorProps {
  onResolveGoogleAds?: (enteredId: string) => void;
}

export default function AccountSelector({ onResolveGoogleAds }: AccountSelectorProps) {
  const {
    metaBusinessId,
    metaAdAccountOptions,
    metaAccessToken,
    dv360AdvertiserId,
    dv360AdvertiserOptions,
    dv360Partners,
    googleAdsCustomerId,
    gadsCustomerOptions,
    gadsMccAccounts,
    snapchatAdAccountId,
    snapAdAccountOptions,
    isMetaConnected,
    isDV360Connected,
    isGoogleAdsConnected,
    isSnapchatConnected,
    hasMetaToken,
    hasGoogleToken,
    hasSnapchatToken,
    clearMetaCredentials,
    clearDV360Credentials,
    clearGoogleAdsCredentials,
    clearSnapchatCredentials,
    clearAllCredentials,
    switchMetaAdAccount,
    setMetaAdAccountOptions,
    setDv360AdvertiserOptions,
    setDv360Partners,
    setGadsCustomerOptions,
    setGadsMccAccounts,
    setSnapAdAccountOptions,
    switchDv360Advertiser,
    switchGoogleAdsCustomer,
    switchSnapchatAdAccount,
    setDV360Credentials,
    setGoogleAdsCredentials,
    setSnapchatCredentials,
    dv360ClientId,
    dv360ClientSecret,
    dv360RefreshToken,
    snapchatClientId,
    snapchatClientSecret,
    snapchatRefreshToken,
  } = useAuthStore();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const metaConn = mounted && isMetaConnected();
  const dv360Conn = mounted && isDV360Connected();
  const gadsConn = mounted && isGoogleAdsConnected();
  const snapConn = mounted && isSnapchatConnected();
  const metaAuth = mounted && hasMetaToken();
  const googleAuth = mounted && hasGoogleToken();
  const snapAuth = mounted && hasSnapchatToken();

  const fullyConnected = [metaConn, dv360Conn, gadsConn, snapConn].filter(Boolean).length;
  const pendingCount = [
    !metaConn && metaAuth,
    !dv360Conn && googleAuth,
    !gadsConn && googleAuth,
    !snapConn && snapAuth,
  ].filter(Boolean).length;

  // Auto-fetch Meta ad accounts whenever a token exists (even before an account is
  // picked), so the user can choose from the dropdown instead of pasting an ID.
  useEffect(() => {
    if (!metaAuth || !metaAccessToken || metaAdAccountOptions.length > 0) return;
    let cancelled = false;
    fetch("/api/meta/ad-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: metaAccessToken }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.accounts) return;
        setMetaAdAccountOptions(d.accounts.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [metaAuth, metaAccessToken, metaAdAccountOptions.length, setMetaAdAccountOptions]);

  // Auto-fetch DV360 advertisers grouped by partner. Guard on the DATA (partners
  // empty) rather than a fire-once flag: that way the fetch is retried if a previous
  // attempt was cancelled (effect re-run or Strict-Mode remount), and it naturally
  // stops once partners are loaded. An in-flight ref prevents duplicate concurrent
  // requests while one is pending.
  const dv360InFlightRef = useRef(false);
  useEffect(() => {
    if (!googleAuth || dv360Partners.length > 0 || dv360InFlightRef.current) return;
    if (!dv360ClientId || !dv360ClientSecret || !dv360RefreshToken) return;
    dv360InFlightRef.current = true;
    fetch("/api/dv360/advertisers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.advertisers?.length) {
          setDv360AdvertiserOptions(
            d.advertisers.map((a: { id: string; name: string; partnerId?: string }) => ({
              id: a.id,
              name: a.name,
              partnerId: a.partnerId,
            }))
          );
        }
        // Set partners LAST so it flips the guard only after options are in place.
        if (d.partners?.length) {
          setDv360Partners(d.partners);
        }
      })
      .catch(() => {})
      .finally(() => { dv360InFlightRef.current = false; });
  }, [googleAuth, dv360Partners.length, dv360ClientId, dv360ClientSecret, dv360RefreshToken, setDv360AdvertiserOptions, setDv360Partners]);

  // Auto-fetch Google Ads accounts (hierarchical: MCC → children) once a Google
  // token exists and no accounts are loaded. Shares the DV360/Google OAuth creds.
  const gadsInFlightRef = useRef(false);
  useEffect(() => {
    if (!googleAuth || gadsMccAccounts.length > 0 || gadsInFlightRef.current) return;
    if (!dv360ClientId || !dv360ClientSecret || !dv360RefreshToken) return;
    gadsInFlightRef.current = true;
    fetch("/api/google-ads/list-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: dv360ClientId,
        clientSecret: dv360ClientSecret,
        refreshToken: dv360RefreshToken,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.accounts?.length) {
          setGadsMccAccounts(d.accounts);
          // Also flatten all leaf accounts into gadsCustomerOptions for
          // backward compatibility with the rest of the app.
          const flat: { id: string; name: string; loginCustomerId?: string }[] = [];
          for (const acc of d.accounts) {
            if (acc.isManager && acc.children?.length) {
              for (const child of acc.children) {
                flat.push({ id: child.id, name: child.name, loginCustomerId: acc.id });
              }
            } else if (!acc.isManager) {
              flat.push({ id: acc.id, name: acc.name });
            }
          }
          if (flat.length > 0) setGadsCustomerOptions(flat);
        }
      })
      .catch(() => {})
      .finally(() => { gadsInFlightRef.current = false; });
  }, [googleAuth, gadsMccAccounts.length, dv360ClientId, dv360ClientSecret, dv360RefreshToken, setGadsMccAccounts, setGadsCustomerOptions]);

  // Auto-fetch Snapchat ad accounts (across all orgs) once a Snapchat token exists
  // and no options are loaded.
  const snapInFlightRef = useRef(false);
  useEffect(() => {
    if (!snapAuth || snapAdAccountOptions.length > 0 || snapInFlightRef.current) return;
    if (!snapchatClientId || !snapchatClientSecret || !snapchatRefreshToken) return;
    snapInFlightRef.current = true;
    fetch("/api/snapchat/ad-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: snapchatClientId,
        clientSecret: snapchatClientSecret,
        refreshToken: snapchatRefreshToken,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.adAccounts?.length) {
          setSnapAdAccountOptions(
            d.adAccounts.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }))
          );
        }
      })
      .catch(() => {})
      .finally(() => { snapInFlightRef.current = false; });
  }, [snapAuth, snapAdAccountOptions.length, snapchatClientId, snapchatClientSecret, snapchatRefreshToken, setSnapAdAccountOptions]);

  const metaOptions = metaAdAccountOptions.length > 0
    ? metaAdAccountOptions
    : metaBusinessId ? [{ id: metaBusinessId, name: metaBusinessId }] : [];
  const dv360Options = dv360AdvertiserOptions.length > 0
    ? dv360AdvertiserOptions
    : dv360AdvertiserId ? [{ id: dv360AdvertiserId, name: dv360AdvertiserId }] : [];
  const gadsOptions = gadsCustomerOptions.length > 0
    ? gadsCustomerOptions
    : googleAdsCustomerId ? [{ id: googleAdsCustomerId, name: googleAdsCustomerId }] : [];
  const snapOptions = snapAdAccountOptions.length > 0
    ? snapAdAccountOptions
    : snapchatAdAccountId ? [{ id: snapchatAdAccountId, name: snapchatAdAccountId }] : [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition shadow-sm"
      >
        <span>Manage Accounts</span>
        {fullyConnected > 0 && (
          <span className="text-[10px] font-bold bg-green-100 text-green-700 rounded-full w-5 h-5 flex items-center justify-center">
            {fullyConnected}
          </span>
        )}
        {pendingCount > 0 && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full w-5 h-5 flex items-center justify-center">
            {pendingCount}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Platform Connections</span>
            <span className="text-[10px] text-gray-400">
              {fullyConnected}/4 active{pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
            </span>
          </div>

          <PlatformRow
            label="Meta"
            icon={<span className="text-blue-600">{META_SVG}</span>}
            color="bg-blue-100"
            connected={metaConn}
            authenticated={metaAuth}
            activeId={metaBusinessId}
            options={metaOptions}
            connectUrl="/api/auth/meta/start"
            onDisconnect={clearMetaCredentials}
            onSwitch={switchMetaAdAccount}
            onClose={() => setOpen(false)}
            pasteLabel="e.g. act_123456789012345"
            pasteHint="Open Ads Manager → Settings — the Ad Account ID is the number after act_."
            onPasteId={(id) => switchMetaAdAccount(id.replace(/^act_/, ""))}
          />

          <DV360Row
            connected={dv360Conn}
            authenticated={googleAuth}
            activeId={dv360AdvertiserId}
            options={dv360Options}
            partners={dv360Partners}
            onSwitch={switchDv360Advertiser}
            onDisconnect={clearDV360Credentials}
            onClose={() => setOpen(false)}
            onPasteId={(id) => {
              const s = useAuthStore.getState();
              setDV360Credentials({
                clientId: s.dv360ClientId!,
                clientSecret: s.dv360ClientSecret!,
                refreshToken: s.dv360RefreshToken!,
                advertiserId: id,
              });
            }}
          />

          <GoogleAdsRow
            connected={gadsConn}
            authenticated={googleAuth}
            activeId={googleAdsCustomerId}
            mccAccounts={gadsMccAccounts}
            flatOptions={gadsOptions}
            onSwitch={(id, loginCustomerId) => {
              setGoogleAdsCredentials({ customerId: id, loginCustomerId });
            }}
            onDisconnect={clearGoogleAdsCredentials}
            onClose={() => setOpen(false)}
            onPasteId={(id) => {
              if (onResolveGoogleAds) onResolveGoogleAds(id);
              else setGoogleAdsCredentials({ customerId: id });
            }}
            onRefresh={() => {
              setGadsMccAccounts([]);
              setGadsCustomerOptions([]);
            }}
          />

          <PlatformRow
            label="Snapchat"
            icon={<span className="text-pink-600">{SNAP_SVG}</span>}
            color="bg-pink-100"
            connected={snapConn}
            authenticated={snapAuth}
            activeId={snapchatAdAccountId}
            options={snapOptions}
            connectUrl="/api/auth/snapchat/start"
            onDisconnect={clearSnapchatCredentials}
            onSwitch={switchSnapchatAdAccount}
            onClose={() => setOpen(false)}
            pasteLabel="e.g. 7f1c2b3a-..."
            pasteHint="Open Snapchat Ads Manager — the Ad Account ID is in the account settings / URL."
            onPasteId={(id) => {
              const s = useAuthStore.getState();
              setSnapchatCredentials({
                clientId: s.snapchatClientId!,
                clientSecret: s.snapchatClientSecret!,
                refreshToken: s.snapchatRefreshToken!,
                adAccountId: id,
                orgId: s.snapchatOrgId || undefined,
              });
            }}
          />

          <div className="border-t border-gray-100 px-4 py-2">
            <button
              onClick={() => { clearAllCredentials(); setOpen(false); window.location.href = "/"; }}
              className="w-full flex items-center gap-2 text-xs text-red-500 hover:text-red-700 font-medium py-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout (disconnect all)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
