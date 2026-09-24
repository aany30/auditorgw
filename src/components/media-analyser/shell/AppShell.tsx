
import { useState } from "react";
import { X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * Dashboard shell: fixed left sidebar (collapsible to an off-canvas drawer on
 * mobile) + sticky topbar + scrollable content region. Wraps every page.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Desktop sidebar — fixed */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 border-r border-line z-30">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line shadow-lg animate-rise">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 grid place-items-center w-8 h-8 rounded-sm text-fg-dim hover:bg-surface-2 z-10"
              aria-label="Close navigation"
            >
              <X size={16} />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Content column */}
      <div className="flex min-h-screen flex-col">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1">
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-10 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
