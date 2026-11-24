((root) => {
  const dimensions = { '9:16': [360, 640], '16:9': [640, 360], '1:1': [480, 480] };
  const point = (scale, x, y) => ({ scale, x, y });
  const presets = {
    locked: [point(100, 50, 50), point(100, 50, 50)],
    push: [point(100, 50, 50), point(132, 50, 50)],
    pull: [point(135, 50, 50), point(100, 50, 50)],
    right: [point(125, 20, 50), point(125, 80, 50)],
    left: [point(125, 80, 50), point(125, 20, 50)]
  };
  const bounded = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

  function normalize(value) {
    if (!value || !Object.hasOwn(dimensions, value.ratio) || !['linear', 'smooth'].includes(value.easing)) return null;
    for (const frame of [value.start, value.end]) {
      if (!frame || !bounded(frame.scale, 100, 180) || !bounded(frame.x, 0, 100) || !bounded(frame.y, 0, 100)) return null;
    }
    return { ratio: value.ratio, easing: value.easing,
      start: point(value.start.scale, value.start.x, value.start.y), end: point(value.end.scale, value.end.x, value.end.y) };
  }

  function read(record) {
    try { return normalize(JSON.parse(record.cameraPlan || 'null')); }
    catch { return null; }
  }

  function crop(plan, progress, width, height) {
    const [targetWidth, targetHeight] = dimensions[plan.ratio];
    const time = Math.min(1, Math.max(0, progress));
    const ratio = plan.easing === 'smooth' ? time * time * (3 - 2 * time) : time;
    const get = field => plan.start[field] + (plan.end[field] - plan.start[field]) * ratio;
    const zoom = Math.max(targetWidth / width, targetHeight / height) * get('scale') / 100;
    const w = Math.min(width, targetWidth / zoom);
    const h = Math.min(height, targetHeight / zoom);
    return { x: (width - w) * get('x') / 100, y: (height - h) * get('y') / 100, w, h };
  }

  function paint(canvas, image, plan, progress) {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) return false;
    const [width, height] = dimensions[plan.ratio];
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const rect = crop(plan, progress, image.naturalWidth, image.naturalHeight);
    canvas.getContext('2d', { alpha: false }).drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
    return true;
  }

  function describe(plan) {
    const position = point => `${point.scale}% 放大，横向取景 ${point.x}%，纵向取景 ${point.y}%`;
    return `${plan.ratio} · ${plan.easing === 'smooth' ? '缓入缓出' : '匀速'} · 起幅 ${position(plan.start)} → 落幅 ${position(plan.end)}`;
  }

  function create(record, keyframe, { save, durationMs, confirmed }) {
    const panel = document.createElement('section');
    panel.className = 'production-history camera-preview-panel';
    panel.innerHTML = `
      <h3>起幅与落幅</h3>
      <p data-camera-note></p>
      <div class="camera-preview-stage">
        <canvas hidden aria-label="根据指定分镜关键画面裁切的运镜预演"></canvas>
        <p data-camera-placeholder>绑定分镜关键画面后可预览裁切。</p>
      </div>
      <div class="production-picker">
        <button type="button" data-camera-play disabled>播放预演</button>
        <button type="button" data-camera-start>看起幅</button>
        <button type="button" data-camera-end>看落幅</button>
        <span data-camera-time></span>
      </div>
      <label>预演位置<input type="range" data-camera-progress min="0" max="1000" value="0"></label>
      <div class="production-metadata">
        <label>取景预设<select data-camera-preset><option value="">选择预设</option>
          <option value="locked">固定</option><option value="push">慢推近</option><option value="pull">慢拉远</option>
          <option value="right">向右平移</option><option value="left">向左平移</option></select></label>
        <label>画幅<select data-camera-ratio></select></label>
        <label>速度变化<select data-camera-ease><option value="linear">匀速</option><option value="smooth">缓入缓出</option></select></label>
      </div>
      <div class="production-metadata" data-camera-frames></div>
      <div class="production-picker"><button type="button" data-camera-save>保存运镜方案</button>
        <output role="status"></output></div>`;
    const frameFields = panel.querySelector('[data-camera-frames]');
    const canvas = panel.querySelector('canvas');
    const slider = panel.querySelector('[data-camera-progress]');
    const play = panel.querySelector('[data-camera-play]');
    const feedback = panel.querySelector('output');
    const ratio = panel.querySelector('[data-camera-ratio]');
    const ease = panel.querySelector('[data-camera-ease]');
    const preset = panel.querySelector('[data-camera-preset]');
    const time = panel.querySelector('[data-camera-time]');
    const note = panel.querySelector('[data-camera-note]');
    const picture = new Image();
    let plan = read(record) || { ratio: '9:16', easing: 'smooth', start: { ...presets.locked[0] }, end: { ...presets.locked[1] } };
    let frame, startedAt, startedFrom;

    for (const option of Object.keys(dimensions)) ratio.add(new Option(option));
    const fields = { start: {}, end: {} };
    for (const [key, label] of [['start', '起幅'], ['end', '落幅']]) {
      const group = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = label;
      group.append(legend);
      for (const [field, title, low, high] of [['scale', '放大比例（%）', 100, 180], ['x', '横向取景（%）', 0, 100], ['y', '纵向取景（%）', 0, 100]]) {
        const label = document.createElement('label');
        label.textContent = title;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = low;
        input.max = high;
        input.step = 1;
        input.oninput = () => {
          if (!bounded(input.valueAsNumber, low, high)) return;
          plan[key][field] = input.valueAsNumber;
          jump(key === 'start' ? 0 : 1000);
        };
        fields[key][field] = input;
        label.append(input);
        group.append(label);
      }
      frameFields.append(group);
    }
    function formValues() {
      ratio.value = plan.ratio;
      ease.value = plan.easing;
      for (const [key, frame] of Object.entries(fields)) {
        for (const [field, control] of Object.entries(frame)) control.value = plan[key][field];
      }
    }
    function update() {
      const ready = paint(canvas, picture, plan, slider.valueAsNumber / 1000);
      canvas.hidden = !ready;
      panel.querySelector('[data-camera-placeholder]').hidden = ready;
      play.disabled = !ready;
      time.textContent = `${(slider.valueAsNumber * durationMs / 1e6).toFixed(2)} / ${(durationMs / 1000).toFixed(2)} 秒`;
      note.textContent = confirmed ? '根据分镜关键画面的二维裁切预演。' : '分镜时长暂定，先用关键画面预演取景。';
      if (ready && ['scale', 'x', 'y'].some(field => plan.start[field] !== plan.end[field])) {
        const first = crop(plan, 0, picture.naturalWidth, picture.naturalHeight);
        const last = crop(plan, 1, picture.naturalWidth, picture.naturalHeight);
        if (['x', 'y', 'w', 'h'].every(field => Math.abs(first[field] - last[field]) < .01)) {
          note.textContent += ' 当前画幅没有可见的平移余量，可以稍微放大后重试。';
        }
      }
    }
    function stop() {
      cancelAnimationFrame(frame);
      frame = undefined;
      play.textContent = '播放预演';
    }
    function jump(value) {
      stop();
      slider.value = value;
      update();
    }
    function tick(now) {
      slider.value = Math.min(1000, Math.round(startedFrom + (now - startedAt) * 1000 / durationMs));
      update();
      if (slider.valueAsNumber >= 1000) stop();
      else frame = requestAnimationFrame(tick);
    }
    play.onclick = () => {
      if (frame !== undefined) return stop();
      if (slider.valueAsNumber >= 1000) jump(0);
      startedAt = performance.now();
      startedFrom = slider.valueAsNumber;
      play.textContent = '暂停预演';
      frame = requestAnimationFrame(tick);
    };
    slider.oninput = () => jump(slider.valueAsNumber);
    panel.querySelector('[data-camera-start]').onclick = () => jump(0);
    panel.querySelector('[data-camera-end]').onclick = () => jump(1000);
    ratio.onchange = () => { plan.ratio = ratio.value; update(); };
    ease.onchange = () => { plan.easing = ease.value; update(); };
    preset.onchange = () => {
      if (!Object.hasOwn(presets, preset.value)) return;
      const [start, end] = presets[preset.value];
      plan = { ...plan, start: { ...start }, end: { ...end } };
      formValues();
      jump(0);
      preset.value = '';
    };
    panel.querySelector('[data-camera-save]').onclick = () => {
      if (Object.values(fields).some(frame => Object.values(frame).some(input =>
        !bounded(input.valueAsNumber, Number(input.min), Number(input.max))))) {
        feedback.textContent = '请填写有效的取景比例和位置。';
        return;
      }
      const previous = record.cameraPlan;
      record.cameraPlan = JSON.stringify(plan);
      if (save() === false) {
        if (previous === undefined) delete record.cameraPlan;
        else record.cameraPlan = previous;
        feedback.textContent = '浏览器未能保存运镜方案，请重试。';
        return;
      }
      feedback.textContent = '已保存本镜起幅与落幅。';
    };
    picture.onload = update;
    if (keyframe?.image) picture.src = keyframe.image;
    formValues();
    update();
    return { panel, dispose() { stop(); picture.onload = null; picture.removeAttribute('src'); } };
  }

  const api = { normalize, read, describe, crop, paint, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.arcCamera = api;
})(globalThis);
