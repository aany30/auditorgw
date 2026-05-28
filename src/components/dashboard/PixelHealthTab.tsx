import { useAudit } from "@/hooks/useAudit";
import type { DateRange } from "@/components/shared/DateRangePicker";
import { RefreshCw, Activity, CheckCircle2 } from "lucide-react";
import { TermText } from "@/components/shared/Term";

interface Props {
  platform?: "meta" | "google" | "both";
  dateRange?: DateRange;
  customStart?: string;
  customEnd?: string;
}

export default function PixelHealthTab({ platform = "both", dateRange = "30d", customStart, customEnd }: Props) {
  const { meta, loading } = useAudit(platform, dateRange, customStart, customEnd);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <RefreshCw className="w-10 h-10 text-blue-600 animate-spin mb-3" />
        <p className="text-gray-600">Loading pixel data...</p>
      </div>
    );
  }

  const pixels = meta?.pixels || [];
  const activePixels = pixels.filter((p) => p.status === "active").length;
  const totalEvents = pixels.reduce((s, p) => s + p.totalEvents, 0);
  // Browser vs Server (CAPI) totals — the only event-quality data Meta's Graph
  // API actually exposes (via aggregation=event_source). Exact dedup % and EMQ
  // score are Events-Manager-only, so they are intentionally not shown here.
  const totalBrowser = pixels.reduce(
    (s, p) => s + p.eventBreakdown.reduce((a, e) => a + e.browserCount, 0),
    0
  );
  const totalServer = pixels.reduce(
    (s, p) => s + p.eventBreakdown.reduce((a, e) => a + e.serverCount, 0),
    0
  );
  const capiSharePct = totalEvents > 0 ? Math.round((totalServer / totalEvents) * 100) : 0;

  // Aggregate event breakdown across all pixels
  const eventMap = new Map<string, { fired: number; browser: number; server: number }>();
  for (const p of pixels) {
    for (const e of p.eventBreakdown) {
      const existing = eventMap.get(e.event);
      if (existing) {
        existing.fired += e.count;
        existing.browser += e.browserCount;
        existing.server += e.serverCount;
      } else {
        eventMap.set(e.event, {
          fired: e.count,
          browser: e.browserCount,
          server: e.serverCount,
        });
      }
    }
  }
  const eventBreakdown = Array.from(eventMap.entries()).map(([event, data]) => {
    const serverPct = data.fired > 0 ? Math.round((data.server / data.fired) * 100) : 0;
    // Status from real data: server events present → CAPI active; else browser-only.
    const status = data.server > 0 ? "CAPI active" : "Browser only";
    return {
      event,
      fired: data.fired,
      browser: data.browser,
      server: data.server,
      serverPct,
      status,
    };
  });

  const statusColor = (s: string) =>
    s === "CAPI active" ? "text-green-700 bg-green-100" : "text-yellow-700 bg-yellow-100";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Activity className="w-8 h-8 text-red-600" /> Pixel Health Monitor
        </h1>
        <p className="text-gray-600 mt-1">Active pixel status, event firing, and deduplication</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Active Pixels</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{activePixels}/{pixels.length}</div>
          <div className="text-xs text-green-600 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Healthy
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600">Total Events</div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{(totalEvents / 1000).toFixed(1)}K</div>
          <div className="text-xs text-gray-500 mt-1">In selected range</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600"><TermText>Server (CAPI) Events</TermText></div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{(totalServer / 1000).toFixed(1)}K</div>
          <div className="text-xs text-gray-500 mt-1">Browser: {(totalBrowser / 1000).toFixed(1)}K</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
          <div className="text-sm text-gray-600"><TermText>CAPI Share</TermText></div>
          <div className="text-3xl font-bold text-gray-900 mt-1">{capiSharePct}%</div>
          <div className="text-xs text-gray-500 mt-1">Events sent server-side</div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Pixel Overview</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700"><TermText>Pixel Name</TermText></th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700"><TermText>Pixel ID</TermText></th>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Status</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Events</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700"><TermText>CAPI %</TermText></th>
              </tr>
            </thead>
            <tbody>
              {pixels.map((p, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold text-gray-900">{p.name}</td>
                  <td className="px-6 py-4 text-gray-600 font-mono text-xs">{p.pixelId}</td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${p.status === "active" ? "text-green-700 bg-green-100" : "text-red-700 bg-red-100"}`}>
                      {p.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right text-gray-900">{p.totalEvents.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{p.capi.serverShare}%</td>
                </tr>
              ))}
              {pixels.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No pixel data available. Connect a Meta account to begin auditing.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Event Breakdown — Browser vs Server</h2>
          <p className="text-sm text-gray-600 mt-1">CAPI deduplication and event firing comparison</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-gray-700">Event</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Total Fired</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Browser</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Server (CAPI)</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Server %</th>
                <th className="px-6 py-3 text-right font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {eventBreakdown.map((e, idx) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4 font-semibold text-gray-900">{e.event}</td>
                  <td className="px-6 py-4 text-right text-gray-900">{e.fired.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-gray-700">{e.browser.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-gray-700">{e.server.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-gray-900 font-semibold">{e.serverPct}%</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor(e.status)}`}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
