import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCitation,
  buildReferenceMarkdown,
  bareDoi,
  citationYear,
  plain,
} from "../src/citation.js";
import type { Picture } from "../src/types.js";

const sample: Picture = {
  id: "https://doi.org/10.7875/togopic.2026.036",
  name: "下眼瞼コロボーマ",
  name_en: "Lower eyelid coloboma",
  author: '<a href="https://erikotoyooka.com/" target="_blank">erico</a>',
  author_str: "erico",
  editor: '<a href="https://plaza.umin.ac.jp/p-genet/">JSPG</a> & <a href="https://dbcls.rois.ac.jp/">DBCLS</a>',
  publisher: "DBCLS",
  license: "https://creativecommons.org/licenses/by/4.0/",
  uploadDate: "2026-07-17",
  png: "202603_Lower_Eyelid_Coloboma.png",
};

test("plain() strips HTML and entities", () => {
  assert.equal(plain(sample.author), "erico");
  assert.equal(plain(sample.editor), "JSPG & DBCLS");
});

test("bareDoi() normalizes DOI URL", () => {
  assert.equal(bareDoi(sample.id), "10.7875/togopic.2026.036");
  assert.equal(bareDoi("10.7875/togopic.2026.036"), "10.7875/togopic.2026.036");
});

test("citationYear() prefers the DOI year", () => {
  assert.equal(citationYear(sample), "2026");
  assert.equal(citationYear({ ...sample, id: "x", uploadDate: "2021-01-02" }), "2021");
});

test("english credit follows the official format", () => {
  const c = buildCitation(sample, { locale: "en" });
  assert.match(c.text, /The image of "Lower eyelid coloboma" is from TogoTV/);
  assert.match(c.text, /© 2026 DBCLS TogoTV, CC-BY-4\.0/);
  assert.match(c.text, /creativecommons\.org\/licenses\/by\/4\.0\/deed\.en/);
  assert.match(c.text, /doi\.org\/10\.7875\/togopic\.2026\.036/);
});

test("japanese credit uses the ja deed link", () => {
  const c = buildCitation(sample, { locale: "ja" });
  assert.match(c.text, /「下眼瞼コロボーマ」の画像は TogoTV より引用/);
  assert.match(c.text, /deed\.ja/);
});

test("modified flag is reflected", () => {
  assert.match(buildCitation(sample, { locale: "en", modified: true }).text, /, modified/);
  assert.match(buildCitation(sample, { locale: "ja", modified: true }).text, /（改変あり）/);
});

test("bibtex carries the corporate author and license note", () => {
  const c = buildCitation(sample);
  assert.match(c.bibtex, /author\s*=\s*\{\{DBCLS TogoTV\}\}/);
  assert.match(c.bibtex, /doi\s*=\s*\{10\.7875\/togopic\.2026\.036\}/);
  assert.match(c.bibtex, /CC-BY-4\.0/);
});

test("reference markdown lists every picture", () => {
  const md = buildReferenceMarkdown([sample, { ...sample, name_en: "Second" }], { locale: "en" });
  assert.match(md, /# References — Togo picture gallery/);
  assert.match(md, /1\. The image of "Lower eyelid coloboma"/);
  assert.match(md, /2\. The image of "Second"/);
});
