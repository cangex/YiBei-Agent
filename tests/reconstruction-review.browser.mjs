import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.YIBEI_TEST_CHROMIUM_EXECUTABLE});
const context=await browser.newContext({viewport:{width:1440,height:1050},deviceScaleFactor:2});
const page=await context.newPage(), errors=[], snapshots=[];
page.on('pageerror', e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});
const out='test-results/reconstruction-review';await mkdir(out,{recursive:true});
async function seed(step,progress,complete=false) {
  await page.evaluate(async ({step,progress,complete})=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('yibei-local-project',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const p=await new Promise((resolve,reject)=>{const r=db.transaction('session').objectStore('session').get('active');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    p.project.state.reconstruction={step,progress,complete,started:true,triangles:41176,repairVersion:'surface-demo-2'};
    await new Promise((resolve,reject)=>{const t=db.transaction('session','readwrite');t.objectStore('session').put(p,'active');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();
  },{step,progress,complete});
  await page.reload(); await page.locator('[data-model-state=ready]').first().waitFor();
  if(!complete) await page.getByRole('button',{name:'暂停',exact:true}).click();
  await page.waitForTimeout(900);
}
async function shot(name){await page.screenshot({path:`${out}/${name}.png`,fullPage:true});snapshots.push({name,...await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth+1,scenes:[...document.querySelectorAll('[data-model-state]')].map(x=>({...x.dataset}))}))});assert.equal(snapshots.at(-1).overflow,false);}
try{
  await page.goto('http://localhost:3000/reconstruction'); await page.locator('[data-model-state=ready]').waitFor();await page.waitForTimeout(1200);
  await seed(2,.7);await shot('01-repair-dpi2');
  await page.getByRole('button',{name:'查看修补机制'}).click();await page.waitForTimeout(500);await shot('02-mechanism');
  await seed(3,.6);await shot('03-validation-dpi2');
  await seed(4,1,true);await page.getByRole('button',{name:'修补量视图',exact:true}).click();await page.waitForTimeout(1000);await shot('04-displacement-dpi2');
  await page.setViewportSize({width:1024,height:768});await page.waitForTimeout(400);await shot('05-small-result');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await shot('06-mobile-result');
  await page.getByRole('tab',{name:'表面修补量'}).click(); await page.waitForTimeout(400);await shot('07-mobile-heat');
  await page.setViewportSize({width:1440,height:1050});await page.getByRole('button',{name:'重置',exact:true}).click();await page.waitForTimeout(1200);
  for(let i=0;i<3;i++){await page.goto('http://localhost:3000/');await page.locator('[data-model-state=ready]').waitFor();assert.equal(await page.locator('canvas').count(),1);await page.goto('http://localhost:3000/reconstruction');await page.locator('[data-model-state=ready]').waitFor();assert.equal(await page.locator('canvas').count(),2);}
  await page.locator('input[type=file]').setInputFiles({name:'错误.stl',mimeType:'application/octet-stream',buffer:Buffer.from('not an STL')});await page.getByRole('alert').waitFor();
  assert.equal(await page.locator('[data-model-state=ready]').count(),1);
  await context.clearPermissions();await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.locator('[data-model-state=ready]').waitFor();await shot('08-reduced-motion');
  assert.deepEqual(errors,[]);
}finally{await writeFile(`${out}/report.json`,JSON.stringify({errors,snapshots},null,2));await browser.close();}
