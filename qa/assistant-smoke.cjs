"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const { answer } = require("../arc-assistant.cjs");
const h3Prompts = require("../arc-h3-prompt.cjs");

const roles = [
  { role: "character", label: "角色图", assetId: "A01", assetKind: "角色", assetKinds: ["角色"] },
  { role: "motion", label: "动作视频", kind: "video", mediaName: "motion.mp4" },
  { role: "sound", label: "声音参考", kind: "audio", mediaName: "sound.wav" }
];
const snapshot = {
  schema: "arc-production-context-v1", episode: 1,
  script: { story: "主角在窗边沉默，随后抬眼", dialogue: "", state: "", rules: "人物只有主角" },
  continuity: [], art: { character: "年轻男性，统一外套", look: "暖色逆光", limits: "不可增加人物" },
  shots: [{ id: "S01", startMs: 0, endMs: 6000, durationConfirmed: true,
    story: { scriptAnchor: "主角在窗边沉默", scriptAnchorValid: true, beat: "主角抬眼", composition: "面部近景",
      performance: "先停顿，再缓慢抬眼，嘴唇不动。", reference: "" },
    camera: { move: "固定机位", path: "", guide: "" },
    references: [{ id: "A01", kind: "角色", name: "主角参考", revision: "v1", notes: "年轻男性，统一外套" }],
    keyframe: null, review: { version: "", verdict: "待审", issue: "", notes: [], checks: [], artChecks: [], history: [] }
  }]
};
const payload = { mode: "prompt", role: "video", shotId: "S01", promptMode: "ref2va", referenceRoles: roles,
  turns: [{ role: "user", content: "先固定机位等人物抬眼，保持统一外套和暖色逆光，不新增人物或对白。" }], snapshot };
const modelReply = { choices: [{ message: { content: JSON.stringify({
  summary: "近景保持人物造型与暖色逆光，先静止再缓慢抬眼；机位固定，不增加人物或对白。",
  warnings: [], sections: {
    subject_definitions: "<Subject 1> <Picture 1> defines the protagonist. <Video 1> guides motion. <Audio 1> guides sound.",
    summary: "Close-up; preserve the protagonist and warm backlight, then slowly raise his eyes.",
    retention_analysis: "Preserve face, hairstyle, black coat and warm backlight.",
    detailed_description: "A young man in a black coat holds still, then slowly raises his eyes toward the warm window light. Keep his face, hairstyle and coat consistent. Locked camera, restrained expression, no extra people or dialogue.",
    overall_soundscape: "Quiet interior ambience.", non_diegetic_music: "No added music."
  }
}) } }] };

