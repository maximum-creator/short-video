"use strict";

const assert = require("node:assert/strict");
const project = require("../production-project.js");

const retryBasis = { status: "failed", shot: { id: "E01-S01", version: "v3", start: 1.25, end: 4.25 },
  source: { name: "source.mp4", size: 1234, sha256: "a".repeat(64) },
  media: { name: "crop.mp4", size: 3456, sha256: "b".repeat(64) },
  providerFingerprint: "c".repeat(64), retryCount: 0, attemptHistory: [],
  options: { workflowSha256: "d".repeat(64), shortEdge: 1080, nested: { fps: "24" } } };
const nextRetryBasis = structuredClone(retryBasis);
delete nextRetryBasis.status;
assert.equal(project.sameAiEnhancementRetryBasis(retryBasis, nextRetryBasis), true,
  "the exact same terminal workflow/input/options can continue the retry ledger");
for (const changed of [
  { ...nextRetryBasis, providerFingerprint: "e".repeat(64) },
  { ...nextRetryBasis, options: { ...nextRetryBasis.options, workflowSha256: "f".repeat(64) } },
  { ...nextRetryBasis, options: { ...nextRetryBasis.options, shortEdge: 720 } },
  { ...nextRetryBasis, source: { ...nextRetryBasis.source, sha256: "e".repeat(64) } },
  { ...nextRetryBasis, media: { ...nextRetryBasis.media, sha256: "e".repeat(64) } },
  { ...nextRetryBasis, shot: { ...nextRetryBasis.shot, end: 4.5 } },
]) assert.equal(project.sameAiEnhancementRetryBasis(retryBasis, changed), false,
  "changing endpoint, workflow, options, source, crop, cut or a nonterminal state starts a separate run");
assert.equal(project.sameAiEnhancementRetryBasis({ ...retryBasis, status: "queued" }, nextRetryBasis), false,
  "a running task cannot seed a new retry ledger");
assert.equal(project.sameAiEnhancementRetryBasis({ ...retryBasis, retryCount: 1, attemptHistory: [{ status: "failed" }] },
  nextRetryBasis), false, "an older or incomplete retry ledger without parameter snapshots starts a new run");
console.log("PASS AI enhancement retries require the same completed shot, source, crop, provider, workflow and options");

const source = { name: "E01-S01.mp4", size: 1234, sha256: "a".repeat(64) };
const shot = { verdict: "通过", version: "v3", file: source.name, inPoint: "1.25", outPoint: "4.25", caption: "", refs: [] };
const options = { resolution: "1080", fps: "60", cleanup: "gentle", interpolate: true };

const job = project.enhancement(0, 0, shot, source, options);
const splitOptions = { resolution: "1080", fps: "60", denoise: "medium", sharpen: "off", interpolate: true };
assert.deepEqual(project.enhancement(0, 0, shot, source, splitOptions).options, splitOptions,
  "new enhancement jobs keep denoise and sharpening as independent controls");
assert.deepEqual(job, {
  schema: "arc-shot-enhance-v1",
  shot: { id: "E01-S01", version: "v3", start: 1.25, end: 4.25 },
  source,
  options
});
console.log("PASS enhancement request · approved version · exact source identity · cut range · options");

