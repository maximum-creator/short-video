(() => {
  const MAX_RANGE = 4 * 1024 * 1024;
  const typeAt = (bytes, offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);

  function boxAt(view, offset, limit) {
    if (offset < 0 || offset + 8 > limit) return null;
    let size = view.getUint32(offset);
    const type = typeAt(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), offset + 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > limit) return null;
      const high = view.getUint32(offset + 8), low = view.getUint32(offset + 12);
      size = high * 0x100000000 + low;
      header = 16;
    } else if (size === 0) size = limit - offset;
    if (!Number.isSafeInteger(size) || size < header || offset + size > limit) return null;
    return { type, start: offset, data: offset + header, end: offset + size, size };
  }

  function boxes(view, start, end) {
    const result = [];
    let offset = start;
    while (offset + 8 <= end && result.length < 10000) {
      const box = boxAt(view, offset, end);
      if (!box) return result;
      result.push(box);
      offset = box.end;
    }
    return result;
  }

  function trackDuration(view, buffer, mdiaChildren) {
    const mdhd = mdiaChildren.find(item => item.type === 'mdhd');
    if (!mdhd || mdhd.data + 20 > mdhd.end) return null;
    const bytes = new Uint8Array(buffer);
    const version = bytes[mdhd.data];
    let timescale, duration;
    if (version === 0) {
      timescale = view.getUint32(mdhd.data + 12);
      duration = view.getUint32(mdhd.data + 16);
    } else if (version === 1 && mdhd.data + 32 <= mdhd.end) {
      timescale = view.getUint32(mdhd.data + 20);
      duration = view.getUint32(mdhd.data + 24) * 0x100000000 + view.getUint32(mdhd.data + 28);
    } else return null;
    if (!Number.isSafeInteger(timescale) || timescale <= 0 || !Number.isSafeInteger(duration) || duration <= 0) return null;
    return duration / timescale;
  }

  function trackCodec(view, mdiaChildren) {
    const minf = mdiaChildren.find(item => item.type === 'minf');
    const stbl = minf && boxes(view, minf.data, minf.end).find(item => item.type === 'stbl');
    const stsd = stbl && boxes(view, stbl.data, stbl.end).find(item => item.type === 'stsd');
    if (!stsd || stsd.data + 16 > stsd.end || view.getUint32(stsd.data + 4) < 1) return null;
    return boxAt(view, stsd.data + 8, stsd.end)?.type || null;
  }

  function parseMoov(buffer, start, end) {
    const view = new DataView(buffer);
    const moov = boxAt(view, start, end);
    if (!moov || moov.type !== 'moov') return null;
    const audioTracks = [];
    let videoMetadata = null;
    for (const trak of boxes(view, moov.data, moov.end).filter(item => item.type === 'trak')) {
      const trakChildren = boxes(view, trak.data, trak.end);
      const mdia = trakChildren.find(item => item.type === 'mdia');
      if (!mdia) continue;
      const mdiaChildren = boxes(view, mdia.data, mdia.end);
      const hdlr = mdiaChildren.find(item => item.type === 'hdlr');
      if (!hdlr || hdlr.data + 12 > hdlr.end) continue;
      const handler = typeAt(new Uint8Array(buffer), hdlr.data + 8);
      if (handler === 'soun') {
        audioTracks.push({ durationSeconds: trackDuration(view, buffer, mdiaChildren), codec: trackCodec(view, mdiaChildren) });
        continue;
      }
      if (handler !== 'vide') continue;
      const mdhd = mdiaChildren.find(item => item.type === 'mdhd');
      const minf = mdiaChildren.find(item => item.type === 'minf');
      const stbl = minf && boxes(view, minf.data, minf.end).find(item => item.type === 'stbl');
      if (!mdhd || !stbl || mdhd.data + 20 > mdhd.end) return null;
      const version = new Uint8Array(buffer)[mdhd.data];
      let timescale, duration;
      if (version === 0) {
        timescale = view.getUint32(mdhd.data + 12);
        duration = view.getUint32(mdhd.data + 16);
      } else if (version === 1 && mdhd.data + 32 <= mdhd.end) {
        timescale = view.getUint32(mdhd.data + 20);
        const high = view.getUint32(mdhd.data + 24), low = view.getUint32(mdhd.data + 28);
        duration = high * 0x100000000 + low;
      } else return null;
      if (!Number.isSafeInteger(timescale) || timescale <= 0) return null;
      const stblChildren = boxes(view, stbl.data, stbl.end);
      const stts = stblChildren.find(item => item.type === 'stts');
      const stsd = stblChildren.find(item => item.type === 'stsd');
      if (!stts || stts.data + 8 > stts.end) return null;
      const entryCount = view.getUint32(stts.data + 4);
      if (entryCount > 10000 || stts.data + 8 + entryCount * 8 > stts.end) return null;
      let frameCount = 0, tickCount = 0;
      const deltas = new Set();
      for (let i = 0; i < entryCount; i++) {
        const count = view.getUint32(stts.data + 8 + i * 8);
        const delta = view.getUint32(stts.data + 12 + i * 8);
        if (!count || !delta) continue;
        frameCount += count;
        tickCount += count * delta;
        deltas.add(delta);
      }
      const seconds = tickCount / timescale;
      if (!frameCount || frameCount > 10_000_000 || !Number.isSafeInteger(tickCount) ||
          !Number.isFinite(seconds) || seconds <= 0) return null;
      let codec = null;
      if (stsd && stsd.data + 16 <= stsd.end && view.getUint32(stsd.data + 4) > 0) {
        const sample = boxAt(view, stsd.data + 8, stsd.end);
        if (sample) codec = sample.type;
      }
      const averageFps = frameCount / seconds;
      const fps = deltas.size === 1 ? timescale / [...deltas][0] : averageFps;
      videoMetadata = { frameCount, durationSeconds: seconds, fps: +fps.toFixed(6), averageFps: +averageFps.toFixed(6),
        frameRateMode: deltas.size === 1 ? 'constant' : 'variable-or-mixed', codec };
    }
    const audioVideoDurationDeltaSeconds = videoMetadata && audioTracks.length &&
      audioTracks.every(item => Number.isFinite(item.durationSeconds)) ?
        Math.max(...audioTracks.map(item => Math.abs(item.durationSeconds - videoMetadata.durationSeconds))) : null;
    return videoMetadata ? { ...videoMetadata, hasAudio: audioTracks.length > 0, audioTrackCount: audioTracks.length,
      audioTracks, audioVideoDurationDeltaSeconds: Number.isFinite(audioVideoDurationDeltaSeconds) ?
        +audioVideoDurationDeltaSeconds.toFixed(6) : null, source: 'mp4-stts' } : null;
  }

  function locate(buffer, baseOffset, total) {
    const view = new DataView(buffer);
    if (baseOffset === 0) {
      for (const box of boxes(view, 0, buffer.byteLength)) {
        if (box.type === 'moov') return parseMoov(buffer, box.start, buffer.byteLength);
      }
    }
    const bytes = new Uint8Array(buffer);
    for (let i = 4; i + 4 <= bytes.length; i++) {
      if (typeAt(bytes, i) !== 'moov') continue;
      const offset = i - 4;
      const box = boxAt(view, offset, bytes.length);
      if (box?.type === 'moov' && baseOffset + box.end <= total) {
        const parsed = parseMoov(buffer, offset, bytes.length);
        if (parsed) return parsed;
      }
    }
    return null;
  }

  async function range(url, start, end, fetchImpl) {
    const response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store' });
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '');
    const total = contentRange ? Number(contentRange[3]) : NaN;
    if (!contentRange || !Number.isSafeInteger(total) || total <= end ||
        Number(contentRange[1]) !== start || Number(contentRange[2]) > end) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RANGE || bytes.byteLength !== Number(contentRange[2]) - start + 1) return null;
    return { bytes, total, start };
  }

  async function read(url, fetchImpl = globalThis.fetch) {
    try {
      const probe = await range(url, 0, 0, fetchImpl);
      if (!probe || !probe.total) return null;
      const headEnd = Math.min(probe.total - 1, MAX_RANGE - 1);
      const head = await range(url, 0, headEnd, fetchImpl);
      if (!head) return null;
      const first = locate(head.bytes, 0, head.total);
      if (first) return first;
      if (head.total <= head.bytes.byteLength) return null;
      const tailStart = Math.max(head.bytes.byteLength, head.total - MAX_RANGE);
      const tail = await range(url, tailStart, head.total - 1, fetchImpl);
      return tail ? locate(tail.bytes, tail.start, tail.total) : null;
    } catch { return null; }
  }

  function inspectBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 16) return null;
    return locate(buffer, 0, buffer.byteLength);
  }

  const api = { read, parseMoov, inspectBuffer };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.arcMp4Metadata = api;
})();
