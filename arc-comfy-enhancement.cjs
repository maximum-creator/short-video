"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const workflowManifest = require("./arc-workflow-manifest.cjs");

const MAX_VIDEO = 128 * 1024 ** 2;
const MAX_REQUEST = MAX_VIDEO + 256 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safePart = value => typeof value === "string" && value.length > 0 && value.length <= 180 &&
  value !== "." && value !== ".." && !(/[\\/:\x00-\x1f]/.test(value));
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

function configure(filename, requestedNode) {
  if (!plain(filename)) throw new Error("增强工作流必须是 ComfyUI API 格式 JSON。");
  const nodes = Object.entries(filename);
  if (!plain(filename) || nodes.length === 0 || nodes.length > 10000 || !nodes.every(([, node]) =>
    plain(node) && typeof node.class_type === "string" && plain(node.inputs))) {
    throw new Error("增强工作流必须是 ComfyUI API 格式 JSON。");
  }
  const candidates = nodes.filter(([, node]) => node.class_type === "LoadVideo" &&
    typeof node.inputs.file === "string");
  const nodeId = requestedNode || (candidates.length === 1 ? candidates[0][0] : "");
  if (!/^\d+(?::\d+)*$/.test(nodeId) || !Object.hasOwn(filename, nodeId) ||
    filename[nodeId].class_type !== "LoadVideo" || typeof filename[nodeId].inputs.file !== "string") {
    throw new Error("增强工作流需有唯一的 LoadVideo.file 输入，或显式指定有效节点编号。");
  }
  const resolutionInputs = nodes.flatMap(([id, node]) => {
    if (!node.class_type.toLowerCase().includes("seedvr2")) return [];
    return ["new_resolution", "resolution"].filter(field => Number.isFinite(node.inputs[field]))
      .map(field => [id, field]);
  });
  // SeedVR2 workflow exports have used both `new_resolution` and the current
  // native `resolution` field. Only bind a single explicit numeric control;
  // do not guess from max_resolution or scale multipliers.
  const resolution = resolutionInputs.length === 1 ? resolutionInputs[0] : null;
  const resolutionMode = resolution?.[1] === "resolution" ? "height" : resolution ? "short-edge" : null;
  const denoiseInputs = nodes.flatMap(([id, node]) => /seedvr2/i.test(node.class_type) &&
    Number.isFinite(node.inputs.denoise) ? [[id, "denoise"]] : []);
  // Only expose a single explicit SeedVR2 denoise literal. Ambiguous graphs
  // remain read-only until the workflow is made unambiguous.
  const denoise = denoiseInputs.length === 1 ? denoiseInputs[0] : null;
  const relay = !resolutionInputs.length && nodes.some(([, node]) => node.class_type === "RelayVSRConditioning") &&
    nodes.some(([, node]) => node.class_type === "VSRDecode");
  const seedvr2 = resolutionInputs.length > 0;
  return { template: filename, video: [nodeId, "file"], resolution, resolutionMode, denoise,
    name: relay ? "RelayVSR 视频超分" : seedvr2 ? "SeedVR2 视频增强" : "AI 视频增强" };
}

function nativeResolution(config, job) {
  if (!config.resolution) return null;
  if (config.resolutionMode !== "height") return job.options.shortEdge;
  const { width, height } = job.media || {};
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
      ![720, 1080].includes(job.options.shortEdge)) throw new Error("SeedVR2 目标高度需要有效的源画面宽高与目标短边。");
  return height > width ? Math.round(job.options.shortEdge * height / width) : job.options.shortEdge;
}

function declaresSeedvr2Denoise(config) {
  return Array.isArray(config?.denoise) && config.denoise.length === 2;
}