const report = {
  schema: "arc-shot-enhance-result-v1", shot: job.shot, source, options,
  processing: { schema: "arc-local-processing-v1", engine: "ffmpeg", profile: "legacy-cleanup-v1",
    processingMs: 4321,
    ffmpegVersion: "ffmpeg version test-fixture", videoFilter: "setpts=PTS-STARTPTS,hqdn3d=1.2:0.9:2.4:1.8",
    audioFilter: "atrim=duration=3.000000,aresample=48000,apad",
    videoEncoder: "libx264 -crf 17 -preset fast -pix_fmt yuv420p", audioEncoder: "aac" },
  output: { name: "E01-S01-processed.mp4", size: 2345, sha256: "b".repeat(64),
    width: 1920, height: 1080, audio: true, frames: 180, fps: 60, duration: 3 }
};
const candidate = project.enhancementCandidate(0, 0, shot, report, source, {
  name: report.output.name, size: report.output.size, sha256: report.output.sha256,
  width: report.output.width, height: report.output.height, duration: report.output.duration
});
assert.equal(candidate.verdict, "待审");
assert.equal(candidate.inPoint, "0");
assert.equal(candidate.outPoint, "3");
assert.match(candidate.version, /^增强-b{12}$/);
assert.equal(project.enhancementDetails(candidate).processing.ffmpegVersion, "ffmpeg version test-fixture");
assert.equal(project.enhancementDetails(candidate).processing.processingMs, 4321);
assert.match(project.enhancementDetails(candidate).processing.videoFilter, /hqdn3d=1\.2/);
assert.throws(() => project.enhancementCandidate(0, 0, shot,
  { ...report, processing: { ...report.processing, processingMs: -1 } }, source, report.output), /本地处理器参数报告无效/);

const denoiseA = { ...report, options: { ...splitOptions, denoise: "off" },
  processing: { ...report.processing, profile: "split-denoise-sharpen-v1", processingMs: 900,
    videoFilter: "setpts=PTS-STARTPTS,fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1" } };
const denoiseB = { ...report, options: { ...splitOptions, denoise: "medium" },
  processing: { ...report.processing, profile: "split-denoise-sharpen-v1", processingMs: 1300,
    videoFilter: "setpts=PTS-STARTPTS,hqdn3d=2.0:1.5:4.0:3.0,fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1" },
  output: { ...report.output, name: "E01-S01-medium.mp4", sha256: "c".repeat(64) } };
const denoiseOutputs = [denoiseA, denoiseB].map(item => ({ ...item.output }));
const denoisePair = project.enhancementComparison(0, 0, shot, source, [denoiseA, denoiseB], denoiseOutputs);
assert.equal(denoisePair.schema, "arc-denoise-ab-v1");
assert.equal(denoisePair.controlled, true);
assert.deepEqual(denoisePair.variants.map(item => item.denoise), ["off", "medium"]);
assert.deepEqual(denoisePair.variants.map(item => item.processingMs), [900, 1300]);
assert.throws(() => project.enhancementComparison(0, 0, shot, source,
  [denoiseA, { ...denoiseB, options: { ...denoiseB.options, sharpen: "light" } }], denoiseOutputs), /只切换降噪档/);
assert.throws(() => project.enhancementComparison(0, 0, shot, source,
  [denoiseA, { ...denoiseB, options: { ...denoiseB.options, denoise: "off" } }], denoiseOutputs), /只切换降噪档/);
assert.throws(() => project.enhancementComparison(0, 0, shot, source,
  [denoiseA, { ...denoiseB, processing: { ...denoiseB.processing, ffmpegVersion: "different ffmpeg" } }], denoiseOutputs), /相同 FFmpeg 版本/);
assert.throws(() => project.enhancementComparison(0, 0, shot, source,
  [denoiseA, { ...denoiseB, processing: { ...denoiseB.processing, videoFilter: denoiseB.processing.videoFilter + ",unsharp=5:5:0.25" } }], denoiseOutputs), /处理链必须完全一致/);
console.log("PASS denoise A/B binds source and cut, permits only denoise variance, verifies filters and records FFmpeg time");
console.log("PASS enhancement return · report identity · frame-aligned duration · pending review candidate");

const jobId = "6a67443f-9555-42b0-8141-559ff9c96fa1";
const comparison = { id: "38fd1280-0f4b-4a66-9b4c-da2be207c897", variant: "B", mode: "vfx",
  effectivePromptSha256: "d".repeat(64), durationSec: 4.46, retryCount: 1 };
