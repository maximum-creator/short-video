const assert = require('node:assert/strict');
const artReview = require('../production-art-review.js');
const reviewNotes = require('../production-review-notes.js');

global.window = {
  arcProductionProject: {
    generatedCandidate: candidate => candidate.generated || null,
    enhancementDetails: candidate => candidate.enhancement || null
  },
  arcArtReview: artReview,
  arcReviewNotes: reviewNotes,
  arcABReview: { report: () => [] }
};
require('../production-ab.js');
require('../production-quality.js');
const generationLog = require('../production-job-log.js');

assert.equal(window.arcAB.sourceOriginConsistent({ testFixture: false }, { testFixture: true }), false,
  'a provider task cannot override a local-test output marker');
assert.equal(window.arcAB.sourceOriginConsistent({ testFixture: true }, { testFixture: false }), false,
  'a local-test task cannot override a provider output marker');
assert.equal(window.arcAB.sourceOriginConsistent({ testFixture: false }, {}), true,
  'missing output-level origin can inherit the explicit task-level classification');
assert.equal(window.arcAB.outputAudioAvailability({ output: { assetKey: 'a'.repeat(64) },
  media: { assetKey: 'a'.repeat(64), hasAudio: true } }), true, 'audio status follows the current output asset');
assert.equal(window.arcAB.outputAudioAvailability({ output: { assetKey: 'a'.repeat(64) },
  media: { assetKey: 'a'.repeat(64), audioTrackCount: 0 } }), false, 'a measured zero-track output is not listenable');
assert.equal(window.arcAB.outputAudioAvailability({ output: { assetKey: 'a'.repeat(64) },
  media: { assetKey: 'b'.repeat(64), hasAudio: true } }), null, 'stale media audio metadata is not reused for another output');

const s05 = window.arcProductionQuality.benchmarkForShot('any series', 7, 12, 'shot-04-action-vfx-v1', 'motion');
assert.equal(s05.id, 'shot-04-action-vfx-v1', 'S05 can bind to any explicit shot independently of sample episode indexes');
assert.equal(s05.variable, 'A 不附动作视频；B 仅增加同一镜头的 Blender 白模预演视频');
assert.ok(s05.fixedInputs.includes('随机种子'));
assert.match(s05.interpretationLimit, /不单独改变特效条件/);
assert.ok(!s05.checks.some(check => check.id === 'fx-timing-occlusion'),
  'motion-only S05 does not block on a VFX-specific criterion');
const s05VfxChecks = window.arcProductionQuality.benchmarkForShot('any series', 7, 12, 'shot-04-action-vfx-v1', 'vfx');
assert.ok(s05VfxChecks.checks.some(check => check.id === 'fx-timing-occlusion'),
  'the VFX mode retains effect timing and occlusion acceptance');

const definitions = [{ id: 'landing', severity: 'blocker' }, { id: 'sound', severity: 'review' }];
const reviewed = (pairId, variant, checks, ready, reviewMs) => ({ pairId, variant, review: {
  found: true, ready, benchmarkId: 'repeatability-unit', benchmarkMissing: [], reviewMs,
  benchmarkChecks: checks.map(([id, result]) => ({ id, result }))
} });
const summary = window.arcProductionQuality.repeatabilityReviewSummary({ cohorts: [{ replicateCount: 2, runs: [
  { pairId: 'pair-1', candidateReviews: { A: [reviewed('pair-1', 'A', [['landing', '符合'], ['sound', '符合']], true, 1500)],
    B: [reviewed('pair-1', 'B', [['landing', '待返修'], ['sound', '符合']], false, 2600)] } },
  { pairId: 'pair-2', candidateReviews: { A: [], B: [] } }
] }] }, definitions, 'repeatability-unit');
assert.deepEqual(summary.cohorts[0].paired,
  { bothReady: 0, aOnlyReady: 1, bOnlyReady: 0, neitherReady: 0, notComparable: 1 });
assert.equal(summary.cohorts[0].variants.A.reviewMsTotal, 1500);
assert.equal(summary.cohorts[0].variants.A.unreviewed, 1);
assert.equal(summary.cohorts[0].variants.B.blockerRepairs, 1);
assert.equal(summary.cohorts[0].variants.B.checks.landing.repair, 1);
assert.match(summary.method, /no composite quality score/);
const excludedSummary = window.arcProductionQuality.repeatabilityReviewSummary({ cohorts: [], excluded: [
  { pairId: 'schema-pair-a', reason: 'workflow-schema-mismatch' },
  { pairId: 'schema-pair-b', reason: 'workflow-schema-mismatch' },
  { pairId: 'legacy-pair', reason: 'workflow-schema-evidence-missing' },
  { pairId: 'prompt-pair', reason: 'effective-prompt-mismatch' },
  { pairId: 'mode-pair', reason: 'unsupported-ab-mode' }
] }, definitions, 'repeatability-unit');
assert.deepEqual(excludedSummary.excluded, [
  { reason: 'workflow-schema-mismatch', count: 2 }, { reason: 'workflow-schema-evidence-missing', count: 1 },
  { reason: 'effective-prompt-mismatch', count: 1 }, { reason: 'unsupported-ab-mode', count: 1 }
], 'the report preserves grouped reasons when otherwise complete A/B pairs are not comparable');
const s05Vfx = window.arcProductionQuality.benchmarkForShot('any series', 7, 12, 'shot-04-action-vfx-v1', 'vfx');
assert.equal(s05Vfx.mode, 'vfx');
assert.equal(s05Vfx.variable, 'A 明确要求干净底片；B 在共用镜头提示后增加唯一特效指令');
assert.match(s05Vfx.interpretationLimit, /多随机种子复测/);
assert.equal(window.arcProductionQuality.benchmarkForShot('any series', 7, 12, 'unknown-benchmark'), null,
  'an unknown explicit benchmark does not fall through to a sample-specific checklist');
assert.equal(window.arcProductionQuality.shotBasisStatus({ shotBasisSha256: 'a'.repeat(64) }, 'a'.repeat(64)), 'current');
assert.equal(window.arcProductionQuality.shotBasisStatus({ shotBasisSha256: 'a'.repeat(64) }, 'b'.repeat(64)), 'changed');
assert.equal(window.arcProductionQuality.shotBasisStatus({ shotBasisSha256: 'a'.repeat(64) }, null), 'unknown');
const staleBasisMeasurement = window.arcProductionQuality.basisBoundMeasurement(
  { shotBasisSha256: 'a'.repeat(64) }, 'b'.repeat(64), 'A', null, 5);
assert.equal(staleBasisMeasurement.status, 'changed');
assert.equal(staleBasisMeasurement.measurement.source, null,
  'a stale S05 experiment remains in history but cannot populate current quality measurements');
const emptyQuality = Object.fromEntries(['identity', 'acting', 'contact', 'space', 'camera', 'light', 'temporal', 'sound']
  .map(id => [id, null]));
const emptyMeasurement = { usableRanges: [], quality: emptyQuality, reviewNotes: [] };
const reportShot = (latest = {}) => ({ bindingStatus: 'bound', study: 'study', variantLabels: ['A', 'B'],
  allowedDifference: ['B only'], acceptanceChecks: [], measurements: { A: { ...emptyMeasurement }, B: { ...emptyMeasurement } },
  repeatability: {}, ...latest });
const basisCsv = window.arcProductionQuality.trialCsv({ shots: [
  reportShot({ latestPerformanceRun: { shotBasisStatus: 'current' } }),
  reportShot({ latestWhiteModelRun: { shotBasisStatus: 'unknown' } }),
  reportShot({ latestActionRun: { shotBasisStatus: 'changed' } })
], postProcessing: { benchmarkId: 'relay-v1', acceptanceChecks: [], measurements: {
  A: { ...emptyMeasurement }, B: { ...emptyMeasurement } }, verdict: null } });
const csvRows = basisCsv.trim().split(/\r?\n/);
const quotedColumnCount = row => [...row.matchAll(/"(?:[^"]|"")*"/g)].length;
assert.ok(csvRows[0].includes('实验基准新鲜度'), 'CSV names the current shot-basis validity column');
assert.ok(csvRows.some(row => row.includes('"changed"')), 'CSV exposes a stale current-baseline run explicitly');
assert.ok(csvRows.every(row => quotedColumnCount(row) === quotedColumnCount(csvRows[0])),
  'freshness fields preserve CSV column alignment for generation and post-processing rows');
