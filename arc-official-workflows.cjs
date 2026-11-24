"use strict";

const { createHash } = require("node:crypto");
const h3 = require("./arc-h3-prompt.cjs");
const enhancement = require("./arc-comfy-enhancement.cjs");

const pikaCommit = "ea7faae6999fb31338f43408ff4a575bd3f7d9a0";
const relayCommit = "6871c60210d75d51463be34278544b564961cfb0";
const source = (commit, file) => `https://github.com/Comfy-Org/workflow_templates/blob/${commit}/templates/${file}.json`;
const node = (class_type, inputs) => ({ class_type, inputs });
const wire = (id, output = 0) => [String(id), output];
const digest = template => createHash("sha256").update(JSON.stringify(template)).digest("hex");
const diffusionWeightControl = branch => ({ id: "diffusion-weight", label: "扩散权重（只切换文件）",
  targets: [["13", "unet_name"]], options: [
    { id: "pruned-int8", label: "剪枝 INT8 · 默认", values: [`minimax_h3_${branch}_pruned_int8_convrot.safetensors`] },
    { id: "full-int8", label: "未剪枝 INT8 · 可选对照", values: [`minimax_h3_${branch}_int8_convrot.safetensors`] }
  ], defaultId: "pruned-int8" });

function h3Preset(mode, configureAB, base = false, art = false) {
  const ref = mode === "ref2va";
  const branch = ref ? mode : "fl2va";
  // The official template uses the FL2VA trunk for first-frame-only I2VA.
  const id = art ? "pika-h3-ref2va-art" : base ? (ref ? "minimax-h3-ref2va" : "minimax-h3-first") :
    ref ? "pika-h3-ref2va" : "pika-h3-first";
  const name = art ? "Pika H3 Flex · 三图与白模 A/B" : base ?
    (ref ? "MiniMax H3 原生 · 多参考 20 步" : "MiniMax H3 基础 · 首帧 20 步") :
    ref ? "Pika H3 Flex · 多参考与白模 A/B" : "Pika H3 Flex · 首帧";
  const template = {
    1: node("LoadImage", { image: "" }),
    8: node(ref ? "MiniMaxH3ReferenceToVideo" : "MiniMaxH3ImageToVideo",
      { clip: wire(12), vae: wire(10), prompt: "", width: 768, height: 1344, length: 124,
        ...(ref ? { audio_vae: wire(11), ref_image_size: "match", "ref_images.ref_image_0": wire(1),
          "ref_images.ref_image_1": wire(2), "ref_videos.ref_video_0": wire(4) } : { first_frame: wire(1) }) }),
    10: node("VAELoader", { vae_name: "minimax_h3_video_vae_int8_convrot.safetensors" }),
    11: node("VAELoader", { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }),
    12: node("CLIPLoader", { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }),
    13: node("UNETLoader", { unet_name: `minimax_h3_${branch}_pruned_int8_convrot.safetensors`, weight_dtype: "default" }),
    14: node("LoraLoaderModelOnly", { model: wire(13), lora_name: `pika_h3_flex_${branch}_v1_bf16.safetensors`, strength_model: 1 }),
    15: node("BasicGuider", { model: wire(14), conditioning: wire(8) }),
    16: node("RandomNoise", { noise_seed: 20261220 }),
    17: node("KSamplerSelect", { sampler_name: "lcm" }),
    18: node("ManualSigmas", { sigmas: "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0" }),
    19: node("SamplerCustomAdvanced", { noise: wire(16), guider: wire(15), sampler: wire(17), sigmas: wire(18), latent_image: wire(8, 1) }),
    20: node("VAEDecode", { samples: wire(19), vae: wire(10) }),
    21: node("VAEDecodeAudio", { samples: wire(19), vae: wire(11) }),
    22: node("CreateVideo", { images: wire(20), audio: wire(21), fps: 24 }),
    23: node("SaveVideo", { video: wire(22), filename_prefix: `video/${id}`, format: "auto", codec: "auto" })
  };
  if (ref) Object.assign(template, {
    2: node("LoadImage", { image: "" }),
    3: node("LoadVideo", { file: "" }),
    4: node("GetVideoComponents", { video: wire(3) })
  });
  if (art) {
    template[5] = node("LoadImage", { image: "" });
    template[8].inputs["ref_images.ref_image_2"] = wire(5);
  }
  if (base) {
    delete template[14];
    template[15].inputs.model = wire(13);
    template[17].inputs.sampler_name = "res_multistep";
    template[18] = node("BasicScheduler", { model: wire(13), scheduler: ref ? "beta" : "simple", steps: 20, denoise: 1 });
  }
  const references = ref ? [
    { id: "character", label: "人物参考", target: ["1", "image"], assetKinds: ["角色"] },
    { id: "scene", label: "场景参考", target: ["2", "image"], assetKinds: ["场景"] },
    ...(art ? [{ id: "keyframe", label: "跨门后关键帧", target: ["5", "image"], assetKinds: ["分镜关键画面"] }] : []),
    { id: "motion", label: "白模动作", target: ["3", "file"], kind: "video", expectedFps: 24 }
  ] : [{ id: "first", label: "首帧", target: ["1", "image"], assetKinds: ["分镜关键画面"] }];
  const prompt = ["8", "prompt"];
  const controls = [diffusionWeightControl(branch),
    { id: "framing", label: "画幅", targets: [["8", "width"], ["8", "height"]], options: [
      { id: "portrait", label: "竖屏 · 768 × 1344", values: [768, 1344] },
      { id: "landscape", label: "横屏 · 1344 × 768", values: [1344, 768] }
    ], defaultId: "portrait" },
    { id: "duration", label: "时长（24 fps · H3 帧步长）", targets: [["8", "length"]], options: [
      [124, "5.17 秒", 5.17], [192, "8 秒", 8], [260, "10.83 秒", 10.83], [328, "13.67 秒", 13.67], [345, "14.38 秒", 14.38]
    ].map(([frames, label, seconds]) => ({ id: `frames-${frames}`, label, values: [frames], seconds })), defaultId: "frames-124" },
    ...(base && ref ? [{ id: "scheduler", label: "采样调度（多参考实验）", targets: [["18", "scheduler"]], options: [
      { id: "beta", label: "Beta · 官方建议尝试", values: ["beta"] },
      { id: "normal", label: "Normal · 官方建议尝试", values: ["normal"] },
      { id: "simple", label: "Simple · 官方模板原值", values: ["simple"] }
    ], defaultId: "beta" }] : []),
    ...(ref ? [{ id: "seed", label: "随机种子（可复现）", targets: [["16", "noise_seed"]],
    options: [20261220, 20261221, 20261222, 20261223].map(value => ({ id: `seed-${value}`,
      label: value === 20261220 ? `基准种子 · ${value}` : `复测试种 · ${value}`, values: [value] })),
    defaultId: "seed-20261220" }] : [])];
  const h3Prompt = h3.configure(mode, undefined, references, controls);
  const ab = ref ? configureAB(template, references, [prompt, ...references.map(item => item.target)], h3Prompt,
    controls, "motion", "8.ref_videos.ref_video_0") : null;
  return { id, name, kind: "generation", source: source(pikaCommit,
    base ? (ref ? "video_minimax_h3_r2v" : "video_minimax_h3_i2v") : "video_pika_h3_flex_" + branch),
    template, prompt, references, controls, h3Prompt, ab, graphSha256: digest(template),
    output: { width: 768, height: 1344, fps: 24, frames: 124 } };
}

