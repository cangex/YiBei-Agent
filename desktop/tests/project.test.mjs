import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectStore, atomicJSON, validateState } from '../lib/project-store.mjs';
import { inspectSTL, MAX_STL_BYTES } from '../lib/stl.mjs';

const demo = new URL('../../public/models/demo.stl', import.meta.url);
const reset = { step: 0, progress: 0, complete: false, started: false, triangles: 41176 };
const finished = { ...reset, step: 4, progress: 1, complete: true, started: true };
test('repair algorithm version is persisted and unknown versions are rejected', () => {
  const state = { reconstruction: { ...finished, repairVersion: 'surface-demo-2' } };
  assert.deepEqual(validateState(state), state);
  assert.throws(() => validateState({ reconstruction: { ...finished, repairVersion: 'untrusted-version' } }), /版本不受支持/);
});
async function fixture(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'yibei-desktop-test-'));
  const root = path.join(folder, '中文 客户数据');
  const store = new ProjectStore(root, demo);
  await store.initialize();
  t.diagnostic(`isolated test data: ${folder}`);
  return { root, store, folder };
}

test('STL parser validates real 41,176-face demo and ASCII geometry', async () => {
  assert.equal(inspectSTL(await readFile(demo)).triangles, 41176);
  const ascii = new TextEncoder().encode('solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid test');
  assert.equal(inspectSTL(ascii).triangles, 1);
  assert.throws(() => inspectSTL(new Uint8Array(MAX_STL_BYTES + 1)), /24 MB/);
  assert.throws(() => inspectSTL(new Uint8Array()), /不完整/);
  const corrupt = Buffer.from(await readFile(demo)); corrupt.writeFloatLE(NaN, 96);
  assert.throws(() => inspectSTL(corrupt), /无效坐标/);
  assert.throws(() => inspectSTL(corrupt.subarray(0, 300)), /损坏|encoded/);
  const oversized = Buffer.alloc(84 + 200001 * 50); oversized.writeUInt32LE(200001, 80);
  assert.throws(() => inspectSTL(oversized), /200,000/);
});

test('projects survive a fresh store, use immutable STL bytes, and serialize competing writes', async (t) => {
  const { root, store } = await fixture(t);
  const original = await readFile(demo), p = store.describe();
  const imported = Buffer.from(original); imported[0] = 42;
  const state1 = { reconstruction: { ...reset, step: 2, progress: .45, started: true } };
  const next = await store.importModel(imported, '客户 牙冠.stl', p.id);
  assert.equal(next.model.originalName, '客户 牙冠.stl');
  assert.notEqual(next.model.sha256, p.model.sha256);
  assert.deepEqual(await readFile(demo), original);
  await Promise.all([store.save(state1, p.id), store.save({ reconstruction: finished }, p.id)]);
  const reopened = new ProjectStore(root, demo); await reopened.initialize();
  assert.equal(reopened.describe().model.sha256, next.model.sha256);
  assert.deepEqual(reopened.describe().state.reconstruction, finished);
  assert.deepEqual(await reopened.modelBytes(reopened.describe().modelUrl), imported);
  assert.equal(await reopened.modelBytes('/project-model/../../secret'), null);
  assert.deepEqual(reopened.current.generatedData, []);
  const files = await readdir(path.dirname(store.file)); assert(!files.some((file) => file.endsWith('.tmp')));
});

test('new project prevents stale writes and failed validation preserves previous project', async (t) => {
  const { store } = await fixture(t);
  const old = store.describe(); const next = await store.create('研究 02');
  await assert.rejects(store.save({ reconstruction: finished }, old.id), /项目已切换/);
  await assert.rejects(store.importModel(new Uint8Array(20), '坏.stl', next.id));
  assert.deepEqual(store.describe().state, {});
  await assert.rejects(store.save({ reconstruction: { ...finished, progress: 2 } }, next.id), /进度无效/);
  assert.deepEqual(JSON.parse(await readFile(store.file, 'utf8')).state, {});
});

test('portable project opens from Chinese/spaced directory and corruption never overwrites active data', async (t) => {
  const { store, folder } = await fixture(t);
  const original = store.describe();
  const destination = path.join(folder, 'U 盘项目', '义齿 研究');
  await cp(path.dirname(store.file), destination, { recursive: true });
  const file = path.join(destination, 'project.yibei');
  await store.openProject(file);
  assert.equal(store.describe().id, original.id);
  const good = await readFile(file, 'utf8'), damaged = JSON.parse(good);
  damaged.model.file = '../../outside.stl'; await writeFile(file, JSON.stringify(damaged));
  await assert.rejects(store.openProject(file), /损坏/);
  await writeFile(file, good); await writeFile(path.join(destination, original.model.file), 'broken');
  await assert.rejects(store.openProject(file), /校验失败/);
  assert.equal(store.describe().model.sha256, original.model.sha256);
  await writeFile(file, '{ invalid json'); await assert.rejects(store.openProject(file), SyntaxError);
  assert.equal(await readFile(file, 'utf8'), '{ invalid json');
});

test('format versions, symlink escapes, settings persistence and atomic failure', async (t) => {
  const { store, root, folder } = await fixture(t);
  await store.setQuality('economy');
  const fresh = new ProjectStore(root, demo); await fresh.initialize(); assert.equal(fresh.describe().quality, 'economy');
  await assert.rejects(store.setQuality('unsafe'));
  const target = path.join(folder, 'atomic.json'); await atomicJSON(target, { stable: true });
  const circular = {}; circular.self = circular;
  await assert.rejects(atomicJSON(target, circular));
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { stable: true });
  const newer = { ...store.current, version: 2 }; const file = path.join(folder, 'future.yibei');
  await atomicJSON(file, newer); await assert.rejects(store.openProject(file), /格式不支持/);
  const linked = path.join(folder, 'link.yibei');
  try { await symlink(store.file, linked); await assert.rejects(store.openProject(linked), /无效/); }
  catch (error) { if (error.code !== 'EPERM') throw error; t.diagnostic('symlink creation not permitted on this host'); }
});

test('candidate and region configuration is persisted and rejects unsafe values', async (t) => {
  const { store } = await fixture(t);
  const regions = ['occlusal','buccal','lingual','mesial','distal'].map((zone, index) => ({ id: `R${index + 1}`, name: zone, anatomicalZone: zone, enabled: index % 2 === 0, pattern: 'topology', topology: '六边拓扑', sides: 6, wave: false, widthUm: 38, depthUm: 20, pitchUm: 168, score: 97 }));
  const candidates = Array.from({ length: 3 }, (_, index) => ({ code: `plan-${index}`, name: `方案${index}`, reason: '确定性演示', fit: 94, metrics: [92,89,86,91,88], regions }));
  const twin = { step: 4, progress: 1, complete: true, started: true, schemeIndex: 2, selectedRegionId: 'R5', candidates };
  await store.save({ twin }, store.current.id);
  await store.openProject(store.file); assert.deepEqual(store.describe().state.twin, twin);
  assert.throws(() => validateState({ twin: { ...twin, schemeIndex: 9 } }), /索引无效/);
  const altered = structuredClone(twin); altered.candidates[0].regions[0].widthUm = Infinity;
  assert.throws(() => validateState({ twin: altered }), /参数无效/);
});
