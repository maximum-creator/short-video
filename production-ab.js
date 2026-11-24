(() => {
  const variants = ['A', 'B'];
  const terminal = new Set(['complete', 'failed', 'no_video', 'rejected']);
  const labels = { submitting: '提交中', queued: '排队中', running: '生成中', awaiting: '等待上游状态',
    complete: '已回片', failed: '生成失败', no_video: '完成但无视频', unconfirmed: '提交结果待确认',
    rejected: '请求未提交' };
  const idPattern = /^[a-f0-9-]{36}$/i;
  const digestPattern = /^[a-f0-9]{64}$/;
  const presetPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
  function motionReferenceEvidence(value) {
    return value?.source === 'mp4-stts' && Number.isSafeInteger(value.frameCount) && value.frameCount > 0 &&
      Number.isFinite(value.durationSeconds) && value.durationSeconds > 0 && value.fps === 24 &&
      value.frameRateMode === 'constant' && (value.codec == null || typeof value.codec === 'string') &&
      typeof value.hasAudio === 'boolean' && Number.isSafeInteger(value.audioTrackCount) && value.audioTrackCount >= 0 ?
      { source: value.source, frameCount: value.frameCount, durationSeconds: value.durationSeconds, fps: value.fps,
        frameRateMode: value.frameRateMode, codec: value.codec ?? null, hasAudio: value.hasAudio,
        audioTrackCount: value.audioTrackCount } : null;
  }
  function safeModelFileEvidence(value, providerFingerprint, workflowSha256) {
    const isV3 = value?.schema === 'arc-comfy-model-files-v3';
    if (value?.status !== 'file-bytes-matched-runtime-unverified' ||
        value?.evidence !== 'workflow-requested-files-present-and-hashed' || value.runtimeLoadedVerified !== false ||
        !digestPattern.test(value.workflowSha256 || '') || !digestPattern.test(workflowSha256 || '') ||
        value.workflowSha256 !== workflowSha256 ||
        !isV3 || !digestPattern.test(value.modelSetSha256 || '') ||
        !digestPattern.test(value.providerFingerprint || '') || value.providerFingerprint !== providerFingerprint ||
        value.providerBinding !== 'operator-supplied-endpoint-fingerprint' ||
        !Array.isArray(value.models) || !value.models.length || value.models.length > 256) return null;
    const models = value.models.map(model => {
      if (!/^[\w.-]{1,170}$/.test(model?.node || '') || !/^[\w.-]{1,170}$/.test(model.classType || '') ||
          !/^[\w.-]{1,170}$/.test(model.field || '') ||
          !/^[\w.-]{1,170}\.(?:safetensors|gguf|ckpt|pt|bin)$/i.test(model.file || '') ||
          !Number.isSafeInteger(model.sizeBytes) || model.sizeBytes < 1 || !digestPattern.test(model.sha256 || '')) return null;
      return { node: model.node, classType: model.classType, field: model.field, file: model.file,
        sizeBytes: model.sizeBytes, sha256: model.sha256 };
    });
    if (models.some(model => !model)) return null;
    return { schema: value.schema, status: value.status,
      evidence: value.evidence, workflowSha256: value.workflowSha256,
      modelSetSha256: value.modelSetSha256, providerFingerprint: value.providerFingerprint,
      providerBinding: value.providerBinding,
      runtimeLoadedVerified: false, models };
  }
  const outputFor = (id, item) => {
    let url;
    try { url = new URL(item?.url || '', 'http://127.0.0.1'); } catch { return undefined; }
    if (url.pathname !== `/api/generation/${id}/video/0` ||
        (url.searchParams.has('preset') && !presetPattern.test(url.searchParams.get('preset')))) return undefined;
    return {
    url: url.pathname + (url.searchParams.has('preset') ? `?preset=${encodeURIComponent(url.searchParams.get('preset'))}` : ''),
    ...(typeof item.name === 'string' && digestPattern.test(item.assetKey || '') ?
      { name: item.name, assetKey: item.assetKey } : {}),
    ...(digestPattern.test(item.sha256 || '') && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes > 0 ?
      { sha256: item.sha256, sizeBytes: item.sizeBytes } : {}),
    ...(typeof item.testFixture === 'boolean' ? { testFixture: item.testFixture } : {})
  }; };
  const sourceOriginConsistent = (job, output) => !(typeof job?.testFixture === 'boolean' &&
    typeof output?.testFixture === 'boolean' && job.testFixture !== output.testFixture);
  const checkedOutput = (id, job) => {
    const output = job?.outputs?.[0];
    if (!output || !sourceOriginConsistent(job, output)) return undefined;
    return outputFor(id, { ...output, ...(typeof output.testFixture === 'boolean' ? {} :
      typeof job.testFixture === 'boolean' ? { testFixture: job.testFixture } : {}) });
  };
  const latestFor = (pair, variant) => pair.attempts[variant].findLast(attempt => attempt.output);
  function outputAudioAvailability(attempt) {
    const media = attempt?.media;
    if (!attempt?.output?.assetKey || media?.assetKey !== attempt.output.assetKey) return null;
    if (typeof media.hasAudio === 'boolean') return media.hasAudio;
    return Number.isSafeInteger(media.audioTrackCount) ? media.audioTrackCount > 0 : null;
  }
  const pairMode = pair => ['vfx', 'performance', 'parameter'].includes(pair.mode) ? pair.mode : 'motion';
  const supportedMode = pair => pair.mode == null || ['motion', 'vfx', 'performance', 'parameter'].includes(pair.mode);
  const validOutputContract = value => value && typeof value === 'object' && !Array.isArray(value) &&
    Number.isSafeInteger(value.width) && value.width > 0 && Number.isSafeInteger(value.height) && value.height > 0 &&
    ((Number.isFinite(value.seconds) && value.seconds > 0) || (Number.isSafeInteger(value.frames) && value.frames > 0 &&
      Number.isFinite(value.fps) && value.fps > 0));
  function actualOutputContractStatus(attempt) {
    const contract = attempt?.outputContract, media = attempt?.media;
    if (!validOutputContract(contract) || !attempt?.output?.assetKey || media?.assetKey !== attempt.output.assetKey) return 'unverified';
    if (!Number.isSafeInteger(media.width) || media.width < 1 || !Number.isSafeInteger(media.height) || media.height < 1 ||
        !Number.isFinite(media.seconds) || media.seconds <= 0) return 'unverified';
    const seconds = contract.seconds ?? contract.frames / contract.fps;
    if (media.width !== contract.width || media.height !== contract.height ||
        Math.abs(media.seconds - seconds) > (Number.isFinite(contract.tolerance) ? contract.tolerance : .12)) return 'mismatch';
    if (Number.isSafeInteger(contract.frames) || Number.isFinite(contract.fps)) {
      if (media.source !== 'mp4-stts' || !Number.isSafeInteger(media.frameCount) ||
          !Number.isFinite(media.fps) || !['constant', 'variable-or-mixed'].includes(media.frameRateMode)) return 'unverified';
      if ((Number.isSafeInteger(contract.frames) && media.frameCount !== contract.frames) ||
          (Number.isFinite(contract.fps) && Math.abs(media.fps - contract.fps) >
            (Number.isFinite(contract.fpsTolerance) ? contract.fpsTolerance : .05)) ||
          media.frameRateMode !== 'constant') return 'mismatch';
    }
    return 'pass';
  }
  const motionMode = pair => pairMode(pair) === 'motion';
  const cueMode = pair => ['vfx', 'performance'].includes(pairMode(pair));
  const parameterMode = pair => pairMode(pair) === 'parameter';
  const parameterControlName = id => id === 'diffusion-weight' ? '扩散权重' : '采样调度';
  const parameterBenchmarkId = id => id === 'diffusion-weight' ? 'h3-ref2va-weight-v1' : 'h3-ref2va-scheduler-v1';
  const variantLabel = (mode, variant) => mode === 'vfx' ? (variant === 'A' ? '干净底片' : '特效提示') :
    mode === 'performance' ? (variant === 'A' ? '基础表演提示' : '表演节拍提示') :
      mode === 'parameter' ? (variant === 'A' ? '参数 A' : '参数 B') :
      (variant === 'A' ? '文字动作' : '白模动作');
  const pairVariantLabel = (pair, variant) => parameterMode(pair) ? pair.parameterDiff?.labels?.[variant] || variantLabel('parameter', variant) :
    variantLabel(pairMode(pair), variant);
  function sourceSummary(attempts, key) {
    const values = attempts.map(attempt => attempt.timing?.[key] ?? null);
    const known = values.filter(value => value === 'comfy-history-timestamps' || value === 'local-bridge-observation');
    if (!known.length) return null;
    if (known.length !== values.length) return 'incomplete';
    return new Set(known).size === 1 ? known[0] : 'mixed';
  }
  function timingSummary(list) {
    const attempts = list.filter(attempt => attempt.status !== 'rejected');
    const latest = attempts.at(-1);
    const queueSource = sourceSummary(attempts, 'queueSource');
    const executionSource = sourceSummary(attempts, 'executionSource');
    const total = key => attempts.length && attempts.every(attempt => Number.isFinite(attempt.timing?.[key]) && attempt.timing[key] >= 0) ?
      attempts.reduce((sum, attempt) => sum + attempt.timing[key], 0) : null;
    return { attempts, latest, queueSource, executionSource,
      queueMs: queueSource === 'mixed' ? null : total('queueMs'),
      executionMs: executionSource === 'mixed' ? null : total('executionMs'),
      retries: latest ? window.arcABReview.retryCount(list, latest.id) : 0 };
  }
  const fingerprint = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ?
    Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const seedKey = key => /^(seed|noise[_-]?seed|random[_-]?seed)$/i.test(key);
  function attemptLedger(list) {
    const billable = list.filter(attempt => attempt.status !== 'rejected');
    const queueSource = sourceSummary(billable, 'queueSource');
    const executionSource = sourceSummary(billable, 'executionSource');
    const total = key => billable.length && billable.every(attempt => Number.isFinite(attempt.timing?.[key]) && attempt.timing[key] >= 0) ?
      billable.reduce((sum, attempt) => sum + attempt.timing[key], 0) : null;
    return { retryCount: Math.max(0, billable.length - 1), queueMs: queueSource === 'mixed' ? null : total('queueMs'),
      executionMs: executionSource === 'mixed' ? null : total('executionMs'), queueSource, executionSource,
      gpuKernelTime: billable.length && billable.every(attempt => attempt.timing?.gpuKernelTime === false) ? false : null,
      attempts: list.map(attempt => ({ jobId: attempt.id, status: attempt.status,
        ...(presetPattern.test(attempt.preset || '') ? { preset: attempt.preset } : {}),
        queueMs: attempt.timing?.queueMs ?? null, executionMs: attempt.timing?.executionMs ?? null,
        queueSource: attempt.timing?.queueSource ?? null, executionSource: attempt.timing?.executionSource ?? null,
        bridgeMs: attempt.timing?.bridgeMs ?? null, bridgeSource: attempt.timing?.bridgeSource ?? null,
        gpuKernelTime: typeof attempt.timing?.gpuKernelTime === 'boolean' ? attempt.timing.gpuKernelTime : null,
        effectivePromptSha256: digestPattern.test(attempt.effectivePromptSha256 || '') ? attempt.effectivePromptSha256 : null,
        outputContract: validOutputContract(attempt.outputContract) ? attempt.outputContract : null,
        outputMediaContractStatus: actualOutputContractStatus(attempt),
        actualMedia: attempt.media && attempt.output?.assetKey && attempt.media.assetKey === attempt.output.assetKey ? {
          assetKey: attempt.media.assetKey, source: attempt.media.source || null,
          seconds: Number.isFinite(attempt.media.seconds) ? attempt.media.seconds : null,
          width: Number.isSafeInteger(attempt.media.width) ? attempt.media.width : null,
          height: Number.isSafeInteger(attempt.media.height) ? attempt.media.height : null,
          frameCount: Number.isSafeInteger(attempt.media.frameCount) ? attempt.media.frameCount : null,
          fps: Number.isFinite(attempt.media.fps) ? attempt.media.fps : null,
          frameRateMode: attempt.media.frameRateMode || null
        } : null,
        outputIdentity: digestPattern.test(attempt.output?.sha256 || '') &&
          Number.isSafeInteger(attempt.output?.sizeBytes) && attempt.output.sizeBytes > 0 ? {
            evidence: 'full-upstream-video-bytes-sha256', sha256: attempt.output.sha256, sizeBytes: attempt.output.sizeBytes
          } : { evidence: attempt.output?.assetKey ? 'provider-output-asset-key-only' : 'missing', sha256: null, sizeBytes: null },
        outputAssetKey: attempt.output?.assetKey || null, testFixture: attempt.testFixture === true || attempt.output?.testFixture === true,
        providerFingerprint: digestPattern.test(attempt.providerFingerprint || '') ? attempt.providerFingerprint : null,
        preflightEvidence: attempt.preflightEvidence || null,
        workflowDeclaration: attempt.workflowDeclaration || null,
        executionPromptEvidence: attempt.executionPromptEvidence || null })) };
  }
  function repeatability(record) {
    const eligible = [];
    const excluded = [];
    for (const pair of readPairs(record)) {
      if (!supportedMode(pair)) {
        excluded.push({ pairId: pair.id, reason: 'unsupported-ab-mode', variants: {
          A: attemptLedger(pair.attempts.A), B: attemptLedger(pair.attempts.B) } });
        continue;
      }
      if (parameterMode(pair)) {
        excluded.push({ pairId: pair.id, reason: 'parameter-pair-not-seed-repeatability-cohort', variants: {
          A: attemptLedger(pair.attempts.A), B: attemptLedger(pair.attempts.B) } });
        continue;
      }
      const controls = pair.settingsSnapshot?.effectiveControls;
      const seedEntry = controls && Object.entries(controls).find(([key, value]) => seedKey(key) &&
        value !== '' && value != null && Number.isFinite(Number(value)));
      const latest = Object.fromEntries(variants.map(variant => [variant, pair.attempts[variant].at(-1)]));
      const complete = variants.every(variant => latest[variant]?.status === 'complete' && latest[variant]?.output?.assetKey);
      const schemaHashes = Object.fromEntries(variants.map(variant => [variant, latest[variant]?.preflightEvidence?.schemaSha256 || null]));
      const schemaEvidenceValid = variants.every(variant => digestPattern.test(schemaHashes[variant] || ''));
      const sameSchema = schemaEvidenceValid && schemaHashes.A === schemaHashes.B;
      const origins = variants.map(variant => {
        const run = latest[variant];
        if (pair.testFixture === true || run?.testFixture === true || run?.output?.testFixture === true) return 'local-test';
        if (pair.testFixture === false || run?.testFixture === false) return 'configured-provider';
        return 'unknown';
      });
      const sameOrigin = origins[0] === origins[1] && origins[0] !== 'unknown';
      const providerIdentityValid = digestPattern.test(pair.providerFingerprint || '');
      const billableAttempts = variants.flatMap(variant => pair.attempts[variant].filter(attempt => attempt.status !== 'rejected'));
      const providerAttemptIdentityMissing = !billableAttempts.length || billableAttempts.some(attempt =>
        !digestPattern.test(attempt.providerFingerprint || ''));
      const providerAttemptIdentityDrift = !providerAttemptIdentityMissing && billableAttempts.some(attempt =>
        attempt.providerFingerprint !== pair.providerFingerprint);
      const modelIdentityStatus = pair.modelFileEvidence ?
        'workflow-requested-files-hashed-runtime-unverified' : 'workflow-declaration-only-runtime-unverified';
      const ledgers = Object.fromEntries(variants.map(variant => [variant, attemptLedger(pair.attempts[variant])]));
      const effectivePrompts = Object.fromEntries(variants.map(variant => [variant, latest[variant]?.effectivePromptSha256 || null]));
      const effectivePromptsValid = variants.every(variant => digestPattern.test(effectivePrompts[variant] || ''));
      const effectivePromptRelationValid = effectivePromptsValid && (motionMode(pair) ?
        effectivePrompts.A === effectivePrompts.B : effectivePrompts.A !== effectivePrompts.B);
      const outputContracts = Object.fromEntries(variants.map(variant => [variant, latest[variant]?.outputContract || null]));
      const outputContractsValid = variants.every(variant => validOutputContract(outputContracts[variant]));
      const sameOutputContract = outputContractsValid && stable(outputContracts.A) === stable(outputContracts.B);
      const actualOutputContracts = Object.fromEntries(variants.map(variant => [variant, actualOutputContractStatus(latest[variant])]));
      const actualOutputContractsPass = variants.every(variant => actualOutputContracts[variant] === 'pass');
      const actualOutputContractsMismatch = variants.some(variant => actualOutputContracts[variant] === 'mismatch');
      const requestedSeed = seedEntry ? Number(seedEntry[1]) : null;
      const declarations = Object.fromEntries(variants.map(variant => [variant, latest[variant]?.workflowDeclaration]));
      const seedMatchesDeclaration = Boolean(seedEntry) && variants.every(variant => {
        const declaration = declarations[variant];
        const seeds = declaration?.seeds;
        return declaration?.evidence === 'workflow-declared' && declaration.loadedWeightsVerified === false &&
          Array.isArray(seeds) && seeds.length > 0 && seeds.every(seed => seed &&
            ['seed', 'noise_seed'].includes(seed.input) && Number.isSafeInteger(seed.value) && seed.value === requestedSeed);
      });
      const declarationsAgree = variants.every(variant => declarations[variant]?.evidence === 'workflow-declared') &&
        stable(Object.fromEntries(['models', 'precision', 'samplers'].map(key => [key, declarations.A?.[key] || []]))) ===
        stable(Object.fromEntries(['models', 'precision', 'samplers'].map(key => [key, declarations.B?.[key] || []])));
      const executionPromptMatches = variants.every(variant => {
        const evidence = latest[variant]?.executionPromptEvidence;
        return evidence?.evidence === 'comfy-history-prompt' && evidence.status === 'matched' &&
          digestPattern.test(evidence.submittedSha256 || '') && evidence.submittedSha256 === evidence.historySha256;
      });
      if (![4, 5].includes(pair.basisVersion) || !seedEntry || !complete || !sameSchema || !sameOrigin || origins[0] === 'local-test' || pair.repair ||
          !providerIdentityValid || providerAttemptIdentityMissing || providerAttemptIdentityDrift ||
          !effectivePromptsValid || !effectivePromptRelationValid || !outputContractsValid ||
          !sameOutputContract || !actualOutputContractsPass || !seedMatchesDeclaration || !declarationsAgree || !executionPromptMatches) {
        excluded.push({ pairId: pair.id, reason: ![4, 5].includes(pair.basisVersion) ? 'legacy-settings-not-snapshotted' :
          !seedEntry ? 'explicit-seed-not-recorded' : !complete ? 'latest-a-or-b-attempt-not-complete' :
          !sameSchema ? (!schemaEvidenceValid ? 'workflow-schema-evidence-missing' : 'workflow-schema-mismatch') :
          !sameOrigin ? (origins.includes('unknown') ? 'source-origin-unknown' : 'mixed-test-and-provider-origin') :
            origins[0] === 'local-test' ? 'local-test-fixture-not-quality-evidence' :
              pair.repair ? 'repair-run-not-baseline' : !providerIdentityValid ? 'provider-identity-not-recorded' :
                providerAttemptIdentityMissing ? 'provider-attempt-identity-missing' : providerAttemptIdentityDrift ? 'provider-attempt-identity-drift' :
              !effectivePromptsValid ? 'effective-prompt-fingerprint-missing' : !effectivePromptRelationValid ? 'effective-prompt-mismatch' :
                !outputContractsValid ? 'output-contract-missing' : !sameOutputContract ? 'output-contract-mismatch' :
                  !actualOutputContractsPass ? (actualOutputContractsMismatch ? 'actual-output-contract-mismatch' : 'actual-output-contract-unverified') :
                    !seedMatchesDeclaration ? 'requested-seed-not-confirmed-by-workflow-declaration' :
                !declarationsAgree ? 'workflow-model-or-sampler-declarations-differ' : 'executed-workflow-prompt-not-confirmed',
          ...(seedEntry ? { seed: String(seedEntry[1]) } : {}), variants: ledgers });
        continue;
      }
      const [seedControl, seedValue] = seedEntry;
      const settings = JSON.parse(JSON.stringify(pair.settingsSnapshot));
      for (const key of Object.keys(settings.controls || {})) if (seedKey(key)) delete settings.controls[key];
      for (const key of Object.keys(settings.effectiveControls || {})) if (seedKey(key)) delete settings.effectiveControls[key];
      const workflowConfig = Object.fromEntries(['evidence', 'loadedWeightsVerified', 'models', 'precision', 'samplers']
        .map(key => [key, declarations.A[key] ?? null]));
      const condition = stable({ benchmarkId: pair.benchmarkId || null, seedControl, profile: pair.profile || null, providerFingerprint: pair.providerFingerprint || null,
        effectivePromptSha256: effectivePrompts, outputContract: outputContracts.A, nodeSchemaSha256: schemaHashes.A,
        assetKinds: pair.assetKinds || {},
        sourceOrigin: origins[0], prompt: pair.prompt, label: pair.label, references: pair.references,
        workflow: pair.workflow, workflowSha256: pair.workflowSha256 || null, plannedSeconds: pair.plannedSeconds,
        executionPromptConfirmed: true,
        shotBasis: pair.shotBasis || null, mode: pairMode(pair), variableCue: pair.variableCue || null,
        motionDigest: pair.motionDigest || null, repair: pair.repair || null,
        modelIdentityStatus,
        modelFileEvidence: pair.modelFileEvidence ? { schema: pair.modelFileEvidence.schema,
          workflowSha256: pair.modelFileEvidence.workflowSha256,
          ...(pair.modelFileEvidence.modelSetSha256 ? { modelSetSha256: pair.modelFileEvidence.modelSetSha256 } : {}),
          providerFingerprint: pair.modelFileEvidence.providerFingerprint,
          providerBinding: pair.modelFileEvidence.providerBinding,
          models: pair.modelFileEvidence.models.map(model => ({ node: model.node, classType: model.classType,
            field: model.field, file: model.file, sizeBytes: model.sizeBytes, sha256: model.sha256 })) } : null,
        workflowConfig, settings });
      eligible.push({ pairId: pair.id, condition, seedControl, seed: String(seedValue),
        providerFingerprint: pair.providerFingerprint, profile: pair.profile || null, nodeSchemaSha256: schemaHashes.A,
        modelIdentityStatus,
        modelFileEvidence: pair.modelFileEvidence ? { schema: pair.modelFileEvidence.schema,
          workflowSha256: pair.modelFileEvidence.workflowSha256,
          ...(pair.modelFileEvidence.modelSetSha256 ? { modelSetSha256: pair.modelFileEvidence.modelSetSha256 } : {}),
          providerFingerprint: pair.modelFileEvidence.providerFingerprint,
          providerBinding: pair.modelFileEvidence.providerBinding,
          runtimeLoadedVerified: false, models: pair.modelFileEvidence.models.map(model => ({ node: model.node,
            classType: model.classType, field: model.field, file: model.file, sizeBytes: model.sizeBytes, sha256: model.sha256 })) } : null,
        seedEvidence: 'matches-workflow-declaration;runtime-seed-application-not-verified', variants: ledgers });
    }
    const groups = new Map();
    for (const run of eligible) {
      if (!groups.has(run.condition)) groups.set(run.condition, []);
      groups.get(run.condition).push(run);
    }
    const cohorts = [...groups.values()]
      .map(rows => ({ replicateCount: rows.length, distinctSeedCount: new Set(rows.map(row => row.seed)).size,
        status: rows.length === 1 ? 'need-additional-seed' : new Set(rows.map(row => row.seed)).size === rows.length ?
          'comparable-distinct-seeds' : 'duplicate-seeds-present',
        modelIdentityStatus: rows[0]?.modelIdentityStatus || 'runtime-weight-identity-unverified',
        runs: rows.map(({ condition: _condition, ...row }) => row) }));
    return { method: 'same-locked-conditions-vary-explicit-seed-only', cohorts, excluded };
  }
  function exclusionSummary(excluded) {
    const labels = { 'local-test-fixture-not-quality-evidence': '本地测试素材（只验流程）',
      'mixed-test-and-provider-origin': '测试与服务来源混合', 'source-origin-unknown': '来源未确认',
      'legacy-settings-not-snapshotted': '旧记录缺少锁定参数', 'explicit-seed-not-recorded': '没有显式种子',
      'latest-a-or-b-attempt-not-complete': 'A/B 未都完成', 'repair-run-not-baseline': '返修组不作基准',
      'provider-identity-not-recorded': '服务端点未记录', 'provider-attempt-identity-missing': '某次任务缺少服务端点指纹',
      'provider-attempt-identity-drift': 'A/B 或重试期间服务端点发生变化', 'effective-prompt-fingerprint-missing': '实际提示词指纹缺失',
      'effective-prompt-mismatch': 'A/B 实际提示词与对照模式不符',
      'output-contract-missing': '缺少锁定输出规格', 'output-contract-mismatch': 'A/B 输出规格不同',
      'actual-output-contract-unverified': '回片实际规格尚未核验', 'actual-output-contract-mismatch': '回片实测规格不符合锁定要求',
      'requested-seed-not-confirmed-by-workflow-declaration': '工作流未确认种子',
      'workflow-model-or-sampler-declarations-differ': '工作流模型或采样设置不同',
      'parameter-pair-not-seed-repeatability-cohort': '参数对照独立统计，不混入 seed 重复性队列',
      'unsupported-ab-mode': 'A/B 实验模式无法识别',
      'executed-workflow-prompt-not-confirmed': 'ComfyUI 历史执行提示与提交工作流未核对',
      'workflow-schema-evidence-missing': '缺少节点定义指纹', 'workflow-schema-mismatch': 'A/B 节点定义版本不同' };
    const counts = new Map();
    for (const item of excluded) counts.set(item.reason, (counts.get(item.reason) || 0) + 1);
    return [...counts].map(([reason, count]) => `${labels[reason] || '其他条件不符'} ${count} 组`).join('、');
  }
  const fingerprintImage = image => fingerprint(Uint8Array.from(atob(image.split(',')[1]), value => value.charCodeAt(0)));

  async function checkOutput(pair, variant, attempt, request) {
    const preset = presetPattern.test(attempt.preset || '') ? `?preset=${encodeURIComponent(attempt.preset)}` : '';
    const job = await request('/' + attempt.id + preset);
    const item = checkedOutput(attempt.id, job);
    if (job.id !== attempt.id || job.comparison?.id !== pair.id || job.comparison?.variant !== variant ||
        (job.comparison?.mode && job.comparison.mode !== pairMode(pair)) ||
        (cueMode(pair) && job.comparison?.cueDigest !== pair.cueDigest) ||
        (parameterMode(pair) && stable(job.comparison?.parameterDiff || null) !== stable({
          controlId: pair.parameterDiff.controlId, optionIds: pair.parameterDiff.optionIds })) ||
        (pair.workflowSha256 && job.graphSha256 !== pair.workflowSha256) ||
        (motionMode(pair) && variant === 'B' && job.comparison.motionDigest !== pair.motionDigest) ||
        job.status !== 'complete' || !item?.assetKey ||
        (attempt.output.assetKey && attempt.output.assetKey !== item.assetKey)) {
      throw new Error('回片与当前选择不匹配，请刷新对照后再试。');
    }
    if (preset && !item.url.includes('?preset=')) item.url += preset;
    return { job, item };
  }

  function checkStoredOutput(pair, variant, attempt) {
    const output = attempt?.output;
    const comparison = attempt?.comparison;
    if (attempt?.status !== 'complete' || !output?.assetKey || comparison?.id !== pair.id ||
        !sourceOriginConsistent(attempt, output) ||
        comparison?.variant !== variant || (comparison?.mode && comparison.mode !== pairMode(pair)) ||
        (cueMode(pair) && comparison?.cueDigest !== pair.cueDigest) ||
        (parameterMode(pair) && stable(comparison?.parameterDiff || null) !== stable({
          controlId: pair.parameterDiff.controlId, optionIds: pair.parameterDiff.optionIds })) ||
        (pair.workflowSha256 && attempt.workflowSha256 !== pair.workflowSha256) ||
        (motionMode(pair) && variant === 'B' && comparison.motionDigest !== pair.motionDigest)) {
      throw new Error('已保存的回片记录缺少匹配的任务或白模指纹，请刷新两版状态后再送审。');
    }
    return { job: { id: attempt.id, status: attempt.status, comparison, graphSha256: attempt.workflowSha256,
      outputContract: attempt.outputContract, timing: attempt.timing }, item: output };
  }

  async function adoption(pair, variant, media, details, request, shotBasis, valid, progress = () => {}) {
    const attempt = latestFor(pair, variant);
    if (!attempt) return null;
    progress('正在核对候选任务与回片文件身份…');
    const { job, item } = attempt.comparison ? checkStoredOutput(pair, variant, attempt) :
      await checkOutput(pair, variant, attempt, request);
    if (!valid(attempt)) throw new Error('核验期间候选回片已变化，未送审。请重新选定版本。');
    progress('正在核对尺寸、片长、帧数与帧率…');
    const checkedMedia = attempt.media?.assetKey === item.assetKey ? attempt.media : null;
    const mediaCheck = window.arcProductionQuality.evaluateMediaContract(media, job.outputContract, checkedMedia);
    if (mediaCheck.status !== 'pass') {
      throw new Error(mediaCheck.status === 'unverified' ? '尚未核验回片帧数与帧率，不能送入候选。' :
        '回片不符合输出契约：' + mediaCheck.issues.join('；'));
    }
    if (details?.range && (details.range.jobId !== job.id || details.range.assetKey !== item.assetKey ||
        !Number.isFinite(media.duration) || details.range.endMs > media.duration * 1000)) {
      throw new Error('可用片段与本次载入的回片不一致。');
    }
    progress('正在对上游完整回片做流式 SHA-256 核验…');
    const indexMatch = /\/video\/(\d+)$/.exec(new URL(item.url, 'http://127.0.0.1').pathname);
    const videoIndex = Number(indexMatch?.[1]);
    if (!Number.isInteger(videoIndex) || videoIndex < 0 || videoIndex > 999) throw new Error('回片地址缺少有效的任务内视频序号。');
    const identityQuery = new URLSearchParams({ file: item.name, asset: item.assetKey,
      ...(presetPattern.test(job.preset || attempt.preset || '') ? { preset: job.preset || attempt.preset } : {}) });
    const identity = await request(`/${job.id}/video/${videoIndex}/sha256?${identityQuery}`);
    if (identity.jobId !== job.id || identity.index !== videoIndex || identity.name !== item.name ||
        identity.assetKey !== item.assetKey || !digestPattern.test(identity.sha256 || '') ||
        !Number.isSafeInteger(identity.sizeBytes) || identity.sizeBytes < 1 ||
        identity.evidence !== 'full-upstream-video-bytes-sha256' ||
        (typeof job.testFixture === 'boolean' && identity.testFixture !== job.testFixture)) {
      throw new Error('内容哈希返回与本次任务/回片不匹配，未送审。');
    }
    progress('正在复核分镜依据…');
    const basisHash = pair.shotBasis;
    const basisStatus = !basisHash ? 'unknown' : basisHash === await shotBasis() ? 'current' : 'changed';
    if (!valid(attempt)) throw new Error('核验期间候选回片已变化，未送审。请重新选定版本。');
    if (basisStatus !== 'current' &&
        !window.confirm('此版的分镜依据有变化或缺少旧记录。是否仍送去审片，按当前分镜重新核对？')) {
      throw new Error('已取消送审；本镜分镜依据有变化或缺少旧记录。');
    }
    const references = Array.isArray(pair.references) ? [...pair.references] : undefined;
    if (references && motionMode(pair) && variant === 'B') references.push({ role: '白模动作', name: pair.motionName,
      sha256: job.comparison.motionDigest, source: pair.motionSource,
      ...(motionReferenceEvidence(job.comparison.motionReference) ? { media: motionReferenceEvidence(job.comparison.motionReference) } : {}) });
    return [{ ...item, sha256: identity.sha256, sizeBytes: identity.sizeBytes }, job.id, basisStatus, basisHash, references, {
      id: pair.id, variant, mode: pairMode(pair), ...(pair.benchmarkId ? { benchmarkId: pair.benchmarkId } : {}),
      outputIdentity: { evidence: identity.evidence, sha256: identity.sha256, sizeBytes: identity.sizeBytes },
      ...(digestPattern.test(attempt.effectivePromptSha256 || job.effectivePromptSha256 || '') ?
        { effectivePromptSha256: attempt.effectivePromptSha256 || job.effectivePromptSha256 } : {}),
      queueMs: job.timing?.queueMs, executionMs: job.timing?.executionMs,
      retryCount: Math.max(0, pair.attempts[variant].slice(0, pair.attempts[variant].indexOf(attempt) + 1)
        .filter(item => item.status !== 'rejected').length - 1),
      ...(Number.isFinite(media.duration) && media.duration > 0 ? { durationSec: media.duration } : {}),
      ...(Number.isFinite(checkedMedia?.fps) && checkedMedia.fps >= 1 && checkedMedia.fps <= 240 ? { fps: checkedMedia.fps } : {}),
      ...(checkedMedia?.source === 'mp4-stts' && checkedMedia.frameRateMode === 'constant' ?
        { fpsEvidenceSource: checkedMedia.source, frameRateMode: checkedMedia.frameRateMode } : {})
    }, { ...details, ...(pair.repairReturn?.variant === variant ? { repairReturn: pair.repairReturn } : {}) }];
  }

  function readPairs(record) {
    let list;
    try { list = JSON.parse(record.generationAB || '[]'); } catch { return []; }
    if (!Array.isArray(list)) return [];
    return list.filter(pair => idPattern.test(pair?.id || '') && digestPattern.test(pair.basis || '') &&
      (pair.workflowSha256 == null || digestPattern.test(pair.workflowSha256)) &&
        (parameterMode(pair) ? ['scheduler', 'diffusion-weight'].includes(pair.parameterDiff?.controlId) &&
        /^[a-z0-9_-]{1,64}$/.test(pair.parameterDiff?.optionIds?.A || '') &&
        /^[a-z0-9_-]{1,64}$/.test(pair.parameterDiff?.optionIds?.B || '') &&
        pair.parameterDiff.optionIds.A !== pair.parameterDiff.optionIds.B &&
        ['A', 'B'].every(key => typeof pair.parameterDiff?.labels?.[key] === 'string' && pair.parameterDiff.labels[key].length <= 100) :
      cueMode(pair) ? typeof pair.variableCue === 'string' && pair.variableCue.length <= 1200 &&
          digestPattern.test(pair.cueDigest || '') :
        digestPattern.test(pair.motionDigest || '') && typeof pair.motionName === 'string') &&
      typeof pair.prompt === 'string' && typeof pair.label === 'string' && variants.every(key => Array.isArray(pair.attempts?.[key])))
      .map(pair => ({ ...pair, ...(safeModelFileEvidence(pair.modelFileEvidence, pair.providerFingerprint, pair.workflowSha256) ?
        { modelFileEvidence: safeModelFileEvidence(pair.modelFileEvidence, pair.providerFingerprint, pair.workflowSha256) } :
        (pair.modelFileEvidence === undefined ? {} : { modelFileEvidence: null })),
        attempts: Object.fromEntries(variants.map(key => [key, pair.attempts[key]
        .filter(attempt => idPattern.test(attempt?.id || '') && Object.hasOwn(labels, attempt.status))
        .map(attempt => ({ ...attempt, output: outputFor(attempt.id, attempt.output) }))])) }));
  }

  function summarize(pair) {
    if (!pair) return null;
    const jobs = variants.flatMap(variant => pair.attempts[variant]);
    const fixture = pair.testFixture === true || jobs.some(job => job.testFixture || job.output?.testFixture);
    const environment = fixture ? 'local-test' : pair.testFixture === false || jobs.some(job => job.testFixture === false) ?
      'configured-provider' : 'unknown';
    return {
      pairId: pair.id, environment, conditionVersion: pair.basisVersion === 5 ? 5 : pair.basisVersion === 4 ? 4 : pair.basisVersion === 2 ? 2 : 1,
      profile: pair.profile || null, providerFingerprint: digestPattern.test(pair.providerFingerprint || '') ? pair.providerFingerprint : null,
      benchmarkId: pair.benchmarkId || null, mode: pairMode(pair), ...(cueMode(pair) ? { variableCue: pair.variableCue, cueDigest: pair.cueDigest } : {}),
      ...(parameterMode(pair) ? { parameterDiff: pair.parameterDiff } : {}),
      lockedSettings: pair.settingsSnapshot || null,
      workflow: pair.workflow ?? null, workflowSha256: pair.workflowSha256 ?? null, plannedSeconds: pair.plannedSeconds ?? null,
      outputContract: validOutputContract(pair.outputContract) ? pair.outputContract : null,
      modelFileEvidence: safeModelFileEvidence(pair.modelFileEvidence, pair.providerFingerprint, pair.workflowSha256),
      shotBasisSha256: digestPattern.test(pair.shotBasis || '') ? pair.shotBasis : null,
      lockedConditionSha256: pair.basis, commonReferences: pair.references || [],
      reviewMarks: window.arcABReview.report(pair),
      mode: pairMode(pair), variable: pairMode(pair) === 'vfx' ? { name: '特效提示', value: pair.variableCue } :
        pairMode(pair) === 'performance' ? { name: '表演节拍提示', value: pair.variableCue } :
        pairMode(pair) === 'parameter' ? { name: parameterControlName(pair.parameterDiff.controlId), controlId: pair.parameterDiff.controlId,
          A: pair.parameterDiff.labels.A, B: pair.parameterDiff.labels.B, optionIds: pair.parameterDiff.optionIds } :
        { name: '白模动作参考', value: pair.motionName, sha256: pair.motionDigest, source: pair.motionSource || 'unknown' },
      ...(motionMode(pair) ? { motionForB: { name: pair.motionName, sha256: pair.motionDigest,
        source: pair.motionSource || 'unknown',
        ...(motionReferenceEvidence(latestFor(pair, 'B')?.comparison?.motionReference) ?
          { media: motionReferenceEvidence(latestFor(pair, 'B').comparison.motionReference) } : {}) } } : {}),
      variants: Object.fromEntries(variants.map(variant => {
        const runs = pair.attempts[variant];
        const timing = attemptLedger(runs);
        return [variant, {
          retryCount: timing.retryCount, queueMs: timing.queueMs, executionMs: timing.executionMs,
          queueSource: timing.queueSource, executionSource: timing.executionSource, gpuKernelTime: timing.gpuKernelTime,
          attempts: runs.map(job => {
            const measured = job.mediaDuration?.assetKey === job.output?.assetKey ? job.mediaDuration?.seconds : undefined;
            return { jobId: job.id, status: job.status,
              providerFingerprint: digestPattern.test(job.providerFingerprint || '') ? job.providerFingerprint : null,
              workflowSha256: job.workflowSha256 ?? pair.workflowSha256 ?? null,
              preset: presetPattern.test(job.preset || '') ? job.preset : null,
              preflightEvidence: job.preflightEvidence || null,
              effectivePromptSha256: digestPattern.test(job.effectivePromptSha256 || '') ? job.effectivePromptSha256 : null,
              workflowDeclaration: job.workflowDeclaration ?? null,
              ...(motionReferenceEvidence(job.comparison?.motionReference) ? { motionReference: motionReferenceEvidence(job.comparison.motionReference) } : {}),
              queueMs: job.timing?.queueMs ?? null, executionMs: job.timing?.executionMs ?? null,
              queueSource: job.timing?.queueSource ?? null, executionSource: job.timing?.executionSource ?? null,
              bridgeMs: job.timing?.bridgeMs ?? null, bridgeSource: job.timing?.bridgeSource ?? null,
              gpuKernelTime: typeof job.timing?.gpuKernelTime === 'boolean' ? job.timing.gpuKernelTime : null,
              output: job.output?.name || null, outputAssetKey: job.output?.assetKey || null,
              outputSha256: digestPattern.test(job.output?.sha256 || '') ? job.output.sha256 : null,
              outputSizeBytes: Number.isSafeInteger(job.output?.sizeBytes) ? job.output.sizeBytes : null,
              outputContract: job.outputContract || null,
              media: job.media?.assetKey === job.output?.assetKey ? job.media : null,
              durationSec: Number.isFinite(measured) && measured > 0 ? measured : null };
          })
        }];
      }))
    };
  }

  function latestComparableReport(record, benchmarkId = null, mode = null) {
    const pair = readPairs(record).filter(candidate => supportedMode(candidate) && (!benchmarkId || candidate.benchmarkId === benchmarkId) &&
      (!mode || pairMode(candidate) === mode)).findLast(candidate => variants.every(variant => {
      const run = latestFor(candidate, variant);
      return run?.status === 'complete' && Boolean(run.output?.assetKey);
    }) && variants.every(variant => digestPattern.test(latestFor(candidate, variant)?.preflightEvidence?.schemaSha256 || '')) &&
      latestFor(candidate, 'A').preflightEvidence.schemaSha256 === latestFor(candidate, 'B').preflightEvidence.schemaSha256 &&
      variants.every(variant => validOutputContract(latestFor(candidate, variant)?.outputContract)) &&
      stable(latestFor(candidate, 'A').outputContract) === stable(latestFor(candidate, 'B').outputContract) &&
      variants.every(variant => actualOutputContractStatus(latestFor(candidate, variant)) === 'pass'));
    return summarize(pair);
  }

  function mount(record, options) {
    const panel = document.createElement('details');
    panel.className = 'production-history generation-ab';
    panel.innerHTML = `
      <summary>${options.benchmark?.mode === 'vfx' ? '特效提示 A/B 对照' : options.benchmark?.mode === 'performance' ? '表演节拍 A/B 对照' : '白模 A/B 对照'}</summary>
      ${options.testFixture ? '<p role="note">本地测试模式 · 视频为流程样片，耗时为模拟服务记录。</p>' : ''}
      <p data-mode-description></p>
      <label>共用提示词<textarea rows="5" maxlength="19000" data-shared></textarea></label>
      <label data-variable-cue-label hidden><span data-variable-cue-title></span><textarea rows="3" maxlength="1200" data-variable-cue></textarea></label>
      <details data-parameter-options hidden>
        <summary>模型参数实验 · 只改变一项</summary>
        <p data-parameter-description>只比较本工作流已公开并通过节点预检的模型权重或 scheduler 离散项。提示词、种子、参考图、其他采样项和输出规格保持一致；结果单独统计。</p>
        <div class="production-metadata">
          <label>实验参数<select data-parameter-control></select></label>
          <label>A 版<select data-parameter-a></select></label>
          <label>B 版<select data-parameter-b></select></label>
        </div>
      </details>
      <div data-draft></div>
      <details data-ab-repair hidden><summary>局部返修要求</summary>
        <p data-repair-text style="white-space:pre-wrap"></p>
        <p data-locked-repair style="white-space:pre-wrap" hidden></p>
        <label data-repair-option><input type="checkbox">两版都带入这份返修单</label>
        <button type="button" data-send-repair hidden></button>
      </details>
      <p data-ab-basis class="production-status" role="status" hidden></p>
      <div data-ab-basis-links class="production-picker" hidden></div>
      <label data-ab-reviewed hidden><input type="checkbox">我已按当前镜头核对共用提示词</label>
      <div class="production-picker">
        <button type="button" data-toggle-parameter hidden>新建模型/参数实验</button>
        <button type="button" data-lock>锁定新对照</button>
        <button type="button" class="production-action" data-run-both hidden>提交 A/B 两版</button>
        <label data-archive hidden>查看对照记录<select></select></label>
        <button type="button" data-refresh hidden>刷新两版状态</button>
        <button type="button" data-export hidden>下载对照记录</button>
      </div>
      <p data-lock-info></p>
      <p data-repeatability role="status"></p>
      <label data-unverified-confirm hidden><input type="checkbox">我已查看工作流节点预检明细，仍继续这组提交</label>
      <output role="status" data-ab-message></output>
      <div class="generation-ab-versions" hidden></div>`;
    const text = panel.querySelector('[data-shared]');
    const variableCue = panel.querySelector('[data-variable-cue]');
    const cueLabel = panel.querySelector('[data-variable-cue-label]');
    let selectedMode = ['vfx', 'performance'].includes(options.benchmark?.mode) ? options.benchmark.mode : 'motion';
    const currentMode = () => pair ? pairMode(pair) : selectedMode;
    const parameterControls = (options.controls || []).filter(group => ['scheduler', 'diffusion-weight'].includes(group.id) &&
      Array.isArray(group.options) && group.options.length >= 2);
    const parameterPanel = panel.querySelector('[data-parameter-options]');
    const parameterToggle = panel.querySelector('[data-toggle-parameter]');
    const parameterControlSelect = panel.querySelector('[data-parameter-control]');
    const parameterA = panel.querySelector('[data-parameter-a]');
    const parameterB = panel.querySelector('[data-parameter-b]');
    const parameterControlFor = id => parameterControls.find(group => group.id === id);
    const parameterLabelFor = id => parameterControlName(id);
    let parameterControl = parameterControls.find(group => group.id === 'scheduler') || parameterControls[0] || null;
    for (const group of parameterControls) parameterControlSelect.add(new Option(parameterLabelFor(group.id), group.id));
    function fillParameterOptions(control, selectedIds) {
      parameterControl = control;
      parameterA.replaceChildren();
      parameterB.replaceChildren();
      for (const option of control?.options || []) {
        parameterA.add(new Option(option.label, option.id));
        parameterB.add(new Option(option.label, option.id));
      }
      const first = selectedIds?.A || control?.defaultId || control?.options?.[0]?.id || '';
      parameterA.value = first;
      parameterB.value = selectedIds?.B || control?.options?.find(option => option.id !== first)?.id || '';
      const label = parameterLabelFor(control?.id || 'scheduler');
      panel.querySelector('[data-parameter-description]').textContent = control?.id === 'diffusion-weight' ?
        '只切换 UNETLoader 的 H3 权重文件（剪枝 INT8 / 未剪枝 INT8）。模型精度、seed、提示词、参考图、scheduler、画幅、时长和其余设置保持一致。权重文件被请求不证明运行时已加载。' :
        '只切换同一 MiniMax H3 Ref2VA 工作流的 scheduler。模型权重、精度、seed、提示词、参考图、采样步数、画幅和时长保持一致。';
      for (const id of ['A', 'B']) panel.querySelector(`[data-parameter-${id.toLowerCase()}]`).closest('label').firstChild.textContent = `${id} 版 ${label}`;
    }
    if (parameterControl) {
      parameterControlSelect.value = parameterControl.id;
      fillParameterOptions(parameterControl);
      parameterToggle.hidden = Boolean(options.focusedRepair);
    }
    parameterControlSelect.onchange = () => fillParameterOptions(parameterControlFor(parameterControlSelect.value));
    function updateModeUI(mode) {
      const isParameter = mode === 'parameter';
      parameterPanel.hidden = !isParameter;
      cueLabel.hidden = !['vfx', 'performance'].includes(mode);
      panel.querySelector('[data-mode-description]').textContent = mode === 'vfx' ?
        'A、B 共用同一角色、场景、机位、时长、参考、工作流和基础提示。A 明确要求干净底片；B 只增加下方一条特效指令。两版都不提交白模视频。' :
        mode === 'performance' ? 'A、B 使用相同人物、首帧、场景、共用提示词、工作流、种子、机位和时长。A 不增加额外表演指令；B 只增加一条下方的视线/微表情节拍提示，不提交白模视频。' :
        isParameter ? `参数实验：只改${parameterLabelFor(parameterControl?.id || parameterControlSelect.value)}。其他模型/采样条件、工作流、seed、提示词、人物/场景参考、画幅和时长保持一致。它单独记录，不并入白模/表演/特效质量基准。` :
        '两版共用角色、场景、机位和参数。A 用文字描述动作，B 在同一句描述上加白模。';
      panel.querySelector('[data-variable-cue-title]').textContent = mode === 'vfx' ? 'B 版唯一特效指令' : 'B 版唯一表演节拍';
      variableCue.placeholder = mode === 'vfx' ? '例如：门缝出现一条短暂、低亮度的青白色能量弧；遮挡顺序在角色前景之后。只写一个效果。' :
        '例如：先保持闭口凝视，停顿约 0.6 秒；视线先上移，再轻抬下巴，最后静止半秒。只写一条可见节拍。';
      parameterToggle.textContent = isParameter ? '返回镜头 A/B 模式' : '新建模型/参数实验';
      panel.querySelector('summary').textContent = isParameter ? '模型参数 A/B 实验' :
        options.benchmark?.mode === 'vfx' ? '特效提示 A/B 对照' : options.benchmark?.mode === 'performance' ? '表演节拍 A/B 对照' : '白模 A/B 对照';
    }
    updateModeUI(selectedMode);
    const message = panel.querySelector('[data-ab-message]');
    const unverifiedConfirm = panel.querySelector('[data-unverified-confirm]');
    const unverifiedCheckbox = unverifiedConfirm.querySelector('input');
    unverifiedCheckbox.onchange = () => {
      unverifiedConfirm.dataset.confirmedKey = unverifiedCheckbox.checked ? unverifiedConfirm.dataset.currentKey || '' : '';
    };
    const lock = panel.querySelector('[data-lock]');
    const runBoth = panel.querySelector('[data-run-both]');
    const refresh = panel.querySelector('[data-refresh]');
    const exportButton = panel.querySelector('[data-export]');
    const versions = panel.querySelector('.generation-ab-versions');
    const archive = panel.querySelector('[data-archive] select');
    const basisNote = panel.querySelector('[data-ab-basis]');
    const basisLinks = panel.querySelector('[data-ab-basis-links]');
    const reviewed = panel.querySelector('[data-ab-reviewed]');
    const confirmation = reviewed.querySelector('input');
    const repairPanel = panel.querySelector('[data-ab-repair]');
    const repairOption = panel.querySelector('[data-repair-option]');
    const repairToggle = repairOption.querySelector('input');
    const sendRepair = panel.querySelector('[data-send-repair]');
    const pairs = readPairs(record);
    const repairSource = pairs.find(item => item.id === options.focusedRepair?.id);
    const repairVariant = variants.includes(options.focusedRepair?.variant) ? options.focusedRepair.variant : null;
    const benchmarkMode = ['vfx', 'performance'].includes(options.benchmark?.mode) ? options.benchmark.mode : null;
    const benchmarkPair = benchmarkMode ? pairs.findLast(item => pairMode(item) === benchmarkMode &&
      (!options.benchmark?.id || item.benchmarkId === options.benchmark.id)) : null;
    let pair = repairSource || benchmarkPair || (benchmarkMode ? null : pairs.at(-1)),
      timer, active = true, polling = false, locking = false, preparingBoth = false;
    if (pair) {
      selectedMode = pairMode(pair);
      updateModeUI(selectedMode);
      if (parameterMode(pair) && parameterControlFor(pair.parameterDiff.controlId)) {
        parameterControlSelect.value = pair.parameterDiff.controlId;
        fillParameterOptions(parameterControlFor(pair.parameterDiff.controlId), pair.parameterDiff.optionIds);
      }
    } else if (benchmarkMode) {
      selectedMode = benchmarkMode;
      updateModeUI(selectedMode);
    }
    parameterToggle.onclick = () => {
      if (!parameterControls.length || options.focusedRepair || locking || preparingBoth || pending.size) return;
      selectedMode = currentMode() === 'parameter' ?
        (['vfx', 'performance'].includes(options.benchmark?.mode) ? options.benchmark.mode : 'motion') : 'parameter';
      pair = null;
      updateModeUI(selectedMode);
      archiveOptions();
      buildCards();
      if (!parameterPanel.hidden) {
        parameterControl = parameterControlFor(parameterControlSelect.value) || parameterControl;
        fillParameterOptions(parameterControl);
      }
      message.textContent = selectedMode === 'parameter' ?
        '参数实验已单独开启。选择一项模型权重或 scheduler 的两个值后锁定；结果不计入 S02/S03/S05 创作基准。' :
        '已返回镜头 A/B 模式。';
    };
    const pending = new Set();
    const cards = new Map();
    let basisCheck;
    const currentParts = options.currentParts();
    const currentHash = options.shotBasis();
    const model = options.createDraft(value => {
      text.value = value;
      checkPromptBasis();
    }, panel.querySelector('[data-draft]'));

    function checkPromptBasis(source) {
      confirmation.checked = false;
      const check = Promise.all([currentParts, currentHash, source?.parts]).then(([parts, hash, saved]) => {
        const changes = options.basisChanges(saved, parts);
        return { changes, stale: changes.length > 0 || Boolean(source &&
          (source.hash ? source.hash !== hash : !saved)) };
      });
      basisCheck = check;
      check.then(({ changes, stale }) => {
        if (!active || basisCheck !== check) return;
        reviewed.hidden = basisNote.hidden = !stale;
        basisNote.textContent = stale ? (changes.length ?
          `共用提示词的依据已变更：${changes.map(({ label }) => label).join('、')}。` :
          '这份共用提示词缺少可核对的旧依据，请按当前镜头复核。') : '';
        options.renderBasisLinks(basisLinks, changes);
      }).catch(() => {
        if (active && basisCheck === check) message.textContent = '无法核对共用提示词，请刷新后重试。';
      });
    }

    text.oninput = () => { confirmation.checked = false; };
    const formatTime = value => Number.isFinite(value) ? (value / 1000).toFixed(2) + ' 秒' : '暂无';

    function save() {
      const old = record.generationAB;
      record.generationAB = JSON.stringify(pairs);
      if (options.save() !== false) return true;
      if (old === undefined) delete record.generationAB; else record.generationAB = old;
      return false;
    }

    function shared() {
      const value = options.shared();
      const prompt = text.value.trim();
      if (!prompt || /<Video\s+\d+>/i.test(prompt)) throw new Error('请填写两版共用的提示词。此处不需要写视频标签。');
      const repair = repairToggle.checked ? options.repairInstruction : '';
      if (repair && /<Video\s+\d+>/i.test(repair)) throw new Error('返修单中无需写视频标签，请删除后重试。');
      if (repair && prompt.length + repair.length + 2 > 19000) throw new Error('共用提示词与返修单合计最多 19000 字。');
      const cue = ['vfx', 'performance'].includes(selectedMode) ? variableCue.value.trim() : '';
      if (['vfx', 'performance'].includes(selectedMode) && (!cue || /<Video\s+\d+>/i.test(cue)))
        throw new Error(selectedMode === 'vfx' ? '请填写一条正向、可见且不含视频标签的特效指令。' : '请填写一条具体、可观察且不含视频标签的表演节拍。');
      if (selectedMode === 'vfx' && /\b(?:no|without)\s+vfx\b/i.test(cue)) throw new Error('特效指令需描述一个正向可见效果。');
      let parameterDiff;
      if (selectedMode === 'parameter') {
        if (!parameterControl) throw new Error('当前工作流没有受支持的模型权重或 scheduler 参数，无法创建参数实验。');
        const a = parameterControl.options.find(option => option.id === parameterA.value);
        const b = parameterControl.options.find(option => option.id === parameterB.value);
        if (!a || !b || a.id === b.id) throw new Error(`请选择两个不同的${parameterLabelFor(parameterControl.id)}值。`);
        parameterDiff = { controlId: parameterControl.id, optionIds: { A: a.id, B: b.id },
          labels: { A: a.label, B: b.label } };
      }
      return { ...value, outputContract: typeof options.outputContract === 'function' ? options.outputContract() : options.outputContract || null, prompt,
        ...(['vfx', 'performance'].includes(selectedMode) ? { variableCue: cue } : {}),
        ...(parameterDiff ? { parameterDiff } : {}), ...(repair ? { repair } : {}) };
    }

    async function stamp(value) {
      if (!validOutputContract(value.outputContract)) throw new Error('当前工作流没有可验证的输出规格，不能锁定质量 A/B。请先配置宽高及目标时长/帧率。');
      const { workflow, plannedSeconds, ...sharedConditions } = value;
      if (value.parameterDiff) {
        const settings = sharedConditions.settings || {};
        sharedConditions.settings = { ...settings, controls: { ...(settings.controls || {}) } };
        delete sharedConditions.settings.controls[value.parameterDiff.controlId];
      }
      return options.digest(JSON.stringify({ ...sharedConditions,
        benchmarkId: value.parameterDiff ? parameterBenchmarkId(value.parameterDiff.controlId) : options.benchmark?.id || null }));
    }

    async function matchesLockedConditions(locked, value) {
      if (locked?.workflow !== value.workflow ||
          (locked?.workflowSha256 ?? null) !== (value.workflowSha256 ?? null) ||
          locked?.plannedSeconds !== value.plannedSeconds ||
          !validOutputContract(locked?.outputContract) ||
          stable(locked.outputContract) !== stable(value.outputContract)) return false;
      return await stamp(value) === locked?.basis;
    }

    function displayRepair() {
      repairPanel.hidden = !options.repairInstruction && !pair?.repair;
      repairPanel.querySelector('[data-repair-text]').textContent = options.repairInstruction || pair?.repair || '';
      repairOption.hidden = !options.repairInstruction;
      repairToggle.checked = Boolean(pair?.repair && pair.repair === options.repairInstruction);
      const locked = panel.querySelector('[data-locked-repair]');
      locked.hidden = !pair?.repair || !options.repairInstruction || repairToggle.checked;
      locked.textContent = locked.hidden ? '' : '已锁定的返修内容：\n' + pair.repair;
      sendRepair.hidden = !(options.repairInstruction && repairSource && pair === repairSource && repairVariant);
      if (!sendRepair.hidden) {
        repairPanel.open = true;
        sendRepair.textContent = `只提交 ${repairVariant} 版返修`;
      }
    }

    function archiveOptions() {
      archive.replaceChildren(...pairs.map((item, index) =>
        new Option(`对照 ${index + 1} · ${pairMode(item) === 'parameter' ? parameterControlName(item.parameterDiff.controlId) + ' 参数' : pairMode(item) === 'vfx' ? '特效提示' :
          pairMode(item) === 'performance' ? '表演节拍' : '白模动作'}`, item.id)));
      archive.value = pair?.id || '';
      archive.closest('label').hidden = pairs.length < 2;
    }

    function buildCards() {
      versions.hidden = !pair;
      refresh.hidden = !pair;
      exportButton.hidden = !pair;
      runBoth.hidden = !pair;
      cards.clear();
      reviewTimeline?.dispose();
      reviewTimeline = null;
      comparison?.dispose();
      versions.replaceChildren();
      if (!pair) return;
      const parameterParity = document.createElement('p');
      parameterParity.className = 'generation-ab-param-parity';
      parameterParity.dataset.paramParity = '';
      parameterParity.setAttribute('role', 'status');
      versions.append(parameterParity);
      for (const variant of variants) {
        const card = document.createElement('section');
        card.innerHTML = `<h4>${variant} · ${pairVariantLabel(pair, variant)}${pairMode(pair) === 'vfx' && variant === 'B' ? '（增加指令）' : ''}</h4>
          <p data-status></p><strong data-fixture hidden>本地测试素材</strong><p data-metrics></p><p data-preflight hidden></p>
          <details data-model hidden><summary>模型与参数依据</summary><div data-model-evidence></div></details><p data-clip-duration hidden></p>
          <output data-output-check></output>
          <video controls playsinline preload="metadata" hidden></video>
          <div class="production-picker">
            <button type="button" class="production-action" data-run></button>
            <button type="button" class="production-action" data-choose hidden>送本版去审片</button>
          </div>`;
        versions.append(card);
        const button = card.querySelector('[data-run]');
        const choose = card.querySelector('[data-choose]');
        button.onclick = () => submit(variant);
        const media = card.querySelector('video');
        const duration = card.querySelector('[data-clip-duration]');
        media.addEventListener('loadedmetadata', () => {
          duration.hidden = !Number.isFinite(media.duration);
          duration.textContent = duration.hidden ? '' : `片长 ${media.duration.toFixed(2)} 秒`;
          const attempt = pair && latestOutput(variant);
          show();
          if (attempt?.output?.assetKey && media.getAttribute('src') === attempt.output.url && !duration.hidden &&
              (attempt.mediaDuration?.seconds !== media.duration || attempt.mediaDuration?.assetKey !== attempt.output.assetKey ||
                attempt.media?.width !== media.videoWidth || attempt.media?.height !== media.videoHeight ||
                attempt.media?.assetKey !== attempt.output.assetKey)) {
            attempt.mediaDuration = { seconds: media.duration, assetKey: attempt.output.assetKey };
            attempt.media = { assetKey: attempt.output.assetKey, seconds: media.duration,
              width: media.videoWidth, height: media.videoHeight };
            if (!save()) message.textContent = '片长已读出，本机记录暂未保存。';
          }
          if (attempt?.output?.assetKey && attempt.media?.assetKey === attempt.output.assetKey &&
              attempt.media?.source !== 'mp4-stts' && window.arcMp4Metadata?.read) {
            const selectedPair = pair;
            const selectedId = attempt.id;
            window.arcMp4Metadata.read(media.currentSrc).then(metadata => {
              if (!metadata || selectedPair !== pair || latestOutput(variant)?.id !== selectedId || !panel.isConnected) return;
              attempt.media = { ...attempt.media, ...metadata, assetKey: attempt.output.assetKey };
              if (save()) show();
              else message.textContent = '视频已读取帧率元数据，本机记录暂未保存。';
            });
          }
        });
        media.addEventListener('emptied', () => { duration.hidden = true; });
        media.addEventListener('error', () => {
          card.querySelector('[data-output-check]').textContent = '无法读取回片。';
          if (latestOutput(variant)?.outputContract) choose.disabled = true;
        });
        choose.onclick = () => adopt(variant, media);
        cards.set(variant, { card, button, choose, media });
      }
      const players = variants.map(variant => cards.get(variant).media);
      comparison = window.arcCompare.create(...players, { audioChoice: true,
        audioLabels: variants.map(variant => `${variant} · ${pairVariantLabel(pair, variant)}`) });
      versions.append(comparison.panel);
      reviewTimeline = window.arcABReview.mount({ pair, latest: latestOutput, players, comparison, save,
        onChange: show,
        adopt: (variant, details) => adopt(variant, cards.get(variant).media, details) });
      versions.append(reviewTimeline.panel);
      show();
    }

    let comparison, reviewTimeline;
    function show() {
      if (!pair) return;
      runBoth.hidden = Boolean(pair.repairReturn) || variants.some(variant => pair.attempts[variant].length);
      runBoth.disabled = locking || preparingBoth || Boolean(pending.size);
      lock.disabled = locking || preparingBoth || Boolean(pending.size);
      sendRepair.disabled = lock.disabled;
      archive.disabled = preparingBoth;
      const lockInfo = pairMode(pair) === 'vfx' ?
        `当前显示对照 ${pairs.indexOf(pair) + 1} · ${pair.label} · 唯一变量：${pair.variableCue}。A/B 均不带白模视频。改动共用条件或特效指令后需锁定新对照。` :
        pairMode(pair) === 'performance' ? `当前显示对照 ${pairs.indexOf(pair) + 1} · ${pair.label} · B 版只增加一条表演节拍：${pair.variableCue}。A/B 均不带白模视频。` :
        pairMode(pair) === 'parameter' ? `参数实验 · 唯一变量 ${parameterControlName(pair.parameterDiff.controlId)}：A ${pair.parameterDiff.labels.A} / B ${pair.parameterDiff.labels.B}。其他输入与输出规格锁定；不计入创作质量基准。` :
          `当前显示对照 ${pairs.indexOf(pair) + 1} · ${pair.label} · 锁定白模 ${pair.motionName}${pair.motionSource === 'builtin' ? '（弧光自制）' : pair.motionSource === 'local' ? '（本地导入）' : ''}${pair.repair ? ' · 两版沿用同一返修单' : ''}。改动共用条件后需锁定新对照。`;
      const fileEvidence = pair.modelFileEvidence;
      panel.querySelector('[data-lock-info]').textContent = lockInfo + (fileEvidence?.runtimeLoadedVerified === false ?
        ` 模型依据：${fileEvidence.models?.length || 0} 个工作流引用文件的 SHA-256 已匹配（${fileEvidence.workflowSha256?.slice(0, 12)}）；运行时实际加载仍未验证。` :
        ' 模型依据：仅工作流声明；权重文件字节和运行时实际加载均未验证。');
      const repeat = repeatability(record);
      const replicateCount = repeat.cohorts.reduce((sum, cohort) => sum + cohort.replicateCount, 0);
      const exclusions = exclusionSummary(repeat.excluded);
      panel.querySelector('[data-repeatability]').textContent = repeat.cohorts.length ?
        `同条件样本：${repeat.cohorts.length} 组、${replicateCount} 次完整 A/B；状态区分待补种子、重复种子与不同种子复测。${repeat.excluded.length ? `排除 ${repeat.excluded.length} 组：${exclusions}。` : ''}失败与耗时仍保留在导出账本。` :
        `同条件模型复测尚未形成：每组固定模型、参考、工作流、时长及 A/B 各自提示词，仅更换显式随机种子；白模组 A/B 提示词相同，表演/特效组 B 只增加已锁定的唯一变量。本地测试素材只验证流程，不进入模型质量队列。${repeat.excluded.length ? `排除 ${repeat.excluded.length} 组：${exclusions}。` : '缺条件的历史记录不计入。'}`;
      for (const [variant, { card, button, choose, media }] of cards) {
        const list = pair.attempts[variant];
        const job = list.at(-1);
        const displayed = latestOutput(variant) || job;
        const timing = timingSummary(list);
        card.querySelector('[data-fixture]').hidden = !(displayed?.testFixture || displayed?.output?.testFixture);
        const status = job?.testFixture && job.status === 'complete' ? '测试片可播放' : labels[job?.status];
        card.querySelector('[data-status]').textContent = job ? [status || '等待状态', job.error].filter(Boolean).join(' · ') : '尚未提交';
        const measuredBy = timing.executionSource === 'comfy-history-timestamps' ? 'Comfy history墙钟（非GPU kernel时间）' :
          timing.executionSource === 'local-bridge-observation' ? '本地桥接观察时间' :
            timing.executionSource === 'mixed' ? '累计来源混合，不作同口径比较' :
              timing.executionSource === 'incomplete' ? '部分尝试缺少计时来源' : '执行计时等待 Comfy history 回执';
        card.querySelector('[data-metrics]').textContent = `本次对照累计排队 ${formatTime(timing.queueMs)} · 累计执行 ${formatTime(timing.executionMs)} · 最近一次 ${formatTime(timing.latest?.timing?.queueMs)} / ${formatTime(timing.latest?.timing?.executionMs)} · 重试 ${timing.retries} 次 · ${measuredBy}`;
        const preflight = card.querySelector('[data-preflight]');
        const preflightEvidence = displayed?.preflightEvidence;
        preflight.hidden = !preflightEvidence;
        preflight.textContent = preflightEvidence ? `提交前节点预检：已核对 ${preflightEvidence.verified}/${preflightEvidence.classes} 类 · ${preflightEvidence.issues} 项明确问题 · ${preflightEvidence.unverified} 项未核实 · 节点集 ${preflightEvidence.schemaSha256?.slice(0, 12) || '缺失'} · 结果 ${preflightEvidence.findingsSha256?.slice(0, 12) || '缺失'}` : '';
        const keepMarks = window.arcABReview.report(pair).filter(mark => mark.variant === variant &&
          mark.jobId === displayed?.id && mark.kind === 'range');
        const kept = window.arcProductionQuality.usableRangeSummary(keepMarks.map(mark =>
          ({ startSeconds: mark.startMs / 1000, endSeconds: mark.endMs / 1000 })), displayed?.media?.seconds);
        if (kept.seconds > 0) {
          const perKept = Number.isFinite(timing.executionMs) ? ` · 累计执行 ${formatTime(timing.executionMs / kept.seconds)} / 可用秒` : '';
          const perKeptWithQueue = Number.isFinite(timing.executionMs) && Number.isFinite(timing.queueMs) ?
            ` · 含排队 ${formatTime((timing.executionMs + timing.queueMs) / kept.seconds)} / 可用秒` : '';
          card.querySelector('[data-metrics]').textContent += ` · 人工标可用 ${kept.seconds.toFixed(2)} 秒${perKept}${perKeptWithQueue}（不是平台账单）`;
        }
        const workflowId = displayed?.workflowSha256 || pair.workflowSha256;
        if (workflowId) card.querySelector('[data-metrics]').textContent += ` · 工作流 SHA-256 ${workflowId.slice(0, 12)}`;
        if (digestPattern.test(displayed?.effectivePromptSha256 || '')) card.querySelector('[data-metrics]').textContent +=
          ` · 实际提交提示词 SHA-256 ${displayed.effectivePromptSha256.slice(0, 12)}`;
        const measuredMedia = displayed?.media?.assetKey && displayed.media.assetKey === displayed?.output?.assetKey ? displayed.media : null;
        if (measuredMedia?.source === 'mp4-stts') card.querySelector('[data-metrics]').textContent +=
          ` · ${measuredMedia.frameCount} 帧 · ${measuredMedia.fps} fps${measuredMedia.codec ? ' · ' + measuredMedia.codec : ''}`;
        if (typeof measuredMedia?.hasAudio === 'boolean') card.querySelector('[data-metrics]').textContent +=
          ` · ${measuredMedia.hasAudio ? `含 ${measuredMedia.audioTrackCount} 条音轨` : '无音轨'}（仅容器检测，仍需听审同步）`;
        if (Number.isFinite(measuredMedia?.audioVideoDurationDeltaSeconds)) card.querySelector('[data-metrics]').textContent +=
          ` · 音画轨最大时长差 ${measuredMedia.audioVideoDurationDeltaSeconds.toFixed(3)} 秒（仅长度，不代表同步）`;
        const declared = displayed?.workflowDeclaration;
        const executionEvidence = displayed?.executionPromptEvidence;
        const modelLine = card.querySelector('[data-model]');
        const modelEvidence = card.querySelector('[data-model-evidence]');
        const modelNames = Array.isArray(declared?.models) ? declared.models
          .filter(model => model && typeof model.file === 'string').map(model => model.file).slice(0, 32) : [];
        const modelPrecision = Array.isArray(declared?.precision) ? declared.precision
          .filter(value => typeof value === 'string').slice(0, 16) : [];
        const modelSeeds = Array.isArray(declared?.seeds) ? declared.seeds.filter(seed => seed &&
          ['seed', 'noise_seed'].includes(seed.input) && Number.isSafeInteger(seed.value) && seed.value >= 0)
          .map(seed => `${seed.input} ${seed.value}`).slice(0, 32) : [];
        const samplerSettings = Array.isArray(declared?.samplers) ? declared.samplers.flatMap(sampler =>
          Object.entries(sampler?.settings || {}).map(([key, value]) =>
            `${key} ${Array.isArray(value) ? `连至节点 ${value[0]}` : String(value)}`)).slice(0, 12) : [];
        modelLine.hidden = !modelNames.length && !modelPrecision.length && !modelSeeds.length && !samplerSettings.length && !executionEvidence;
        const executionLabel = executionEvidence?.status === 'matched' ? 'ComfyUI history 请求图与提交图一致' :
          executionEvidence?.status === 'mismatch' ? 'ComfyUI history 请求图与提交图不一致' :
            executionEvidence?.status === 'unavailable' ? 'ComfyUI history 请求图不可核对' : executionEvidence?.status === 'pending' ? '等待 ComfyUI history 请求图核对' : '';
        modelEvidence.replaceChildren();
        const appendEvidence = (label, value) => {
          if (!value) return;
          const row = document.createElement('p');
          const strong = document.createElement('strong');
          strong.textContent = `${label}：`;
          row.append(strong, document.createTextNode(value));
          modelEvidence.append(row);
        };
        appendEvidence('工作流声明', [...modelNames, ...modelPrecision, ...modelSeeds].join(' · '));
        appendEvidence('工作流采样/处理参数', samplerSettings.join(' · '));
        appendEvidence('权重文件核验', pair.modelFileEvidence?.runtimeLoadedVerified === false ?
          `工作流引用文件字节已核对（${pair.modelFileEvidence.models?.length || 0} 个）；运行时实际加载仍未验证。` :
          '权重文件未作哈希核验；运行时实际加载未验证。');
        appendEvidence('请求图回执', executionLabel || '尚无 history 校验记录。');
        appendEvidence('证据边界', '请求图一致不证明远端实际加载了该权重文件，也不代表画质已验收。');
        button.disabled = preparingBoth || pending.has(variant) || Boolean(job && !terminal.has(job.status));
        button.hidden = Boolean(pair.repairReturn && pair.repairReturn.variant !== variant);
        button.textContent = job?.status === 'complete' ? `重跑 ${variant}` : job ? `重试 ${variant}` : `提交 ${variant}`;
        const video = displayed?.output;
        if (video && displayed !== job) card.querySelector('[data-status]').textContent += ' · 播放前一版，耗时对应所播版本';
        if (media.getAttribute('src') !== (video?.url || null)) {
          if (video) media.src = video.url; else { media.removeAttribute('src'); media.load(); }
          comparison.sourceChanged();
        }
        media.hidden = !video;
        choose.hidden = !video;
        const check = card.querySelector('[data-output-check]');
        const contract = displayed?.outputContract;
        if (video && contract) {
          const result = window.arcProductionQuality.evaluateMediaContract(media, contract, measuredMedia);
          const matches = result.status === 'pass';
          choose.disabled = !matches || pending.has(variant);
          check.textContent = media.readyState < 1 ? '等待回片尺寸和时长检查。' :
            result.status === 'unverified' ? result.issues.join('；') : matches ? '尺寸和时长已核对' : result.issues.join('；') || '尺寸或时长不符';
          if (media.readyState >= 1) check.textContent += ` · ${media.videoWidth}×${media.videoHeight} · ${media.duration.toFixed(2)} 秒`;
        } else { check.textContent = ''; }
      }
      const parameterParity = versions.querySelector('[data-param-parity]');
      const declarations = variants.map(variant => latestOutput(variant)?.workflowDeclaration);
      if (declarations.every(declaration => declaration?.evidence === 'workflow-declared')) {
        const signature = (declaration, variant) => ({ ...Object.fromEntries(['models', 'precision', 'seeds']
          .map(key => [key, key === 'models' && parameterMode(pair) && pair.parameterDiff.controlId === 'diffusion-weight' ?
            (declaration[key] || []).map(item => /UNETLoader/i.test(item.type || '') ?
              { ...item, file: '<selected-diffusion-weight>' } : item) : declaration[key] || []])),
          samplers: (declaration.samplers || []).map(item => ({ ...item,
            settings: { ...item.settings, ...(parameterMode(pair) && pair.parameterDiff.controlId === 'scheduler' ? { scheduler: undefined } : {}) } })),
          outputContract: latestOutput(variant)?.outputContract || null });
        let identical = stable(signature(declarations[0], 'A')) === stable(signature(declarations[1], 'B'));
        let parameterObserved = null;
        if (parameterMode(pair)) {
          const control = parameterControlFor(pair.parameterDiff.controlId);
          const expected = ['A', 'B'].map(variant => control?.options.find(option =>
            option.id === pair.parameterDiff.optionIds[variant])?.values || []);
          const actual = declarations.map((declaration, index) => pair.parameterDiff.controlId === 'scheduler' ?
            (declaration.samplers || []).flatMap(item => Object.entries(item.settings || {})
              .filter(([key]) => key === 'scheduler').map(([, value]) => value)) :
            (declaration.models || []).filter(item => /UNETLoader/i.test(item.type || '')).map(item => item.file));
          parameterObserved = { expected, actual };
          identical = identical && expected.every((values, index) => values.length === 1 && actual[index].length === 1 &&
            actual[index][0] === values[0]);
        }
        parameterParity.dataset.state = identical ? 'matched' : 'mismatch';
        parameterParity.textContent = identical ?
          parameterMode(pair) ? `参数实验核对：除${parameterControlName(pair.parameterDiff.controlId)}外的模型/采样项、seed 和输出规格一致；设定的 A/B 值已写入工作流声明。` :
            'A/B 参数核对：模型、精度、种子、采样及输出规格一致。运行回执和权重加载状态见各自详情。' :
          parameterMode(pair) ? `参数实验核对失败：${parameterControlName(pair.parameterDiff.controlId)}以外仍有差异，或工作流声明没有应用设定值（目标 A ${JSON.stringify(parameterObserved?.expected?.[0] || [])} / B ${JSON.stringify(parameterObserved?.expected?.[1] || [])}；声明 A ${JSON.stringify(parameterObserved?.actual?.[0] || [])} / B ${JSON.stringify(parameterObserved?.actual?.[1] || [])}）；不可作为单变量结论。` :
            'A/B 参数核对：模型、精度、种子、采样或输出规格有差异；这组不能解释为单变量对照。';
      } else {
        parameterParity.dataset.state = 'pending';
        parameterParity.textContent = declarations.some(Boolean) ?
          'A/B 参数核对：还缺一版完整工作流声明。' :
          'A/B 参数核对：共用设置已锁定；提交回片后核验两版实际声明。';
      }
      comparison?.setAudioAvailability(variants.map(variant => outputAudioAvailability(latestOutput(variant))));
      reviewTimeline?.refresh();
    }

    function latestOutput(variant) {
      return latestFor(pair, variant);
    }

    async function adopt(variant, media, details) {
      const current = pair;
      const attempt = latestOutput(variant);
      if (!attempt) return;
      const button = cards.get(variant).choose;
      button.disabled = true;
    message.textContent = `正在核对 ${variant} 版回片身份、画幅、时长、帧数与帧率…`;
      try {
        const result = await adoption(current, variant, media, details, options.request, options.shotBasis,
          selected => active && current === pair && latestOutput(variant)?.id === selected.id,
          status => { if (active) message.textContent = status; });
        if (result) options.adopt(...result);
      } catch (error) { if (active) message.textContent = error.message; }
      finally { button.disabled = false; }
    }

    function update(attempt, job, current, variant) {
      if (job.id !== attempt.id || job.comparison?.id !== current.id || job.comparison?.variant !== variant ||
          (job.comparison?.mode && job.comparison.mode !== pairMode(current)) ||
          (cueMode(current) && job.comparison?.cueDigest !== current.cueDigest) ||
          (parameterMode(current) && stable(job.comparison?.parameterDiff || null) !== stable({
            controlId: current.parameterDiff.controlId, optionIds: current.parameterDiff.optionIds })) ||
          (motionMode(current) && variant === 'B' && job.comparison.motionDigest !== current.motionDigest) ||
          (current.workflowSha256 && job.graphSha256 !== current.workflowSha256) ||
          !Object.hasOwn(labels, job.status)) throw new Error('返回的任务与当前对照不匹配。');
      const output = checkedOutput(attempt.id, job);
      if (job.outputs?.[0] && !output) throw new Error('任务与回片的测试/服务来源标记冲突，已拒绝登记。');
      if (output && presetPattern.test(job.preset || '')) output.url += `?preset=${encodeURIComponent(job.preset)}`;
      const next = { id: attempt.id, status: job.status, timing: job.timing, output, error: job.error,
        ...(digestPattern.test(job.providerFingerprint || '') ? { providerFingerprint: job.providerFingerprint } : {}),
        ...(presetPattern.test(job.preset || '') ? { preset: job.preset } : {}),
        comparison: { id: job.comparison.id, variant: job.comparison.variant,
          ...(['vfx', 'performance', 'motion', 'parameter'].includes(job.comparison.mode) ? { mode: job.comparison.mode } : {}),
          ...(job.comparison.parameterDiff ? { parameterDiff: job.comparison.parameterDiff } : {}),
          ...(typeof job.comparison.cueDigest === 'string' ? { cueDigest: job.comparison.cueDigest } : {}),
          ...(typeof job.comparison.motionDigest === 'string' ? { motionDigest: job.comparison.motionDigest } : {}),
          ...(motionReferenceEvidence(job.comparison.motionReference) ? { motionReference: motionReferenceEvidence(job.comparison.motionReference) } : {}) },
        ...(digestPattern.test(job.graphSha256 || '') ? { workflowSha256: job.graphSha256 } : {}),
        ...(attempt.preflightEvidence ? { preflightEvidence: attempt.preflightEvidence } : {}),
        ...(digestPattern.test(job.effectivePromptSha256 || '') ? { effectivePromptSha256: job.effectivePromptSha256 } : {}),
        ...(job.workflowDeclaration ? { workflowDeclaration: job.workflowDeclaration } : {}),
        ...(job.executionPromptEvidence ? { executionPromptEvidence: job.executionPromptEvidence } : {}),
        outputContract: job.outputContract,
        ...(typeof job.testFixture === 'boolean' ? { testFixture: job.testFixture } : {}) };
      if (JSON.stringify(next) === JSON.stringify(attempt)) return;
      Object.assign(attempt, next);
      if (!save()) message.textContent = '浏览器未能保存最新状态。可在本次页面继续查看。';
    }

    async function poll(force = false) {
      if (!active || !pair || polling) return;
      clearTimeout(timer);
      polling = true;
      const current = pair;
      let again = false;
      try {
        for (const variant of variants) {
          const attempt = current.attempts[variant].at(-1);
          if (!attempt || pending.has(variant) || terminal.has(attempt.status) && (!force || attempt.status === 'rejected')) continue;
          try {
            const job = await options.request('/' + attempt.id);
            if (!active) return;
            update(attempt, job, current, variant);
            if (!terminal.has(attempt.status) && attempt.status !== 'unconfirmed') again = true;
          } catch (error) {
            message.textContent = `${variant} 状态暂不可查：${error.message}。请刷新原任务，避免重复提交。`;
          }
        }
      } finally {
        polling = false;
        if (active) {
          show();
          if (again || current !== pair) timer = setTimeout(poll, 2300);
        }
      }
    }

    async function lockPair(source) {
      if (locking || preparingBoth || pending.size) return;
      locking = true;
      lock.disabled = true;
      sendRepair.disabled = true;
      try {
        const check = basisCheck;
        const { stale } = await check;
        if (basisCheck !== check || (stale && !confirmation.checked)) {
          throw new Error('请先核对当前镜头，再锁定一组新对照。');
        }
        const value = shared();
      if (source && !(await matchesLockedConditions(source, { ...value, repair: source.repair }))) {
          throw new Error('原对照的参考、参数或提示词已有变化。请核对当前设置后手动锁定新对照。');
        }
        const file = motionMode({ mode: selectedMode }) ? await options.motion() : undefined;
        const motionSource = file ? options.motionOrigin(file) : undefined;
        const [basis, motionDigest, cueDigest, shotBasis, references] = await Promise.all([
          stamp(value), file ? options.digest(file) : Promise.resolve(null),
          ['vfx', 'performance'].includes(selectedMode) ? options.digest(value.variableCue) : Promise.resolve(null), options.shotBasis(),
          Promise.all(Object.values(value.images).map(async (image, index) =>
            ({ ...value.references[index], sha256: await fingerprintImage(image) })))
        ]);
        if (!active) return;
        const currentShared = shared();
        if (basisCheck !== check || (stale && !confirmation.checked) || !basis ||
            await stamp(currentShared) !== basis || currentShared.workflow !== value.workflow ||
            currentShared.workflowSha256 !== value.workflowSha256 || currentShared.plannedSeconds !== value.plannedSeconds ||
            stable(currentShared.outputContract) !== stable(value.outputContract)) {
          throw new Error('正在锁定时共用设置发生变化，请重试。');
        }
        const settingsSnapshot = { ...JSON.parse(JSON.stringify(value.settings || {})),
          effectiveControls: JSON.parse(JSON.stringify(value.effectiveControls || {})) };
        if (value.parameterDiff) {
          for (const key of ['controls', 'effectiveControls']) delete settingsSnapshot[key]?.[value.parameterDiff.controlId];
        }
        const modelFileEvidence = value.parameterDiff?.controlId !== 'diffusion-weight' &&
          value.modelFileEvidence?.schema === 'arc-comfy-model-files-v3' &&
          value.modelFileEvidence.status === 'file-bytes-matched-runtime-unverified' &&
          value.modelFileEvidence.workflowSha256 === value.workflowSha256 &&
          value.modelFileEvidence.providerFingerprint === value.providerFingerprint &&
          digestPattern.test(value.modelFileEvidence.modelSetSha256 || '') &&
          window.arcWorkflowAudit.modelFilesMatch(value.expectedModelFiles, value.modelFileEvidence) ?
          JSON.parse(JSON.stringify(value.modelFileEvidence)) : null;
        const next = { id: crypto.randomUUID(), basisVersion: 5, mode: selectedMode,
          benchmarkId: selectedMode === 'parameter' ? parameterBenchmarkId(value.parameterDiff.controlId) : options.benchmark?.id || null,
          basis, profile: value.profile || null,
          providerFingerprint: digestPattern.test(value.providerFingerprint || '') ? value.providerFingerprint : null,
          assetKinds: JSON.parse(JSON.stringify(value.assetKinds || {})),
          ...(file ? { motionDigest, motionName: file.name, motionSource } : {}),
          ...(['vfx', 'performance'].includes(selectedMode) ? { variableCue: value.variableCue, cueDigest } : {}),
          ...(value.parameterDiff ? { parameterDiff: value.parameterDiff } : {}),
          prompt: value.prompt, label: value.label, shotBasis, basisParts: await currentParts,
          ...(modelFileEvidence ? { modelFileEvidence } : {}),
          references, workflow: value.workflow, workflowSha256: value.workflowSha256 || null, plannedSeconds: value.plannedSeconds,
          outputContract: JSON.parse(JSON.stringify(value.outputContract)),
          settingsSnapshot,
          testFixture: options.testFixture === true, ...(value.repair ? { repair: value.repair } : {}), attempts: { A: [], B: [] } };
        if (source && options.focusedRepair.origin) {
          const origin = options.focusedRepair.origin;
          const run = source.attempts[repairVariant].find(item =>
            item.id === origin.jobId && item.output?.assetKey === origin.assetKey && item.output?.name === origin.name);
          if (!run) throw new Error('找不到这次返修所对应的原回片。');
          const marks = window.arcABReview.report(source).filter(mark =>
            mark.variant === repairVariant && mark.jobId === origin.jobId && mark.assetKey === origin.assetKey);
          if (marks.some(mark => mark.kind !== 'range')) {
            next.repairReturn = { origin, variant: repairVariant, marks: marks.map(({ id, kind, startMs, endMs, change }) =>
              ({ id, kind, startMs, endMs, change })) };
          }
        }
        pairs.push(next);
        if (!save()) { pairs.pop(); throw new Error('浏览器未能保存这组对照。'); }
        pair = next;
        unverifiedCheckbox.checked = false;
        unverifiedConfirm.hidden = true;
        delete unverifiedConfirm.dataset.currentKey;
        delete unverifiedConfirm.dataset.confirmedKey;
        displayRepair();
        checkPromptBasis();
        archiveOptions();
        buildCards();
        message.textContent = '共用条件已锁定，可一起提交 A/B，也可分别提交。';
        return next;
      } catch (error) { if (active) message.textContent = error.message; }
      finally { locking = false; lock.disabled = false; if (active) show(); }
    }
    lock.onclick = () => lockPair();
    sendRepair.onclick = async () => {
      if (sendRepair.hidden || sendRepair.disabled) return;
      repairToggle.checked = true;
      const result = await lockPair(repairSource);
      if (active && result && result === pair) await submit(repairVariant);
    };

    function forVariant(value, current, variant) {
      if (!parameterMode(current)) return value;
      const parameter = current.parameterDiff;
      const controlId = parameter?.controlId;
      const optionId = parameter?.optionIds?.[variant];
      if (!parameterControlFor(controlId)?.options.some(option => option.id === optionId)) {
        throw new Error('参数实验记录中的模型/采样选项无效，请锁定新对照。');
      }
      return { ...value, settings: { ...value.settings,
        controls: { ...(value.settings?.controls || {}), [controlId]: optionId } } };
    }

    async function prepareInputs(current, withMotion, variant) {
      message.textContent = '正在读取本镜共用条件…';
      const commonValue = shared();
      message.textContent = '正在核对提示词、参考图、工作流和请求时长…';
      if (!(await matchesLockedConditions(current, commonValue))) throw new Error('共用条件、工作流或请求时长已变化。请恢复原值，或锁定新对照。');
      const value = forVariant(commonValue, current, variant);
      message.textContent = '正在预检工作流节点和参数…';
      let preflight;
      const controlsQuery = value.settings?.controlsProfile ? new URLSearchParams({
        controlsProfile: value.settings.controlsProfile, controls: JSON.stringify(value.settings.controls || {}),
        ...(value.settings.promptMode ? { promptMode: value.settings.promptMode } : {})
      }).toString() : '';
      try { preflight = await options.request('/preflight' + (controlsQuery ? '?' + controlsQuery : '')); }
      catch (error) { throw new Error(`工作流预检未完成，未提交 A/B：${error.message}`); }
      if (!['classes', 'verified', 'issues', 'unverified'].every(key => Number.isSafeInteger(preflight?.[key]) && preflight[key] >= 0) ||
          !Array.isArray(preflight?.findings)) throw new Error('工作流预检返回格式无效，未提交 A/B。');
      if (!digestPattern.test(preflight.graphSha256 || '') || !digestPattern.test(current.workflowSha256 || '')) {
        throw new Error('无法绑定服务端当前工作流与锁定对照的 SHA-256，未提交 A/B。请刷新工作流并重新锁定。');
      }
      if (!digestPattern.test(preflight.schemaSha256 || '')) {
        throw new Error('服务端未提供有效的节点定义集合指纹，无法复现本次预检，未提交 A/B。');
      }
      if (preflight.graphSha256 !== current.workflowSha256) {
        unverifiedCheckbox.checked = false;
        unverifiedConfirm.hidden = true;
        delete unverifiedConfirm.dataset.currentKey;
        delete unverifiedConfirm.dataset.confirmedKey;
        throw new Error('锁定对照后服务端工作流已变化，预检已停止提交。请刷新并重新锁定 A/B。');
      }
      if (!validOutputContract(preflight.outputContract) ||
          stable(preflight.outputContract) !== stable(current.outputContract)) {
        throw new Error('锁定对照后服务端输出规格已变化，预检已停止提交 A/B。请刷新工作流并重新锁定。');
      }
      const priorAttempts = variants.flatMap(variant => current.attempts?.[variant] || []);
      if (priorAttempts.length) {
        const priorSchemas = priorAttempts.map(attempt => attempt.preflightEvidence?.schemaSha256 || null);
        if (priorSchemas.some(hash => !digestPattern.test(hash || ''))) {
          unverifiedCheckbox.checked = false;
          unverifiedConfirm.hidden = true;
          delete unverifiedConfirm.dataset.currentKey;
          delete unverifiedConfirm.dataset.confirmedKey;
          throw new Error('本组先前回合缺少节点定义指纹，无法保证同组版本可比；未提交，请锁定新对照。');
        }
        if (priorSchemas.some(hash => hash !== preflight.schemaSha256)) {
          unverifiedCheckbox.checked = false;
          unverifiedConfirm.hidden = true;
          delete unverifiedConfirm.dataset.currentKey;
          delete unverifiedConfirm.dataset.confirmedKey;
          throw new Error('本组节点定义集合已变化，无法与先前回合公平对照；未提交，请锁定新对照。');
        }
      }
      if (preflight.issues > 0) {
        unverifiedCheckbox.checked = false;
        unverifiedConfirm.hidden = true;
        delete unverifiedConfirm.dataset.currentKey;
        delete unverifiedConfirm.dataset.confirmedKey;
        const details = preflight.findings.filter(item => item?.kind === 'issue').slice(0, 3)
          .map(item => [item.node, item.field, item.message].filter(Boolean).join('. ')).join('；');
        throw new Error(`工作流预检发现 ${preflight.issues} 项明确问题，已阻止提交以免浪费算力。${details ? ` ${details}` : ''} 请先修复后重试。`);
      }
      const findingsSha256 = await fingerprint(new TextEncoder().encode(stable(preflight.findings)));
      const preflightKey = `${preflight.graphSha256}:${preflight.schemaSha256}:${findingsSha256}`;
      if (preflight.unverified > 0) {
        unverifiedConfirm.hidden = false;
        if (unverifiedConfirm.dataset.currentKey !== preflightKey) {
          unverifiedCheckbox.checked = false;
          unverifiedConfirm.dataset.confirmedKey = '';
          unverifiedConfirm.dataset.currentKey = preflightKey;
        }
        if (!unverifiedCheckbox.checked || unverifiedConfirm.dataset.confirmedKey !== preflightKey) {
          throw new Error(`预检有 ${preflight.unverified} 项无法核实。请先点上方「预检工作流」查看节点明细，再勾选确认；当前 A/B 尚未提交。`);
        }
      } else {
        unverifiedCheckbox.checked = false;
        unverifiedConfirm.hidden = true;
        delete unverifiedConfirm.dataset.currentKey;
        delete unverifiedConfirm.dataset.confirmedKey;
      }
      const preflightEvidence = {
        evidence: 'comfy-object-info-preflight',
        status: preflight.unverified > 0 ? 'passed-with-unverified-items' : 'passed',
        workflowSha256: preflight.graphSha256,
        schemaSha256: preflight.schemaSha256,
        classes: preflight.classes, verified: preflight.verified,
        issues: preflight.issues, unverified: preflight.unverified,
        findingsSha256,
        checkedAt: new Date().toISOString()
      };
      if (preflight.unverified > 0) message.textContent = `已确认当前工作流的 ${preflight.unverified} 项待核实节点；开始准备输入。`;
      else message.textContent = '工作流节点和参数预检通过，正在准备输入…';
      let file;
      if (motionMode(current)) {
        message.textContent = '正在校验白模文件…';
        file = withMotion ? await options.motion() : undefined;
        if (file && await options.digest(file) !== current.motionDigest) throw new Error('白模内容已变化，请恢复原片或锁定新对照。');
      }
      return { value, file, preflight, preflightEvidence };
    }

    runBoth.onclick = async () => {
      if (!pair || runBoth.hidden || runBoth.disabled) return;
      const current = pair;
      preparingBoth = true;
      message.textContent = currentMode() === 'vfx' ? '正在核对共用设置和特效指令…' :
        currentMode() === 'performance' ? '正在核对共用设置和表演节拍…' : '正在核对共用设置和白模…';
      try {
        show();
        const prepared = {};
        for (const variant of variants) prepared[variant] = await prepareInputs(current, motionMode(current) && variant === 'B', variant);
        if (!(await matchesLockedConditions(current, shared()))) throw new Error('核对期间共用设置已变化，请重新提交。');
        if (!active || current !== pair) return;
        preparingBoth = false;
        await Promise.all(variants.map(variant => submit(variant, prepared[variant])));
      } catch (error) { if (active) message.textContent = error.message; }
      finally {
        preparingBoth = false;
        if (active) show();
      }
    };

    async function submit(variant, prepared) {
      if (!pair || locking || preparingBoth || pending.has(variant)) return;
      const current = pair;
      const mode = pairMode(current);
      if (current.repairReturn && current.repairReturn.variant !== variant) return;
      const list = current.attempts[variant];
      if (list.length && !terminal.has(list.at(-1).status)) return;
      pending.add(variant);
      if (!prepared || variant === 'A') message.textContent = '';
      show();
      let attempt;
      try {
        const inputs = prepared || await prepareInputs(current, motionMode(current) && variant === 'B', variant);
        const { value, preflight, preflightEvidence } = inputs;
        if (preflight.unverified > 0) message.textContent = `预检未发现明确错误；仍有 ${preflight.unverified} 项无法核实，请结合上方逐项详情判断。`;
        const file = mode === 'motion' && variant === 'B' ? inputs.file : undefined;
        if (!active || current !== pair) return;
        attempt = { id: crypto.randomUUID(), status: 'submitting', preflightEvidence };
        list.push(attempt);
        if (!save()) { list.pop(); attempt = undefined; throw new Error('浏览器未能保存任务，未发送提交。'); }
        const variantPrompt = mode === 'vfx' ? value.prompt + '\n\n' + (variant === 'A' ?
          'VFX condition: clean plate; do not add visible visual effects, particles, glow, energy, or impact graphics.' :
          'Single VFX cue: ' + current.variableCue) : mode === 'performance' && variant === 'B' ?
            value.prompt + '\n\nPerformance cue: ' + current.variableCue : value.prompt;
        const data = { id: attempt.id, prompt: value.repair ? variantPrompt + '\n\n' + value.repair : variantPrompt,
          sharedPrompt: value.prompt, providerFingerprint: current.providerFingerprint,
          ...(cueMode(current) ? { variableCue: current.variableCue } : {}),
          repair: value.repair || '',
          workflowSha256: current.workflowSha256,
          outputContract: current.outputContract,
          preflightSchemaSha256: preflightEvidence.schemaSha256,
          preflightFindingsSha256: preflightEvidence.findingsSha256,
          preflightUnverifiedAcknowledged: preflightEvidence.unverified > 0,
          images: value.images, referenceAssetKinds: value.assetKinds,
          ...value.settings, comparison: { id: current.id, variant, mode,
            ...(mode === 'motion' ? { motionDigest: current.motionDigest } : mode === 'parameter' ?
              { parameterDiff: { controlId: current.parameterDiff.controlId, optionIds: current.parameterDiff.optionIds } } :
              { cueDigest: current.cueDigest }) } };
        const task = JSON.stringify(data);
        let request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: task };
        if (file) {
          const body = new FormData();
          body.append('task', task);
          body.append(options.motionRole, file);
          request = { method: 'POST', body };
        }
        update(attempt, await options.request('', request), current, variant);
      } catch (error) {
        if (attempt) {
          attempt.status = [400, 403, 409, 429].includes(error.status) ? 'rejected' : 'unconfirmed';
          attempt.error = error.message;
          save();
        }
        if (active) message.textContent = error.message;
      } finally {
        pending.delete(variant);
        if (active) { show(); poll(); }
      }
    }

    archive.onchange = () => {
      pair = pairs.find(item => item.id === archive.value) || pairs.at(-1);
      text.value = pair?.prompt || '';
      variableCue.value = cueMode(pair || {}) ? pair.variableCue || '' : '';
      if (pair) {
        selectedMode = pairMode(pair);
        updateModeUI(selectedMode);
        if (parameterMode(pair) && parameterControlFor(pair.parameterDiff.controlId)) {
          parameterControlSelect.value = pair.parameterDiff.controlId;
          fillParameterOptions(parameterControlFor(pair.parameterDiff.controlId), pair.parameterDiff.optionIds);
        }
      }
      displayRepair();
      checkPromptBasis(pair && { hash: pair.shotBasis, parts: pair.basisParts });
      buildCards();
      poll();
    };
    refresh.onclick = () => poll(true);
    exportButton.onclick = () => {
      if (!pair) return;
      const generated = window.arcProductionProject.generatedCandidate(record) ||
        window.arcProductionProject.enhancementDetails(record)?.generationSource;
      const review = generated?.comparison?.id === pair.id ? {
        variant: generated.comparison.variant, jobId: generated.jobId, candidateVersion: record.version,
        recordedVerdict: record.verdict || '待审'
      } : null;
      const report = summarize(pair);
      for (const variant of variants) report.variants[variant].displayedJobId = latestOutput(variant)?.id || null;
      if (options.benchmark?.id) {
        report.benchmark = { id: options.benchmark.id,
          ...(options.benchmark.mode ? { mode: options.benchmark.mode } : {}),
          ...(options.benchmark.study ? { study: options.benchmark.study } : {}),
          ...(options.benchmark.variable ? { variable: options.benchmark.variable } : {}),
          ...(Array.isArray(options.benchmark.fixedInputs) ? { fixedInputs: [...options.benchmark.fixedInputs] } : {}),
          ...(options.benchmark.interpretationLimit ? { interpretationLimit: options.benchmark.interpretationLimit } : {}),
          checks: (options.benchmark.checks || []).map(check => ({ id: check.id, check: check.check })) };
        report.candidateReviews = Object.fromEntries(variants.map(variant => {
          const run = latestFor(pair, variant);
          return [variant, run && options.reviewContext ? window.arcProductionQuality.candidateReviewEvidence(record,
            options.reviewContext, { pairId: pair.id, variant, jobId: run.id, benchmark: options.benchmark }) : []];
        }));
      }
      const shot = `E${String(options.episode).padStart(2, '0')}-${options.shotId}`;
      const reportLabel = pairMode(pair) === 'parameter' ? `${parameterControlName(pair.parameterDiff.controlId)}参数实验` : pairMode(pair) === 'vfx' ? '特效提示对照' :
        pairMode(pair) === 'performance' ? '表演节拍对照' : '白模对照';
      options.download(`${shot}-${reportLabel}-${pair.id.slice(0, 8)}.json`, {
        schema: 'arc-h3-ab-report-v1', shot, ...report, review
      });
    };
    text.value = options.preparedPrompt && pair?.workflow !== options.workflowName
      ? options.preparedPrompt : pair?.prompt || options.initialPrompt();
    if (cueMode(pair || {})) variableCue.value = pair.variableCue || '';
    displayRepair();
    checkPromptBasis(pair ? { hash: pair.shotBasis, parts: pair.basisParts } :
      text.value.trim() ? { parts: options.inheritedParts() } : undefined);
    archiveOptions();
    buildCards();
    poll();
    return { panel, dispose() { active = false; clearTimeout(timer); reviewTimeline?.dispose(); comparison?.dispose(); model?.dispose(); } };
  }

  function mountArtReview(record, options) {
    const panel = document.createElement('details');
    panel.className = 'production-optional-field station-ab-art-review';
    panel.innerHTML = `
      <summary>本镜 A/B 美术验收</summary>
      <div class="production-picker"><label>选择对照<select></select></label><output role="status"></output></div>
      <div class="station-ab-layout"><div data-review-main></div><aside aria-label="本次对照使用的美术参考"></aside></div>`;
    const main = panel.querySelector('[data-review-main]');
    const side = panel.querySelector('aside');
    const status = panel.querySelector('output');
    const selector = panel.querySelector('select');
    const evidence = document.createElement('section');
    evidence.className = 'station-ab-quality-status';
    evidence.setAttribute('aria-live', 'polite');
    main.append(evidence);
    const pairs = readPairs(record).filter(pair =>
      variants.every(variant => latestFor(pair, variant)?.output?.assetKey));
    for (const [index, pair] of pairs.entries()) {
      selector.add(new Option(`对照 ${index + 1} · ${pair.workflow || (pairMode(pair) === 'parameter' ? parameterControlName(pair.parameterDiff.controlId) + ' 参数 A/B' :
        pairMode(pair) === 'vfx' ? '特效提示 A/B' : pairMode(pair) === 'performance' ? '表演节拍 A/B' : '白模 A/B')}`, pair.id));
    }
    selector.value = pairs.at(-1)?.id || '';
    selector.closest('label').hidden = pairs.length < 2;
    status.textContent = pairs.length ? '' : '同一组 A、B 两版回片完成后，即可在本镜同步验收。';
    let runtime, loading;

    function refreshEvidence(selectedPair = pairs.find(item => item.id === selector.value)) {
      evidence.replaceChildren();
      const heading = document.createElement('h4');
      heading.textContent = 'A/B 审片状态';
      const hint = document.createElement('p');
      hint.textContent = '按本次回片任务、版本和文件指纹读取已保存的人工验收；未审或依据过期不会标成通过。';
      evidence.append(heading, hint);
      if (!selectedPair) {
        const empty = document.createElement('p');
        empty.textContent = '两版回片就绪后会在这里显示各自的验收状态。';
        evidence.append(empty);
        return;
      }
      const grid = document.createElement('div');
      grid.className = 'station-ab-quality-grid';
      for (const variant of variants) {
        const run = latestFor(selectedPair, variant);
        const card = document.createElement('article');
        const title = document.createElement('strong');
        title.textContent = `${variant} · ${pairVariantLabel(selectedPair, variant)}`;
        const result = document.createElement('p');
        const candidates = run && options.reviewContext ?
          window.arcProductionQuality.candidateReviewEvidence(record, options.reviewContext,
            { pairId: selectedPair.id, variant, jobId: run.id, benchmark: options.benchmark }) : [];
        const candidate = candidates.at(-1);
        result.textContent = window.arcProductionQuality.reviewStatusLabel(candidate, { hasReturned: Boolean(run) });
        card.append(title, result);
        if (run) {
          const provenance = document.createElement('small');
          provenance.className = 'station-ab-quality-meta';
          provenance.textContent = run.testFixture === true || candidate?.testFixture === true ?
            '本地测试素材 · 不代表真实 H3 画面质量' :
            run.testFixture === false || candidate?.testFixture === false ?
              '已配置服务回片 · 实际模型/权重身份未验证 · 仍需人工审片' :
              '素材来源尚未确认';
          card.append(provenance);
          const timing = timingSummary(selectedPair.attempts[variant]);
          const metrics = document.createElement('small');
          metrics.className = 'station-ab-quality-meta';
          const formatDuration = value => Number.isFinite(value) ? `${(value / 1000).toFixed(1)} 秒` : '暂无';
          const measuredBy = timing.executionSource === 'comfy-history-timestamps' ? 'Comfy history墙钟（非GPU kernel时间）' :
            timing.executionSource === 'local-bridge-observation' ? '本地桥接观察时间' :
              timing.executionSource === 'mixed' ? '累计来源混合，不作同口径比较' :
                timing.executionSource === 'incomplete' ? '部分尝试缺少计时来源' : '执行计时等待 Comfy history 回执';
          metrics.textContent = `本次对照累计排队 ${formatDuration(timing.queueMs)} · 累计执行 ${formatDuration(timing.executionMs)} · 最近一次 ${formatDuration(timing.latest?.timing?.queueMs)} / ${formatDuration(timing.latest?.timing?.executionMs)} · 重试 ${timing.retries} 次 · ${measuredBy}`;
          card.append(metrics);
        }
        if (candidate) {
          const version = document.createElement('small');
          version.textContent = `${candidate.candidateVersion || '未命名版本'} · ${candidate.file || '未关联文件'} · 资产键 ${(candidate.outputAssetKey || '无').slice(0, 12)}`;
          card.append(version);
          for (const issue of candidate.review.issues.slice(0, 3)) {
            const note = document.createElement('p');
            note.className = 'station-ab-quality-issue';
            note.textContent = `${issue.label}${issue.note ? ' · ' + issue.note : ''}`;
            card.append(note);
          }
          for (const note of candidate.timecodeNotes.slice(0, 2)) {
            const timecode = document.createElement('p');
            timecode.className = 'station-ab-quality-issue';
            timecode.textContent = `${window.arcReviewNotes.timestamp(note.sourceMs)} · ${note.category} · ${note.note}`;
            card.append(timecode);
          }
        }
        if (options.benchmark?.checks?.length) {
          const completed = candidate?.review?.benchmarkChecks || [];
          const pending = candidate?.review?.benchmarkMissing || options.benchmark.checks.map(item => item.check);
          const summary = document.createElement('small');
          summary.className = 'station-ab-quality-meta';
          summary.textContent = `本镜专项 ${completed.filter(item => item.result !== '待核对').length} / ${options.benchmark.checks.length} 已核对`;
          card.append(summary);
          const list = document.createElement('ul');
          list.className = 'station-ab-benchmark-list';
          for (const definition of options.benchmark.checks) {
            const item = completed.find(row => row.id === definition.id);
            const row = document.createElement('li');
            const label = document.createElement('span');
            const state = item?.result || '待核对';
            const timecodes = item?.timecodes || [];
            label.textContent = `${state} · ${definition.check}` +
              (item?.note ? ` · ${item.note}` : '') +
              (timecodes.length ? ` · ${timecodes.map(mark => `${window.arcReviewNotes.timestamp(mark.sourceMs)}${mark.note ? ' ' + mark.note : ''}`).join(' / ')}` : '');
            row.append(label);
            list.append(row);
          }
          if (!pending.length && completed.length === options.benchmark.checks.length) list.dataset.complete = 'true';
          card.append(list);
        }
        grid.append(card);
      }
      evidence.append(grid);
    }

    function clear() {
      loading?.abort();
      loading = undefined;
      runtime?.dispose();
      runtime = undefined;
      main.replaceChildren(evidence);
      side.replaceChildren();
    }

    function saveMarks(pair) {
      const previous = record.generationAB;
      const history = JSON.parse(previous || '[]');
      const saved = history.find(item => item.id === pair.id);
      if (!saved || variants.some(variant =>
        latestFor(saved, variant)?.output?.assetKey !== latestFor(pair, variant)?.output?.assetKey)) {
        throw new Error('回片已变更，请重新打开本镜验收。');
      }
      saved.reviewMarks = pair.reviewMarks;
      for (const variant of variants) for (const run of saved.attempts[variant]) {
        const current = pair.attempts[variant].find(item => item.id === run.id);
        if (current?.output?.sha256 && digestPattern.test(current.output.sha256) &&
            Number.isSafeInteger(current.output.sizeBytes) && current.output.sizeBytes > 0) {
          run.output = { ...run.output, sha256: current.output.sha256, sizeBytes: current.output.sizeBytes };
        }
      }
      record.generationAB = JSON.stringify(history);
      if (options.save()) return true;
      record.generationAB = previous;
      return false;
    }

    function mediaFrame(label, element) {
      const figure = document.createElement('figure');
      const caption = document.createElement('figcaption');
      caption.textContent = label;
      figure.append(caption, element);
      return figure;
    }

    async function references(pair, signal) {
      const refs = (pair.references || []).filter(ref => ['角色', '分镜关键画面'].includes(ref.kind));
      const items = await Promise.all(refs.map(async ref => {
        const matches = options.assets.filter(asset => asset.kind === ref.kind && asset.name === ref.name &&
          asset.revision === ref.revision && asset.image);
        const item = matches.length === 1 && matches[0];
        if (!item || (ref.sha256 && await fingerprintImage(item.image) !== ref.sha256)) {
          const warning = document.createElement('p');
          warning.textContent = `无法核对回片使用的${ref.role}，请从素材库找回该版本。`;
          return warning;
        }
        const img = document.createElement('img');
        img.src = item.image;
        img.alt = ref.kind === '角色' ? '本次回片定妆' : '本次回片关键帧';
        return mediaFrame(img.alt + (ref.sha256 ? '' : ' · 历史版本名称匹配'), img);
      }));
      const motion = document.createElement('p');
      motion.textContent = `白模 · ${pair.motionName}`;
      const measuredMotion = motionReferenceEvidence(latestFor(pair, 'B')?.comparison?.motionReference);
      if (!signal.aborted) side.replaceChildren(...items, motion);
      try {
        const file = await window.arcMotionActions.loadReference(record);
        if (file.name !== pair.motionName || await fingerprint(await file.arrayBuffer()) !== pair.motionDigest) {
          throw new Error('当前白模与这组回片的锁定文件不同。');
        }
        if (signal.aborted) return;
        const player = document.createElement('video');
        player.src = options.trackMedia(file);
        player.controls = true;
        player.muted = true;
        player.preload = 'metadata';
        player.setAttribute('aria-label', '本次回片白模');
        motion.replaceWith(mediaFrame(measuredMotion ?
          `B 版白模 · 已核对文件 · ${measuredMotion.frameCount} 帧 · ${measuredMotion.fps} fps 恒定 · ${measuredMotion.durationSeconds.toFixed(2)} 秒 · ${measuredMotion.hasAudio ? '含音轨' : '无音轨'}` :
          'B 版白模 · 已核对文件 · 帧率元数据未记录', player));
      } catch (error) { if (!signal.aborted) motion.textContent += ' · ' + error.message; }
    }

    async function load() {
      const pair = pairs.find(item => item.id === selector.value);
      refreshEvidence(pair);
      if (!panel.open || !pair || runtime?.id === pair.id) return;
      clear();
      const controller = new AbortController();
      loading = controller;
      status.textContent = '正在核对 A、B 回片…';
      async function request(path) {
        const response = await fetch('/api/generation' + path, { cache: 'no-store', signal: controller.signal });
        const job = await response.json();
        if (!response.ok) throw new Error(job.error || '无法读取回片。');
        return job;
      }
      try {
        const checked = await Promise.all(variants.map(variant =>
          checkOutput(pair, variant, latestFor(pair, variant), request)));
        if (controller.signal.aborted || !panel.isConnected) return;
        const stage = document.createElement('div');
        stage.className = 'station-ab-videos';
        const urls = new Map();
        const players = checked.map(({ job, item }, index) => {
          const player = document.createElement('video');
          const sourceUrl = new URL(item.url, 'http://127.0.0.1');
          sourceUrl.searchParams.set('file', item.name);
          sourceUrl.searchParams.set('asset', item.assetKey);
          const source = sourceUrl.pathname + sourceUrl.search;
          player.preload = 'metadata';
          player.controls = true;
          player.playsInline = true;
          player.src = source;
          urls.set(player, source);
          const run = latestFor(pair, variants[index]);
          run.outputContract = job.outputContract;
          const label = `${variants[index]} · ${pairVariantLabel(pair, variants[index])}` + (job.testFixture ? ' · 本地测试素材' : '');
          stage.append(mediaFrame(label, player));
          return player;
        });
        const comparison = window.arcCompare.create(...players, { audioChoice: true,
          audioLabels: variants.map(variant => `${variant} · ${pairVariantLabel(pair, variant)}`) });
        comparison.setAudioAvailability(variants.map(variant => outputAudioAvailability(latestFor(pair, variant))));
        const timeline = window.arcABReview.mount({
          pair, latest: variant => latestFor(pair, variant), players, comparison, art: true,
          sourceMatches: (player, run) => player.getAttribute('src') === urls.get(player) && Boolean(run?.output),
          save: () => saveMarks(pair),
          async adopt(variant, details) {
            const result = await adoption(pair, variant, players[variants.indexOf(variant)], details, request,
              options.shotBasis, () => !controller.signal.aborted && panel.isConnected && panel.open);
            if (result) options.adopt(...result);
          }
        });
        runtime = { id: pair.id, pause: comparison.pauseForEvidence, dispose() {
          timeline.dispose();
          comparison.dispose();
          for (const player of players) { player.removeAttribute('src'); player.load(); }
        } };
        main.append(stage, comparison.panel, timeline.panel);
        status.textContent = '同步两版后，选择有问题的一版进行标记。';
        await references(pair, controller.signal);
      } catch (error) { if (!controller.signal.aborted) status.textContent = error.message; }
    }
    selector.onchange = load;
    panel.ontoggle = () => {
      if (panel.open) load();
      else runtime?.pause();
    };
    return { panel, dispose: clear, refreshEvidence };
  }

  window.arcAB = { mount, mountArtReview, pairs: readPairs, latest: record => readPairs(record).at(-1),
    latestReport: record => summarize(readPairs(record).at(-1)), latestComparableReport, repeatability, sourceOriginConsistent,
    outputAudioAvailability };
})();
