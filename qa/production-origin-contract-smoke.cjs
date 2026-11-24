"use strict";

const assert = require("node:assert/strict");
const files = require("../production-project.js");
const art = require("../production-art-review.js");

const series = { character: "主角", look: "柔和侧光", limits: "风衣与配饰保持一致" };
const shot = {
  scriptAnchor: "角色A推开旧仓库的门。", beat: "她发现门后有人刚离开。",
  composition: "中近景，角色A停在画面左侧，门内留出空场。",
  performance: "先屏息，再抬眼；嘴唇闭合，视线落向门内。",
  duration: "4", inPoint: "0", outPoint: "4", version: "v1", file: "E01-S01.mp4",
  verdict: "通过", refs: [], move: "缓慢推进", path: "从门外越过门槛", guide: "抬眼时停住",
  sourceBinding: JSON.stringify({ version: "v1", file: "E01-S01.mp4", size: 100, fingerprint: "sha256:" + "a".repeat(64), contentDigest: "sha256-tree-v1:" + "d".repeat(64) })
};
shot.artReviews = JSON.stringify([{
  version: shot.version, file: shot.file, signature: art.signature(shot, series, { story: shot.scriptAnchor, dialogue: "" }),
  checks: art.dimensions.map(([id]) => ({ id, result: "符合", note: "" }))
}]);

const project = { series, assets: [], episodes: [{ pages: { story: shot.scriptAnchor, dialogue: "" }, shots: [shot] }] };
const manifest = files.manifest(project, 0, "720");
const origin = manifest.shots[0].productionOrigin;
assert.equal(origin.scriptAnchor, shot.scriptAnchor);
assert.equal(origin.beat, shot.beat);
assert.equal(origin.composition, shot.composition);
assert.equal(origin.performance, shot.performance);
assert.equal(origin.camera.path, shot.path);
assert.equal(origin.motionPlan, undefined, "older shots without a motion plan keep their existing contract");
shot.motionAction = "kick";
assert.match(files.assembly(project, 0).error, /重新完成视觉验收/, "a newly selected motion plan invalidates the old approval");
const review = JSON.parse(shot.artReviews);
review[0].signature = art.signature(shot, series, project.episodes[0].pages);
shot.artReviews = JSON.stringify(review);
assert.equal(files.manifest(project, 0, "720").shots[0].productionOrigin.motionPlan.name, "踢刀");
const referenceProject = { assets: [
  { id: "A01", name: "角色A常服", kind: "角色" }, { id: "A02", name: "场景", kind: "场景" },
  { id: "A03", name: "角色A常服", kind: "角色" }
] };
const previousShot = { refs: ["A01", "A02"] };
assert.deepEqual(files.replacementReferences(referenceProject, previousShot, "A01", "A03"), ["A03", "A02"]);
assert.deepEqual(previousShot.refs, ["A01", "A02"]);
assert.deepEqual(files.replacementReferences(referenceProject, { refs: ["A01", "A02", "A03"] }, "A01", "A03"), ["A03", "A02"]);
assert.throws(() => files.replacementReferences(referenceProject, previousShot, "A01", "A02"), /同名同类别/);
console.log("PASS ARC production origin and shot-scoped reference replacement");
