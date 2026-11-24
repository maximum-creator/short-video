((root) => {
  "use strict";
  const PREFIX = "sha256-tree-v1:";
  const CHUNK_BYTES = 4 * 1024 * 1024;
  const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  }
  async function compute(file, onProgress) {
    if (!globalThis.crypto?.subtle || !file || !Number.isSafeInteger(file.size) || file.size < 1 ||
        typeof file.slice !== "function") throw new Error("无法计算完整视频内容校验");
    const leaves = [];
    for (let start = 0, index = 0; start < file.size; start += CHUNK_BYTES, index += 1) {
      const bytes = new Uint8Array(await file.slice(start, Math.min(file.size, start + CHUNK_BYTES)).arrayBuffer());
      const header = new TextEncoder().encode(`arc-source-leaf-v1\0${index}\0${bytes.length}\0`);
      const input = new Uint8Array(header.length + bytes.length);
      input.set(header); input.set(bytes, header.length);
      leaves.push(await sha256(input));
      if (typeof onProgress === "function") onProgress(Math.min(file.size, start + bytes.length), file.size);
    }
    const rootHeader = new TextEncoder().encode(`arc-source-tree-v1\0${file.size}\0${leaves.length}\0`);
    const input = new Uint8Array(rootHeader.length + leaves.reduce((n, leaf) => n + leaf.length, 0));
    input.set(rootHeader);
    let offset = rootHeader.length;
    for (const leaf of leaves) { input.set(leaf, offset); offset += leaf.length; }
    return PREFIX + hex(await sha256(input));
  }
  const api = Object.freeze({ PREFIX, CHUNK_BYTES, compute });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.arcSourceDigest = api;
})(globalThis);
