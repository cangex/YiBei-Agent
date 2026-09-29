/** Deterministic, reversible surface demonstration. Never mutates the imported mesh. */
export type RepairKind = 'margin' | 'topology' | 'hole' | 'fissure';
export type RepairRegion = {
  id: string; name: string; kind: RepairKind; reason: string; action: string;
  center: [number, number, number]; radius: number; vertices: number; max: number; mean: number;
  triangles: Uint32Array; section: Float32Array;
};
export type ReconstructionPlan = {
  version: 'surface-demo-2'; source: 'deterministic-demo';
  original: Float32Array; delta: Float32Array; cleanup: Float32Array; regionIds: Int8Array;
  magnitudes: Float32Array; history: Float32Array; regions: RepairRegion[]; scale: number;
  stats: { triangles: number; storedVertices: number; uniqueVertices: number; dimensions: number[]; area: number; afterArea: number; boundaryEdges: number; nonmanifoldEdges: number; cleanupVertices: number; max: number; mean: number; changedVertices: number };
};
export const clamp = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };
export const RECONSTRUCTION_DURATIONS = [3600, 10000, 64000, 16000, 3600];
export function reconstructionState(step: number, progress: number, started = true) {
  const p = started ? clamp(progress) : 0;
  const cleanup = step > 2 ? 1 : step === 2 ? smooth(p / .16) : 0;
  const cursor = clamp((p - .16) / .84) * 4;
  const region = step < 2 ? Math.min(3, Math.floor(p * 4)) : step > 2 ? Math.min(3, Math.floor(p * 4)) : Math.min(3, Math.floor(cursor));
  const local = step === 2 ? clamp(cursor - region) : step > 2 ? 1 : 0;
  const factors = Array.from({ length: 4 }, (_, i) => step > 2 ? 1 : step < 2 ? 0 : smooth((cursor - i - .24) / .58));
  const action = !started ? '等待载入与启动' : step === 0 ? '读取网格、统计独立顶点与空间边界' : step === 1 ? '自下而上追踪几何截面' : step === 2 && p < .16 ? (p < .05 ? '筛选孤立尖点与异常位移' : p < .12 ? '保留边缘与沟槽 · 局部降噪' : '清理复核 · 准备逐区处理') : step === 2 ? local < .24 ? '定位示范区域与原始截面' : local < .82 ? '应用局部几何修补' : '复核位移与截面 · 进入下一区域' : step === 3 ? ['对齐原始与演示表面', '逐区测量实际顶点位移', '复核截面与变化范围', '汇总几何变化'][Math.min(3, Math.floor(p * 4))] : '整理演示结果与模型传递';
  return { cleanup, region, local, factors, action, denoising: step === 2 && p < .16, total: started ? (step + p) * 20 : 0, completedRegions: step > 2 ? 4 : step < 2 ? 0 : Math.floor(cursor) };
}
function areaOf(p: Float32Array) {
  let area = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i + 3] - p[i], ay = p[i + 4] - p[i + 1], az = p[i + 5] - p[i + 2];
    const bx = p[i + 6] - p[i], by = p[i + 7] - p[i + 1], bz = p[i + 8] - p[i + 2];
    area += Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) * .5;
  }
  return area;
}
export function buildReconstructionPlan(source: Float32Array): ReconstructionPlan {
  const count = source.length / 3, low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  const unique: number[][] = [], map = new Map<string, number>(), ids = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const v = [source[i * 3], source[i * 3 + 1], source[i * 3 + 2]];
    for (let k = 0; k < 3; k++) { low[k] = Math.min(low[k], v[k]); high[k] = Math.max(high[k], v[k]); }
    // Exact coordinate welding: this is not STL's three stored vertices per face.
    const key = v.join(','); let id = map.get(key);
    if (id === undefined) { id = unique.length; map.set(key, id); unique.push(v); }
    ids[i] = id;
  }
  const dimensions = high.map((v, k) => v - low[k]), scale = 2.65 / Math.max(...dimensions, .001);
  const original = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) original[i] = (source[i] - (low[i % 3] + high[i % 3]) / 2) * scale;
  const points = unique.map(v => v.map((x, k) => (x - (low[k] + high[k]) / 2) * scale));
  const neighbors = points.map(() => new Set<number>()), normals = points.map(() => [0, 0, 0]), edges = new Map<string, number>();
  for (let i = 0; i < count; i += 3) {
    const a = ids[i], b = ids[i + 1], c = ids[i + 2], p = points[a], q = points[b], r = points[c];
    const u = q.map((x, k) => x - p[k]), v = r.map((x, k) => x - p[k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const id of [a, b, c]) for (let k = 0; k < 3; k++) normals[id][k] += n[k];
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { neighbors[x].add(y); neighbors[y].add(x); const key = x < y ? `${x}:${y}` : `${y}:${x}`; edges.set(key, (edges.get(key) || 0) + 1); }
  }
  const boundary = new Set<number>(); let boundaryEdges = 0, nonmanifoldEdges = 0;
  for (const [key, n] of edges) { if (n === 1) boundaryEdges++; if (n > 2) nonmanifoldEdges++; if (n !== 2) key.split(':').forEach(x => boundary.add(Number(x))); }
  normals.forEach(n => { const l = Math.hypot(...n) || 1; for (let k = 0; k < 3; k++) n[k] /= l; });
  const defs: Array<[RepairKind, string, string, string, number, number]> = [
    ['margin', '底部边缘区域', '演示边缘过渡；开放边界保持不变', '沿边缘连接与过渡', .13, -.3],
    ['topology', '下部侧壁区域', '演示邻域平滑；不改变网格连接关系', '邻域约束平滑', .37, .32],
    ['hole', '上部侧壁区域', '演示补面形变机制；不宣称检出孔洞', '向局部参考曲面补高', .61, -.22],
    ['fissure', '顶部表面区域', '演示局部沟槽形态；解剖方向未经确认', '沿表面恢复连续沟槽', .84, .23],
  ];
  const regionIds = new Int8Array(count).fill(-1), uniqueRegions = new Int8Array(points.length).fill(-1);
  const delta = new Float32Array(source.length), cleanup = new Float32Array(source.length), magnitudes = new Float32Array(count);
  const uniqueDelta = points.map(() => [0, 0, 0]), uniqueCleanup = points.map(() => [0, 0, 0]);
  const height = dimensions[1] * scale, width = dimensions[0] * scale;
  const regions: RepairRegion[] = defs.map(([kind, name, reason, action, level, side], regionIndex) => {
    const target = [width * side, -height / 2 + height * level, dimensions[2] * scale * .42];
    let seed = 0, best = Infinity;
    points.forEach((p, i) => { const d = (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2 * 3 + (p[2] - target[2]) ** 2; if (d < best) { best = d; seed = i; } });
    const center = points[seed] as [number, number, number], radius = Math.max(.12, Math.min(.5, height * .24));
    // Connected flood fill excludes nearby but disconnected/back-facing surface sheets.
    const selected = new Set<number>(), queue = [seed], visited = new Set<number>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]; if (visited.has(id)) continue; visited.add(id);
      const d = Math.hypot(...points[id].map((x, k) => x - center[k]));
      if (d > radius || uniqueRegions[id] !== -1) continue;
      selected.add(id); uniqueRegions[id] = regionIndex;
      neighbors[id].forEach(n => { if (!visited.has(n)) queue.push(n); });
      const weight = smooth(1 - d / radius), p = points[id];
      let laplace = 0;
      neighbors[id].forEach(j => { laplace += points[j].reduce((s, x, k) => s + (x - p[k]) * normals[id][k], 0); });
      laplace /= Math.max(1, neighbors[id].size);
      // Bounded, explicit demonstration deformation, not an inferred clinical repair.
      const shape = kind === 'margin' ? .014 * weight : kind === 'topology' ? Math.max(-.018, Math.min(.018, laplace * .6)) * weight : kind === 'hole' ? .033 * weight : -.02 * weight * Math.exp(-(((p[0] - center[0]) / (radius * .28)) ** 2));
      for (let k = 0; k < 3; k++) uniqueDelta[id][k] = boundary.has(id) ? 0 : normals[id][k] * shape;
    }
    return { id: `R0${regionIndex + 1}`, name, kind, reason, action, center, radius, vertices: selected.size, max: 0, mean: 0, triangles: new Uint32Array(), section: new Float32Array() };
  });
  let cleanupVertices = 0;
  // Restrict cleanup to interior, smoothly oriented neighborhoods; retain sharp features and open boundaries.
  points.forEach((p, id) => {
    if (boundary.has(id) || neighbors[id].size < 3 || uniqueRegions[id] < 0) return;
    let offset = 0, aligned = true;
    neighbors[id].forEach(j => { if (normals[id].reduce((s, v, k) => s + v * normals[j][k], 0) < .85) aligned = false; offset += points[j].reduce((s, v, k) => s + (v - p[k]) * normals[id][k], 0); });
    offset /= neighbors[id].size;
    if (!aligned || Math.abs(offset) < .004) return;
    const amount = Math.max(-.008, Math.min(.008, offset * .25));
    for (let k = 0; k < 3; k++) uniqueCleanup[id][k] = normals[id][k] * amount;
    cleanupVertices++;
  });
  for (let i = 0; i < count; i++) {
    const id = ids[i]; regionIds[i] = uniqueRegions[id];
    for (let k = 0; k < 3; k++) { delta[i * 3 + k] = uniqueDelta[id][k]; cleanup[i * 3 + k] = uniqueCleanup[id][k]; }
    magnitudes[i] = Math.hypot(...uniqueDelta[id].map((v, k) => v + uniqueCleanup[id][k])) / scale;
  }
  regions.forEach((r, ri) => {
    const triangles: number[] = [], section: number[] = [];
    let sum = 0, n = 0;
    points.forEach((_, i) => { if (uniqueRegions[i] === ri) { const d = Math.hypot(...uniqueDelta[i].map((v, k) => v + uniqueCleanup[i][k])) / scale; r.max = Math.max(r.max, d); sum += d; n++; } });
    r.mean = sum / Math.max(1, n);
    for (let i = 0; i < count; i += 3) {
      if (![regionIds[i], regionIds[i + 1], regionIds[i + 2]].includes(ri)) continue;
      triangles.push(i);
      // Plane y = region center.y intersects actual input triangles. Each endpoint stores original+delta+cleanup.
      const hits: number[][] = [];
      for (const [a, b] of [[i, i + 1], [i + 1, i + 2], [i + 2, i]]) {
        const ya = original[a * 3 + 1] - r.center[1], yb = original[b * 3 + 1] - r.center[1];
        if ((ya < 0) === (yb < 0) || ya === yb) continue;
        const t = ya / (ya - yb), values: number[] = [];
        for (const arr of [original, delta, cleanup]) for (let k = 0; k < 3; k++) values.push(arr[a * 3 + k] * (1 - t) + arr[b * 3 + k] * t);
        hits.push(values);
      }
      if (hits.length === 2) section.push(...hits[0], ...hits[1]);
    }
    r.triangles = new Uint32Array(triangles); r.section = new Float32Array(section);
  });
  const final = original.map((x, i) => x + delta[i] + cleanup[i]);
  const all = points.map((_, i) => Math.hypot(...uniqueDelta[i].map((v, k) => v + uniqueCleanup[i][k])) / scale).filter(d => d > 1e-9);
  const history = new Float32Array(101);
  for (let sample = 0; sample <= 100; sample++) {
    const state = reconstructionState(2, sample / 100);
    let sum = 0;
    points.forEach((_, i) => { const factor = state.factors[uniqueRegions[i]] || 0; sum += Math.hypot(...uniqueDelta[i].map((v, k) => v * factor + uniqueCleanup[i][k] * state.cleanup)) / scale; });
    history[sample] = sum / Math.max(1, all.length);
  }
  return { version: 'surface-demo-2', source: 'deterministic-demo', original, delta, cleanup, magnitudes, history, regionIds, regions, scale, stats: { triangles: count / 3, storedVertices: count, uniqueVertices: unique.length, dimensions, area: areaOf(source), afterArea: areaOf(final) / scale ** 2, boundaryEdges, nonmanifoldEdges, cleanupVertices, max: all.reduce((m, d) => Math.max(m, d), 0), mean: all.reduce((s, d) => s + d, 0) / Math.max(1, all.length), changedVertices: all.length } };
}
export function applyReconstruction(plan: ReconstructionPlan, factors: number[], cleanup: number, target: Float32Array = new Float32Array(plan.original.length)) {
  for (let i = 0; i < target.length; i++) target[i] = plan.original[i] + plan.cleanup[i] * cleanup + plan.delta[i] * (factors[plan.regionIds[Math.floor(i / 3)]] || 0);
  return target;
}
