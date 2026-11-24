"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const projectFiles = require("../production-project.js");
const artReview = require("../production-art-review.js");
const arcEpisode = require(path.resolve(__dirname,
  "../../../../2026-09-22/arc-deepseek/work/Arc-Light/web/episode-assembly.js"));
const arcProject = require(path.resolve(__dirname,
  "../../../../2026-09-22/arc-deepseek/work/Arc-Light/web/project-engine.js"));

const pages = { story: "场次一。角色A站在窗边沉默，随后抬眼。", dialogue: "角色A：我会回来的。" };
const series = { character: "角色A", look: "暖色逆光", limits: "服装保持一致" };
const jobId = "f086f366-f485-4fd1-a15e-15a2908ce202";
const shot = { scriptAnchor: "角色A站在窗边沉默，随后抬眼。", beat: "观众看到角色A作出决定。",
  composition: "面部近景", move: "固定", path: "从门口看向窗边", guide: "人物抬眼时保持构图",
  refs: ["A0"], version: "生成-v1", file: "E01-S01.mp4", inPoint: "0", outPoint: "2", verdict: "通过",
  sourceBinding: JSON.stringify({ version: "生成-v1", file: "E01-S01.mp4", size: 100,
    fingerprint: "sha256:" + "a".repeat(64), contentDigest: "sha256-tree-v1:" + "d".repeat(64) }),
  generatedCandidate: JSON.stringify({ jobId, index: 0, name: "E01-S01.mp4", assetKey: "b".repeat(64), version: "生成-v1" }) };

assert.equal(projectFiles.scriptAnchorStatus(shot, pages).ready, true);
assert.equal(projectFiles.scriptAnchorStatus({ ...shot, scriptAnchor: "我会回来的" }, pages).ready, true,
  "dialogue quotes also provide an anchor");
assert.equal(projectFiles.scriptAnchorStatus({ ...shot, scriptAnchor: "人物站到窗旁" }, pages).missing, false);
assert.equal(projectFiles.scriptAnchorStatus({ ...shot, scriptAnchor: "" }, pages).missing, true);
assert.match(projectFiles.scriptAnchorStatus({ ...shot, scriptAnchor: "x".repeat(501) }, pages).reason, /500 字以内/);

const project = { series, assets: [{ id: "A0", kind: "角色", name: "角色A常服", revision: "v03", notes: "统一外套" }],
  episodes: [{ pages, shots: [shot] }] };
delete shot.scriptAnchor;
assert.match(projectFiles.assembly(project, 0).error, /请在分镜补填本镜对应的剧本原句；请回到分镜核对。/);
shot.scriptAnchor = "角色A站在窗边沉默，随后抬眼。";
shot.artReviews = JSON.stringify([{ version: shot.version, file: shot.file,
  signature: artReview.signature(shot, series, pages),
  checks: artReview.dimensions.map(([id]) => ({ id, result: "符合", note: "" }))
}]);
assert.equal(projectFiles.assembly(project, 0).error, "");
shot.beat = "观众看到她已经做出另一个决定。";
assert.match(projectFiles.assembly(project, 0).error, /剧本段落、连续性规则或分镜已变化.*请在镜头审片补齐/);
shot.beat = "观众看到角色A作出决定。";
assert.equal(projectFiles.assembly(project, 0).error, "");
const manifest = projectFiles.manifest(project, 0, "720");
assert.equal(manifest.targetDurationSec, 90, "episode target duration crosses the workbench-to-ARC contract");
assert.equal(manifest.shots[0].scriptAnchor, shot.scriptAnchor,
  "the original story line crosses the workbench manifest");
assert.equal(manifest.shots[0].productionOrigin.generationAssetKey, "b".repeat(64),
  "the generation output identity crosses the workbench manifest");
