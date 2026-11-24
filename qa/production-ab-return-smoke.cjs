const assert = require('node:assert/strict');
const returnedReview = require('../production-ab-return.js');

const candidate = { jobId: '11111111-1111-4111-8111-111111111111', assetKey: 'a'.repeat(64), index: 0,
  name: 's03-v2.mp4', version: 'v2' };
const origin = { jobId: '22222222-2222-4222-8222-222222222222', assetKey: 'b'.repeat(64), index: 0,
  name: 's03-v1.mp4', version: 'v1' };
const marks = [{ id: '33333333-3333-4333-8333-333333333333', kind: 'step', startMs: 1800 }];

const current = { version: 'v2', file: candidate.name, abRepairReview: 'previous-approved-review' };
returnedReview.attach(current, candidate, { origin, marks });
assert.equal(returnedReview.read(current).candidate.assetKey, candidate.assetKey,
  'valid single-shot return attaches to the current version');

const beforeInvalidReturn = current.abRepairReview;
assert.throws(() => returnedReview.attach(current, candidate, { origin, marks }, { version: 'v2', file: candidate.name,
  generatedCandidate: { ...candidate, jobId: '99999999-9999-4999-8999-999999999999' } }), /资产与当前生成任务不符/);
assert.equal(current.abRepairReview, beforeInvalidReturn,
  'a return from another asset cannot replace current review evidence even if version and filename match');
assert.throws(() => returnedReview.attach(current, candidate, { origin, marks: [] }), /原回片、原时间码/);
assert.equal(current.abRepairReview, beforeInvalidReturn,
  'an invalid returned mark list does not overwrite the existing review');
assert.throws(() => returnedReview.attach(current, { ...candidate, version: 'stale-v1' }, { origin, marks }), /不是当前镜头版本/);
assert.equal(current.abRepairReview, beforeInvalidReturn,
  'a stale version return preserves current review and rollback evidence');

const hashedCandidate = { ...candidate, sha256: 'c'.repeat(64), sizeBytes: 4096 };
const hashBound = { version: 'v2', file: candidate.name };
returnedReview.attach(hashBound, hashedCandidate, { origin, marks }, {
  version: 'v2', file: candidate.name, generatedCandidate: { ...hashedCandidate }
});
assert.equal(returnedReview.read(hashBound).candidate.sha256, hashedCandidate.sha256,
  'repair return attaches when upstream content SHA and byte count match the generated candidate');
assert.throws(() => returnedReview.attach({ version: 'v2', file: candidate.name }, hashedCandidate,
  { origin, marks }, { version: 'v2', file: candidate.name,
    generatedCandidate: { ...hashedCandidate, sha256: 'd'.repeat(64) } }), /资产与当前生成任务不符/,
  'matching task and asset keys cannot mask a changed upstream content hash');
assert.throws(() => returnedReview.attach({ version: 'v2', file: candidate.name }, candidate,
  { origin, marks }, { version: 'v2', file: candidate.name, generatedCandidate: hashedCandidate }), /资产与当前生成任务不符/,
  'a missing upstream hash cannot inherit hash-bound repair approval');

const newRecord = { version: 'v2', file: candidate.name };
assert.throws(() => returnedReview.attach(newRecord, candidate, { origin, marks: [] }), /原回片、原时间码/);
assert.equal(Object.hasOwn(newRecord, 'abRepairReview'), false,
  'failed attachment on a new record leaves no malformed partial review');

const originalDigest = 'sha256-tree-v1:' + '1'.repeat(64);
const candidateDigest = 'sha256-tree-v1:' + '2'.repeat(64);
const patched = { version: 'v2', file: candidate.name, generatedCandidate: JSON.stringify({ ...candidate, comparison: { fps: 24 } }),
  abRepairReview: JSON.stringify({ candidate, origin, marks: [{ ...marks[0], startMs: 1250 }], checks: {
    [marks[0].id]: { pass: true, originSha256: originalDigest, candidateSha256: candidateDigest, candidateMs: 2500 }
  } }) };
