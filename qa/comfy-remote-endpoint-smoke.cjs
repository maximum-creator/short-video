const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { configuration, generationServer } = require('../arc-comfy-server.cjs');
const { endpoint } = require('../arc-comfy-endpoint.cjs');
const canonicalJson = value => Array.isArray(value) ? `[${value.map(canonicalJson).join(',')}]` :
  value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}` :
    JSON.stringify(value);

async function freePort() {
  const server = require('node:http').createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function main() {
  assert.throws(() => endpoint('http://gpu.example.net', 8765), /HTTPS/,
    'a public remote inference endpoint must use HTTPS');
  assert.throws(() => endpoint('https://user:secret@gpu.example.net', 8765), /凭据/,
    'credentials cannot be embedded in the URL');
  assert.throws(() => endpoint('https://gpu.example.net/?token=secret', 8765), /查询参数/,
    'query strings cannot leak credentials into provider identity or logs');
  assert.throws(() => endpoint('http://127.0.0.1:8765', 8765), /工作台本身/,
    'the bridge cannot recursively proxy to itself');
  const remote = endpoint('https://gpu.example.net/comfy', 8765, 'private-token');
  assert.equal(remote.base, 'https://gpu.example.net/comfy');
  assert.equal(remote.transport, 'https');
  assert.equal(remote.credential, 'private-token');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-remote-provider-'));
  const file = path.join(temp, 'workflow.json');
  fs.writeFileSync(file, JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: { text: 'prompt' } } }));
  const port = await freePort();
  const oldToken = process.env.ARC_COMFY_BEARER_TOKEN;
  const oldFetch = global.fetch;
  const nativeFetch = oldFetch;
  process.env.ARC_COMFY_BEARER_TOKEN = 'private-token';
  const observed = [];
  let bridge;
  let submittedGraph;
  const submittedGraphs = new Map();
  try {
    const config = configuration(['--port', String(port), '--comfy-url', 'https://gpu.example.net/comfy',
      '--workflow', file, '--prompt-node', '1', '--prompt-input', 'text', '--state', path.join(temp, 'jobs.json')]);
    bridge = generationServer(config);
    bridge.listen(port, '127.0.0.1');
    await once(bridge, 'listening');
    const peerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const mismatchPeerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const taskId = '11111111-1111-4111-8111-111111111111';
    const mismatchTaskId = '22222222-2222-4222-8222-222222222222';
    const generatedBytes = Buffer.from('remote-mp4-fixture');
    global.fetch = async (input, options) => {
      const url = String(input);
      if (url.startsWith('https://gpu.example.net/comfy/')) {
        observed.push({ url, authorization: options?.headers?.get?.('Authorization'), redirect: options?.redirect });
        if (url.endsWith('/object_info/CLIPTextEncode')) return new Response(JSON.stringify({ CLIPTextEncode: {
          input: { required: { text: ['STRING', { default: '' }] } }, output: ['CONDITIONING']
        } }), { status: 200, headers: { 'content-type': 'application/json' } });
        if (url.endsWith('/queue')) return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
        if (url.endsWith('/prompt')) {
          const payload = JSON.parse(options.body);
          assert.equal(payload.prompt['1'].inputs.text, 'One controlled shot prompt.');
          submittedGraph = payload.prompt;
          const promptId = payload.client_id === taskId ? peerId : payload.client_id === mismatchTaskId ? mismatchPeerId : null;
          assert.ok(promptId, 'each local generation task receives its own upstream identity');
          if (!submittedGraphs.has(promptId)) submittedGraphs.set(promptId, payload.prompt);
          return new Response(JSON.stringify({ prompt_id: promptId }), {
            status: 200, headers: { 'content-type': 'application/json' }
          });
        }
        if (/\/history\/[a-f0-9-]+$/.test(url)) {
          const promptId = url.split('/').at(-1);
          const historyPrompt = structuredClone(submittedGraphs.get(promptId));
          if (promptId === mismatchPeerId) historyPrompt['1'].inputs.text = 'Provider history prompt changed.';
          return new Response(JSON.stringify({ [promptId]: {
          prompt: [1, promptId, historyPrompt, { create_time: 1000 }],
          status: { status_str: 'success', completed: true, messages: [
            ['execution_start', { prompt_id: promptId, timestamp: 2000 }],
            ['execution_success', { prompt_id: promptId, timestamp: 5000 }]
          ] },
          outputs: { '2': { gifs: [{ filename: 'actual-h3.mp4', subfolder: 'arc-output', type: 'output' }] } }
        } }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/view?')) {
          const range = options?.headers?.get?.('Range');
          if (range === 'bytes=0-3') return new Response(generatedBytes.subarray(0, 4), { status: 206,
            headers: { 'content-range': `bytes 0-3/${generatedBytes.length}`, 'content-length': '4', 'accept-ranges': 'bytes' } });
          return new Response(generatedBytes, { status: 200,
            headers: { 'content-length': String(generatedBytes.length), 'accept-ranges': 'bytes' } });
        }
        throw new Error('Unexpected mocked remote route: ' + url);
      }
      return nativeFetch(input, options);
    };
    const origin = `http://127.0.0.1:${port}`;
    const localFetch = (url, options = {}) => {
      const headers = new Headers(options.headers);
      if (String(url).startsWith(origin)) headers.set('connection', 'close');
      return nativeFetch(url, { ...options, headers });
    };
    const profile = await (await localFetch(origin + '/api/generation')).json();
    assert.equal(profile.connection.transport, 'https');
    assert.equal(profile.connection.host, 'gpu.example.net');
    assert.equal(profile.providerFingerprint.length, 64);
    assert.equal(JSON.stringify(profile).includes('private-token'), false,
      'the local browser profile never receives the bearer token');
    const preflight = await (await localFetch(origin + '/api/generation/preflight')).json();
    const preflightFields = { workflowSha256: preflight.graphSha256,
      preflightSchemaSha256: preflight.schemaSha256,
      preflightFindingsSha256: require('node:crypto').createHash('sha256').update(canonicalJson(preflight.findings)).digest('hex'),
      preflightUnverifiedAcknowledged: preflight.unverified > 0 };
    const status = await localFetch(origin + '/api/generation/connection');
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { transport: 'https', host: 'gpu.example.net', running: 0, queued: 0 });
    const submitted = await localFetch(origin + '/api/generation', { method: 'POST', headers: {
      origin, 'content-type': 'application/json' }, body: JSON.stringify({ ...preflightFields, id: taskId, prompt: 'One controlled shot prompt.' }) });
    assert.equal(submitted.status, 202);
    const queued = await submitted.json();
    assert.equal(queued.status, 'queued');
    assert.equal(queued.testFixture, false, 'a real configured remote provider is distinguished from local fixtures');
    assert.equal(queued.providerFingerprint, profile.providerFingerprint);
    assert.match(queued.workflowDeclaration.evidence, /workflow-declared/);
    assert.equal(queued.workflowDeclaration.loadedWeightsVerified, false,
      'workflow declarations do not claim runtime-loaded model identity');
    assert.match(queued.effectivePromptSha256, /^[a-f0-9]{64}$/);

    await new Promise(resolve => bridge.close(resolve));
    bridge = generationServer(config);
    bridge.listen(port, '127.0.0.1');
    await once(bridge, 'listening');

    const completed = await (await localFetch(origin + '/api/generation/' + taskId)).json();
    assert.equal(completed.status, 'complete');
    assert.equal(completed.testFixture, false);
    assert.deepEqual(completed.executionPromptEvidence, {
      evidence: 'comfy-history-prompt', status: 'matched',
      submittedSha256: require('node:crypto').createHash('sha256').update(canonicalJson(submittedGraph)).digest('hex'),
      historySha256: require('node:crypto').createHash('sha256').update(canonicalJson(submittedGraph)).digest('hex')
    });
    assert.equal(completed.timing.queueMs, 1000);
    assert.equal(completed.timing.executionMs, 3000);
    assert.equal(completed.timing.queueSource, 'comfy-history-timestamps');
    assert.equal(completed.timing.executionSource, 'comfy-history-timestamps');
    assert.equal(completed.timing.bridgeSource, 'local-bridge-observation');
    assert.equal(completed.timing.gpuKernelTime, false,
      'Comfy history wall-clock timings are not GPU-kernel timings');
    assert.equal(completed.outputs.length, 1);
    assert.equal(completed.outputs[0].assetKey,
      require('node:crypto').createHash('sha256').update(JSON.stringify(['actual-h3.mp4', 'arc-output', 'output'])).digest('hex'));
    assert.equal(JSON.stringify(completed).includes('private-token'), false,
      'returned job evidence never contains the upstream credential');

    const badAsset = await localFetch(origin + `/api/generation/${taskId}/video/0?file=actual-h3.mp4&asset=${'0'.repeat(64)}`);
    assert.equal(badAsset.status, 409, 'a mismatched returned-asset key is rejected before reading remote media');
    const identity = await (await localFetch(origin + `/api/generation/${taskId}/video/0/sha256?file=actual-h3.mp4&asset=${completed.outputs[0].assetKey}`)).json();
    assert.equal(identity.jobId, taskId);
    assert.equal(identity.name, 'actual-h3.mp4');
    assert.equal(identity.assetKey, completed.outputs[0].assetKey);
    assert.equal(identity.sha256, require('node:crypto').createHash('sha256').update(generatedBytes).digest('hex'));
    assert.equal(identity.sizeBytes, generatedBytes.length);
    assert.equal(identity.evidence, 'full-upstream-video-bytes-sha256');
    const video = await localFetch(origin + `/api/generation/${taskId}/video/0?file=actual-h3.mp4&asset=${completed.outputs[0].assetKey}`,
      { headers: { range: 'bytes=0-3' } });
    assert.equal(video.status, 206);
    assert.equal(video.headers.get('content-range'), `bytes 0-3/${generatedBytes.length}`);
    assert.deepEqual(Buffer.from(await video.arrayBuffer()), generatedBytes.subarray(0, 4));
    const mismatchSubmitted = await localFetch(origin + '/api/generation', { method: 'POST', headers: {
      origin, 'content-type': 'application/json' }, body: JSON.stringify({ ...preflightFields, id: mismatchTaskId, prompt: 'One controlled shot prompt.' }) });
    assert.equal(mismatchSubmitted.status, 202);
    const mismatchResult = await (await localFetch(origin + '/api/generation/' + mismatchTaskId)).json();
    assert.equal(mismatchResult.status, 'complete');
    assert.equal(mismatchResult.executionPromptEvidence.status, 'mismatch',
      'a provider history prompt that changed after submission is detected even when a video was returned');
    assert.notEqual(mismatchResult.executionPromptEvidence.submittedSha256,
      mismatchResult.executionPromptEvidence.historySha256);
    const savedState = JSON.parse(fs.readFileSync(path.join(temp, 'jobs.json'), 'utf8'));
    assert.ok(savedState.jobs.some(item => item.id === taskId && item.peerId === peerId && item.state === 'queued' &&
      item.providerFingerprint === profile.providerFingerprint && item.workflowDeclaration?.evidence === 'workflow-declared' &&
      item.submittedGraphSha256 === completed.executionPromptEvidence.submittedSha256 &&
      item.executionPromptEvidence?.status === 'matched'),
    'the remote task, peer identity, endpoint, submitted graph hash and matched history evidence survive recovery');
    assert.ok(observed.some(item => item.url.endsWith('/queue')));
    assert.ok(observed.some(item => item.url.endsWith('/prompt')));
    assert.ok(observed.some(item => item.url.endsWith('/history/' + peerId)));
    assert.ok(observed.some(item => item.url.endsWith('/history/' + mismatchPeerId)));
    assert.ok(observed.some(item => item.url.includes('/view?')));
    assert.ok(observed.every(item => item.authorization === 'Bearer private-token' && item.redirect === 'error'),
      'the bridge adds credentials to every server-side HTTPS call and refuses redirects');
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.ARC_COMFY_BEARER_TOKEN;
    else process.env.ARC_COMFY_BEARER_TOKEN = oldToken;
    if (bridge?.listening) await new Promise(resolve => bridge.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('PASS remote HTTPS ComfyUI bridge, server-side bearer handling, endpoint identity and error gates');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
