const assert = require('node:assert/strict');
const recheck = require('../production-recheck.js');
const artReview = require('../production-art-review.js');
const projectFiles = require('../production-project.js');

const note = { id: 'review-1', version: 'v01', file: 'shot-v01.mp4', sourceMs: 1840,
  category: '表演', note: '视线提前移开。' };
const record = { version: 'v02', file: 'shot-v02.mp4', reviewNotes: JSON.stringify([note]) };

assert.deepEqual(recheck.approval(record), { ready: false, pending: 1, stillExists: 0, total: 1 });
const series = { character: '角色A', look: '电影感', limits: '服装稳定' };
const pages = { story: '她推开门。' };
const shot = { ...record, verdict: '通过', scriptAnchor: '她推开门。', inPoint: '0', outPoint: '2',
  sourceBinding: JSON.stringify({ version: record.version, file: record.file, size: 100, fingerprint: 'sha256:' + 'a'.repeat(64), contentDigest: 'sha256-tree-v1:' + 'd'.repeat(64) }) };
shot.artReviews = JSON.stringify([{ version: shot.version, file: shot.file,
  signature: artReview.signature(shot, series, pages),
  checks: artReview.dimensions.map(([id]) => ({ id, result: '符合', note: '' })) }]);
const project = { series, episodes: [{ pages, shots: [shot] }] };
assert.match(projectFiles.assembly(project, 0).error, /旧版问题尚未全部复核：待复核 1 项/);
const identity = JSON.stringify([note.id, note.sourceMs, note.category, note.note]);
const check = { version: record.version, file: record.file, originVersion: note.version,
  originFile: note.file, noteId: note.id, basis: identity, candidateMs: 2250, state: '仍存在' };
record.reviewChecks = JSON.stringify([check]);
assert.deepEqual(recheck.approval(record), { ready: false, pending: 0, stillExists: 1, total: 1 });
shot.reviewChecks = record.reviewChecks;
assert.match(projectFiles.assembly(project, 0).error, /仍存在 1 项/);
record.reviewChecks = JSON.stringify([{ ...check, state: '已修复' }]);
assert.deepEqual(recheck.approval(record), { ready: true, pending: 0, stillExists: 0, total: 1 });
shot.reviewChecks = record.reviewChecks;
assert.equal(projectFiles.assembly(project, 0).error, '');
assert.deepEqual(recheck.approval({ version: 'v01', file: 'shot-v01.mp4', reviewNotes: JSON.stringify([note]) }),
  { ready: true, pending: 0, stillExists: 0, total: 0 });
record.reviewChecks = JSON.stringify([{ ...check, state: '已修复', basis: 'stale-evidence' }]);
assert.deepEqual(recheck.approval(record), { ready: false, pending: 1, stillExists: 0, total: 1 });

console.log('PASS delivery gate · historical review notes must be rechecked and resolved on the current candidate');
