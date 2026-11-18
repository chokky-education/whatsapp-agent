import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = {
  html: readFileSync(new URL("../public/index.html", import.meta.url), "utf8"),
  css: readFileSync(new URL("../public/style.css", import.meta.url), "utf8"),
  app: readFileSync(new URL("../public/app.js", import.meta.url), "utf8"),
  vm: readFileSync(new URL("../public/view-model.js", import.meta.url), "utf8"),
  work: readFileSync(new URL("../public/work-view.js", import.meta.url), "utf8"),
  workCss: readFileSync(new URL("../public/work.css", import.meta.url), "utf8"),
};

test("public UI contains zero inline style attributes or inline scripts under strict CSP", () => {
  for (const [name, content] of Object.entries(files)) {
    assert.equal(/\bstyle\s*=/.test(content), false, `${name} must not emit HTML style="..." attributes`);
  }
  const inlineScriptMatches = [...files.html.matchAll(/<script\b([^>]*)>/gi)].filter(
    (m) => !/\bsrc\s*=/.test(m[1]),
  );
  assert.equal(inlineScriptMatches.length, 0, "index.html must not contain inline scripts");
});

const ALLOWED_URLS = new Set([
  "https://accounts.google.com/gsi/client",
  "http://www.w3.org/2000/svg",
]);

test("public UI only references self-hosted assets and allowed Google Identity script", () => {
  for (const [name, content] of Object.entries(files)) {
    const urls = [...content.matchAll(/https?:\/\/[^\s"'`)>]+/g)].map((m) => m[0]);
    for (const url of urls) {
      assert.equal(
        ALLOWED_URLS.has(url),
        true,
        `${name} contains unapproved external URL: ${url}`,
      );
    }
  }
});

test("app.js wires view-model adapters, live CSRF auth APIs, and excludes prototype scenarios", () => {
  assert.ok(files.app.includes("./view-model.js"), "app.js must import ./view-model.js");
  assert.ok(files.app.includes("x-csrf-token"), "app.js must pass x-csrf-token header");
  assert.ok(files.app.includes("/api/status") && files.app.includes("/api/history"), "app.js must query live status & history");
  assert.equal(/RAW_SCENARIOS|buildMockApiPayloads/.test(files.app), false, "app.js must not include synthetic prototype scenarios");
});
