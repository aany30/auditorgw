/**
 * Gemini Files API helper — uploads a video so it can be referenced as a
 * `file_data { file_uri }` part in `generateContent` (arbitrary HTTP URLs are
 * NOT accepted as `file_uri`; the bytes must be uploaded first). Used by the
 * Stage-05 QC gate to let Gemini watch the rendered ad.
 *
 * Flow (resumable upload):
 *   1. POST /upload/v1beta/files?uploadType=resumable (start) → upload URL header
 *   2. POST that URL with the bytes (upload + finalize)
 *   3. Poll files/{name} until state === "ACTIVE"
 */

const FILES_BASE = "https://generativelanguage.googleapis.com";

export interface GeminiFile {
  fileUri: string;
  mimeType: string;
  name: string;
}

/** Download a remote video URL into memory. */
async function fetchVideoBytes(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download video (${res.status}) for QC`);
  const mime = res.headers.get("content-type")?.split(";")[0] || "video/mp4";
  const bytes = await res.arrayBuffer();
  return { bytes, mime };
}

/**
 * Upload a remote video URL to the Gemini Files API and wait until it is ACTIVE.
 * Returns the `file_uri` + mime type ready for a `file_data` part.
 */
export async function uploadVideoToGeminiFiles(
  apiKey: string,
  videoUrl: string,
  opts?: { displayName?: string; pollMs?: number; timeoutMs?: number },
): Promise<GeminiFile> {
  const { bytes, mime } = await fetchVideoBytes(videoUrl);
  const numBytes = bytes.byteLength;

  // 1 — start a resumable upload session.
  const startRes = await fetch(`${FILES_BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(numBytes),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: opts?.displayName ?? "ugc_qc_video" } }),
  });
  if (!startRes.ok) {
    const err = await startRes.text().catch(() => "");
    throw new Error(`Gemini Files start HTTP ${startRes.status}: ${err.slice(0, 200)}`);
  }
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Files start returned no upload URL");

  // 2 — upload the bytes and finalize in one request.
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mime,
    },
    body: bytes,
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text().catch(() => "");
    throw new Error(`Gemini Files upload HTTP ${uploadRes.status}: ${err.slice(0, 200)}`);
  }
  const uploaded = (await uploadRes.json()) as { file?: { name?: string; uri?: string; state?: string; mimeType?: string } };
  const file = uploaded.file;
  if (!file?.name || !file?.uri) throw new Error("Gemini Files upload returned no file handle");

  // 3 — poll until the file is ACTIVE (PROCESSING → ACTIVE | FAILED).
  const pollMs = opts?.pollMs ?? 2000;
  const deadline = Date.now() + (opts?.timeoutMs ?? 120_000);
  let state = String(file.state ?? "PROCESSING");
  const shortName = file.name; // e.g. "files/abc123"
  let fileUri = file.uri;
  let mimeType = file.mimeType ?? mime;

  while (state !== "ACTIVE" && Date.now() < deadline) {
    if (state === "FAILED") throw new Error("Gemini Files processing failed");
    await new Promise(r => setTimeout(r, pollMs));
    const pollRes = await fetch(`${FILES_BASE}/v1beta/${shortName}?key=${apiKey}`);
    if (!pollRes.ok) continue;
    const pd = (await pollRes.json()) as { state?: string; uri?: string; mimeType?: string };
    state = String(pd.state ?? state);
    if (pd.uri) fileUri = pd.uri;
    if (pd.mimeType) mimeType = pd.mimeType;
  }

  if (state !== "ACTIVE") throw new Error("Gemini Files did not become ACTIVE in time");
  return { fileUri, mimeType, name: shortName };
}

/** Best-effort delete of an uploaded file (cleanup; failures are non-fatal). */
export async function deleteGeminiFile(apiKey: string, name: string): Promise<void> {
  try {
    await fetch(`${FILES_BASE}/v1beta/${name}?key=${apiKey}`, { method: "DELETE" });
  } catch {
    /* non-fatal */
  }
}
