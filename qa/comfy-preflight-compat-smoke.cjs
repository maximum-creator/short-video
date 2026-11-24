const assert = require('node:assert/strict');
const { inspect } = require('../arc-comfy-preflight.cjs');

const build = (sourceOutput, targetInput) => ({
  template: {
    '1': { class_type: 'FixtureSource', inputs: {} },
    '2': { class_type: 'FixtureSink', inputs: { video: ['1', 0] } }
  },
  prompt: ['2', 'prompt'], references: [], controls: [],
  schemas: {
    FixtureSource: { input: { required: {} }, output: [sourceOutput] },
    FixtureSink: { input: { required: { video: [targetInput] } }, output: [] }
  }
});

const queryFor = fixture => async route => {
  const name = decodeURIComponent(route.slice('/object_info/'.length));
  return { [name]: fixture.schemas[name] };
};

(async () => {
  const mismatch = build('IMAGE', 'VIDEO');
  const bad = await inspect(mismatch, queryFor(mismatch));
  assert.equal(bad.issues, 1);
  assert.match(bad.findings[0].message, /上游 IMAGE → 下游 VIDEO/);
  assert.match(bad.schemaSha256, /^[a-f0-9]{64}$/);

  const exact = build('VIDEO', 'VIDEO');
  const good = await inspect(exact, queryFor(exact));
  assert.equal(good.issues, 0);
  assert.equal(good.unverified, 0);
  assert.equal((await inspect(exact, queryFor(exact))).schemaSha256, good.schemaSha256,
    'schema identity is stable across repeat inspection');
  assert.notEqual(good.schemaSha256, bad.schemaSha256, 'a changed published node type changes the schema-set identity');

  const hostedApi = { template: {
    '1': { class_type: 'MinimaxHailuo03ReferenceNode', inputs: { 'model.prompt': 'night platform' } },
    '2': { class_type: 'SaveVideo', inputs: { video: ['1', 0] } }
  }, prompt: ['1', 'model.prompt'], references: [], controls: [],
  schemas: {
    MinimaxHailuo03ReferenceNode: { input: { required: { 'model.prompt': ['STRING'] } }, output: ['VIDEO'] },
    SaveVideo: { input: { required: { video: ['VIDEO'] } }, output: [] }
  } };
  const apiResult = await inspect(hostedApi, queryFor(hostedApi));
  assert.equal(apiResult.issues, 1, 'hosted MiniMax API nodes are blocked even when their node schemas are valid');
  assert.match(apiResult.findings[0].message, /供应商服务.*按量费用.*不是本地 H3 INT8/);

  const localNative = build('VIDEO', 'VIDEO');
  localNative.template['1'].class_type = 'MiniMaxH3ReferenceToVideo';
  localNative.schemas.MiniMaxH3ReferenceToVideo = localNative.schemas.FixtureSource;
  delete localNative.schemas.FixtureSource;
  const localResult = await inspect(localNative, queryFor(localNative));
  assert.equal(localResult.issues, 0, 'local native H3 conditioning remains eligible for local inference preflight');

  const union = build('IMAGE', ['VIDEO', 'IMAGE']);
  const unionResult = await inspect(union, queryFor(union));
  assert.equal(unionResult.issues, 0);
  assert.equal(unionResult.unverified, 0);

  const wildcard = build('*', 'VIDEO');
  const uncertain = await inspect(wildcard, queryFor(wildcard));
  assert.equal(uncertain.issues, 0);
  assert.equal(uncertain.unverified, 1, 'wildcard types remain unknown, never a false pass');

  console.log('PASS ComfyUI connection preflight catches provable type mismatches and preserves unknown types');
})().catch(error => { console.error(error); process.exitCode = 1; });
