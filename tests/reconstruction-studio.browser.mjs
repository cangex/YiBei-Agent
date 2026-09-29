import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true,executablePath:process.env.YIBEI_TEST_CHROMIUM_EXECUTABLE});
const context = await browser.newContext({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const page = await context.newPage(), errors = [], report = { stages: [], errors };
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{ if(m.type()==='error' && !m.text().includes('404')) errors.push(m.text()); });
await mkdir('test-results/reconstruction-studio',{recursive:true});
try {
  await page.goto('http://localhost:3000/reconstruction');
  await page.locator('[data-model-state="ready"]').waitFor();
  await page.screenshot({path:'test-results/reconstruction-studio/01-ready.png',fullPage:true});
  await page.getByRole('button',{name:/启动超精准重建/}).click();
  for (const [step, threshold, name] of [[0,.2,'02-parse'],[1,.3,'03-scan'],[2,.09,'04-cleanup'],[2,.3,'05-edge'],[2,.52,'06-smoothing'],[2,.72,'07-surface'],[2,.93,'08-groove'],[3,.45,'09-validation'],[4,.3,'10-output']]) {
    await page.waitForFunction(({step,threshold})=>{const t=document.querySelector('.studio-timeline'); return Number(t?.dataset.step)===step&&Number(t.dataset.progress)>=threshold;},{step,threshold},{timeout:35000});
    await page.screenshot({path:`test-results/reconstruction-studio/${name}.png`,fullPage:true});
    report.stages.push(await page.evaluate(()=>({step:document.querySelector('.studio-timeline').dataset.step, progress:document.querySelector('.studio-timeline').dataset.progress,region:document.querySelector('.reconstruction-observations').dataset.region,modelRegion:document.querySelector('.studio-dental-scene')?.dataset.repairRegion,fps:document.querySelector('[data-render-fps]')?.dataset.renderFps,geometries:document.querySelector('[data-geometries]')?.dataset.geometries})));
    if(step>=2) assert.equal(report.stages.at(-1).region,report.stages.at(-1).modelRegion);
  }
  await page.getByRole('button',{name:'修补量视图',exact:true}).waitFor({timeout:15000});
  await page.locator('.studio-comparison [data-model-state="ready"]').nth(1).waitFor();
  await page.getByRole('button',{name:'修补量视图',exact:true}).click();
  await page.getByRole('button',{name:'R03 上部侧壁区域',exact:true}).click();
  assert.equal(await page.locator('.reconstruction-observations').getAttribute('data-region'),'R03');
  await page.screenshot({path:'test-results/reconstruction-studio/11-displacement.png',fullPage:true});
  await page.getByRole('button',{name:'材质视图',exact:true}).click();
  await page.screenshot({path:'test-results/reconstruction-studio/12-material.png',fullPage:true});
  await page.waitForTimeout(1200); await page.reload();
  await page.getByRole('button',{name:'材质视图',exact:true}).waitFor();
  await page.getByRole('link',{name:/进入双微AI设计/}).click();
  await page.locator('[data-model-state="ready"]').first().waitFor();
  await page.goto('http://localhost:3000/reconstruction');
  await page.getByRole('button',{name:'重置',exact:true}).click();
  await page.getByRole('button',{name:/启动超精准重建/}).waitFor();
  assert.equal(await page.locator('[role=progressbar]').getAttribute('aria-valuenow'),'0');
  for (const [width,height] of [[1024,768],[390,844]]) {
    await page.setViewportSize({width,height}); await page.screenshot({path:`test-results/reconstruction-studio/viewport-${width}.png`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.getByRole('tab',{name:'截面轮廓',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'截面轮廓',exact:true}).getAttribute('aria-selected'),'true');
  assert.deepEqual(errors,[]);
  report.result='passed';
} catch(e) {report.result='failed';report.failure=e.message;throw e;}
finally { await writeFile('test-results/reconstruction-studio/report.json',JSON.stringify(report,null,2)); await browser.close(); }
