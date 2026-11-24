"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { configuration, generationServer } = require("../arc-comfy-server.cjs");
const prompt = require("../arc-h3-prompt.cjs");
const fetchFresh = (url, options = {}) => fetch(url, {
  ...options, headers: { ...options.headers, Connection: "close" }
});
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}` : JSON.stringify(value);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arc-reference-kinds-"));
  try {
    const workflowPath = path.join(dir, "workflow.json");
    const rolesPath = path.join(dir, "references.json");
    fs.writeFileSync(workflowPath, JSON.stringify({
      "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
      "2": { class_type: "LoadImage", inputs: { image: "" } },
      "3": { class_type: "LoadImage", inputs: { image: "" } },
      "4": { class_type: "LoadImage", inputs: { image: "" } },
      "5": { class_type: "LoadVideo", inputs: { file: "" } }
    }));
    const roles = [
      { id: "opening", label: "起始画面", node: "2", assetKinds: ["分镜关键画面"] },
      { id: "character", label: "角色外观", node: "3", assetKinds: ["角色"] },
      { id: "environment", label: "场景构图", node: "4", assetKinds: ["场景"] }
    ];
    fs.writeFileSync(rolesPath, JSON.stringify(roles));
    const portProbe = http.createServer();
    await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
    const port = portProbe.address().port;
    await new Promise(resolve => portProbe.close(resolve));
    const args = ["--port", String(port), "--workflow", workflowPath, "--prompt-node", "1",
      "--references", rolesPath, "--h3-mode", "ref2va", "--h3-duration", "6"];
    const config = configuration([...args]);
    assert.deepEqual(config.references.map(item => item.assetKinds), [
      ["分镜关键画面"], ["角色"], ["场景"]
    ]);

    const selected = [
      { role: "opening", label: "起始画面", assetId: "A2", assetKind: "分镜关键画面" },
      { role: "character", label: "角色外观", assetId: "A0", assetKind: "角色" },
      { role: "environment", label: "场景构图", assetId: "A1", assetKind: "场景" }
    ];
    const profile = prompt.configure("ref2va", "6", config.references, []);
    assert.equal(prompt.prepare(profile, [], selected).entries.length, 3);
    assert.throws(() => prompt.prepare(profile, [], selected.map(item => item.role === "character" ?
      { ...item, assetKind: "场景" } : item)), /只接受 角色 类参考图/);

    fs.writeFileSync(rolesPath, JSON.stringify([{ ...roles[1], assetKinds: ["not-a-real-kind"] }]));
    assert.throws(() => configuration([...args]), /参考素材角色字段无效/);
    fs.writeFileSync(rolesPath, JSON.stringify([{ ...roles[1], assetKinds: "角色" }]));
    assert.throws(() => configuration([...args]), /参考素材角色字段无效/);

    fs.writeFileSync(rolesPath, JSON.stringify([{ id: "motion", label: "白模动作", node: "5", kind: "video", expectedFps: 24 }]));
    assert.equal(configuration([...args]).references[0].expectedFps, 24, "the H3 timing requirement survives role parsing");
    fs.writeFileSync(rolesPath, JSON.stringify([{ id: "motion", label: "白模动作", node: "5", kind: "video", expectedFps: 30 }]));
    assert.throws(() => configuration([...args]), /参考素材角色字段无效/, "unexpected motion clocks cannot silently weaken the H3 gate");

    fs.writeFileSync(rolesPath, JSON.stringify(roles));
    let submissions = 0;
    const peerId = "f086f366-f485-4fd1-a15e-15a2908ce203";
    const mock = http.createServer(async (req, res) => {
      const send = data => res.end(JSON.stringify(data));
      if (req.url === "/upload/image") {
        for await (const _ of req) {}
        return send({ name: "mock.png" });
      }
      if (req.url === "/prompt") {
        for await (const _ of req) {}
        submissions++;
        return send({ prompt_id: peerId });
      }
      if (req.url === "/history/" + peerId) return send({ [peerId]: { status: { completed: true },
        outputs: { "9": { videos: [{ filename: "return.mp4", subfolder: "", type: "output" }] } } } });
      if (req.url.startsWith("/view?")) return res.end("fixture video bytes");
      res.writeHead(404);
      res.end();
    });
    await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
    const restartable = configuration([...args, "--comfy-port", String(mock.address().port), "--state", path.join(dir, "jobs.json")]);
    let server;
    const listen = async () => {
      server = generationServer(restartable);
      await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
    };
    const shutdown = () => new Promise(resolve => server.close(resolve));
    try {
      await listen();
      const origin = `http://127.0.0.1:${port}`;
      const preflight = await (await fetchFresh(origin + "/api/generation/preflight")).json();
      const preflightFields = { workflowSha256: preflight.graphSha256,
        preflightSchemaSha256: preflight.schemaSha256,
        preflightFindingsSha256: crypto.createHash("sha256").update(canonicalJson(preflight.findings)).digest("hex"),
        preflightUnverifiedAcknowledged: preflight.unverified > 0 };
      assert.ok(preflight.unverified > 0, "the mocked provider must exercise unknown-node acknowledgement");
      const unacknowledged = await fetchFresh(origin + "/api/generation", {
        method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ ...preflightFields, preflightUnverifiedAcknowledged: false,
          id: "f086f366-f485-4fd1-a15e-15a2908ce201", prompt: "test prompt" })
      });
      assert.equal(unacknowledged.status, 409);
      assert.match((await unacknowledged.json()).error, /尚未确认/);
      assert.equal(submissions, 0, "unacknowledged unknown schemas never reach the provider");
      const staleSchema = await fetchFresh(origin + "/api/generation", {
        method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ ...preflightFields, preflightSchemaSha256: "0".repeat(64),
          id: "f086f366-f485-4fd1-a15e-15a2908ce204", prompt: "test prompt" })
      });
      assert.equal(staleSchema.status, 409);
      assert.match((await staleSchema.json()).error, /节点定义或预检发现已变化/);
      assert.equal(submissions, 0, "schema drift between preflight and submission is rejected before provider queueing");
      const html = await (await fetchFresh(origin + "/index.html")).text();
      const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
      assert.ok(scripts.length > 0);
      await Promise.all(scripts.map(async script => {
        const asset = await fetchFresh(origin + "/" + script);
        assert.equal(asset.status, 200, `bridge must serve the workbench script ${script}`);
        await asset.arrayBuffer();
      }));
      const response = await fetchFresh(`http://127.0.0.1:${port}/api/generation`, {
        method: "POST", headers: { origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
        body: JSON.stringify({ ...preflightFields, id: "f086f366-f485-4fd1-a15e-15a2908ce202", prompt: "test prompt",
          images: { opening: "data:image/png;base64,AA==", character: "data:image/png;base64,AA==",
            environment: "data:image/png;base64,AA==" },
          referenceAssetKinds: { opening: "分镜关键画面", character: "场景", environment: "场景" } })
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /「角色外观」只接受 角色 类参考图/);

      const id = "f086f366-f485-4fd1-a15e-15a2908ce202";
      const submit = () => fetchFresh(origin + "/api/generation", {
        method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ ...preflightFields, id, prompt: "test prompt", images: Object.fromEntries(roles.map(role =>
          [role.id, "data:image/png;base64,AA=="])),
        referenceAssetKinds: { opening: "分镜关键画面", character: "角色", environment: "场景" } })
      });
      const posted = await submit();
      assert.equal(posted.status, 202);
      assert.equal((await posted.json()).status, "queued");
      const status = () => fetchFresh(origin + "/api/generation/" + id).then(response => response.json());
      const before = await status();
      assert.equal(before.status, "complete");
      await shutdown();
      await listen();
      const restored = await status();
      assert.equal(restored.status, "complete");
      assert.deepEqual(restored.outputs, before.outputs);
      const overview = await (await fetchFresh(origin + "/api/generation/jobs?ids=" + id)).json();
      assert.deepEqual(overview.jobs[0].timing, restored.timing);
      assert.equal(overview.jobs[0].workflow, restored.workflow);
      assert.equal("outputs" in overview.jobs[0], false);
      const file = await fetchFresh(origin + restored.outputs[0].url);
      assert.equal(file.status, 200);
      assert.equal(await file.text(), "fixture video bytes");
      const replay = await submit();
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).status, "complete");
      assert.equal(submissions, 1);
    } finally {
      if (server?.listening) await shutdown();
      await new Promise(resolve => mock.close(resolve));
    }
    console.log("PASS generation bridge · reference checks · completed task recovery · duplicate submission protection");
  } finally {
    const tempRoot = path.resolve(os.tmpdir());
    const target = path.resolve(dir);
    if (!path.basename(target).startsWith("arc-reference-kinds-") || !target.startsWith(tempRoot + path.sep)) {
      throw new Error("refusing to remove a temporary directory outside the expected test root");
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