const references = [{ role: "白模动作", name: "过门.mp4" }];
const generated = { ...shot, generatedCandidate: project.saveGeneratedCandidate(shot, {
  name: source.name, url: `/api/generation/${jobId}/video/0`, assetKey: "f".repeat(64), testFixture: true
}, jobId, "current", "e".repeat(64), references, comparison) };
const derived = project.enhancementCandidate(0, 0, generated, report, source, report.output);
assert.deepEqual(project.generatedCandidate(generated).comparison, comparison);
const lineage = {
  version: shot.version, name: source.name, sha256: source.sha256, jobId, assetKey: "f".repeat(64),
  jobReferences: references, comparison, testFixture: true,
  basisStatus: "current", basisHash: "e".repeat(64)
};
assert.deepEqual(project.enhancementDetails(derived).generationSource, lineage);
assert.equal(project.enhancementDetails(derived).testFixture, true);

const approved = { ...derived, verdict: "通过" };
const secondJob = project.enhancement(0, 0, approved, report.output, options);
const secondOutput = { ...report.output, name: "twice-processed.mp4", sha256: "c".repeat(64) };
const second = project.enhancementCandidate(0, 0, approved, {
  ...report, shot: secondJob.shot, source: secondJob.source, output: secondOutput
}, report.output, secondOutput);
assert.equal(project.enhancementDetails(second).sourceVersion, derived.version);
assert.deepEqual(project.enhancementDetails(second).generationSource, lineage);
console.log("PASS repeated enhancement preserves the original B generation, inputs and fixture status");

const aiReport = { ...report,
  engine: { kind: "comfyui-ai-enhancement", workflowSha256: "c".repeat(64), taskId: "6a67443f-9555-42b0-8141-559ff9c96fa1",
    providerFingerprint: "9".repeat(64), testFixture: false, timingSource: "per-field", retryCount: 0,
    preflightSchemaSha256: "f".repeat(64), modelParameters: { denoise: 0.75 },
    executionPromptEvidence: { evidence: "comfy-history-prompt", status: "matched",
      submittedSha256: "1".repeat(64), historySha256: "1".repeat(64) },
    attemptHistory: [], timing: { queueMs: 125, executionMs: 2300, bridgeMs: 2450,
      queueSource: "comfy-history-timestamps", executionSource: "comfy-history-timestamps",
      bridgeSource: "local-bridge-observation", gpuKernelTime: false } },
  aiInput: { name: "E01-S01-ai-input.mp4", size: 3456, sha256: "d".repeat(64) },
  aiOutput: { name: "E01-S01-ai.mp4", size: 4567, sha256: "e".repeat(64), width: 1280, height: 720, duration: 3 }
};
delete aiReport.processing;
const aiTask = { schema: "arc-ai-enhancement-task-v1", id: aiReport.engine.taskId, status: "complete",
  source, media: aiReport.aiInput,
  shot: { id: "E01-S01", version: shot.version, start: 1.25, end: 4.25 },
  options: { workflowSha256: aiReport.engine.workflowSha256, preflightSchemaSha256: aiReport.engine.preflightSchemaSha256, denoise: 0.75 },
  providerFingerprint: aiReport.engine.providerFingerprint, testFixture: false,
  executionPromptEvidence: aiReport.engine.executionPromptEvidence,
  retryCount: 0, attemptHistory: [], runtime: { queueMs: 125, executionMs: 2300, bridgeMs: 2450,
    queueSource: "comfy-history-timestamps", executionSource: "comfy-history-timestamps",
    bridgeSource: "local-bridge-observation", gpuKernelTime: false } };
const aiShot = { ...shot, aiEnhancementJob: JSON.stringify(aiTask) };
const aiCandidate = project.enhancementCandidate(0, 0, aiShot, aiReport, source, aiReport.output);
assert.equal(aiCandidate.verdict, "待审");
assert.deepEqual(project.enhancementDetails(aiCandidate).engine, aiReport.engine);
assert.equal(project.enhancementDetails(aiCandidate).engine.retryCount, 0);
assert.equal(project.enhancementDetails(aiCandidate).testFixture, false,
  "a configured provider return stays explicitly non-fixture through project persistence");
assert.equal(project.enhancementDetails(aiCandidate).engine.providerFingerprint, "9".repeat(64));
assert.throws(() => project.enhancementCandidate(0, 0, shot, aiReport, source, aiReport.output), /当前已完成的 ComfyUI 任务/,
  "an AI report without a saved task cannot enter review");
