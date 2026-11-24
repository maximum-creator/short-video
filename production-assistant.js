(() => {
  const titles = { script: '剧本主编', video: '视频总导演', edit: '剪辑负责人' };
  const starters = {
    script: ['逐镜核对本集剧本与分镜覆盖', '检查世界规则、数值和人物所知'],
    video: ['对照剧本核对本镜目的与前后镜头', '给我一个改动最小的返修方案'],
    edit: ['检查本镜的切点与对白位置', '这几镜怎么排更顺？']
  };

  function create(role, snapshot, shotId, threads, initialReview = null, approveRepair) {
    const panel = document.createElement('section');
    panel.className = 'production-assistant production-history';
    panel.innerHTML = `
      <header><h3></h3><p data-state>正在读取助手配置…</p><p data-scope></p></header>
      <div data-starters class="production-picker"></div>
      <div class="assistant-thread" aria-live="polite"></div>
      <label>你的问题<textarea rows="3" maxlength="2000" placeholder="可以问到具体镜头、台词或时间点"></textarea></label>
      <div class="production-picker"><button type="button" data-send disabled>发送</button>
        ${approveRepair ? '<button type="button" data-make-repair disabled>起草返修单</button>' : ''}
        <button type="button" data-cancel hidden>停止等待</button></div>
      <output role="status"></output><div data-repair-draft></div>`;
    panel.querySelector('h3').textContent = titles[role];
    const status = panel.querySelector('[data-state]');
    const scope = panel.querySelector('[data-scope]');
    const thread = panel.querySelector('.assistant-thread');
    const input = panel.querySelector('textarea');
    const send = panel.querySelector('[data-send]');
    const makeRepair = panel.querySelector('[data-make-repair]');
    const draft = panel.querySelector('[data-repair-draft]');
    const cancel = panel.querySelector('[data-cancel]');
    const feedback = panel.querySelector('output');
    let connection, active = true, pending;
    let samples;

    function currentKey() {
      return [role, snapshot.episode, role === 'script' ? '' : shotId].join('/');
    }

    function render() {
      scope.textContent = role === 'script' ? `第 ${snapshot.episode} 集 · 剧本与连续性` :
        `第 ${snapshot.episode} 集 / ${shotId} · 镜头资料与前后镜头`;
      thread.replaceChildren();
      for (const turn of threads.get(currentKey()) || []) {
        const note = document.createElement('article'), label = document.createElement('b'), text = document.createElement('p');
        note.dataset.role = turn.role;
        label.textContent = turn.role === 'user' ? '你' : titles[role];
        text.textContent = turn.content;
        note.append(label, text);
        thread.append(note);
      }
      thread.scrollTop = thread.scrollHeight;
      send.disabled = !connection || Boolean(pending);
      if (makeRepair) makeRepair.disabled = send.disabled;
      cancel.hidden = !pending;
    }

    function stop() {
      pending?.abort();
      pending = undefined;
    }

    for (const question of starters[role]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = question;
      button.onclick = () => { input.value = question; input.focus(); };
      panel.querySelector('[data-starters]').append(button);
    }

    async function submit(repair) {
      const question = input.value.trim();
      if (!connection || pending || (!repair && !question)) return;
      if (samples?.pending()) { feedback.textContent = '正在取样，请等画面准备好再发送。'; return; }
      const frames = samples?.frames() || [];
      const key = currentKey();
      const past = threads.get(key) || [];
      const requestShot = shotId;
      const turns = [...(repair ? [] : past.slice(-6)), { role: 'user',
        content: question || '请整理此镜头改动最小的返修单。' }];
      if (repair) draft.replaceChildren();
      const frameSources = { candidate: samples?.sourceName('candidate') || '',
        comparison: samples?.sourceName('comparison') || '' };
      const request = new AbortController();
      pending = request;
      feedback.textContent = frames.length ? `等待视觉模型审看 ${frames.length} 张抽样画面…` : '等待本地模型回复…';
      render();
      try {
        const response = await fetch('/api/assistant', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: request.signal,
          body: JSON.stringify({ role, snapshot, shotId: requestShot, turns,
            ...(repair ? { mode: 'repair' } : {}), ...(frames.length ? { frames } : {}) })
        });
        const data = await response.json();
        if (!response.ok || (!data.repair && typeof data.reply !== 'string')) throw new Error(data.error || '未收到回复。');
        if (!active || pending !== request) return;
        if (repair) {
          if (data.repairError) {
            feedback.textContent = data.repairError;
            const raw = document.createElement('p');
            raw.textContent = data.reply;
            draft.append(raw);
            return;
          }
          const preview = window.arcRepair.render(data.repair, '返修单草稿 · ' + requestShot);
          const confirm = document.createElement('button');
          confirm.type = 'button';
          confirm.className = 'production-action';
          confirm.textContent = '确认保存到候选';
          confirm.onclick = () => {
            try {
              if (!samples?.sameFrames(frames)) throw new Error('取样画面或视频已更换，请重新取样后再保存返修单。');
              if (!approveRepair(requestShot, data.repair, frameSources, frames)) return;
              confirm.disabled = true;
              feedback.textContent = '已保存返修单，可在镜头审片查看。';
            } catch (error) { feedback.textContent = error.message; }
          };
          preview.append(confirm);
          draft.append(preview);
          feedback.textContent = '请核对时间点、修改范围和需要保留的内容。';
          return;
        }
        threads.set(key, [...turns, { role: 'assistant', content: data.reply }]);
        if (input.value.trim() === question) input.value = '';
        feedback.textContent = frames.length ? `已收到 ${data.model} 的抽样意见。` : '已收到回复。';
      } catch (error) {
        if (active && pending === request) feedback.textContent = error.message;
      } finally {
        if (pending === request) {
          pending = undefined;
          if (active) render();
        }
      }
    }
    send.onclick = () => submit(false);
    if (makeRepair) makeRepair.onclick = () => submit(true);
    cancel.onclick = () => { stop(); feedback.textContent = '已停止等待，可继续编辑问题。'; render(); };
    render();
    if (location.hostname === '127.0.0.1' && location.protocol === 'http:') {
      fetch('/api/assistant', { cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!active) return;
        connection = data;
        status.textContent = data.testFixture ? '本地助手演练 · 使用模拟回复' :
          '已配置模型 · ' + (data.models?.[role] || data.model) + ' · 调用时检查服务';
        if (role === 'video' && data.vision) {
          samples = window.arcReviewFrames.create(initialReview);
          panel.insertBefore(samples.panel, thread);
          status.textContent += ' · 视觉审片 ' + data.vision;
        } else if (initialReview) {
          feedback.textContent = '请配置本地视觉模型后再进行抽样审片。';
        }
        render();
      }).catch(() => { if (active) status.textContent = '此页面尚未连接本地助手模型。'; });
    } else {
      status.textContent = '从配置了助手的本地工作台地址打开，即可在这里提问。';
    }

    return { panel, setShot(next) {
      if (next === shotId) return;
      if (role !== 'script') {
        stop();
        samples?.reset(true);
        draft.replaceChildren();
        input.value = '';
        feedback.textContent = '';
      }
      shotId = next;
      render();
    }, dispose() { active = false; stop(); samples?.reset(true); } };
  }
  window.arcAssistant = { create };
})();
