(() => {
  function create(record, snapshot, shotId, getReferences, getSettings, applyDraft) {
    const panel = document.createElement('details');
    panel.className = 'production-history prompt-draft';
    panel.innerHTML = `
      <summary>用中文交代拍法</summary>
      <label>你希望怎么拍<textarea data-instruction rows="3" maxlength="2000"
        placeholder="例如先固定机位等人物抬眼，再沿窗向右轻移。保持发型、风衣和暖色逆光。"></textarea></label>
      <div class="production-picker">
        <button type="button" data-draft disabled>请总导演起草英文</button>
        <button type="button" data-cancel-draft hidden>停止等待</button>
      </div>
      <output role="status"></output>
      <div data-preview hidden>
        <p data-draft-summary></p><ul data-warnings></ul>
        <label>英文草稿<textarea data-draft-text rows="6" maxlength="6500"></textarea></label>
        <div class="production-picker"><button type="button" data-apply-draft>采用为本镜提示词</button></div>
      </div>`;
    const instruction = panel.querySelector('[data-instruction]');
    const preview = panel.querySelector('[data-preview]');
    const draftText = panel.querySelector('[data-draft-text]');
    const draft = panel.querySelector('[data-draft]');
    const cancel = panel.querySelector('[data-cancel-draft]');
    const output = panel.querySelector('output');
    const apply = panel.querySelector('[data-apply-draft]');
    let active = true, configured = false, testFixture = false, pending, draftScope;
    instruction.value = record.generationInstruction || '';
    const motion = window.arcMotionActions.describe(record.motionAction);
    if (motion && !instruction.value) instruction.value =
      '采用本镜选定动作，按分镜的角色、场景和机位来拍。只写必要的起势、主要动作和收势。';
    const signature = () => JSON.stringify(getReferences());
    const settingsSignature = () => JSON.stringify(getSettings());

    function controls() {
      draft.disabled = !configured || Boolean(pending);
      cancel.hidden = !pending;
    }

    function stop() {
      pending?.abort();
      pending = undefined;
      controls();
    }

    draft.onclick = async () => {
      const question = instruction.value.trim();
      if (!question) { output.textContent = '先用中文描述这个镜头希望怎么拍。'; return; }
      if (pending || !configured) return;
      const referenceRoles = getReferences();
      const scope = JSON.stringify(referenceRoles);
      const settings = getSettings();
      const settingsScope = JSON.stringify(settings);
      const controller = new AbortController();
      pending = controller;
      preview.hidden = true;
      output.textContent = '总导演正在起草英文提示词…';
      controls();
      try {
        const route = settings.preset ? '/api/assistant?preset=' + encodeURIComponent(settings.preset) : '/api/assistant';
        const response = await fetch(route, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ mode: 'prompt', role: 'video', snapshot, shotId, referenceRoles, ...settings,
            turns: [{ role: 'user', content: question }] })
        });
        const value = await response.json();
        if (!active || pending !== controller) return;
        if (!response.ok || !value.promptDraft) throw new Error(value.promptError || value.error || '未取得英文提示词。');
        if (scope !== signature() || settingsScope !== settingsSignature() || question !== instruction.value.trim()) {
          throw new Error('中文指令、参考图或生成参数已更改，请重新起草。');
        }
        const result = value.promptDraft;
        draftText.value = result.prompt;
        panel.querySelector('[data-draft-summary]').textContent = result.summary;
        const warnings = panel.querySelector('[data-warnings]');
        warnings.replaceChildren();
        for (const warning of result.warnings) {
          const item = document.createElement('li');
          item.textContent = warning;
          warnings.append(item);
        }
        if (!referenceRoles.length) {
          const notice = document.createElement('li');
          notice.textContent = '起草时没有已选的生成参考图。';
          warnings.append(notice);
        }
        draftScope = { question, scope, settingsScope };
        preview.hidden = false;
        apply.disabled = false;
        output.textContent = testFixture ? '本地模拟草稿，请核对描述和保留项。' : '草稿已就绪，请核对描述和保留项。';
        draftText.focus();
      } catch (error) {
        if (active && pending === controller) output.textContent = error.message;
      } finally {
        if (pending === controller) { pending = undefined; controls(); }
      }
    };
    cancel.onclick = () => { stop(); output.textContent = '已停止等待。'; };
    apply.onclick = () => {
      if (!draftScope || draftScope.scope !== signature() || draftScope.settingsScope !== settingsSignature() ||
          draftScope.question !== instruction.value.trim()) {
        output.textContent = '拍法、参考图或生成参数已变化，请重新起草后采用。';
        return;
      }
      const value = draftText.value.trim();
      if (!value) { output.textContent = '英文草稿为空。'; return; }
      try {
        applyDraft(value, draftScope.scope, draftScope.settingsScope, draftScope.question);
        output.textContent = '已带入本镜生成提示词。';
        apply.disabled = true;
      } catch (error) { output.textContent = error.message; }
    };
    draftText.oninput = () => { apply.disabled = false; };
    if (location.hostname === '127.0.0.1' && location.protocol === 'http:') {
      fetch('/api/assistant', { cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error();
        const config = await response.json();
        if (!active) return;
        testFixture = config.testFixture === true;
        configured = true;
        output.textContent = testFixture ? '本地助手演练 · 使用模拟草稿' : '总导演已配置；发送时会检查本地模型服务。';
        controls();
      }).catch(() => { if (active) output.textContent = '总导演服务未连接，可在下方手动编写生成提示词。'; });
    } else {
      output.textContent = '从已配置总导演的本地工作台地址打开，即可起草。';
    }
    return { panel, dispose() { active = false; stop(); } };
  }

  window.arcPromptDraft = { create };
})();
