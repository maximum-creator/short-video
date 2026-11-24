const assert = require('node:assert/strict');
const projectFiles = require('../production-project.js');

const versioned = { version: 'approved-v1', file: 'approved-v1.mp4',
  reviewNotes: JSON.stringify([{ id: 'old-note', version: 'approved-v1', file: 'approved-v1.mp4', sourceMs: 400,
    category: '表演', note: '旧版原有批注' }]),
  reviewChecks: JSON.stringify([{ version: 'approved-v1', file: 'approved-v1.mp4', originVersion: 'v0',
    originFile: 'v0.mp4', noteId: 'earlier-note', basis: 'basis-v0', candidateMs: 500, state: '已修复' }]) };

projectFiles.saveCandidate(versioned);
versioned.version = 'current-v2';
versioned.file = 'current-v2.mp4';
versioned.reviewNotes = JSON.stringify([{ id: 'new-note', version: 'current-v2', file: 'current-v2.mp4',
  sourceMs: 700, category: '场景', note: '新版新增批注' }]);
versioned.reviewChecks = '[]';

projectFiles.loadCandidate(versioned, 0);
assert.match(versioned.reviewNotes, /新版新增批注/,
  'ordinary candidate switching keeps the full review history visible');

projectFiles.loadCandidate(versioned, 0, { restoreReviewState: true });
assert.match(versioned.reviewNotes, /旧版原有批注/,
  'rollback reconstruction restores the archived candidate review snapshot');
assert.doesNotMatch(versioned.reviewNotes, /新版新增批注/,
  'new candidate notes are not reclassified as unresolved old-version notes on rollback');
assert.match(versioned.reviewChecks, /earlier-note/,
  'rollback retains the archived candidate prior-note evidence');

console.log('PASS candidate-scoped review snapshots · rollback isolation · ordinary history preservation');
