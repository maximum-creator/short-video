const assert = require('node:assert/strict');
const { frameTimecode, validFrameEvidence } = require('../production-ab-review.js');

const measured = { source: 'mp4-stts', frameRateMode: 'constant', fps: 24 };
const snapped = frameTimecode(1.51, measured);
assert.deepEqual(snapped, { startMs: 1500, frameIndex: 36, fps: 24,
  timecodeBasis: 'measured-cfr-frame-grid' });
assert.equal(validFrameEvidence(snapped), true);
assert.equal(validFrameEvidence({ ...snapped, startMs: 1510 }), false,
  'recorded frame evidence cannot disagree with its frame grid');

const variable = frameTimecode(1.51, { ...measured, frameRateMode: 'variable-or-mixed' });
assert.deepEqual(variable, { startMs: 1510, timecodeBasis: 'player-time' },
  'variable-frame-rate output is never presented as frame-accurate');
assert.equal(validFrameEvidence(variable), true);

const range = { ...snapped, kind: 'range', endMs: 2500, endFrameIndex: 60, endFps: 24 };
assert.equal(validFrameEvidence(range, true), true);
assert.equal(validFrameEvidence({ ...range, endMs: 2510 }, true), false,
  'a kept range end must be on the declared measured frame grid');

console.log('PASS A/B issue timecode snaps only to an identity-bound constant-rate frame grid');
