(() => {
  const number = value => String(value).padStart(2, '0');
  const exists = value => typeof value === 'string' && !!value.trim();
  const target = (workspace, tab, index) => ({ workspace, tab, index });

  function qualityAdvice(shot, keyframe, assets) {
    const selected = new Map((shot.refs || []).map(id => [id, assets.get(id)]).filter(([, asset]) => asset));
    const kinds = new Set([...selected.values()].map(asset => asset.kind));
    const advice = [];
    if (!keyframe) advice.push('绑定本镜关键画面，锁定构图');
    if (!kinds.has('角色')) advice.push('绑定角色外观参考（如本镜有人物）');
    if (!kinds.has('场景')) advice.push('绑定场景空间参考（如有固定场景）');
    if (!exists(shot.performance)) advice.push('补充表演节拍（有人物表演时）');
    return advice;
  }

  function scriptCoverage(episode, includedShots) {
    const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, '');
    const sources = [
      ['剧情', episode.pages?.story],
      ['对白', episode.pages?.dialogue]
    ];
    const units = sources.flatMap(([kind, text]) => typeof text === 'string' ?
      text.split(/\r?\n+/).flatMap(line => line.match(/[^。！？!?；;]+[。！？!?；;]?[”’」』】）)]*/g) || [])
        .map(value => value.trim()).filter(value => normalize(value)).map(text => ({ kind, text })) : []);
    const shots = (episode.shots || []).flatMap((shot, index) => {
      if (includedShots && !includedShots.has(index)) return [];
      return [{ id: `S${number(index + 1)}`, anchor: normalize(typeof shot.scriptAnchor === 'string' ? shot.scriptAnchor : '') }];
    });
    const rows = units.map(unit => {
      const quote = normalize(unit.text);
      const linked = shots.filter(shot => quote && shot.anchor.includes(quote)).map(shot => shot.id);
      return { ...unit, linked, status: linked.length ? '已关联' : '待核对' };
    });
    return { rows, linked: rows.filter(row => row.linked.length).length,
      pending: rows.filter(row => !row.linked.length).length };
  }

  function describe(project, episodeIndex) {
    const episode = project.episodes[episodeIndex];
    const projectFiles = window.arcProductionProject;
    const ordered = projectFiles.storyboard(project, episodeIndex, { skipEmpty: true });
    const handoff = projectFiles.assembly(project, episodeIndex);
    const continuityBasis = window.arcContinuity.reviewBasis(project, episodeIndex);
    const durationGoal = projectFiles.targetDuration(episode);
    const minimumShotCount = Math.ceil(durationGoal / 15);
    let planned = 0;
    let readyForReview = 0;
    const handoffByShot = new Map(handoff.shots.map(shot => [shot.index, shot]));
    const rows = ordered.filter(cut => Object.keys(episode.shots[cut.index] || {}).length > 0).map(cut => {
      const shot = episode.shots[cut.index];
      const source = handoffByShot.get(cut.index);
      const anchor = projectFiles.scriptAnchorStatus(shot, episode.pages);
      const guidance = qualityAdvice(shot, cut.frame, new Map((project.assets || []).map(asset => [asset.id, asset])));
      const plannedShot = anchor.ready && exists(shot.beat) && exists(shot.composition) && cut.specified && (exists(shot.move) || cut.cameraPlan);
      const hasCandidate = exists(shot.version) && exists(shot.file);
      const ab = window.arcAB?.latest(shot);
      const generated = ab || shot.generationId ? projectFiles.generatedCandidate(shot) : null;
      if (plannedShot) planned++;
      if (hasCandidate) readyForReview++;
      const unresolved = window.arcRecheck.context(shot).filter(issue => issue.state === '仍存在');
      const art = window.arcArtReview.current(shot, project.series, episode.pages, continuityBasis);
      const artIssue = art.checks.find(item => item.result === '待返修');
      let label, reason, action, tab;
      if (!anchor.ready) {
        label = anchor.missing ? '待绑定剧本原句' : '剧本锚点待复核';
        reason = anchor.reason;
        action = '核对剧本对应';
        tab = 'board';
      } else if (unresolved.length) {
        label = '复核仍有问题';
        reason = unresolved[0].note;
        action = '查看复核';
        tab = 'review';
      } else if (artIssue || (art.stale && hasCandidate)) {
        label = art.stale ? '美术待重审' : '美术待返修';
        reason = artIssue?.note || '美术设定、剧本、连续性或镜头资料有变化';
        action = '查看美术验收';
        tab = 'review';
      } else if (source.issue) {
        label = '交接缺项';
        reason = source.issue;
        action = '补交接信息';
        tab = 'review';
      } else if (source.verdict === '通过') {
        label = '可剪辑';
        reason = source.title;
        action = '回看镜头';
        tab = 'review';
      } else if (source.verdict === '可回收' || source.verdict === '返修') {
        label = source.verdict === '返修' ? '待返修' : source.verdict;
        reason = shot.issue || '查看审片结论和候选片段';
        action = '打开审片';
        tab = 'review';
      } else if (hasCandidate) {
        label = '待审片';
        reason = source.title;
        action = '审片';
        tab = 'review';
      } else if (shot.generationId || ab) {
        label = ab ? '有白模 A/B 对照' : '有生成任务';
        reason = ab ? '打开两版状态，完成后选择候选' : '打开任务查看状态';
        action = ab ? '看两版对照' : '查生成任务';
        tab = 'generation';
      } else if (!exists(shot.beat) || !exists(shot.composition) || !cut.specified) {
        label = '待分镜';
        reason = !exists(shot.beat) ? '缺少镜头目的' : !exists(shot.composition) ? '缺少构图和表演' : '缺少预演时长';
        action = '编辑分镜';
        tab = 'board';
      } else if (!exists(shot.move) && !cut.cameraPlan) {
        label = '待运镜';
        reason = '缺少机位或镜头运动';
        action = '编辑运镜';
        tab = 'camera';
      } else if (guidance.length && !hasCandidate) {
        label = '待生成 · 有画面建议';
        reason = `可继续生成；画面质量建议：${guidance[0]}`;
        action = '直接生成';
        tab = 'generation';
      } else {
        label = '待生成';
        reason = '分镜与运镜资料已填写';
        action = '打开生成';
        tab = 'generation';
      }
      const jobId = window.arcOverviewJobs.validJobId(shot.generationId) ? shot.generationId : null;
      return { ...cut, label, reason, action, ready: label === '可剪辑', next: target('video', tab, cut.index),
        guidance,
        jobId, jobAdopted: Boolean(jobId && generated?.jobId === jobId),
        ab: ab ? { attempts: ['A', 'B'].map(variant => ({ variant, attempt: ab.attempts[variant].at(-1) })),
          adopted: generated?.comparison?.id === ab.id ? generated.comparison.variant : null } : null };
    });
    const story = exists(episode.pages.story);
    const canon = exists(episode.pages.state) && exists(episode.pages.rules);
    const continuity = window.arcContinuity.report(project, episodeIndex);
    const pendingContinuity = continuity.filter(item => item.status.startsWith('待'));
    const continuityPending = pendingContinuity.length;
    const firstOpen = rows.find(row => !row.ready);
    const workInReview = rows.find(row => !row.ready && ['review', 'generation'].includes(row.next.tab));
    const workInPlanning = rows.find(row => ['board', 'camera'].includes(row.next.tab));
    const guidanceComplete = rows.filter(row => !row.guidance.length).length;
    const scriptTarget = target('script', story && (!canon || continuityPending || continuity.length) ? 'canon' : 'script');
    const stages = [
      ['剧本与连续性', !story ? '待写本集剧本' : continuityPending ? `${continuityPending} 项状态待衔接` :
        continuity.length ? `${continuity.length} 项交接已填` : canon ? '剧本与连续性已填写' : '待补连续性', scriptTarget],
      ['分镜与运镜', !story ? '等待剧本' : rows.length ? `基本设计 ${planned} / ${rows.length} 镜 · 质量建议已处理 ${guidanceComplete} / ${rows.length} 镜` : '尚未拆分镜头', workInPlanning?.next || target('video', 'board')],
      ['生成与审片', rows.length ? `${readyForReview} / ${rows.length} 镜已登记候选` : '等待分镜镜头', workInReview?.next || target('video', 'review')],
      ['ARC 剪辑交接', rows.length ? `${handoff.ready.length} 镜 · ${(handoff.duration).toFixed(0)} / ${durationGoal} 秒` : '等待镜头通过', target('edit', 'assembly')]
    ];
    const firstContinuity = pendingContinuity[0];
    const next = !story ? { title: '开始写本集剧本', detail: '先补剧情正文，再核对人物状态与世界规则。', route: scriptTarget } :
      firstContinuity ? { title: '处理连续性缺项',
        detail: `${firstContinuity.subject} · ${firstContinuity.field} · ${firstContinuity.status}（共 ${continuityPending} 项）`,
        route: { ...scriptTarget, continuityRow: firstContinuity } } :
      !rows.length ? { title: '开始拆分分镜', detail: '本集还没有正式镜头；按剧情原文拆分后，再逐镜设计构图、表演与运镜。', route: target('video', 'board', 0) } :
      firstOpen ? { title: `${firstOpen.action} · ${firstOpen.id}`, detail: `${firstOpen.label}：${firstOpen.reason}`, route: firstOpen.next } :
        { title: '核对剪辑清单', detail: `${handoff.ready.length} 镜已通过；仍需人工确认剧情覆盖、表演和成片质量。`, route: stages.at(-1)[2] };
    const coverage = scriptCoverage(episode);
    return { rows, stages, next, coverage, durationGoal, duration: handoff.duration,
      readyShotCount: handoff.ready.length, minimumShotCount,
      durationProgress: Math.min(100, handoff.duration / durationGoal * 100),
      episodeTargetReached: handoff.ready.length >= minimumShotCount && handoff.duration >= durationGoal };
  }

  function time(ms) {
    return `${number(Math.floor(ms / 60000))}:${(ms % 60000 / 1000).toFixed(1).padStart(4, '0')}`;
  }

  function mount(host, project, episodeIndex, { selectEpisode, open, onlyOpen, setOnlyOpen, setTargetDuration, addShotFromQuote, save }) {
    const value = describe(project, episodeIndex);
    const firstRun = value.coverage.rows.length === 0 && value.rows.length === 0;
    host.classList.toggle('is-first-run', firstRun);
    host.innerHTML = `
      <header><div><h1>本集制作</h1><label>选择集数<select data-episode></select></label></div>
        <button type="button" class="overview-next"><span data-next-title></span><small data-next-detail></small></button></header>
      <section class="overview-episode-target" aria-label="整集时长目标">
        <div><strong>整集进度</strong><span data-progress-copy></span></div>
        <progress data-progress max="100" value="0" aria-label="整集时长完成度"></progress>
        <label>目标时长（秒）<input data-target type="number" min="30" max="600" step="15"></label>
        <small data-shot-floor></small>
      </section>
      <details class="overview-coverage">
        <summary>核对剧本与镜头关联 <span data-coverage-count></span></summary>
        <p>按原文逐句列出已绑定的镜头。未关联只表示需要人工核对，不自动判定剧情遗漏。</p>
        <ol data-coverage-rows></ol>
        <p data-coverage-action role="status" hidden></p>
      </details>
      <ol class="overview-stages" aria-label="制作流程"></ol>
      <div class="overview-generation" hidden><strong>本集生成任务</strong>
        <output role="status"></output><button type="button">刷新状态</button></div>
      <details class="overview-coverage" data-generation-summary hidden>
        <summary>本集生成用量 <span data-generation-count></span></summary>
        <ul data-generation-groups></ul>
        <p>普通与 A/B 任务按编号去重。各项相加的是任务耗时，实际卡时和费用以平台账单为准。</p>
      </details>
      <section class="overview-queue" aria-labelledby="overview-queue-title">
        <div class="overview-queue-head"><h2 id="overview-queue-title">镜头进度</h2>
          <label>显示<select data-filter><option value="all">全部镜头</option><option value="open">只看待处理</option></select></label>
        </div><p data-result role="status"></p><div class="overview-scroll" tabindex="0" role="region" aria-label="镜头列表">
          <ul class="overview-rows"></ul></div>
      </section>`;
    const episode = host.querySelector('[data-episode]');
    episode.id = 'episodeSelect';
    episode.name = 'episode';
    for (const [index] of project.episodes.entries()) episode.add(new Option(`第 ${number(index + 1)} 集`, index));
    episode.value = episodeIndex;
    episode.onchange = () => selectEpisode(Number(episode.value));
    const targetInput = host.querySelector('[data-target]');
    targetInput.id = 'episodeTargetDuration';
    targetInput.name = 'targetDurationSec';
    targetInput.value = value.durationGoal;
    targetInput.onchange = () => {
      const seconds = Number(targetInput.value);
      if (!Number.isInteger(seconds) || seconds < 30 || seconds > 600) {
        targetInput.value = value.durationGoal;
        targetInput.setCustomValidity('请输入 30 到 600 秒之间的整数。');
        targetInput.reportValidity();
        return;
      }
      targetInput.setCustomValidity('');
      setTargetDuration(seconds);
    };
    const progressCopy = host.querySelector('[data-progress-copy]');
    const progress = host.querySelector('[data-progress]');
    progress.value = value.durationProgress;
    progressCopy.textContent = value.episodeTargetReached ?
      `${value.readyShotCount} 镜 · ${value.duration.toFixed(1)} / ${value.durationGoal} 秒 · 时长目标已达，仍需人工确认剧情完整度` :
      `${value.readyShotCount} 镜 · ${value.duration.toFixed(1)} / ${value.durationGoal} 秒 · ${value.rows.length === 0 ? '尚未拆分镜头' : value.readyShotCount <= 1 ? '当前只是片段草稿' : '整集仍在制作中'}`;
    host.querySelector('[data-shot-floor]').textContent =
      `H3 单镜最长 15 秒；按此上限至少需要 ${value.minimumShotCount} 镜，常规节奏通常会更多。`;
    const coverageCount = host.querySelector('[data-coverage-count]');
    coverageCount.textContent = `${value.coverage.linked} / ${value.coverage.rows.length} 句已关联 · ${value.coverage.pending} 句待核对`;
    const coverageRows = host.querySelector('[data-coverage-rows]');
    const coverageAction = host.querySelector('[data-coverage-action]');
    for (const row of value.coverage.rows) {
      const item = document.createElement('li');
      const source = document.createElement('span');
      source.textContent = `${row.kind} · ${row.text}`;
      const links = document.createElement('div');
      links.className = 'overview-coverage-links';
      if (row.linked.length) {
        for (const id of row.linked) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = id;
          button.setAttribute('aria-label', `打开分镜 ${id}`);
          button.onclick = () => go(target('video', 'board', Number(id.slice(1)) - 1));
          links.append(button);
        }
      } else {
        links.dataset.pending = 'true';
        const button = document.createElement('button');
        button.type = 'button';
        const canAdd = row.text.length <= 500 && typeof addShotFromQuote === 'function';
        button.textContent = canAdd ? '用此句新建镜头' : '去分镜截取原句';
        button.onclick = () => {
          if (!canAdd) {
            go(target('video', 'board', value.rows.length ? undefined : 0));
            return;
          }
          try { addShotFromQuote(row.text); }
          catch (error) {
            coverageAction.hidden = false;
            coverageAction.textContent = error.message;
          }
        };
        links.append(button);
      }
      item.append(source, links);
      coverageRows.append(item);
    }
    const go = route => open(route.workspace, route.tab, route.index, route.continuityRow);
    const shots = project.episodes[episodeIndex].shots;
    let observed = new Map();
    function renderMetrics() {
      const metrics = window.arcGenerationLog.summarize(shots, window.arcAB?.pairs, observed);
      host.querySelector('[data-generation-summary]').hidden = !metrics.total;
      if (!metrics.total) return;
      host.querySelector('[data-generation-count]').textContent = `已记录 ${metrics.total} 次结束的任务`;
      const groups = [
        ['生成服务记录', metrics.service],
        ['本地模拟记录', metrics.fixtures],
        ['未标记来源的旧记录', metrics.unknown]
      ];
      const list = host.querySelector('[data-generation-groups]');
      list.replaceChildren(...groups.filter(([, group]) => group.total).map(([label, group]) => {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = label;
        const counts = document.createElement('p');
        counts.textContent = `常规 ${group.standard} · A ${group.A} · B ${group.B} · 回片 ${group.returned} · 未回片 ${group.failed + group.noVideo}` +
          (group.retry ? ` · 含 A/B 重试 ${group.retry} 次` : '');
        const format = (name, entry) => entry.count ?
          `${name} ${(entry.milliseconds / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 秒（${entry.count}/${group.total} 次有记录）` :
          `${name}暂无记录`;
        const time = document.createElement('p');
        time.textContent = [format('累计排队', group.queue), format('累计执行', group.execution)].join(' · ');
        item.append(title, counts, time);
        return item;
      }));
    }
    renderMetrics();
    const primary = host.querySelector('.overview-next');
    primary.querySelector('[data-next-title]').textContent = value.next.title;
    primary.querySelector('[data-next-detail]').textContent = value.next.detail;
    primary.onclick = () => go(value.next.route);
    for (const [name, status, route] of value.stages) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const title = document.createElement('strong');
      title.textContent = name;
      const detail = document.createElement('span');
      detail.textContent = status;
      button.append(title, detail);
      button.onclick = () => go(route);
      item.append(button);
      host.querySelector('.overview-stages').append(item);
    }
    const filter = host.querySelector('[data-filter]');
    filter.id = 'shotProgressFilter';
    filter.name = 'shotProgressFilter';
    filter.value = onlyOpen ? 'open' : 'all';
    const list = host.querySelector('.overview-rows');
    const tracked = new Set(value.rows.flatMap(row => [row.jobId, ...(row.ab?.attempts || [])
      .filter(({ attempt }) => attempt?.status !== 'rejected').map(({ attempt }) => attempt?.id)])
      .filter(window.arcOverviewJobs.validJobId));
    const entries = value.rows.map(row => {
      const item = document.createElement('li');
      if (row.frame?.image) {
        const image = document.createElement('img');
        image.src = row.frame.image;
        image.alt = '';
        image.width = 72;
        image.height = 48;
        image.loading = 'lazy';
        item.append(image);
      }
      const copy = document.createElement('div');
      copy.className = 'overview-shot';
      const title = document.createElement('strong');
      title.textContent = row.id + (row.beat ? ' · ' + row.beat : '');
      const range = document.createElement('span');
      range.textContent = `${time(row.start)}–${time(row.end)}${row.specified ? '' : ' · 暂定'}`;
      copy.append(title, range);
      const state = document.createElement('div');
      state.className = 'overview-shot-status';
      state.dataset.ready = String(row.ready);
      const name = document.createElement('strong');
      name.textContent = row.label;
      const reason = document.createElement('span');
      reason.textContent = row.reason;
      state.append(name, reason);
      if (row.guidance.length) {
        const guidance = document.createElement('small');
        guidance.className = 'overview-shot-guidance';
        guidance.textContent = `画面质量建议：${row.guidance.slice(0, 3).join('；')}${row.guidance.length > 3 ? `；另有 ${row.guidance.length - 3} 项` : ''}`;
        state.append(guidance);
      }
      let jobLabel;
      if (row.jobId) {
        jobLabel = document.createElement(row.next.tab === 'generation' ? 'span' : 'button');
        jobLabel.className = 'overview-row-job';
        if (jobLabel.tagName === 'BUTTON') {
          jobLabel.type = 'button';
          jobLabel.onclick = () => go(target('video', 'generation', row.index));
        }
        state.append(jobLabel);
      }
      let comparisonLabel;
      if (row.ab) {
        comparisonLabel = document.createElement('button');
        comparisonLabel.type = 'button';
        comparisonLabel.className = 'overview-row-job';
        comparisonLabel.onclick = () => go(target('video', 'generation', row.index));
        state.append(comparisonLabel);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = row.action;
      button.setAttribute('aria-label', row.action + ' ' + row.id);
      button.onclick = () => go(row.next);
      item.append(copy, state, button);
      list.append(item);
      return { row, item, jobLabel, comparisonLabel };
    });
    const watcher = window.arcOverviewJobs.watch(host.querySelector('.overview-generation'), [...tracked], jobs => {
      observed = new Map(jobs.map(job => [job.id, job]));
      const changed = [];
      for (const shot of shots) {
        const job = observed.get(shot.generationId);
        if (!job) continue;
        const log = window.arcGenerationLog.nextLog(shot, job);
        if (!log) continue;
        changed.push([shot, shot.generationLog]);
        shot.generationLog = log;
      }
      if (changed.length && save() === false) {
        for (const [shot, previous] of changed) {
          if (previous === undefined) delete shot.generationLog;
          else shot.generationLog = previous;
        }
        host.querySelector('.overview-generation output').append(' · 新耗时记录保存失败');
      }
      renderMetrics();
      renderRows();
    });
    function renderRows() {
      if (!value.rows.length) {
        filter.disabled = true;
        host.querySelector('.overview-scroll').hidden = true;
        host.querySelector('[data-result]').textContent = '本集尚未拆分镜头。先写好剧本，再进入分镜把剧情拆成多个镜头。';
        return;
      }
      filter.disabled = false;
      let visible = 0;
      for (const { row, item, jobLabel, comparisonLabel } of entries) {
        const job = row.jobId ? watcher.value(row.jobId, row.jobAdopted) : null;
        if (jobLabel) {
          jobLabel.textContent = job.title;
          if (jobLabel.tagName === 'BUTTON') jobLabel.setAttribute('aria-label', row.id + ' ' + job.title);
        }
        let comparisonPending = false;
        if (comparisonLabel) {
          const variants = row.ab.attempts.map(({ variant, attempt }) => ({
            variant, ...watcher.value(attempt?.id, row.ab.adopted === variant, attempt)
          }));
          const title = variants.map(({ variant, title }) => variant + ' ' + title).join(' · ');
          comparisonLabel.textContent = title;
          comparisonLabel.setAttribute('aria-label', `${row.id} 白模 A/B · ${title}`);
          comparisonPending = !row.ab.adopted || variants.some(variant => !variant.terminal);
        }
        const shown = filter.value === 'all' || !row.ready || Boolean(job && !job.done) || comparisonPending;
        if (!shown && item.contains(document.activeElement)) filter.focus();
        item.hidden = !shown;
        if (shown) visible++;
      }
      host.querySelector('.overview-scroll').hidden = !visible;
      host.querySelector('[data-result]').textContent = visible === 0 ? '本集没有待处理的镜头。' :
        `显示 ${visible} / ${value.rows.length} 镜 · 时间沿用动态分镜`;
    }
    filter.onchange = () => { setOnlyOpen(filter.value === 'open'); renderRows(); };
    renderRows();
    return watcher;
  }

  window.arcOverview = { mount, qualityAdvice, scriptCoverage, describe };
})();
