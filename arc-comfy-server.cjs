#!/usr/bin/env node
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable, Transform, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const assistant = require("./arc-assistant.cjs");
const generationControls = require("./arc-generation-controls.cjs");
const jobTiming = require("./arc-job-timing.cjs");
const workflowManifest = require("./arc-workflow-manifest.cjs");
const { endpoint } = require("./arc-comfy-endpoint.cjs");
const preflight = require("./arc-comfy-preflight.cjs");
const h3Prompts = require("./arc-h3-prompt.cjs");
const referenceMedia = require("./arc-reference-media.cjs");
const aiEnhancement = require("./arc-comfy-enhancement.cjs");
const motionActions = require("./production-actions.js");
const officialWorkflows = require("./arc-official-workflows.cjs");

const PORTS = ["--port", "--comfy-port", "--assistant-port"];
const MODEL_FLAGS = ["--assistant-model", "--script-model", "--video-model", "--edit-model", "--vision-model"];
const GENERATION_FLAGS = ["--workflow", "--prompt-node", "--prompt-input", "--image-node", "--image-input", "--references", "--controls", "--output-contract", "--state", "--comfy-port", "--comfy-url", "--h3-mode", "--h3-duration", "--ab-motion-role", "--ab-motion-slot"];
const ENHANCEMENT_FLAGS = ["--enhancement-workflow", "--enhancement-video-node"];
const FLAGS = [...new Set([...GENERATION_FLAGS, ...ENHANCEMENT_FLAGS, ...MODEL_FLAGS, ...PORTS, "--test-fixtures", "--official-presets"])];
const SCRIPTS = new Set(["index.html", "studio-hub.css", "studio-hub.js", "production.css", "production.js",
  "production-route.js", "source-content-digest.js", "stream-sha256.js", "production-actions.js", "production-ab.js",
  "production-quality.js", "mp4-container-metadata.js", "production-ab-review.js", "production-ab-return.js", "production-workflow-audit.js",
  "production-context.js", "production-project.js", "production-camera.js", "production-storyboard.js", "production-dialogue.js", "production-generation.js", "production-job-log.js", "production-prompt.js", "production-assistant.js", "production-review-frames.js", "production-repair.js", "production-compare.js", "production-relay-review.js", "production-review-notes.js", "production-recheck.js", "production-continuity.js", "production-art-review.js", "production-overview-jobs.js", "production-overview.js", "PRODUCTION-GUIDE.md", "comfy-output-contract.example.json"]);
