((root) => {
  const notes = typeof module === 'object' && module.exports ? require('./production-review-notes.js') : root.arcReviewNotes;
  const categories = ['角色', '表演', '运镜', '构图', '光色', '道具', '连续性', '口型与声音', '其他'];
  function text(value, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('返修单的文字字段缺失或太长。');
    return value.trim();
  }

  function plan(input, frames) {
    if (!input || !Array.isArray(input.issues) || input.issues.length > 6 ||
      !Array.isArray(input.keep) || input.keep.length > 6) throw new Error('返修单格式不完整或条目过多。');
    return {
      summary: text(input.summary, 400),
      keep: input.keep.map(item => text(item, 240)),
      issues: input.issues.map(issue => {
        if (!issue || !categories.includes(issue.category) || !['frame', 'needs_review'].includes(issue.evidence)) {
          throw new Error('返修条目缺少有效的分类或证据类型。');
        }
        const { track, sourceMs, evidence } = issue;
        if (evidence === 'frame') {
          if (!['candidate', 'comparison'].includes(track) || !Number.isSafeInteger(sourceMs) ||
            sourceMs < 0 || sourceMs > 3600000 || (frames && !frames.some(frame => frame.track === track && frame.sourceMs === sourceMs))) {
            throw new Error('返修单引用了这次没有发送的画面时间。');
          }
        } else if (track != null || sourceMs != null) {
          throw new Error('待复核建议不能填写未经验证的画面时间。');
        }
        return { category: issue.category, evidence, track: track ?? null, sourceMs: sourceMs ?? null,
          issue: text(issue.issue, 300), change: text(issue.change, 300) };
      })
    };
  }

  function bound(value, record, frames) {
    const version = String(record.version || '').trim();
    const file = String(record.file || '').trim();
    if (!version || !file) throw new Error('先在镜头审片填写当前候选的版本和源文件名。');
    return { version, file, plan: plan(value, frames) };
  }

  function persist(stored, record, save) {
    const previous = record.repairPlan;
    record.repairPlan = JSON.stringify(stored);
    if (save() === false) {
      if (previous === undefined) delete record.repairPlan;
      else record.repairPlan = previous;
      throw new Error('浏览器未能保存返修单，请重试。');
    }
    return stored;
  }

  function saveBound(value, record, frames, save) {
    return persist(bound(value, record, frames), record, save);
  }

  function saveFromNotes(record, changes, keep, save) {
    if (!record.sourceBinding) throw new Error('请先核对并绑定当前视频。');
    if (!changes.length || changes.length > 6) throw new Error('请为 1 至 6 条批注填写具体修改。');
    const currentNotes = new Map(notes.list(record).map(note => [note.id, note]));
    const evidence = changes.map(({ id }) => currentNotes.get(id));
    if (evidence.some(note => !note) || new Set(changes.map(({ id }) => id)).size !== changes.length) {
      throw new Error('当前批注已变更，请重新核对。');
    }
    const mapCategory = { '口型与声音': '表演', '角色与道具': '角色', '剪辑接续': '连续性' };
    const issues = evidence.map((note, index) => ({
      category: mapCategory[note.category] || note.category, evidence: 'frame', track: 'candidate',
      sourceMs: note.sourceMs, issue: note.note.slice(0, 300), change: changes[index].change
    }));
    const value = { summary: `仅处理已选的 ${issues.length} 条时间码批注`, keep, issues };
    return persist({ ...bound(value, record), noteEvidence: evidence, sourceBinding: record.sourceBinding }, record, save);
  }

  function current(record) {
    try {
      const stored = JSON.parse(record.repairPlan || 'null');
      if (!stored || stored.version !== String(record.version || '').trim() || stored.file !== String(record.file || '').trim()) return null;
      if (stored.noteEvidence) {
        const existing = notes.list(record);
        if (!Array.isArray(stored.noteEvidence) || stored.sourceBinding !== record.sourceBinding ||
            !stored.noteEvidence.every(note => existing.some(item => JSON.stringify(item) === JSON.stringify(note)))) return null;
      }
      return plan(stored.plan);
    } catch { return null; }
  }

  function instruction(value) {
    const timestamp = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    const changes = value.issues.filter(item => item.evidence === 'frame' && item.track === 'candidate').map(item =>
      `- ${item.category} · 候选源 ${timestamp(item.sourceMs)} · 发现：${item.issue} · 只修改：${item.change}`);
    if (!changes.length) return '';
    return ['局部返修要求：只处理下列问题，不改无关表演、构图、角色外观、背景和镜头内容。', ...changes,
      ...(value.keep.length ? ['保持：' + value.keep.join('；')] : [])].join('\n');
  }

  function render(value, title) {
    const panel = document.createElement('section');
    panel.className = 'production-history repair-plan';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const summary = document.createElement('p');
    summary.textContent = value.summary;
    panel.append(heading, summary);
    if (value.keep.length) {
      const keep = document.createElement('p');
      keep.textContent = '保留 · ' + value.keep.join('；');
      panel.append(keep);
    }
    const issues = document.createElement('ol');
    for (const entry of value.issues) {
      const item = document.createElement('li');
      const label = document.createElement('strong');
      const source = entry.track === 'candidate' ? '候选' : '对照';
      label.textContent = entry.evidence === 'frame' ?
        `${entry.category} · ${source} ${(entry.sourceMs / 1000).toFixed(3)} 秒` :
        `${entry.category} · 待复核`;
      const detail = document.createElement('p');
      detail.textContent = entry.issue;
      const change = document.createElement('p');
      change.textContent = '建议修改 · ' + entry.change;
      item.append(label, detail, change);
      issues.append(item);
    }
    if (issues.childElementCount) panel.append(issues);
    return panel;
  }

  function fromNotesPanel(record, { canBind, save, openGeneration }) {
    const panel = document.createElement('details');
    panel.className = 'production-history repair-plan';
    panel.innerHTML = `<summary>从时间码批注整理返修</summary>
      <p>只给本次要处理的批注填写修改动作。未填写的批注保留待复核。</p>
      <div data-repair-notes></div>
      <label>这次要保留的内容（可选）<input maxlength="240" data-repair-keep></label>
      <div class="production-picker">
        <button type="button" data-repair-confirm>确认返修单</button>
        <button type="button" data-repair-generate hidden>去生成任务</button>
      </div>
      <output role="status"></output>`;
    const list = panel.querySelector('[data-repair-notes]');
    const feedback = panel.querySelector('output');
    const confirm = panel.querySelector('[data-repair-confirm]');
    const generate = panel.querySelector('[data-repair-generate]');
    const keep = panel.querySelector('[data-repair-keep]');
    let fields = new Map();

    function refresh() {
      const entries = notes.list(record);
      panel.hidden = !entries.length;
      const previous = fields;
      fields = new Map();
      list.replaceChildren();
      for (const note of entries) {
        const label = document.createElement('label');
        const change = document.createElement('textarea');
        change.rows = 2;
        change.maxLength = 300;
        change.value = previous.get(note.id)?.value || '';
        change.placeholder = '只修改……';
        label.append(`${notes.timestamp(note.sourceMs)} · ${note.category} · ${note.note}`, change);
        list.append(label);
        fields.set(note.id, change);
      }
      confirm.disabled = !canBind();
      generate.hidden = !instruction(current(record) || { issues: [], keep: [] });
      if (!canBind()) feedback.textContent = '先核对并绑定本镜原视频。';
      else if (generate.hidden) feedback.textContent = '';
    }
    confirm.onclick = () => {
      try {
        if (!canBind()) throw new Error('请先核对并绑定本镜原视频。');
        const changes = [...fields].filter(([, field]) => field.value.trim())
          .map(([id, field]) => ({ id, change: field.value }));
        saveFromNotes(record, changes, keep.value.trim() ? [keep.value] : [], save);
        feedback.textContent = '返修单已确认，生成时可把它带入本镜任务。';
        generate.hidden = false;
      } catch (error) { feedback.textContent = error.message; }
    };
    generate.onclick = openGeneration;
    refresh();
    return { panel, refresh };
  }

  const api = { plan, bound, saveBound, saveFromNotes, current, instruction, categories, render, fromNotesPanel };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcRepair = api;
})(globalThis);
