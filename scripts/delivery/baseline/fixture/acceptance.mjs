import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, lstat, readdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url));
const sourceFiles = ['server.mjs', 'index.html', 'client.js', 'smoke.mjs'];
const sha256 = data => createHash('sha256').update(data).digest('hex');

export async function candidateDigest(directory) {
  const root = resolve(directory);
  const rows = [];
  for (const name of sourceFiles) {
    const path = join(root, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`invalid candidate file: ${name}`);
    const body = await readFile(path);
    rows.push(`${name}\0${sha256(body)}`);
  }
  const names = await readdir(root);
  if (names.some(name => !sourceFiles.includes(name))) throw new Error('candidate contains protected or unexpected files');
  return sha256(rows.join('\n'));
}

export const CANARY_WORKSPACE_FILES = Object.freeze(['nonce.txt', 'marker.txt']);

export async function canaryDigest(directory) {
  const root = resolve(directory);
  const names = await readdir(root);
  for (const name of names) {
    if (!CANARY_WORKSPACE_FILES.includes(name)) throw new Error(`canary workspace contains unexpected file: ${name}`);
  }
  if (!names.includes('nonce.txt')) throw new Error('canary workspace is missing nonce.txt');
  const rows = [];
  for (const name of CANARY_WORKSPACE_FILES) {
    if (!names.includes(name)) continue;
    const path = join(root, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`invalid canary file: ${name}`);
    const body = await readFile(path);
    rows.push(`${name}\0${sha256(body)}`);
  }
  return sha256(rows.join('\n'));
}

