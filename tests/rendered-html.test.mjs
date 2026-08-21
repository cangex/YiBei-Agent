import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished Yibei brand homepage", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>益贝医疗智能体｜智能义齿设计与数字孪生验证<\/title>/);
  assert.match(html, /让义齿，从几何重建/);
  assert.match(html, /href="\/reconstruction"/);
  assert.match(html, /href="\/twin-ai"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/);
});

test("homepage uses a crown-dominant square molar instead of the product demo STL", async () => {
  const [homepage, heroScene] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HeroToothScene.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(homepage, /HeroToothScene/);
  assert.doesNotMatch(homepage, /DentalScene|demo\.stl/);
  assert.match(heroScene, /STLLoader/);
  assert.match(heroScene, /standard-molar\.stl/);
  assert.match(heroScene, /ROOT_COMPRESSION = 0\.18/);
  assert.match(heroScene, /MODEL_SCALE = 0\.75/);
  assert.doesNotMatch(heroScene, /demo\.stl|createAnatomicalTooth|createCrown|createRoot/);
});

test("server-renders both product routes with independent metadata", async () => {
  const [reconstructionResponse, twinResponse] = await Promise.all([
    render("/reconstruction"),
    render("/twin-ai"),
  ]);
  assert.equal(reconstructionResponse.status, 200);
  assert.equal(twinResponse.status, 200);

  const reconstruction = await reconstructionResponse.text();
  const twin = await twinResponse.text();
  assert.match(reconstruction, /<title>义齿三维轮廓超精准重建智能体｜益贝医疗智能体<\/title>/);
  assert.match(reconstruction, /启动超精准重建/);
  assert.match(reconstruction, /读取三角网格与空间边界/);
  assert.match(twin, /<title>双微AI设计智能体及验证平台｜益贝医疗智能体<\/title>/);
  assert.match(twin, /启动双微AI设计/);
  assert.match(twin, /分区均衡方案/);
  assert.match(twin, /不雕刻/);
});

test("ships the real STL demonstration model", async () => {
  const model = await stat(new URL("../public/models/demo.stl", import.meta.url));
  assert.ok(model.size > 2_000_000);
});

test("ships the CC0 compact molar homepage model", async () => {
  const [model, notices] = await Promise.all([
    stat(new URL("../public/models/standard-molar.stl", import.meta.url)),
    readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
  ]);
  assert.ok(model.size > 1_200_000);
  assert.match(notices, /CC0 1\.0/);
  assert.match(notices, /c25d75c8c3d03d5323471168d35a0396f7187bab/);
});

test("product scenes use precision surface scanning and continuous stage transitions", async () => {
  const [scene, reconstruction, twin, styles] = await Promise.all([
    readFile(new URL("../app/components/DentalScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ReconstructionExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TwinAIExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(scene, /createSliceProfile/);
  assert.match(scene, /createPointCloud/);
  assert.match(scene, /createNormalField/);
  assert.match(scene, /uScanY/);
  assert.match(scene, /configureRegionalTexture/);
  assert.match(scene, /regionalTextures/);
  assert.match(scene, /if \(field < 0\.008\) discard/);
  assert.doesNotMatch(scene, /const scanLine/);
  assert.doesNotMatch(scene, /makePatternTexture/);
  assert.match(reconstruction, /stageProgress/);
  assert.match(reconstruction, /stepDurations/);
  assert.match(twin, /phaseProgress/);
  assert.match(twin, /phaseDurations/);
  assert.match(twin, /分区均衡方案/);
  assert.match(twin, /保持光滑/);
  assert.match(twin, /不雕刻/);
  assert.match(twin, /regionalTextures=\{scheme\.regions\}/);
  assert.doesNotMatch(twin, /六边贯通型|波浪四边型|梯度三边型/);
  assert.match(styles, /stage-transition-veil/);
  assert.match(styles, /stage-bridge/);
});
