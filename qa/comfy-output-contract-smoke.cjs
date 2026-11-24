"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { configuration, generationServer } = require("../arc-comfy-server.cjs");

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "arc-output-contract-"));
  const workflow = path.join(folder, "workflow.json");
  const contract = path.join(folder, "contract.json");
  const port = await freePort();
  let server;
  try {
    fs.writeFileSync(workflow, JSON.stringify({ "1": { class_type: "CLIPTextEncode", inputs: { text: "" } } }));
    fs.writeFileSync(contract, JSON.stringify({ width: 768, height: 1344, frames: 124, fps: 24 }));
    const config = configuration(["--port", String(port), "--comfy-port", String(await freePort()),
      "--workflow", workflow, "--prompt-node", "1", "--output-contract", contract]);
    assert.deepEqual(config.outputContract, { width: 768, height: 1344, frames: 124, fps: 24 });
    server = generationServer(config);
    await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${port}/api/generation`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).outputContract, config.outputContract,
      "custom workflow exposes its operator-declared output contract without contacting ComfyUI");
    fs.writeFileSync(contract, JSON.stringify({ width: 768, height: 1344, seconds: 5, frames: 124, fps: 24 }));
    const validationPort = await freePort();
    assert.throws(() => configuration(["--port", String(port), "--comfy-port", String(validationPort),
      "--workflow", workflow, "--prompt-node", "1", "--output-contract", contract]), /输出契约无效/);
    console.log("PASS custom ComfyUI output contract is validated and exposed locally without GPU or provider requests");
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
