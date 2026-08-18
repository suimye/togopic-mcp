/**
 * Layer 3 of the attribution strategy: embed the credit INTO the asset bytes,
 * so it survives even if a downstream tool drops the visible caption.
 *
 * - PNG: standard iTXt text chunks (Title/Author/Copyright/Source/Description)
 *   plus an XMP packet (dc / xmpRights / cc namespaces). Pure Node, no deps.
 * - SVG: an RDF <metadata> block and a leading credit comment.
 */
import type { Picture } from "./types.js";
import {
  buildCitation,
  plain,
  bareDoi,
  citationYear,
  COPYRIGHT_HOLDER,
  LICENSE_CODE,
  LICENSE_URL,
  type CitationOptions,
} from "./citation.js";

export interface AttributionMeta {
  title: string;
  author: string;
  copyright: string;
  license: string;
  licenseUrl: string;
  source: string;
  description: string;
  credit: string;
  attributionName: string;
}

export function attributionMeta(p: Picture, opts: CitationOptions = {}): AttributionMeta {
  const c = buildCitation(p, opts);
  const year = citationYear(p);
  const illustrator = plain(p.author_str || p.author);
  return {
    title: `${p.name_en || p.name}${p.name && p.name_en ? ` (${p.name})` : ""}`,
    author: illustrator ? `${illustrator}; ${COPYRIGHT_HOLDER}` : COPYRIGHT_HOLDER,
    copyright: `© ${year} ${COPYRIGHT_HOLDER}. ${LICENSE_CODE} (${LICENSE_URL})`,
    license: LICENSE_CODE,
    licenseUrl: LICENSE_URL,
    source: c.doi,
    description: plain(p.Description_small),
    credit: c.text,
    attributionName: COPYRIGHT_HOLDER,
  };
}

const xesc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildXmp(m: AttributionMeta): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
   xmlns:cc="http://creativecommons.org/ns#">
  <rdf:Description rdf:about="">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xesc(m.title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xesc(m.author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xesc(m.credit)}</rdf:li></rdf:Alt></dc:rights>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xesc(m.description)}</rdf:li></rdf:Alt></dc:description>
   <dc:source>${xesc(m.source)}</dc:source>
   <xmpRights:Marked>True</xmpRights:Marked>
   <xmpRights:WebStatement>${xesc(m.licenseUrl)}</xmpRights:WebStatement>
   <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${xesc(m.credit)}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
   <cc:license rdf:resource="${xesc(m.licenseUrl)}"/>
   <cc:attributionName>${xesc(m.attributionName)}</cc:attributionName>
   <cc:attributionURL>${xesc(m.source)}</cc:attributionURL>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ---- PNG chunk plumbing ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Uncompressed iTXt chunk (UTF-8 text; supports Japanese). */
function iTXt(keyword: string, text: string): Buffer {
  const data = Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0x00]), // keyword null separator
    Buffer.from([0x00]), // compression flag = 0
    Buffer.from([0x00]), // compression method = 0
    Buffer.from([0x00]), // empty language tag + separator
    Buffer.from([0x00]), // empty translated keyword + separator
    Buffer.from(text, "utf8"),
  ]);
  return pngChunk("iTXt", data);
}

const PNG_SIG = Buffer.from("89504e470d0a1a0a", "hex");

/** Insert attribution iTXt chunks (incl. XMP) right after IHDR. Returns a new PNG. */
export function embedPngAttribution(png: Buffer, m: AttributionMeta): Buffer {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIG)) return png; // not a PNG
  // IHDR is the first chunk: 4 (len) + 4 (type) + 13 (data) + 4 (crc) = 25 bytes after sig.
  const insertAt = 8 + 25;
  const chunks = [
    iTXt("Title", m.title),
    iTXt("Author", m.author),
    iTXt("Copyright", m.copyright),
    iTXt("Source", m.source),
    iTXt("Description", m.description || m.title),
    iTXt("License", `${m.license} ${m.licenseUrl}`),
    iTXt("Comment", m.credit),
    iTXt("XML:com.adobe.xmp", buildXmp(m)),
  ];
  return Buffer.concat([png.subarray(0, insertAt), ...chunks, png.subarray(insertAt)]);
}

/** Inject an RDF <metadata> block + leading credit comment into an SVG string. */
export function embedSvgAttribution(svg: string, m: AttributionMeta): string {
  const meta = `<metadata id="togopic-credit">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:cc="http://creativecommons.org/ns#">
  <cc:Work rdf:about="${xesc(m.source)}">
   <dc:title>${xesc(m.title)}</dc:title>
   <dc:creator><cc:Agent><dc:title>${xesc(m.author)}</dc:title></cc:Agent></dc:creator>
   <dc:rights><cc:Agent><dc:title>${xesc(m.credit)}</dc:title></cc:Agent></dc:rights>
   <dc:source>${xesc(m.source)}</dc:source>
   <cc:license rdf:resource="${xesc(m.licenseUrl)}"/>
  </cc:Work>
 </rdf:RDF>
</metadata>`;
  const comment = `<!-- ${m.credit.replace(/--/g, "- -")} -->\n`;
  const openTag = svg.match(/<svg\b[^>]*>/i);
  if (!openTag) return comment + svg;
  const idx = (openTag.index ?? 0) + openTag[0].length;
  return comment + svg.slice(0, idx) + "\n" + meta + svg.slice(idx);
}

export function bareDoiOf(p: Picture): string {
  return bareDoi(p.id);
}
