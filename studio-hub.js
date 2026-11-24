(() => {
  const workspaces = {
    script: { title: '剧本创作中心', label: '01 / CREATE', subtitle: '整理故事、人物与设定，让灵感有处可循。', icon: 'studio-script.png' },
    video: { title: '视频创作工作室', label: '02 / MAKE', subtitle: '为视频制作准备创意与素材，流程由你共同定义。', icon: 'studio-video.png' },
    edit: { title: '剪辑中心', label: '03 / FINISH', subtitle: '集中处理素材、剪辑与最终成片交付。', icon: 'studio-edit.png' }
  };
  const home = document.querySelector('#homeView');
  const detail = document.querySelector('#workspaceView');
  const crumb = document.querySelector('#crumb');
  const dialog = document.querySelector('#helpDialog');
  const scrollTop = () => window.scrollTo({ top: 0,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });

  function showHome() {
    window.arcProduction.close();
    home.hidden = false;
    detail.hidden = true;
    crumb.textContent = '工作台总览';
    window.arcProduction.showOverview(openFromOverview);
    document.querySelectorAll('.nav-link').forEach(link => {
      const active = link.dataset.view === 'home';
      link.classList.toggle('selected', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    scrollTop();
    document.querySelector('.production-overview h1').setAttribute('tabindex', '-1');
    document.querySelector('.production-overview h1').focus({ preventScroll: true });
  }

  function openFromOverview(key, tab, shot, continuityRow) {
    openWorkspace(key, tab, shot, continuityRow);
    if (continuityRow) return;
    const heading = document.querySelector('#production-title');
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  function openWorkspace(key, tab, shot, continuityRow) {
    const item = workspaces[key];
    if (!item) return;
    home.hidden = true;
    detail.hidden = false;
    crumb.textContent = item.title;
    document.querySelector('#workspaceTitle').textContent = item.title;
    document.querySelector('#workspaceOverline').textContent = item.label;
    document.querySelector('#workspaceSubtitle').textContent = item.subtitle;
    document.querySelector('#workspaceIcon').innerHTML = `<img src="assets/${item.icon}" alt="">`;
    window.arcProduction.open(key, tab, shot, continuityRow);
    document.querySelectorAll('.nav-link').forEach(link => {
      const active = link.dataset.view === key;
      link.classList.toggle('selected', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (!continuityRow) scrollTop();
  }

  window.addEventListener('arc-production-route', event => {
    const { workspace, tab, shot } = event.detail || {};
    if (!workspaces[workspace] || typeof tab !== 'string') return;
    openWorkspace(workspace, tab, shot);
    const heading = document.querySelector('#production-title');
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  });

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => button.dataset.view === 'home' ? showHome() : openWorkspace(button.dataset.view));
  });
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openWorkspace(button.dataset.open, button.dataset.tab)));
  document.querySelector('#backHome').addEventListener('click', showHome);
  document.querySelector('#helpButton').addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  window.arcProduction.showOverview(openFromOverview);
})();
