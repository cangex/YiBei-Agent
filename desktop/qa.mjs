import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const output = path.resolve('dist-desktop/qa'); await mkdir(output, { recursive: true });
const applicationPath = path.resolve(process.env.YIBEI_QA_APP || 'dist-desktop/app');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'yibei-visual-qa-'));
const userData = path.join(temporary, '中文用户名', '含 空格的应用数据');
const errors = [], externalRequests = [], frames = [];
let application, page;
const report = { platform: process.platform, os: os.release(), arch: process.arch, applicationPath, userData, errors, externalRequests, stages: frames, checks: [], startedAt: new Date().toISOString() };
const record = (name) => { report.checks.push(name); console.log('PASS', name); };
const occupied = http.createServer(); await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
async function launch() {
  application = await _electron.launch({ args: [applicationPath], env: { ...process.env, YIBEI_TEST_USER_DATA: userData }, timeout: 30000 });
  page = await application.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
  await page.waitForSelector('.desktop-projectbar');
  await page.waitForSelector('[data-model-state="ready"]');
}
async function screenshot(name) {
  if (name === '15-ui-125-percent' || name === '14-small-window') {
    await page.waitForTimeout(800);
    await page.locator('.twin-scene').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    const capture = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
    await writeFile(path.join(output, `${name}.png`), Buffer.from(capture, 'base64'));
  } else await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  const info = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, overflow: document.documentElement.scrollWidth > innerWidth + 2, canvases: document.querySelectorAll('canvas').length, scenes: [...document.querySelectorAll('[data-model-state]')].map((element) => ({ ...element.dataset })), heap: performance.memory?.usedJSHeapSize }));
  frames.push({ name, ...info });
  assert.equal(info.overflow, false, `${name}: horizontal layout overflow`);
  console.log('VISUAL', name, info.scenes.map((s) => ({ fps: s.renderFps, calls: s.drawCalls, geometry: s.geometries })));
}
async function clickLink(href) { await page.locator(`a[href="${href}"],a[href^="${href}?"]`).first().click(); }
async function save() { await page.getByRole('button', { name: '保存项目', exact: true }).click(); await page.getByRole('status').filter({ hasText: '已保存在本机' }).waitFor(); }
async function current() { return page.evaluate(() => window.yibeiDesktop.read()); }
async function close() {
  const closed = application.waitForEvent('close');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
}
try {
  await launch();
  const initialURL = page.url();
  assert.notEqual(new URL(initialURL).port, String(occupied.address().port));
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; return window.webContents.getLastWebPreferences();
  });
  assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true);
  record('independent startup, ephemeral port and renderer isolation');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await screenshot('01-home');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('客户甲 · 中文 项目');
  await page.getByRole('button', { name: '创建项目 →' }).click();
  await page.waitForSelector('.reconstruction-page [data-model-state="ready"]');
  record('new project from real UI');
  await page.locator('input[type=file]').setInputFiles({ name: '非法.stl', mimeType: 'application/octet-stream', buffer: Buffer.from('not a valid model') });
  await page.getByRole('alert').filter({ hasText: /STL|格式|模型|encoded/ }).waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: '超大模型.stl', mimeType: 'application/octet-stream', buffer: Buffer.alloc(24 * 1024 * 1024 + 1) });
  await page.getByRole('alert').filter({ hasText: /24 MB/ }).waitFor();
  record('invalid and oversized STL feedback');
  const original = await readFile('public/models/demo.stl'), imported = Buffer.from(original); imported[0] = 79;
  await page.locator('input[type=file]').setInputFiles({ name: '客户 定制牙冠.stl', mimeType: 'application/octet-stream', buffer: imported });
  await page.getByText('客户 定制牙冠.stl', { exact: true }).first().waitFor();
  await page.waitForSelector('.reconstruction-page [data-model-state="ready"]');
  assert.deepEqual(await readFile('public/models/demo.stl'), original);
  await save(); const modelProject = await current();
  assert.equal(modelProject.model.originalName, '客户 定制牙冠.stl');
  const parsed = await readFile(path.join(path.dirname(modelProject.location), modelProject.model.file));
  assert.deepEqual(parsed, imported); record('real STL import and durable unchanged original bytes');
  await screenshot('02-reconstruction-idle');
  await page.getByRole('button', { name: '启动超精准重建' }).click();
  await page.locator('.studio-timeline li.is-active').filter({ hasText: '全域扫描' }).waitFor();
  await screenshot('03-reconstruction-scan');
  await page.locator('.studio-timeline li.is-active').filter({ hasText: '缺陷重建' }).waitFor();
  await page.waitForSelector('.observation-shared-canvas');
  await screenshot('04-local-repair');
  await save(); const checkpoint = await current();
  assert.equal(checkpoint.state.reconstruction.step, 2);
  const beforeMinimize = checkpoint.state.reconstruction.progress;
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await new Promise((resolve) => setTimeout(resolve, 1800));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await save(); assert((await current()).state.reconstruction.progress < beforeMinimize + .1);
  record('minimized workflow pauses');
  await close(); await assert.rejects(fetch(initialURL));
  await launch(); await clickLink('/reconstruction');
  await page.locator('.studio-timeline li.is-active').filter({ hasText: '缺陷重建' }).waitFor();
  assert.equal((await current()).model.sha256, modelProject.model.sha256);
  record('graceful close, port cleanup, restart model and mid-repair state restoration');
  for (const kind of ['R02','R03','R04']) {
    await page.locator(`.reconstruction-observations[data-region="${kind}"]`).waitFor({ timeout: 60000 });
    await screenshot(`05-repair-${kind.toLowerCase()}`);
  }
  await page.locator('.studio-timeline li.is-active').filter({ hasText: '精度校验' }).waitFor({ timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  await screenshot('06-precision-validation');
  await page.waitForSelector('.studio-comparison', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.studio-comparison [data-model-state="ready"]').length === 2);
  await screenshot('07-before-after'); await save();
  assert.equal((await current()).state.reconstruction.complete, true); record('full reconstruction and before/after comparison');
  await clickLink('/twin-ai?source=processed');
  await page.waitForSelector('.twin-page [data-model-state="ready"]');
  assert.equal(await page.evaluate(() => window.yibeiDesktop.read().then((p) => p.model.sha256)), modelProject.model.sha256);
  record('same persisted STL across both products');
  await screenshot('08-twin-idle');
  await page.getByRole('button', { name: '启动双微AI设计' }).click();
  for (const [field, name] of [['力学响应场','mechanics'],['表面流体场','fluid'],['微生态风险场','bio'],['多场融合','fusion']]) {
    await page.locator('.simulation-director.is-visible > strong').filter({ hasText: field }).waitFor();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    await screenshot(`09-baseline-${name}`);
  }
  await page.locator('.ai-state strong').filter({ hasText: '联合设计' }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 3500));
  await screenshot('10-parallel-design');
  await page.locator('.ai-state strong').filter({ hasText: '候选复算' }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await screenshot('11-parallel-simulation');
  await page.locator('.scheme-comparison.is-visible').waitFor({ timeout: 45000 });
  await screenshot('12-convergence');
  await page.locator('.scheme-node-3').click(); await save();
  const completed = await current(); assert.equal(completed.state.twin.complete, true); assert.equal(completed.state.twin.schemeIndex, 2); assert.equal(completed.state.twin.candidates.length, 3);
  await page.locator('.twin-scene').scrollIntoViewIfNeeded();
  const canvas = await page.locator('.twin-scene canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width / 2 + 90, canvas.y + canvas.height / 2 + 20, { steps: 15 }); await page.mouse.up(); await page.mouse.wheel(0, -80);
  await screenshot('13-selected-scheme-3'); record('complete twin workflow, all four fields, parallel designs, convergence and interactive selection');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 740));
  await screenshot('14-small-window');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
  await screenshot('15-ui-125-percent');
  await application.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setSize(1440, 960); });
  await page.getByLabel('渲染质量').selectOption('economy');
  await page.waitForSelector('.twin-page [data-model-state="ready"]'); await save();
  await screenshot('16-economy-quality'); record('small window, high-DPI host, 125% UI zoom and quality control');
  const portable = path.join(temporary, 'U 盘 备份', '项目 甲'); await cp(path.dirname(completed.location), portable, { recursive: true });
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(portable, 'project.yibei'));
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await page.waitForSelector('.reconstruction-page');
  assert.equal((await current()).location, await realpath(path.join(portable, 'project.yibei'))); record('native open command with Chinese and spaced portable project path');
  for (let index = 0; index < 3; index++) {
    await clickLink('/twin-ai'); await page.waitForSelector('.twin-page [data-model-state="ready"]');
    await clickLink('/'); await page.waitForSelector('.home-shell [data-model-state="ready"]');
    await screenshot(`17-navigation-cycle-${index + 1}`);
    assert.equal(await page.locator('canvas').count(), 1);
  }
  record('three repeated page cycles release mounted canvases');
  await save(); await close(); await launch(); await clickLink('/twin-ai');
  await page.waitForSelector('.twin-page [data-model-state="ready"]');
  assert.equal((await current()).state.twin.schemeIndex, 2); assert.equal((await current()).quality, 'economy'); record('selected candidate, region configuration and quality survive restart');
  report.electron = await application.evaluate(() => process.versions);
  report.gpu = await application.evaluate(({ app }) => app.getGPUFeatureStatus());
  report.processMetrics = await application.evaluate(({ app }) => app.getAppMetrics());
  assert.deepEqual(externalRequests, []); record('no runtime external requests observed');
  assert.deepEqual(errors, []); record('no renderer console errors observed');
  await close();
  report.finishedAt = new Date().toISOString(); report.success = true;
} catch (error) {
  report.success = false; report.failure = error.stack;
  console.error(error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  if (application) await application.close().catch(() => {});
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => occupied.close(resolve));
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('QA report:', path.join(output, 'report.json'));
}
