import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { buildReconstructionPlan, applyReconstruction, reconstructionState } from '../app/lib/reconstruction-plan.ts';
const b = readFileSync(new URL('../public/models/demo.stl', import.meta.url));
const source = new STLLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).attributes.position.array;
const originalCopy = source.slice(), plan = buildReconstructionPlan(source);
test('actual mesh statistics distinguish unique and stored vertices and preserve input', () => {
  assert.equal(plan.stats.triangles, 41176); assert.equal(plan.stats.uniqueVertices, 20590); assert.equal(plan.stats.storedVertices, 123528);
  assert.ok(Math.abs(plan.stats.area - 443.851618) < .00001); assert.deepEqual(source, originalCopy);
  assert.deepEqual(applyReconstruction(plan, [0, 0, 0, 0], 0), plan.original);
});
test('connected demonstration regions ascend and sections interpolate the same input geometry', () => {
  plan.regions.forEach((r, ri) => {
    assert.ok(r.triangles.length > 100); assert.ok(r.section.length > 0); assert.equal(r.section.length % 18, 0);
    if (ri) assert.ok(r.center[1] > plan.regions[ri - 1].center[1]);
    for (let i = 0; i < r.section.length; i += 9) assert.ok(Math.abs(r.section[i + 1] - r.center[1]) < 1e-6);
  });
  const processed = applyReconstruction(plan, [1, 1, 1, 1], 1);
  let max = 0, changed = 0;
  for (let i = 0; i < plan.regionIds.length; i++) {
    const d = Math.hypot(...[0, 1, 2].map(k => processed[i * 3 + k] - plan.original[i * 3 + k])) / plan.scale;
    if (plan.regionIds[i] < 0) assert.equal(d, 0);
    assert.ok(Math.abs(d - plan.magnitudes[i]) < 1e-6);
    max = Math.max(max, d); if (d > 1e-9) changed++;
  }
  assert.ok(changed > 0); assert.ok(Math.abs(max - plan.stats.max) < 1e-6);
  assert.ok(Math.abs(plan.history[100] - plan.stats.mean) < 1e-6);
});
test('five-stage progress is monotonic and denoising precedes serial repair and verification', () => {
  let previous = 0;
  for (let step = 0; step < 5; step++) for (let i = 0; i <= 100; i++) {
    const s = reconstructionState(step, i / 100);
    assert.ok(s.total >= previous); previous = s.total;
    if (step < 2) assert.deepEqual(s.factors, [0, 0, 0, 0]);
    const running = s.factors.filter(n => n > 0 && n < 1); assert.ok(running.length <= 1);
  }
  const early = reconstructionState(2, .1); assert.equal(early.denoising, true); assert.deepEqual(early.factors, [0, 0, 0, 0]);
  assert.deepEqual(reconstructionState(2, 1).factors, [1, 1, 1, 1]);
});
test('open mesh boundaries are reported but never automatically closed or displaced', () => {
  const square = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,0,0, 1,1,0, 0,1,0]);
  const p = buildReconstructionPlan(square);
  assert.equal(p.stats.area, 1); assert.equal(p.stats.uniqueVertices, 4); assert.equal(p.stats.boundaryEdges, 4);
  assert.deepEqual(applyReconstruction(p, [1,1,1,1], 1), p.original);
});
