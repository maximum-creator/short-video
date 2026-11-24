((root) => {
  const reviewNotes = typeof module === 'object' && module.exports ?
    require('./production-review-notes.js') : root.arcReviewNotes;
  const recheck = typeof module === 'object' && module.exports ?
    require('./production-recheck.js') : root.arcRecheck;
  const continuity = typeof module === 'object' && module.exports ?
    require('./production-continuity.js') : root.arcContinuity;
  const artReview = typeof module === 'object' && module.exports ?
    require('./production-art-review.js') : root.arcArtReview;
  const camera = typeof module === 'object' && module.exports ?
    require('./production-camera.js') : root.arcCamera;
  const motion = typeof module === 'object' && module.exports ?
    require('./production-actions.js') : root.arcMotionActions;
  const schema = 'arc-production-context-v1';
  const text = (value, limit = 1200) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const pick = (object, keys, limit) => Object.fromEntries(keys.map(key => [key, text(object?.[key], limit)]));
  const asset = item => pick(item, ['id', 'kind', 'name', 'revision', 'notes'], 600);

  function create(project, index, projectFiles) {
    const episode = project.episodes[index];
    const cuts = projectFiles.storyboard(project, index);
    const continuityBasis = continuity.reviewBasis(project, index);
    const byId = new Map((project.assets || []).map(item => [item.id, item]));
    const snapshot = {
      schema,
      episode: index + 1,
      script: pick(episode.pages, ['story', 'dialogue', 'state', 'rules'], 6000),
      continuity: continuity.forAssistant(continuity.report(project, index)),
      continuityBasis,
      art: pick(project.series, ['character', 'look', 'limits'], 2400),
      shots: cuts.map(cut => {
        const shot = episode.shots[cut.index];
        return {
          id: cut.id,
          startMs: cut.start,
          endMs: cut.end,
          durationConfirmed: cut.specified,
          ...(shot.motionFingerprint ? { motionFingerprint: shot.motionFingerprint } : {}),
          story: { ...pick(shot, ['scriptAnchor', 'beat', 'composition', 'performance', 'reference']),
            ...(shot.generationEffects ? pick(shot, ['generationEffects']) : {}),
            ...(motion.describe(shot.motionAction) ? { motionAction: shot.motionAction } : {}),
            scriptAnchorValid: projectFiles.scriptAnchorStatus(shot, episode.pages).ready },
          camera: { ...pick(shot, ['move', 'path', 'guide']), ...(cut.cameraPlan ? { framing: cut.cameraPlan } : {}),
            ...(text(shot.lighting) ? { lighting: text(shot.lighting) } : {}) },
          references: (shot.refs || []).map(id => byId.get(id)).filter(Boolean).map(asset),
          keyframe: cut.frame ? asset(cut.frame) : null,
          review: {
            version: text(shot.version, 120),
            verdict: text(shot.verdict, 12) || '待审',
            issue: text(shot.issue),
            notes: reviewNotes.forAssistant(reviewNotes.list(shot)),
            checks: recheck.context(shot),
            artChecks: artReview.current(shot, project.series, episode.pages, continuityBasis).checks,
            history: (shot.candidates || []).slice(-12).map(candidate => pick(candidate, ['version', 'verdict', 'issue'], 400))
          }
        };
      })
    };
    return snapshot;
  }

  function overview(snapshot) {
    return {
      episode: snapshot.episode,
      durationMs: snapshot.shots.at(-1)?.endMs || 0,
      shots: snapshot.shots.map(shot => ({
        id: shot.id, startMs: shot.startMs, endMs: shot.endMs, verdict: shot.review.verdict
      }))
    };
  }

  function reviewQueue(snapshot) {
    return snapshot.shots.flatMap(shot => {
      const notes = [];
      if (!shot.story.scriptAnchorValid) notes.push('缺少仍能在本集剧情或对白中找到的原文锚点');
      if (!shot.story.beat) notes.push('缺剧本对应或镜头目的');
      if (!shot.durationConfirmed) notes.push('预演时长仍是暂定值');
      if (!shot.camera.move && !shot.camera.framing) notes.push('缺机位或运镜方案');
      if (!shot.references.length && !shot.keyframe) notes.push('缺已登记的参考版本或关键画面');
      for (const check of (shot.review.checks || []).filter(item => item.state === '仍存在').slice(0, 3)) {
        notes.push(`复核仍存在 · 候选源 ${(check.candidateMs / 1000).toFixed(3)} 秒 · ${check.note}`);
      }
      for (const check of (shot.review.artChecks || []).filter(item => item.result === '待返修')) {
        notes.push(`美术待返修 · ${check.label} · ${check.note}`);
      }
      if (shot.review.verdict === '返修') {
        if (shot.review.issue) notes.push(shot.review.issue);
        else if (shot.review.notes?.length) notes.push(...shot.review.notes.slice(0, 3)
          .map(item => `候选源 ${(item.sourceMs / 1000).toFixed(3)} 秒 · ${item.category} · ${item.note}`));
        else notes.push('需要补充返修原因');
      }
      return notes.length ? [{ id: shot.id, verdict: shot.review.verdict, notes }] : [];
    });
  }

  function readShot(snapshot, id) {
    const index = snapshot.shots.findIndex(shot => shot.id === id);
    if (index < 0) throw new Error('当前快照没有该镜头。');
    return { episode: snapshot.episode, shot: snapshot.shots[index],
      previous: snapshot.shots[index - 1]?.id ?? null, next: snapshot.shots[index + 1]?.id ?? null,
      art: snapshot.art, script: snapshot.script, continuity: snapshot.continuity,
      continuityBasis: snapshot.continuityBasis };
  }

  function parse(input) {
    if (input?.schema !== schema || !Number.isSafeInteger(input.episode) || input.episode < 1 ||
      !Array.isArray(input.shots) || input.shots.length < 1 || input.shots.length > 1000) {
      throw new Error('请选择工作台导出的本集助手快照。');
    }
    const seen = new Set();
    let cursor = 0;
    const shots = input.shots.map(item => {
      if (!item || typeof item.id !== 'string' || !/^S[0-9]{2,8}$/.test(item.id) || seen.has(item.id) ||
        item.startMs !== cursor || !Number.isSafeInteger(item.endMs) || item.endMs <= cursor ||
        item.endMs - cursor > 120_000) throw new Error('助手快照含有无效的镜头或时长。');
      seen.add(item.id);
      cursor = item.endMs;
      const framing = camera.normalize(item.camera?.framing);
      return {
        id: item.id, startMs: item.startMs, endMs: item.endMs, durationConfirmed: item.durationConfirmed === true,
        story: { ...pick(item.story, ['scriptAnchor', 'beat', 'composition', 'performance', 'reference']),
          ...(text(item.story?.generationEffects) ? pick(item.story, ['generationEffects']) : {}),
          ...(motion.describe(item.story?.motionAction) ? { motionAction: item.story.motionAction } : {}),
          scriptAnchorValid: item.story?.scriptAnchorValid === true },
        camera: { ...pick(item.camera, ['move', 'path', 'guide']), ...(framing ? { framing } : {}),
          ...(text(item.camera?.lighting) ? { lighting: text(item.camera.lighting) } : {}) },
        references: Array.isArray(item.references) ? item.references.slice(0, 100).map(asset) : [],
        keyframe: item.keyframe ? asset(item.keyframe) : null,
        review: { version: text(item.review?.version, 120), verdict: text(item.review?.verdict, 12) || '待审',
          issue: text(item.review?.issue), notes: reviewNotes.forAssistant(item.review?.notes),
          checks: recheck.parseContext(item.review?.checks),
          artChecks: artReview.parse(item.review?.artChecks),
          history: Array.isArray(item.review?.history) ? item.review.history.slice(-12).map(candidate => pick(candidate, ['version', 'verdict', 'issue'], 400)) : [] }
      };
    });
    return { schema, episode: input.episode, shots,
      script: pick(input.script, ['story', 'dialogue', 'state', 'rules'], 6000),
      continuity: continuity.forAssistant(input.continuity),
      art: pick(input.art, ['character', 'look', 'limits'], 2400) };
  }

  const api = { create, overview, reviewQueue, readShot, parse };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcProductionContext = api;
})(globalThis);
