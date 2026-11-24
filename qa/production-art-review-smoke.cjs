const assert = require('node:assert/strict');
const review = require('../production-art-review.js');
const projectFiles = require('../production-project.js');
const reviewNotes = require('../production-review-notes.js');

const labels = review.dimensions.map(([, label]) => label);
assert.equal(review.dimensions.length, 7);
assert(labels.includes('表演与表情'));
assert(labels.includes('运镜与动作连续'));
assert(labels.includes('跨帧稳定与伪影'));

const untouched = review.dimensions.map(([id]) => ({ id, result: '待核对', note: '' }));
assert.deepEqual(review.missing(untouched), labels);

const complete = review.dimensions.map(([id]) => ({ id, result: '符合', note: '' }));
assert.deepEqual(review.missing(complete), []);

const explicitlyNotApplicable = review.dimensions.map(([id]) => ({ id, result: '本镜不适用', note: '' }));
assert.deepEqual(review.missing(explicitlyNotApplicable), []);

const returned = review.dimensions.map(([id]) => ({ id, result: '符合', note: '' }));
returned[4] = { id: 'performance', result: '待返修', note: '' };
assert.equal(review.parse(returned).find(item => item.id === 'performance').result, '待返修');
assert.equal(review.parse([{ id: 'untrusted', result: '符合' }]).length, 0);

const qcHash = 'f'.repeat(64);
const qcReport = { source_identity: { sha256: qcHash, size_bytes: 1234, stable_during_qc: true },
  summary: { errors: 1, warnings: 2, has_audio: true, audio_all_silent: false, audio_video_track_duration_delta: 1.5 },
  findings: [{ kind: 'black', severity: 'error', start: 0, end: 1, detail: '黑帧 1.00s', threshold: '平均亮度阈值' },
    { kind: 'av-track-duration', severity: 'warn', start: 1, end: 2.5, detail: '轨道时长相差 1.50s' }],
  thresholds: { black_pic_th: 0.1 } };
const parsedQc = review.parseTechnicalQc(qcReport, qcHash, 1234);
assert.equal(parsedQc.findings[0].kind, 'black');
assert.equal(parsedQc.findings[1].kind, 'av-track-duration');
assert.equal(parsedQc.summary.audioVideoTrackDurationDelta, 1.5);
assert.deepEqual(parsedQc.coverage.automated, ['black', 'freeze', 'silence', 'relative-shake', 'av-track-duration-delta']);
assert.equal(parsedQc.coverage.cleanResultIsQualityPass, false,
  'technical QC import explicitly records that a clean scan is not an art-quality pass');
assert(parsedQc.coverage.manualReviewRequired.includes('lip-sync'));
assert.throws(() => review.parseTechnicalQc(qcReport, 'e'.repeat(64), 1234), /SHA-256/,
  'a QC report for another version cannot be attached');
assert.throws(() => review.parseTechnicalQc({ ...qcReport, source_identity: { ...qcReport.source_identity, stable_during_qc: false } }, qcHash, 1234), /SHA-256/,
  'a report for a file changed during QC is rejected');

const record = { version: 'v1', file: 'E01-S01.mp4', scriptAnchor: '我会回来', refs: [], composition: '近景', move: '推近', path: '',
  cameraPlan: '', frameAsset: '', sourceBinding: JSON.stringify({ version: 'v1', file: 'E01-S01.mp4', size: 100,
    fingerprint: 'sha256:' + 'a'.repeat(64), contentDigest: 'sha256-tree-v1:' + 'd'.repeat(64) }) };
const series = { character: '主角', look: '写实电影感', limits: '保持服装一致' };
const pages = { story: '室内空间夜景\n\n他望向窗外，说：“我会回来。”\n\n另一场：街角下雨。', dialogue: '', state: '左手握着随身物品', rules: '午夜前必须离开' };
const benchmark = { id: 'shot-02-v1', checks: [{ id: 'threshold-contact', check: '脚底与门槛接触稳定', severity: 'blocker' }] };
assert.equal(review.approval(record, series).ready, false, 'unreviewed candidate cannot pass');
assert.deepEqual(review.current(record, series, pages, undefined, benchmark).benchmarkChecks[0].result, '待核对',
  'benchmark checks stay pending until a reviewer records the candidate');
