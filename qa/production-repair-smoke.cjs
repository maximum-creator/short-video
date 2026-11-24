const assert = require('node:assert/strict');
const repair = require('../production-repair.js');

const record = { version: 'v07', file: 'shot-v07.mp4' };
const frames = [
  { track: 'candidate', sourceMs: 1840 },
  { track: 'comparison', sourceMs: 2110 }
];
const plan = { summary: '眼神动作短暂漂移。', keep: ['保留落眼前的停顿和左侧暖光'], issues: [
  { category: '表演', evidence: 'frame', track: 'candidate', sourceMs: 1840,
    issue: '角色眼神在转头前提前横移。', change: '仅修正这一瞬间的目光方向，保持头部姿态。' },
  { category: '构图', evidence: 'frame', track: 'comparison', sourceMs: 2110,
    issue: '对照版主体更靠左。', change: '将候选主体向左微移。' },
  { category: '其他', evidence: 'needs_review', track: null, sourceMs: null,
    issue: '动作交接仍需连续播放判断。', change: '逐帧复核转身是否连贯。' }
] };

const bound = repair.bound(plan, record, frames);
assert.equal(bound.version, 'v07');
assert.match(repair.instruction(bound.plan), /表演 · 候选源 00:01\.840/);
assert.match(repair.instruction(bound.plan), /发现：角色眼神/);
assert.match(repair.instruction(bound.plan), /只修改：仅修正这一瞬间/);
assert.match(repair.instruction(bound.plan), /保持：保留落眼前/);
assert.doesNotMatch(repair.instruction(bound.plan), /对照版主体|动作交接仍需/);
assert.match(repair.instruction(bound.plan), /不改无关表演/);

const changedEvidence = structuredClone(plan);
changedEvidence.issues[0].sourceMs += 1;
assert.throws(() => repair.bound(changedEvidence, record, frames), /没有发送的画面时间/);

repair.saveBound(plan, record, frames, () => true);
assert.equal(repair.current(record).issues[0].sourceMs, 1840);
assert.equal(repair.current({ ...record, version: 'v08' }), null);
assert.equal(repair.current({ ...record, file: 'different.mp4' }), null);

const failing = { ...record, repairPlan: 'previous-plan' };
assert.throws(() => repair.saveBound(plan, failing, frames, () => false), /未能保存返修单/);
assert.equal(failing.repairPlan, 'previous-plan');

const manual = { version: 'v08', file: 'v08.mp4', sourceBinding: 'bound-file-identity',
  reviewNotes: JSON.stringify([
    { id: 'note-a', version: 'v08', file: 'v08.mp4', sourceMs: 1200, category: '角色与道具', note: '衣领接缝闪动' },
    { id: 'note-b', version: 'v08', file: 'v08.mp4', sourceMs: 1500, category: '表演', note: '动作待核对' }
  ]) };
repair.saveFromNotes(manual, [{ id: 'note-a', change: '只修衣领接缝' }], ['原机位'], () => true);
const request = repair.instruction(repair.current(manual));
assert.match(request, /00:01\.200/);
assert.doesNotMatch(request, /动作待核对/);
assert.equal(repair.current({ ...manual, sourceBinding: 'different-file-identity' }), null);
assert.equal(repair.current({ ...manual, reviewNotes: manual.reviewNotes.replace('衣领接缝闪动', '衣领变色') }), null);

console.log('PASS repair scope · sampled and manual timestamps · minimal candidate-only instruction · version isolation · failed-save rollback');
