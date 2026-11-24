"use strict";

const crypto = require("node:crypto");
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
const label = value => typeof value === "string" && value.trim() && value.length <= 60;

function configure(raw, template) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 6) throw new Error("工作流参数需有 1 至 6 组。");
  const ids = new Set();
  return raw.map(group => {
    if (!plain(group) || !id(group.id) || ids.has(group.id) || !label(group.label) ||
        !Array.isArray(group.targets) || !group.targets.length || group.targets.length > 6 ||
        !Array.isArray(group.options) || !group.options.length || group.options.length > 24) {
      throw new Error("工作流参数分组无效或编号重复。");
    }
    ids.add(group.id);
    const targets = group.targets.map(target => {
      if (!plain(target) || typeof target.node !== "string" || !/^\d+(?::\d+)*$/.test(target.node) ||
          typeof target.input !== "string" || !/^[a-zA-Z0-9_]+$/.test(target.input) ||
          !Object.hasOwn(template, target.node) || !Object.hasOwn(template[target.node].inputs, target.input)) {
        throw new Error("工作流参数目标节点或输入不存在。");
      }
      return [target.node, target.input];
    });
    const original = targets.map(([node, input]) => template[node].inputs[input]);
    const optionIds = new Set();
    const optionValues = new Set();
    const options = group.options.map(option => {
      if (!plain(option) || !id(option.id) || optionIds.has(option.id) || !label(option.label) ||
          !Array.isArray(option.values) || option.values.length !== targets.length ||
          option.values.some((value, index) => typeof value !== typeof original[index] ||
            (typeof value === "number" ? !Number.isFinite(value) :
              typeof value === "string" ? value.length > 180 : typeof value !== "boolean")) ||
          (option.seconds !== undefined && (group.id !== "duration" || !Number.isFinite(option.seconds) ||
            option.seconds <= 0 || option.seconds > 120))) throw new Error("工作流参数选项、类型或时长无效。");
      const valuesKey = JSON.stringify(option.values);
      if (optionValues.has(valuesKey)) throw new Error("工作流参数不能有相同的选项值。");
      optionIds.add(option.id);
      optionValues.add(valuesKey);
      return { id: option.id, label: option.label.trim(), values: option.values, seconds: option.seconds };
    });
    const defaultOption = options.find(option => option.values.every((value, index) => value === original[index]));
    if (!defaultOption) throw new Error(`参数 ${group.id} 的选项必须包含模板原值。`);
    return { id: group.id, label: group.label.trim(), targets, options, defaultId: defaultOption.id };
  });
}

function describe(groups) {
  const profile = groups.length ? crypto.createHash("sha256").update(JSON.stringify(groups)).digest("hex") : null;
  const controls = groups.map(({ id, label, options, defaultId }) => ({
    id, label, defaultId, options: options.map(({ id, label, seconds, values }) => ({ id, label, seconds, values }))
  }));
  return { profile, controls };
}

function select(groups, profile, requested, expectedProfile) {
  if (requested == null) return groups.map(group => [group, group.options.find(option => option.id === group.defaultId)]);
  if (!plain(requested) || (groups.length && profile !== expectedProfile) ||
      Object.keys(requested).some(id => !groups.some(group => group.id === id))) {
    throw new Error("工作流参数配置已变更或包含未知项目，请刷新工作台。");
  }
  return groups.map(group => {
    const optionId = Object.hasOwn(requested, group.id) ? requested[group.id] : group.defaultId;
    const option = group.options.find(item => item.id === optionId);
    if (!option) throw new Error(`「${group.label}」的选项不可用。`);
    return [group, option];
  });
}

function apply(workflow, selected) {
  for (const [group, option] of selected) group.targets.forEach(([node, input], index) => {
    workflow[node].inputs[input] = option.values[index];
  });
}

module.exports = { configure, describe, select, apply };
