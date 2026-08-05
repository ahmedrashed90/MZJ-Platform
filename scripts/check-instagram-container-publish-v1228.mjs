import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require("typescript");
} catch {
  const globalTypescript = path.resolve(path.dirname(process.execPath), "../lib/node_modules/typescript/lib/typescript.js");
  ts = require(globalTypescript);
}

const root = process.cwd();
const helperPath = path.join(root, "server/_instagram-publisher.ts");
const apiPath = path.join(root, "server/marketing/index.ts");
const helperSource = fs.readFileSync(helperPath, "utf8");
const apiSource = fs.readFileSync(apiPath, "utf8");

const staticChecks = [
  ["marketing publishing delegates the whole Instagram branch to one clean publisher", apiSource.includes('import { publishInstagramContent } from "../_instagram-publisher.js";') && apiSource.includes("result=await publishInstagramContent({")],
  ["the old immediate Instagram media_publish calls were removed from the marketing route", !apiSource.includes("`/${igId}/media_publish`")],
  ["the Instagram publisher polls container status before publishing", helperSource.includes('fields: "id,status_code,status"') && helperSource.includes('lastStatus === "FINISHED"')],
  ["failed and expired Instagram containers stop with their processing error", helperSource.includes('lastStatus === "ERROR" || lastStatus === "EXPIRED"')],
  ["Media ID availability errors have a bounded retry instead of immediate failure", helperSource.includes("isTransientPublishAvailabilityError") && helperSource.includes("code === 9007") && helperSource.includes("publishRetryCount")],
  ["Instagram processing stays inside the Vercel function limit and can be tuned by environment", helperSource.includes('INSTAGRAM_MEDIA_PROCESSING_TIMEOUT_MS') && helperSource.includes("90000") && helperSource.includes("105000")],
  ["carousel children and parent containers are both awaited", helperSource.includes("childReadiness") && helperSource.includes('label: "Carousel"')],
];

for (const [label, condition] of staticChecks) {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  assert.equal(condition, true, label);
}

const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
  },
  reportDiagnostics: true,
});
const syntaxErrors = (transpiled.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
assert.equal(syntaxErrors.length, 0, syntaxErrors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mzj-instagram-publisher-"));
const compiledPath = path.join(tempDir, "instagram-publisher.mjs");
fs.writeFileSync(compiledPath, transpiled.outputText);
const { publishInstagramContent } = await import(`${pathToFileURL(compiledPath).href}?v=${Date.now()}`);

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

{
  let clock = 0;
  let statusReads = 0;
  let publishAttempts = 0;
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, method: init.method || "GET", body: String(init.body || "") });
    if (parsed.pathname.endsWith("/ig-account/media")) return jsonResponse(200, { id: "container-1" });
    if (parsed.pathname.endsWith("/container-1")) {
      statusReads += 1;
      return jsonResponse(200, statusReads === 1 ? { id: "container-1", status_code: "IN_PROGRESS" } : { id: "container-1", status_code: "FINISHED" });
    }
    if (parsed.pathname.endsWith("/ig-account/media_publish")) {
      publishAttempts += 1;
      if (publishAttempts === 1) return jsonResponse(400, { error: { message: "Media ID is not available", code: 9007, fbtrace_id: "trace-1" } });
      return jsonResponse(200, { id: "published-media-1" });
    }
    throw new Error(`Unexpected request ${parsed.pathname}`);
  };

  const result = await publishInstagramContent({
    instagramUserId: "ig-account",
    accessToken: "token",
    publishFormat: "reel",
    caption: "Test reel",
    media: [{ url: "https://cdn.example.com/reel.mp4", isVideo: true }],
  }, {
    fetchImpl: fakeFetch,
    sleep: async (milliseconds) => { clock += milliseconds; },
    now: () => clock,
    graphVersion: "v25.0",
    processingTimeoutMs: 30000,
    pollingIntervalMs: 4000,
    publishRetryCount: 4,
  });

  assert.equal(statusReads, 2);
  assert.equal(publishAttempts, 2);
  assert.equal(result.readiness.status_code, "FINISHED");
  assert.equal(result.publish.id, "published-media-1");
  assert.equal(result.publish.attempts, 2);
  const firstPublishIndex = calls.findIndex((call) => call.path.endsWith("/media_publish"));
  const finishedStatusIndex = calls.map((call) => call.path).lastIndexOf("/v25.0/container-1");
  assert.ok(firstPublishIndex > finishedStatusIndex, "media_publish must occur only after a FINISHED status read");
  console.log("PASS: Reel waits for FINISHED and retries Media ID is not available before publishing");
}

{
  let clock = 0;
  let sequence = 0;
  const fakeFetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/ig-account/media")) {
      sequence += 1;
      return jsonResponse(200, { id: `container-${sequence}` });
    }
    if (pathname.includes("/container-")) return jsonResponse(200, { id: pathname.split("/").at(-1), status_code: "FINISHED" });
    if (pathname.endsWith("/ig-account/media_publish")) return jsonResponse(200, { id: "carousel-post" });
    throw new Error(`Unexpected request ${pathname}`);
  };

  const result = await publishInstagramContent({
    instagramUserId: "ig-account",
    accessToken: "token",
    publishFormat: "photo_post",
    caption: "Carousel",
    media: [
      { url: "https://cdn.example.com/1.jpg", isVideo: false },
      { url: "https://cdn.example.com/2.jpg", isVideo: false },
    ],
  }, {
    fetchImpl: fakeFetch,
    sleep: async (milliseconds) => { clock += milliseconds; },
    now: () => clock,
    graphVersion: "v25.0",
    processingTimeoutMs: 30000,
    pollingIntervalMs: 4000,
  });

  assert.equal(result.children.length, 2);
  assert.equal(result.publish.id, "carousel-post");
  assert.equal(result.readiness.status_code, "FINISHED");
  console.log("PASS: Carousel waits for every child and the parent container");
}

console.log(`Instagram container publishing checks: ${staticChecks.length + 2}/${staticChecks.length + 2} passed`);
