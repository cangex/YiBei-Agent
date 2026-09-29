import { mkdir, readFile, writeFile, rename, open, stat, lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectSTL, MAX_STL_BYTES } from './stl.mjs';

export const FORMAT_VERSION = 1;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validId = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);
export async function atomicJSON(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target);
  } finally { await unlink(temporary).catch(() => {}); }
}

export function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || JSON.stringify(state).length > 256000) throw new Error('项目状态无效或过大。');
  const result = {};
  for (const key of Object.keys(state)) {
    if (!['reconstruction', 'twin'].includes(key)) throw new Error('项目包含未知模块。');
    const value = state[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('流程状态不完整。');
    const allowed = key === 'reconstruction'
      ? ['step', 'progress', 'complete', 'started', 'triangles', 'repairVersion']
      : ['step', 'progress', 'complete', 'started', 'schemeIndex', 'selectedRegionId', 'candidates'];
    if (Object.keys(value).some((field) => !allowed.includes(field))) throw new Error('流程状态包含未知字段。');
    if (key === 'reconstruction' && value.repairVersion !== undefined && value.repairVersion !== 'surface-demo-2') throw new Error('修补演示版本不受支持。');
    if (!Number.isInteger(value.step) || value.step < 0 || value.step > 4 || typeof value.progress !== 'number' || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1 || typeof value.complete !== 'boolean' || typeof value.started !== 'boolean') throw new Error('流程进度无效。');
    if (value.complete && (value.step !== 4 || value.progress !== 1)) throw new Error('完成状态与流程进度不一致。');
    if (key === 'reconstruction' && (!Number.isInteger(value.triangles) || value.triangles < 1 || value.triangles > 200000)) throw new Error('模型面数无效。');
    if (key === 'twin') {
      if (!Number.isInteger(value.schemeIndex) || value.schemeIndex < 0 || value.schemeIndex > 2) throw new Error('候选方案索引无效。');
      if (value.selectedRegionId !== null && !/^R[1-5]$/.test(value.selectedRegionId)) throw new Error('区域索引无效。');
      if (!Array.isArray(value.candidates) || value.candidates.length !== 3) throw new Error('候选方案数据不完整。');
      for (const candidate of value.candidates) {
        if (!candidate || typeof candidate.name !== 'string' || candidate.name.length > 80 || typeof candidate.code !== 'string' || typeof candidate.reason !== 'string' || candidate.reason.length > 2000 || !Number.isFinite(candidate.fit) || candidate.fit < 0 || candidate.fit > 100 || !Array.isArray(candidate.metrics) || candidate.metrics.length !== 5 || candidate.metrics.some((v) => !Number.isFinite(v) || v < 0 || v > 100) || !Array.isArray(candidate.regions) || candidate.regions.length !== 5) throw new Error('候选方案格式无效。');
        const zones = new Set();
        for (const region of candidate.regions) {
          if (!region || !/^R[1-5]$/.test(region.id) || zones.has(region.id) || !['occlusal','buccal','lingual','mesial','distal'].includes(region.anatomicalZone) || typeof region.enabled !== 'boolean' || !['topology','wave','straight'].includes(region.pattern) || !Number.isInteger(region.sides) || region.sides < 3 || region.sides > 6 || typeof region.wave !== 'boolean' || typeof region.name !== 'string' || typeof region.topology !== 'string') throw new Error('区域配置无效。');
          zones.add(region.id);
          for (const property of ['widthUm', 'depthUm', 'pitchUm', 'score']) if (!Number.isFinite(region[property]) || region[property] < 0 || region[property] > 1000) throw new Error('微织构参数无效。');
          if (region.textureAngle !== undefined && (!Number.isFinite(region.textureAngle) || Math.abs(region.textureAngle) > 10)) throw new Error('微织构方向无效。');
        }
      }
    }
    result[key] = JSON.parse(JSON.stringify(value));
  }
  return result;
}

