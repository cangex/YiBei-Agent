import { build } from 'vite';
import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({ configFile: path.join(root, 'desktop/vite.config.ts') });
const app = path.join(root, 'dist-desktop/app');
const assets = ['models/demo.stl', 'models/standard-molar.stl', 'brand/yibei-medical-logo.png', 'favicon.svg'];
for (const relative of assets) {
  await mkdir(path.dirname(path.join(app, 'renderer', relative)), { recursive: true });
  await cp(path.join(root, 'public', relative), path.join(app, 'renderer', relative));
}
for (const name of ['main.mjs', 'preload.cjs', 'lib']) await cp(path.join(root, 'desktop', name), path.join(app, name), { recursive: true });
await cp(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(app, 'THIRD_PARTY_NOTICES.md'));
await cp(path.join(root, 'desktop/USER_GUIDE.md'), path.join(app, '使用说明.md'));
await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'yibei-medical-desktop', productName: '益贝医疗智能体', version: '1.1.0', description: '益贝医疗智能体离线演示软件', author: '益贝医疗智能体', main: 'main.mjs', type: 'module', private: true, license: 'UNLICENSED', dependencies: {} }, null, 2));
await mkdir(path.join(app, 'licenses'), { recursive: true });
for (const library of ['react', 'react-dom', 'three']) await cp(path.join(root, 'node_modules', library, 'LICENSE'), path.join(app, 'licenses', `${library}.txt`));
const input = await readFile(path.join(root, 'public/brand/yibei-medical-logo.png'));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((size) => sharp(input).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((data, index) => {
  const base = 6 + index * 16;
  header[base] = sizes[index] % 256; header[base + 1] = sizes[index] % 256;
  header.writeUInt16LE(1, base + 4); header.writeUInt16LE(32, base + 6);
  header.writeUInt32LE(data.length, base + 8); header.writeUInt32LE(offset, base + 12); offset += data.length;
});
await writeFile(path.join(app, 'icon.ico'), Buffer.concat([header, ...images]));
await sharp(input).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(app, 'icon.png'));
console.log('独立桌面生产资源已生成：', app);
