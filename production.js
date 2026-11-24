(() => {
  const root = document.querySelector('#productionWorkspace');
  const projectFiles = window.arcProductionProject;
  const scriptImport = window.arcScriptImport;
  const storageKey = 'arc-production-v1';
  const workspaces = {
    script: {
      script: ['剧本', '本集', '写清本集发生了什么，以及观众最后知道了什么。', [
        ['story', '剧情与场次', '先写粗稿：人物想要什么 → 遇到什么阻碍 → 发生什么变化 → 留下什么悬念'],
        ['dialogue', '对白与旁白（可后补）', '按场标出说话人；需要时再写动作、停顿和潜台词'],
        ['sceneOutline', '场次索引（人工确认草案）', '只整理识别到的场次标题与原稿行号；原始剧情正文始终保留']
      ]],
      canon: ['连续性', '本集', '记录本集开场状态与结尾状态，供下一集对照。', [
        ['state', '人物与道具状态', '位置、服装、伤情、持有道具、已知信息'],
        ['rules', '世界观与数值核对', '需要遵守的规则、能力上限、时间和数值']
      ]],
      assistant: ['剧本主编', '本集', '围绕剧本、对白和连续性讨论修改。', []]
    },
    video: {
      art: ['美术设定', '全剧', '定下全剧共用的视觉规则。镜头里的例外写在分镜。', [
        ['character', '角色与服装', '三视图、表情图、服装和道具的资产名或版本'],
        ['look', '场景与灯光', '空间地标、光源方向、色板、材质和景深'],
        ['limits', '风格边界', '哪些元素可以变化，哪些必须保持一致']
      ]],
      assets: ['美术参考库', '全剧', '建立角色、场景、道具和光色参考，分镜可直接引用指定版本。', []],
      board: ['分镜', '镜头', '写清这一个镜头要交代什么，以及怎么接前后镜头。', [
        ['scriptAnchor', '剧本原文锚点', '从本集剧情或对白复制本镜对应的一句原文；修改本句或本镜剧情目的后需重新视觉验收'],
        ['beat', '剧情目的', '本镜传递什么信息，推动什么变化'],
        ['composition', '构图与走位', '景别、主体位置、视线方向、前后景关系与人物走位'],
        ['performance', '表演节拍与表情', '写开始状态 → 情绪/表情变化 → 动作落点；注明眼神、嘴部、头部或手部细节'],
        ['reference', '补充参考说明（可选）', '只写特殊借用要求；角色、场景和关键画面请在下方参考库按版本绑定']
      ]],
      animatic: ['动态分镜', '本集', '把关键画面按时长排起来，用临时对白预演整集节奏。', []],
      assistant: ['视频总导演', '本集', '围绕当前镜头讨论构图、参考、表演和返修。', []],
      camera: ['运镜', '镜头', '设计机位运动与起止构图；人物表演节拍在分镜中维护。需要精确视差时，可另附三维预演。', [
        ['move', '主要运镜', '固定、推进、横移、跟拍或环绕'],
        ['path', '起止构图与节奏', '起点 → 方向与速度 → 落点，补充焦点与视差'],
        ['guide', '运动参考与保留项', '参考视频或预演版本，以及脸、道具、背景的保护要求'],
        ['lighting', '本镜灯光与连续性', '写场景中的主光位置与软硬、冷暖关系、反打时不能变的光影。例如左侧暖灯为主光；右后门有冷色轮廓，切近景时保留。']
      ]],
      generation: ['生成任务', '镜头', '核对本镜提示词与参考，再提交给所配置的 ComfyUI 服务。', []],
      review: ['镜头审片', '镜头', '记录缺陷发生的时间，决定换版本、返修还是保留。', [
        ['version', '候选素材版本', '例：S01 v03，记录文件名与模型设置'],
        ['issue', '整镜审片结论', '整体判断、保留项与修改范围']
      ]]
    },
    edit: {
      assembly: ['剪辑交接', '本集', '把已通过镜头的顺序、源版本和声音需求交给 ARC。', [
        ['order', '镜头顺序与切点', '镜头编号、版本、入出点和转场'],
        ['audio', '对白、字幕与配乐', '分轨文件名、字幕时间码、混音和重点切点']
      ]],
      finish: ['画质后期', '镜头', '登记要处理的镜头和比较标准，保留原版用于回看。', [
        ['treatment', '处理方案', '裁切、遮罩、画中画、补帧、超分或降噪需求'],
        ['check', '交付检查', '检查脸和发丝是否改变、切点是否重影、声画是否同步']
      ]],
      assistant: ['剪辑负责人', '本集', '围绕时间线节奏、对白和镜头交接讨论调整。', []]
    }
  };
  const flowGroups = {
    script: [
      { label: '01 · 剧情设定', tabs: ['script', 'canon'] },
      { label: '02 · 主编助手', tabs: ['assistant'] }
    ],
    video: [
      { label: '01 · 视觉基准', tabs: ['art', 'assets'] },
      { label: '02 · 镜头设计', tabs: ['board', 'animatic', 'camera'] },
      { label: '03 · 生成审片', tabs: ['generation', 'review'] },
      { label: '辅助工具', tabs: ['assistant'] }
    ],
    edit: [
      { label: '01 · 剪辑与后期', tabs: ['assembly', 'finish'] },
      { label: '辅助工具', tabs: ['assistant'] }
    ]
  };
  const empty = () => ({ series: {}, episodes: [{ pages: {}, targetDurationSec: 90, shots: [{}] }] });
  let data = empty();
  let lastScriptImportUndo = null;
  let storageError = false;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) data = projectFiles.restore(projectFiles.backup(JSON.parse(raw)));
  } catch {
    data = empty();
    storageError = true;
  }
  let workspace = 'script';
  let tab = 'script';
  const lastWorkflowTab = { script: 'script', video: 'art', edit: 'assembly' };
  let workflowRouteTimer;
  let episodeIndex = 0;
  let shotIndex = 0;
  const mediaUrls = new Set();
  const dialogueFiles = new Map();
  const handoffDialogueFiles = new Map();
  let animatic;
  let cameraPreview;
  let artReview;
  let generationPanel;
  let motionPanel;
  let pairedReview;
  let relayRawPreview;
  let abReturnPanel;
  let stationABReview;
  let assistantRuntime;
  let reviewVisionSeed;
  const reviewMedia = new WeakMap();
  const enhancedMedia = new WeakMap();
  const assistantThreads = new Map();
  let overviewOnlyOpen = false;
  let overviewOpenWorkspace;
  let overviewRuntime;
  let refreshShotContext;
  const number = index => String(index + 1).padStart(2, '0');
  const projectDialog = document.querySelector('#projectDialog');
  const importInput = document.querySelector('#openProject');
  const projectMessage = document.querySelector('#projectMessage');
  const restoreButton = document.querySelector('#restoreProject');
  let pendingProject;
  let importRequest = 0;

  function download(name, value) {
    const csv = name.endsWith('.csv');
    const url = URL.createObjectURL(new Blob([csv ? value : JSON.stringify(value, null, 2)],
      { type: csv ? 'text/csv;charset=utf-8' : 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  document.querySelector('#projectFiles').onclick = () => projectDialog.showModal();
  window.arcWorkflowAudit.mount(projectDialog.querySelector('#workflowAudit'), download, evidence => {
    const previous = data.modelFileEvidence;
    const sameSet = item => item.providerFingerprint && evidence.providerFingerprint ?
      item.modelSetSha256 === evidence.modelSetSha256 && item.providerFingerprint === evidence.providerFingerprint :
      item.workflowSha256 === evidence.workflowSha256;
    data.modelFileEvidence = [...(previous || []).filter(item => !sameSet(item)),
      JSON.parse(JSON.stringify(evidence))].slice(-32);
    if (save()) return true;
    if (previous === undefined) delete data.modelFileEvidence; else data.modelFileEvidence = previous;
    return false;
  });
  document.querySelector('#saveProject').onclick = () => download('弧光项目备份.json', projectFiles.backup(data));
  importInput.onchange = async () => {
    const request = ++importRequest;
    pendingProject = undefined;
    restoreButton.disabled = true;
    const file = importInput.files[0];
    projectMessage.textContent = file ? '正在检查备份…' : '';
    if (!file) return;
    try {
      const project = projectFiles.restore(JSON.parse(await file.text()));
      if (request !== importRequest) return;
      pendingProject = project;
      restoreButton.disabled = false;
      projectMessage.textContent = `备份包含 ${project.episodes.length} 集。恢复会替换当前项目，可先下载当前备份。`;
    } catch (error) {
      if (request === importRequest) projectMessage.textContent =
        error instanceof SyntaxError ? '文件不是有效的 JSON。当前项目已保留。' : error.message;
    }
  };
  restoreButton.onclick = () => { if (pendingProject) installProject(pendingProject); };
  function installProject(project) {
    ++importRequest;
    lastScriptImportUndo = null;
    try {
      localStorage.setItem(storageKey, JSON.stringify(project));
    } catch {
      projectMessage.textContent = '浏览器无法保存恢复后的项目。当前项目已保留。';
      return false;
    }
    data = project;
    assistantThreads.clear();
    dialogueFiles.clear();
    handoffDialogueFiles.clear();
    episodeIndex = 0;
    shotIndex = 0;
    storageError = false;
    if (root.childElementCount) render();
    if (overviewOpenWorkspace && !document.querySelector('#homeView').hidden) showOverview(overviewOpenWorkspace);
    projectMessage.textContent = `已恢复 ${data.episodes.length} 集。`;
    pendingProject = undefined;
    restoreButton.disabled = true;
    importInput.value = '';
    return true;
  }
  projectDialog.addEventListener('close', () => {
    ++importRequest;
    pendingProject = undefined;
    restoreButton.disabled = true;
    importInput.value = '';
    projectMessage.textContent = '';
  });

  function close() {
    refreshShotContext = undefined;
    assistantRuntime?.dispose();
    assistantRuntime = undefined;
    generationPanel?.dispose();
    generationPanel = undefined;
    motionPanel?.dispose();
    motionPanel = undefined;
    pairedReview?.dispose();
    pairedReview = undefined;
    relayRawPreview?.dispose();
    relayRawPreview = undefined;
    abReturnPanel?.dispose();
    abReturnPanel = undefined;
    stationABReview?.dispose();
    stationABReview = undefined;
    animatic?.dispose();
    animatic = undefined;
    cameraPreview?.dispose();
    cameraPreview = undefined;
    artReview?.dispose();
    artReview = undefined;
    clearTimeout(workflowRouteTimer);
    for (const player of root.querySelectorAll('video')) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    for (const url of mediaUrls) URL.revokeObjectURL(url);
    mediaUrls.clear();
    root.replaceChildren();
  }

  function renderScriptImportUndo() {
    if (!lastScriptImportUndo) return;
    if (localStorage.getItem(storageKey) !== lastScriptImportUndo.afterStored) {
      lastScriptImportUndo = null;
      return;
    }
    const notice = document.createElement('aside');
    notice.className = 'script-import-undo';
    notice.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = '剧本已导入。继续编辑后将不能撤销这次导入。';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '撤销导入';
    button.onclick = () => {
      if (!lastScriptImportUndo || localStorage.getItem(storageKey) !== lastScriptImportUndo.afterStored) {
        lastScriptImportUndo = null;
        notice.remove();
        return;
      }
      const snapshot = lastScriptImportUndo;
      try {
        if (snapshot.beforeStored === null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, snapshot.beforeStored);
      } catch {
        text.textContent = '浏览器存储失败，未撤销；当前项目保持不变。';
        button.disabled = true;
        return;
      }
      data = JSON.parse(snapshot.beforeData);
      episodeIndex = snapshot.beforeEpisodeIndex;
      shotIndex = 0;
      lastScriptImportUndo = null;
      render();
    };
    notice.append(text, button);
    root.append(notice);
  }

  function render(continuityTask) {
    close();
    const episode = data.episodes[episodeIndex];
    const [title, scope, description, fields] = workspaces[workspace][tab];
    const record = scope === '全剧' ? data.series :
      scope === '镜头' ? episode.shots[shotIndex] : episode.pages;
    root.innerHTML = `
      <section class="workflow-route" aria-label="主制作流程"></section>
      <div class="production-shell">
        <aside class="production-nav" aria-label="本工作室流程">
          <div class="production-picker">
            <label>当前集<select id="production-episode"></select></label>
            <button type="button" id="production-add-episode">新建一集</button>
          </div>
          <div class="production-tabs"></div>
        </aside>
        <section class="production-panel" aria-labelledby="production-title">
          <header class="production-head">
            <div><span class="production-scope"></span><h2 id="production-title"></h2><p></p></div>
            ${['art', 'assets'].includes(tab) ? '<img src="assets/studio-art-direction.png" alt="" width="92" height="92">' : ''}
            ${workspace === 'script' && tab === 'script' ? `<div class="script-import-entry">
              <button type="button" class="production-action" data-script-import-open>导入剧本</button>
              <input type="file" accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" data-script-import-file hidden>
            </div>
            <dialog class="script-import-dialog" data-script-import-dialog aria-labelledby="script-import-title">
              <button type="button" class="dialog-close" aria-label="关闭">×</button>
              <span class="production-kicker">SCRIPT IMPORT</span><h2 id="script-import-title">导入整部剧本</h2>
              <p>按“第 N 集 / EP N”自动匹配。文件只在本地解析；来源记录只存文件名、SHA-256、时间和分集操作，不额外存一份原稿副本。你选择导入的剧情正文仍会写入对应分集；已有正文默认保留。</p>
              <div class="script-import-controls" data-script-import-controls hidden>
                <label>起始目标集<input type="number" min="1" max="300" value="1" data-script-import-start></label>
                <small>按原集数间隔顺延；每一集仍可单独调整目标集。</small>
              </div>
              <section class="script-import-preface" data-script-import-preface hidden>
                <label><input type="checkbox" data-script-import-include-preface checked> 将集数标题前的说明并入文件第一集</label>
                <details><summary>查看标题前说明</summary><pre data-script-import-preface-text></pre></details>
              </section>
              <section class="script-import-repeat" data-script-import-repeat hidden>
                <output role="alert" data-script-import-repeat-warning></output>
                <label><input type="checkbox" data-script-import-repeat-confirm> 我确认仍要继续这次重复导入</label>
              </section>
              <output role="alert" data-script-import-error hidden></output>
              <output role="status" data-script-import-summary></output>
              <div class="script-import-rows" data-script-import-rows></div>
              <div class="script-import-actions"><button type="button" data-script-import-cancel>取消</button>
                <button type="button" class="production-action" data-script-import-apply disabled>导入所选集</button></div>
            </dialog>` : ''}
          </header>
          <div id="production-shot-bar" class="production-picker" hidden>
            <label>当前镜头<select id="production-shot"></select></label>
            <button type="button" id="production-add-shot">添加镜头</button>
            <section class="production-shot-next" id="production-shot-next" aria-label="本镜下一步" hidden>
              <div><strong></strong><small></small></div>
              <button type="button" class="production-action"></button>
            </section>
          </div>
          <form class="production-form"></form>
        </section>
      </div>`;
    renderWorkflowRoute();
    root.querySelector('#production-title').textContent = title;
    root.querySelector('.production-scope').textContent = scope === '全剧' ? scope :
      `第 ${number(episodeIndex)} 集${scope === '镜头' ? ' / S' + number(shotIndex) : ''}`;
    root.querySelector('.production-head p').textContent = description;

    function options(selector, items, index, label) {
      const select = root.querySelector(selector);
      items.forEach((_, i) => select.add(new Option(label + number(i), i)));
      select.value = index;
      return select;
    }
    const episodeSelect = root.querySelector('#production-episode');
    data.episodes.forEach((item, index) => episodeSelect.add(new Option(
      `第 ${number(index)} 集${item.episodeTitle ? ' · ' + item.episodeTitle : ''}`, index)));
    episodeSelect.value = episodeIndex;
    episodeSelect.onchange = event => {
      episodeIndex = Number(event.target.value);
      shotIndex = 0;
      render();
    };
    if (workspace === 'script' && tab === 'script') {
      const openImport = root.querySelector('[data-script-import-open]');
      const fileInput = root.querySelector('[data-script-import-file]');
      const dialog = root.querySelector('[data-script-import-dialog]');
      const summary = root.querySelector('[data-script-import-summary]');
      const errorOutput = root.querySelector('[data-script-import-error]');
      const rowsHost = root.querySelector('[data-script-import-rows]');
      const applyButton = root.querySelector('[data-script-import-apply]');
      const controls = root.querySelector('[data-script-import-controls]');
      const startInput = root.querySelector('[data-script-import-start]');
      const prefacePanel = root.querySelector('[data-script-import-preface]');
      const prefaceCheckbox = root.querySelector('[data-script-import-include-preface]');
      const prefaceText = root.querySelector('[data-script-import-preface-text]');
      const repeatPanel = root.querySelector('[data-script-import-repeat]');
      const repeatWarning = root.querySelector('[data-script-import-repeat-warning]');
      const repeatConfirm = root.querySelector('[data-script-import-repeat-confirm]');
      let importPlan = null;
      let duplicateSource = null;
      openImport.onclick = () => fileInput.click();
      root.querySelector('.dialog-close').onclick = () => dialog.close();
      root.querySelector('[data-script-import-cancel]').onclick = () => dialog.close();
      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        try {
          summary.textContent = '正在本地读取剧本…';
          const parsed = scriptImport.parse(await scriptImport.readFile(file));
          summary.textContent = '正在本地计算文件指纹…';
          const sha256 = await window.ArcStreamSha256.file(file);
          const fileName = String(file.name || '剧本').split(/[\\/]/u).pop().slice(0, 240);
          const format = fileName.split('.').pop().toLowerCase();
          const source = { sha256, fileName, fileSize: file.size, format };
          importPlan = scriptImport.plan(parsed, data, episodeIndex);
          importPlan.source = source;
          duplicateSource = (data.scriptImportHistory || []).find(item => item.sha256 === sha256) || null;
          rowsHost.replaceChildren();
          errorOutput.hidden = true;
          errorOutput.textContent = '';
          controls.hidden = !importPlan.hasEpisodeHeadings;
          startInput.value = String(importPlan.sourceStart);
          prefacePanel.hidden = !importPlan.preface;
          prefaceText.textContent = importPlan.preface;
          prefaceCheckbox.checked = true;
          repeatConfirm.checked = false;
          const targetInputs = [];
          const actionInputs = [];
          if (!importPlan.hasEpisodeHeadings) {
            summary.textContent = `未识别到分集标题；将这份剧本暂配到当前选择的第 ${number(episodeIndex)} 集。`;
          } else {
            summary.textContent = `识别到 ${importPlan.items.length} 个集标题。默认按原集数匹配；需要续季或分批导入时，可改起始集或逐集指定目标集。`;
          }
          importPlan.items.forEach((item, index) => {
            const card = document.createElement('section');
            card.className = 'script-import-row';
            const heading = document.createElement('h3');
            heading.textContent = `${item.number === null ? '未分集剧本' : `原稿第 ${number(item.number - 1)} 集`}${item.title ? ' · ' + item.title : ''}`;
            const match = document.createElement('p');
            const targetLabel = document.createElement('label');
            targetLabel.textContent = '目标集数';
            const target = document.createElement('input');
            target.type = 'number'; target.min = '1'; target.max = '300'; target.value = String(item.targetNumber);
            target.setAttribute('aria-label', `原稿第 ${item.number ?? number(episodeIndex)} 集的目标集数`);
            targetLabel.append(target);
            targetInputs.push(target);
            const refreshMatch = () => {
              const targetIndex = Number(target.value) - 1;
              const existing = data.episodes[targetIndex];
              match.textContent = !Number.isInteger(targetIndex) || targetIndex < 0 ? '请输入 1–300 的目标集数。' :
                existing ? `匹配到项目第 ${number(targetIndex)} 集${existing.episodeTitle ? ` · ${existing.episodeTitle}` : ''}${existing.pages?.story?.trim() ? '；已有正文' : '；正文为空'}。` : `将新建项目第 ${number(targetIndex)} 集${targetIndex > data.episodes.length ? `，并补齐前面的 ${targetIndex - data.episodes.length + 1} 个集位` : ''}。`;
            };
            refreshMatch();
            const details = document.createElement('p');
            details.className = 'script-import-existing';
            details.textContent = item.empty ? '这个集标题下没有正文；不会静默丢掉，可选择只补集名。' : '已有剧情正文默认保留。对白、设定和分镜不会被剧情导入覆盖。';
            const actionLabel = document.createElement('label');
            actionLabel.textContent = '导入方式';
            const action = document.createElement('select');
            const choices = item.empty ? [['keep', '不导入此空集'], ...(item.title ? [['title', '仅补集名']] : []),
              ...(index === 0 && importPlan.preface ? [['preface', '只导入集前说明']] : [])] :
              [['keep', '保留原稿'], ['replace', '替换剧情正文'], ['append', '追加到原文后']];
            for (const [value, label] of choices) {
              action.add(new Option(label, value));
            }
            action.value = item.suggestedAction;
            action.setAttribute('aria-label', `原稿第 ${item.number ?? number(episodeIndex)} 集导入方式`);
            action.dataset.userSelected = 'false';
            action.onchange = () => { action.dataset.userSelected = 'true'; updateImportState(); };
            actionLabel.append(action);
            actionInputs.push(action);
            const preview = document.createElement('details');
            const previewTitle = document.createElement('summary');
            previewTitle.textContent = item.empty ? '无正文' : `预览导入正文（${item.text.length} 字）`;
            const previewText = document.createElement('pre');
            previewText.textContent = item.text.slice(0, 1200) + (item.text.length > 1200 ? '\n…（仅显示前 1200 字）' : '');
            preview.append(previewTitle, previewText);
            card.append(heading, targetLabel, match, details, actionLabel, preview);
            card.dataset.itemIndex = String(index);
            rowsHost.append(card);
            target.oninput = () => {
              refreshMatch();
              if (action.dataset.userSelected !== 'true') {
                const targetEpisode = data.episodes[Number(target.value) - 1];
                action.value = item.empty ? 'keep' : targetEpisode?.pages?.story?.trim() ? 'keep' : 'replace';
              }
              updateImportState();
            };
          });
          const updateImportState = () => {
            const selected = actionInputs.filter(item => item.value !== 'keep').length;
            const targets = targetInputs.map(item => Number(item.value));
            const duplicate = new Set(targets).size !== targets.length;
            const badTarget = targetInputs.some(item => !item.value || !item.checkValidity());
            const titleConflict = actionInputs.some((action, index) => action.value === 'title' && data.episodes[targets[index] - 1]?.episodeTitle);
            const prefaceBlocked = Boolean(importPlan.preface && prefaceCheckbox.checked && actionInputs[0] && ['keep', 'title'].includes(actionInputs[0].value));
            const repeatedAppendTargets = importPlan.items.flatMap((item, index) => {
              if (actionInputs[index].value !== 'append' || !item.text.trim()) return [];
              const existing = data.episodes[targets[index] - 1]?.pages?.story;
              return typeof existing === 'string' && existing.includes(item.text.trim()) ? [targets[index]] : [];
            });
            const repeatNeeded = Boolean(duplicateSource || repeatedAppendTargets.length);
            repeatPanel.hidden = !repeatNeeded;
            if (!repeatNeeded) repeatConfirm.checked = false;
            repeatWarning.textContent = [
              duplicateSource ? `这个文件已于 ${new Date(duplicateSource.importedAt).toLocaleString('zh-CN')} 导入过（${duplicateSource.fileName}）。` : '',
              repeatedAppendTargets.length ? `第 ${[...new Set(repeatedAppendTargets)].map(target => number(target - 1)).join('、')} 集的剧情正文已包含本次准备追加的完整段落。` : ''
            ].filter(Boolean).join(' ');
            const added = targets.filter(target => target > data.episodes.length).length;
            summary.textContent = `${selected} 集将写入；${duplicate ? '有多集指向同一目标集。' : ''}${added ? `将自动补齐并新建至第 ${Math.max(...targets)} 集。` : ''}`;
            errorOutput.hidden = !(duplicate || badTarget || titleConflict || prefaceBlocked);
            errorOutput.textContent = duplicate ? '目标集重复，请为每一集指定不同的目标。' : badTarget ? '目标集数必须在 1–300 之间。' : titleConflict ? '目标集已有集名；为避免悄悄改名，请取消“仅补集名”或改选目标集。' : prefaceBlocked ? '集前说明要并入第一集时，请将原稿第一集设为追加或替换。' : '';
            applyButton.disabled = selected === 0 || duplicate || badTarget || titleConflict || prefaceBlocked || repeatNeeded && !repeatConfirm.checked;
            applyButton.textContent = selected ? `导入所选 ${selected} 集` : '导入所选集';
          };
          startInput.oninput = () => {
            const start = Number(startInput.value);
            if (!Number.isInteger(start) || start < 1 || start > 300) { updateImportState(); return; }
            importPlan.items.forEach((item, index) => {
              targetInputs[index].value = String(start + (item.number === null ? 0 : item.number - importPlan.sourceStart));
              targetInputs[index].dispatchEvent(new Event('input'));
            });
            updateImportState();
          };
          prefaceCheckbox.onchange = () => {
            if (!prefaceCheckbox.checked && actionInputs[0]?.value === 'preface') {
              actionInputs[0].value = 'keep';
              actionInputs[0].dataset.userSelected = 'false';
            }
            updateImportState();
          };
          repeatConfirm.onchange = updateImportState;
          updateImportState();
          dialog.showModal();
        } catch (error) {
          importPlan = null;
          window.alert(error.message || '无法读取剧本文件。');
        }
      };
      applyButton.onclick = () => {
        if (!importPlan) return;
        try {
          const actions = [...rowsHost.querySelectorAll('select')].map(item => item.value);
          const targetNumbers = [...rowsHost.querySelectorAll('input[type="number"]')].map(item => Number(item.value));
          const beforeStored = localStorage.getItem(storageKey);
          const beforeData = JSON.stringify(data);
          const beforeEpisodeIndex = episodeIndex;
          const nextProject = scriptImport.apply(data, importPlan, actions, targetNumbers, prefaceCheckbox.checked);
          if ((duplicateSource || importPlan.items.some((item, index) => actions[index] === 'append' && item.text.trim() &&
              data.episodes[targetNumbers[index] - 1]?.pages?.story?.includes(item.text.trim()))) && !repeatConfirm.checked) {
            throw new Error('检测到重复来源或重复追加；请在预览中确认后再继续。');
          }
          const historyEntry = {
            schema: 'arc-script-import-v1', sha256: importPlan.source.sha256,
            fileName: importPlan.source.fileName, fileSize: importPlan.source.fileSize, format: importPlan.source.format,
            importedAt: new Date().toISOString(), prefaceIncluded: Boolean(prefaceCheckbox.checked && importPlan.preface),
            mappings: importPlan.items.map((item, index) => ({ sourceEpisode: item.number, targetEpisode: targetNumbers[index], action: actions[index] }))
          };
          nextProject.scriptImportHistory = [...(data.scriptImportHistory || []), historyEntry].slice(-50);
          const nextStored = JSON.stringify(nextProject);
          try { localStorage.setItem(storageKey, nextStored); }
          catch { summary.textContent = '浏览器存储空间不足，未写入项目；当前剧本保持不变。'; return; }
          const firstChanged = importPlan.items.find((_, index) => actions[index] !== 'keep');
          data = nextProject;
          episodeIndex = firstChanged ? targetNumbers[importPlan.items.indexOf(firstChanged)] - 1 : episodeIndex;
          shotIndex = 0;
          storageError = false;
          assistantThreads.clear();
          lastScriptImportUndo = { beforeStored, beforeData, afterStored: nextStored, beforeEpisodeIndex };
          dialog.close();
          render();
          root.querySelector('[data-save-status]')?.replaceChildren(document.createTextNode(`已导入并保存 ${actions.filter(action => action !== 'keep').length} 集剧情正文；其他项目内容已保留。`));
        } catch (error) { errorOutput.hidden = false; errorOutput.textContent = error.message || '导入失败，项目未更改。'; }
      };
    }
    root.querySelector('#production-add-episode').onclick = () => {
      data.episodes.push({ pages: {}, targetDurationSec: 90, shots: [{}] });
      episodeIndex = data.episodes.length - 1;
      shotIndex = 0;
      render();
      save();
    };
    if (scope === '镜头') {
      root.querySelector('#production-shot-bar').hidden = false;
      options('#production-shot', episode.shots, shotIndex, 'S').onchange = event => {
        shotIndex = Number(event.target.value);
        render();
      };
      root.querySelector('#production-add-shot').onclick = () => {
        episode.shots.push({});
        shotIndex = episode.shots.length - 1;
        episode.shotOrder?.push(shotIndex);
        render();
        save();
      };
      const nextPanel = root.querySelector('#production-shot-next');
      const nextTitle = nextPanel.querySelector('strong');
      const nextReason = nextPanel.querySelector('small');
      const nextButton = nextPanel.querySelector('button');
      const refresh = () => {
        const row = window.arcOverview.describe(data, episodeIndex).rows.find(item => item.index === shotIndex);
        const target = row?.next;
        const alreadyHere = target && target.workspace === workspace && target.tab === tab && target.index === shotIndex;
        nextPanel.hidden = !row || !target || alreadyHere;
        if (!row || !target || alreadyHere) return;
        nextTitle.textContent = `${row.id} · ${row.label}`;
        nextReason.textContent = row.reason;
        nextButton.textContent = `${row.action} →`;
        nextButton.setAttribute('aria-label', `${row.id} ${row.label}：${row.action}。${row.reason}`);
        nextButton.onclick = () => window.dispatchEvent(new CustomEvent('arc-production-route', {
          detail: { workspace: target.workspace, tab: target.tab, shot: target.index }
        }));
      };
      refreshShotContext = refresh;
      refresh();
    }
    for (const group of flowGroups[workspace]) {
      const section = document.createElement('details');
      section.className = 'production-tab-group';
      section.open = group.tabs.includes(tab);
      const heading = document.createElement('summary');
      heading.textContent = group.label;
      section.append(heading);
      const list = document.createElement('div');
      list.className = 'production-tab-list';
      for (const key of group.tabs) {
        const [label] = workspaces[workspace][key];
        const button = document.createElement('button');
        button.textContent = label;
        button.setAttribute('aria-pressed', String(key === tab));
        button.onclick = () => {
          tab = key;
          render();
          root.querySelector('[aria-pressed="true"]').focus();
        };
        list.append(button);
      }
      section.append(list);
      root.querySelector('.production-tabs').append(section);
    }
    const tabStrip = root.querySelector('.production-tabs');
    const activeGroup = tabStrip.querySelector('.production-tab-group[open]');
    if (activeGroup && matchMedia('(max-width: 740px)').matches) {
      const stripBox = tabStrip.getBoundingClientRect();
      const activeBox = activeGroup.getBoundingClientRect();
      tabStrip.scrollLeft += activeBox.left - stripBox.left;
    }
    const form = root.querySelector('form');
    const stationRigShot = false;
    const trialBenchmark = window.arcProductionQuality?.benchmarkForShot?.(data.series.title, episodeIndex, shotIndex,
      record.qualityBenchmarkId || null, record.qualityBenchmarkMode || 'motion') || null;
    const templateFields = new Map();
    const reviewBaseFields = [];
    let verdict;
    let reviewNotes;
    let manualRepair;
    let recheck;
    let sourceBinding;
    let refreshCandidate;
    let refreshShotReplacement;
    function resetApproval() {
      if (record.verdict !== '通过') return;
      record.verdict = '待审';
      if (verdict) verdict.value = record.verdict;
      refreshShotReplacement?.();
    }
    if (workspace === 'script' && tab === 'script' && !record.story?.trim()) {
      const guidance = document.createElement('aside');
      guidance.className = 'production-guidance';
      guidance.setAttribute('role', 'note');
      const title = document.createElement('strong');
      title.textContent = '先写剧情，其他可以后补';
      const copy = document.createElement('p');
      copy.textContent = '每场先交代人物目标、阻碍和变化，最后留一个观众想追下去的问题。可以直接写自然语言，不用先套格式；对白可留空，人物状态和世界规则之后在「连续性」里核对。';
      guidance.append(title, copy);
      form.append(guidance);
    }
    if (workspace === 'video' && tab === 'board' &&
        (!record.scriptAnchor?.trim() || !record.beat?.trim() || !record.composition?.trim())) {
      const guidance = document.createElement('aside');
      guidance.className = 'production-guidance';
      guidance.setAttribute('role', 'note');
      const title = document.createElement('strong');
      title.textContent = '先把这一镜说清楚';
      const copy = document.createElement('p');
      copy.textContent = '一镜先只承担一个信息或动作：绑定本集原句，写观众要看到什么变化，再定景别、人物位置和走位。有人物表演时补表情与动作节拍；运镜在下一环节单独设计。';
      guidance.append(title, copy);
      form.append(guidance);
    }
    for (const [key, label, placeholder] of fields) {
      const optionalReference = (tab === 'board' && key === 'reference') || key === 'lighting' || key === 'sceneOutline';
      const wrapper = document.createElement(optionalReference ? 'details' : 'label');
      const field = document.createElement('textarea');
      field.rows = 3;
      if (key === 'scriptAnchor') field.maxLength = 500;
      else if (['beat', 'composition', 'performance', 'lighting'].includes(key)) field.maxLength = 1200;
      field.placeholder = placeholder;
      field.value = record[key] || '';
      templateFields.set(key, field);
      let refreshAnchorPickerStatus;
      let refreshAnchorWarning;
      field.oninput = () => {
        record[key] = field.value;
        if (key === 'version' || key === 'scriptAnchor') resetApproval();
        if (key === 'version') { reviewNotes?.refresh(); manualRepair?.refresh(); recheck?.refresh(); sourceBinding?.refresh(); artReview?.refresh(); refreshCandidate?.(); }
        save();
        if (key === 'scriptAnchor') {
          refreshAnchorPickerStatus?.();
          refreshAnchorWarning?.();
        }
      };
      if (optionalReference) {
        wrapper.className = 'production-optional-field';
        wrapper.open = Boolean(field.value);
        const summary = document.createElement('summary');
        summary.textContent = label;
        const inputLabel = document.createElement('label');
        inputLabel.textContent = key === 'lighting' ? '主光、色温与跨镜保留项' : key === 'sceneOutline' ? '可编辑的场次索引' : '本镜特殊参考要求';
        inputLabel.append(field);
        wrapper.append(summary, inputLabel);
      } else {
        wrapper.textContent = label;
        wrapper.append(field);
      }
      if (tab === 'review') reviewBaseFields.push(wrapper);
      else form.append(wrapper);
      if (tab === 'board' && key === 'scriptAnchor') {
        const warning = document.createElement('p');
        warning.id = 'production-anchor-warning';
        warning.className = 'production-status';
        warning.setAttribute('role', 'status');
        field.setAttribute('aria-describedby', warning.id);
        refreshAnchorWarning = () => {
          const status = projectFiles.scriptAnchorStatus(record, episode.pages);
          warning.textContent = status.reason;
          warning.hidden = status.ready;
        };
        refreshAnchorWarning();
        form.append(warning);
        const picker = document.createElement('details');
        picker.className = 'production-optional-field production-anchor-picker';
        const summary = document.createElement('summary');
        summary.textContent = '从本集剧本选择原句';
        picker.append(summary);
        const quotes = window.arcOverview.scriptCoverage(episode).rows;
        if (quotes.length) {
          const controls = document.createElement('div');
          controls.className = 'production-anchor-picker-controls';
          const select = document.createElement('select');
          select.setAttribute('aria-label', '选择本集剧情或对白原句');
          select.add(new Option('选择剧情或对白原句…', ''));
          const quoteOptions = [];
          quotes.forEach((quote, index) => {
            const status = quote.status === '已关联' ? '已有关联' : '待绑定';
            const option = new Option(`${status} · ${quote.kind} · ${quote.text}`, String(index));
            quoteOptions.push(option);
            select.add(option);
          });
          refreshAnchorPickerStatus = () => {
            const currentQuotes = window.arcOverview.scriptCoverage(episode).rows;
            quoteOptions.forEach((option, index) => {
              const quote = currentQuotes[index];
              if (!quote) return;
              option.textContent = `${quote.status === '已关联' ? '已有关联' : '待绑定'} · ${quote.kind} · ${quote.text}`;
            });
          };
          const useQuote = document.createElement('button');
          useQuote.type = 'button';
          useQuote.className = 'production-action';
          useQuote.textContent = '用这句做锚点';
          useQuote.disabled = true;
          select.onchange = () => { useQuote.disabled = select.value === ''; };
          useQuote.onclick = () => {
            const quote = quotes[Number(select.value)];
            if (!quote) return;
            field.value = quote.text;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            picker.open = false;
          };
          controls.append(select, useQuote);
          picker.append(controls);
        } else {
          const empty = document.createElement('p');
          empty.textContent = '先在「故事与对白」里写本集剧情或对白，再回来绑定原句。';
          picker.append(empty);
        }
        form.append(picker);
      }
    }
    if (workspace === 'script' && tab === 'script') form.append(scriptStructurePanel(episode, templateFields));
    if (tab === 'board') {
      motionPanel = window.arcMotionActions.mount(record, save);
      form.append(motionPanel.section);
      if (stationRigShot) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'production-action';
        open.textContent = '在本镜预览 Blender 白模';
        open.onclick = () => { tab = 'review'; render({ openStationRig: true }); };
        form.append(open);
      }
      const effects = document.createElement('details');
      effects.className = 'production-optional-field';
      effects.open = Boolean(record.generationEffects || record.postEffects);
      effects.innerHTML = `<summary>特效与合成（可选）</summary>
        <label>随镜头生成<textarea name="generationEffects" rows="2" maxlength="1200"
          placeholder="例如第 2 秒灯光闪烁，冷光照亮半张脸，人物眨眼"></textarea></label>
        <label>留给后期合成<textarea name="postEffects" rows="2" maxlength="1200"
          placeholder="例如保留干净底片，后期把雾放在人物后、车窗前；检查发丝遮挡"></textarea></label>`;
      effects.insertAdjacentHTML('beforeend', `
        <div class="production-metadata">
          <label>合成开始（镜头内秒数）<input type="number" name="postCueStart" min="0" max="15" step="any"></label>
          <label>合成结束（镜头内秒数）<input type="number" name="postCueEnd" min="0" max="15" step="any"></label>
          <label>画面位置<input name="postCueRegion" maxlength="120" placeholder="例如门框内，人物身后"></label>
        </div>
        <p class="production-status">可选时间标记。以剪入成片的镜头入点为 0 秒。</p>`);
      for (const field of effects.querySelectorAll('textarea,input')) {
        field.value = record[field.name] || '';
        templateFields.set(field.name, field);
        field.oninput = () => {
          if (field.value.trim()) record[field.name] = field.value;
          else delete record[field.name];
          save();
        };
      }
      form.append(effects);
    }
    if (tab === 'assets') form.append(assetLibrary());
    if (tab === 'art') form.append(window.arcArtReview.example());
    const shortcuts = window.arcProductionQuality.shortcuts(tab, (key, addition) => {
      const field = templateFields.get(key);
      const before = field.value;
      if (!addition) return '请先填写模板内容。';
      if (before.includes(addition)) return '这段内容已经在字段中。';
      const next = [before, addition].filter(Boolean).join('\n');
      if (field.maxLength > 0 && next.length > field.maxLength) return '追加内容超过上限，请缩短草稿。';
      record[key] = next;
      if (!save()) {
        if (before) record[key] = before;
        else delete record[key];
        return '保存失败，原字段已保留。';
      }
      field.value = next;
      const details = field.closest('details');
      if (details) details.open = true;
      return '已追加并保存。';
    });
    if (shortcuts) form.prepend(shortcuts);
    if (tab === 'canon') {
      form.prepend(window.arcContinuity.mount(data, episodeIndex, save, {
        initialTask: continuityTask,
        openPrevious(row, sourceIndex) {
          if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= episodeIndex) return;
          const from = episodeIndex;
          episodeIndex = sourceIndex;
          shotIndex = 0;
          render({ row, from });
        },
        returnTo: Number.isInteger(continuityTask?.from) ? () => {
          episodeIndex = continuityTask.from;
          shotIndex = 0;
          render();
          root.querySelector('[data-pending-only]')?.focus();
        } : undefined
      }));
    }
    if (tab === 'assistant') form.append(assistantPanel());

    function openShotRepair() {
      const source = projectFiles.generatedCandidate(record);
      const { jobId, assetKey, name, index, testFixture } = source || {};
      const cut = record.inPoint?.trim() && record.outPoint?.trim() ?
        { startMs: Math.round(Number(record.inPoint) * 1000), endMs: Math.round(Number(record.outPoint) * 1000) } : undefined;
      tab = 'generation';
      render(source?.comparison ? { abRepair: { ...source.comparison,
        origin: { jobId, assetKey, name, index, testFixture, version: record.version, cut } } } : undefined);
    }

    function adoptGeneration(item, id, basisStatus, basisHash, jobReferences, comparison, details) {
      const candidateIndex = Number(new URL(item.url, 'http://127.0.0.1').pathname.split('/').at(-1));
      const version = (comparison ? `对照${comparison.variant}-` : '生成-') + id.slice(-8) + '-' + candidateIndex;
      let submittedReferences;
      try { submittedReferences = JSON.parse(jobReferences); } catch { /* Older jobs have no submitted references. */ }
      const returned = projectFiles.saveGeneratedCandidate({ version }, item, id, basisStatus, basisHash, submittedReferences, comparison);
      const before = structuredClone(record);
      let generationABWithIdentity = record.generationAB;
      if (comparison && /^[a-f0-9]{64}$/.test(item.sha256 || '') && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes > 0) {
        let history;
        try { history = JSON.parse(record.generationAB || '[]'); } catch { throw new Error('A/B 任务账本损坏，未采用回片。'); }
        const pair = Array.isArray(history) && history.find(entry => entry?.id === comparison.id);
        const attempt = pair?.attempts?.[comparison.variant]?.find(entry => entry?.id === id);
        if (!attempt || attempt.output?.assetKey !== item.assetKey || attempt.output?.name !== item.name ||
            comparison.outputIdentity?.sha256 !== item.sha256 || comparison.outputIdentity?.sizeBytes !== item.sizeBytes) {
          throw new Error('回片哈希无法绑定到同一条 A/B 任务记录，未采用。');
        }
        attempt.output = { ...attempt.output, sha256: item.sha256, sizeBytes: item.sizeBytes };
        generationABWithIdentity = JSON.stringify(history);
      }
      const repair = details?.repair ? window.arcRepair.bound(details.repair, { version, file: item.name }) : null;
      const replay = {};
      if (details?.repairReturn) window.arcABReturn.attach(replay, { version, name: item.name, jobId: id,
        assetKey: item.assetKey, index: candidateIndex, sha256: item.sha256, sizeBytes: item.sizeBytes }, details.repairReturn,
        { version, file: item.name, generatedCandidate: JSON.parse(returned) });
      function finish() {
        if (replay.abRepairReview && !record.abRepairReview) {
          record.abRepairReview = replay.abRepairReview;
          const cut = details.repairReturn.origin.cut;
          if (cut && Number.isInteger(cut.startMs) && Number.isInteger(cut.endMs) &&
            cut.startMs >= 0 && cut.endMs > cut.startMs) {
            record.inPoint = String(cut.startMs / 1000);
            record.outPoint = String(cut.endMs / 1000);
          }
        }
        if (details?.range) {
          record.inPoint = String(details.range.startMs / 1000);
          record.outPoint = String(details.range.endMs / 1000);
          record.verdict = '待审';
        }
        if (repair) {
          record.repairPlan = JSON.stringify(repair);
          record.verdict = '待审';
        }
        if (generationABWithIdentity !== record.generationAB) record.generationAB = generationABWithIdentity;
        if (!save()) {
          for (const key of Object.keys(record)) delete record[key];
          Object.assign(record, before);
          throw new Error('浏览器未保存候选，当前审片记录已保留。');
        }
        if (details?.fromShotReview && repair) { openShotRepair(); return; }
        tab = 'review';
        render();
      }
      if (record.version === version) {
        if (record.file?.trim() !== item.name) throw new Error('此候选的源文件名已更改，请从审片页核对。');
        record.generatedCandidate = returned;
        finish();
        return;
      }
      const previousVersion = record.version?.trim();
      const archived = (record.candidates || []).find(candidate => candidate.version === previousVersion);
      if (previousVersion && !archived) projectFiles.saveCandidate(record);
      else if (archived && archived.file === record.file) {
        const past = projectFiles.generatedCandidate(archived);
        const origin = details?.repairReturn?.origin;
        if (origin && origin.version === previousVersion && past?.jobId === origin.jobId && past.assetKey === origin.assetKey) {
          const checkpoint = projectFiles.saveCandidate({ ...record, candidates: [] });
          record.candidates = record.candidates.map(candidate => candidate === archived ? checkpoint : candidate);
        }
        const binding = projectFiles.candidateSource(record);
        const repair = window.arcRepair.current(record);
        if (binding || repair) record.candidates = record.candidates.map(candidate => candidate === archived ?
          { ...candidate, ...(repair ? { repairPlan: record.repairPlan } : {}),
            ...(binding ? { sourceBinding: record.sourceBinding } : {}) } : candidate);
      }
      record.file = item.name;
      record.version = version;
      record.generatedCandidate = returned;
      record.inPoint = '';
      record.outPoint = '';
      record.issue = '';
      delete record.repairPlan;
      delete record.abRepairReview;
      delete record.sourceBinding;
      delete record.enhancementResult;
      record.verdict = '待审';
      finish();
    }

    if (tab === 'generation') {
      const snapshot = window.arcProductionContext.create(data, episodeIndex, projectFiles);
      form.append(window.arcProductionQuality.actionFxTemplate(record, (benchmarkId, benchmarkMode) => {
        const previous = record.qualityBenchmarkId;
        const previousMode = record.qualityBenchmarkMode;
        if (benchmarkId) record.qualityBenchmarkId = benchmarkId;
        else delete record.qualityBenchmarkId;
        if (benchmarkId) record.qualityBenchmarkMode = benchmarkMode === 'vfx' ? 'vfx' : 'motion';
        else delete record.qualityBenchmarkMode;
        if (!save()) {
          if (previous === undefined) delete record.qualityBenchmarkId;
          else record.qualityBenchmarkId = previous;
          if (previousMode === undefined) delete record.qualityBenchmarkMode;
          else record.qualityBenchmarkMode = previousMode;
          return false;
        }
        render(continuityTask);
        return true;
      }));
      if (episode.shots.length >= 4) {
        form.append(window.arcProductionQuality.audition(episode.shots, shotIndex, (workspace, tab, shot) => {
          window.dispatchEvent(new CustomEvent('arc-production-route', { detail: { workspace, tab, shot } }));
        }, download, shotId => {
          const shot = window.arcProductionContext.readShot(snapshot, shotId);
          return window.arcGeneration.basisDigest(window.arcGeneration.promptBasis(shot));
        }, { series: data.series, pages: episode.pages,
          continuityBasis: window.arcContinuity.reviewBasis(data, episodeIndex) }));
      }
      const brief = window.arcProductionContext.readShot(snapshot, 'S' + number(shotIndex));
      const repairPlan = window.arcRepair.current(record);
      generationPanel = window.arcGeneration.create(record, brief,
        (data.assets || []).filter(asset => (record.refs?.includes(asset.id) || record.frameAsset === asset.id) && asset.image), {
          save,
          snapshot,
          benchmark: trialBenchmark,
          reviewContext: { series: data.series, pages: episode.pages,
            continuityBasis: window.arcContinuity.reviewBasis(data, episodeIndex) },
          modelFileEvidence: (workflowSha256, expectedModels, providerFingerprint) => {
            const candidates = (data.modelFileEvidence || []).filter(item =>
              item.status === 'file-bytes-matched-runtime-unverified' &&
              item.schema === 'arc-comfy-model-files-v3' && item.providerFingerprint === providerFingerprint &&
              item.workflowSha256 === workflowSha256 &&
              item.providerBinding === 'operator-supplied-endpoint-fingerprint' &&
              item.modelSetSha256 && Array.isArray(expectedModels) &&
              window.arcWorkflowAudit.modelFilesMatch(expectedModels, item));
            if (!candidates.length) return null;
            const identities = new Set(candidates.map(item => JSON.stringify((item.models || []).map(model =>
              [model.node, model.classType, model.field, model.file, model.sizeBytes, model.sha256]).sort())));
            return identities.size === 1 ? candidates.at(-1) : null;
          },
          recommendedPreset: null,
          focusedABRepair: continuityTask?.abRepair,
          openAB: continuityTask?.openAB,
          reload: () => render(),
          repairInstruction: repairPlan ? window.arcRepair.instruction(repairPlan) : '',
          download,
          adopt: adoptGeneration
        });
      form.append(generationPanel.panel);
    }
    if (tab === 'finish') form.prepend(enhancementPanel(record));
    if (tab === 'board') form.append(storyboardInputs(record));
    if (tab === 'camera') {
      const cut = projectFiles.storyboard(data, episodeIndex).find(item => item.index === shotIndex);
      cameraPreview = window.arcCamera.create(record, cut.frame, { save,
        durationMs: cut.end - cut.start, confirmed: cut.specified });
      form.prepend(cameraPreview.panel);
    }
    if (tab === 'animatic') {
      const previewCuts = projectFiles.storyboard(data, episodeIndex, { skipEmpty: true });
      animatic = window.arcStoryboard.create(previewCuts, shotIndex, {
        targetSeconds: projectFiles.targetDuration(episode),
        audioFile: dialogueFiles.get(episodeIndex),
        onAudio(file) {
          if (file) dialogueFiles.set(episodeIndex, file);
          else dialogueFiles.delete(episodeIndex);
        },
        openShot(index) {
          shotIndex = index;
          tab = 'board';
          render();
        },
        setDuration(index, seconds) {
          const shot = episode.shots[index];
          const previous = shot.duration;
          shot.duration = String(seconds);
          if (!save()) {
            if (previous === undefined) delete shot.duration;
            else shot.duration = previous;
            throw new Error('未能保存镜头时长，请检查浏览器存储后重试。');
          }
          shotIndex = index;
          render();
          root.querySelector('[data-shot-duration]')?.focus();
          const message = root.querySelector('[data-duration-status]');
          if (message) message.textContent = `已保存 ${seconds} 秒`;
        },
        moveShot(from, to) {
          projectFiles.moveShot(episode, from, to);
          shotIndex = from;
          render();
          save();
        }
      });
      form.append(animatic.panel);
    }
    let reviewReferencePanel;
    if (['board', 'camera', 'review'].includes(tab)) {
      const referencePanel = shotReferences(record, tab === 'board', () => {
        resetApproval();
        return save();
      });
      if (tab === 'review') reviewReferencePanel = referencePanel;
      else form.append(referencePanel);
    }
    if (tab === 'review') {
      const continuityBasis = window.arcContinuity.reviewBasis(data, episodeIndex);
      const motionActions = window.arcMotionActions;
      const motion = motionActions.describe(record.motionAction);
      if (motion) {
        const guidance = document.createElement('p');
        guidance.className = 'production-status';
        guidance.textContent = `动作对照 · ${motion.name}：${motion.beats}`;
        form.append(guidance);
      }
      const verdictLabel = document.createElement('label');
      verdictLabel.textContent = '镜头状态';
      verdict = document.createElement('select');
      for (const state of ['待审', '通过', '返修', '可回收']) verdict.add(new Option(state));
      verdict.value = record.verdict || '待审';
      const verdictFeedback = document.createElement('small');
      verdictFeedback.setAttribute('role', 'status');
      const existingAnchor = projectFiles.scriptAnchorStatus(record, data.episodes[episodeIndex].pages);
      const existingApproval = window.arcArtReview.approval(record, data.series, episode.pages, continuityBasis, trialBenchmark);
      const existingRecheck = window.arcRecheck.approval(record);
      const returnReady = () => window.arcABReturn.approval(record, projectFiles.candidateSource(record)).ready;
      if (verdict.value === '通过' && !existingAnchor.ready) {
        verdictFeedback.textContent = existingAnchor.reason;
      } else if (verdict.value === '通过' && !existingApproval.ready) {
        verdictFeedback.textContent = existingApproval.unbound ? '尚未核验原片指纹；请先绑定当前视频，再重新完成视觉验收。' : existingApproval.stale ? '原片指纹、美术设定、剧本、连续性或分镜已变化；请重新完成视觉验收。' :
          existingApproval.issues.length ? `${existingApproval.issues[0].label}仍待返修；处理后重新验收。` :
            existingApproval.benchmarkMissing?.length ? `试镜专项仍待核对：${existingApproval.benchmarkMissing[0]}` : '完成七项视觉验收后才能通过。';
      } else if (verdict.value === '通过' && !existingRecheck.ready) {
        record.verdict = '返修';
        verdict.value = '返修';
        save();
        verdictFeedback.textContent = `旧版问题尚未全部复核：待复核 ${existingRecheck.pending} 项，仍存在 ${existingRecheck.stillExists} 项。`;
      } else if (verdict.value === '通过' && !returnReady()) {
        resetApproval();
        save();
        verdictFeedback.textContent = '返修问题或原可用片段尚未全部通过复核。';
      }
      const applyVerdict = () => {
        const previous = record.verdict || '待审';
        if (verdict.value === '通过') {
          const anchor = projectFiles.scriptAnchorStatus(record, data.episodes[episodeIndex].pages);
          if (!anchor.ready) {
            verdict.value = previous;
            verdictFeedback.textContent = anchor.reason;
            return;
          }
          const approval = window.arcArtReview.approval(record, data.series, episode.pages, continuityBasis, trialBenchmark);
          if (!approval.ready) {
            verdict.value = previous;
            verdictFeedback.textContent = approval.unbound ? '尚未核验原片指纹；请先绑定当前视频，再重新完成视觉验收。' : approval.stale ? '原片指纹、美术设定、剧本段落、连续性规则或分镜已变化；请重新完成视觉验收。' :
              approval.issues.length ? `${approval.issues[0].label}仍待返修；处理后重新验收。` :
                approval.benchmarkMissing?.length ? `试镜专项仍待核对：${approval.benchmarkMissing[0]}` : '完成七项视觉验收后才能通过。';
            return;
          }
          const recheck = window.arcRecheck.approval(record);
          if (!recheck.ready) {
            verdict.value = previous;
            verdictFeedback.textContent = `旧版问题尚未全部复核：待复核 ${recheck.pending} 项，仍存在 ${recheck.stillExists} 项。`;
            return;
          }
          if (!returnReady()) {
            verdict.value = previous;
            verdictFeedback.textContent = '返修问题或原可用片段尚未全部通过复核。';
            return;
          }
        }
        record.verdict = verdict.value;
        verdictFeedback.textContent = '';
        if (!save()) {
          record.verdict = previous;
          verdict.value = previous;
          verdictFeedback.textContent = '验收状态未保存，请重试。';
          return false;
        }
        refreshShotReplacement?.();
        return true;
      };
      verdict.onchange = applyVerdict;
      verdictLabel.append(verdict, verdictFeedback);
      const metadata = document.createElement('div');
      metadata.className = 'production-metadata';
      const metadataFields = new Map();
      for (const [key, title, hint] of [
        ['file', '源视频文件名', '选入当前候选视频后自动填入；也可手动修正'],
        ['inPoint', '源视频入点（秒）', '例如 0.5'],
        ['outPoint', '源视频出点（秒）', '例如 4.5'],
        ['caption', '整镜字幕（可选）', '在此镜头的整个时段显示']
      ]) {
        const label = document.createElement('label');
        const field = document.createElement('input');
        label.textContent = title;
        field.placeholder = hint;
        if (key === 'caption') field.maxLength = 160;
        field.value = record[key] || '';
        metadataFields.set(key, field);
        field.oninput = () => {
          record[key] = field.value;
          if (key === 'file') { resetApproval(); reviewNotes?.refresh(); manualRepair?.refresh(); recheck?.refresh(); sourceBinding?.refresh(); artReview?.refresh(); refreshCandidate?.(); }
          save();
        };
        label.append(field);
        metadata.append(label);
      }
      const linkedDialogue = window.arcOverview.scriptCoverage(episode, new Set([shotIndex])).rows
        .filter(row => row.kind === '对白' && row.linked.length)
        .map(row => row.text.replace(/^[\p{L}\p{N} ·]{1,16}[：:]\s*/u, '').trim()).join(' ');
      if (linkedDialogue && linkedDialogue.length <= 160) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'production-action';
        copy.textContent = '用本镜已关联的对白填字幕';
        copy.onclick = () => {
          const field = metadataFields.get('caption');
          if (field.value.trim() && field.value !== linkedDialogue &&
              !window.confirm('使用当前剧本对白替换已填写的整镜字幕？')) return;
          field.value = linkedDialogue;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.focus();
        };
        metadata.append(copy);
      }
      const review = document.createElement('section');
      review.className = 'production-compare';
      review.setAttribute('aria-label', '候选与参考视频对比');
      const visualReview = document.createElement('button');
      visualReview.type = 'button';
      visualReview.className = 'production-action';
      visualReview.textContent = '交给总导演视觉审片';
      let motionComparison;
      visualReview.onclick = () => {
        reviewVisionSeed = { candidate: candidate.selectedSource(),
          comparison: motionComparison ? undefined : comparison.selectedSource() };
        tab = 'assistant';
        render();
      };
      let shotReviewNotes;
      let shotReviewCompact;
      const candidate = videoPreview('当前候选', time => {
        pairedReview.pauseForNote();
        if (shotReviewNotes) shotReviewNotes.open = true;
        reviewNotes.start(Math.round(time * 1000));
      }, () => location.hostname === '127.0.0.1' && location.protocol === 'http:' ?
        projectFiles.generatedCandidate(record) : null);
      const comparison = videoPreview('对照视频或运镜预演');
      review.append(candidate, comparison);
      const candidatePlayer = candidate.querySelector('video');
      const comparisonPlayer = comparison.querySelector('video');
      pairedReview = window.arcCompare.create(candidatePlayer, comparisonPlayer, {
        audioChoice: stationRigShot && Boolean(record.abRepairReview), audioLabels: ['返修回片', '旧原片']
      });
      const compareDetails = document.createElement('details');
      compareDetails.className = 'review-comparison';
      compareDetails.innerHTML = '<summary><span>对照片段（可选）</span><small>白模、运镜预演或旧版本</small></summary>';
      const compareBody = document.createElement('div');
      compareBody.className = 'review-comparison-body';
      compareBody.append(comparison, pairedReview.panel);
      compareDetails.append(compareBody);
      review.replaceChildren(candidate, compareDetails);
      const comparisonInput = comparison.querySelector('input[type="file"]');
      const compareSummary = compareDetails.querySelector('summary span');
      let useMotion;
      const compareFeedback = document.createElement('p');
      compareFeedback.className = 'production-status';
      compareFeedback.setAttribute('role', 'status');
      compareFeedback.hidden = true;
      const motionLandmarks = document.createElement('section');
      motionLandmarks.hidden = true;
      if (motion?.landmarks) {
        motionLandmarks.className = 'production-history';
        const help = document.createElement('p');
        help.textContent = '先把候选停在对应动作，再点白模关键时刻。对齐后可往前或往后回看。';
        const markers = document.createElement('div');
        markers.className = 'production-picker';
        motionLandmarks.append(help, markers);
        for (const [label, seconds] of motion.landmarks) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'production-action';
          button.textContent = `${label} · ${seconds.toFixed(2)} 秒`;
          button.onclick = () => {
            try {
              pairedReview.alignAt(seconds);
              compareFeedback.textContent = `已按「${label}」对齐；回放核对两段动作是否接得上。`;
            } catch (error) { compareFeedback.textContent = error.message; }
            compareFeedback.hidden = false;
          };
          markers.append(button);
        }
      }
      comparisonInput.addEventListener('change', () => {
        const file = comparisonInput.files[0];
        if (motionComparison !== file) motionComparison = undefined;
        compareSummary.textContent = abReturnPanel && file ? `旧版 · ${file.name}` : motionComparison ? `动作白模：${motion.name}` :
          file ? `对照片段：${file.name}` : '对照片段（可选）';
        compareFeedback.textContent = motionComparison ?
          '这是当前分镜的动作目标。用它核对节奏和落点。旧版问题请换回原候选，总导演视觉审片只采样当前候选。' : '';
        compareFeedback.hidden = !compareFeedback.textContent;
        motionLandmarks.hidden = !(motionComparison && motion?.landmarks && !record.motionFilename);
        if (file) compareDetails.open = true;
      });
      if (motion && motionActions.hasReference(record)) {
        useMotion = document.createElement('button');
        useMotion.type = 'button';
        useMotion.className = 'production-action';
        useMotion.textContent = '与本镜白模对照';
        useMotion.onclick = async () => {
          const previous = comparison.selectedSource();
          useMotion.disabled = true;
          try {
            const file = await motionActions.loadReference(record);
            if (!comparisonInput.isConnected || comparison.selectedSource() !== previous) return;
            const transfer = new DataTransfer();
            transfer.items.add(file);
            comparisonInput.files = transfer.files;
            motionComparison = comparisonInput.files[0];
            comparisonInput.dispatchEvent(new Event('change'));
            compareDetails.querySelector('summary').focus();
          } catch (error) {
            if (!compareFeedback.isConnected) return;
            compareDetails.open = true;
            compareFeedback.textContent = error.message;
            compareFeedback.hidden = false;
          } finally {
            useMotion.disabled = false;
          }
        };
        candidate.append(useMotion);
      }
      compareBody.prepend(compareFeedback, motionLandmarks);
      const generationNote = document.createElement('p');
      generationNote.className = 'production-status';
      generationNote.setAttribute('role', 'status');
      const fixtureNote = document.createElement('strong');
      fixtureNote.className = 'production-status';
      fixtureNote.textContent = '本地测试素材 · 用于验证流程';
      const submittedReferences = document.createElement('details');
      submittedReferences.className = 'production-optional-field';
      const referenceHeading = document.createElement('summary');
      referenceHeading.textContent = '此候选生成时使用的参考';
      const referenceList = document.createElement('ul');
      submittedReferences.append(referenceHeading, referenceList);
      let generationNoteRequest = 0;
      const updateGenerationNote = async () => {
        const request = ++generationNoteRequest;
        const direct = projectFiles.generatedCandidate(record);
        const enhanced = projectFiles.enhancementDetails(record);
        const source = direct || enhanced?.generationSource;
        referenceHeading.textContent = direct ? '此候选生成时使用的参考' : '上游原片生成时使用的参考';
        submittedReferences.hidden = !source;
        fixtureNote.hidden = !(source?.testFixture || enhanced?.testFixture ||
          record.version?.trim().startsWith('本地流程样片-'));
        const labels = source?.jobReferences?.map(item =>
          [item.role, item.kind, item.name, item.revision,
            item.source === 'builtin' ? '弧光自制' : item.source === 'local' ? '本地导入' : '',
            item.sha256 ? `SHA-256 ${item.sha256.slice(0, 12)}` : ''].filter(Boolean).join(' · '));
        referenceList.replaceChildren(...(labels?.length ? labels :
          [labels ? '此次任务没有提交参考素材。' : '此候选没有保存提交参考记录。']).map(label => {
          const entry = document.createElement('li');
          entry.textContent = label;
          return entry;
        }));
        if (source) {
          const job = document.createElement('li');
          job.textContent = [direct ? '' : '上游原片', source.testFixture ? '模拟任务' : '生成任务', source.jobId].filter(Boolean).join(' · ');
          referenceList.prepend(job);
        }
        if (source?.comparison) {
          const selected = document.createElement('li');
          const { variant, mode, effectivePromptSha256, queueMs, executionMs, durationSec, retryCount } = source.comparison;
          const variantLabel = mode === 'vfx' ? (variant === 'A' ? 'A 版 · 干净底片' : 'B 版 · 特效提示') :
            mode === 'performance' ? (variant === 'A' ? 'A 版 · 基础表演提示' : 'B 版 · 表演节拍提示') :
              (variant === 'A' ? 'A 版 · 文字动作' : 'B 版 · 白模动作');
          selected.textContent = [direct ? '' : '上游原片', variantLabel,
            /^[a-f0-9]{64}$/.test(effectivePromptSha256 || '') ? `实际提示词 SHA-256 ${effectivePromptSha256.slice(0, 12)}` : '',
            Number.isFinite(queueMs) ? `排队 ${(queueMs / 1000).toFixed(2)} 秒` : '',
            Number.isFinite(executionMs) ? `执行 ${(executionMs / 1000).toFixed(2)} 秒` : '',
            Number.isFinite(durationSec) ? `片长 ${durationSec.toFixed(2)} 秒` : '',
            Number.isInteger(retryCount) ? `重试 ${retryCount} 次` : ''].filter(Boolean).join(' · ');
          referenceList.prepend(selected);
        }
        function display(status, compared = false) {
          if (request !== generationNoteRequest) return;
          generationNote.textContent = status === 'changed'
            ? (compared ? '当前镜头资料与提交任务时不同。请对照当前分镜核验画面。'
              : '采用此候选时，镜头资料已比提交任务时更新。请对照当前分镜核验画面。')
            : status === 'unknown' ? '此候选缺少可用于对照的提交记录。请对照当前分镜核验画面。' : '';
          generationNote.hidden = !generationNote.textContent;
        }
        display(source?.basisStatus);
        if (!source?.basisHash) return;
        try {
          const context = window.arcProductionContext;
          const generation = window.arcGeneration;
          const snapshot = context.create(data, episodeIndex, projectFiles);
          const brief = context.readShot(snapshot, 'S' + number(shotIndex));
          const digest = await generation.basisDigest(generation.promptBasis(brief));
          if (digest) display(digest === source.basisHash ? 'current' : 'changed', true);
        } catch {
          if (source.basisStatus === 'current') display('unknown');
        }
      };
      refreshCandidate = () => {
        if (candidate.refreshSource()) pairedReview.sourceChanged();
        updateGenerationNote();
      };
      updateGenerationNote();
      const sources = [...review.querySelectorAll('input[type="file"]')];
      sourceBinding = sourceBindingPanel(record, sources[0], candidatePlayer, candidate.selectedSource,
        () => { artReview?.refreshBindingStatus(); manualRepair?.refresh(); abReturnPanel?.refresh(); });
      artReview = window.arcArtReview.create(record, data.series, episode.pages, {
        continuityBasis,
        benchmark: trialBenchmark,
        selectedFile: candidate.selectedSource,
        onSaved() { stationABReview?.refreshEvidence?.(); },
        onTimecode(id, label, issue) {
          if (candidatePlayer.readyState < 2 || candidatePlayer.seeking) {
            throw new Error('请等候选画面稳定后再记录问题时间码。');
          }
          pairedReview.pauseForNote();
          const category = ({ character: '角色与道具', space: '角色与道具', light: '光色', framing: '构图',
            performance: '表演', camera: '运镜', temporal: '其他' })[id] || '其他';
          reviewNotes.start(Math.round(candidatePlayer.currentTime * 1000),
            { category, note: `${label}：${issue}` });
        },
        onBenchmarkTimecode() {
          if (candidatePlayer.readyState < 2 || candidatePlayer.seeking) throw new Error('请等候选画面稳定后再记录专项时间码。');
          pairedReview.pauseForNote();
          return Math.round(candidatePlayer.currentTime * 1000);
        },
        onBenchmarkRepair({ label, issue, sourceMs }) {
          if (candidatePlayer.readyState < 2 || candidatePlayer.seeking ||
              candidate.selectedSource()?.name !== record.file) throw new Error('请先载入并核对当前候选，再转交返修。');
          pairedReview.pauseForNote();
          if (shotReviewCompact) shotReviewCompact.open = true;
          if (shotReviewNotes) shotReviewNotes.open = true;
          reviewNotes.start(sourceMs, { category: '其他', note: `专项验收 · ${label}：${issue}` });
          reviewNotes.panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },
        async verify(file) {
          if (candidatePlayer.readyState < 1 || !candidatePlayer.videoWidth) throw new Error('候选视频尚未载入。');
          const bound = projectFiles.candidateSource(record);
          if (!bound) return;
          if (!(file instanceof File)) throw new Error('此版本已绑定指纹。请下载并选入原文件再保存美术验收。');
          const actual = await projectFiles.fingerprintSource(file);
          if (bound.size !== actual.size || bound.fingerprint !== actual.fingerprint) {
            throw new Error('当前播放的视频与已绑定的源文件不符。');
          }
        },
        save
      });
      manualRepair = window.arcRepair.fromNotesPanel(record, {
        canBind: () => Boolean(projectFiles.candidateSource(record)),
        save,
        openGeneration: () => window.dispatchEvent(new CustomEvent('arc-production-route', {
          detail: { workspace: 'video', tab: 'generation', shot: shotIndex }
        }))
      });
      reviewNotes = window.arcReviewNotes.create(record, {
        selectedFile: () => candidate.selectedSource()?.name,
        seek: pairedReview.seekCandidate,
        save,
        onChange() { manualRepair.refresh(); stationABReview?.refreshEvidence?.(); }
      });
      const recheckFingerprints = new WeakMap();
      recheck = window.arcRecheck.create(record, {
        sourceNames: () => [candidate.selectedSource()?.name, motionComparison ? undefined : comparison.selectedSource()?.name],
        async verifyMedia(note) {
          const current = candidate.selectedSource();
          const old = comparison.selectedSource();
          const currentIdentity = projectFiles.candidateSource(record);
          const archived = record.candidates?.find(item => item.version === note.version && item.file === note.file);
          const oldIdentity = archived && projectFiles.candidateSource(archived);
          if (!currentIdentity) throw new Error('请先核对并绑定新版原视频。');
          function digest(file) {
            if (!recheckFingerprints.has(file)) {
              recheckFingerprints.set(file, projectFiles.fingerprintSource(file).catch(error => {
                recheckFingerprints.delete(file);
                throw error;
              }));
            }
            return recheckFingerprints.get(file);
          }
          const [currentDigest, oldDigest] = await Promise.all([digest(current), oldIdentity ? digest(old) : null]);
          if (current !== candidate.selectedSource() || old !== comparison.selectedSource() || motionComparison ||
              currentIdentity.contentDigest !== projectFiles.candidateSource(record)?.contentDigest) {
            throw new Error('视频或绑定记录已变更，请重新核对。');
          }
          if (currentDigest.contentDigest !== currentIdentity.contentDigest) throw new Error('新版视频内容与已绑定原片不符。');
          if (oldIdentity && oldDigest.contentDigest !== oldIdentity.contentDigest) throw new Error('旧版视频内容与已绑定原片不符。');
          return Boolean(oldIdentity);
        },
        readCandidateTime(originMs) {
          if (candidatePlayer.readyState < 2 || candidatePlayer.seeking || comparisonPlayer.readyState < 1 ||
              originMs > Math.round(comparisonPlayer.duration * 1000)) {
            throw new Error('请等两段视频载入，并核对旧版时间后再记录。');
          }
          return Math.round(candidatePlayer.currentTime * 1000);
        },
        seek: pairedReview.seekEvidence,
        pause: pairedReview.pauseForEvidence,
        save,
        onChange: resetApproval
      });
      const remembered = reviewMedia.get(record);
      const fallback = enhancedMedia.get(record)?.get(record.version);
      const rememberedSources = remembered && remembered.version === record.version && remembered.file === record.file ?
        remembered.sources : fallback?.[0]?.name === record.file ? fallback : undefined;
      if (rememberedSources) {
        for (const [index, input] of sources.entries()) {
          if (!rememberedSources[index]) continue;
          if (input === comparisonInput && remembered?.sources === rememberedSources && remembered.motionComparison &&
              remembered.motionComparison !== motionActions.fileFor(record)) continue;
          const transfer = new DataTransfer();
          transfer.items.add(rememberedSources[index]);
          input.files = transfer.files;
          if (input === comparisonInput && remembered?.sources === rememberedSources && remembered.motionComparison) {
            motionComparison = input.files[0];
          }
          input.dispatchEvent(new Event('change'));
        }
      }
      for (const input of sources) {
        input.addEventListener('change', () => {
          pairedReview.sourceChanged();
          if (input === sources[0] && candidate.selectedSource()?.name && record.file !== candidate.selectedSource().name) {
            record.file = candidate.selectedSource().name;
            metadataFields.get('file').value = record.file;
            resetApproval();
            reviewNotes.refresh();
            manualRepair.refresh();
            recheck.refresh();
            sourceBinding.refresh();
            artReview.refresh();
            save();
          }
          reviewMedia.set(record, { version: record.version, file: record.file,
            sources: sources.map(item => item.files[0]),
            motionComparison: motionComparison ? motionActions.fileFor(record) : undefined });
          sourceBinding.refresh();
        });
      }
      abReturnPanel = window.arcABReturn.create(record, {
        players: [candidatePlayer, comparisonPlayer],
        sources: () => [candidate.selectedSource(), comparison.selectedSource()],
        async load(files) {
          files.forEach((file, index) => {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            sources[index].files = transfer.files;
            sources[index].dispatchEvent(new Event('change'));
          });
          const selected = [candidate.selectedSource(), comparison.selectedSource()];
          const matchesSelection = () => candidate.selectedSource() === selected[0] &&
            comparison.selectedSource() === selected[1];
          compareDetails.open = true;
          await Promise.all([candidatePlayer, comparisonPlayer].map((player, index) => {
            if (player.readyState >= 1) return;
            const version = index ? '旧版' : '新版';
            return new Promise((resolve, reject) => {
              const events = new AbortController();
              const finish = error => {
                events.abort();
                clearTimeout(timer);
                if (error) reject(error);
                else resolve();
              };
              const timer = setTimeout(() => finish(new Error(version + '预览未就绪，请重新载入回片。')), 10000);
              player.addEventListener('loadedmetadata', () => finish(), { signal: events.signal });
              player.addEventListener('error', () => finish(new Error(version + '视频无法预览。')), { signal: events.signal });
            });
          }));
          if (!matchesSelection()) throw new Error('选入的视频已变更，请重新载入回片。');
          if (!sourceBinding.panel.isConnected || !await sourceBinding.bind()) {
            throw new Error(sourceBinding.panel.querySelector('output').textContent || '新版绑定未完成。');
          }
          if (!matchesSelection()) throw new Error('选入的视频已变更，请重新载入回片。');
          return selected;
        },
        sync: pairedReview.alignRange,
        coordinates: pairedReview.coordinates,
        pause: pairedReview.pauseForEvidence,
        fingerprint: projectFiles.fingerprintSource,
        binding: () => projectFiles.candidateSource(record),
        originBinding: origin => {
          const archived = (record.candidates || []).find(item => item.version === origin.version && item.file === origin.name);
          return archived && projectFiles.candidateSource(archived);
        },
        rollback() {
          const manifest = projectFiles.shotRollback(data, episodeIndex, shotIndex);
          download(`${manifest.shot.id}-ARC旧版回退.json`, manifest);
        },
        ...(stationRigShot ? {
          patchContext: () => {
            const shot = projectFiles.shotRollback(data, episodeIndex, shotIndex).shot;
            const originalComparison = shot.productionOrigin?.generationComparison;
            const candidateComparison = projectFiles.generatedCandidate(record)?.comparison;
            return { ...shot, fps: originalComparison?.fps, fpsEvidenceSource: originalComparison?.fpsEvidenceSource,
              frameRateMode: originalComparison?.frameRateMode, candidateFps: candidateComparison?.fps,
              candidateFpsEvidenceSource: candidateComparison?.fpsEvidenceSource,
              candidateFrameRateMode: candidateComparison?.frameRateMode };
          },
          exportPatch() {
            const manifest = projectFiles.shotPatch(data, episodeIndex, shotIndex);
            if (record.verdict !== '通过') {
              verdict.value = '通过';
              if (!applyVerdict()) throw new Error(verdictFeedback.textContent);
            }
            download(`${manifest.shot.id}-ARC局部换镜.json`, manifest);
          }
        } : {}),
        save,
        onChange(previousVerdict) {
          if (previousVerdict === '通过') verdict.value = record.verdict;
          refreshShotReplacement?.();
        }
      });
      const section = (number, headingText, descriptionText, children) => {
        const block = document.createElement('section');
        block.className = 'review-step';
        const heading = document.createElement('header');
        const numberLabel = document.createElement('span');
        numberLabel.className = 'review-step-number';
        numberLabel.textContent = number;
        const title = document.createElement('h3');
        title.textContent = headingText;
        const description = document.createElement('p');
        description.textContent = descriptionText;
        heading.append(numberLabel, title, description);
        block.append(heading, ...children.filter(Boolean));
        return block;
      };
      const replacement = document.createElement('div');
      replacement.className = 'production-picker';
      replacement.innerHTML = '<button type="button" class="production-action">导出 ARC 单镜替换清单</button><output role="status"></output>';
      const replacementFeedback = replacement.querySelector('output');
      refreshShotReplacement = () => { replacement.hidden = record.verdict !== '通过'; };
      refreshShotReplacement();
      const exportReplacement = () => {
        try {
          const list = projectFiles.shotReplacement(data, episodeIndex, shotIndex);
          download(`${list.shot.id}-ARC单镜替换.json`, list);
          replacementFeedback.textContent = `在 ARC 选中 ${list.shot.id}，打开「替换选中镜头」，选入这份清单和已验收原片。`;
        } catch (error) { replacementFeedback.textContent = error.message; }
      };
      replacement.querySelector('button').onclick = exportReplacement;
      const stationRig = stationRigShot ? motionActions.mountStationRig(record, {
        ready: () => projectFiles.scriptAnchorStatus(record, episode.pages).ready,
        save() {
          if (!save()) return false;
          verdict.value = record.verdict || '待审';
          refreshShotReplacement?.();
          return true;
        },
        openAB() { tab = 'generation'; render({ openAB: true }); },
        trackUrl: url => mediaUrls.add(url),
        expanded: continuityTask?.openStationRig
      }) : null;
      if (stationRigShot || trialBenchmark) {
        stationABReview = window.arcAB.mountArtReview(record, {
          assets: data.assets || [],
          benchmark: trialBenchmark,
          reviewContext: { series: data.series, pages: episode.pages, continuityBasis },
          save,
          trackMedia(file) {
            const url = URL.createObjectURL(file);
            mediaUrls.add(url);
            return url;
          },
          shotBasis() {
            const context = window.arcProductionContext;
            const generation = window.arcGeneration;
            const snapshot = context.create(data, episodeIndex, projectFiles);
            return generation.basisDigest(generation.promptBasis(context.readShot(snapshot, 'S' + number(shotIndex))));
          },
          adopt(item, id, state, hash, references, origin, details) {
            adoptGeneration(item, id, state, hash, references ? JSON.stringify(references) : undefined,
              origin, { ...details, fromShotReview: true });
          }
        });
      }
      if (abReturnPanel) {
        const shotPage = document.createElement('section');
        shotPage.className = 'shot-review-workspace';
        shotPage.setAttribute('aria-label', '本镜返修');
        const heading = document.createElement('h3');
        heading.textContent = `本镜 · S${number(shotIndex)}`;
        const compact = document.createElement('details');
        shotReviewCompact = compact;
        compact.className = 'production-optional-field';
        compact.innerHTML = '<summary>版本、切点与更多审片工具</summary>';
        compact.append(generationNote, submittedReferences, reviewReferencePanel, reviewBaseFields[0],
          metadata, sourceBinding.panel, reviewBaseFields[1], manualRepair.panel, recheck.panel, visualReview,
          candidateHistory(record), verdictLabel);
        const deliver = document.createElement('div');
        deliver.className = 'production-picker shot-review-delivery';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'production-action';
        approve.textContent = stationRigShot ? '验收新版' : '验收并导出 ARC 本镜清单';
        approve.onclick = () => {
          verdict.value = '通过';
          const passed = applyVerdict();
          if (passed && !stationRigShot) exportReplacement();
          feedback.textContent = passed && stationRigShot ?
            '新版审片已通过。请在「局部换镜」导出需要替换的区间。' : verdictFeedback.textContent;
        };
        const feedback = document.createElement('output');
        feedback.setAttribute('role', 'status');
        const relay = document.createElement('details');
        relay.className = 'production-optional-field shot-relay-review';
        relay.innerHTML = '<summary>画质对照 · RelayVSR 2×</summary><p data-relay-hint>通过本镜验收后，可用同一段 ARC 裁片对照增强回片。</p>';
        relay.ontoggle = () => mountRelay();
        function mountRelay() {
          if (!relay.open || relay.querySelector('.ai-enhancement') || record.verdict !== '通过') return;
          relay.querySelector('[data-relay-hint]').hidden = true;
          relay.append(enhancementPanel(record, { shotRelay: true, original: candidate.selectedSource() }));
        }
        const updateReplacement = refreshShotReplacement;
        refreshShotReplacement = () => {
          updateReplacement();
          mountRelay();
        };
        shotReviewNotes = document.createElement('details');
        shotReviewNotes.className = 'production-optional-field';
        shotReviewNotes.innerHTML = '<summary>补记本镜问题</summary>';
        shotReviewNotes.append(reviewNotes.panel);
        deliver.append(approve, feedback, replacementFeedback);
        compact.append(abReturnPanel.rollback, ...abReturnPanel.originals);
        compareDetails.open = true;
        candidate.querySelector('label span').textContent = '新版 · 返修回片';
        comparison.querySelector('label span').textContent = '旧版 · 原片';
        candidate.classList.add('shot-review-new');
        comparison.classList.add('shot-review-old');
        if (useMotion) useMotion.hidden = true;
        const noteAtPlayhead = candidate.querySelector('button');
        const markerToolbar = abReturnPanel.panel.querySelector('.shot-review-markers');
        if (noteAtPlayhead && markerToolbar) markerToolbar.append(noteAtPlayhead);
        for (const player of [candidatePlayer, comparisonPlayer]) player.controls = false;
        review.replaceChildren(comparison, candidate, pairedReview.panel);
        const zoom = document.createElement('button');
        zoom.type = 'button';
        zoom.textContent = '放大对照';
        zoom.setAttribute('aria-pressed', 'false');
        zoom.onclick = () => {
          const enlarged = review.classList.toggle('is-review-enlarged');
          zoom.textContent = enlarged ? '适应画面' : '放大对照';
          zoom.setAttribute('aria-pressed', String(enlarged));
        };
        pairedReview.panel.querySelector('[data-transport] .production-picker').append(zoom);
        abReturnPanel.panel.querySelector('[data-playback]').prepend(review);
        abReturnPanel.placeAfterCompare(shotReviewNotes);
        if (stationRigShot) compact.prepend(deliver);
        abReturnPanel.placeBeforeDelivery(artReview.panel, ...(stationRigShot ? [] : [deliver]));
        const references = document.createElement('details');
        references.className = 'production-optional-field';
        references.innerHTML = '<summary>参考与生成记录</summary>';
        references.append(...[stationRig, stationABReview?.panel].filter(Boolean));
        shotPage.append(heading, fixtureNote, abReturnPanel.panel, references, relay, compact);
        form.append(shotPage);
      } else form.append(
        section('01', '载入候选视频', '先选入本镜候选，再按需对照白模、运镜预演或旧版本。',
          [fixtureNote, generationNote, submittedReferences, reviewReferencePanel, abReturnPanel?.panel, review]),
        section('02', '绑定版本和切点', '确认候选版本、文件名与 ARC 使用的入点和出点。文件名会随候选视频自动填入。',
          [reviewBaseFields[0], metadata, sourceBinding.panel]),
        section('03', '核验画面并决定去向', '按角色、表演、构图、光色、运镜和跨帧稳定逐项核对；发现问题时记时间码，再返修或通过。',
          [reviewBaseFields[1], artReview.panel, reviewNotes.panel, manualRepair.panel, recheck.panel, visualReview,
            candidateHistory(record), verdictLabel, replacement])
      );
      if (!abReturnPanel && stationRig) form.prepend(stationRig);
      if (!abReturnPanel && stationABReview) form.prepend(stationABReview.panel);
      if (record.postEffects?.trim() || record.postCueStart || record.postCueEnd || record.postCueRegion) {
        const effect = document.createElement('p');
        effect.className = 'production-status';
        const cueText = () => {
          try {
            const cue = projectFiles.postCue(record, Number(record.outPoint) - Number(record.inPoint));
            return cue ? `后期合成 · 镜头内 ${cue.start}–${cue.end} 秒 · ${cue.region}。 ${record.postEffects}` :
              '后期合成 · ' + record.postEffects;
          } catch (error) { return error.message; }
        };
        effect.textContent = cueText();
        metadata.addEventListener('input', () => { effect.textContent = cueText(); });
        form.prepend(effect);
      }
      const enhanced = projectFiles.enhancementDetails(record);
      if (enhanced) {
        const origin = document.createElement('p');
        origin.className = 'production-status';
        origin.textContent = `画质处理版 · 来自 ${enhanced.sourceVersion} · 原片从 ${enhanced.sourceStart} 秒起 · ${enhanced.width}×${enhanced.height} · ${enhanced.fps} fps`;
        form.prepend(origin);
        if (enhanced.engine?.kind === 'comfyui-ai-enhancement') {
          const modelRecord = document.createElement('details');
          modelRecord.className = 'production-history';
          const summary = document.createElement('summary');
          summary.textContent = '查看 AI 工作流与模型参数记录';
          const parameters = document.createElement('pre');
          parameters.textContent = [
            `工作流 SHA-256：${enhanced.engine.workflowSha256}`,
            `ComfyUI 节点 schema SHA-256：${enhanced.engine.preflightSchemaSha256 || '旧任务未记录'}`,
            `本次模型参数：${JSON.stringify(enhanced.engine.modelParameters || {})}`,
            '参数来源是提交任务快照；它不证明服务运行时加载了对应权重。'
          ].join('\n');
          modelRecord.append(summary, parameters);
          form.prepend(modelRecord);
        }
        if (enhanced.processing) {
          const processing = document.createElement('details');
          processing.className = 'production-history';
          const summary = document.createElement('summary');
          summary.textContent = `查看本地处理链 · ${enhanced.processing.profile}` +
            (Number.isSafeInteger(enhanced.processing.processingMs) ? ` · FFmpeg ${(
              enhanced.processing.processingMs / 1000).toFixed(2)} 秒` : '') + ` · ${enhanced.processing.ffmpegVersion}`;
          const parameters = document.createElement('pre');
          parameters.textContent = `视频滤镜：${enhanced.processing.videoFilter}\n音频滤镜：${enhanced.processing.audioFilter || '无'}\n视频编码：${enhanced.processing.videoEncoder}\n音频编码：${enhanced.processing.audioEncoder}`;
          processing.append(summary, parameters);
          form.prepend(processing);
        }
      }
      const repairPlan = window.arcRepair.current(record);
      if (repairPlan) {
        const card = window.arcRepair.render(repairPlan, '已确认的返修单');
        if (window.arcRepair.instruction(repairPlan)) {
          const generate = document.createElement('button');
          generate.type = 'button';
          generate.textContent = '去生成本镜返修';
          generate.onclick = openShotRepair;
          card.append(generate);
        }
        form.append(card);
      }
    }
    if (tab === 'assembly') {
      form.prepend(assemblyPanel());
    }
    const status = document.createElement('output');
    status.className = 'production-status';
    status.dataset.saveStatus = '';
    status.setAttribute('role', 'status');
    status.textContent = storageError ? '浏览器存储读取失败。刷新前请保留当前文字。' : '输入自动保存到当前浏览器';
    form.append(status);
    [...form.querySelectorAll('input, select, textarea')].forEach((control, index) => {
      if (!control.id) control.id = `studio-${workspace}-${tab}-field-${index + 1}`;
    });
    renderScriptImportUndo();
  }

  function sourceBindingPanel(record, input, player, selectedCandidate, onBound) {
    const panel = document.createElement('section');
    panel.className = 'production-history candidate-source';
    panel.innerHTML = '<div class="production-picker"><button type="button">核对并绑定当前视频</button><output role="status"></output></div>';
    const button = panel.querySelector('button');
    const status = panel.querySelector('output');
    let pending = false;
    function refresh() {
      button.disabled = pending;
      if (pending) return;
      const bound = projectFiles.candidateSource(record);
      const generated = projectFiles.generatedCandidate(record);
      const remoteIdentity = generated?.sha256 ? `上游回片 SHA-256 ${generated.sha256.slice(0, 16)} · ${generated.sizeBytes} 字节。` : '';
      status.textContent = bound ? (bound.fingerprint.startsWith('sha256:') ?
        '此版本已登记完整文件指纹和全文件分块校验。' : '此版本已登记首尾抽样指纹和全文件分块校验。') :
        `该版本尚未绑定本地原文件。${remoteIdentity}下载后绑定会完整校验文件内容，ARC 导入时也会复核。`;
    }
    async function bind() {
      if (pending) return false;
      const version = record.version?.trim();
      const source = input.files[0];
      const file = record.file?.trim();
      if (!version || !file || !source || source.name !== file || selectedCandidate() !== source || player.readyState < 1 || !player.videoWidth) {
        if (selectedCandidate()?.url) {
          status.textContent = '当前候选是生成任务回传视频。请先下载到本地，再选入本地原视频进行绑定和验收。';
          return;
        }
        status.textContent = '请填写候选版本及文件名，并选入同名的本地原视频。';
        return;
      }
      pending = true;
      refresh();
      status.textContent = '正在本机分块校验整个视频并登记指纹…';
      try {
        const identity = await projectFiles.fingerprintSource(source, (done, total) => {
          status.textContent = `正在本机全文件分块校验 · ${Math.floor(done / total * 100)}%`;
        });
        if (!panel.isConnected || input.files[0] !== source || record.version?.trim() !== version || record.file?.trim() !== file) {
          throw new Error('候选或所选文件已变更，请重新核对。');
        }
        const archived = (record.candidates || []).find(item => item.version?.trim() === version && item.file?.trim() === file);
        const knownSources = [projectFiles.candidateSource(record), archived && projectFiles.candidateSource(archived)].filter(Boolean);
        for (const known of knownSources) {
          if (known.size !== identity.size || known.fingerprint !== identity.fingerprint ||
              known.contentDigest !== identity.contentDigest) {
            throw new Error('同名文件与该版本记录不一致。若要审查新片，请为它填写新版本和独立文件名。');
          }
        }
        const generated = projectFiles.generatedCandidate(record);
        if (generated?.comparison && !knownSources.length) {
          status.textContent = '正在比对所选文件与 A/B 任务原片…';
          const response = await fetch(generated.url, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
          if (!response.ok) throw new Error('任务原片暂不可用，无法核对这个 A/B 版本。');
          const original = await response.blob();
          if (original.size !== identity.size || await window.arcSourceDigest.compute(original) !== identity.contentDigest) {
            throw new Error('本地文件与所选 A/B 任务原片不一致，请下载该版本的原视频。');
          }
          if (!panel.isConnected || input.files[0] !== source || projectFiles.generatedCandidate(record)?.url !== generated.url ||
              record.version?.trim() !== version || record.file?.trim() !== file) {
            throw new Error('候选或所选文件已变更，请重新核对。');
          }
        }
        const previous = record.sourceBinding;
        const previousArchive = archived?.sourceBinding;
        record.sourceBinding = JSON.stringify({ version, file, ...identity });
        if (archived) archived.sourceBinding = record.sourceBinding;
        if (!save()) {
          if (previous === undefined) delete record.sourceBinding;
          else record.sourceBinding = previous;
          if (archived) {
            if (previousArchive === undefined) delete archived.sourceBinding;
            else archived.sourceBinding = previousArchive;
          }
          throw new Error('浏览器未能保存源文件指纹，请重试。');
        }
        status.textContent = identity.fingerprint.startsWith('sha256:') ? '已登记完整 SHA-256 与全文件分块校验。' :
          '已登记首尾抽样指纹与全文件分块校验。';
        onBound();
        return true;
      } catch (error) { status.textContent = error.message; }
      finally { pending = false; button.disabled = false; }
      return false;
    }
    button.onclick = bind;
    refresh();
    return { panel, refresh, bind };
  }

  function assemblyPanel() {
    const queue = projectFiles.assembly(data, episodeIndex);
    const continuityBasis = window.arcContinuity.reviewBasis(data, episodeIndex);
    const protectedRow = projectFiles.protectedShot(data, episodeIndex, queue.ready);
    let original;
    let baselineError = '';
    if (protectedRow) {
      try { original = projectFiles.shotRollback(data, episodeIndex, protectedRow.index).shot; }
      catch (error) { baselineError = error.message; }
    }
    const forBaseline = shot => shot === protectedRow && original ? { ...shot, ...original } : shot;
    const ready = queue.ready.map(forBaseline);
    const duration = ready.reduce((total, shot) => total + (shot.end - shot.start), 0);
    const frameDuration = ready.reduce((frames, shot) => frames +
      Math.max(1, Math.round((Math.round(shot.end * 1e6) - Math.round(shot.start * 1e6)) * 30 / 1e6)), 0) / 30;
    const sourceCount = new Set(ready.map(shot => shot.file.normalize('NFC').toLowerCase())).size;
    const exportedShots = new Set(ready.map(shot => shot.index));
    const coverage = window.arcOverview.scriptCoverage(data.episodes[episodeIndex], exportedShots);
    const skipped = queue.shots.filter(shot => shot.verdict !== '通过').length;
    const panel = document.createElement('section');
    panel.className = 'production-history assembly-panel';
    panel.innerHTML = `
      <h3>本集粗剪清单</h3><p data-count></p>
      <div class="assembly-scroll" tabindex="0" role="region" aria-label="镜头交接详情">
        <table><thead><tr><th scope="col">镜头</th><th scope="col">候选版本</th>
        <th scope="col">原视频</th><th scope="col">源入点 → 出点</th><th scope="col">交接状态</th></tr></thead><tbody></tbody></table>
      </div>
      <label class="assembly-coverage-confirm"><input type="checkbox">
        <span><strong>我已核对这份粗剪清单的剧本覆盖</strong><small>逐句对照剧情、对白和本次交接的镜头，确认哪些内容留待后续剪入。</small></span>
      </label>
      <label data-partial hidden><input type="checkbox">先导出已通过镜头</label>
      <div class="production-picker">
        <label>交付分辨率<select><option value="1080">1080p</option><option value="720">720p</option></select></label>
        <button type="button" data-episode-manifest>导出 ARC 镜头清单</button>
      </div>
      <output role="status"></output>`;
    panel.querySelector('[data-count]').textContent =
      `${ready.length} / ${queue.shots.length} 镜可交接 · ${sourceCount} 个原视频 · 按 30 fps 预计 ${frameDuration.toFixed(2)} 秒`;
    const rows = panel.querySelector('tbody');
    for (const current of queue.shots) {
      const shot = forBaseline(current);
      const row = rows.insertRow();
      const episode = data.episodes[episodeIndex];
      const art = window.arcArtReview.current(episode.shots[shot.index], data.series, episode.pages, continuityBasis);
      const heading = document.createElement('th');
      heading.scope = 'row';
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = shot.id;
      const anchor = projectFiles.scriptAnchorStatus(episode.shots[shot.index], episode.pages);
      const needsAnchor = !anchor.ready && shot.issue === anchor.reason;
      open.setAttribute('aria-label', needsAnchor ? '修正 ' + shot.id + ' 剧本原句' : '审片 ' + shot.id);
      if (needsAnchor) open.title = '去分镜重新绑定剧本原句';
      open.onclick = () => {
        shotIndex = shot.index;
        document.querySelector(`[data-open="video"][data-tab="${needsAnchor ? 'board' : 'review'}"]`).click();
        root.querySelector('#production-title').setAttribute('tabindex', '-1');
        root.querySelector('#production-title').focus();
      };
      heading.append(open);
      row.append(heading);
      const artState = art.stale ? ' · 美术待重审' :
        art.checks.some(item => item.result === '待返修') ? ' · 有美术返修项' : '';
      for (const label of [shot.title || '—', shot.file || '—',
        shot.start === null || shot.end === null ? '—' : `${shot.start} → ${shot.end} 秒`,
        (current === protectedRow ? (baselineError || '原片底稿 · 可局部换镜') : '') ||
        shot.issue || (shot.verdict === '通过' ?
          '可交接' + artState + (shot.source ? ' · 已登记指纹' : ' · 仅按名称') : shot.verdict + artState)]) {
        row.insertCell().textContent = label;
      }
    }
    const formControls = panel.querySelector('.production-picker');
    const choice = formControls.querySelector('select');
    const button = formControls.querySelector('[data-episode-manifest]');
    const partial = panel.querySelector('[data-partial]');
    const confirmation = partial.querySelector('input');
    const coverageConfirmation = panel.querySelector('.assembly-coverage-confirm input');
    const feedback = panel.querySelector('output');
    const blockingError = queue.error || baselineError;
    partial.hidden = !skipped || Boolean(blockingError);
    if (protectedRow) {
      button.textContent = '导出 ARC 底稿清单';
      const guidance = document.createElement('p');
      guidance.className = 'production-status';
      guidance.textContent = '新建 ARC 工程时，先导入底稿和表中的原视频。若工程已有同版底稿，可直接导入局部换镜清单和返修视频。';
      const patch = document.createElement('button');
      patch.type = 'button';
      patch.textContent = '导出本镜局部换镜清单';
      patch.onclick = () => {
        try {
          const list = projectFiles.shotPatch(data, episodeIndex, protectedRow.index);
          download(`${list.shot.id}-ARC局部换镜.json`, list);
          update(`已导出本镜局部换镜清单。请在 ARC 选中底稿里的 S03，并选择 ${list.shot.file}。`);
        } catch (error) { update(error.message); }
      };
      formControls.append(patch);
      formControls.after(guidance);
    }
    const dialogue = window.arcDialogueHandoff.create({
      initial: handoffDialogueFiles.get(episodeIndex) || dialogueFiles.get(episodeIndex), skipped,
      filmSeconds: Math.min(duration, frameDuration), onFile(file) {
        if (file) handoffDialogueFiles.set(episodeIndex, file);
        else handoffDialogueFiles.delete(episodeIndex);
      } });
    formControls.before(dialogue.panel);
    let exporting = false;
    function update(result = '') {
      button.disabled = exporting || Boolean(blockingError) || !coverageConfirmation.checked || (skipped > 0 && !confirmation.checked);
      feedback.textContent = result || blockingError || (!coverageConfirmation.checked ?
        `有 ${coverage.pending} 句未直接关联本次可交接的镜头。导出前请核对。` :
        skipped && !confirmation.checked ? `还有 ${skipped} 镜未通过。确认后可以先导出一份局部粗剪。` :
        '将清单与表中要交接的原视频一同导入 ARC。ARC 会核对实际时长。');
    }
    confirmation.onchange = coverageConfirmation.onchange = () => update();
    button.onclick = async () => {
      if (button.disabled) return;
      exporting = true;
      button.disabled = true;
      let result = '';
      try {
        if (!coverageConfirmation.checked) throw new Error('请先人工核对本集剧本与镜头覆盖。');
        const list = projectFiles.manifest(data, episodeIndex, choice.value, {
          schema: 'arc-short-drama-coverage-review-v1', confirmed: true,
          sourceUnitCount: coverage.rows.length, unlinkedUnitCount: coverage.pending,
          shotAnchors: ready.map(shot => ({ id: shot.id, scriptAnchor: shot.scriptAnchor,
            start: shot.start, end: shot.end }))
        }, { originalPatchBaseline: Boolean(protectedRow) });
        const audio = await dialogue.declaration();
        if (!panel.isConnected) return;
        if (audio) list.dialogue = audio;
        const label = protectedRow ? 'ARC底稿清单' : 'ARC镜头清单';
        download(`E${number(episodeIndex)}-${label}.json`, list);
        result = `已导出 ${list.shots.length} 镜${skipped ? `，暂缺 ${skipped} 镜` : ''}。清单已附剧本覆盖核对记录。` +
          (audio ? `导入 ARC 时请同时选择 ${audio.file}。` : '');
      } catch (error) { result = error.message; }
      finally { exporting = false; update(result); }
    };
    update();
    return panel;
  }

  function assistantPanel() {
    const context = window.arcProductionContext;
    const snapshot = context.create(data, episodeIndex, projectFiles);
    const panel = document.createElement('section');
    panel.className = 'production-history';
    panel.innerHTML = `
      <h3>本集镜头和交付缺项</h3>
      <div class="production-picker">
        <label>查看镜头<select></select></label>
        <button type="button" data-save-context>下载本集助手快照</button>
        <button type="button" data-save-brief>下载镜头简报</button>
      </div>
      <div class="assistant-preview"></div>
      <p class="production-status">快照包含本集文字、分镜和参考版本说明。MCP 从选定快照读取。</p>
      <output role="status"></output>`;
    const selector = panel.querySelector('select');
    const preview = panel.querySelector('.assistant-preview');
    const output = panel.querySelector('output');
    for (const item of snapshot.shots) selector.add(new Option(item.id, item.id));
    const queue = new Map(context.reviewQueue(snapshot).map(item => [item.id, item.notes]));
    const selectedId = 'S' + number(shotIndex);
    if (snapshot.shots.some(item => item.id === selectedId)) selector.value = selectedId;
    const episode = data.episodes[episodeIndex];
    const candidates = new Map(episode.shots.map((record, index) =>
      ['S' + number(index), { record, version: record.version, file: record.file }]));
    function approveRepair(id, plan, frameSources, frames) {
      const candidate = candidates.get(id);
      if (!candidate || data.episodes[episodeIndex] !== episode ||
          candidate.version !== candidate.record.version || candidate.file !== candidate.record.file) {
        throw new Error('候选已更换，请重新审片。');
      }
      const stored = window.arcRepair.bound(plan, candidate.record, frames);
      for (const issue of stored.plan.issues.filter(item => item.evidence === 'frame')) {
        const expectedName = issue.track === 'candidate' ? stored.file : frameSources.comparison;
        if (frameSources[issue.track] !== expectedName || !expectedName) {
          throw new Error('返修单引用的候选/对照画面与当前取样视频不符，请重新取样。');
        }
      }
      if (window.arcRepair.current(candidate.record) && !window.confirm('覆盖当前候选已确认的返修单？')) return false;
      window.arcRepair.saveBound(plan, candidate.record, frames, save);
      return true;
    }
    assistantRuntime = window.arcAssistant.create(workspace, snapshot, selector.value, assistantThreads, reviewVisionSeed,
      workspace === 'video' ? approveRepair : undefined);
    reviewVisionSeed = undefined;
    if (workspace !== 'script') assistantRuntime.panel.querySelector('header').append(selector.closest('label'));
    panel.prepend(assistantRuntime.panel);
    function update() {
      const { shot } = context.readShot(snapshot, selector.value);
      preview.replaceChildren();
      for (const [heading, value] of [
        ['剧本原文锚点', shot.story.scriptAnchor], ['剧情目的', shot.story.beat], ['构图与走位', shot.story.composition],
        ['表演节拍与表情', shot.story.performance],
        ['机位与运动', [shot.camera.move, shot.camera.path, shot.camera.framing && window.arcCamera.describe(shot.camera.framing)].filter(Boolean).join(' · ')],
        ['参考版本', shot.references.map(item => `${item.name} · ${item.revision}`).join(' / ')],
        ['审片状态', [shot.review.verdict, shot.review.issue].filter(Boolean).join(' · ')],
        ['待补资料', (queue.get(shot.id) || ['基础镜头资料齐全']).join(' / ')]
      ]) {
        const group = document.createElement('div'), title = document.createElement('b'), content = document.createElement('p');
        title.textContent = heading;
        content.textContent = value || '待填写';
        group.append(title, content);
        preview.append(group);
      }
    }
    selector.onchange = () => { assistantRuntime?.setShot(selector.value); update(); };
    panel.querySelector('[data-save-context]').onclick = () => {
      if (new Blob([JSON.stringify(snapshot, null, 2)]).size > 2 * 1024 * 1024) {
        output.textContent = '本集快照超过 2 MB，可以按镜头下载简报。';
        return;
      }
      download(`E${number(episodeIndex)}-助手快照.json`, snapshot);
      output.textContent = '已下载本集助手快照。';
    };
    panel.querySelector('[data-save-brief]').onclick = () => {
      download(`E${number(episodeIndex)}-${selector.value}-镜头简报.json`, context.readShot(snapshot, selector.value));
      output.textContent = '已下载当前镜头简报。';
    };
    update();
    return panel;
  }

  function enhancementPanel(record, { shotRelay = false, original } = {}) {
    const panel = document.createElement('section');
    panel.className = 'production-history';
    panel.innerHTML = `
      <h3>本地画质处理</h3>
      <p>为通过版本生成 ARC 处理任务。处理后可在这里对照原片和新片。</p>
      <div class="production-metadata">
        <label>短边分辨率<select data-res><option value="original">保持原尺寸</option><option value="720">720</option><option value="1080">1080</option></select></label>
        <label>目标帧率<select data-fps><option value="30">30 fps</option><option value="60">60 fps</option></select></label>
        <label>视频降噪<select data-denoise><option value="off">关闭</option><option value="light">轻度 · 原有参数</option><option value="medium">中度 · 实验</option></select></label>
        <label>锐化<select data-sharpen><option value="off">关闭</option><option value="light">轻度 · 实验</option></select></label>
        <label>运动补帧<select data-interpolate><option value="off">关闭</option><option value="on">开启</option></select></label>
        <label>关联通过版本的原视频<input type="file" accept="video/*,.mp4,.webm,.mov"></label>
      </div>
      <button type="button" class="production-action">下载画质任务</button>
      <output role="status"></output>
      <p data-frame-rate-hint role="note"></p>
      <p>降噪和锐化可分别做同镜对照，原片会保留。中度降噪和轻度锐化都是待验证档位：降噪可能抹掉皮肤、发丝和布料纹理，锐化可能放大噪点或产生边缘光晕；不能据此判断画质已提升。ARC 当前用 FFmpeg 做 Lanczos 缩放和传统运动估计补帧，不是 AI 超分或人脸修复。补帧可能在口型、发丝、手指和遮挡处产生重影，建议先处理短镜并逐帧对照。在 ARC-Light 的 tools 中运行 arc_shot_enhance_picker.ps1，按窗口选择任务、原片和输出位置；它会预检并自动生成回传报告。</p>
      <details class="production-history">
        <summary>查看实际滤镜参数与调参边界</summary>
        <ul>
          <li>降噪关闭：不加降噪滤镜。</li>
          <li>轻度：FFmpeg hqdn3d=1.2:0.9:2.4:1.8（亮度/色度空间阈值，亮度/色度时间阈值）。</li>
          <li>中度：FFmpeg hqdn3d=2.0:1.5:4.0:3.0；这是实验档，可能抹掉发丝、皮肤微纹理、布料纹理和运动细节。</li>
          <li>轻度锐化：unsharp 5×5，亮度强度 0.25；会放大噪点或产生边缘光晕。</li>
        </ul>
        <p>以上是传统 FFmpeg 滤镜，不是 AI 时域降噪、去模糊或细节重建。先以原片为 A、单独改一个因素做同镜 A/B；按脸/发丝/衣料、背景纹理、运动边缘和音画连续性记录观察。没有真实镜头对照通过前，不将任何档位设为推荐。H3 的 CFG、步数、scheduler 等只由已验证工作流实际暴露的输入决定；未暴露参数不提供猜测滑块。</p>
      </details>
      <div class="production-compare"></div>
      <button type="button" class="production-action" data-compare>同步对照本镜区间</button>
      <div data-enhance-transport></div>
      <div class="production-picker">
        <label>ARC 结果报告<input type="file" data-enhanced-report accept=".json,application/json"></label>
        <button type="button" data-keep-enhanced>把处理版加入待审候选</button>
        <button type="button" data-review-enhanced hidden>打开处理版审片</button>
      </div>
      <details class="production-history denoise-ab" data-denoise-ab>
        <summary>降噪档 A/B · 同镜同步看</summary>
        <p>选择同一通过版本导出的 A、B 两个处理视频和 ARC 报告。系统会校验原片哈希、切点与处理参数，只允许降噪档不同。</p>
        <div class="production-metadata">
          <label>A 版处理视频<input type="file" data-denoise-video="A" accept="video/mp4,.mp4"></label>
          <label>A 版 ARC 报告<input type="file" data-denoise-report="A" accept=".arc-enhance.json,application/json"></label>
          <label>B 版处理视频<input type="file" data-denoise-video="B" accept="video/mp4,.mp4"></label>
          <label>B 版 ARC 报告<input type="file" data-denoise-report="B" accept=".arc-enhance.json,application/json"></label>
        </div>
        <button type="button" class="production-action" data-denoise-compare>核对并同步 A/B</button>
        <output data-denoise-status role="status">尚未载入降噪对照。</output>
        <label>人工观察（可选）<textarea rows="2" maxlength="500" data-denoise-note placeholder="记录脸部、发丝、衣料、背景噪点或动作边缘的可见变化"></textarea></label>
        <button type="button" data-denoise-export hidden>下载降噪 A/B 记录</button>
        <div class="production-compare" data-denoise-players hidden>
          <section><h4 data-denoise-label="A">A 版</h4><video controls preload="metadata"></video></section>
          <section><h4 data-denoise-label="B">B 版</h4><video controls preload="metadata"></video></section>
        </div>
        <div data-denoise-transport></div>
      </details>
      <details class="production-history ai-enhancement" data-ai-enhancement hidden>
        <summary>ComfyUI AI 视频增强 · 实验通道</summary>
        <div class="production-picker" data-ai-preset-picker hidden>
          <label>增强工作流<select data-ai-preset></select></label>
          <a data-ai-workflow-source target="_blank" rel="noopener noreferrer" hidden>官方参考图</a>
        </div>
        <p data-ai-profile>正在读取增强工作流…</p>
        <details class="production-history">
          <summary>查看工作流声明的模型与采样参数</summary>
          <p>仅表示 API 工作流提交图中写了什么，不证明服务实际加载了权重或执行了这些设置。</p>
          <p data-ai-denoise-boundary hidden>SeedVR2 的 denoise 是模型复原采样参数，与 ARC 的 FFmpeg hqdn3d 降噪不同。下方控件只有在节点 schema 提供明确范围后才开放；这是待实测参数，不代表推荐值。</p>
          <pre data-ai-declaration>尚未读取。</pre>
        </details>
        <label data-ai-denoise-control hidden>SeedVR2 模型 denoise（实验参数）<input type="number" data-ai-denoise-input></label>
        <small data-ai-denoise-range hidden></small>
        <section class="production-history" data-ai-denoise-pair hidden>
          <h4>同镜 SeedVR2 denoise A/B</h4>
          <p>将提交两个独立任务。固定同一裁片、工作流、schema、画幅和其余选项，只改变 denoise；约消耗两次推理时间。数值仅作实验，不代表推荐值。</p>
          <div class="production-metadata">
            <label>A · denoise<input type="number" data-ai-denoise-a></label>
            <label>B · denoise<input type="number" data-ai-denoise-b></label>
          </div>
          <button type="button" class="production-action" data-ai-denoise-pair-start>提交同镜 A/B</button>
          <output data-ai-denoise-pair-status role="status">选择两个不同的有效数值后提交。</output>
          <div data-ai-denoise-pair-results></div>
        </section>
        <div class="production-metadata">
          <label>ARC 导出的本镜头裁切视频<input type="file" data-ai-video accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"></label>
          <label>ARC 裁切报告<input type="file" data-ai-report accept=".arc-ai-input.json,application/json"></label>
          <label>目标短边<select data-ai-short-edge><option value="720">720</option><option value="1080">1080</option></select></label>
        </div>
        <button type="button" class="production-action" data-ai-submit>提交 AI 增强</button>
        <output data-ai-status role="status">需选定通过版本原片，并提供 ARC 导出的单镜头裁切文件。</output>
        <div data-ai-result></div>
      </details>`;
    const [episode, shot] = [episodeIndex, shotIndex];
    const input = panel.querySelector('input');
    const button = panel.querySelector('button');
    const status = panel.querySelector('output');
    const fpsSelect = panel.querySelector('[data-fps]');
    const interpolateSelect = panel.querySelector('[data-interpolate]');
    const frameRateHint = panel.querySelector('[data-frame-rate-hint]');
    const updateFrameRateHint = () => {
      const timeline = fpsSelect.value === '60' ?
        'ARC 当前整片时间轴固定 30 fps，60 fps 处理版回到整片会重采样到 30 fps，需先对照确认收益。' :
        '30 fps 与 ARC 当前整片时间轴一致。';
      frameRateHint.textContent = interpolateSelect.value === 'on' ?
        `目标 ${fpsSelect.value} fps：开启 FFmpeg 运动估计补帧，会合成中间帧；快速动作、遮挡、发丝和口型可能出现伪影，需逐帧对照。${timeline}` :
        `目标 ${fpsSelect.value} fps：当前只做帧率转换，不合成真实中间帧；例如 24 fps 转 30 fps 可能重复帧，不会增加真实运动细节。${timeline}`;
    };
    fpsSelect.addEventListener('change', updateFrameRateHint);
    interpolateSelect.addEventListener('change', updateFrameRateHint);
    updateFrameRateHint();
    status.textContent = record.verdict === '通过' ? `当前源版本 · ${record.version || '待填写版本'}` : '等待镜头审片通过。';
    button.disabled = record.verdict !== '通过';
    if (shotRelay) {
      panel.classList.add('shot-relay-panel');
      panel.querySelector('[data-denoise-ab]').hidden = true;
      panel.querySelector('h3').textContent = '准备同一段 ARC 裁片';
      panel.querySelector('p').textContent = '用本镜通过版的切点导出裁片和报告，再把两者选回这里。';
      button.textContent = '下载 ARC 裁片任务';
      for (const field of panel.querySelectorAll('.production-metadata select')) field.closest('label').hidden = true;
      for (const element of panel.querySelectorAll('[data-frame-rate-hint], :scope > p:nth-of-type(3), :scope > .production-compare, [data-compare], [data-enhance-transport], :scope > .production-picker')) element.hidden = true;
      if (original instanceof File && original.name === record.file) {
        const transfer = new DataTransfer();
        transfer.items.add(original);
        input.files = transfer.files;
        status.textContent = '已选入当前通过版原片，可生成当前切点的裁片任务。';
      }
    }
    async function fullIdentity(file) {
      if (!window.crypto?.subtle) throw new Error('当前浏览器环境无法计算 SHA-256，请用本地工作台地址打开。');
      if (!file || !file.size || file.size > 128 * 1024 ** 2) throw new Error('请选择 128 MiB 以内的非空视频。');
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        byte => byte.toString(16).padStart(2, '0')).join('');
      return { name: file.name, size: file.size, sha256 };
    }
    async function sourceIdentity(file) {
      const identity = await fullIdentity(file);
      const bound = projectFiles.candidateSource(record);
      if (!bound) throw new Error('请先在镜头审片中核对并绑定当前源视频。');
      const same = bound.fingerprint.startsWith('sample-v1:') ?
        (await window.arcSourceDigest.compute(file)) === bound.contentDigest : bound.fingerprint === 'sha256:' + identity.sha256;
      if (bound.size !== identity.size || !same) {
        throw new Error('所选原视频与已通过候选的指纹不一致。');
      }
      return identity;
    }
    const denoiseSection = panel.querySelector('[data-denoise-ab]');
    const denoiseStatus = denoiseSection.querySelector('[data-denoise-status]');
    const denoisePlayers = denoiseSection.querySelectorAll('video');
    let denoiseComparison;
    let denoisePairRecord;
    const denoiseUrls = [];
    const clearDenoisePreview = () => {
      denoiseComparison?.dispose();
      denoiseComparison = undefined;
      for (const player of denoisePlayers) { player.pause(); player.removeAttribute('src'); player.load(); }
      for (const url of denoiseUrls.splice(0)) { URL.revokeObjectURL(url); mediaUrls.delete(url); }
      denoiseSection.querySelector('[data-denoise-players]').hidden = true;
      denoiseSection.querySelector('[data-denoise-transport]').replaceChildren();
      denoisePairRecord = undefined;
      denoiseSection.querySelector('[data-denoise-export]').hidden = true;
    };
    for (const field of denoiseSection.querySelectorAll('input[type="file"]')) {
      field.addEventListener('change', () => {
        clearDenoisePreview();
        denoiseStatus.textContent = '文件已变更，请重新核对 A/B。';
      });
    }
    input.addEventListener('change', () => {
      clearDenoisePreview();
      denoiseStatus.textContent = '原视频已变更，请重新核对 A/B。';
    });
    const metadata = (player, file) => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      denoiseUrls.push(url);
      mediaUrls.add(url);
      const timer = window.setTimeout(() => done(new Error('读取本地处理版媒体信息超时。')), 15000);
      const done = error => {
        window.clearTimeout(timer);
        player.removeEventListener('loadedmetadata', loaded);
        player.removeEventListener('error', failed);
        if (error) reject(error); else resolve({ width: player.videoWidth, height: player.videoHeight, duration: player.duration });
      };
      const loaded = () => done();
      const failed = () => done(new Error('无法读取所选处理版视频。'));
      player.addEventListener('loadedmetadata', loaded, { once: true });
      player.addEventListener('error', failed, { once: true });
      player.src = url;
    });
    denoiseSection.querySelector('[data-denoise-compare]').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      clearDenoisePreview();
      try {
        const original = input.files[0];
        if (!original) throw new Error('先选择当前通过版本的原视频。');
        const source = await sourceIdentity(original);
        const reports = [], files = [], outputs = [];
        for (const variant of ['A', 'B']) {
          const videoFile = denoiseSection.querySelector(`[data-denoise-video="${variant}"]`).files[0];
          const reportFile = denoiseSection.querySelector(`[data-denoise-report="${variant}"]`).files[0];
          if (!videoFile || !reportFile || reportFile.size > 64 * 1024) {
            throw new Error(`请为 ${variant} 版选择处理视频和 64 KiB 以内的 ARC 报告。`);
          }
          const report = JSON.parse(await reportFile.text());
          const identity = await fullIdentity(videoFile);
          reports.push(report);
          files.push(videoFile);
          outputs.push({ ...identity, ...await metadata(denoisePlayers[variant === 'A' ? 0 : 1], videoFile) });
          if (report.output?.name !== identity.name || report.output?.size !== identity.size || report.output?.sha256 !== identity.sha256) {
            throw new Error(`${variant} 版视频与 ARC 报告的文件名、大小或 SHA-256 不一致。`);
          }
        }
        if (input.files[0] !== original || files.some((file, index) =>
            denoiseSection.querySelector(`[data-denoise-video="${index ? 'B' : 'A'}"]`).files[0] !== file)) return;
        const comparison = projectFiles.enhancementComparison(episode, shot, record, source, reports, outputs);
        const selectedGeneration = projectFiles.generatedCandidate(record);
        const fixture = selectedGeneration?.testFixture === true || /本地(?:流程)?样片/.test(record.version || '') || /本地样片/.test(source.name);
        denoisePairRecord = { ...comparison, environment: 'local-ffmpeg',
          sourceClassification: fixture ? 'local-test-fixture' : 'source-not-marked-as-fixture' };
        const names = comparison.variants.map(item => `${item.variant} ${item.denoise === 'off' ? '关闭' : item.denoise === 'light' ? '轻度' : '中度'}`);
        for (const [index, item] of comparison.variants.entries()) {
          denoiseSection.querySelector(`[data-denoise-label="${index ? 'B' : 'A'}"]`).textContent =
            `${names[index]} · ${item.processingMs === null ? '耗时未记录' : `FFmpeg ${(item.processingMs / 1000).toFixed(2)} 秒`}`;
        }
        const pair = window.arcCompare.create(denoisePlayers[0], denoisePlayers[1]);
        denoiseComparison = pair;
        denoiseSection.querySelector('[data-denoise-transport]').append(pair.panel);
        denoiseSection.querySelector('[data-denoise-players]').hidden = false;
        pair.alignRange(0, 0, Math.min(outputs[0].duration, outputs[1].duration));
        denoiseStatus.textContent = `${fixture ? '本地测试素材 · ' : ''}已核对同源同切点；仅降噪不同：${names.join(' / ')}。未对结果作画质优劣判断。`;
        denoiseSection.querySelector('[data-denoise-export]').hidden = false;
      } catch (error) {
        clearDenoisePreview();
        denoiseStatus.textContent = error.message;
      } finally { button.disabled = false; }
    };
    denoiseSection.querySelector('[data-denoise-export]').onclick = () => {
      if (!denoisePairRecord) return;
      download(`${denoisePairRecord.shot.id}-降噪AB.json`, { ...denoisePairRecord,
        reviewedAt: new Date().toISOString(), humanObservation: denoiseSection.querySelector('[data-denoise-note]').value.trim() });
    };
    button.onclick = async () => {
      const file = input.files[0];
      const options = {
        resolution: panel.querySelector('[data-res]').value,
        fps: panel.querySelector('[data-fps]').value,
        denoise: panel.querySelector('[data-denoise]').value,
        sharpen: panel.querySelector('[data-sharpen]').value,
        interpolate: panel.querySelector('[data-interpolate]').value === 'on'
      };
      if (!file || file.name !== record.file?.trim() || !file.size || file.size > 128 * 1024 ** 2) {
        status.textContent = '请选择与审片记录同名、大小在 128 MB 以内的原视频。';
        return;
      }
      button.disabled = true;
      status.textContent = '正在本地校验源视频…';
      try {
        if (shotRelay) projectFiles.shotReplacement(data, episode, shot);
        const identity = await sourceIdentity(file);
        if (!panel.isConnected || input.files[0] !== file) return;
        const job = projectFiles.enhancement(episode, shot, record, identity, options);
        download(`${job.shot.id}-画质任务.json`, job);
        status.textContent = '已生成任务。处理版和结果报告可一同带回待审。';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
    const originalPreview = videoPreview('原片对照');
    const processedPreview = videoPreview('处理版对照');
    panel.querySelector('.production-compare').append(originalPreview, processedPreview);
    const chooseOriginal = originalPreview.querySelector('input');
    chooseOriginal.hidden = true;
    input.addEventListener('change', () => {
      const transfer = new DataTransfer();
      if (input.files[0]) transfer.items.add(input.files[0]);
      chooseOriginal.files = transfer.files;
      chooseOriginal.dispatchEvent(new Event('change'));
    });
    const [originalPlayer, processedPlayer] = panel.querySelectorAll('.production-compare video');
    const enhancementCompare = window.arcCompare.create(originalPlayer, processedPlayer);
    if (!shotRelay) pairedReview = enhancementCompare;
    panel.querySelector('[data-enhance-transport]').append(enhancementCompare.panel);
    for (const picker of [chooseOriginal, processedPreview.querySelector('input')]) {
      picker.addEventListener('change', () => enhancementCompare.sourceChanged());
    }
    const reportInput = panel.querySelector('[data-enhanced-report]');
    const reviewButton = panel.querySelector('[data-review-enhanced]');
    const keep = panel.querySelector('[data-keep-enhanced]');
    keep.disabled = button.disabled;
    keep.onclick = async () => {
      const reportFile = reportInput.files[0];
      const original = originalPreview.selectedSource() || input.files[0];
      const file = processedPreview.selectedSource();
      const player = processedPreview.querySelector('video');
      if (!original || !file || !reportFile || reportFile.size > 64 * 1024 || player.readyState < 1) {
        status.textContent = '请载入原片、处理版和 64 KiB 以内的 ARC 结果报告。';
        return;
      }
      keep.disabled = true;
      try {
        const report = JSON.parse(await reportFile.text());
        const source = await sourceIdentity(original);
        const output = await fullIdentity(file);
        const bound = file.size <= 64 * 1024 ** 2 ? {
          size: output.size, fingerprint: 'sha256:' + output.sha256, contentDigest: await window.arcSourceDigest.compute(file)
        } : await projectFiles.fingerprintSource(file);
        if (!panel.isConnected || reportInput.files[0] !== reportFile ||
            (originalPreview.selectedSource() || input.files[0]) !== original || processedPreview.selectedSource() !== file) return;
        const saved = projectFiles.enhancementCandidate(episode, shot, record, report, source, {
          ...output, width: player.videoWidth, height: player.videoHeight, duration: player.duration
        });
        const previous = record.candidates;
        if ((previous || []).some(item => item.version === saved.version)) throw new Error('该处理版已在候选版本中。');
        const sourceVersion = (previous || []).find(item => item.version === record.version?.trim());
        if (sourceVersion && (sourceVersion.file !== record.file || sourceVersion.inPoint !== record.inPoint ||
            sourceVersion.outPoint !== record.outPoint)) {
          throw new Error('当前源版本的文件或切点与已归档记录有差异，请核对版本后再加入处理版。');
        }
        if (!sourceVersion) projectFiles.saveCandidate(record);
        saved.sourceBinding = JSON.stringify({ version: saved.version, file: saved.file, ...bound });
        record.candidates = [...(record.candidates || []), saved];
        const previousAiJob = record.aiEnhancementJob;
        let clearAiJob = false;
        if (report.engine?.kind === 'comfyui-ai-enhancement' && previousAiJob) {
          try {
            clearAiJob = JSON.parse(previousAiJob).id === report.engine.taskId;
          } catch { clearAiJob = false; }
          if (clearAiJob) delete record.aiEnhancementJob;
        }
        if (!save()) {
          if (previous === undefined) delete record.candidates;
          else record.candidates = previous;
          if (clearAiJob) record.aiEnhancementJob = previousAiJob;
          throw new Error('浏览器未能保存这个候选，请重试。');
        }
        const sources = enhancedMedia.get(record) || new Map();
        sources.set(saved.version, [file, original]);
        if (sources.size > 8) sources.delete(sources.keys().next().value);
        enhancedMedia.set(record, sources);
        status.textContent = `处理版 ${saved.version} 已加入待审，原通过版保留。`;
        reviewButton.hidden = false;
        reviewButton.onclick = () => {
          const index = (record.candidates || []).findIndex(item => item === saved);
          if (index < 0) return;
          const before = structuredClone(record);
          projectFiles.loadCandidate(record, index);
          if (!save()) {
            for (const key of Object.keys(record)) delete record[key];
            Object.assign(record, before);
            status.textContent = '未能打开处理版，原通过版仍在。';
            return;
          }
          window.dispatchEvent(new CustomEvent('arc-production-route', { detail: { workspace: 'video', tab: 'review', shot } }));
        };
      } catch (error) { status.textContent = error.message; }
      finally { keep.disabled = false; }
    };
    panel.querySelector('[data-compare]').onclick = () => {
      try {
        const start = Number(record.inPoint), end = Number(record.outPoint);
        if (!record.inPoint?.trim() || !record.outPoint?.trim()) throw new Error('请先确认已审源片的入点和出点。');
        enhancementCompare.alignRange(start, 0, end - start);
        status.textContent = '已同步本镜区间。原片从已审入点开始，处理版从 0 秒开始。';
      } catch (error) { status.textContent = error.message; }
    };
    const aiPanel = panel.querySelector('[data-ai-enhancement]');
    const aiProfile = panel.querySelector('[data-ai-profile]');
    const aiClip = panel.querySelector('[data-ai-video]');
    const aiReportInput = panel.querySelector('[data-ai-report]');
    const aiSubmit = panel.querySelector('[data-ai-submit]');
    const aiStatus = panel.querySelector('[data-ai-status]');
    const aiResult = panel.querySelector('[data-ai-result]');
    const aiResolution = panel.querySelector('[data-ai-short-edge]');
    const aiPreset = panel.querySelector('[data-ai-preset]');
    const denoiseLabel = aiPanel.querySelector('[data-ai-denoise-control]');
    const denoiseInput = aiPanel.querySelector('[data-ai-denoise-input]');
    const denoiseRange = aiPanel.querySelector('[data-ai-denoise-range]');
    const denoisePairPanel = aiPanel.querySelector('[data-ai-denoise-pair]');
    const denoisePairA = aiPanel.querySelector('[data-ai-denoise-a]');
    const denoisePairB = aiPanel.querySelector('[data-ai-denoise-b]');
    const denoisePairStart = aiPanel.querySelector('[data-ai-denoise-pair-start]');
    const denoisePairStatus = aiPanel.querySelector('[data-ai-denoise-pair-status]');
    const denoisePairResults = aiPanel.querySelector('[data-ai-denoise-pair-results]');
    let denoiseControl = null;
    let aiEnhancementProfile = null;
    let aiEnhancementPreflight = null;
    let denoisePairSubmitting = false;
    const denoisePairPolling = new Set();
    const renderedDenoisePairs = new Set();
    function timingText(runtime) {
      const parts = [];
      if (Number.isFinite(runtime?.queueMs) && runtime.queueMs >= 0 && runtime.queueSource === 'comfy-history-timestamps')
        parts.push(`排队 ${(runtime.queueMs / 1000).toFixed(1)} 秒`);
      if (Number.isFinite(runtime?.executionMs) && runtime.executionMs >= 0 && runtime.executionSource === 'comfy-history-timestamps')
        parts.push(`工作流执行 ${(runtime.executionMs / 1000).toFixed(1)} 秒（ComfyUI 时间戳）`);
      if (runtime?.gpuKernelTime === false) parts.push('GPU 核心耗时未提供');
      else if (runtime?.executionMs != null) parts.push('执行耗时来源未核实');
      return parts.length ? ` · ${parts.join(' · ')}` : '';
    }
    function matchesCurrentCut(task) {
      const binding = projectFiles.candidateSource(record);
      return panel.isConnected && record.verdict === '通过' && binding &&
        task.shot.id === `E${number(episode)}-S${number(shot)}` &&
        task.shot.version === record.version && task.source.name === record.file?.trim() &&
        binding.size === task.source.size &&
        (!binding.fingerprint.startsWith('sha256:') || binding.fingerprint === 'sha256:' + task.source.sha256) &&
        task.shot.start === Number(record.inPoint) && task.shot.end === Number(record.outPoint);
    }
    const aiFetch = (route = '', options) => fetch('/api/enhancement' + route +
      (aiPreset.value && aiPreset.value !== 'custom' ? '?preset=' + encodeURIComponent(aiPreset.value) : ''),
      { ...options, cache: 'no-store' });
    function compareRelayRaw(task, video, item, outputContract, fixture, cadenceVerified) {
      const grid = document.createElement('section');
      grid.className = 'generation-ab-versions relay-raw-comparison';
      grid.setAttribute('aria-label', 'ARC 原裁片与 RelayVSR 原始回片');
      grid.innerHTML = `
        <section><h4>ARC 原裁片</h4><output data-cut-status role="status"></output>
          <video controls preload="metadata" hidden></video></section>
        <section><h4>RelayVSR 原始回片</h4></section>`;
      const sourceVideo = grid.querySelector('video');
      const feedback = grid.querySelector('[data-cut-status]');
      grid.lastElementChild.append(video);
      const comparison = window.arcCompare.create(sourceVideo, video, { audioChoice: shotRelay });
      grid.append(comparison.panel);
      const marks = shotRelay && item.assetKey ? window.arcRelayReview.create(record, {
        task, assetKey: item.assetKey, sourceVideo, video, comparison, fixture, save,
        canMark: () => Boolean(sourceUrl && matchesCurrentCut(task) &&
          JSON.parse(record.aiEnhancementJob || 'null')?.id === task.id &&
          cadenceVerified() && window.arcProductionQuality.matchesVideo(video, outputContract))
      }) : null;
      if (marks) grid.append(marks);
      const controller = new AbortController();
      let version = 0;
      let sourceUrl;
      function clearSource() {
        sourceVideo.removeAttribute('src');
        sourceVideo.hidden = true;
        sourceVideo.load();
        comparison.sourceChanged();
        if (sourceUrl) {
          URL.revokeObjectURL(sourceUrl);
          mediaUrls.delete(sourceUrl);
          sourceUrl = undefined;
        }
      }
      async function checkSource() {
        const current = ++version;
        clearSource();
        const clip = aiClip.files[0];
        feedback.textContent = `请选择本次提交的裁片 ${task.media.name}。`;
        if (!clip) return;
        try {
          if (shotRelay && !matchesCurrentCut(task)) throw new Error('通过版本或切点已变更，请重新导出本镜裁片。');
          if (clip.name !== task.media.name || clip.size !== task.media.size ||
              (await fullIdentity(clip)).sha256 !== task.media.sha256) {
            throw new Error('裁片与本次增强任务的文件名、大小或 SHA-256 不符。');
          }
          if (controller.signal.aborted || version !== current || !grid.isConnected) return;
          sourceUrl = URL.createObjectURL(clip);
          mediaUrls.add(sourceUrl);
          sourceVideo.src = sourceUrl;
          sourceVideo.hidden = false;
          feedback.textContent = '已核对同源裁片 · 两版从 0 秒对齐。';
        } catch (error) {
          if (!controller.signal.aborted && version === current) feedback.textContent = error.message;
        }
      }
      aiClip.addEventListener('change', checkSource, { signal: controller.signal });
      return { grid, checkSource, dispose() { controller.abort(); comparison.dispose(); clearSource(); } };
    }
    let aiPolling = false;
    async function updateAiJob(jobId) {
      if (aiPolling || !panel.isConnected) return;
      aiPolling = true;
      try {
        const response = await aiFetch('/' + encodeURIComponent(jobId));
        const job = await response.json();
        if (!panel.isConnected) return;
        const task = JSON.parse(record.aiEnhancementJob || 'null');
        if (task?.id !== jobId) {
          if (task?.id) window.setTimeout(() => updateAiJob(task.id), 0);
          return;
        }
        if (shotRelay && !matchesCurrentCut(task)) {
          aiStatus.textContent = '通过版本或切点已变更，此回片不能用于当前对照。';
          return;
        }
        if (!response.ok) throw new Error(job.error || '读取 AI 增强状态失败。');
        let taskChanged = false;
        if (typeof job.testFixture === 'boolean' && task.testFixture !== job.testFixture) {
          task.testFixture = job.testFixture;
          taskChanged = true;
        }
        if (job.workflowDeclaration && JSON.stringify(task.workflowDeclaration) !== JSON.stringify(job.workflowDeclaration)) {
          task.workflowDeclaration = job.workflowDeclaration;
          taskChanged = true;
        }
        const executionEvidence = job.executionPromptEvidence;
        if (executionEvidence?.evidence === 'comfy-history-prompt' &&
            ['pending', 'matched', 'mismatch', 'unavailable'].includes(executionEvidence.status)) {
          const savedEvidence = { evidence: executionEvidence.evidence, status: executionEvidence.status,
            ...(typeof executionEvidence.submittedSha256 === 'string' ? { submittedSha256: executionEvidence.submittedSha256 } : {}),
            ...(typeof executionEvidence.historySha256 === 'string' ? { historySha256: executionEvidence.historySha256 } : {}) };
          if (JSON.stringify(task.executionPromptEvidence || null) !== JSON.stringify(savedEvidence)) {
            task.executionPromptEvidence = savedEvidence;
            taskChanged = true;
          }
        }
        if (task.status !== job.status) {
          task.status = job.status;
          taskChanged = true;
          if (['complete', 'failed', 'no_video'].includes(job.status)) {
            task.runtime = {
              queueMs: Number.isFinite(job.timing?.queueMs) && job.timing.queueMs >= 0 ? job.timing.queueMs : null,
              executionMs: Number.isFinite(job.timing?.executionMs) && job.timing.executionMs >= 0 ? job.timing.executionMs : null,
              queueSource: job.timing?.queueSource === 'comfy-history-timestamps' ? 'comfy-history-timestamps' : null,
              executionSource: job.timing?.executionSource === 'comfy-history-timestamps' ? 'comfy-history-timestamps' : null,
              bridgeMs: Number.isFinite(job.timing?.bridgeMs) && job.timing.bridgeMs >= 0 ? job.timing.bridgeMs : null,
              bridgeSource: job.timing?.bridgeSource === 'local-bridge-observation' ? 'local-bridge-observation' : null,
              gpuKernelTime: job.timing?.gpuKernelTime === false ? false : null
            };
            if (job.error) task.error = String(job.error).slice(0, 400);
          }
        }
        if (taskChanged) {
          record.aiEnhancementJob = JSON.stringify(task);
          save();
        }
        const fixture = job.testFixture ? '本地测试素材 · ' : '';
        const executionVerified = task.executionPromptEvidence?.evidence === 'comfy-history-prompt' &&
          task.executionPromptEvidence.status === 'matched' &&
          /^[a-f0-9]{64}$/.test(task.executionPromptEvidence.submittedSha256 || '') &&
          task.executionPromptEvidence.submittedSha256 === task.executionPromptEvidence.historySha256;
        aiStatus.textContent = `${fixture}AI 增强任务 · ${job.status} · 重试 ${task.retryCount || 0} 次${timingText(job.timing)}`;
        if (job.status === 'failed' || job.status === 'no_video') {
          aiStatus.textContent += ` · ${job.error || '工作流没有返回视频。'}`;
          return;
        }
        if (job.status === 'complete' && Array.isArray(job.outputs) && job.outputs.length) {
          relayRawPreview?.dispose();
          relayRawPreview = undefined;
          aiResult.replaceChildren();
          for (const item of job.outputs) {
            if (!item.url?.startsWith(`/api/enhancement/${jobId}/video/`)) continue;
            const video = document.createElement('video');
            video.controls = true;
            video.preload = 'metadata';
            const outputUrl = item.assetKey ? item.url + '?' + new URLSearchParams({ file: item.name, asset: item.assetKey }) : item.url;
            video.src = outputUrl;
            video.className = 'production-ai-preview';
            const check = document.createElement('output');
            const link = document.createElement('a');
            link.href = outputUrl;
            link.download = item.name;
            link.textContent = `下载 ${item.name}`;
            const taskDownload = document.createElement('button');
            taskDownload.type = 'button';
            taskDownload.textContent = '下载 ARC 终结任务';
            taskDownload.disabled = !job.testFixture && !executionVerified;
            const verifiedRelay = job.scale === 2 && task?.id === jobId && job.graphSha256 === task?.options?.workflowSha256 &&
              Number.isSafeInteger(task.media?.frames) && task.media.frames > 0 &&
              /^[1-9]\d*\/[1-9]\d*$/.test(task.media?.fps || '');
            const [fpsNumerator, fpsDenominator] = String(task.media.fps || '').split('/').map(Number);
            const expectedFps = fpsNumerator / fpsDenominator;
            const outputContract = { width: task.media.width * 2, height: task.media.height * 2,
              seconds: task.media.duration, frames: task.media.frames,
              ...(Number.isFinite(expectedFps) && expectedFps > 0 ? { fps: expectedFps } : {}) };
            let cadenceVerified = false;
            if (verifiedRelay) {
              window.arcProductionQuality.checkVideo(video, check, outputContract, passed => {
                cadenceVerified = passed;
                taskDownload.disabled = !passed;
                link.hidden = !passed;
              });
            } else if (job.scale === 2) {
              taskDownload.disabled = true;
              link.hidden = true;
              check.textContent = '缺少该 RelayVSR 任务的签名和源尺寸，无法核对回片。';
            }
            taskDownload.onclick = () => {
              try {
                const task = JSON.parse(record.aiEnhancementJob || 'null');
                if (!task || task.id !== jobId) throw new Error();
                download(`${task.shot.id}-AI终结任务.json`, task);
              } catch { aiStatus.textContent = '任务记录缺失，请重新提交并保存工作台项目。'; }
            };
            if (verifiedRelay && !relayRawPreview) {
              relayRawPreview = compareRelayRaw(task, video, item, outputContract, Boolean(job.testFixture), () => cadenceVerified);
              aiResult.append(relayRawPreview.grid);
              relayRawPreview.checkSource();
            } else aiResult.append(video);
            aiResult.append(link, taskDownload, check);
          }
          aiStatus.textContent = `${fixture}回片已返回 · 重试 ${task.retryCount || 0} 次${timingText(task.runtime)}。` + (shotRelay ?
            '同步两段后可按时间码记录问题。' : relayRawPreview ?
            '可先同步看原裁片和原始回片，检查箱沿、反光和闪烁。' : '') +
            (!job.testFixture && !task.executionPromptEvidence ? 'ComfyUI history 执行图回执未核对；可预览/下载回片，但不能进入 ARC 正式候选。' :
              !job.testFixture && !executionVerified ? 'ComfyUI history 执行图缺失或不匹配；不可将此回片登记为正式候选。' :
                '尺寸和时长核对后，可下载视频及 ARC 终结任务。运行 ARC-Light/tools/arc_shot_ai_finalize_picker.ps1 生成 MP4 和验收报告，再回来登记待审候选。');
          return;
        }
        window.setTimeout(() => updateAiJob(jobId), 2500);
      } catch (error) { aiStatus.textContent = `${error.message} 可稍后重新打开此页继续查询。`; }
      finally { aiPolling = false; }
    }
    function findDenoisePair(pairId) {
      return (Array.isArray(record.seedvr2DenoisePairs) ? record.seedvr2DenoisePairs : []).find(item => item.id === pairId) || null;
    }
    async function updateDenoisePairPreview(pairId) {
      const pair = findDenoisePair(pairId);
      if (!pair || renderedDenoisePairs.has(pairId) || !pair.variants?.A?.output?.url || !pair.variants?.B?.output?.url) return;
      if (pair.shot?.version !== record.version || pair.shot?.start !== Number(record.inPoint) || pair.shot?.end !== Number(record.outPoint)) {
        denoisePairStatus.textContent = '这组回片对应旧镜头版本或切点；保留记录，但不并入当前镜头对照。';
        return;
      }
      const sameShot = task => task?.shot?.id === pair.shot.id && task?.shot?.version === pair.shot.version &&
        task?.shot?.start === pair.shot.start && task?.shot?.end === pair.shot.end;
      const sameSource = task => task?.source?.sha256 === pair.source?.sha256 && task?.media?.sha256 === pair.media?.sha256 &&
        task?.media?.name === pair.media?.name && task?.media?.size === pair.media?.size;
      const sameOptions = task => {
        const options = { ...(task?.options || {}) };
        delete options.denoise;
        return JSON.stringify(options);
      };
      const declaration = task => task?.workflowDeclaration;
      const comparableDeclaration = task => {
        const value = declaration(task);
        if (!value || value.evidence !== 'workflow-declared' || value.loadedWeightsVerified !== false) return null;
        const copy = structuredClone(value);
        for (const sampler of copy.samplers || []) {
          if (sampler?.settings && /seedvr2/i.test(sampler.type || '')) delete sampler.settings.denoise;
        }
        return JSON.stringify(copy);
      };
      const declaredDenoiseMatches = (task, value) => {
        const nodes = (declaration(task)?.samplers || []).filter(item => /seedvr2/i.test(item.type || '') &&
          Number.isFinite(item.settings?.denoise));
        return nodes.length === 1 && nodes[0].settings.denoise === value;
      };
      const aTask = pair.variants.A.task, bTask = pair.variants.B.task;
      if (!pair.source?.sha256 || !pair.media?.sha256 || !sameShot(aTask) || !sameShot(bTask) ||
          !sameSource(aTask) || !sameSource(bTask) || aTask?.source?.sha256 !== bTask?.source?.sha256 ||
          aTask?.media?.sha256 !== bTask?.media?.sha256 || aTask?.options?.denoise !== pair.variants.A.denoise ||
          bTask?.options?.denoise !== pair.variants.B.denoise || sameOptions(aTask) !== sameOptions(bTask) ||
          comparableDeclaration(aTask) !== comparableDeclaration(bTask) ||
          (aTask?.testFixture !== true && !declaredDenoiseMatches(aTask, pair.variants.A.denoise)) ||
          (bTask?.testFixture !== true && !declaredDenoiseMatches(bTask, pair.variants.B.denoise)) ||
          aTask?.providerFingerprint !== pair.providerFingerprint || bTask?.providerFingerprint !== pair.providerFingerprint ||
          aTask?.options?.workflowSha256 !== pair.workflowSha256 || bTask?.options?.workflowSha256 !== pair.workflowSha256) {
        denoisePairStatus.textContent = 'A/B 的原片、裁片、镜头、工作流或其他参数身份不一致；拒绝同步审片。';
        return;
      }
      if (!panel.isConnected || findDenoisePair(pairId) !== pair) return;
      const grid = document.createElement('section');
      grid.className = 'generation-ab-versions denoise-model-ab';
      grid.setAttribute('aria-label', 'SeedVR2 denoise 同镜 A/B 回片');
      const players = {};
      for (const variant of ['A', 'B']) {
        const result = pair.variants[variant];
        const section = document.createElement('section');
        const title = document.createElement('h4');
        title.textContent = `${variant} · denoise ${result.denoise} · ${timingText(result.task.runtime)}`;
        const video = document.createElement('video');
        video.controls = true;
        video.preload = 'metadata';
        const output = result.output;
        const url = output.assetKey ? output.url + '?' + new URLSearchParams({ file: output.name, asset: output.assetKey }) : output.url;
        video.src = url;
        section.append(title, video);
        grid.append(section);
        players[variant] = video;
      }
      const check = document.createElement('output');
      check.setAttribute('role', 'status');
      check.textContent = '读取 A/B 回片规格…';
      grid.append(check);
      const configEvidence = document.createElement('details');
      configEvidence.className = 'production-optional-field';
      const configSummary = document.createElement('summary');
      configSummary.textContent = '查看共用模型与采样设置';
      const configText = document.createElement('p');
      const firstDeclaration = declaration(aTask);
      const models = (firstDeclaration?.models || []).map(item => item.file).join('、') || '未从工作流声明读取';
      const precision = (firstDeclaration?.precision || []).join('、') || '未声明';
      const seeds = (firstDeclaration?.seeds || []).map(item => `${item.input}=${item.value}`).join(' · ') || '未声明';
      const samplers = (firstDeclaration?.samplers || []).map(item => `${item.type} ${Object.entries(item.settings || {})
        .filter(([key]) => key !== 'denoise').map(([key, value]) => `${key}=${Array.isArray(value) ? value[0] : value}`).join(', ')}`).join('；') || '未声明';
      configText.textContent = `工作流 ${pair.workflowSha256.slice(0, 12)} · schema ${pair.preflightSchemaSha256.slice(0, 12)}；` +
        `输出短边 ${pair.fixedOptions?.resolution || '未声明'} · ${pair.fixedOptions?.fps || '未声明'} fps；模型 ${models} · 精度 ${precision}；` +
        `seed ${seeds}；共用采样/处理 ${samplers}；唯一变量 SeedVR2 denoise：A ${pair.variants.A.denoise} / B ${pair.variants.B.denoise}。工作流声明不证明远端运行时实际加载了这些权重。`;
      configEvidence.append(configSummary, configText);
      grid.append(configEvidence);
      denoisePairResults.replaceChildren(grid);
      renderedDenoisePairs.add(pairId);
      Promise.all(['A', 'B'].map(variant => new Promise((resolve, reject) => {
        const video = players[variant];
        const timer = window.setTimeout(() => reject(new Error('读取回片规格超时。')), 15000);
        video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(video); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法读取一版回片。')); }, { once: true });
      }))).then(([a, b]) => {
        if (Math.abs(a.duration - b.duration) > .04 || a.videoWidth !== b.videoWidth || a.videoHeight !== b.videoHeight) {
          check.textContent = `两版输出规格不一致，暂不启用同步比较：A ${a.videoWidth}×${a.videoHeight} · ${a.duration.toFixed(2)}秒；B ${b.videoWidth}×${b.videoHeight} · ${b.duration.toFixed(2)}秒。`;
          return;
        }
        const comparison = window.arcCompare.create(a, b, { audioChoice: true });
        grid.append(comparison.panel);
        const fixture = aTask.testFixture === true || bTask.testFixture === true;
        const executionMatched = ['A', 'B'].every(variant => {
          const evidence = pair.variants[variant].task.executionPromptEvidence;
          return evidence?.evidence === 'comfy-history-prompt' && evidence.status === 'matched' &&
            /^[a-f0-9]{64}$/.test(evidence.submittedSha256 || '') && evidence.submittedSha256 === evidence.historySha256;
        });
        const boundary = fixture ? '本地测试素材，不代表模型画质或真实执行。' : executionMatched ?
          '两版执行图均与 ComfyUI history 回执匹配；权重运行时加载仍未核验。' :
          '执行图 history 回执缺失或不匹配；可以观察回片，但不能作为参数效果结论。';
        check.textContent = `两版尺寸与时长一致（${a.videoWidth}×${a.videoHeight} · ${a.duration.toFixed(2)}秒），同步审片已开启。${boundary}帧率、音轨和时间码仍需 ARC 回片报告核对。`;
        const review = document.createElement('section');
        review.className = 'production-history';
        review.setAttribute('aria-label', 'SeedVR2 参数 A/B 时间码审片记录');
        const heading = document.createElement('h4');
        heading.textContent = '时间码问题记录';
        const hint = document.createElement('p');
        hint.textContent = '先用上方同步进度定位，再记录当前时间。只保存观察，不自动判定哪版更好。';
        const controls = document.createElement('div');
        controls.className = 'production-metadata';
        const targetLabel = document.createElement('label');
        targetLabel.textContent = '问题范围';
        const target = document.createElement('select');
        target.dataset.denoiseMarkTarget = '';
        for (const value of ['A', 'B', 'A/B']) target.add(new Option(value, value));
        targetLabel.append(target);
        const issueLabel = document.createElement('label');
        issueLabel.textContent = '问题类型';
        const issue = document.createElement('select');
        issue.dataset.denoiseMarkIssue = '';
        for (const value of ['细节抹除', '闪烁', '运动重影', '边缘伪影', '其他']) issue.add(new Option(value, value));
        issueLabel.append(issue);
        const noteLabel = document.createElement('label');
        noteLabel.textContent = '观察备注（可选）';
        const note = document.createElement('input');
        note.type = 'text'; note.maxLength = 300; note.dataset.denoiseMarkNote = '';
        note.placeholder = '例如：B 的发丝更平滑，但眼睫细节变少';
        noteLabel.append(note);
        const addMark = document.createElement('button');
        addMark.type = 'button'; addMark.className = 'production-action';
        addMark.dataset.denoiseMarkAdd = ''; addMark.textContent = '记录当前时码';
        const exportMarks = document.createElement('button');
        exportMarks.type = 'button'; exportMarks.dataset.denoiseMarkExport = '';
        exportMarks.textContent = '导出对照记录';
        controls.append(targetLabel, issueLabel, noteLabel, addMark, exportMarks);
        const markStatus = document.createElement('output');
        markStatus.setAttribute('role', 'status');
        const markList = document.createElement('ol');
        markList.dataset.denoiseMarkList = '';
        const renderMarks = () => {
          markList.replaceChildren();
          for (const mark of pair.reviewMarks || []) {
            const item = document.createElement('li');
            item.textContent = `${(mark.atMs / 1000).toFixed(3)} 秒 · ${mark.target} · ${mark.issue}${mark.note ? ` · ${mark.note}` : ''}`;
            markList.append(item);
          }
          markStatus.textContent = `${(pair.reviewMarks || []).length} 条时间码观察已保存到本镜 A/B 记录。`;
        };
        addMark.onclick = () => {
          const aTime = players.A.currentTime, bTime = players.B.currentTime;
          if (!Number.isFinite(aTime) || !Number.isFinite(bTime) || Math.abs(aTime - bTime) > 0.05) {
            markStatus.textContent = '两版当前时间没有对齐；先拖动同步进度，再记录。';
            return;
          }
          pair.reviewMarks = Array.isArray(pair.reviewMarks) ? pair.reviewMarks : [];
          if (pair.reviewMarks.length >= 100) { markStatus.textContent = '每组最多保存 100 条时间码观察。'; return; }
          pair.reviewMarks.push({ atMs: Math.round(aTime * 1000), target: target.value, issue: issue.value,
            note: note.value.trim().slice(0, 300), createdAt: new Date().toISOString() });
          if (!save()) { pair.reviewMarks.pop(); markStatus.textContent = '保存失败；本条观察未保留。'; return; }
          renderMarks();
        };
        exportMarks.onclick = () => download(`${pair.shot.id}-SeedVR2-denoise-对照审片.json`, {
          schema: 'arc-seedvr2-denoise-ab-review-v1', exportedAt: new Date().toISOString(),
          sourceClassification: ['A', 'B'].some(variant => pair.variants[variant].task.testFixture === true) ?
            'local-test-fixture' : 'provider-return-unverified', pair
        });
        review.append(heading, hint, controls, markStatus, markList);
        grid.append(review);
        renderMarks();
        pair.comparisonReady = true;
        save();
      }).catch(error => { check.textContent = error.message; });
    }
    async function updateAiDenoisePair(pairId) {
      if (denoisePairPolling.has(pairId) || !panel.isConnected) return;
      denoisePairPolling.add(pairId);
      let shouldPoll = false;
      try {
        const pair = findDenoisePair(pairId);
        if (!pair || pair.schema !== 'arc-seedvr2-denoise-ab-v1') return;
        for (const variant of ['A', 'B']) {
          const item = pair.variants?.[variant];
          const task = item?.task;
          if (!task?.id || ['complete', 'failed', 'no_video'].includes(task.status)) continue;
          shouldPoll = true;
          try {
            const response = await aiFetch('/' + encodeURIComponent(task.id));
            const job = await response.json();
            if (!response.ok || job.id !== task.id) throw new Error(job.error || '读取 A/B 任务状态失败。');
            task.status = job.status;
            if (typeof job.testFixture === 'boolean') task.testFixture = job.testFixture;
            if (job.workflowDeclaration?.evidence === 'workflow-declared' && job.workflowDeclaration.loadedWeightsVerified === false)
              task.workflowDeclaration = job.workflowDeclaration;
            const execution = job.executionPromptEvidence;
            if (execution?.evidence === 'comfy-history-prompt' && ['pending', 'matched', 'mismatch', 'unavailable'].includes(execution.status)) {
              task.executionPromptEvidence = { evidence: execution.evidence, status: execution.status,
                ...(typeof execution.submittedSha256 === 'string' ? { submittedSha256: execution.submittedSha256 } : {}),
                ...(typeof execution.historySha256 === 'string' ? { historySha256: execution.historySha256 } : {}) };
            }
            task.runtime = {
              queueMs: Number.isFinite(job.timing?.queueMs) && job.timing.queueMs >= 0 ? job.timing.queueMs : null,
              executionMs: Number.isFinite(job.timing?.executionMs) && job.timing.executionMs >= 0 ? job.timing.executionMs : null,
              queueSource: job.timing?.queueSource === 'comfy-history-timestamps' ? 'comfy-history-timestamps' : null,
              executionSource: job.timing?.executionSource === 'comfy-history-timestamps' ? 'comfy-history-timestamps' : null,
              bridgeMs: Number.isFinite(job.timing?.bridgeMs) && job.timing.bridgeMs >= 0 ? job.timing.bridgeMs : null,
              bridgeSource: job.timing?.bridgeSource === 'local-bridge-observation' ? 'local-bridge-observation' : null,
              gpuKernelTime: job.timing?.gpuKernelTime === false ? false : null
            };
            if (job.status === 'complete' && Array.isArray(job.outputs) && job.outputs.length === 1 &&
                typeof job.outputs[0].url === 'string' && new RegExp(`^/api/enhancement/${task.id}/video/0$`).test(job.outputs[0].url) &&
                /^[a-f0-9]{64}$/.test(job.outputs[0].assetKey || '') && typeof job.outputs[0].name === 'string') {
              item.output = { name: job.outputs[0].name, assetKey: job.outputs[0].assetKey, url: job.outputs[0].url };
            } else if (job.status === 'failed' || job.status === 'no_video') task.error = String(job.error || job.status).slice(0, 300);
            if (pair.providerFingerprint !== job.providerFingerprint || pair.workflowSha256 !== job.graphSha256) {
              task.status = 'failed';
              task.error = '服务端工作流或端点指纹与这组 A/B 不一致。';
              delete item.output;
            }
          } catch (error) {
            task.status = 'failed';
            task.error = String(error.message || error).slice(0, 300);
          }
        }
        const statuses = ['A', 'B'].map(variant => pair.variants?.[variant]?.task?.status || '未提交');
        const terminal = statuses.every(status => ['complete', 'failed', 'no_video'].includes(status));
        shouldPoll = !terminal;
        denoisePairStatus.textContent = `A denoise ${pair.variants.A.denoise}：${statuses[0]}${pair.variants.A.task.error ? `（${pair.variants.A.task.error}）` : ''} ${timingText(pair.variants.A.task.runtime)} · ` +
          `B denoise ${pair.variants.B.denoise}：${statuses[1]}${pair.variants.B.task.error ? `（${pair.variants.B.task.error}）` : ''} ${timingText(pair.variants.B.task.runtime)}`;
        denoisePairStart.disabled = denoisePairSubmitting || !terminal;
        aiSubmit.disabled = record.verdict !== '通过' || !terminal;
        save();
        updateDenoisePairPreview(pairId);
      } finally {
        denoisePairPolling.delete(pairId);
        if (shouldPoll && panel.isConnected) window.setTimeout(() => updateAiDenoisePair(pairId), 2500);
      }
    }
    async function startAiDenoisePair() {
      if (denoisePairSubmitting) return;
      const aValue = Number(denoisePairA.value), bValue = Number(denoisePairB.value);
      if (!denoiseControl || denoisePairPanel.hidden || !denoisePairA.checkValidity() || !denoisePairB.checkValidity() ||
          !Number.isFinite(aValue) || !Number.isFinite(bValue) || aValue === bValue) {
        denoisePairStatus.textContent = 'A、B 必须是 ComfyUI 范围/步长内的两个不同数值。';
        return;
      }
      const existingPairs = Array.isArray(record.seedvr2DenoisePairs) ? record.seedvr2DenoisePairs : [];
      if (existingPairs.some(pair => ['A', 'B'].some(variant => pair.variants?.[variant]?.task?.id &&
          !['complete', 'failed', 'no_video'].includes(pair.variants[variant].task.status)))) {
        denoisePairStatus.textContent = '上一组 A/B 仍在运行，请等待两边结束后再开始，避免重复占用算力。';
        return;
      }
      if (record.aiEnhancementJob) {
        try {
          const previous = JSON.parse(record.aiEnhancementJob);
          if (previous?.id && !['complete', 'failed', 'no_video'].includes(previous.status || '')) {
            denoisePairStatus.textContent = '普通 AI 增强任务仍在运行，请等它结束后再提交双任务对照。';
            return;
          }
        } catch { /* An invalid old task must not block the new, independently fingerprinted pair. */ }
      }
      denoisePairSubmitting = true;
      denoisePairStart.disabled = true;
      aiSubmit.disabled = true;
      try {
        const original = input.files[0], clip = aiClip.files[0], reportFile = aiReportInput.files[0];
        if (!original || original.name !== record.file?.trim() || !clip || !reportFile || reportFile.size > 64 * 1024)
          throw new Error('请选择通过版本原片、本镜 ARC 裁切视频和裁切报告。');
        const profileResponse = await aiFetch();
        const profile = await profileResponse.json();
        if (!profileResponse.ok || profile.denoiseControl?.node !== denoiseControl.node || profile.denoiseControl?.field !== denoiseControl.field)
          throw new Error('SeedVR2 工作流或 denoise 节点已变化，请刷新本镜后重新预检。');
        const checkResponse = await aiFetch('/preflight');
        const check = await checkResponse.json();
        const schemaControl = check.parameterControls?.find(item => item.node === denoiseControl.node && item.field === denoiseControl.field);
        if (!checkResponse.ok || check.issues > 0 || check.schemaSha256 !== aiEnhancementPreflight?.schemaSha256 ||
            !schemaControl || !Number.isFinite(schemaControl.min) || !Number.isFinite(schemaControl.max))
          throw new Error('SeedVR2 节点 schema 与本次预检不一致，未提交任务。');
        for (const value of [aValue, bValue]) {
          const steps = schemaControl.step ? (value - schemaControl.min) / schemaControl.step : 0;
          if (value < schemaControl.min || value > schemaControl.max ||
              (schemaControl.step && Math.abs(steps - Math.round(steps)) > 1e-6) ||
              (schemaControl.type === 'INT' && !Number.isInteger(value))) throw new Error(`denoise ${value} 不符合实时节点范围或步长。`);
        }
        const source = await sourceIdentity(original), media = await fullIdentity(clip);
        const report = JSON.parse(await reportFile.text());
        const { duration, width, height } = await window.arcProductionQuality.readVideoFile(clip);
        const start = Number(record.inPoint), end = Number(record.outPoint);
        const shotId = `E${String(episode + 1).padStart(2, '0')}-S${String(shot + 1).padStart(2, '0')}`;
        if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(duration - (end - start)) > .12 ||
            report?.schema !== 'arc-ai-input-v1' || report.shot?.id !== shotId || report.shot?.version !== record.version ||
            report.shot?.start !== start || report.shot?.end !== end || report.source?.sha256 !== source.sha256 ||
            report.media?.sha256 !== media.sha256 || report.media?.name !== media.name || report.media?.size !== media.size ||
            Math.abs(report.media?.duration - duration) > .12) throw new Error('ARC 裁切报告、原片或本镜切点身份不匹配。');
        const baseOptions = { shortEdge: profile.resolutionControl ? Number(aiResolution.value) : null,
          ...(profile.resolutionControl?.mode === 'height' ? { nativeResolution: height > width ?
            Math.round(Number(aiResolution.value) * height / width) : Number(aiResolution.value) } : {}),
          resolution: String(aiResolution.value), fps: panel.querySelector('[data-fps]').value,
          workflowSha256: profile.sha256, preflightSchemaSha256: check.schemaSha256 };
        const pairId = crypto.randomUUID();
        const sharedMedia = { ...media, duration: report.media.duration,
          ...(profile.resolutionControl?.mode === 'height' ? { width, height } : {}) };
        const sharedShot = { id: shotId, version: record.version, start, end };
        const variants = {};
        for (const [variant, value] of [['A', aValue], ['B', bValue]]) {
          const task = { schema: 'arc-ai-enhancement-task-v1', id: crypto.randomUUID(), source,
            workflowDeclaration: profile.workflowDeclaration || null, media: sharedMedia, shot: sharedShot,
            options: { ...baseOptions, denoise: value }, providerFingerprint: profile.providerFingerprint,
            retryCount: 0, attemptHistory: [], status: 'submitting' };
          variants[variant] = { denoise: value, task };
        }
        const pair = { schema: 'arc-seedvr2-denoise-ab-v1', id: pairId, createdAt: new Date().toISOString(),
          shot: sharedShot, source, media: sharedMedia, workflowSha256: profile.sha256,
          preflightSchemaSha256: check.schemaSha256, providerFingerprint: profile.providerFingerprint,
          fixedOptions: baseOptions, variants };
        record.seedvr2DenoisePairs = [...existingPairs, pair].slice(-10);
        if (!save()) throw new Error('无法保存 A/B 任务记录，未向 ComfyUI 提交。');
        denoisePairStatus.textContent = '提交 A/B 双任务…';
        for (const variant of ['A', 'B']) {
          const task = variants[variant].task;
          const form = new FormData();
          form.append('task', JSON.stringify(task)); form.append('video', clip, clip.name);
          form.append('report', reportFile, reportFile.name);
          try {
            const response = await aiFetch('', { method: 'POST', body: form });
            const accepted = await response.json();
            if (!response.ok) throw new Error(accepted.error || '提交失败。');
            task.status = accepted.status || 'queued';
            if (typeof accepted.testFixture === 'boolean') task.testFixture = accepted.testFixture;
            if (accepted.workflowDeclaration?.evidence === 'workflow-declared' && accepted.workflowDeclaration.loadedWeightsVerified === false)
              task.workflowDeclaration = accepted.workflowDeclaration;
            const execution = accepted.executionPromptEvidence;
            if (execution?.evidence === 'comfy-history-prompt' && ['pending', 'matched', 'mismatch', 'unavailable'].includes(execution.status)) {
              task.executionPromptEvidence = { evidence: execution.evidence, status: execution.status,
                ...(typeof execution.submittedSha256 === 'string' ? { submittedSha256: execution.submittedSha256 } : {}),
                ...(typeof execution.historySha256 === 'string' ? { historySha256: execution.historySha256 } : {}) };
            }
            save();
          } catch (error) {
            task.status = 'failed'; task.error = String(error.message || error).slice(0, 300); save();
          }
        }
        denoisePairStatus.textContent = '双任务已提交或记录了单边失败；等待 A/B 各自回片。';
        updateAiDenoisePair(pairId);
      } catch (error) {
        denoisePairStatus.textContent = error.message;
      } finally {
        denoisePairSubmitting = false;
        denoisePairStart.disabled = false;
        if (denoisePairStatus.textContent.includes('仍在运行')) aiSubmit.disabled = true;
        else aiSubmit.disabled = record.verdict !== '通过';
      }
    }
    denoisePairStart.onclick = startAiDenoisePair;
    for (const fileInput of [input, aiClip]) fileInput.addEventListener('change', () => {
      renderedDenoisePairs.clear();
      denoisePairResults.replaceChildren();
      const latest = (Array.isArray(record.seedvr2DenoisePairs) ? record.seedvr2DenoisePairs : []).at(-1);
      if (latest) updateDenoisePairPreview(latest.id);
    });
    async function loadAiProfile() {
      const discovery = await fetch('/api/workflow-presets', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null).catch(() => null);
      if (!panel.isConnected) return;
      const choices = discovery?.presets.filter(item => item.kind === 'enhancement') || [];
      if (choices.length) {
        if (discovery.defaultEnhancement) aiPreset.add(new Option('自定义增强工作流', 'custom'));
        for (const item of choices) aiPreset.add(new Option(item.name, item.id));
        if (shotRelay) {
          if (!choices.some(option => option.id === 'relayvsr-2x')) throw new Error('桥接未启用 RelayVSR 2× 预设。');
          aiPreset.value = 'relayvsr-2x';
          aiPreset.disabled = true;
        } else if ([...aiPreset.options].some(option => option.value === record.enhancementPreset)) aiPreset.value = record.enhancementPreset;

        panel.querySelector('[data-ai-preset-picker]').hidden = false;
        const link = panel.querySelector('[data-ai-workflow-source]');
        const selected = choices.find(item => item.id === aiPreset.value);
        if (selected?.source) { link.href = selected.source; link.hidden = false; }
        aiPreset.onchange = () => {
          const previous = record.enhancementPreset;
          record.enhancementPreset = aiPreset.value;
          if (save()) render();
          else {
            if (previous === undefined) delete record.enhancementPreset;
            else record.enhancementPreset = previous;
            aiPreset.value = selected?.id || 'custom';
          }
        };
      }
      const response = await aiFetch();
      const profile = await response.json();
      if (!response.ok || !panel.isConnected) return;
      aiEnhancementProfile = profile;
      aiPanel.hidden = false;
      const declaration = profile.workflowDeclaration;
      aiPanel.querySelector('[data-ai-declaration]').textContent = declaration ? JSON.stringify(declaration, null, 2) :
        '当前工作流没有可识别的模型/采样声明。';
      aiPanel.querySelector('[data-ai-denoise-boundary]').hidden = profile.seedvr2DenoiseDeclared !== true;
      denoiseControl = profile.denoiseControl;
      denoiseLabel.hidden = true;
      denoiseRange.hidden = true;
      if (shotRelay) {
        aiPanel.open = true;
        aiPanel.querySelector('summary').textContent = '提交裁片与对照回片';
        aiSubmit.textContent = '提交 RelayVSR 2× 对照';
      }
      aiProfile.textContent = `${profile.testFixture ? '本地测试模式 · ' : ''}工作流：${profile.workflow} · 工作流指纹 ${profile.sha256.slice(0, 12)} · 服务端点指纹 ${profile.providerFingerprint?.slice(0, 12) || '缺失'} · 输入节点 ${profile.input.node}.${profile.input.field}。` +
        (profile.scale === 2 ? '按源片宽高 2× 检查，保持原切点，回片后复核帧率和音轨。' :
          profile.resolutionControl?.mode === 'height' ? '按源画幅把目标短边换算为 SeedVR2 输出高度；提交前会按本镜实际尺寸做 ComfyUI 预检。' :
            profile.resolutionControl ? '可设置增强短边。' : '原始增强尺寸由工作流决定，回片后再核对实际分辨率。');
      if (!profile.resolutionControl) aiResolution.closest('label').hidden = true;
      const checkResponse = await aiFetch('/preflight');
      const check = await checkResponse.json();
      aiEnhancementPreflight = check;
      if (!checkResponse.ok || check.issues > 0) {
        aiStatus.textContent = `工作流预检发现 ${check.issues ?? '未知'} 个阻断问题${check.findings?.length ? `：${check.findings.filter(item => item.kind === 'issue').slice(0, 2).map(item => item.message).join('；')}` : ''}。修复 ComfyUI 图后重启桥接。`;
        aiSubmit.disabled = true;
      } else {
        aiSubmit.disabled = record.verdict !== '通过';
        aiStatus.textContent = `工作流静态预检：${check.nodes} 个节点，${check.verified} 个节点定义可核对，${check.unverified} 个未验证。节点定义可查不代表模型已载入或画质通过。`;
      }
      if (denoiseControl && profile.seedvr2DenoiseDeclared === true) {
        const control = check.parameterControls?.find(item => item.node === denoiseControl.node && item.field === denoiseControl.field &&
          Number.isFinite(item.min) && Number.isFinite(item.max) && item.min <= item.max);
        if (control) {
          denoiseInput.min = String(control.min);
          denoiseInput.max = String(control.max);
          denoiseInput.step = control.type === 'INT' ? '1' : String(control.step || 'any');
          denoiseInput.value = String(denoiseControl.value);
          denoiseLabel.hidden = false;
          denoiseRange.textContent = `ComfyUI 公布范围 ${control.min}–${control.max}${control.step ? `，步长 ${control.step}` : ''}；当前工作流值 ${denoiseControl.value}。只在同镜单变量 A/B 中试，不把数值大小当作质量高低。`;
          denoiseRange.hidden = false;
          if (control.min < control.max) {
            for (const field of [denoisePairA, denoisePairB]) {
              field.min = String(control.min);
              field.max = String(control.max);
              field.step = control.type === 'INT' ? '1' : String(control.step || 'any');
            }
            denoisePairA.value = String(denoiseControl.value);
            let alternate = control.step ? denoiseControl.value + control.step : control.max;
            if (alternate > control.max) alternate = control.step ? denoiseControl.value - control.step : control.min;
            if (alternate < control.min || alternate === denoiseControl.value) alternate = control.min !== denoiseControl.value ? control.min : control.max;
            denoisePairB.value = String(alternate);
            denoisePairPanel.hidden = check.issues > 0 || !Number.isFinite(alternate) || alternate === denoiseControl.value;
          }
        }
      }
      if (record.aiEnhancementJob) {
        try {
          const previous = JSON.parse(record.aiEnhancementJob);
          if (previous?.id && (!shotRelay || previous.options?.scale === 2)) updateAiJob(previous.id);
        } catch { delete record.aiEnhancementJob; save(); }
      }
      const savedPairs = Array.isArray(record.seedvr2DenoisePairs) ? record.seedvr2DenoisePairs : [];
      const latestPair = savedPairs.at(-1);
      if (latestPair) {
        denoisePairStatus.textContent = `已保存一组 A/B · ${latestPair.variants?.A?.denoise} / ${latestPair.variants?.B?.denoise} · ` +
          `${latestPair.variants?.A?.task?.status || '未提交'} / ${latestPair.variants?.B?.task?.status || '未提交'}`;
        for (const variant of ['A', 'B']) {
          const task = latestPair.variants?.[variant]?.task;
          if (task?.id && !['complete', 'failed', 'no_video'].includes(task.status)) updateAiDenoisePair(latestPair.id);
        }
        updateDenoisePairPreview(latestPair.id);
      }
    }
    loadAiProfile().catch(() => {
      if (panel.isConnected && shotRelay) status.textContent = '未能读取 RelayVSR 2× 预设，请确认本地桥接已启用。';
      else if (panel.isConnected && !aiPanel.hidden) aiStatus.textContent = '未能读取增强工作流的预检结果。';
    });
    aiSubmit.disabled = true;
    aiSubmit.onclick = async () => {
      const original = input.files[0];
      const clip = aiClip.files[0];
      const reportFile = aiReportInput.files[0];
      if (!original || original.name !== record.file?.trim() || !clip || !reportFile || reportFile.size > 64 * 1024) {
        aiStatus.textContent = '请选择与通过版本同名的原视频、本镜头 ARC 裁切视频及 64 KiB 以内的 ARC 裁切报告。';
        return;
      }
      aiSubmit.disabled = true;
      aiPreset.disabled = true;
      try {
        if ((Array.isArray(record.seedvr2DenoisePairs) ? record.seedvr2DenoisePairs : []).some(pair =>
          ['A', 'B'].some(variant => pair.variants?.[variant]?.task?.id &&
            !['complete', 'failed', 'no_video'].includes(pair.variants[variant].task.status)))) {
          throw new Error('SeedVR2 denoise A/B 仍有任务运行，请等待两边结束后再提交普通增强。');
        }
        const previousTask = JSON.parse(record.aiEnhancementJob || 'null');
        if (previousTask?.id && !['complete', 'failed', 'no_video'].includes(previousTask.status || '')) {
          throw new Error('上一增强任务仍在排队或处理中，请等待终态后再提交，避免重复占用算力。');
        }
        if (shotRelay) projectFiles.shotReplacement(data, episode, shot);
        const checkResponse = await aiFetch('/preflight');
        const check = await checkResponse.json();
        if (!checkResponse.ok || check.issues > 0 || !/^[a-f0-9]{64}$/.test(check.schemaSha256 || ''))
          throw new Error('ComfyUI 增强工作流预检未通过或缺少节点定义指纹，未上传文件。');
        aiStatus.textContent = '正在校验原视频和裁切文件指纹…';
        const source = await sourceIdentity(original);
        const media = await fullIdentity(clip);
        const report = JSON.parse(await reportFile.text());
        const { duration, width, height } = await window.arcProductionQuality.readVideoFile(clip);
        const start = Number(record.inPoint), end = Number(record.outPoint);
        if (!Number.isFinite(start) || !Number.isFinite(end) || Math.abs(duration - (end - start)) > .12 ||
            report?.schema !== 'arc-ai-input-v1' || report.shot?.id !== `E${String(episode + 1).padStart(2, '0')}-S${String(shot + 1).padStart(2, '0')}` ||
            report.shot?.version !== record.version || report.shot?.start !== start || report.shot?.end !== end ||
            report.source?.sha256 !== source.sha256 || report.media?.sha256 !== media.sha256 || report.media?.name !== media.name ||
            report.media?.size !== media.size || Math.abs(report.media?.duration - duration) > .12) {
          throw new Error('ARC 裁切报告、原片、视频时长或当前镜头版本不匹配，请在 ARC 重新导出本镜头。');
        }
        const profileResponse = await aiFetch();
        const profile = await profileResponse.json();
        if (!profileResponse.ok) throw new Error(profile.error || 'AI 增强工作流不可用。');
        if (!/^[a-f0-9]{64}$/.test(profile.providerFingerprint || '')) throw new Error('缺少 ComfyUI 服务端指纹，请刷新工作流配置。');
        if (profile.scale === 2 && (width !== report.media.width || height !== report.media.height ||
            !/^[1-9]\d*\/[1-9]\d*$/.test(report.media.fps || '') || !Number.isSafeInteger(report.media.frames) || report.media.frames < 1)) {
          throw new Error('裁切片尺寸、帧率或实测帧数与 ARC 报告不符，请重新裁切。');
        }
        const options = { shortEdge: profile.resolutionControl ? Number(aiResolution.value) : null,
          ...(profile.resolutionControl?.mode === 'height' ? { nativeResolution: height > width ?
            Math.round(Number(aiResolution.value) * height / width) : Number(aiResolution.value) } : {}),
          resolution: String(aiResolution.value), fps: panel.querySelector('[data-fps]').value,
          workflowSha256: profile.sha256, preflightSchemaSha256: check.schemaSha256,
          ...(denoiseControl && !denoiseLabel.hidden ? { denoise: Number(denoiseInput.value) } : {}),
          ...(profile.scale === 2 ? { scale: 2 } : {}) };
        if (denoiseControl && !denoiseLabel.hidden && !denoiseInput.checkValidity()) {
          throw new Error('SeedVR2 denoise 超出 ComfyUI 节点公布范围，请修正参数后重提。');
        }
        const nextRetryBasis = { source,
          media: { ...media, duration: report.media.duration,
            ...(profile.scale === 2 || profile.resolutionControl?.mode === 'height' ? { width, height } : {}),
            ...(profile.scale === 2 ? { fps: report.media.fps, frames: report.media.frames } : {}) },
          shot: { id: `E${String(episode + 1).padStart(2, '0')}-S${String(shot + 1).padStart(2, '0')}`,
            version: record.version, start, end },
          options, providerFingerprint: profile.providerFingerprint };
        const sameRetryBasis = window.arcProductionProject.sameAiEnhancementRetryBasis(previousTask, nextRetryBasis);
        const task = { schema: 'arc-ai-enhancement-task-v1', id: crypto.randomUUID(), source,
          workflowDeclaration: profile.workflowDeclaration || null,
          media: nextRetryBasis.media, shot: nextRetryBasis.shot, options,
          providerFingerprint: profile.providerFingerprint,
          retryCount: sameRetryBasis ? (Number.isSafeInteger(previousTask.retryCount) ? previousTask.retryCount + 1 : 1) : 0 };
        if (task.retryCount > 100) throw new Error('同一镜头已达 100 次提交上限，请检查工作流和素材后再开始新基准。');
        task.attemptHistory = sameRetryBasis ? [...(Array.isArray(previousTask.attemptHistory) ? previousTask.attemptHistory : []), {
          taskId: previousTask.id, status: previousTask.status,
          sourceSha256: source.sha256, mediaSha256: media.sha256, shotVersion: record.version,
          workflowSha256: previousTask.options.workflowSha256, providerFingerprint: previousTask.providerFingerprint,
          options: previousTask.options,
          queueMs: Number.isFinite(previousTask.runtime?.queueMs) ? previousTask.runtime.queueMs : null,
          executionMs: Number.isFinite(previousTask.runtime?.executionMs) ? previousTask.runtime.executionMs : null,
          queueSource: previousTask.runtime?.queueSource === 'comfy-history-timestamps' ? 'comfy-history-timestamps' : null,
          executionSource: previousTask.runtime?.executionSource === 'comfy-history-timestamps' ? 'comfy-history-timestamps' : null,
          bridgeMs: Number.isFinite(previousTask.runtime?.bridgeMs) ? previousTask.runtime.bridgeMs : null,
          bridgeSource: previousTask.runtime?.bridgeSource === 'local-bridge-observation' ? 'local-bridge-observation' : null,
          gpuKernelTime: previousTask.runtime?.gpuKernelTime === false ? false : null
        }] : [];
        if (!panel.isConnected || input.files[0] !== original || aiClip.files[0] !== clip || aiReportInput.files[0] !== reportFile) return;
        if (shotRelay && (profile.scale !== 2 || !matchesCurrentCut(task))) throw new Error('只能对当前通过版的原切段做 RelayVSR 2×。');
        const form = new FormData();
        form.append('task', JSON.stringify(task));
        form.append('video', clip, clip.name);
        form.append('report', reportFile, reportFile.name);
        aiStatus.textContent = '本地指纹核验通过，正在把本镜头上传到 ComfyUI…';
        const response = await aiFetch('', { method: 'POST', body: form });
        const accepted = await response.json();
        if (!response.ok) throw new Error(accepted.error || 'ComfyUI 提交失败。');
        task.status = accepted.status || 'queued';
        record.aiEnhancementJob = JSON.stringify(task);
        download(`${task.shot.id}-AI增强任务.json`, task);
        if (!save()) aiStatus.textContent = '任务已提交，但任务编号未能保存到项目。请先记下任务编号后再离开此页。';
        else aiStatus.textContent = `任务已提交 · ${accepted.status}。原通过版本保持不变。`;
        relayRawPreview?.dispose();
        relayRawPreview = undefined;
        aiResult.replaceChildren();
        updateAiJob(task.id);
      } catch (error) { aiStatus.textContent = error.message; }
      finally { aiSubmit.disabled = record.verdict !== '通过'; aiPreset.disabled = shotRelay; }
    };
    return panel;
  }

  function storyboardInputs(record) {
    const group = document.createElement('section');
    group.className = 'production-history production-storyboard-inputs';
    group.innerHTML = '<h3>动态分镜预演</h3><p>可先跳过：预演暂按 3 秒；正式审片前再确认时长。关键画面是构图参考，可之后在参考库补充。</p>' +
      '<div class="production-metadata"><label>镜头时长（秒）<input type="number" min="0.25" max="120" step="0.01" placeholder="暂用 3 秒"></label>' +
      '<label>关键画面（建议）<select></select></label></div>';
    const duration = group.querySelector('input');
    duration.value = record.duration || '';
    duration.oninput = () => {
      record.duration = duration.value;
      save();
    };
    const picture = group.querySelector('select');
    picture.add(new Option('暂不指定关键画面（可之后补）', ''));
    for (const asset of data.assets || []) {
      if (asset.kind === '分镜关键画面') picture.add(new Option(`${asset.name} · ${asset.revision}`, asset.id));
    }
    picture.value = record.frameAsset || '';
    picture.onchange = () => {
      record.frameAsset = picture.value;
      save();
    };
    return group;
  }

  function assetCard(asset) {
    const card = document.createElement('article');
    card.className = 'production-asset-card';
    if (asset.image) {
      const image = document.createElement('img');
      image.src = asset.image;
      image.alt = asset.name;
      image.loading = 'lazy';
      card.append(image);
    }
    const identity = document.createElement('small');
    identity.textContent = `${asset.kind} · ${asset.id} · ${asset.revision}`;
    const title = document.createElement('b');
    title.textContent = asset.name;
    card.append(identity, title);
    if (asset.notes) {
      const details = document.createElement('p');
      details.textContent = asset.notes;
      card.append(details);
    }
    return card;
  }

  function assetLibrary() {
    const project = data;
    const section = document.createElement('section');
    section.className = 'production-history production-library';
    section.innerHTML = `
      <h3>新增参考版本</h3>
      <div class="production-metadata">
        <label>类别<select></select></label>
        <label>名称<input data-field="name" placeholder="例如 主角常服"></label>
        <label>版本<input data-field="revision" placeholder="例如 v01"></label>
        <label>参考图（可选）<input type="file" accept="image/png,image/jpeg,image/webp"></label>
      </div>
      <label>使用说明<textarea rows="2" placeholder="例如 侧逆光、保留左侧刘海和领口徽记"></textarea></label>
      <button type="button" class="production-action">加入参考库</button>
      <output role="status"></output>
      <label>查找参考<input type="search" placeholder="名称、类别或版本"></label>
      <div class="production-assets"></div>`;
    const type = section.querySelector('select');
    const output = section.querySelector('output');
    const grid = section.querySelector('.production-assets');
    const search = section.querySelector('[type="search"]');
    const add = section.querySelector('button');
    const name = section.querySelector('[data-field="name"]');
    const revision = section.querySelector('[data-field="revision"]');
    const notes = section.querySelector('textarea');
    const imageInput = section.querySelector('[type="file"]');
    for (const kind of projectFiles.assetKinds) type.add(new Option(kind));
    function showAssets() {
      const query = search.value.trim().toLowerCase();
      const assets = (project.assets || []).filter(asset =>
        [asset.kind, asset.name, asset.revision, asset.id].some(value => value.toLowerCase().includes(query)));
      grid.replaceChildren(...assets.map(assetCard));
      if (!assets.length) grid.textContent = query ? '没有符合条件的参考。' : '还没有参考素材。';
    }
    search.oninput = showAssets;
    add.onclick = async () => {
      const fields = { kind: type.value, name: name.value, revision: revision.value, notes: notes.value };
      const file = imageInput.files[0];
      add.disabled = true;
      try {
        if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 900_000)) {
          throw new Error('请选择 900 KB 以内的 PNG、JPEG 或 WebP 参考图。');
        }
        fields.image = file ? await readReferenceImage(file) : '';
        if (project !== data || !section.isConnected) return;
        const previous = project.assets;
        const asset = projectFiles.addAsset(project, fields);
        if (!save()) {
          if (previous === undefined) delete project.assets;
          else project.assets = previous;
          throw new Error('本机没有保存这个参考版本，请检查浏览器存储空间。');
        }
        output.textContent = `已加入 ${asset.name} · ${asset.revision}。`;
        imageInput.value = '';
        showAssets();
      } catch (error) {
        output.textContent = error.message;
      } finally {
        add.disabled = false;
      }
    };
    showAssets();
    return section;
  }

  async function readReferenceImage(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('参考图无法解码，请选择可正常打开的 PNG、JPEG 或 WebP 文件。');
    }
    bitmap.close();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('参考图读取失败，请重新选择。'));
      reader.readAsDataURL(file);
    });
  }

  function shotReferences(record, editable, onChange) {
    const section = document.createElement('section');
    section.className = 'production-history';
    section.innerHTML = '<h3>本镜美术参考</h3><p data-reference-summary role="status"></p>' +
      (editable ? '<div class="reference-filters"><label>类别<select data-kind></select></label>' +
        '<label>搜索名称或版本<input type="search" data-search placeholder="例如 主角常服 v03"></label></div>' : '') +
      '<div class="production-assets"></div>';
    const grid = section.querySelector('.production-assets');
    const assets = data.assets || [];
    const summary = section.querySelector('[data-reference-summary]');
    const selectedIds = () => new Set(record.refs || []);
    const compare = document.createElement('dialog');
    compare.className = 'reference-compare-dialog';
    compare.setAttribute('aria-labelledby', 'reference-compare-title');
    compare.innerHTML = `<h3 id="reference-compare-title">参考版本对比</h3>
      <label>对照版本<select></select></label>
      <div class="production-assets"></div>
      <div class="production-picker">
        <button type="button" data-use-reference class="production-action">换成本镜参考</button>
        <button type="button" data-close-reference>关闭</button>
      </div>
      <output role="status"></output>`;
    if (editable) section.append(compare);
    const compareChoice = compare.querySelector('select');
    const compareCards = compare.querySelector('.production-assets');
    const compareStatus = compare.querySelector('output');
    const useReference = compare.querySelector('[data-use-reference]');
    compare.querySelector('[data-close-reference]').onclick = () => compare.close();
    const referenceStatus = document.createElement('output');
    referenceStatus.setAttribute('role', 'status');
    if (editable) section.append(referenceStatus);
    let from;

    function setReferences(refs) {
      const prior = { refs: record.refs, verdict: record.verdict };
      record.refs = refs;
      if (onChange() !== false) return;
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete record[key];
        else record[key] = value;
      }
      throw new Error('未能保存更换，原有参考已保留。');
    }

    function showComparison() {
      const next = assets.find(asset => asset.id === compareChoice.value);
      if (!from || !next) return;
      const cards = [
        ['本镜当前版本', from],
        [selectedIds().has(next.id) ? '对照版本 · 已绑定本镜' : '对照版本', next]
      ].map(([title, item]) => {
        const card = assetCard(item);
        const heading = document.createElement('strong');
        heading.textContent = title;
        card.prepend(heading);
        return card;
      });
      compareCards.replaceChildren(...cards);
    }
    compareChoice.onchange = showComparison;
    useReference.onclick = () => {
      try {
        const id = compareChoice.value;
        setReferences(projectFiles.replacementReferences(data, record, from?.id, id));
        compare.close();
        showAssets();
        const selected = assets.find(item => item.id === id);
        referenceStatus.textContent = `本镜已换用 ${selected.name} · ${selected.revision}。请核对本镜提示词和审片。`;
        [...grid.querySelectorAll('[data-asset-id]')].find(card => card.dataset.assetId === id)?.querySelector('button')?.focus();
      } catch (error) { compareStatus.textContent = error.message; }
    };
    function openComparison(asset, versions) {
      from = asset;
      compareStatus.textContent = '';
      compareChoice.replaceChildren(...versions.map(item => new Option(item.revision, item.id)));
      showComparison();
      compare.showModal();
      compareChoice.focus();
    }
    function allowCompare(card, asset, selected) {
      card.querySelector('[data-compare-version]')?.remove();
      if (!selected) return;
      const versions = assets.filter(item =>
        item.id !== asset.id && item.kind === asset.kind && item.name === asset.name)
        .sort((a, b) => b.revision.localeCompare(a.revision, 'zh-Hans-CN', { numeric: true }));
      if (!versions.length) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'production-action';
      button.dataset.compareVersion = '';
      button.textContent = '对比版本';
      button.onclick = () => openComparison(asset, versions);
      card.append(button);
    }
    function updateSummary() {
      const selected = assets.filter(asset => selectedIds().has(asset.id));
      const groups = new Map();
      for (const item of selected) {
        const key = `${item.kind}\u0000${item.name}`;
        groups.set(key, [...(groups.get(key) || []), item.revision]);
      }
      const conflicts = [...groups.values()].filter(revisions => new Set(revisions).size > 1).length;
      summary.textContent = editable ?
        `已绑定 ${selected.length} 个版本。引用角色/场景时请确认类别和版本；同名多版本 ${conflicts} 组。` :
        selected.length ? `当前镜头引用 ${selected.length} 个美术版本${conflicts ? ` · 同名多版本 ${conflicts} 组，请核对` : ''}。` :
          '此镜头没有绑定美术参考版本。';
      summary.dataset.conflict = conflicts ? 'true' : 'false';
    }
    const kindFilter = section.querySelector('[data-kind]');
    const search = section.querySelector('[data-search]');
    if (editable) {
      kindFilter.add(new Option('全部类别', ''));
      for (const kind of projectFiles.assetKinds.filter(kind => assets.some(asset => asset.kind === kind))) {
        kindFilter.add(new Option(kind, kind));
      }
    }
    function showAssets() {
      const selected = selectedIds();
      const query = search?.value.trim().toLocaleLowerCase() || '';
      const list = assets.filter(asset =>
        (!kindFilter?.value || asset.kind === kindFilter.value) &&
        [asset.kind, asset.name, asset.revision, asset.id].some(value => value.toLocaleLowerCase().includes(query)) &&
        (editable || selected.has(asset.id)));
      list.sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
        a.kind.localeCompare(b.kind, 'zh-Hans-CN') || a.name.localeCompare(b.name, 'zh-Hans-CN') ||
        b.revision.localeCompare(a.revision, 'zh-Hans-CN', { numeric: true }));
      grid.replaceChildren();
      for (const asset of list) {
        const isSelected = selected.has(asset.id);
        const card = assetCard(asset);
        card.dataset.selected = isSelected ? 'true' : 'false';
        card.dataset.assetId = asset.id;
        if (editable) {
          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = isSelected;
          const marker = document.createElement('span');
          marker.textContent = isSelected ? '本镜已绑定' : '用于本镜';
          checkbox.onchange = () => {
            const refs = new Set(record.refs || []);
            if (checkbox.checked) refs.add(asset.id);
            else refs.delete(asset.id);
            try {
              setReferences([...refs]);
              referenceStatus.textContent = '';
              card.dataset.selected = checkbox.checked ? 'true' : 'false';
              marker.textContent = checkbox.checked ? '本镜已绑定' : '用于本镜';
              allowCompare(card, asset, checkbox.checked);
              updateSummary();
            } catch (error) {
              checkbox.checked = !checkbox.checked;
              referenceStatus.textContent = error.message;
            }
          };
          label.append(checkbox, marker);
          card.append(label);
          allowCompare(card, asset, isSelected);
        }
        grid.append(card);
      }
      if (!grid.childElementCount) grid.textContent = editable ?
        (assets.length ? '没有符合筛选条件的参考版本。' : '先在美术参考库登记角色、场景或道具版本。') :
        '需要使用参考时，回「分镜」绑定；没有参考时可以继续审片。';
      updateSummary();
    }
    if (editable) {
      kindFilter.onchange = showAssets;
      search.oninput = showAssets;
    }
    showAssets();
    return section;
  }

  function videoPreview(title, addNote, remote) {
    const panel = document.createElement('div');
    panel.innerHTML = '<label><span></span><input type="file" accept="video/*"></label><video controls hidden preload="metadata"></video><output role="status"></output>';
    panel.querySelector('span').textContent = title;
    const player = panel.querySelector('video');
    const output = panel.querySelector('output');
    const input = panel.querySelector('input');
    let url, selected;
    const link = document.createElement('a');
    link.className = 'preview-download';
    link.textContent = '下载回传原视频';
    link.hidden = true;
    const marker = document.createElement('button');
    if (addNote) {
      marker.type = 'button';
      marker.className = 'production-action';
      marker.textContent = '在此时刻写批注';
      marker.disabled = true;
      marker.onclick = () => addNote(player.currentTime);
      player.onloadedmetadata = () => { marker.disabled = false; };
      panel.append(marker);
    }
    panel.selectedSource = () => selected;
    panel.refreshSource = () => {
      const next = input.files[0] || remote?.();
      if (selected === next || (selected?.url && selected.url === next?.url)) return false;
      selected = next;
      marker.disabled = true;
      if (url) {
        URL.revokeObjectURL(url);
        mediaUrls.delete(url);
        url = undefined;
      }
      const file = selected instanceof File ? selected : null;
      player.removeAttribute('src');
      player.hidden = !selected;
      link.hidden = !selected?.url;
      if (selected?.url) {
        link.href = selected.url;
        link.download = selected.name;
      } else link.removeAttribute('href');
      output.textContent = selected?.url ? `${selected.testFixture ? '本地测试素材' : '回传视频'} · ${selected.name}` : file?.name || '';
      if (file) {
        url = URL.createObjectURL(file);
        mediaUrls.add(url);
        player.src = url;
      } else if (selected?.url) player.src = selected.url;
      else player.load();
      return true;
    };
    input.onchange = panel.refreshSource;
    player.onerror = () => {
      marker.disabled = true;
      output.textContent = selected?.url ? '回传视频暂不可用。可重新打开生成任务，或选入已保存的原视频。' :
        '浏览器无法播放此文件。';
    };
    if (remote) { panel.append(link); panel.refreshSource(); }
    return panel;
  }

  function candidateHistory(record) {
    const group = document.createElement('section');
    group.className = 'production-history';
    group.innerHTML = `
      <h3>候选版本</h3>
      <p>载入只恢复版本资料，不会把旧审片结论带到新候选。视频文件不在项目备份内；载入后请选入与文件名及指纹相符的视频再复核。</p>
      <button type="button" class="production-action">保留当前版本</button>
      <ul></ul><output role="status"></output>`;
    const feedback = group.querySelector('output');
    group.querySelector('button').onclick = () => {
      try {
        const saved = projectFiles.saveCandidate(record);
        save();
        list();
        feedback.textContent = `已保留 ${saved.version} 的候选记录。`;
      } catch (error) {
        feedback.textContent = error.message;
      }
    };
    function list() {
      const items = group.querySelector('ul');
      items.replaceChildren();
      for (const [index, candidate] of (record.candidates || []).entries()) {
        const item = document.createElement('li');
        const text = document.createElement('span');
        text.textContent = [candidate.version, candidate.file || '未关联文件', candidate.verdict || '待审',
          candidate.issue ? `问题：${candidate.issue}` : '无返修备注'].filter(Boolean).join(' · ');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'production-action';
        button.textContent = '载入为待审';
        button.onclick = () => {
          if (!window.confirm(`载入 ${candidate.version}（${candidate.file || '未关联视频文件'}）并替换当前审片表单？载入后请重新选入对应视频；旧审片结论不会沿用，此版本将从待审重新验收。`)) return;
          projectFiles.loadCandidate(record, index);
          render();
          save();
        };
        item.append(text, button);
        items.append(item);
      }
    }
    list();
    return group;
  }

  function scriptStructurePanel(episode, templateFields) {
    const panel = document.createElement('section');
    panel.className = 'production-history script-structure-panel';
    panel.innerHTML = `
      <h3>场次与对白结构建议</h3>
      <p>只识别明确的场次标题和“角色：对白”行。原始剧情正文不会改变；未识别内容只展示，不会自动搬动。</p>
      <details class="script-import-history" data-script-import-history hidden>
        <summary data-script-import-history-summary>剧本导入来源记录</summary>
        <p>来源记录只保存文件名、SHA-256、时间和分集操作，不额外保存原稿副本；已选入的正文仍保存在对应分集。</p>
        <ol data-script-import-history-list></ol>
      </details>
      <button type="button" class="production-action" data-structure-analyze>分析当前剧情</button>
      <output role="status" data-structure-status></output>
      <div data-structure-results hidden>
        <p data-structure-counts></p>
        <div class="script-structure-preview">
          <section><h4>场次标题</h4><pre data-structure-scenes></pre></section>
          <section><h4>明确对白候选</h4><pre data-structure-dialogue></pre></section>
        </div>
        <details><summary data-structure-candidate-summary>待确认人物提示行</summary><pre data-structure-candidates></pre></details>
        <details><summary data-structure-unclassified-summary>未识别原稿行</summary><pre data-structure-unclassified></pre></details>
        <div class="script-structure-actions">
          <div class="script-structure-action-row">
            <label><input type="checkbox" data-structure-use-scenes>写入场次索引</label>
            <select aria-label="场次索引写入方式" data-structure-scenes-mode><option value="append">追加</option><option value="replace">替换</option></select>
          </div>
          <div class="script-structure-action-row">
            <label><input type="checkbox" data-structure-use-dialogue>写入明确对白</label>
            <select aria-label="对白写入方式" data-structure-dialogue-mode><option value="append">追加</option><option value="replace">替换</option></select>
          </div>
          <label class="script-structure-candidates"><input type="checkbox" data-structure-use-candidates>同时纳入待确认人物提示行</label>
          <button type="button" class="production-action" data-structure-apply disabled>写入所选草案</button>
        </div>
      </div>`;
    const results = panel.querySelector('[data-structure-results]');
    const status = panel.querySelector('[data-structure-status]');
    const useScenes = panel.querySelector('[data-structure-use-scenes]');
    const useDialogue = panel.querySelector('[data-structure-use-dialogue]');
    const useCandidates = panel.querySelector('[data-structure-use-candidates]');
    const apply = panel.querySelector('[data-structure-apply]');
    const analyze = panel.querySelector('[data-structure-analyze]');
    const history = (Array.isArray(data.scriptImportHistory) ? data.scriptImportHistory : []).slice(-10).reverse();
    const historyPanel = panel.querySelector('[data-script-import-history]');
    if (history.length) {
      historyPanel.hidden = false;
      panel.querySelector('[data-script-import-history-summary]').textContent = `剧本导入来源记录 · 最近 ${history.length} / 共 ${data.scriptImportHistory.length} 次`;
      const list = panel.querySelector('[data-script-import-history-list]');
      list.replaceChildren(...history.map(item => {
        const row = document.createElement('li');
        const actionNames = { keep: '保留', replace: '替换正文', append: '追加正文', title: '补集名', preface: '写入前言' };
        const mapping = item.mappings.map(entry =>
          `${entry.sourceEpisode === null ? '未分集' : `原第 ${number(entry.sourceEpisode - 1)} 集`} → 第 ${number(entry.targetEpisode - 1)} 集（${actionNames[entry.action]}）`).join('；');
        row.textContent = `${new Date(item.importedAt).toLocaleString('zh-CN')} · ${item.fileName} · SHA-256 ${item.sha256.slice(0, 12)}… · ${mapping}`;
        return row;
      }));
    }
    let analysis = null;
    const candidateText = () => analysis?.dialogueCandidates.map(item =>
      `${item.speaker}（待确认）：${item.text} [原稿第 ${item.line}–${item.nextLine} 行]`).join('\n') || '';
    const selectedDialogue = () => [analysis?.dialogueText || '', useCandidates.checked ? candidateText().split('\n').map(line => line.replace(/ \[原稿第 .*$/u, '')).join('\n') : '']
      .filter(Boolean).join('\n');
    const refresh = () => {
      const selected = useScenes.checked && Boolean(analysis?.sceneOutline) || useDialogue.checked && Boolean(selectedDialogue());
      const sceneExisting = episode.pages.sceneOutline || '';
      const dialogueExisting = episode.pages.dialogue || '';
      const duplicateScene = useScenes.checked && panel.querySelector('[data-structure-scenes-mode]').value === 'append' &&
        sceneExisting.split(/\n\s*\n/u).some(block => block.trim() === analysis?.sceneOutline.trim());
      const dialogueAddition = selectedDialogue();
      const existingDialogueLines = dialogueExisting.split(/\n+/u).map(line => line.trim()).filter(Boolean);
      const additionLines = dialogueAddition.split(/\n+/u).map(line => line.trim()).filter(Boolean);
      const duplicateDialogue = useDialogue.checked && panel.querySelector('[data-structure-dialogue-mode]').value === 'append' &&
        additionLines.length > 0 && additionLines.every(line => existingDialogueLines.includes(line));
      apply.disabled = !selected || duplicateScene || duplicateDialogue;
      if (duplicateScene || duplicateDialogue) status.textContent = '所选草案已存在于目标栏中；为防止重复追加，请取消该项或改用替换。';
      else if (!selected && analysis) status.textContent = '勾选要写入的草案后才能保存。';
      else status.textContent = '';
    };
    analyze.onclick = () => {
      try { analysis = window.arcScriptImport.analyzeStructure(episode.pages.story || ''); }
      catch (error) { analysis = null; results.hidden = true; status.textContent = error.message || '无法分析当前原稿。'; return; }
      results.hidden = false;
      useScenes.checked = false;
      useDialogue.checked = false;
      useCandidates.checked = false;
      useScenes.disabled = !analysis.sceneOutline;
      useDialogue.disabled = !analysis.dialogueText && !analysis.dialogueCandidates.length;
      useCandidates.disabled = !analysis.dialogueCandidates.length;
      panel.querySelector('[data-structure-scenes-mode]').value = episode.pages.sceneOutline?.trim() ? 'append' : 'replace';
      panel.querySelector('[data-structure-dialogue-mode]').value = episode.pages.dialogue?.trim() ? 'append' : 'replace';
      panel.querySelector('[data-structure-scenes]').textContent = analysis.sceneOutline || '未识别到明确场次标题。';
      panel.querySelector('[data-structure-dialogue]').textContent = analysis.dialogueText || '未识别到带角色前缀的对白。';
      panel.querySelector('[data-structure-candidates]').textContent = candidateText() || '无待确认人物提示行。';
      panel.querySelector('[data-structure-candidate-summary]').textContent = `待确认人物提示行 · ${analysis.stats.dialogueCandidates}`;
      panel.querySelector('[data-structure-unclassified]').textContent = analysis.unclassified.slice(0, 60)
        .map(item => `第 ${item.line} 行 · ${item.text}`).join('\n') +
        (analysis.unclassified.length > 60 ? `\n…另有 ${analysis.unclassified.length - 60} 行` : '') || '无';
      panel.querySelector('[data-structure-unclassified-summary]').textContent = `未识别为场次标题/明确对白的原稿行 · ${analysis.stats.unclassified}`;
      panel.querySelector('[data-structure-counts]').textContent =
        `识别到 ${analysis.stats.scenes} 个场次标题、${analysis.stats.dialogue} 条明确对白、${analysis.stats.dialogueCandidates} 条待确认对白；原稿正文仍完整保留。`;
      status.textContent = '识别结果是格式建议，不代表语义已核实。检查下面内容后，再勾选要写入的辅助字段。';
      refresh();
    };
    for (const control of panel.querySelectorAll('input, select')) control.onchange = refresh;
    apply.onclick = () => {
      if (!analysis || apply.disabled) return;
      const beforeScene = episode.pages.sceneOutline;
      const beforeDialogue = episode.pages.dialogue;
      const sceneAddition = analysis.sceneOutline;
      const dialogueAddition = selectedDialogue();
      if (useScenes.checked) {
        const mode = panel.querySelector('[data-structure-scenes-mode]').value;
        episode.pages.sceneOutline = mode === 'append' && beforeScene?.trim() ? `${beforeScene.trimEnd()}\n\n${sceneAddition}` : sceneAddition;
      }
      if (useDialogue.checked) {
        const mode = panel.querySelector('[data-structure-dialogue-mode]').value;
        episode.pages.dialogue = mode === 'append' && beforeDialogue?.trim() ? `${beforeDialogue.trimEnd()}\n${dialogueAddition}` : dialogueAddition;
      }
      if (!save()) {
        if (beforeScene === undefined) delete episode.pages.sceneOutline; else episode.pages.sceneOutline = beforeScene;
        if (beforeDialogue === undefined) delete episode.pages.dialogue; else episode.pages.dialogue = beforeDialogue;
        status.textContent = '浏览器存储失败，草案未写入；原有内容已保留。';
        apply.disabled = false;
        return;
      }
      const sceneField = templateFields.get('sceneOutline');
      const dialogueField = templateFields.get('dialogue');
      if (sceneField) { sceneField.value = episode.pages.sceneOutline || ''; sceneField.closest('details')?.setAttribute('open', ''); }
      if (dialogueField) dialogueField.value = episode.pages.dialogue || '';
      lastScriptImportUndo = null;
      root.querySelector('.script-import-undo')?.remove();
      status.textContent = `${[useScenes.checked ? '场次索引' : '', useDialogue.checked ? '对白草案' : ''].filter(Boolean).join('和')}已写入并保存；原始剧情正文未修改。`;
      apply.disabled = true;
    };
    return panel;
  }

  function save() {
    if (lastScriptImportUndo && JSON.stringify(data) !== lastScriptImportUndo.afterStored) {
      lastScriptImportUndo = null;
      root.querySelector('.script-import-undo')?.remove();
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
      storageError = false;
    } catch {
      storageError = true;
    }
    const status = root.querySelector('[data-save-status]');
    if (status) status.textContent = storageError ?
      '保存失败。当前页面仍保留你的输入。' : '已保存到当前浏览器';
    if (tab === 'review') {
      clearTimeout(workflowRouteTimer);
      workflowRouteTimer = setTimeout(renderWorkflowRoute, 160);
    }
    refreshShotContext?.();
    return !storageError;
  }

  function renderWorkflowRoute() {
    const host = root.querySelector('.workflow-route');
    if (!host) return;
    const route = window.arcProductionRoute.state(workspace, tab);
    const navigate = step => window.dispatchEvent(new CustomEvent('arc-production-route', {
      detail: { workspace: step.workspace, tab: step.tab, shot: Number.isInteger(step.index) ? step.index : shotIndex }
    }));
    const copy = document.createElement('div');
    copy.className = 'workflow-route-copy';
    if (!route) {
      const title = document.createElement('b');
      title.textContent = '辅助助手 · 可随时调用';
      const note = document.createElement('span');
      note.textContent = '助手不属于必经制作步骤，不会替你自动改稿或通过审片。';
      copy.append(title, note);
      const returnStep = window.arcProductionRoute.state(workspace, lastWorkflowTab[workspace]);
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'workflow-route-next';
      back.textContent = `返回主流程：${returnStep.current.title}`;
      back.onclick = () => navigate(returnStep.current);
      host.replaceChildren(copy, back);
      return;
    }

    const label = document.createElement('span');
    label.className = 'workflow-route-label';
    const phases = [
      { title: '剧本与连续性', includes: step => step.workspace === 'script' },
      { title: '视觉与分镜', includes: step => step.workspace === 'video' && ['art', 'assets', 'board', 'animatic', 'camera'].includes(step.tab) },
      { title: '生成与审片', includes: step => step.workspace === 'video' && ['generation', 'review'].includes(step.tab) },
      { title: '剪辑与交付', includes: step => step.workspace === 'edit' }
    ];
    const phaseIndex = phases.findIndex(phase => phase.includes(route.current));
    label.textContent = `制作阶段 · ${phaseIndex + 1} / ${phases.length} · ${phases[phaseIndex].title}`;
    const title = document.createElement('b');
    title.textContent = `${route.current.studio}：${route.current.title}`;
    const note = document.createElement('span');
    note.className = 'workflow-route-note';
    note.textContent = '这里只标记当前位置，不代表内容已验收；审片与剪辑交接仍按本集实际状态校验。';
    copy.append(label, title, note);
    const controls = document.createElement('div');
    controls.className = 'workflow-route-controls';
    if (route.previous) {
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'workflow-route-previous';
      previous.textContent = `← ${route.previous.title}`;
      previous.setAttribute('aria-label', `上一步：${route.previous.studio}，${route.previous.title}`);
      previous.onclick = () => navigate(route.previous);
      controls.append(previous);
    }
    if (tab === 'review') {
      const episode = window.arcOverview.describe(data, episodeIndex);
      const action = window.arcProductionRoute.reviewAction(episode.rows, shotIndex);
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'workflow-route-next';
      if (action.type === 'next-shot') {
        next.textContent = `下一待办：${action.row.id} · ${action.row.action} →`;
        next.setAttribute('aria-label', `下一待办镜头 ${action.row.id}：${action.row.action}，${action.row.reason}`);
        next.onclick = () => navigate(action.target);
        note.textContent = `${action.row.label}：${String(action.row.reason).replace(/[。；; ]+$/u, '')}。处理后再回到本集镜头进度。`;
      } else if (action.type === 'assembly') {
        next.textContent = '现有镜头均可交接 · 检查剪辑清单 →';
        next.setAttribute('aria-label', '现有镜头已通过交接校验，打开剪辑清单');
        next.onclick = () => navigate(action.target);
        note.textContent = '当前已有镜头均通过交接校验；整集时长与剧情完整度仍需在总览和剪辑中确认。';
      } else if (action.type === 'current-shot-action') {
        next.textContent = `继续当前镜头：${action.row.action} →`;
        next.setAttribute('aria-label', `继续处理当前镜头 ${action.row.id}：${action.row.action}，${action.row.reason}`);
        next.onclick = () => navigate(action.target);
        note.textContent = `${action.row.id} · ${action.row.label}：${String(action.row.reason).replace(/[。；; ]+$/u, '')}。先完成这项，再回到审片。`;
      } else if (action.type === 'current-shot') {
        next.disabled = true;
        next.textContent = `本镜待处理：${action.row.action}`;
        next.setAttribute('aria-label', `当前镜头 ${action.row.id} 尚待处理：${action.row.reason}`);
        note.textContent = `${action.row.id} · ${action.row.label}：${String(action.row.reason).replace(/[。；; ]+$/u, '')}。先完成本镜审片，再继续本集。`;
      } else {
        next.disabled = true;
        next.textContent = '暂时无法判断本集下一步';
        note.textContent = '请返回工作台总览检查本集镜头状态。';
      }
      controls.append(next);
    } else if (route.next) {
      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'workflow-route-next';
      next.textContent = `下一步：${route.next.title} →`;
      next.setAttribute('aria-label', `下一步：${route.next.studio}，${route.next.title}`);
      next.onclick = () => navigate(route.next);
      controls.append(next);
    }
    host.replaceChildren(copy, controls);
  }

  function showOverview(open) {
    overviewRuntime?.dispose();
    overviewOpenWorkspace = open;
    const host = document.querySelector('#productionOverview');
    overviewRuntime = window.arcOverview.mount(host, data, episodeIndex, {
      open,
      save,
      addShotFromQuote(quote) {
        const episode = data.episodes[episodeIndex];
        const shot = { scriptAnchor: quote };
        const anchor = projectFiles.scriptAnchorStatus(shot, episode.pages);
        if (!anchor.ready) throw new Error(anchor.reason);
        const replaceEmpty = episode.shots.length === 1 && !Object.keys(episode.shots[0]).length;
        const index = replaceEmpty ? 0 : episode.shots.length;
        if (replaceEmpty) episode.shots[0] = shot;
        else {
          episode.shots.push(shot);
          episode.shotOrder?.push(index);
        }
        if (!save()) {
          if (replaceEmpty) episode.shots[0] = {};
          else {
            episode.shots.pop();
            episode.shotOrder?.pop();
          }
          throw new Error('未能保存新镜头，请检查浏览器存储后重试。');
        }
        open('video', 'board', index);
      },
      onlyOpen: overviewOnlyOpen,
      setOnlyOpen(value) { overviewOnlyOpen = value; },
      setTargetDuration(seconds) {
        data.episodes[episodeIndex].targetDurationSec = seconds;
        if (save()) showOverview(open);
      },
      selectEpisode(index) {
        episodeIndex = index;
        shotIndex = 0;
        showOverview(open);
        host.querySelector('[data-episode]').focus();
      }
    });
  }

  window.arcProduction = {
    open(key, requestedTab, requestedShot, continuityRow) {
      overviewRuntime?.dispose();
      overviewRuntime = undefined;
      workspace = key;
      tab = Object.hasOwn(workspaces[key], requestedTab) ? requestedTab : Object.keys(workspaces[key])[0];
      if (tab !== 'assistant') lastWorkflowTab[workspace] = tab;
      if (Number.isInteger(requestedShot) && data.episodes[episodeIndex].shots[requestedShot]) shotIndex = requestedShot;
      render(tab === 'canon' && continuityRow ? { row: continuityRow } : undefined);
    },
    close, showOverview
  };
})();
