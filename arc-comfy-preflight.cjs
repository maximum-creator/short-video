"use strict";

const crypto = require("node:crypto");

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const targetKey = (node, field) => JSON.stringify([node, field]);
const describeValue = value => typeof value === "string" ? value.replace(/\s+/g, " ").slice(0, 100) : String(value);
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]` :
  object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}` :
    JSON.stringify(value);
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function checkLiteral(value, definition) {
  if (!Array.isArray(definition)) return "";
  const [type, options] = definition;
  const choices = Array.isArray(type) ? type : type === "COMBO" && Array.isArray(options?.options) ? options.options : null;
  if (choices && choices.every(item => ["string", "number", "boolean"].includes(typeof item)) &&
      ["string", "number", "boolean"].includes(typeof value) && !choices.includes(value)) {
    return `服务端选项中没有「${describeValue(value)}」。`;
  }
  if ((type === "INT" || type === "FLOAT") && typeof value === "number") {
    if (type === "INT" && !Number.isInteger(value)) return "该输入要求整数。";
    if ((Number.isFinite(options?.min) && value < options.min) || (Number.isFinite(options?.max) && value > options.max)) {
      return `数值 ${value} 超出节点公布的范围。`;
    }
    if (Number.isFinite(options?.step) && options.step > 0 && Number.isFinite(options?.min)) {
      const steps = (value - options.min) / options.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-6) return `数值 ${value} 不符合节点公布的步长。`;
    }
  }
  return "";
}

