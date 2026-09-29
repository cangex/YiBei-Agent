import { _electron } from 'playwright';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
const last = JSON.parse(await readFile('dist-desktop/qa/report.json'));
const app = await _electron.launch({ args: [path.resolve('dist-desktop/app')], env: { ...process.env, YIBEI_TEST_USER_DATA: last.userData } });
const page = await app.firstWindow();
await page.waitForSelector('.home-shell');
await page.locator('a[href="/twin-ai"]').click();
await page.waitForSelector('[data-model-state=ready]');
const measurements = [];
for (const [width, height, zoom] of [[1440, 960, 1], [1040, 740, 1], [1040, 740, 1.25]]) {
  await app.evaluate(({ BrowserWindow }, values) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(values[0], values[1]); w.webContents.setZoomFactor(values[2]); }, [width, height, zoom]);
  await page.waitForTimeout(1800);
  await page.locator('.twin-scene').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1800);
  const data = await page.evaluate(() => ({ viewport: [innerWidth, innerHeight, devicePixelRatio], scroll: [scrollX, scrollY], body: [document.body.scrollWidth, document.body.scrollHeight], scene: [...document.querySelectorAll('.twin-workspace,.twin-scene-wrap,.twin-scene,canvas')].map((x) => ({ name: x.className || x.tagName, rect: x.getBoundingClientRect().toJSON(), width: getComputedStyle(x).width, height: getComputedStyle(x).height, dataset: { ...x.dataset } })) }));
  measurements.push(data); console.log(JSON.stringify(data));
  const capture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(`dist-desktop/qa/actual-layout-${width}-${zoom}.png`, Buffer.from(capture, 'base64'));
}
await writeFile('dist-desktop/qa/layout-report.json', JSON.stringify(measurements, null, 2));
await app.close();
