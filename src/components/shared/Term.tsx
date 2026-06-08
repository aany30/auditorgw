import React, { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { GLOSSARY, GLOSSARY_KEYS_SORTED, getTermDef } from "@/lib/glossary";

interface TermProps {
  /** Glossary key, e.g. "CAPI", "EMQ", "ROAS". */
  name: string;
  /** Override what's displayed (defaults to the term itself). */
  children?: ReactNode;
}

/**
 * Wraps a single glossary term with a dotted-underline + hover tooltip.
 * Uses React state for hover (doesn't depend on Tailwind named-group variants
 * which don't always compile reliably).
 */
export function Term({ name, children }: TermProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: "top" | "bottom" }>({
    top: 0,
    left: 0,
    placement: "top",
  });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const def = getTermDef(name);
  if (!def) return <>{children || name}</>;

  // Portal-rendered fixed-position tooltip with auto-flip + horizontal clamp,
  // so it never gets clipped by `overflow-hidden` table containers or pushed
  // off-screen near edges.
  const recompute = () => {
    if (!triggerRef.current || typeof window === "undefined") return;
    const r = triggerRef.current.getBoundingClientRect();
    const W = 288; // matches w-72 below
    const H = 140; // approximate tooltip height
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Flip down if there isn't room above AND there IS room below.
    const placement: "top" | "bottom" =
      r.top < H + margin && vh - r.bottom > H + margin ? "bottom" : "top";
    const top = placement === "top" ? r.top - margin : r.bottom + margin;
    let left = r.left + r.width / 2 - W / 2;
    left = Math.max(margin, Math.min(left, vw - W - margin));
    setCoords({ top, left, placement });
  };

  const handleEnter = () => {
    recompute();
    setOpen(true);
  };

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={() => setOpen(false)}
      onFocus={handleEnter}
      onBlur={() => setOpen(false)}
    >
      <span
        ref={triggerRef}
        className="cursor-help inline-flex items-baseline gap-0.5 group/term"
        tabIndex={0}
      >
        {children || name}
        <Info className="w-3 h-3 inline-block self-center text-gray-400 group-hover/term:text-blue-500 transition-colors" />
      </span>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: 288,
              transform: coords.placement === "top" ? "translateY(-100%)" : "none",
              zIndex: 9999,
            }}
            className="bg-gray-900 text-white text-xs rounded-lg p-3 shadow-xl pointer-events-none"
          >
            <span className="block font-bold text-white mb-1">
              {name} <span className="text-gray-400 font-normal">· {def.short}</span>
            </span>
            <span className="block text-gray-200 leading-snug normal-case">{def.long}</span>
          </div>,
          document.body
        )}
    </span>
  );
}

/**
 * Auto-wraps glossary terms with <Term> tooltips inside any string or JSX
 * children. Recursively walks the tree so paragraphs like
 *   <p>Add <strong>hashed</strong> CAPI events</p>
 * still get CAPI wrapped without manually splitting the text.
 *
 * Notes:
 * - Word-boundary matching so "Pixel" doesn't match inside "pixelated".
 * - Acronyms are case-sensitive; multi-word phrases are case-sensitive too
 *   (so "Audience Overlap" matches but "audience overlap" in body text doesn't —
 *   prevents over-triggering inside long sentences).
 * - JSX children (icons, links, bold text) are left intact; only string text
 *   nodes are scanned for glossary terms.
 */
export function TermText({ children }: { children: ReactNode }): JSX.Element {
  return <>{wrapNode(children)}</>;
}

/** Recursively walk children; replace text matches with <Term> wrappers. */
function wrapNode(node: ReactNode, keyPrefix = ""): ReactNode {
  if (node === null || node === undefined || typeof node === "boolean") return node;
  if (typeof node === "number") return node;
  if (typeof node === "string") return wrapString(node, keyPrefix);
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <span key={`tt-${keyPrefix}-${i}`}>{wrapNode(child, `${keyPrefix}-${i}`)}</span>
    ));
  }
  // React element — walk its children (don't touch its props/attrs)
  if (isReactElement(node)) {
    const el = node as React.ReactElement<{ children?: ReactNode }>;
    // Don't recurse into a Term — already wrapped
    if ((el.type as { displayName?: string })?.displayName === "Term") return node;
    // Don't recurse into <a>, <input>, <textarea> — their children may need to stay literal
    const tag = typeof el.type === "string" ? el.type : "";
    if (tag === "input" || tag === "textarea" || tag === "code" || tag === "pre") return node;
    const childProps = el.props as { children?: ReactNode };
    if (childProps?.children === undefined) return node;
    return React.cloneElement(el, {
      ...el.props,
      children: wrapNode(childProps.children, keyPrefix),
    });
  }
  return node;
}

function isReactElement(node: unknown): node is React.ReactElement {
  return typeof node === "object" && node !== null && "type" in node && "props" in node;
}

/** Match a single string against the glossary and produce a parts array. */
function wrapString(text: string, keyPrefix: string): ReactNode {
  if (!text) return text;

  // Build alternation of all glossary keys, escaping regex specials and using word boundaries.
  // Longest first so "Learning Limited" matches before "Learning Phase".
  const escaped = GLOSSARY_KEYS_SORTED.map((k) =>
    k.replace(/[+]/g, "\\+").replace(/\s+/g, "\\s+")
  );
  const pattern = new RegExp(`(${escaped.join("|")})\\b`, "g");

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let counter = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const matched = match[1];
    const canonical = Object.keys(GLOSSARY).find(
      (k) => k.replace(/\s+/g, " ").toLowerCase() === matched.replace(/\s+/g, " ").toLowerCase()
    );
    if (canonical) {
      parts.push(
        <Term key={`t-${keyPrefix}-${counter++}-${match.index}`} name={canonical}>
          {matched}
        </Term>
      );
    } else {
      parts.push(matched);
    }
    lastIndex = match.index + matched.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length === 1 ? parts[0] : parts;
}
