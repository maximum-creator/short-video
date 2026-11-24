(() => {
  const labels = { hair: '发丝闪烁', frame: '门框边缘', footstep: '脚步音画偏移' };
  const timestamp = window.arcReviewNotes.timestamp;

  function create(record, { task, assetKey, sourceVideo, video, comparison, fixture, save, canMark }) {
    const panel = document.createElement('section');
    panel.className = 'production-history relay-issue-notes';
    panel.innerHTML = `
      <h4>画质问题</h4>
      <div class="production-picker">
        <button type="button" data-kind="hair">标发丝闪烁</button>
        <button type="button" data-kind="frame">标门框边缘</button>
        <button type="button" data-kind="footstep">标脚步音画偏移</button>
      </div>
      <label>观察（可选）<input maxlength="160" placeholder="例如脚步声比落地晚约 80 毫秒"></label>
      <ul></ul><output role="status"></output>`;
    const list = panel.querySelector('ul');
    const status = panel.querySelector('output');
    const note = panel.querySelector('input');

    function entries() {
      try {
        const rows = JSON.parse(record.relayReviewNotes || '[]');
        return Array.isArray(rows) ? rows.filter(row => row && Object.hasOwn(labels, row.kind) &&
          Number.isInteger(row.ms) && row.ms >= 0 && typeof row.note === 'string').slice(-120) : [];
      } catch { return []; }
    }

    function sameOutput(entry) {
      return entry.taskId === task.id && entry.assetKey === assetKey && entry.cutSha256 === task.media.sha256;
    }

    function synchronize() {
      if (!canMark() || [sourceVideo, video].some(player => player.readyState < 2 || player.seeking)) {
        throw new Error('请先载入已核验的原裁片和增强回片，再等画面就绪。');
      }
      if (!comparison.coordinates().linked) throw new Error('请先点「同步两段」。');
      comparison.pauseForEvidence();
    }

    function render() {
      list.replaceChildren();
      for (const entry of entries().filter(sameOutput).sort((a, b) => a.ms - b.ms)) {
        const row = document.createElement('li');
        const jump = document.createElement('button');
        const sourceMs = Math.round(task.shot.start * 1000) + entry.ms;
        jump.type = 'button';
        jump.textContent = `${timestamp(entry.ms)} · ${labels[entry.kind]}`;
        jump.onclick = () => {
          try { synchronize(); comparison.seekTrack(0, entry.ms / 1000); }
          catch (error) { status.textContent = error.message; }
        };
        const text = document.createElement('span');
        text.textContent = [`原片 ${timestamp(sourceMs)}`, entry.note, entry.fixture ? '本地测试素材' : ''].filter(Boolean).join(' · ');
        row.append(jump, text);
        list.append(row);
      }
    }

    for (const button of panel.querySelectorAll('[data-kind]')) button.onclick = () => {
      try {
        synchronize();
        if (Math.abs(sourceVideo.currentTime - video.currentTime) > .12) {
          throw new Error('两版播放头尚未对齐，请拖动同步进度后再记录。');
        }
        const ms = Math.round(sourceVideo.currentTime * 1000);
        const kind = button.dataset.kind;
        const previous = record.relayReviewNotes;
        const current = entries();
        if (current.some(entry => sameOutput(entry) && entry.kind === kind && entry.ms === ms)) {
          throw new Error('这个时间点已记录相同问题。');
        }
        record.relayReviewNotes = JSON.stringify([...current, { taskId: task.id, assetKey, cutSha256: task.media.sha256,
          kind, ms, note: note.value.trim(), fixture }].slice(-120));
        if (!save()) {
          if (previous === undefined) delete record.relayReviewNotes;
          else record.relayReviewNotes = previous;
          throw new Error('批注未保存，请重试。');
        }
        note.value = '';
        render();
        status.textContent = `已记录 ${labels[kind]}。`;
      } catch (error) { status.textContent = error.message; }
    };
    render();
    return panel;
  }

  window.arcRelayReview = { create };
})();