const s02 = window.arcProductionQuality.benchmarkForShot('短剧工作台 · 示例', 0, 1);
assert.equal(s02.mode, 'performance', 'S02 is a controlled acting-cue experiment, not multi-variable model screening');
assert.deepEqual(s02.fixedInputs, ['模型与精度', '工作流与采样器', '随机种子', '人物定妆/场景参考',
  '共用提示词', '画幅/分辨率/时长', '机位与运镜', '音频条件']);
assert.match(s02.interpretationLimit, /额外表演节拍提示/);

const sha = char => char.repeat(64);
const source = (version, file, marker) => JSON.stringify({ version, file, size: 256,
  fingerprint: 'sha256:' + marker.repeat(64), contentDigest: 'sha256-tree-v1:' + marker.repeat(64) });
const series = { character: 'test character', look: 'test look', limits: 'consistent costume' };
const pages = { story: 'A character crosses the threshold.', dialogue: '', state: '', rules: '' };
const reviewContext = { series, pages, continuityBasis: '' };
const pairId = '11111111-1111-4111-8111-111111111111';
const proof = 'a'.repeat(64);
const retryLog = {};
for (const [id, status, queueMs, executionMs] of [
  ['00000000-0000-4000-8000-000000000001', 'failed', 80, 400],
  ['00000000-0000-4000-8000-000000000002', 'no_video', 120, 700],
  ['00000000-0000-4000-8000-000000000003', 'complete', 100, 900]
]) {
  retryLog.generationLog = generationLog.nextLog(retryLog, { id, status, preset: 'minimax-h3-first',
    firstFrameProof: proof, timing: { queueMs, executionMs,
      queueSource: 'comfy-history-timestamps', executionSource: 'comfy-history-timestamps',
      bridgeSource: 'local-bridge-observation', gpuKernelTime: false } });
}
const retriedRun = generationLog.firstFrameTrials(retryLog)[0];
assert.equal(retriedRun.retryCount, 2, 'H3 trial retry count includes failed and no-video attempts with the same input proof');
assert.deepEqual(retriedRun.cumulativeTiming, { queueMs: 300, executionMs: 2000,
  queueSource: 'comfy-history-timestamps', executionSource: 'comfy-history-timestamps', gpuKernelTime: false,
  latestQueueMs: 100, latestExecutionMs: 900, attempts: 3, coverage: 'retained-generation-log' });
const timingProvenanceLog = {};
timingProvenanceLog.generationLog = generationLog.nextLog(timingProvenanceLog, {
  id: '00000000-0000-4000-8000-000000000006', status: 'complete', preset: 'minimax-h3-first',
  firstFrameProof: proof, timing: { queueMs: 25, executionMs: 900, bridgeMs: 950,
    queueSource: 'comfy-history-timestamps', executionSource: 'comfy-history-timestamps',
    bridgeSource: 'local-bridge-observation', gpuKernelTime: false }
});
const timingProvenance = JSON.parse(timingProvenanceLog.generationLog)[0].timing;
assert.equal(timingProvenance.executionSource, 'comfy-history-timestamps');
assert.equal(timingProvenance.bridgeSource, 'local-bridge-observation');
assert.equal(timingProvenance.gpuKernelTime, false,
  'persisted timing makes clear that Comfy history wall time is not GPU kernel time');
const mixedRetryLog = {};
for (const [id, status, source, executionMs] of [
  ['00000000-0000-4000-8000-000000000007', 'failed', 'comfy-history-timestamps', 500],
  ['00000000-0000-4000-8000-000000000008', 'complete', 'local-bridge-observation', 800]
]) {
  mixedRetryLog.generationLog = generationLog.nextLog(mixedRetryLog, { id, status, preset: 'minimax-h3-first',
    firstFrameProof: proof, timing: { queueMs: 100, executionMs, queueSource: source, executionSource: source,
      gpuKernelTime: false } });
}
const mixedRetry = generationLog.firstFrameTrials(mixedRetryLog)[0];
assert.equal(mixedRetry.cumulativeTiming.executionMs, null,
  'cumulative generation timing is suppressed when retries have different measurement sources');
assert.equal(mixedRetry.cumulativeTiming.executionSource, 'mixed');
assert.equal(mixedRetry.cumulativeTiming.latestExecutionMs, 800,
  'the last attempt remains available even when the cumulative measurement is mixed');
const trialAudio = { output: { assetKey: sha('c') }, media: { assetKey: sha('c'), hasAudio: false, audioTrackCount: 0 } };
assert.equal(window.arcProductionQuality.trialAudioAvailability(trialAudio), false,
  'first-frame audio state requires media measured from the same returned asset');
assert.equal(window.arcProductionQuality.trialAudioAvailability({ ...trialAudio,
  media: { ...trialAudio.media, assetKey: sha('d'), hasAudio: true } }), null,
  'first-frame audio metadata from an older output cannot label the current output');
const firstFrameRun = { id: 'first-frame-id', preset: 'pika-h3-first', firstFrameProof: sha('c'),
  output: { assetKey: sha('c') } };
assert.equal(window.arcProductionQuality.firstFrameInputsMatch([firstFrameRun, { ...firstFrameRun }]), true,
  'first-frame inputs are comparable only when both matching proofs are present');
assert.equal(window.arcProductionQuality.firstFrameInputsMatch([{ ...firstFrameRun, firstFrameProof: undefined },
  { ...firstFrameRun, firstFrameProof: undefined }]), false, 'two missing proofs are not treated as matching evidence');
assert.equal(window.arcProductionQuality.firstFrameInputsMatch([firstFrameRun, { ...firstFrameRun, firstFrameProof: sha('d') }]),
  false, 'different first-frame proofs remain an exploratory non-comparable pair');
const firstFrameJob = { id: firstFrameRun.id, preset: firstFrameRun.preset, firstFrameProof: firstFrameRun.firstFrameProof,
  outputContract: { width: 768, height: 1344 }, testFixture: true };
const firstFrameClip = { assetKey: sha('c'), url: `/api/generation/${firstFrameRun.id}/video/0`, testFixture: true };
assert.equal(window.arcProductionQuality.firstFrameReturnMatches(firstFrameRun, firstFrameJob, firstFrameClip), true,
  'first-frame comparison requires the exact logged output asset and consistent origin');
assert.equal(window.arcProductionQuality.firstFrameReturnMatches(firstFrameRun, firstFrameJob,
  { ...firstFrameClip, assetKey: sha('d') }), false, 'a changed output asset is rejected');
assert.equal(window.arcProductionQuality.firstFrameReturnMatches(firstFrameRun, firstFrameJob,
  { ...firstFrameClip, testFixture: false }), false, 'fixture/provider source disagreement is rejected');
assert.equal(window.arcProductionQuality.firstFrameReturnMatches({ ...firstFrameRun, testFixture: false },
  firstFrameJob, firstFrameClip), false, 'the generation ledger origin participates in return admission');
assert.equal(window.arcProductionQuality.firstFrameOriginLabel(firstFrameRun, firstFrameJob, firstFrameClip),
  '本地测试素材 · 不代表真实模型回片');
assert.equal(window.arcProductionQuality.firstFrameOriginLabel({ ...firstFrameRun, testFixture: false },
  { ...firstFrameJob, testFixture: false }, { ...firstFrameClip, testFixture: false }),
  '服务回片来源标记一致 · 实际加载权重仍未核验');
assert.match(window.arcProductionQuality.firstFrameOriginLabel(firstFrameRun, {}, {}), /来源未完全核验/);
assert.match(window.arcProductionQuality.firstFrameOriginLabel({ ...firstFrameRun, testFixture: true },
  { testFixture: false }, { testFixture: false }), /来源标记冲突/);
const incompleteTimingLog = { generationLog: generationLog.nextLog({}, { id: '00000000-0000-4000-8000-000000000004',
  status: 'failed', preset: 'minimax-h3-first', firstFrameProof: proof, timing: { queueMs: 5 } }) };
incompleteTimingLog.generationLog = JSON.stringify([...JSON.parse(incompleteTimingLog.generationLog),
  ...JSON.parse(generationLog.nextLog({}, { id: '00000000-0000-4000-8000-000000000005', status: 'complete',
    preset: 'minimax-h3-first', firstFrameProof: proof, timing: { queueMs: 7, executionMs: 9 } }))]);
assert.equal(generationLog.firstFrameTrials(incompleteTimingLog)[0].cumulativeTiming.executionMs, null,
  'an unknown earlier execution time is never silently omitted from the cumulative total');

