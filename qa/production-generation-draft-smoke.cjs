"use strict";

const assert = require("node:assert/strict");
const { draft, promptBasis, promptBasisStale, resultBasisStatus, basisParts, basisChanges, compatibleReferences, defaultReference } = require("../production-generation.js");

const prompt = draft({
  shot: {
    id: "S01",
    story: { scriptAnchor: "角色A推开门。", beat: "她停顿后抬眼，发现房间空无一人。",
      composition: "人物靠画面左侧，门内留出空场。", performance: "先屏息停顿，再抬眼；嘴唇保持闭合，视线落向门内。",
      reference: "保留门框上的铜色铭牌。" },
    camera: { move: "缓慢推进", path: "从门外越过门槛", guide: "在人物抬眼时停住", framing: null },
    references: [
      { kind: "角色", name: "角色A常服", revision: "v03", notes: "统一发型、统一外套、配饰" },
      { kind: "场景", name: "旧公寓玄关", revision: "v02", notes: "门框铜牌位于左上方" }
    ]
  },
  script: { state: "随身物品仍在角色A手中。", rules: "按场景规则行动。" },
  continuity: [{ subject: "角色A", field: "持有物", previousEnd: "随身物品", start: "随身物品", end: "随身物品已撕裂", status: "待衔接" }],
  art: { character: "角色A保持统一发型和统一外套。", look: "柔和侧光，背景浅景深。", limits: "不要改变配饰和风衣领口。" }
});

for (const text of ["剧本原句：角色A推开门。", "镜头叙事目的：她停顿后抬眼，发现房间空无一人。",
  "表演节拍与表情：先屏息停顿，再抬眼；嘴唇保持闭合，视线落向门内。",
  "本集人物状态与规则：随身物品仍在角色A手中。；按场景规则行动。",
  "待衔接连续性：角色A·持有物：随身物品 → 随身物品已撕裂",
  "全剧人物身份基准：角色A保持统一发型", "角色「角色A常服」v03：统一发型",
  "场景「旧公寓玄关」v02：门框铜牌", "摄影机与运镜：缓慢推进；从门外越过门槛",
  "全剧视觉风格：柔和侧光", "必须保持的美术限制：不要改变配饰"])
  assert.ok(prompt.includes(text), `默认提示词应包含：${text}`);

const basisInput = { episode: 1, shot: { id: "S01", startMs: 0, endMs: 6000,
  durationConfirmed: true, story: { beat: "先静止，再抬眼。" }, camera: { move: "固定" }, references: [], keyframe: null },
  script: { state: "随身物品在手。", rules: "凌晨前离开。" }, continuity: [], art: { look: "暖光" } };
const basis = promptBasis(basisInput);
assert.equal(promptBasisStale({ generationPromptBasis: basis }, basisInput), false);
assert.equal(promptBasisStale({ generationPromptBasis: "older basis" }, basisInput), true);
assert.equal(promptBasisStale({}, basisInput), true, "legacy prompts without a recorded basis require a review");
assert.notEqual(promptBasis({ ...basisInput, script: { ...basisInput.script, state: "随身物品已经撕碎。" } }), basis,
  "changing story state changes the prompt review basis");
const editedBrief = { ...basisInput, shot: { ...basisInput.shot, camera: { move: "慢推" } } };
const jobWithNewDraft = { generationJobBasis: basis, generationPromptBasis: promptBasis(editedBrief) };
assert.equal(promptBasisStale(jobWithNewDraft, editedBrief), false);
assert.equal(resultBasisStatus(jobWithNewDraft, editedBrief), "changed",
  "saving a fresh prompt cannot change the recorded basis of a submitted job");
assert.equal(resultBasisStatus(jobWithNewDraft, basisInput), "current");
assert.equal(resultBasisStatus({ generationPromptBasis: basis }, basisInput), "unknown");
const differences = value => basisChanges(basisParts(basis), basisParts(promptBasis(value)));
assert.deepEqual(differences(editedBrief), [{ label: "运镜、机位与灯光", tab: "camera" }]);
const lightBrief = structuredClone(basisInput);
lightBrief.shot.camera.lighting = "保持左上方暖色主光。";
assert.match(draft(lightBrief), /本镜灯光与连续性：保持左上方暖色主光/);
assert.deepEqual(differences(lightBrief), [{ label: "运镜、机位与灯光", tab: "camera" }]);
assert.deepEqual(differences({ ...basisInput, shot: { ...basisInput.shot,
  references: [{ kind: "角色", revision: "v02" }], endMs: 7000 } }), [
  { label: "参考版本与关键画面", tab: "board" }, { label: "动态分镜时序", tab: "animatic" }
]);
assert.deepEqual(differences({ ...basisInput, script: { ...basisInput.script, state: "随身物品已被取走。" } }),
  [{ label: "人物状态与世界规则", tab: "canon" }]);
assert.equal(basisParts("legacy structure"), null);

console.log("PASS generation draft · story anchor · character identity · versioned visual references · camera · art constraints");

const assets = [
  { id: "A0", kind: "角色", name: "角色A", revision: "v03" },
  { id: "A1", kind: "场景", name: "旧公寓", revision: "v02" },
  { id: "A2", kind: "分镜关键画面", name: "起幅", revision: "v01" }
];
assert.deepEqual(compatibleReferences({ assetKinds: ["角色"] }, assets).map(item => item.id), ["A0"]);
assert.deepEqual(compatibleReferences({ assetKinds: ["场景", "道具"] }, assets).map(item => item.id), ["A1"]);
assert.deepEqual(compatibleReferences({}, assets), assets, "legacy workflows without assetKinds stay unrestricted");
assert.deepEqual(defaultReference({ assetKinds: ["角色"] }, assets, ""), { id: "A0", automatic: true },
  "a unique compatible version is selected automatically");
assert.deepEqual(defaultReference({}, assets, ""), { id: "", automatic: false },
  "multiple versions remain unselected until the creator confirms one");
assert.deepEqual(defaultReference({ assetKinds: ["角色"] }, assets, "A1"), { id: "A0", automatic: true },
  "a remembered selection with the wrong asset kind is not reused");
assert.deepEqual(defaultReference({ assetKinds: ["角色"] }, assets, "A0"), { id: "A0", automatic: false },
  "a valid remembered version remains selected");
console.log("PASS reference selection · character/environment/keyframe type filter · legacy compatibility");
