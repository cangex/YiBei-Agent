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

test("product scenes use precision scanning, dense on-model regional microgeometry, and continuous transitions", async () => {
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
  assert.match(scene, /enableMacroMicroGeometry = false/);
  assert.match(scene, /createSurfacePatchRig/);
  assert.match(scene, /regionSuitabilityScore/);
  assert.match(scene, /ellipseField/);
  assert.match(scene, /segmentField/);
  assert.match(scene, /regionCarveProgress/);
  assert.match(scene, /layout === "flow-network"/);
  assert.match(scene, /layout === "ridge-bridge"/);
  assert.match(scene, /assignedSurfaceRegion/);
  assert.match(scene, /ownershipConfidence/);
  assert.match(scene, /regionGrowthOrder/);
  assert.match(scene, /aRegionConfidence/);
  assert.match(scene, /uDecision/);
  assert.match(scene, /createSimulationFieldMaterial/);
  assert.match(scene, /aStress/);
  assert.match(scene, /aFluid/);
  assert.match(scene, /aBio/);
  assert.match(scene, /aFusion/);
  assert.match(scene, /createSimulationBoundaryRig/);
  assert.match(scene, /createMechanicsFieldRig/);
  assert.match(scene, /anatomical-occlusal-boundary/);
  assert.match(scene, /contactPatches/);
  assert.match(scene, /shellLayers/);
  assert.match(scene, /localCyclePhase/);
  assert.match(scene, /buccalZone/);
  assert.match(scene, /centralZone/);
  assert.match(scene, /lingualZone/);
  assert.match(scene, /mechanicalContacts/);
  assert.match(scene, /createSurfaceFlowRig/);
  assert.match(scene, /surface-flow-inlet/);
  assert.match(scene, /const laneCount = 24/);
  assert.match(scene, /const particleCount = 1100/);
  assert.match(scene, /ghostLine/);
  assert.match(scene, /vortices/);
  assert.match(scene, /exchangeFlux/);
  assert.match(scene, /createSurfaceFlowParticleMaterial/);
  assert.match(scene, /createFluidRetentionMaterial/);
  assert.match(scene, /createBioFilmMaterial/);
  assert.match(scene, /createBioNetworkRig/);
  assert.match(scene, /createBioEntityRig/);
  assert.match(scene, /InstancedMesh/);
  assert.match(scene, /createFusionLayerRig/);
  assert.match(scene, /three-scheme-ensemble/);
  assert.match(scene, /createEnsembleSchemeRig/);
  assert.match(scene, /updateEnsembleSchemeRig/);
  assert.match(scene, /parallelSchemes/);
  assert.match(scene, /selectedSchemeIndex/);
  assert.match(scene, /ensembleCarouselAngle/);
  assert.match(scene, /orbitAngle/);
  assert.match(scene, /parallelScreenOffset/);
  assert.match(scene, /projectedSchemeCenter/);
  assert.match(scene, /layoutHost\.style\.setProperty/);
  assert.match(scene, /createBioRiskGeometry/);
  assert.match(scene, /surfaceFlowBlend/);
  assert.match(scene, /regional-surface-patch-geometry/);
  assert.match(scene, /projectSurfacePoint/);
  assert.match(scene, /surfacePatchCache/);
  assert.match(scene, /aGrooveDepth/);
  assert.match(scene, /normal \* aGrooveDepth \* carveAmount/);
  assert.match(scene, /modelUnitsPerUm = normalization \/ 1000/);
  assert.match(scene, /surfacePattern/);
  assert.match(scene, /uPhysical0/);
  assert.match(scene, /carveFront/);
  assert.match(scene, /focusRegionId/);
  assert.match(scene, /13_062 \/ pitchUm/);
  assert.match(scene, /reconstructionLightWave/);
  assert.match(scene, /reconstructionLightWaveMaterial/);
  assert.match(scene, /uWavePosition/);
  assert.match(scene, /curvedCoordinate/);
  assert.match(scene, /echoWave/);
  assert.match(scene, /readyEnteredAt/);
  assert.match(scene, /loopProgress/);
  assert.doesNotMatch(scene, /addReconstructionAttributes|aRepairInfluence|uCompare|uResidualOpacity|uInspection/);
  assert.match(scene, /if \(field < 0\.008\) discard/);
  assert.doesNotMatch(scene, /float active =/);
  assert.doesNotMatch(scene, /const scanLine/);
  assert.doesNotMatch(scene, /makePatternTexture/);
  assert.match(reconstruction, /stageProgress/);
  assert.match(reconstruction, /reconstructionLightWave/);
  assert.doesNotMatch(reconstruction, /LOCAL PATCH SYNTHESIS|同位轮廓剖分校验|珍珠陶瓷表面/);
  assert.match(reconstruction, /stepDurations/);
  assert.match(twin, /phaseProgress/);
  assert.match(twin, /phaseDurations/);
  assert.match(twin, /分区均衡方案/);
  assert.match(twin, /双峰承力岛/);
  assert.match(twin, /龈侧环流带/);
  assert.match(twin, /纵向交换支路/);
  assert.match(twin, /主接触峰群/);
  assert.match(twin, /承力脊桥/);
  assert.match(twin, /layout: "protect-crescent"/);
  assert.match(twin, /保持光滑/);
  assert.match(twin, /不雕刻/);
  assert.match(twin, /regionalTextures=\{scheme\.regions\}/);
  assert.match(twin, /parallelSchemes=\{parallelSchemeRegions\}/);
  assert.match(twin, /selectedSchemeIndex=\{schemeIndex\}/);
  assert.match(twin, /parallel-scheme-rail/);
  assert.match(twin, /pattern: "wave"/);
  assert.match(twin, /pattern: "straight"/);
  assert.match(twin, /micro-modeling-sequence/);
  assert.match(twin, /region-color-legend/);
  assert.match(twin, /surface-design-readout/);
  assert.match(twin, /区域生长/);
  assert.match(twin, /纹理匹配/);
  assert.match(twin, /逐区雕刻/);
  assert.match(twin, /基线孪生/);
  assert.match(twin, /候选复算/);
  assert.match(twin, /BASELINE TWIN/);
  assert.match(twin, /CANDIDATE RE-SOLVE/);
  assert.match(twin, /对颌咬合面接近/);
  assert.match(twin, /局部涡旋演化/);
  assert.match(twin, /矿化晶核形成/);
  assert.match(twin, /当前为前端演示仿真/);
  assert.match(twin, /颜色对应区域，沟槽形态对应纹理类型/);
  assert.doesNotMatch(twin, /MicroTextureLens|micro-viewport-shell|600 × 440 μm/);
  assert.doesNotMatch(twin, /六边贯通型|波浪四边型|梯度三边型/);
  assert.match(styles, /stage-transition-veil/);
  assert.match(styles, /stage-bridge/);
  assert.match(styles, /modeling-path-solve/);
  assert.match(styles, /region-color-legend/);
  assert.match(styles, /surface-region-inspector/);
  assert.match(styles, /simulation-director/);
  assert.match(styles, /simulation-evidence/);
  assert.match(styles, /parallel-scheme-rail/);
  assert.match(styles, /var\(--scheme-1-x,24%\)/);
  assert.doesNotMatch(styles, /reconstruction-compare-guide|reconstruction-result-signature|repair-evidence/);
});
