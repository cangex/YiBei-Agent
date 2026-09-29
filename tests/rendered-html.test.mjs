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
  assert.match(html, /精准口腔微生态调控专家/);
  assert.match(html, /以仿生微织构，探寻智能口腔修复体/);
  assert.match(html, /未来式/);
  assert.match(html, /口腔修复体扫描平台，规划中/);
  assert.match(html, /义齿三维轮廓超精准重建智能体/);
  assert.match(html, /双微AI设计智能体及验证平台/);
  assert.match(html, /仿生微纳织构加工平台，规划中/);
  assert.match(html, /src="\/brand\/yibei-medical-logo\.png"/);
  assert.match(html, /href="\/reconstruction"/);
  assert.match(html, /href="\/twin-ai"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/);
});

test("homepage restores the single scanned molar above four product entries", async () => {
  const [homepage, experience, heroScene, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HomeProductExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HeroToothScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(homepage, /HomeProductExperience/);
  assert.match(homepage, /home-brand-logo/);
  assert.match(experience, /HeroToothScene/);
  assert.doesNotMatch(experience, /HeroSurfaceEvolution|surface-stage-readouts/);
  assert.match(experience, /home-product-rail/);
  assert.match(experience, /home-product-track/);
  assert.match(experience, /aria-disabled="true"/);
  assert.match(experience, /STRUCTURED SURFACE CAPTURE/);
  assert.match(experience, /NORMAL · CURVATURE · DEPTH/);
  assert.match(experience, /home-single-tooth-model/);
  assert.match(experience, /onMouseEnter/);
  assert.match(experience, /onFocus/);
  assert.match(experience, /autoMode/);
  assert.match(experience, /effectiveMode/);
  assert.match(experience, /href: "\/reconstruction"/);
  assert.match(experience, /href: "\/twin-ai"/);
  assert.doesNotMatch(experience, /ENTER PRODUCT|PLANNED ·/);
  assert.doesNotMatch(experience, /type="button" disabled aria-label="口腔修复体扫描平台/);
  assert.doesNotMatch(homepage, /以仿生微织构，<br \/>/);
  assert.match(styles, /\.home-hero \.hero-title \{[^}]*white-space: nowrap/);
  assert.match(styles, /\.home-product-track \{[^}]*grid-template-columns: repeat\(4/);
  assert.match(styles, /\.home-product-experience \{[^}]*grid-template-rows: minmax\(310px, 1fr\) auto/);
  assert.match(styles, /\.home-product-rail \{[^}]*margin: clamp\(10px, 1\.5vh, 18px\)/);
  assert.match(styles, /\.home-product-node \{ width: 44px; height: 44px/);
  assert.match(styles, /\.home-product-entry strong \{[^}]*font-size: clamp\(16px, 1\.25vw, 19px\)/);
  assert.match(styles, /\.home-single-tooth-model \{[^}]*width: min\(392px, 44vw\)/);
  assert.match(styles, /\.home-product-experience \.single-tooth-hero-stage/);
  assert.match(styles, /home-product-line-in/);
  assert.match(styles, /home-product-signal/);
  assert.doesNotMatch(styles, /home-planned-scan|home-planned-orbit/);
  assert.doesNotMatch(homepage, /className="brand-mark"/);
  assert.match(heroScene, /ShaderMaterial/);
  assert.match(heroScene, /STLLoader/);
  assert.match(heroScene, /standard-molar\.stl/);
  assert.match(heroScene, /ROOT_COMPRESSION = 0\.18/);
  assert.match(heroScene, /MODEL_SCALE = 0\.75/);
  assert.match(heroScene, /createSliceProfile/);
  assert.match(heroScene, /createPointCloud/);
  assert.match(heroScene, /createNormalField/);
  assert.match(heroScene, /uScanY/);
  assert.match(heroScene, /prefers-reduced-motion/);
  assert.doesNotMatch(heroScene, /demo\.stl/);
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
  assert.match(reconstruction, /src="\/brand\/yibei-medical-logo\.png"/);
  assert.match(twin, /<title>双微AI设计智能体及验证平台｜益贝医疗智能体<\/title>/);
  assert.match(twin, /启动双微AI设计/);
  assert.match(twin, /五区均衡方案/);
  assert.match(twin, /不雕刻/);
  assert.doesNotMatch(twin, /yibei-medical-logo\.png/);
});

test("ships the reconstruction brand logo as a transparent page asset", async () => {
  const [logo, nav, reconstruction, styles] = await Promise.all([
    stat(new URL("../public/brand/yibei-medical-logo.png", import.meta.url)),
    readFile(new URL("../app/components/ProductNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ReconstructionExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.ok(logo.size > 50_000);
  assert.match(nav, /brandVariant/);
  assert.match(nav, /product-brand-logo/);
  assert.match(styles, /--signal: #24b7c7/);
  assert.match(styles, /\.processing-caption-heading b/);
  assert.match(styles, /--product-bg: #f5fbfc/);
  assert.match(styles, /--product-muted: #55767b/);
  assert.match(styles, /\.process-step \{[^}]*opacity: 1/);
  assert.match(styles, /\.reconstruction-page \.step-title-row strong \{ color: #365e64/);
  assert.match(styles, /Reconstruction brand theme: medical white \+ logo cyan/);
  assert.match(styles, /linear-gradient\(145deg, #12a8ba 0%, #24b7c7 48%, #43c7d2 100%\)/);
  assert.match(styles, /\.product-brand-logo/);
});

test("ships the real STL demonstration model", async () => {
  const model = await stat(new URL("../public/models/demo.stl", import.meta.url));
  assert.ok(model.size > 2_000_000);
});

test("retains the CC0 compact molar asset for possible future use", async () => {
  const [model, notices] = await Promise.all([
    stat(new URL("../public/models/standard-molar.stl", import.meta.url)),
    readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
  ]);
  assert.ok(model.size > 1_200_000);
  assert.match(notices, /CC0 1\.0/);
  assert.match(notices, /c25d75c8c3d03d5323471168d35a0396f7187bab/);
});

test("product scenes use precision scanning, dense on-model regional microgeometry, and continuous transitions", async () => {
  const [scene, reconstruction, reconstructionDetail, reconstructionPatch, twin, styles] = await Promise.all([
    readFile(new URL("../app/components/DentalScene.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ReconstructionExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ReconstructionDetailOverlay.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/ReconstructionPatchScene.tsx", import.meta.url), "utf8"),
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
  assert.match(scene, /AnatomicalCrownZone/);
  assert.match(scene, /classifyCrownTriangle/);
  assert.match(scene, /createAnatomicalSurfacePatchRig/);
  assert.match(scene, /five-zone-anatomical-crown-atlas/);
  assert.match(scene, /anatomicalProjectionConfig/);
  assert.match(scene, /projectAnatomicalSurfacePoint/);
  assert.match(scene, /axisBins/);
  assert.match(scene, /anatomicalZoneOrder/);
  assert.match(scene, /occlusalBoundary/);
  assert.match(scene, /createThinFilmFlowMaterial/);
  assert.match(scene, /configureThinFilmFlowResponse/);
  assert.match(scene, /movingRibbons/);
  assert.match(scene, /filmThickness/);
  assert.match(scene, /travelingCrest/);
  assert.match(scene, /vFilmHeight/);
  assert.match(scene, /heightGradient/);
  assert.match(scene, /capillaryFlow/);
  assert.doesNotMatch(scene, /createSurfaceFlowParticleMaterial|surface-flow-streamlines|flowStreakGeometry/);
  assert.match(scene, /MICROTEXTURE_COLORS/);
  assert.match(scene, /microtextureColorCss/);
  assert.match(scene, /reverseWinding/);
  assert.doesNotMatch(scene, /anatomicalZoneColors/);
  assert.match(scene, /regionSuitabilityScore/);
  assert.match(scene, /surfaceShape/);
  assert.match(scene, /sampledRegionPaths/);
  assert.match(scene, /CatmullRomCurve3/);
  assert.match(scene, /pointInsideSplineOutline/);
  assert.match(scene, /nearestSplineLocation/);
  assert.match(scene, /splineRegionScore/);
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
  assert.match(scene, /phaseShowsRegionalDesign/);
  assert.match(scene, /const regionalLayerAllowed = phaseShowsRegionalDesign/);
  assert.match(scene, /regionalOpacity = !showRegionalDesign/);
  assert.doesNotMatch(scene, /visual\.phase === "baseline" && visual\.simulationField === "fusion"/);
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
  assert.match(scene, /createThinFilmFlowMaterial/);
  assert.match(scene, /softPool/);
  assert.match(scene, /vortexRibbon/);
  assert.match(scene, /exchangeThreads/);
  assert.match(scene, /configureThinFilmFlowBounds/);
  assert.match(scene, /convergenceFilm/);
  assert.match(scene, /createBioFilmMaterial/);
  assert.match(scene, /createBioNetworkRig/);
  assert.match(scene, /createBioEntityRig/);
  assert.match(scene, /InstancedMesh/);
  assert.match(scene, /createFusionLayerRig/);
  assert.match(scene, /createIsoContourGeometry/);
  assert.match(scene, /createFusionConstraintGeometry/);
  assert.match(scene, /createFusionConflictGeometry/);
  assert.match(scene, /updateFusionLayerRig/);
  assert.match(scene, /constraintLines/);
  assert.match(scene, /conflictPoints/);
  assert.match(scene, /confidenceLines/);
  assert.match(twin, /约束路径对齐/);
  assert.match(twin, /冲突节点消解/);
  assert.match(twin, /咬合面区/);
  assert.match(twin, /颊侧区（前）/);
  assert.match(twin, /舌侧区（后）/);
  assert.match(twin, /近中侧区（左）/);
  assert.match(twin, /远中侧区（右）/);
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
  assert.match(scene, /fluidResponses/);
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
  assert.match(scene, /showScannerOverlay/);
  assert.match(scene, /comparisonAppearance/);
  assert.match(scene, /reconstructionMaterialProgress/);
  assert.match(scene, /createReconstructionSurfaceMaterial/);
  assert.match(scene, /uRepairProgress/);
  assert.match(scene, /unified-reconstruction-surface/);
  assert.match(scene, /uWorkflowActive/);
  assert.match(scene, /reconstructedColor/);
  assert.match(scene, /position \+ normal \* uSurfaceOffset/);
  assert.doesNotMatch(scene, /reconstructionSurfaceMesh/);
  assert.match(scene, /repairSweepActive/);
  assert.match(scene, /RECONSTRUCTION_BEFORE_SURFACE/);
  assert.match(scene, /uVitality/);
  assert.match(scene, /visual\.showScannerOverlay && visual\.phase !== "validate" && state\.scan > 0\.01/);
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
  assert.match(scene, /reconstructionFocusRotations/);
  assert.match(scene, /reconstructionFocusTilts/);
  assert.match(scene, /reconstructionFocusHeights/);
  assert.match(reconstructionDetail, /OCCLUSAL FISSURE/);
  assert.match(reconstructionDetail, /BUCCAL SURFACE/);
  assert.match(reconstructionDetail, /MESIAL · CERVICAL MARGIN/);
  assert.match(reconstructionDetail, /DISTAL SIDEWALL/);
  assert.match(reconstructionDetail, /EDGE SEARCH/);
  assert.match(reconstructionDetail, /TOPOLOGY RELINK/);
  assert.match(reconstructionDetail, /MEMBRANE GROW/);
  assert.match(reconstructionDetail, /GROOVE SCULPT/);
  assert.match(reconstructionDetail, /activeStep !== 2/);
  assert.match(reconstructionDetail, /RECONSTRUCTION_DETAIL_REGIONS\.slice\(0, detail\.regionIndex \+ 1\)/);
  assert.match(reconstructionDetail, /局部三维异常发现与轮廓修复计算细节/);
  assert.match(reconstructionPatch, /WebGLRenderer/);
  assert.match(reconstructionPatch, /createMarginRig/);
  assert.match(reconstructionPatch, /createTopologyRig/);
  assert.match(reconstructionPatch, /createHoleRig/);
  assert.match(reconstructionPatch, /createFissureRig/);
  assert.match(reconstructionPatch, /TubeGeometry/);
  assert.match(reconstructionPatch, /fanTriangles/);
  assert.match(reconstructionPatch, /createSurfaceApronGeometry/);
  assert.match(reconstructionPatch, /createHoleWallGeometry/);
  assert.match(reconstructionPatch, /bridgeFaces/);
  assert.match(reconstructionPatch, /sculptedSurface/);
  assert.match(reconstructionPatch, /shadowMap\.enabled = true/);
  assert.match(reconstructionPatch, /shadowMap\.autoUpdate = false/);
  assert.match(reconstructionPatch, /1000 \/ 30/);
  assert.match(scene, /maximumPixelRatio/);
  assert.match(scene, /applyPixelRatio/);
  assert.match(scene, /material\.visible = false/);
  assert.match(scene, /reconstructionLightWaveMaterial\.visible/);
  assert.match(scene, /IntersectionObserver/);
  assert.match(scene, /precision-validation-rig/);
  assert.match(scene, /createPrecisionValidationRig/);
  assert.match(scene, /updatePrecisionValidationRig/);
  assert.match(scene, /aValidationResidual/);
  assert.match(scene, /confidenceMaterial/);
  assert.match(scene, /validationRotation/);
  assert.match(styles, /\.reconstruction-detail-viewport/);
  assert.match(styles, /\.detail-focus-locator/);
  assert.match(styles, /\.reconstruction-patch-webgl/);
  assert.match(styles, /\.precision-validation-hud/);
  assert.match(styles, /validation-phase-solve/);
  assert.match(twin, /phaseProgress/);
  assert.match(twin, /phaseDurations/);
  assert.match(twin, /五区均衡方案/);
  assert.match(twin, /anatomicalZone: "occlusal"/);
  assert.match(twin, /anatomicalZone: "buccal"/);
  assert.match(twin, /anatomicalZone: "lingual"/);
  assert.match(twin, /anatomicalZone: "mesial"/);
  assert.match(twin, /anatomicalZone: "distal"/);
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
  assert.match(twin, /局部滞留与涡旋演化/);
  assert.match(twin, /液膜分流与厚度演化/);
  assert.match(twin, /矿化晶核形成/);
  assert.match(twin, /当前为前端演示仿真/);
  assert.match(twin, /每一处微织构/);
  assert.match(twin, /都经过<em>数字孪生<\/em><br \/><span>预演/);
  assert.match(twin, /microtextureColorCss/);
  assert.match(twin, /颜色与沟槽形态共同对应微织构类型/);
  assert.doesNotMatch(twin, /region-color-[1-5]/);
  assert.doesNotMatch(twin, /MicroTextureLens|micro-viewport-shell|600 × 440 μm/);
  assert.doesNotMatch(twin, /六边贯通型|波浪四边型|梯度三边型/);
  assert.match(styles, /stage-transition-veil/);
  assert.match(styles, /stage-bridge/);
  assert.match(styles, /reconstruction-comparison/);
  assert.match(styles, /comparison-metrics/);
  assert.match(styles, /comparison-metric-arrow-head/);
  assert.match(styles, /processing-progress i::after/);
  assert.match(styles, /width: min\(660px, calc\(100% - 150px\)\)/);
  assert.match(styles, /process-step\.is-active \.step-title-row strong/);
  assert.match(styles, /process-step\.is-active \.step-note-en/);
  assert.match(styles, /--run-signal: #ff654f/);
  assert.match(styles, /conic-gradient\(var\(--run-signal\)/);
  assert.match(styles, /process-marker-breathe/);
  assert.match(styles, /process-rail-tail/);
  assert.match(styles, /process-step-scan/);
  assert.match(styles, /reconstruction-intro-action/);
  assert.match(styles, /modeling-path-solve/);
  assert.match(styles, /region-color-legend/);
  assert.match(styles, /surface-region-inspector/);
  assert.match(styles, /simulation-director/);
  assert.match(styles, /simulation-evidence/);
  assert.match(styles, /parallel-scheme-rail/);
  assert.match(styles, /var\(--scheme-1-x,24%\)/);
  assert.doesNotMatch(styles, /reconstruction-compare-guide|reconstruction-result-signature|repair-evidence/);
});