const a = { version: 'A1', file: 'a.mp4', sourceBinding: source('A1', 'a.mp4', 'a'),
  generated: { jobId: 'job-a', assetKey: sha('a'), comparison: { id: pairId, variant: 'A' }, testFixture: true } };
const b = { version: 'B1', file: 'b.mp4', sourceBinding: source('B1', 'b.mp4', 'b'),
  generated: { jobId: 'job-b', assetKey: sha('b'), comparison: { id: pairId, variant: 'B' } } };
const shot = { scriptAnchor: 'A character crosses the threshold.', beat: 'he stops before turning', composition: 'wide shot',
  performance: 'settles before turning', path: 'fixed camera', lighting: 'cool station light', candidates: [a, b] };
const completedChecks = artReview.dimensions.map(([id]) => ({ id, result: '符合', note: '' }));
const benchmark = { id: 'shot-02-v1', checks: [{ id: 'threshold-contact', check: '脚底接触可信', severity: 'blocker' }] };
const reviewedA = { ...shot, ...a };
shot.artReviews = JSON.stringify([{ version: a.version, file: a.file,
  signature: artReview.signature(reviewedA, series, pages, ''), checks: completedChecks,
  reviewMs: 1234, technicalQc: { sourceSha256: sha('a'), sizeBytes: 256,
    summary: { errors: 1, warnings: 2, hasAudio: true, audioAllSilent: false },
    findings: [{ kind: 'freeze', severity: 'warn', start: 2, end: 2.8, detail: '画面冻结' }], thresholds: { freeze_min_s: 0.8 } },
  benchmark: { id: benchmark.id, checks: [{ id: 'threshold-contact', result: '待返修', note: '右脚落地后滑动',
    timecodes: [{ sourceMs: 1430, note: '右脚接触后滑移' }] }] } }]);
shot.reviewNotes = JSON.stringify([
  { id: 'note-a', version: 'A1', file: 'a.mp4', sourceMs: 950, category: '构图', note: '门框向右漂移' },
  { id: 'note-b', version: 'B1', file: 'b.mp4', sourceMs: 1350, category: '表演', note: '站稳后再转头' }
]);

const aEvidence = window.arcProductionQuality.candidateReviewEvidence(shot, reviewContext,
  { pairId, variant: 'A', benchmark });
const bEvidence = window.arcProductionQuality.candidateReviewEvidence(shot, reviewContext,
  { pairId, variant: 'B', benchmark });
assert.equal(aEvidence.length, 1, 'A evidence is linked by pair id and variant');
assert.equal(aEvidence[0].outputAssetKey, sha('a'), 'the review evidence records the output asset identity key');
assert.equal(aEvidence[0].sourceBinding.fingerprint, `sha256:${sha('a')}`, 'a bound local file contributes its own byte fingerprint');
assert.equal(aEvidence[0].sourceBinding.contentDigest, `sha256-tree-v1:${sha('a')}`,
  'the content digest is separately namespaced from the asset lookup key');
assert.equal(aEvidence[0].testFixture, true, 'local test origin remains explicit');
assert.equal(aEvidence[0].review.found, true, 'a saved candidate review is distinguished from no review');
assert.equal(aEvidence[0].review.ready, false, 'a marked benchmark defect blocks the candidate approval');
assert.equal(aEvidence[0].review.reviewMs, 1234, 'manual review time remains bound to the exact candidate report');
assert.equal(aEvidence[0].review.technicalQc.sourceSha256, sha('a'), 'QC results export only with the SHA-bound candidate');
assert.equal(aEvidence[0].review.technicalQc.findings[0].kind, 'freeze');
assert.deepEqual(aEvidence[0].timecodeNotes.map(item => [item.sourceMs, item.note]), [[950, '门框向右漂移']],
  'the same shot view receives timecoded notes scoped to the exact candidate');
assert.equal(aEvidence[0].review.benchmarkId, benchmark.id);
assert.deepEqual(aEvidence[0].review.benchmarkChecks[0], { id: 'threshold-contact', label: '脚底接触可信',
  severity: 'blocker', result: '待返修', note: '右脚落地后滑动', timecodes: [{ sourceMs: 1430, note: '右脚接触后滑移' }] },
  'the A/B audit receives the benchmark failure and its source timecode from the exact candidate review');
assert.equal(aEvidence[0].review.issues[0].note, '右脚落地后滑动');
assert.equal(bEvidence[0].review.found, false, 'an unreviewed B output is never presented as reviewed');
assert.equal(bEvidence[0].review.ready, false);
assert.equal(bEvidence[0].review.benchmarkChecks[0].result, '待核对',
  'an unreviewed B return does not inherit A benchmark status or timecodes');
const aEarlier = { ...a, version: 'A0', file: 'a-earlier.mp4', sourceBinding: source('A0', 'a-earlier.mp4', 'c'),
  generated: { ...a.generated, jobId: 'job-a-earlier', assetKey: sha('c') } };
const retryShot = { ...shot, candidates: [aEarlier, a, b] };
const retryPair = { pairId, variants: { A: { attempts: [
  { jobId: 'job-a-earlier', status: 'complete', outputAssetKey: sha('c') },
  { jobId: 'job-a', status: 'complete', outputAssetKey: sha('a') }
] }, B: { attempts: [{ jobId: 'job-b', status: 'complete', outputAssetKey: sha('b') }] } } };
assert.equal(window.arcProductionQuality.pairedRunAttempt(retryPair, 'A').jobId, 'job-a',
  'paired measurement selects the latest completed output attempt');
const retryReview = window.arcProductionQuality.pairedCandidateReviewEvidence(retryShot, reviewContext,
  retryPair, 'A', benchmark);
assert.equal(retryReview.length, 1);
assert.equal(retryReview[0].jobId, 'job-a');
assert.equal(retryReview[0].outputAssetKey, sha('a'),
  'A/B review evidence is tied to the same exact retry output as its measured run');
const benchmarkVariantResult = window.arcProductionQuality.benchmarkVariantResult;
const criterion = { id: 'threshold-contact' };
assert.deepEqual(benchmarkVariantResult(criterion, aEvidence[0], benchmark.id), {
  result: 'repair', note: '右脚落地后滑动', candidateVersion: 'A1', file: 'a.mp4', outputAssetKey: sha('a'),
  timecodedEvidence: [{ sourceMs: 1430, note: '右脚接触后滑移' }]
}, 'report projection keeps repair, timecode, and exact A identity together');
assert.equal(benchmarkVariantResult(criterion, { ...aEvidence[0], review: { benchmarkId: benchmark.id,
  benchmarkChecks: [{ id: criterion.id, result: '符合' }] } }, benchmark.id).result, 'pass');
assert.equal(benchmarkVariantResult(criterion, { ...aEvidence[0], review: { benchmarkId: benchmark.id,
  benchmarkChecks: [{ id: criterion.id, result: '本镜不适用' }] } }, benchmark.id).result, 'not-applicable');
assert.equal(benchmarkVariantResult(criterion, bEvidence[0], benchmark.id).result, 'not-reviewed');
assert.equal(benchmarkVariantResult(criterion, { ...aEvidence[0], review: { benchmarkId: 'other-trial',
  benchmarkChecks: [{ id: criterion.id, result: '符合' }] } }, benchmark.id).result, 'not-reviewed',
  'a review from a different shot benchmark cannot produce a pass');