assert.deepEqual(manifest.shots[0].productionOrigin, {
  schema: "arc-short-drama-origin-v1", episode: 1, shotId: "E01-S01", candidateVersion: "生成-v1", generationJobId: jobId,
  generationAssetKey: "b".repeat(64),
  scriptAnchor: shot.scriptAnchor, beat: shot.beat, composition: shot.composition, performance: "",
  references: [{ kind: "角色", name: "角色A常服", revision: "v03", notes: "统一外套" }],
  camera: { move: "固定", path: "从门口看向窗边", guide: "人物抬眼时保持构图" }
});
const expectedSource = JSON.parse(shot.sourceBinding);
assert.equal(manifest.shots[0].source.contentDigest, expectedSource.contentDigest);
const assembled = arcEpisode.assemble(manifest, [{ id: "source-1", name: shot.file, size: 100, fingerprint: "sha256:" + "a".repeat(64),
  contentDigest: expectedSource.contentDigest,
  duration: 2, width: 720, height: 1280 }], "bridge-smoke");
assert.equal(assembled.clips[0].scriptAnchor, shot.scriptAnchor,
  "the original story line reaches the ARC timeline clip");
assert.equal(assembled.clips[0].productionOrigin.candidateVersion, "生成-v1");
assert.equal(assembled.clips[0].productionOrigin.references[0].revision, "v03");
assert.equal(assembled.clips[0].productionOrigin.camera.guide, "人物抬眼时保持构图");
assert.equal(projectFiles.generatedCandidate(shot).basisStatus, "unknown");
const importedCandidate = { version: "生成-v2", file: "returned.mp4" };
const submittedRefs = [{ role: "角色参考", kind: "角色", name: "角色A常服", revision: "v02" },
  { role: "运动参考", name: "walk.mp4" }];
importedCandidate.generatedCandidate = projectFiles.saveGeneratedCandidate(importedCandidate, {
  url: `/api/generation/${jobId}/video/1`, name: importedCandidate.file, assetKey: "c".repeat(64)
}, jobId, "changed", "d".repeat(64), submittedRefs);
projectFiles.saveCandidate(importedCandidate);
projectFiles.loadCandidate(importedCandidate, 0);
assert.equal(projectFiles.generatedCandidate(importedCandidate).basisStatus, "changed",
  "the basis status stays attached to the saved candidate when restored from history");
assert.equal(projectFiles.generatedCandidate(importedCandidate).basisHash, "d".repeat(64));
assert.deepEqual(projectFiles.generatedCandidate(importedCandidate).jobReferences, submittedRefs);
assert.equal(projectFiles.generatedCandidate(shot).jobReferences, undefined);
assert.equal(projectFiles.generatedCandidate({ ...importedCandidate, file: "different.mp4" }), null,
  "the warning must not attach to another file");
const coverageReview = { schema: "arc-short-drama-coverage-review-v1", confirmed: true,
  sourceUnitCount: 3, unlinkedUnitCount: 1,
  shotAnchors: [{ id: "E01-S01", scriptAnchor: shot.scriptAnchor, start: 0, end: 2 }] };
const reviewedManifest = projectFiles.manifest(project, 0, "720", coverageReview);
assert.deepEqual(reviewedManifest.scriptCoverageReview, coverageReview,
  "manual episode coverage signoff crosses the workbench handoff package");
const reviewedProject = arcEpisode.assemble(reviewedManifest, [{ id: "source-1", name: shot.file, size: 100,
  fingerprint: "sha256:" + "a".repeat(64), contentDigest: expectedSource.contentDigest,
  duration: 2, width: 720, height: 1280 }], "coverage-review-smoke");
assert.deepEqual(arcProject.normalize(reviewedProject).episodeCoverageReview, coverageReview,
  "ARC project validation preserves the signoff for editing and save/reopen");
