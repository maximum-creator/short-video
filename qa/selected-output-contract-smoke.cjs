const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { configuration, generationServer } = require('../arc-comfy-server.cjs');
const official = require('../arc-official-workflows.cjs');
const sha = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}` :
    JSON.stringify(value);

async function freePort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-selected-contract-'));
  const port = await freePort();
  const comfyPort = await freePort();
  const oldFetch = global.fetch;
  let promptPosts = 0;
  let submittedGraph;
  let server;
  try {
    global.fetch = async (input, options = {}) => {
      const url = String(input);
      if (url.includes('/object_info/')) {
        const type = decodeURIComponent(url.slice(url.lastIndexOf('/object_info/') + '/object_info/'.length));
        const preset = official.presets(() => null).find(item => item.id === 'minimax-h3-ref2va');
        const node = Object.values(preset.template).find(item => item.class_type === type) ||
          Object.values(official.presets(() => null).find(item => item.id === 'pika-h3-ref2va').template)
            .find(item => item.class_type === type);
        const optional = Object.fromEntries(Object.entries(node?.inputs || {}).map(([field, value]) => {
          const linked = Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';
          const type = linked ? '*' : typeof value === 'number' ? (Number.isInteger(value) ? 'INT' : 'FLOAT') :
            typeof value === 'boolean' ? 'BOOLEAN' : 'STRING';
          return [field, [type, type === 'INT' || type === 'FLOAT' ? { min: -100000, max: Number.MAX_SAFE_INTEGER } : {}]];
        }));
        if (type === 'BasicScheduler') optional.scheduler = ['COMBO', { options: ['beta', 'normal', 'simple'] }];
        return new Response(JSON.stringify({ [type]: { input: { required: {}, optional }, output: Array(8).fill('*') } }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      }
      if (url.endsWith('/upload/image')) return new Response(JSON.stringify({ name: 'fixture.png', subfolder: '' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
      if (url.endsWith('/prompt')) {
        promptPosts++;
        submittedGraph = JSON.parse(options.body).prompt;
        return new Response(JSON.stringify({ prompt_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
      }
      return oldFetch(input);
    };
    const workflow = path.join(temp, 'fixture-workflow.json');
    fs.writeFileSync(workflow, JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }));
    const config = configuration(['--port', String(port), '--comfy-port', String(comfyPort), '--workflow', workflow,
      '--prompt-node', '1', '--test-fixtures', 'local', '--official-presets', 'enabled', '--state', path.join(temp, 'jobs.json')]);
    server = generationServer(config);
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${port}`;
    const profile = await (await oldFetch(`${origin}/api/generation?preset=pika-h3-ref2va`)).json();
    assert.equal(profile.outputContract.width, 768);
    assert.equal(profile.outputContract.height, 1344);
    assert.equal(profile.outputContract.frames, 124);
    const requested = { ...Object.fromEntries(profile.controls.map(group => [group.id, group.defaultId])),
      'diffusion-weight': 'full-int8', framing: 'landscape', duration: 'frames-192', seed: 'seed-20261221' };
    const query = new URLSearchParams({ preset: 'pika-h3-ref2va', controlsProfile: profile.controlsProfile,
      controls: JSON.stringify(requested), promptMode: 'ref2va' });
    const checked = await (await oldFetch(`${origin}/api/generation/preflight?${query}`)).json();
    assert.deepEqual(checked.outputContract, { width: 1344, height: 768, fps: 24, frames: 192 },
      'the API preflight returns the exact non-default frame and canvas contract');
    assert.equal(checked.issues, 0, JSON.stringify(checked.findings.filter(item => item.kind === 'issue')));
    const staleContract = await oldFetch(`${origin}/api/generation?preset=pika-h3-ref2va`, { method: 'POST', headers: {
      origin, 'content-type': 'application/json' }, body: JSON.stringify({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', prompt: 'Fixture prompt only',
      workflowSha256: profile.graphSha256, providerFingerprint: profile.providerFingerprint,
      controlsProfile: profile.controlsProfile, controls: requested, promptMode: 'ref2va', comparison: {},
      outputContract: profile.outputContract
    }) });
    assert.equal(staleContract.status, 409,
      'the server refuses a stale default output contract after a non-default A/B control change');
    assert.match((await staleContract.json()).error, /输出规格/);
    assert.equal(promptPosts, 0, 'the stale-contract rejection occurs before any upstream generation queue call');
    const sharedPrompt = 'One controlled shot: cross the doorway, settle, then look right.';
    const cue = 'Keep the eyes still until the back foot lands.';
    const images = {
      character: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/DgAAAABJRU5ErkJggg==',
      scene: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/DgAAAABJRU5ErkJggg=='
    };
    const selectedIds = profile.controls.map(group => [group.id, requested[group.id]]);
    const basis = sha(JSON.stringify([sharedPrompt, '', [images.character, images.scene, undefined], selectedIds]));
    const preflightFields = { workflowSha256: profile.graphSha256, preflightSchemaSha256: checked.schemaSha256,
      preflightFindingsSha256: sha(canonicalJson(checked.findings)), preflightUnverifiedAcknowledged: true };
    const submitted = await oldFetch(`${origin}/api/generation?preset=pika-h3-ref2va`, { method: 'POST', headers: {
      origin, 'content-type': 'application/json' }, body: JSON.stringify({
      ...preflightFields, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', prompt: sharedPrompt, sharedPrompt,
      providerFingerprint: profile.providerFingerprint, controlsProfile: profile.controlsProfile, controls: requested,
      promptMode: 'ref2va', outputContract: checked.outputContract, images,
      referenceAssetKinds: { character: '角色', scene: '场景' }, variableCue: cue, repair: '',
      comparison: { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', variant: 'A', mode: 'performance', basis,
        cueDigest: sha(cue) }
    }) });
    const submittedBody = await submitted.text();
    assert.equal(submitted.status, 202, submittedBody);
    const accepted = JSON.parse(submittedBody);
    assert.equal(accepted.testFixture, true, 'the generation path is explicitly marked as a local test fixture');
    assert.deepEqual(accepted.outputContract, checked.outputContract);
    assert.equal(promptPosts, 1, 'only the valid, fully bound fixture request enters the mocked local Comfy queue');
    assert.deepEqual([submittedGraph['8'].inputs.width, submittedGraph['8'].inputs.height, submittedGraph['8'].inputs.length],
      [1344, 768, 192], 'the actual submitted API graph carries the non-default output controls');
    assert.equal(submittedGraph['13'].inputs.unet_name, 'minimax_h3_ref2va_int8_convrot.safetensors');
    assert.equal(submittedGraph['16'].inputs.noise_seed, 20261221);

    // Exercise native H3 parameter selection end-to-end through the local bridge and mocked Comfy API.
    const native = await (await oldFetch(`${origin}/api/generation?preset=minimax-h3-ref2va`)).json();
    assert.equal(native.testFixture, true);
    assert.equal(native.controls.find(group => group.id === 'scheduler').defaultId, 'beta');
    const nativeControls = Object.fromEntries(native.controls.map(group => [group.id, group.defaultId]));
    nativeControls.scheduler = 'normal';
    const nativeQuery = new URLSearchParams({ preset: 'minimax-h3-ref2va', controlsProfile: native.controlsProfile,
      controls: JSON.stringify(nativeControls), promptMode: 'ref2va' });
    const nativeCheck = await (await oldFetch(`${origin}/api/generation/preflight?${nativeQuery}`)).json();
    assert.equal(nativeCheck.issues, 0, JSON.stringify(nativeCheck.findings.filter(item => item.kind === 'issue')));
    assert.ok(nativeCheck.unverified > 0, 'the generic local fixture reports uncertain link types instead of claiming provider verification');
    const nativePrompt = 'A tightly framed, still camera shot of a traveler crossing the doorway.';
    const nativeImages = { character: images.character, scene: images.scene };
    const nativeIds = native.controls.map(group => [group.id, nativeControls[group.id]]);
    const nativeBasis = sha(JSON.stringify([nativePrompt, '', [nativeImages.character, nativeImages.scene, undefined], nativeIds]));
    const nativeCue = 'The traveler settles after the back foot lands.';
    const nativeTask = {
      id: '11111111-1111-4111-8111-111111111111', prompt: nativePrompt, sharedPrompt: nativePrompt,
      workflowSha256: native.graphSha256, providerFingerprint: native.providerFingerprint,
      controlsProfile: native.controlsProfile, controls: nativeControls, promptMode: 'ref2va',
      outputContract: nativeCheck.outputContract, images: nativeImages,
      referenceAssetKinds: { character: '角色', scene: '场景' }, variableCue: nativeCue, repair: '',
      preflightSchemaSha256: nativeCheck.schemaSha256, preflightFindingsSha256: sha(canonicalJson(nativeCheck.findings)),
      preflightUnverifiedAcknowledged: true,
      comparison: { id: '22222222-2222-4222-8222-222222222222', variant: 'A', mode: 'performance',
        basis: nativeBasis, cueDigest: sha(nativeCue) }
    };
    const nativeForm = new FormData();
    nativeForm.append('task', JSON.stringify(nativeTask));
    const nativeResponse = await oldFetch(`${origin}/api/generation?preset=minimax-h3-ref2va`, { method: 'POST',
      headers: { origin }, body: nativeForm });
    const nativeBody = await nativeResponse.text();
    assert.equal(nativeResponse.status, 202, nativeBody);
    assert.equal(promptPosts, 2, 'the native H3 fixture queues exactly one additional mocked API prompt');
    assert.equal(submittedGraph['18'].inputs.scheduler, 'normal',
      'the selected native-H3 scheduler reaches the actual submitted Comfy API graph');
    assert.equal(submittedGraph['18'].inputs.steps, 20, 'the validated 20-step baseline remains fixed in submission');
    assert.equal(submittedGraph['17'].inputs.sampler_name, 'res_multistep');
    const wrongMode = new URLSearchParams(query);
    wrongMode.set('promptMode', 'i2va');
    const rejected = await oldFetch(`${origin}/api/generation/preflight?${wrongMode}`);
    assert.equal(rejected.status, 400, 'the settings query cannot bind choices to a different H3 mode');
    const invalid = new URLSearchParams(query);
    invalid.set('controls', JSON.stringify({ ...requested, duration: 'arbitrary-999' }));
    assert.equal((await oldFetch(`${origin}/api/generation/preflight?${invalid}`)).status, 400,
      'the server rejects unsupported frame lengths before any generation request');
    console.log('PASS selected H3 controls reach preflight, A/B lock and actual mocked API graph; stale values fail before queue');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    global.fetch = oldFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
