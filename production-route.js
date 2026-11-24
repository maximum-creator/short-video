(() => {
  const steps = [
    { workspace: 'script', tab: 'script', title: '故事与对白', studio: '剧本创作' },
    { workspace: 'script', tab: 'canon', title: '连续性与规则', studio: '剧本创作' },
    { workspace: 'video', tab: 'art', title: '全剧视觉设定', studio: '视频制作' },
    { workspace: 'video', tab: 'assets', title: '角色与场景参考', studio: '视频制作' },
    { workspace: 'video', tab: 'board', title: '逐镜分镜', studio: '视频制作' },
    { workspace: 'video', tab: 'animatic', title: '动态分镜', studio: '视频制作' },
    { workspace: 'video', tab: 'camera', title: '运镜设计', studio: '视频制作' },
    { workspace: 'video', tab: 'generation', title: '视频生成', studio: '视频制作' },
    { workspace: 'video', tab: 'review', title: '逐镜审片', studio: '视频制作' },
    { workspace: 'edit', tab: 'assembly', title: '剪辑交接', studio: '剪辑交付' },
    { workspace: 'edit', tab: 'finish', title: '画质后期', studio: '剪辑交付' }
  ];

  function state(workspace, tab) {
    const index = steps.findIndex(step => step.workspace === workspace && step.tab === tab);
    if (index < 0) return null;
    return { index, total: steps.length, current: steps[index], previous: steps[index - 1] || null,
      next: steps[index + 1] || null };
  }

  function reviewAction(rows, currentShot) {
    if (!Array.isArray(rows) || !rows.length || !Number.isInteger(currentShot)) return { type: 'unavailable' };
    const currentPosition = rows.findIndex(row => row && row.index === currentShot);
    if (currentPosition < 0) return { type: 'unavailable' };
    const pending = rows.filter(row => row && row.ready !== true && Number.isInteger(row.index) && row.next);
    if (!pending.length) return { type: 'assembly', target: { workspace: 'edit', tab: 'assembly' } };
    const next = pending.filter(row => rows.indexOf(row) > currentPosition)
      .concat(pending.filter(row => rows.indexOf(row) <= currentPosition))
      .find(row => row.index !== currentShot);
    if (next) return { type: 'next-shot', row: next, target: next.next };
    const current = pending.find(row => row.index === currentShot);
    if (!current) return { type: 'unavailable' };
    const target = current.next;
    if (target.workspace !== 'video' || target.tab !== 'review' || target.index !== currentShot) {
      return { type: 'current-shot-action', row: current, target };
    }
    return { type: 'current-shot', row: current };
  }

  const api = { steps: steps.map(step => ({ ...step })), state, reviewAction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.arcProductionRoute = api;
})();
