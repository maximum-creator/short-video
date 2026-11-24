(() => {
  const labels = {
    submitting: '正在提交', queued: '排队中', running: '生成中', complete: '已回传',
    failed: '生成失败', no_video: '没有视频输出', awaiting: '等待服务确认', unconfirmed: '提交结果待核对',
    unknown: '桥接未找到任务', unreachable: '暂时无法读取', rejected: '提交未受理'
  };
  const unsettled = new Set(['submitting', 'queued', 'running', 'awaiting', 'unreachable']);
  const validJobId = value => typeof value === 'string' &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);

  function watch(panel, ids, changed) {
    const button = panel.querySelector('button');
    const output = panel.querySelector('output');
    const states = new Map();
    let disposed = false, request, timer;
    const canRead = ids.length && location.hostname === '127.0.0.1' && location.protocol === 'http:';
    panel.hidden = !ids.length;
    button.disabled = !canRead;
    output.textContent = canRead ? '等待读取本集任务' : '从本地桥接地址打开后可读取生成状态。';

    function value(id, adopted, fallback) {
      const observed = states.get(id);
      const cached = !observed || ['unknown', 'unreachable'].includes(observed.status);
      const state = cached ? fallback?.status || observed?.status : observed.status;
      const fixture = observed?.testFixture === true || fallback?.testFixture === true;
      const title = (state === 'complete' && fixture ? '测试片可播放' : labels[state]) ||
        (id ? '查看生成任务' : '未提交');
      return { title: title + (state !== 'complete' && fixture ? ' · 本地测试' : '') +
        (state === 'complete' && adopted ? ' · 已列候选' : '') +
        (fallback && cached && state ? '（本地记录）' : ''),
        done: state === 'complete' && adopted,
        terminal: ['complete', 'failed', 'no_video', 'rejected'].includes(state) };
    }

    function report(jobs) {
      const all = [...states.values()];
      const count = name => all.filter(item => item.status === name).length;
      const fixtures = all.filter(item => item.testFixture === true).length;
      const failed = count('failed') + count('no_video');
      const other = all.length - count('queued') - count('running') - count('complete') - failed;
      output.textContent = `排队 ${count('queued')} · 生成 ${count('running')} · 回传 ${count('complete')}` +
        ` · 未回片 ${failed}` + (fixtures ? ` · 含 ${fixtures} 条本地测试任务` : '') +
        (other ? ` · 其他状态 ${other}` : '');
      changed(jobs);
    }

    function stop() {
      clearTimeout(timer);
      request?.abort();
      request = undefined;
    }

    async function refresh() {
      if (!canRead || disposed || document.hidden || request) return;
      clearTimeout(timer);
      const controller = new AbortController();
      request = controller;
      button.disabled = true;
      try {
        const jobs = [];
        for (let cursor = 0; cursor < ids.length; cursor += 24) {
          const query = new URLSearchParams({ ids: ids.slice(cursor, cursor + 24).join(',') });
          const response = await fetch('/api/generation/jobs?' + query, {
            cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)])
          });
          if (!response.ok) throw new Error(response.status === 503 ? '桥接未配置生成服务。' : '生成状态暂不可读取。');
          const result = await response.json();
          if (!Array.isArray(result.jobs)) throw new Error('未取得有效的生成状态。');
          jobs.push(...result.jobs);
        }
        if (request !== controller) return;
        states.clear();
        for (const item of jobs) if (validJobId(item.id) && Object.hasOwn(labels, item.status)) states.set(item.id, { status: item.status, testFixture: item.testFixture });
        report(jobs);
        if ([...states.values()].some(item => unsettled.has(item.status))) timer = setTimeout(refresh, 6500);
      } catch (error) {
        if (request !== controller) return;
        const message = ['TimeoutError', 'TypeError'].includes(error.name) ? '生成状态暂不可读取。' : error.message;
        output.textContent = states.size ? `${message} 镜头上保留上次读取的状态。` : message;
      } finally {
        if (request === controller) {
          request = undefined;
          button.disabled = false;
        }
      }
    }
    function visibility() {
      if (document.hidden) stop();
      else refresh();
    }
    button.onclick = refresh;
    if (canRead) {
      document.addEventListener('visibilitychange', visibility);
      refresh();
    }
    return { value, dispose() { disposed = true; stop(); document.removeEventListener('visibilitychange', visibility); } };
  }

  window.arcOverviewJobs = { watch, validJobId };
})();
