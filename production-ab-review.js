(() => {
  const types = {
    step: { title: '落脚', category: '表演', change: '前脚落稳再收后脚，过门槛时脚掌贴地。' },
    turn: { title: '停步转头', category: '表演', change: '先停步稳住重心，再转头看向画外。' },
    doorway: { title: '门框漂移', category: '构图', change: '锁定门框位置与垂线，保持原机位和轴线。' },
    sound: { title: '脚步音画偏移', category: '口型与声音', change: '将脚步瞬态对齐脚掌接地帧；只修声音偏移，不改已通过的画面动作与节奏。' },
    face: { title: '脸型漂移', category: '角色', change: '按定妆保持下颌轮廓、眼距和鼻梁，转头只改变角度。' },
    wardrobe: { title: '衣服变化', category: '角色', change: '保持定妆的服装版型、细节与材质，锁定衣服款式与色相。' },
    light: { title: '灯光跑偏', category: '光色', change: '恢复左上暖主光和右后门缝冷轮廓，维持门框及湿地反光的位置。' }
  };
  const variantKeys = ['A', 'B'];
  const limit = 120;
  const validMs = value => Number.isInteger(value) && value >= 0 && value <= 3_600_000;
  const assetKey = /^[a-f0-9]{64}$/;
  const time = ms => window.arcReviewNotes.timestamp(ms);
  const retryCount = (attempts, id) => Math.max(0,
    attempts.slice(0, attempts.findIndex(item => item.id === id) + 1).filter(item => item.status !== 'rejected').length - 1);
  function frameTimecode(seconds, media) {
    const rawMs = Math.floor(seconds * 1000);
    if (media?.source === 'mp4-stts' && media.frameRateMode === 'constant' &&
        Number.isFinite(media.fps) && media.fps >= 1 && media.fps <= 240) {
      const frameIndex = Math.max(0, Math.round(seconds * media.fps));
      return { startMs: Math.round(frameIndex * 1000 / media.fps), frameIndex, fps: media.fps,
        timecodeBasis: 'measured-cfr-frame-grid' };
    }
    return { startMs: rawMs, timecodeBasis: 'player-time' };
  }
  const validFrameEvidence = (mark, endpoint = false) => {
    const indexKey = endpoint ? 'endFrameIndex' : 'frameIndex';
    const hasEvidence = Object.hasOwn(mark, indexKey) || Object.hasOwn(mark, 'fps');
    if (!hasEvidence) return !mark.timecodeBasis || mark.timecodeBasis === 'player-time';
    const index = mark[indexKey];
    const ms = endpoint ? mark.endMs : mark.startMs;
    return mark.timecodeBasis === 'measured-cfr-frame-grid' && Number.isSafeInteger(index) && index >= 0 &&
      Number.isFinite(mark.fps) && mark.fps >= 1 && mark.fps <= 240 &&
      ms === Math.round(index * 1000 / mark.fps);
  };

  function read(pair) {
    if (!Array.isArray(pair?.reviewMarks)) return [];
    return pair.reviewMarks.slice(0, limit).filter(mark => mark && variantKeys.includes(mark.variant) &&
      typeof mark.id === 'string' && mark.id.length <= 64 && typeof mark.jobId === 'string' &&
      assetKey.test(mark.assetKey || '') && validMs(mark.startMs) && validFrameEvidence(mark) &&
      (mark.kind === 'range' ? validMs(mark.endMs) && mark.endMs - mark.startMs >= 250 &&
        validFrameEvidence(mark, true) && (mark.timecodeBasis !== 'measured-cfr-frame-grid' || mark.fps === mark.endFps) :
        Object.hasOwn(types, mark.kind) && typeof mark.change === 'string' && mark.change.trim() &&
        mark.change.length <= 260));
  }

  const belongs = (entry, variant, run) =>
    entry.variant === variant && entry.jobId === run?.id && entry.assetKey === run.output?.assetKey;

  function report(pair) {
    return read(pair).map(entry => {
      const run = pair.attempts[entry.variant].find(item => belongs(entry, entry.variant, item));
      return { ...entry, title: entry.kind === 'range' ? '可用片段' : types[entry.kind].title,
        timing: run ? { queueMs: run.timing?.queueMs ?? null, executionMs: run.timing?.executionMs ?? null,
          retries: retryCount(pair.attempts[entry.variant], run.id) } : null };
    });
  }

  function mount({ pair, latest, players, comparison, save, adopt, art = false, sourceMatches, onChange = () => {} }) {
    const panel = document.createElement('details');
    panel.className = 'production-history ab-timeline-review';
    panel.open = true;
    panel.innerHTML = `
      <summary>A/B 时间轴审片</summary>
      <div class="production-picker">
        <label>标记到<select data-track><option value="A">A 文字动作</option><option value="B" selected>B 白模动作</option></select></label>
        <div data-issue-tools class="production-picker"></div>
        <button type="button" data-start>记可用入点</button>
        <button type="button" data-end>保存可用段</button>
      </div>
      <label>具体修改（可选）<input maxlength="260" placeholder="留空使用该问题的默认修改"></label>
      <div data-tracks></div>
      <ul data-marks></ul>
      <button type="button" data-repair>准备本镜返修</button>
      <output role="status"></output>`;
    const track = panel.querySelector('[data-track]');
    const issueTools = panel.querySelector('[data-issue-tools]');
    for (const kind of art ? ['face', 'wardrobe', 'light', 'step'] : ['step', 'turn', 'doorway', 'light', 'sound']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.issue = kind;
      button.textContent = '标' + types[kind].title;
      issueTools.append(button);
    }
    const start = panel.querySelector('[data-start]');
    const end = panel.querySelector('[data-end]');
    const change = panel.querySelector('input');
    const message = panel.querySelector('output');
    const repair = panel.querySelector('[data-repair]');
    const marks = panel.querySelector('[data-marks]');
    const tracks = panel.querySelector('[data-tracks]');
    const tools = [...panel.querySelectorAll('[data-issue]')];
    const offsets = comparison.panel.querySelectorAll('input[type="number"]');
    const listeners = new AbortController();
    const events = { signal: listeners.signal };
    let rangeStart;
    let busy = false;
    let renderKey;

    function scope() {
      const variant = track.value;
      const player = players[variantKeys.indexOf(variant)];
      const run = latest(variant);
      return { variant, run, player, ready: Boolean(run?.output?.assetKey &&
        (sourceMatches ? sourceMatches(player, run) : player.getAttribute('src') === run.output.url) &&
        (!art || comparison.coordinates().linked) && player.readyState >= 1 && Number.isFinite(player.duration) &&
        window.arcProductionQuality.matchesVideo(player, run.outputContract)) };
    }

    function point(snapToMeasuredFrame = false) {
      const current = scope();
      if (!current.ready || current.player.seeking) throw new Error('请先停在所选版本已经载入的画面。');
      comparison.pauseForEvidence();
      const media = current.run.media?.assetKey === current.run.output.assetKey ? current.run.media : null;
      return { variant: current.variant, jobId: current.run.id, assetKey: current.run.output.assetKey,
        ...frameTimecode(current.player.currentTime, snapToMeasuredFrame ? media : null) };
    }

    function commit(next) {
      const previous = pair.reviewMarks;
      pair.reviewMarks = next;
      let saved;
      try { saved = save(); }
      finally {
        if (!saved) {
          if (previous === undefined) delete pair.reviewMarks;
          else pair.reviewMarks = previous;
        }
      }
      if (saved) { onChange(); return; }
      throw new Error('审片记录未保存。');
    }

    function add(value) {
      const entries = read(pair);
      if (entries.length >= limit) throw new Error('本组对照的审片记录已达上限。');
      if (entries.some(item => belongs(item, value.variant, latest(value.variant)) && item.kind === value.kind &&
          item.startMs === value.startMs && item.endMs === value.endMs)) throw new Error('这个位置已有相同标记。');
      if (value.kind !== 'range' && entries.filter(item => item.kind !== 'range' &&
          belongs(item, value.variant, latest(value.variant))).length >= 6) {
        throw new Error('每个回片最多保留六条问题。');
      }
      commit([...entries, { id: crypto.randomUUID(), ...value }]);
    }

    function press(action) {
      try { action(); } catch (error) { message.textContent = error.message; }
      refresh();
    }

    for (const button of tools) button.onclick = () => press(() => {
      const kind = button.dataset.issue;
      const evidence = point(true);
      add({ ...evidence, kind, change: change.value.trim() || types[kind].change });
      change.value = '';
      message.textContent = evidence.timecodeBasis === 'measured-cfr-frame-grid' ?
        `已记录${types[kind].title}问题 · 吸附到实测第 ${evidence.frameIndex} 帧（${evidence.fps} fps）。` :
        `已记录${types[kind].title}问题 · 使用播放器时间码；回片帧率未核验，切点仍须按帧复核。`;
    });
    start.onclick = () => press(() => {
      rangeStart = point();
      message.textContent = `已记 ${rangeStart.variant} 入点 ${time(rangeStart.startMs)}${rangeStart.frameIndex !== undefined ?
        ` · 第 ${rangeStart.frameIndex} 帧` : ' · 播放器时间码'}，定位出点后保存。`;
    });
    end.onclick = () => press(() => {
      const edge = point();
      if (!rangeStart || edge.jobId !== rangeStart.jobId || edge.assetKey !== rangeStart.assetKey ||
          edge.variant !== rangeStart.variant || edge.startMs - rangeStart.startMs < 250 ||
          edge.timecodeBasis !== rangeStart.timecodeBasis ||
          (edge.timecodeBasis === 'measured-cfr-frame-grid' && edge.fps !== rangeStart.fps)) {
        throw new Error('请选择同一回片，出点须在入点之后至少 0.25 秒。');
      }
      const rangeBasis = rangeStart;
      add({ ...rangeStart, endMs: edge.startMs, ...(edge.frameIndex !== undefined ?
        { endFrameIndex: edge.frameIndex, endFps: edge.fps } : {}), kind: 'range' });
      rangeStart = null;
      message.textContent = rangeBasis.timecodeBasis === 'measured-cfr-frame-grid' ?
        `已保存可用片段 · ${rangeBasis.fps} fps 帧格。` : '已保存可用片段 · 播放器时间码，导出切点时仍须按帧吸附。';
    });

    function link(entry, label, current) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.disabled = !current;
      button.onclick = () => press(() => {
        comparison.seekTrack(variantKeys.indexOf(entry.variant), entry.startMs / 1000);
      });
      return button;
    }

    function refresh() {
      const current = scope();
      panel.hidden = !variantKeys.some(variant => latest(variant));
      const entries = report(pair);
      const selected = entries.filter(item => belongs(item, current.variant, current.run));
      for (const button of [...tools, start]) button.disabled = !current.ready || busy;
      end.disabled = !current.ready || busy || !rangeStart || !belongs(rangeStart, current.variant, current.run);
      repair.disabled = busy || !current.ready || !selected.some(item => item.kind !== 'range');
      const view = comparison.coordinates();
      const key = JSON.stringify([entries, view.linked, view.starts, view.length,
        players.map((player, index) => [player.duration, latest(variantKeys[index])?.id])]);
      if (key === renderKey) return;
      renderKey = key;
      tracks.replaceChildren();
      marks.replaceChildren();
      for (const [index, variant] of variantKeys.entries()) {
        const line = document.createElement('div');
        line.className = 'ab-marker-row';
        const label = document.createElement('span');
        label.textContent = variant;
        const rail = document.createElement('div');
        rail.className = 'ab-marker-rail';
        const origin = view.linked ? view.starts[index] : 0;
        const length = view.linked ? view.length : players[index].duration;
        for (const entry of entries.filter(item => belongs(item, variant, latest(variant)))) {
          const position = (entry.startMs / 1000 - origin) / length * 100;
          if (!Number.isFinite(position) || position < 0 || position > 100) continue;
          const frameLabel = Number.isSafeInteger(entry.frameIndex) ? ` · 第 ${entry.frameIndex} 帧 @ ${entry.fps} fps` : '';
          const label = `${variant} ${time(entry.startMs)} ${entry.title}${frameLabel}`;
          const marker = link(entry, entry.kind === 'range' ? '━' : '●', true);
          marker.title = label;
          marker.setAttribute('aria-label', label);
          marker.style.left = position + '%';
          if (entry.kind === 'range') {
            const width = (entry.endMs - entry.startMs) / 1000 / length * 100;
            marker.style.width = Math.min(width, 100 - position) + '%';
            marker.classList.add('ab-marker-segment');
          }
          rail.append(marker);
        }
        line.append(label, rail);
        tracks.append(line);
      }
      for (const entry of entries) {
        const row = document.createElement('li');
        const active = belongs(entry, entry.variant, latest(entry.variant));
        const frameLabel = Number.isSafeInteger(entry.frameIndex) ? ` · 第 ${entry.frameIndex} 帧 @ ${entry.fps} fps` :
          entry.timecodeBasis === 'player-time' ? ' · 帧率未核验' : '';
        const title = `${entry.variant} · ${time(entry.startMs)}${entry.kind === 'range' ? '–' + time(entry.endMs) : ''} · ${entry.title}${frameLabel}`;
        const copy = document.createElement('span');
        const timed = entry.timing;
        const duration = ms => Number.isFinite(ms) ? (ms / 1000).toFixed(2) + ' 秒' : '待记录';
        copy.textContent = [entry.change, active ? '' : '历史回片',
          timed ? `排队 ${duration(timed.queueMs)} · 执行 ${duration(timed.executionMs)} · 重试 ${timed.retries} 次` : '']
          .filter(Boolean).join(' · ');
        row.append(link(entry, title, active), copy);
        if (entry.kind === 'range' && active) {
          const use = document.createElement('button');
          use.type = 'button';
          use.textContent = '用此段审片';
          use.onclick = () => handoff(entry.variant, { range: entry });
          row.append(use);
        }
        marks.append(row);
      }
    }

    async function handoff(variant, details) {
      if (busy) return;
      busy = true;
      refresh();
      try { await adopt(variant, details); }
      catch (error) { message.textContent = error.message; }
      finally { busy = false; refresh(); }
    }

    repair.onclick = () => {
      const current = scope();
      const entries = read(pair).filter(item => belongs(item, current.variant, current.run));
      const issues = entries.filter(item => item.kind !== 'range')
        .map(item => ({ category: types[item.kind].category, evidence: 'frame', track: 'candidate', sourceMs: item.startMs,
          issue: types[item.kind].title, change: item.change }));
      const keep = entries.filter(item => item.kind === 'range').slice(0, 5)
        .map(item => `保留 ${time(item.startMs)}–${time(item.endMs)} 的画面表演、构图、光色与原声`);
      if (issues.length) handoff(current.variant, { repair: { summary: '仅处理此回片已标记的问题', issues, keep } });
    };
    track.onchange = refresh;
    comparison.panel.addEventListener('click', () => refresh(), events);
    for (const offset of offsets) offset.addEventListener('change', refresh, events);
    for (const player of players) {
      for (const event of ['loadedmetadata', 'emptied', 'error']) player.addEventListener(event, refresh, events);
    }
    refresh();
    return { panel, refresh, dispose: () => listeners.abort() };
  }

  const api = { mount, report, retryCount, frameTimecode, validFrameEvidence };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.arcABReview = api;
})();
