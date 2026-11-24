"use strict";

const assert = require("node:assert/strict");
const workbench = require("../source-content-digest.js");
const arc = require("../../../../2026-09-22/arc-deepseek/work/Arc-Light/web/source-content-digest.js");

(async () => {
  const bytes = Buffer.alloc(workbench.CHUNK_BYTES + 97, 7);
  const changed = Buffer.from(bytes);
  changed[Math.floor(changed.length / 2)] ^= 0xff;
  const first = new Blob([bytes]);
  const second = new Blob([changed]);
  const left = await workbench.compute(first);
  assert.equal(left, await arc.compute(first), "workbench and ARC must use the same digest contract");
  const vector = new Uint8Array(Array.from({ length: 1024 }, (_, index) => index % 256));
  assert.equal(await workbench.compute(new Blob([vector])),
    "sha256-tree-v1:57a55f12cbce010fcf9f4c102e94a5ed24e0373904f399009fa45f75f4434d68",
    "the browser implementation matches the independent renderer reference vector");
  assert.notEqual(left, await workbench.compute(second), "changing only an interior byte must change the whole-file digest");
  assert.match(left, /^sha256-tree-v1:[a-f0-9]{64}$/);
  console.log("PASS full-file chunk digest · interior-byte sensitivity · workbench/ARC contract parity");
})().catch(error => { console.error(error); process.exitCode = 1; });
