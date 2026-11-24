"use strict";

const modes = {
  t2va: { label: "H3 文生视频", min: 0, max: 0 },
  i2va: { label: "H3 首帧图生视频", min: 1, max: 1 },
  fl2va: { label: "H3 首尾帧视频", min: 2, max: 2 },
  l2va: { label: "H3 尾帧图生视频", min: 1, max: 1 },
  // The per-type maxima sum to 15, but H3 imposes a stricter 12-file mixed-input cap below.
  ref2va: { label: "H3 多素材参考视频", min: 1, max: 15 }
};
const base = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
const refs = ["subject_definitions", "summary", "retention_analysis", "detailed_description", ...base.slice(1)];
const validSeconds = value => Number.isFinite(value) && value >= 4 && value <= 15 &&
  Math.abs(Math.round(value * 100) - value * 100) < .000001;

function configure(mode, fixed, references, controls) {
  if (mode === undefined) {
    if (fixed !== undefined) throw new Error("--h3-duration 要与 --h3-mode 一起使用。");
    return null;
  }
  if (!Object.hasOwn(modes, mode)) throw new Error("请选择有效的 H3 输入模式。");
  const definition = modes[mode];
  if (references.length < definition.min || references.length > definition.max) {
    throw new Error(`${definition.label} 要求 ${definition.min === definition.max ? definition.min : `${definition.min}–${definition.max}`} 个参考输入。`);
  }
  const kinds = references.map(item => item.kind || "image");
  if (mode !== "ref2va" && kinds.some(kind => kind !== "image")) throw new Error("H3 首帧和尾帧模式只使用图片。");
  if (kinds.filter(kind => kind === "image").length > 9 || kinds.filter(kind => kind === "video").length > 3 ||
      kinds.filter(kind => kind === "audio").length > 3 || kinds.length > 12) {
    throw new Error("H3 参考素材最多 9 张图、3 段视频及 3 段音频，混合输入总数最多 12 个文件。");
  }
  const duration = controls.find(item => item.id === "duration");
  const seconds = fixed === undefined ? undefined : Number(fixed);
  if ((duration && (fixed !== undefined || duration.options.some(option => !validSeconds(option.seconds)))) ||
      (!duration && (typeof fixed !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(fixed) || !validSeconds(seconds)))) {
    throw new Error("H3 需声明工作流的实际生成时长（4–15 秒），可用 --h3-duration 或 duration 预设二选一。");
  }
  return { mode, label: mode === "ref2va" && kinds.every(kind => kind === "image") ? "H3 多图参考视频" : definition.label,
    seconds, inputs: references.map(item => ({ id: item.id, label: item.label, ...(item.kind ? { kind: item.kind } : {}),
      ...(item.assetKinds ? { assetKinds: item.assetKinds } : {}) })) };
}

function prepare(profile, settings, input) {
  if (!profile) return null;
  const incoming = Array.isArray(input) ? input : [];
  if (incoming.length !== profile.inputs.length ||
      incoming.some(item => !profile.inputs.some(role => role.id === item?.role))) {
    throw new Error("请为 H3 工作流选好每个参考输入，再起草提示词。");
  }
  const seconds = profile.seconds ?? settings.find(item => item.seconds !== undefined)?.seconds;
  if (!validSeconds(seconds)) throw new Error("无法确定当前 H3 模板的生成时长。");
  const counts = { image: 0, video: 0, audio: 0 };
  if (incoming.filter(item => item?.motionOnly === true).length > 1) {
    throw new Error("当前镜头只可将一条视频指定为白模动作。");
  }
  const prefix = { image: "Picture", video: "Video", audio: "Audio" };
  const entries = profile.inputs.map(role => {
    const choices = incoming.filter(item => item?.role === role.id);
    if (choices.length !== 1) throw new Error("H3 工作流的参考输入缺失或重复。");
    const kind = role.kind || "image";
    if (choices[0].motionOnly === true && kind !== "video") {
      throw new Error("白模动作必须绑定到视频参考输入。");
    }
    if (role.assetKinds && !role.assetKinds.includes(choices[0].assetKind)) {
      throw new Error(`「${role.label}」只接受 ${role.assetKinds.join("、")} 类参考图。`);
    }
    const marker = `<${prefix[kind]} ${++counts[kind]}>`;
    return { role: role.id, label: role.label, kind, assetId: choices[0].assetId,
      ...(choices[0].assetKind ? { assetKind: choices[0].assetKind } : {}),
      ...(role.assetKinds ? { assetKinds: role.assetKinds } : {}),
      mediaName: choices[0].mediaName, marker, ...(kind === "image" ? { picture: marker } : {}),
      ...(choices[0].motionOnly === true ? { motionOnly: true } : {}) };
  });
  const fields = profile.mode === "ref2va" ? refs : base;
  return { mode: profile.mode, label: profile.label, seconds, entries, fields };
}