async function readSubmission(req) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_REQUEST) throw new Error("增强任务请求超过 128 MiB。");
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_REQUEST) throw new Error("增强任务请求超过 128 MiB。");
    chunks.push(chunk);
  }
  const body = await new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": req.headers["content-type"] }
  }).formData();
  const payload = body.getAll("task"), videos = body.getAll("video"), reports = body.getAll("report");
  for (const [name] of body) {
    if (!["task", "video", "report"].includes(name)) throw new Error("增强任务包含未识别的上传字段。");
  }
  if (payload.length !== 1 || typeof payload[0] !== "string" || payload[0].length > 64_000 ||
    videos.length !== 1 || typeof videos[0] === "string" || reports.length !== 1 || typeof reports[0] === "string" || reports[0].size > 64 * 1024) {
    throw new Error("增强任务需包含任务说明、单镜头视频和 ARC 裁切报告。");
  }
  const data = JSON.parse(payload[0]);
  const report = JSON.parse(await reports[0].text());
  const attemptHistory = data?.attemptHistory ?? [];
  const optionsSignature = plain(data?.options) ? JSON.stringify(canonical(data.options)) : "";
  if (!plain(data) || !uuid.test(data.id || "") || !plain(data.source) || !plain(data.media) ||
    !plain(data.shot) || !plain(data.options) ||
    !safePart(data.source.name) || !Number.isSafeInteger(data.source.size) || data.source.size < 4 ||
    !/^[a-f0-9]{64}$/.test(data.source.sha256 || "") || !safePart(data.media.name) ||
    !Number.isSafeInteger(data.media.size) || data.media.size < 4 || !/^[a-f0-9]{64}$/.test(data.media.sha256 || "") ||
    !Number.isFinite(data.media.duration) || videos[0].size !== data.media.size || videos[0].name !== data.media.name ||
    !/^E\d{2,}-S\d{2,}$/.test(data.shot.id || "") ||
    typeof data.shot.version !== "string" || !data.shot.version.trim() ||
    !Number.isSafeInteger(data.retryCount ?? 0) || (data.retryCount ?? 0) < 0 || (data.retryCount ?? 0) > 100 ||
    !Array.isArray(data.attemptHistory ?? []) || (data.attemptHistory ?? []).length !== (data.retryCount ?? 0) ||
    (data.attemptHistory ?? []).some(attempt => !plain(attempt) || !uuid.test(attempt.taskId || "") ||
      !["complete", "failed", "no_video"].includes(attempt.status) ||
      attempt.sourceSha256 !== data.source.sha256 || attempt.mediaSha256 !== data.media.sha256 ||
      attempt.shotVersion !== data.shot.version ||
      attempt.workflowSha256 !== data.options.workflowSha256 || attempt.providerFingerprint !== data.providerFingerprint ||
      !plain(attempt.options) || JSON.stringify(canonical(attempt.options)) !== optionsSignature ||
      ![undefined, null, "comfy-history-timestamps"].includes(attempt.queueSource) ||
      ![undefined, null, "comfy-history-timestamps"].includes(attempt.executionSource) ||
      (attempt.bridgeSource !== undefined && attempt.bridgeSource !== null && attempt.bridgeSource !== "local-bridge-observation") ||
      (attempt.gpuKernelTime !== undefined && attempt.gpuKernelTime !== null && attempt.gpuKernelTime !== false) ||
      (attempt.bridgeMs !== undefined && attempt.bridgeMs !== null &&
        (!Number.isSafeInteger(attempt.bridgeMs) || attempt.bridgeMs < 0 || attempt.bridgeMs > 7 * 24 * 3600 * 1000)) ||
      [attempt.queueMs, attempt.executionMs].some(value => value !== null &&
        (!Number.isSafeInteger(value) || value < 0 || value > 7 * 24 * 3600 * 1000))) ||
    (attemptHistory.length > 0 && (!/^[a-f0-9]{64}$/.test(data.options.workflowSha256 || "") ||
      !/^[a-f0-9]{64}$/.test(data.providerFingerprint || ""))) ||
    !Number.isFinite(data.shot.start) || !Number.isFinite(data.shot.end) || data.shot.start < 0 ||
    data.shot.end - data.shot.start < .25 || data.shot.end - data.shot.start > 120 ||
    Object.keys(data.options).some(key => !["shortEdge", "nativeResolution", "workflowSha256", "preflightSchemaSha256", "resolution", "fps", "scale", "denoise"].includes(key)) ||
    !/^[a-f0-9]{64}$/.test(data.options.preflightSchemaSha256 || "") ||
    (data.options.scale !== undefined && (data.options.scale !== 2 ||
      ![data.media.width, data.media.height].every(value => Number.isInteger(value) && value > 0 && value <= 8192) ||
      !Number.isSafeInteger(data.media.frames) || data.media.frames < 1 || data.media.frames > 1000000 ||
      !/^[1-9]\d*\/[1-9]\d*$/.test(data.media.fps || ""))) ||
    (data.options.shortEdge != null && ![720, 1080].includes(data.options.shortEdge)) ||
    (data.options.nativeResolution != null && (!Number.isSafeInteger(data.options.nativeResolution) ||
      data.options.nativeResolution < 720 || data.options.nativeResolution > 8192)) ||
    (data.options.resolution != null && !["720", "1080"].includes(data.options.resolution)) ||
    (data.options.fps != null && !["30", "60"].includes(data.options.fps)) ||
    (data.options.denoise != null && (!Number.isFinite(data.options.denoise) || data.options.denoise < 0 || data.options.denoise > 100)) ||
    Math.abs(data.media.duration - (data.shot.end - data.shot.start)) > .12) {
    throw new Error("增强任务字段、镜头区间或源文件身份无效。");
  }
  if (report?.schema !== "arc-ai-input-v1" || !plain(report.source) || !plain(report.media) || !plain(report.shot) ||
    ["id", "version", "start", "end"].some(key => report.shot[key] !== data.shot[key]) ||
    ["name", "size", "sha256"].some(key => report.source[key] !== data.source[key]) ||
    ["name", "size", "sha256", "duration", ...(data.options.scale === 2 || data.options.nativeResolution != null ?
      ["width", "height"] : []), ...(data.options.scale === 2 ? ["fps", "frames"] : [])]
      .some(key => report.media[key] !== data.media[key])) {
    throw new Error("ARC 裁切报告与当前镜头、原视频或上传裁切文件不一致。");
  }
  const ext = path.extname(videos[0].name).toLowerCase();
  if (!new Set([".mp4", ".webm", ".mov"]).has(ext) || videos[0].size > MAX_VIDEO) {
    throw new Error("镜头视频仅支持 128 MiB 以内的 MP4、WebM 或 MOV。");
  }
  const head = Buffer.from(await videos[0].slice(0, 16).arrayBuffer());
  const sig = head.toString("ascii");
  const valid = ext === ".webm" ? head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) :
    sig.slice(4, 8) === "ftyp";
  if (!valid) throw new Error("镜头视频扩展名与文件头不符。");
  const digest = crypto.createHash("sha256").update(Buffer.from(await videos[0].arrayBuffer())).digest("hex");
  if (digest !== data.media.sha256) throw new Error("上传视频的 SHA-256 与 ARC 导出的单镜头素材不一致。");
  return { data, video: videos[0] };
}