function relay() {
  const template = {
    1: node("LoadVideo", { file: "" }),
    2: node("GetVideoComponents", { video: wire(1) }),
    3: node("UNETLoader", { unet_name: "relayvsr_x2_lightx2v_int8_convrot.safetensors", weight_dtype: "default" }),
    4: node("RelayVSRConditioning", { model: wire(3), images: wire(2) }),
    5: node("KSampler", { model: wire(3), positive: wire(4), negative: wire(4), latent_image: wire(4, 1),
      seed: 42, steps: 1, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 }),
    6: node("VAELoader", { vae_name: "relayvsr_flash_vae_x2_fp32.safetensors" }),
    7: node("VSRDecode", { vae: wire(6), samples: wire(5), images: wire(2), detail: 1 }),
    8: node("CreateVideo", { images: wire(7), audio: wire(2, 1), fps: wire(2, 2) }),
    9: node("SaveVideo", { video: wire(8), filename_prefix: "video/relayvsr-2x", format: "auto", codec: "auto" })
  };
  const name = "RelayVSR 2× · 同源裁片";
  return { id: "relayvsr-2x", name, kind: "enhancement",
    source: source(relayCommit, "utility_relayvsr_video_x2_upscale"),
    enhancement: { ...enhancement.configure(template), name, sha256: digest(template), scale: 2 } };
}

function presets(configureAB) {
  return [h3Preset("i2va", configureAB), h3Preset("ref2va", configureAB), h3Preset("ref2va", configureAB, false, true),
    h3Preset("i2va", configureAB, true), h3Preset("ref2va", configureAB, true), relay()];
}

module.exports = { presets };
