"use strict";

const totalLimit = 48 * 1024 ** 2;
const maximum = { video: 24 * 1024 ** 2, audio: 10 * 1024 ** 2 };
const types = {
  video: { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" },
  audio: { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4" }
};
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const mp4Metadata = require("./mp4-container-metadata.js");

async function readSubmission(req, references) {
  const declared = Number(req.headers["content-length"]);
  if (declared > totalLimit) throw new Error("参考素材请求超过 48 MiB。");
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > totalLimit) throw new Error("参考素材请求超过 48 MiB。");
    chunks.push(chunk);
  }
  const body = await new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": req.headers["content-type"] }
  }).formData();
  const payload = body.getAll("task");
  if (payload.length !== 1 || typeof payload[0] !== "string" || payload[0].length > 12_000_000) {
    throw new Error("参考素材请求缺少有效的任务记录。");
  }
  const data = JSON.parse(payload[0]);
  if (!plain(data)) throw new Error("任务记录无效。");
  const files = new Map();
  const allowed = new Set(references.filter(role => role.kind === "video" || role.kind === "audio").map(role => role.id));
  for (const [key, file] of body) {
    if (key === "task") continue;
    if (!allowed.has(key) || typeof file === "string" || files.has(key)) {
      throw new Error("参考文件的输入位置无效或重复。");
    }
    files.set(key, file);
  }
  return { data, files };
}

function mediaName(value) {
  return typeof value === "string" && value.lastIndexOf(".") > 0 && value.length <= 180 &&
    !/[\\/:\x00-\x1f]/.test(value) && Object.values(types).some(table => Object.hasOwn(table, value.split(".").at(-1).toLowerCase()));
}

async function mediaSpec(role, file) {
  const ext = typeof file?.name === "string" ? file.name.split(".").at(-1).toLowerCase() : "";
  if (!file || !mediaName(file.name) || !Object.hasOwn(types[role.kind], ext) || file.size < 4 || file.size > maximum[role.kind]) {
    throw new Error(`「${role.label}」请选择类型正确、大小合规的参考文件。`);
  }
  const head = Buffer.from(await file.slice(0, 16).arrayBuffer());
  const signature = head.toString("ascii");
  const valid = ["mp4", "mov", "m4a"].includes(ext) ? signature.slice(4, 8) === "ftyp" :
    ext === "webm" ? head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) :
    ext === "wav" ? signature.startsWith("RIFF") && signature.slice(8, 12) === "WAVE" :
    ext === "mp3" ? signature.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) :
    ext === "flac" ? signature.startsWith("fLaC") : signature.startsWith("OggS");
  if (!valid) throw new Error(`「${role.label}」文件头与所选参考格式不符。`);
  let metadata = null;
  if (role.kind === "video" && role.expectedFps) {
    const bytes = await file.arrayBuffer();
    metadata = mp4Metadata.inspectBuffer(bytes);
    if (!metadata || metadata.frameRateMode !== "constant" ||
        Math.abs(metadata.fps - role.expectedFps) > 0.001) {
      const measured = metadata ? `${metadata.fps} fps (${metadata.frameRateMode})` : "无法从 MP4 样本表读取帧率";
      throw new Error(`「${role.label}」须为恒定 ${role.expectedFps} fps MP4；当前：${measured}。请保留原片，在本地新建转换件后重新导入：ffmpeg -n -i input.mp4 -an -vf fps=24 -fps_mode cfr -c:v libx264 -pix_fmt yuv420p output-24fps.mp4`);
    }
  }
  return { blob: new Blob([file], { type: types[role.kind][ext] }), ext, ...(metadata ? { metadata } : {}) };
}

function validNameForKind(kind, value) {
  return mediaName(value) && Object.hasOwn(types[kind], value.split(".").at(-1).toLowerCase());
}

module.exports = { readSubmission, mediaSpec, validNameForKind };
