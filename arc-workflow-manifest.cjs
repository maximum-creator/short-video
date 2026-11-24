"use strict";

const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const safeText = value => typeof value === "string" && value.length <= 180 && !/[\x00-\x1f]/.test(value);
const modelFile = value => typeof value === "string" && /\.(?:safetensors|ckpt|pt|pth|gguf)$/i.test(value);
const safeFile = value => safeText(value) && !/[\\/]/.test(value) && modelFile(value);

function describe(template) {
  if (!plain(template)) return null;
  const models = [];
  const seeds = [];
  const samplers = [];
  const precision = new Set();
  const modelInputs = /^(?:model|unet|diffusion_model|checkpoint|ckpt|clip|vae|lora|text_encoder)_name$/i;
  const samplerInputs = new Set(["steps", "cfg", "sampler_name", "scheduler", "denoise", "sigmas", "add_noise",
    "start_at_step", "end_at_step", "noise_seed", "seed", "guidance", "shift", "shift_video", "shift_audio",
    "fps", "width", "height", "length", "resolution", "new_resolution", "max_resolution", "batch_size"]);
  for (const [nodeId, node] of Object.entries(template)) {
    if (!plain(node) || !plain(node.inputs) || !safeText(node.class_type)) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if ((key === "seed" || key === "noise_seed") && Number.isSafeInteger(value) && value >= 0) {
        seeds.push({ node: nodeId, type: node.class_type, input: key, value });
      }
      if (modelInputs.test(key) && modelFile(value)) {
        const file = value.split(/[\\/]/).at(-1);
        models.push({ node: nodeId, type: node.class_type, file });
        for (const match of file.matchAll(/(?:^|[_-])(int\d+|fp\d+|bf\d+|nvfp\d+|awq)(?=[_.-]|$)/ig)) {
          precision.add(match[1].toUpperCase());
        }
      }
      if (key === "weight_dtype" && safeText(value) && /^(?:int\d+|fp\d+|bf\d+|nvfp\d+|awq)$/i.test(value)) precision.add(value.toUpperCase());
    }
    if (/sampler|scheduler|noise|guider|modelsampling|seedvr2/i.test(node.class_type)) {
      const settings = Object.fromEntries(Object.entries(node.inputs).filter(([key, value]) => samplerInputs.has(key) &&
        (Number.isFinite(value) || (safeText(value) && value.length <= 180) ||
          (Array.isArray(value) && value.length === 2 && safeText(value[0]) && Number.isSafeInteger(value[1])))));
      if (Object.keys(settings).length) samplers.push({ node: nodeId, type: node.class_type, settings });
    }
  }
  return {
    evidence: "workflow-declared",
    loadedWeightsVerified: false,
    models: models.slice(0, 32), precision: [...precision].sort(), seeds: seeds.slice(0, 32), samplers: samplers.slice(0, 32)
  };
}

function sanitize(value) {
  if (!plain(value) || value.evidence !== "workflow-declared" || value.loadedWeightsVerified !== false) return undefined;
  const models = Array.isArray(value.models) ? value.models.filter(item => plain(item) && safeText(item.node) &&
    safeText(item.type) && safeFile(item.file)).slice(0, 32) : [];
  const precision = Array.isArray(value.precision) ? value.precision.filter(safeText).slice(0, 16) : [];
  const seeds = Array.isArray(value.seeds) ? value.seeds.filter(item => plain(item) && safeText(item.node) &&
    safeText(item.type) && (item.input === "seed" || item.input === "noise_seed") &&
    Number.isSafeInteger(item.value) && item.value >= 0).slice(0, 32) : [];
  const samplers = Array.isArray(value.samplers) ? value.samplers.filter(item => plain(item) && safeText(item.node) &&
    safeText(item.type) && plain(item.settings)).slice(0, 32).map(item => ({ node: item.node, type: item.type,
      settings: Object.fromEntries(Object.entries(item.settings).filter(([key, setting]) => safeText(key) &&
        (Number.isFinite(setting) || (safeText(setting) && setting.length <= 180) ||
          (Array.isArray(setting) && setting.length === 2 && safeText(setting[0]) && Number.isSafeInteger(setting[1])))).slice(0, 24)) })) : [];
  return { evidence: "workflow-declared", loadedWeightsVerified: false, models, precision, seeds, samplers };
}

module.exports = { describe, sanitize };