function instructions(value) {
  const sections = value.fields.join("、");
  const general = "输出 JSON。顶层 summary 用中文解释，warnings 是中文核对项列表，sections 是英文提示词各段内容。sections 只填写这些字段：" +
    sections + "。H3 需要的段落都写在 sections 里，逐项遵守官方字段与参考标签规则。工作台一次只生成当前一个分镜镜头：除非用户明确要求镜头内切换，否则不得增加第二镜、转场或新场景。按起始状态、可见动作与表情变化、收束状态描述节奏，动作幅度和数量须匹配实际秒数；明确景别、主体位置、光源位置、运镜速度与落点、需要保留的角色/服装/道具/场景特征。避免空泛质量词和同时发生过多动作。对白和可见文字保留原文。";
  if (value.mode === "ref2va") {
    const motion = value.entries.find(entry => entry.motionOnly);
    return [general, "这是 reference generation。六段 sections 全部使用英文。subject_definitions 给实际会出现在成片中的角色、场景或道具分配稳定的 <Subject N>，并引用已绑定素材，写清每份素材只提供什么：角色图用于外观/服装，场景图用于空间/布景，动作或运镜视频用于时间/运动，音频用于指定的声音层。不得把动作参考视频的人物外观或背景带入目标镜头，除非用户明确要求；也不得把角色参考图写成首帧。只有用户明确把图指定为首帧、尾帧或关键构图时，才把 <Picture N> 当成具体帧锚点；纯角色/场景参考应在对应 <Subject N> 定义中说明来源。retention_analysis 逐项说明各素材在哪个镜头保留、迁移、直接复用或仅作参考。detailed_description 逐镜说明构图、主体位置、场景与光线、可见动作状态变化、运镜和声音；按本镜头复杂度写够必要细节即可。短镜优先保留能看到的动作、起止构图和不应变化的主体特征。参考标签只在需要时引用，删除同义词堆叠、重复的保留要求和未确认的画面。",
      ...(motion ? [`${motion.marker} 是用户明确选入的白模，只沿用角色动作与节奏。不能作为外观、布景、光色、机位或声音参考。工作台会在最终英文提示词附上这句限制，草稿里只需说明该白模驱动哪个主体与动作。其它视频按各自绑定用途描述。`] : [])];
  }
  const anchors = {
    t2va: "从文本描述起幅、动作和落幅，不应使用图片标签。",
    i2va: "从选定首帧的主体、服饰和构图出发，描述动作怎样从该状态开始。",
    fl2va: "说明如何从第一帧连续走到第二张图的收尾构图，重点写动作过程，避免把两张图各写成独立镜头。",
    l2va: "从与尾帧相容的状态开始，逐渐落到尾帧的姿态与取景。"
  };
  return [general, anchors[value.mode]];
}

function format(value, profile) {
  const sections = value?.sections;
  if (!sections || typeof sections !== "object" || Array.isArray(sections) ||
      Object.keys(sections).length !== profile.fields.length ||
      profile.fields.some(key => typeof sections[key] !== "string" || !sections[key].trim() || sections[key].length > 4000)) {
    throw new Error("H3 草稿缺少对应模式的提示词段落。");
  }
  const text = profile.fields.map(key => sections[key].trim()).join("\n");
  const subjects = new Set([...((sections.subject_definitions || "").matchAll(/<Subject (\d+)>/gi))].map(match => match[1]));
  if (profile.mode === "ref2va" && profile.entries.some(entry => !sections.subject_definitions.includes(entry.marker))) {
    throw new Error("H3 草稿未交代每份参考素材的作用。");
  }
  const known = new Set(profile.entries.map(entry => entry.marker.toLowerCase()));
  for (const label of text.matchAll(/<(Picture|Video|Audio|Subject)\s+(\d+)>/gi)) {
    const kind = label[1].toLowerCase(), number = Number(label[2]);
    if ((kind !== "subject" && !known.has(`<${kind} ${number}>`)) ||
        (kind === "subject" && (!subjects.has(label[2]) || profile.mode !== "ref2va"))) {
      throw new Error("H3 草稿引用了未绑定素材或未定义主体。");
    }
  }
  if (/\[Shot\s+(?!1\])\d+\]/i.test(text)) throw new Error("此处只起草当前镜头。");
  const end = profile.seconds.toFixed(2);
  const alignment = {
    i2va: "Use <Picture 1> as the complete opening frame of [Shot 1] at 0.00 seconds.",
    fl2va: `Align <Picture 1> with 0.00 seconds and <Picture 2> with ${end} seconds of [Shot 1].`,
    l2va: `Align <Picture 1> with the final frame of [Shot 1] at ${end} seconds.`
  }[profile.mode];
  const motion = profile.entries.find(entry => entry.motionOnly);
  const info = profile.fields.map(key => {
    let content = sections[key].trim();
    if (key === "integrated_multimodal_description" || key === "detailed_description") {
      content = `[Shot 1] Duration: ${end} seconds. ${content.replace(/^\[Shot 1\]\s*/i, "")}`;
    }
    if (key === "summary" && !/^\[reference generation\]/i.test(content)) content = "[reference generation] " + content;
    if (key === "retention_analysis" && motion) {
      content += `\nUse ${motion.marker} only for body motion and action timing. Keep character appearance, setting, lighting, camera and audio from their own references or the shot brief.`;
    }
    return key + ": " + content;
  });
  const warnings = Array.isArray(value.warnings) ? [...value.warnings] : [];
  return { ...value, prompt: [...(alignment ? [alignment] : []), ...info].join("\n\n"), warnings: warnings.slice(0, 6) };
}

module.exports = { configure, prepare, instructions, format };