const pairedHistory = (overrides = {}) => {
  const id = overrides.id || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const run = (variant, suffix) => {
    const jobId = `${variant.toLowerCase()}${suffix}000000-0000-4000-8000-000000000000`;
    const submittedGraphSha256 = require('node:crypto').createHash('sha256').update(jobId + '-graph').digest('hex');
    return { id: jobId, providerFingerprint: sha('7'),
    status: 'complete', timing: { queueMs: 100, executionMs: 200 },
    outputContract: { width: 768, height: 1344, fps: 24, frames: 124 },
    media: { assetKey: sha(variant === 'A' ? 'a' : 'b'), source: 'mp4-stts', seconds: 124 / 24,
      width: 768, height: 1344, frameCount: 124, fps: 24, frameRateMode: 'constant' },
    effectivePromptSha256: sha('c'),
    executionPromptEvidence: { evidence: 'comfy-history-prompt', status: 'matched',
      submittedSha256: submittedGraphSha256, historySha256: submittedGraphSha256 },
    preflightEvidence: { evidence: 'comfy-object-info-preflight', status: 'passed',
      schemaSha256: sha('c'), workflowSha256: submittedGraphSha256 },
    workflowDeclaration: { evidence: 'workflow-declared', loadedWeightsVerified: false,
      models: [{ file: 'h3-int8.safetensors' }], precision: ['int8'],
      seeds: [{ node: 'sampler', type: 'Sampler', input: 'seed', value: Number(overrides.seed ?? 101) }],
      samplers: [{ node: 'sampler', type: 'Sampler', settings: { steps: 30 } }] },
    output: { url: `/api/generation/${jobId}/video/0`, name: `${variant}.mp4`, assetKey: sha(variant === 'A' ? 'a' : 'b') } };
  };
  return { id, basisVersion: 4, basis: sha('c'), testFixture: false,
    profile: 'provider-profile-v1', providerFingerprint: sha('7'), assetKinds: { character: 'character-sheet' },
    motionDigest: sha('d'), motionName: 'motion.mp4', prompt: 'locked prompt',
    label: 'baseline', references: [{ role: 'character', sha256: sha('e') }], workflow: 'Pika H3 Flex',
    workflowSha256: sha('f'), plannedSeconds: 5, outputContract: { width: 768, height: 1344, fps: 24, frames: 124 }, shotBasis: sha('9'), settingsSnapshot: {
      controlsProfile: 'profile-v1', controls: { seed: `seed-${overrides.seed ?? 101}`, steps: '30' },
      effectiveControls: { seed: Number(overrides.seed ?? 101), steps: '30' }, preset: 'pika-h3-flex'
    }, attempts: { A: [run('A', '1')], B: [run('B', '2')] }, ...overrides };
};
const replicateOne = pairedHistory({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', seed: 101 });
assert.deepEqual(window.arcAB.latestReport({ generationAB: JSON.stringify([replicateOne]) }).outputContract,
  { width: 768, height: 1344, fps: 24, frames: 124 }, 'A/B exports preserve the locked target output contract');
const replicateTwo = pairedHistory({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', seed: 202 });
let repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([replicateOne, replicateTwo]) });
assert.equal(repeats.cohorts.length, 1, 'same locked conditions with a different explicit seed form a repeatability cohort');
assert.equal(repeats.cohorts[0].replicateCount, 2);
assert.equal(repeats.cohorts[0].distinctSeedCount, 2);
assert.equal(repeats.cohorts[0].status, 'comparable-distinct-seeds');
assert.equal(repeats.cohorts[0].modelIdentityStatus, 'workflow-declaration-only-runtime-unverified',
  'a provider workflow declaration is not presented as proof of runtime-loaded weights');
assert.equal(repeats.cohorts[0].runs[0].variants.A.attempts[0].outputAssetKey, sha('a'), 'replicates retain each exact A asset key');
assert.equal(repeats.cohorts[0].runs[1].variants.B.executionMs, 200, 'replicates retain per-run timing');
assert.equal(repeats.cohorts[0].runs[0].providerFingerprint, sha('7'), 'the safe endpoint fingerprint is visible in trial evidence');
assert.equal(repeats.cohorts[0].runs[0].variants.A.attempts[0].providerFingerprint, sha('7'),
  'each model attempt preserves its exact provider endpoint fingerprint');
assert.equal(repeats.cohorts[0].runs[0].variants.A.attempts[0].workflowDeclaration.seeds[0].value, 101,
  'each recorded attempt preserves its actual workflow-declared seed');
assert.deepEqual(repeats.cohorts[0].runs[0].variants.A.attempts[0].outputContract,
  { width: 768, height: 1344, fps: 24, frames: 124 }, 'repeatability ledger retains the locked output format contract');
assert.equal(repeats.cohorts[0].runs[0].variants.A.attempts[0].outputMediaContractStatus, 'pass');
assert.deepEqual(repeats.cohorts[0].runs[0].variants.A.attempts[0].actualMedia,
  { assetKey: sha('a'), source: 'mp4-stts', seconds: 124 / 24, width: 768, height: 1344,
    frameCount: 124, fps: 24, frameRateMode: 'constant' }, 'repeatability evidence retains the measured bytes-bound media format');
assert.deepEqual(repeats.cohorts[0].runs[0].variants.A.attempts[0].outputIdentity,
  { evidence: 'provider-output-asset-key-only', sha256: null, sizeBytes: null },
  'asset keys are not described as full output-byte hashes');
const hashedOutput = pairedHistory({ id: 'bcdedeee-baba-4aba-8aba-babababababa', seed: 111 });
hashedOutput.attempts.A[0].output.sha256 = sha('e');
hashedOutput.attempts.A[0].output.sizeBytes = 4096;
const hashedOutputLedger = window.arcAB.repeatability({ generationAB: JSON.stringify([hashedOutput]) });
assert.deepEqual(hashedOutputLedger.cohorts[0].runs[0].variants.A.attempts[0].outputIdentity,
  { evidence: 'full-upstream-video-bytes-sha256', sha256: sha('e'), sizeBytes: 4096 },
  'full video hashes and byte lengths remain explicit when available');
const endpointDrift = pairedHistory({ id: 'cbdedeee-baba-4aba-8aba-babababababa', seed: 112 });
endpointDrift.attempts.B[0].providerFingerprint = sha('8');
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([endpointDrift]) });
assert.equal(repeats.excluded[0].reason, 'provider-attempt-identity-drift',
  'a paired run whose actual provider differs from its locked provider cannot enter a same-condition cohort');
const missingAttemptEndpoint = pairedHistory({ id: 'dbdedeee-baba-4aba-8aba-babababababa', seed: 113 });
delete missingAttemptEndpoint.attempts.A[0].providerFingerprint;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([missingAttemptEndpoint]) });
assert.equal(repeats.excluded[0].reason, 'provider-attempt-identity-missing',
  'legacy attempts without per-request endpoint identity remain outside repeatability evidence');
const mismatchedOutputContract = pairedHistory({ id: 'babababa-baba-4aba-8aba-babababababa', seed: 303 });
mismatchedOutputContract.attempts.B[0].outputContract.height = 1152;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([mismatchedOutputContract]) });
assert.equal(repeats.excluded[0].reason, 'output-contract-mismatch',
  'A and B with different expected dimensions cannot be compared as one controlled trial');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([mismatchedOutputContract]) }), null,
  'an A/B pair with different output contracts cannot become the latest comparable report');
const missingOutputContract = pairedHistory({ id: 'bcbababa-baba-4aba-8aba-babababababa', seed: 304 });
delete missingOutputContract.attempts.A[0].outputContract;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([missingOutputContract]) });
assert.equal(repeats.excluded[0].reason, 'output-contract-missing',
  'a trial without measurable expected dimensions and cadence cannot enter a quality cohort');
const unverifiedActualMedia = pairedHistory({ id: 'bbbbabab-baba-4aba-8aba-babababababa', seed: 306 });
delete unverifiedActualMedia.attempts.B[0].media;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([unverifiedActualMedia]) });
assert.equal(repeats.excluded[0].reason, 'actual-output-contract-unverified',
  'declared specs without bytes-bound measured media cannot enter a quality cohort');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([unverifiedActualMedia]) }), null,
  'latest comparable report waits for actual output specification checks');
const mismatchedActualMedia = pairedHistory({ id: 'bbbbabab-baba-4bbb-8bbb-babababababb', seed: 307 });
mismatchedActualMedia.attempts.A[0].media.width = 720;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([mismatchedActualMedia]) });
assert.equal(repeats.excluded[0].reason, 'actual-output-contract-mismatch',
  'actual resolution mismatch cannot hide behind identical requested contracts');
const changedOutputContract = pairedHistory({ id: 'bdbababa-baba-4aba-8aba-babababababa', seed: 305 });
for (const variant of ['A', 'B']) {
  changedOutputContract.attempts[variant][0].outputContract.height = 1536;
  changedOutputContract.attempts[variant][0].media.height = 1536;
}
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([replicateOne, changedOutputContract]) });
assert.equal(repeats.cohorts.length, 2,
  'replicates with different locked output contracts stay in separate conditions');
const benchmarkA = pairedHistory({ id: 'abababab-abab-4aba-8aba-000000000001', seed: 101,
  benchmarkId: 'shot-02-v1' });
const benchmarkB = pairedHistory({ id: 'abababab-abab-4aba-8aba-000000000002', seed: 202,
  benchmarkId: 'shot-04-action-vfx-v1' });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([benchmarkA, benchmarkB]) });
