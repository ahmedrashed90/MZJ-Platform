import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadPublisher({ createDownloadUrl = () => "https://download.local/video.mp4" } = {}) {
  const source = fs.readFileSync("server/_instagram-publisher.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: "server/_instagram-publisher.ts",
  }).outputText;

  const module = { exports: {} };
  const customRequire = (specifier) => {
    if (specifier === "./_media-storage.js") return { createDownloadUrl };
    if (specifier === "./_zoho-workdrive.js") {
      return {
        getZohoFileInfo: async () => ({}),
        getZohoRuntime: async () => ({ uploadDomain: "https://zoho.local", accessToken: "zoho-token" }),
      };
    }
    throw new Error(`Unexpected require: ${specifier}`);
  };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: customRequire,
    process,
    Buffer,
    URL,
    URLSearchParams,
    Response,
    Headers,
    Blob,
    FormData,
    setTimeout,
    clearTimeout,
    console,
    fetch: (...args) => globalThis.fetch(...args),
  });
  const wrapper = new vm.Script(`(function(require,module,exports){${output}\n})`, { filename: "_instagram-publisher.cjs" });
  wrapper.runInContext(context)(customRequire, module, module.exports);
  return module.exports;
}

async function testBinaryReelFlow() {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method, headers: init.headers || {}, body: init.body });

    if (url === "https://download.local/video.mp4") {
      return new Response(Buffer.from("test-video-bytes"), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "16" },
      });
    }
    if (url.includes("/178900000000000/media_publish") && method === "POST") {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("creation_id"), "container-reel-1");
      return Response.json({ id: "published-reel-1" });
    }
    if (url.includes("/178900000000000/media") && method === "POST") {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("media_type"), "REELS");
      assert.equal(params.get("upload_type"), "resumable");
      assert.equal(params.get("video_url"), null);
      assert.equal(params.get("share_to_feed"), "true");
      return Response.json({ id: "container-reel-1" });
    }
    if (url.includes("rupload.facebook.com/ig-api-upload/v25.0/container-reel-1")) {
      assert.equal(init.headers.Authorization, "OAuth meta-token");
      assert.equal(init.headers.offset, "0");
      assert.equal(init.headers.file_size, "16");
      return Response.json({ success: true, message: "Upload successful." });
    }
    if (url.includes("/container-reel-1?") && method === "GET") {
      return Response.json({ id: "container-reel-1", status_code: "FINISHED" });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const { publishInstagramContent } = loadPublisher();
  const result = await publishInstagramContent({}, {
    igId: "178900000000000",
    token: "meta-token",
    caption: "Test caption",
    format: "reel",
    files: [{ storage_provider: "r2", storage_key: "video.mp4", original_name: "video.mp4", mime_type: "video/mp4", file_size: 16 }],
    resolvePublicUrl: async () => { throw new Error("Reel must not use a public URL"); },
  });

  assert.equal(result.uploadMode, "resumable_binary");
  assert.equal(result.publish.id, "published-reel-1");
  assert.ok(calls.some((call) => call.url.includes("rupload.facebook.com")));
}

async function testOrderedMultiImageStories() {
  const published = [];
  let containerIndex = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    if (url.includes("/178900000000000/media_publish") && method === "POST") {
      const params = new URLSearchParams(init.body);
      const creationId = params.get("creation_id");
      published.push(creationId);
      return Response.json({ id: `published-${creationId}` });
    }
    if (url.includes("/178900000000000/media") && method === "POST") {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("media_type"), "STORIES");
      containerIndex += 1;
      assert.equal(params.get("image_url"), `https://images.local/${containerIndex}.jpg`);
      return Response.json({ id: `story-container-${containerIndex}` });
    }
    const match = url.match(/story-container-(\d+)\?/);
    if (match && method === "GET") return Response.json({ id: match[0], status_code: "FINISHED" });
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };

  const { publishInstagramContent } = loadPublisher();
  const files = [
    { original_name: "1.jpg", mime_type: "image/jpeg" },
    { original_name: "2.jpg", mime_type: "image/jpeg" },
  ];
  let resolved = 0;
  const result = await publishInstagramContent({}, {
    igId: "178900000000000",
    token: "meta-token",
    caption: "",
    format: "story",
    files,
    resolvePublicUrl: async () => `https://images.local/${++resolved}.jpg`,
  });

  assert.deepEqual(published, ["story-container-1", "story-container-2"]);
  assert.equal(result.batchCount, 2);
  assert.equal(result.stories.length, 2);
}

await testBinaryReelFlow();
await testOrderedMultiImageStories();
console.log("Instagram resumable publisher behavior tests: 2/2 passed");
