/** Fetch a remote image and return it as a base64 data URI (self-contained embeds). */

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function mimeFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "image/png";
}

export interface EmbeddedImage {
  /** data:<mime>;base64,<...> */
  dataUri: string;
  /** raw base64 (no prefix) — pptxgenjs wants "<mime>;base64,<...>" */
  base64: string;
  mime: string;
  /** Natural pixel size when detectable (PNG); used to preserve aspect ratio. */
  natW?: number;
  natH?: number;
}

/** Read intrinsic width/height from a PNG buffer (IHDR), else undefined. */
function pngSize(buf: Buffer): { natW: number; natH: number } | undefined {
  const PNG_SIG = "89504e470d0a1a0a";
  if (buf.length < 24 || buf.subarray(0, 8).toString("hex") !== PNG_SIG) return undefined;
  return { natW: buf.readUInt32BE(16), natH: buf.readUInt32BE(20) };
}

export async function fetchImageAsDataUri(url: string): Promise<EmbeddedImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "togopic-mcp" },
    });
    if (!res.ok) throw new Error(`image fetch ${res.status} for ${url}`);
    const mime = res.headers.get("content-type")?.split(";")[0] || mimeFromUrl(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const base64 = buf.toString("base64");
    return { dataUri: `data:${mime};base64,${base64}`, base64, mime, ...pngSize(buf) };
  } finally {
    clearTimeout(timer);
  }
}