async function inspect(config, query) {
  const graph = config.template;
  const nodes = Object.entries(graph);
  const classes = [...new Set(nodes.map(([, node]) => node.class_type))];
  const schemas = new Map();
  const signal = AbortSignal.timeout(15000);
  let next = 0;
  async function readClasses() {
    while (next < classes.length && !signal.aborted) {
      const name = classes[next++];
      if (!name || name.length > 160 || [".", ".."].includes(name) || /[\u0000-\u001f\u007f/\\]/.test(name)) continue;
      try {
        const result = await query("/object_info/" + encodeURIComponent(name), { signal });
        if (object(result) && !Object.keys(result).length) schemas.set(name, null);
        else if (object(result) && Object.hasOwn(result, name) && object(result[name]?.input)) schemas.set(name, result[name]);
      } catch { /* Unreachable or incompatible metadata is reported as unverified. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(classes.length, 4) }, readClasses));

  const overwritten = new Set([config.prompt, ...config.references.map(item => item.target)].map(([node, field]) => targetKey(node, field)));
  const presets = new Map();
  for (const group of config.controls) {
    group.targets.forEach(([node, field], index) => {
      presets.set(targetKey(node, field), group.options.map(option => ({ label: group.label + ' · ' + option.label, value: option.values[index] })));
    });
  }
  const findings = [];
  const parameterControls = [];
  const report = (kind, node, field, message) => findings.push({ kind, node, field, message });
  const hostedMinimaxNode = type => /^MinimaxHailuo03/.test(type);
  const seenClasses = new Set();
  for (const [id, node] of nodes) {
    if (typeof node.class_type === "string" && hostedMinimaxNode(node.class_type)) {
      report("issue", id, "", "这是 MiniMax 托管 API 节点；生成会发送到供应商服务并可能产生按量费用，不是本地 H3 INT8 推理。为避免误用计费接口，工作台已阻止提交。请改用本地 UNETLoader + MiniMaxH3ReferenceToVideo 工作流。");
    }
    const schema = schemas.get(node.class_type);
    if (!schema && !seenClasses.has(node.class_type)) {
      report(schema === null ? "issue" : "unverified", id, "",
        schema === null ? `服务端没有节点「${node.class_type}」。` : `未能核对节点「${node.class_type}」。`);
      seenClasses.add(node.class_type);
    }
    const required = object(schema?.input.required) ? schema.input.required : {};
    const optional = object(schema?.input.optional) ? schema.input.optional : {};
    const declared = { ...optional, ...required };
    if (/seedvr2/i.test(node.class_type) && Object.hasOwn(node.inputs, "denoise")) {
      const definition = declared.denoise;
      if (Array.isArray(definition) && ["FLOAT", "INT"].includes(definition[0]) && Number.isFinite(node.inputs.denoise)) {
        const bounds = object(definition[1]) ? definition[1] : {};
        parameterControls.push({ node: id, field: "denoise", type: definition[0], value: node.inputs.denoise,
          min: Number.isFinite(bounds.min) ? bounds.min : null, max: Number.isFinite(bounds.max) ? bounds.max : null,
          step: Number.isFinite(bounds.step) && bounds.step > 0 ? bounds.step : null });
      }
    }
    for (const field of Object.keys(required)) {
      if (!Object.hasOwn(node.inputs, field)) report("issue", id, field, "模板缺少节点公开的必填输入。");
    }
    for (const [field, value] of Object.entries(node.inputs)) {
      const key = targetKey(id, field);
      const definition = Object.hasOwn(declared, field) ? declared[field] : undefined;
      const options = presets.get(key);
      if ((overwritten.has(key) || options) && schema && definition === undefined) {
        report("unverified", id, field, "工作台绑定的输入未出现在服务端节点定义中。");
      }
      if (overwritten.has(key) && Array.isArray(definition) && ["INT", "FLOAT", "BOOLEAN"].includes(definition[0])) {
        report("issue", id, field, "该输入是数值或布尔值，不能接收提示词或上传后的文件名。");
      }
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1])) {
        const parent = Object.hasOwn(graph, value[0]) ? graph[value[0]] : null;
        const parentSchema = parent && schemas.get(parent.class_type);
        const slots = parentSchema?.output;
        if (!parent || value[1] < 0 || (Array.isArray(slots) && value[1] >= slots.length)) {
          report("issue", id, field, "连线引用的上游节点或输出不存在。");
        } else if (schema && parentSchema) {
          const sourceType = Array.isArray(slots) ? slots[value[1]] : null;
          const targetType = definition?.[0];
          const sourceTypes = typeof sourceType === "string" ? [sourceType] :
            Array.isArray(sourceType) ? sourceType.filter(item => typeof item === "string") : [];
          const targetTypes = typeof targetType === "string" ? [targetType] :
            Array.isArray(targetType) ? targetType.filter(item => typeof item === "string") : [];
          if (!sourceTypes.length || !targetTypes.length || sourceTypes.includes("*") || targetTypes.includes("*")) {
            report("unverified", id, field, "节点类型定义不支持静态连线兼容性判断。");
          } else if (!sourceTypes.some(sourceName => targetTypes.includes(sourceName))) {
            report("issue", id, field, `连线类型不匹配：上游 ${sourceTypes.join("/")} → 下游 ${targetTypes.join("/")}。`);
          }
        }
        continue;
      }
      if (overwritten.has(key) || !definition) continue;
      if (options) {
        for (const option of options) {
          const issue = checkLiteral(option.value, definition);
          if (issue) report("issue", id, field, `${option.label}：${issue}`);
        }
      } else {
        const issue = checkLiteral(value, definition);
        if (issue) report("issue", id, field, issue);
      }
    }
  }
  const schemaSet = classes.slice().sort().map(className => {
    if (!schemas.has(className)) return { className, status: "unreachable" };
    const schema = schemas.get(className);
    return schema ? { className, status: "verified", schemaSha256: sha256(canonicalJson(schema)) } :
      { className, status: "missing-node" };
  });
  return { nodes: nodes.length, classes: classes.length, verified: [...schemas.values()].filter(Boolean).length,
    schemaSha256: sha256(canonicalJson(schemaSet)),
    issues: findings.filter(item => item.kind === "issue").length,
    unverified: findings.filter(item => item.kind === "unverified").length, findings: findings.slice(0, 80),
    parameterControls: parameterControls.length <= 8 ? parameterControls : [] };
}

module.exports = { inspect };