const patchOriginal = { file: origin.name, start: 0, end: 10, fps: 24, candidateFps: 24,
  fpsEvidenceSource: 'mp4-stts', frameRateMode: 'constant',
  candidateFpsEvidenceSource: 'mp4-stts', candidateFrameRateMode: 'constant',
  source: { contentDigest: originalDigest } };
const patchBinding = { contentDigest: candidateDigest };
const patchRange = { oldInMs: 1250, oldOutMs: 1750, newInMs: 2500, motion: true, light: true, audio: true,
  originalDigest, candidateDigest };
const hashBoundApproval = { version: 'v2', file: candidate.name,
  generatedCandidate: JSON.stringify({ ...hashedCandidate, comparison: { fps: 24 } }),
  abRepairReview: JSON.stringify({ candidate: hashedCandidate, origin, marks: [{ ...marks[0], startMs: 1250 }], checks: {
    [marks[0].id]: { pass: true, originSha256: originalDigest, candidateSha256: candidateDigest, candidateMs: 2500 }
  } }) };
assert.equal(returnedReview.approval(hashBoundApproval, { contentDigest: candidateDigest }).ready, true,
  'an exact upstream byte identity can be approved after local review');
hashBoundApproval.generatedCandidate = JSON.stringify({ ...hashedCandidate, sha256: 'd'.repeat(64), comparison: { fps: 24 } });
assert.equal(returnedReview.approval(hashBoundApproval, { contentDigest: candidateDigest }).ready, false,
  'upstream content hash drift invalidates a previously approved repair return');
assert.throws(() => returnedReview.patchIntervals(hashBoundApproval, patchOriginal,
  { contentDigest: candidateDigest }, [patchRange]), /请先确认旧通过版、新版指纹和局部换镜区间/,
  'changed upstream bytes cannot retain local replacement authority');
assert.deepEqual(returnedReview.patchIntervals(patched, patchOriginal, patchBinding, [patchRange]), [patchRange],
  '24 fps cuts are checked against both identity-bound constant-rate MP4 frame grids');
assert.equal(returnedReview.approval(patched, patchBinding).ready, true,
  'completed return approval is bound to the exact generated candidate');
const previousGenerated = patched.generatedCandidate;
patched.generatedCandidate = JSON.stringify({ ...candidate, jobId: '99999999-9999-4999-8999-999999999999' });
assert.equal(returnedReview.approval(patched, patchBinding).ready, false,
  'regenerating the same version and filename invalidates approval of the old repair return');
assert.throws(() => returnedReview.patchIntervals(patched, patchOriginal, patchBinding, [patchRange]),
  /请先确认旧通过版、新版指纹和局部换镜区间/,
  'a stale repair review cannot authorize partial replacement of a new return');
patched.generatedCandidate = previousGenerated;
assert.throws(() => returnedReview.patchIntervals(patched, { ...patchOriginal, fps: undefined }, patchBinding, [patchRange]),
  /缺少旧版或新版绑定同一回片的 MP4 恒定帧率证据/);
assert.throws(() => returnedReview.patchIntervals(patched, { ...patchOriginal, candidateFpsEvidenceSource: undefined }, patchBinding, [patchRange]),
  /缺少旧版或新版绑定同一回片的 MP4 恒定帧率证据/,
  'a numeric average frame rate without asset-bound MP4 stts evidence cannot authorize a patch');
assert.throws(() => returnedReview.patchIntervals(patched, { ...patchOriginal, frameRateMode: 'variable-or-mixed' }, patchBinding, [patchRange]),
  /缺少旧版或新版绑定同一回片的 MP4 恒定帧率证据/,
  'variable-rate media cannot be treated as a constant frame grid');
assert.throws(() => returnedReview.patchIntervals(patched, patchOriginal, patchBinding,
  [{ ...patchRange, oldInMs: 1260 }]), /局部区间、接缝复核/,
  'non-frame-aligned source cut points are rejected');
assert.throws(() => returnedReview.patchIntervals(patched, patchOriginal, patchBinding,
  [{ ...patchRange, newInMs: 2550 }]), /局部区间、接缝复核/,
  'candidate in and out points must also align to measured frames');

console.log('PASS one-shot repair return identity, rollback, and source/candidate frame-grid validation');