assert.deepEqual(review.approval(record, series, pages, undefined, benchmark).benchmarkMissing, ['脚底与门槛接触稳定'],
  'a trial candidate cannot pass while its shot-specific acceptance is unreviewed');
assert.equal(review.approval(record, series, pages, undefined, benchmark).ready, false,
  'unreviewed shot-specific acceptance is a hard approval gate');
const unbound = { ...record }; delete unbound.sourceBinding;
assert.equal(review.approval(unbound, series).unbound, true, 'a candidate without a bound media identity cannot pass');
const signature = review.signature(record, series, pages);
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature,
  checks: complete, reviewMs: 4321, technicalQc: { ...parsedQc, sourceSha256: 'a'.repeat(64), sizeBytes: 100 } }]);
assert.equal(review.current(record, series, pages).reviewMs, 4321,
  'manual visual-review duration stays bound to the same candidate and review basis');
assert.equal(review.current(record, series, pages).technicalQc.summary.errors, 1,
  'a technical QC report is available for the exact SHA-bound candidate');
assert.equal(review.current(record, series, pages).technicalQc.findings[1].kind, 'av-track-duration',
  'the gross track-duration warning survives persistence on its SHA-bound candidate');
assert.equal(review.current(record, series, pages).technicalQc.summary.audioVideoTrackDurationDelta, 1.5,
  'the measured audio/video track extent remains available after project reload');
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete,
  technicalQc: { ...parsedQc, sourceSha256: qcHash, sizeBytes: 1234 } }]);
assert.equal(review.current(record, series, pages).technicalQc, null,
  'a technical QC report cannot display when its file hash differs from the bound candidate');
assert.equal(review.approval(record, series, pages).ready, true, 'complete visual review permits pass');
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature,
  checks: complete, benchmark: { id: benchmark.id, checks: [{ id: 'threshold-contact', result: '待返修', note: '脚底滑动',
    timecodes: [{ sourceMs: 1420, note: '右脚触地后滑动' }] }] } }]);
assert.equal(review.current(record, series, pages, undefined, benchmark).benchmarkChecks[0].timecodes[0].sourceMs, 1420,
  'benchmark timecodes remain attached to the saved review and candidate identity');
assert.equal(review.approval(record, series, pages, undefined, benchmark).ready, false,
  'an explicit benchmark repair blocks approval');
assert.equal(review.approval(record, series, pages, undefined, benchmark).issues[0].note, '脚底滑动');
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete,
  benchmark: { id: 'another-trial', checks: [{ id: 'threshold-contact', result: '符合' }] } }]);
assert.equal(review.current(record, series, pages, undefined, benchmark).benchmarkChecks[0].result, '待核对',
  'benchmark conclusions from a different trial cannot leak into this one');
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete }]);
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete,
  benchmark: { id: benchmark.id, checks: [{ id: 'threshold-contact', result: '符合', timecodes: [] }] } }]);
assert.equal(review.approval(record, series, pages, undefined, benchmark).ready, true,
  'a complete shot-specific acceptance plus general visual review permits pass');
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete,
  benchmark: { id: benchmark.id, checks: [{ id: 'threshold-contact', result: '本镜不适用' }] } }]);
const blockerNa = review.approval(record, series, pages, undefined, benchmark);
assert.equal(blockerNa.ready, false, 'a blocker criterion cannot be bypassed as not applicable');
assert.deepEqual(blockerNa.benchmarkMissing, ['脚底与门槛接触稳定']);
assert.equal(review.current(record, series, pages, undefined, benchmark).benchmarkChecks[0].severity, 'blocker');
const reviewOnlyBenchmark = { id: 's02-reaction-review', checks: [
  { id: 'reaction-cut', check: '反应剪辑余量', severity: 'review' }
] };
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete,
  benchmark: { id: reviewOnlyBenchmark.id, checks: [{ id: 'reaction-cut', result: '本镜不适用' }] } }]);
assert.equal(review.approval(record, series, pages, undefined, reviewOnlyBenchmark).ready, true,
  'non-blocking review criteria may still be marked not applicable');
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete }]);
assert.equal(review.current(record, series, pages).stale, false);
assert.equal(review.current(record, series, pages).checks.length, labels.length);
pages.story = '室内空间夜景\n\n他望向窗外，说：“我会回来。”\n\n另一场：街角晴天。';
assert.equal(review.approval(record, series, pages).ready, true, 'editing a separate scene does not invalidate this shot review');
record.generatedCandidate = JSON.stringify({ jobId: '11111111-1111-4111-8111-111111111111', index: 0,
  name: record.file, version: record.version, assetKey: 'a'.repeat(64) });
