(() => {
  const MAX_SIZE = 30 * 1024 ** 2;

  function duration(file) {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      const timer = setTimeout(() => finish(new Error('读取对白音频已超时。')), 8000);
      function finish(error) {
        clearTimeout(timer);
        audio.onloadedmetadata = audio.onerror = null;
        const seconds = audio.duration;
        audio.removeAttribute('src');
        audio.load();
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else if (!Number.isFinite(seconds) || seconds < .1 || seconds > 300) reject(new Error('请选择 0.1 秒至 5 分钟的对白音频。'));
        else resolve(seconds);
      }
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => finish();
      audio.onerror = () => finish(new Error('浏览器无法读取对白音频。'));
      audio.src = url;
    });
  }

  function create({ initial, onFile, skipped, filmSeconds }) {
    const panel = document.createElement('details');
    panel.className = 'production-history dialogue-handoff';
    panel.innerHTML = `
      <summary>交接独立对白</summary>
      <p data-dialogue-status></p>
      <label>选择对白文件<input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"></label>
      <label class="dialogue-checkbox"><input type="checkbox" data-include-dialogue>随本集清单交接对白</label>
      <div class="production-metadata">
        <label>对白源入点（秒）<input type="number" min="0" step="0.001" value="0"></label>
        <label>对白源出点（秒）<input type="number" min="0" step="0.001" placeholder="音频结尾"></label>
        <label>成片中从第几秒开始<input type="number" min="0" step="0.001" value="0"></label>
      </div>`;
    const input = panel.querySelector('[type="file"]');
    const include = panel.querySelector('[data-include-dialogue]');
    const [startField, endField, delayField] = panel.querySelectorAll('[type="number"]');
    let file = initial;
    function show() {
      include.disabled = Boolean(skipped) || !file;
      const status = panel.querySelector('[data-dialogue-status]');
      status.textContent = skipped ? '本集还有未通过的镜头。局部粗剪可先交接画面，在 ARC 里重新摆放对白。' :
        file ? `已选 ${file.name} · 按本集成片的时间定位。` : '可选择本集对白或沿用动态分镜中的临时对白。';
    }
    input.onchange = () => {
      file = input.files[0];
      onFile(file);
      include.checked = Boolean(file) && !skipped;
      show();
    };
    show();
    return { panel, async declaration() {
      if (!include.checked || include.disabled) return undefined;
      const source = file;
      const start = startField.valueAsNumber;
      const enteredEnd = endField.valueAsNumber;
      const delay = delayField.valueAsNumber;
      if (!source || source.size < 1 || source.size > MAX_SIZE) throw new Error('对白文件须非空且不超过 30 MiB。');
      if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法校验音频指纹，请用本地工作台地址打开。');
      const seconds = await duration(source);
      const end = Number.isNaN(enteredEnd) ? seconds : enteredEnd;
      if (!Number.isFinite(start) || !Number.isFinite(delay) || start < 0 || delay < 0 || end - start < .1 ||
          end > seconds + .001 || delay + end - start > filmSeconds + .001) {
        throw new Error('对白须保留至少 0.1 秒，源切点和成片位置不能超出各自时长。');
      }
      const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', await source.arrayBuffer()));
      if (file !== source || !include.checked || startField.valueAsNumber !== start || delayField.valueAsNumber !== delay ||
          !Object.is(endField.valueAsNumber, enteredEnd)) throw new Error('对白选择已修改，请重新导出。');
      return { file: source.name, size: source.size,
        hash: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), start, end, delay };
    } };
  }

  window.arcDialogueHandoff = { create };
})();
