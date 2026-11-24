(() => {
  const terminal = new Set(['complete', 'failed', 'no_video']);
  const isMs = value => Number.isSafeInteger(value) && value >= 0;
  const firstFramePresets = ['minimax-h3-first', 'pika-h3-first'];
  const sha = /^[a-f0-9]{64}$/;
  const safeText = value => typeof value === 'string' && value.length <= 180 && !/[\x00-\x1f]/.test(value);
  function timingSourceSummary(attempts, key) {
    const values = attempts.map(attempt => attempt.timing?.[key] ?? null);
    const known = values.filter(value => value === 'comfy-history-timestamps' || value === 'local-bridge-observation');
    if (!known.length) return null;
    if (known.length !== values.length) return 'incomplete';
    return new Set(known).size === 1 ? known[0] : 'mixed';
  }

  function workflowDeclaration(value) {
    if (!value || value.evidence !== 'workflow-declared' || value.loadedWeightsVerified !== false) return undefined;
    const models = Array.isArray(value.models) ? value.models.filter(item => item && safeText(item.node) &&
      safeText(item.type) && safeText(item.file) && !/[\\/]/.test(item.file) &&
      /\.(?:safetensors|ckpt|pt|pth|gguf)$/i.test(item.file)).slice(0, 32) : [];
    const precision = Array.isArray(value.precision) ? value.precision.filter(safeText).slice(0, 16) : [];
    const seeds = Array.isArray(value.seeds) ? value.seeds.filter(item => item && safeText(item.node) && safeText(item.type) &&
      ['seed', 'noise_seed'].includes(item.input) && Number.isSafeInteger(item.value) && item.value >= 0)
      .slice(0, 32) : [];
    const samplers = Array.isArray(value.samplers) ? value.samplers.filter(item => item && safeText(item.node) &&
      safeText(item.type) && item.settings && typeof item.settings === 'object' && !Array.isArray(item.settings))
      .slice(0, 32).map(item => ({ node: item.node, type: item.type, settings: Object.fromEntries(
        Object.entries(item.settings).filter(([key, setting]) => safeText(key) &&
          (Number.isFinite(setting) || (safeText(setting) && setting.length <= 180) ||
            (Array.isArray(setting) && setting.length === 2 && safeText(setting[0]) && Number.isSafeInteger(setting[1])))).slice(0, 24)) })) : [];
    return { evidence: 'workflow-declared', loadedWeightsVerified: false, models, precision, seeds, samplers };
  }

  function firstFrameTrials(record) {
    const history = read(record);
    return firstFramePresets.map(preset => {
      const runs = history.filter(run => run.preset === preset && sha.test(run.firstFrameProof || ''));
      const run = runs.findLast(item => item.status === 'complete');
      if (!run) return null;
      const attempts = runs.slice(0, runs.indexOf(run) + 1).filter(item => item.firstFrameProof === run.firstFrameProof);
      const queueSource = timingSourceSummary(attempts, 'queueSource');
      const executionSource = timingSourceSummary(attempts, 'executionSource');
      const total = (key, source) => source !== 'mixed' && attempts.every(item => isMs(item.timing?.[key])) ?
        attempts.reduce((sum, item) => sum + item.timing[key], 0) : null;
      return { ...run, retryCount: Math.max(0, attempts.length - 1),
        cumulativeTiming: { queueMs: total('queueMs', queueSource), executionMs: total('executionMs', executionSource),
          queueSource, executionSource,
          gpuKernelTime: attempts.length && attempts.every(item => item.timing?.gpuKernelTime === false) ? false : null,
          latestQueueMs: isMs(run.timing?.queueMs) ? run.timing.queueMs : null,
          latestExecutionMs: isMs(run.timing?.executionMs) ? run.timing.executionMs : null,
          attempts: attempts.length, coverage: 'retained-generation-log' } };
    });
  }

  function timingText(timing, running) {
    if (!timing) return '';
    const historyMeasured = timing.executionSource === 'comfy-history-timestamps';
    const fields = [
      [timing.queueSource === 'comfy-history-timestamps' ? 'Comfy history 排队' : 'ComfyUI 排队', timing.queueMs],
      [historyMeasured ? 'Comfy history 执行墙钟（非 GPU kernel）' : 'ComfyUI 执行', timing.executionMs],
      [running ? '工作台已等待' : '提交至首次确认', timing.bridgeMs]
    ];
    return fields.filter(([, ms]) => isMs(ms))
      .map(([label, ms]) => `${label} ${(ms / 1000).toFixed(2)} 秒`).join(' · ');
  }

  function read(record) {
    try {
      const value = JSON.parse(record.generationLog || '[]');
      return Array.isArray(value) ? value.slice(-12).filter(item =>
        item && typeof item.id === 'string' && terminal.has(item.status)).map(item => ({ ...item,
          workflowDeclaration: workflowDeclaration(item.workflowDeclaration) })) : [];
    } catch { return []; }
  }

  function summarizeAttempts(items) {
    const summary = {
      total: items.length, returned: 0, failed: 0, noVideo: 0,
      retry: 0, standard: 0, A: 0, B: 0,
      queue: { milliseconds: 0, count: 0 }, execution: { milliseconds: 0, count: 0 }
    };
    for (const item of items) {
      if (item.retry) summary.retry++;
      summary[item.variant || 'standard']++;
      if (item.status === 'complete') summary.returned++;
      if (item.status === 'failed') summary.failed++;
      if (item.status === 'no_video') summary.noVideo++;
      for (const [bucket, ms] of [[summary.queue, item.timing?.queueMs], [summary.execution, item.timing?.executionMs]]) {
        if (!isMs(ms)) continue;
        bucket.milliseconds += ms;
        bucket.count++;
      }
    }
    return summary;
  }

  function summarize(shots, pairsFor = () => [], observed = new Map()) {
    const recorded = new Map();
    function record(attempt, variant, retry = false) {
      const live = observed.get(attempt.id);
      const preferred = terminal.has(live?.status) ? live : attempt;
      if (!terminal.has(preferred.status) || !attempt.id) return;
      const previous = recorded.get(attempt.id);
      recorded.set(attempt.id, { ...previous, ...attempt, ...preferred, variant: variant || previous?.variant, retry,
        timing: { ...previous?.timing, ...attempt.timing, ...preferred.timing },
        testFixture: [previous, attempt, preferred].some(item => item?.testFixture === true || item?.output?.testFixture === true)
          ? true : preferred.testFixture ?? attempt.testFixture ?? previous?.testFixture });
    }
    for (const shot of shots) {
      for (const attempt of read(shot)) record(attempt);
      for (const pair of pairsFor(shot)) for (const variant of ['A', 'B']) {
        pair.attempts[variant].filter(attempt => attempt.status !== 'rejected')
          .forEach((attempt, index) => record(attempt, variant, index > 0));
      }
    }
    const entries = [...recorded.values()];
    return { total: entries.length,
      service: summarizeAttempts(entries.filter(item => item.testFixture === false)),
      fixtures: summarizeAttempts(entries.filter(item => item.testFixture === true)),
      unknown: summarizeAttempts(entries.filter(item => typeof item.testFixture !== 'boolean')) };
  }

  function nextLog(record, job) {
    if (!terminal.has(job.status) || !job.id || !job.timing) return undefined;
    const timing = job.timing;
    const returned = job.outputs?.[0];
    const output = returned?.url === `/api/generation/${job.id}/video/0` &&
      /^[a-f0-9]{64}$/.test(returned.assetKey || '') && typeof returned.name === 'string' &&
      returned.name.length <= 180 && !/[\\/:\x00-\x1f]/.test(returned.name) ?
        { name: returned.name, assetKey: returned.assetKey } : undefined;
    const contract = job.outputContract && [job.outputContract.width, job.outputContract.height]
      .every(value => Number.isInteger(value) && value > 0) &&
      (Number.isFinite(job.outputContract.seconds) ||
        (Number.isFinite(job.outputContract.frames) && Number.isFinite(job.outputContract.fps))) ? {
          width: job.outputContract.width, height: job.outputContract.height,
          ...(Number.isFinite(job.outputContract.seconds) ? { seconds: job.outputContract.seconds } : {}),
          ...(Number.isFinite(job.outputContract.frames) ? { frames: job.outputContract.frames } : {}),
          ...(Number.isFinite(job.outputContract.fps) ? { fps: job.outputContract.fps } : {})
        } : undefined;
    const before = read(record);
    const previous = before.findIndex(item => item.id === job.id);
    const known = before[previous]?.timing;
    const entry = { id: job.id, status: job.status, workflow: job.workflow || '', settings: job.settings || [],
      acceptedAt: isMs(job.acceptedAt) ? job.acceptedAt : undefined,
      ...(typeof (job.testFixture ?? before[previous]?.testFixture) === 'boolean' ?
        { testFixture: job.testFixture ?? before[previous]?.testFixture } : {}),
      ...(output ? { output } : {}), ...(contract ? { outputContract: contract } : {}),
      ...(workflowDeclaration(job.workflowDeclaration) ? { workflowDeclaration: workflowDeclaration(job.workflowDeclaration) } : {}),
      ...(output && before[previous]?.media?.assetKey === output.assetKey ? { media: before[previous].media } : {}),
      ...(typeof job.workflow === 'string' ? { workflow: job.workflow.slice(0, 160) } : {}),
      ...(sha.test(job.graphSha256 || '') ? { graphSha256: job.graphSha256 } : {}),
      ...(Array.isArray(job.settings) ? { settings: job.settings.filter(item => item &&
        typeof item.label === 'string' && typeof item.value === 'string').slice(0, 40) } : {}),
      ...(firstFramePresets.includes(job.preset) && sha.test(job.firstFrameProof || '') ?
        { preset: job.preset, firstFrameProof: job.firstFrameProof,
          ...(sha.test(job.graphSha256 || '') ? { graphSha256: job.graphSha256 } : {}) } : {}),
      timing: { ...Object.fromEntries(['queueMs', 'executionMs', 'bridgeMs']
        .map(key => [key, isMs(timing[key]) ? timing[key] : known?.[key]]).filter(([, ms]) => isMs(ms))),
        ...Object.fromEntries(['queueSource', 'executionSource', 'bridgeSource'].flatMap(key =>
          ['comfy-history-timestamps', 'local-bridge-observation'].includes(timing[key]) ? [[key, timing[key]]] :
            ['comfy-history-timestamps', 'local-bridge-observation'].includes(known?.[key]) ? [[key, known[key]]] : [])),
        ...(typeof timing.gpuKernelTime === 'boolean' ? { gpuKernelTime: timing.gpuKernelTime } :
          typeof known?.gpuKernelTime === 'boolean' ? { gpuKernelTime: known.gpuKernelTime } : {}) } };
    if (previous >= 0 && JSON.stringify(before[previous]) === JSON.stringify(entry)) return undefined;
    if (previous >= 0) before[previous] = entry;
    else before.push(entry);
    return JSON.stringify(before.slice(-12));
  }

  function recordMedia(record, id, assetKey, media, save) {
    if (!sha.test(assetKey || '') || !media ||
        !Number.isFinite(media.seconds) || media.seconds <= 0 ||
        !Number.isInteger(media.width) || media.width <= 0 ||
        !Number.isInteger(media.height) || media.height <= 0) return false;
    const before = read(record);
    const entry = before.find(item => item.id === id && item.output?.assetKey === assetKey);
    if (!entry) return false;
    const previous = record.generationLog;
    entry.media = { assetKey, seconds: media.seconds, width: media.width, height: media.height,
      ...(Number.isFinite(media.fps) && media.fps > 0 ? { fps: media.fps } : {}),
      ...(Number.isSafeInteger(media.frameCount) && media.frameCount > 0 ? { frameCount: media.frameCount } : {}),
      ...(safeText(media.codec) ? { codec: media.codec } : {}),
      ...(media.frameRateMode === 'constant' || media.frameRateMode === 'variable-or-mixed' ?
        { frameRateMode: media.frameRateMode } : {}),
      ...(typeof media.hasAudio === 'boolean' ? { hasAudio: media.hasAudio } : {}),
      ...(Number.isInteger(media.audioTrackCount) && media.audioTrackCount >= 0 && media.audioTrackCount <= 16 ?
        { audioTrackCount: media.audioTrackCount } : {}),
      ...(media.source === 'mp4-stts' && Array.isArray(media.audioTracks) && media.audioTracks.length <= 16 ?
        { audioTracks: media.audioTracks.map(track => ({
          ...(Number.isFinite(track?.durationSeconds) && track.durationSeconds > 0 ? { durationSeconds: track.durationSeconds } : {}),
          ...(safeText(track?.codec) ? { codec: track.codec } : {})
        })) } : {}),
      ...(media.source === 'mp4-stts' && Number.isFinite(media.audioVideoDurationDeltaSeconds) &&
        media.audioVideoDurationDeltaSeconds >= 0 && media.audioVideoDurationDeltaSeconds <= 3600 ?
        { audioVideoDurationDeltaSeconds: media.audioVideoDurationDeltaSeconds } : {}),
      ...(media.source === 'mp4-stts' ? { source: media.source } : {}) };
    record.generationLog = JSON.stringify(before);
    if (save() !== false) return true;
    if (previous === undefined) delete record.generationLog;
    else record.generationLog = previous;
    return false;
  }

  function create(record, save, labels) {
    const panel = document.createElement('section');
    panel.className = 'generation-telemetry';
    panel.innerHTML = `<p data-live-timing hidden></p><details hidden>
      <summary>本镜生成记录</summary><ol></ol></details>`;
    const live = panel.querySelector('p');
    const details = panel.querySelector('details');
    const list = panel.querySelector('ol');
    function renderHistory() {
      const records = read(record);
      details.hidden = !records.length;
      list.replaceChildren();
      for (const attempt of [...records].reverse()) {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        const date = isMs(attempt.acceptedAt) && attempt.acceptedAt <= 8.64e15 ?
          new Date(attempt.acceptedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        title.textContent = [attempt.testFixture ? '本地模拟' : '', labels[attempt.status], attempt.workflow, date].filter(Boolean).join(' · ');
        const settings = document.createElement('span');
        settings.textContent = (Array.isArray(attempt.settings) ? attempt.settings : [])
          .filter(value => value && typeof value.label === 'string' && typeof value.value === 'string')
          .map(value => `${value.label} ${value.value}`).join(' · ');
        const timings = document.createElement('span');
        timings.textContent = timingText(attempt.timing, false) || '未返回耗时';
        item.append(title, ...(settings.textContent ? [settings] : []), timings);
        list.append(item);
      }
    }
    function update(job) {
      const done = terminal.has(job.status);
      const timing = job.timing;
      const text = timingText(timing, !done);
      live.hidden = !text;
      live.textContent = text;
      const next = nextLog(record, job);
      if (!next) return;
      const old = record.generationLog;
      record.generationLog = next;
      if (save() === false) {
        if (old === undefined) delete record.generationLog;
        else record.generationLog = old;
        live.textContent = [text, '浏览器未保存这条生成记录'].filter(Boolean).join(' · ');
        live.hidden = false;
        return;
      }
      renderHistory();
    }
    renderHistory();
    return { panel, update };
  }

  if (typeof module === 'object' && module.exports) module.exports = { summarize, nextLog, recordMedia, firstFrameTrials };
  if (typeof window !== 'undefined') window.arcGenerationLog = { create, summarize, nextLog, firstFrameTrials, recordMedia };
})();
