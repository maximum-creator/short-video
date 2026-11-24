"use strict";

const assert = require("node:assert/strict");
const h3 = require("../arc-h3-prompt.cjs");
const refs = (image, video, audio) => [
  ...Array.from({ length: image }, (_, i) => ({ id: `i${i}`, label: `图${i}` })),
  ...Array.from({ length: video }, (_, i) => ({ id: `v${i}`, label: `视频${i}`, kind: "video" })),
  ...Array.from({ length: audio }, (_, i) => ({ id: `a${i}`, label: `音频${i}`, kind: "audio" }))
];
const valid = (image, video, audio) => h3.configure("ref2va", "6", refs(image, video, audio), []);

assert.equal(valid(9, 3, 0).inputs.length, 12, "the 9 image + 3 video mixed-input boundary is valid");
assert.equal(valid(9, 2, 1).inputs.length, 12, "the 12-file combined multimodal boundary is valid");
assert.throws(() => valid(9, 3, 1), /总数最多 12/, "each category can be within its cap while total still exceeds 12");
assert.throws(() => valid(10, 0, 0), /最多 9 张图/);
assert.throws(() => valid(0, 4, 0), /3 段视频/);
assert.throws(() => valid(0, 0, 4), /3 段音频/);

console.log("PASS H3 Ref2VA input caps · per-modality limits and 12-file mixed limit");
