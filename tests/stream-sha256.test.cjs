const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Sha256, file } = require('../stream-sha256.js');

test('streaming SHA-256 matches standard digest across block and padding boundaries', () => {
  for (const size of [1, 55, 56, 63, 64, 65, 4095, 4096, 65537]) {
    const bytes = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) bytes[i] = i % 251;
    const hash = new Sha256();
    for (let offset = 0; offset < size; offset += 997) hash.update(bytes.subarray(offset, Math.min(size, offset + 997)));
    assert.equal(hash.hex(), crypto.createHash('sha256').update(bytes).digest('hex'), `size=${size}`);
  }
});

test('file hashing reads large Blob slices and matches whole-buffer SHA-256', async () => {
  const bytes = Buffer.alloc(9 * 1024 * 1024 + 17);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17) % 251;
  const blob = new Blob([bytes]);
  const progress = [];
  assert.equal(await file(blob, (done, total) => progress.push([done, total])),
    crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(progress.at(-1)[0], bytes.length);
  assert.equal(progress.at(-1)[1], bytes.length);
});
