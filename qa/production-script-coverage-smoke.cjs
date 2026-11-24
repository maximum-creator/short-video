"use strict";

const assert = require("node:assert/strict");
global.window = {};
require("../production-overview.js");

const coverage = window.arcOverview.scriptCoverage({
  pages: {
    story: "角色A推开门。她看见桌上的旧照片！",
    dialogue: "‘你终于来了。’\n（电话挂断）"
  },
  shots: [
    { scriptAnchor: "角色A推开门。" },
    { scriptAnchor: "她看见桌上的旧照片！" },
    { scriptAnchor: "‘你终于来了。’" }
  ]
});

assert.deepEqual(coverage.rows.map(row => [row.text, row.linked, row.status]), [
  ["角色A推开门。", ["S01"], "已关联"],
  ["她看见桌上的旧照片！", ["S02"], "已关联"],
  ["‘你终于来了。’", ["S03"], "已关联"],
  ["（电话挂断）", [], "待核对"]
]);
assert.equal(coverage.linked, 3);
assert.equal(coverage.pending, 1);
assert.deepEqual(window.arcOverview.scriptCoverage({ pages: {}, shots: [] }),
  { rows: [], linked: 0, pending: 0 });
console.log("PASS script coverage · exact source units map to shot anchors and unlinked dialogue remains reviewable");