async function main() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(modelReply));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const profile = h3Prompts.configure("ref2va", "6", [
    { id: "character", label: "角色图", assetKinds: ["角色"] }, { id: "motion", label: "动作视频", kind: "video" },
    { id: "sound", label: "声音参考", kind: "audio" }
  ], []);
  const h3Draft = h3Prompts.prepare(profile, [], roles);
  try {
    const plan = structuredClone(payload);
    plan.snapshot.shots[0].story.motionAction = "skate";
    const result = await answer({ model: "mock", models: {}, port }, plan, new AbortController().signal, [], h3Draft);
    assert.equal(result.model, "mock");
    assert.match(result.promptDraft.prompt, /<Picture 1>/);
    assert.match(result.promptDraft.prompt, /Duration: 6\.00 seconds/);
    assert.equal(result.promptDraft.warnings.length, 0, "a concise 6 s description does not receive a length warning");
    console.log("PASS assistant draft · H3 ref2va · multimodal bindings · concise single-shot structure");
    assert.match(requests.at(-1).messages[0].content, /没有候选画面时只评价制作计划/);
    assert.match(requests.at(-1).messages[0].content, /一次只生成当前一个分镜镜头/);
    assert.match(requests.at(-1).messages[0].content, /不得把动作参考视频的人物外观或背景带入目标镜头/);
    assert.match(requests.at(-1).messages[0].content, /起始状态、可见动作与表情变化、收束状态/);
    assert.match(requests.at(-1).messages[0].content, /当前证据来源（文字计划\/候选抽样画面及时间）/);
    assert.match(requests.at(-1).messages[1].content, /\"composition\":\"面部近景\"/);
    assert.match(requests.at(-1).messages[1].content, /\"performance\":\"先停顿，再缓慢抬眼，嘴唇不动。\"/);
    assert.match(requests.at(-1).messages[1].content, /\"scriptAnchor\":\"主角在窗边沉默\"/);
    assert.match(requests.at(-1).messages[1].content, /"motionPlan":\{"name":"花滑掠冰"/);
    console.log("PASS video director context · motion plan, script-purpose, composition, camera and evidence boundary");
    const wrongAssetSnapshot = structuredClone(snapshot);
    wrongAssetSnapshot.shots[0].references[0].kind = "场景";
    await assert.rejects(() => answer({ model: "mock", models: {}, port },
      { ...payload, snapshot: wrongAssetSnapshot }, new AbortController().signal, [], h3Draft), /绑定无效/);
    console.log("PASS assistant reference integrity · role type is checked against the bound project asset");
    const mixedRoles = [
      roles[0],
      { role: "camera", label: "运镜预演", kind: "video", mediaName: "camera.mp4" },
      { ...roles[1], motionOnly: true }
    ];
    const mixedProfile = h3Prompts.configure("ref2va", "6", mixedRoles.map(({ role, label, kind }) =>
      ({ id: role, label, kind })), []);
    const mixed = h3Prompts.prepare(mixedProfile, [], mixedRoles);
    assert.throws(() => h3Prompts.prepare(mixedProfile, [], mixedRoles.map((item, index) =>
      index === 1 ? { ...item, motionOnly: true } : item)), /只可将一条/);
    assert.throws(() => h3Prompts.prepare(mixedProfile, [], mixedRoles.map((item, index) =>
      index === 0 ? { ...item, motionOnly: true } : { ...item, motionOnly: false })), /视频参考输入/);
    assert.match(h3Prompts.instructions(mixed).join("\n"), /<Video 2> 是用户明确选入的白模/);
    const mixedReply = JSON.parse(modelReply.choices[0].message.content);
    mixedReply.sections.subject_definitions =
      "<Subject 1> uses <Picture 1> for appearance, <Video 1> for camera movement and <Video 2> for action timing.";
    const mixedPrompt = h3Prompts.format(mixedReply, mixed).prompt;
    assert.match(mixedPrompt, /Use <Video 2> only for body motion and action timing/);
    assert.doesNotMatch(mixedPrompt, /Use <Video 1> only for body motion/);
    console.log("PASS H3 pins the white-model instruction to the correct video marker among multiple videos");
    const longDescription = Array(36).fill("A young man slowly raises his eyes toward warm light.").join(" ");
    const longDraft = h3Prompts.format({
      summary: "镜头描述长度符合常见建议。", warnings: [], sections: {
        ...JSON.parse(modelReply.choices[0].message.content).sections,
        detailed_description: longDescription
      }
    }, h3Draft);
    assert.equal(longDraft.warnings.length, 0);
    console.log("PASS H3 description length · 360 English words receives no short-description warning");
    const scriptPayload = { ...payload, role: "script", turns: [{ role: "user",
      content: "逐镜核对本集剧本与分镜覆盖，并检查人物所知。" }] };
    delete scriptPayload.mode;
    delete scriptPayload.promptMode;
    delete scriptPayload.referenceRoles;
    const scriptResult = await answer({ model: "mock", models: {}, port }, scriptPayload,
      new AbortController().signal);
    assert.ok(scriptResult.reply);
    assert.match(requests.at(-1).messages[0].content, /明确矛盾、覆盖不足与资料不足/);
    assert.match(requests.at(-1).messages[0].content, /剧本原文锚点｜镜头目的｜判断（吻合\/部分吻合\/矛盾\/证据不足）/);
    assert.match(requests.at(-1).messages[1].content, /\"composition\":\"面部近景\"/);
    assert.match(requests.at(-1).messages[1].content, /\"performance\":\"先停顿，再缓慢抬眼，嘴唇不动。\"/);
    console.log("PASS script editor context · per-shot coverage and contradiction review evidence");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  let unavailablePort;
  const unused = http.createServer();
  await new Promise(resolve => unused.listen(0, "127.0.0.1", resolve));
  unavailablePort = unused.address().port;
  await new Promise(resolve => unused.close(resolve));
  await assert.rejects(() => answer({ model: "mock", models: {}, port: unavailablePort }, payload,
    new AbortController().signal, [], h3Draft), new RegExp(`127\\.0\\.0\\.1:${unavailablePort}.*--assistant-port`));
  console.log("PASS assistant connection failure · includes endpoint and recovery action");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