const generatedReviewSignature = review.signature(record, series, pages);
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature: generatedReviewSignature, checks: complete }]);
assert.equal(review.current(record, series, pages).stale, false);
const generatedNote = { id: 'generated-note', ...reviewNotes.identity(record), sourceMs: 720,
  category: '表演', note: '目光停顿自然' };
record.reviewNotes = JSON.stringify([generatedNote]);
assert.equal(reviewNotes.list(record).length, 1, 'timecoded notes bind to the current returned asset');
record.generatedCandidate = JSON.stringify({ jobId: '22222222-2222-4222-8222-222222222222', index: 0,
  name: record.file, version: record.version, assetKey: 'b'.repeat(64) });
assert.equal(review.current(record, series, pages).stale, true,
  'regenerating the same version and filename invalidates prior visual approval when output identity changes');
assert.equal(review.approval(record, series, pages).ready, false);
assert.equal(reviewNotes.list(record).length, 0,
  'timecoded notes from an earlier generated asset cannot appear on the replacement return');
const legacyNotes = { version: 'v1', file: 'legacy.mp4', reviewNotes: JSON.stringify([
  { id: 'legacy-note', version: 'v1', file: 'legacy.mp4', sourceMs: 120, category: '表演', note: '旧记录' }
]) };
assert.equal(reviewNotes.list(legacyNotes).length, 1, 'legacy review notes remain readable before an output asset is bound');
delete record.generatedCandidate;
delete record.reviewNotes;
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete }]);
pages.story = '室内空间夜景\n\n他望向窗外，说：“我会回来。”随后把随身物品撕碎。\n\n另一场：街角晴天。';
assert.equal(review.approval(record, series, pages).stale, true, 'editing the paragraph linked by the anchor invalidates visual approval');
pages.story = '室内空间夜景\n\n他望向窗外，说：“我会回来。”\n\n另一场：街角晴天。';
pages.rules = '午夜后才能离开';
assert.equal(review.approval(record, series, pages).stale, true, 'changing episode rules invalidates visual approval');
pages.rules = '午夜前必须离开';
record.beat = '观众误以为她已经离开';
assert.equal(review.approval(record, series, pages).stale, true,
  'changing the dramatic purpose invalidates an approval made for the previous beat');
record.beat = '';
assert.equal(review.approval(record, series, pages).ready, true, 'restoring the reviewed purpose restores its approval');
record.sourceBinding = JSON.stringify({ version: record.version, file: record.file, size: 100,
  fingerprint: 'sha256:' + 'c'.repeat(64), contentDigest: 'sha256-tree-v1:' + 'e'.repeat(64) });
assert.equal(review.approval(record, series, pages).stale, true, 'changing bytes under the same name invalidates the old approval');
record.sourceBinding = JSON.stringify({ version: record.version, file: record.file, size: 100,
  fingerprint: 'sha256:' + 'a'.repeat(64), contentDigest: 'sha256-tree-v1:' + 'd'.repeat(64) });
record.performance = '她先屏息，再抬眼';
assert.equal(review.approval(record, series, pages).stale, true,
  'changing the dedicated performance beats invalidates the previous visual approval');
delete record.performance;
assert.equal(review.approval(record, series, pages).ready, true, 'legacy shots remain valid when the optional performance field is empty');
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature,
  checks: returned.map((item, index) => index === 4 ? { ...item, result: '待返修', note: '眼神跳变' } : item) }]);
assert.equal(review.approval(record, series, pages).ready, false, 'open visual issue blocks pass');

const shot = { ...record, verdict: '通过', inPoint: '0', outPoint: '2' };
const project = { series, episodes: [{ shots: [shot], pages }] };
assert.match(projectFiles.assembly(project, 0).error, /表演与表情仍待返修/);
record.artReviews = JSON.stringify([{ version: record.version, file: record.file, signature, checks: complete }]);
shot.artReviews = record.artReviews;
assert.equal(projectFiles.assembly(project, 0).error, '', 'complete reviewed candidate can be handed to ARC');
const benchmarkShot = { ...shot, qualityBenchmarkId: 'shot-04-action-vfx-v1', qualityBenchmarkMode: 'motion',
  artReviews: JSON.stringify([{ version: shot.version, file: shot.file, signature, checks: complete }]) };
