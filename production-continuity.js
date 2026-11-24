((root) => {
  const projectFiles = typeof module === 'object' && module.exports ?
    require('./production-project.js') : root.arcProductionProject;
  const categories = ['人物', '道具', '时间与地点', '数值与规则'];
  const limit = 80;
  const statuses = ['待写开场', '待写结尾', '待解释变化', '待补上集结尾', '待复核剧本原句', '承接一致', '变化已说明', '本集新增'];
  const clean = (value, size) => typeof value === 'string' ? value.trim().slice(0, size) : '';
  const comparable = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
  const key = value => JSON.stringify([value.kind, comparable(value.subject), comparable(value.field)]);

  function normalize(entry) {
    if (!entry || !categories.includes(entry.kind)) return null;
    const subject = clean(entry.subject, 60);
    const field = clean(entry.field, 60);
    if (!subject || !field) return null;
    const reasonQuote = clean(entry.reasonQuote, 500);
    return { kind: entry.kind, subject, field, start: clean(entry.start, 200),
      end: clean(entry.end, 200), reason: clean(entry.reason, 240), reasonFrom: clean(entry.reasonFrom, 200),
      ...(reasonQuote ? { reasonQuote } : {}) };
  }

  function read(pages) {
    try {
      const list = JSON.parse(pages?.continuityLedger || '[]');
      if (!Array.isArray(list)) return [];
      const unique = new Map();
      for (const raw of list.slice(0, limit)) {
        const row = normalize(raw);
        if (row && !unique.has(key(row))) unique.set(key(row), row);
      }
      return [...unique.values()];
    } catch { return []; }
  }

  function quoteMatches(entry, pages) {
    return projectFiles.scriptAnchorStatus({ scriptAnchor: entry.reasonQuote }, pages).ready;
  }

  function status(entry, previous, pages) {
    if (!entry.start) return '待写开场';
    if (previous && !previous.end) return '待补上集结尾';
    const changed = previous && comparable(entry.start) !== comparable(previous.end);
    if (changed && (!entry.reason || comparable(entry.reasonFrom) !== comparable(previous.end))) return '待解释变化';
    if (changed && entry.reasonQuote && !quoteMatches(entry, pages)) return '待复核剧本原句';
    if (!entry.end) return '待写结尾';
    return changed ? '变化已说明' : previous ? '承接一致' : '本集新增';
  }

  function priorStates(project, index, wanted) {
    const previous = new Map();
    for (let episodeIndex = index - 1; episodeIndex >= 0; episodeIndex--) {
      if (episodeIndex !== index - 1 && wanted && !wanted.size) break;
      for (const row of read(project.episodes[episodeIndex]?.pages)) {
        const id = key(row);
        if (!previous.has(id) && (episodeIndex === index - 1 || !wanted || wanted.has(id))) {
          previous.set(id, { ...row, episodeIndex });
          wanted?.delete(id);
        }
      }
    }
    return previous;
  }

  function previousLabel(old) { return `第 ${String(old.episodeIndex + 1).padStart(2, '0')} 集结尾`; }

  function report(project, index) {
    const pages = project.episodes[index].pages;
    const current = new Map(read(pages).map(row => [key(row), row]));
    const previous = priorStates(project, index, new Set(current.keys()));
    const keys = new Set([...Array.from(previous).filter(([, row]) => row.episodeIndex === index - 1).map(([id]) => id),
      ...current.keys()]);
    return [...keys].map(id => {
      const old = previous.get(id);
      const saved = current.get(id);
      const entry = saved || { kind: old.kind, subject: old.subject, field: old.field, start: '', end: '', reason: '' };
      return { ...entry, previousEnd: old?.end || '', ...(old && old.episodeIndex < index - 1 ? { previousEpisode: old.episodeIndex + 1 } : {}),
        status: status(entry, old, pages), saved: Boolean(saved) };
    });
  }

  function forAssistant(items) {
    return Array.isArray(items) ? items.slice(0, limit * 2).flatMap(item => {
      const entry = normalize(item);
      if (!entry || !statuses.includes(item.status)) return [];
      const { reasonFrom, ...current } = entry;
      return [{ ...current, previousEnd: clean(item.previousEnd, 200),
        ...(Number.isSafeInteger(item.previousEpisode) && item.previousEpisode > 0 ? { previousEpisode: item.previousEpisode } : {}),
        status: item.status }];
    }).sort((first, second) => Number(second.status.startsWith('待')) - Number(first.status.startsWith('待'))).slice(0, 20) : [];
  }

  function reviewBasis(project, index) {
    const rows = report(project, index)
      .map(({ kind, subject, field, previousEnd, start, end, reason, reasonQuote, status, previousEpisode }) =>
        JSON.stringify([kind, subject, field, previousEnd, start, end, reason, reasonQuote || '', status,
          ...(previousEpisode ? [previousEpisode] : [])]))
      .sort();
    if (!rows.length) return '';
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(JSON.stringify(rows))) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    }
    return 'fnv1a64:' + hash.toString(16).padStart(16, '0');
  }

  function mount(project, index, save, { initialTask, openPrevious, returnTo } = {}) {
    const pages = project.episodes[index].pages;
    const panel = document.createElement('section');
    panel.className = 'production-history continuity-panel';
    panel.innerHTML = `
      <h3>前集结尾 → 本集开场</h3>
      <p data-summary></p>
      <div class="production-picker">
        <button type="button" data-add class="production-action">新增一项状态</button>
        <button type="button" data-import-previous class="production-action" hidden>带入上集已登记结尾</button>
        <label><input type="checkbox" data-pending-only>只看待处理</label>
        <button type="button" data-return hidden>返回刚才的一集</button>
      </div>
      <fieldset data-editor hidden>
        <legend>状态交接</legend>
        <div class="production-metadata">
          <label>分类<select name="kind"></select></label>
          <label>对象<input name="subject" maxlength="60" placeholder="例如角色A、关键道具"></label>
          <label>属性<input name="field" maxlength="60" placeholder="例如伤势、持有人、能力上限"></label>
        </div>
        <p data-previous></p>
        <button type="button" data-copy class="production-action" hidden>沿用上集结尾</button>
        <label>本集开场<input name="start" maxlength="200"></label>
        <label>本集结尾<input name="end" maxlength="200"></label>
        <label>跨集变化的依据<textarea name="reason" rows="2" maxlength="240" placeholder="有时间跳跃或状态变化时，写明剧本依据"></textarea></label>
        <label data-reconfirm hidden><input type="checkbox">已按最近一次结尾复核这条变化依据</label>
        <label>剧本原句（选填）<textarea name="reasonQuote" rows="2" maxlength="500" placeholder="粘贴本集剧情或对白中的原句，改稿后会自动检查"></textarea></label>
        <div class="production-picker"><button type="button" data-save>保存状态</button><button type="button" data-cancel>取消</button></div>
      </fieldset>
      <ul class="continuity-list"></ul>
      <details data-earlier hidden><summary>沿用较早集的状态</summary>
        <div class="production-picker"><label>对象和属性<select></select></label><button type="button">带入本集</button></div>
      </details><output role="status"></output>`;
    const editor = panel.querySelector('[data-editor]');
    const fields = Object.fromEntries([...editor.querySelectorAll('[name]')].map(field => [field.name, field]));
    const previous = panel.querySelector('[data-previous]');
    const copy = panel.querySelector('[data-copy]');
    const list = panel.querySelector('ul');
    const feedback = panel.querySelector('output');
    const pendingOnly = panel.querySelector('[data-pending-only]');
    const importPrevious = panel.querySelector('[data-import-previous]');
    const availablePrevious = rows => rows.filter(row => !row.saved && row.previousEnd && !row.previousEpisode);
    const back = panel.querySelector('[data-return]');
    const prior = priorStates(project, index);
    const earlier = panel.querySelector('[data-earlier]');
    const priorSelect = earlier.querySelector('select');
    const reconfirmLabel = panel.querySelector('[data-reconfirm]');
    const reconfirm = reconfirmLabel.querySelector('input');
    const focusFields = {
      '待写开场': 'start', '待写结尾': 'end',
      '待解释变化': 'reason', '待复核剧本原句': 'reasonQuote'
    };
    let editing, original;
    for (const category of categories) fields.kind.add(new Option(category));
    function values() {
      return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]));
    }
    function showPrevious() {
      const old = prior.get(key(values()));
      previous.textContent = old ? `${previousLabel(old)} · ${old.end || '待补记录'}` : '';
      reconfirmLabel.hidden = !(original?.reason && old?.end &&
        comparable(original.reasonFrom) !== comparable(old.end) && comparable(fields.start.value) !== comparable(old.end));
      if (reconfirmLabel.hidden) reconfirm.checked = false;
      copy.hidden = !old?.end;
      if (old) copy.textContent = old.episodeIndex === index - 1 ? '沿用上集结尾' : '沿用' + previousLabel(old);
      copy.onclick = old?.end ? () => { fields.start.value = old.end; showPrevious(); fields.start.focus(); } : null;
    }
    for (const name of ['kind', 'subject', 'field', 'start']) fields[name].addEventListener('input', showPrevious);
    function open(row, focusField) {
      editing = row?.saved ? key(row) : null;
      original = row?.saved ? row : null;
      reconfirm.checked = false;
      for (const [name, field] of Object.entries(fields)) field.value = row?.[name] || (name === 'kind' ? categories[0] : '');
      editor.hidden = false;
      importPrevious.disabled = true;
      feedback.textContent = '';
      showPrevious();
      (fields[focusField] ?? (row ? fields.start : fields.subject)).focus();
    }
    function commit(rows) {
      const previousValue = pages.continuityLedger;
      pages.continuityLedger = JSON.stringify(rows);
      if (save() !== false) return;
      if (previousValue === undefined) delete pages.continuityLedger;
      else pages.continuityLedger = previousValue;
      throw new Error('浏览器未能保存连续性记录，请重试。');
    }
    function action(label, run) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = 'production-action';
      button.onclick = run;
      return button;
    }
    function render() {
      const rows = report(project, index);
      const pending = rows.filter(row => row.status.startsWith('待')).length;
      const importable = availablePrevious(rows).length;
      importPrevious.hidden = !importable;
      importPrevious.disabled = !editor.hidden;
      importPrevious.textContent = `带入上集已登记结尾${importable ? `（${importable} 项）` : ''}`;
      const live = new Set(rows.map(key));
      const dormant = [...prior].filter(([id]) => !live.has(id));
      earlier.hidden = !dormant.length;
      priorSelect.replaceChildren(...dormant.map(([id, row]) => new Option(
        `${row.subject} · ${row.field} · ${previousLabel(row)}`, id)));
      panel.querySelector('[data-summary]').textContent = rows.length ?
        `${rows.length} 项交接记录 · ${pending} 项待补充` :
        '登记需要跨集保持的人物状态、道具归属或世界规则。';
      list.replaceChildren();
      for (const row of rows) {
        if (pendingOnly.checked && !row.status.startsWith('待')) continue;
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = `${row.subject} · ${row.field}`;
        const badge = document.createElement('span');
        badge.className = 'continuity-status';
        badge.dataset.pending = String(row.status.startsWith('待'));
        badge.textContent = row.status;
        const old = prior.get(key(row));
        const detail = document.createElement('dl');
        for (const [name, value] of [[old ? previousLabel(old) : '前集结尾', row.previousEnd], ['本集开场', row.start], ['本集结尾', row.end]]) {
          const label = document.createElement('dt');
          label.textContent = name;
          const valueField = document.createElement('dd');
          valueField.textContent = value || '—';
          detail.append(label, valueField);
        }
        const controls = document.createElement('div');
        controls.className = 'production-picker';
        const needsQuoteReview = row.status === '待复核剧本原句';
        controls.append(action(needsQuoteReview ? '复核原句' : row.saved ? '编辑' : '填写本集',
          () => open(row, needsQuoteReview ? 'reasonQuote' : undefined)));
        if (old && openPrevious) {
          const previousButton = action(old.end ? '查看' + previousLabel(old) : '补' + previousLabel(old), () => {
            if (!editor.hidden) {
              feedback.textContent = '请先保存或取消当前编辑，再跳到上集。';
              return;
            }
            openPrevious(old, old.episodeIndex);
          });
          previousButton.dataset.openPrevious = '';
          controls.append(previousButton);
        }
        if (row.saved) controls.append(action('删除本集记录', () => {
          if (!window.confirm('删除这项本集状态？上集记录会保留。')) return;
          try {
            commit(read(pages).filter(item => key(item) !== key(row)));
            if (editing === key(row)) editor.hidden = true;
            render();
            feedback.textContent = '已删除本集记录。';
          } catch (error) { feedback.textContent = error.message; }
        }));
        item.append(title, badge, detail);
        if (row.reason) {
          const reason = document.createElement('p');
          reason.textContent = (row.status === '待解释变化' ? '原依据待重核 · ' : '跨集依据 · ') + row.reason;
          item.append(reason);
        }
        if (row.reasonQuote) {
          const quote = document.createElement('p');
          quote.textContent = (needsQuoteReview ? '当前剧本找不到原句 · ' : '剧本原句 · ') + row.reasonQuote;
          item.append(quote);
        }
        item.append(controls);
        list.append(item);
      }
    }
    panel.querySelector('[data-add]').onclick = () => open();
    earlier.querySelector('button').onclick = () => {
      const old = prior.get(priorSelect.value);
      if (old) open({ kind: old.kind, subject: old.subject, field: old.field, start: old.end }, 'end');
    };
    pendingOnly.onchange = render;
    back.hidden = !returnTo;
    back.onclick = () => {
      if (!editor.hidden) {
        feedback.textContent = '请先保存或取消当前编辑，再返回。';
        return;
      }
      returnTo?.();
    };
    importPrevious.onclick = () => {
      if (!editor.hidden) return;
      try {
        const fromPrevious = availablePrevious(report(project, index));
        const current = read(pages);
        if (current.length + fromPrevious.length > limit) throw new Error('带入后将超过本集 80 项上限，请按需要逐项选择。');
        if (!fromPrevious.length) return;
        const drafts = fromPrevious.map(({ kind, subject, field, previousEnd }) =>
          normalize({ kind, subject, field, start: previousEnd }));
        commit([...current, ...drafts]);
        render();
        feedback.textContent = `已带入 ${drafts.length} 项开场状态。请在本集写出各项结尾。`;
        list.querySelector('button')?.focus();
      } catch (error) { feedback.textContent = error.message; }
    };
    panel.querySelector('[data-cancel]').onclick = () => {
      editor.hidden = true;
      importPrevious.disabled = false;
      feedback.textContent = '';
    };
    panel.querySelector('[data-save]').onclick = () => {
      try {
        const entry = normalize(values());
        if (!entry) throw new Error('请填写对象和属性。');
        if (entry.reasonQuote && !entry.reason) {
          fields.reason.focus();
          throw new Error('请说明原句如何解释跨集变化。');
        }
        if (entry.reasonQuote && !quoteMatches(entry, pages)) {
          fields.reasonQuote.focus();
          throw new Error('本集剧情或对白中找不到这句，请更新原句或将此栏留空。');
        }
        const priorEnd = prior.get(key(entry))?.end || '';
        const reusedReason = original && editing === key(entry) && entry.reason === original.reason &&
          (entry.reasonQuote || '') === (original.reasonQuote || '');
        entry.reasonFrom = entry.reason ? (reusedReason && !reconfirm.checked ? original.reasonFrom : priorEnd) : '';
        const rows = read(pages).filter(item => key(item) !== editing);
        if (rows.some(item => key(item) === key(entry))) throw new Error('已有相同对象和属性，请编辑原记录。');
        if (rows.length >= limit) throw new Error('本集状态交接已达 80 项。');
        commit([...rows, entry]);
        editor.hidden = true;
        render();
        feedback.textContent = '已保存本集状态。';
      } catch (error) { feedback.textContent = error.message; }
    };
    render();
    if (initialTask) {
      const rows = report(project, index);
      const rowIndex = rows.findIndex(item => key(item) === key(initialTask.row));
      const row = rows[rowIndex];
      if (row) queueMicrotask(() => {
        if (!panel.isConnected) return;
        if (Number.isInteger(initialTask.from)) open(row, 'end');
        else if (row.status === '待补上集结尾' && openPrevious) {
          list.children[rowIndex]?.querySelector('[data-open-previous]')?.focus();
        } else open(row, focusFields[row.status]);
      });
    }
    return panel;
  }

  const api = { report, forAssistant, reviewBasis, mount };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcContinuity = api;
})(globalThis);
