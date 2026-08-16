import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadPublisher({
  createDownloadUrl = () => "https://download.local/video.mp4",
  getZohoFileInfo = async () => ({ downloadUrl: "https://zoho.local/protected-video" }),
  getZohoRuntime = async () => ({ uploadDomain: "https://zoho.local", accessToken: "zoho-token" }),
} = {}) {
  const source = fs.readFileSync("server/_facebook-video-publisher.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: "server/_facebook-video-publisher.ts",
  }).outputText;
  const module = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier === "./_media-storage.js") return { createDownloadUrl };
    if (specifier === "./_zoho-workdrive.js") return { getZohoFileInfo, getZohoRuntime };
    throw new Error(`Unexpected require: ${specifier}`);
  };
  const context = vm.createContext({
    module, exports: module.exports, require: customRequire, process, Buffer, URL, URLSearchParams, Response, Headers,
    setTimeout, clearTimeout, console, fetch: (...args) => globalThis.fetch(...args),
  });
  const wrapper = new vm.Script(`(function(require,module,exports){${output}\n})`, { filename: "_facebook-video-publisher.cjs" });
  wrapper.runInContext(context)(customRequire, module, module.exports);
  return module.exports;
}

async function testBinaryReelFromZoho() {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method, headers: init.headers || {}, body: init.body });

    if (url === "https://zoho.local/protected-video") {
      assert.equal(init.headers.Authorization, "Zoho-oauthtoken zoho-token");
      return new Response(Buffer.from("test-video-bytes"), { status: 200, headers: { "content-type": "application/octet-stream", "content-length": "16" } });
    }
    if (url.includes("/page-1/video_reels") && method === "POST") {
      const params = new URLSearchParams(init.body);
      if (params.get("upload_phase") === "start") return Response.json({ video_id: "video-1", upload_url: "https://rupload.facebook.com/video-upload/video-1" });
      assert.equal(params.get("upload_phase"), "finish");
      assert.equal(params.get("video_id"), "video-1");
      assert.equal(params.get("video_state"), "PUBLISHED");
      assert.equal(params.get("description"), "caption #tag");
      return Response.json({ success: true });
    }
    if (url === "https://rupload.facebook.com/video-upload/video-1") {
      assert.equal(init.headers.Authorization, "OAuth meta-token");
      assert.equal(init.headers.offset, "0");
      assert.equal(init.headers.file_size, "16");
      assert.equal(init.headers["Content-Type"], "application/octet-stream");
      assert.equal(init.headers.file_url, undefined);
      assert.ok(init.body, "binary stream/body must be forwarded to Meta");
      return Response.json({ success: true });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const { publishFacebookReel } = loadPublisher();
  const result = await publishFacebookReel({}, {
    pageId: "page-1",
    token: "meta-token",
    caption: "caption #tag",
    file: { storage_provider: "zoho", external_id: "zoho-1", original_name: "reel.mp4", mime_type: "video/mp4", file_size: 16 },
  });
  assert.equal(result.video_id, "video-1");
  assert.equal(result.uploadMode, "resumable_binary");
  assert.ok(calls.some((call) => call.url.includes("rupload.facebook.com")));
}

async function testBinaryVideoStoryFromR2() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    if (url === "https://download.local/video.mp4") {
      return new Response(Buffer.from("story-video"), { status: 200, headers: { "content-type": "video/mp4", "content-length": "11" } });
    }
    if (url.includes("/page-2/video_stories") && method === "POST") {
      const params = new URLSearchParams(init.body);
      if (params.get("upload_phase") === "start") return Response.json({ video_id: "story-1", upload_url: "https://rupload.facebook.com/video-upload/story-1" });
      assert.equal(params.get("upload_phase"), "finish");
      assert.equal(params.get("video_id"), "story-1");
      return Response.json({ success: true });
    }
    if (url === "https://rupload.facebook.com/video-upload/story-1") {
      assert.equal(init.headers.file_size, "11");
      return Response.json({ success: true });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const { publishFacebookVideoStory } = loadPublisher();
  const result = await publishFacebookVideoStory({}, {
    pageId: "page-2",
    token: "meta-token",
    file: { storage_provider: "r2", storage_key: "story.mp4", original_name: "story.mp4", mime_type: "video/mp4", file_size: 11 },
  });
  assert.equal(result.video_id, "story-1");
  assert.equal(result.uploadMode, "resumable_binary");
}

async function test422PreservesMetaDetail() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    if (url === "https://download.local/video.mp4") {
      return new Response(Buffer.from("bad-video"), { status: 200, headers: { "content-type": "video/mp4", "content-length": "9" } });
    }
    if (url.includes("/page-3/video_reels") && method === "POST") {
      const params = new URLSearchParams(init.body);
      if (params.get("upload_phase") === "start") return Response.json({ video_id: "video-422", upload_url: "https://rupload.facebook.com/video-upload/video-422" });
      throw new Error("finish should not run after failed upload");
    }
    if (url === "https://rupload.facebook.com/video-upload/video-422") {
      return Response.json({ debug_info: { type: "ProcessingFailedError", message: "Request processing failed" } }, { status: 422 });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const { publishFacebookReel } = loadPublisher();
  await assert.rejects(
    () => publishFacebookReel({}, {
      pageId: "page-3", token: "meta-token", caption: "", file: { storage_provider: "r2", storage_key: "bad.mp4", original_name: "bad.mp4", mime_type: "video/mp4", file_size: 9 },
    }),
    (error) => {
      assert.match(error.message, /Request processing failed/);
      assert.match(error.message, /HTTP 422/);
      assert.match(error.message, /ProcessingFailedError/);
      return true;
    },
  );
}

await testBinaryReelFromZoho();
await testBinaryVideoStoryFromR2();
await test422PreservesMetaDetail();
console.log("Facebook resumable publishing behavior tests: 3/3 passed");
