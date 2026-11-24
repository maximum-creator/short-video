(() => {
  const maxTextBytes = 5 * 1024 * 1024;
  const maxDocxBytes = 20 * 1024 * 1024;
  const maxDocxXmlBytes = 10 * 1024 * 1024;
  const maxEpisodeNumber = 300;
  const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const cleanTitle = value => String(value || '').replace(/[】\]]+\s*$/, '').trim().slice(0, 120);
  const heading = line => {
    const value = line.trim().replace(/^#{1,6}\s+/, '').trim();
    let match = value.match(/^第\s*0*(\d{1,3})\s*[集话回](?:\s*[：:、.．\-—]?\s*(.*))?$/);
    if (match) return { number: Number(match[1]), title: cleanTitle(match[2]) };
    match = value.match(/^(?:EP|Episode)\s*0*(\d{1,3})(?:\s*[：:、.．\-—]?\s*(.*))?$/i);
    return match ? { number: Number(match[1]), title: cleanTitle(match[2]) } : null;
  };
  function parse(text) {
    if (typeof text !== 'string') throw new Error('剧本内容必须是文本。');
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!normalized) throw new Error('文件内容为空。');
    const lines = normalized.split('\n');
    const starts = [];
    lines.forEach((line, index) => {
      const found = heading(line);
      if (found) {
        if (found.number < 1 || found.number > maxEpisodeNumber) throw new Error(`集数需在 1–${maxEpisodeNumber} 集之间。`);
        starts.push({ ...found, line: index });
      }
    });
    if (!starts.length) return { hasEpisodeHeadings: false, preface: '', episodes: [{ number: null, title: '', text: normalized, empty: false }] };
    const seen = new Set();
    for (const item of starts) {
      if (seen.has(item.number)) throw new Error(`文件中重复出现第 ${item.number} 集标题；请先整理后再导入。`);
      seen.add(item.number);
    }
    const preface = lines.slice(0, starts[0].line).join('\n').trim();
    const episodes = starts.map((item, index) => {
      const body = lines.slice(item.line + 1, starts[index + 1]?.line ?? lines.length).join('\n').trim();
      return { number: item.number, title: item.title, text: body, empty: !body };
    });
    return { hasEpisodeHeadings: true, preface, episodes };
  }
  function analyzeStructure(text) {
    const source = String(text || '');
    if (source.length > 500_000) throw new Error('单集超过 50 万字，暂不做自动结构识别；原稿仍可正常编辑。');
    const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const scenes = [];
    const dialogue = [];
    const dialogueCandidates = [];
    const unclassified = [];
    const candidateLines = new Set();
    const scenePattern = /^(?:第\s*[零〇一二两三四五六七八九十百\d]+\s*[场幕](?:\s*[：:、.．\-—]?\s*.+)?|场景(?:\s*[零〇一二两三四五六七八九十百\d]+)?\s*[：:]\s*.+|(?:内景|外景|内外景)\s*[：:]\s*.+|(?:INT\.?|EXT\.?|INT\s*\/\s*EXT\.?)\s+.+|SCENE\s+\d+(?:\s*[:.\-—]\s*.*)?|\d{1,3}[-.]\d{1,3}\s+.+)$/iu;
    const inlineDialogue = /^(?:【(?<bracket>[^】]{1,24})】\s*[：:]?\s*|(?<speaker>[\p{L}\p{N}·]{1,16}(?:（[^）]{1,12}）)?\s*[：:])\s*)(?<text>.+)$/u;
    const cueOnly = /^(?:【(?<bracket>[^】]{1,24})】|(?<plain>[\p{Script=Han}·]{1,8}(?:（(?:旁白|内心|画外音|OS|VO|V\.O\.)）)?))$/iu;
    const meaningfulAfter = index => {
      for (let next = index + 1; next < lines.length; next++) if (lines[next].trim()) return next;
      return -1;
    };
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index].trim().replace(/^#{1,6}\s+/, '');
      if (!raw) continue;
      const lineNumber = index + 1;
      if (candidateLines.has(index)) continue;
      if (scenePattern.test(raw)) {
        scenes.push({ line: lineNumber, heading: raw.replace(/^#{1,6}\s+/, '') });
        continue;
      }
      const match = raw.match(inlineDialogue);
      if (match) {
        dialogue.push({ line: lineNumber, speaker: match.groups.bracket || match.groups.speaker.replace(/[：:]\s*$/, ''), text: match.groups.text.trim(), confidence: 'explicit-cue' });
        continue;
      }
      const cue = raw.match(cueOnly);
      const nextIndex = meaningfulAfter(index);
      const next = nextIndex >= 0 ? lines[nextIndex].trim() : '';
      if (cue && next && /^(?:[“"「『（(]|【)/u.test(next)) {
        dialogueCandidates.push({ line: lineNumber, nextLine: nextIndex + 1,
          speaker: cue.groups.bracket || cue.groups.plain, text: next, confidence: 'review-required' });
        candidateLines.add(index);
        candidateLines.add(nextIndex);
        continue;
      }
      unclassified.push({ line: lineNumber, text: raw });
    }
    const sceneOutline = scenes.map((scene, index) =>
      `场次 ${String(index + 1).padStart(2, '0')} · 原稿第 ${scene.line} 行\n${scene.heading}`).join('\n\n');
    const dialogueText = dialogue.map(item => `${item.speaker}：${item.text}`).join('\n');
    return { scenes, dialogue, dialogueCandidates, unclassified, sceneOutline, dialogueText,
      stats: { scenes: scenes.length, dialogue: dialogue.length, dialogueCandidates: dialogueCandidates.length, unclassified: unclassified.length } };
  }
  function docxXmlToText(xml) {
    if (typeof DOMParser === 'undefined') throw new Error('当前浏览器无法读取 Word 文档，请另存为 UTF-8 文本后导入。');
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Word 正文包含不支持的 XML 声明，已停止解析。');
    const documentXml = new DOMParser().parseFromString(xml, 'application/xml');
    if (documentXml.querySelector('parsererror')) throw new Error('Word 文档结构无效或已损坏。');
    const paragraphs = [...documentXml.getElementsByTagNameNS(wordNs, 'p')];
    if (!paragraphs.length) throw new Error('Word 文档中没有可读取的正文段落。');
    const textOf = paragraph => {
      let value = '';
      const walk = node => {
        for (const child of node.childNodes) {
          if (child.nodeType !== 1) continue;
          if (child.namespaceURI === wordNs && ['del', 'moveFrom'].includes(child.localName)) continue;
          if (child.namespaceURI === wordNs && child.localName === 't') value += child.textContent || '';
          else if (child.namespaceURI === wordNs && child.localName === 'tab') value += '\t';
          else if (child.namespaceURI === wordNs && ['br', 'cr'].includes(child.localName)) value += '\n';
          else walk(child);
        }
      };
      walk(paragraph);
      return value;
    };
    return paragraphs.map(paragraph => {
      const style = paragraph.getElementsByTagNameNS(wordNs, 'pStyle')[0]?.getAttributeNS(wordNs, 'val') || '';
      const value = textOf(paragraph);
      return /^(?:heading\s*\d|title|subtitle|标题|章标题)/i.test(style) && value.trim() ? `# ${value}` : value;
    }).join('\n').replace(/\u0000/g, '');
  }
  function readU16(view, offset) {
    if (offset < 0 || offset + 2 > view.byteLength) throw new Error('Word 文档 ZIP 目录不完整。');
    return view.getUint16(offset, true);
  }
  function readU32(view, offset) {
    if (offset < 0 || offset + 4 > view.byteLength) throw new Error('Word 文档 ZIP 目录不完整。');
    return view.getUint32(offset, true);
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  async function extractDocxText(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const start = Math.max(0, bytes.length - 22 - 65535);
    let eocd = -1;
    for (let offset = bytes.length - 22; offset >= start; offset--) {
      if (readU32(view, offset) === 0x06054b50 && offset + 22 + readU16(view, offset + 20) === bytes.length) {
        eocd = offset;
        break;
      }
    }
    if (eocd < 0) throw new Error('不是有效的 .docx 文件，或 ZIP 目录缺失。');
    const disk = readU16(view, eocd + 4);
    const directoryDisk = readU16(view, eocd + 6);
    const diskEntries = readU16(view, eocd + 8);
    const entryCount = readU16(view, eocd + 10);
    const directorySize = readU32(view, eocd + 12);
    const directoryOffset = readU32(view, eocd + 16);
    if (disk || directoryDisk || diskEntries !== entryCount || entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff || directoryOffset + directorySize > eocd) {
      throw new Error('暂不支持分卷或 ZIP64 Word 文档，请另存为标准 .docx。');
    }
    const decoder = new TextDecoder('ascii');
    let cursor = directoryOffset;
    let documentEntry = null;
    for (let index = 0; index < entryCount; index++) {
      if (readU32(view, cursor) !== 0x02014b50) throw new Error('Word 文档 ZIP 文件目录损坏。');
      const flags = readU16(view, cursor + 8);
      const method = readU16(view, cursor + 10);
      const crc = readU32(view, cursor + 16);
      const compressedSize = readU32(view, cursor + 20);
      const uncompressedSize = readU32(view, cursor + 24);
      const nameLength = readU16(view, cursor + 28);
      const extraLength = readU16(view, cursor + 30);
      const commentLength = readU16(view, cursor + 32);
      const localOffset = readU32(view, cursor + 42);
      const end = cursor + 46 + nameLength + extraLength + commentLength;
      if (end > directoryOffset + directorySize) throw new Error('Word 文档 ZIP 文件目录损坏。');
      const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (name === 'word/document.xml') documentEntry = { flags, method, crc, compressedSize, uncompressedSize, localOffset };
      cursor = end;
    }
    if (!documentEntry) throw new Error('这个 .docx 中找不到正文内容。');
    if (documentEntry.flags & 1) throw new Error('不支持加密的 Word 文档，请先解除文档密码后再导入。');
    if (![0, 8].includes(documentEntry.method)) throw new Error('这个 Word 文档使用了不支持的压缩方式。');
    if (documentEntry.uncompressedSize > maxDocxXmlBytes || documentEntry.compressedSize > bytes.length) throw new Error('Word 正文过大，已停止解析。');
    const local = documentEntry.localOffset;
    if (readU32(view, local) !== 0x04034b50) throw new Error('Word 文档正文数据不完整。');
    if (readU16(view, local + 6) !== documentEntry.flags || readU16(view, local + 8) !== documentEntry.method) {
      throw new Error('Word 文档正文头与文件目录不一致。');
    }
    const localNameLength = readU16(view, local + 26);
    const localExtraLength = readU16(view, local + 28);
    const dataStart = local + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + documentEntry.compressedSize;
    if (dataEnd > bytes.length) throw new Error('Word 文档正文数据不完整。');
    if (decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== 'word/document.xml') {
      throw new Error('Word 文档正文名称与文件目录不一致。');
    }
    const compressed = bytes.subarray(dataStart, dataEnd);
    let xmlBytes;
    if (documentEntry.method === 0) xmlBytes = compressed;
    else {
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器缺少本地 Word 解压能力，请升级 Chrome 或 Edge。');
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxDocxXmlBytes) { await reader.cancel(); throw new Error('Word 正文解压后过大，已停止解析。'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      xmlBytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { xmlBytes.set(chunk, offset); offset += chunk.length; }
    }
    if (xmlBytes.length !== documentEntry.uncompressedSize || crc32(xmlBytes) !== documentEntry.crc) throw new Error('Word 正文校验失败，文件可能已损坏。');
    let xml;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(xmlBytes); }
    catch { throw new Error('Word 正文编码无效，无法安全解析。'); }
    return docxXmlToText(xml);
  }
  function plan(parsed, project, selectedEpisodeIndex = 0) {
    if (!parsed?.episodes?.length || !Array.isArray(project?.episodes) || !project.episodes.length) {
      throw new Error('没有可匹配的分集或目标项目。');
    }
    const sourceStart = parsed.episodes.find(item => item.number !== null)?.number ?? selectedEpisodeIndex + 1;
    const items = parsed.episodes.map(item => {
      const targetNumber = item.number === null ? selectedEpisodeIndex + 1 : item.number;
      const targetIndex = targetNumber - 1;
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= maxEpisodeNumber) throw new Error('无法匹配目标集数。');
      const existing = project.episodes[targetIndex];
      const existingStory = typeof existing?.pages?.story === 'string' ? existing.pages.story : '';
      return { ...item, targetNumber, targetIndex, isNew: !existing,
        existingChars: existingStory.length,
        existingTitle: typeof existing?.episodeTitle === 'string' ? existing.episodeTitle : '',
        suggestedAction: existingStory.trim() ? 'keep' : item.empty ? 'keep' : 'replace' };
    });
    return { hasEpisodeHeadings: parsed.hasEpisodeHeadings, preface: parsed.preface || '', sourceStart, items,
      maxTargetIndex: Math.max(...items.map(item => item.targetIndex)), currentEpisodeCount: project.episodes.length };
  }
  function apply(project, importPlan, actions, targetNumbers, includePreface = false) {
    if (!Array.isArray(project?.episodes) || !importPlan?.items?.length || !Array.isArray(actions) || actions.length !== importPlan.items.length) {
      throw new Error('导入预览已失效，请重新选择剧本。');
    }
    const targets = targetNumbers || importPlan.items.map(item => item.targetNumber);
    if (!Array.isArray(targets) || targets.length !== importPlan.items.length || targets.some(number =>
      !Number.isInteger(number) || number < 1 || number > maxEpisodeNumber)) throw new Error('目标集数需在 1–300 集之间。');
    if (new Set(targets).size !== targets.length) throw new Error('有多集剧本指向了同一目标集，请调整匹配后再导入。');
    if (actions.includes('preface') && (!includePreface || !importPlan.preface)) throw new Error('集前说明未选择导入，请重新检查预览选项。');
    const episodes = [...project.episodes];
    const maxTargetIndex = Math.max(...targets) - 1;
    while (episodes.length <= maxTargetIndex) episodes.push({ pages: {}, targetDurationSec: 90, shots: [{}] });
    let changed = 0;
    for (let index = 0; index < importPlan.items.length; index++) {
      const item = importPlan.items[index];
      const action = actions[index] || 'keep';
      if (!['keep', 'replace', 'append', 'title', 'preface'].includes(action)) throw new Error('导入动作无效。');
      if (action === 'keep') continue;
      let episode = episodes[targets[index] - 1];
      const episodeTitle = item.title && !episode.episodeTitle ? item.title : episode.episodeTitle;
      if (action !== 'title') {
        const pages = { ...(episode.pages || {}) };
        const current = typeof pages.story === 'string' ? pages.story : '';
        let text = action === 'preface' && index === 0 ? importPlan.preface : item.text;
        if (includePreface && index === 0 && importPlan.preface && action !== 'preface') text = `${importPlan.preface}\n\n${text}`.trim();
        pages.story = action === 'append' && current.trim() ? `${current.trimEnd()}\n\n${text}` : text;
        episode = { ...episode, pages };
      }
      if (episodeTitle) episode = { ...episode, episodeTitle };
      episodes[targets[index] - 1] = episode;
      changed++;
    }
    if (includePreface && importPlan.preface && ['keep', 'title'].includes(actions[0])) {
      throw new Error('集前说明选择并入首集时，首集不能设为“保留原稿”或“仅补集名”；请改为追加或替换。');
    }
    if (!changed) throw new Error('没有选择要导入的分集。');
    return { ...project, episodes };
  }
  async function readFile(file) {
    if (!(file instanceof Blob) || file.size < 1) throw new Error('请选择有效的剧本文件。');
    if (/\.docx$/i.test(file.name || '')) {
      if (file.size > maxDocxBytes) throw new Error('Word 文件不能超过 20 MiB。');
      return extractDocxText(await file.arrayBuffer());
    }
    if (file.size > maxTextBytes) throw new Error('文本剧本不能超过 5 MiB。');
    if (!/\.(?:txt|md)$/i.test(file.name || '')) throw new Error('当前支持 UTF-8/GB18030 的 .txt、.md 和标准 .docx 剧本。');
    const bytes = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch {
      try { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
      catch { throw new Error('无法识别文件编码，请另存为 UTF-8 文本后重试。'); }
    }
  }
  const api = { parse, plan, apply, readFile, analyzeStructure };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.arcScriptImport = api;
})();
