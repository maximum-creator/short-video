(() => {
  function awaitFrame(video, ready, signal, start) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const events = ['loadeddata', 'seeked', 'error'];
      const abort = () => done(signal.reason);
      const timeout = setTimeout(() => done(new Error('视频取帧超时，请换一个本地视频重试。')), 8000);
      const finish = () => {
        if (video.error) done(new Error('浏览器无法解码该视频。'));
        else if (ready()) done();
      };
      function done(error) {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        for (const event of events) video.removeEventListener(event, finish);
        if (error) reject(error);
        else resolve();
      }
      signal.addEventListener('abort', abort, { once: true });
      for (const event of events) video.addEventListener(event, finish);
      try { start(); finish(); } catch (error) { done(error); }
    });
  }

  async function extract(source, track, start, end, signal) {
    const video = document.createElement('video');
    const isFile = source instanceof File;
    const url = isFile ? URL.createObjectURL(source) : source.url;
    video.preload = 'auto';
    video.muted = true;
    try {
      await awaitFrame(video, () => video.readyState >= 2 && !video.seeking, signal, () => { video.src = url; });
      const limit = Number.isNaN(end) ? video.duration : end;
      if (!Number.isFinite(video.duration) || video.duration <= 0 || start < 0 || limit > video.duration + .001 ||
        limit - start < .15 || limit > 3600) throw new Error('请检查取样范围，至少 0.15 秒且不超过源视频时长。');
      const canvas = document.createElement('canvas');
      const resize = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * resize));
      canvas.height = Math.max(1, Math.round(video.videoHeight * resize));
      const ctx = canvas.getContext('2d', { alpha: false });
      const frames = [];
      for (const position of [.15, .50, .85]) {
        const target = start + (limit - start) * position;
        await awaitFrame(video, () => video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - target) < .0005,
          signal, () => { video.currentTime = target; });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL('image/jpeg', .72);
        if (image.length > 180000) throw new Error('抽样图超过本地助手请求上限。');
        frames.push({ track, sourceMs: Math.round(video.currentTime * 1000), image });
      }
      return frames;
    } finally {
      video.removeAttribute('src');
      video.load();
      if (isFile) URL.revokeObjectURL(url);
    }
  }

  function create(initial = null) {
    const panel = document.createElement('details');
    panel.className = 'review-frames';
    panel.innerHTML = `
      <summary>视觉审片</summary>
      <p>每段视频取三帧。发送时只传缩小后的图片和时间码。</p>
      <div class="production-metadata" data-sources></div>
      <div class="production-picker">
        <button type="button" data-sample>取样并预览</button>
        <button type="button" data-clear hidden>清除取样</button>
      </div>
      <output data-frame-status role="status"></output>
      <div class="review-frame-strip"></div>`;
    const sources = panel.querySelector('[data-sources]');
    const sample = panel.querySelector('[data-sample]');
    const clear = panel.querySelector('[data-clear]');
    const status = panel.querySelector('[data-frame-status]');
    const strip = panel.querySelector('.review-frame-strip');
    let frames = [], pending;
    const inputs = new Map();
    const returned = new Map();
    const selected = track => inputs.get(track)[0].files[0] || returned.get(track);
    for (const [track, label] of [['candidate', '当前候选'], ['comparison', '对照片段（可选）']]) {
      const group = document.createElement('fieldset');
      group.innerHTML = `<legend>${label}</legend><label>本地视频<input type="file" accept="video/*,.mp4,.webm,.mov"></label>
        <div class="production-metadata">
          <label>从（秒）<input type="number" min="0" step="any" placeholder="0"></label>
          <label>到（秒）<input type="number" min="0" step="any" placeholder="片尾"></label>
        </div>`;
      inputs.set(track, [...group.querySelectorAll('input')]);
      group.addEventListener('input', () => reset());
      sources.append(group);
    }
    if (initial) {
      panel.open = true;
      for (const [track, [input]] of inputs) {
        const file = initial[track];
        if (!(file instanceof File)) {
          if (file && typeof file.url === 'string' && /^\/api\/generation\/[a-f\d-]{36}\/video\/\d{1,3}\?file=[^&#]+&asset=[a-f\d]{64}$/i.test(file.url)) {
            const marker = document.createElement('p');
            marker.textContent = '已关联回传视频 · ' + file.name;
            input.closest('label').after(marker);
            returned.set(track, { ...file, marker });
          }
          continue;
        }
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
      }
    }

    function reset(clearInputs = false) {
      pending?.abort();
      pending = undefined;
      frames = [];
      strip.replaceChildren();
      sample.disabled = false;
      clear.hidden = true;
      status.textContent = '';
      if (clearInputs) {
        for (const fields of inputs.values()) for (const input of fields) input.value = '';
        for (const source of returned.values()) source.marker.remove();
        returned.clear();
      }
    }

    function show() {
      for (const frame of frames) {
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        const label = document.createElement('figcaption');
        label.textContent = `${frame.track === 'candidate' ? '候选' : '对照'} · 源 ${(frame.sourceMs / 1000).toFixed(3)} 秒`;
        image.alt = label.textContent;
        image.src = frame.image;
        figure.append(image, label);
        strip.append(figure);
      }
      clear.hidden = !frames.length;
    }

    sample.onclick = async () => {
      reset();
      if (!selected('candidate')) { status.textContent = '请先选择候选视频。'; return; }
      const task = new AbortController();
      pending = task;
      sample.disabled = true;
      status.textContent = '正在本地读取抽样画面…';
      try {
        const result = [];
        for (const [track, [, start, end]] of inputs) {
          const source = selected(track);
          if (source) result.push(...await extract(source, track, start.valueAsNumber || 0, end.valueAsNumber, task.signal));
        }
        if (pending !== task) return;
        frames = result;
        status.textContent = `已准备 ${frames.length} 张抽样画面。发送问题时会附带这些画面。`;
        show();
      } catch (error) {
        if (pending === task) status.textContent = error.message;
      } finally {
        if (pending === task) { pending = undefined; sample.disabled = false; }
      }
    };
    clear.onclick = () => reset(true);
    return { panel, frames: () => frames, pending: () => Boolean(pending), reset,
      candidateName: () => selected('candidate')?.name || '',
      sourceName: track => selected(track)?.name || '',
      sameFrames: value => frames === value };
  }
  window.arcReviewFrames = { create };
})();
