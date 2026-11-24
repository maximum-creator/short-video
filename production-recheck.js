((root) => {
  const notes = typeof module === 'object' && module.exports ? require('./production-review-notes.js') : root.arcReviewNotes;
  const states = ['已修复', '仍存在'];
  const limit = 400;
  const basis = note => JSON.stringify([note.id, note.sourceMs, note.category, note.note]);
  const keyOf = source => JSON.stringify([source.version, source.file]);

  function read(record) {
    try {
      const list = JSON.parse(record.reviewChecks || '[]');
      return Array.isArray(list) ? list.slice(0, limit).filter(item => item && typeof item.basis === 'string' &&
        typeof item.version === 'string' && typeof item.file === 'string' &&
        typeof item.originVersion === 'string' && typeof item.originFile === 'string' && typeof item.noteId === 'string' &&
        states.includes(item.state) && notes.validTime(item.candidateMs)) : [];
    } catch { return []; }
  }

  function sameOrigin(check, note) {
    return check.originVersion === note.version && check.originFile === note.file && check.noteId === note.id;
  }

  function find(list, scope, note) {
    return list.find(item => notes.same(item, scope) && sameOrigin(item, note) && item.basis === basis(note));
  }

  function context(record) {
    const scope = notes.identity(record);
    const checks = read(record);
    return notes.read(record).flatMap(note => {
      const check = find(checks, scope, note);
      return check ? [{ originVersion: note.version, originMs: note.sourceMs, candidateMs: check.candidateMs,
        state: check.state, category: note.category, note: note.note }] : [];
    }).slice(0, 12);
  }

  function approval(record) {
    const scope = notes.identity(record);
    const priorNotes = notes.read(record).filter(note => !notes.same(note, scope));
    const checks = read(record);
    const unresolved = priorNotes.flatMap(note => {
      const check = find(checks, scope, note);
      return check?.state === states[0] ? [] : [{ note, state: check?.state || '待复核' }];
    });
    return {
      ready: unresolved.length === 0,
      pending: unresolved.filter(item => item.state === '待复核').length,
      stillExists: unresolved.filter(item => item.state === states[1]).length,
      total: priorNotes.length
    };
  }

  function parseContext(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 12).flatMap(item => {
      if (!item || !states.includes(item.state) || !notes.validTime(item.originMs) || !notes.validTime(item.candidateMs)) return [];
      const [note] = notes.forAssistant([{ ...item, sourceMs: item.originMs }]);
      return note && typeof item.originVersion === 'string' ?
        [{ originVersion: item.originVersion.trim().slice(0, 120), originMs: item.originMs, candidateMs: item.candidateMs,
          state: item.state, category: note.category, note: note.note }] : [];
    });
  }

  function create(record, { sourceNames, verifyMedia, readCandidateTime, seek, pause, save, onChange = () => {} }) {
    const panel = document.createElement('details');
    panel.className = 'production-history review-recheck';
    panel.innerHTML = `
      <summary>复核旧版问题</summary>
      <label>旧候选版本<select></select></label>
      <p data-summary></p>
      <ul></ul><output role="status"></output>`;
    const select = panel.querySelector('select');
    const summary = panel.querySelector('[data-summary]');
    const rows = panel.querySelector('ul');
    const status = panel.querySelector('output');
    let groups;
    let checking = false;

    function action(text, run) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.onclick = async () => {
        try { status.textContent = await run(); }
        catch (error) { status.textContent = error.message; }
      };
      return button;
    }

    function verifySources(scope, note, both) {
      const [candidate, comparison] = sourceNames();
      if (comparison !== note.file) throw new Error(`请在对照栏载入 ${note.file}。`);
      if (both && candidate !== scope.file) throw new Error(`请在候选栏载入 ${scope.file}。`);
    }

    async function recordState(scope, note, state) {
      if (checking) throw new Error('正在核对文件，请稍候。');
      verifySources(scope, note, true);
      pause();
      const candidateMs = readCandidateTime(note.sourceMs);
      if (!notes.validTime(candidateMs)) throw new Error('请先将新版定位到对应动作。');
      checking = true;
      status.textContent = '正在核对两版视频文件…';
      let verified;
      try {
        verified = await verifyMedia(note);
        if (!panel.isConnected || !notes.same(notes.identity(record), scope) ||
            !notes.read(record).some(item => notes.same(item, note) && basis(item) === basis(note))) {
          throw new Error('候选或批注已变化，请重新核对。');
        }
      } finally { checking = false; }
      const all = read(record).filter(item => !notes.same(item, scope) || !sameOrigin(item, note));
      if (all.length >= limit) throw new Error('本镜头已有 400 条复核记录。');
      const previous = record.reviewChecks;
      record.reviewChecks = JSON.stringify([...all, { ...scope, originVersion: note.version,
        originFile: note.file, noteId: note.id, basis: basis(note), state, candidateMs }]);
      if (save() === false) {
        if (previous === undefined) delete record.reviewChecks;
        else record.reviewChecks = previous;
        throw new Error('浏览器未能保存复核记录，请重试。');
      }
      onChange();
      return verified;
    }

    function render() {
      rows.replaceChildren();
      const group = groups.get(select.value);
      if (!group) { summary.textContent = '选择有批注的旧候选。'; return; }
      const scope = notes.identity(record);
      const checks = read(record);
      const fixed = group.filter(note => find(checks, scope, note)?.state === states[0]).length;
      const unresolved = group.filter(note => find(checks, scope, note)?.state === states[1]).length;
      summary.textContent = `对照栏载入 ${group[0].file}。对准新版后，按当下画面记录结果。已修复 ${fixed} 项，仍存在 ${unresolved} 项，待复核 ${group.length - fixed - unresolved} 项。`;
      for (const note of group) {
        const checked = find(checks, scope, note);
        const row = document.createElement('li');
        const text = document.createElement('p');
        text.textContent = note.category + ' · ' + note.note;
        const evidence = document.createElement('p');
        evidence.textContent = checked ? `${checked.state} · 新版源 ${notes.timestamp(checked.candidateMs)}` : '待复核';
        const actions = document.createElement('div');
        actions.className = 'production-picker';
        actions.append(action('旧版 ' + notes.timestamp(note.sourceMs), () => {
          verifySources(scope, note, false);
          seek(null, note.sourceMs / 1000);
          return '已定位旧版问题，请在新版找到对应动作。';
        }));
        if (checked) actions.append(action('回看复核位置', () => {
          verifySources(scope, note, true);
          seek(checked.candidateMs / 1000, note.sourceMs / 1000);
          return '已分别定位到新版和旧版的源时间。';
        }));
        for (const state of states) actions.append(action(state, async () => {
          const verified = await recordState(scope, note, state);
          render();
          const sameRow = [...rows.children].find(item => item.dataset.noteId === note.id);
          if (sameRow) [...sameRow.querySelectorAll('button')].find(button => button.textContent === state)?.focus();
          return '已保存 · ' + state + (verified ? '' : '。旧版无历史指纹，请人工确认旧片来源。');
        }));
        row.dataset.noteId = note.id;
        row.append(text, evidence, actions);
        rows.append(row);
      }
    }

    function refresh() {
      const scope = notes.identity(record);
      groups = new Map();
      for (const note of notes.read(record).sort((a, b) => a.sourceMs - b.sourceMs)) {
        if (notes.same(scope, note)) continue;
        const key = keyOf(note);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(note);
      }
      panel.hidden = !scope.version || !scope.file || !groups.size;
      const previous = select.value;
      select.replaceChildren(new Option('选择旧候选', ''));
      for (const [key, group] of groups) select.add(new Option(`${group[0].version} · ${group[0].file}`, key));
      select.value = groups.has(previous) ? previous : groups.size === 1 ? groups.keys().next().value : '';
      status.textContent = '';
      render();
    }

    select.onchange = () => { status.textContent = ''; render(); };
    refresh();
    return { panel, refresh };
  }

  const api = { create, context, parseContext, approval };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcRecheck = api;
})(globalThis);
