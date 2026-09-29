import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const appRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = appRequire('@electron/asar');
const archive = path.resolve('release/win-unpacked/resources/app.asar');
const files = asar.listPackage(archive);
assert(!files.some((f) => /node_modules|standard-upper|cad-upper|nih-hra|HeroSurfaceEvolution|\.map$|\.env|worker\/index|wrangler|hosting.json|qa.mjs/.test(f)), 'unused or development resources in installer');
for (const item of ['/main.mjs','/preload.cjs','/renderer/index.html','/renderer/models/demo.stl','/renderer/models/standard-molar.stl','/renderer/brand/yibei-medical-logo.png','/licenses/three.txt']) assert(files.includes(item), `Missing ${item}`);
for (const asset of ['models/demo.stl','models/standard-molar.stl','brand/yibei-medical-logo.png']) assert.deepEqual(asar.extractFile(archive, `renderer/${asset}`), await readFile(path.join('public', asset)));
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
const builtPackage = JSON.parse(await readFile('dist-desktop/app/package.json', 'utf8'));
assert.equal(pkg.version, builtPackage.version, 'packaged version must match the current build');
for (const file of files) {
  if (asar.statFile(archive, file.slice(1)).files) continue;
  if (file.startsWith('/renderer/') || ['/main.mjs', '/preload.cjs'].includes(file) || file.startsWith('/lib/')) {
    assert.deepEqual(asar.extractFile(archive, file.slice(1)), await readFile(path.join('dist-desktop/app', file)), `Stale packaged resource: ${file}`);
  }
}
const exe = await readFile('release/win-unpacked/益贝医疗智能体.exe');
const pe = exe.readUInt32LE(0x3c); assert.equal(exe.toString('ascii', pe, pe + 2), 'PE');
assert.equal(exe.readUInt16LE(pe + 4), 0x8664, 'application must be Windows x64');
const optional = pe + 24; assert.equal(exe.readUInt16LE(optional), 0x20b);
const signatureOffset = exe.readUInt32LE(optional + 112 + 4 * 8);
assert.equal(signatureOffset, 0, 'expected deliberately unsigned test build');
const installer = path.resolve(`release/Yibei-Medical-${pkg.version}-x64-Setup.exe`);
const bytes = await readFile(installer);
const installerPE = bytes.readUInt32LE(0x3c);
const installerOptional = installerPE + 24;
const installerDirectory = bytes.readUInt16LE(installerOptional) === 0x20b ? 112 : 96;
assert.equal(bytes.readUInt32LE(installerOptional + installerDirectory + 4 * 8), 0, 'installer should be unsigned');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const report = { version: pkg.version, installer, bytes: bytes.length, sha256, signature: 'unsigned', applicationArchitecture: 'x64', packageFiles: files, verifiedAt: new Date().toISOString() };
await writeFile(path.resolve('release/SHA256SUMS.txt'), `${sha256}  ${path.basename(installer)}\n`);
await writeFile(path.resolve('release/package-verification.json'), JSON.stringify(report, null, 2));
await writeFile(path.resolve(`release/SHA256SUMS-${pkg.version}.txt`), `${sha256}  ${path.basename(installer)}\n`);
await writeFile(path.resolve(`release/package-verification-${pkg.version}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ version: pkg.version, installer, bytes: bytes.length, sha256, signature: 'unsigned', packageFiles: files.length }, null, 2));