const benchmarkProject = { series: { ...series, title: '独立测试' }, episodes: [{ shots: [{}, {}, benchmarkShot], pages }] };
assert.match(projectFiles.assembly(benchmarkProject, 0).error, /试镜专项仍待核对/,
  'ARC assembly blocks an otherwise visually approved shot while its selected benchmark checklist is incomplete');
for (const [field, value] of [['guide', '切换运镜参考'], ['reference', '换用另一道主光'], ['duration', '5']]) {
  shot[field] = value;
  assert.equal(review.current(shot, series, pages).stale, true, field + ' invalidates the displayed review');
  assert.match(projectFiles.assembly(project, 0).error, /重新完成视觉验收/);
  delete shot[field];
}
assert.equal(projectFiles.assembly(project, 0).error, '', 'undoing those edits restores the previously reviewed plan');

global.window = { arcProductionProject: projectFiles, arcArtReview: review,
  arcRecheck: require('../production-recheck.js'), arcContinuity: require('../production-continuity.js'),
  arcOverviewJobs: { validJobId: () => false } };
require('../production-overview.js');
assert.equal(window.arcOverview.describe(project, 0).rows[0].label, '可剪辑');
shot.guide = '跟随新参考';
assert.equal(window.arcOverview.describe(project, 0).rows[0].label, '美术待重审');
delete shot.guide;

const previous = { kind: '道具', subject: '随身物品', field: '位置', start: '桌上', end: '左手' };
const current = { ...previous, start: '左手', end: '车窗边' };
const other = { kind: '人物', subject: '旅客', field: '位置', start: '场景', end: '车厢' };
const priorPages = { continuityLedger: JSON.stringify([previous]) };
const nextPages = { ...pages, continuityLedger: JSON.stringify([current, other]) };
const sequel = { series, episodes: [
  { shots: [{}], pages: priorPages }, { shots: [shot], pages: nextPages }
] };
const { reviewBasis } = window.arcContinuity;
const continuitySignature = review.signature(shot, series, nextPages, reviewBasis(sequel, 1));
assert.equal(window.arcOverview.describe(sequel, 1).rows[0].label, '美术待重审',
  'a previously approved shot without a ledger basis must be reviewed once');
shot.artReviews = JSON.stringify([{ version: shot.version, file: shot.file, signature: continuitySignature, checks: complete }]);
assert.equal(projectFiles.assembly(sequel, 1).error, '');
nextPages.continuityLedger = JSON.stringify([other, current]);
assert.equal(projectFiles.assembly(sequel, 1).error, '', 'reordering the records does not invalidate review');
priorPages.continuityLedger = JSON.stringify([{ ...previous, end: '右手' }]);
assert.equal(window.arcOverview.describe(sequel, 1).rows[0].label, '美术待重审');
assert.match(projectFiles.assembly(sequel, 1).error, /重新完成视觉验收/);
assert.equal(projectFiles.assembly(sequel, 1).ready.length, 0, 'old approval cannot enter the ARC handoff');
assert.equal(shot.verdict, '通过', 'historical verdict remains on the candidate');
priorPages.continuityLedger = JSON.stringify([previous]);
assert.equal(projectFiles.assembly(sequel, 1).error, '');

const separated = { series, episodes: [{ pages: priorPages, shots: [{}] },
  { pages: {}, shots: [{}] }, { pages: nextPages, shots: [shot] }] };
const { report } = window.arcContinuity;
const acrossGap = report(separated, 2).find(row => row.subject === previous.subject);
assert.equal(acrossGap.previousEpisode, 1);
assert.equal(acrossGap.status, '承接一致');
priorPages.continuityLedger = JSON.stringify([{ ...previous, end: '右手' }]);
assert.equal(report(separated, 2).find(row => row.subject === previous.subject).status, '待解释变化');
assert.notEqual(reviewBasis(separated, 2), continuitySignature);
separated.episodes[1].pages.continuityLedger = JSON.stringify([{ ...previous, end: '' }]);
assert.equal(report(separated, 2).find(row => row.subject === previous.subject).status, '待补上集结尾');
console.log('PASS visual acceptance · continuity across gaps · latest incomplete record takes priority · candidate preserved');
