((root) => {
  const dimensions = [
    ['character', '角色与服装', '换景别后核对脸部轮廓、发型、领口和材质。'],
    ['space', '场景与道具', '对照窗框、门口等空间地标，再核对道具位置与方向。'],
    ['light', '光向与材质', '对照主光、肤色和材质；镜内特效发光时，检查反光、遮挡和亮度是否同步。'],
    ['framing', '构图与视线', '核对视线方向、景别、主体位置和前后镜头的画面关系。'],
    ['performance', '表演与表情', '核对情绪是否读得清，眼神、嘴部和头部动作是否自然且接得上台词。'],
    ['camera', '运镜与动作连续', '对照预定起止构图、方向和速度，检查运镜是否漂移或动作跳变。'],
    ['temporal', '跨帧稳定与伪影', '检查脸、手、发丝、衣纹和背景是否闪烁、变形、融化或凭空增减。']
  ];
  const states = ['待核对', '符合', '待返修', '本镜不适用'];
  const limit = 60;
  function sourceIdentity(record) {
    try {
      const value = JSON.parse(record.sourceBinding || 'null');
      if (!value || value.version !== record.version?.trim() || value.file !== record.file?.trim() ||
          !Number.isSafeInteger(value.size) || value.size <= 0 ||
          !/^(sha256|sample-v1):[a-f0-9]{64}$/.test(value.fingerprint) ||
          !/^sha256-tree-v1:[a-f0-9]{64}$/.test(value.contentDigest)) return null;
      return [value.size, value.fingerprint, value.contentDigest];
    } catch { return null; }
  }
  function returnedIdentity(record) {
    try {
      const value = JSON.parse(record.generatedCandidate || 'null');
      if (!value || value.version !== record.version?.trim() || value.name !== record.file?.trim() ||
          !/^[a-f0-9-]{36}$/i.test(value.jobId || '') || !Number.isInteger(value.index) || value.index < 0 || value.index > 999 ||
          !/^[a-f0-9]{64}$/.test(value.assetKey || '')) return null;
      return [value.jobId, value.index, value.assetKey];
    } catch { return null; }
  }
  function parseTechnicalQc(report, expectedSha256, expectedSizeBytes) {
    if (!report || typeof report !== 'object' || !report.source_identity || report.source_identity.stable_during_qc !== true ||
        !/^[a-f0-9]{64}$/.test(report.source_identity.sha256 || '') ||
        !Number.isSafeInteger(report.source_identity.size_bytes) || report.source_identity.size_bytes < 1 ||
        report.source_identity.sha256 !== expectedSha256 || report.source_identity.size_bytes !== expectedSizeBytes) {
      throw new Error('ARC QC 报告与当前候选视频的 SHA-256/字节数不一致，或检测期间文件发生变化。');
    }
    const summary = report.summary;
    if (!summary || !['errors', 'warnings'].every(key => Number.isSafeInteger(summary[key]) && summary[key] >= 0) ||
        !Array.isArray(report.findings) || report.findings.length > 500) throw new Error('ARC QC 报告结构无效。');
    const findings = report.findings.map(item => {
      if (!item || !['black', 'freeze', 'silence', 'shake', 'av-track-duration'].includes(item.kind) ||
          !['error', 'warn', 'info'].includes(item.severity) || !Number.isFinite(item.start) || item.start < 0 || item.start > 3600 ||
          !Number.isFinite(item.end) || item.end < item.start || item.end > 3600 || typeof item.detail !== 'string' || item.detail.length > 300) {
        throw new Error('ARC QC 报告包含格式无效的检测项。');
      }
      return { kind: item.kind, severity: item.severity, start: item.start, end: item.end,
        detail: item.detail, ...(typeof item.threshold === 'string' ? { threshold: item.threshold.slice(0, 200) } : {}) };
    });
    return { sourceSha256: expectedSha256, sizeBytes: expectedSizeBytes,
      summary: { errors: summary.errors, warnings: summary.warnings,
        ...(typeof summary.has_audio === 'boolean' ? { hasAudio: summary.has_audio } : {}),
        ...(typeof summary.audio_all_silent === 'boolean' ? { audioAllSilent: summary.audio_all_silent } : {}),
        ...(Number.isFinite(summary.audio_video_track_duration_delta) && summary.audio_video_track_duration_delta >= 0 ?
          { audioVideoTrackDurationDelta: summary.audio_video_track_duration_delta } : {}) },
      coverage: { automated: ['black', 'freeze', 'silence', 'relative-shake', 'av-track-duration-delta'],
        manualReviewRequired: ['character-identity', 'expression-and-performance', 'action-and-contact',
          'camera-and-composition', 'flicker-and-temporal-artifacts', 'style-and-lighting-continuity',
          'lip-sync', 'audio-video-sync'], cleanResultIsQualityPass: false },
      findings, thresholds: report.thresholds && typeof report.thresholds === 'object' ? Object.fromEntries(
        Object.entries(report.thresholds).filter(([key, value]) => /^[a-z_]{1,48}$/.test(key) && Number.isFinite(value)).slice(0, 32)) : {} };
  }
  function storedTechnicalQc(value, record) {
    if (!value || !/^[a-f0-9]{64}$/.test(value.sourceSha256 || '') ||
        !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1 ||
        !value.summary || !Number.isSafeInteger(value.summary.errors) || !Number.isSafeInteger(value.summary.warnings) ||
        !Array.isArray(value.findings) || value.findings.length > 500) return null;
    const binding = sourceIdentity(record);
    const expected = binding?.[1]?.startsWith('sha256:') ? binding[1].slice(7) : null;
    if (!expected || expected !== value.sourceSha256 || binding[0] !== value.sizeBytes) return null;
    try { return parseTechnicalQc({ source_identity: { sha256: value.sourceSha256, size_bytes: value.sizeBytes,
      stable_during_qc: true }, summary: { errors: value.summary.errors, warnings: value.summary.warnings,
      has_audio: value.summary.hasAudio, audio_all_silent: value.summary.audioAllSilent,
      audio_video_track_duration_delta: value.summary.audioVideoTrackDurationDelta }, findings: value.findings,
      thresholds: value.thresholds }, expected, binding[0]); }
    catch { return null; }
  }
  function scriptContext(record, pages) {
    if (!pages || typeof pages !== 'object') return null;
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, '');
    const anchor = normalize(record.scriptAnchor);
    const paragraphs = ['story', 'dialogue'].flatMap(key => {
      const source = typeof pages[key] === 'string' ? pages[key] : '';
      if (!anchor || !source) return [];
      return source.split(/\n\s*\n/u).filter(paragraph => normalize(paragraph).includes(anchor))
        .map(paragraph => [key, paragraph.trim()]);
    });
    return { paragraphs, state: pages.state || '', rules: pages.rules || '' };
  }
  function signature(record, series, pages, continuityBasis) {
    const constraints = [record.guide, record.reference, record.duration].map(value => value?.trim() || '');
    return JSON.stringify([sourceIdentity(record), returnedIdentity(record), record.scriptAnchor || '', record.beat || '', record.frameAsset || '', record.refs || [], record.composition || '', record.performance || '', record.move || '',
      record.path || '', series.character || '', series.look || '', series.limits || '', ...(record.cameraPlan ? [record.cameraPlan] : []),
      scriptContext(record, pages), ...(constraints.some(Boolean) ? [constraints] : []),
      ...(continuityBasis?.length ? [{ continuity: continuityBasis }] : []),
      ...(record.lighting?.trim() ? [{ lighting: record.lighting.trim() }] : []),
      ...(record.generationEffects?.trim() ? [{ generationEffects: record.generationEffects.trim() }] : []),
      ...(record.motionAction ? [{ motionAction: record.motionAction, motionFilename: record.motionFilename || '',
        ...(record.motionFingerprint ? { motionFingerprint: record.motionFingerprint } : {}) }] : [])]);
  }
  const scope = record => ({ version: record.version?.trim() || '', file: record.file?.trim() || '' });
  const same = (left, right) => left.version === right.version && left.file === right.file;

  function parse(items) {
    if (!Array.isArray(items)) return [];
    return dimensions.flatMap(([id, label]) => {
      const matching = items.find(item => item?.id === id && states.includes(item.result));
      if (!matching || matching.result === states[0]) return [];
      return [{ id, label, result: matching.result,
        note: typeof matching.note === 'string' ? matching.note.trim().slice(0, 240) : '' }];
    });
  }

  function parseBenchmark(items, benchmark) {
    if (!benchmark?.id || !Array.isArray(benchmark.checks)) return [];
    return benchmark.checks.flatMap(definition => {
      if (!definition || typeof definition.id !== 'string') return [];
      const row = Array.isArray(items) ? items.find(item => item?.id === definition.id) : null;
      const result = states.includes(row?.result) ? row.result : states[0];
      const note = typeof row?.note === 'string' ? row.note.trim().slice(0, 240) : '';
      const timecodes = Array.isArray(row?.timecodes) ? row.timecodes.slice(0, 24).flatMap(item =>
        Number.isSafeInteger(item?.sourceMs) && item.sourceMs >= 0 && item.sourceMs <= 3_600_000 ?
          [{ sourceMs: item.sourceMs, note: typeof item.note === 'string' ? item.note.trim().slice(0, 240) : '' }] : []) : [];
      return [{ id: definition.id, label: definition.check || definition.id,
        severity: definition.severity === 'blocker' ? 'blocker' : 'review', result, note, timecodes }];
    });
  }

  function missing(items) {
    const values = Array.isArray(items) ? items : [];
    return dimensions.filter(([id]) => !values.some(item => item?.id === id &&
      states.includes(item.result) && item.result !== states[0])).map(([, label]) => label);
  }

  function read(record) {
    try {
      const all = JSON.parse(record.artReviews || '[]');
      return Array.isArray(all) ? all.slice(0, limit).filter(item => item && typeof item.version === 'string' &&
        typeof item.file === 'string' && typeof item.signature === 'string' && Array.isArray(item.checks)) : [];
    } catch { return []; }
  }
  function current(record, series, pages, continuityBasis, benchmark) {
    const now = scope(record);
    const saved = read(record).find(item => same(item, now));
    const matches = saved?.signature === signature(record, series, pages, continuityBasis);
    const activeBenchmark = matches && benchmark?.id && saved.benchmark?.id === benchmark.id ? saved.benchmark.checks : [];
    return { stale: Boolean(saved && !matches), checks: matches ? parse(saved.checks) : [],
      benchmarkChecks: parseBenchmark(activeBenchmark, benchmark),
      technicalQc: matches ? storedTechnicalQc(saved.technicalQc, record) : null,
      reviewMs: matches && Number.isSafeInteger(saved?.reviewMs) && saved.reviewMs >= 0 && saved.reviewMs <= 604_800_000 ?
        saved.reviewMs : null };
  }

  function approval(record, series, pages, continuityBasis, benchmark) {
    if (!sourceIdentity(record)) return { ready: false, stale: false, unbound: true, missing: [], issues: [] };
    const now = scope(record);
    const saved = read(record).find(item => same(item, now));
    if (!saved) return { ready: false, stale: false, missing: dimensions.map(([, label]) => label), issues: [],
      benchmarkMissing: benchmark?.checks?.map(item => item.check) || [], benchmarkChecks: [] };
    if (saved.signature !== signature(record, series, pages, continuityBasis)) return { ready: false, stale: true, missing: [], issues: [] };
    const missingItems = missing(saved.checks);
    const benchmarkChecks = benchmark?.id && saved.benchmark?.id === benchmark.id ? parseBenchmark(saved.benchmark.checks, benchmark) : [];
    const issues = [...parse(saved.checks).filter(item => item.result === '待返修'),
      ...benchmarkChecks.filter(item => item.result === '待返修')];
    const benchmarkMissing = benchmark ? benchmark.checks.filter(item => {
      const check = benchmarkChecks.find(row => row.id === item.id);
      return !check || check.result === states[0] || (item.severity === 'blocker' && check.result === '本镜不适用');
    }).map(item => item.check) : [];
    return { ready: !missingItems.length && !issues.length && !benchmarkMissing.length, stale: false, missing: missingItems, issues,
      benchmarkMissing, benchmarkChecks };
  }

  function create(record, series, pages, { selectedFile, verify, save, onTimecode, onBenchmarkTimecode, onSaved,
    onBenchmarkRepair, continuityBasis, benchmark }) {
    const panel = document.createElement('details');
    panel.className = 'production-history art-review';
    panel.innerHTML = `
      <summary>视觉验收</summary>
      <div class="production-picker"><button type="button" data-review-timer>开始人工审片计时</button><output data-review-duration role="status">人工审片累计 0 秒 · 仅统计手动计时</output></div>
      <details class="art-review-technical-qc"><summary>ARC 技术 QC · 可选导入</summary>
        <p>导入 ARC 导出的 QC JSON。仅接受与当前候选文件 SHA-256 和字节数一致的报告。自动筛查黑帧、长冻结、长静音、片段间相对抖动和音画轨道长度差；长度一致不证明同步，未检出也不等于画质通过。人物一致性、表演、动作接触、构图运镜、闪烁伪影、光色连续、口型与声画同步仍需人工逐镜验收。</p>
        <label>ARC QC JSON<input type="file" accept=".json,application/json" data-qc-file></label>
        <output data-qc-status role="status">尚未附加技术 QC 报告。</output><ul data-qc-findings></ul></details>
      <p data-art-status></p><div data-art-checks></div>
      <div class="production-picker"><button type="button" data-art-save>保存视觉验收</button></div>
      <output data-art-message role="status"></output>`;
    const status = panel.querySelector('[data-art-status]');
    const content = panel.querySelector('[data-art-checks]');
    const message = panel.querySelector('[data-art-message]');
    const button = panel.querySelector('[data-art-save]');
    const timerButton = panel.querySelector('[data-review-timer]');
    const timerOutput = panel.querySelector('[data-review-duration]');
    const qcInput = panel.querySelector('[data-qc-file]');
    const qcStatus = panel.querySelector('[data-qc-status]');
    const qcFindings = panel.querySelector('[data-qc-findings]');
    const timerEvents = new AbortController();
    let baseline, editors, benchmarkEditors;
    let qcDraft = null, qcScope = '';
    let timerScope = '', savedReviewMs = null, sessionReviewMs = 0, timerStartedAt = null, timerInterval;

    function reviewDuration() {
      if (savedReviewMs === null && sessionReviewMs === 0 && timerStartedAt === null) return null;
      return (savedReviewMs || 0) + sessionReviewMs + (timerStartedAt === null ? 0 : Math.max(0, performance.now() - timerStartedAt));
    }
    function renderTimer() {
      const duration = reviewDuration();
      const seconds = duration === null ? null : Math.floor(duration / 1000);
      timerOutput.textContent = seconds === null ? '人工审片时长未计 · 可选手动计时' :
        `人工审片累计 ${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒 · 手动计时`;
      timerButton.textContent = timerStartedAt === null ? '开始人工审片计时' : '暂停人工审片计时';
    }
    function pauseTimer() {
      if (timerStartedAt !== null) {
        sessionReviewMs += Math.max(0, performance.now() - timerStartedAt);
        timerStartedAt = null;
      }
      clearInterval(timerInterval);
      timerInterval = undefined;
      renderTimer();
    }
    function startTimer() {
      if (timerStartedAt !== null || document.visibilityState === 'hidden') return;
      if (!sourceIdentity(record) || selectedFile()?.name !== scope(record).file) {
        message.textContent = '请先载入并核对当前候选视频，再开始计时。';
        return;
      }
      savedReviewMs ??= 0;
      timerStartedAt = performance.now();
      timerInterval = setInterval(renderTimer, 500);
      renderTimer();
    }
    timerButton.onclick = () => timerStartedAt === null ? startTimer() : pauseTimer();
    panel.addEventListener('toggle', () => { if (!panel.open) pauseTimer(); }, { signal: timerEvents.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') pauseTimer();
    }, { signal: timerEvents.signal });
    function refreshBindingStatus() {
      const { stale, checks, benchmarkChecks } = current(record, series, pages, continuityBasis, benchmark);
      status.textContent = !sourceIdentity(record) ? '请先核对并绑定当前视频文件指纹，再保存视觉验收。' :
        stale ? '原片指纹、美术设定、剧本段落、连续性规则或分镜有变化，请重新核对。' :
        checks.length ? `已核对 ${checks.length} / ${dimensions.length} 项 · 待返修 ${checks.filter(item => item.result === '待返修').length} 项` +
          (benchmark ? ` · 试镜专项 ${benchmarkChecks.filter(item => item.result !== states[0] &&
            !(item.severity === 'blocker' && item.result === '本镜不适用')).length} / ${benchmarkChecks.length}` : '') :
          '把候选与本镜绑定的参考版本对照，记录你在画面里看到的情况。';
      return checks;
    }
    function show() {
      const nextQcScope = JSON.stringify([scope(record), sourceIdentity(record), returnedIdentity(record)]);
      if (qcScope !== nextQcScope) { qcScope = nextQcScope; qcDraft = null; }
      const nextTimerScope = JSON.stringify([scope(record), signature(record, series, pages, continuityBasis)]);
      if (timerScope !== nextTimerScope) {
        pauseTimer();
        timerScope = nextTimerScope;
        savedReviewMs = current(record, series, pages, continuityBasis, benchmark).reviewMs;
        sessionReviewMs = 0;
        renderTimer();
      }
      baseline = scope(record);
      qcDraft ||= current(record, series, pages, continuityBasis, benchmark).technicalQc;
      renderQc();
      const checks = refreshBindingStatus();
      content.replaceChildren();
      editors = dimensions.map(([id, label, hint]) => {
        const row = document.createElement('div');
        row.className = 'art-review-row';
        const title = document.createElement('label');
        title.textContent = label;
        const select = document.createElement('select');
        for (const state of states) select.add(new Option(state));
        const saved = checks.find(item => item.id === id);
        select.value = saved?.result || states[0];
        title.append(select);
        const note = document.createElement('input');
        note.type = 'text';
        note.maxLength = 240;
        note.placeholder = '记录画面现象';
        note.setAttribute('aria-label', label + '画面观察');
        note.value = saved?.note || '';
        const text = document.createElement('p');
        text.textContent = id === 'light' && record.lighting?.trim()
          ? `本镜灯光要求：${record.lighting.trim()}。逐帧核对脸部亮暗、背景地标与光向。` : hint;
        const markTime = document.createElement('button');
        markTime.type = 'button';
        markTime.className = 'production-action';
        markTime.textContent = '在当前时刻标记此问题';
        markTime.disabled = select.value !== '待返修' || !note.value.trim() || typeof onTimecode !== 'function';
        select.onchange = () => { markTime.disabled = select.value !== '待返修' || !note.value.trim() || typeof onTimecode !== 'function'; };
        note.oninput = () => { markTime.disabled = select.value !== '待返修' || !note.value.trim() || typeof onTimecode !== 'function'; };
        markTime.onclick = () => {
          try { onTimecode(id, label, note.value.trim()); }
          catch (error) { message.textContent = error.message; }
        };
        row.append(title, note, text, markTime);
        content.append(row);
        return { id, select, note };
      });
      benchmarkEditors = [];
      if (benchmark?.checks?.length) {
        const saved = current(record, series, pages, continuityBasis, benchmark).benchmarkChecks;
        const section = document.createElement('details');
        section.className = 'art-review-benchmark';
        const summary = document.createElement('summary');
        const completedCount = () => saved.filter(item => item.result !== states[0] &&
          !(item.severity === 'blocker' && item.result === '本镜不适用')).length;
        summary.textContent = `本镜试镜专项核对 · ${completedCount()} / ${saved.length}`;
        section.append(summary);
        const explanation = document.createElement('p');
        explanation.textContent = '只记录当前候选能直接观察到的结论。待返修项请写清画面现象，可在候选视频当前时刻添加时间码。';
        section.append(explanation);
        for (const definition of benchmark.checks) {
          const prior = saved.find(item => item.id === definition.id);
          const row = document.createElement('article');
          row.className = 'art-review-benchmark-row';
          const title = document.createElement('strong');
          title.textContent = `${definition.severity === 'blocker' ? '阻断项 · ' : '复核项 · '}${definition.check}`;
          const select = document.createElement('select');
          for (const state of states) {
            const option = new Option(state);
            if (definition.severity === 'blocker' && state === '本镜不适用') option.disabled = true;
            select.add(option);
          }
          select.value = prior?.result || states[0];
          const note = document.createElement('input');
          note.type = 'text';
          note.maxLength = 240;
          note.placeholder = select.value === '待返修' ? '写出具体缺陷' : '可选：补充观察';
          note.value = prior?.note || '';
          const timecodes = (prior?.timecodes || []).map(item => ({ ...item }));
          const timecodeList = document.createElement('ul');
          const renderTimecodes = () => {
            timecodeList.replaceChildren();
            for (const [index, item] of timecodes.entries()) {
              const line = document.createElement('li');
              const label = document.createElement('span');
              label.textContent = `${Math.floor(item.sourceMs / 60000).toString().padStart(2, '0')}:` +
                `${Math.floor(item.sourceMs / 1000 % 60).toString().padStart(2, '0')}.` +
                `${String(item.sourceMs % 1000).padStart(3, '0')}${item.note ? ' · ' + item.note : ''}`;
              const handoff = document.createElement('button');
              handoff.type = 'button';
              handoff.textContent = '转为返修批注';
              handoff.disabled = typeof onBenchmarkRepair !== 'function';
              handoff.onclick = () => {
                try {
                  const issue = (item.note || note.value).trim();
                  if (!issue) throw new Error('先写清此验收项看到的问题，再转入返修。');
                  onBenchmarkRepair({ id: definition.id, label: definition.check, issue, sourceMs: item.sourceMs });
                  benchmarkFeedback.textContent = '已打开返修批注，并带入此项时间码和问题描述。';
                } catch (error) { benchmarkFeedback.textContent = error.message; }
              };
              const remove = document.createElement('button');
              remove.type = 'button';
              remove.textContent = '移除';
              remove.setAttribute('aria-label', '移除此项时间码');
              remove.onclick = () => { timecodes.splice(index, 1); renderTimecodes(); };
              line.append(label, handoff, remove);
              timecodeList.append(line);
            }
          };
          renderTimecodes();
          const actions = document.createElement('div');
          actions.className = 'production-picker';
          const mark = document.createElement('button');
          mark.type = 'button';
          mark.textContent = '记候选当前时刻';
          mark.disabled = typeof onBenchmarkTimecode !== 'function' || timecodes.length >= 24;
          mark.onclick = () => {
            try {
              const sourceMs = onBenchmarkTimecode();
              if (!Number.isSafeInteger(sourceMs) || sourceMs < 0 || sourceMs > 3_600_000) throw new Error('候选视频当前时间无效。');
              timecodes.push({ sourceMs, note: note.value.trim().slice(0, 240) });
              renderTimecodes();
              benchmarkFeedback.textContent = '已记录此验收项的候选时间码；保存视觉验收后写入报告。';
            } catch (error) { benchmarkFeedback.textContent = error.message; }
          };
          actions.append(mark);
          row.append(title, select, note, actions, timecodeList);
          section.append(row);
          benchmarkEditors.push({ id: definition.id, label: definition.check, select, note, timecodes });
        }
        const benchmarkFeedback = document.createElement('output');
        benchmarkFeedback.setAttribute('role', 'status');
        section.append(benchmarkFeedback);
        content.append(section);
      }
    }

    function renderQc() {
      qcFindings.replaceChildren();
      if (!qcDraft) { qcStatus.textContent = '尚未附加技术 QC 报告。'; return; }
      const trackDelta = Number.isFinite(qcDraft.summary.audioVideoTrackDurationDelta) ?
        `${qcDraft.summary.audioVideoTrackDurationDelta.toFixed(3)} 秒（仅长度差）` : '未测得';
      qcStatus.textContent = `已绑定当前文件 SHA-256 ${qcDraft.sourceSha256.slice(0, 12)} · ${qcDraft.sizeBytes} 字节 · 自动规则：${qcDraft.summary.errors} 项错误、${qcDraft.summary.warnings} 项提示 · 音画轨长度差 ${trackDelta}；不是画质/同步通过结论。`;
      for (const finding of qcDraft.findings.slice(0, 100)) {
        const row = document.createElement('li');
        row.textContent = `${finding.start.toFixed(2)}–${finding.end.toFixed(2)} 秒 · ${finding.kind} · ${finding.detail}`;
        qcFindings.append(row);
      }
      if (qcDraft.findings.length > 100) {
        const row = document.createElement('li'); row.textContent = `另有 ${qcDraft.findings.length - 100} 项，详见原始 ARC QC JSON。`; qcFindings.append(row);
      }
    }
    qcInput.onchange = async () => {
      const reportFile = qcInput.files?.[0];
      if (!reportFile) return;
      qcInput.disabled = true;
      try {
        if (reportFile.size < 1 || reportFile.size > 1_048_576) throw new Error('ARC QC JSON 必须小于 1 MiB。');
        const candidate = selectedFile();
        const binding = sourceIdentity(record);
        const fingerprint = binding?.[1];
        if (!(candidate instanceof File) || candidate.name !== scope(record).file || !fingerprint?.startsWith('sha256:')) {
          throw new Error('先载入并以完整 SHA-256 核对当前候选视频，再导入 QC 报告。');
        }
        await verify(candidate);
        const localSha = await root.ArcStreamSha256.file(candidate);
        const report = JSON.parse(await reportFile.text());
        qcDraft = parseTechnicalQc(report, localSha, candidate.size);
        if (localSha !== fingerprint.slice(7)) throw new Error('当前视频与已绑定的候选 SHA-256 不一致。');
        renderQc();
        message.textContent = 'ARC QC 已绑定到当前候选；保存视觉验收后会一并记录。';
      } catch (error) { qcDraft = null; renderQc(); message.textContent = error.message; }
      finally { qcInput.disabled = false; qcInput.value = ''; }
    };

    button.onclick = async () => {
      const identity = scope(record);
      const file = selectedFile();
      const plan = signature(record, series, pages, continuityBasis);
      if (!sourceIdentity(record)) {
        message.textContent = '请先点“核对并绑定当前视频”，登记当前文件指纹后再保存视觉验收。';
        return;
      }
      if (!identity.version || !identity.file || file?.name !== identity.file || !same(identity, baseline)) {
        message.textContent = '先填写候选版本及源文件名，再载入对应视频。';
        return;
      }
      const checks = parse(editors.map(({ id, select, note }) => ({ id, result: select.value, note: note.value })));
      const checkedBenchmark = benchmark?.id ? { id: benchmark.id, checks: (benchmarkEditors || []).map(item => ({
        id: item.id, result: item.select.value, note: item.note.value.trim().slice(0, 240),
        timecodes: item.timecodes.slice(0, 24).map(timecode => ({ sourceMs: timecode.sourceMs, note: timecode.note }))
      })) } : undefined;
      const blockerNA = checkedBenchmark?.checks.find(row => row.result === '本镜不适用' &&
        benchmark.checks.some(definition => definition.id === row.id && definition.severity === 'blocker'));
      if (blockerNA) { message.textContent = '阻断项不能标为“本镜不适用”；请确认画面符合，或标记待返修。'; return; }
      const incomplete = missing(editors.map(({ id, select }) => ({ id, result: select.value })));
      if (incomplete.length) {
        message.textContent = `请逐项核对：${incomplete.slice(0, 3).join('、')}${incomplete.length > 3 ? ` 等 ${incomplete.length} 项` : ''}。如不适用，请明确选择“本镜不适用”。`;
        return;
      }
      const openIssue = checks.find(item => item.result === '待返修' && !item.note);
      if (openIssue) { message.textContent = `${openIssue.label}待返修，请写清可见的问题。`; return; }
      const openBenchmarkIssue = checkedBenchmark?.checks.find(item => item.result === '待返修' && !item.note);
      if (openBenchmarkIssue) { message.textContent = '试镜专项有待返修项，请写清可见的问题。'; return; }
      const duration = reviewDuration();
      const reviewMs = Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null;
      button.disabled = true;
      try {
        await verify(file);
        if (!panel.isConnected || !same(identity, scope(record)) || file !== selectedFile() || plan !== signature(record, series, pages, continuityBasis)) {
          throw new Error('候选或参考资料已变更，请重新核对。');
        }
        const rows = read(record).filter(item => !same(item, identity));
        if (rows.length >= limit) throw new Error('本镜已有 60 个候选的美术记录。');
        const prior = record.artReviews;
        record.artReviews = JSON.stringify([...rows, { ...identity, signature: plan, checks,
          ...(reviewMs === null ? {} : { reviewMs }),
          ...(qcDraft ? { technicalQc: qcDraft } : {}),
          ...(checkedBenchmark ? { benchmark: checkedBenchmark } : {}) }]);
        if (save() === false) {
          if (prior === undefined) delete record.artReviews;
          else record.artReviews = prior;
          throw new Error('浏览器未能保存美术验收，请重试。');
        }
        pauseTimer();
        savedReviewMs = reviewMs;
        sessionReviewMs = 0;
        renderTimer();
        show();
        try { onSaved?.(); } catch { /* The saved review remains valid if an optional view cannot refresh. */ }
        message.textContent = '已保存本候选的视觉验收；待返修项仍需按时间码处理或明确批准保留。';
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; }
    };
    show();
    return { panel, refreshBindingStatus, refresh() { if (!same(baseline, scope(record))) { message.textContent = ''; show(); } },
      dispose() { pauseTimer(); timerEvents.abort(); } };
  }

  function example() {
    const panel = document.createElement('details');
    panel.className = 'production-history art-example';
    panel.innerHTML = `
      <summary>视觉验收检查顺序</summary>
      <p>先核角色与服装，再核场景地标、光向、构图、表演和跨帧稳定。发现问题时记录实际时间码与可见现象。</p>`;
    return panel;
  }

  const api = { current, approval, parse, parseBenchmark, parseTechnicalQc, missing, create, example, dimensions, signature, sourceIdentity, returnedIdentity, scriptContext };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcArtReview = api;
})(globalThis);