async function submit({ config, query, job, video }) {
  const targetResolution = nativeResolution(config, job);
  if (config.resolution ? ![720, 1080].includes(job.options.shortEdge) ||
      (config.resolutionMode === "height" ? job.options.nativeResolution !== targetResolution : job.options.nativeResolution != null) :
      job.options.shortEdge !== null || job.options.nativeResolution != null) {
    throw new Error(config.resolution ? "AI 增强任务目标分辨率无效。" : "当前增强工作流由节点和权重决定输出尺寸，请保留工作流设定。");
  }
  const prompt = structuredClone(config.template);
  if (config.denoise) {
    const [node, field] = config.denoise;
    if (!Number.isFinite(job.options.denoise)) throw new Error("SeedVR2 denoise 参数缺失或无效。");
    prompt[node].inputs[field] = job.options.denoise;
  } else if (job.options.denoise !== undefined && job.options.denoise !== null) {
    throw new Error("当前工作流未声明唯一的 SeedVR2 denoise 输入。");
  }
  const form = new FormData();
  const ext = path.extname(video.name).toLowerCase().slice(1);
  form.append("image", new Blob([video], { type: video.type || "application/octet-stream" }), `arc-${job.id}.${ext}`);
  form.append("type", "input");
  const uploaded = await query("/upload/image", { method: "POST", body: form }, 120_000);
  if (!safePart(uploaded?.name) || uploaded.subfolder) throw new Error("ComfyUI 返回了无效的视频输入名。");
  const [node, input] = config.video;
  prompt[node].inputs[input] = uploaded.name;
  if (config.resolution) {
    const [resolutionNode, resolutionInput] = config.resolution;
    prompt[resolutionNode].inputs[resolutionInput] = targetResolution;
  }
  job.workflowDeclaration = workflowManifest.describe(prompt);
  job.submittedGraphSha256 = crypto.createHash("sha256").update(JSON.stringify(canonical(prompt))).digest("hex");
  job.submitted = true;
  const result = await query("/prompt", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, client_id: job.id }) });
  if (!uuid.test(result?.prompt_id || "")) throw new Error("ComfyUI 未返回增强任务编号。");
  job.peerId = result.prompt_id;
  return job;
}

module.exports = { configure, nativeResolution, declaresSeedvr2Denoise, readSubmission, submit, MAX_VIDEO };