async function startServer(directory, databasePath, fault) {
  const child = spawn(process.execPath, [join(directory, 'server.mjs'), '--database', databasePath, '--fault', fault], {
    cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2048); });
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000);
    let text = '';
    child.stdout.on('data', chunk => {
      text += chunk.toString();
      const line = text.split('\n')[0];
      if (!line.endsWith('}')) return;
      try { clearTimeout(timer); resolveUrl(JSON.parse(line).url); }
      catch { /* wait for a complete line */ }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
  }).catch(error => { child.kill(); throw error; });
  return { child, url, async stop() {
    if (child.exitCode !== null) return;
    const done = new Promise(resolveDone => child.once('exit', resolveDone));
    child.kill('SIGTERM');
    await Promise.race([done, new Promise(resolveDone => setTimeout(resolveDone, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  } };
}
async function json(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
function check(condition, message, results) { results.push({ check: message, pass: Boolean(condition) }); }

export async function verifyCandidate({ candidateDir, fault = 'NONE', browser = true, screenshotPath }) {
  const expected = await candidateDigest(candidateDir);
  const verifier = await mkdtemp(join(tmpdir(), 'baseline-verify-'));
  const copy = join(verifier, 'candidate');
  const results = [];
  let serverProcess;
  try {
    await cp(candidateDir, copy, { recursive: true, force: false, errorOnExist: true });
    if (await candidateDigest(copy) !== expected) throw new Error('candidate changed during copy');
    for (const name of ['server.mjs', 'client.js', 'smoke.mjs']) {
      const checked = spawnSync(process.execPath, ['--check', join(copy, name)], { encoding: 'utf8', timeout: 10000, maxBuffer: 8192 });
      if (checked.error) throw checked.error;
      check(checked.status === 0, `candidate JavaScript parses: ${name}`, results);
    }
    if (results.some(result => !result.pass))
      return { schemaVersion: 1, status: 'REJECTED', candidateDigest: expected, checks: results, failureClass: 'CANDIDATE_SYNTAX' };
    const databasePath = join(verifier, 'requests.sqlite');
    serverProcess = await startServer(copy, databasePath, fault);
    const base = serverProcess.url;
    const created = await json(`${base}/requests`, 'POST', { title: '  Valid title  ', description: 'A description' });
    check(created.status === 201 && created.body.title === 'Valid title' && created.body.status === 'OPEN', 'create and normalize valid title', results);
    const id = created.body.id;
    const exact120 = await json(`${base}/requests`, 'POST', { title: '😀'.repeat(120) });
    check(exact120.status === 201 && [...exact120.body.title].length === 120, 'accept 120 Unicode code points', results);
    const tooLong = await json(`${base}/requests`, 'POST', { title: '😀'.repeat(121) });
    check(tooLong.status === 400 && tooLong.body.error?.field === 'title', 'reject 121 Unicode code points', results);
    const longDescription = await json(`${base}/requests`, 'POST', { title: 'Description boundary', description: 'x'.repeat(2001) });
    check(longDescription.status === 400 && longDescription.body.error?.field === 'description', 'reject description over 2000 code points without insert', results);
    const afterLongDescription = await json(`${base}/requests`);
    check(!afterLongDescription.body.some(row => row.title === 'Description boundary'), 'overlong description does not insert a row', results);
    for (const title of ['', '   ']) {
      const rejected = await json(`${base}/requests`, 'POST', { title });
      check(rejected.status === 400 && rejected.body.error?.field === 'title', `reject blank title ${JSON.stringify(title)}`, results);
    }
    const updated = await json(`${base}/requests/${id}`, 'PATCH', { title: ' Updated ', status: 'CLOSED' });
    check(updated.status === 200 && updated.body.title === 'Updated' && updated.body.status === 'CLOSED', 'update title and status', results);
    const invalidStatus = await json(`${base}/requests/${id}`, 'PATCH', { title: 'Must not persist', status: 'INVALID' });
    const afterInvalid = await json(`${base}/requests`);
    const current = afterInvalid.body.find(row => row.id === id);
    check(invalidStatus.status === 400 && current?.title === 'Updated' && current?.status === 'CLOSED', 'invalid status has no partial mutation', results);
    const invalidTitle = await json(`${base}/requests/${id}`, 'PATCH', { title: '😀'.repeat(121) });
    const invalidDescription = await json(`${base}/requests/${id}`, 'PATCH', { description: 'x'.repeat(2001) });
    const afterBoundaries = await json(`${base}/requests`);
    const boundaryCurrent = afterBoundaries.body.find(row => row.id === id);
    check(invalidTitle.status === 400 && invalidTitle.body.error?.field === 'title' && invalidDescription.status === 400 && invalidDescription.body.error?.field === 'description' && boundaryCurrent?.title === 'Updated' && boundaryCurrent?.description === 'A description', 'invalid title and description patches have no partial mutation', results);
    const emptyPatch = await json(`${base}/requests/${id}`, 'PATCH', {});
    const illegalPatch = await json(`${base}/requests/${id}`, 'PATCH', { title: 'Safe', unexpected: true });
    check(emptyPatch.status === 400 && illegalPatch.status === 400, 'empty and illegal patches are rejected', results);
    const unknown = await json(`${base}/requests/999999`, 'PATCH', { title: 'Missing' });
    check(unknown.status === 404, 'unknown id returns 404', results);
    check(afterInvalid.body.every((row, index, rows) => index === 0 || rows[index - 1].id < row.id), 'list ordered by ascending id', results);
    const hostile = await json(`${base}/requests`, 'POST', { title: '<img src=x onerror=alert(1)>' });
    check(hostile.status === 201, 'store literal HTML text', results);
    if (browser) {
      const { chromium } = await import('playwright');
      const browserProcess = await chromium.launch({ headless: true });
      try {
        const page = await browserProcess.newPage();
        await page.goto(base);
        await page.getByRole('list', { name: 'Requests' }).getByRole('listitem').first().waitFor();
        check(await page.getByLabel(`Title ${id}`).inputValue() === 'Updated', 'browser shows persisted update', results);
        check(await page.locator('img').count() === 0, 'browser renders hostile title as text', results);
        await page.getByLabel('Title', { exact: true }).fill('Created in browser');
        await page.getByRole('button', { name: 'Create request' }).click();
        const browserRows = await json(`${base}/requests`);
        const browserCreated = browserRows.body.find(row => row.title === 'Created in browser');
        check(Boolean(browserCreated), 'browser creates a request through API', results);
        if (browserCreated) {
          await page.getByLabel(`Status ${browserCreated.id}`).waitFor();
          await page.getByLabel(`Status ${browserCreated.id}`).selectOption('CLOSED');
          await page.getByRole('listitem').filter({ has: page.getByLabel(`Title ${browserCreated.id}`) }).getByRole('button', { name: 'Save' }).click();
          const browserUpdated = await json(`${base}/requests`);
          check(browserUpdated.body.find(row => row.id === browserCreated.id)?.status === 'CLOSED', 'browser updates status through API', results);
        }
        await page.getByLabel('Title', { exact: true }).fill('Keyboard created');
        await page.getByRole('button', { name: 'Create request' }).focus();
        await page.keyboard.press('Enter');
        check(Boolean((await json(`${base}/requests`)).body.find(row => row.title === 'Keyboard created')), 'keyboard reaches and activates create control', results);
        await page.getByLabel('Title', { exact: true }).fill('   ');
        await page.getByRole('button', { name: 'Create request' }).click();
        check((await page.getByRole('alert').textContent() ?? '').includes('Title'), 'browser shows title validation error', results);
        if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
        await page.reload();
        check(await page.getByLabel(`Title ${id}`).inputValue() === 'Updated', 'browser reload preserves edited row', results);
      } finally { await browserProcess.close(); }
    }
    const beforeRestart = await json(`${base}/requests`);
    await serverProcess.stop(); serverProcess = null;
    serverProcess = await startServer(copy, databasePath, fault);
    const reopened = await json(`${serverProcess.url}/requests`);
    check(JSON.stringify(reopened.body) === JSON.stringify(beforeRestart.body), 'same database persists across restart', results);
    check(reopened.body.every((row, index, rows) => index === 0 || rows[index - 1].id < row.id), 'restart preserves ascending order', results);
    const after = await candidateDigest(copy);
    const originalAfter = await candidateDigest(candidateDir);
    if (after !== expected || originalAfter !== expected) throw new Error('candidate tree drift during verification');
    return { schemaVersion: 1, status: results.every(result => result.pass) ? 'ACCEPTED' : 'REJECTED', candidateDigest: expected, checks: results };
  } catch (error) {
    return { schemaVersion: 1, status: 'INCONCLUSIVE', candidateDigest: expected, checks: results, infrastructureError: error.message };
  } finally {
    if (serverProcess) await serverProcess.stop();
    await rm(verifier, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidateDir = process.argv[2] ?? fixtureDirectory;
  const fault = process.argv[3] ?? 'NONE';
  console.log(JSON.stringify(await verifyCandidate({ candidateDir, fault }), null, 2));
}
