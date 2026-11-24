const assert = require('node:assert/strict');
const { mediaSpec } = require('../arc-reference-media.cjs');

const u32 = value => { const out = Buffer.alloc(4); out.writeUInt32BE(value); return out; };
const box = (type, ...parts) => { const payload = Buffer.concat(parts); return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]); };
const full = Buffer.alloc(4);
function mp4(deltas) {
  const mdhd = box('mdhd', full, Buffer.alloc(8), u32(24000), u32(deltas.reduce((a, b) => a + b, 0)), Buffer.alloc(4));
  const hdlr = box('hdlr', full, u32(0), Buffer.from('vide'), Buffer.alloc(12));
  const entries = [];
  for (const delta of deltas) {
    const previous = entries.find(item => item.delta === delta);
    if (previous) previous.count++;
    else entries.push({ count: 1, delta });
  }
  const stts = box('stts', full, u32(entries.length), ...entries.flatMap(item => [u32(item.count), u32(item.delta)]));
  const stsd = box('stsd', full, u32(1), box('avc1'));
  const moov = box('moov', box('trak', box('mdia', mdhd, hdlr, box('minf', box('stbl', stts, stsd)))));
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom'));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.from([1, 2, 3, 4]))]);
}
function file(bytes, name = 'motion.mp4') {
  const result = new File([bytes], name, { type: 'video/mp4' });
  return result;
}
const role = { id: 'motion', label: '白模动作', kind: 'video', expectedFps: 24 };

(async () => {
  const accepted = await mediaSpec(role, file(mp4([1000, 1000, 1000])));
  assert.equal(accepted.metadata.fps, 24);
  assert.equal(accepted.metadata.frameRateMode, 'constant');
  await assert.rejects(mediaSpec(role, file(mp4([800, 800, 800]))), error =>
    /恒定 24 fps.*30 fps/.test(error.message) && error.message.includes('-fps_mode cfr'));
  await assert.rejects(mediaSpec(role, file(mp4([1000, 900, 1000]))), /恒定 24 fps.*variable-or-mixed/);
  await assert.rejects(mediaSpec(role, file(Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('ftyp'), Buffer.alloc(8)]))), /无法从 MP4 样本表读取帧率/);
  console.log('PASS H3 motion reference requires parseable constant 24 fps MP4');
})().catch(error => { console.error(error); process.exitCode = 1; });