assert.throws(() => project.enhancementCandidate(0, 0, aiShot, { ...aiReport,
  engine: { ...aiReport.engine, taskId: "6a67443f-9555-42b0-8141-559ff9c96fa2" } }, source, aiReport.output), /当前已完成的 ComfyUI 任务/,
  "a result from an older/different task cannot be bound to this shot");
assert.throws(() => project.enhancementCandidate(0, 0, aiShot, { ...aiReport,
  engine: { ...aiReport.engine, providerFingerprint: "8".repeat(64) } }, source, aiReport.output), /当前已完成的 ComfyUI 任务/,
  "a result from another ComfyUI endpoint cannot be bound to this task");
assert.throws(() => project.enhancementCandidate(0, 0, aiShot, { ...aiReport,
  engine: { ...aiReport.engine, workflowSha256: "b".repeat(64) } }, source, aiReport.output), /当前已完成的 ComfyUI 任务/,
  "a result from another workflow revision cannot be bound to this task");
assert.throws(() => project.enhancementCandidate(0, 0, aiShot, { ...aiReport,
  engine: { ...aiReport.engine, providerFingerprint: undefined } }, source, aiReport.output), /AI 处理来源或任务指纹无效/,
  "a return without a ComfyUI endpoint fingerprint cannot enter review");
assert.throws(() => project.enhancementCandidate(0, 0, aiShot, { ...aiReport,
  engine: { ...aiReport.engine, executionPromptEvidence: { ...aiReport.engine.executionPromptEvidence, status: "mismatch", historySha256: "2".repeat(64) } } },
  source, aiReport.output), /AI 处理来源或任务指纹无效/,
  "a real-provider enhancement return with a mismatched execution graph cannot enter review");
assert.throws(() => project.enhancementCandidate(0, 0, aiShot, { ...aiReport,
  engine: { ...aiReport.engine, testFixture: undefined } }, source, aiReport.output), /AI 处理来源或任务指纹无效/,
  "a return without an explicit test/provider classification cannot enter review");
const wrongMediaTask = { ...aiTask, media: { ...aiTask.media, sha256: "f".repeat(64) } };
assert.throws(() => project.enhancementCandidate(0, 0, { ...shot, aiEnhancementJob: JSON.stringify(wrongMediaTask) },
  aiReport, source, aiReport.output), /当前已完成的 ComfyUI 任务/,
  "a result from another crop cannot be bound to this task");
console.log("PASS AI result provenance · workflow SHA-256 bound into pending review candidate");

const wrongShot = structuredClone(report);
wrongShot.shot.id = "E02-S01";
assert.throws(() => project.enhancementCandidate(0, 0, shot, wrongShot, source, report.output), /当前通过镜头/);
const wrongSource = structuredClone(report);
wrongSource.source.sha256 = "c".repeat(64);
assert.throws(() => project.enhancementCandidate(0, 0, shot, wrongSource, source, report.output), /原文件不一致/);
const wrongDuration = { ...report.output, duration: 2.9 };
assert.throws(() => project.enhancementCandidate(0, 0, shot, report, source, wrongDuration), /时长与报告不符/);
console.log("PASS enhancement rejection · wrong episode/shot · wrong source hash · wrong output duration");

const betweenFrames = { ...shot, version: "本地流程样片-1", inPoint: "0.5", outPoint: "3.01" };
const localJob = project.enhancement(0, 0, betweenFrames, source, options);
const padded = { ...report.output, duration: 76 / 30, frames: 152 };
const newLocal = project.enhancementCandidate(0, 0, betweenFrames,
  { ...report, shot: localJob.shot, output: padded }, source, padded);
assert.equal(newLocal.outPoint, "2.51");
assert.equal(project.enhancementDetails(newLocal).testFixture, true);
const historical = { ...padded, duration: 2.5, frames: 150 };
assert.equal(project.enhancementCandidate(0, 0, betweenFrames,
  { ...report, shot: localJob.shot, output: historical }, source, historical).outPoint, "2.5");
console.log("PASS exact editorial cut for new local derivatives · older frame-rounded reports open");
