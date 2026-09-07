import { test } from "node:test";
import assert from "node:assert/strict";
import { externalCredit } from "../src/sources.js";

test("bioart credit is free-to-use, not required, links to BioArt", () => {
  const c = externalCredit({ source: "bioart", title: "T4 phage", locale: "en" });
  assert.match(c.text, /NIH BioArt Source/);
  assert.match(c.text, /free to use/);
  assert.match(c.text, /bioart\.niaid\.nih\.gov/);
  assert.equal(c.required, false);
  assert.doesNotMatch(c.text, /CC-BY|DBCLS/); // never Togo's license
});

test("bioart credit localizes to Japanese", () => {
  const c = externalCredit({ source: "bioart", title: "大腸菌", locale: "ja" });
  assert.match(c.text, /NIH BioArt Source/);
  assert.match(c.text, /自由利用可/);
});

test("explicit credit overrides generation", () => {
  const c = externalCredit({ source: "external", credit: "© Someone, all rights reserved" });
  assert.equal(c.text, "© Someone, all rights reserved");
  assert.equal(c.required, false);
});

test("generic external falls back to the title", () => {
  const c = externalCredit({ source: "external", title: "my figure", locale: "en" });
  assert.match(c.text, /my figure/);
});
