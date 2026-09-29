import { _electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=await mkdtemp(path.join(os.tmpdir(),'yibei-reconstruction-qa-'));
const userData=path.join(root,'中文用户','项目 空间');
const output=path.resolve('test-results/reconstruction-desktop');await mkdir(output,{recursive:true});
const errors=[],external=[],checks=[];let app,page;
async function launch(){app=await _electron.launch({args:[path.resolve(process.env.YIBEI_QA_APP || 'dist-desktop/app')],env:{...process.env,YIBEI_TEST_USER_DATA:userData}});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});await page.locator('.desktop-projectbar').waitFor();await page.locator('a[href="/reconstruction"]').first().click();await page.locator('[data-model-state=ready]').waitFor();}
try{
 await launch();await page.getByRole('button',{name:/启动超精准重建/}).click();
 await page.waitForFunction(()=>document.querySelector('.studio-timeline')?.dataset.step==='2',null,{timeout:25000});
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await page.getByRole('button',{name:'保存项目',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存在本机'}).waitFor();
 const saved=await page.evaluate(()=>window.yibeiDesktop.read());assert.equal(saved.state.reconstruction.repairVersion,'surface-demo-2');checks.push('新演示版本参数通过隔离IPC保存');
 await page.screenshot({path:path.join(output,'01-desktop-repair.png'),fullPage:true});
 await app.close();app=null;await launch();
 await page.waitForFunction(()=>document.querySelector('.studio-timeline')?.dataset.step==='2');
 const restored=await page.evaluate(()=>window.yibeiDesktop.read());assert.equal(restored.model.sha256,saved.model.sha256);checks.push('中文和空格目录保存、关闭、重启恢复原始模型与阶段');
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1100,850);w.webContents.setZoomFactor(1.25);});await page.waitForTimeout(500);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(output,'02-desktop-125-percent.png'),fullPage:true});checks.push('桌面窗口125%缩放无横向溢出');
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);checks.push('无外网资源请求、无渲染器错误');
}finally{if(app)await app.close();await writeFile(path.join(output,'report.json'),JSON.stringify({platform:process.platform,arch:process.arch,userData,checks,errors,external},null,2));}