export class ProjectStore {
  constructor(root, defaultModel) { this.root = root; this.defaultModel = defaultModel; this.current = null; this.queue = Promise.resolve(); }
  async initialize() {
    await mkdir(path.join(this.root, 'projects'), { recursive: true });
    let settings;
    try { settings = JSON.parse(await readFile(path.join(this.root, 'settings.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('设置文件损坏。请从“打开项目”恢复已有项目。'); }
    this.settings = { quality: 'balanced', ...settings };
    if (!['balanced','high','economy'].includes(this.settings.quality)) this.settings.quality = 'balanced';
    if (this.settings.lastProject) return this.openProject(this.settings.lastProject);
    return this.create('未命名项目');
  }
  enqueue(action) { const pending = this.queue.then(action); this.queue = pending.catch(() => {}); return pending; }
  async remember() { await atomicJSON(path.join(this.root, 'settings.json'), { ...this.settings, lastProject: this.file }); }
  async create(name = '未命名项目') {
    await this.queue;
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('项目名称需为 1–80 个字符。');
    const id = randomUUID(), now = new Date().toISOString();
    const folder = path.join(this.root, 'projects', id);
    const bytes = await readFile(this.defaultModel);
    const geometry = inspectSTL(bytes), sha256 = hash(bytes);
    await mkdir(path.join(folder, 'models'), { recursive: true });
    await writeFile(path.join(folder, 'models', `${sha256}.stl`), bytes, { flag: 'wx', mode: 0o600 });
    const project = { format: 'yibei-project', version: FORMAT_VERSION, id, name: name.trim(), createdAt: now, updatedAt: now, algorithm: 'frontend-deterministic-demo-v1', model: { file: `models/${sha256}.stl`, originalName: '测试.stl', sha256, ...geometry }, generatedData: [], state: {} };
    const file = path.join(folder, 'project.yibei');
    await atomicJSON(file, project);
    this.current = project; this.file = file;
    await this.remember(); return this.describe();
  }
  async openProject(file) {
    await this.queue;
    if (path.extname(file) !== '.yibei') throw new Error('请选择 project.yibei 项目文件。');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512000) throw new Error('项目文件无效。');
    const p = JSON.parse(await readFile(file, 'utf8'));
    if (p.format !== 'yibei-project' || p.version !== FORMAT_VERSION) throw new Error('项目格式不支持，请使用兼容版本的软件打开。');
    if (!validId(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || !Number.isFinite(Date.parse(p.createdAt)) || !Number.isFinite(Date.parse(p.updatedAt)) || !/^[0-9a-f]{64}$/.test(p.model?.sha256) || p.model.file !== `models/${p.model.sha256}.stl` || typeof p.model.originalName !== 'string' || p.model.originalName.length > 255 || p.algorithm !== 'frontend-deterministic-demo-v1' || !Array.isArray(p.generatedData) || p.generatedData.length) throw new Error('项目描述文件损坏。');
    p.state = validateState(p.state);
    const folder = await realpath(path.dirname(file));
    const models = path.join(folder, 'models');
    const modelPath = path.join(folder, p.model.file);
    if ((await lstat(models)).isSymbolicLink() || (await lstat(modelPath)).isSymbolicLink() || await realpath(modelPath) !== modelPath) throw new Error('项目模型路径不安全。');
    const size = (await stat(modelPath)).size;
    if (size > MAX_STL_BYTES) throw new Error('项目模型超过大小限制。');
    const bytes = await readFile(modelPath);
    if (hash(bytes) !== p.model.sha256) throw new Error('项目模型校验失败，文件可能损坏。原文件未被修改。');
    const geometry = inspectSTL(bytes);
    p.model = { ...p.model, ...geometry };
    this.current = p; this.file = path.join(folder, path.basename(file));
    await this.remember(); return this.describe();
  }
  describe() {
    if (!this.current) throw new Error('请先创建或打开项目。');
    return { ...structuredClone(this.current), modelUrl: `/project-model/${this.current.id}/${this.current.model.sha256}.stl`, location: this.file, quality: this.settings?.quality || 'balanced' };
  }
  importModel(bytes, name, expectedId) {
    return this.enqueue(async () => {
      if (this.current?.id !== expectedId) throw new Error('项目已切换，请重试导入。');
      if (typeof name !== 'string' || !name.toLowerCase().endsWith('.stl') || name.length > 255 || /[\\/]/.test(name) || name.includes('\0')) throw new Error('请选择有效的 STL 文件名。');
      const geometry = inspectSTL(bytes), sha256 = hash(bytes);
      const destination = path.join(path.dirname(this.file), 'models', `${sha256}.stl`);
      try { await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; if (hash(await readFile(destination)) !== sha256) throw new Error('已有模型副本损坏。'); }
      const next = { ...this.current, model: { file: `models/${sha256}.stl`, originalName: name, sha256, ...geometry }, state: {}, generatedData: [], updatedAt: new Date().toISOString() };
      await atomicJSON(this.file, next); this.current = next; return this.describe();
    });
  }
  save(state, expectedId) {
    return this.enqueue(async () => {
      if (this.current?.id !== expectedId) throw new Error('项目已切换，已阻止覆盖其它项目。');
      const next = { ...this.current, state: validateState(state), updatedAt: new Date().toISOString() };
      await atomicJSON(this.file, next); this.current = next; return this.describe();
    });
  }
  async setQuality(quality) {
    if (!['balanced','high','economy'].includes(quality)) throw new Error('渲染质量无效。');
    this.settings = { ...this.settings, quality }; await this.remember(); return quality;
  }
  async modelBytes(url) {
    const p = this.current;
    if (!p || url !== `/project-model/${p.id}/${p.model.sha256}.stl`) return null;
    return readFile(path.join(path.dirname(this.file), p.model.file));
  }
}