assert.equal(repeats.cohorts.length, 2, 'different benchmark IDs cannot merge into one repeatability cohort');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([benchmarkA, benchmarkB]) },
  'shot-02-v1').benchmarkId, 'shot-02-v1', 'the latest comparable A/B query is scoped to its locked benchmark');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([benchmarkA, benchmarkB]) },
  'shot-04-action-vfx-v1').benchmarkId, 'shot-04-action-vfx-v1');
const s05VfxRun = pairedHistory({ id: 'abababab-abab-4aba-8aba-000000000003', seed: 303,
  benchmarkId: 'shot-04-action-vfx-v1', mode: 'vfx', variableCue: 'one effect', cueDigest: sha('8') });
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([benchmarkB, s05VfxRun]) },
  'shot-04-action-vfx-v1', 'motion').pairId, benchmarkB.id,
  'motion and VFX variants of S05 remain separate when retrieving the latest comparison');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([benchmarkB, s05VfxRun]) },
  'shot-04-action-vfx-v1', 'vfx').pairId, s05VfxRun.id);
const changedEffectivePrompt = pairedHistory({ id: 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc', seed: 303 });
changedEffectivePrompt.attempts.B[0].effectivePromptSha256 = sha('e');
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([replicateOne, changedEffectivePrompt]) });
assert.equal(repeats.cohorts.length, 1, 'the valid replicate remains while the white-model pair with different A/B prompts is excluded');
assert.equal(repeats.excluded[0].reason, 'effective-prompt-mismatch',
  'a white-model pair must preserve identical submitted prompt text');
const declaredCuePair = pairedHistory({ id: 'bdbdbdbd-bdbd-4bdb-8bdb-bdbdbdbdbdbd', seed: 304,
  mode: 'performance', variableCue: 'pause, then turn toward the door', cueDigest: sha('8') });
declaredCuePair.attempts.B[0].effectivePromptSha256 = sha('e');
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([declaredCuePair]) });
assert.equal(repeats.cohorts.length, 1,
  'a performance-cue pair accepts distinct actual prompt hashes because B intentionally carries the declared cue');
const undeclaredCueDifference = pairedHistory({ id: 'bebebebe-bebe-4ebe-8ebe-bebebebebebe', seed: 305,
  mode: 'performance', variableCue: 'pause, then turn toward the door', cueDigest: sha('8') });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([undeclaredCueDifference]) });
assert.equal(repeats.excluded[0].reason, 'effective-prompt-mismatch',
  'a performance-cue pair is excluded when its A/B effective prompt hashes are unexpectedly identical');
const unsupportedMode = pairedHistory({ id: 'bfbfbfbf-bfbf-4bfb-8bfb-bfbfbfbfbfbf', seed: 306,
  mode: 'unknown-experiment-mode' });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([unsupportedMode]) });
assert.equal(repeats.excluded[0].reason, 'unsupported-ab-mode',
  'an explicit unknown A/B mode cannot silently fall back to white-model motion');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([unsupportedMode]) }), null,
  'an unknown A/B mode cannot appear as a comparable report');
const missingEffectivePrompt = pairedHistory({ id: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', seed: 304 });
delete missingEffectivePrompt.attempts.B[0].effectivePromptSha256;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([missingEffectivePrompt]) });
assert.equal(repeats.excluded[0].reason, 'effective-prompt-fingerprint-missing',
  'a pair without an actual submitted-prompt fingerprint cannot enter repeatability cohorts');
const changedNodeSchema = pairedHistory({ id: 'cacacaca-caca-4aca-8aca-cacacacacaca', seed: 303 });
changedNodeSchema.attempts.B[0].preflightEvidence.schemaSha256 = sha('e');
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([changedNodeSchema]) });
assert.equal(repeats.excluded[0].reason, 'workflow-schema-mismatch',
  'A and B using different ComfyUI node definition sets cannot enter one quality cohort');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([changedNodeSchema]) }), null,
  'a node schema mismatch is retained in history but not presented as a comparable report');
assert.equal(window.arcAB.latestComparableReport({ generationAB: JSON.stringify([benchmarkA, changedNodeSchema]) }).pairId,
  benchmarkA.id, 'a newer non-comparable trial cannot hide the latest earlier comparable report');
const missingNodeSchema = pairedHistory({ id: 'cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb', seed: 303 });
delete missingNodeSchema.attempts.A[0].preflightEvidence.schemaSha256;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([missingNodeSchema]) });
assert.equal(repeats.excluded[0].reason, 'workflow-schema-evidence-missing',
  'missing node schema identity cannot be inferred or treated as a match');
const unconfirmedExecutionPrompt = pairedHistory({ id: 'dededede-dede-4ede-8ede-dededededede', seed: 305 });
unconfirmedExecutionPrompt.attempts.B[0].executionPromptEvidence.status = 'mismatch';
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([unconfirmedExecutionPrompt]) });
assert.equal(repeats.excluded[0].reason, 'executed-workflow-prompt-not-confirmed',
  'a return whose ComfyUI history prompt differs from the submitted graph cannot enter quality cohorts');
const differentModel = pairedHistory({ id: 'abababab-abab-4aba-8aba-aaaaaaaaaaaa', seed: 202 });
for (const variant of ['A', 'B']) differentModel.attempts[variant][0].workflowDeclaration.models[0].file = 'h3-different-int8.safetensors';
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([replicateOne, differentModel]) });
assert.equal(repeats.cohorts.length, 2, 'model declaration changes split conditions even when workflow hashes match');
assert.ok(repeats.cohorts.every(cohort => cohort.status === 'need-additional-seed'));
const fileEvidence = { schema: 'arc-comfy-model-files-v3', status: 'file-bytes-matched-runtime-unverified',
  evidence: 'workflow-requested-files-present-and-hashed', workflowSha256: sha('f'), modelSetSha256: sha('e'),
  providerFingerprint: sha('7'), providerBinding: 'operator-supplied-endpoint-fingerprint',
  runtimeLoadedVerified: false, models: [{ node: '1', classType: 'UNETLoader',
    field: 'unet_name', file: 'h3-int8.safetensors', sizeBytes: 123, sha256: sha('a') }] };
const withFileEvidence = pairedHistory({ id: 'abababab-abab-4aba-8aba-bbbbbbbbbbbb', seed: 202,
  modelFileEvidence: fileEvidence });
const firstWithFileEvidence = pairedHistory({ id: 'abababab-abab-4aba-8aba-dddddddddddd', seed: 101,
  modelFileEvidence: fileEvidence });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([firstWithFileEvidence, withFileEvidence]) });
assert.equal(repeats.cohorts.length, 1, 'same matched weight-file evidence remains the same repeatability condition');
assert.equal(repeats.cohorts[0].runs[0].modelFileEvidence.models[0].sha256, sha('a'));
assert.equal(repeats.cohorts[0].runs[0].modelFileEvidence.runtimeLoadedVerified, false);
assert.equal(repeats.cohorts[0].modelIdentityStatus, 'workflow-requested-files-hashed-runtime-unverified',
  'hashed files referenced by the workflow remain distinct from runtime-load attestation');
const evidenceFromOtherWorkflow = pairedHistory({ id: 'abababab-abab-4aba-8aba-121212121212', seed: 406,
  modelFileEvidence: { ...fileEvidence, workflowSha256: sha('d') } });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([evidenceFromOtherWorkflow]) });
assert.equal(repeats.cohorts[0].runs[0].modelFileEvidence, null,
  'a model-file manifest from another workflow hash cannot be attributed to this A/B pair');
const evidenceFromOtherProvider = pairedHistory({ id: 'abababab-abab-4aba-8aba-ffffffffffff', seed: 404,
  providerFingerprint: sha('8'), modelFileEvidence: { ...fileEvidence, providerFingerprint: sha('7') } });
for (const variant of ['A', 'B']) for (const attempt of evidenceFromOtherProvider.attempts[variant]) attempt.providerFingerprint = sha('8');
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([evidenceFromOtherProvider]) });
assert.equal(repeats.cohorts.length, 1);
assert.equal(repeats.cohorts[0].runs[0].modelFileEvidence, null,
  'a file manifest bound to another ComfyUI endpoint is excluded from the current A/B condition');
const missingBindingMethod = pairedHistory({ id: 'abababab-abab-4aba-8aba-eeeeeeeeeeee', seed: 405,
  modelFileEvidence: { ...fileEvidence, providerBinding: undefined } });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([missingBindingMethod]) });
