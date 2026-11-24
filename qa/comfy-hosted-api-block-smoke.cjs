"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { configuration, generationServer } = require("../arc-comfy-server.cjs");

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}` : JSON.stringify(value);

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "arc-hosted-api-block-"));
  const port = await freePort();
  const comfyPort = await freePort();
  const workflowPath = path.join(folder, "hosted-api.json");
  const statePath = path.join(folder, "jobs.json");
  const graph = {
    "1": { class_type: "MinimaxHailuo03ReferenceNode", inputs: { prompt: "" } },
    "2": { class_type: "SaveVideo", inputs: { video: ["1", 0] } }
  };
  fs.writeFileSync(workflowPath, JSON.stringify(graph));
  let upstreamSubmissions = 0;
  const comfy = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url.startsWith("/object_info/")) {
      const className = decodeURIComponent(req.url.slice("/object_info/".length));
      const schema = className === "MinimaxHailuo03ReferenceNode" ?
        { input: { required: { prompt: ["STRING"] } }, output: ["VIDEO"] } :
        { input: { required: { video: ["VIDEO"] } }, output: [] };
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ [className]: schema }));
    }
    if (req.method === "POST" && req.url === "/prompt") upstreamSubmissions++;
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => comfy.listen(comfyPort, "127.0.0.1", resolve));
  const config = configuration(["--port", String(port), "--comfy-port", String(comfyPort),
    "--workflow", workflowPath, "--prompt-node", "1", "--prompt-input", "prompt", "--state", statePath,
    "--test-fixtures", "local"]);
  const server = generationServer(config);
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${port}`;
  try {
    const preflightResponse = await fetch(`${origin}/api/generation/preflight`, { headers: { connection: "close" } });
    assert.equal(preflightResponse.status, 200);
    const preflight = await preflightResponse.json();
    assert.equal(preflight.issues, 1);
    assert.match(preflight.findings[0].message, /托管 API.*可能产生按量费用.*不是本地 H3 INT8/);
    const workflow = await (await fetch(`${origin}/api/generation`, { headers: { connection: "close" } })).json();
    const post = await fetch(`${origin}/api/generation`, {
      method: "POST", headers: { origin, "content-type": "application/json", connection: "close" },
      body: JSON.stringify({ id: "0f79632f-4fc6-41a6-8d26-5e14376ecaa0", prompt: "A test shot.",
        workflowSha256: workflow.graphSha256,
        preflightSchemaSha256: preflight.schemaSha256,
        preflightFindingsSha256: crypto.createHash("sha256").update(canonicalJson(preflight.findings)).digest("hex"),
        preflightUnverifiedAcknowledged: false })
    });
    assert.equal(post.status, 409);
    assert.match((await post.json()).error, /明确问题.*未排队/);
    assert.equal(upstreamSubmissions, 0, "hosted API workflow is rejected before any upstream generation request");
    console.log("PASS hosted MiniMax API workflow is blocked at server preflight before upstream submission");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => comfy.close(resolve));
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
