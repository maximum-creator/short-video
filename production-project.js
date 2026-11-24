((root) => {
  const camera = typeof module === 'object' && module.exports ? require('./production-camera.js') : root.arcCamera;
  const artReview = typeof module === 'object' && module.exports ? require('./production-art-review.js') : root.arcArtReview;
  const recheck = typeof module === 'object' && module.exports ? require('./production-recheck.js') : root.arcRecheck;
  const abReturn = typeof module === 'object' && module.exports ? require('./production-ab-return.js') : root.arcABReturn;
  const quality = typeof module === 'object' && module.exports ? require('./production-quality.js') : null;
  const schema = 'arc-workbench-project-v1';
  const states = ['待审', '通过', '返修', '可回收'];
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isRecord = value => isObject(value) && Object.values(value).every(item => typeof item === 'string');
  const number = index => String(index + 1).padStart(2, '0');
  const finite = value => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
  const targetDuration = episode => Number.isInteger(episode?.targetDurationSec) &&
    episode.targetDurationSec >= 30 && episode.targetDurationSec <= 600 ? episode.targetDurationSec : 90;
  const reviewFields = ['version', 'file', 'inPoint', 'outPoint', 'caption', 'issue', 'verdict', 'repairPlan', 'sourceBinding', 'generatedCandidate', 'enhancementResult', 'aiEnhancementJob', 'abRepairReview'];
  const generatedRoute = /^\/api\/generation\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\/video\/(\d{1,3})$/i;
  const assetKinds = ['角色', '场景', '道具', '光色', '表演参考', '分镜关键画面'];
  const imagePattern = /^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/]+={0,2}$/i;
  const imageLimit = 2_000_000;
  const validReview = value => isRecord(value) &&
    (value.verdict === undefined || states.includes(value.verdict));
  const validDenoiseIdentity = value => isObject(value) && typeof value.name === 'string' &&
    value.name.length > 0 && value.name.length <= 240 && Number.isSafeInteger(value.size) && value.size > 0 &&
    value.size <= 128 * 1024 ** 2 && /^[a-f0-9]{64}$/.test(value.sha256 || '');
  const validExecutionPromptEvidence = value => isObject(value) && value.evidence === 'comfy-history-prompt' &&
    ['pending', 'matched', 'mismatch', 'unavailable'].includes(value.status) &&
    (value.submittedSha256 === undefined || /^[a-f0-9]{64}$/.test(value.submittedSha256)) &&
    (value.historySha256 === undefined || /^[a-f0-9]{64}$/.test(value.historySha256));
  const validDenoiseShot = value => isObject(value) && /^E\d{2}-S\d{2}$/.test(value.id || '') &&
    typeof value.version === 'string' && value.version.length > 0 && value.version.length <= 200 &&
    Number.isFinite(value.start) && Number.isFinite(value.end) && value.start >= 0 && value.end > value.start;
  const validDenoiseTask = (task, pair, denoise) => isObject(task) &&
    task.schema === 'arc-ai-enhancement-task-v1' &&
    /^[a-f0-9-]{36}$/.test(task.id || '') && validDenoiseIdentity(task.source) &&
    validDenoiseIdentity(task.media) && Number.isFinite(task.media.duration) && task.media.duration > 0 &&
    task.source.sha256 === pair.source.sha256 && task.media.sha256 === pair.media.sha256 &&
    task.media.name === pair.media.name && task.media.size === pair.media.size &&
    validDenoiseShot(task.shot) && task.shot.id === pair.shot.id && task.shot.version === pair.shot.version &&
    task.shot.start === pair.shot.start && task.shot.end === pair.shot.end &&
    isObject(task.options) && task.options.denoise === denoise &&
    task.options.workflowSha256 === pair.workflowSha256 &&
    task.options.preflightSchemaSha256 === pair.preflightSchemaSha256 &&
    task.providerFingerprint === pair.providerFingerprint && Number.isInteger(task.retryCount) && task.retryCount >= 0 &&
    task.retryCount <= 20 && Array.isArray(task.attemptHistory) && task.attemptHistory.length <= 20 &&
    typeof task.status === 'string' && task.status.length <= 60 &&
    (task.executionPromptEvidence === undefined || validExecutionPromptEvidence(task.executionPromptEvidence)) &&
    (task.error === undefined || (typeof task.error === 'string' && task.error.length <= 300)) &&
    (task.testFixture === undefined || typeof task.testFixture === 'boolean');
  const validDenoisePairs = pairs => pairs === undefined || (Array.isArray(pairs) && pairs.length <= 10 &&
    pairs.every(pair => {
      if (!isObject(pair) || pair.schema !== 'arc-seedvr2-denoise-ab-v1' ||
          !/^[a-f0-9-]{36}$/.test(pair.id || '') || typeof pair.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(pair.createdAt)) || !validDenoiseShot(pair.shot) ||
          !validDenoiseIdentity(pair.source) || !validDenoiseIdentity(pair.media) ||
          !Number.isFinite(pair.media.duration) || pair.media.duration <= 0 ||
          !/^[a-f0-9]{64}$/.test(pair.workflowSha256 || '') ||
          !/^[a-f0-9]{64}$/.test(pair.preflightSchemaSha256 || '') ||
          !/^[a-f0-9]{64}$/.test(pair.providerFingerprint || '') || !isObject(pair.variants)) return false;
      return ['A', 'B'].every(variant => {
        const item = pair.variants[variant];
        if (!isObject(item) || !Number.isFinite(item.denoise) || !validDenoiseTask(item.task, pair, item.denoise)) return false;
        if (item.output === undefined) return true;
        return isObject(item.output) && typeof item.output.name === 'string' && item.output.name.length > 0 &&
          item.output.name.length <= 240 && /^[a-f0-9]{64}$/.test(item.output.assetKey || '') &&
          item.output.url === `/api/enhancement/${item.task.id}/video/0`;
      }) && pair.variants.A.denoise !== pair.variants.B.denoise &&
        (pair.reviewMarks === undefined || (Array.isArray(pair.reviewMarks) && pair.reviewMarks.length <= 100 &&
          pair.reviewMarks.every(mark => isObject(mark) && Number.isSafeInteger(mark.atMs) && mark.atMs >= 0 &&
            mark.atMs <= (pair.media.duration + 10) * 1000 && ['A', 'B', 'A/B'].includes(mark.target) &&
            ['细节抹除', '闪烁', '运动重影', '边缘伪影', '其他'].includes(mark.issue) &&
            typeof mark.note === 'string' && mark.note.length <= 300 &&
            typeof mark.createdAt === 'string' && Number.isFinite(Date.parse(mark.createdAt)))));
    }));
  const validRefs = (refs, ids) => refs === undefined || (Array.isArray(refs) &&
    refs.every(id => ids.has(id)) && new Set(refs).size === refs.length);
  const validShot = (shot, ids, frames) => {
    if (!isObject(shot)) return false;
    const { candidates, refs, seedvr2DenoisePairs, ...fields } = shot;
    return validReview(fields) && validDenoisePairs(seedvr2DenoisePairs) && validRefs(refs, ids) &&
      (!shot.frameAsset || frames.has(shot.frameAsset)) && (candidates === undefined ||
      (Array.isArray(candidates) && candidates.every(candidate => {
        if (!isObject(candidate)) return false;
        const { refs: references, ...review } = candidate;
        return validReview(review) && validRefs(references, ids);
      })));
  };

  function orderedShots(episode) {
    return episode.shotOrder ?? episode.shots.map((_, index) => index);
  }

  function storyboard(project, episodeIndex, { skipEmpty = false } = {}) {
    const episode = project.episodes[episodeIndex];
    const assets = new Map((project.assets ?? []).map(asset => [asset.id, asset]));
    let end = 0;
    const order = orderedShots(episode);
    const included = skipEmpty ? order.filter(index => Object.keys(episode.shots[index]).length) : order;
    return included.map(index => {
      const shot = episode.shots[index];
      const seconds = Number(shot.duration);
      const specified = finite(shot.duration) && seconds >= 0.25 && seconds <= 120;
      const start = end;
      end += Math.round((specified ? seconds : 3) * 1000);
      const cameraPlan = camera.read(shot);
      return { index, id: 'S' + number(index), start, end, specified, beat: shot.beat,
        frame: assets.get(shot.frameAsset), ...(cameraPlan ? { cameraPlan } : {}) };
    });
  }

  function scriptAnchorStatus(shot, pages) {
    const anchor = typeof shot.scriptAnchor === 'string' ? shot.scriptAnchor.trim() : '';
    if (!anchor) return { ready: false, missing: true, reason: '请在分镜补填本镜对应的剧本原句。' };
    if (anchor.length > 500) return { ready: false, missing: false, reason: '剧本原文锚点请控制在 500 字以内。' };
    const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, '');
    const quote = normalize(anchor);
    const source = normalize([pages?.story, pages?.dialogue].filter(value => typeof value === 'string').join('\n'));
    if (!quote || !source.includes(quote)) return { ready: false, missing: false,
      reason: '本镜绑定的剧本原句已不在当前剧情或对白中，请重新核对。' };
    return { ready: true, missing: false, reason: '' };
  }

  function moveShot(episode, from, to) {
    const order = [...orderedShots(episode)];
    if (!Number.isInteger(from) || !Number.isInteger(to) || !order.includes(from) || !order.includes(to)) {
      throw new Error('镜头顺序无效。');
    }
    const target = order.indexOf(to);
    order.splice(order.indexOf(from), 1);
    order.splice(target, 0, from);
    episode.shotOrder = order;
  }

  function addAsset(project, fields) {
    const name = fields.name.trim();
    const revision = fields.revision.trim();
    if (!assetKinds.includes(fields.kind) || !name || !revision) throw new Error('请填写类别、名称与版本。');
    const assets = project.assets ?? [];
    if (assets.some(asset => asset.kind === fields.kind && asset.name === name && asset.revision === revision)) {
      throw new Error('该素材版本已存在。请使用新的版本名称。');
    }
    const image = fields.image || '';
    if ((image && !imagePattern.test(image)) ||
      assets.reduce((sum, asset) => sum + asset.image.length, image.length) > imageLimit) {
      throw new Error('参考图需为 PNG、JPEG 或 WebP，且本项目参考图总量已达本地原型上限时，请换较小的图。');
    }
    const asset = { id: 'A' + number(assets.length), kind: fields.kind, name, revision, image, notes: fields.notes.trim() };
    project.assets = [...assets, asset];
    return asset;
  }

  function replacementReferences(project, shot, originalId, replacementId) {
    const refs = shot.refs || [];
    const assets = project.assets || [];
    const original = assets.find(asset => asset.id === originalId);
    const replacement = assets.find(asset => asset.id === replacementId);
    if (!original || !replacement || !refs.includes(originalId) || originalId === replacementId ||
        original.kind !== replacement.kind || original.name !== replacement.name) {
      throw new Error('只能替换本镜已绑定的同名同类别参考版本。');
    }
    return [...new Set(refs.map(id => id === originalId ? replacementId : id))];
  }

  function saveCandidate(shot) {
    const version = shot.version?.trim();
    if (!version) throw new Error('先填写本版名称，再保存候选。');
    const candidates = shot.candidates ?? [];
    if (candidates.some(item => item.version === version)) {
      throw new Error('这个版本已保留。请为当前候选填写不同的版本名称。');
    }
    const snapshot = Object.fromEntries(reviewFields.filter(key => typeof shot[key] === 'string')
      .map(key => [key, shot[key]]));
    snapshot.version = version;
    if (shot.refs) snapshot.refs = [...shot.refs];
    for (const key of ['reviewNotes', 'reviewChecks']) {
      if (typeof shot[key] === 'string') snapshot[key] = shot[key];
    }
    shot.candidates = [...candidates, snapshot];
    return snapshot;
  }

  function loadCandidate(shot, index, { restoreReviewState = false } = {}) {
    const snapshot = shot.candidates?.[index];
    if (!snapshot) throw new Error('请选择要载入的候选版本。');
    const currentReviewState = Object.fromEntries(['reviewNotes', 'reviewChecks']
      .filter(key => typeof shot[key] === 'string').map(key => [key, shot[key]]));
    for (const key of reviewFields) delete shot[key];
    delete shot.refs;
    Object.assign(shot, snapshot, { verdict: '待审' });
    if (snapshot.refs) shot.refs = [...snapshot.refs];
    for (const key of ['reviewNotes', 'reviewChecks']) {
      if (restoreReviewState) {
        if (typeof snapshot[key] === 'string') shot[key] = snapshot[key];
        else delete shot[key];
      } else if (typeof currentReviewState[key] === 'string') {
        shot[key] = currentReviewState[key];
      }
    }
  }

  function backup(project) {
    return { schema, project };
  }

  function restore(payload) {
    const project = payload?.project;
    const modelEvidence = project?.modelFileEvidence;
    const validModelEvidence = modelEvidence === undefined || (
      Array.isArray(modelEvidence) && modelEvidence.length <= 32 && modelEvidence.every(item => {
        if (!isObject(item) || item.status !== 'file-bytes-matched-runtime-unverified' ||
            item.evidence !== 'workflow-requested-files-present-and-hashed' || item.runtimeLoadedVerified !== false ||
            (item.schema === 'arc-comfy-model-files-v2' || item.schema === 'arc-comfy-model-files-v3' ?
              !/^[a-f0-9]{64}$/.test(item.modelSetSha256 || '') ||
                item.schema === 'arc-comfy-model-files-v3' && (!/^[a-f0-9]{64}$/.test(item.providerFingerprint || '') ||
                  item.providerBinding !== 'operator-supplied-endpoint-fingerprint') :
              item.schema !== undefined && item.schema !== 'arc-comfy-model-files-v1') ||
            !/^[a-f0-9]{64}$/.test(item.workflowSha256 || '') || !Array.isArray(item.models) ||
            !item.models.length || item.models.length > 256) return false;
        return item.models.every(model => isObject(model) && /^[\w.-]{1,170}$/.test(model.node || '') &&
          /^[\w.-]{1,170}$/.test(model.classType || '') && /^[\w.-]{1,170}$/.test(model.field || '') &&
          /^[\w.-]{1,170}\.(?:safetensors|gguf|ckpt|pt|bin)$/i.test(model.file || '') &&
          Number.isSafeInteger(model.sizeBytes) && model.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(model.sha256 || ''));
      })
    );
    const scriptImportHistory = project?.scriptImportHistory;
    const validScriptImportHistory = scriptImportHistory === undefined || (
      Array.isArray(scriptImportHistory) && scriptImportHistory.length <= 50 && scriptImportHistory.every(item =>
        isObject(item) && item.schema === 'arc-script-import-v1' && /^[a-f0-9]{64}$/.test(item.sha256 || '') &&
        typeof item.fileName === 'string' && item.fileName.length > 0 && item.fileName.length <= 240 &&
        Number.isSafeInteger(item.fileSize) && item.fileSize > 0 && item.fileSize <= 20 * 1024 ** 2 &&
        ['txt', 'md', 'docx'].includes(item.format) && typeof item.importedAt === 'string' &&
        Number.isFinite(Date.parse(item.importedAt)) && typeof item.prefaceIncluded === 'boolean' &&
        Array.isArray(item.mappings) && item.mappings.length > 0 && item.mappings.length <= 300 &&
        item.mappings.every(mapping => isObject(mapping) &&
          (mapping.sourceEpisode === null || (Number.isInteger(mapping.sourceEpisode) && mapping.sourceEpisode >= 1 && mapping.sourceEpisode <= 300)) &&
          Number.isInteger(mapping.targetEpisode) && mapping.targetEpisode >= 1 && mapping.targetEpisode <= 300 &&
          ['keep', 'replace', 'append', 'title', 'preface'].includes(mapping.action))
      )
    );
    const assets = project?.assets ?? [];
    const validAssets = Array.isArray(assets) && assets.every((asset, index) =>
      isRecord(asset) && asset.id === 'A' + number(index) && assetKinds.includes(asset.kind) &&
      Boolean(asset.name?.trim() && asset.revision?.trim()) && typeof asset.notes === 'string' &&
      (asset.image === '' || (typeof asset.image === 'string' && imagePattern.test(asset.image)))) &&
      assets.reduce((sum, asset) => sum + asset.image.length, 0) <= imageLimit;
    const ids = new Set(validAssets ? assets.map(asset => asset.id) : []);
    const frames = new Set(validAssets ? assets.filter(asset => asset.kind === '分镜关键画面').map(asset => asset.id) : []);
    if (payload?.schema !== schema || !isObject(project) || !isRecord(project.series) ||
      !validAssets || project.assets === null || !validModelEvidence || !validScriptImportHistory ||
      !Array.isArray(project.episodes) || !project.episodes.length ||
      !project.episodes.every(episode => isObject(episode) && isRecord(episode.pages) &&
        Array.isArray(episode.shots) && episode.shots.length &&
        (episode.targetDurationSec === undefined || (Number.isInteger(episode.targetDurationSec) &&
          episode.targetDurationSec >= 30 && episode.targetDurationSec <= 600)) &&
        episode.shots.every(shot => validShot(shot, ids, frames)) &&
        (episode.shotOrder === undefined || (Array.isArray(episode.shotOrder) &&
          episode.shotOrder.length === episode.shots.length && new Set(episode.shotOrder).size === episode.shots.length &&
          episode.shotOrder.every(index => Number.isInteger(index) && index >= 0 && index < episode.shots.length))))) {
      throw new Error('文件不是有效的弧光项目备份，或含有无法恢复的记录。');
    }
    return project;
  }

  function candidateSource(shot) {
    try {
      const value = JSON.parse(shot.sourceBinding || 'null');
      if (!value || !value.version || !value.file || value.version !== shot.version?.trim() || value.file !== shot.file?.trim() ||
          !Number.isSafeInteger(value.size) || value.size <= 0 ||
          !/^(sha256|sample-v1):[a-f0-9]{64}$/.test(value.fingerprint) ||
          !/^sha256-tree-v1:[a-f0-9]{64}$/.test(value.contentDigest)) return null;
      return { size: value.size, fingerprint: value.fingerprint, contentDigest: value.contentDigest };
    } catch { return null; }
  }

  function readJobReferences(raw) {
    if (!Array.isArray(raw)) return undefined;
    return raw.slice(0, 32).flatMap(item => {
      if (typeof item?.role !== 'string' || !item.role.trim() || typeof item.name !== 'string' || !item.name.trim()) return [];
      const reference = { role: item.role.slice(0, 160), name: item.name.slice(0, 240) };
      if (assetKinds.includes(item.kind)) reference.kind = item.kind;
      if (typeof item.revision === 'string') reference.revision = item.revision.slice(0, 120);
      if (item.role === '白模动作' && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)) {
        reference.sha256 = item.sha256;
        if (['builtin', 'local'].includes(item.source)) reference.source = item.source;
      }
      return [reference];
    });
  }

  function readComparison(input) {
    if (!input || !/^[a-f0-9-]{36}$/i.test(input.id || '') || !['A', 'B'].includes(input.variant)) return undefined;
    return { id: input.id, variant: input.variant,
      ...(input.mode === 'motion' || input.mode === 'vfx' || input.mode === 'performance' ? { mode: input.mode } : {}),
      ...(typeof input.effectivePromptSha256 === 'string' && /^[a-f0-9]{64}$/.test(input.effectivePromptSha256) ?
        { effectivePromptSha256: input.effectivePromptSha256 } : {}),
      ...(input.outputIdentity?.evidence === 'full-upstream-video-bytes-sha256' && /^[a-f0-9]{64}$/.test(input.outputIdentity.sha256 || '') &&
        Number.isSafeInteger(input.outputIdentity.sizeBytes) && input.outputIdentity.sizeBytes > 0 ?
        { outputIdentity: { evidence: input.outputIdentity.evidence, sha256: input.outputIdentity.sha256,
          sizeBytes: input.outputIdentity.sizeBytes } } : {}),
      ...Object.fromEntries(['queueMs', 'executionMs', 'retryCount'].filter(key =>
        Number.isSafeInteger(input[key]) && input[key] >= 0).map(key => [key, input[key]])),
      ...(Number.isFinite(input.durationSec) && input.durationSec > 0 && input.durationSec <= 600 ?
        { durationSec: input.durationSec } : {}),
      ...(Number.isFinite(input.fps) && input.fps >= 1 && input.fps <= 240 ? { fps: input.fps } : {}),
      ...(input.fpsEvidenceSource === 'mp4-stts' && input.frameRateMode === 'constant' ?
        { fpsEvidenceSource: input.fpsEvidenceSource, frameRateMode: input.frameRateMode } : {}) };
  }

  function saveGeneratedCandidate(shot, item, jobId, basisStatus, basisHash, jobReferences, comparison) {
    let parsedUrl;
    try { parsedUrl = new URL(item?.url || '', 'http://127.0.0.1'); } catch { parsedUrl = null; }
    const match = generatedRoute.exec(parsedUrl?.pathname || '');
    const preset = parsedUrl?.searchParams.get('preset');
    if (!match || match[1] !== jobId || typeof item?.assetKey !== 'string' || !/^[a-f\d]{64}$/.test(item.assetKey) ||
        (preset && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(preset)) ||
        typeof item?.name !== 'string' || !item.name || item.name.length > 180 ||
        /[\\/:\x00-\x1f]/.test(item.name) || !/\.(mp4|webm|mov)$/i.test(item.name)) throw new Error('返回的视频身份无效。');
    return JSON.stringify({ jobId, index: Number(match[2]), name: item.name, assetKey: item.assetKey, ...(preset ? { preset } : {}), version: shot.version,
      ...(typeof item.sha256 === 'string' && /^[a-f\d]{64}$/.test(item.sha256) && Number.isSafeInteger(item.sizeBytes) &&
        item.sizeBytes > 0 ? { sha256: item.sha256, sizeBytes: item.sizeBytes } : {}),
      ...(['current', 'changed', 'unknown'].includes(basisStatus) ? { basisStatus } : {}),
      ...(/^[a-f\d]{64}$/.test(basisHash) ? { basisHash } : {}),
      jobReferences: readJobReferences(jobReferences), comparison: readComparison(comparison),
      ...(item.testFixture === true ? { testFixture: true } : {}) });
  }

  function generatedCandidate(shot) {
    try {
      const data = JSON.parse(shot.generatedCandidate || 'null');
      if (!data || data.version !== shot.version?.trim() || data.name !== shot.file?.trim() ||
          !Number.isInteger(data.index) || data.index < 0 || data.index > 999) return null;
      const route = `/api/generation/${data.jobId}/video/${data.index}`;
      const routeQuery = new URLSearchParams(data.preset ? { preset: data.preset } : {});
      saveGeneratedCandidate(shot, { name: data.name, url: route + (routeQuery.size ? '?' + routeQuery : ''), assetKey: data.assetKey,
        sha256: data.sha256, sizeBytes: data.sizeBytes }, data.jobId);
      const mediaQuery = new URLSearchParams({ file: data.name, asset: data.assetKey, ...(data.preset ? { preset: data.preset } : {}) });
      return { url: route + '?' + mediaQuery, name: data.name,
        jobId: data.jobId, assetKey: data.assetKey, index: data.index,
        ...(typeof data.preset === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(data.preset) ? { preset: data.preset } : {}),
        ...(typeof data.sha256 === 'string' && /^[a-f\d]{64}$/.test(data.sha256) && Number.isSafeInteger(data.sizeBytes) &&
          data.sizeBytes > 0 ? { sha256: data.sha256, sizeBytes: data.sizeBytes } : {}),
        basisStatus: ['current', 'changed'].includes(data.basisStatus) ? data.basisStatus : 'unknown',
        jobReferences: readJobReferences(data.jobReferences),
        comparison: readComparison(data.comparison),
        ...(data.testFixture === true ? { testFixture: true } : {}),
        ...(typeof data.basisHash === 'string' && /^[a-f\d]{64}$/.test(data.basisHash) ? { basisHash: data.basisHash } : {}) };
    } catch { return null; }
  }

  // Use the same byte layout and threshold as ARC's local video import.
  async function fingerprintSource(file, onProgress) {
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器环境无法生成指纹，请用本地工作台地址打开。');
    if (!Number.isSafeInteger(file.size) || file.size < 1) throw new Error('请选择非空视频。');
    const hash = await root.ArcStreamSha256.file(file, onProgress && ((done, total) => onProgress(done, total * 2)));
    const contentDigest = await root.arcSourceDigest.compute(file, onProgress && ((done, total) => onProgress(total + done, total * 2)));
    return { size: file.size, fingerprint: 'sha256:' + hash, contentDigest };
  }

  function postCue(shot, length = 15, sourceIn = 0) {
    const { postCueStart, postCueEnd, postCueRegion } = shot;
    const region = postCueRegion?.trim() || '';
    if (!region && !postCueStart?.trim() && !postCueEnd?.trim()) return null;
    const start = Number(postCueStart), end = Number(postCueEnd);
    if (!shot.postEffects?.trim() || !region || region.length > 120 ||
        !finite(postCueStart) || !finite(postCueEnd) || !Number.isFinite(length) || start < 0 || end > 15 ||
        Math.round(end * 1e6) <= Math.round(start * 1e6) ||
        Math.round(end * 1e6) > Math.round(length * 1e6)) {
      throw new Error('后期合成标记须填写效果、画面位置和镜头内有效起止时间。');
    }
    return { start, end, region, sourceIn };
  }

  function assembly(project, episodeIndex) {
    const episode = project.episodes[episodeIndex];
    const continuity = typeof module === 'object' && module.exports ?
      require('./production-continuity.js') : root.arcContinuity;
    const continuityBasis = continuity.reviewBasis(project, episodeIndex);
    const shots = orderedShots(episode).map(index => {
      const shot = episode.shots[index];
      const file = shot.file?.trim();
      const start = finite(shot.inPoint) ? Number(shot.inPoint) : null;
      const end = finite(shot.outPoint) ? Number(shot.outPoint) : null;
      const title = shot.version?.trim();
      const verdict = shot.verdict || '待审';
      let issue = '';
      if (verdict === '通过') {
        const anchor = scriptAnchorStatus(shot, episode.pages);
        const benchmarkForShot = quality?.benchmarkForShot || root.arcProductionQuality?.benchmarkForShot;
        const benchmark = benchmarkForShot?.(project.series?.title, episodeIndex, index,
          shot.qualityBenchmarkId || null, shot.qualityBenchmarkMode || 'motion') || null;
        const visual = artReview.approval(shot, project.series, episode.pages, continuityBasis, benchmark);
        const priorIssues = recheck.approval(shot);
        if (!anchor.ready) issue = anchor.reason;
        else if (!visual.ready) issue = visual.unbound ? '请先核验并绑定当前视频指纹' : visual.stale ? '原片指纹、美术设定、剧本段落、连续性规则或分镜已变化，请重新完成视觉验收' :
          visual.issues.length ? `${visual.issues[0].label}仍待返修` : visual.benchmarkMissing?.length ?
            `试镜专项仍待核对：${visual.benchmarkMissing[0]}` : '请先完成本候选的七项视觉验收';
        else if (!priorIssues.ready) issue = `旧版问题尚未全部复核：待复核 ${priorIssues.pending} 项，仍存在 ${priorIssues.stillExists} 项`;
        else if (!abReturn.approval(shot, candidateSource(shot)).ready) issue = '返修问题或原可用片段尚未全部通过复核';
        else if (!file || /[\\/:]/.test(file) || /\.json$/i.test(file) || !title) issue = '缺少有效的源视频文件名或候选版本';
        else if (start === null || end === null) issue = '缺少源视频入点或出点';
        else if (start < 0 || end <= start) issue = '出点须大于入点，入点须大于等于零';
        else if (end - start < .15) issue = 'ARC 本地粗剪导出要求每镜至少 0.15 秒';
        else if (end - start > 15) issue = '单镜超过 H3 的 15 秒输出上限，请拆成多个短镜头';
        if (!issue) {
          try { postCue(shot, end - start, start); }
          catch (error) { issue = error.message; }
        }
      }
      return { index, id: `E${number(episodeIndex)}-S${number(index)}`, file, start, end, title,
        scriptAnchor: typeof shot.scriptAnchor === 'string' ? shot.scriptAnchor.trim() : '',
        caption: shot.caption || '', verdict, issue, source: candidateSource(shot) };
    });
    const approved = shots.filter(shot => shot.verdict === '通过');
    const ready = approved.filter(shot => !shot.issue);
    const duration = ready.reduce((total, shot) => total + (shot.end - shot.start), 0);
    const episodeTargetDurationSec = targetDuration(episode);
    const minimumShotCount = Math.ceil(episodeTargetDurationSec / 15);
    const frameDuration = ready.reduce((frames, shot) => frames +
      Math.max(1, Math.round((Math.round(shot.end * 1e6) - Math.round(shot.start * 1e6)) * 30 / 1e6)), 0) / 30;
    const sourceCount = new Set(ready.map(shot => shot.file.normalize('NFC').toLowerCase())).size;
    const identities = new Map();
    let error = '';
    if (!approved.length || approved.length > 50) error = '该集需要 1 至 50 个通过的镜头。';
    else if (approved.length !== ready.length) {
      const first = approved.find(shot => shot.issue);
      const destination = first.index !== undefined && !scriptAnchorStatus(episode.shots[first.index], episode.pages).ready
        ? '请回到分镜核对。' : '请在镜头审片补齐。';
      error = `${first.id} · ${first.issue.replace(/[。；; ]+$/u, '')}；${destination}`;
    } else if (duration > 600.000001) error = '粗剪总时长超过 10 分钟。';
    for (const shot of ready) {
      if (!shot.source) continue;
      const key = shot.file.normalize('NFC').toLowerCase();
      const previous = identities.get(key);
      if (previous && (previous.source.size !== shot.source.size || previous.source.fingerprint !== shot.source.fingerprint)) {
        if (!error) error = `${previous.id} 和 ${shot.id} 使用同名的不同视频。请改名后回到镜头审片重新绑定。`;
      } else identities.set(key, shot);
    }
    return { shots, ready, duration, frameDuration, sourceCount, error, episodeTargetDurationSec,
      minimumShotCount, durationProgress: Math.min(100, duration / episodeTargetDurationSec * 100),
      targetReached: ready.length >= minimumShotCount && duration >= episodeTargetDurationSec };
  }

  function manifestShot(project, episodeIndex, { index, id, file, start, end, title, scriptAnchor, caption, source }) {
    const motionActions = typeof module === 'object' && module.exports ?
      require('./production-actions.js') : root.arcMotionActions;
    const episode = project.episodes[episodeIndex];
    const assets = new Map((project.assets || []).map(asset => [asset.id, asset]));
    const shot = episode.shots[index];
    const referenceIds = [...new Set([...(shot.refs || []), ...(shot.frameAsset ? [shot.frameAsset] : [])])].slice(0, 15);
    const enhanced = enhancementDetails(shot);
    const generated = generatedCandidate(shot) || enhanced?.generationSource;
    const cue = postCue(shot, end - start, start);
    const motion = motionActions.describe(shot.motionAction);
    const cameraPreview = camera.read(shot);
    const productionOrigin = {
      schema: 'arc-short-drama-origin-v1', episode: episodeIndex + 1, shotId: id,
      candidateVersion: title,
      scriptAnchor,
      beat: shot.beat || '',
      composition: shot.composition || '',
      performance: shot.performance || '',
      ...(motion ? { motionPlan: { name: motion.name, beats: motion.beats } } : {}),
      ...(shot.postEffects?.trim() ? { postEffects: shot.postEffects.trim().slice(0, 1200) } : {}),
      ...(cue ? { postCue: cue } : {}),
      ...(generated?.jobId ? { generationJobId: generated.jobId } : {}),
      ...(generated?.preset ? { generationPreset: generated.preset } : {}),
      ...(generated?.assetKey ? { generationAssetKey: generated.assetKey } : {}),
      ...((generated?.generatedVideoSha256 || generated?.sha256) ? { generatedVideoSha256: generated.generatedVideoSha256 || generated.sha256,
        ...((Number.isSafeInteger(generated.sizeBytes) && generated.sizeBytes > 0) ||
          (Number.isSafeInteger(generated.generatedVideoSizeBytes) && generated.generatedVideoSizeBytes > 0) ||
          (Number.isSafeInteger(generated.comparison?.outputIdentity?.sizeBytes) && generated.comparison.outputIdentity.sizeBytes > 0) ?
          { generatedVideoSizeBytes: generated.sizeBytes || generated.generatedVideoSizeBytes || generated.comparison?.outputIdentity?.sizeBytes } : {}) } : {}),
      ...(generated?.jobReferences ? { generationReferences: generated.jobReferences } : {}),
      ...(generated?.comparison ? { generationComparison: generated.comparison } : {}),
      ...(enhanced ? { enhancement: { sourceVersion: enhanced.sourceVersion, sourceStart: enhanced.sourceStart,
        width: enhanced.width, height: enhanced.height, fps: enhanced.fps, ...(enhanced.engine ? { engine: enhanced.engine } : {}),
        ...(enhanced.generationSource ? { generationVersion: enhanced.generationSource.version,
          generationFile: enhanced.generationSource.name, generationSha256: enhanced.generationSource.sha256 } : {}) } } : {}),
      ...(generated?.testFixture || enhanced?.testFixture || title.startsWith('本地流程样片-') ? { testFixture: true } : {}),
      references: referenceIds.map(assetId => assets.get(assetId)).filter(Boolean)
        .map(asset => ({ kind: asset.kind, name: asset.name, revision: asset.revision, notes: asset.notes })),
      camera: { move: shot.move || '', path: shot.path || '', guide: shot.guide || '',
        ...(shot.lighting?.trim() ? { lighting: shot.lighting.trim().slice(0, 1200) } : {}),
        ...(cameraPreview ? { preview: cameraPreview } : {}) }
    };
    return { id, file, start, end, title, scriptAnchor, caption, productionOrigin,
      ...(source ? { source } : {}) };
  }

  function shotReplacement(project, episodeIndex, shotIndex) {
    const row = assembly(project, episodeIndex).shots.find(shot => shot.index === shotIndex);
    if (row?.verdict !== '通过') throw new Error('请先验收通过当前候选。');
    if (row.issue) throw new Error(row.issue);
    if (!row.source?.contentDigest) throw new Error('请绑定新版本原视频并完成全文件校验。');
    return { schema: 'arc-shot-replacement-v1', shot: manifestShot(project, episodeIndex, row) };
  }

  function shotRollback(project, episodeIndex, shotIndex) {
    const episode = project.episodes[episodeIndex];
    const shot = episode.shots[shotIndex];
    const origin = abReturn.read(shot)?.origin;
    const index = origin ? (shot.candidates || []).findIndex(previous => {
      const media = generatedCandidate(previous);
      return previous.version === origin.version && previous.file === origin.name &&
        media?.jobId === origin.jobId && media.assetKey === origin.assetKey;
    }) : -1;
    if (index < 0 || shot.candidates[index].verdict !== '通过') throw new Error('旧版没有可导出的通过记录。');
    const previous = { ...shot };
    loadCandidate(previous, index, { restoreReviewState: true });
    previous.verdict = '通过';
    const shots = [...episode.shots];
    shots[shotIndex] = previous;
    const episodes = [...project.episodes];
    episodes[episodeIndex] = { ...episode, shots };
    return shotReplacement({ ...project, episodes }, episodeIndex, shotIndex);
  }

  function shotPatch(project, episodeIndex, shotIndex) {
    const episode = project.episodes[episodeIndex];
    const record = episode.shots[shotIndex];
    const original = shotRollback(project, episodeIndex, shotIndex).shot;
    const source = candidateSource(record);
    const ranges = abReturn.patchIntervals(record, { ...original,
      fps: original.productionOrigin?.generationComparison?.fps,
      fpsEvidenceSource: original.productionOrigin?.generationComparison?.fpsEvidenceSource,
      frameRateMode: original.productionOrigin?.generationComparison?.frameRateMode,
      candidateFps: generatedCandidate(record)?.comparison?.fps,
      candidateFpsEvidenceSource: generatedCandidate(record)?.comparison?.fpsEvidenceSource,
      candidateFrameRateMode: generatedCandidate(record)?.comparison?.frameRateMode }, source);
    const shot = manifestShot(project, episodeIndex, {
      index: shotIndex, id: original.id, file: record.file.trim(), start: original.start, end: original.end,
      title: record.version.trim(), scriptAnchor: original.scriptAnchor, caption: original.caption, source
    });
    const protectedRanges = abReturn.read(record).marks.filter(mark => mark.kind === 'range')
      .map(mark => ({ startMs: mark.startMs, endMs: mark.endMs }));
    return { schema: 'arc-shot-patch-v1', shot, original, ranges, protectedRanges };
  }

  function protectedShot(project, episodeIndex, ready) {
    return ready.find(row =>
      abReturn.read(project.episodes[episodeIndex].shots[row.index])?.marks.some(mark => mark.kind === 'range')) || null;
  }

  function manifest(project, episodeIndex, quality, scriptCoverageReview, { originalPatchBaseline = false } = {}) {
    if (!['720', '1080'].includes(quality)) throw new Error('请选择 720p 或 1080p。');
    const episode = project.episodes[episodeIndex];
    const { ready, error } = assembly(project, episodeIndex);
    if (error) throw new Error(error);
    const protectedRow = protectedShot(project, episodeIndex, ready);
    if (protectedRow && !originalPatchBaseline) {
      throw new Error('本集有已锁定的旧原片区间。请在原 ARC 工程导入「局部换镜」清单，避免整镜覆盖。');
    }
    const shots = ready.map(row => row === protectedRow
      ? shotRollback(project, episodeIndex, row.index).shot
      : manifestShot(project, episodeIndex, row));
    const identities = new Map();
    for (const shot of protectedRow ? shots : []) {
      const key = shot.file.normalize('NFC').toLowerCase();
      const previous = identities.get(key);
      if (previous && (previous.source?.size !== shot.source?.size ||
          previous.source?.fingerprint !== shot.source?.fingerprint)) {
        throw new Error(`${previous.id} 和 ${shot.id} 使用同名的不同视频。`);
      }
      identities.set(key, shot);
    }
    if (shots.reduce((duration, shot) => duration + shot.end - shot.start, 0) > 600.000001) {
      throw new Error('粗剪总时长超过 10 分钟。');
    }
    return { schema: 'arc-episode-v1', title: `第 ${number(episodeIndex)} 集`, quality,
      targetDurationSec: targetDuration(episode),
      ...(scriptCoverageReview === undefined ? {} : { scriptCoverageReview }), shots };
  }

  function enhancement(episodeIndex, shotIndex, shot, source, options) {
    if (shot.verdict !== '通过' || !shot.version?.trim()) throw new Error('先在镜头审片中确认源视频版本。');
    if (!shot.file || shot.file.trim() !== source.name || !Number.isSafeInteger(source.size) || source.size < 1 ||
      !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('请选择当前通过版本的原视频。');
    if (!finite(shot.inPoint) || !finite(shot.outPoint)) throw new Error('请填写源视频的入点和出点。');
    const start = Number(shot.inPoint), end = Number(shot.outPoint);
    if (start < 0 || end - start < .25 || end - start > 120) throw new Error('只处理 0.25 至 120 秒的单个镜头。');
    const legacyCleanup = ['none', 'gentle', 'medium'].includes(options.cleanup) &&
      options.denoise === undefined && options.sharpen === undefined;
    const splitCleanup = ['off', 'light', 'medium'].includes(options.denoise) &&
      ['off', 'light'].includes(options.sharpen) && options.cleanup === undefined;
    if (!['original', '720', '1080'].includes(options.resolution) || !['30', '60'].includes(options.fps) ||
      (!legacyCleanup && !splitCleanup) || typeof options.interpolate !== 'boolean') throw new Error('画质选项无效。');
    return { schema: 'arc-shot-enhance-v1',
      shot: { id: `E${number(episodeIndex)}-S${number(shotIndex)}`, version: shot.version, start, end },
      source, options };
  }

  function sameAiEnhancementRetryBasis(previous, next) {
    if (!isObject(previous) || !isObject(next) || !['complete', 'failed', 'no_video'].includes(previous.status) ||
        !isObject(previous.shot) || !isObject(next.shot) || !isObject(previous.source) || !isObject(next.source) ||
        !isObject(previous.media) || !isObject(next.media) || !isObject(previous.options) || !isObject(next.options) ||
        !Number.isSafeInteger(previous.retryCount) || previous.retryCount < 0 || !Array.isArray(previous.attemptHistory) ||
        previous.attemptHistory.length !== previous.retryCount) return false;
    const sameKeys = (left, right, keys) => keys.every(key => left[key] === right[key]);
    const canonical = value => Array.isArray(value) ? value.map(canonical) : isObject(value) ?
      Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const optionsSignature = JSON.stringify(canonical(previous.options));
    const historyMatches = previous.attemptHistory.every(attempt => isObject(attempt) &&
      ['complete', 'failed', 'no_video'].includes(attempt.status) && attempt.sourceSha256 === previous.source.sha256 &&
      attempt.mediaSha256 === previous.media.sha256 && attempt.shotVersion === previous.shot.version &&
      attempt.workflowSha256 === previous.options.workflowSha256 && attempt.providerFingerprint === previous.providerFingerprint &&
      isObject(attempt.options) && JSON.stringify(canonical(attempt.options)) === optionsSignature);
    return historyMatches && sameKeys(previous.shot, next.shot, ['id', 'version', 'start', 'end']) &&
      sameKeys(previous.source, next.source, ['name', 'size', 'sha256']) &&
      sameKeys(previous.media, next.media, ['name', 'size', 'sha256']) &&
      previous.providerFingerprint === next.providerFingerprint &&
      JSON.stringify(canonical(previous.options)) === JSON.stringify(canonical(next.options));
  }

  function enhancementCandidate(episodeIndex, shotIndex, shot, report, source, output) {
    if (report?.schema !== 'arc-shot-enhance-result-v1' || !isObject(report.shot) || !isObject(report.output)) {
      throw new Error('请选择 ARC 画质任务生成的结果报告。');
    }
    const expected = enhancement(episodeIndex, shotIndex, shot, source, report.options || {});
    if (['id', 'version', 'start', 'end'].some(key => report.shot[key] !== expected.shot[key]) ||
        ['name', 'size', 'sha256'].some(key => report.source?.[key] !== source[key])) {
      throw new Error('处理报告与当前通过镜头、切点或原文件不一致。');
    }
    const detail = report.output;
    const cursorStart = Math.round(expected.shot.start * 1e6);
    const cursorEnd = Math.round(expected.shot.end * 1e6);
    const sourceSpan = (cursorEnd - cursorStart) / 1e6;
    const frameSpan = (cursorEnd - cursorStart) * 30 / 1e6;
    const previousDuration = Math.round(frameSpan) / 30;
    const duration = !report.engine && detail.duration === Math.ceil(frameSpan) / 30 ? detail.duration : previousDuration;
    const fps = Number(expected.options.fps);
    if (['name', 'size', 'sha256', 'width', 'height'].some(key => detail[key] !== output[key]) ||
        !/^[a-f0-9]{64}$/.test(output.sha256) || !Number.isSafeInteger(output.size) || output.size < 1 ||
        typeof output.name !== 'string' || !/\.mp4$/i.test(output.name) || /[\\/:\x00-\x1f]/.test(output.name) ||
        !Number.isInteger(output.width) || !Number.isInteger(output.height) || output.width < 1 || output.height < 1 ||
        !Number.isFinite(output.duration) || output.duration + .001 < duration || output.duration - duration > .08 ||
        detail.duration !== duration || detail.fps !== fps || detail.frames !== Math.round(fps * duration) ||
        typeof detail.audio !== 'boolean' || (expected.options.resolution !== 'original' &&
          Math.min(output.width, output.height) !== Number(expected.options.resolution))) {
      throw new Error('处理版文件的指纹、画面或时长与报告不符。');
    }
    let provenance = null;
    if (report.engine !== undefined) {
      const engine = report.engine, aiInput = report.aiInput, aiOutput = report.aiOutput;
      const aiIdentity = value => isObject(value) && typeof value.name === 'string' && value.name.length > 0 &&
        !/[\\/:\x00-\x1f]/.test(value.name) && Number.isSafeInteger(value.size) && value.size > 0 &&
        /^[a-f0-9]{64}$/.test(value.sha256 || '');
      if (!isObject(engine) || engine.kind !== 'comfyui-ai-enhancement' ||
          !/^[a-f0-9]{64}$/.test(engine.workflowSha256 || '') ||
          !/^[a-f0-9]{64}$/.test(engine.providerFingerprint || '') ||
          (engine.preflightSchemaSha256 !== undefined && !/^[a-f0-9]{64}$/.test(engine.preflightSchemaSha256 || '')) ||
          (engine.executionPromptEvidence !== undefined &&
            (!validExecutionPromptEvidence(engine.executionPromptEvidence) || engine.executionPromptEvidence.status !== 'matched' ||
              engine.executionPromptEvidence.submittedSha256 !== engine.executionPromptEvidence.historySha256)) ||
          (engine.modelParameters !== undefined && (!isObject(engine.modelParameters) || Object.entries(engine.modelParameters).some(([key, value]) =>
            key !== 'denoise' || !Number.isFinite(value) || value < 0 || value > 100))) ||
          !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(engine.taskId || '') ||
          typeof engine.testFixture !== 'boolean' ||
          (engine.retryCount !== undefined && engine.retryCount !== null &&
            (!Number.isSafeInteger(engine.retryCount) || engine.retryCount < 0 || engine.retryCount > 100)) ||
          (engine.timingSource !== undefined && !['local-bridge', 'per-field'].includes(engine.timingSource)) ||
          (engine.timing !== undefined && (!isObject(engine.timing) || Object.entries(engine.timing).some(([key, value]) =>
            ['queueMs', 'executionMs', 'bridgeMs'].includes(key) ? value !== null && (!Number.isFinite(value) || value < 0 || value > 7 * 24 * 3600 * 1000) :
              key === 'queueSource' || key === 'executionSource' ? value !== null && value !== 'comfy-history-timestamps' :
                key === 'bridgeSource' ? value !== null && value !== 'local-bridge-observation' :
                  key === 'gpuKernelTime' ? value !== null && value !== false : true))) ||
          (engine.attemptHistory !== undefined && (!Array.isArray(engine.attemptHistory) || engine.attemptHistory.length > 100 ||
            engine.attemptHistory.length !== (engine.retryCount ?? 0) || engine.attemptHistory.some(attempt =>
              !isObject(attempt) || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(attempt.taskId || '') ||
              !['complete', 'failed', 'no_video'].includes(attempt.status) || !/^[a-f0-9]{64}$/.test(attempt.sourceSha256 || '') ||
              attempt.sourceSha256 !== report.source.sha256 || attempt.mediaSha256 !== aiInput.sha256 ||
              attempt.shotVersion !== expected.shot.version ||
               ['queueMs', 'executionMs', 'bridgeMs'].some(key => attempt[key] !== null && attempt[key] !== undefined &&
                 (!Number.isFinite(attempt[key]) || attempt[key] < 0 || attempt[key] > 7 * 24 * 3600 * 1000)) ||
               ['queueSource', 'executionSource'].some(key => attempt[key] !== null && attempt[key] !== undefined && attempt[key] !== 'comfy-history-timestamps') ||
               (attempt.bridgeSource !== null && attempt.bridgeSource !== undefined && attempt.bridgeSource !== 'local-bridge-observation') ||
               (attempt.gpuKernelTime !== null && attempt.gpuKernelTime !== undefined && attempt.gpuKernelTime !== false)))) ||
          !aiIdentity(aiInput) || !aiIdentity(aiOutput) || !Number.isInteger(aiOutput.width) ||
          !Number.isInteger(aiOutput.height) || aiOutput.width < 1 || aiOutput.height < 1 ||
          !Number.isFinite(aiOutput.duration) || aiOutput.duration <= 0) {
        throw new Error('AI 处理来源或任务指纹无效。');
      }
      let submittedTask = null;
      try { submittedTask = JSON.parse(shot.aiEnhancementJob || 'null'); } catch { /* An unparseable task cannot bind an AI return. */ }
      const taskMatches = isObject(submittedTask) && submittedTask.schema === 'arc-ai-enhancement-task-v1' &&
        submittedTask.id === engine.taskId && submittedTask.status === 'complete' &&
        ['id', 'version', 'start', 'end'].every(key => submittedTask.shot?.[key] === expected.shot[key]) &&
        ['name', 'size', 'sha256'].every(key => submittedTask.source?.[key] === expected.source[key]) &&
        ['name', 'size', 'sha256'].every(key => submittedTask.media?.[key] === aiInput[key]) &&
        submittedTask.options?.workflowSha256 === engine.workflowSha256 &&
        (engine.preflightSchemaSha256 === undefined || submittedTask.options?.preflightSchemaSha256 === engine.preflightSchemaSha256) &&
        (engine.modelParameters === undefined || JSON.stringify(engine.modelParameters) === JSON.stringify(
          submittedTask.options?.denoise === undefined ? {} : { denoise: submittedTask.options.denoise })) &&
        (engine.executionPromptEvidence === undefined || JSON.stringify(engine.executionPromptEvidence) ===
          JSON.stringify(submittedTask.executionPromptEvidence)) &&
        submittedTask.providerFingerprint === engine.providerFingerprint &&
        submittedTask.testFixture === engine.testFixture &&
        (submittedTask.retryCount === undefined || submittedTask.retryCount === engine.retryCount) &&
        (submittedTask.attemptHistory === undefined || JSON.stringify(submittedTask.attemptHistory) === JSON.stringify(engine.attemptHistory)) &&
        (engine.timing === undefined || JSON.stringify(submittedTask.runtime && Object.fromEntries(Object.keys(engine.timing).map(key => [key, submittedTask.runtime[key] ?? null]))) === JSON.stringify(engine.timing));
      if (!taskMatches) throw new Error('AI 结果与当前已完成的 ComfyUI 任务、工作流、端点或裁片不匹配。');
      provenance = { engine: { kind: engine.kind, workflowSha256: engine.workflowSha256, taskId: engine.taskId,
        ...(typeof engine.providerFingerprint === 'string' ? { providerFingerprint: engine.providerFingerprint } : {}),
        ...(typeof engine.preflightSchemaSha256 === 'string' ? { preflightSchemaSha256: engine.preflightSchemaSha256 } : {}),
        ...(isObject(engine.executionPromptEvidence) ? { executionPromptEvidence: { ...engine.executionPromptEvidence } } : {}),
        ...(isObject(engine.modelParameters) ? { modelParameters: { ...engine.modelParameters } } : {}),
        ...(typeof engine.testFixture === 'boolean' ? { testFixture: engine.testFixture } : {}),
        ...(engine.retryCount !== undefined ? { retryCount: engine.retryCount } : {}),
        ...(engine.timingSource ? { timingSource: engine.timingSource } : {}),
        ...(isObject(engine.timing) ? { timing: { ...engine.timing } } : {}),
        ...(Array.isArray(engine.attemptHistory) ? { attemptHistory: engine.attemptHistory.map(item => ({ ...item })) } : {}) },
        aiInput: { name: aiInput.name, size: aiInput.size, sha256: aiInput.sha256,
          ...(Number.isSafeInteger(aiInput.frames) && aiInput.frames > 0 ? { frames: aiInput.frames } : {}),
          ...(typeof aiInput.fps === 'string' && /^[1-9]\d*\/[1-9]\d*$/.test(aiInput.fps) ? { fps: aiInput.fps } : {}),
          ...(typeof aiInput.audio === 'boolean' ? { audio: aiInput.audio } : {}) },
        aiOutput: { name: aiOutput.name, size: aiOutput.size, sha256: aiOutput.sha256,
          width: aiOutput.width, height: aiOutput.height, duration: aiOutput.duration,
          ...(Number.isSafeInteger(aiOutput.frames) && aiOutput.frames > 0 ? { frames: aiOutput.frames } : {}),
          ...(typeof aiOutput.fps === 'string' && /^[1-9]\d*\/[1-9]\d*$/.test(aiOutput.fps) ? { fps: aiOutput.fps } : {}),
          ...(typeof aiOutput.audio === 'boolean' ? { audio: aiOutput.audio } : {}) } };
    }
    if (report.processing !== undefined) {
      const processing = report.processing;
      if (report.engine !== undefined || !isObject(processing) || processing.schema !== 'arc-local-processing-v1' ||
          processing.engine !== 'ffmpeg' || !['legacy-cleanup-v1', 'split-denoise-sharpen-v1'].includes(processing.profile) ||
          typeof processing.ffmpegVersion !== 'string' || !processing.ffmpegVersion.trim() || processing.ffmpegVersion.length > 240 ||
          (processing.processingMs !== undefined && (!Number.isSafeInteger(processing.processingMs) || processing.processingMs < 0 || processing.processingMs > 604_800_000)) ||
          /[\x00-\x1f]/.test(processing.ffmpegVersion) || typeof processing.videoFilter !== 'string' ||
          !processing.videoFilter || processing.videoFilter.length > 6000 || /[\x00-\x1f]/.test(processing.videoFilter) ||
          typeof processing.audioFilter !== 'string' || processing.audioFilter.length > 1000 || /[\x00-\x1f]/.test(processing.audioFilter) ||
          processing.videoEncoder !== 'libx264 -crf 17 -preset fast -pix_fmt yuv420p' || processing.audioEncoder !== 'aac') {
        throw new Error('本地处理器参数报告无效。');
      }
      provenance = { ...(provenance || {}), processing: { schema: processing.schema, engine: processing.engine,
        profile: processing.profile, ...(processing.processingMs !== undefined ? { processingMs: processing.processingMs } : {}),
        ffmpegVersion: processing.ffmpegVersion, videoFilter: processing.videoFilter,
        audioFilter: processing.audioFilter, videoEncoder: processing.videoEncoder, audioEncoder: processing.audioEncoder } };
    }
    const version = '增强-' + output.sha256.slice(0, 12);
    const generated = generatedCandidate(shot);
    const previousEnhancement = enhancementDetails(shot);
    const generationSource = generated ? {
      version: expected.shot.version, name: source.name, sha256: source.sha256, jobId: generated.jobId,
      ...(generated.assetKey ? { assetKey: generated.assetKey } : {}),
      ...(generated.preset ? { preset: generated.preset } : {}),
      ...(generated.sha256 ? { generatedVideoSha256: generated.sha256 } : {}),
      ...((Number.isSafeInteger(generated.sizeBytes) && generated.sizeBytes > 0) ||
        (Number.isSafeInteger(generated.comparison?.outputIdentity?.sizeBytes) && generated.comparison.outputIdentity.sizeBytes > 0) ?
        { generatedVideoSizeBytes: generated.sizeBytes || generated.comparison?.outputIdentity?.sizeBytes } : {}),
      jobReferences: generated.jobReferences, comparison: generated.comparison, testFixture: generated.testFixture,
      basisStatus: generated.basisStatus, basisHash: generated.basisHash
    } : previousEnhancement?.generationSource;
    return { version, file: output.name, inPoint: '0', outPoint: String(report.engine ? duration : Math.min(sourceSpan, duration)), caption: shot.caption || '',
      refs: [...(shot.refs || [])], verdict: '待审',
      enhancementResult: JSON.stringify({ version, file: output.name, sourceVersion: expected.shot.version,
        sourceStart: expected.shot.start, fps, width: output.width, height: output.height,
        options: expected.options, ...(generationSource ? { generationSource } : {}),
        ...(typeof report.engine?.testFixture === 'boolean' ? { testFixture: report.engine.testFixture } :
          (generated?.testFixture || previousEnhancement?.testFixture || expected.shot.version.startsWith('本地流程样片-') ?
            { testFixture: true } : {})), ...(provenance || {}) }) };
  }

  function enhancementComparison(episodeIndex, shotIndex, shot, source, reports, outputs) {
    if (!Array.isArray(reports) || reports.length !== 2 || !Array.isArray(outputs) || outputs.length !== 2) {
      throw new Error('需要 A、B 两份 ARC 本地处理报告和对应视频。');
    }
    const candidates = reports.map((report, index) => enhancementCandidate(
      episodeIndex, shotIndex, shot, report, source, outputs[index]));
    const options = reports.map(report => report.options);
    const allowed = new Set(['off', 'light', 'medium']);
    if (reports.some(report => report.engine !== undefined || report.processing?.engine !== 'ffmpeg' ||
        report.processing?.profile !== 'split-denoise-sharpen-v1' || !isObject(report.options) ||
        !allowed.has(report.options.denoise))) {
      throw new Error('降噪 A/B 只接受 ARC 的本地独立降噪处理报告。');
    }
    const stableOptions = value => JSON.stringify(Object.fromEntries(Object.keys(value).filter(key => key !== 'denoise')
      .sort().map(key => [key, value[key]])));
    if (options[0].denoise === options[1].denoise || stableOptions(options[0]) !== stableOptions(options[1])) {
      throw new Error('A/B 必须使用同一原片、切点、分辨率、帧率、锐化和补帧设置，且只切换降噪档。');
    }
    if (reports[0].processing.ffmpegVersion !== reports[1].processing.ffmpegVersion ||
        reports[0].processing.audioFilter !== reports[1].processing.audioFilter) {
      throw new Error('A/B 必须使用相同 FFmpeg 版本和音频处理链。');
    }
    const expectedFilters = { off: null, light: 'hqdn3d=1.2:0.9:2.4:1.8', medium: 'hqdn3d=2.0:1.5:4.0:3.0' };
    const withoutDenoise = [];
    for (let index = 0; index < 2; index++) {
      const filter = reports[index].processing.videoFilter;
      const denoiseFilters = filter.match(/(?:^|,)hqdn3d=[^,]*/g) || [];
      if (expectedFilters[options[index].denoise] ? denoiseFilters.length !== 1 ||
          !filter.includes(expectedFilters[options[index].denoise]) : denoiseFilters.length !== 0) {
        throw new Error(`第 ${index ? 'B' : 'A'} 版报告的降噪选项与实际 FFmpeg 滤镜不一致。`);
      }
      withoutDenoise.push(filter.replace(/(?:^|,)hqdn3d=[^,]*/g, ''));
    }
    if (withoutDenoise[0] !== withoutDenoise[1]) throw new Error('两版除 hqdn3d 降噪滤镜外的视频处理链必须完全一致。');
    const identities = outputs.map(output => `${output.sha256}:${output.size}`);
    if (identities[0] === identities[1]) throw new Error('A/B 处理版文件相同，无法比较降噪差异。');
    return { schema: 'arc-denoise-ab-v1', shot: { id: `E${number(episodeIndex)}-S${number(shotIndex)}`,
      version: shot.version, start: Number(shot.inPoint), end: Number(shot.outPoint) }, source,
      variable: 'denoise', controlled: true, variants: ['A', 'B'].map((variant, index) => ({ variant,
        denoise: options[index].denoise, options: { ...options[index] },
        processingMs: reports[index].processing.processingMs ?? null,
        processing: { profile: reports[index].processing.profile, ffmpegVersion: reports[index].processing.ffmpegVersion,
          videoFilter: reports[index].processing.videoFilter },
        output: { name: outputs[index].name, size: outputs[index].size, sha256: outputs[index].sha256,
          width: outputs[index].width, height: outputs[index].height, duration: outputs[index].duration },
        candidateVersion: candidates[index].version })) };
  }

  function enhancementDetails(shot) {
    try {
      const detail = JSON.parse(shot.enhancementResult || 'null');
      if (!detail || detail.version !== shot.version || detail.file !== shot.file || typeof detail.sourceVersion !== 'string' ||
          !detail.sourceVersion.trim() || detail.sourceVersion.length > 120 || !Number.isFinite(detail.sourceStart) || detail.sourceStart < 0 ||
          ![detail.width, detail.height].every(value => Number.isInteger(value) && value > 0 && value <= 16384) || ![30, 60].includes(detail.fps)) return null;
      const validAttemptHistory = (history, retryCount) => history === undefined ||
        (Array.isArray(history) && history.length <= 100 && history.length === (retryCount ?? 0) && history.every(attempt =>
          isObject(attempt) && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(attempt.taskId || '') &&
          ['complete', 'failed', 'no_video'].includes(attempt.status) && /^[a-f0-9]{64}$/.test(attempt.sourceSha256 || '') &&
          /^[a-f0-9]{64}$/.test(attempt.mediaSha256 || '') && typeof attempt.shotVersion === 'string' &&
          ['queueMs', 'executionMs', 'bridgeMs'].every(key => attempt[key] === null || attempt[key] === undefined ||
            (Number.isFinite(attempt[key]) && attempt[key] >= 0 && attempt[key] <= 7 * 24 * 3600 * 1000)) &&
          ['queueSource', 'executionSource'].every(key => attempt[key] === null || attempt[key] === undefined || attempt[key] === 'comfy-history-timestamps') &&
          (attempt.bridgeSource === null || attempt.bridgeSource === undefined || attempt.bridgeSource === 'local-bridge-observation') &&
          (attempt.gpuKernelTime === null || attempt.gpuKernelTime === undefined || attempt.gpuKernelTime === false)));
      if (detail.engine && (detail.engine.kind !== 'comfyui-ai-enhancement' ||
          !/^[a-f0-9]{64}$/.test(detail.engine.workflowSha256 || '') ||
          (detail.engine.providerFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(detail.engine.providerFingerprint || '')) ||
          (detail.engine.preflightSchemaSha256 !== undefined && !/^[a-f0-9]{64}$/.test(detail.engine.preflightSchemaSha256 || '')) ||
          (detail.engine.modelParameters !== undefined && (!isObject(detail.engine.modelParameters) || Object.entries(detail.engine.modelParameters).some(([key, value]) =>
            key !== 'denoise' || !Number.isFinite(value) || value < 0 || value > 100))) ||
          !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(detail.engine.taskId || '') ||
          (detail.engine.testFixture !== undefined && typeof detail.engine.testFixture !== 'boolean') ||
          (detail.engine.retryCount !== undefined && detail.engine.retryCount !== null &&
            (!Number.isSafeInteger(detail.engine.retryCount) || detail.engine.retryCount < 0 || detail.engine.retryCount > 100)) ||
          !validAttemptHistory(detail.engine.attemptHistory, detail.engine.retryCount) ||
          (detail.engine.timingSource !== undefined && !['local-bridge', 'per-field'].includes(detail.engine.timingSource)) ||
          (detail.engine.timing !== undefined && (!isObject(detail.engine.timing) || Object.entries(detail.engine.timing).some(([key, value]) =>
            ['queueMs', 'executionMs', 'bridgeMs'].includes(key) ? value !== null && (!Number.isFinite(value) || value < 0 || value > 7 * 24 * 3600 * 1000) :
              key === 'queueSource' || key === 'executionSource' ? value !== null && value !== 'comfy-history-timestamps' :
                key === 'bridgeSource' ? value !== null && value !== 'local-bridge-observation' :
                  key === 'gpuKernelTime' ? value !== null && value !== false : true))))) return null;
      if (detail.processing && (detail.processing.schema !== 'arc-local-processing-v1' || detail.processing.engine !== 'ffmpeg' ||
          !['legacy-cleanup-v1', 'split-denoise-sharpen-v1'].includes(detail.processing.profile) ||
          typeof detail.processing.ffmpegVersion !== 'string' || !detail.processing.ffmpegVersion.trim() ||
          (detail.processing.processingMs !== undefined && (!Number.isSafeInteger(detail.processing.processingMs) ||
            detail.processing.processingMs < 0 || detail.processing.processingMs > 604_800_000)) ||
          detail.processing.ffmpegVersion.length > 240 || /[\x00-\x1f]/.test(detail.processing.ffmpegVersion) ||
          typeof detail.processing.videoFilter !== 'string' || !detail.processing.videoFilter ||
          detail.processing.videoFilter.length > 6000 || /[\x00-\x1f]/.test(detail.processing.videoFilter) ||
          typeof detail.processing.audioFilter !== 'string' || detail.processing.audioFilter.length > 1000 ||
          /[\x00-\x1f]/.test(detail.processing.audioFilter) ||
          detail.processing.videoEncoder !== 'libx264 -crf 17 -preset fast -pix_fmt yuv420p' ||
          detail.processing.audioEncoder !== 'aac')) return null;
      const source = detail.generationSource;
      if (source !== undefined) {
        if (!isObject(source) || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(source.jobId || '') ||
            !/^[a-f\d]{64}$/.test(source.sha256 || '') || typeof source.version !== 'string' ||
            !source.version.trim() || source.version.length > 120 || typeof source.name !== 'string' ||
            !source.name || source.name.length > 180 || /[\\/:\x00-\x1f]/.test(source.name) ||
            (source.assetKey !== undefined && !/^[a-f\d]{64}$/.test(source.assetKey)) ||
            (source.preset !== undefined && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(source.preset)) ||
            (source.generatedVideoSha256 !== undefined && !/^[a-f\d]{64}$/.test(source.generatedVideoSha256)) ||
            (source.generatedVideoSizeBytes !== undefined && (!Number.isSafeInteger(source.generatedVideoSizeBytes) || source.generatedVideoSizeBytes < 1))) return null;
        detail.generationSource = { jobId: source.jobId, sha256: source.sha256, version: source.version.trim(), name: source.name,
          ...(source.assetKey ? { assetKey: source.assetKey } : {}), ...(source.preset ? { preset: source.preset } : {}),
          ...(source.generatedVideoSha256 ? { generatedVideoSha256: source.generatedVideoSha256 } : {}),
          ...(source.generatedVideoSizeBytes ? { generatedVideoSizeBytes: source.generatedVideoSizeBytes } : {}),
          jobReferences: readJobReferences(source.jobReferences), comparison: readComparison(source.comparison),
          ...(['current', 'changed', 'unknown'].includes(source.basisStatus) ? { basisStatus: source.basisStatus } : {}),
          ...(/^[a-f\d]{64}$/.test(source.basisHash || '') ? { basisHash: source.basisHash } : {}),
          ...(source.testFixture === true ? { testFixture: true } : {}) };
      }
      if (typeof detail.testFixture !== 'boolean' && typeof detail.engine?.testFixture === 'boolean') {
        detail.testFixture = detail.engine.testFixture;
      }
      return detail;
    } catch { return null; }
  }

  const api = { backup, restore, assembly, manifest, protectedShot, shotReplacement, shotRollback, shotPatch, postCue, candidateSource, fingerprintSource, saveGeneratedCandidate, generatedCandidate,
    saveCandidate, loadCandidate, addAsset, replacementReferences, assetKinds, storyboard, scriptAnchorStatus, moveShot, targetDuration, enhancement,
    sameAiEnhancementRetryBasis, enhancementCandidate, enhancementComparison, enhancementDetails };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcProductionProject = api;
})(globalThis);
