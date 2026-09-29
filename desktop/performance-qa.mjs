import { _electron } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const previous = JSON.parse(await readFile('dist-desktop/qa/report.json'));
const app = await _electron.launch({ args: [path.resolve('release/win-unpacked/resources/app.asar')], env: { ...process.env, YIBEI_TEST_USER_DATA: previous.userData } });
const page = await app.firstWindow();
const samples = [], frameRates = [];
try {
  await page.waitForSelector('.home-shell [data-model-state=ready]');
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  for (let cycle = 0; cycle < 7; cycle++) {
    if (cycle > 0) {
      await page.locator('a[href="/reconstruction"]').click();
      await page.waitForFunction(() => document.querySelectorAll('.reconstruction-comparison [data-model-state=ready]').length === 2);
      await page.locator('a[href="/twin-ai?source=processed"]').click();
      await page.waitForSelector('.twin-page [data-model-state=ready]');
      await page.locator('a[href="/"]').first().click();
      await page.waitForSelector('.home-shell [data-model-state=ready]');
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Performance.getMetrics')).metrics.find((entry) => entry.name === 'JSHeapUsedSize').value;
    samples.push({ cycle, heapBytesAfterGC: heap, canvasCount: await page.locator('canvas').count() });
    console.log('MEMORY', cycle, heap); assert.equal(samples.at(-1).canvasCount, 1);
  }
  assert(samples.at(-1).heapBytesAfterGC < samples[0].heapBytesAfterGC + 32 * 1024 * 1024, 'post-GC heap grew significantly across navigation cycles');
  await page.locator('a[href="/twin-ai"]').click(); await page.waitForSelector('.twin-page [data-model-state=ready]');
  await page.getByLabel('渲染质量').selectOption('balanced'); await page.waitForSelector('.twin-page [data-model-state=ready]');
  await page.locator('.twin-scene').scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);
  for (let index = 0; index < 5; index++) { await page.waitForTimeout(1100); frameRates.push(await page.locator('.twin-scene').evaluate((x) => ({ ...x.dataset }))); }
  console.log('STEADY-FRAMES', frameRates);
  await writeFile('dist-desktop/qa/performance-report.json', JSON.stringify({ success: true, platform: process.platform, samples, frameRates, scope: 'six navigation cycles; steady completed twin, balanced quality; not a Windows benchmark' }, null, 2));
  await cdp.detach();
} finally { await app.close(); }
