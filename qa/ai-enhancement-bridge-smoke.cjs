"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { configuration, generationServer, providerFingerprint } = require("../arc-comfy-server.cjs");
const enhancement = require("../arc-comfy-enhancement.cjs");

const jobId = "6a67443f-9555-42b0-8141-559ff9c96fa1";
const peerId = "6a67443f-9555-42b0-8141-559ff9c96fa2";
const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(256, 7)]);
const digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
const resultBytes = Buffer.from("fake-comfy-output-video");
let stage = "setup";
const fetchLocal = (url, options = {}) => fetch(url, { ...options,
  headers: { ...options.headers, Connection: "close" } });

async function freePort(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function checkRelayWorkflow() {
  const template = {
    "10": { class_type: "LoadVideo", inputs: { file: "" } },
    "11": { class_type: "GetVideoComponents", inputs: { video: ["10", 0] } },
    "12": { class_type: "RelayVSRConditioning", inputs: { images: ["11", 0] } },
    "13": { class_type: "VSRDecode", inputs: { detail: 0.3 } },
  };
  const config = enhancement.configure(template);
  assert.equal(config.name, "RelayVSR 视频超分");
  assert.equal(config.resolution, null);
  assert.equal(enhancement.declaresSeedvr2Denoise(config), false,
    "a similarly named sampler parameter in a non-SeedVR2 workflow must not trigger the SeedVR2 boundary note");
  const video = new File([bytes], "shot.mp4", { type: "video/mp4" });
  const job = { id: jobId, options: { shortEdge: null } };
  let submitted;
  const query = async (route, request) => {
    if (route === "/upload/image") return { name: "scene-source.mp4", subfolder: "" };
    assert.equal(route, "/prompt");
    submitted = JSON.parse(request.body).prompt;
    return { prompt_id: peerId };
  };
  await enhancement.submit({ config, query, job, video });
  assert.deepEqual(submitted, { ...template, "10": { class_type: "LoadVideo", inputs: { file: "scene-source.mp4" } } });
  assert.equal(template["10"].inputs.file, "");
  await assert.rejects(() => enhancement.submit({ config, query, job: { ...job, options: { shortEdge: 1080 } }, video }),
    /输出尺寸/);
  console.log("PASS RelayVSR API profile · output size stays with the configured workflow");
}

async function checkSeedVr2ResolutionFields() {
  for (const field of ["new_resolution", "resolution"]) {
    const template = {
      "10": { class_type: "LoadVideo", inputs: { file: "" } },
      "20": { class_type: "SeedVR2VideoUpscaler", inputs: { [field]: 720, denoise: 0.5, max_resolution: 0 } },
      "30": { class_type: "KSampler", inputs: { denoise: 1 } },
    };
    const config = enhancement.configure(template);
    assert.deepEqual(config.resolution, ["20", field]);
    assert.equal(config.resolutionMode, field === "resolution" ? "height" : "short-edge");
    assert.equal(config.name, "SeedVR2 视频增强");
    assert.equal(enhancement.declaresSeedvr2Denoise(config), true,
      "the SeedVR2 denoise control is declared on the SeedVR2 node itself");
    let submitted;
    const query = async (route, request) => {
      if (route === "/upload/image") return { name: "seedvr2-input.mp4", subfolder: "" };
      submitted = JSON.parse(request.body).prompt;
      return { prompt_id: peerId };
    };
    const job = { id: jobId, media: { width: 720, height: 1280 },
      options: { shortEdge: 1080, denoise: 0.75, ...(field === "resolution" ? { nativeResolution: 1920 } : {}) } };
    await enhancement.submit({ config, query, job,
      video: new File([bytes], "seedvr2.mp4", { type: "video/mp4" }) });
    assert.equal(submitted["20"].inputs[field], field === "resolution" ? 1920 : 1080,
      `selected 1080p target reaches the actual SeedVR2 ${field} field`);
    assert.equal(submitted["20"].inputs.denoise, 0.75, "the explicit SeedVR2 denoise selection reaches its model input");
    assert.equal(template["20"].inputs[field], 720, "profile discovery/submission never mutates the configured template");
  }
  const ambiguous = enhancement.configure({
    "10": { class_type: "LoadVideo", inputs: { file: "" } },
    "20": { class_type: "SeedVR2VideoUpscaler", inputs: { resolution: 720, new_resolution: 720 } },
  });
  assert.equal(ambiguous.resolution, null, "ambiguous resolution inputs must not be guessed");
  const unrelatedDenoise = enhancement.configure({
    "10": { class_type: "LoadVideo", inputs: { file: "" } },
    "20": { class_type: "SeedVR2VideoUpscaler", inputs: { resolution: 720 } },
    "30": { class_type: "KSampler", inputs: { denoise: 1 } },
  });
  assert.equal(unrelatedDenoise.denoise, null,
    "an ordinary KSampler denoise field is not exposed as the SeedVR2 model restoration control");
  assert.equal(enhancement.declaresSeedvr2Denoise(unrelatedDenoise), false);
  await assert.rejects(() => enhancement.submit({ config: ambiguous,
    query: async () => { throw new Error("must reject before upstream call"); },
    job: { id: jobId, options: { shortEdge: 1080 } }, video: new File([bytes], "ambiguous.mp4") }), /输出尺寸/);
  assert.equal(enhancement.nativeResolution({ resolution: ["20", "resolution"], resolutionMode: "height" },
    { media: { width: 720, height: 1280 }, options: { shortEdge: 720 } }), 1280,
    "portrait short-edge selection maps to SeedVR2's height-based native parameter");
  assert.equal(enhancement.nativeResolution({ resolution: ["20", "resolution"], resolutionMode: "height" },
    { media: { width: 1920, height: 1080 }, options: { shortEdge: 720 } }), 720,
    "landscape short-edge selection maps directly to SeedVR2 output height");
  console.log("PASS SeedVR2 legacy/current resolution field binding · portrait/landscape mapping · ambiguous controls fail closed");
}

async function main() {
  await checkSeedVr2ResolutionFields();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "arc-ai-enhance-"));
  const uploadNames = [];
  let seedvr2MaxResolution = 1080;
  let submittedEnhancementPrompt;
  let historyDrift = false;
  let server;
  const mock = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/queue") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ queue_running: [], queue_pending: [] }));
    }
    if (req.method === "GET" && req.url.startsWith("/object_info/")) {
      const name = decodeURIComponent(req.url.slice("/object_info/".length));
      const schemas = {
        LoadVideo: { input: { required: { file: ["COMBO", { options: ["placeholder.mp4"] }] } }, output: ["VIDEO"] },
        SeedVR2VideoUpscaler: { input: { required: { video: ["VIDEO"], new_resolution: ["INT", { min: 720, max: seedvr2MaxResolution }],
         seed: ["INT", { min: 0, max: 0xfffffffffffff }], denoise: ["FLOAT", { min: 0, max: 1, step: 0.05 }] } }, output: ["IMAGE"] },
        CreateVideo: { input: { required: { images: ["IMAGE"], fps: ["FLOAT"] } }, output: ["VIDEO"] },
        SaveVideo: { input: { required: { video: ["VIDEO"] } }, output: [] }
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(schemas[name] ? { [name]: schemas[name] } : {}));
    }
    if (req.method === "POST" && req.url === "/upload/image") {
      for await (const _chunk of req) { /* Drain the upload before replying. */ }
      uploadNames.push(req.headers["content-type"]);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ name: "arc-input.mp4", subfolder: "", type: "input" }));
    }
    if (req.method === "POST" && req.url === "/prompt") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const submitted = JSON.parse(body);
      submittedEnhancementPrompt = submitted.prompt;
      assert.equal(submitted.prompt["10"].inputs.file, "arc-input.mp4");
      assert.equal(submitted.prompt["20"].inputs.new_resolution, 1080);
      assert.equal(submitted.prompt["20"].inputs.denoise, 0.75);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ prompt_id: peerId }));
    }
    if (req.method === "GET" && req.url === `/history/${peerId}`) {
      const historyPrompt = structuredClone(submittedEnhancementPrompt);
      if (historyDrift) historyPrompt["20"].inputs.denoise = 0.5;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ [peerId]: { prompt: [0, peerId, historyPrompt],
        status: { status_str: "success", completed: true }, outputs: {
        "90": { video: [{ filename: "E01-S01-ai.mp4", subfolder: "", type: "output" }] }
      } } }));
    }
    if (req.method === "GET" && req.url.startsWith("/view?")) {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": resultBytes.length, "Accept-Ranges": "bytes" });
      return res.end(resultBytes);
    }
    res.writeHead(404); res.end();
  });

  try {
    const comfyPort = await freePort(mock);
    mock.listen(comfyPort, "127.0.0.1");
    await once(mock, "listening");
    const uiPort = await freePort(http.createServer());
    const workflowFile = path.join(temp, "seedvr2-api.json");
    fs.writeFileSync(workflowFile, JSON.stringify({
      "10": { class_type: "LoadVideo", inputs: { file: "placeholder.mp4" } },
      "20": { class_type: "SeedVR2VideoUpscaler", inputs: { video: ["10", 0], new_resolution: 720, denoise: 0.5, batch_size: 5, seed: 42 } },
      "80": { class_type: "CreateVideo", inputs: { images: ["20", 0], fps: 24 } },
      "90": { class_type: "SaveVideo", inputs: { video: ["80", 0] } }
    }));
    const config = configuration(["--port", String(uiPort), "--comfy-port", String(comfyPort),
      "--enhancement-workflow", workflowFile, "--state", path.join(temp, "jobs.json")]);
    assert.notEqual(providerFingerprint(config), providerFingerprint({ ...config, comfyPort: comfyPort + 1 }),
      "different local ComfyUI ports cannot collapse into the same provider fingerprint");
    assert.equal(config.enhancement.video[0], "10");
    server = generationServer(config);
    server.listen(uiPort, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${uiPort}`;
    stage = "profile request";
    const profileResponse = await fetchLocal(origin + "/api/enhancement");
    const profile = await profileResponse.json();
    assert.equal(profileResponse.status, 200);
    assert.equal(profile.input.type, "ComfyUI LoadVideo");
    assert.equal(profile.persistent, true);
    assert.ok(profile.resolutionControl);
    assert.deepEqual(profile.denoiseControl, { node: "20", field: "denoise", value: 0.5 });
    assert.equal(profile.workflowDeclaration.seeds[0].value, 42,
      "profile exposes the SeedVR2 workflow-declared seed without claiming runtime execution");
    assert.match(profile.providerFingerprint, /^[a-f0-9]{64}$/);
    stage = "workflow preflight";
    const preflight = await (await fetchLocal(origin + "/api/enhancement/preflight")).json();
    assert.equal(preflight.verified, 4);
    assert.equal(preflight.issues, 0);
    assert.match(preflight.schemaSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(preflight.parameterControls.find(item => item.node === "20" && item.field === "denoise"),
      { node: "20", field: "denoise", type: "FLOAT", value: 0.5, min: 0, max: 1, step: 0.05 });

    const file = new File([bytes], "E01-S01.mp4", { type: "video/mp4" });
    const task = { id: jobId, source: { name: "episode-source.mp4", size: 999, sha256: "a".repeat(64) },
      media: { name: file.name, size: file.size, sha256: digest, duration: 3 },
      shot: { id: "E01-S01", version: "approved-v4", start: 1, end: 4 },
      providerFingerprint: profile.providerFingerprint,
      options: { shortEdge: 1080, denoise: 0.75, workflowSha256: profile.sha256, preflightSchemaSha256: preflight.schemaSha256 } };
    const form = new FormData();
    form.append("task", JSON.stringify(task)); form.append("video", file);
    form.append("report", new File([JSON.stringify({ schema: "arc-ai-input-v1", source: task.source,
      media: task.media, shot: task.shot })], "E01-S01.arc-ai-input.json", { type: "application/json" }));
    stage = "submit request";
    const submit = await fetchLocal(origin + "/api/enhancement", { method: "POST", headers: { Origin: origin }, body: form });
    const accepted = await submit.json();
    assert.equal(submit.status, 202);
    assert.equal(accepted.status, "queued");
    assert.equal(accepted.workflow, "SeedVR2 视频增强");
    assert.equal(accepted.providerFingerprint, profile.providerFingerprint);
    assert.equal(accepted.executionPromptEvidence.status, "pending",
      "enhancement tasks expose a pending ComfyUI history graph comparison after submission");
    const actualSeedvr2Node = accepted.workflowDeclaration.samplers.find(item => item.type === "SeedVR2VideoUpscaler");
    assert.equal(actualSeedvr2Node.settings.denoise, 0.75,
      "the task declaration reflects the effective graph, not only the saved template");
    assert.equal(actualSeedvr2Node.settings.new_resolution, 1080);
    assert.equal(uploadNames.length, 1);

    stage = "complete status";
    const completed = await (await fetchLocal(origin + `/api/enhancement/${jobId}`)).json();
    assert.equal(completed.status, "complete");
    assert.equal(completed.providerFingerprint, profile.providerFingerprint);
    assert.equal(completed.executionPromptEvidence.status, "matched",
      "SeedVR2 completion proves ComfyUI history matches the submitted graph");
    assert.equal(completed.executionPromptEvidence.submittedSha256, completed.executionPromptEvidence.historySha256);
    assert.equal(completed.outputs.length, 1);
    for (const [id, denoise] of [["9a67443f-9555-42b0-8141-559ff9c96fa1", 1.05],
      ["9b67443f-9555-42b0-8141-559ff9c96fa2", 0.73]]) {
      const invalid = { ...task, id, options: { ...task.options, denoise } };
      const invalidForm = new FormData();
      invalidForm.append("task", JSON.stringify(invalid));
      invalidForm.append("video", new File([bytes], "E01-S01.mp4", { type: "video/mp4" }));
      invalidForm.append("report", new File([JSON.stringify({ schema: "arc-ai-input-v1", source: task.source,
        media: task.media, shot: task.shot })], "E01-S01.arc-ai-input.json", { type: "application/json" }));
      const invalidResponse = await fetchLocal(origin + "/api/enhancement", { method: "POST", headers: { Origin: origin }, body: invalidForm });
      assert.equal(invalidResponse.status, 409, `SeedVR2 denoise ${denoise} must fail schema preflight`);
      assert.equal(uploadNames.length, 1, "invalid denoise parameters are rejected before media upload");
    }
    stage = "schema drift rejection";
    seedvr2MaxResolution = 1200;
    const driftForm = new FormData();
    driftForm.append("task", JSON.stringify({ ...task, id: "7a67443f-9555-42b0-8141-559ff9c96fa4" }));
    driftForm.append("video", new File([bytes], "E01-S01.mp4", { type: "video/mp4" }));
    driftForm.append("report", new File([JSON.stringify({ schema: "arc-ai-input-v1", source: task.source,
      media: task.media, shot: task.shot })], "E01-S01.arc-ai-input.json", { type: "application/json" }));
    const driftResponse = await fetchLocal(origin + "/api/enhancement", { method: "POST", headers: { Origin: origin }, body: driftForm });
    assert.equal(driftResponse.status, 409);
    assert.match((await driftResponse.json()).error, /节点定义已变化/);
    assert.equal(uploadNames.length, 1, "node schema drift is rejected before the video upload reaches ComfyUI");
    seedvr2MaxResolution = 1080;
    stage = "result video";
    const video = await fetchLocal(origin + completed.outputs[0].url);
    assert.equal(video.status, 200);
    assert.deepEqual(Buffer.from(await video.arrayBuffer()), resultBytes);
    stage = "route isolation";
    assert.equal((await fetchLocal(origin + `/api/generation/${jobId}`)).status, 503);

    const wrongId = "7a67443f-9555-42b0-8141-559ff9c96fa1";
    const invalidMedia = { ...task.media, sha256: "b".repeat(64) };
    const invalidForm = new FormData();
    invalidForm.append("task", JSON.stringify({ ...task, id: wrongId, media: invalidMedia }));
    invalidForm.append("video", new File([bytes], "E01-S01.mp4", { type: "video/mp4" }));
    invalidForm.append("report", new File([JSON.stringify({ schema: "arc-ai-input-v1", source: task.source,
      media: invalidMedia, shot: task.shot })], "E01-S01.arc-ai-input.json", { type: "application/json" }));
    stage = "bad input";
    const rejected = await fetchLocal(origin + "/api/enhancement", { method: "POST", headers: { Origin: origin }, body: invalidForm });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /SHA-256/);
    assert.equal(uploadNames.length, 1, "mismatched media must be rejected before contacting ComfyUI");
    const invalidRetryTask = { ...task, id: "7a67443f-9555-42b0-8141-559ff9c96fa3", retryCount: 1,
      attemptHistory: [{ taskId: jobId, status: "failed", sourceSha256: task.source.sha256,
        mediaSha256: task.media.sha256, shotVersion: task.shot.version,
        workflowSha256: task.options.workflowSha256, providerFingerprint: task.providerFingerprint,
        options: { ...task.options, shortEdge: 720 }, queueMs: 1, executionMs: 2 }] };
    const invalidRetryForm = new FormData();
    invalidRetryForm.append("task", JSON.stringify(invalidRetryTask));
    invalidRetryForm.append("video", new File([bytes], "E01-S01.mp4", { type: "video/mp4" }));
    invalidRetryForm.append("report", new File([JSON.stringify({ schema: "arc-ai-input-v1", source: task.source,
      media: task.media, shot: task.shot })], "E01-S01.arc-ai-input.json", { type: "application/json" }));
    const invalidRetry = await fetchLocal(origin + "/api/enhancement", { method: "POST", headers: { Origin: origin }, body: invalidRetryForm });
    assert.equal(invalidRetry.status, 400);
    assert.equal(uploadNames.length, 1, "a retry ledger with different settings is rejected before submission to ComfyUI");
    const wrongProviderId = "8a67443f-9555-42b0-8141-559ff9c96fa1";
    const wrongProviderForm = new FormData();
    wrongProviderForm.append("task", JSON.stringify({ ...task, id: wrongProviderId, providerFingerprint: "b".repeat(64) }));
    wrongProviderForm.append("video", new File([bytes], "E01-S01.mp4", { type: "video/mp4" }));
    wrongProviderForm.append("report", new File([JSON.stringify({ schema: "arc-ai-input-v1", source: task.source,
      media: task.media, shot: task.shot })], "E01-S01.arc-ai-input.json", { type: "application/json" }));
    const wrongProvider = await fetchLocal(origin + "/api/enhancement", { method: "POST", headers: { Origin: origin }, body: wrongProviderForm });
    assert.equal(wrongProvider.status, 409);
    assert.equal(uploadNames.length, 1, "a stale provider fingerprint is rejected before submission to ComfyUI");
    await new Promise(resolve => server.close(resolve));
    server = generationServer(config);
    server.listen(uiPort, "127.0.0.1");
    await once(server, "listening");
    stage = "restart status";
    const restored = await (await fetchLocal(origin + `/api/enhancement/${jobId}`)).json();
    assert.equal(restored.status, "complete");
    assert.equal(restored.workflow, "SeedVR2 视频增强");
    assert.equal(restored.workflowDeclaration.seeds[0].value, 42,
      "persisted enhancement job keeps the server-read workflow parameter declaration");
    assert.equal(restored.providerFingerprint, profile.providerFingerprint);
    historyDrift = true;
    await new Promise(resolve => server.close(resolve));
    server = generationServer(config);
    server.listen(uiPort, "127.0.0.1");
    await once(server, "listening");
    stage = "history mismatch";
    const mismatched = await (await fetchLocal(origin + `/api/enhancement/${jobId}`)).json();
    assert.equal(mismatched.status, "complete");
    assert.equal(mismatched.executionPromptEvidence.status, "mismatch",
      "a changed denoise value in ComfyUI history must not be reported as the submitted experiment");
    console.log("PASS profile load · LoadVideo workflow binding · SHA-256-gated upload · queued/complete status · video return · route isolation");
    console.log("PASS bad media digest rejected before upload · persisted graph identity restored · changed history graph is flagged");
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => mock.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

checkRelayWorkflow().then(main).catch(error => { console.error(`FAILED at ${stage}:`, error); process.exitCode = 1; });
