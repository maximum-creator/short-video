(() => {
  function clock(ms) {
    const seconds = Math.floor(ms / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${Math.floor(ms % 1000 / 100)}`;
  }

  function create(cuts, activeIndex, { openShot, moveShot, audioFile, onAudio, targetSeconds, setDuration }) {
    const panel = document.createElement('section');
    panel.className = 'animatic';
    if (!cuts.length) {
      panel.innerHTML = '<p class="production-status">本集还没有可预演的镜头。先去分镜写下第一镜的剧情目的或选一张关键画面。</p>' +
        '<div class="production-picker"><button type="button" class="production-action">开始分镜</button></div>';
      panel.querySelector('button').onclick = () => openShot(activeIndex);
      return { panel, dispose() {} };
    }
    panel.innerHTML = `
      <section class="animatic-pacing" aria-label="预演与目标时长">
        <div><strong>本集预演时长</strong> <span data-pacing-duration></span></div>
        <p class="production-status" data-pacing-detail></p>
        <button type="button" class="production-action" data-first-draft hidden>编辑第一条暂定镜头</button>
      </section>
      <div class="animatic-preview">
        <img alt="" hidden>
        <canvas hidden aria-label="当前分镜的二维运镜预演"></canvas>
        <p class="animatic-placeholder"></p>
        <div class="animatic-caption"><b></b><span></span></div>
      </div>
      <div class="animatic-controls">
        <button type="button" class="production-action" data-play>播放</button>
        <span data-clock></span>
        <input type="range" min="0" step="10" value="0" aria-label="预演播放位置">
        <label>临时对白<input type="file" accept="audio/*"></label>
      </div>
      <div class="animatic-audio-fit" data-audio-fit hidden>
        <p data-audio-length></p>
        <button type="button" class="production-action" data-audio-tail disabled>定位到尾部检查</button>
        <button type="button" class="production-action" data-audio-clear>移除临时对白</button>
      </div>
      <div class="animatic-duration-editor">
        <label><span data-duration-label>当前镜头时长（秒）</span><input data-shot-duration type="number" min="0.25" max="120" step="0.01" required></label>
        <button type="button" class="production-action" data-save-duration>保存镜头时长</button>
        <output role="status" data-duration-status></output>
      </div>
      <p role="status" class="production-status"></p>
      <div class="animatic-strip" aria-label="镜头顺序"></div>
      <details class="production-optional-field animatic-sheet">
        <summary>并排检查关键画面</summary>
        <p class="production-status" data-sheet-count></p>
        <label><input type="checkbox" data-grayscale>灰度查看明暗</label>
        <div class="animatic-sheet-grid"></div>
      </details>`;
    const strip = panel.querySelector('.animatic-strip');
    const play = panel.querySelector('[data-play]');
    const slider = panel.querySelector('[type="range"]');
    const picture = panel.querySelector('img');
    const canvas = panel.querySelector('canvas');
    const placeholder = panel.querySelector('.animatic-placeholder');
    const caption = panel.querySelector('.animatic-caption');
    const status = panel.querySelector('p[role="status"]');
    const durationInput = panel.querySelector('[data-shot-duration]');
    const durationMessage = panel.querySelector('[data-duration-status]');
    const audioInput = panel.querySelector('input[type="file"]');
    const audioFit = panel.querySelector('[data-audio-fit]');
    const audioLength = panel.querySelector('[data-audio-length]');
    const audioTail = panel.querySelector('[data-audio-tail]');
    const audio = new Audio();
    const total = cuts.at(-1).end;
    const unconfirmed = cuts.filter(cut => !cut.specified);
    const seconds = total / 1000;
    const formatSeconds = value => Number(value.toFixed(2)).toString();
    const delta = seconds - targetSeconds;
    panel.querySelector('[data-pacing-duration]').textContent = `${formatSeconds(seconds)} / ${targetSeconds} 秒`;
    const difference = Math.abs(delta) < .005 ? '与目标时长一致' :
      `比目标${delta < 0 ? '短' : '长'} ${formatSeconds(Math.abs(delta))} 秒`;
    panel.querySelector('[data-pacing-detail]').textContent = unconfirmed.length
      ? `${difference}。其中 ${unconfirmed.length} 镜暂按每镜 3 秒，确认后再判断整集节奏。`
      : `${difference}。本集镜头时长均已填写。`;
    if (unconfirmed.length) {
      const editDraft = panel.querySelector('[data-first-draft]');
      editDraft.hidden = false;
      editDraft.textContent = `编辑 ${unconfirmed[0].id} 时长`;
      editDraft.onclick = () => {
        stop();
        jump(unconfirmed[0].start);
        durationInput.focus();
      };
    }
    let position = cuts.find(cut => cut.index === activeIndex)?.start || 0;
    let current = -1;
    let frame;
    let startedAt;
    let startedFrom;
    let audioUrl;
    let audioReady = false;
    let playRequest = 0;
    slider.max = total;

    const sheet = panel.querySelector('.animatic-sheet');
    const sheetGrid = sheet.querySelector('.animatic-sheet-grid');
    const shades = sheet.querySelector('[data-grayscale]');
    shades.onchange = () => sheetGrid.classList.toggle('is-grayscale', shades.checked);
    sheet.querySelector('[data-sheet-count]').textContent =
      `${cuts.filter(cut => cut.frame?.image).length} / ${cuts.length} 镜有关键画面。按播放顺序核对机位、主光和道具位置。`;
    sheet.addEventListener('toggle', () => {
      if (!sheet.open || sheetGrid.childElementCount) return;
      for (const cut of cuts) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'animatic-sheet-tile';
        tile.onclick = () => openShot(cut.index);
        const label = document.createElement('strong');
        label.textContent = cut.id;
        const note = document.createElement('span');
        note.textContent = cut.frame?.image ? [cut.frame.name, cut.frame.revision].filter(Boolean).join(' · ') : '待选关键画面';
        if (cut.frame?.image) {
          const picture = document.createElement('img');
          picture.src = cut.frame.image;
          picture.alt = cut.frame.name;
          picture.loading = 'lazy';
          tile.append(picture);
        } else {
          const placeholder = document.createElement('span');
          placeholder.className = 'animatic-sheet-empty';
          placeholder.setAttribute('aria-hidden', 'true');
          tile.append(placeholder);
        }
        tile.append(label, note);
        sheetGrid.append(tile);
      }
    });

    cuts.forEach((cut, i) => {
      const tile = document.createElement('article');
      tile.innerHTML = '<button type="button" data-seek></button><div><button type="button" data-left>前移</button><button type="button" data-right>后移</button><button type="button" data-edit>编辑</button></div>';
      const seek = tile.querySelector('[data-seek]');
      seek.textContent = `${cut.id} · ${(cut.end - cut.start) / 1000} 秒${cut.specified ? '' : '（暂定）'}`;
      seek.title = cut.beat || cut.id;
      seek.onclick = () => jump(cut.start);
      const left = tile.querySelector('[data-left]');
      const right = tile.querySelector('[data-right]');
      left.disabled = i === 0;
      right.disabled = i === cuts.length - 1;
      left.onclick = () => moveShot(cut.index, cuts[i - 1].index);
      right.onclick = () => moveShot(cut.index, cuts[i + 1].index);
      tile.querySelector('[data-edit]').onclick = () => openShot(cut.index);
      strip.append(tile);
    });

    function show() {
      const index = cuts.findIndex(cut => position < cut.end);
      const next = index < 0 ? cuts.length - 1 : index;
      if (current !== next) {
        if (current >= 0) strip.children[current].removeAttribute('aria-current');
        strip.children[next].setAttribute('aria-current', 'true');
        const cut = cuts[next];
        current = next;
        panel.querySelector('[data-duration-label]').textContent = `${cut.id} 时长（秒）`;
        durationInput.value = cut.specified ? (cut.end - cut.start) / 1000 : '';
        durationInput.placeholder = cut.specified ? '' : '暂用 3 秒';
        durationMessage.textContent = '';
        caption.querySelector('b').textContent = cut.id;
        caption.querySelector('span').textContent = cut.beat || '待填写镜头说明';
        picture.hidden = !cut.frame?.image;
        placeholder.hidden = !picture.hidden;
        if (cut.frame?.image) {
          picture.src = cut.frame.image;
          picture.alt = cut.frame.name;
        } else {
          picture.removeAttribute('src');
          placeholder.textContent = cut.frame ? cut.frame.name : '待选分镜关键画面';
        }
      }
      const active = cuts[next];
      const hasImage = Boolean(active.frame?.image);
      const painted = hasImage && active.cameraPlan && window.arcCamera.paint(canvas, picture, active.cameraPlan,
        (position - active.start) / (active.end - active.start));
      canvas.hidden = !painted;
      picture.hidden = !hasImage || Boolean(painted);
      slider.value = position;
      panel.querySelector('[data-clock]').textContent = `${clock(position)} / ${clock(total)}`;
    }

    function syncAudio() {
      const request = ++playRequest;
      if (!audioReady || !Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.min(position / 1000, audio.duration);
      if (frame !== undefined && position / 1000 < audio.duration) {
        audio.play().catch(() => {
          if (request === playRequest) status.textContent = '临时对白无法播放，画面预演仍可继续。';
        });
      } else {
        audio.pause();
      }
    }

    function stop() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      ++playRequest;
      audio.pause();
      play.textContent = '播放';
    }

    function tick(now) {
      position = Math.min(total, Math.round(startedFrom + now - startedAt));
      show();
      if (position >= total) stop();
      else frame = requestAnimationFrame(tick);
    }

    function jump(ms) {
      position = ms;
      startedFrom = ms;
      startedAt = performance.now();
      show();
      syncAudio();
    }

    function saveDuration() {
      stop();
      if (!durationInput.reportValidity()) return;
      try {
        setDuration(cuts[current].index, durationInput.valueAsNumber);
      } catch (error) { durationMessage.textContent = error.message; }
    }
    panel.querySelector('[data-save-duration]').onclick = saveDuration;
    durationInput.onfocus = stop;
    durationInput.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveDuration();
    };

    play.onclick = () => {
      if (frame !== undefined) return stop();
      if (position >= total) position = 0;
      startedFrom = position;
      startedAt = performance.now();
      frame = requestAnimationFrame(tick);
      play.textContent = '暂停';
      syncAudio();
    };
    slider.oninput = () => jump(Number(slider.value));
    function loadAudio(file) {
      ++playRequest;
      audio.pause();
      audioReady = false;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audio.removeAttribute('src');
      audioUrl = file ? URL.createObjectURL(file) : undefined;
      status.textContent = file ? `临时对白 · ${file.name}，从本集 00:00 对齐。` : '';
      audioFit.hidden = !file;
      audioTail.disabled = true;
      audioLength.textContent = file ? '正在读取对白时长…' : '';
      if (audioUrl) audio.src = audioUrl;
      else audio.load();
    }
    audioInput.onchange = event => {
      const file = event.target.files[0];
      onAudio(file);
      loadAudio(file);
    };
    audio.onloadedmetadata = () => {
      audioReady = Number.isFinite(audio.duration) && audio.duration > 0;
      if (!audioReady) {
        audioLength.textContent = '无法读取对白时长。';
        return;
      }
      const difference = audio.duration - total / 1000;
      const estimate = unconfirmed.length ? ' 当前分镜含暂定镜头。' : '';
      const comparison = Math.abs(difference) < .05 ? '对白与预演的总时长接近。' : difference > 0
        ? `对白音轨有约 ${formatSeconds(difference)} 秒落在预演结束之后。`
        : `对白结束后还有约 ${formatSeconds(-difference)} 秒画面，可检查是否留给反应或转场。`;
      audioLength.textContent = `对白 ${formatSeconds(audio.duration)} 秒 · 预演 ${formatSeconds(total / 1000)} 秒。 ${comparison}${estimate}`;
      audioTail.disabled = false;
      syncAudio();
    };
    audio.onerror = () => {
      audioReady = false;
      audioTail.disabled = true;
      audioLength.textContent = '';
      if (audioUrl) status.textContent = '无法读取这条临时对白，请选择浏览器可播放的音频。';
    };
    audioTail.onclick = () => {
      if (!audioReady) return;
      stop();
      jump(Math.max(0, Math.min(total, Math.round(audio.duration * 1000)) - 1000));
    };
    panel.querySelector('[data-audio-clear]').onclick = () => {
      audioInput.value = '';
      onAudio(undefined);
      loadAudio(undefined);
      audioInput.focus();
    };
    picture.onload = show;
    if (audioFile) loadAudio(audioFile);
    show();
    return { panel, dispose() {
      stop();
      audio.onloadedmetadata = null;
      audio.onerror = null;
      picture.onload = null;
      audio.removeAttribute('src');
      audio.load();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    } };
  }

  window.arcStoryboard = { create };
})();
