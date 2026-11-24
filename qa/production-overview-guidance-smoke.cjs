"use strict";

const assert = require("node:assert/strict");
global.window = {};
require("../production-overview.js");

const assets = new Map([
  ["A01", { id: "A01", kind: "角色" }],
  ["A02", { id: "A02", kind: "场景" }]
]);
const missing = window.arcOverview.qualityAdvice({}, null, assets);
assert.deepEqual(missing, [
  "绑定本镜关键画面，锁定构图",
  "绑定角色外观参考（如本镜有人物）",
  "绑定场景空间参考（如有固定场景）",
  "补充表演节拍（有人物表演时）"
]);
const referenced = window.arcOverview.qualityAdvice({ refs: ["A01", "A02"], performance: "先停顿，再抬眼" },
  { id: "A03" }, assets);
assert.deepEqual(referenced, [], "a fully directed shot has no optional quality advice");

const projectFiles = {
  storyboard: (_project, _episode) => [{ index: 0, id: "S01", start: 0, end: 3000, specified: true,
    frame: null, cameraPlan: null }],
  assembly: () => ({ shots: [{ index: 0, verdict: "待审", issue: "", title: "" }], ready: [], duration: 0 }),
  targetDuration: () => 90,
  scriptAnchorStatus: () => ({ ready: true })
};
global.window.arcProductionProject = projectFiles;
global.window.arcRecheck = { context: () => [] };
global.window.arcArtReview = { current: () => ({ checks: [], stale: false }) };
global.window.arcContinuity = require("../production-continuity.js");
global.window.arcOverviewJobs = { validJobId: () => false };
const project = { series: {}, assets: [], episodes: [{ pages: { story: "她抬眼。" }, shots: [{
  scriptAnchor: "她抬眼。", beat: "揭示她注意到门外的人。", composition: "近景，目光看向画外。",
  move: "固定", duration: "3"
}] }] };
const advised = window.arcOverview.describe(project, 0);
assert.equal(advised.rows[0].label, "待生成 · 有画面建议");
assert.deepEqual(advised.rows[0].next, { workspace: "video", tab: "generation", index: 0 },
  "quality advice remains actionable but does not prevent generation");
assert.match(advised.stages[1][1], /质量建议已处理 0 \/ 1 镜/);

const emptyEpisode = window.arcOverview.describe({ series: {}, assets: [], episodes: [{ pages: { story: "她抬眼。" }, shots: [{}] }] }, 0);
assert.equal(emptyEpisode.rows.length, 0, "the blank first-shot editing slot is not a real production shot");
assert.equal(emptyEpisode.stages[1][1], "尚未拆分镜头");
assert.equal(emptyEpisode.stages[2][1], "等待分镜镜头");
assert.equal(emptyEpisode.stages[3][1], "等待镜头通过");
assert.equal(emptyEpisode.next.title, "开始拆分分镜");
assert.deepEqual(emptyEpisode.next.route, { workspace: "video", tab: "board", index: 0 });

project.episodes[0].shots[0] = { ...project.episodes[0].shots[0], version: "v1", file: "E01-S01.mp4" };
projectFiles.assembly = () => ({ shots: [{ index: 0, verdict: "待审", issue: "", title: "v1" }], ready: [], duration: 0 });
const existing = window.arcOverview.describe(project, 0);
assert.equal(existing.rows[0].label, "待审片", "optional guidance does not block an existing candidate from review");
assert.ok(existing.rows[0].guidance.length, "recommendations remain visible while reviewing older candidates");

const realProjectFiles = require("../production-project.js");
Object.assign(window.arcProductionProject, {
  storyboard: realProjectFiles.storyboard,
  assembly: realProjectFiles.assembly
});
const episode = project.episodes[0];
episode.shots.push({}, { ...episode.shots[0], version: "v3", file: "E01-S03.mp4" });
episode.shotOrder = [1, 2, 0];
const reordered = window.arcOverview.describe(project, 0);
assert.deepEqual(reordered.rows.map(({ id, reason, next }) => [id, reason, next.index]), [
  ["S03", "v3", 2], ["S01", "v1", 0]
], "skipping a blank slot preserves the candidate and navigation target for each visible shot");
const { summarize, nextLog } = require("../production-job-log.js");
const makeJob = (id, status, testFixture, executionMs) => ({ id, status, testFixture, timing: { executionMs } });
const fixtureA1 = makeJob("a1", "failed", true, 700);
const fixtureA2 = makeJob("a2", "complete", true, 900);
const fixtureB = makeJob("b1", "complete", true, 1300);
const demo = { generationLog: JSON.stringify([fixtureA1, makeJob("real", "complete", false, 2200),
  makeJob("legacy", "complete", undefined, 50000)]) };
const logged = summarize([demo], () => [{ attempts: { A: [fixtureA1, { id: "rejected", status: "rejected" }, fixtureA2],
  B: [{ id: fixtureB.id, status: "queued" }] } }], new Map([[fixtureB.id, fixtureB]]));
assert.equal(logged.total, 5);
assert.equal(logged.fixtures.A, 2);
assert.equal(logged.fixtures.B, 1);
assert.equal(logged.fixtures.retry, 1);
assert.equal(logged.fixtures.execution.milliseconds, 2900);
assert.equal(logged.service.execution.milliseconds, 2200);
assert.equal(logged.unknown.execution.milliseconds, 50000);
assert.equal(JSON.parse(nextLog({}, fixtureB))[0].testFixture, true);
console.log("PASS overview advice and separate episode timings · regular, A/B retries, local fixtures, legacy");
