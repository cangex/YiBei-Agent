// Run against a built, running local website:
// node --test tests/model-loading.browser.mjs
// Optional: YIBEI_TEST_BASE_URL and YIBEI_TEST_CHROMIUM_EXECUTABLE.
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.YIBEI_TEST_BASE_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Use a local test server.');
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.YIBEI_TEST_CHROMIUM_EXECUTABLE || undefined,
  });
  await mkdir('test-results/model-loading', { recursive: true });
});
after(async () => { await browser?.close(); });

async function observedPage(context, failOnce = false) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.addInitScript(({ failOnce }) => {
    const NativeWorker = window.Worker;
    window.modelWorkerObservations = [];
    let shouldFail = failOnce;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (shouldFail && String(url).includes('stl.worker')) {
          shouldFail = false;
          throw new DOMException('Simulated worker startup denial', 'SecurityError');
        }
        super(url, options);
        const entry = { url: new URL(url, location.href).href, positions: 0, normals: 0, terminated: false, firstByte: null };
        window.modelWorkerObservations.push(entry);
        const postMessage = this.postMessage.bind(this);
        this.postMessage = (data, transfer) => {
          entry.firstByte = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer)[0];
          postMessage(data, transfer);
        };
        this.addEventListener('message', ({ data }) => {
          entry.positions = data.positions?.length || 0;
          entry.normals = data.normals?.length || 0;
        });
        const terminate = this.terminate.bind(this);
        this.terminate = () => { entry.terminated = true; terminate(); };
      }
    };
  }, { failOnce });
  return page;
}

async function expectMesh(page) {
  await page.locator('[data-model-state="ready"]').first().waitFor();
  assert.equal(await page.locator('.model-load-error').count(), 0);
  const observations = await page.evaluate(() => window.modelWorkerObservations);
  const parsed = observations.filter((entry) => entry.positions > 0);
  assert.ok(parsed.length > 0, 'A real worker returned mesh vertices.');
  for (const entry of parsed) {
    assert.equal(new URL(entry.url).origin, new URL(base).origin);
    assert.equal(new URL(entry.url).protocol, new URL(base).protocol);
    assert.equal(entry.positions, 41176 * 9);
    assert.equal(entry.normals, entry.positions);
    assert.equal(entry.terminated, true, 'Completed parsers release their worker.');
  }
}

test('both product pages load the real default mesh using same-origin workers', { timeout: 90000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await observedPage(context);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const route of ['/reconstruction', '/twin-ai']) {
      await page.goto(base + route);
      await expectMesh(page);
      await page.screenshot({ path: `test-results/model-loading${route}.png` });
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('imported STL survives refresh and opens in both products', { timeout: 90000 }, async () => {
  const context = await browser.newContext();
  try {
    const page = await observedPage(context);
    await page.goto(base + '/reconstruction');
    await expectMesh(page);
    const buffer = await readFile(new URL('../public/models/demo.stl', import.meta.url));
    buffer[0] = (buffer[0] + 1) % 256; // Different header, unchanged valid geometry.
    const firstByte = buffer[0];
    const importedParsed = () => page.waitForFunction((firstByte) =>
      window.modelWorkerObservations.some((entry) => entry.positions > 0 && entry.firstByte === firstByte), firstByte);
    const name = '回归测试 牙冠.stl';
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
    await page.getByText(name, { exact: true }).first().waitFor();
    await importedParsed();
    await expectMesh(page);
    await page.reload();
    await page.getByText(name, { exact: true }).first().waitFor();
    await importedParsed();
    await expectMesh(page);
    await page.goto(base + '/twin-ai');
    await importedParsed();
    await expectMesh(page);
  } finally { await context.close(); }
});

test('worker startup failure has a readable error and reload recovers', { timeout: 60000 }, async () => {
  const context = await browser.newContext();
  try {
    const page = await observedPage(context, true);
    await page.goto(base + '/reconstruction');
    await page.getByText('模型解析线程无法启动，请刷新页面后重试。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '重新加载模型' }).click();
    await expectMesh(page);
  } finally { await context.close(); }
});
