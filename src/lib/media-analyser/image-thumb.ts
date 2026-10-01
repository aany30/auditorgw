// Downscale a data/image URL to a small JPEG thumbnail (client-side, canvas).
// Used to persist a lightweight preview of input reference images in generation
// history — never the full-size base64 (rows must stay light: tens of KB).
export function makeThumb(src: string, maxDim = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not available")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch (e) {
        // Tainted canvas (remote image without CORS) → fall back to the original.
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for thumbnail"));
    img.src = src;
  });
}

// Build up to `cap` thumbnails from a list of image URLs/data URLs, skipping any
// that fail (e.g. CORS-tainted remote images). Never throws.
export async function makeThumbs(srcs: (string | undefined | null)[], cap = 3, maxDim = 200): Promise<string[]> {
  const out: string[] = [];
  for (const src of srcs) {
    if (!src || out.length >= cap) continue;
    try {
      out.push(await makeThumb(src, maxDim));
    } catch {
      /* skip un-thumbnailable images */
    }
  }
  return out;
}
