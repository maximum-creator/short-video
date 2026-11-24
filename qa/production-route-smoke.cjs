"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const route = require("../production-route.js");

assert.equal(route.steps.length, 11, "the main workflow must cover script, video, and editing stages");
assert.deepEqual(route.state("script", "script").previous, null);
assert.equal(route.state("script", "script").next.title, "连续性与规则");
assert.equal(route.state("script", "canon").next.workspace, "video");
assert.equal(route.state("video", "generation").next.title, "逐镜审片");
assert.equal(route.state("video", "review").next.workspace, "edit");
assert.equal(route.state("edit", "finish").next, null);
assert.equal(route.state("video", "assistant"), null, "optional assistants are not required workflow stages");
const rows = [
  { index: 0, id: "E01-S01", ready: true, next: { workspace: "video", tab: "review", index: 0 } },
  { index: 1, id: "E01-S02", ready: false, action: "审片", label: "待审片", reason: "候选尚未通过",
    next: { workspace: "video", tab: "review", index: 1 } },
  { index: 2, id: "E01-S03", ready: false, action: "生成", label: "待生成", reason: "分镜已填写",
    next: { workspace: "video", tab: "generation", index: 2 } }
];
assert.equal(route.reviewAction(rows, 0).row.id, "E01-S02", "review continuation finds the next unresolved shot");
assert.equal(route.reviewAction(rows, 1).row.id, "E01-S03", "review continuation advances in shot order");
assert.equal(route.reviewAction(rows, 2).row.id, "E01-S02", "review continuation wraps to earlier unresolved shots");
assert.equal(route.reviewAction([rows[2], { ...rows[0], ready: false }, rows[1]], 2).row.id, "E01-S01",
  "review continuation follows the edited storyboard order rather than shot IDs");
assert.equal(route.reviewAction(rows.slice(0, 2), 1).type, "current-shot", "a sole unresolved current review blocks skipping to edit");
const needsBoard = [{ index: 0, id: "E01-S01", ready: false, action: "核对剧本对应", label: "待绑定剧本原句",
  reason: "请回分镜补填剧本原句。", next: { workspace: "video", tab: "board", index: 0 } }];
assert.equal(route.reviewAction(needsBoard, 0).type, "current-shot-action", "review can return the current shot to its required planning step");
assert.equal(route.reviewAction(needsBoard, 0).target.tab, "board");
assert.equal(route.reviewAction(rows.map(row => ({ ...row, ready: true })), 1).target.tab, "assembly",
  "only a fully handoff-ready episode advances to editing");
assert.equal(route.reviewAction([], 0).type, "unavailable", "empty episode state fails closed");

const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const production = fs.readFileSync(path.join(__dirname, "..", "production.js"), "utf8");
const hub = fs.readFileSync(path.join(__dirname, "..", "studio-hub.js"), "utf8");
assert.ok(index.indexOf("production-route.js") < index.indexOf("studio-hub.js"), "route contract must load before workspace navigation");
assert.match(production, /主制作流程/);
assert.match(production, /不代表内容已验收/);
assert.match(production, /arc-production-route/);
assert.match(production, /reviewAction\(episode\.rows, shotIndex\)/);
assert.match(production, /先完成本镜审片，再继续本集/);
assert.match(hub, /addEventListener\('arc-production-route'/);
console.log("PASS cross-studio route · next/previous stages · optional assistant separation · review boundary");
