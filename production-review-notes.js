((root) => {
  const categories = ['表演', '口型与声音', '构图', '运镜', '光色', '角色与道具', '剪辑接续', '其他'];
  const maximum = 200;
  const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 3_600_000;
  const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  function identity(record) {
    const result = { version: text(record.version, 512), file: text(record.file, 512) };
    if (/^[a-f0-9-]{36}$/i.test(record.outputJobId || '') && /^[a-f0-9]{64}$/.test(record.outputAssetKey || '')) {
      result.outputJobId = record.outputJobId;
      result.outputAssetKey = record.outputAssetKey;
      return result;
    }
    try {
      const media = JSON.parse(record.generatedCandidate || 'null');
      if (media && media.version === result.version && media.name === result.file &&
          /^[a-f0-9-]{36}$/i.test(media.jobId || '') && Number.isInteger(media.index) && media.index >= 0 && media.index <= 999 &&
          /^[a-f0-9]{64}$/.test(media.assetKey || '')) {
        result.outputJobId = media.jobId;
        result.outputAssetKey = media.assetKey;
      }
    } catch { /* Older candidates remain scoped by version and file only. */ }
    return result;
  }
  const same = (first, second) => first.version === second.version && first.file === second.file &&
    first.outputJobId === second.outputJobId && first.outputAssetKey === second.outputAssetKey;

  function normalize(item) {
    if (!item || !validTime(item.sourceMs) || !categories.includes(item.category)) return null;
    const note = text(item.note, 400);
    return note ? { sourceMs: item.sourceMs, category: item.category, note } : null;
  }

  function read(record) {
    try {
      const parsed = JSON.parse(record.reviewNotes || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, maximum).flatMap(item => {
        const value = normalize(item);
        if (!value || typeof item.id !== 'string' || !item.id || item.id.length > 64) return [];
        const scope = identity(item);
        return scope.version && scope.file ? [{ id: item.id, ...scope, ...value }] : [];
      });
    } catch { return []; }
  }

  function list(record) {
    const scope = identity(record);
    return read(record).filter(item => same(item, scope)).sort((left, right) => left.sourceMs - right.sourceMs);
  }

  function forAssistant(items) {
    return Array.isArray(items) ? items.slice(0, 12).map(normalize).filter(Boolean) : [];
  }

  function timestamp(ms) {
    return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  }

  function create(record, { selectedFile, seek, save, onChange = () => {} }) {
    const panel = document.createElement('section');
    panel.className = 'production-history review-notes';
    panel.innerHTML = `
      <h3>时间码批注</h3>
      <div data-editor hidden>
        <p data-draft-time></p>
        <label>问题类型<select></select></label>
        <label>看到的问题<textarea rows="2" maxlength="400" placeholder="例如眼神先移走，和转身动作接不上"></textarea></label>
        <div class="production-picker">
          <button type="button" data-save-note>保存批注</button>
          <button type="button" data-close-note>取消</button>
        </div>
      </div>
      <p data-empty>在候选视频上定位后，点「在此时刻写批注」。</p>
      <ul></ul><output role="status"></output>`;
    const editor = panel.querySelector('[data-editor]');
    const label = panel.querySelector('[data-draft-time]');
    const select = panel.querySelector('select');
    const note = panel.querySelector('textarea');
    const feedback = panel.querySelector('output');
    const items = panel.querySelector('ul');
    let draft;
    for (const category of categories) select.add(new Option(category));

    function open(item) {
      draft = item;
      label.textContent = `候选源时间 ${timestamp(item.sourceMs)}`;
      select.value = categories.includes(item.category) ? item.category : categories[0];
      note.value = item.note || '';
      feedback.textContent = '';
      editor.hidden = false;
      note.focus();
    }

    function close() {
      draft = undefined;
      editor.hidden = true;
    }

    function render() {
      const entries = list(record);
      panel.querySelector('[data-empty]').hidden = entries.length > 0 || Boolean(draft);
      items.replaceChildren();
      for (const entry of entries) {
        const row = document.createElement('li');
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.textContent = timestamp(entry.sourceMs);
        jump.setAttribute('aria-label', '跳到候选源时间 ' + jump.textContent);
        jump.onclick = () => {
          try {
            if (selectedFile() !== entry.file) throw new Error('请先载入这条批注对应的候选视频。');
            seek(entry.sourceMs / 1000);
            feedback.textContent = '已定位到候选源 ' + timestamp(entry.sourceMs);
          } catch (error) { feedback.textContent = error.message; }
        };
        const description = document.createElement('p');
        description.textContent = entry.category + ' · ' + entry.note;
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '编辑';
        edit.onclick = () => open(entry);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '删除';
        remove.onclick = () => {
          if (!window.confirm('删除这条时间码批注？')) return;
          try {
            commit(read(record).filter(item => item.id !== entry.id));
            if (draft?.id === entry.id) close();
            feedback.textContent = '已删除批注。';
            render();
          } catch (error) { feedback.textContent = error.message; }
        };
        const actions = document.createElement('div');
        actions.className = 'production-picker';
        actions.append(jump, edit, remove);
        row.append(actions, description);
        items.append(row);
      }
    }

    function commit(value) {
      const previous = record.reviewNotes;
      record.reviewNotes = JSON.stringify(value);
      if (save() !== false) { onChange(); return; }
      if (previous === undefined) delete record.reviewNotes;
      else record.reviewNotes = previous;
      throw new Error('浏览器未能保存批注，请检查存储后重试。');
    }

    panel.querySelector('[data-save-note]').onclick = () => {
      try {
        if (!draft || !same(draft, identity(record))) throw new Error('候选已变更，请重新定位。');
        if (!draft.id && selectedFile() !== draft.file) throw new Error('请载入与候选记录相同的源视频。');
        const entry = normalize({ sourceMs: draft.sourceMs, category: select.value, note: note.value });
        if (!entry) throw new Error('请填写看到的问题。');
        const all = read(record);
        if (!draft.id && all.length >= maximum) throw new Error('本镜头批注已达 200 条，请整理后再新增。');
        commit([...all.filter(item => item.id !== draft.id), { ...identity(record), ...entry, id: draft.id || crypto.randomUUID() }]);
        close();
        feedback.textContent = '已保存批注。';
        render();
      } catch (error) { feedback.textContent = error.message; }
    };
    panel.querySelector('[data-close-note]').onclick = () => { close(); render(); feedback.textContent = ''; };
    render();
    return { panel, start(sourceMs, initial = {}) {
      const scope = identity(record);
      if (!scope.version || !scope.file) feedback.textContent = '先填写候选版本和源视频文件名。';
      else if (selectedFile() !== scope.file) feedback.textContent = '请载入与候选记录相同的源视频。';
      else if (!validTime(sourceMs)) feedback.textContent = '此视频时间无法记录。';
      else { open({ ...scope, sourceMs,
        category: categories.includes(initial.category) ? initial.category : categories[0],
        note: typeof initial.note === 'string' ? initial.note.slice(0, 400) : '' }); render(); }
    }, refresh() {
      if (draft && !same(draft, identity(record))) {
        close();
        feedback.textContent = '候选已变更，请重新定位。';
      }
      render();
    } };
  }

  const api = { create, read, list, forAssistant, identity, same, timestamp, validTime };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcReviewNotes = api;
})(globalThis);