const TYPES = { ".html": "text/html", ".md": "text/plain", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };
const VIDEO = new Set([".mp4", ".webm", ".mov"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
function readOutputContract(filename) {
  const file = path.resolve(filename);
  if (fs.statSync(file).size > 16384) throw new Error("输出契约文件超过 16 KB。");
  const value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const allowed = new Set(["width", "height", "seconds", "frames", "fps"]);
  if (!plain(value) || Object.keys(value).some(key => !allowed.has(key)) ||
      !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 16384 ||
      !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 16384 ||
      (value.seconds !== undefined && (!Number.isFinite(value.seconds) || value.seconds <= 0 || value.seconds > 3600)) ||
      (value.frames !== undefined && (!Number.isSafeInteger(value.frames) || value.frames < 1 || value.frames > 1_000_000)) ||
      (value.fps !== undefined && (!Number.isFinite(value.fps) || value.fps <= 0 || value.fps > 240)) ||
      (value.seconds === undefined && !(Number.isSafeInteger(value.frames) && Number.isFinite(value.fps))) ||
      ((value.frames === undefined) !== (value.fps === undefined)) ||
      (value.seconds !== undefined && value.frames !== undefined && Math.abs(value.seconds - value.frames / value.fps) > 0.12)) {
    throw new Error("输出契约无效：需声明正整数宽高，以及秒数或帧数和帧率；秒数与帧数并存时误差须在 0.12 秒内。");
  }
  return { width: value.width, height: value.height,
    ...(value.seconds !== undefined ? { seconds: value.seconds } : {}),
    ...(value.frames !== undefined ? { frames: value.frames, fps: value.fps } : {}) };
}

function selectedOutputContract(config, selected) {
  const base = config.id ? config.output : config.outputContract;
  if (!base || !config.id || !config.template?.["8"] ||
      !["MiniMaxH3ImageToVideo", "MiniMaxH3ReferenceToVideo"].includes(config.template["8"].class_type)) return base;
  const graph = structuredClone(config.template);
  generationControls.apply(graph, selected);
  return { ...base, width: graph["8"].inputs.width, height: graph["8"].inputs.height,
    frames: graph["8"].inputs.length };
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const roleId = /^[a-z][a-z0-9_-]{0,31}$/;
const sha = /^[a-f0-9]{64}$/;
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function promptDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function modelFilesByControl(template, controls) {
  if (!plain(template) || !Array.isArray(controls)) return {};
  const result = {};
  for (const group of controls) {
    if (!group?.targets?.some(([id, field]) => /(?:unet|clip|vae|lora).*name|(?:unet|clip|vae|lora)_name/i.test(field) &&
        typeof template[id]?.inputs?.[field] === "string" && /\.(?:safetensors|gguf|ckpt|pt|pth|bin)$/i.test(template[id].inputs[field]))) continue;
    result[group.id] = Object.fromEntries(group.options.map(option => {
      const graph = structuredClone(template);
      generationControls.apply(graph, [[group, option]]);
      const models = workflowManifest.describe(graph)?.models || [];
      return [option.id, models.map(({ node, type, file }) => ({ node, classType: type, file }))];
    }));
  }
  return result;
}
function providerFingerprint(config) {
  const endpoint = config.comfyEndpoint?.base || `http://127.0.0.1:${config.comfyPort}`;
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}
const validMotionReference = item => plain(item) && item.source === "mp4-stts" &&
  Number.isSafeInteger(item.frameCount) && item.frameCount > 0 &&
  Number.isFinite(item.durationSeconds) && item.durationSeconds > 0 &&
  item.fps === 24 && item.frameRateMode === "constant" &&
  (item.codec === null || typeof item.codec === "string") && typeof item.hasAudio === "boolean" &&
  Number.isSafeInteger(item.audioTrackCount) && item.audioTrackCount >= 0;
const validComparison = item => plain(item) && uuid.test(item.id || "") && ["A", "B"].includes(item.variant) &&
  sha.test(item.basis || "") && (item.motionReference === undefined ||
    (item.mode === "motion" && item.variant === "B" && validMotionReference(item.motionReference))) &&
  (item.mode === "parameter" ? item.motionDigest === undefined && item.cueDigest === undefined && plain(item.parameterDiff) &&
      ["scheduler", "diffusion-weight"].includes(item.parameterDiff.controlId) && plain(item.parameterDiff.optionIds) &&
      typeof item.parameterDiff.optionIds.A === "string" && typeof item.parameterDiff.optionIds.B === "string" &&
      item.parameterDiff.optionIds.A !== item.parameterDiff.optionIds.B :
   ["vfx", "performance"].includes(item.mode) ? item.motionDigest === undefined && sha.test(item.cueDigest || "") :
    (item.mode === undefined || item.mode === "motion") && sha.test(item.motionDigest || ""));
const assetKinds = new Set(["角色", "场景", "道具", "光色", "表演参考", "分镜关键画面"]);
const safePart = value => typeof value === "string" && value.length > 0 && value.length <= 180 &&
  value !== "." && value !== ".." && !/[\\/:\x00-\x1f]/.test(value);

function configuration(args) {
  const options = new Map();
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!FLAGS.includes(key) || !value || value.startsWith("--") || options.has(key)) throw new Error("启动参数无效。");
    if (PORTS.includes(key) && (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535)) {
      throw new Error("端口需为 1024–65535 内的整数。");
    }
    options.set(key, value);
  }
  const testFixtures = options.get("--test-fixtures");
  const official = options.has("--official-presets");
  if (official && (options.get("--official-presets") !== "enabled" || !options.has("--state"))) {
    throw new Error("官方预设需指定 --official-presets enabled 和 --state。");
  }
  if (testFixtures !== undefined && (testFixtures !== "local" || (!options.has("--workflow") && !official) ||
    !options.has("--comfy-port") || options.has("--comfy-url") || options.has("--enhancement-workflow"))) {
    throw new Error("测试素材模式需要 --test-fixtures local 和指定的本地模拟端口及生成工作流。");
  }
  const model = options.get("--assistant-model");
  if ((!model && (options.has("--assistant-port") || MODEL_FLAGS.some(flag => options.has(flag)))) ||
    MODEL_FLAGS.some(flag => options.has(flag) && !/^[a-z\d._:/-]{1,100}$/i.test(options.get(flag)))) {
    throw new Error("请指定有效的 --assistant-model，再选填本地端口或工作室模型。");
  }
  const base = { port: Number(options.get("--port") || 8765), official, assistant: model ? {
    model, vision: options.get("--vision-model") || null, port: Number(options.get("--assistant-port") || 11434),
    models: Object.fromEntries(["script", "video", "edit"].filter(role => options.has(`--${role}-model`)).map(role => [role, options.get(`--${role}-model`)]))
  } : null };
  if (base.port === base.assistant?.port) throw new Error("助手模型与工作台必须使用不同端口。");
  function enhancementConfig() {
    if (!options.has("--enhancement-workflow")) {
      if (options.has("--enhancement-video-node")) throw new Error("--enhancement-video-node 需要 --enhancement-workflow。");
      return null;
    }
    const filename = path.resolve(options.get("--enhancement-workflow"));
    if (fs.statSync(filename).size > 2 * 1024 * 1024) throw new Error("AI 增强工作流文件超过 2 MB。");
    const template = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
    return { ...aiEnhancement.configure(template, options.get("--enhancement-video-node")),
      file: filename, sha256: crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex") };
  }
  if (!options.has("--enhancement-workflow") && options.has("--enhancement-video-node")) {
    throw new Error("--enhancement-video-node 需要 --enhancement-workflow。");
  }
  if (!options.has("--workflow") && (options.has("--enhancement-workflow") || official)) {
    if (GENERATION_FLAGS.some(flag => !["--comfy-port", "--comfy-url", "--state"].includes(flag) && options.has(flag))) {
      throw new Error("AI 增强单工作流模式不能同时配置生成工作流参数。");
    }
    if (options.has("--comfy-url") && options.has("--comfy-port")) throw new Error("请选择 --comfy-url 或 --comfy-port，两项不能同时填写。");
    const comfyEndpoint = options.has("--comfy-url") ?
      endpoint(options.get("--comfy-url"), base.port, process.env.ARC_COMFY_BEARER_TOKEN) : undefined;
    return { ...base, comfyPort: Number(options.get("--comfy-port") || 8188), comfyEndpoint,
      enhancement: enhancementConfig(), name: "自定义工作流", template: null, references: [], controls: [],
      testFixtures: testFixtures === "local",
      stateFile: options.has("--state") ? path.resolve(options.get("--state")) : null };
  }
  if (!options.has("--workflow") && !GENERATION_FLAGS.some(flag => options.has(flag)) && base.assistant) return base;
  if (!options.has("--workflow") || !options.has("--prompt-node")) throw new Error("请指定 --workflow 和 --prompt-node，或仅配置本地助手。");
  if (options.has("--comfy-url") && options.has("--comfy-port")) throw new Error("请选择 --comfy-url 或 --comfy-port，两项不能同时填写。");
  const comfyEndpoint = options.has("--comfy-url") ?
    endpoint(options.get("--comfy-url"), base.port, process.env.ARC_COMFY_BEARER_TOKEN) : undefined;
  if (options.has("--image-input") && !options.has("--image-node")) throw new Error("--image-input 需要配合 --image-node。");
  if (options.has("--image-node") && options.has("--references")) throw new Error("请选用单图参数或多图配置。");
  const filename = path.resolve(options.get("--workflow"));
  if (fs.statSync(filename).size > 2 * 1024 * 1024) throw new Error("工作流文件超过 2 MB。");
  const workflowBytes = fs.readFileSync(filename);
  const template = JSON.parse(workflowBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const graphSha256 = crypto.createHash("sha256").update(workflowBytes).digest("hex");
  if (!plain(template) || !Object.keys(template).length || !Object.values(template).every(node =>
    plain(node) && typeof node.class_type === "string" && plain(node.inputs))) {
    throw new Error("请选择 ComfyUI API 格式的工作流 JSON。");
  }
  const binding = (node, input) => {
    if (!/^\d+(?::\d+)*$/.test(node) || !/^[a-zA-Z0-9_]+$/.test(input) ||
      !Object.hasOwn(template, node) || !Object.hasOwn(template[node].inputs, input) ||
      typeof template[node].inputs[input] !== "string") throw new Error(`工作流没有字符串输入 ${node}.${input}。`);
    return [node, input];
  };
  const prompt = binding(options.get("--prompt-node"), options.get("--prompt-input") || "text");
  let references = options.has("--image-node") ?
    [{ id: "reference", label: "参考图片", target: binding(options.get("--image-node"), options.get("--image-input") || "image") }] : [];
  if (options.has("--references")) {
    const file = path.resolve(options.get("--references"));
    if (fs.statSync(file).size > 16384) throw new Error("参考图绑定文件过大。");
    const roles = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(roles) || !roles.length || roles.length > 15) throw new Error("参考素材绑定需有 1 至 15 个输入。");
    references = roles.map(role => {
      if (!plain(role) || !roleId.test(role.id || "") || typeof role.label !== "string" ||
        !role.label.trim() || role.label.length > 40 || typeof role.node !== "string" ||
          (role.kind !== undefined && !["image", "video", "audio"].includes(role.kind)) ||
          (role.assetKinds !== undefined && (!Array.isArray(role.assetKinds) || !role.assetKinds.length ||
            role.assetKinds.length > assetKinds.size || role.assetKinds.some(kind => !assetKinds.has(kind)) ||
            new Set(role.assetKinds).size !== role.assetKinds.length || (role.kind && role.kind !== "image"))) ||
          (role.expectedFps !== undefined && (role.kind !== "video" || role.expectedFps !== 24)) ||
          (role.input !== undefined && typeof role.input !== "string")) throw new Error("参考素材角色字段无效。");
      const kind = role.kind || "image";
      const target = binding(role.node, role.input || (kind === "image" ? "image" : "file"));
      return { id: role.id, label: role.label.trim(), target,
        ...(kind !== "image" ? { kind } : {}), ...(role.assetKinds ? { assetKinds: [...role.assetKinds] } : {}),
        ...(role.expectedFps ? { expectedFps: role.expectedFps } : {}) };
    });
    if (new Set(references.map(role => role.id)).size !== references.length) throw new Error("参考素材角色编号重复。");
  }
  let controls = [];
  if (options.has("--controls")) {
    const file = path.resolve(options.get("--controls"));
    if (fs.statSync(file).size > 65536) throw new Error("工作流参数绑定文件过大。");
    controls = generationControls.configure(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")), template);
  }
  const bindings = [prompt, ...references.map(role => role.target), ...controls.flatMap(group => group.targets)];
  if (new Set(bindings.map(target => JSON.stringify(target))).size !== bindings.length) {
    throw new Error("提示词、参考图或工作流参数输入绑定重复。");
  }
  const h3Prompt = h3Prompts.configure(options.get("--h3-mode"), options.get("--h3-duration"), references, controls);
  const outputContract = options.has("--output-contract") ? readOutputContract(options.get("--output-contract")) : undefined;
  const ab = abProfile(template, references, bindings, h3Prompt, controls,
    options.get("--ab-motion-role"), options.get("--ab-motion-slot"));
  if (ab && !options.has("--state")) throw new Error("H3 A/B 需指定 --state 以恢复两版任务记录。");
  const enhancement = enhancementConfig();
  return {
    ...base, graphSha256,
    comfyPort: Number(options.get("--comfy-port") || 8188),
    comfyEndpoint,
    name: path.basename(filename), template, outputContract,
    prompt, references, controls, h3Prompt, enhancement, ab, testFixtures: testFixtures === "local",
    stateFile: options.has("--state") ? path.resolve(options.get("--state")) : null
  };
}

function abProfile(template, references, bindings, h3, controls, roleId, slot) {
  if (!roleId && !slot) return null;
  const videos = references.filter(role => role.kind === "video");
  const role = videos.find(item => item.id === roleId);
  if (h3?.mode !== "ref2va" || !role || videos.length !== 1 || references.some(item => item.kind === "audio") ||
      !["角色", "场景"].every(kind => references.some(item => item.assetKinds?.length === 1 && item.assetKinds[0] === kind))) {
    throw new Error("H3 A/B 需要 Ref2VA、唯一白模视频输入，以及分别绑定的角色图和场景图。");
  }
  const match = /^(\d+(?::\d+)*)\.(ref_videos\.ref_video_0)$/.exec(slot || "");
  const [, node, input] = match || [];
  const target = template[node];
  const linked = value => Array.isArray(value) && value.length === 2 && typeof value[0] === "string" &&
    Object.hasOwn(template, value[0]) && Number.isInteger(value[1]);
  if (target?.class_type !== "MiniMaxH3ReferenceToVideo" || !linked(target.inputs[input]) ||
      bindings[0][0] !== node || bindings[0][1] !== "prompt" ||
      Object.values(template).some(item => item.class_type === "MiniMaxH3ReferenceToVideo" &&
        Object.keys(item.inputs).some(key => /^(ref_videos\.|ref_video_audios\.)/.test(key) &&
          (item !== target || key !== input)))) {
    throw new Error("A/B 需将提示词绑定到同一个原生 H3 节点的 prompt，并指定唯一 ref_videos.ref_video_0。白模支路不接入音频。");
  }
  function lineage(connection) {
    const result = new Set();
    const queue = linked(connection) ? [connection[0]] : [];
    while (queue.length) {
      const id = queue.pop();
      if (result.has(id)) continue;
      result.add(id);
      for (const value of Object.values(template[id].inputs)) if (linked(value)) queue.push(value[0]);
    }
    return result;
  }
  const sharedImages = references.filter(item => !item.kind || item.kind === "image");
  if (sharedImages.some((item, index) =>
    !lineage(target.inputs[`ref_images.ref_image_${index}`]).has(item.target[0]))) {
    throw new Error("A/B 共用图需依参考配置顺序连接到 H3 的 ref_images.ref_image_N。");
  }
  const seeds = Object.values(template).flatMap(item => Object.entries(item.inputs)
    .filter(([key]) => key === "seed" || key === "noise_seed").map(([, value]) => value));
  if (!seeds.length || seeds.some(seed => !Number.isSafeInteger(seed) || seed < 0)) {
    throw new Error("A/B 需要在 API 工作流中使用固定的整数 seed 或 noise_seed。");
  }
  const exactSeconds = frameCount => Number.isInteger(frameCount) && frameCount >= 5
    ? +((Math.ceil((frameCount - 5) / 17) * 17 + 5) / 24).toFixed(2) : NaN;
  const duration = controls.find(group => group.id === "duration");
  const lengthIndex = duration?.targets.findIndex(([id, field]) => id === node && field === "length");
  if (h3.seconds !== undefined ? h3.seconds !== exactSeconds(target.inputs.length)
    : !(lengthIndex >= 0 && duration.options.every(option => option.seconds === exactSeconds(option.values[lengthIndex])))) {
    throw new Error("A/B 声明的秒数须对应 H3 length 的实际帧数。按 17n+5 对齐后，以 24 fps 计算。");
  }
  const ancestors = lineage(target.inputs[input]);
  const textTemplate = structuredClone(template);
  delete textTemplate[node].inputs[input];
  const consumers = () => new Set(Object.values(textTemplate).flatMap(item =>
    Object.values(item.inputs).filter(linked).map(value => value[0])));
  const removed = new Set();
  let changed;
  do {
    changed = false;
    const used = consumers();
    for (const id of ancestors) if (Object.hasOwn(textTemplate, id) && !used.has(id)) {
      delete textTemplate[id];
      removed.add(id);
      changed = true;
    }
  } while (changed);
  if (!removed.has(role.target[0]) || bindings.some(binding => binding !== role.target && removed.has(binding[0]))) {
    throw new Error("白模支路必须独立，不能同时驱动或移除共用角色、场景、提示词或生成参数。");
  }
  return { role: role.id, slot, textTemplate,
    profile: crypto.createHash("sha256").update(JSON.stringify([template, references, h3, controls, slot])).digest("hex") };
}

async function limitedJson(req, limit = 12_000_000) {
  let size = 0;
  const chunks = [];
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw new Error("请求超过大小限制。");
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function journal(config, references, controls) {
  if (!config.stateFile) return { jobs: new Map(), persist() {} };
  const filename = config.stateFile;
  const basis = [config.port, config.comfyPort, config.template, config.prompt, references];
  if (config.enhancement) basis.push(config.enhancement.sha256);
  if (controls.length) basis.push(controls);
  if (config.comfyEndpoint) basis.push(config.comfyEndpoint.base);
  if (config.h3Prompt) basis.push(config.h3Prompt);
  if (config.ab) basis.push(config.ab);
  if (config.testFixtures) basis.push("local-test-fixtures");
  const domain = crypto.createHash("sha256").update(JSON.stringify(basis)).digest("hex");
  const jobs = new Map();
  if (fs.existsSync(filename)) {
    if (fs.statSync(filename).size > 1_000_000) throw new Error("生成任务记录超过大小限制。");
    const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (saved?.schema !== "arc-comfy-jobs-v1" || saved.domain !== domain || !Array.isArray(saved.jobs)) {
      throw new Error("任务记录与当前工作流、输入绑定或端口不匹配。请使用原配置或新的记录文件。");
    }
    for (const item of saved.jobs) {
      if (!plain(item) || !uuid.test(item.id || "") || jobs.has(item.id) ||
        (item.peerId != null && !uuid.test(item.peerId)) || !["submitting", "failed", "unconfirmed", "queued"].includes(item.state) ||
        (item.state === "queued") !== Boolean(item.peerId) || ![undefined, "generation", "enhancement"].includes(item.kind) ||
        (item.comparison !== undefined && !validComparison(item.comparison))) throw new Error("任务记录损坏。");
      jobs.set(item.id, { id: item.id, peerId: item.peerId, kind: item.kind || "generation",
        providerFingerprint: sha.test(item.providerFingerprint || "") ? item.providerFingerprint : undefined,
        workflowName: typeof item.workflowName === "string" ? item.workflowName : undefined,
        acceptedAt: jobTiming.timestamp(item.acceptedAt), firstTerminalSeenAt: jobTiming.timestamp(item.firstTerminalSeenAt),
        settings: jobTiming.metadata(item.settings),
        workflowDeclaration: workflowManifest.sanitize(item.workflowDeclaration),
        submittedGraphSha256: sha.test(item.submittedGraphSha256 || "") ? item.submittedGraphSha256 : undefined,
        executionPromptEvidence: plain(item.executionPromptEvidence) &&
          item.executionPromptEvidence.evidence === "comfy-history-prompt" &&
          ["matched", "mismatch", "unavailable"].includes(item.executionPromptEvidence.status) &&
          (item.executionPromptEvidence.submittedSha256 == null || sha.test(item.executionPromptEvidence.submittedSha256)) &&
          (item.executionPromptEvidence.historySha256 == null || sha.test(item.executionPromptEvidence.historySha256)) ?
          item.executionPromptEvidence : undefined,
        comparison: item.comparison,
        effectivePromptSha256: sha.test(item.effectivePromptSha256 || "") ? item.effectivePromptSha256 : undefined,
        firstFrameProof: sha.test(item.firstFrameProof || "") ? item.firstFrameProof : undefined,
        state: item.state === "submitting" ? "unconfirmed" : item.state });
    }
  } else if (!fs.statSync(path.dirname(filename)).isDirectory()) {
    throw new Error("请为任务记录选择已有的文件夹。");
  }
  return { jobs, persist() {
    const temporary = filename + "." + crypto.randomUUID() + ".tmp";
    const state = { schema: "arc-comfy-jobs-v1", domain, jobs: [...jobs.values()].map(job => ({
      id: job.id, peerId: job.peerId, kind: job.kind || "generation", workflowName: job.workflowName,
      providerFingerprint: job.providerFingerprint,
      state: job.state || "submitting",
      acceptedAt: job.acceptedAt, firstTerminalSeenAt: job.firstTerminalSeenAt, settings: job.settings, comparison: job.comparison,
      workflowDeclaration: job.workflowDeclaration,
      submittedGraphSha256: job.submittedGraphSha256,
      executionPromptEvidence: job.executionPromptEvidence,
      effectivePromptSha256: job.effectivePromptSha256,
      firstFrameProof: job.firstFrameProof
    })) };
    let fd;
    try {
      fd = fs.openSync(temporary, "wx");
      fs.writeFileSync(fd, JSON.stringify(state), "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, filename);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  } };
}

function readers(config) {
  const profile = config.comfyEndpoint;
  const base = profile?.base || `http://127.0.0.1:${config.comfyPort}`;
  async function upstream(route, options = {}, timeout = 8000) {
    const headers = new Headers(options.headers);
    if (profile?.credential) headers.set("Authorization", "Bearer " + profile.credential);
    const budget = AbortSignal.timeout(timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, budget]) : budget;
    return fetch(base + route, { ...options, headers, redirect: "error", signal });
  }
  async function query(route, options, timeout) {
    const res = await upstream(route, options, timeout);
    if (!res.ok) {
      if (profile) await res.body?.cancel().catch(() => {});
      const detail = profile ? {} : await res.json().catch(() => ({}));
      const reason = typeof detail.error?.message === "string" ? detail.error.message.slice(0, 180) : "";
      throw new Error(`ComfyUI 返回 HTTP ${res.status}${reason ? " · " + reason : ""}`);
    }
    return res.json();
  }
  return { upstream, query };
}

function collectVideos(outputs) {
  const result = [];
  const seen = new Set();
  for (const node of Object.values(outputs || {})) {
    for (const files of Object.values(node || {})) {
      if (!Array.isArray(files)) continue;
      for (const item of files) {
        if (!item || item.type !== "output" || !safePart(item.filename) ||
          !VIDEO.has(path.extname(item.filename).toLowerCase())) continue;
        const subfolder = typeof item.subfolder === "string" ? item.subfolder.replace(/\\/g, "/") : "";
        if (subfolder && (subfolder.length > 360 || !subfolder.split("/").every(safePart))) continue;
        const key = subfolder + "/" + item.filename;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ filename: item.filename, subfolder, type: "output" });
        if (result.length === 24) return result;
      }
    }
  }
  return result;
}

const resultKey = file => crypto.createHash("sha256").update(JSON.stringify([file.filename, file.subfolder, file.type])).digest("hex");

async function fingerprintRemoteVideo(upstream, file) {
  const remote = await upstream("/view?" + new URLSearchParams(file), {}, 120000);
  if (!remote.ok || !remote.body) {
    await remote.body?.cancel().catch(() => {});
    throw new Error(`ComfyUI 视频指纹读取失败（HTTP ${remote.status}）。`);
  }
  const declaredSize = Number(remote.headers.get("content-length"));
  const maxBytes = 2 * 1024 ** 3;
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    await remote.body.cancel().catch(() => {});
    throw new Error("回片超过 2 GiB 指纹核验上限；请先在本地 ARC 绑定文件后验收。");
  }
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    sizeBytes += chunk.length;
    if (sizeBytes > maxBytes) return callback(new Error("回片超过 2 GiB 指纹核验上限。"));
    hash.update(chunk);
    callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(remote.body), meter, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  } catch (error) {
    throw new Error(`回片内容哈希未完成：${error.message}`);
  }
  if (Number.isFinite(declaredSize) && declaredSize !== sizeBytes) throw new Error("回片长度与上游声明不一致，拒绝生成内容指纹。");
  return { sha256: hash.digest("hex"), sizeBytes };
}

function generationServer(config) {
  if (!config.official) return workflowServer(config).server;
  const handlers = [];
  const baseline = workflowServer(config, handlers);
  const choices = officialWorkflows.presets(abProfile);
  const profiles = new Map(choices.map(choice => [choice.id, workflowServer({
    ...config, template: null, references: [], controls: [], prompt: null, h3Prompt: null, ab: null, enhancement: null,
    ...choice, stateFile: config.stateFile + "." + choice.id
  }, handlers)]));
  handlers.push(baseline, ...profiles.values());
  const origin = `http://127.0.0.1:${config.port}`;
  const json = (res, status, value) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  return http.createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${config.port}`) return json(res, 403, { error: "请通过本机工作台地址访问。" });
    const url = new URL(req.url, origin);
    if (req.method === "GET" && url.pathname === "/api/workflow-presets") {
      return json(res, 200, {
        defaultGeneration: Boolean(config.template), defaultEnhancement: Boolean(config.enhancement),
        presets: choices.map(({ id, name, kind, source, output, graphSha256, enhancement }) =>
          ({ id, name, kind, source, output, graphSha256: graphSha256 || enhancement?.sha256 }))
      });
    }
    const id = url.searchParams.get("preset");
    if (id && !profiles.has(id)) return json(res, 400, { error: "工作流预设不存在。" });
    const job = /^\/api\/(generation|enhancement)\/([a-f\d-]+)(?:\/video\/\d+(?:\/sha256)?)?$/i.exec(url.pathname);
    const owner = job && handlers.find(handler => handler.ownsJob(job[2], job[1]));
    const handler = owner || profiles.get(id) || baseline;
    handler.server.emit("request", req, res);
  });
}

function workflowServer(config, handlers = []) {
  if (!config.comfyEndpoint && config.port === config.comfyPort) throw new Error("工作台和 ComfyUI 必须使用不同端口。");
  const { upstream, query } = readers(config);
  const references = config.references ?? (config.image ? [{ id: "reference", label: "参考图片", target: config.image }] : []);
  const controls = config.controls || [];
  const controlOptions = generationControls.describe(controls);
  function selections(data) {
    if (data.promptMode !== undefined && data.promptMode !== config.h3Prompt?.mode) {
      throw new Error("提示词模式已变更，请刷新工作台后重新核对。");
    }
    return generationControls.select(controls, data.controlsProfile, data.controls, controlOptions.profile);
  }
  function preflightSelections(url) {
    if (!url.searchParams.has("controls")) return generationControls.select(controls, controlOptions.profile, null, controlOptions.profile);
    let requested;
    try { requested = JSON.parse(url.searchParams.get("controls")); }
    catch { throw new Error("预检参数格式无效，请刷新工作台后重试。"); }
    return selections({ controlsProfile: url.searchParams.get("controlsProfile"), controls: requested,
      ...(url.searchParams.has("promptMode") ? { promptMode: url.searchParams.get("promptMode") } : {}) });
  }
  function validateReferenceAssetKinds(data) {
    const constrained = references.filter(role => role.assetKinds);
    if (!constrained.length) return;
    if (!plain(data.referenceAssetKinds)) throw new Error("请为角色或场景输入绑定正确类别的参考图。");
    for (const role of constrained) {
      if (!role.assetKinds.includes(data.referenceAssetKinds[role.id])) {
        throw new Error(`「${role.label}」只接受 ${role.assetKinds.join("、")} 类参考图。`);
      }
    }
    if (Object.keys(data.referenceAssetKinds).some(id => !references.some(role => role.id === id &&
      role.assetKinds && role.assetKinds.includes(data.referenceAssetKinds[id])))) {
      throw new Error("参考图类别与工作流输入不匹配。");
    }
  }
  const { jobs, persist } = journal(config, references, controls);
  const origin = `http://127.0.0.1:${config.port}`;
  const reply = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  function sameOrigin(req, media = false) {
    const type = req.headers["content-type"]?.split(";")[0].trim().toLowerCase();
    return req.headers.origin === origin && (type === "application/json" || (media && type === "multipart/form-data"));
  }

  function jobView(job, status, entry) {
    const comparison = job.comparison ? { id: job.comparison.id, variant: job.comparison.variant,
      ...(job.comparison.mode ? { mode: job.comparison.mode } : {}),
      ...(job.comparison.parameterDiff ? { parameterDiff: job.comparison.parameterDiff } : {}),
      ...(job.comparison.cueDigest ? { cueDigest: job.comparison.cueDigest } : {}),
      ...(job.comparison.variant === "B" ? { motionDigest: job.comparison.motionDigest,
        ...(validMotionReference(job.comparison.motionReference) ? { motionReference: job.comparison.motionReference } : {}) } : {}) } : null;
    const outputContract = job.outputContract || (config.id ? config.output : config.outputContract);
    return { id: job.id, status, error: job.error, acceptedAt: job.acceptedAt,
      ...(config.id ? { preset: config.id, scale: config.enhancement?.scale,
        graphSha256: config.graphSha256 || config.enhancement?.sha256 } : {}),
      ...(outputContract ? { outputContract } : {}),
      ...(!config.id && config.graphSha256 ? { graphSha256: config.graphSha256 } : {}),
      ...(config.enhancement ? { scale: config.enhancement.scale, graphSha256: config.enhancement.sha256 } : {}),
      ...(sha.test(job.providerFingerprint || "") ? { providerFingerprint: job.providerFingerprint } : {}),
      ...(job.firstFrameProof ? { firstFrameProof: job.firstFrameProof } : {}),
      ...(sha.test(job.effectivePromptSha256 || "") ? { effectivePromptSha256: job.effectivePromptSha256 } : {}),
      testFixture: config.testFixtures === true,
      ...(comparison ? { comparison } : {}),
      workflow: job.workflowName || config.name, settings: job.settings || [],
      ...(job.workflowDeclaration ? { workflowDeclaration: job.workflowDeclaration } : {}),
      ...(plain(job.executionPromptEvidence) ? { executionPromptEvidence: job.executionPromptEvidence } :
        sha.test(job.submittedGraphSha256 || "") ? { executionPromptEvidence: { evidence: "comfy-history-prompt",
          status: "pending", submittedSha256: job.submittedGraphSha256, historySha256: null } } : {}),
      timing: jobTiming.timing(job, entry, Date.now()) };
  }

  async function startEnhancement(job, video) {
    if (!config.enhancement) throw new Error("未配置 AI 视频增强工作流。");
    job.workflowName = config.enhancement.name;
    job.workflowDeclaration = workflowManifest.describe(config.enhancement.template);
    await aiEnhancement.submit({ config: config.enhancement, query, job, video });
    return jobView(job, "queued");
  }

  async function start(job) {
    const mode = job.comparison?.mode || "motion";
    const withoutMotion = mode !== "motion" || job.comparison?.variant === "A";
    const activeReferences = withoutMotion ? references.filter(role => role.id !== config.ab.role) : references;
    const prompt = structuredClone(withoutMotion ? config.ab.textTemplate : config.template);
    const [node, input] = config.prompt;
    prompt[node].inputs[input] = job.prompt;
    generationControls.apply(prompt, job.controls);
    const supplied = job.images ?? (job.image ? { reference: job.image } : {});
    const imageRoles = activeReferences.filter(role => !role.kind || role.kind === "image");
    if (!plain(supplied) || Object.keys(supplied).length !== imageRoles.length ||
        job.referenceFiles.size !== activeReferences.length - imageRoles.length) throw new Error("请为工作流的每个参考输入选择素材。");
    const inputs = await Promise.all(activeReferences.map(async role => {
      if (role.kind === "audio" || role.kind === "video") {
        return { role, ...(await referenceMedia.mediaSpec(role, job.referenceFiles.get(role.id))) };
      }
      const image = Object.hasOwn(supplied, role.id) ? supplied[role.id] : null;
      const match = typeof image === "string" && /^data:image\/(png|jpeg|webp);base64,([a-z\d+/]+={0,2})$/i.exec(image);
      if (!match) throw new Error(`「${role.label}」缺少可用的参考图。`);
      const ext = match[1].toLowerCase();
      return { role, image, ext, blob: new Blob([Buffer.from(match[2], "base64")], { type: `image/${ext}` }) };
    }));
    if (job.comparison?.mode === "motion" && job.comparison.variant === "B") {
      const evidence = inputs.find(item => item.role.id === config.ab?.role)?.metadata;
      if (!evidence || !validMotionReference(evidence)) throw new Error("白模帧率证据缺失或格式无效，未提交 H3 任务。");
      job.comparison.motionReference = { source: evidence.source, frameCount: evidence.frameCount,
        durationSeconds: evidence.durationSeconds, fps: evidence.fps, frameRateMode: evidence.frameRateMode,
        codec: evidence.codec ?? null, hasAudio: evidence.hasAudio, audioTrackCount: evidence.audioTrackCount };
    }
    const uploadedFiles = new Map();
    for (const { role, image, ext, blob } of inputs) {
      let filename = image && uploadedFiles.get(image);
      if (!filename) {
        const form = new FormData();
        form.append("image", blob, `arc-${job.id}-${role.id}.${ext}`);
        form.append("type", "input");
        const uploaded = await query("/upload/image", { method: "POST", body: form });
        if (!safePart(uploaded.name) || uploaded.subfolder) throw new Error("ComfyUI 返回了无法使用的参考素材名称。");
        filename = uploaded.name;
        if (image) uploadedFiles.set(image, filename);
      }
      const [referenceNode, referenceInput] = role.target;
      prompt[referenceNode].inputs[referenceInput] = filename;
    }
    job.workflowDeclaration = workflowManifest.describe(prompt);
    job.submittedGraphSha256 = promptDigest(prompt);
    job.effectivePromptSha256 = crypto.createHash("sha256").update(prompt[node].inputs[input]).digest("hex");
    // Once POST begins a network failure can leave a real task on the peer.
    job.submitted = true;
    const response = await query("/prompt", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, client_id: job.id }) });
    if (!uuid.test(response.prompt_id || "")) throw new Error("ComfyUI 未返回可查询的任务编号。");
    job.peerId = response.prompt_id;
    return jobView(job, "queued");
  }

  async function status(job, readQueue = () => query("/queue"), signal) {
    if (!job.peerId) return jobView(job, job.state || "submitting");
    if (job.final) return job.final;
    const history = await query("/history/" + job.peerId, { signal });
    const entry = history[job.peerId];
    if (!entry) {
      const queue = await readQueue();
      const contains = items => Array.isArray(items) && items.some(item => item?.[1] === job.peerId);
      return jobView(job, contains(queue.queue_running) ? "running" : contains(queue.queue_pending) ? "queued" : "awaiting");
    }
    const historyPrompt = Array.isArray(entry.prompt) && plain(entry.prompt[2]) ? entry.prompt[2] : null;
    const historyPromptSha256 = historyPrompt ? promptDigest(historyPrompt) : null;
    const submittedGraphSha256 = sha.test(job.submittedGraphSha256 || "") ? job.submittedGraphSha256 : null;
    job.executionPromptEvidence = { evidence: "comfy-history-prompt",
      status: !historyPrompt || !submittedGraphSha256 ? "unavailable" :
        historyPromptSha256 === submittedGraphSha256 ? "matched" : "mismatch",
      ...(submittedGraphSha256 ? { submittedSha256: submittedGraphSha256 } : {}),
      ...(historyPromptSha256 ? { historySha256: historyPromptSha256 } : {}) };
    const videos = collectVideos(entry.outputs);
    const state = entry.status?.status_str === "error" ? "failed" : videos.length ? "complete" :
      entry.status?.completed ? "no_video" : "awaiting";
    if (state === "awaiting") return jobView(job, state);
    if (job.firstTerminalSeenAt === undefined) {
      job.firstTerminalSeenAt = Date.now();
      try { persist(); } catch { /* GPU results remain available even if the timing record cannot be saved. */ }
    }
    job.files = state === "complete" ? videos : [];
    job.final = { ...jobView(job, state, entry), outputs: job.files.map((file, i) => ({
      name: file.filename, assetKey: resultKey(file), url: `/api/${job.kind === "enhancement" ? "enhancement" : "generation"}/${job.id}/video/${i}`
    })) };
    return job.final;
  }

  async function serveVideo(req, res, job, index, paramsFromClient) {
    if (!job.files && job.peerId) await status(job);
    const expected = paramsFromClient.get("file"), key = paramsFromClient.get("asset");
    const file = key == null ? job.files?.[index] : job.files?.find(item => resultKey(item) === key);
    if (!file && key == null) return reply(res, 404, { error: "没有对应的生成视频。" });
    if (!file || (expected != null && file.filename !== expected)) {
      return reply(res, 409, { error: "回传视频与候选版本的文件身份不一致。" });
    }
    const params = new URLSearchParams(file);
    const range = req.headers.range;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return reply(res, 416, { error: "视频范围无效。" });
    const remote = await upstream("/view?" + params, { headers: range ? { Range: range } : {} }, 120000);
    if (!remote.ok || !remote.body) return reply(res, remote.status === 416 ? 416 : 502, { error: "ComfyUI 视频读取失败。" });
    const headers = { "Content-Type": TYPES[path.extname(file.filename).toLowerCase()], "Cache-Control": "no-store" };
    for (const key of ["content-length", "content-range", "accept-ranges"]) {
      const value = remote.headers.get(key);
      if (value) headers[key] = value;
    }
    res.writeHead(remote.status, headers);
    await pipeline(Readable.fromWeb(remote.body), res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== `127.0.0.1:${config.port}`) return reply(res, 403, { error: "请通过本机工作台地址访问。" });
      const url = new URL(req.url, origin);
      const route = url.pathname;
      if (req.method === "GET" && route === "/api/assistant") {
        return config.assistant ? reply(res, 200, { model: config.assistant.model, models: config.assistant.models, vision: config.assistant.vision,
          ...(config.testFixtures ? { testFixture: true } : {}) }) :
          reply(res, 503, { error: "未配置本地助手模型。" });
      }
      if (req.method === "POST" && route === "/api/assistant") {
        if (!sameOrigin(req)) return reply(res, 403, { error: "仅接受当前工作台的助手请求。" });
        if (!config.assistant) return reply(res, 503, { error: "未配置本地助手模型。" });
        const data = await limitedJson(req, 1_500_000);
        let settings = [];
        let h3Draft = null;
        if (data?.mode === "prompt") {
          try {
            settings = selections(data).map(([group, option]) => ({ label: group.label, choice: option.label, seconds: option.seconds }));
            if (Array.isArray(data.referenceRoles)) {
              data.referenceRoles = data.referenceRoles.map(item => {
                const configured = references.find(role => role.id === item?.role);
                if (item?.mediaName != null && !["audio", "video"].includes(configured?.kind)) {
                  throw new Error("音视频参考未绑定到工作流中对应的输入。");
                }
                return { ...item, kind: configured?.kind || "image" };
              });
            }
            if (data.abDraft === true && !config.ab) throw new Error("未启用 H3 A/B 对照。");
            const draftProfile = data.abDraft === true ? { ...config.h3Prompt,
              inputs: config.h3Prompt.inputs.filter(role => role.id !== config.ab.role) } : config.h3Prompt;
            h3Draft = h3Prompts.prepare(draftProfile, settings, data.referenceRoles);
          } catch (error) { return reply(res, 400, { error: error.message }); }
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once("close", cancel);
        try {
          const result = await assistant.answer(config.assistant, data, controller.signal, settings, h3Draft);
          if (!res.destroyed) return reply(res, 200, result);
          return;
        } finally {
          res.removeListener("close", cancel);
        }
      }
      if (req.method === "GET" && route === "/api/enhancement") {
        if (!config.enhancement) return reply(res, 503, { error: "未配置 AI 视频增强工作流。" });
        const [node, input] = config.enhancement.video;
        return reply(res, 200, { workflow: config.enhancement.name, sha256: config.enhancement.sha256, scale: config.enhancement.scale,
          workflowDeclaration: workflowManifest.describe(config.enhancement.template),
          seedvr2DenoiseDeclared: aiEnhancement.declaresSeedvr2Denoise(config.enhancement),
          providerFingerprint: providerFingerprint(config),
          ...(config.testFixtures ? { testFixture: true } : {}),
          input: { node, field: input, type: "ComfyUI LoadVideo" }, maximumVideoBytes: aiEnhancement.MAX_VIDEO,
          resolutionControl: config.enhancement.resolution ? { node: config.enhancement.resolution[0],
            field: config.enhancement.resolution[1], mode: config.enhancement.resolutionMode } : null,
           denoiseControl: config.enhancement.denoise ? { node: config.enhancement.denoise[0], field: config.enhancement.denoise[1],
             value: config.enhancement.template[config.enhancement.denoise[0]].inputs[config.enhancement.denoise[1]] } : null,
          persistent: Boolean(config.stateFile), modelAndParameters: "以已配置的 ComfyUI API 工作流为准" });
      }
      if (req.method === "GET" && route === "/api/enhancement/preflight") {
        if (!config.enhancement) return reply(res, 503, { error: "未配置 AI 视频增强工作流。" });
        const controls = config.enhancement.resolution ? [{ label: "目标短边", targets: [config.enhancement.resolution],
          options: [{ label: "720", values: [720] }, { label: "1080", values: [1080] }] }] : [];
        return reply(res, 200, await preflight.inspect({ template: config.enhancement.template,
          prompt: config.enhancement.video, references: [], controls }, query));
      }
      if (route.startsWith("/api/enhancement") && !config.enhancement) {
        return reply(res, 503, { error: "未配置 AI 视频增强工作流。" });
      }
      if (req.method === "POST" && route === "/api/enhancement") {
        if (!sameOrigin(req, true)) return reply(res, 403, { error: "仅接受当前工作台发出的增强任务。" });
        if (!req.headers["content-type"]?.toLowerCase().startsWith("multipart/form-data")) {
          return reply(res, 400, { error: "增强任务需使用 multipart/form-data。" });
        }
        let data, video;
        try { ({ data, video } = await aiEnhancement.readSubmission(req)); }
        catch (error) { return reply(res, 400, { error: /[\u4e00-\u9fff]/.test(error.message) ? error.message : "无法解析 AI 增强任务。" }); }
        let targetResolution;
        try { targetResolution = aiEnhancement.nativeResolution(config.enhancement, data); }
        catch (error) { return reply(res, 400, { error: error.message }); }
        const resolutionMismatch = config.enhancement.resolution ?
          (![720, 1080].includes(data.options.shortEdge) || (config.enhancement.resolutionMode === "height" ?
            data.options.nativeResolution !== targetResolution : data.options.nativeResolution != null)) :
          data.options.shortEdge !== null || data.options.nativeResolution != null;
        const denoiseMismatch = config.enhancement.denoise ? !Number.isFinite(data.options.denoise) :
          data.options.denoise !== undefined && data.options.denoise !== null;
        if (data.options.workflowSha256 !== config.enhancement.sha256 ||
          data.providerFingerprint !== providerFingerprint(config) ||
          data.options.scale !== config.enhancement.scale ||
           resolutionMismatch || denoiseMismatch) {
          return reply(res, 409, { error: "工作流或参数设置已变化，请刷新工作台并重新生成裁切任务。" });
        }
        const controls = config.enhancement.resolution ? [{
          label: config.enhancement.resolutionMode === "height" ? "SeedVR2 目标输出高度" : "目标短边",
          targets: [config.enhancement.resolution], options: [{ label: String(targetResolution), values: [targetResolution] }]
        }] : [];
        if (config.enhancement.denoise) controls.push({ label: "SeedVR2 denoise", targets: [config.enhancement.denoise],
          options: [{ label: String(data.options.denoise), values: [data.options.denoise] }] });
        let check;
        try { check = await preflight.inspect({ template: config.enhancement.template, prompt: config.enhancement.video,
          references: [], controls }, query); }
        catch { return reply(res, 502, { error: "无法重新读取 ComfyUI 节点定义；未提交增强任务。" }); }
        if (check.schemaSha256 !== data.options.preflightSchemaSha256) {
          return reply(res, 409, { error: "ComfyUI 节点定义已变化，请重新预检并建立新增强任务；未上传视频。", preflight: check });
        }
        if (check.issues > 0) return reply(res, 409, { error: "本镜头目标尺寸未通过 ComfyUI 工作流预检；未提交生成任务。", preflight: check });
        const prior = jobs.get(data.id);
        if (!prior && handlers.some(handler => handler.ownsJob(data.id, "generation") || handler.ownsJob(data.id, "enhancement"))) {
          return reply(res, 409, { error: "此编号已用于其他工作流。" });
        }
        if (prior) return prior.kind === "enhancement" ? reply(res, 200, await status(prior)) :
          reply(res, 409, { error: "此任务编号已用于视频生成。" });
        if (jobs.size >= 200) return reply(res, 429, { error: "本次会话已记录 200 个任务。" });
        const job = { id: data.id, kind: "enhancement", shot: data.shot, source: data.source,
          media: data.media, options: data.options, providerFingerprint: data.providerFingerprint, acceptedAt: Date.now(),
          workflowName: config.enhancement.name, workflowDeclaration: workflowManifest.describe(config.enhancement.template),
          settings: [...(config.enhancement.resolution ? [{
            label: config.enhancement.resolutionMode === "height" ? "目标短边 / SeedVR2 输出高度" : "目标短边",
            value: `${data.options.shortEdge} / ${targetResolution}` }] : []),
            ...(config.enhancement.denoise ? [{ label: "SeedVR2 模型 denoise（实验）", value: data.options.denoise }] : [])] };
        jobs.set(job.id, job);
        try { persist(); }
        catch {
          jobs.delete(job.id);
          return reply(res, 200, { ...jobView(job, "failed"), error: "无法保存任务记录，未提交到 ComfyUI。" });
        }
        try {
          const result = await startEnhancement(job, video);
          job.state = "queued";
          try { persist(); }
          catch { result.error = "已提交，但任务编号未能写入磁盘。请暂时保持桥接运行。"; }
          return reply(res, 202, result);
        } catch (error) {
          job.state = job.submitted ? "unconfirmed" : "failed";
          if (!job.submitted) job.firstTerminalSeenAt = Date.now();
          job.error = error.message;
          try { persist(); } catch { /* Retain the in-memory task for status recovery. */ }
          return reply(res, 200, await status(job));
        }
      }
      if (req.method === "GET" && route === "/api/generation/jobs") {
        if (!config.template && !handlers.length) return reply(res, 503, { error: "未配置 ComfyUI 工作流。" });
        if (req.headers["sec-fetch-site"] === "cross-site") return reply(res, 403, { error: "仅允许工作台读取镜头任务。" });
        const ids = (url.searchParams.get("ids") || "").split(",");
        if (ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !uuid.test(id))) {
          return reply(res, 400, { error: "镜头任务列表无效。" });
        }
        const cancel = new AbortController();
        const close = () => cancel.abort();
        res.once("close", close);
        const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(24000)]);
        let pendingQueue;
        const readQueue = () => pendingQueue ??= query("/queue", { signal });
        let next = 0;
        const results = new Array(ids.length);
        async function collect() {
          while (next < ids.length) {
            const index = next++;
            const id = ids[index];
            const owner = handlers.find(handler => handler.ownsJob(id, "generation"));
            results[index] = await (owner?.overview || overview)(id, readQueue, signal);
          }
        }
        try { await Promise.all(Array.from({ length: Math.min(4, ids.length) }, collect)); }
        finally { res.removeListener("close", close); }
        if (res.destroyed) return;
        return reply(res, 200, { jobs: results });
      }
      if (route.startsWith("/api/generation") && !config.template) return reply(res, 503, { error: "未配置 ComfyUI 工作流。" });
      const connection = config.comfyEndpoint ? { transport: config.comfyEndpoint.transport, host: config.comfyEndpoint.host } :
        { transport: "local" };
      if (req.method === "GET" && route === "/api/generation/connection") {
        try {
          const queue = await query("/queue");
          if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue?.queue_pending)) {
            return reply(res, 502, { error: "服务已响应，但未返回兼容的 ComfyUI 队列。" });
          }
          return reply(res, 200, { ...connection, running: queue.queue_running.length, queued: queue.queue_pending.length });
        } catch (error) {
          const reason = /^ComfyUI 返回 HTTP \d{3}/.exec(error.message)?.[0];
          return reply(res, 502, { error: reason || "未能访问 ComfyUI，请核对地址、连接和访问凭据。" });
        }
      }
      if (req.method === "GET" && route === "/api/generation/preflight") {
        if (req.headers["sec-fetch-site"] === "cross-site") return reply(res, 403, { error: "仅允许工作台发起预检。" });
        let selected;
        try { selected = preflightSelections(url); }
        catch (error) { return reply(res, 400, { error: error.message }); }
        return reply(res, 200, { ...await preflight.inspect({ template: config.template, prompt: config.prompt, references, controls }, query),
          graphSha256: config.graphSha256 || null,
          ...(selectedOutputContract(config, selected) ?
            { outputContract: selectedOutputContract(config, selected) } : {}) });
      }
      if (req.method === "GET" && route === "/api/generation") return reply(res, 200, { workflow: config.name,
        ...(config.id ? { preset: config.id, graphSha256: config.graphSha256 } : {}),
        ...((config.id ? config.output : config.outputContract) ? { outputContract: config.id ? config.output : config.outputContract } : {}),
        ...(!config.id && config.graphSha256 ? { graphSha256: config.graphSha256 } : {}),
        providerFingerprint: providerFingerprint(config),
        connection, ...(config.testFixtures ? { testFixture: true } : {}),
        ...(config.ab ? { ab: { motionRole: config.ab.role, slot: config.ab.slot, profile: config.ab.profile } } : {}),
        promptMode: config.h3Prompt ? { id: config.h3Prompt.mode, label: config.h3Prompt.label, seconds: config.h3Prompt.seconds } : null,
        image: references.some(role => !role.kind || role.kind === "image"),
        references: references.map(({ id, label, kind, assetKinds: allowed }) => ({ id, label, kind: kind || "image",
          ...(allowed ? { assetKinds: allowed } : {}) })),
        controls: controlOptions.controls, controlsProfile: controlOptions.profile,
        modelFilesByControl: modelFilesByControl(config.template, controls), persistent: Boolean(config.stateFile) });
      if (req.method === "POST" && route === "/api/generation") {
        if (!sameOrigin(req, true)) {
          return reply(res, 403, { error: "仅接受当前工作台发出的提交。" });
        }
        let data, files;
        try {
          if (req.headers["content-type"].toLowerCase().startsWith("multipart/form-data")) {
            ({ data, files } = await referenceMedia.readSubmission(req, references));
          } else { data = await limitedJson(req); files = new Map(); }
        } catch (error) {
          return reply(res, 400, { error: /[\u4e00-\u9fff]/.test(error.message) ? error.message : "无法解析参考素材请求。" });
        }
        if (!plain(data) || !uuid.test(data.id || "") || typeof data.prompt !== "string" || !data.prompt.trim() ||
          data.prompt.length > 20000 || (data.image != null && typeof data.image !== "string") ||
          (data.images != null && (!plain(data.images) || data.image != null))) {
          return reply(res, 400, { error: "生成任务参数无效。" });
        }
        const prior = jobs.get(data.id);
        if (!prior && handlers.some(handler => handler.ownsJob(data.id, "generation") || handler.ownsJob(data.id, "enhancement"))) {
          return reply(res, 409, { error: "此编号已用于其他工作流。" });
        }
        if (prior) return prior.kind === "generation" && prior.comparison?.id === data.comparison?.id &&
          prior.comparison?.variant === data.comparison?.variant &&
          (prior.comparison?.mode || "motion") === (data.comparison?.mode || "motion") &&
          prior.comparison?.motionDigest === data.comparison?.motionDigest &&
          prior.comparison?.cueDigest === data.comparison?.cueDigest ? reply(res, 200, await status(prior)) :
          reply(res, 409, { error: "此任务编号已被其他对照或任务占用。" });
        if (data.workflowSha256 !== config.graphSha256) {
          return reply(res, 409, { error: data.comparison !== undefined ?
            "A/B 锁定的工作流 SHA-256 与当前服务端配置不一致，未提交到 ComfyUI。请刷新工作流并重新锁定。" :
            "单镜锁定的工作流 SHA-256 与当前服务端配置不一致，未提交到 ComfyUI。请刷新工作流并重新提交。" });
        }
        if (data.comparison !== undefined) {
          if (!sha.test(data.providerFingerprint || "") || data.providerFingerprint !== providerFingerprint(config)) {
            return reply(res, 409, { error: "A/B 锁定的服务端点指纹与当前服务不一致，未提交到 ComfyUI。请刷新服务信息并重新锁定对照。" });
          }
          let requestedSelections;
          try { requestedSelections = selections(data); }
          catch (error) { return reply(res, 400, { error: error.message }); }
          const expectedOutputContract = selectedOutputContract(config, requestedSelections);
          if (!expectedOutputContract || !plain(data.outputContract) ||
              canonicalJson(data.outputContract) !== canonicalJson(expectedOutputContract)) {
            return reply(res, 409, { error: "A/B 锁定的输出规格与当前服务端配置不一致或缺失，未提交到 ComfyUI。请刷新规格并重新锁定对照。" });
          }
        }
        if (!sha.test(data.preflightSchemaSha256 || "") || !sha.test(data.preflightFindingsSha256 || "") ||
            typeof data.preflightUnverifiedAcknowledged !== "boolean") {
          return reply(res, 409, { error: "缺少提交前节点预检指纹；请重新预检后提交。" });
        }
        let currentPreflight;
        try {
          currentPreflight = await preflight.inspect({ template: config.template, prompt: config.prompt, references, controls }, query);
        } catch {
          return reply(res, 502, { error: "无法重新核对 ComfyUI 节点定义，任务未排队。" });
        }
        const currentFindingsSha256 = promptDigest(currentPreflight.findings);
        if (currentPreflight.schemaSha256 !== data.preflightSchemaSha256 || currentFindingsSha256 !== data.preflightFindingsSha256) {
          return reply(res, 409, { error: "提交期间节点定义或预检发现已变化，任务未排队。请重新预检后提交。" });
        }
        if (currentPreflight.issues > 0) {
          return reply(res, 409, { error: `当前工作流有 ${currentPreflight.issues} 项明确问题，任务未排队。` });
        }
        if (currentPreflight.unverified > 0 && !data.preflightUnverifiedAcknowledged) {
          return reply(res, 409, { error: `当前工作流有 ${currentPreflight.unverified} 项无法核实，尚未确认，任务未排队。` });
        }
        try { validateReferenceAssetKinds(data); }
        catch (error) { return reply(res, 400, { error: error.message }); }
        let selected;
        try { selected = selections(data); }
        catch (error) { return reply(res, 400, { error: error.message }); }
        let comparison;
        if (data.comparison !== undefined) {
          const { id, variant, motionDigest, mode = "motion", parameterDiff } = plain(data.comparison) ? data.comparison : {};
          const sharedPrompt = typeof data.sharedPrompt === "string" ? data.sharedPrompt : data.prompt;
          const repair = data.repair === undefined ? "" : data.repair;
          if (typeof sharedPrompt !== "string" || typeof data.prompt !== "string") {
            return reply(res, 400, { error: "A/B 提示词格式无效。" });
          }
          if (typeof repair !== "string" || repair.length > 19000 || sharedPrompt.trim().length + repair.length > 19000) {
            return reply(res, 400, { error: "A/B 共用返修提示无效或超过长度限制。" });
          }
          if (["vfx", "performance"].includes(mode) && (typeof data.variableCue !== "string" || !data.variableCue.trim() ||
              data.variableCue.length > 1200 || /<Video\s+\d+>/i.test(data.variableCue) ||
              (mode === "vfx" && /\b(?:no|without)\s+vfx\b/i.test(data.variableCue)))) {
            return reply(res, 400, { error: mode === "vfx" ? "特效对照必须提供一条有效的特效指令。" : "表演对照必须提供一条有效的节拍指令。" });
          }
          const normalizedCue = typeof data.variableCue === "string" ? data.variableCue.trim() : "";
          let parameterSelection;
          if (mode === "parameter") {
            const controlId = parameterDiff?.controlId;
            const group = ["scheduler", "diffusion-weight"].includes(controlId) ?
              controls.find(item => item.id === controlId) : null;
            const ids = parameterDiff?.optionIds;
            if (!group || !plain(ids) ||
                !["A", "B"].every(key => typeof ids[key] === "string" && group.options.some(option => option.id === ids[key])) ||
                ids.A === ids.B || !plain(data.controls) || data.controls[controlId] !== ids[variant]) {
              return reply(res, 400, { error: "参数实验仅支持已预检的模型权重或 scheduler 离散选项，A/B 必须各选一个不同值。" });
            }
            parameterSelection = { controlId, optionIds: { A: ids.A, B: ids.B } };
          }
          const commonSelected = selected.filter(([group]) => mode !== "parameter" || group.id !== parameterSelection.controlId)
            .map(([group, option]) => [group.id, option.id]);
          const stamp = crypto.createHash("sha256").update(JSON.stringify([sharedPrompt.trim(), repair,
            references.map(role => data.images?.[role.id]), commonSelected, parameterSelection || null])).digest("hex");
          const cueDigest = ["vfx", "performance"].includes(mode) ? crypto.createHash("sha256").update(data.variableCue.trim()).digest("hex") : undefined;
          comparison = { id, variant, mode, basis: stamp,
            ...(motionDigest ? { motionDigest } : {}), ...(cueDigest ? { cueDigest } : {}),
            ...(parameterSelection ? { parameterDiff: parameterSelection } : {}) };
          const validFiles = mode !== "motion" ? files.size === 0 :
            variant === "A" ? files.size === 0 : files.has(config.ab?.role);
          const vfxPrefix = variant === "A" ? sharedPrompt.trim() + "\n\nVFX condition: clean plate; do not add visible visual effects, particles, glow, energy, or impact graphics." :
            sharedPrompt.trim() + "\n\nSingle VFX cue: " + normalizedCue;
          const performancePrefix = variant === "B" ? sharedPrompt.trim() + "\n\nPerformance cue: " + normalizedCue : sharedPrompt.trim();
          const variantPrompt = mode === "vfx" ? vfxPrefix : mode === "performance" ? performancePrefix : sharedPrompt.trim();
          const expectedPrompt = repair ? variantPrompt + "\n\n" + repair : variantPrompt;
          if (!config.ab || !validComparison(comparison) || typeof sharedPrompt !== "string" ||
              (["vfx", "performance"].includes(mode) && cueDigest !== data.comparison.cueDigest) ||
              (mode === "parameter" && canonicalJson(parameterDiff) !== canonicalJson(data.comparison.parameterDiff)) ||
              /<Video\s+\d+>/i.test(sharedPrompt) || /<Video\s+\d+>/i.test(data.prompt) ||
              /<Video\s+\d+>/i.test(repair) || !validFiles || data.prompt !== expectedPrompt || data.prompt.length > 19000) {
            return reply(res, 400, { error: "A/B 参数无效：检查模式、共用条件、唯一变化项及视频输入。" });
          }
          if (mode === "motion" && variant === "B") {
            const digest = crypto.createHash("sha256").update(Buffer.from(await files.get(config.ab.role).arrayBuffer())).digest("hex");
            if (digest !== motionDigest) return reply(res, 400, { error: "白模视频与锁定对照的文件内容不一致。" });
          }
          for (const item of jobs.values()) {
            if (item.comparison?.id !== id) continue;
            if (item.comparison.basis !== stamp || (item.comparison.mode || "motion") !== mode ||
                item.comparison.motionDigest !== motionDigest || item.comparison.cueDigest !== cueDigest ||
                canonicalJson(item.comparison.parameterDiff || null) !== canonicalJson(parameterSelection || null)) {
              return reply(res, 409, { error: "共用提示词、参考图、生成参数或白模已变化，请新建对照。" });
            }
            if (item.comparison.variant === variant && !["complete", "failed", "no_video"].includes(item.final?.status || item.state)) {
              return reply(res, 409, { error: "该版本已有未结束的任务，请先查看原任务状态。" });
            }
          }
          if (jobs.has(data.id)) return reply(res, 409, { error: "任务编号已登记，请刷新状态。" });
        }
        if (jobs.size >= 200) return reply(res, 429, { error: "本次会话已记录 200 个任务。" });
        const selectedContract = selectedOutputContract(config, selected);
        if (data.outputContract !== undefined && (selectedContract ?
            canonicalJson(data.outputContract) !== canonicalJson(selectedContract) : data.outputContract !== null)) {
          return reply(res, 409, { error: "任务锁定的输出规格与当前所选方向或帧长不一致，未提交。请刷新预检后重试。" });
        }
        const job = { id: data.id, kind: "generation", prompt: data.prompt, image: data.image, images: data.images, referenceFiles: files, controls: selected, comparison,
          outputContract: selectedContract,
          providerFingerprint: providerFingerprint(config), acceptedAt: Date.now(),
          settings: selected.map(([group, option]) => ({ label: group.label, value: option.label })) };
        if (["pika-h3-first", "minimax-h3-first"].includes(config.id) && typeof data.images?.first === "string") {
          job.firstFrameProof = crypto.createHash("sha256").update(JSON.stringify([
            data.prompt, data.images.first, config.template["16"].inputs.noise_seed, config.output
          ])).digest("hex");
        }
        jobs.set(job.id, job);
        try { persist(); }
        catch {
          jobs.delete(job.id);
          return reply(res, 200, { id: job.id, status: "failed", error: "无法保存任务记录，未提交到 ComfyUI。" });
        }
        try {
          const result = await start(job);
          job.state = "queued";
          try { persist(); }
          catch { result.error = "已提交，但任务编号未能写入磁盘。请暂时保持桥接运行。"; }
          return reply(res, 202, result);
        }
        catch (error) {
          job.state = job.submitted ? "unconfirmed" : "failed";
          if (!job.submitted) job.firstTerminalSeenAt = Date.now();
          job.error = error.message;
          try { persist(); } catch { /* Keep the earlier submitting record for recovery. */ }
          return reply(res, 200, await status(job));
        } finally { delete job.prompt; delete job.image; delete job.images; delete job.referenceFiles; delete job.controls; }
      }
      const match = /^\/api\/(generation|enhancement)\/([a-f\d-]+)(?:\/video\/(\d+)(?:\/(sha256))?)?$/i.exec(route);
      if (req.method === "GET" && match) {
        const job = jobs.get(match[2]);
        if (!job) return reply(res, 404, { error: "当前桥接会话找不到该任务。" });
        if (job.kind !== match[1]) return reply(res, 404, { error: "任务类型与请求地址不符。" });
        if (match[3] != null && match[4] === "sha256") {
          if (req.headers.range) return reply(res, 416, { error: "内容指纹核验不接受分段请求。" });
          if (!job.files && job.peerId) await status(job);
          const expected = url.searchParams.get("file"), key = url.searchParams.get("asset");
          const file = key == null ? job.files?.[Number(match[3])] : job.files?.find(item => resultKey(item) === key);
          if (!file || (expected != null && file.filename !== expected)) {
            return reply(res, file ? 409 : 404, { error: "回片与任务资产身份不匹配，未生成内容指纹。" });
          }
          const identity = await fingerprintRemoteVideo(upstream, file);
          return reply(res, 200, { jobId: job.id, index: Number(match[3]), name: file.filename,
            assetKey: resultKey(file), ...identity, evidence: "full-upstream-video-bytes-sha256",
            ...(job.testFixture === true ? { testFixture: true } : {}) });
        }
        if (match[3] != null) return await serveVideo(req, res, job, Number(match[3]), url.searchParams);
        return reply(res, 200, await status(job));
      }
      const name = route === "/" ? "index.html" : route.slice(1);
      if (req.method === "GET" && (SCRIPTS.has(name) || /^assets\/[\w-]+\.(?:png|svg)$/.test(name) ||
          (name.startsWith("assets/") && motionActions.isBuiltInVideo(name.slice("assets/".length))))) {
        const file = path.join(__dirname, name);
        try {
          const content = await fs.promises.readFile(file);
          res.writeHead(200, { "Content-Type": TYPES[path.extname(name)], "Cache-Control": "no-store" });
          return res.end(content);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      return reply(res, 404, { error: "页面不存在。" });
    } catch (error) {
      if (res.headersSent || res.destroyed) return res.destroy();
      return reply(res, 502, { error: error instanceof SyntaxError ? "JSON 格式有误。" : error.message });
    }
  });
  async function overview(id, readQueue, signal) {
    const job = jobs.get(id);
    if (job?.kind !== "generation") return { id, status: "unknown" };
    const details = { id, testFixture: config.testFixtures === true };
    try {
      if (signal.aborted) return { ...details, status: "unreachable" };
      const view = await status(job, readQueue, signal);
      if (["complete", "failed", "no_video"].includes(view.status)) {
        Object.assign(details, { timing: view.timing, acceptedAt: view.acceptedAt, workflow: view.workflow,
          settings: view.settings, workflowDeclaration: view.workflowDeclaration });
      }
      return { ...details, status: view.status };
    } catch { return { ...details, status: "unreachable" }; }
  }
  return { server, overview, ownsJob: (id, kind) => jobs.get(id)?.kind === kind };
}

if (require.main === module) {
  try {
    const config = configuration(process.argv.slice(2));
    generationServer(config).listen(config.port, "127.0.0.1", () =>
      process.stdout.write(`弧光工作台 http://127.0.0.1:${config.port}/\n`));
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
module.exports = { configuration, generationServer, providerFingerprint, modelFilesByControl, selectedOutputContract };
