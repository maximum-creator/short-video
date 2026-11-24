const assert = require('node:assert/strict');
const { read } = require('../mp4-container-metadata.js');

const u32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
const box = (type, ...parts) => { const payload = Buffer.concat(parts); return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]); };
const full = Buffer.alloc(4);
const mdhd = box('mdhd', full, Buffer.alloc(8), u32(24000), u32(2000), Buffer.alloc(4));
const hdlr = box('hdlr', full, u32(0), Buffer.from('vide'), Buffer.alloc(12));
const stts = box('stts', full, u32(1), u32(2), u32(1000));
const stsd = box('stsd', full, u32(1), box('avc1'));
const stbl = box('stbl', stts, stsd);
const minf = box('minf', stbl);
const mdia = box('mdia', mdhd, hdlr, minf);
const moov = box('moov', box('trak', mdia));
const audioMdia = box('mdia', box('mdhd', full, Buffer.alloc(8), u32(48000), u32(8000), Buffer.alloc(4)),
  box('hdlr', full, u32(0), Buffer.from('soun'), Buffer.alloc(12)),
  box('minf', box('stbl', box('stsd', full, u32(1), box('mp4a')))));
const moovWithAudio = box('moov', box('trak', mdia), box('trak', audioMdia));
const ftyp = box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom'));
const moovAtStart = Buffer.concat([ftyp, moov, box('mdat', Buffer.from([0, 1, 2, 3]))]);

function rangeFetch(file) {
  return async (_url, options) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
    assert.ok(match, 'metadata reader uses byte ranges');
    const start = Number(match[1]), end = Math.min(Number(match[2]), file.length - 1);
    return new Response(file.subarray(start, end + 1), { status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}` } });
  };
}

(async () => {
  const head = await read('/video.mp4', rangeFetch(moovAtStart));
  assert.deepEqual({ frameCount: head.frameCount, fps: head.fps, frameRateMode: head.frameRateMode, codec: head.codec },
    { frameCount: 2, fps: 24, frameRateMode: 'constant', codec: 'avc1' });
  assert.equal(head.source, 'mp4-stts');
  assert.equal(head.hasAudio, false);
  assert.equal(head.audioTrackCount, 0);
  assert.equal(head.audioVideoDurationDeltaSeconds, null, 'no audio track is not reported as zero-drift audio');

  const withAudio = await read('/video-with-audio.mp4', rangeFetch(Buffer.concat([ftyp, moovWithAudio, box('mdat', Buffer.alloc(16))])));
  assert.equal(withAudio?.hasAudio, true, 'audio track is found even when it follows the video track');
  assert.equal(withAudio?.audioTrackCount, 1);
  assert.equal(withAudio?.audioTracks[0]?.codec, 'mp4a');
  assert.equal(withAudio?.audioTracks[0]?.durationSeconds, 8000 / 48000);
  assert.equal(withAudio?.audioVideoDurationDeltaSeconds, 0.083333,
    'track duration mismatch is reported separately from actual audio-video synchronization');

  const mdatPayload = Buffer.alloc(4 * 1024 * 1024 + 100);
  const mdat = Buffer.concat([u32(mdatPayload.length + 8), Buffer.from('mdat'), mdatPayload]);
  const moovAtTail = Buffer.concat([ftyp, mdat, moov]);
  const tail = await read('/video.mp4', rangeFetch(moovAtTail));
  assert.equal(tail?.frameCount, 2, 'metadata reader finds a tail-positioned moov with bounded ranges');

  const fullOnly = await read('/video.mp4', async () => new Response(moovAtStart, { status: 200 }));
  assert.equal(fullOnly, null, 'servers without byte-range support do not trigger a full video download');
  console.log('PASS MP4 frame rate and frame count from bounded range reads; full-download fallback rejected');
})().catch(error => { console.error(error); process.exitCode = 1; });
