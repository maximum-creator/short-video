(() => {
  function create(candidate, comparison, { audioChoice = false, audioLabels = ['原裁片', '增强回片'] } = {}) {
    const panel = document.createElement('section');
    panel.className = 'production-history paired-review';
    panel.innerHTML = `
      <h3>同步对照</h3>
      <div class="production-picker"><button type="button" data-link disabled>同步两段</button>
        <span data-status role="status">选好候选与对照视频后即可同步。</span></div>
      <div data-transport hidden>
        <div class="production-picker">
          <button type="button" data-position="-0.1">−0.1 秒</button>
          <button type="button" data-play>播放</button>
          <button type="button" data-position="0.1">+0.1 秒</button>
          <label>倍速<select><option value="1">1×</option><option value="0.5">0.5×</option></select></label>
        </div>
        <label>同步进度<input type="range" min="0" value="0" step="0.001"></label>
        <p data-time></p>
        <details><summary>调整两段的起点</summary>
          <p>两段片头长度不同时，填入同一个动作在各自视频上的时间。</p>
          <div class="production-metadata">
            <label>候选起点（秒）<input type="number" min="0" step="any" value="0"></label>
            <label>对照起点（秒）<input type="number" min="0" step="any" value="0"></label>
          </div>
        </details>
      </div>`;
    const players = [candidate, comparison];
    const link = panel.querySelector('[data-link]');
    const transport = panel.querySelector('[data-transport]');
    const status = panel.querySelector('[data-status]');
    const time = panel.querySelector('[data-time]');
    const play = panel.querySelector('[data-play]');
    const position = panel.querySelector('input[type="range"]');
    const offsets = [...panel.querySelectorAll('input[type="number"]')];
    const rate = panel.querySelector('select');
    let audioTrack = 0;
    let audioAvailability = [null, null];
    let audioSelect;
    if (audioChoice) {
      const label = document.createElement('label');
      label.textContent = '监听音轨';
      audioSelect = document.createElement('select');
      audioSelect.append(new Option(audioLabels[0], '0'), new Option(audioLabels[1], '1'));
      audioSelect.onchange = () => { audioTrack = Number(audioSelect.value); applyAudio(); showSyncStatus(); };
      label.append(audioSelect);
      rate.closest('.production-picker').append(label);
      panel.querySelector('[data-transport] details').hidden = true;
    }
    const steps = [...panel.querySelectorAll('[data-position]')];
    const listeners = new AbortController();
    let starts = [0, 0], length = 0, rangeLimit, linked = false, running = false, frame, sequence = 0, audio;

    function ready() {
      return players.every(player => player.readyState >= 1 && Number.isFinite(player.duration) && player.duration > 0);
    }

    function relativeTime() {
      return Math.min(length, Math.max(0, candidate.currentTime - starts[0]));
    }

    function showTime() {
      position.value = relativeTime();
      const names = audioChoice ? audioLabels : ['候选源', '对照源'];
      time.textContent = `${names[0]} ${candidate.currentTime.toFixed(3)} 秒 · ${names[1]} ${comparison.currentTime.toFixed(3)} 秒`;
    }

    function showSyncStatus() {
      status.textContent = audioChoice ? audioAvailability.every(value => value === false) ?
        '同步已开启 · 两版均未检测到音轨，当前只能审画面' :
        `同步已开启 · 选择试听${audioLabels[audioTrack]} · ${audioEvidenceLabel(audioAvailability[audioTrack])}` :
        '同步已开启 · 对照已静音';
    }

    function audioEvidenceLabel(available) {
      return available === true ? '容器检测到音轨，仍需听审内容与同步' :
        available === false ? '容器未检测到音轨' : '音轨状态未核验';
    }

    function setAudioAvailability(values) {
      if (!audioChoice || !Array.isArray(values) || values.length !== 2) return;
      audioAvailability = values.map(value => value === true ? true : value === false ? false : null);
      for (const [index, option] of [...audioSelect.options].entries()) {
        option.textContent = `${audioLabels[index]}（${audioEvidenceLabel(audioAvailability[index])}）`;
        option.disabled = audioAvailability[index] === false;
      }
      if (audioAvailability[audioTrack] === false) {
        const available = audioAvailability.findIndex(value => value !== false);
        if (available >= 0) audioTrack = available;
        audioSelect.value = String(audioTrack);
      }
      audioSelect.disabled = audioAvailability.every(value => value === false);
      applyAudio();
      showSyncStatus();
    }

    function applyAudio() {
      if (audioChoice) players.forEach((player, index) => {
        player.muted = audioAvailability.every(value => value === false) || audioAvailability[audioTrack] === false || index !== audioTrack;
      });
      else comparison.muted = true;
    }

    function pause() {
      ++sequence;
      running = false;
      cancelAnimationFrame(frame);
      for (const player of players) player.pause();
      play.textContent = '播放';
    }

    function seek(value) {
      const target = Math.max(0, Math.min(length, value));
      players.forEach((player, index) => { player.currentTime = starts[index] + target; });
      showTime();
    }

    function updateRange(at = 0) {
      pause();
      const entered = offsets.map(input => input.valueAsNumber);
      const valid = ready() && entered.every((start, index) => Number.isFinite(start) && start >= 0 && start < players[index].duration);
      length = valid ? Math.min(rangeLimit ?? Infinity, ...players.map((player, index) => player.duration - entered[index])) : 0;
      const available = length >= .02;
      for (const control of [play, position, ...steps]) control.disabled = !available;
      if (available) showSyncStatus();
      else status.textContent = '两段起点之后至少要有 0.02 秒可对照。';
      if (!available) time.textContent = '';
      if (available) {
        starts = entered;
        position.max = length;
        seek(at);
      }
    }

    function unlink(message) {
      if (linked) {
        pause();
        players.forEach((player, index) => {
          player.controls = true;
          player.playbackRate = audio[index].rate;
          player.muted = audio[index].muted;
        });
      }
      linked = false;
      transport.hidden = true;
      link.disabled = !ready();
      link.textContent = '同步两段';
      status.textContent = message || (ready() ? '两段视频已就绪。' : '选好候选与对照视频后即可同步。');
    }

    function tick() {
      if (!running) return;
      if (relativeTime() >= length - .01 || candidate.ended || comparison.ended) {
        pause();
        seek(length);
        return;
      }
      const target = starts[1] + relativeTime();
      if (Math.abs(comparison.currentTime - target) > .18 && !comparison.seeking && !candidate.seeking) {
        comparison.currentTime = target;
      }
      showTime();
      frame = requestAnimationFrame(tick);
    }

    function canSeek(player, seconds) {
      return player.readyState >= 1 && Number.isFinite(player.duration) && Number.isFinite(seconds) &&
        seconds >= 0 && seconds <= player.duration + .0005;
    }

    function beginSync() {
      audio = players.map(player => ({ rate: player.playbackRate, muted: player.muted }));
      linked = true;
      transport.hidden = false;
      link.textContent = '取消同步';
      players.forEach(player => { player.controls = false; player.playbackRate = Number(rate.value); });
      applyAudio();
    }

    link.onclick = () => {
      if (linked) { unlink(); return; }
      if (!ready()) return;
      beginSync();
      updateRange();
    };
    play.onclick = async () => {
      if (running) { pause(); return; }
      const operation = ++sequence;
      if (relativeTime() >= length - .01) seek(0);
      running = true;
      play.textContent = '暂停';
      showSyncStatus();
      try {
        await Promise.all(players.map(player => player.play()));
        if (operation === sequence) frame = requestAnimationFrame(tick);
      } catch {
        if (operation !== sequence) return;
        pause();
        status.textContent = '两段未能同时播放。请检查源视频，再试一次。';
      }
    };
    position.oninput = () => { pause(); seek(Number(position.value)); };
    for (const button of steps) button.onclick = () => { pause(); seek(relativeTime() + Number(button.dataset.position)); };
    for (const input of offsets) input.onchange = () => { rangeLimit = undefined; updateRange(); };
    rate.onchange = () => { for (const player of players) player.playbackRate = Number(rate.value); };
    for (const player of players) {
      const options = { signal: listeners.signal };
      player.addEventListener('loadedmetadata', () => { if (!linked) unlink(); }, options);
      player.addEventListener('emptied', () => unlink(), options);
      player.addEventListener('error', () => unlink(), options);
      player.addEventListener('seeked', () => { if (linked) showTime(); }, options);
    }
    return { panel, setAudioAvailability, sourceChanged() {
      unlink('等待视频就绪。');
      link.disabled = true;
      rangeLimit = undefined;
      offsets.forEach(input => { input.value = 0; });
    }, pauseForNote() { if (linked) pause(); else candidate.pause(); },
      pauseForEvidence: pause,
      coordinates() {
        return { linked, starts: [...starts], length };
      },
      seekTrack(track, seconds) {
        if (!canSeek(players[track], seconds)) throw new Error('回片尚未就绪，或位置超出视频。');
        if (linked && seconds >= starts[track] && seconds <= starts[track] + length) {
          pause();
          seek(seconds - starts[track]);
        } else {
          if (linked) unlink('标记在共同区间之外，已定位到对应版本。');
          else pause();
          players[track].currentTime = seconds;
        }
      },
      alignRange(candidateStart, comparisonStart, duration) {
        if (!ready() || !canSeek(candidate, candidateStart) || !canSeek(comparison, comparisonStart) ||
            !Number.isFinite(duration) || Math.min(duration, candidate.duration - candidateStart,
              comparison.duration - comparisonStart) < .02) throw new Error('两段视频尚未就绪，或镜头区间超出视频范围。');
        if (!linked) beginSync();
        rangeLimit = duration;
        offsets.forEach((input, index) => { input.value = index ? comparisonStart : candidateStart; });
        updateRange();
      },
      alignAt(comparisonTime) {
        const candidateTime = candidate.currentTime;
        if (!ready() || candidate.readyState < 2 || candidate.seeking ||
            !canSeek(comparison, comparisonTime) || candidateTime >= candidate.duration ||
            comparisonTime >= comparison.duration) {
          throw new Error('等两个视频载入后，先把候选停在对应动作上。');
        }
        const delta = candidateTime - comparisonTime;
        const anchor = Math.min(candidateTime, comparisonTime);
        const opening = [Math.max(0, delta), Math.max(0, -delta)];
        if (Math.min(...players.map((player, index) => player.duration - opening[index])) < .02) {
          throw new Error('这两个时刻之后没有足够的共同区间，请调整候选播放头。');
        }
        if (!linked) beginSync();
        rangeLimit = undefined;
        offsets.forEach((input, index) => { input.value = opening[index]; });
        updateRange(anchor);
      },
      seekCandidate(seconds) {
        if (!canSeek(candidate, seconds)) {
          throw new Error('当前视频未就绪，或批注超出源视频时长。');
        }
        if (linked && length && seconds >= starts[0] && seconds <= starts[0] + length) {
          pause();
          seek(seconds - starts[0]);
        } else {
          if (linked) unlink('已取消同步，批注在共同区间之外。');
          candidate.pause();
          candidate.currentTime = Math.min(seconds, candidate.duration);
        }
      },
      seekEvidence(candidateTime, comparisonTime) {
        if (!canSeek(comparison, comparisonTime) || (candidateTime != null && !canSeek(candidate, candidateTime))) {
          throw new Error('视频尚未就绪，或复核时间超出当前源视频。');
        }
        if (linked) unlink('已暂停同步，定位到复核时间。');
        else pause();
        if (candidateTime != null) candidate.currentTime = Math.min(candidateTime, candidate.duration);
        comparison.currentTime = Math.min(comparisonTime, comparison.duration);
      },
      dispose() { listeners.abort(); pause(); } };
  }

  window.arcCompare = { create };
})();
