((root) => {
  const pinned = {
    '8578b13908b8940068301984b4c3bba5e714a7f2b4ad9629afc23a0f1a28ab1e': 'Pika H3 Flex · FL2VA 官图',
    'ae9e656deb54043a8daec5b47c065207db1b43775380cf14e43229921bb79092': 'Pika H3 Flex · Ref2VA 官图',
    '8abdc39eff08babc9c731ecd05511355030d58a9ec1e90c5f266f8ee858e2eba': 'MiniMax H3 I2V 官图',
    d5198525386fa1bfe4cf9070d020c14609d9962113b7df42bb424d8a4819c3f9: 'RelayVSR 2× 官图'
  };
  const fields = {
    UNETLoader: { unet_name: 0, weight_dtype: 1 },
    CLIPLoader: { clip_name: 0, type: 1, device: 2 },
    VAELoader: { vae_name: 0 },
    LoraLoaderModelOnly: { lora_name: 0, strength_model: 1 },
    LoraLoader: { lora_name: 0, strength_model: 1, strength_clip: 2 },
    BasicScheduler: { model: -1, scheduler: 0, steps: 1, denoise: 2 },
    BasicGuider: { model: -1, conditioning: -1 },
    KSamplerSelect: { sampler_name: 0 },
    KSampler: { seed: 0, steps: 2, cfg: 3, sampler_name: 4, scheduler: 5, denoise: 6 },
    ManualSigmas: { sigmas: 0 },
    RandomNoise: { noise_seed: 0 },
    MiniMaxH3ImageToVideo: { width: 1, height: 2, length: 3 },
    MiniMaxH3ReferenceToVideo: { width: 1, height: 2, length: 3, ref_image_size: 4 },
    SamplerCustomAdvanced: { guider: -1, sampler: -1, sigmas: -1, latent_image: -1 },
    CreateVideo: { images: -1, audio: -1, fps: 0 },
    VSRDecode: { vae: -1, samples: -1, images: -1, detail: 0 },
    RelayVSRConditioning: { model: -1, images: -1 },
    GetVideoComponents: { video: -1 },
    Subgraph: { unet_name: -1, clip_name: -1, vae_name: -1, vae_name_1: -1, lora_name: -1,
      strength_model: -1, strength_model_1: -1, sampler_name: -1, scheduler: -1, steps: -1, fps: -1,
      noise_seed: -1, seed: -1, width: -1, height: -1 },
    SaveVideo: { video: -1 },
    LoadVideo: {}
  };
  const weights = new Set(['unet_name', 'clip_name', 'vae_name', 'vae_name_1', 'lora_name']);
  const linkOnly = new Set(['model', 'conditioning', 'guider', 'sampler', 'latent_image', 'video', 'samples', 'images', 'audio', 'vae']);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safeText = value => typeof value === 'string' && value.length <= 180 && !/[\x00-\x1f]/.test(value);
  const safeFile = value => safeText(value) && !/[\\/]/.test(value) &&
    /^[\w.-]{1,170}\.(?:safetensors|gguf|ckpt|pt|pth|bin)$/i.test(value);
  const modelSetSha256 = async models => {
    const rows = models.map(item => [item.node, item.classType, item.field, item.file])
      .sort((left, right) => {
        const a = JSON.stringify(left), b = JSON.stringify(right);
        return a < b ? -1 : a > b ? 1 : 0;
      });
    const bytes = new TextEncoder().encode(JSON.stringify(rows));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  };
  const link = value => Array.isArray(value) && value.length === 2 &&
    /^\d+(?::\d+)*$/.test(String(value[0])) && Number.isInteger(value[1]) && value[1] >= 0;
  const nodeId = value => /^\d+(?::\d+)*$/.test(String(value));
  const frameInput = { GetVideoComponents: 'video', SaveVideo: 'video', CreateVideo: 'images',
    VAEDecode: 'samples', VAEDecodeTiled: 'samples', SamplerCustomAdvanced: 'latent_image',
    KSampler: 'latent_image', KSamplerAdvanced: 'latent_image', ImageScale: 'image',
    ImageScaleBy: 'image', VideoSlice: 'video', 'Video Slice': 'video', VSRDecode: 'images' };

  function traceRelay(nodes, scope, typeOf, upstream, inactive, find = id => nodes.get(id)) {
    const results = [];
    for (const [id, node] of nodes) {
      if (typeOf(node) !== 'RelayVSRConditioning' || inactive(node)) continue;
      const path = [{ node: id, type: 'RelayVSRConditioning' }];
      const seen = new Set([id]);
      let source = upstream(node, 'images', id);
      let status = 'unresolved';
      while (source !== undefined && !seen.has(source) && path.length < 64) {
        const parent = find(source);
        if (!parent || inactive(parent)) break;
        seen.add(source);
        const type = typeOf(parent);
        if (typeof type !== 'string' || !/^[\w -]{1,100}$/.test(type)) break;
        const boundary = source.startsWith('parent:');
        path.push({ node: boundary ? source.slice(7) : source, type, ...(boundary ? { scope: '主图' } : {}) });
        if (type === 'LoadVideo') { status = 'file-input'; break; }
        if (type === 'MiniMaxH3ImageToVideo' || type === 'MiniMaxH3ReferenceToVideo') {
          status = 'h3-frame-path';
          break;
        }
        if (!Object.hasOwn(frameInput, type)) break;
        source = upstream(parent, frameInput[type], source);
      }
      results.push({ scope, status, path });
    }
    return results;
  }

  function editorGraph(graph) {
    const nodes = new Map((graph.nodes || []).filter(node => nodeId(node?.id)).map(node => [String(node.id), node]));
    const links = new Map();
    for (const item of Array.isArray(graph.links) ? graph.links : []) {
      const id = Array.isArray(item) ? item[0] : item?.id;
      const source = Array.isArray(item) ? item[1] : item?.origin_id;
      const output = Array.isArray(item) ? item[2] : item?.origin_slot;
      const target = Array.isArray(item) ? item[3] : item?.target_id;
      const slot = Array.isArray(item) ? item[4] : item?.target_slot;
      if (Number.isInteger(id) && (nodeId(source) || source === graph.inputNode?.id) && nodeId(target)) {
        links.set(id, { id, source: String(source), output, target: String(target), slot });
      }
    }
    const edge = (node, field) => {
      const index = Array.isArray(node.inputs) ? node.inputs.findIndex(item => item?.name === field) : -1;
      const info = links.get(node.inputs?.[index]?.link);
      return info?.target === String(node.id) && info.slot === index ? info : undefined;
    };
    const relays = [...nodes].filter(([, node]) => node.type === 'RelayVSRConditioning');
    return { nodes, edge, relays };
  }

  const editorInactive = node => node.mode === 2 || node.mode === 4;

  function editorTrace(graph, local, scope, parent, instance) {
    return traceRelay(local.relays, scope, node => node.type, (node, field, id) => {
      if (id.startsWith('parent:')) {
        const edge = parent.edge(node, field);
        return edge && `parent:${edge.source}`;
      }
      const edge = local.edge(node, field);
      if (!edge || edge.source !== String(graph.inputNode?.id)) return edge?.source;
      const port = graph.inputs?.[edge.output];
      if (!instance || typeof port?.name !== 'string' || !Array.isArray(port.linkIds) || !port.linkIds.includes(edge.id)) return;
      const external = parent.edge(instance, port.name);
      return external && `parent:${external.source}`;
    }, editorInactive, id => id.startsWith('parent:') ? parent?.nodes.get(id.slice(7)) : local.nodes.get(id));
  }

  const traceLabels = {
    'file-input': 'RelayVSR 的画面来自 LoadVideo。裁片由哪个模型生成需另核对。',
    'h3-frame-path': '已追踪到从 H3 到 RelayVSR 的画面连线。',
    unresolved: '这条超分的画面来源还需核对子图、节点或线缆。'
  };

  function literal(field, value) {
    if (weights.has(field)) {
      const name = typeof value === 'string' ? value.split(/[\\/]/).at(-1) : '';
      return /^[\w.-]{1,170}\.(?:safetensors|gguf|ckpt|pt|pth|bin)$/i.test(name) ? name : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || value.length > 170) return undefined;
    if (field === 'sigmas') return /^\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*$/.test(value) ? value : undefined;
    return /^[a-zA-Z0-9_-]+$/.test(value) ? value : undefined;
  }

  async function compareModelManifest(workflowReport, value) {
    const fail = reason => ({ status: 'mismatch', reason, runtimeLoadedVerified: false });
    if (!object(workflowReport) || workflowReport.format !== 'api' || !/^[a-f0-9]{64}$/.test(workflowReport.sha256 || '')) {
      return fail('需要先选择 API 工作流 JSON。');
    }
    const legacyV1 = value?.schema === undefined || value?.schema === 'arc-comfy-model-files-v1';
    const isV3 = value?.schema === 'arc-comfy-model-files-v3';
    if (!object(value) || !legacyV1 && value.schema !== 'arc-comfy-model-files-v2' && !isV3 ||
        value.evidence !== 'workflow-requested-files-present-and-hashed' || value.runtimeLoadedVerified !== false ||
        !/^[a-f0-9]{64}$/.test(value.workflowSha256 || '') || !Array.isArray(value.models) ||
        !value.models.length || value.models.length > 256 ||
        (isV3 && (!/^[a-f0-9]{64}$/.test(value.providerFingerprint || '') ||
          value.providerBinding !== 'operator-supplied-endpoint-fingerprint'))) return fail('模型文件清单格式无效。');
    if (legacyV1 && value.workflowSha256 !== workflowReport.sha256) {
      return fail('工作流 SHA-256 与模型文件清单不一致。');
    }
    const expected = workflowReport.entries.flatMap(entry => entry.fields.filter(field =>
      weights.has(field.key) && typeof field.value === 'string' &&
      /^[\w.-]{1,170}\.(?:safetensors|gguf|ckpt|pt|bin)$/i.test(field.value)).map(field => ({
        node: entry.node, classType: entry.type, field: field.key, file: field.value.split(/[\\/]/).at(-1)
      })));
    const actual = value.models.map(item => {
      if (!object(item) || !safeText(item.node) || !safeText(item.classType) || !safeText(item.field) ||
          !safeFile(item.file) || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 ||
          !/^[a-f0-9]{64}$/.test(item.sha256 || '')) return null;
      return { node: item.node, classType: item.classType, field: item.field, file: item.file,
        sizeBytes: item.sizeBytes, sha256: item.sha256 };
    });
    if (!expected.length || actual.some(item => !item)) return fail('模型节点无法和清单安全对应。');
    const identity = item => JSON.stringify([item.node, item.classType, item.field, item.file]);
    const expectedKeys = expected.map(identity).sort();
    const actualKeys = actual.map(identity).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) return fail('清单模型节点或文件名与 API 工作流不一致。');
    if (!legacyV1 &&
        (!/^[a-f0-9]{64}$/.test(value.modelSetSha256 || '') || value.modelSetSha256 !== await modelSetSha256(actual))) {
      return fail('模型文件集合 SHA-256 与清单明细不一致。');
    }
    return { schema: legacyV1 ? 'arc-comfy-model-files-v1' : value.schema,
      status: 'file-bytes-matched-runtime-unverified',
      evidence: 'workflow-requested-files-present-and-hashed', workflowSha256: value.workflowSha256,
      ...(!legacyV1 ? { modelSetSha256: value.modelSetSha256 } : {}),
      ...(isV3 ? { providerFingerprint: value.providerFingerprint } : {}),
      ...(isV3 ? { providerBinding: value.providerBinding } : {}),
      runtimeLoadedVerified: false, models: actual };
  }

  function modelFilesMatch(expected, evidence) {
    if (!Array.isArray(expected) || !expected.length || !Array.isArray(evidence?.models) || !evidence.models.length) return false;
    const key = (node, type, file) => JSON.stringify([String(node), String(type), String(file)]);
    const expectedKeys = expected.map(item => item && key(item.node, item.classType || item.type, item.file)).sort();
    const actualKeys = evidence.models.map(item => item && key(item.node, item.classType, item.file)).sort();
    return expectedKeys.every(value => typeof value === 'string') && actualKeys.every(value => typeof value === 'string') &&
      JSON.stringify(expectedKeys) === JSON.stringify(actualKeys);
  }

  function audit(body, digest) {
    if (!object(body)) throw new Error('请选择 ComfyUI 工作流 JSON。');
    const editor = Array.isArray(body.nodes);
    if (editor && !body.nodes.length) throw new Error('编辑器图中没有主图节点。');
    const graph = object(body.prompt) ? body.prompt : body;
    if (!editor && (!Object.keys(graph).length || !Object.entries(graph).every(([id, node]) =>
      nodeId(id) && typeof node?.class_type === 'string' && object(node.inputs)))) {
      throw new Error('无法识别 ComfyUI 编辑器图或 API 图。');
    }
    const entries = [];
    const subgraphs = editor && Array.isArray(body.definitions?.subgraphs) ? body.definitions.subgraphs : [];
    const subgraphIds = new Set(subgraphs.map(group => group?.id).filter(id => typeof id === 'string'));
    let skipped = 0, total = 0;
    function visit(node, scope, id) {
      total++;
      if (total > 10000) throw new Error('工作流节点过多。');
      const kind = editor ? node?.type : node.class_type;
      const type = editor && subgraphIds.has(kind) ? 'Subgraph' : kind;
      if (!nodeId(id) || !Object.hasOwn(fields, type)) { skipped++; return; }
      const items = Object.entries(fields[type]).flatMap(([key, position]) => {
        const edge = editor && Array.isArray(node.inputs) ? node.inputs.find(input => input?.name === key)?.link : undefined;
        const connected = editor ? edge != null : link(node.inputs[key]);
        const raw = editor ? node.widgets_values_named?.[key] ?? node.widgets_values?.[position] : node.inputs[key];
        const value = linkOnly.has(key) ? undefined : literal(key, raw);
        if (connected) return [{ key, source: '连线决定',
          ...(editor ? (Number.isInteger(edge) && edge >= 0 ? { linkId: edge } : {}) :
            { upstream: { node: String(node.inputs[key][0]), output: node.inputs[key][1] } }),
          ...(value === undefined ? {} : { panelDefault: value }) }];
        return value === undefined ? [] : [{ key, value, source: editor ? '保存的面板值' : 'API 直接输入' }];
      });
      entries.push({ scope, node: String(id), type,
        ...(editor && (node.mode === 2 || node.mode === 4) ? { inactive: true } : {}), fields: items });
    }
    let relayInputs;
    let relayInputsTruncated = false;
    if (editor) {
      body.nodes.forEach(node => visit(node, '主图', node?.id));
      const main = editorGraph(body);
      relayInputs = editorTrace(body, main, '主图');
      const activeInstances = new Map();
      for (const node of main.nodes.values()) {
        if (!subgraphIds.has(node.type) || editorInactive(node)) continue;
        if (!activeInstances.has(node.type)) activeInstances.set(node.type, []);
        activeInstances.get(node.type).push(node);
      }
      subgraphs.forEach((group, index) => {
        if (Array.isArray(group?.nodes)) {
          const scope = `子图定义 ${index + 1}`;
          group.nodes.forEach(node => visit(node, scope, node?.id));
          const instances = activeInstances.get(group.id) || [];
          const local = editorGraph(group);
          for (const instance of instances) {
            if (!local.relays.length) break;
            if (relayInputs.length >= 512) { relayInputsTruncated = true; break; }
            addRelayPaths(editorTrace(group, local, `主图子图实例 #${instance.id}`, main, instance));
          }
          if (!instances.length) addRelayPaths(editorTrace(group, local, scope));
        }
      });
    } else {
      Object.entries(graph).forEach(([id, node]) => visit(node, 'API 图', id));
      relayInputs = traceRelay(new Map(Object.entries(graph)), 'API 图', node => node.class_type,
        (node, field) => link(node.inputs[field]) ? String(node.inputs[field][0]) : undefined, () => false);
    }
    return { schema: 'arc-workflow-audit-v1', sha256: digest ?? null,
      format: editor ? 'editor' : 'api', pinnedSource: pinned[digest] || null, total, skipped, entries, relayInputs,
      ...(relayInputsTruncated ? { relayInputsTruncated: true } : {}) };

    function addRelayPaths(paths) {
      const available = 512 - relayInputs.length;
      relayInputs.push(...paths.slice(0, available));
      if (paths.length > available) relayInputsTruncated = true;
    }
  }

  function mount(panel, download, attachEvidence = () => false) {
    const input = panel.querySelector('[data-workflow]');
    const manifestInput = panel.querySelector('[data-model-manifest]');
    const status = panel.querySelector('output');
    const manifestStatus = panel.querySelector('[data-model-status]');
    const manifestRows = panel.querySelector('[data-model-rows]');
    const rows = panel.querySelector('ul');
    const button = panel.querySelector('[data-download-workflow-report]');
    const saveEvidence = panel.querySelector('[data-save-model-evidence]');
    let current, sequence = 0;
    input.onchange = async () => {
      const token = ++sequence;
      current = null;
      saveEvidence.disabled = true;
      manifestInput.value = '';
      manifestStatus.textContent = '';
      manifestRows.replaceChildren();
      button.disabled = true;
      rows.replaceChildren();
      status.textContent = '';
      const file = input.files[0];
      if (!file) return;
      try {
        if (!file.size || file.size > 2 * 1024 ** 2) throw new Error('请选择 2 MiB 以内的非空 JSON。');
        const bytes = await file.arrayBuffer();
        const sha = root.crypto?.subtle ? await root.crypto.subtle.digest('SHA-256', bytes) : null;
        const digest = sha && [...new Uint8Array(sha)].map(value => value.toString(16).padStart(2, '0')).join('');
        const report = audit(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), digest);
        if (token !== sequence) return;
        current = report;
        button.disabled = false;
        status.textContent = [report.format === 'api' ? 'API 图' : '编辑器图', report.pinnedSource || '未匹配已登记官图',
          `${report.entries.length} 个可列节点，${report.skipped} 个其它节点`,
          ...(report.relayInputsTruncated ? ['画面来源仅列出前 512 条。'] : []),
          report.format === 'editor' ? '支持追踪主图及一层子图的外部输入。' : '连线字段需查看上游节点。'].join(' · ');
        for (const trace of report.relayInputs.slice(0, 8)) {
          const row = document.createElement('li');
          row.textContent = trace.scope + ' · ' + traceLabels[trace.status] + ' · ' +
            trace.path.map(item => `${item.scope ? item.scope + ' ' : ''}${item.type} #${item.node}`).join(' ← ');
          rows.append(row);
        }
        for (const item of report.entries.slice(0, 36)) {
          const row = document.createElement('li');
          row.textContent = [item.scope, item.node, item.type, item.inactive ? '停用或旁路' : '',
            ...item.fields.map(field => `${field.key} ${field.value ?? field.source}` +
              (field.upstream ? `（节点 ${field.upstream.node} 输出 ${field.upstream.output}）` :
                field.linkId !== undefined ? `（连线 ${field.linkId}）` : '') +
              (field.panelDefault === undefined ? '' : `（面板默认 ${field.panelDefault}）`))].filter(Boolean).join(' · ');
          rows.append(row);
        }
        if (report.entries.length > 36) {
          const row = document.createElement('li');
          row.textContent = '其余节点可见下载的报告。';
          rows.append(row);
        }
      } catch (error) {
        if (token === sequence) status.textContent = error instanceof SyntaxError ? 'JSON 语法有误。' : error.message;
      }
    };
    manifestInput.onchange = async () => {
      if (current) delete current.modelFileEvidence;
      saveEvidence.disabled = true;
      manifestRows.replaceChildren();
      const file = manifestInput.files[0];
      if (!file) { manifestStatus.textContent = ''; return; }
      try {
        if (!file.size || file.size > 512 * 1024) throw new Error('请选择 512 KiB 以内的非空模型文件清单。');
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
        const evidence = await compareModelManifest(current, value);
        if (evidence.status !== 'file-bytes-matched-runtime-unverified') throw new Error(evidence.reason);
        current.modelFileEvidence = evidence;
        saveEvidence.disabled = false;
        manifestStatus.textContent = `${evidence.models.length} 个声明模型文件与工作流匹配 · ` +
          (evidence.schema === 'arc-comfy-model-files-v3' ? '端点指纹由操作员提供并匹配（非远端签名证明）' :
            '旧清单未绑定服务端点，不计入 A/B 权重证据') + ' · 运行时实际加载仍未验证';
        const row = document.createElement('li');
        row.textContent = evidence.models.map(item => `${item.node} ${item.classType}.${item.field} · ${item.file} · ${item.sizeBytes} 字节 · SHA-256 ${item.sha256}`).join('；');
        manifestRows.append(row);
      } catch (error) { manifestStatus.textContent = error instanceof SyntaxError ? '模型文件清单 JSON 语法有误。' : error.message; }
    };
    saveEvidence.onclick = () => {
      if (!current?.modelFileEvidence) return;
      const saved = attachEvidence(current.modelFileEvidence);
      manifestStatus.textContent = saved ? '已保存到当前项目。文件哈希覆盖清单生成机器上的声明文件；A/B 只接收操作员绑定且指纹匹配的 v3 清单，未获远端签名或运行时加载证明。' :
        '保存失败，当前项目未改变。';
    };
    button.onclick = () => { if (current) download('ComfyUI工作流核对.json', current); };
  }

  if (typeof module === 'object' && module.exports) module.exports = { audit, compareModelManifest, modelFilesMatch, modelSetSha256 };
  else root.arcWorkflowAudit = { mount, modelFilesMatch };
})(globalThis);
