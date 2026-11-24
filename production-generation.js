(() => {
  const motionActions = typeof module === 'object' && module.exports ?
    require('./production-actions.js') : window.arcMotionActions;
  const statusLabels = {
    submitting: '提交中', queued: '等待生成', running: '生成中',
    awaiting: '等待 ComfyUI 更新状态', failed: '任务失败',
    unconfirmed: '提交结果未确认，请先在 ComfyUI 检查队列',
    no_video: '工作流已完成，未找到可导入的视频', complete: '已返回视频'
  };
  const busy = new Set(['submitting', 'queued', 'running', 'awaiting', 'unconfirmed', 'unavailable']);
  const sessionMedia = new WeakMap();
  const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` :
    value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}` :
      JSON.stringify(value);
  const sha256Pattern = /^[a-f0-9]{64}$/;
  const mediaInputs = {
    video: { label: '视频', accept: '.mp4,.webm,.mov', limit: 24 },
    audio: { label: '音频', accept: '.wav,.mp3,.flac,.ogg,.m4a', limit: 10 }
  };

  function draft(brief) {
    const { shot, art } = brief;
    const motion = motionActions.describe(shot.story.motionAction);
    const camera = [shot.camera.move, shot.camera.path, shot.camera.guide,
      shot.camera.framing && window.arcCamera.describe(shot.camera.framing)].filter(Boolean).join('；');
    const references = shot.references.map(item =>
      `${item.kind}「${item.name}」${item.revision}${item.notes ? `：${item.notes}` : ''}`).join('；');
    return [
      ['剧本原句', shot.story.scriptAnchor], ['镜头叙事目的', shot.story.beat],
      ['构图与人物视线', shot.story.composition], ['表演节拍与表情', shot.story.performance],
      ['选定动作', motion && `${motion.name} · ${motion.beats}`],
      ['本镜额外参考说明', shot.story.reference],
      ['随镜头生成的特效与交互光', shot.story.generationEffects],
      ['本集人物状态与规则', [brief.script?.state, brief.script?.rules].filter(Boolean).join('；')],
      ['待衔接连续性', (brief.continuity || []).filter(item => item.status?.startsWith('待')).slice(0, 8)
        .map(item => `${item.subject}·${item.field}：${item.previousEnd || item.start || '待确认'} → ${item.end || '待确认'}${item.reason ? `（${item.reason}）` : ''}`).join('；')],
      ['全剧人物身份基准', art.character], ['本镜绑定的美术参考版本', references],
      ['摄影机与运镜', camera], ['本镜灯光与连续性', shot.camera.lighting],
      ['全剧视觉风格', art.look], ['必须保持的美术限制', art.limits]
    ].filter(([, value]) => value).map(([label, value]) => `${label}：${value}`).join('\n');
  }

  function promptBasis(brief) {
    const shot = brief.shot;
    return JSON.stringify({ episode: brief.episode, script: brief.script, continuity: brief.continuity,
      ...(brief.continuityBasis ? { continuityBasis: brief.continuityBasis } : {}),
      shot: { id: shot.id, startMs: shot.startMs, endMs: shot.endMs, durationConfirmed: shot.durationConfirmed,
        ...(shot.motionFingerprint ? { motionFingerprint: shot.motionFingerprint } : {}),
        story: shot.story, camera: shot.camera, references: shot.references, keyframe: shot.keyframe }, art: brief.art });
  }
  const basisGroups = [
    ['剧本与对白', 'script', value => [value.script?.story, value.script?.dialogue]],
    ['人物状态与世界规则', 'canon', value => [value.script?.state, value.script?.rules, value.continuity, value.continuityBasis]],
    ['分镜与表演', 'board', value => [value.episode, value.shot?.id, value.shot?.story, value.shot?.motionFingerprint]],
    ['运镜、机位与灯光', 'camera', value => value.shot?.camera],
    ['参考版本与关键画面', 'board', value => [value.shot?.references, value.shot?.keyframe]],
    ['动态分镜时序', 'animatic', value => [value.shot?.startMs, value.shot?.endMs, value.shot?.durationConfirmed]],
    ['全剧美术设定', 'art', value => value.art]
  ];

  function basisParts(serialized) {
    try {
      const value = JSON.parse(serialized);
      return value?.shot && Number.isInteger(value.episode) ?
        basisGroups.map(([, , read]) => JSON.stringify(read(value)) ?? 'null') : null;
    } catch { return null; }
  }

  function basisChanges(previous, current) {
    if (!previous || !current) return [];
    return basisGroups.flatMap(([label, tab], index) => previous[index] === current[index] ? [] : [{ label, tab }]);
  }

  function promptBasisStale(record, brief) {
    return !record.generationPromptBasis || record.generationPromptBasis !== promptBasis(brief);
  }

  function resultBasisStatus(record, brief) {
    if (!record.generationJobBasis) return 'unknown';
    return record.generationJobBasis === promptBasis(brief) ? 'current' : 'changed';
  }

  async function basisDigest(basis) {
    if (!basis || !globalThis.crypto?.subtle) return '';
    const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }

  const resultBasisWarnings = {
    unknown: '这条任务没有保存提交时的镜头资料，请对照当前分镜后再采用。',
    changed: '任务提交后，剧本、连续性、分镜或参考资料有变更。请按当前镜头要求重新审片。'
  };

  function compatibleReferences(role, assets) {
    return assets.filter(asset => !role.assetKinds || role.assetKinds.includes(asset.kind));
  }

  function defaultReference(role, assets, rememberedId) {
    const compatible = compatibleReferences(role, assets);
    if (compatible.some(asset => asset.id === rememberedId)) return { id: rememberedId, automatic: false };
    return compatible.length === 1 ? { id: compatible[0].id, automatic: true } : { id: '', automatic: false };
  }

  function create(record, brief, references, actions) {
    const panel = document.createElement('section');
    panel.className = 'production-history generation-panel';
    panel.innerHTML = `
      <section class="generation-readiness" aria-label="本镜生成准备">
        <strong>本镜生成准备</strong><p data-ready-status role="status">正在读取生成配置…</p>
        <div class="production-picker" data-ready-actions hidden>
          <button type="button" data-go-missing>定位缺少的参考</button>
          <button type="button" data-go-board>回分镜补参考</button>
        </div>
      </section>
      <details class="production-history" data-ab-placeholder><summary>白模 A/B 对照</summary>
        <p>从启用了 Ref2VA 白模 A/B 的本地桥接打开工作台，即可锁定同一镜头并分别提交两版。</p></details>
      <p data-connection>正在读取本地生成配置…</p>
      <button type="button" data-copy-provider hidden>复制服务端点指纹</button>
      <div class="production-picker" data-workflow-picker hidden>
        <label>生成工作流<select data-workflow-preset></select></label>
        <a data-workflow-source target="_blank" rel="noopener noreferrer" hidden>官方参考图</a>
      </div>
      <div class="production-picker">
        <button type="button" data-test-connection disabled>测试 ComfyUI 连接</button>
        <button type="button" data-preflight disabled>预检工作流</button>
        <output data-connection-status role="status"></output>
      </div>
      <section class="generation-preflight" data-preflight-result hidden aria-label="工作流预检结果">
        <p role="status"></p><ul></ul>
        <label data-preflight-ack hidden><input type="checkbox">我已查看当前节点明细；仍继续提交这一镜</label>
      </section>
      <div data-controls class="production-metadata" hidden></div>
      <p data-duration class="production-status" hidden></p>
      <label>本镜生成提示词<textarea data-generation-prompt rows="8" maxlength="20000"></textarea></label>
      <p data-basis-status class="production-status" role="status"></p>
      <div data-basis-links class="production-picker" hidden></div>
      <label data-basis-confirm hidden><input type="checkbox">我已按当前剧本、状态、分镜和美术重新核对提示词</label>
      <div data-reference class="production-metadata" hidden></div>
      <p data-input-status class="production-status" role="status" hidden></p>
      <div class="production-picker">
        <button type="button" data-submit disabled>提交这一镜</button>
        <button type="button" data-refresh disabled>刷新状态</button>
        <button type="button" data-forget hidden>解除当前任务关联</button>
      </div>
      <output data-task-status role="status"></output>
      <div data-results></div>`;
    const prompt = panel.querySelector('[data-generation-prompt]');
    const referenceFields = panel.querySelector('[data-reference]');
    const parameterFields = panel.querySelector('[data-controls]');
    const durationNotice = panel.querySelector('[data-duration]');
    const basisStatus = panel.querySelector('[data-basis-status]');
    const basisLinks = panel.querySelector('[data-basis-links]');
    const inputStatus = panel.querySelector('[data-input-status]');
    const basisConfirm = panel.querySelector('[data-basis-confirm]');
    const basisCheckbox = basisConfirm.querySelector('input');
    const submit = panel.querySelector('[data-submit]');
    const refresh = panel.querySelector('[data-refresh]');
    const forget = panel.querySelector('[data-forget]');
    const testConnection = panel.querySelector('[data-test-connection]');
    const preflight = panel.querySelector('[data-preflight]');
    const findings = panel.querySelector('[data-preflight-result]');
    const preflightAck = findings.querySelector('[data-preflight-ack]');
    const preflightAckInput = preflightAck.querySelector('input');
    preflightAckInput.onchange = () => {
      preflightAck.dataset.confirmedKey = preflightAckInput.checked ? preflightAck.dataset.currentKey || '' : '';
    };
    const connectionStatus = panel.querySelector('[data-connection-status]');
    const message = panel.querySelector('[data-task-status]');
    const results = panel.querySelector('[data-results]');
    const connection = panel.querySelector('[data-connection]');
    const copyProvider = panel.querySelector('[data-copy-provider]');
    const readyStatus = panel.querySelector('[data-ready-status]');
    const readyActions = panel.querySelector('[data-ready-actions]');
    const goMissing = panel.querySelector('[data-go-missing]');
    panel.querySelector('[data-go-board]').onclick = () => window.dispatchEvent(new CustomEvent('arc-production-route', {
      detail: { workspace: 'video', tab: 'board', shot: Number(brief.shot.id.slice(1)) - 1 }
    }));
    const telemetry = window.arcGenerationLog.create(record, actions.save, statusLabels);
    message.after(telemetry.panel);
    const firstFrame = actions.recommendedPreset === 'pika-h3-first' ?
      window.arcProductionQuality.firstFrameComparison(record, actions.save) : null;
    if (firstFrame) results.after(firstFrame.panel);
    let config, active = true, timer, checking = false, checkingPreflight = false, pollFailures = 0, ab;
    let jobState = record.generationId ? 'awaiting' : '';
    let presetId = '';
    const workflowPicker = panel.querySelector('[data-workflow-picker]');
    const workflowSelect = panel.querySelector('[data-workflow-preset]');
    const savedPrompt = typeof record.generationPrompt === 'string' && record.generationPrompt.trim();
    prompt.value = record.generationPrompt ?? draft(brief);
    if (!savedPrompt && !record.generationPromptBasis) record.generationPromptBasis = promptBasis(brief);
    const currentBasis = () => promptBasis(brief);
    const currentParts = basisParts(currentBasis());
    function renderBasisLinks(container, changes) {
      container.hidden = !changes.length;
      container.replaceChildren(...changes.map(({ label, tab }) => {
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = '核对' + label;
        link.onclick = () => window.dispatchEvent(new CustomEvent('arc-production-route', {
          detail: { workspace: ['script', 'canon'].includes(tab) ? 'script' : 'video', tab, shot: Number(brief.shot.id.slice(1)) - 1 }
        }));
        return link;
      }));
    }
    function updateBasisStatus() {
      const stale = promptBasisStale(record, brief);
      const changes = stale ? basisChanges(basisParts(record.generationPromptBasis), currentParts) : [];
      const changed = changes.map(({ label }) => label).join('、');
      basisStatus.textContent = stale ? (changed ? `已变更：${changed}。请重新起草，或核对后勾选确认。` :
        '这份提示词的原依据不可核对，请重新起草，或按当前镜头核对。') :
        '提示词依据已绑定当前剧本、连续性、分镜与美术版本。';
      renderBasisLinks(basisLinks, changes);
      basisConfirm.hidden = !stale;
      if (!stale) basisCheckbox.checked = false;
      controls();
    }
    prompt.oninput = () => { record.generationPrompt = prompt.value; basisCheckbox.checked = false; actions.save(); updateBasisStatus(); };
    basisCheckbox.onchange = controls;
    let useRepair;
    if (actions.repairInstruction) {
      const repair = document.createElement('details');
      repair.className = 'repair-plan';
      const summary = document.createElement('summary');
      summary.textContent = '查看已确认的返修要求';
      const preview = document.createElement('p');
      preview.textContent = actions.repairInstruction;
      preview.style.whiteSpace = 'pre-wrap';
      const label = document.createElement('label');
      useRepair = document.createElement('input');
      useRepair.type = 'checkbox';
      label.append(useRepair, '随本次生成提交');
      repair.append(summary, preview, label);
      prompt.closest('label').after(repair);
    }
    const selectedInputs = new Map();
    const rememberedMedia = sessionMedia.get(record) ?? new Map();
    sessionMedia.set(record, rememberedMedia);
    const selectedControls = new Map();
    let remembered = {};
    try { remembered = JSON.parse(record.generationSelections || '{}') || {}; } catch { /* Older projects have no saved inputs. */ }

    function referenceRoles() {
      return [...selectedInputs].flatMap(([role, { control, label, kind, assetKinds }]) => {
        if (kind === 'image') {
          const asset = references.find(item => item.id === control.value);
          return asset ? [{ role, label, assetId: asset.id, assetKind: asset.kind,
            ...(assetKinds ? { assetKinds } : {}) }] : [];
        }
        const item = rememberedMedia.get(role);
        return item ? [{ role, label, mediaName: item.file.name, localId: item.id,
          ...(item.fromMotion ? { motionOnly: true } : {}) }] : [];
      });
    }

    function generationSettings() {
      return { ...(config?.controlsProfile ? { controlsProfile: config.controlsProfile,
        controls: Object.fromEntries([...selectedControls].map(([id, input]) => [id, input.value])) } : {}),
        ...(config?.promptMode ? { promptMode: config.promptMode.id } : {}),
        ...(presetId ? { preset: presetId } : {}) };
    }

    function selectedOutputContract() {
      const output = config?.outputContract ? { ...config.outputContract } : null;
      if (!output) return null;
      const options = config.controls || [];
      const choice = id => {
        const group = options.find(item => item.id === id);
        return group?.options.find(item => item.id === selectedControls.get(id)?.value);
      };
      const framing = choice('framing');
      if (framing?.values?.length === 2) [output.width, output.height] = framing.values;
      const duration = choice('duration');
      if (duration?.values?.length === 1) output.frames = duration.values[0];
      return output;
    }

    function preflightRoute(settings = generationSettings()) {
      const query = new URLSearchParams();
      if (settings.controlsProfile) {
        query.set('controlsProfile', settings.controlsProfile);
        query.set('controls', JSON.stringify(settings.controls || {}));
      }
      if (settings.promptMode) query.set('promptMode', settings.promptMode);
      return '/preflight' + (query.size ? '?' + query.toString() : '');
    }

    function showControls(groups) {
      let prior;
      try { prior = JSON.parse(record.generationControls || 'null'); } catch { /* Use template defaults. */ }
      parameterFields.replaceChildren();
      selectedControls.clear();
      parameterFields.hidden = !groups.length;
      const duration = groups.find(group => group.id === 'duration');
      function showDuration() {
        const seconds = duration?.options.find(option => option.id === selectedControls.get('duration')?.value)?.seconds ??
          config.promptMode?.seconds;
        const planned = brief.shot.durationConfirmed ? (brief.shot.endMs - brief.shot.startMs) / 1000 : null;
        durationNotice.hidden = !seconds;
        durationNotice.textContent = seconds ? `生成 ${seconds} 秒 · ${planned === null ? '预演时长待定' : `分镜预演 ${planned} 秒`}` +
          (planned !== null && planned !== seconds ? ' · 剪辑时需核对切点' : '') : '';
      }
      for (const group of groups) {
        const label = document.createElement('label');
        label.textContent = group.label;
        const select = document.createElement('select');
        for (const option of group.options) select.add(new Option(option.label, option.id));
        const stored = prior?.controlsProfile === config.controlsProfile && prior.controls?.[group.id];
        select.value = group.options.some(option => option.id === stored) ? stored : group.defaultId;
        select.onchange = () => { record.generationControls = JSON.stringify(generationSettings()); actions.save(); showDuration(); controls(); };
        selectedControls.set(group.id, select);
        label.append(select);
        parameterFields.append(label);
      }
      showDuration();
    }

    let priorPrompt;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'production-action';
    undo.textContent = '恢复采用前的提示词';
    undo.hidden = true;
    prompt.closest('label').after(undo);
    function applyPrompt(value, refs, settings, instruction, basis) {
      const before = { generationPrompt: record.generationPrompt, generationPromptRefs: record.generationPromptRefs,
        generationPromptSettings: record.generationPromptSettings,
        generationInstruction: record.generationInstruction, generationPromptBasis: record.generationPromptBasis };
      record.generationPrompt = value;
      record.generationPromptRefs = refs;
      record.generationPromptSettings = settings;
      if (instruction !== undefined) record.generationInstruction = instruction;
      if (basis !== undefined) record.generationPromptBasis = basis;
      if (actions.save() === false) {
        for (const [key, item] of Object.entries(before)) {
          if (item === undefined) delete record[key];
          else record[key] = item;
        }
        throw new Error('浏览器未能保存提示词，请重试。');
      }
      prompt.value = value;
      prompt.focus();
    }
    undo.onclick = () => {
      try {
        if (prompt.value !== priorPrompt.applied) throw new Error('生成提示词已经手动改过。请先保留这些修改。');
        applyPrompt(priorPrompt.text, priorPrompt.refs, priorPrompt.settings, undefined, priorPrompt.basis);
        basisCheckbox.checked = false;
        updateBasisStatus();
        undo.hidden = true;
        message.textContent = '已恢复采用草稿前的提示词。';
      } catch (error) { message.textContent = error.message; }
    };
    const promptDraft = window.arcPromptDraft.create(record, actions.snapshot, brief.shot.id, referenceRoles, generationSettings,
      (value, refs, settings, instruction) => {
        const previous = { text: prompt.value, refs: record.generationPromptRefs || '',
          settings: record.generationPromptSettings || '', basis: record.generationPromptBasis || '', applied: value };
        applyPrompt(value, refs, settings, instruction, currentBasis());
        priorPrompt = previous;
        basisCheckbox.checked = false;
        updateBasisStatus();
        undo.hidden = false;
      });
    prompt.closest('label').before(promptDraft.panel);

    function showReferences(roles) {
      referenceFields.replaceChildren();
      selectedInputs.clear();
      referenceFields.hidden = roles.length === 0;
      const counts = { image: 0, video: 0, audio: 0 };
      for (const role of roles) {
        const kind = role.kind ?? 'image';
        const media = mediaInputs[kind];
        const label = document.createElement('label');
        const title = config?.promptMode ? `${media?.label || '图'} ${++counts[kind]} · ${role.label}` : role.label;
        label.textContent = title;
        if (media) {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = media.accept;
          const detail = document.createElement('small');
          detail.textContent = kind === 'video' && record.motionFilename && !motionActions.hasReference(record)
            ? `本镜白模尚未关联。可回分镜重新关联 ${record.motionFilename}，或在此选择其它参考。`
            : `上限 ${media.limit} MiB · 本次打开工作台期间保留`;
          const stored = rememberedMedia.get(role.id);
          if (stored?.kind === kind && (!stored.fromMotion || stored.file === window.arcMotionActions.fileFor(record))) {
            const transfer = new DataTransfer();
            transfer.items.add(stored.file);
            input.files = transfer.files;
          } else {
            rememberedMedia.delete(role.id);
          }
          input.onchange = () => {
            const [file] = input.files;
            rememberedMedia.delete(role.id);
            if (!file) { controls(); return; }
            const validExtension = media.accept.split(',').some(ext => file.name.toLowerCase().endsWith(ext));
            if (!validExtension || !file.size || file.size > media.limit * 1024 ** 2) {
              input.value = '';
              message.textContent = `「${role.label}」请选择受支持的格式，文件上限为 ${media.limit} MiB。`;
              controls();
              return;
            }
            rememberedMedia.set(role.id, { file, kind, id: crypto.randomUUID() });
            message.textContent = '';
            controls();
          };
          selectedInputs.set(role.id, { control: input, label: title, kind });
          label.append(input, detail);
          referenceFields.append(label);
          if (kind === 'video' && motionActions.hasReference(record)) {
            const useMotion = document.createElement('button');
            useMotion.type = 'button';
            useMotion.className = 'production-action';
            useMotion.textContent = `在「${role.label}」使用本镜白模`;
            useMotion.onclick = async () => {
              useMotion.disabled = true;
              try {
                const motionFile = await motionActions.loadReference(record);
                if (!active || !input.isConnected) return;
                for (const [id, item] of rememberedMedia) {
                  if (id !== role.id && item.fromMotion) {
                    rememberedMedia.delete(id);
                    const previousInput = selectedInputs.get(id);
                    if (previousInput) previousInput.control.value = '';
                  }
                }
                const transfer = new DataTransfer();
                transfer.items.add(motionFile);
                input.files = transfer.files;
                input.onchange();
                const item = rememberedMedia.get(role.id);
                if (item) {
                  item.fromMotion = true;
                  item.id = record.motionFingerprint || `builtin:${motionFile.name}`;
                  message.textContent = `已将 ${motionFile.name} 用作「${role.label}」。`;
                }
              } catch (error) {
                if (active) message.textContent = error.message;
              } finally {
                useMotion.disabled = false;
              }
            };
            label.after(useMotion);
          }
          continue;
        }
        const select = document.createElement('select');
        select.add(new Option('选择镜头参考或关键画面', ''));
        const compatible = compatibleReferences(role, references);
        for (const asset of compatible) select.add(new Option(`${asset.kind} · ${asset.name} · ${asset.revision}`, asset.id));
        const preset = defaultReference(role, compatible, remembered[role.id]);
        if (preset.id) select.value = preset.id;
        const helper = document.createElement('small');
        helper.textContent = !compatible.length ? `本镜没有可用于「${role.label}」的参考；请回美术参考库或分镜补充对应版本。` :
          preset.automatic ? `已自动选中本镜唯一符合类别的版本：${compatible[0].name} · ${compatible[0].revision}；可手动更换。` :
            preset.id ? `已沿用上次确认的版本：${compatible.find(asset => asset.id === preset.id).name} · ${compatible.find(asset => asset.id === preset.id).revision}。` :
              compatible.length > 1 ? `本镜绑定了 ${compatible.length} 个匹配版本，请确认本次使用哪一版。` :
              `仅显示${role.assetKinds?.join('、') || '本镜已绑定'}类参考图；请确认版本与输入用途一致。`;
        if (!compatible.length) {
          select.options[0].textContent = `暂无${role.assetKinds?.join('或') || ''}类镜头参考`;
          select.disabled = true;
        }
        if (compatible.some(asset => asset.id === remembered[role.id])) select.value = remembered[role.id];
        selectedInputs.set(role.id, { control: select, label: title, kind, assetKinds: role.assetKinds });
        select.onchange = () => {
          record.generationSelections = JSON.stringify(Object.fromEntries([...selectedInputs]
            .filter(([, item]) => item.kind === 'image').map(([id, item]) => [id, item.control.value])));
          actions.save();
          controls();
        };
        label.append(select, helper);
        referenceFields.append(label);
      }
    }

    async function request(route, options) {
      const hasPreset = new URLSearchParams(route.includes('?') ? route.slice(route.indexOf('?') + 1) : '').has('preset');
      const suffix = presetId && !hasPreset ? (route.includes('?') ? '&' : '?') + 'preset=' + encodeURIComponent(presetId) : '';
      const response = await fetch('/api/generation' + route + suffix, { ...options, cache: 'no-store' });
      const value = await response.json().catch(() => null);
      if (!response.ok || !value) throw Object.assign(new Error(value?.error || '生成服务不可用。'), { status: response.status });
      return value;
    }

    function controls() {
      const basisStale = promptBasisStale(record, brief);
      const missing = [...selectedInputs].filter(([role, item]) => item.kind === 'image'
        ? !references.some(asset => asset.id === item.control.value && asset.image)
        : !rememberedMedia.get(role)?.file);
      const singleShotReady = Boolean(config && prompt.value.trim() && !missing.length && (!basisStale || basisCheckbox.checked));
      if (!config) readyStatus.textContent = '可先写拍法和整理素材。连接本地桥接后可提交生成。';
      else if (busy.has(jobState)) readyStatus.textContent = '本镜的单镜任务已登记，可在下方查看状态。';
      else if (!prompt.value.trim()) readyStatus.textContent = '填写本镜提示词后才能提交单镜任务。';
      else if (missing.length) {
        const abMotionOnly = config.ab && missing.length === 1 && missing[0][0] === config.ab.motionRole;
        readyStatus.textContent = abMotionOnly ? '白模 A/B 会从分镜读取动作。若走下方单镜生成，请为视频输入选择参考。'
          : '单镜生成缺少参考：' + missing.map(([, item]) => item.label).join('、') + '。';
      } else if (!singleShotReady) readyStatus.textContent = '本镜资料有改动，请复核提示词后再提交。';
      else readyStatus.textContent = '单镜输入已齐。可提交，或先预检工作流。';
      readyActions.hidden = !config || !missing.length;
      goMissing.onclick = () => missing[0]?.[1].control.focus();
      const changed = [
        record.generationPromptRefs && record.generationPromptRefs !== JSON.stringify(referenceRoles()) ? '已选参考素材' : '',
        record.generationPromptSettings && record.generationPromptSettings !== JSON.stringify(generationSettings()) ? '生成参数' : ''
      ].filter(Boolean);
      inputStatus.hidden = !config || !changed.length;
      inputStatus.textContent = changed.length ? `提示词定稿后已变更：${changed.join('、')}。提交前请核对。` : '';
      submit.disabled = !singleShotReady || busy.has(jobState) || checkingPreflight;
      workflowSelect.disabled = busy.has(jobState) || checkingPreflight;
      preflight.disabled = !config || busy.has(jobState) || checkingPreflight;
      refresh.disabled = !config || !record.generationId || checking || jobState === 'submitting';
      forget.hidden = !['unconfirmed', 'unavailable'].includes(jobState);
    }

    function clearTimer() {
      clearTimeout(timer);
      timer = undefined;
    }

    function show(job) {
      jobState = job.status;
      message.textContent = [job.testFixture ? '本地测试模式' : '', statusLabels[job.status] || '等待状态', job.error].filter(Boolean).join(' · ');
      telemetry.update(job);
      firstFrame?.refresh();
      controls();
      results.replaceChildren();
      const basisStatus = resultBasisStatus(record, brief);
      const resultWarning = resultBasisWarnings[basisStatus];
      if (resultWarning && job.outputs?.length) {
        const warning = document.createElement('p');
        warning.className = 'production-status';
        warning.textContent = resultWarning;
        results.append(warning);
      }
      for (const item of job.outputs || []) {
        if (!item.url?.startsWith(`/api/generation/${record.generationId}/video/`)) continue;
        const row = document.createElement('div');
        const preview = document.createElement('video');
        preview.controls = true;
        preview.preload = 'metadata';
        preview.src = item.url;
        const link = document.createElement('a');
        link.href = item.url;
        link.download = item.name;
        link.textContent = '下载 ' + item.name;
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'production-action';
        review.textContent = '列为待审候选';
        const check = document.createElement('output');
        window.arcProductionQuality.checkVideo(preview, check, job.outputContract, passed => { review.disabled = !passed; });
        review.onclick = async () => {
          if (resultWarning && !window.confirm(resultWarning + ' 将此视频列为待审候选？')) return;
          review.disabled = true;
          try {
            const digest = await basisDigest(record.generationJobBasis);
            if (active && record.generationId === job.id) {
              actions.adopt({ ...item, testFixture: job.testFixture }, job.id, basisStatus, digest, record.generationJobReferences);
            }
          } catch (error) { if (active) message.textContent = error.message; }
          finally { review.disabled = (await window.arcProductionQuality.inspectOutputVideo(preview, job.outputContract)).status !== 'pass'; }
        };
        row.append(preview, link, review, check);
        results.append(row);
      }
      clearTimer();
      if (['queued', 'running', 'awaiting', 'submitting'].includes(jobState)) timer = setTimeout(poll, 2200);
    }

    async function poll() {
      if (!active || !record.generationId || checking) return;
      const id = record.generationId;
      clearTimer();
      checking = true;
      controls();
      try {
        const job = await request('/' + id, { signal: AbortSignal.timeout(12000) });
        if (active && record.generationId === id) {
          pollFailures = 0;
          show(job);
        }
      } catch (error) {
        if (active && record.generationId === id) {
          if (error.status === 404) {
            jobState = 'unavailable';
            message.textContent = error.message;
          } else {
            pollFailures += 1;
            const delay = [3, 6, 12, 20][pollFailures - 1];
            message.textContent = delay
              ? `状态查询暂时失败，${delay} 秒后重查同一任务。`
              : '多次查询失败。任务编号已保留，连接恢复后可点「刷新状态」。';
            if (delay) timer = setTimeout(poll, delay * 1000);
          }
        }
      } finally {
        checking = false;
        if (active) controls();
      }
    }

    submit.onclick = async () => {
      if (!config || busy.has(jobState)) return;
      const basis = currentBasis();
      const basisStale = promptBasisStale(record, brief);
      if (basisStale && !basisCheckbox.checked) {
        message.textContent = '提示词还没有按当前剧本和镜头资料复核。请重新起草，或勾选已核对后再提交。';
        return;
      }
      const text = prompt.value.trim();
      const submitted = useRepair?.checked ? text + '\n\n' + actions.repairInstruction : text;
      const images = {};
      const files = new Map();
      for (const [role, { kind, control }] of selectedInputs) {
        if (kind === 'image') images[role] = references.find(item => item.id === control.value)?.image;
        else files.set(role, rememberedMedia.get(role)?.file);
      }
      if (!text || [...Object.values(images), ...files.values()].some(item => !item)) {
        message.textContent = '请填写提示词，并为工作流的每个参考输入选择素材。';
        return;
      }
      if (presetId === 'pika-h3-ref2va' && files.has('motion')) {
        const motion = files.get('motion');
        try { await window.arcProductionQuality.checkMotion(motion); }
        catch (error) { message.textContent = error.message; return; }
        if (!active || busy.has(jobState) || rememberedMedia.get('motion')?.file !== motion || prompt.value.trim() !== text) return;
      }
      if (submitted.length > 20000) {
        message.textContent = '提示词与返修要求合计超过 20000 字，请缩短后提交。';
        return;
      }
      const selectedReferences = referenceRoles();
      const currentRefs = JSON.stringify(selectedReferences);
      const jobReferences = JSON.stringify(selectedReferences.map(input => {
        const asset = references.find(item => item.id === input.assetId);
        return asset ? { role: input.label, kind: asset.kind, name: asset.name, revision: asset.revision }
          : { role: input.motionOnly ? `${input.label} · 白模动作` : input.label, name: input.mediaName };
      }));
      const referenceAssetKinds = Object.fromEntries(selectedReferences
        .filter(item => item.assetKind && item.assetKinds).map(item => [item.role, item.assetKind]));
      const settings = generationSettings();
      const settingsKey = JSON.stringify(settings);
      let preflightEvidence;
      checkingPreflight = true;
      controls();
      try { preflightEvidence = await inspectPreflight({ requireClean: true, settings }); }
      catch (error) { message.textContent = error.message; return; }
      finally { checkingPreflight = false; controls(); }
      if (!active || prompt.value.trim() !== text || JSON.stringify(generationSettings()) !== settingsKey ||
          JSON.stringify(referenceRoles()) !== currentRefs) {
        message.textContent = '预检期间提示词、参数或参考素材已变化；本镜未提交，请重新核对后再试。';
        return;
      }
      const refsChanged = record.generationPromptRefs && record.generationPromptRefs !== currentRefs;
      const settingsChanged = record.generationPromptSettings && record.generationPromptSettings !== settingsKey;
      if ((refsChanged || settingsChanged) && !window.confirm('参考素材或生成参数在提示词定稿后有变更。确认已核对提示词，继续提交？')) return;
      const id = crypto.randomUUID();
      const previous = { generationId: record.generationId, generationPrompt: record.generationPrompt,
        generationPromptRefs: record.generationPromptRefs, generationPromptSettings: record.generationPromptSettings,
        generationPromptBasis: record.generationPromptBasis, generationPreflightEvidence: record.generationPreflightEvidence,
        generationJobBasis: record.generationJobBasis,
        generationJobReferences: record.generationJobReferences };
      Object.assign(record, { generationId: id, generationPrompt: text,
        generationPromptRefs: currentRefs, generationPromptSettings: settingsKey,
        generationPromptBasis: basis, generationPreflightEvidence: JSON.stringify(preflightEvidence),
        generationJobBasis: basis, generationJobReferences: jobReferences });
      if (actions.save() === false) {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete record[key];
          else record[key] = value;
        }
        message.textContent = '浏览器未能保存任务，请检查本机存储后再提交。';
        return;
      }
      show({ status: 'submitting' });
      try {
        const task = JSON.stringify({ id, prompt: submitted, images, referenceAssetKinds,
          outputContract: selectedOutputContract(),
          workflowSha256: preflightEvidence.workflowSha256,
          preflightSchemaSha256: preflightEvidence.schemaSha256,
          preflightFindingsSha256: preflightEvidence.findingsSha256,
          preflightUnverifiedAcknowledged: preflightEvidence.unverified > 0, ...settings });
        let submission = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: task };
        if (files.size) {
          const body = new FormData();
          body.append('task', task);
          for (const [role, file] of files) body.append(role, file);
          submission = { method: 'POST', body };
        }
        const response = await request('', submission);
        if (useRepair) useRepair.checked = false;
        if (active) show(response);
      } catch (error) {
        if (error.status === 400 && record.generationId === id) {
          delete record.generationId;
          delete record.generationJobBasis;
          delete record.generationJobReferences;
          actions.save();
        }
        if (active) show({ status: error.status === 400 ? 'failed' : 'unconfirmed', error: error.message });
      }
    };
    refresh.onclick = () => {
      pollFailures = 0;
      poll();
    };
    testConnection.onclick = async () => {
      testConnection.disabled = true;
      connectionStatus.textContent = '正在读取 ComfyUI 队列…';
      try {
        const value = await request('/connection');
        if (active) connectionStatus.textContent = `连接可用 · 运行 ${value.running} · 等待 ${value.queued}`;
      } catch (error) {
        if (active) connectionStatus.textContent = error.message;
      } finally {
        if (active) testConnection.disabled = false;
      }
    };
    async function inspectPreflight({ requireClean, settings = generationSettings() }) {
      findings.hidden = false;
      const report = findings.querySelector('p');
      const list = findings.querySelector('ul');
      report.textContent = '正在从 ComfyUI 读取节点定义…';
      list.replaceChildren();
      try {
        const value = await request(preflightRoute(settings));
        if (!active) throw new Error('当前单镜面板已关闭，取消提交。');
        if (!Number.isSafeInteger(value?.classes) || value.classes < 0 || !Number.isSafeInteger(value?.verified) ||
            value.verified < 0 || !Number.isSafeInteger(value?.issues) || value.issues < 0 ||
            !Number.isSafeInteger(value?.unverified) || value.unverified < 0 || !Array.isArray(value?.findings) ||
            !sha256Pattern.test(value?.graphSha256 || '') || !sha256Pattern.test(value?.schemaSha256 || '') ||
            !sha256Pattern.test(config?.graphSha256 || '')) throw new Error('工作流预检证据格式无效，未提交。');
        if (value.graphSha256 !== config.graphSha256) {
          preflightAckInput.checked = false;
          preflightAck.hidden = true;
          delete preflightAck.dataset.currentKey;
          delete preflightAck.dataset.confirmedKey;
          throw new Error('锁定工作流已变化，预检停止提交。请刷新工作流并重新核对。');
        }
        const findingsSha256 = await basisDigest(canonicalJson(value.findings));
        const confirmationKey = `${value.graphSha256}:${value.schemaSha256}:${findingsSha256}`;
        report.textContent = `已核对 ${value.verified} / ${value.classes} 类节点 · ${value.issues} 项问题 · ${value.unverified} 项待确认`;
        for (const item of value.findings) {
          const row = document.createElement('li');
          const area = [item.node, item.field].filter(Boolean).join('.');
          row.textContent = `${item.kind === 'issue' ? '核对' : '待确认'} · 节点 ${area} · ${item.message}`;
          list.append(row);
        }
        if (value.issues + value.unverified > value.findings.length) {
          const row = document.createElement('li');
          row.textContent = `还有 ${value.issues + value.unverified - value.findings.length} 项未展开。`;
          list.append(row);
        }
        if (value.issues > 0) {
          preflightAckInput.checked = false;
          preflightAck.hidden = true;
          delete preflightAck.dataset.currentKey;
          delete preflightAck.dataset.confirmedKey;
          if (requireClean) throw new Error(`工作流预检发现 ${value.issues} 项明确问题，已阻止单镜提交。请先修复节点或参数。`);
        }
        if (value.unverified > 0) {
          preflightAck.hidden = false;
          if (preflightAck.dataset.currentKey !== confirmationKey) {
            preflightAckInput.checked = false;
            preflightAck.dataset.confirmedKey = '';
            preflightAck.dataset.currentKey = confirmationKey;
          }
          if (requireClean && (!preflightAckInput.checked || preflightAck.dataset.confirmedKey !== confirmationKey)) {
            throw new Error(`预检有 ${value.unverified} 项无法核实。请查看上方节点明细并勾选确认；当前单镜尚未提交。`);
          }
        } else {
          preflightAckInput.checked = false;
          preflightAck.hidden = true;
          delete preflightAck.dataset.currentKey;
          delete preflightAck.dataset.confirmedKey;
        }
        return { evidence: 'comfy-object-info-preflight', status: value.unverified ? 'passed-with-unverified-items' : 'passed',
          workflowSha256: value.graphSha256, schemaSha256: value.schemaSha256, findingsSha256,
          classes: value.classes, verified: value.verified, issues: value.issues, unverified: value.unverified,
          checkedAt: new Date().toISOString() };
      } catch (error) {
        report.textContent = error.message;
        throw error;
      }
    }
    preflight.onclick = async () => {
      preflight.disabled = true;
      try { await inspectPreflight({ requireClean: false }); }
      catch { /* the preflight panel already contains the actionable error */ }
      finally { if (active) preflight.disabled = false; }
    };
    forget.onclick = () => {
      if (!window.confirm('请先在 ComfyUI 核对原任务。解除关联只清除工作台记录，原任务可能仍在运行。')) return;
      delete record.generationId;
      delete record.generationJobBasis;
      delete record.generationJobReferences;
      actions.save();
      show({ status: '' });
      message.textContent = '已解除关联，可以提交新任务。';
    };
    async function configureWorkflow() {
      const discovery = await fetch('/api/workflow-presets', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null).catch(() => null);
      if (!active) return null;
      const choices = discovery?.presets.filter(item => item.kind === 'generation') || [];
      if (choices.length) {
        if (discovery.defaultGeneration) workflowSelect.add(new Option('自定义工作流', 'custom'));
        for (const item of choices) workflowSelect.add(new Option(item.name, item.id));
        const preferred = [record.generationPreset, actions.recommendedPreset]
          .find(id => [...workflowSelect.options].some(option => option.value === id));
        workflowSelect.value = preferred || workflowSelect.options[0].value;
        presetId = workflowSelect.value === 'custom' ? '' : workflowSelect.value;
        const source = choices.find(choice => choice.id === presetId)?.source;
        const link = panel.querySelector('[data-workflow-source]');
        if (source) { link.href = source; link.hidden = false; }
        workflowPicker.hidden = false;
        workflowSelect.onchange = () => {
          const previous = record.generationPreset;
          record.generationPreset = workflowSelect.value;
          if (actions.save() !== false) actions.reload();
          else {
            if (previous === undefined) delete record.generationPreset;
            else record.generationPreset = previous;
            workflowSelect.value = presetId || 'custom';
          }
        };
      }
      return request('');
    }

    if (location.hostname === '127.0.0.1' && location.protocol === 'http:') {
      configureWorkflow().then(value => {
        if (!active) return;
        config = value;
        const transport = config.connection?.transport;
        const destination = transport === 'https' ? `HTTPS 工作流 · ${config.connection.host}` :
          transport === 'loopback' ? `本机转发 · ${config.connection.host}` : '本地工作流';
        connection.textContent = [config.testFixture ? '本地测试模式' : '', destination, config.workflow, config.promptMode?.label,
          config.persistent ? '任务可恢复' : ''].filter(Boolean).join(' · ');
        copyProvider.hidden = !/^[a-f0-9]{64}$/.test(config.providerFingerprint || '');
        copyProvider.onclick = async () => {
          try {
            await navigator.clipboard.writeText(config.providerFingerprint);
            connectionStatus.textContent = `已复制端点指纹 ${config.providerFingerprint.slice(0, 12)}…；生成的模型文件清单需用该值绑定当前服务。`;
          } catch { connectionStatus.textContent = '无法自动复制。请从本次任务的服务端点指纹字段复制完整值。'; }
        };
        testConnection.disabled = false;
        preflight.disabled = false;
        if (transport === 'https' || transport === 'loopback') submit.textContent = '提交到该 ComfyUI';
        showControls(config.controls || []);
        showReferences(config.references ?? (config.image ? [{ id: 'reference', label: '参考图片' }] : []));
        if (config.ab) {
          ab = window.arcAB.mount(record, {
            request, save: actions.save, download: actions.download, episode: actions.snapshot.episode, shotId: brief.shot.id,
            motionRole: config.ab.motionRole, testFixture: config.testFixture, outputContract: selectedOutputContract,
            controls: config.controls || [],
            benchmark: actions.benchmark, reviewContext: actions.reviewContext,
            graphSha256: config.graphSha256 || null,
            shotBasis: () => basisDigest(currentBasis()),
            currentParts: () => Promise.all(currentParts.map(basisDigest)),
            inheritedParts: () => {
              const parts = basisParts(record.generationPromptBasis);
              return parts ? Promise.all(parts.map(basisDigest)) : null;
            },
            renderBasisLinks, basisChanges, repairInstruction: actions.repairInstruction,
            focusedRepair: actions.focusedABRepair,
            adopt: (item, id, status, hash, refs, comparison, details) => actions.adopt(item, id, status, hash,
              refs ? JSON.stringify(refs) : undefined, comparison, details),
            motion: async () => {
              const file = await motionActions.loadReference(record);
              return ['pika-h3-ref2va', 'pika-h3-ref2va-art'].includes(presetId) ? window.arcProductionQuality.checkMotion(file) : file;
            }, motionOrigin: motionActions.referenceOrigin,
            digest: async value => typeof value === 'string' ? basisDigest(value) :
              Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await value.arrayBuffer())),
                byte => byte.toString(16).padStart(2, '0')).join(''),
            initialPrompt: () => prompt.value.includes('<Video ') ? '' : prompt.value,
            preparedPrompt: presetId === 'pika-h3-ref2va-art' ? actions.preparedABPrompt : '',
            workflowName: config.workflow,
            createDraft(apply, host) {
              const draft = window.arcPromptDraft.create(record, actions.snapshot, brief.shot.id,
                () => referenceRoles().filter(role => role.role !== config.ab.motionRole),
                () => ({ ...generationSettings(), abDraft: true }), apply);
              host.append(draft.panel);
              return draft;
            },
            shared() {
              const camera = brief.shot.camera;
              if (!camera.move && !camera.framing) throw new Error('请先在运镜页指定本镜机位或运镜。');
              const selected = referenceRoles().filter(role => role.role !== config.ab.motionRole);
              const images = {}, assetKinds = {}, referencesUsed = [];
              for (const role of config.references.filter(role => role.id !== config.ab.motionRole)) {
                const choice = selected.find(item => item.role === role.id);
                const asset = choice && references.find(item => item.id === choice.assetId);
                if (!asset?.image) throw new Error(`请先选择「${role.label}」的共用参考图。`);
                images[role.id] = asset.image;
                if (role.assetKinds) assetKinds[role.id] = asset.kind;
                referencesUsed.push({ role: role.label, name: asset.name, revision: asset.revision, kind: asset.kind });
              }
              const settings = generationSettings();
              const duration = (config.controls || []).flatMap(group => group.options.filter(option =>
                group.id === 'duration' && option.id === settings.controls?.duration))[0]?.seconds ?? config.promptMode?.seconds;
              if (!Number.isFinite(duration)) throw new Error('请先选择工作流的生成时长。');
              const effectiveControls = Object.fromEntries((config.controls || []).map(group => {
                const option = group.options.find(item => item.id === settings.controls?.[group.id]);
                return [group.id, option?.values?.length === 1 ? option.values[0] : option?.values ?? null];
              }));
              const expectedModelFiles = Object.entries(config.modelFilesByControl || {})
                .map(([id, options]) => options?.[settings.controls?.[id]])
                .find(Array.isArray) || null;
              return { profile: config.ab.profile, providerFingerprint: config.providerFingerprint || null,
                basis: currentBasis(), images, assetKinds, settings, effectiveControls, expectedModelFiles,
                references: referencesUsed,
                plannedSeconds: duration, workflow: config.workflow, workflowSha256: config.graphSha256 || null,
                modelFileEvidence: actions.modelFileEvidence?.(config.graphSha256 || null, expectedModelFiles,
                  config.providerFingerprint || null) || null,
                label: `${config.workflow} · 目标 ${duration} 秒 · ${camera.move || '分镜取景方案'} · ${selected.map(choice =>
                  references.find(item => item.id === choice.assetId)?.name).filter(Boolean).join(' / ')}` };
            }
          });
          ab.panel.open = Boolean(actions.openAB || window.arcAB.latest(record));
          panel.querySelector('[data-ab-placeholder]').replaceWith(ab.panel);
        }
        controls();
        poll();
      }).catch(() => { if (active) connection.textContent = '此页面尚未连接本地生成服务。'; });
    } else {
      connection.textContent = '请从本地 ComfyUI 桥接地址打开工作台后提交。提示词可在此保存。';
    }
    updateBasisStatus();
    return { panel, dispose() { active = false; clearTimer(); promptDraft.dispose(); ab?.dispose(); firstFrame?.dispose(); } };
  }

  if (typeof module === 'object' && module.exports) module.exports = { draft, promptBasis, promptBasisStale, resultBasisStatus, basisParts, basisChanges, compatibleReferences, defaultReference };
  if (typeof window !== 'undefined') window.arcGeneration = { create, defaultReference, promptBasis, basisDigest };
})();
