#!/usr/bin/env node
// Runs only a local fake service and a separate headless Chromium profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const tempParent = resolve(tmpdir());
const temporary = await mkdtemp(join(tempParent, 'teal-api-browser-'));
assert.ok(temporary.startsWith(tempParent + sep));
const extension = join(temporary, 'extension');
let browser;
let child;
let scenario = 'success';
let releaseStopResponse;
const uploads = new Map();
const rows = [];
const events = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
let origin;
const html = `<!doctype html><meta charset="utf-8"><title>TAB-TEST - local upload check</title>
<main><label>Question <textarea id="question">Keep this question.</textarea></label>
<section id="answer-table"><input id="answer" value="Keep this answer field.">
<input id="json-decoy" type="file" accept=".json"></section>
<section id="staged"><div><strong>Staged files</strong><button id="add">Add file</button><input id="native" type="file"></div>
<div id="rows">No staged files.</div></section></main>
<script>
window.nativeChanges=0;window.jsonChanges=0;
document.querySelector('#json-decoy').onchange=()=>window.jsonChanges++;
document.querySelector('#add').onclick=()=>document.querySelector('#native').click();
function render(rows){const body=document.querySelector('#rows');body.textContent='';const table=document.createElement('table');const tbody=document.createElement('tbody');table.append(tbody);for(const row of rows){const tr=document.createElement('tr');for(const val of [row.filename,row.byte_size+' B']){const td=document.createElement('td');td.textContent=val;tr.append(td);}const td=document.createElement('td');const s=document.createElement('span');s.title=row.sha256;s.textContent=row.sha256.slice(0,8);td.append(s);tr.append(td);const actions=document.createElement('td');actions.innerHTML='<button>download</button><button>remove</button>';tr.append(actions);tbody.append(tr);}body.append(table);}
document.querySelector('#native').onchange=async(event)=>{window.nativeChanges++;const file=event.target.files[0];const add=document.querySelector('#add');add.textContent='Uploading…';add.disabled=true;const type=file.type||'application/octet-stream';const p=await(await fetch('/api/storage/staged-upload-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({issue_identifier:'TAB-TEST',filename:file.name,content_type:type})})).json();await fetch(p.upload_url,{method:'PUT',headers:{'Content-Type':type},credentials:'omit',body:file});await fetch('/api/staged-files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({issue_identifier:'TAB-TEST',filename:file.name,storage_key:p.storage_key,content_type:type})});render((await(await fetch('/api/staged-files?issue_identifier=TAB-TEST')).json()).rows);event.target.value='';add.textContent='Add file';add.disabled=false;};
</script>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin || 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/issue/TAB-TEST') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'teal_fixture_session=local; SameSite=Strict; Path=/' });
      response.end(html); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/staged-files') {
      assert.equal(url.searchParams.get('issue_identifier'), 'TAB-TEST');
      json(response, 200, { rows }); return;
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const pieces = [];
    for await (const chunk of request) pieces.push(chunk);
    const bytes = Buffer.concat(pieces);
    if (request.method === 'POST' && url.pathname === '/api/storage/staged-upload-url') {
      assert.match(request.headers.cookie || '', /teal_fixture_session=local/);
      const body = JSON.parse(bytes);
      assert.equal(body.issue_identifier, 'TAB-TEST');
      events.push({ step: 'prepare', filename: body.filename });
      if (scenario === 'auth') { json(response, 403, { error: 'fixture denied' }); return; }
      const key = `TAB-TEST/${randomUUID()}/${body.filename}`;
      uploads.set(key, { filename: body.filename, content_type: body.content_type });
      json(response, 200, { upload_url: `${origin}/mock-upload/${key.split('/').map(encodeURIComponent).join('/')}`, storage_key: key, bucket: 'test-bucket', region: 'us-east-1' }); return;
    }
    if (request.method === 'PUT' && url.pathname.startsWith('/mock-upload/')) {
      assert.equal(request.headers.cookie, undefined, 'storage PUT must omit cookies');
      const key = decodeURIComponent(url.pathname.slice('/mock-upload/'.length));
      const file = uploads.get(key);
      assert.ok(file);
      assert.equal(request.headers['content-type'], file.content_type);
      file.bytes = bytes;
      events.push({ step: 'put', filename: file.filename });
      response.writeHead(200, { etag: 'fixture' }); response.end(); return;
    }
    if (request.method === 'POST' && url.pathname === '/api/staged-files') {
      assert.match(request.headers.cookie || '', /teal_fixture_session=local/);
      const body = JSON.parse(bytes);
      assert.equal(body.issue_identifier, 'TAB-TEST');
      const file = uploads.get(body.storage_key);
      assert.ok(file?.bytes);
      assert.equal(body.filename, file.filename);
      const row = { id: randomUUID(), issue_identifier: 'TAB-TEST', filename: body.filename,
        storage_key: body.storage_key, content_type: body.content_type, byte_size: file.bytes.length,
        sha256: scenario === 'bad-hash' ? '0'.repeat(64) : digest(file.bytes), linear_comment_id: randomUUID() };
      rows.push(row); events.push({ step: 'register', filename: file.filename });
      if (scenario === 'stop' && file.filename === 'stop-first.txt') {
        await new Promise(resolveResponse => { releaseStopResponse = resolveResponse; });
      }
      if (scenario === 'reset-register') { request.socket.destroy(); return; }
      if (scenario === 'lost-register') {
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
        response.flushHeaders(); response.write('{');
        setTimeout(() => response.destroy(), 20); return;
      }
      json(response, 200, { row }); return;
    }
    json(response, 404, { error: 'unknown fixture path' });
  } catch (error) {
    events.push({ step: 'fixture-error', error: error.message });
    json(response, 500, { error: 'fixture contract failure' });
  }
});

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function runCli(args) {
  const cli = spawn(process.execPath, [join(extension, 'teal-eval-bulk-cli.mjs'), '--cdp', endpoint,
    '--issue', 'TAB-TEST', '--state', join(temporary, 'tokens.json'), ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary } });
  let stdout = '', stderr = '';
  cli.stdout.on('data', b => { stdout += b; });
  cli.stderr.on('data', b => { stderr += b; });
  const timer = setTimeout(() => cli.kill(), 60000);
  try {
    const code = await new Promise((resolveExit, reject) => { cli.once('error', reject); cli.once('exit', resolveExit); });
    const lines = stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 1, stderr || stdout);
    return { code, ...JSON.parse(lines[0]), stderr };
  } finally { clearTimeout(timer); }
}
let endpoint;
async function uploadPlan(file) {
  const plan = await runCli(['--upload-mode', 'api', 'plan-upload', file]);
  assert.equal(plan.code, 0, plan.stderr);
  assert.equal(plan.uploadMode, 'api');
  return plan;
}
try {
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  await cp(join(root, 'extension'), extension, { recursive: true });
  for (const file of await readdir(extension)) {
    if (!/\.(?:m?js|json)$/.test(file)) continue;
    const name = join(extension, file);
    const source = await readFile(name, 'utf8');
    // Only copied fixture code permits the ephemeral port. Production stays unchanged.
    await writeFile(name, source.replaceAll('8769', String(port)));
  }
  const manifestPath = join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = [`${origin}/*`];
  manifest.content_scripts.forEach(entry => { entry.matches = [`${origin}/issue/*`]; });
  await writeFile(manifestPath, JSON.stringify(manifest));
  const probe = createServer();
  await new Promise(resolveListen => probe.listen(0, '127.0.0.1', resolveListen));
  const debugPort = probe.address().port;
  await new Promise(resolveClose => probe.close(resolveClose));
  endpoint = `http://127.0.0.1:${debugPort}`;
  child = spawn(process.env.PLAYWRIGHT_CHROMIUM_PATH || chromium.executablePath(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-sandbox',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1',
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(temporary, 'profile')}`, `${origin}/issue/TAB-TEST`,
  ], { windowsHide: true, stdio: 'ignore' });
  const start = Date.now();
  while (true) {
    try { const r = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }); if (r.ok) break; } catch {}
    if (Date.now() - start > 20000) throw new Error('Local Chromium startup timed out');
    await sleep(100);
  }
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages().find(p => p.url() === `${origin}/issue/TAB-TEST`);
  assert.ok(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.locator('#teal-eval-bulk-files-v1-button').waitFor({ state: 'attached' });
  await page.locator('#teal-eval-bulk-files-v1-button').click();
  const dom = await browser.contexts()[0].newCDPSession(page);
  await dom.send('DOM.enable');
  const nodes = (await dom.send('DOM.getFlattenedDocument', { depth: -1, pierce: true })).nodes;
  const selectNode = nodes.find(node => node.nodeName === 'SELECT' && node.attributes?.includes('upload-method'));
  assert.ok(selectNode, 'the human upload method selector must be present');
  const selectObject = await dom.send('DOM.resolveNode', { backendNodeId: selectNode.backendNodeId });
  const changed = await dom.send('Runtime.callFunctionOn', { objectId: selectObject.object.objectId,
    functionDeclaration: "function(){this.value='api';this.dispatchEvent(new Event('change',{bubbles:true}));return this.value;}", returnByValue: true });
  assert.equal(changed.result.value, 'api');
  if (process.env.TEAL_API_SCREENSHOT) await page.screenshot({ path: process.env.TEAL_API_SCREENSHOT });
  const closeNode = nodes.find(node => node.nodeName === 'BUTTON' && node.attributes?.includes('close'));
  assert.ok(closeNode);
  const closeObject = await dom.send('DOM.resolveNode', { backendNodeId: closeNode.backendNodeId });
  await dom.send('Runtime.callFunctionOn', { objectId: closeObject.object.objectId, functionDeclaration: 'function(){this.click();}' });
  await dom.detach();
  const nativeFile = join(temporary, 'native.txt');
  await writeFile(nativeFile, 'native still works\n');
  const nativePlan = await runCli(['plan-upload', nativeFile]);
  assert.equal(nativePlan.code, 0, nativePlan.stderr);
  const nativeApply = await runCli(['apply-upload', nativePlan.token]);
  assert.equal(nativeApply.code, 0, JSON.stringify(nativeApply));
  assert.equal(await page.evaluate(() => window.nativeChanges), 1);
  rows.length = 0; events.length = 0;
  // API upload must not require the staged table or its file input.
  await page.evaluate(() => document.querySelector('#staged').remove());
  const files = [];
  for (const [name, data] of [['example.pdf', '%PDF-fixture\n'], ['example.xlsx', 'PK\x03\x04fixture'], ['example.eml', 'Subject: fixture\r\n\r\nbody']]) {
    const path = join(temporary, name); await writeFile(path, data); files.push(path);
  }
  const plan = await runCli(['--upload-mode', 'api', 'plan-upload', ...files]);
  assert.equal(plan.code, 0, plan.stderr);
  assert.equal(events.length, 0, 'planning must not prepare/PUT/register');
  const wrongMode = await runCli(['--upload-mode', 'native', 'apply-upload', plan.token]);
  assert.notEqual(wrongMode.code, 0);
  assert.equal(events.length, 0, 'mode mismatch must not mutate');
  const applied = await runCli(['apply-upload', plan.token]);
  assert.equal(applied.code, 0, JSON.stringify(applied));
  assert.equal(applied.uploadMode, 'api');
  assert.equal(applied.succeeded.length, 3);
  assert.equal(events.filter(e => e.step === 'register').length, 3);
  assert.equal(rows.length, 3);
  for (const path of files) {
    const bytes = await readFile(path);
    const matches = rows.filter(r => r.filename === path.split(/[\\/]/).at(-1));
    assert.equal(matches.length, 1); assert.equal(matches[0].sha256, digest(bytes));
    assert.equal(matches[0].byte_size, bytes.length);
  }
  const verified = await runCli(['--upload-mode', 'api', 'verify', ...files]);
  assert.equal(verified.code, 0, verified.stderr);
  const duplicate = await runCli(['--upload-mode', 'api', 'plan-upload', ...files]);
  assert.equal(duplicate.code, 0, duplicate.stderr);
  assert.deepEqual(duplicate.actionableNames, []); assert.equal(duplicate.skipped.length, 3);
  const beforeReplay = events.length;
  const replay = await runCli(['apply-upload', plan.token]);
  assert.notEqual(replay.code, 0); assert.equal(events.length, beforeReplay);

  scenario = 'lost-register';
  const lostFile = join(temporary, 'lost-response.txt'); await writeFile(lostFile, 'one registration only');
  const lostPlan = await uploadPlan(lostFile);
  const lost = await runCli(['apply-upload', lostPlan.token]);
  assert.ok(lost.code === 0 || (lost.code === 4 && lost.indeterminate === true), lost.stderr);
  assert.equal(events.filter(e => e.step === 'register' && e.filename === 'lost-response.txt').length, 1);
  assert.equal(rows.filter(r => r.filename === 'lost-response.txt').length, 1);
  scenario = 'reset-register';
  const resetFile = join(temporary, 'reset-response.txt'); await writeFile(resetFile, 'transport may replay before headers');
  const resetPlan = await uploadPlan(resetFile);
  const reset = await runCli(['apply-upload', resetPlan.token]);
  const resetRows = rows.filter(r => r.filename === 'reset-response.txt').length;
  assert.ok(resetRows >= 1);
  if (resetRows > 1) { assert.equal(reset.code, 4); assert.equal(reset.indeterminate, true); }
  else assert.ok(reset.code === 0 || (reset.code === 4 && reset.indeterminate === true));
  const resetRegistrations = events.filter(e => e.step === 'register' && e.filename === 'reset-response.txt').length;
  const resetReplay = await runCli(['apply-upload', resetPlan.token]);
  assert.notEqual(resetReplay.code, 0);
  assert.equal(events.filter(e => e.step === 'register' && e.filename === 'reset-response.txt').length, resetRegistrations);
  scenario = 'bad-hash';
  const badFile = join(temporary, 'bad-hash.txt'); await writeFile(badFile, 'correct local bytes');
  const badPlan = await uploadPlan(badFile);
  const bad = await runCli(['apply-upload', badPlan.token]);
  assert.equal(bad.code, 4); assert.notEqual(bad.ok, true);
  assert.equal(events.filter(e => e.step === 'register' && e.filename === 'bad-hash.txt').length, 1);
  scenario = 'auth';
  const authFile = join(temporary, 'auth.txt'); await writeFile(authFile, 'no write when denied');
  const authPlan = await uploadPlan(authFile);
  const auth = await runCli(['apply-upload', authPlan.token]);
  assert.equal(auth.code, 4);
  assert.equal(events.filter(e => ['put', 'register'].includes(e.step) && e.filename === 'auth.txt').length, 0);
  scenario = 'stop';
  const firstStop = join(temporary, 'stop-first.txt'), secondStop = join(temporary, 'stop-second.txt');
  await writeFile(firstStop, 'complete current'); await writeFile(secondStop, 'do not start');
  const stopPlan = await runCli(['--upload-mode', 'api', 'plan-upload', firstStop, secondStop]);
  assert.equal(stopPlan.code, 0, JSON.stringify(stopPlan));
  const pendingApply = runCli(['apply-upload', stopPlan.token]);
  const stopDeadline = Date.now() + 30000;
  while (!releaseStopResponse && Date.now() < stopDeadline) await sleep(50);
  assert.ok(releaseStopResponse, 'the first file must reach registration');
  try {
    const stopped = await runCli(['stop']);
    assert.equal(stopped.code, 0, JSON.stringify(stopped));
  } finally { releaseStopResponse(); }
  const stopResult = await pendingApply;
  assert.equal(stopResult.code, 4, JSON.stringify(stopResult));
  assert.equal(stopResult.stopped, true); assert.equal(stopResult.uploadSelectionReleased, true);
  assert.notEqual(stopResult.indeterminate, true);
  assert.deepEqual(stopResult.succeeded, ['stop-first.txt']);
  assert.deepEqual(stopResult.remaining, ['stop-second.txt']);
  assert.equal(events.filter(e => e.filename === 'stop-second.txt').length, 0);
  const protectedState = await page.evaluate(() => ({ question: document.querySelector('#question').value,
    answer: document.querySelector('#answer').value, jsonChanges: window.jsonChanges, nativeChanges: window.nativeChanges }));
  assert.deepEqual(protectedState, { question: 'Keep this question.', answer: 'Keep this answer field.', jsonChanges: 0, nativeChanges: 1 });
  assert.deepEqual(events.filter(e => e.step === 'fixture-error'), []);
  console.log(JSON.stringify({ ok: true, temporaryBrowser: true, humanModeSelectorPresent: true,
    nativeCliIgnoresApiUiChoice: true, nativeUploadPassed: true, apiBatch: 3,
    noNativePanelRequired: true, modeBoundToToken: true, duplicateSkips: 3, noReplay: true,
    lostBodyReconciled: true, preHeaderResetRows: resetRows, resetTokenNotReplayed: true,
    stopAfterCurrentPassed: true,
    hashMismatchRejected: true, authFailureStopped: true, protectedStateUnchanged: true }));
} finally {
  if (releaseStopResponse) releaseStopResponse();
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) {
    const exit = new Promise(resolveExit => child.once('exit', resolveExit)); child.kill();
    await Promise.race([exit, sleep(3000)]);
  }
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
  assert.ok(resolve(temporary).startsWith(tempParent + sep));
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