assert.throws(() => arcEpisode.assemble({ ...reviewedManifest, scriptCoverageReview: {
  ...coverageReview, shotAnchors: [{ ...coverageReview.shotAnchors[0], end: 1.5 }]
} }, [{ id: "source-1", name: shot.file, size: 100, fingerprint: "sha256:" + "a".repeat(64),
  contentDigest: expectedSource.contentDigest, duration: 2, width: 720, height: 1280 }], "stale-coverage-review"),
/剧本覆盖核对记录与镜头顺序、原句或切点不一致/);
assert.throws(() => arcProject.normalize({ ...reviewedProject, episodeCoverageReview: {
  ...coverageReview, unlinkedUnitCount: 4
} }), /漫剧剧本覆盖核对记录无效/);
assert.match(projectFiles.assembly({ series, episodes: [{ pages: { story: "剧情已改写", dialogue: "" }, shots: [shot] }] }, 0).error,
  /剧本原句已不在当前剧情或对白中/);

global.window = {};
require("../production-overview.js");
const pendingAnchor = "窗外响起警铃。";
const reorderedPages = { ...pages, story: pages.story + pendingAnchor };
const first = { ...shot };
first.generatedCandidate = JSON.stringify({ ...JSON.parse(first.generatedCandidate), jobReferences: submittedRefs });
const third = { ...shot, scriptAnchor: pages.dialogue, version: "生成-v3", file: "E01-S03.mp4",
  inPoint: "0.5", outPoint: "1.5", generatedCandidate: "" };
third.sourceBinding = JSON.stringify({ ...expectedSource, version: third.version, file: third.file });
for (const candidate of [first, third]) {
  candidate.artReviews = JSON.stringify([{ ...JSON.parse(shot.artReviews)[0], version: candidate.version,
    file: candidate.file, signature: artReview.signature(candidate, series, reorderedPages) }]);
}
const reorderedEpisode = { pages: reorderedPages, shots: [first, { scriptAnchor: pendingAnchor }, third],
  shotOrder: [2, 1, 0] };
const reorderedProject = { ...project, episodes: [reorderedEpisode] };
const ready = projectFiles.assembly(reorderedProject, 0).ready;
const coverage = window.arcOverview.scriptCoverage(reorderedEpisode, new Set(ready.map(item => item.index)));
assert.equal(window.arcOverview.scriptCoverage(reorderedEpisode).pending, 1);
assert.equal(coverage.pending, 2, "a pending shot only covers its lines in the planning view");
const reorderedManifest = projectFiles.manifest(reorderedProject, 0, "720", {
  ...coverageReview, sourceUnitCount: coverage.rows.length, unlinkedUnitCount: coverage.pending,
  shotAnchors: ready.map(({ id, scriptAnchor, start, end }) => ({ id, scriptAnchor, start, end }))
});
const sources = [first, third].map(({ file }, index) => ({ id: `source-${index + 1}`,
  name: file, size: expectedSource.size, fingerprint: expectedSource.fingerprint,
  contentDigest: expectedSource.contentDigest, duration: 2, width: 720, height: 1280 }));
const reorderedClips = arcProject.normalize(arcEpisode.assemble(reorderedManifest, sources, "reorder-smoke")).clips;
assert.deepEqual(reorderedClips[1].productionOrigin.generationReferences, submittedRefs);
assert.equal(reorderedClips[1].productionOrigin.references[0].revision, "v03",
  "planned v03 and submitted v02 belong to separate fields");
assert.equal(reorderedClips[0].productionOrigin.generationReferences, undefined);
assert.deepEqual(reorderedClips.map(clip => [clip.productionOrigin.shotId, clip.sourceId,
  clip.productionOrigin.candidateVersion, clip.scriptAnchor, clip.start, clip.end]), [
  ["E01-S03", "source-2", third.version, third.scriptAnchor, 0.5, 1.5],
  ["E01-S01", "source-1", first.version, first.scriptAnchor, 0, 2]
]);

console.log("PASS script anchor · exact source · invalidation · pass gate · workbench-to-ARC clip handoff");
