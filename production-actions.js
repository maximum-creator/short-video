((root) => {
  const actions = [
    { id: 'kick', name: '踢刀', group: '奇幻动作', image: 'action-kick.png',
      video: 'action-kick-previz-v1.mp4',
      landmarks: [['离地', .875], ['触碰道具', 1.375], ['落地', 2.208]],
      beats: '俯身蓄势并跃起 → 触碰悬浮道具，光弧一闪，道具飞离 → 人物收腿落地，镜头留出道具运动空间。' },
    { id: 'rift', name: '裂空现影', group: '角色登场', image: 'action-rift.png',
      video: 'action-rift-previz-v1.mp4',
      landmarks: [['裂隙亮起', .875], ['前脚落地', 1.542], ['停步转头', 3.250]],
      beats: '裂隙从暗转亮 → 人物跨出门槛，后脚跟上 → 重心落定，再转头看向画外。' },
    { id: 'doorway', name: '跨门停步', group: '角色登场', image: 'action-doorway.png',
      video: 'action-doorway-previz-v1.mp4',
      landmarks: [['前脚落地', 1.542], ['后脚跟上', 2.5], ['停步转头', 3.25]],
      beats: '固定竖屏机位。人物前脚越过门槛，后脚跟上；重心落定后再转头，保留门框与双脚。' },
    { id: 'skate', name: '花滑掠冰', group: '流动表演', image: 'action-skate.png',
      video: 'action-skate-previz-v1.mp4',
      landmarks: [['进入滑行', .333], ['完整展开', 1.542], ['收势', 3.500]],
      beats: '单脚沿弧线滑入 → 后腿抬起、双臂展开 → 缓缓收势，冰痕延续到画外。' },
    { id: 'look', name: '听声抬眼', group: '日常表演', image: 'action-look.png',
      video: 'action-look-previz-v1.mp4', landmarks: [['开始抬头', .83], ['停顿', 1.67], ['姿势收稳', 3.17]],
      beats: '身体留在原地 → 听见画外声后抬头转向 → 留半拍反应，再收稳姿势。' },
    { id: 'reach', name: '伸手停在道具前', group: '道具互动', image: 'action-reach.png',
      video: 'action-reach-previz-v1.mp4', landmarks: [['开始伸手', .83], ['道具前停顿', 1.67], ['收手', 3.17]],
      beats: '看向台面道具 → 身体微微前倾，伸手靠近 → 在接触前停住，再收手。' },
    { id: 'custom', name: '导入自己的白模', group: '本地素材',
      beats: '按本镜需要填写表演节拍，并附上已有的动作参考。' }
  ];
  const files = new WeakMap();
  const builtInFiles = new Map();
  const describe = id => actions.find(item => item.id === id);
  const builtInFor = record => !record.motionFilename ? describe(record.motionAction)?.video : undefined;
  const fileFor = record => files.get(record) || builtInFiles.get(builtInFor(record));
  const referenceOrigin = file => builtInFiles.get(file.name) === file ? 'builtin' : 'local';
  const hasReference = record => Boolean(files.has(record) || builtInFor(record));
  async function loadBuiltIn(name) {
    if (builtInFiles.has(name)) return builtInFiles.get(name);
    const response = await fetch('assets/' + name);
    if (!response.ok || !/^video\/mp4\b/i.test(response.headers.get('Content-Type') || '')) {
      throw new Error('内置白模未能读取，请重试或附上本地视频。');
    }
    const bytes = await response.blob();
    if (!bytes.size || bytes.size > 24 * 1024 ** 2) throw new Error('内置白模文件大小无效。');
    if (!builtInFiles.has(name)) builtInFiles.set(name, new File([bytes], name, { type: 'video/mp4' }));
    return builtInFiles.get(name);
  }
  async function loadReference(record) {
    const current = fileFor(record);
    if (current) return current;
    const name = builtInFor(record);
    if (!name) throw new Error('请先在分镜中关联白模视频。');
    const file = await loadBuiltIn(name);
    if (builtInFor(record) !== name) throw new Error('白模已更换，请重新选择。');
    return file;
  }

  function mount(record, save) {
    const section = document.createElement('section');
    section.className = 'production-history action-reference';
    section.innerHTML = `
      <div class="action-reference-head">
        <div><strong>白模动作</strong><p data-action-current></p></div>
        <button class="production-action" type="button" data-action-open>打开动作库</button>
      </div>
      <div data-action-file hidden>
        <label class="action-file-label">附上白模视频<input type="file" accept=".mp4,.webm,.mov"></label>
        <p data-action-file-status></p>
        <p data-action-provenance hidden></p>
        <video aria-label="白模视频预览" controls playsinline preload="metadata" hidden></video>
        <button class="production-action" type="button" data-action-reset hidden>改用内置白模</button>
        <button class="production-action" type="button" data-action-clear>移除本镜动作</button>
        <button class="production-action" type="button" data-action-replace hidden>确认替换白模</button>
      </div>
      <output role="status"></output>
      <dialog class="action-library" aria-labelledby="action-library-title">
        <header><div><h2 id="action-library-title">白模动作库</h2><p>先看动作和落点，再选给本镜使用。</p></div>
          <button class="action-close" type="button" aria-label="关闭动作库">×</button></header>
        <label class="action-search">搜索动作<input type="search" autofocus placeholder="名称、类型或动作节拍"></label>
        <section class="action-library-preview" hidden tabindex="-1" aria-label="动作详情">
          <video controls playsinline preload="auto" aria-label="待选动作预演"></video>
          <div><h3></h3><p data-action-beats></p><div data-action-markers class="production-picker"></div>
            <button type="button" data-apply-action class="production-action">用于本镜</button>
            <p data-preview-status role="status"></p>
          </div>
        </section>
        <div class="action-grid"></div><p class="action-empty" hidden>没有找到匹配的动作。</p>
      </dialog>`;
    const dialog = section.querySelector('dialog');
    const input = section.querySelector('input[type=file]');
    const video = section.querySelector('video');
    const feedback = section.querySelector('output');
    const replace = section.querySelector('[data-action-replace]');
    const search = section.querySelector('input[type=search]');
    const preview = dialog.querySelector('.action-library-preview');
    const previewVideo = preview.querySelector('video');
    const applyAction = preview.querySelector('[data-apply-action]');
    let previewUrl, selection = 0, replacement, inspected, libraryUrl, previewRequest = 0;

    function refreshPreviewMarkers() {
      for (const marker of preview.querySelectorAll('[data-action-markers] button')) {
        const seconds = Number(marker.dataset.seconds);
        marker.disabled = !Array.from({ length: previewVideo.seekable.length }, (_, index) =>
          seconds >= previewVideo.seekable.start(index) && seconds <= previewVideo.seekable.end(index)
        ).some(Boolean);
      }
    }
    for (const name of ['progress', 'loadeddata', 'canplay']) previewVideo.addEventListener(name, refreshPreviewMarkers);

    function clearPreview() {
      previewRequest++;
      inspected = undefined;
      preview.hidden = true;
      previewVideo.pause();
      previewVideo.removeAttribute('src');
      previewVideo.load();
      if (libraryUrl) URL.revokeObjectURL(libraryUrl);
      libraryUrl = undefined;
    }

    async function inspect(item, button) {
      clearPreview();
      inspected = item;
      for (const card of dialog.querySelectorAll('.action-card')) card.setAttribute('aria-pressed', String(card === button));
      preview.hidden = false;
      preview.querySelector('h3').textContent = item.name;
      preview.querySelector('[data-action-beats]').textContent = item.beats;
      const previewStatus = preview.querySelector('[data-preview-status]');
      previewStatus.textContent = item.video ? '正在读取本地动作预演…' : '选用后可附上本地视频。';
      previewVideo.hidden = !item.video;
      const markers = preview.querySelector('[data-action-markers]');
      markers.replaceChildren();
      preview.focus();
      if (item.video) {
        const request = previewRequest;
        for (const [name, seconds] of item.landmarks) {
          const marker = document.createElement('button');
          marker.type = 'button';
          marker.dataset.seconds = String(seconds);
          marker.textContent = `${name} · ${seconds.toFixed(2)} 秒`;
          marker.onclick = () => {
            if (previewVideo.readyState < 1) return;
            previewVideo.pause();
            previewVideo.currentTime = seconds;
          };
          markers.append(marker);
        }
        refreshPreviewMarkers();
        if (location.protocol === 'file:') {
          previewVideo.src = 'assets/' + item.video;
          previewStatus.textContent = '弧光自制动作预演 v1';
          return;
        }
        try {
          const file = await loadBuiltIn(item.video);
          if (request !== previewRequest || !dialog.open) return;
          libraryUrl = URL.createObjectURL(file);
          previewVideo.src = libraryUrl;
          previewStatus.textContent = '弧光自制动作预演 v1';
        } catch (error) {
          if (request === previewRequest && dialog.open) previewStatus.textContent = error.message;
        }
      }
    }

    applyAction.onclick = () => {
      if (!inspected) return;
      const item = inspected;
      if (item.id !== record.motionAction && !commit(item.id, null)) {
        preview.querySelector('[data-preview-status]').textContent = feedback.textContent;
        return;
      }
      dialog.close();
      if (!item.video) input.focus();
    };
    function refresh() {
      const chosen = describe(record.motionAction);
      section.querySelector('[data-action-current]').textContent = chosen ? `${chosen.name} · ${chosen.beats}` : '从姿势卡找到灵感，再为本镜选择运动参考。';
      section.querySelector('[data-action-file]').hidden = !chosen;
      const file = files.get(record);
      const builtIn = builtInFor(record);
      section.querySelector('[data-action-file-status]').textContent = file ? `已关联 ${file.name}。生成任务中可选用。` :
        record.motionFilename ? `请重新关联 ${record.motionFilename}。${record.motionFingerprint ? '工作台会核对内容。' : '该旧记录首次关联后会保存内容指纹。'}` :
        builtIn ? '已选内置白模预演，可播放，也可在生成任务里用作运动参考。' : '当前只有动作说明。附上自己的白模视频后，可作为运动参考。';
      const provenance = section.querySelector('[data-action-provenance]');
      provenance.hidden = !chosen;
      provenance.textContent = record.motionFilename ? '来源：本地导入，使用权限由导入者确认。' :
        builtIn ? '来源：弧光自制动作预演 v1。' : '来源：弧光动作卡。';
      if (builtIn) {
        provenance.textContent += ' · ' + chosen.landmarks
          .map(([label, seconds]) => `${label} ${seconds.toFixed(2)} 秒`).join(' · ');
      }
      section.querySelector('[data-action-reset]').hidden = !(chosen?.video && record.motionFilename);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = file ? URL.createObjectURL(file) : undefined;
      video.hidden = !previewUrl && !builtIn;
      if (previewUrl || builtIn) video.src = previewUrl || 'assets/' + builtIn;
      else video.removeAttribute('src');
    }
    function commit(id, file, fingerprint) {
      const before = { motionAction: record.motionAction, motionFilename: record.motionFilename,
        motionFingerprint: record.motionFingerprint };
      if (id) record.motionAction = id; else delete record.motionAction;
      if (file) record.motionFilename = file.name; else delete record.motionFilename;
      if (fingerprint) record.motionFingerprint = fingerprint; else delete record.motionFingerprint;
      if (save() === false) {
        for (const [key, value] of Object.entries(before)) {
          if (value === undefined) delete record[key]; else record[key] = value;
        }
        feedback.textContent = '保存失败，请检查浏览器存储后重试。';
        return false;
      }
      selection++;
      replacement = undefined;
      replace.hidden = true;
      if (file) files.set(record, file); else files.delete(record);
      input.value = '';
      refresh();
      feedback.textContent = id ? `已选用${describe(id).name}。` : '已移除本镜动作。';
      return true;
    }
    function cards() {
      const query = search.value.trim().toLowerCase();
      const grid = section.querySelector('.action-grid');
      const items = actions.filter(item => !item.shotSpecific &&
        [item.name, item.group, item.beats].some(field => field.toLowerCase().includes(query)));
      grid.replaceChildren();
      section.querySelector('.action-empty').hidden = items.length > 0;
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'action-card';
        button.setAttribute('aria-pressed', 'false');
        if (item.image) {
          const image = new Image();
          image.src = 'assets/' + item.image;
          image.alt = '';
          button.append(image);
        }
        const title = document.createElement('strong');
        title.textContent = item.name;
        const caption = document.createElement('small');
        caption.textContent = item.video ? `${item.group} · 内置预演` : item.group;
        button.append(title, caption);
        button.onclick = () => inspect(item, button);
        grid.append(button);
      }
    }
    search.oninput = () => { clearPreview(); cards(); };
    dialog.addEventListener('close', clearPreview);
    section.querySelector('[data-action-open]').onclick = () => {
      cards();
      dialog.showModal();
    };
    dialog.querySelector('.action-close').onclick = () => dialog.close();
    section.querySelector('[data-action-clear]').onclick = () => commit(null, null);
    section.querySelector('[data-action-reset]').onclick = () => commit(record.motionAction, null);
    input.onchange = async () => {
      const operation = ++selection;
      const action = record.motionAction;
      replacement = undefined;
      replace.hidden = true;
      const [file] = input.files;
      if (!file) return;
      if (!/\.(mp4|webm|mov)$/i.test(file.name) || file.name.length > 180 || !file.size || file.size > 24 * 1024 ** 2) {
        input.value = '';
        feedback.textContent = '请选择非空的 MP4、WebM 或 MOV 视频，最大 24 MiB。';
        return;
      }
      feedback.textContent = '正在核对白模内容…';
      try {
        const { fingerprint } = await root.arcProductionProject.fingerprintSource(file);
        if (operation !== selection || record.motionAction !== action || !section.isConnected) return;
        if ((record.motionFingerprint && fingerprint !== record.motionFingerprint) ||
            (record.motionFilename && !record.motionFingerprint && file.name !== record.motionFilename)) {
          replacement = { file, fingerprint };
          replace.hidden = false;
          feedback.textContent = `${file.name} 与已登记的白模不同。可重新选择原文件，或确认替换。`;
          return;
        }
        if (commit(action, file, fingerprint)) feedback.textContent = `已核对并关联 ${file.name}。`;
      } catch (error) {
        if (operation === selection && section.isConnected) feedback.textContent = error.message || '无法核对白模内容。';
      } finally {
        if (operation === selection) input.value = '';
      }
    };
    replace.onclick = () => {
      if (replacement) commit(record.motionAction, replacement.file, replacement.fingerprint);
    };
    refresh();
    return { section, dispose() { selection++; clearPreview(); if (previewUrl) URL.revokeObjectURL(previewUrl); } };
  }

  const api = { describe, mount, clearSessionFile: record => files.delete(record),
    fileFor, hasReference, loadReference, referenceOrigin,
    isBuiltInVideo: filename => actions.some(item => item.video && filename === item.video) };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcMotionActions = api;
})(globalThis);
