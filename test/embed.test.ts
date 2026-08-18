import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  attributionMeta,
  buildXmp,
  embedPngAttribution,
  embedSvgAttribution,
} from "../src/embed.js";
import type { Picture } from "../src/types.js";

const sample: Picture = {
  id: "https://doi.org/10.7875/togopic.2026.036",
  name: "下眼瞼コロボーマ",
  name_en: "Lower eyelid coloboma",
  author_str: "erico",
  publisher: "DBCLS",
  uploadDate: "2026-07-17",
  Description_small: "特徴的な形態。",
  png: "x.png",
};

/** Minimal valid 1x1 PNG (signature + IHDR + IDAT + IEND). */
function tinyPng(): Buffer {
  const sig = Buffer.from("89504e470d0a1a0a", "hex");
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "latin1");
    // crc not validated by our reader; use zeros for the test fixture
    return Buffer.concat([len, t, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

test("attributionMeta carries copyright, license and DOI", () => {
  const m = attributionMeta(sample, { locale: "en" });
  assert.match(m.copyright, /© 2026 DBCLS TogoTV/);
  assert.equal(m.license, "CC-BY-4.0");
  assert.match(m.source, /10\.7875\/togopic\.2026\.036/);
});

test("XMP packet includes the credit and license resource", () => {
  const xmp = buildXmp(attributionMeta(sample));
  assert.match(xmp, /x:xmpmeta/);
  assert.match(xmp, /cc:license rdf:resource="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(xmp, /DBCLS TogoTV/);
});

test("embedPngAttribution keeps a valid PNG and inserts iTXt + XMP", () => {
  const out = embedPngAttribution(tinyPng(), attributionMeta(sample, { locale: "ja" }));
  assert.ok(out.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "signature intact");
  assert.ok(out.includes(Buffer.from("iTXt")), "has iTXt chunk");
  assert.ok(out.includes(Buffer.from("XML:com.adobe.xmp")), "has XMP keyword");
  assert.ok(out.includes(Buffer.from("下眼瞼コロボーマ", "utf8")), "UTF-8 title embedded");
  // IHDR must still be the first chunk (bytes 12..16 == 'IHDR').
  assert.equal(out.subarray(12, 16).toString("latin1"), "IHDR");
});

test("embedSvgAttribution injects RDF metadata after <svg>", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
  const out = embedSvgAttribution(svg, attributionMeta(sample));
  assert.match(out, /<metadata id="togopic-credit">/);
  assert.match(out, /cc:license/);
  assert.ok(out.indexOf("<metadata") > out.indexOf("<svg"), "metadata sits inside svg");
});