assert.equal(repeats.cohorts[0].runs[0].modelFileEvidence, null,
  'v3 requires the report to disclose that the endpoint fingerprint was operator supplied');
const changedFileEvidence = pairedHistory({ id: 'abababab-abab-4aba-8aba-cccccccccccc', seed: 303,
  modelFileEvidence: { ...fileEvidence, models: [{ ...fileEvidence.models[0], sha256: sha('b') }] } });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([replicateOne, changedFileEvidence]) });
assert.equal(repeats.cohorts.length, 2, 'different actual weight-file bytes split repeatability conditions');
const malformedEvidence = pairedHistory({ id: 'abababab-abab-4aba-8aba-eeeeeeeeeeee', seed: 404,
  modelFileEvidence: { ...fileEvidence, models: [{ ...fileEvidence.models[0], file: 'C:\\private\\weights.safetensors' }] } });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([malformedEvidence]) });
assert.equal(repeats.cohorts.length, 1, 'invalid legacy evidence is discarded without breaking a valid A/B history');
assert.equal(repeats.cohorts[0].runs[0].modelFileEvidence, null,
  'a tampered path-bearing model manifest cannot flow into the report');
const differentProvider = pairedHistory({ id: 'abababab-abab-4aba-8aba-bbbbbbbbbbbb', seed: 202, providerFingerprint: sha('8') });
for (const variant of ['A', 'B']) for (const attempt of differentProvider.attempts[variant]) attempt.providerFingerprint = sha('8');
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([replicateOne, differentProvider]) });
assert.equal(repeats.cohorts.length, 2, 'different ComfyUI provider fingerprints cannot share a repeatability cohort');
const changedPrompt = pairedHistory({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', seed: 303, prompt: 'changed prompt' });
const duplicateSeed = pairedHistory({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', seed: 101 });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([replicateOne, duplicateSeed, changedPrompt]) });
const repeatedSeeds = repeats.cohorts.find(cohort => cohort.replicateCount === 2);
assert.equal(repeatedSeeds.status, 'duplicate-seeds-present', 'same-seed retries never count as independent seeds');
assert.equal(repeatedSeeds.distinctSeedCount, 1);
assert.equal(repeats.cohorts.length, 2, 'changed prompt is reported separately as a singleton condition');
assert.equal(repeats.cohorts.find(cohort => cohort.runs[0].pairId === changedPrompt.id).status, 'need-additional-seed');
const legacy = pairedHistory({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', basisVersion: 3, seed: 404 });
const noSeed = pairedHistory({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', settingsSnapshot: {
  controls: { steps: '30' }, effectiveControls: { steps: '30' }
} });
const failedRetry = pairedHistory({ id: 'abababab-abab-4aba-8aba-abababababab', seed: 505 });
failedRetry.attempts.B.push({ id: 'bb000000-0000-4000-8000-000000000000', status: 'failed',
  timing: { queueMs: 40, executionMs: 90 } });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([legacy, noSeed, failedRetry]) });
assert.deepEqual(repeats.excluded.map(item => item.reason), ['legacy-settings-not-snapshotted', 'explicit-seed-not-recorded',
  'latest-a-or-b-attempt-not-complete'], 'legacy, seedless and failed-latest runs cannot pass into quality cohorts');
assert.equal(repeats.excluded[2].variants.B.retryCount, 1);
assert.equal(repeats.excluded[2].variants.B.executionMs, 290, 'failed retry cost stays in the excluded-run ledger');
assert.equal(repeats.excluded[2].variants.B.attempts[0].outputAssetKey, sha('b'),
  'an earlier successful clip is retained as history, not mislabeled as the latest return');
const mixedOrigin = pairedHistory({ id: 'acacacac-acac-4aca-8aca-acacacacacac', seed: 606 });
mixedOrigin.attempts.B[0].output.testFixture = true;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([mixedOrigin]) });
assert.equal(repeats.excluded[0].reason, 'mixed-test-and-provider-origin',
  'local fixture footage and provider returns are never grouped into one quality comparison');
const localFixturePair = pairedHistory({ id: 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc', seed: 607, testFixture: true });
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([localFixturePair]) });
assert.equal(repeats.cohorts.length, 0,
  'even a complete local-fixture A/B pair is excluded from model repeatability cohorts');
assert.equal(repeats.excluded[0].reason, 'local-test-fixture-not-quality-evidence');
const unconfirmedSeed = pairedHistory({ id: 'adadadad-adad-4ada-8ada-adadadadadad', seed: 707 });
unconfirmedSeed.attempts.B[0].workflowDeclaration.seeds[0].value = 999;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([unconfirmedSeed]) });
assert.equal(repeats.excluded[0].reason, 'requested-seed-not-confirmed-by-workflow-declaration',
  'a UI seed control alone cannot establish the seed declared in the submitted workflow');
const mismatchedSampler = pairedHistory({ id: 'aeaeaeae-aeae-4aea-8aea-aeaeaeaeaeae', seed: 808 });
mismatchedSampler.attempts.B[0].workflowDeclaration.samplers[0].settings.steps = 31;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([mismatchedSampler]) });
assert.equal(repeats.excluded[0].reason, 'workflow-model-or-sampler-declarations-differ',
  'A and B must declare identical model, precision and sampler settings');
const unknownOrigin = pairedHistory({ id: 'afafafaf-afaf-4afa-8afa-afafafafafaf', seed: 909 });
delete unknownOrigin.testFixture;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([unknownOrigin]) });
assert.equal(repeats.excluded[0].reason, 'source-origin-unknown',
  'unlabelled source origin cannot be treated as provider output');
