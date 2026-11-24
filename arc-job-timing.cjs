"use strict";

const timestamp = value => Number.isSafeInteger(value) && value > 0 ? value : undefined;
const duration = (start, end) => start !== undefined && end !== undefined && end >= start ? end - start : undefined;
const terminal = new Set(["execution_success", "execution_error", "execution_interrupted"]);

function metadata(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 6).flatMap(item => item && typeof item.label === "string" && typeof item.value === "string" ?
    [{ label: item.label.slice(0, 60), value: item.value.slice(0, 60) }] : []);
}

function timing(job, entry, now) {
  const timeline = { bridgeMs: duration(job.acceptedAt, job.firstTerminalSeenAt ?? now),
    bridgeSource: "local-bridge-observation" };
  if (!entry) return { ...timeline, queueSource: null, executionSource: null, gpuKernelTime: false };
  const events = entry.status?.messages;
  let begun, ended;
  if (Array.isArray(events)) {
    for (const event of events) {
      if (!Array.isArray(event) || event[1]?.prompt_id !== job.peerId) continue;
      const time = timestamp(event[1].timestamp);
      if (time === undefined) continue;
      if (event[0] === "execution_start") begun = time;
      else if (terminal.has(event[0])) ended = time;
    }
  }
  const created = entry.prompt?.[1] === job.peerId ? timestamp(entry.prompt[3]?.create_time) : undefined;
  return { ...timeline, queueMs: duration(created, begun), executionMs: duration(begun, ended),
    queueSource: created !== undefined && begun !== undefined ? "comfy-history-timestamps" : null,
    executionSource: begun !== undefined && ended !== undefined ? "comfy-history-timestamps" : null,
    gpuKernelTime: false };
}

module.exports = { metadata, timestamp, timing };
