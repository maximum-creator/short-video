const assert = require('node:assert/strict');
const importer = require('../production-script-import.js');

const project = {
  series: { title: 'Demo', look: 'keep' },
  assets: [{ id: 'A01', kind: '角色', name: 'M', revision: 'v1', notes: '', image: '' }],
  episodes: [
    { episodeTitle: '旧名', pages: { story: '已有第一集', dialogue: '对白保留', state: '状态保留' }, shots: [{ version: 'S01' }] },
    { pages: { story: '', rules: '规则保留' }, shots: [{ version: 'S02' }] }
  ]
};

const parsed = importer.parse('剧名：夜站\n\n第01集：夜归\n角色A走进场景。\n\nEP 2: 门后\n她停步回头。');
assert.equal(parsed.episodes.length, 2);
assert.equal(parsed.episodes[0].number, 1);
assert.equal(parsed.episodes[0].title, '夜归');
assert.equal(parsed.preface, '剧名：夜站', 'preamble must be kept separate so it cannot silently pollute episode one');
assert.equal(parsed.episodes[0].text, '角色A走进场景。');
assert.equal(parsed.episodes[1].number, 2);

const plan = importer.plan(parsed, project, 0);
assert.equal(plan.items[0].targetIndex, 0);
assert.equal(plan.items[0].suggestedAction, 'keep', 'existing script should be protected by default');
assert.equal(plan.items[1].targetIndex, 1);
assert.equal(plan.items[1].suggestedAction, 'replace');
const next = importer.apply(project, plan, ['replace', 'replace']);
assert.equal(next.episodes[0].pages.story, parsed.episodes[0].text);
assert.equal(next.episodes[0].pages.dialogue, '对白保留');
assert.equal(next.episodes[0].pages.state, '状态保留');
assert.equal(next.episodes[0].episodeTitle, '旧名', 'existing episode title must not be replaced');
assert.equal(next.episodes[0].shots[0].version, 'S01');
assert.equal(next.episodes[1].pages.story, '她停步回头。');
assert.equal(next.episodes[1].pages.rules, '规则保留');
const withPreface = importer.apply(project, plan, ['replace', 'keep'], [1, 2], true);
assert.equal(withPreface.episodes[0].pages.story, '剧名：夜站\n\n角色A走进场景。');
assert.throws(() => importer.apply(project, plan, ['keep', 'replace'], [1, 2], true), /集前说明选择并入首集时/);
assert.equal(project.episodes[0].pages.story, '已有第一集', 'import must not mutate the original project');
assert.equal(next.assets, project.assets);
assert.equal(next.series, project.series);

const unnumbered = importer.plan(importer.parse('一段没有集数标题的完整剧本。'), project, 1);
assert.equal(unnumbered.items[0].targetIndex, 1, 'an unnumbered script follows the currently selected episode');
assert.throws(() => importer.parse('第1集\n正文\n第01集\n重复编号'), /重复出现第 1 集/);
assert.throws(() => importer.apply(project, unnumbered, ['keep']), /没有选择要导入的分集/);

const future = importer.plan(importer.parse('第4集 终章\n最后一幕。'), project, 0);
const extended = importer.apply(project, future, ['replace']);
assert.equal(extended.episodes.length, 4);
assert.deepEqual(extended.episodes[2], { pages: {}, targetDurationSec: 90, shots: [{}] });
assert.equal(extended.episodes[3].episodeTitle, '终章');
assert.equal(extended.episodes[3].pages.story, '最后一幕。');

const remapped = importer.apply(project, importer.plan(importer.parse('第11集 起\n第十一集正文\n第12集 续\n第十二集正文'), project),
  ['replace', 'replace'], [1, 2]);
assert.equal(remapped.episodes[0].pages.story, '第十一集正文');
assert.equal(remapped.episodes[1].pages.story, '第十二集正文');
assert.throws(() => importer.apply(project, plan, ['replace', 'replace'], [2, 2]), /指向了同一目标集/);

const blank = importer.parse('第1集：空集\n\n第2集：正文\n第二集内容。');
assert.equal(blank.episodes.length, 2, 'empty headed episodes must remain visible in preview');
assert.equal(blank.episodes[0].empty, true);
assert.equal(blank.episodes[1].text, '第二集内容。');
const titleOnly = importer.apply({ ...project, episodes: [{ pages: {}, shots: [{}] }, project.episodes[1]] },
  importer.plan(blank, { ...project, episodes: [{ pages: {}, shots: [{}] }, project.episodes[1]] }), ['title', 'replace']);
assert.equal(titleOnly.episodes[0].episodeTitle, '空集');
assert.equal(titleOnly.episodes[0].pages.story, undefined, 'title-only import must not create or alter story text');

const prefaceOnly = importer.apply({ ...project, episodes: [{ pages: {}, shots: [{}] }, project.episodes[1]] },
  importer.plan(importer.parse('全剧说明\n\n第1集：空集\n\n第2集：正文\n第二集内容。'),
    { ...project, episodes: [{ pages: {}, shots: [{}] }, project.episodes[1]] }), ['preface', 'keep'], [1, 2], true);
assert.equal(prefaceOnly.episodes[0].pages.story, '全剧说明', 'explicit preface-only choice must preserve the preface without inventing episode text');
assert.throws(() => importer.apply(project, plan, ['replace', 'replace'], [1, 1]), /指向了同一目标集/);

const structure = importer.analyzeStructure([
  '第1场：夜 / 外 场景',
  '角色A走进场景。',
  '角色A（低声）：你怎么来了？',
  '【沈砚】',
  '“我一直在等你。”',
  '她退后一步。'
].join('\n'));
assert.equal(structure.scenes.length, 1);
assert.equal(structure.dialogue.length, 1);
assert.equal(structure.dialogue[0].speaker, '角色A（低声）');
assert.equal(structure.dialogueCandidates.length, 1, 'standalone character cues should remain review-only');
assert.deepEqual(structure.unclassified.map(item => item.text), ['角色A走进场景。', '她退后一步。'],
  'unclassified action prose should be visible but never moved automatically');
assert.throws(() => importer.analyzeStructure('x'.repeat(500_001)), /超过 50 万字/);

const appended = importer.apply(project, importer.plan(importer.parse('第1集\n新增一段。'), project, 0), ['append']);
assert.equal(appended.episodes[0].pages.story, '已有第一集\n\n新增一段。');
console.log('PASS screenplay episode parsing, number matching, safe preview actions, preserve-only project updates and sparse episode creation');
