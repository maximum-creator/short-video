"use strict";

const assert = require("node:assert/strict");
const projectFiles = require("../production-project.js");
const artReview = require("../production-art-review.js");

const series = { character: "角色A", look: "暖色逆光", limits: "服装一致" };
const completeChecks = artReview.dimensions.map(([id]) => ({ id, result: "符合", note: "" }));
const pages = { story: "角色A推开门。", dialogue: "" };
function makeShot(index, duration = 15) {
  const shot = { scriptAnchor: "角色A推开门。", beat: `第 ${index + 1} 镜揭示门后的空间。`,
    composition: "中近景", move: "缓慢推进", path: "", refs: [], version: `v${index + 1}`,
    file: `E01-S${String(index + 1).padStart(2, "0")}.mp4`, inPoint: "0", outPoint: String(duration), verdict: "通过" };
  shot.sourceBinding = JSON.stringify({ version: shot.version, file: shot.file, size: 100,
    fingerprint: "sha256:" + String(index + 1).repeat(64), contentDigest: "sha256-tree-v1:" + String(index + 1).repeat(64) });
  shot.artReviews = JSON.stringify([{ version: shot.version, file: shot.file,
    signature: artReview.signature(shot, series, pages), checks: completeChecks }]);
  return shot;
}

const one = { pages, shots: [makeShot(0)] };
const partial = projectFiles.assembly({ series, episodes: [one] }, 0);
assert.equal(partial.duration, 15);
assert.equal(partial.episodeTargetDurationSec, 90);
assert.equal(partial.minimumShotCount, 6);
assert.ok(Math.abs(partial.durationProgress - 100 / 6) < 1e-10);
assert.equal(partial.targetReached, false, "one maximum-length H3 shot remains a segment, not a complete episode");
const partialManifest = projectFiles.manifest({ series, episodes: [one] }, 0, "720");
assert.equal(partialManifest.shots.length, 1, "partial cuts stay available for rough-cut review");
assert.equal(partialManifest.targetDurationSec, 90);
const overlong = { pages: one.pages, shots: [makeShot(0, 16)] };
assert.match(projectFiles.assembly({ series, episodes: [overlong] }, 0).error, /单镜超过 H3 的 15 秒输出上限/);

const complete = { targetDurationSec: 90, pages,
  shots: Array.from({ length: 6 }, (_, index) => makeShot(index)) };
const full = projectFiles.assembly({ series, episodes: [complete] }, 0);
assert.equal(full.duration, 90);
assert.equal(full.ready.length, 6);
assert.equal(full.targetReached, true);
assert.equal(projectFiles.restore(projectFiles.backup({ series, episodes: [complete] })).episodes[0].targetDurationSec, 90);
assert.throws(() => projectFiles.restore(projectFiles.backup({ series,
  episodes: [{ ...complete, targetDurationSec: 601 }] })), /有效的弧光项目备份/);

console.log("PASS episode target · progress · minimum shot count · 15-second shot cap · backup validation");