const unknownProvider = pairedHistory({ id: 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0', seed: 910 });
delete unknownProvider.providerFingerprint;
repeats = window.arcAB.repeatability({ generationAB: JSON.stringify([unknownProvider]) });
assert.equal(repeats.excluded[0].reason, 'provider-identity-not-recorded',
  'provider origin without endpoint fingerprint cannot support a repeatability claim');

assert.equal(window.arcProductionQuality.candidateReviewEvidence(shot, reviewContext,
  { pairId, variant: 'C' }).length, 0, 'unmatched variant evidence is excluded');

const reviewStatusLabel = window.arcProductionQuality.reviewStatusLabel;
assert.equal(reviewStatusLabel(null, { hasReturned: false }), '尚无可核验回片');
assert.equal(reviewStatusLabel(null, { hasReturned: true }), '回片已就绪 · 尚未送入本镜候选验收');
assert.equal(reviewStatusLabel({ review: { unbound: true } }), '源文件指纹未绑定 · 尚不能验收');
assert.equal(reviewStatusLabel({ review: { stale: true } }), '验收依据已变化 · 需要重新核对');
assert.equal(reviewStatusLabel({ review: { found: false } }), '待视觉验收');
assert.equal(reviewStatusLabel({ review: { found: true, issues: [{}] } }), '有 1 项待返修');
assert.equal(reviewStatusLabel({ review: { found: true, ready: true, issues: [] } }), '视觉验收完成 · 无待返修项');

const taskId = '22222222-2222-4222-8222-222222222222';
const enhancedCandidate = { version: 'enhanced-1', file: 'enhanced.mp4', sourceBinding: source('enhanced-1', 'enhanced.mp4', 'f'),
  enhancement: { sourceVersion: 'source-1', testFixture: false, engine: { kind: 'comfyui-ai-enhancement', taskId, workflowSha256: sha('c'),
      providerFingerprint: sha('7'), testFixture: false,
      timingSource: 'local-bridge', retryCount: 2, timing: { queueMs: 125, executionMs: 2300 },
      attemptHistory: [
        { taskId: '44444444-4444-4444-8444-444444444444', status: 'failed', sourceSha256: sha('d'),
          mediaSha256: sha('d'), shotVersion: 'source-1', queueMs: 100, executionMs: 1500 },
        { taskId: '55555555-5555-4555-8555-555555555555', status: 'no_video', sourceSha256: sha('d'),
          mediaSha256: sha('d'), shotVersion: 'source-1', queueMs: 200, executionMs: 2500 }
      ] },
    aiInput: { sha256: sha('d'), frames: 124, fps: '24/1', audio: true },
    aiOutput: { sha256: sha('e'), frames: 124, fps: '24/1', audio: false } } };
const enhancementShot = { ...shot, candidates: [enhancedCandidate],
  relayReviewNotes: JSON.stringify([
    { taskId, assetKey: sha('e'), cutSha256: sha('d'), kind: 'hair', ms: 1000, note: 'verified fixture', fixture: true },
    { taskId: '33333333-3333-4333-8333-333333333333', assetKey: sha('e'), cutSha256: sha('d'), kind: 'frame', ms: 2000, note: 'other job', fixture: false }
  ]) };
enhancementShot.artReviews = JSON.stringify([{ version: enhancedCandidate.version, file: enhancedCandidate.file,
  signature: artReview.signature({ ...enhancementShot, ...enhancedCandidate }, series, pages, ''), checks: completedChecks }]);
const enhancementEvidence = window.arcProductionQuality.enhancementReviewEvidence(enhancementShot, reviewContext);
assert.equal(enhancementEvidence.length, 1);
assert.equal(enhancementEvidence[0].sourceSha256, sha('d'));
assert.equal(enhancementEvidence[0].outputSha256, sha('e'));
assert.equal(enhancementEvidence[0].testFixture, false,
  'configured enhancement is distinguished from an explicit local fixture');
assert.equal(enhancementEvidence[0].providerFingerprint, sha('7'));
assert.deepEqual(enhancementEvidence[0].cadence, { sourceFrames: 124, sourceFps: '24/1',
  rawReturnFrames: 124, rawReturnFps: '24/1', sourceAudio: true, rawReturnAudio: false, preserved: true });
assert.deepEqual(enhancementEvidence[0].timing, { queueMs: 425, executionMs: 6300, latestQueueMs: 125,
  latestExecutionMs: 2300, attempts: 3, historyComplete: true });
assert.equal(enhancementEvidence[0].retries, 2);
assert.equal(enhancementEvidence[0].relayIssueNotes.length, 1, 'only annotations for the same task and media hashes are linked');
assert.equal(enhancementEvidence[0].relayIssueNotes[0].fixture, true);
assert.equal(enhancementEvidence[0].artReview.found, true);
assert.equal(window.arcProductionQuality.evidenceStatus([], null, enhancementEvidence).evidenceStatus,
  'configured-provider-output-linked', 'a verified non-fixture Relay return is not downgraded to unknown');
const legacyEnhancementEvidence = window.arcProductionQuality.enhancementReviewEvidence({
  ...enhancementShot,
  candidates: [{ ...enhancedCandidate, enhancement: { ...enhancedCandidate.enhancement,
    testFixture: undefined, engine: { ...enhancedCandidate.enhancement.engine, testFixture: undefined } } }]
}, reviewContext);
assert.equal(legacyEnhancementEvidence[0].testFixture, null,
  'old reports without a source flag remain unconfirmed rather than being guessed as provider output');
assert.equal(window.arcProductionQuality.evidenceStatus([], null, legacyEnhancementEvidence).evidenceStatus,
  'source-unconfirmed');

const evidenceStatus = window.arcProductionQuality.evidenceStatus;
const pairedTiming = window.arcProductionQuality.pairedTiming;
const pairAttempts = [
  { status: 'failed', queueMs: 300, executionMs: 500 },
  { status: 'rejected', queueMs: 0, executionMs: 0 },
  { status: 'complete', queueMs: 200, executionMs: 800 }
];
const pairedRun = pairAttempts[2];
assert.deepEqual(pairedTiming({ attempts: pairAttempts, retryCount: 1 }, pairedRun), {
  queueMs: 500, processingMs: 1300, latestQueueMs: 200, latestProcessingMs: 800,
  queueSource: null, executionSource: null, latestQueueSource: null, latestExecutionSource: null,
  gpuKernelTime: null, attempts: 2, coverage: 'all-persisted-attempts'
}, 'A/B report cost includes billable failed attempts, excludes rejected submissions, and keeps last-run timing separately');
const laterFailure = { status: 'failed', queueMs: 50, executionMs: 900 };
assert.deepEqual(pairedTiming({ attempts: [...pairAttempts, laterFailure], retryCount: 2 }, pairedRun), {
  queueMs: 550, processingMs: 2200, latestQueueMs: 50, latestProcessingMs: 900,
  queueSource: null, executionSource: null, latestQueueSource: null, latestExecutionSource: null,
  gpuKernelTime: null, attempts: 3, coverage: 'all-persisted-attempts'
}, 'a failed retry after the selected successful return still counts toward total cost and latest-attempt timing');
const mixedTimingAttempts = [
  { status: 'failed', queueMs: 300, executionMs: 500,
    queueSource: 'comfy-history-timestamps', executionSource: 'comfy-history-timestamps', gpuKernelTime: false },
  { status: 'complete', queueMs: 200, executionMs: 800,
    queueSource: 'local-bridge-observation', executionSource: 'local-bridge-observation', gpuKernelTime: false }
];
assert.deepEqual(pairedTiming({ attempts: mixedTimingAttempts, retryCount: 1 }, mixedTimingAttempts[1]), {
  queueMs: null, processingMs: null, queueSource: 'mixed', executionSource: 'mixed',
  latestQueueMs: 200, latestProcessingMs: 800, latestQueueSource: 'local-bridge-observation',
  latestExecutionSource: 'local-bridge-observation', gpuKernelTime: false,
  attempts: 2, coverage: 'all-persisted-attempts'
}, 'cumulative timing is suppressed when attempts use different measurement sources, while per-attempt values remain available');
const pickedReturn = window.arcProductionQuality.pairedMeasurement({ environment: 'configured-provider',
  workflow: 'H3 test workflow', workflowSha256: sha('a'), providerFingerprint: sha('b'),
  modelFileEvidence: { ...fileEvidence, workflowSha256: sha('a'), providerFingerprint: sha('b'),
    models: [{ node: '1', classType: 'UNETLoader',
      field: 'unet_name', file: 'h3-int8.safetensors', sizeBytes: 512, sha256: sha('c') }] },
  variants: { A: { retryCount: 2, attempts: [...pairAttempts.map((attempt, index) => ({ ...attempt,
    jobId: `attempt-${index}`, output: index === 2 ? 'picked.mp4' : null,
    outputAssetKey: index === 2 ? sha('f') : null })), laterFailure] } } }, 'A', null, 5);
assert.equal(pickedReturn.runId, 'attempt-2', 'visual review remains tied to the selected playable return');
assert.equal(pickedReturn.queueMs, 550);
assert.equal(pickedReturn.processingMs, 2200);
assert.equal(pickedReturn.latestProcessingMs, 900);
assert.equal(pickedReturn.timingAttempts, 3);
assert.equal(pickedReturn.retries, 2);
assert.equal(pickedReturn.modelFileEvidence.workflowSha256, sha('a'),
  'the unified per-shot report carries model-file evidence beside timing and returned media');
assert.equal(pickedReturn.modelFileEvidence.runtimeLoadedVerified, false);
const wrongWorkflowReturn = window.arcProductionQuality.pairedMeasurement({ environment: 'configured-provider',
  workflow: 'H3 changed workflow', workflowSha256: sha('d'), providerFingerprint: sha('b'),
  modelFileEvidence: { ...fileEvidence, workflowSha256: sha('a'), providerFingerprint: sha('b') },
  variants: { A: { attempts: [{ status: 'complete', jobId: 'wrong-workflow', output: 'wrong.mp4',
    outputAssetKey: sha('1') }] } }
}, 'A', null, 5);
assert.equal(wrongWorkflowReturn.modelFileEvidence, null,
  'the quality report drops model-file evidence bound to a different workflow digest');
assert.equal(pickedReturn.returnAssetKey, sha('f'));
assert.equal(pickedReturn.returnSha256, null, 'no bound output bytes means no full-file SHA-256 claim');
assert.equal(pickedReturn.returnFileFingerprint, null);
assert.equal(pickedReturn.returnContentDigest, null);
const usefulRangeReturn = window.arcProductionQuality.pairedMeasurement({ environment: 'configured-provider',
  reviewMarks: [
    { variant: 'A', jobId: 'old-retry', assetKey: sha('a'), kind: 'range', startMs: 0, endMs: 8000 },
    { variant: 'A', jobId: 'kept', assetKey: sha('f'), kind: 'range', startMs: 1000, endMs: 3000 },
    { variant: 'A', jobId: 'kept', assetKey: sha('f'), kind: 'range', startMs: 2500, endMs: 4500 },
    { variant: 'A', jobId: 'kept', assetKey: sha('f'), kind: 'range', startMs: 8000, endMs: 9000 }
  ], variants: { A: { retryCount: 2, attempts: [{ status: 'complete', jobId: 'kept', output: 'kept.mp4',
    outputAssetKey: sha('f'), durationSec: 10, queueMs: 550, executionMs: 2200 }] } }
}, 'A', { review: { found: true } }, 10);
assert.equal(usefulRangeReturn.usableSeconds, 4.5, 'overlapping marked keep ranges are unioned and not double-counted');
assert.equal(usefulRangeReturn.processingSecondsPerUsableSecond, 0.489,
  'the report normalizes cumulative execution time by human-marked usable footage');
assert.equal(usefulRangeReturn.queuePlusProcessingSecondsPerUsableSecond, 0.611,
  'the report separates queue-inclusive turnaround efficiency from execution time');
const mediaReturn = window.arcProductionQuality.pairedMeasurement({ environment: 'configured-provider', variants: {
  A: { attempts: [{ status: 'complete', jobId: 'av-return', output: 'av-return.mp4', outputAssetKey: sha('f'),
    media: { assetKey: sha('f'), seconds: 2, width: 768, height: 1344, hasAudio: true, audioTrackCount: 1,
      audioTracks: [{ durationSeconds: 2.08, codec: 'mp4a' }], audioVideoDurationDeltaSeconds: 0.08 } }] }
} }, 'A', null, 2);
assert.equal(mediaReturn.audioVideoDurationDeltaSeconds, 0.08,
  'the report preserves container track-length difference without calling it sync quality');
const unreviewedEfficiency = window.arcProductionQuality.pairedMeasurement({ environment: 'configured-provider',
  variants: { A: { attempts: [{ status: 'complete', jobId: 'unreviewed', output: 'unreviewed.mp4',
    outputAssetKey: sha('f'), durationSec: 10, queueMs: 10, executionMs: 20 }] } }
}, 'A', null, 10);
assert.equal(unreviewedEfficiency.usableSeconds, null, 'no human-marked keep range yields no efficiency claim');
assert.deepEqual(window.arcProductionQuality.usableRangeSummary([
  { startSeconds: 0, endSeconds: 3 }, { startSeconds: 2, endSeconds: 8 }, { startSeconds: 8.2, endSeconds: 12 }
], 10), { seconds: 9.8, intervalCount: 3 }, 'marked keep time is unioned and clipped to the media duration');
assert.deepEqual(window.arcProductionQuality.usableRangeSummary([
  { startSeconds: 0, endSeconds: 3 }
], null), { seconds: null, intervalCount: 0 }, 'unknown returned duration cannot produce an efficiency denominator');
const reviewTimedReturn = window.arcProductionQuality.pairedMeasurement({ environment: 'configured-provider', variants: {
  A: { retryCount: 0, attempts: [{ status: 'complete', jobId: 'reviewed', output: 'reviewed.mp4', outputAssetKey: sha('f') }] }
} }, 'A', { review: { found: true, reviewMs: 4321 } }, 5);
assert.equal(reviewTimedReturn.reviewMs, 4321, 'saved manual review time reaches the per-variant quality measurement');
const boundReturn = window.arcProductionQuality.pairedMeasurement({ environment: 'configured-provider', variants: {
  A: { retryCount: 0, attempts: [{ status: 'complete', jobId: 'bound', output: 'bound.mp4', outputAssetKey: sha('f') }] }
} }, 'A', { sourceBinding: { fingerprint: `sha256:${sha('d')}`, contentDigest: `sha256-tree-v1:${sha('e')}` } }, 5);
assert.equal(boundReturn.returnAssetKey, sha('f'), 'the media lookup identity stays distinct from byte identity');
assert.equal(boundReturn.returnSha256, sha('d'), 'a complete bound-file fingerprint is exposed as the actual file SHA-256');
assert.equal(boundReturn.returnFileFingerprint, `sha256:${sha('d')}`);
assert.equal(boundReturn.returnContentDigest, `sha256-tree-v1:${sha('e')}`);
assert.equal(pairedTiming({ attempts: [{ status: 'failed', queueMs: 300 }, pairedRun], retryCount: 1 }, pairedRun)
  .processingMs, null, 'missing retry timing leaves cumulative processing time unknown');
const outputContract = { width: 768, height: 1344, fps: 24, frames: 124 };
const outputVideo = { videoWidth: 768, videoHeight: 1344, duration: 124 / 24 };
const media = { source: 'mp4-stts', frameCount: 124, fps: 24, frameRateMode: 'constant' };
assert.deepEqual(window.arcProductionQuality.evaluateMediaContract(outputVideo, outputContract, media),
  { status: 'pass', issues: [] }, 'a candidate passes only when declared dimensions, duration, frames and cadence agree');
assert.equal(window.arcProductionQuality.evaluateMediaContract(outputVideo, outputContract,
  { ...media, frameCount: 123 }).status, 'mismatch', 'duration tolerance cannot hide a missing frame');
assert.equal(window.arcProductionQuality.evaluateMediaContract(outputVideo, outputContract,
  { ...media, fps: 30 }).status, 'mismatch', 'unexpected encoded cadence is rejected');
assert.equal(window.arcProductionQuality.evaluateMediaContract(outputVideo, outputContract,
  { ...media, frameRateMode: 'variable-or-mixed' }).status, 'mismatch', 'variable cadence is not silently accepted');
assert.equal(window.arcProductionQuality.evaluateMediaContract(outputVideo, outputContract, null).status,
  'unverified', 'missing container evidence is never treated as a pass');
assert.equal(evidenceStatus([{ status: 'failed', testFixture: false }], null, []).evidenceStatus,
  'no-return-linked', 'a failed provider attempt is not presented as a returned real clip');
assert.equal(evidenceStatus([{ status: 'complete', testFixture: true }], null, []).evidenceStatus,
  'local-test-only');
assert.equal(evidenceStatus([{ status: 'complete', testFixture: false }], null, []).evidenceStatus,
  'configured-provider-output-linked');
assert.equal(evidenceStatus([
  { status: 'complete', testFixture: false }, { status: 'complete', testFixture: true }
], null, []).evidenceStatus, 'mixed-source-outputs',
  'a configured-provider return cannot hide local test footage in the same report');
assert.equal(evidenceStatus([{ status: 'complete' }], null, []).evidenceStatus,
  'source-unconfirmed', 'an unmarked return is never upgraded to configured-provider evidence');
assert.equal(evidenceStatus([{ status: 'complete', testFixture: false }], null,
  [{ testFixture: true }]).evidenceStatus, 'mixed-source-outputs',
  'test enhancement footage remains visible when provider generation returns also exist');
assert.equal(evidenceStatus([], { environment: 'configured-provider', variants: { A: { attempts: [{ status: 'failed', output: null }] } } }, []).evidenceStatus,
  'no-return-linked', 'a failed A/B submission is not treated as real return footage');
assert.equal(evidenceStatus([], { environment: 'configured-provider', variants: { B: { attempts: [{ status: 'complete', output: 'b.mp4' }] } } }, []).evidenceStatus,
  'configured-provider-output-linked');

const mediaRecord = { generationLog: JSON.stringify([{ id: 'media-job', status: 'complete',
  output: { assetKey: sha('f'), name: 'av-return.mp4' } }]) };
assert.equal(generationLog.recordMedia(mediaRecord, 'media-job', sha('f'), {
  seconds: 2, width: 768, height: 1344, frameCount: 48, fps: 24, frameRateMode: 'constant',
  source: 'mp4-stts', hasAudio: true, audioTrackCount: 1,
  audioTracks: [{ durationSeconds: 2.08, codec: 'mp4a' }], audioVideoDurationDeltaSeconds: 0.08
}, () => true), true);
const storedMedia = JSON.parse(mediaRecord.generationLog).at(-1).media;
assert.equal(storedMedia.audioVideoDurationDeltaSeconds, 0.08,
  'metadata read by the player is durably retained on the exact returned asset');
assert.deepEqual(storedMedia.audioTracks, [{ durationSeconds: 2.08, codec: 'mp4a' }]);
const beforeFailedSave = mediaRecord.generationLog;
assert.equal(generationLog.recordMedia(mediaRecord, 'media-job', sha('f'), {
  seconds: 3, width: 768, height: 1344, source: 'mp4-stts', hasAudio: false,
  audioTrackCount: 0, audioTracks: [], audioVideoDurationDeltaSeconds: null
}, () => false), false);
assert.equal(mediaRecord.generationLog, beforeFailedSave, 'failed project save rolls technical metadata back');

console.log('PASS quality report links variant reviews and enhancement notes to exact media identities');
