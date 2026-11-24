(function () {
  'use strict';

  const templates = {
    art: [[
      '角色设定模板', '角色与服装', 'character',
      '锁定正面、四分之三侧面和侧面参考，核对眉眼、下颌和发际线。记录服装版本、配饰所在侧、道具持有手。表情图沿用同一角色版本与柔和中性光，避免把光影变化误判为脸型变化。',
      'https://qianlu.net/topics/ai-human-realism/', '千鹿 · 人物真实感'
    ]],
    board: [[
      '文戏表演模板', '表演节拍与表情', 'performance',
      '先交代角色发现了什么。让眼神先动，停一拍再用手部或头部回应；动作落定后保留短暂反应。没有对白时保持嘴部自然静止。只保留能传达本镜情绪变化的动作。',
      'https://qianlu.net/topics/ai-human-realism/', '千鹿 · 人物真实感'
    ], [
      '特效交接模板', '留给后期合成', 'postEffects',
      '保留干净底片。将特效位置、起止时刻和遮挡关系交给合成。先核对发丝、手、道具与前景遮挡，再按现场主光补反射；在镜头切点前检查残影。',
      'https://qianlu.net/topics/ai-cinematic-vfx/', '千鹿 · 影视特效'
    ]],
    camera: [[
      '运镜节拍模板', '起止构图与节奏', 'path',
      '明确开场构图和结束构图，只给一次主要机位变化。写出运动由哪个表演节拍触发、在哪个动作落点停住。移动中锁定视线轴、焦点和空间地标。',
      'https://qianlu.net/topics/ai-camera-movements/#movement-atlas', '千鹿 · 运镜图鉴'
    ], [
      '用光连续性模板', '本镜灯光与连续性', 'lighting',
      '沿用场景主光的空间侧、软硬和冷暖比例。记录区别于主光的轮廓光，并约束正反打的人物肤色、阴影方向和高光强度。光位变化要有画内动机。',
      'https://qianlu.net/topics/ai-lighting/', '千鹿 · 影视打光'
    ]]
  };

  function element(tag, value) {
    const node = document.createElement(tag);
    if (value) node.textContent = value;
    return node;
  }

  function button(label, action) {
    const node = element('button', label);
    node.type = 'button';
    node.onclick = action;
    return node;
  }

  function shortcuts(tab, append) {
    const entries = templates[tab];
    if (!entries) return null;
    const panel = element('details');
    panel.className = 'production-optional-field production-quality';
    panel.append(element('summary', '制作模板'));
    for (const [title, label, key, content, url, source] of entries) {
      const entry = element('details');
      const draft = element('textarea');
      draft.rows = 3;
      draft.maxLength = 1200;
      draft.value = content;
      const draftLabel = element('label', '按当前内容改写后，再追加到「' + label + '」');
      draftLabel.append(draft);
      const link = element('a', source);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const status = element('output');
      status.setAttribute('role', 'status');
      entry.append(element('summary', title), draftLabel,
        button('追加到「' + label + '」', () => {
          status.textContent = append(key, draft.value.trim());
        }), link, status);
      panel.append(entry);
    }
    return panel;
  }

  const trial = [
    { index: 1, id: 'shot-01-v1', name: '反应近景', mode: 'performance',
      study: '受控 A/B · 只增加一条表演节拍提示', variable: 'A 共用镜头提示 · B 增加一条视线/微表情节拍',
      variants: ['基础表演提示', '增加表演节拍提示'],
      picture: '面部特征、配饰与持物连续',
      action: '抬眼前的停顿、嘴部稳定', sound: '核对有无意外人声，确认接回同场底声时的连续性',
      control: '固定同一模型与精度、工作流、人物定妆与场景参考、共用提示词、种子、采样、画幅、分辨率、时长和机位。A 不增加表演节拍补充；B 只增加一条明确的视线/微表情时间提示。',
      checks: '比较抬眼与头部反应的先后、停顿可读性、嘴部稳定、身份/道具连续性；记录实际提示指纹、回片来源、耗时、重试及缺陷时间码。',
      acceptanceChecks: [
        { id: 'gaze-before-head', check: '抬眼先于头部或身体反应；停顿可读，不出现抢拍或无动机回头。', severity: 'blocker' },
        { id: 'facial-readability', check: '眉眼与嘴部在停顿和抬眼期间稳定可读；无意外张嘴、表情融化或瞳孔跳变。', severity: 'blocker' },
        { id: 'identity-props', check: '左右耳饰、发际线、脸型和手持道具与已绑定定妆及道具参考一致。', severity: 'blocker' },
        { id: 'reaction-cut', check: '开头与结尾保留可剪辑的反应余量；无意外人声，环境底声能与本场接续。', severity: 'review' }
      ] },
    { index: 2, id: 'shot-02-v1', name: '空间动作全景', study: '受控 A/B · 只改变动作参考', variable: 'A 文字动作 · B 加白模动作',
      variants: ['无动作视频', '加白模'],
      picture: '对定妆和关键帧核对脸型、服装、冷光方向、固定地标与物件位置',
      action: '过门槛时对齐白模的落脚，站稳后转头', sound: '核对脚步声与落脚、换入与换出切点',
      control: '两版固定同一模型与精度、工作流、角色/场景/关键帧、提示词、种子、画幅、分辨率、时长、采样和机位。唯一允许差异是 B 增加静音动作白模；任一共同条件变化，本组只能标为不可比较并重跑。',
      checks: '看两脚是否越过门槛、站稳后是否转头、固定地标与物件是否漂移、光向是否一致；另查脸服、剪辑切点与脚步声。记录每项的可见现象和时间码。',
      acceptanceChecks: [
        { id: 'threshold-contact', check: '前后脚分别越过门槛，脚底与地面接触可信；无滑步、穿插、悬空或腿部形变。', severity: 'blocker' },
        { id: 'stop-then-turn', check: '躯干和重心先停稳，再转头；动作顺序、方向和分镜节拍一致。', severity: 'blocker' },
        { id: 'set-lock', check: '固定场景边界与物件与机位保持空间关系；背景不得随人物或镜头意外漂移。', severity: 'blocker' },
        { id: 'cast-light-lock', check: '脸型、发型、立领服装和道具连续；主光与轮廓光方向不跳变。', severity: 'blocker' },
        { id: 'motion-sound-cut', check: '跨帧无明显肢体/背景闪变；脚步声落点与脚掌接地同步，入出点动作可衔接。', severity: 'blocker' }
      ] },
    { index: 3, id: 'shot-03-v1', name: '固定物件特写', study: '同源后期对照 · 只比较增强副作用', variable: 'A 原片 · B 同源 RelayVSR 2×',
      variants: ['原片', '同源 RelayVSR 2×'],
      picture: '箱沿和湿地反射的闪烁、假纹理、过锐、拖影',
      action: '核对同一裁片的帧序、切点和时长', sound: '原轨与增强轨的轻响位置、是否偏移',
      control: '同一已通过原片作为唯一输入；保留原帧序、裁切区间和音轨。只记录 RelayVSR 处理变化，不把放大后的像素数当作细节质量提升。',
      checks: '逐帧看箱沿、湿地反射、发丝边缘的稳定性与真实纹理；检查过锐、拖影、闪烁、音画同步。记录处理耗时、重试和可用区间。',
      acceptanceChecks: [
        { id: 'source-frame-lock', check: 'A 与 B 来自同一源文件、裁片、帧序与音轨；除增强外不允许变速、补帧、重裁或改色。', severity: 'blocker' },
        { id: 'edge-artifacts', check: '箱沿与发丝不出现白边、振铃、过锐、重影或细线断裂；放大不等于细节通过。', severity: 'blocker' },
        { id: 'texture-stability', check: '湿地反光、暗部噪点和细纹理跨帧稳定；不凭空生成纹理，也不吞掉真实纹理。', severity: 'blocker' },
        { id: 'timing-audio-preserve', check: '源帧数、帧率、片长和原声同步保持；切点前后无音画偏移或瞬态错位。', severity: 'blocker' }
      ] }
  ];

  const actionFxBenchmark = {
    id: 'shot-04-action-vfx-v1',
    name: '动作编排与特效',
    study: '受控 A/B · 白模预演对动作/机位控制的增益',
    variable: 'A 不附动作视频；B 仅增加同一镜头的 Blender 白模预演视频',
    fixedInputs: ['模型与精度', '工作流与采样器', '随机种子', '角色/场景/关键帧参考', '共用提示词', '画幅/分辨率/时长', '运镜镜头卡', '音频条件'],
    interpretationLimit: '验收表中的特效项检查生成结果是否可用；此轮不单独改变特效条件，因此不能据此声称白模或某种特效提示带来了特效质量增益。',
    allAcceptanceChecks: [
      { id: 'action-beats', check: '起势、加速、接触/闪避、收势的时间点清楚，动作量与镜头时长相配。', severity: 'blocker' },
      { id: 'axis-blocking', check: '人物起止位置、运动方向、交手距离和前后景遮挡稳定；不得瞬移或无因换边。', severity: 'blocker' },
      { id: 'camera-path', check: '起止构图、移动路径、速度变化和停点符合镜头卡；运镜由动作节拍触发。', severity: 'blocker' },
      { id: 'contact-weight', check: '武器/身体接触点可信，脚步与重心匹配；无穿模、滑步或肢体瞬断。', severity: 'blocker' },
      { id: 'fx-timing-occlusion', check: '特效起止时刻、作用区域和遮挡顺序正确；不盖脸、手、武器接触点或剧情信息。', severity: 'blocker' },
      { id: 'fx-light-continuity', check: '特效反光符合场景主光；人物肤色、环境亮度和地标不随特效无故漂移。', severity: 'blocker' },
      { id: 'action-temporal-stability', check: '脸、手、武器、衣摆、粒子边缘与背景无明显闪烁、拖影、融化或跳变。', severity: 'blocker' },
      { id: 'action-sound-edit', check: '动作落点留有剪辑余量；击打、衣料、脚步与环境声同步，局部返修两端接缝通过复核。', severity: 'blocker' }
    ]
  };
  const motionAcceptanceChecks = actionFxBenchmark.allAcceptanceChecks.filter(check =>
    !['fx-timing-occlusion', 'fx-light-continuity'].includes(check.id));
  const vfxAcceptanceChecks = actionFxBenchmark.allAcceptanceChecks;
  actionFxBenchmark.acceptanceChecks = motionAcceptanceChecks;
  const checksForMode = mode => (mode === 'vfx' ? vfxAcceptanceChecks : motionAcceptanceChecks)
    .map(check => ({ ...check }));

  const postProcessBenchmark = trial.pop();
  trial.push({ shotNumber: '05', index: null, id: actionFxBenchmark.id, name: actionFxBenchmark.name,
    study: actionFxBenchmark.study, variable: actionFxBenchmark.variable, variants: ['文字动作', '加白模动作'],
    picture: '动作节拍、轴线、接触点、运镜路径与特效遮挡',
    action: '按镜头卡核对起势、接触/闪避和收势时间点',
    sound: '动作落点与脚步、击打、衣料声及局部切点同步',
    control: '动作模式 A/B 只改变 B 是否附带同镜白模；其他输入依固定项锁定。特效模式是另一独立实验，不能与动作模式合并归因。',
    checks: actionFxBenchmark.interpretationLimit, acceptanceChecks: actionFxBenchmark.acceptanceChecks });

  const qualityGate = [
    ['identity', '人物身份', '脸型、发型、服装与道具连续'],
    ['acting', '表演可读', '眼神、表情与动作节拍成立'],
    ['contact', '动作接触', '落脚、手持物和身体接触关系成立'],
    ['space', '空间连续', '场景边界、地标、轴线和景别关系稳定'],
    ['camera', '摄影机与构图', '主体层次与视线清楚；起止构图、运动方向和停点符合镜头卡'],
    ['light', '美术风格与光色', '人物、服装、道具和场景的材质/色彩统一；主光、肤色与环境曝光连续'],
    ['temporal', '跨帧稳定', '面部、手、发丝、衣物、道具、特效和背景无明显闪烁变形'],
    ['sound', '声音衔接', '对白、脚步、环境声与切点同步']
  ];

  function benchmarkForShot(seriesTitle, episodeIndex, shotIndex, benchmarkId = null, benchmarkMode = 'motion') {
    if (benchmarkId === trial[0].id) return { ...trial[0], checks: trial[0].acceptanceChecks.map(check => ({ ...check })) };
    if (benchmarkId === actionFxBenchmark.id) {
      const mode = benchmarkMode === 'vfx' ? 'vfx' : 'motion';
      const benchmark = { ...actionFxBenchmark };
      delete benchmark.allAcceptanceChecks;
      return { ...benchmark, mode,
        study: mode === 'vfx' ? '受控 A/B · 只比较一条特效提示的影响' : actionFxBenchmark.study,
        variable: mode === 'vfx' ? 'A 明确要求干净底片；B 在共用镜头提示后增加唯一特效指令' : actionFxBenchmark.variable,
        fixedInputs: [...actionFxBenchmark.fixedInputs],
        interpretationLimit: mode === 'vfx' ? '本实验只比较文字特效指令；不改变白模、角色/场景参考、模型、工作流、机位或时长。提示词效果仍需多随机种子复测，单次回片不作因果结论。' : actionFxBenchmark.interpretationLimit,
        checks: checksForMode(mode) };
    }
    if (benchmarkId) return null;
    if (seriesTitle !== '短剧工作台 · 示例' || episodeIndex !== 0) return null;
    const item = trial.find(candidate => candidate.index === shotIndex);
    if (!item && shotIndex === 3) return { ...postProcessBenchmark,
      checks: postProcessBenchmark.acceptanceChecks.map(check => ({ ...check })) };
    if (!item) return null;
    return { id: item.id, study: item.study, variable: item.variable, ...(item.mode ? { mode: item.mode } : {}),
      fixedInputs: [1, 2].includes(item.index) ? ['模型与精度', '工作流与采样器', '随机种子',
        ...(item.index === 1 ? ['人物定妆/场景参考'] : ['人物定妆/场景/关键帧参考']),
        '共用提示词', '画幅/分辨率/时长', '机位与运镜', '音频条件'] : [],
      interpretationLimit: item.index === 2 ? '只改变 B 是否附带白模动作视频；共同条件变化、权重或运行状态未核实时，不作单变量因果或真实权重结论。' :
        item.index === 1 ? '只比较额外表演节拍提示；须逐项核对最终提示词指纹和工作流声明。未确认实际权重或种子执行状态前，不作权重身份或泛化因果结论。' :
          '同源后期保真比较，不代表视频生成模型能力。',
      checks: item.acceptanceChecks.map(check => ({ ...check })) };
  }

  function actionFxTemplate(shot, onChange = () => {}) {
    const panel = element('details');
    panel.className = 'production-optional-field production-quality production-quality-gate';
    panel.append(element('summary', '动作编排与特效 A/B · S05 模板'));
    panel.append(element('p', '绑定到当前镜头后，逐项验收会附到候选审片和 A/B 版本。选择一种单变量实验：白模模式只让 B 增加动作预演；特效模式只让 B 增加一条特效指令，A 使用干净底片要求。其他输入保持相同。绑定只保存验收标准，不会自动配置服务或生成素材。'));
    const modeLabel = element('label', '实验模式');
    const modeSelect = element('select');
    modeSelect.add(new Option('动作 / 机位：文字 vs 白模', 'motion'));
    modeSelect.add(new Option('特效提示：干净底片 vs 一条特效指令', 'vfx'));
    const savedMode = shot.qualityBenchmarkMode === 'vfx' ? 'vfx' : 'motion';
    modeSelect.value = savedMode;
    modeLabel.append(modeSelect);
    panel.append(modeLabel);
    const list = element('ul');
    function renderChecks() {
      list.replaceChildren(...checksForMode(modeSelect.value).map(check => {
        const row = element('li', `阻断项：${check.check}`);
        row.dataset.checkId = check.id;
        return row;
      }));
    }
    renderChecks();
    panel.append(list, element('p', '建议先关闭特效，只比较文字动作与白模预演；确认动作/摄影机收益后，再固定胜出的动作版本，单独做特效 A/B。这样不会把动作、运镜和特效的变化混成一个结论。'));
    const status = element('output');
    status.setAttribute('role', 'status');
    const applied = shot.qualityBenchmarkId === actionFxBenchmark.id;
    const toggle = button(applied ? '从本镜移除 S05 专项' : '应用到当前镜头');
    modeSelect.onchange = () => {
      renderChecks();
      toggle.textContent = applied && modeSelect.value === savedMode ?
        '从本镜移除 S05 专项' : applied ? '保存 S05 模式' : '应用到当前镜头';
    };
    toggle.onclick = () => {
      const remove = applied && modeSelect.value === savedMode;
      const next = remove ? null : actionFxBenchmark.id;
      if (onChange(next, modeSelect.value) !== true) {
        status.textContent = '保存失败；本镜专项状态未更改。';
        return;
      }
      status.textContent = next ? (modeSelect.value === 'vfx' ? 'S05 特效提示对照已绑定本镜。锁定时需填写唯一特效指令。' : 'S05 白模动作对照已绑定本镜。请选用支持白模 A/B 的工作流。') : '已移除 S05；既有候选记录保留。';
      toggle.disabled = true;
    };
    panel.append(toggle, status);
    return panel;
  }

  function blankMeasurement() {
    return { source: null, runId: null, outputName: null, returnAssetKey: null, returnSha256: null,
      returnFileFingerprint: null, returnContentDigest: null, workflowHash: null, workflow: null,
      model: null, modelEvidence: null, modelFileEvidence: null, rawModelReturnSha256: null, precision: null, seed: null, sampler: null,
      requestedSeconds: null, actualSeconds: null,
      width: null, height: null, frameCount: null, codec: null, frameRateMode: null,
      hasAudio: null, audioTrackCount: null, audioTracks: null, audioVideoDurationDeltaSeconds: null,
      expectedWidth: null, expectedHeight: null,
      fps: null, expectedFps: null, usableRanges: [], usableSeconds: null,
      processingSecondsPerUsableSecond: null, queuePlusProcessingSecondsPerUsableSecond: null,
      queueMs: null, processingMs: null,
      latestQueueMs: null, latestProcessingMs: null, timingAttempts: null, timingCoverage: null, retries: null, reviewMs: null,
      quality: Object.fromEntries(qualityGate.map(([id]) => [id, null])), fatalIssues: null, reviewNotes: [] };
  }

  function trialAudioAvailability(run) {
    if (!run?.output?.assetKey || run.media?.assetKey !== run.output.assetKey) return null;
    return typeof run.media.hasAudio === 'boolean' ? run.media.hasAudio :
      Number.isSafeInteger(run.media.audioTrackCount) ? run.media.audioTrackCount > 0 : null;
  }

  function firstFrameReturnMatches(run, job, clip) {
    const origins = [run?.testFixture, job?.testFixture, clip?.testFixture].filter(value => typeof value === 'boolean');
    const sourceConsistent = !(origins.includes(true) && origins.includes(false));
    return Boolean(run?.id && run?.output?.assetKey && job?.id === run.id && job?.preset === run.preset &&
      job?.firstFrameProof === run.firstFrameProof && job?.outputContract &&
      sourceConsistent && window.arcAB.sourceOriginConsistent(job, clip) && clip?.assetKey === run.output.assetKey &&
      clip?.url === '/api/generation/' + run.id + '/video/0' && /^[a-f0-9]{64}$/.test(clip.assetKey));
  }

  function firstFrameOriginLabel(run, job, clip) {
    const flags = [run?.testFixture, job?.testFixture, clip?.testFixture].filter(value => typeof value === 'boolean');
    if (flags.includes(true) && flags.includes(false)) return '回片来源标记冲突 · 不纳入真实模型样本';
    if (flags.includes(true)) return '本地测试素材 · 不代表真实模型回片';
    if (flags.length === 3 && flags.every(value => value === false)) return '服务回片来源标记一致 · 实际加载权重仍未核验';
    return '回片来源未完全核验 · 暂不作为真实模型样本';
  }

  function firstFrameInputsMatch(runs) {
    return Array.isArray(runs) && runs.length === 2 && runs.every(run => run && /^[a-f0-9]{64}$/.test(run.firstFrameProof || '')) &&
      runs[0].firstFrameProof === runs[1].firstFrameProof;
  }

  function safeModelFileEvidence(value, providerFingerprint, workflowSha256) {
    const isV3 = value?.schema === 'arc-comfy-model-files-v3';
    if (value?.status !== 'file-bytes-matched-runtime-unverified' ||
        value?.evidence !== 'workflow-requested-files-present-and-hashed' || value.runtimeLoadedVerified !== false ||
        !/^[a-f0-9]{64}$/.test(value.workflowSha256 || '') ||
        !/^[a-f0-9]{64}$/.test(workflowSha256 || '') || value.workflowSha256 !== workflowSha256 ||
        !isV3 || !/^[a-f0-9]{64}$/.test(value.modelSetSha256 || '') ||
        !/^[a-f0-9]{64}$/.test(value.providerFingerprint || '') || value.providerFingerprint !== providerFingerprint ||
        value.providerBinding !== 'operator-supplied-endpoint-fingerprint' ||
        !Array.isArray(value.models) ||
        !value.models.length || value.models.length > 256) return null;
    const models = value.models.map(model => {
      if (!/^[\w.-]{1,170}$/.test(model?.node || '') || !/^[\w.-]{1,170}$/.test(model.classType || '') ||
          !/^[\w.-]{1,170}$/.test(model.field || '') ||
          !/^[\w.-]{1,170}\.(?:safetensors|gguf|ckpt|pt|bin)$/i.test(model.file || '') ||
          !Number.isSafeInteger(model.sizeBytes) || model.sizeBytes < 1 || !/^[a-f0-9]{64}$/.test(model.sha256 || '')) return null;
      return { node: model.node, classType: model.classType, field: model.field, file: model.file,
        sizeBytes: model.sizeBytes, sha256: model.sha256 };
    });
    if (models.some(model => !model)) return null;
    return { schema: value.schema,
      evidence: 'workflow-requested-files-present-and-hashed', status: value.status,
      workflowSha256: value.workflowSha256, modelSetSha256: value.modelSetSha256,
      providerFingerprint: value.providerFingerprint, providerBinding: value.providerBinding,
      runtimeLoadedVerified: false, models };
  }

  function declaredWorkflowFields(run) {
    const declaration = run?.workflowDeclaration;
    if (declaration?.evidence !== 'workflow-declared' || declaration.loadedWeightsVerified !== false) return {};
    const models = Array.isArray(declaration.models) ? declaration.models.filter(item =>
      item && typeof item.file === 'string' && item.file.length <= 180 && !/[\\/\x00-\x1f]/.test(item.file))
      .map(item => item.file).slice(0, 32) : [];
    const precision = Array.isArray(declaration.precision) ? declaration.precision
      .filter(value => typeof value === 'string' && value.length <= 40).slice(0, 16) : [];
    const seeds = Array.isArray(declaration.seeds) ? declaration.seeds.filter(item => item &&
      (item.input === 'seed' || item.input === 'noise_seed') && Number.isSafeInteger(item.value) && item.value >= 0)
      .map(item => `${item.input}=${item.value}`).slice(0, 32) : [];
    const samplers = Array.isArray(declaration.samplers) ? declaration.samplers.slice(0, 32) : [];
    return { model: models.join(' · ') || null,
      modelEvidence: '工作流声明；权重文件哈希未核验', precision: precision.join(' · ') || null,
      seed: seeds.join(' · ') || null, sampler: samplers.length ? JSON.stringify(samplers) : null };
  }

  function qualityFrom(reviewEvidence) {
    const review = reviewEvidence?.review?.found ? reviewEvidence.review :
      reviewEvidence?.artReview?.found ? reviewEvidence.artReview : null;
    if (!review) return blankMeasurement().quality;
    const ids = { character: 'identity', performance: 'acting' };
    const values = Object.fromEntries(qualityGate.map(([id]) => [id, null]));
    for (const check of review.checks || []) {
      const id = ids[check.id] || check.id;
      if (!Object.hasOwn(values, id)) continue;
      values[id] = check.result === '符合' ? 'pass' : check.result === '待返修' ? 'repair' :
        check.result === '本镜不适用' ? 'not-applicable' : null;
    }
    return values;
  }

  function attachReview(measurement, reviewEvidence) {
    measurement.quality = qualityFrom(reviewEvidence);
    const review = reviewEvidence?.review?.found ? reviewEvidence.review :
      reviewEvidence?.artReview?.found ? reviewEvidence.artReview : null;
    measurement.reviewMs = Number.isSafeInteger(review?.reviewMs) && review.reviewMs >= 0 ? review.reviewMs : null;
    const issues = review?.issues || reviewEvidence?.artReview?.approval?.issues;
    measurement.fatalIssues = review ? (issues || []).map(issue => `${issue.label}${issue.note ? ' · ' + issue.note : ''}`) : null;
    measurement.reviewNotes = (reviewEvidence?.timecodeNotes || []).map(note =>
      `${window.arcReviewNotes.timestamp(note.sourceMs)} · ${note.category} · ${note.note}`);
    if (Array.isArray(reviewEvidence?.relayIssueNotes)) measurement.reviewNotes.push(...reviewEvidence.relayIssueNotes.map(note =>
      `${window.arcReviewNotes.timestamp(note.ms)} · ${note.kind} · ${note.note}`));
    const usable = usableRangeSummary(measurement.usableRanges, measurement.actualSeconds).seconds;
    const rounded = value => Math.round((value + Number.EPSILON) * 1000) / 1000;
    measurement.usableSeconds = usable == null ? null : rounded(usable);
    measurement.processingSecondsPerUsableSecond = usable > 0 && Number.isFinite(measurement.processingMs) ?
      rounded(measurement.processingMs / 1000 / usable) : null;
    measurement.queuePlusProcessingSecondsPerUsableSecond = usable > 0 &&
      Number.isFinite(measurement.processingMs) && Number.isFinite(measurement.queueMs) ?
      rounded((measurement.processingMs + measurement.queueMs) / 1000 / usable) : null;
    return measurement;
  }

  function usableRangeSummary(ranges, durationSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return { seconds: null, intervalCount: 0 };
    const maxDuration = durationSeconds;
    const intervals = (Array.isArray(ranges) ? ranges : []).map(range => ({
      start: Math.max(0, Number(range?.startSeconds)), end: Math.min(maxDuration, Number(range?.endSeconds))
    })).filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .sort((a, b) => a.start - b.start);
    if (!intervals.length) return { seconds: null, intervalCount: 0 };
    let end = -Infinity, seconds = 0;
    for (const range of intervals) {
      seconds += Math.max(0, range.end - Math.max(range.start, end));
      end = Math.max(end, range.end);
    }
    return { seconds, intervalCount: intervals.length };
  }

  function fileIdentityFromReview(reviewEvidence) {
    const sourceBinding = reviewEvidence?.sourceBinding;
    const fingerprint = /^(sha256|sample-v1):[a-f0-9]{64}$/.test(sourceBinding?.fingerprint || '') ?
      sourceBinding.fingerprint : null;
    const contentDigest = /^sha256-tree-v1:[a-f0-9]{64}$/.test(sourceBinding?.contentDigest || '') ?
      sourceBinding.contentDigest : null;
    return { returnSha256: fingerprint?.startsWith('sha256:') ? fingerprint.slice(7) : null,
      returnFileFingerprint: fingerprint, returnContentDigest: contentDigest };
  }

  function frameMeasurement(run, evidence, requestedSeconds) {
    const measurement = blankMeasurement();
    if (!run) return measurement;
    Object.assign(measurement, {
      source: run.testFixture === true ? 'local-test' : run.testFixture === false ? 'configured-provider' : 'unknown',
      runId: run.id || null, outputName: run.output?.name || null, returnAssetKey: run.output?.assetKey || null,
      ...fileIdentityFromReview(evidence),
      workflowHash: run.graphSha256 || null, workflow: run.workflow || run.preset || null,
      ...declaredWorkflowFields(run),
      requestedSeconds: Number.isFinite(requestedSeconds) ? requestedSeconds :
        run.outputContract?.seconds ?? (Number.isFinite(run.outputContract?.frames) && Number.isFinite(run.outputContract?.fps) &&
          run.outputContract.fps > 0 ? run.outputContract.frames / run.outputContract.fps : null),
      actualSeconds: run.media?.assetKey === run.output?.assetKey ? run.media.seconds : null,
      width: run.media?.assetKey === run.output?.assetKey ? run.media.width : null,
      height: run.media?.assetKey === run.output?.assetKey ? run.media.height : null,
      fps: run.media?.assetKey === run.output?.assetKey ? run.media.fps ?? null : null,
      frameCount: run.media?.assetKey === run.output?.assetKey ? run.media.frameCount ?? null : null,
      codec: run.media?.assetKey === run.output?.assetKey ? run.media.codec ?? null : null,
      frameRateMode: run.media?.assetKey === run.output?.assetKey ? run.media.frameRateMode ?? null : null,
      hasAudio: run.media?.assetKey === run.output?.assetKey ? run.media.hasAudio ?? null : null,
      audioTrackCount: run.media?.assetKey === run.output?.assetKey ? run.media.audioTrackCount ?? null : null,
      audioTracks: run.media?.assetKey === run.output?.assetKey ? run.media.audioTracks ?? null : null,
      audioVideoDurationDeltaSeconds: run.media?.assetKey === run.output?.assetKey ? run.media.audioVideoDurationDeltaSeconds ?? null : null,
      expectedWidth: run.outputContract?.width ?? null, expectedHeight: run.outputContract?.height ?? null,
      expectedFps: run.outputContract?.fps ?? null,
      queueMs: run.cumulativeTiming ? run.cumulativeTiming.queueMs :
        (Number.isFinite(run.timing?.queueMs) ? run.timing.queueMs : null),
      processingMs: run.cumulativeTiming ? run.cumulativeTiming.executionMs :
        (Number.isFinite(run.timing?.executionMs) ? run.timing.executionMs : null),
      latestQueueMs: run.cumulativeTiming ? run.cumulativeTiming.latestQueueMs :
        (Number.isFinite(run.timing?.queueMs) ? run.timing.queueMs : null),
      latestProcessingMs: run.cumulativeTiming ? run.cumulativeTiming.latestExecutionMs :
        (Number.isFinite(run.timing?.executionMs) ? run.timing.executionMs : null),
      timingAttempts: run.cumulativeTiming?.attempts ?? 1,
      timingCoverage: run.cumulativeTiming?.coverage ?? 'latest-attempt-only',
      retries: Number.isInteger(run.retryCount) ? run.retryCount : null
    });
    return attachReview(measurement, evidence);
  }

  function pairedTiming(group, run) {
    const attempts = group?.attempts?.filter(attempt => attempt.status !== 'rejected') || [];
    const latest = attempts.at(-1);
    const sourceSummary = key => {
      const values = attempts.map(attempt => attempt[key] ?? null);
      const known = values.filter(value => value === 'comfy-history-timestamps' || value === 'local-bridge-observation');
      if (!known.length) return null;
      if (known.length !== values.length) return 'incomplete';
      return new Set(known).size === 1 ? known[0] : 'mixed';
    };
    const queueSource = sourceSummary('queueSource');
    const executionSource = sourceSummary('executionSource');
    const total = key => attempts.every(attempt => Number.isFinite(attempt[key]) && attempt[key] >= 0) ?
      attempts.reduce((sum, attempt) => sum + attempt[key], 0) : null;
    return { queueMs: queueSource === 'mixed' ? null : total('queueMs'),
      processingMs: executionSource === 'mixed' ? null : total('executionMs'), queueSource, executionSource,
      latestQueueMs: Number.isFinite(latest?.queueMs) ? latest.queueMs : null,
      latestProcessingMs: Number.isFinite(latest?.executionMs) ? latest.executionMs : null,
      latestQueueSource: latest?.queueSource ?? null, latestExecutionSource: latest?.executionSource ?? null,
      gpuKernelTime: attempts.length && attempts.every(attempt => attempt.gpuKernelTime === false) ? false : null,
      attempts: attempts.length,
      coverage: attempts.length === (group?.retryCount || 0) + 1 ? 'all-persisted-attempts' : 'partial-history' };
  }

  function pairedMeasurement(pair, variant, evidence, requestedSeconds) {
    const measurement = blankMeasurement();
    const group = pair?.variants?.[variant];
    const run = pairedRunAttempt(pair, variant);
    if (!run) return measurement;
    const timing = pairedTiming(group, run);
    const actualMedia = run.media?.assetKey === run.outputAssetKey ? run.media : null;
    Object.assign(measurement, {
      source: pair.environment === 'local-test' ? 'local-test' : pair.environment === 'configured-provider' ? 'configured-provider' : 'unknown',
      runId: run.jobId || null, outputName: run.output || null, returnAssetKey: run.outputAssetKey || null,
      ...fileIdentityFromReview(evidence),
      workflowHash: run.workflowSha256 || pair.workflowSha256 || null, providerFingerprint: pair.providerFingerprint || null,
      workflow: pair.workflow || null,
      modelFileEvidence: safeModelFileEvidence(pair.modelFileEvidence, pair.providerFingerprint, pair.workflowSha256),
      workflowPreflightEvidence: run.preflightEvidence || null,
      ...declaredWorkflowFields(run),
      requestedSeconds: Number.isFinite(requestedSeconds) ? requestedSeconds : null,
      actualSeconds: actualMedia?.seconds ?? run.durationSec ?? null,
      width: actualMedia?.width ?? null, height: actualMedia?.height ?? null,
      fps: actualMedia?.fps ?? null, frameCount: actualMedia?.frameCount ?? null,
      codec: actualMedia?.codec ?? null, frameRateMode: actualMedia?.frameRateMode ?? null,
      hasAudio: actualMedia?.hasAudio ?? null, audioTrackCount: actualMedia?.audioTrackCount ?? null,
      audioTracks: actualMedia?.audioTracks ?? null,
      audioVideoDurationDeltaSeconds: actualMedia?.audioVideoDurationDeltaSeconds ?? null,
      expectedWidth: run.outputContract?.width ?? null, expectedHeight: run.outputContract?.height ?? null,
      expectedFps: run.outputContract?.fps ?? null,
      queueMs: timing.queueMs, processingMs: timing.processingMs,
      queueSource: timing.queueSource, executionSource: timing.executionSource,
      gpuKernelTime: timing.gpuKernelTime,
      latestQueueMs: timing.latestQueueMs, latestProcessingMs: timing.latestProcessingMs,
      timingAttempts: timing.attempts, timingCoverage: timing.coverage,
      retries: Number.isInteger(group.retryCount) ? group.retryCount : null,
      usableRanges: (pair.reviewMarks || []).filter(mark => mark.variant === variant && mark.kind === 'range' &&
        mark.jobId === run.jobId && mark.assetKey === run.outputAssetKey)
        .map(mark => ({ startSeconds: mark.startMs / 1000, endSeconds: mark.endMs / 1000 }))
    });
    return attachReview(measurement, evidence);
  }

  function pairedRunAttempt(pair, variant) {
    const attempts = pair?.variants?.[variant]?.attempts || [];
    return attempts.findLast(attempt => attempt.status === 'complete' && attempt.outputAssetKey) ||
      attempts.findLast(attempt => attempt.status === 'complete') || null;
  }

  function pairedCandidateReviewEvidence(shot, context, pair, variant, benchmark) {
    const run = pairedRunAttempt(pair, variant);
    if (!run?.jobId) return [];
    return candidateReviewEvidence(shot, context, { jobId: run.jobId, pairId: pair.pairId, variant, benchmark });
  }

  function shotBasisStatus(run, currentBasis) {
    const historicalBasis = run?.shotBasisSha256;
    return !historicalBasis || !currentBasis ? 'unknown' : historicalBasis === currentBasis ? 'current' : 'changed';
  }

  function basisBoundMeasurement(run, currentBasis, variant, evidence, requestedSeconds) {
    const status = shotBasisStatus(run, currentBasis);
    return { status, measurement: status === 'current' ?
      pairedMeasurement(run, variant, evidence, requestedSeconds) : blankMeasurement() };
  }

  function trialCsv(report) {
    const headings = ['镜头', '绑定状态', '实验基准新鲜度', '基准 ID', '实验类型', '方案', '允许变化', '共同输入', '画面验收', '动作验收', '声音验收', '本镜可观察验收点',
      '运行来源（真实回片或本地测试）', '运行编号或文件', '回片资产键（非文件哈希）', '绑定文件指纹', '分块内容摘要',
      '完整文件 SHA-256（仅全量绑定时）', '工作流指纹', '服务端点指纹',
      '工作流/预设', '工作流预检证据', '模型工作流声明', '模型参数证据', '清单来源工作流 SHA-256', '模型文件集合 SHA-256',
      '模型文件清单绑定端点 SHA-256', '端点绑定方式', '模型文件清单明细',
      '模型原始回片 SHA-256', '精度声明', '种子', '采样设置', '请求秒数', '实测秒数',
        '实测宽度', '实测高度', '实测帧数', '实测编码', '帧率模式', '含音轨', '音轨数', '音轨结构', '音画轨道最大时长差（不等同同步）', '预期宽度', '预期高度', '实测帧率', '预期帧率',
      'Relay源帧数', 'Relay源帧率', 'Relay原始回片帧数', 'Relay原始回片帧率', 'Relay帧节奏是否保留', '可用区间', '可用秒数',
      '累计执行秒/人工标可用秒', '累计排队+执行秒/人工标可用秒',
      '累计排队秒数', '累计生成或增强秒数', '最近一次排队秒数', '最近一次生成或增强秒数', '计入耗时的尝试数', '耗时覆盖范围',
      '重试次数', '人工审片秒数', ...qualityGate.map(([, label]) => label),
      '问题时间码', '致命问题', '结论', '重复试镜与排除样本账本'];
    const generationRows = trial.flatMap((item, shotIndex) => item.variants.map((variant, index) => {
      const measurement = report.shots[shotIndex].measurements[variant === item.variants[0] ? 'A' : 'B'];
      const run = shotIndex === 0 ? report.shots[shotIndex].latestPerformanceRun :
        shotIndex === 1 ? report.shots[shotIndex].latestWhiteModelRun : report.shots[shotIndex].latestActionRun;
      const ranges = measurement.usableRanges || [];
      return [item.shotNumber ? 'S' + item.shotNumber : 'S0' + (item.index + 1), report.shots[shotIndex].bindingStatus || 'bound',
        run?.shotBasisStatus || 'no-current-pair', item.id, report.shots[shotIndex].study,
        `${'AB'[index]} · ${report.shots[shotIndex].variantLabels[index]}`,
        item.id === actionFxBenchmark.id ? report.shots[shotIndex].allowedDifference.join('；') :
          item.index === 1 ? 'B 只增加一条表演节拍提示' : 'B 只增加白模动作视频',
        item.control, item.picture, item.action, item.sound, JSON.stringify(report.shots[shotIndex].acceptanceChecks), measurement.source || '',
        measurement.runId || measurement.outputName || '', measurement.returnAssetKey || '', measurement.returnFileFingerprint || '',
        measurement.returnContentDigest || '', measurement.returnSha256 || '', measurement.workflowHash || '', measurement.providerFingerprint || '',
        measurement.workflow || '', JSON.stringify(measurement.workflowPreflightEvidence || null),
        measurement.model || '', measurement.modelEvidence || '',
        measurement.modelFileEvidence?.workflowSha256 || '', measurement.modelFileEvidence?.modelSetSha256 || '',
        measurement.modelFileEvidence?.providerFingerprint || '', measurement.modelFileEvidence?.providerBinding || '',
        JSON.stringify(measurement.modelFileEvidence?.models || []),
        measurement.rawModelReturnSha256 || '',
        measurement.precision || '', measurement.seed ?? '', measurement.sampler || '',
        measurement.requestedSeconds ?? '', measurement.actualSeconds ?? '', measurement.width ?? '', measurement.height ?? '',
        measurement.frameCount ?? '', measurement.codec || '', measurement.frameRateMode || '',
        measurement.hasAudio === true ? '是' : measurement.hasAudio === false ? '否' : '',
        measurement.audioTrackCount ?? '', JSON.stringify(measurement.audioTracks || []), measurement.audioVideoDurationDeltaSeconds ?? '',
        measurement.expectedWidth ?? '', measurement.expectedHeight ?? '',
        measurement.fps ?? '', measurement.expectedFps ?? '', measurement.sourceFrames ?? '', measurement.sourceFps ?? '',
        measurement.rawReturnFrames ?? '', measurement.rawReturnFps ?? '',
        measurement.rawCadencePreserved === true ? '是' : measurement.rawCadencePreserved === false ? '否' : '',
        JSON.stringify(ranges), measurement.usableSeconds ?? '', measurement.processingSecondsPerUsableSecond ?? '',
        measurement.queuePlusProcessingSecondsPerUsableSecond ?? '',
        Number.isFinite(measurement.queueMs) ? measurement.queueMs / 1000 : '',
        Number.isFinite(measurement.processingMs) ? measurement.processingMs / 1000 : '',
        Number.isFinite(measurement.latestQueueMs) ? measurement.latestQueueMs / 1000 : '',
        Number.isFinite(measurement.latestProcessingMs) ? measurement.latestProcessingMs / 1000 : '',
        measurement.timingAttempts ?? '', measurement.timingCoverage || '', measurement.retries ?? '',
        Number.isFinite(measurement.reviewMs) ? measurement.reviewMs / 1000 : '',
        ...qualityGate.map(([id]) => measurement.quality[id] || ''), measurement.reviewNotes.join('；'),
        Array.isArray(measurement.fatalIssues) ? measurement.fatalIssues.join('；') : '',
        report.shots[shotIndex].verdict || '',
        JSON.stringify(report.shots[shotIndex].repeatability || null)]
    }));
    const relay = report.postProcessing;
    const postRows = postProcessBenchmark.variants.map((variant, index) => {
      const measurement = relay.measurements[variant === postProcessBenchmark.variants[0] ? 'A' : 'B'];
      const ranges = measurement.usableRanges || [];
      return ['S04', 'post-process', 'same-source-check', relay.benchmarkId, postProcessBenchmark.study,
        `${'AB'[index]} · ${variant}`, 'B 仅对同一源片执行 RelayVSR 2×',
        postProcessBenchmark.control, postProcessBenchmark.picture, postProcessBenchmark.action, postProcessBenchmark.sound,
        JSON.stringify(relay.acceptanceChecks), measurement.source || '', measurement.runId || measurement.outputName || '',
        measurement.returnAssetKey || '', measurement.returnFileFingerprint || '', measurement.returnContentDigest || '',
        measurement.returnSha256 || '', measurement.workflowHash || '', measurement.providerFingerprint || '',
        measurement.workflow || '', JSON.stringify(measurement.workflowPreflightEvidence || null),
        measurement.model || '', measurement.modelEvidence || '',
        measurement.modelFileEvidence?.workflowSha256 || '', measurement.modelFileEvidence?.modelSetSha256 || '',
        measurement.modelFileEvidence?.providerFingerprint || '', measurement.modelFileEvidence?.providerBinding || '',
        JSON.stringify(measurement.modelFileEvidence?.models || []),
        measurement.rawModelReturnSha256 || '', measurement.precision || '', measurement.seed ?? '', measurement.sampler || '',
        measurement.requestedSeconds ?? '', measurement.actualSeconds ?? '', measurement.width ?? '', measurement.height ?? '',
        measurement.frameCount ?? '', measurement.codec || '', measurement.frameRateMode || '',
        measurement.hasAudio === true ? '是' : measurement.hasAudio === false ? '否' : '',
        measurement.audioTrackCount ?? '', JSON.stringify(measurement.audioTracks || []), measurement.audioVideoDurationDeltaSeconds ?? '', measurement.expectedWidth ?? '',
        measurement.expectedHeight ?? '', measurement.fps ?? '', measurement.expectedFps ?? '', measurement.sourceFrames ?? '',
        measurement.sourceFps ?? '', measurement.rawReturnFrames ?? '', measurement.rawReturnFps ?? '',
        measurement.rawCadencePreserved === true ? '是' : measurement.rawCadencePreserved === false ? '否' : '',
        JSON.stringify(ranges), measurement.usableSeconds ?? '', measurement.processingSecondsPerUsableSecond ?? '',
        measurement.queuePlusProcessingSecondsPerUsableSecond ?? '',
        Number.isFinite(measurement.queueMs) ? measurement.queueMs / 1000 : '',
        Number.isFinite(measurement.processingMs) ? measurement.processingMs / 1000 : '',
        Number.isFinite(measurement.latestQueueMs) ? measurement.latestQueueMs / 1000 : '',
        Number.isFinite(measurement.latestProcessingMs) ? measurement.latestProcessingMs / 1000 : '',
        measurement.timingAttempts ?? '', measurement.timingCoverage || '', measurement.retries ?? '',
        Number.isFinite(measurement.reviewMs) ? measurement.reviewMs / 1000 : '',
        ...qualityGate.map(([id]) => measurement.quality[id] || ''), measurement.reviewNotes.join('；'),
        Array.isArray(measurement.fatalIssues) ? measurement.fatalIssues.join('；') : '', relay.verdict || '', '[]'];
    });
    const rows = [...generationRows, ...postRows];
    return '\uFEFF' + [headings, ...rows].map(row =>
      row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
  }

  function candidateReviewEvidence(shot, context, { jobId, pairId, variant, benchmark } = {}) {
    if (!context?.series || !context?.pages) return [];
    const candidates = [...(Array.isArray(shot.candidates) ? shot.candidates : []), shot];
    const seen = new Set();
    return candidates.flatMap(candidate => {
      const generated = window.arcProductionProject.generatedCandidate(candidate);
      if (!generated || (jobId && generated.jobId !== jobId) ||
          (pairId && (generated.comparison?.id !== pairId || generated.comparison?.variant !== variant))) return [];
      const key = [generated.jobId, generated.comparison?.variant || '', generated.assetKey].join(':');
      if (seen.has(key)) return [];
      seen.add(key);
      const reviewRecord = { ...shot, ...candidate, artReviews: shot.artReviews };
      const current = window.arcArtReview.current(reviewRecord, context.series, context.pages, context.continuityBasis, benchmark);
      const approval = window.arcArtReview.approval(reviewRecord, context.series, context.pages, context.continuityBasis, benchmark);
      let sourceBinding = null;
      try {
        const parsed = JSON.parse(candidate.sourceBinding || 'null');
        if (parsed && parsed.version === candidate.version && parsed.file === candidate.file &&
            Number.isSafeInteger(parsed.size) && parsed.size > 0 &&
            /^(sha256|sample-v1):[a-f0-9]{64}$/.test(parsed.fingerprint || '') &&
            /^sha256-tree-v1:[a-f0-9]{64}$/.test(parsed.contentDigest || '')) {
          sourceBinding = { size: parsed.size, fingerprint: parsed.fingerprint, contentDigest: parsed.contentDigest };
        }
      } catch { /* Missing or malformed source identity remains explicit below. */ }
      return [{ candidateVersion: candidate.version || null, file: candidate.file || null,
        jobId: generated.jobId, pairId: generated.comparison?.id || null,
        variant: generated.comparison?.variant || null, outputAssetKey: generated.assetKey,
        sourceBinding, testFixture: typeof generated.testFixture === 'boolean' ? generated.testFixture : null,
        timecodeNotes: window.arcReviewNotes?.list(reviewRecord) || [],
        review: { found: !current.stale && current.checks.length > 0, stale: current.stale,
          ready: approval.ready, unbound: approval.unbound, missing: approval.missing, reviewMs: current.reviewMs,
          checks: current.checks, issues: approval.issues,
          technicalQc: current.technicalQc,
          benchmarkId: benchmark?.id || null, benchmarkChecks: current.benchmarkChecks,
          benchmarkMissing: approval.benchmarkMissing || [] } }];
    });
  }

  function enhancementReviewEvidence(shot, context, benchmark) {
    const candidates = [...(Array.isArray(shot.candidates) ? shot.candidates : []), shot];
    const seen = new Set();
    return candidates.flatMap(candidate => {
      const detail = window.arcProductionProject.enhancementDetails(candidate);
      if (!detail || detail.engine?.kind !== 'comfyui-ai-enhancement') return [];
      const key = [detail.engine.taskId, detail.aiOutput?.sha256 || '', candidate.version || ''].join(':');
      if (seen.has(key)) return [];
      seen.add(key);
      const notes = (() => {
        try {
          const rows = JSON.parse(shot.relayReviewNotes || '[]');
          return Array.isArray(rows) ? rows.filter(row => row?.taskId === detail.engine.taskId &&
            row.assetKey === detail.aiOutput.sha256 && row.cutSha256 === detail.aiInput.sha256).slice(-120) : [];
        } catch { return []; }
      })();
      let artReview = null;
      if (window.arcArtReview && context?.series && context?.pages) {
        const reviewRecord = { ...shot, ...candidate, artReviews: shot.artReviews };
        const review = window.arcArtReview.current(reviewRecord, context.series, context.pages, context.continuityBasis, benchmark);
        artReview = { ...review, found: !review.stale && review.checks.length > 0,
          approval: window.arcArtReview.approval(reviewRecord, context.series, context.pages, context.continuityBasis, benchmark) };
      }
      const binding = window.arcArtReview?.sourceIdentity(candidate);
      const finalOutputSha256 = binding?.[1]?.startsWith('sha256:') ? binding[1].slice(7) : null;
      const finalSeconds = Number(candidate.outPoint) - Number(candidate.inPoint);
      const retryHistory = Array.isArray(detail.engine.attemptHistory) ? detail.engine.attemptHistory : [];
      const currentTiming = ['local-bridge', 'per-field'].includes(detail.engine.timingSource) ? detail.engine.timing || {} : {};
      const historyComplete = retryHistory.length === (Number.isSafeInteger(detail.engine.retryCount) ? detail.engine.retryCount : 0);
      const cumulativeTiming = key => {
        const values = [...retryHistory.map(item => item[key]), currentTiming[key]];
        const sourceKey = key === 'queueMs' ? 'queueSource' : key === 'executionMs' ? 'executionSource' : null;
        const sourcesMatch = detail.engine.timingSource !== 'per-field' || !sourceKey ||
          [...retryHistory, currentTiming].every(item => item[sourceKey] === 'comfy-history-timestamps');
        return historyComplete && sourcesMatch && values.every(value => Number.isFinite(value) && value >= 0) ?
          values.reduce((sum, value) => sum + value, 0) : null;
      };
      return [{ candidateVersion: candidate.version || null, file: candidate.file || null,
        sourceVersion: detail.sourceVersion, taskId: detail.engine.taskId,
        workflowSha256: detail.engine.workflowSha256, sourceSha256: detail.aiInput.sha256,
        providerFingerprint: detail.engine.providerFingerprint || null,
        sourceName: detail.aiInput.name, sourceJobId: detail.generationSource?.jobId || null,
        outputName: detail.aiOutput.name, finalOutputName: candidate.file || null,
        output: { width: detail.width, height: detail.height, duration: Number.isFinite(finalSeconds) && finalSeconds > 0 ? finalSeconds : null,
          fps: detail.fps },
        cadence: { sourceFrames: detail.aiInput.frames ?? null, sourceFps: detail.aiInput.fps ?? null,
          rawReturnFrames: detail.aiOutput.frames ?? null, rawReturnFps: detail.aiOutput.fps ?? null,
          sourceAudio: typeof detail.aiInput.audio === 'boolean' ? detail.aiInput.audio : null,
          rawReturnAudio: typeof detail.aiOutput.audio === 'boolean' ? detail.aiOutput.audio : null,
          preserved: Number.isSafeInteger(detail.aiInput.frames) && detail.aiInput.frames === detail.aiOutput.frames &&
            typeof detail.aiInput.fps === 'string' && detail.aiInput.fps === detail.aiOutput.fps },
        timing: { queueMs: cumulativeTiming('queueMs'), executionMs: cumulativeTiming('executionMs'),
          latestQueueMs: Number.isFinite(currentTiming.queueMs) ? currentTiming.queueMs : null,
          latestExecutionMs: Number.isFinite(currentTiming.executionMs) ? currentTiming.executionMs : null,
          attempts: retryHistory.length + 1, historyComplete },
        retries: Number.isSafeInteger(detail.engine.retryCount) ? detail.engine.retryCount : null,
        finalOutputSha256,
        outputSha256: detail.aiOutput.sha256,
        testFixture: typeof detail.testFixture === 'boolean' ? detail.testFixture : null,
        relayIssueNotes: notes, artReview: artReview ? { ...artReview,
          benchmarkId: benchmark?.id || null, benchmarkMissing: artReview.approval?.benchmarkMissing || [] } : null }];
    });
  }

  function evidenceStatus(firstFrameRuns, pairedRun, enhancementCandidates) {
    const origins = [
      ...(Array.isArray(firstFrameRuns) ? firstFrameRuns.filter(run => run?.status === 'complete').map(run => run.testFixture) : []),
      ...(pairedRun && ['A', 'B'].some(variant => pairedRun.variants?.[variant]?.attempts?.some(
        attempt => attempt.status === 'complete' && attempt.output)) ? [
          pairedRun.environment === 'configured-provider' ? false : pairedRun.environment === 'local-test' ? true : null
        ] : []),
      ...(Array.isArray(enhancementCandidates) ? enhancementCandidates.map(candidate => candidate.testFixture) : [])
    ];
    const hasProvider = origins.includes(false);
    const hasTestFixture = origins.includes(true);
    const hasUnknown = origins.some(origin => origin !== true && origin !== false);
    const status = !origins.length ? 'no-return-linked' :
      hasProvider && hasTestFixture ? 'mixed-source-outputs' :
        hasUnknown ? 'source-unconfirmed' :
          hasProvider ? 'configured-provider-output-linked' : 'local-test-only';
    return { evidenceStatus: status,
      status: status === 'configured-provider-output-linked' ? '非模拟服务回片已关联 · 模型身份与画质仍待核验' :
        status === 'local-test-only' ? '仅有关联本地测试素材 · 真实画面仍待实测' :
          status === 'mixed-source-outputs' ? '回片来源混杂（含本地测试素材）· 不能作为真实模型质量证据' :
          status === 'source-unconfirmed' ? '已有回片但来源未确认 · 画质结论待审' : '待实测' };
  }

  function reviewStatusLabel(candidate, { hasReturned = false } = {}) {
    if (!candidate) return hasReturned ? '回片已就绪 · 尚未送入本镜候选验收' : '尚无可核验回片';
    const review = candidate.review || {};
    if (review.unbound) return '源文件指纹未绑定 · 尚不能验收';
    if (review.stale) return '验收依据已变化 · 需要重新核对';
    if (!review.found) return '待视觉验收';
    if (review.issues?.length) return `有 ${review.issues.length} 项待返修`;
    if (review.benchmarkMissing?.length) return `通用视觉已审 · 试镜专项还差 ${review.benchmarkMissing.length} 项`;
    if (review.ready) return '视觉验收完成 · 无待返修项';
    return `验收未完成 · 还缺 ${review.missing?.length || 0} 项检查`;
  }

  function benchmarkVariantResult(definition, candidate, benchmarkId) {
    const identity = { candidateVersion: candidate?.candidateVersion || null, file: candidate?.file || null,
      outputAssetKey: candidate?.outputAssetKey || null };
    const pending = { result: 'not-reviewed', note: '', ...identity, timecodedEvidence: [] };
    if (!definition?.id || candidate?.review?.benchmarkId !== benchmarkId) return pending;
    const observed = candidate.review.benchmarkChecks?.find(item => item?.id === definition.id);
    if (!observed) return pending;
    const result = observed.result === '符合' ? 'pass' : observed.result === '待返修' ? 'repair' :
      observed.result === '本镜不适用' ? 'not-applicable' : 'not-reviewed';
    return { result, note: observed.note || '', ...identity,
      timecodedEvidence: (observed.timecodes || []).flatMap(item => Number.isSafeInteger(item?.sourceMs) && item.sourceMs >= 0 ?
        [{ sourceMs: item.sourceMs, note: item.note || '' }] : []) };
  }

  function repeatabilityReviewSummary(repeatability, definitions, benchmarkId) {
    if (!repeatability || !Array.isArray(repeatability.cohorts) || !Array.isArray(definitions) || !benchmarkId) return null;
    const outcomes = () => ({ bothReady: 0, aOnlyReady: 0, bOnlyReady: 0, neitherReady: 0, notComparable: 0 });
    const emptyVariant = () => ({ reviews: 0, complete: 0, incomplete: 0, ready: 0, notReady: 0, unreviewed: 0,
      blockerRepairs: 0, reviewMsSamples: 0, reviewMsTotal: 0,
      checks: Object.fromEntries(definitions.map(check => [check.id, { pass: 0, repair: 0, notApplicable: 0, notReviewed: 0 }])) });
    const mapResult = result => result === 'pass' ? 'pass' : result === 'repair' ? 'repair' :
      result === 'not-applicable' ? 'notApplicable' : 'notReviewed';
    const cohorts = repeatability.cohorts.map(cohort => {
      const variants = { A: emptyVariant(), B: emptyVariant() };
      const paired = outcomes();
      const runs = Array.isArray(cohort.runs) ? cohort.runs : [];
      for (const run of runs) {
        const current = {};
        for (const variant of ['A', 'B']) {
          const stats = variants[variant];
          const candidate = (run.candidateReviews?.[variant] || []).filter(item => item?.pairId === run.pairId &&
            item?.variant === variant && item?.review?.benchmarkId === benchmarkId).at(-1);
          const review = candidate?.review;
          const checks = definitions.map(definition => ({ definition,
            result: benchmarkVariantResult(definition, candidate, benchmarkId).result }));
          const reviewed = Boolean(review?.found);
          const complete = reviewed && (review.benchmarkMissing || []).length === 0 &&
            checks.every(item => item.result !== 'not-reviewed');
          const ready = complete && review.ready === true;
          if (reviewed) stats.reviews++;
          else stats.unreviewed++;
          if (complete) stats.complete++;
          else if (reviewed) stats.incomplete++;
          if (ready) stats.ready++;
          else if (complete) stats.notReady++;
          for (const { definition, result } of checks) {
            stats.checks[definition.id][mapResult(result)]++;
            if (definition.severity === 'blocker' && result === 'repair') stats.blockerRepairs++;
          }
          if (Number.isSafeInteger(review?.reviewMs) && review.reviewMs >= 0) {
            stats.reviewMsSamples++;
            stats.reviewMsTotal += review.reviewMs;
          }
          current[variant] = { complete, ready };
        }
        if (!current.A.complete || !current.B.complete) paired.notComparable++;
        else if (current.A.ready && current.B.ready) paired.bothReady++;
        else if (current.A.ready) paired.aOnlyReady++;
        else if (current.B.ready) paired.bOnlyReady++;
        else paired.neitherReady++;
      }
      for (const variant of ['A', 'B']) variants[variant].unreviewed = Math.max(variants[variant].unreviewed,
        runs.length - variants[variant].reviews);
      return { replicateCount: runs.length, paired, variants,
        modelIdentityStatus: cohort.modelIdentityStatus || 'runtime-weight-identity-unverified' };
    });
    const excludedCounts = new Map();
    for (const item of Array.isArray(repeatability.excluded) ? repeatability.excluded : []) {
      const reason = typeof item?.reason === 'string' ? item.reason : 'unknown';
      excludedCounts.set(reason, (excludedCounts.get(reason) || 0) + 1);
    }
    return { method: 'eligible-repeatability-runs; human review counts only; no composite quality score', cohorts,
      excluded: [...excludedCounts].map(([reason, count]) => ({ reason, count })) };
  }

  function audition(shots, activeIndex, navigate, download, shotBasis, reviewContext) {
    const panel = element('details');
    panel.className = 'production-optional-field production-quality';
    panel.open = true;
    panel.append(element('summary', '镜头质量基准'));
    panel.append(element('p', '三类生成镜头分开对照：表演节拍、空间动作、动作编排/特效；后期增强 是独立后期保真检查。不同模型方案摸底不计入单变量 A/B。来源状态只说明回片标记，不等于权重或画质验收。'));
    const evidenceStatusView = element('output', '正在核对已关联回片来源…');
    evidenceStatusView.dataset.evidenceStatus = 'checking';
    evidenceStatusView.setAttribute('role', 'status');
    panel.append(evidenceStatusView);
    const gate = element('details');
    gate.className = 'production-quality-gate';
    gate.append(element('summary', '本次试镜检查清单 · 不自动判片'));
    const gateList = element('ul');
    for (const [, label, hint] of qualityGate) gateList.append(element('li', `${label}：${hint}`));
    gate.append(gateList, element('p', '人物身份明显漂移、动作接触关系错误、空间轴线/门框跳变、关键表情不可读、跨帧崩坏或音画错位，都应记录为阻断问题并按时间码返修。这里是验收清单，不会自动分析视频或替你通过镜头；正式视觉验收仍按本镜候选逐项完成。'));
    panel.append(gate);
    const repeatabilityViews = new Map();
    const exclusionLabels = { 'local-test-fixture-not-quality-evidence': '本地测试素材',
      'workflow-schema-mismatch': 'A/B 节点定义版本不同', 'workflow-schema-evidence-missing': '缺少节点定义指纹',
      'latest-a-or-b-attempt-not-complete': 'A/B 未都完成', 'effective-prompt-fingerprint-missing': '缺少实际提示词指纹',
      'effective-prompt-mismatch': 'A/B 实际提示词与对照模式不符',
      'output-contract-missing': '缺少锁定输出规格', 'output-contract-mismatch': 'A/B 输出规格不同',
      'unsupported-ab-mode': '无法识别的 A/B 实验模式',
      'workflow-model-or-sampler-declarations-differ': '模型/采样声明不同', 'provider-identity-not-recorded': '未记录服务身份',
      'provider-attempt-identity-missing': '某次任务缺少服务端点指纹',
      'provider-attempt-identity-drift': 'A/B 或重试期间服务端点变化',
      'source-origin-unknown': '来源未确认', 'mixed-test-and-provider-origin': '测试与服务回片混合',
      'repair-run-not-baseline': '返修组不作基准', 'explicit-seed-not-recorded': '未记录随机种子',
      'requested-seed-not-confirmed-by-workflow-declaration': '工作流未确认随机种子',
      'executed-workflow-prompt-not-confirmed': '执行提示未与提交内容匹配', 'legacy-settings-not-snapshotted': '旧记录缺少参数快照' };
    const updateRepeatabilityViews = report => {
      for (const shot of report.shots || []) {
        const view = repeatabilityViews.get(shot.benchmarkId);
        if (!view) continue;
        const summary = shot.repeatability?.reviewSummary;
        const excluded = (summary?.excluded || []).map(item => `${exclusionLabels[item.reason] || '条件不符'} ${item.count} 组`).join('、');
        view.textContent = !summary?.cohorts?.length ?
          `重复试镜审片：尚无满足条件的真实服务样本；${excluded ? `排除原因：${excluded}。` : '测试片、来源不明和条件不一致的记录不会计入。'}` :
          '重复试镜人工结论：' + summary.cohorts.map(cohort => {
            const p = cohort.paired;
            const a = cohort.variants.A, b = cohort.variants.B;
            const duration = row => row.reviewMsSamples ? `${(row.reviewMsTotal / 1000).toFixed(1)} 秒（${row.reviewMsSamples} 次）` : '未计时';
            const modelIdentity = cohort.modelIdentityStatus === 'workflow-requested-files-hashed-runtime-unverified' ?
              '工作流引用文件已哈希、运行时加载未验证' : '仅工作流声明、运行时权重未验证';
            return `${cohort.replicateCount} 对：${modelIdentity}；两版通过 ${p.bothReady}、仅 A ${p.aOnlyReady}、仅 B ${p.bOnlyReady}、两版待修 ${p.neitherReady}、未完成 ${p.notComparable}；阻断待修 A/B ${a.blockerRepairs}/${b.blockerRepairs}；人工审片 ${duration(a)}/${duration(b)}`;
          }).join('；') + (excluded ? ` 排除原因：${excluded}。` : '');
      }
    };
    for (const [trialIndex, item] of trial.entries()) {
      const resolvedIndex = item.index ?? shots.findIndex(shot => shot.qualityBenchmarkId === item.id);
      const row = element('div');
      row.className = 'production-trial-row';
      row.append(element('strong', (item.shotNumber ? 'S' + item.shotNumber : 'S0' + (item.index + 1)) + ' · ' + item.name),
        element('p', item.study), element('p', item.variable));
      if (item.index == null && resolvedIndex < 0) row.append(element('p', '尚未绑定到本项目镜头；先在目标镜头的生成页应用 S05 专项，再记录 A/B。此处不自动创建镜头或素材。'));
      if (activeIndex === resolvedIndex && resolvedIndex >= 0) {
        row.append(element('p', item.control), element('p', item.checks));
        const specific = element('details');
        specific.className = 'production-trial-checks';
        specific.append(element('summary', '本镜可观察验收点 · 逐项按时间码记录'));
        const list = element('ul');
        for (const check of item.acceptanceChecks) {
          const line = element('li', `${check.severity === 'blocker' ? '阻断项' : '剪辑复核'}：${check.check}`);
          line.dataset.checkId = check.id;
          line.dataset.severity = check.severity;
          list.append(line);
        }
        specific.append(list);
        row.append(specific);
      }
      const actions = element('div');
      actions.className = 'production-picker';
      if (resolvedIndex >= 0) {
        actions.append(button(activeIndex === resolvedIndex ? '当前镜头' : '打开镜头', () => navigate('video', 'generation', resolvedIndex)),
          button('去审片', () => navigate('video', 'review', resolvedIndex)));
        actions.firstElementChild.disabled = activeIndex === resolvedIndex;
        if (item.id === 'shot-02-v1' || item.id === actionFxBenchmark.id) actions.append(button('去分镜看白模', () => navigate('video', 'board', resolvedIndex)));
      }
      row.append(actions);
      const repeatabilityPanel = element('details');
      repeatabilityPanel.className = 'production-repeatability-review-summary';
      const repeatabilitySummary = element('summary', '重复试镜审片统计');
      const repeatabilityView = element('p', '刷新或导出质量报告后显示人工结论统计。');
      repeatabilityPanel.append(repeatabilitySummary, repeatabilityView);
      repeatabilityViews.set(item.id, repeatabilityView);
      row.append(repeatabilityPanel);
      panel.append(row);
    }
    const postRow = element('div');
    postRow.className = 'production-trial-row';
    postRow.append(element('strong', 'S04 · 固定物件特写 · RelayVSR 后期保真'),
      element('p', postProcessBenchmark.study),
      element('p', '同一已通过源片、裁片与帧序；只比较 RelayVSR 2× 的边缘伪影、纹理稳定、帧节奏和原声同步。该项不计入视频生成三类基准。'));
    const postActions = element('div');
    postActions.className = 'production-picker';
    postActions.append(button(activeIndex === 3 ? '当前镜头' : '去画质后期', () => navigate('edit', 'finish', 3)));
    postActions.firstElementChild.disabled = activeIndex === 3;
    postRow.append(postActions);
    panel.append(postRow);
    const exportStatus = element('output');
    exportStatus.setAttribute('role', 'status');
    const exportButton = button('导出质量基准报告', async () => {
      exportButton.disabled = true;
      exportStatus.textContent = '';
      try {
        const payload = await trialReport();
        if (panel.isConnected) {
          evidenceStatusView.textContent = payload.status;
          evidenceStatusView.dataset.evidenceStatus = payload.evidenceStatus;
          updateRepeatabilityViews(payload);
          download('短剧质量基准报告.json', payload);
        }
      } catch {
        exportStatus.textContent = '验收表未导出，请重试。';
      } finally {
        exportButton.disabled = false;
      }
    });
    const exports = element('div');
    exports.className = 'production-picker';
    const refreshEvidenceStatus = async () => {
      evidenceStatusView.textContent = '正在核对已关联回片来源…';
      evidenceStatusView.dataset.evidenceStatus = 'checking';
      try {
        const report = await trialReport();
        if (!panel.isConnected) return;
        evidenceStatusView.textContent = report.status;
        evidenceStatusView.dataset.evidenceStatus = report.evidenceStatus;
        updateRepeatabilityViews(report);
      } catch {
        if (panel.isConnected) {
          evidenceStatusView.textContent = '来源状态暂时无法核对';
          evidenceStatusView.dataset.evidenceStatus = 'source-unconfirmed';
        }
      }
    };
    exports.append(button('刷新回片来源', refreshEvidenceStatus),
      button('下载质量基准 CSV', async () => {
      try {
        const report = await trialReport();
        download('短剧质量基准报告.csv', trialCsv(report));
        evidenceStatusView.textContent = report.status;
        evidenceStatusView.dataset.evidenceStatus = report.evidenceStatus;
        updateRepeatabilityViews(report);
      }
      catch { exportStatus.textContent = '验收表未导出，请重试。'; }
    }), exportButton);
    panel.append(exports, exportStatus);
    async function trialReport() {
      const actionShotIndex = shots.findIndex(shot => shot.qualityBenchmarkId === actionFxBenchmark.id);
      const actionShot = actionShotIndex >= 0 ? shots[actionShotIndex] : null;
      const latestPerformanceRun = window.arcAB.latestComparableReport(shots[1], trial[0].id);
      const latestWhiteModelRun = window.arcAB.latestComparableReport(shots[2], trial[1].id);
      const latestActionRun = actionShot ? window.arcAB.latestComparableReport(actionShot, actionFxBenchmark.id,
        actionShot.qualityBenchmarkMode === 'vfx' ? 'vfx' : 'motion') : null;
      const firstFrameRuns = window.arcGenerationLog.firstFrameTrials(shots[1]);
      const report = {
        schema: 'arc.station-trial.v3',
        status: '待实测',
        note: '本报告只规定实验与记录契约。除真实回片完成身份校验、质量门槛和人工结论外，不得将模拟结果写成画面质量结论。',
        qualityChecklist: qualityGate.map(([id, label, criterion]) => ({ id, label, criterion, requiredForTrialVerdict: true })),
        humanVerdictOnly: true,
        shots: trial.map(({ index, shotNumber, id, name, study, variable, control, checks, acceptanceChecks }) => {
          const resolvedShotIndex = index ?? actionShotIndex;
          const shot = resolvedShotIndex >= 0 ? shots[resolvedShotIndex] : {};
          const s05Mode = id === actionFxBenchmark.id && shot.qualityBenchmarkMode === 'vfx' ? 'vfx' : 'motion';
          const s05Benchmark = id === actionFxBenchmark.id && resolvedShotIndex >= 0 ?
            benchmarkForShot(reviewContext?.series?.title, 0, resolvedShotIndex, id, s05Mode) : null;
          const variants = id === actionFxBenchmark.id ? s05Mode === 'vfx' ? ['干净底片', '特效提示'] :
            ['文字动作', '加白模动作'] : trial.find(item => item.id === id).variants;
          return {
            shot: shotNumber ? 'S' + shotNumber : 'S0' + (index + 1), benchmarkId: id,
            bindingStatus: resolvedShotIndex >= 0 ? 'bound' : 'not-bound', boundShotIndex: resolvedShotIndex >= 0 ? resolvedShotIndex : null,
            name, study: s05Benchmark?.study || study, variable: s05Benchmark?.variable || variable,
            mode: id === actionFxBenchmark.id ? s05Mode : null, variantLabels: variants, control, checks,
          acceptanceChecks: acceptanceChecks.map(item => ({ ...item, verdict: null, timecodedEvidence: [],
            variants: { A: { result: 'not-reviewed', note: '', timecodedEvidence: [] },
              B: { result: 'not-reviewed', note: '', timecodedEvidence: [] } } })),
            allowedDifference: id === actionFxBenchmark.id ? [s05Mode === 'vfx' ?
              '仅 B 增加一条特效提示；A 使用干净底片要求，两版均不附白模' : '仅 B 增加静音白模动作视频'] :
              index === 1 ? ['仅 B 增加一条表演节拍提示'] : ['仅 B 增加静音白模动作视频'],
            comparability: 'controlled-single-variable',
            plannedInputs: {
              story: shot.scriptAnchor || null, plannedCutSeconds: Number(shot.duration) || null,
              composition: shot.composition, camera: shot.path,
              lighting: shot.lighting || null, references: shot.refs || [], keyframe: shot.frameAsset || null
            },
            measurements: { A: blankMeasurement(), B: blankMeasurement() },
            qualityValueOptions: ['pass', 'repair', 'not-applicable'],
            measurementFields: ['source', 'runId', 'outputName', 'returnAssetKey', 'returnFileFingerprint', 'returnContentDigest', 'returnSha256', 'rawModelReturnSha256', 'workflowHash', 'providerFingerprint', 'workflow', 'model', 'modelEvidence', 'modelFileEvidence', 'precision', 'seed', 'sampler', 'requestedSeconds',
            'actualSeconds', 'width', 'height', 'frameCount', 'codec', 'frameRateMode', 'hasAudio', 'audioTrackCount', 'audioTracks', 'audioVideoDurationDeltaSeconds', 'expectedWidth', 'expectedHeight', 'fps', 'expectedFps',
            'sourceFrames', 'sourceFps', 'rawReturnFrames', 'rawReturnFps', 'rawCadencePreserved',
            'usableRanges', 'queueMs', 'processingMs', 'latestQueueMs', 'latestProcessingMs',
            'timingAttempts', 'timingCoverage', 'retries', 'reviewMs',
              'quality.identity', 'quality.acting', 'quality.contact', 'quality.space', 'quality.camera', 'quality.light',
              'quality.temporal', 'quality.sound', 'fatalIssues', 'reviewNotes'],
            verdict: null
          };
        })
      };
      if (latestPerformanceRun) {
        const current = await shotBasis('S02');
        const status = shotBasisStatus(latestPerformanceRun, current);
        report.shots[0].latestPerformanceRun = {
          ...latestPerformanceRun,
          shotBasisStatus: status
        };
        report.shots[0].candidateReviews = Object.fromEntries(['A', 'B'].map(variant => [variant,
          pairedCandidateReviewEvidence(shots[1], reviewContext, latestPerformanceRun, variant,
            benchmarkForShot(reviewContext?.series?.title, 0, 1, trial[0].id, 'performance'))]));
        if (status === 'current') {
          for (const variant of ['A', 'B']) report.shots[0].measurements[variant] = basisBoundMeasurement(
            latestPerformanceRun, current, variant, report.shots[0].candidateReviews[variant].at(-1),
            latestPerformanceRun.plannedSeconds).measurement;
        }
      }
      report.shots[0].repeatability = window.arcAB.repeatability(shots[1]);
      for (const cohort of report.shots[0].repeatability.cohorts) for (const run of cohort.runs) {
        run.candidateReviews = Object.fromEntries(['A', 'B'].map(variant => [variant,
          pairedCandidateReviewEvidence(shots[1], reviewContext, run, variant,
            benchmarkForShot(reviewContext?.series?.title, 0, 1, trial[0].id, 'performance'))]));
      }
      report.shots[0].repeatability.reviewSummary = repeatabilityReviewSummary(report.shots[0].repeatability,
        trial[0].acceptanceChecks, trial[0].id);
      if (firstFrameRuns.some(Boolean)) {
        report.exploratoryComparisons = [{
          id: 'shot-01-model-screen-v1', name: 'S02 生成方案摸底',
          comparability: 'exploratory-multivariable',
          interpretationLimit: '不同模型或官方工作流的摸底可能同时改变模型、采样与参数；只用于后续选型，不计入 S02 表演提示单变量 A/B。',
          firstFrameComparison: {
          sameInputs: firstFrameInputsMatch(firstFrameRuns),
          A: firstFrameRuns[0], B: firstFrameRuns[1]
          }, candidateReviews: {
            A: firstFrameRuns[0] ? candidateReviewEvidence(shots[1], reviewContext, { jobId: firstFrameRuns[0].id }) : [],
            B: firstFrameRuns[1] ? candidateReviewEvidence(shots[1], reviewContext, { jobId: firstFrameRuns[1].id }) : []
          }, measurements: { A: blankMeasurement(), B: blankMeasurement() }
        }];
        for (const [index, variant] of ['A', 'B'].entries()) {
          const exploratory = report.exploratoryComparisons[0];
          exploratory.measurements[variant] = frameMeasurement(firstFrameRuns[index],
            exploratory.candidateReviews[variant].at(-1), firstFrameRuns[index]?.outputContract?.seconds);
        }
      }
      if (latestWhiteModelRun) {
        const current = await shotBasis('S03');
        const status = shotBasisStatus(latestWhiteModelRun, current);
        report.shots[1].latestWhiteModelRun = {
          ...latestWhiteModelRun,
          shotBasisStatus: status
        };
        report.shots[1].candidateReviews = Object.fromEntries(['A', 'B'].map(variant => [variant,
          pairedCandidateReviewEvidence(shots[2], reviewContext, latestWhiteModelRun, variant,
            benchmarkForShot(reviewContext?.series?.title, 0, 2))]));
        if (status === 'current') {
          for (const variant of ['A', 'B']) report.shots[1].measurements[variant] = basisBoundMeasurement(
            latestWhiteModelRun, current, variant, report.shots[1].candidateReviews[variant].at(-1),
            latestWhiteModelRun.plannedSeconds).measurement;
        }
      }
      report.shots[1].repeatability = window.arcAB.repeatability(shots[2]);
      for (const cohort of report.shots[1].repeatability.cohorts) for (const run of cohort.runs) {
        run.candidateReviews = Object.fromEntries(['A', 'B'].map(variant => [variant,
          pairedCandidateReviewEvidence(shots[2], reviewContext, run, variant,
            benchmarkForShot(reviewContext?.series?.title, 0, 2))]));
      }
      report.shots[1].repeatability.reviewSummary = repeatabilityReviewSummary(report.shots[1].repeatability,
        trial[1].acceptanceChecks, trial[1].id);
      if (actionShot) {
        report.shots[2].repeatability = window.arcAB.repeatability(actionShot);
        for (const cohort of report.shots[2].repeatability.cohorts) for (const run of cohort.runs) {
          run.candidateReviews = Object.fromEntries(['A', 'B'].map(variant => [variant,
            pairedCandidateReviewEvidence(actionShot, reviewContext, run, variant,
              benchmarkForShot(reviewContext?.series?.title, 0, actionShotIndex, actionFxBenchmark.id,
                actionShot.qualityBenchmarkMode || 'motion'))]));
        }
        report.shots[2].repeatability.reviewSummary = repeatabilityReviewSummary(report.shots[2].repeatability,
          actionFxBenchmark.acceptanceChecks, actionFxBenchmark.id);
      }
      if (actionShot && latestActionRun) {
        const current = await shotBasis('S' + String(actionShotIndex + 1).padStart(2, '0'));
        const status = shotBasisStatus(latestActionRun, current);
        report.shots[2].latestActionRun = { ...latestActionRun, shotBasisStatus: status };
        report.shots[2].candidateReviews = Object.fromEntries(['A', 'B'].map(variant => [variant,
          pairedCandidateReviewEvidence(actionShot, reviewContext, latestActionRun, variant,
            benchmarkForShot(reviewContext?.series?.title, 0, actionShotIndex, actionFxBenchmark.id,
              actionShot.qualityBenchmarkMode || 'motion'))]));
        if (status === 'current') {
          for (const variant of ['A', 'B']) report.shots[2].measurements[variant] = basisBoundMeasurement(
            latestActionRun, current, variant, report.shots[2].candidateReviews[variant].at(-1),
            latestActionRun.plannedSeconds).measurement;
        }
      }
      report.postProcessing = { shot: 'S04', name: postProcessBenchmark.name, study: postProcessBenchmark.study,
        benchmarkId: 'relayvsr-2x-source-fidelity-v1', acceptanceChecks: postProcessBenchmark.acceptanceChecks.map(item => ({ ...item })),
        measurements: { A: blankMeasurement(), B: blankMeasurement() }, candidateReviews: { A: [], B: [] }, verdict: null };
      report.postProcessing.enhancementCandidates = enhancementReviewEvidence(shots[3], reviewContext,
        benchmarkForShot(reviewContext?.series?.title, 0, 3));
      const enhancement = report.postProcessing.enhancementCandidates.at(-1);
      if (enhancement) {
        report.postProcessing.candidateReviews.A = enhancement.sourceJobId ? candidateReviewEvidence(shots[3], reviewContext, {
          jobId: enhancement.sourceJobId, benchmark: benchmarkForShot(reviewContext?.series?.title, 0, 3) }) : [];
        Object.assign(report.postProcessing.measurements.A, {
          source: enhancement.testFixture === true ? 'local-test' : enhancement.testFixture === false ? 'configured-provider' : 'unknown',
          runId: enhancement.sourceJobId || null, outputName: enhancement.sourceName || null,
          returnSha256: enhancement.sourceSha256 || null
        });
        const processed = report.postProcessing.measurements.B;
        Object.assign(processed, {
          source: enhancement.testFixture === true ? 'local-test' : enhancement.testFixture === false ? 'configured-provider' : 'unknown',
          runId: enhancement.taskId || null, outputName: enhancement.finalOutputName || null,
          returnSha256: enhancement.finalOutputSha256 || null, rawModelReturnSha256: enhancement.outputSha256 || null,
          workflowHash: enhancement.workflowSha256 || null, providerFingerprint: enhancement.providerFingerprint || null,
          workflow: 'RelayVSR 2×', requestedSeconds: enhancement.output?.duration ?? null,
          actualSeconds: enhancement.output?.duration ?? null, width: enhancement.output?.width ?? null,
          height: enhancement.output?.height ?? null, fps: enhancement.output?.fps ?? null,
          expectedFps: enhancement.output?.fps ?? null,
          sourceFrames: enhancement.cadence?.sourceFrames ?? null,
          sourceFps: enhancement.cadence?.sourceFps ?? null,
          rawReturnFrames: enhancement.cadence?.rawReturnFrames ?? null,
          rawReturnFps: enhancement.cadence?.rawReturnFps ?? null,
          rawCadencePreserved: enhancement.cadence?.preserved ?? null,
          queueMs: enhancement.timing?.queueMs ?? null,
          processingMs: enhancement.timing?.executionMs ?? null,
          latestQueueMs: enhancement.timing?.latestQueueMs ?? null,
          latestProcessingMs: enhancement.timing?.latestExecutionMs ?? null,
          timingAttempts: enhancement.timing?.attempts ?? null,
          timingCoverage: enhancement.timing?.historyComplete ? 'complete-retry-history' : 'incomplete-history',
          retries: enhancement.retries ?? null
        });
        attachReview(processed, enhancement);
        if (enhancement.artReview) report.postProcessing.candidateReviews.B = [{ candidateVersion: enhancement.candidateVersion,
          file: enhancement.finalOutputName, jobId: enhancement.taskId, outputSha256: enhancement.finalOutputSha256,
          testFixture: enhancement.testFixture, review: { found: enhancement.artReview.found, stale: enhancement.artReview.stale,
            ready: enhancement.artReview.approval?.ready, checks: enhancement.artReview.checks,
            issues: enhancement.artReview.approval?.issues, benchmarkId: enhancement.artReview.benchmarkId,
            benchmarkChecks: enhancement.artReview.benchmarkChecks || [], benchmarkMissing: enhancement.artReview.benchmarkMissing || [] } }];
      }
      for (let shotIndex = 0; shotIndex < report.shots.length; shotIndex++) {
        const row = report.shots[shotIndex];
        for (const variant of ['A', 'B']) {
          const candidate = row.candidateReviews?.[variant]?.at(-1);
          for (const check of row.acceptanceChecks) {
            check.variants[variant] = benchmarkVariantResult(check, candidate, trial[shotIndex].id);
          }
        }
      }
      Object.assign(report, evidenceStatus(firstFrameRuns, latestWhiteModelRun, report.postProcessing.enhancementCandidates));
      return report;
    }
    void refreshEvidenceStatus();
    return panel;
  }

  function matchesVideo(video, contract) {
    if (!contract) return true;
    const seconds = contract.seconds ?? contract.frames / contract.fps;
    return video.videoWidth === contract.width && video.videoHeight === contract.height &&
      Number.isFinite(video.duration) && Math.abs(video.duration - seconds) <= (contract.tolerance ?? .12);
  }

  function evaluateMediaContract(video, contract, metadata) {
    if (!contract) return { status: 'pass', issues: [] };
    if (!matchesVideo(video, contract)) return { status: 'mismatch', issues: ['尺寸或时长不符合工作流输出契约'] };
    const needsContainer = Number.isInteger(contract.frames) || Number.isFinite(contract.fps);
    if (!needsContainer) return { status: 'pass', issues: [] };
    if (!metadata || metadata.source !== 'mp4-stts') return { status: 'unverified', issues: ['尚未读取 MP4 帧数与帧率'] };
    const issues = [];
    if (Number.isInteger(contract.frames) && metadata.frameCount !== contract.frames) {
      issues.push(`帧数 ${metadata.frameCount}，预期 ${contract.frames}`);
    }
    if (Number.isFinite(contract.fps) && Math.abs(metadata.fps - contract.fps) > (contract.fpsTolerance ?? .05)) {
      issues.push(`帧率 ${metadata.fps}，预期 ${contract.fps} fps`);
    }
    if (Number.isFinite(contract.fps) && metadata.frameRateMode !== 'constant') {
      issues.push(`帧率模式 ${metadata.frameRateMode || '未知'}，预期恒定帧率`);
    }
    return { status: issues.length ? 'mismatch' : 'pass', issues };
  }

  async function inspectOutputVideo(video, contract) {
    if (!contract || !matchesVideo(video, contract)) return evaluateMediaContract(video, contract);
    if (!Number.isInteger(contract.frames) && !Number.isFinite(contract.fps)) return evaluateMediaContract(video, contract);
    if (!window.arcMp4Metadata?.read || !video.currentSrc) return evaluateMediaContract(video, contract);
    try {
      const metadata = await window.arcMp4Metadata.read(video.currentSrc);
      return { ...evaluateMediaContract(video, contract, metadata), metadata };
    } catch {
      return evaluateMediaContract(video, contract);
    }
  }

  function checkVideo(video, status, contract, ready) {
    if (!contract) return;
    const seconds = contract.seconds ?? contract.frames / contract.fps;
    const expected = `${contract.width}×${contract.height} · ${seconds.toFixed(2)} 秒`;
    ready(false);
    status.textContent = '等待回片检查 · 预期 ' + expected;
    let generation = 0;
    video.addEventListener('loadedmetadata', () => {
      const current = ++generation;
      ready(false);
      status.textContent = '尺寸、时长已读 · 正在核对帧数与帧率…';
      inspectOutputVideo(video, contract).then(result => {
        if (current !== generation || !video.isConnected) return;
        const passed = result.status === 'pass';
        const cadence = result.metadata ? ` · ${result.metadata.frameCount} 帧 · ${result.metadata.fps} fps · ${result.metadata.frameRateMode}` : '';
        const avLength = Number.isFinite(result.metadata?.audioVideoDurationDeltaSeconds) ?
          ` · 音画轨最大时长差 ${result.metadata.audioVideoDurationDeltaSeconds.toFixed(3)} 秒（只比长度，不代表同步）` : '';
        status.textContent = (passed ? '输出规格已核对 · ' : result.issues.join('；') + ' · ') +
          `${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(2)} 秒${cadence}${avLength} · 预期 ${expected}`;
        ready(passed);
      });
    });
    video.addEventListener('error', () => {
      generation++;
      ready(false);
      status.textContent = '无法读取回片。';
    });
  }

  function readVideoFile(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      const timeout = setTimeout(() => finish(new Error('读取视频信息超时。')), 10000);
      function finish(error) {
        clearTimeout(timeout);
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      }
      video.onloadedmetadata = () => finish();
      video.onerror = () => finish(new Error('无法读取视频信息。'));
      video.preload = 'metadata';
      video.src = url;
    });
  }

  async function checkMotion(file) {
    const meta = await readVideoFile(file);
    if (!Number.isFinite(meta.duration) || meta.duration < 2 || meta.duration > 15) {
      throw new Error('Pika H3 白模参考须为 2–15 秒视频。');
    }
    return file;
  }

  function firstFrameComparison(shot, save) {
    const panel = element('details');
    panel.className = 'production-history first-frame-comparison';
    panel.append(element('summary', 'S02 生成方案摸底 · 非单变量对照'));
    const description = element('p');
    const feedback = element('output');
    feedback.setAttribute('role', 'status');
    const grid = element('div');
    grid.className = 'generation-ab-versions';
    const controller = new AbortController();
    let lastKey;
    let playback;
    function refresh() {
      const runs = window.arcGenerationLog.firstFrameTrials(shot);
      const key = JSON.stringify(runs);
      if (key === lastKey) return;
      lastKey = key;
      playback?.dispose();
      playback = undefined;
      grid.hidden = true;
      grid.replaceChildren();
      load.disabled = runs.some(run => !run);
      description.textContent = load.disabled ? '此工具比较基础 H3 与 Pika H3 首帧采样方案，只用于方案筛选；模型和官方采样设置可能同时变化，结果不计入单变量质量 A/B。两条均有回片后可同步查看。' :
        firstFrameInputsMatch(runs) ?
          '已核对两版提交的首帧、提示词、种子、分辨率和帧数一致。' :
          runs.some(run => !/^[a-f0-9]{64}$/.test(run.firstFrameProof || '')) ?
            '缺少有效条件指纹，无法确认两版输入是否一致；请重新提交同一输入后再比较。' :
          '两版提交的输入条件有差异，可以回看，评估差异前请重新使用相同输入生成。';
      feedback.textContent = '';
    }
    const load = button('载入两版回片', async () => {
      const runs = window.arcGenerationLog.firstFrameTrials(shot);
      const key = lastKey;
      load.disabled = true;
      feedback.textContent = '正在核对两条回片的来源…';
      try {
        const jobs = await Promise.all(runs.map(async run => {
          const response = await fetch('/api/generation/' + encodeURIComponent(run.id), {
            cache: 'no-store', signal: controller.signal
          });
          const job = await response.json();
          const clip = job.outputs?.[0];
          if (!response.ok || !firstFrameReturnMatches(run, job, clip)) {
            throw new Error('对应工作流的回片暂时无法核对。');
          }
          return { job, clip };
        }));
        if (!panel.isConnected || lastKey !== key) return;
        playback?.dispose();
        grid.replaceChildren();
        const players = jobs.map(({ job, clip }, index) => {
          const card = element('section');
          const player = element('video');
          player.controls = true;
          player.preload = 'metadata';
          const status = element('p');
          const seconds = ms => Number.isSafeInteger(ms) ? (ms / 1000).toFixed(2) + ' 秒' : '待记录';
          const total = runs[index].cumulativeTiming;
          card.append(element('h4', index === 0 ? 'A · 基础 H3' : 'B · Pika H3 Flex'),
            element('p', firstFrameOriginLabel(runs[index], job, clip)),
            element('p', `留存记录累计排队 ${seconds(total?.queueMs)}、执行 ${seconds(total?.executionMs)} · 最近一次排队 ${seconds(total?.latestQueueMs)}、执行 ${seconds(total?.latestExecutionMs)} · 记录内复跑 ${runs[index].retryCount} 次`),
            player, status);
          player.addEventListener('loadedmetadata', () => {
            const measured = { seconds: player.duration, width: player.videoWidth, height: player.videoHeight };
            window.arcGenerationLog?.recordMedia(shot, job.id, clip.assetKey, measured, save);
            window.arcMp4Metadata?.read(player.currentSrc).then(metadata => {
              if (!metadata || !panel.isConnected || lastKey !== key) return;
              window.arcGenerationLog?.recordMedia(shot, job.id, clip.assetKey, { ...measured, ...metadata }, save);
              const currentRuns = window.arcGenerationLog.firstFrameTrials(shot);
              if (currentRuns.every((run, index) => run?.id === runs[index]?.id)) {
                playback?.setAudioAvailability(currentRuns.map(trialAudioAvailability));
              }
            });
          }, { once: true });
          checkVideo(player, status, job.outputContract, () => {});
          player.src = clip.url + '?' + new URLSearchParams({ file: clip.name, asset: clip.assetKey });
          grid.append(card);
          return player;
        });
        playback = window.arcCompare.create(...players, { audioChoice: true,
          audioLabels: ['A · 基础 H3', 'B · Pika H3 Flex'] });
        playback.setAudioAvailability(runs.map(trialAudioAvailability));
        grid.append(playback.panel);
        grid.hidden = false;
        feedback.textContent = '';
      } catch (error) { if (lastKey === key && panel.isConnected) feedback.textContent = error.message; }
      finally { if (lastKey === key) load.disabled = false; }
    });
    panel.append(description, load, feedback, grid);
    refresh();
    return { panel, refresh, dispose() { controller.abort(); playback?.dispose(); } };
  }

  const api = { shortcuts, audition, actionFxTemplate, matchesVideo, checkVideo, readVideoFile, checkMotion,
    firstFrameComparison, candidateReviewEvidence, pairedCandidateReviewEvidence, pairedRunAttempt,
    enhancementReviewEvidence, benchmarkForShot, benchmarkVariantResult,
    evidenceStatus, reviewStatusLabel, repeatabilityReviewSummary,
    evaluateMediaContract, inspectOutputVideo, pairedTiming, pairedMeasurement, usableRangeSummary, shotBasisStatus,
    basisBoundMeasurement, trialAudioAvailability, firstFrameReturnMatches, firstFrameOriginLabel, firstFrameInputsMatch, trialCsv };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    if (typeof window !== 'undefined') window.arcProductionQuality = api;
  } else window.arcProductionQuality = api;
})();
