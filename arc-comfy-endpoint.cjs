"use strict";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

function endpoint(input, bridgePort, credential) {
  let url;
  try { url = new URL(input); }
  catch { throw new Error("请填写有效的 ComfyUI 服务地址。"); }
  if (/\s|[?#\\]/.test(input) || url.username || url.password ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.has(url.hostname))) ||
      !/^\/(?:[a-zA-Z0-9._~-]+\/)*[a-zA-Z0-9._~-]*$/.test(url.pathname)) {
    throw new Error("远端 ComfyUI 请使用 HTTPS 服务地址。本机转发可使用回环 HTTP。地址请勿包含凭据、查询参数或片段。");
  }
  if (loopback.has(url.hostname) && Number(url.port || (url.protocol === "https:" ? 443 : 80)) === bridgePort) {
    throw new Error("ComfyUI 地址不能指向工作台本身。");
  }
  if (credential !== undefined && url.protocol === "https:" && !/^[a-zA-Z0-9._~+/=-]{1,4096}$/.test(credential)) {
    throw new Error("ARC_COMFY_BEARER_TOKEN 的格式无效。");
  }
  return { base: url.origin + url.pathname.replace(/\/$/, ""), host: url.host,
    transport: url.protocol === "https:" ? "https" : "loopback", credential: url.protocol === "https:" ? credential : undefined };
}

module.exports = { endpoint };
