((root) => {
  const labels = { step: '落脚', turn: '停步转头', doorway: '门框漂移', range: '原可用片段',
    face: '脸型漂移', wardrobe: '衣服变化', light: '灯光跑偏', sound: '脚步音画偏移' };
  const sha = /^[a-f0-9]{64}$/;
  const fileDigest = /^sha256-tree-v1:[a-f0-9]{64}$/;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const validMs = n => Number.isInteger(n) && n >= 0 && n <= 3_600_000;
  const isMedia = item => item && uuid.test(item.jobId || '') && sha.test(item.assetKey || '') &&
    Number.isInteger(item.index) && item.index >= 0 && item.index <= 999 &&
    typeof item.name === 'string' && /\.(mp4|webm|mov)$/i.test(item.name) && !/[\\/:\x00-\x1f]/.test(item.name) &&
    typeof item.version === 'string' && Boolean(item.version);
  const sameOutputBytes = (first, second) => {
    const hasIdentity = first?.sha256 !== undefined || second?.sha256 !== undefined ||
      first?.sizeBytes !== undefined || second?.sizeBytes !== undefined;
    return !hasIdentity || (sha.test(first?.sha256 || '') && sha.test(second?.sha256 || '') &&
      Number.isSafeInteger(first?.sizeBytes) && first.sizeBytes > 0 &&
      Number.isSafeInteger(second?.sizeBytes) && second.sizeBytes > 0 &&
      first.sha256 === second.sha256 && first.sizeBytes === second.sizeBytes);
  };
  const sameMedia = (first, second) => isMedia(first) && isMedia(second) && first.jobId === second.jobId &&
    first.index === second.index && first.name === second.name && first.version === second.version &&
    first.assetKey === second.assetKey && sameOutputBytes(first, second);
  function currentGeneratedMedia(record) {
    try {
      const item = JSON.parse(record.generatedCandidate || 'null');
      return isMedia(item) && item.version === record.version && item.name === record.file ? item : null;
    } catch { return null; }
  }
  const validRange = mark => validMs(mark.startMs) && validMs(mark.endMs) && mark.endMs - mark.startMs >= 250;
  const url = item => '/api/generation/' + item.jobId + '/video/' + item.index +
    '?' + new URLSearchParams({ file: item.name, asset: item.assetKey });

  function read(record) {
    try {
      const value = JSON.parse(record.abRepairReview || 'null');
      if (!isMedia(value?.candidate) || !isMedia(value.origin) || !Array.isArray(value.marks) ||
          !value.marks.length || value.marks.length > 120 || value.origin.jobId === value.candidate.jobId ||
          new Set(value.marks.map(mark => mark?.id)).size !== value.marks.length ||
          !value.marks.every(mark => mark && typeof mark.id === 'string' && uuid.test(mark.id) &&
            Object.hasOwn(labels, mark.kind) && validMs(mark.startMs) &&
            (mark.kind !== 'range' || validRange(mark))) || !value.checks || Array.isArray(value.checks) ||
          typeof value.checks !== 'object') return null;
      return value;
    } catch { return null; }
  }

  function attach(record, candidate, returned, target = record) {
    const previous = record.abRepairReview;
    try {
      if (candidate?.version !== target?.version || candidate?.name !== (target?.file || target?.name)) {
        throw new Error('返修回片已不是当前镜头版本，请重新载入。');
      }
      if (target?.generatedCandidate && !sameMedia(candidate, target.generatedCandidate)) {
        throw new Error('返修回片资产与当前生成任务不符，请重新载入。');
      }
      record.abRepairReview = JSON.stringify({ candidate, origin: returned.origin, marks: returned.marks, checks: {} });
      if (!read(record)) throw new Error('返修回片与原回片、原时间码无法对应。');
    } catch (error) {
      if (previous === undefined) delete record.abRepairReview;
      else record.abRepairReview = previous;
      throw error;
    }
  }

  function approval(record, binding) {
    if (!record.abRepairReview) return { ready: true };
    const value = read(record);
    if (!value || value.candidate.version !== record.version || value.candidate.name !== record.file ||
        !sameMedia(value.candidate, currentGeneratedMedia(record)) ||
        !fileDigest.test(binding?.contentDigest || '')) return { ready: false };
    return { ready: value.marks.every(mark => {
      const check = value.checks[mark.id];
      return check?.pass === true && check.candidateSha256 === binding.contentDigest &&
        fileDigest.test(check.originSha256 || '') && validMs(check.candidateMs) &&
        (mark.kind !== 'range' || validRange({ startMs: check.candidateMs, endMs: check.candidateEndMs }));
    }) };
  }

  function patchIntervals(record, original, binding, patches) {
    const value = read(record);
    const ranges = patches || value?.patches;
    const sourceFps = original?.fps;
    const candidateFps = original?.candidateFps;
    const sourceCadenceVerified = original?.fpsEvidenceSource === 'mp4-stts' && original?.frameRateMode === 'constant';
    const candidateCadenceVerified = original?.candidateFpsEvidenceSource === 'mp4-stts' &&
      original?.candidateFrameRateMode === 'constant';
    if (!value || value.candidate.version !== record.version || value.candidate.name !== record.file ||
        !sameMedia(value.candidate, currentGeneratedMedia(record)) ||
        !fileDigest.test(binding?.contentDigest || '') ||
        original?.file !== value.origin.name || !fileDigest.test(original.source?.contentDigest || '') ||
        !Array.isArray(ranges) || !ranges.length || ranges.length > 12) {
      throw new Error('请先确认旧通过版、新版指纹和局部换镜区间。');
    }
    if (![sourceFps, candidateFps].every(fps => Number.isFinite(fps) && fps >= 1 && fps <= 240) ||
        !sourceCadenceVerified || !candidateCadenceVerified) {
      throw new Error('缺少旧版或新版绑定同一回片的 MP4 恒定帧率证据，不能安全对齐局部切点。');
    }
    const ordered = [...ranges].sort((a, b) => a?.oldInMs - b?.oldInMs);
    for (const [index, item] of ordered.entries()) {
      const { oldInMs, oldOutMs, newInMs, motion, light, audio } = item || {};
      const sourceFrameAligned = ms => Math.abs((ms - original.start * 1000) * sourceFps / 1000 -
        Math.round((ms - original.start * 1000) * sourceFps / 1000)) < .04;
      const candidateFrameAligned = ms => Math.abs(ms * candidateFps / 1000 - Math.round(ms * candidateFps / 1000)) < .04;
      if (![oldInMs, oldOutMs, newInMs].every(validMs) || oldOutMs - oldInMs < 1000 / sourceFps ||
          !sourceFrameAligned(oldInMs) || !sourceFrameAligned(oldOutMs) ||
          !candidateFrameAligned(newInMs) || !candidateFrameAligned(newInMs + oldOutMs - oldInMs) ||
          oldInMs <= original.start * 1000 || oldOutMs >= original.end * 1000 ||
          (index && ordered[index - 1].oldOutMs >= oldInMs) || motion !== true || light !== true || audio !== true ||
          item.originalDigest !== original.source.contentDigest || item.candidateDigest !== binding.contentDigest) {
        throw new Error('局部区间、接缝复核或源文件身份无效，请重新核对。');
      }
      if (value.marks.some(mark => mark.kind === 'range' && mark.startMs < oldOutMs && mark.endMs > oldInMs)) {
        throw new Error('局部替换碰到已锁定的可用段，请缩小区间。');
      }
      const issues = value.marks.filter(mark => mark.kind !== 'range' && mark.startMs >= oldInMs && mark.startMs < oldOutMs);
      if (!issues.length || issues.some(mark => {
        const checked = value.checks[mark.id];
        return checked?.pass !== true || !validMs(checked.candidateMs) || checked.originSha256 !== item.originalDigest ||
          checked.candidateSha256 !== item.candidateDigest ||
          Math.abs(checked.candidateMs - mark.startMs - (newInMs - oldInMs)) > 1;
      })) throw new Error('区间必须覆盖已修复问题，且每条问题都要使用同一个新旧时间偏移。');
    }
    return ordered;
  }

  function create(record, actions) {
    const value = read(record);
    if (!value || value.candidate.version !== record.version || value.candidate.name !== record.file ||
        !sameMedia(value.candidate, currentGeneratedMedia(record))) return null;
    const panel = document.createElement('section');
    panel.className = 'production-history ab-return-review';
    panel.innerHTML = `
      <div class="production-picker">
        <button type="button" data-load>载入新旧回片</button>
        <details class="shot-review-offset"><summary>调整时间对齐</summary>
          <label>新版时间偏移（秒）<input type="number" value="0" step="0.001" min="-15" max="15"></label>
        </details>
      </div>
      <div data-playback></div>
      <output role="status"></output>
      <h4 data-progress>时间码检查</h4>
      <ul></ul>`;
    const status = panel.querySelector('output');
    const list = panel.querySelector('ul');
    const load = panel.querySelector('[data-load]');
    const playback = panel.querySelector('[data-playback]');
    const rail = document.createElement('div');
    rail.className = 'shot-review-rail';
    rail.setAttribute('role', 'group');
    rail.setAttribute('aria-label', '旧版时间码标记');
    rail.hidden = true;
    playback.append(rail);
    const offset = panel.querySelector('input');
    const timestamp = root.arcReviewNotes.timestamp;
    const progress = panel.querySelector('[data-progress]');
    let loaded, active, loading = false;
    const controller = new AbortController();
    let patchList;

    async function fileFor(item) {
      const response = await fetch(url(item), { cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('video/')) {
        throw new Error('找不到回片 ' + item.name);
      }
      return new File([await response.blob()], item.name, { type: response.headers.get('content-type') });
    }

    function act(text, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.onclick = () => {
        try { handler(); } catch (error) { status.textContent = error.message; }
      };
      return button;
    }

    function sourcesReady() {
      return loaded && actions.sources().every((file, index) => file === loaded.files[index]) &&
        actions.players.every(player => player.readyState >= 1);
    }

    function jump(mark) {
      if (!sourcesReady()) throw new Error('请先载入这次返修对应的新旧回片。');
      const offsetMs = Math.round(offset.valueAsNumber * 1000);
      if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > 15000) throw new Error('请填写有效的新版时间偏移。');
      const candidateMs = mark.startMs + offsetMs;
      const oldTime = mark.startMs / 1000;
      const newTime = candidateMs / 1000;
      const players = actions.players;
      const remaining = Math.min(players[0].duration - newTime, players[1].duration - oldTime);
      const duration = mark.kind === 'range' ? (mark.endMs - mark.startMs) / 1000 : remaining;
      if (!validMs(candidateMs) || duration < .02 || duration - remaining > .001) {
        throw new Error('对齐后的位置或片段超出回片时间，请核对时间偏移。');
      }
      actions.sync(newTime, oldTime, duration);
      active = { mark, candidateMs, offsetMs };
      status.textContent = mark.kind === 'range' ? '已同步原可用段，播放检查整段后再下结论。' :
        '已同步到这条问题。可用同步播放控件查看后续动作。';
    }

    function fullRange() {
      if (!sourcesReady()) throw new Error('请先载入两版。');
      const shift = offset.valueAsNumber;
      if (!Number.isFinite(shift) || Math.abs(shift) > 15) throw new Error('请填写有效的新版时间偏移。');
      const oldStart = Math.max(0, -shift);
      const newStart = Math.max(0, shift);
      const length = Math.min(actions.players[0].duration - newStart, actions.players[1].duration - oldStart);
      actions.sync(newStart, oldStart, length);
      active = null;
    }

    function recordCheck(mark, pass) {
      const current = read(record);
      const timing = actions.coordinates();
      if (!sourcesReady() || !active || active.mark.id !== mark.id ||
          Math.round(offset.valueAsNumber * 1000) !== active.offsetMs ||
          !timing.linked || Math.abs(timing.starts[0] * 1000 - active.candidateMs) > 1 ||
          Math.abs(timing.starts[1] * 1000 - mark.startMs) > 1 ||
          actions.players.some(player => player.seeking || player.readyState < 2) ||
          !sameMedia(current?.candidate, currentGeneratedMedia(record)) || !sameMedia(current?.candidate, value.candidate) ||
          record.version !== value.candidate.version ||
          record.file !== value.candidate.name) throw new Error('请先点此条的「同步看」，等新旧画面就绪。');
      if (actions.binding()?.contentDigest !== loaded.digests[0]) throw new Error('请先核对并绑定当前新版视频。');
      actions.pause();
      const previous = record.abRepairReview;
      const previousVerdict = record.verdict;
      const check = { pass, candidateMs: active.candidateMs, candidateSha256: loaded.digests[0],
        originSha256: loaded.digests[1], ...(mark.kind === 'range' ?
          { candidateEndMs: mark.endMs + active.offsetMs } : {}) };
      current.checks[mark.id] = check;
      record.abRepairReview = JSON.stringify(current);
      if (record.verdict === '通过') record.verdict = '待审';
      if (actions.save() === false) {
        record.abRepairReview = previous;
        record.verdict = previousVerdict;
        throw new Error('复核结论未保存。');
      }
      actions.onChange(previousVerdict);
      render();
      list.querySelector('[data-mark-id="' + mark.id + '"] button')?.focus();
      status.textContent = '已记录 · ' + (pass ? '通过' : '需返修');
    }

    function render() {
      list.replaceChildren();
      rail.replaceChildren();
      const duration = sourcesReady() ? actions.players[1].duration * 1000 : 0;
      rail.hidden = !duration;
      const current = read(record);
      const marks = current?.marks || value.marks;
      let passed = 0;
      for (const mark of [...marks].sort((a, b) => a.startMs - b.startMs)) {
        const range = mark.kind === 'range';
        const row = document.createElement('li');
        row.dataset.returnKind = mark.kind;
        row.dataset.markId = mark.id;
        const title = document.createElement('strong');
        title.textContent = labels[mark.kind] + ' · ' + timestamp(mark.startMs) +
          (range ? '–' + timestamp(mark.endMs) : '');
        const result = document.createElement('span');
        result.dataset.returnResult = '';
        const checked = current?.checks[mark.id];
        if (checked && checked.candidateSha256 === actions.binding()?.contentDigest) {
          if (checked.pass) passed++;
          const outcome = checked.pass ? (range ? '保留完好' : '已修复') : (range ? '片段受损' : '仍存在');
          result.textContent = outcome + ' · 新版 ' + timestamp(checked.candidateMs) +
            (range ? '–' + timestamp(checked.candidateEndMs) : '');
        } else result.textContent = '待复核';
        const buttons = document.createElement('div');
        buttons.className = 'production-picker';
        buttons.append(act('同步看', () => jump(mark)),
          act(range ? '保留完好' : '已修复', () => recordCheck(mark, true)),
          act(range ? '片段受损' : '仍存在', () => recordCheck(mark, false)));
        if (mark.addedInReturn) buttons.append(act('撤销标记', () => removeMark(mark)));
        row.append(title, result, buttons);
        list.append(row);
        if (duration && mark.startMs < duration) {
          const pin = act('', () => jump(mark));
          pin.title = title.textContent;
          pin.setAttribute('aria-label', title.textContent);
          if (range) {
            pin.classList.add('is-range');
            pin.style.width = ((Math.min(mark.endMs, duration) - mark.startMs) / duration * 100) + '%';
          } else if (checked?.pass && checked.candidateSha256 === actions.binding()?.contentDigest) {
            pin.classList.add('is-resolved');
          }
          pin.style.left = (mark.startMs / duration * 100) + '%';
          rail.append(pin);
        }
      }
      progress.textContent = `时间码检查 · ${passed}/${marks.length} 项通过`;
      if (patchList) {
        const patches = Array.isArray(current?.patches) ? current.patches : [];
        patchList.replaceChildren(...patches.map((patch, index) => {
          const row = document.createElement('li');
          const label = document.createElement('span');
          label.textContent = `旧版 ${timestamp(patch.oldInMs)}–${timestamp(patch.oldOutMs)} → 新版 ${timestamp(patch.newInMs)} · 动作、光色、脚步已核对`;
          row.append(label, act('移除区间', () => savePatches(current.patches.filter((_, entry) => entry !== index))));
          return row;
        }));
      }
    }

    function oldPlayhead() {
      if (!sourcesReady() || !actions.coordinates().linked ||
          actions.players.some(player => player.seeking || player.readyState < 2)) {
        throw new Error('请先载入两版并停在要记录的画面。');
      }
      actions.pause();
      return Math.round(actions.players[1].currentTime * 1000);
    }

    function currentReview() {
      const current = read(record);
      if (!current || !sameMedia(current.candidate, currentGeneratedMedia(record)) || !sameMedia(current.candidate, value.candidate) ||
          current.candidate.version !== record.version || current.candidate.name !== record.file) {
        throw new Error('当前候选已变更，请重新载入新旧回片。');
      }
      return current;
    }

    function saveMarks(current) {
      const previous = record.abRepairReview;
      const previousVerdict = record.verdict;
      record.abRepairReview = JSON.stringify(current);
      if (record.verdict === '通过') record.verdict = '待审';
      if (actions.save() === false) {
        record.abRepairReview = previous;
        record.verdict = previousVerdict;
        throw new Error('时间码未保存。');
      }
      active = null;
      actions.onChange(previousVerdict);
      render();
    }

    function addMark(kind, startMs, endMs) {
      const current = currentReview();
      if (current.marks.length >= 120) throw new Error('本镜最多保存 120 条时间码。');
      if (!validMs(startMs) || (kind === 'range' && !validRange({ startMs, endMs }))) {
        throw new Error('可用段至少 0.25 秒，结束须晚于起点。');
      }
      if (current.marks.some(mark => mark.kind === kind && mark.startMs === startMs && mark.endMs === endMs)) {
        throw new Error('这个时间码已经记录。');
      }
      if (kind === 'range' && (current.patches || []).some(patch =>
          patch.oldInMs < endMs && patch.oldOutMs > startMs)) throw new Error('该段与已锁定的换镜区间冲突。');
      current.marks.push({ id: crypto.randomUUID(), kind, startMs, addedInReturn: true,
        ...(kind === 'range' ? { endMs } : {}) });
      saveMarks(current);
      status.textContent = kind === 'range' ?
        `已锁定旧版 ${timestamp(startMs)}–${timestamp(endMs)}，此段继续使用旧原片。` :
        `已标记旧版 ${timestamp(startMs)} · ${labels[kind]}`;
    }

    function removeMark(mark) {
      const current = currentReview();
      if (mark.kind !== 'range' && (current.patches || []).some(patch =>
          patch.oldInMs <= mark.startMs && patch.oldOutMs > mark.startMs)) {
        throw new Error('此标记在已锁定的换镜区间内。请先移除对应换镜区间。');
      }
      current.marks = current.marks.filter(item => item.id !== mark.id);
      delete current.checks[mark.id];
      saveMarks(current);
      status.textContent = '已撤销这条标记。';
    }

    function savePatches(patches) {
      const current = read(record);
      if (!current || !sameMedia(current.candidate, currentGeneratedMedia(record)) || !sameMedia(current.candidate, value.candidate)) {
        throw new Error('当前候选已变更，请重新载入新旧回片。');
      }
      const previous = record.abRepairReview;
      record.abRepairReview = JSON.stringify({ ...current, patches });
      if (actions.save() === false) {
        record.abRepairReview = previous;
        throw new Error('局部换镜区间未保存。');
      }
      render();
    }

    if (actions.patchContext) {
      const markers = document.createElement('div');
      markers.className = 'production-picker shot-review-markers';
      const issue = document.createElement('select');
      issue.setAttribute('aria-label', '问题类型');
      for (const [kind, label] of Object.entries(labels)) {
        if (kind !== 'range') issue.add(new Option(label, kind));
      }
      let keepFrom = null;
      const from = act('设可用起点', () => {
        keepFrom = { time: oldPlayhead(), files: loaded.files };
        from.textContent = '可用起点 ' + timestamp(keepFrom.time);
        status.textContent = '拖动同步进度到这段的结束位置，再锁定可用段。';
      });
      const keep = act('锁定可用段', () => {
        if (!keepFrom || keepFrom.files !== loaded?.files) throw new Error('请先设置可用起点。');
        addMark('range', keepFrom.time, oldPlayhead());
        keepFrom = null;
        from.textContent = '设可用起点';
      });
      const full = act('回到整镜', fullRange);
      markers.append(issue, act('标记此刻', () => addMark(issue.value, oldPlayhead())), from, keep, full);
      playback.append(markers);
      const patch = document.createElement('details');
      patch.className = 'production-optional-field ab-local-patch';
      patch.innerHTML = `
        <summary>局部换镜 · 保留旧原片</summary>
        <p>填写旧版中的问题区间。已锁定可用段继续引用旧文件。</p>
        <div class="production-picker">
          <label>旧版换入点（秒）<input type="number" data-in min="0" step="0.001"></label>
          <button type="button" data-in-now>取当前入点</button>
          <label>旧版换出点（秒）<input type="number" data-out min="0" step="0.001"></label>
          <button type="button" data-out-now>取当前出点</button>
        </div>
        <div class="production-picker">
          <button type="button" data-first>同步看换入接缝</button>
          <button type="button" data-last>同步看换出接缝</button>
        </div>
        <div class="production-picker">
          <label><input type="checkbox" data-motion>动作接上</label>
          <label><input type="checkbox" data-light>光色接上</label>
          <label><input type="checkbox" data-audio>脚步声接上</label>
          <button type="button" data-commit>锁定局部换镜</button>
          <button type="button" class="production-action" data-export>验收并导出 ARC 局部换镜清单</button>
        </div><output role="status"></output><ul></ul>`;
      patchList = patch.querySelector('ul');
      const patchStatus = patch.querySelector('output');
      const report = message => {
        patchStatus.textContent = message;
        status.textContent = message;
      };
      const cutIn = patch.querySelector('[data-in]');
      const cutOut = patch.querySelector('[data-out]');
      const flags = ['motion', 'light', 'audio'].map(key => patch.querySelector('[data-' + key + ']'));
      const viewed = new Set();
      function clearSeams() { viewed.clear(); flags.forEach(flag => { flag.checked = false; }); }
      for (const [edge, input] of [['in', cutIn], ['out', cutOut]]) {
        patch.querySelector('[data-' + edge + '-now]').onclick = () => {
          try {
            input.value = (oldPlayhead() / 1000).toFixed(3);
            clearSeams();
          } catch (error) { report(error.message); }
        };
      }
      for (const control of [cutIn, cutOut, offset]) control.addEventListener('input', clearSeams);

      function draft() {
        if (!sourcesReady()) throw new Error('请先载入并绑定本次的新旧回片。');
        const original = actions.patchContext();
        const snap = input => {
          const base = original.start * 1000;
          const fps = original.fps;
          if (!Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('缺少旧通过版实测帧率，不能吸附切点。');
          return Math.round(base + Math.round((input.valueAsNumber * 1000 - base) * fps / 1000) * 1000 / fps);
        };
        const oldInMs = snap(cutIn), oldOutMs = snap(cutOut);
        const delta = Math.round(offset.valueAsNumber * 1000);
        const item = { oldInMs, oldOutMs, newInMs: oldInMs - Math.round(original.start * 1000) + delta,
          motion: true, light: true, audio: true,
          originalDigest: loaded.digests[1], candidateDigest: loaded.digests[0] };
        patchIntervals(record, original, actions.binding(), [item]);
        if (item.newInMs + oldOutMs - oldInMs > actions.players[0].duration * 1000) throw new Error('新版区间超出回片时长。');
        return { item, original, delta };
      }
      for (const [selector, edge] of [['[data-first]', 'in'], ['[data-last]', 'out']]) {
        patch.querySelector(selector).onclick = () => {
          try {
            const { item, original, delta } = draft();
            cutIn.value = (item.oldInMs / 1000).toFixed(3);
            cutOut.value = (item.oldOutMs / 1000).toFixed(3);
            const point = edge === 'in' ? item.oldInMs : item.oldOutMs;
            const before = Math.max(original.start, (point - 200) / 1000, original.start - delta / 1000);
            const after = Math.min(original.end, (point + 200) / 1000,
              original.start + actions.players[0].duration - delta / 1000);
            actions.sync(before - original.start + delta / 1000, before, after - before);
            viewed.add(edge);
            report(`已对齐${edge === 'in' ? '换入' : '换出'}接缝，回看切点前后并试听两路声音。`);
          } catch (error) { report(error.message); }
        };
      }
      patch.querySelector('[data-commit]').onclick = () => {
        try {
          if (viewed.size !== 2 || !flags.every(flag => flag.checked)) throw new Error('请先复核两端接缝，并确认动作、光色和脚步声。');
          const { item, original } = draft();
          const entries = patchIntervals(record, original, actions.binding(), [...(read(record).patches || []), item]);
          savePatches(entries);
          clearSeams();
          report('已锁定局部换镜。其余时间继续使用旧原片。');
        } catch (error) { report(error.message); }
      };
      patch.querySelector('[data-export]').onclick = () => {
        try { actions.exportPatch(); report('已导出局部清单。到 ARC 选中本镜，并选入新版视频。'); }
        catch (error) { report(error.message); }
      };
      panel.append(patch);
    }

    load.onclick = async () => {
      if (loading) return;
      loading = true;
      load.disabled = true;
      status.textContent = '正在核对新旧回片来源…';
      try {
        const files = await Promise.all([value.candidate, value.origin].map((item, index) => {
          const selected = actions.sources()[index];
          return selected instanceof File && selected.name === item.name ? selected : fileFor(item);
        }));
        const digests = await Promise.all(files.map(file => actions.fingerprint(file).then(item => item.contentDigest)));
        if (!panel.isConnected) return;
        if (record.version !== value.candidate.version || record.file !== value.candidate.name) {
          throw new Error('候选版本已变更，请重新打开复核。');
        }
        const binding = actions.binding();
        const originBinding = actions.originBinding(value.origin);
        if ((binding && binding.contentDigest !== digests[0]) ||
            (originBinding && originBinding.contentDigest !== digests[1])) {
          throw new Error('回片字节与已绑定版本不一致。');
        }
        const selected = await actions.load(files);
        if (!panel.isConnected) return;
        loaded = { files: selected, digests };
        active = null;
        fullRange();
        render();
        status.textContent = '两版已载入并核验新版。逐条同步复核后，再交接 ARC。';
      } catch (error) { if (panel.isConnected) status.textContent = error.message; }
      finally { load.disabled = false; loading = false; }
    };
    const rollback = document.createElement('button');
    rollback.type = 'button';
    rollback.textContent = '导出 ARC 旧版回退清单';
    rollback.onclick = () => {
      try {
        actions.rollback();
        status.textContent = '已导出旧版清单。在 ARC 选中本镜，用清单和旧原片换回。';
      } catch (error) { status.textContent = error.message; }
    };
    render();
    const originals = [['取新版原片', value.candidate], ['取旧版原片', value.origin]].map(([label, item]) => {
      const link = document.createElement('a');
      link.className = 'preview-download';
      link.textContent = label;
      link.href = url(item);
      link.download = item.name;
      return link;
    });
    return { panel, rollback, originals, refresh: render,
      placeAfterCompare: node => panel.querySelector('[data-playback]').after(node),
      placeBeforeDelivery: (...nodes) => {
        const patch = panel.querySelector('.ab-local-patch');
        if (patch) patch.before(...nodes);
        else panel.append(...nodes);
      },
      dispose: () => controller.abort() };
  }

  const api = { read, attach, approval, patchIntervals, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcABReturn = api;
})(globalThis);
