"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { DentalScene, DentalSceneMode, DentalScenePhase, microtextureColorCss, RegionalTextureRegion, SimulationField } from "./DentalScene";
import { ProductNav } from "./ProductNav";

const phases = [
  { title: "模型接入", short: "接收重建表面" },
  { title: "基线孪生", short: "求解力学、流体与微生态基线场" },
  { title: "联合设计", short: "依据融合场决定区域与微织构" },
  { title: "候选复算", short: "将设计方案回传孪生模型重新评估" },
  { title: "联合收敛", short: "输出区域—纹理联合推荐" },
];

type SchemeRegion = RegionalTextureRegion & {
  name: string;
  topology: string;
  widthUm: number;
  depthUm: number;
  pitchUm: number;
  score: number;
};

type Scheme = {
  code: string;
  name: string;
  fit: number;
  reason: string;
  metrics: number[];
  regions: SchemeRegion[];
};

const schemes: Scheme[] = [
  {
    code: "A-RG",
    name: "五区均衡方案",
    fit: 94,
    reason: "孪生评估建议在完整咬合面、颊侧与近中侧雕刻，舌侧和远中侧保留原表面，在承力、交换与微生态风险之间取得平衡。",
    metrics: [92, 89, 86, 91, 88],
    regions: [
      { id: "R1", name: "咬合面区", anatomicalZone: "occlusal", enabled: true, pattern: "topology", topology: "六边拓扑", sides: 6, wave: false, textureAngle: 0.08, widthUm: 38, depthUm: 20, pitchUm: 168, score: 97 },
      { id: "R2", name: "颊侧区（前）", anatomicalZone: "buccal", enabled: true, pattern: "wave", topology: "波浪线流道", sides: 4, wave: true, textureAngle: 0.12, widthUm: 42, depthUm: 17, pitchUm: 120, score: 94 },
      { id: "R3", name: "舌侧区（后）", anatomicalZone: "lingual", enabled: false, pattern: "topology", topology: "保持光滑", sides: 3, wave: false, widthUm: 0, depthUm: 0, pitchUm: 160, score: 91 },
      { id: "R4", name: "近中侧区（左）", anatomicalZone: "mesial", enabled: true, pattern: "topology", topology: "四边拓扑", sides: 4, wave: false, textureAngle: -0.08, widthUm: 34, depthUm: 18, pitchUm: 154, score: 92 },
      { id: "R5", name: "远中侧区（右）", anatomicalZone: "distal", enabled: false, pattern: "topology", topology: "保持光滑", sides: 3, wave: false, widthUm: 0, depthUm: 0, pitchUm: 160, score: 90 },
    ],
  },
  {
    code: "B-FL",
    name: "交换优先方案",
    fit: 87,
    reason: "咬合面保留原表面，四个侧面分别生成波浪或直线流道，形成环绕牙冠的高交换方案，但雕刻覆盖率更高。",
    metrics: [80, 96, 79, 86, 82],
    regions: [
      { id: "R1", name: "咬合面区", anatomicalZone: "occlusal", enabled: false, pattern: "topology", topology: "保持光滑", sides: 6, wave: false, widthUm: 0, depthUm: 0, pitchUm: 168, score: 92 },
      { id: "R2", name: "颊侧区（前）", anatomicalZone: "buccal", enabled: true, pattern: "wave", topology: "波浪线流道", sides: 4, wave: true, textureAngle: 0.14, widthUm: 45, depthUm: 16, pitchUm: 124, score: 98 },
      { id: "R3", name: "舌侧区（后）", anatomicalZone: "lingual", enabled: true, pattern: "straight", topology: "直线流道", sides: 4, wave: false, textureAngle: 1.42, widthUm: 36, depthUm: 15, pitchUm: 112, score: 96 },
      { id: "R4", name: "近中侧区（左）", anatomicalZone: "mesial", enabled: true, pattern: "wave", topology: "波浪线流道", sides: 4, wave: true, textureAngle: 0.24, widthUm: 40, depthUm: 17, pitchUm: 118, score: 95 },
      { id: "R5", name: "远中侧区（右）", anatomicalZone: "distal", enabled: true, pattern: "straight", topology: "直线流道", sides: 4, wave: false, textureAngle: 1.36, widthUm: 32, depthUm: 15, pitchUm: 108, score: 94 },
    ],
  },
  {
    code: "C-ST",
    name: "承力优先方案",
    fit: 84,
    reason: "咬合面使用五边拓扑，舌侧与远中侧采用局部拓扑强化，颊侧和近中侧保持光滑，减少侧壁雕刻对结构的扰动。",
    metrics: [97, 71, 92, 83, 95],
    regions: [
      { id: "R1", name: "咬合面区", anatomicalZone: "occlusal", enabled: true, pattern: "topology", topology: "五边拓扑", sides: 5, wave: false, textureAngle: -0.1, widthUm: 34, depthUm: 23, pitchUm: 150, score: 99 },
      { id: "R2", name: "颊侧区（前）", anatomicalZone: "buccal", enabled: false, pattern: "topology", topology: "保持光滑", sides: 4, wave: false, widthUm: 0, depthUm: 0, pitchUm: 160, score: 93 },
      { id: "R3", name: "舌侧区（后）", anatomicalZone: "lingual", enabled: true, pattern: "topology", topology: "三边拓扑", sides: 3, wave: false, textureAngle: 0.16, widthUm: 30, depthUm: 21, pitchUm: 142, score: 95 },
      { id: "R4", name: "近中侧区（左）", anatomicalZone: "mesial", enabled: false, pattern: "topology", topology: "保持光滑", sides: 4, wave: false, widthUm: 0, depthUm: 0, pitchUm: 160, score: 92 },
      { id: "R5", name: "远中侧区（右）", anatomicalZone: "distal", enabled: true, pattern: "topology", topology: "六边拓扑", sides: 6, wave: false, textureAngle: -0.14, widthUm: 36, depthUm: 24, pitchUm: 172, score: 96 },
    ],
  },
];
const parallelSchemeRegions = schemes.map((scheme) => scheme.regions);

function microtextureColorStyle(region: RegionalTextureRegion) {
  return { "--region-color": microtextureColorCss(region) } as CSSProperties;
}

const metricNames = ["结构稳定", "流体交换", "抗沉积", "抗菌定植", "疲劳耐受"];
const visualPhases: DentalScenePhase[] = ["ingress", "baseline", "generate", "recalculate", "converge"];
const phaseDurations = [1800, 21000, 7200, 16000, 2300];
const modelingSteps = ["融合场锁定", "区域生长", "纹理匹配", "逐区雕刻"];
const simulationFields: Array<{ id: Exclude<SimulationField, "none">; name: string; code: string; note: string }> = [
  { id: "mechanics", name: "力学响应场", code: "MECHANICAL", note: "应力集中 · 结构稳定 · 疲劳风险" },
  { id: "fluid", name: "表面流体场", code: "SURFACE FLOW", note: "交换速率 · 流线组织 · 滞留风险" },
  { id: "bio", name: "微生态风险场", code: "MICROECOLOGY", note: "吸附倾向 · 矿化沉积 · 定植风险" },
  { id: "fusion", name: "多场融合", code: "FIELD FUSION", note: "作为区域与微织构设计的数据依据" },
];
const simulationStages: Record<Exclude<SimulationField, "none">, Array<{ end: number; label: string; code: string }>> = {
  mechanics: [
    { end: 0.14, label: "建立固定边界", code: "BOUNDARY LOCK" },
    { end: 0.3, label: "对颌咬合面接近", code: "OCCLUSAL APPROACH" },
    { end: 0.48, label: "多接触斑分级加载", code: "CONTACT RAMP" },
    { end: 0.7, label: "主应力路径传播", code: "STRESS TRANSFER" },
    { end: 1, label: "疲劳循环与稳定", code: "FATIGUE CYCLE" },
  ],
  fluid: [
    { end: 0.2, label: "唾液薄膜润湿", code: "SURFACE WETTING" },
    { end: 0.45, label: "速度场与流迹建立", code: "FLOW ADVECTION" },
    { end: 0.68, label: "分流、汇流与滞留", code: "RETENTION SOLVE" },
    { end: 0.88, label: "局部涡旋演化", code: "VORTEX EVOLUTION" },
    { end: 1, label: "表面交换通量", code: "EXCHANGE FLUX" },
  ],
  bio: [
    { end: 0.22, label: "唾液条件膜形成", code: "CONDITIONING FILM" },
    { end: 0.44, label: "蛋白吸附累积", code: "ADSORPTION" },
    { end: 0.64, label: "矿化晶核形成", code: "MINERAL NUCLEATION" },
    { end: 0.79, label: "微生物接近与黏附", code: "CELL ADHESION" },
    { end: 1, label: "定植网络扩张", code: "COLONY GROWTH" },
  ],
  fusion: [
    { end: 0.18, label: "三场空间分层", code: "FIELD SEPARATION" },
    { end: 0.45, label: "约束路径对齐", code: "CONSTRAINT ALIGN" },
    { end: 0.7, label: "冲突节点消解", code: "CONFLICT RESOLVE" },
    { end: 1, label: "设计置信场收敛", code: "DESIGN CONFIDENCE" },
  ],
};
const simulationEvidence: Record<Exclude<SimulationField, "none">, Array<{ label: string; baseline: string; candidate: string }>> = {
  mechanics: [
    { label: "应力集中", baseline: "0.78", candidate: "0.61" },
    { label: "结构稳定", baseline: "0.72", candidate: "0.86" },
    { label: "疲劳风险", baseline: "0.46", candidate: "0.34" },
  ],
  fluid: [
    { label: "交换能力", baseline: "0.57", candidate: "0.82" },
    { label: "局部滞留", baseline: "0.69", candidate: "0.41" },
    { label: "流线连续", baseline: "0.63", candidate: "0.88" },
  ],
  bio: [
    { label: "吸附倾向", baseline: "0.64", candidate: "0.45" },
    { label: "矿化风险", baseline: "0.58", candidate: "0.39" },
    { label: "定植风险", baseline: "0.71", candidate: "0.43" },
  ],
  fusion: [
    { label: "承力需求", baseline: "0.81", candidate: "0.91" },
    { label: "交换需求", baseline: "0.74", candidate: "0.89" },
    { label: "设计置信", baseline: "0.67", candidate: "0.94" },
  ],
};

function resolveSimulationState(phase: number, progress: number, complete: boolean): { field: SimulationField; progress: number } {
  if (complete) return { field: "none", progress: 0 };
  if (phase === 1) {
    if (progress < 0.25) return { field: "mechanics", progress: progress / 0.25 };
    if (progress < 0.52) return { field: "fluid", progress: (progress - 0.25) / 0.27 };
    if (progress < 0.72) return { field: "bio", progress: (progress - 0.52) / 0.2 };
    return { field: "fusion", progress: (progress - 0.72) / 0.28 };
  }
  if (phase === 3) {
    if (progress < 0.22) return { field: "mechanics", progress: progress / 0.22 };
    if (progress < 0.49) return { field: "fluid", progress: (progress - 0.22) / 0.27 };
    if (progress < 0.71) return { field: "bio", progress: (progress - 0.49) / 0.22 };
    return { field: "fusion", progress: (progress - 0.71) / 0.29 };
  }
  return { field: "none", progress: 0 };
}

function ease(value: number) {
  return value * value * (3 - 2 * value);
}

export function TwinAIExperience() {
  const [modelSrc] = useState(() => {
    if (typeof window === "undefined") return "/models/demo.stl";
    return (window as unknown as { __YIBEI_MODEL_URL__?: string }).__YIBEI_MODEL_URL__ || "/models/demo.stl";
  });
  const [phase, setPhase] = useState(0);
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [schemeIndex, setSchemeIndex] = useState(0);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [phaseProgress, setPhaseProgress] = useState(0);
  const runToken = useRef(0);

  useEffect(() => {
    if (!running) return;
    const token = runToken.current;
    const startedAt = performance.now();
    const duration = phaseDurations[phase];
    let timer = 0;
    const tick = () => {
      if (token !== runToken.current) return;
      const fraction = Math.min(1, (performance.now() - startedAt) / duration);
      setPhaseProgress(fraction);
      if (fraction >= 1) {
        if (phase >= phases.length - 1) {
          setRunning(false);
          setComplete(true);
        } else {
          setPhaseProgress(0);
          setPhase((value) => value + 1);
        }
        return;
      }
      timer = window.setTimeout(tick, 42);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [phase, running]);

  const begin = () => {
    runToken.current += 1;
    setPhase(0);
    setPhaseProgress(0);
    setSchemeIndex(0);
    setSelectedRegionId(null);
    setComplete(false);
    setRunning(true);
  };

  const scheme = schemes[schemeIndex];
  const engravedRegions = scheme.regions.filter((region) => region.enabled);
  const activeRegionIndex = running && phase === 2
    ? Math.min(engravedRegions.length - 1, Math.floor(phaseProgress * engravedRegions.length))
    : 0;
  const focusRegion = engravedRegions[activeRegionIndex] ?? scheme.regions[0];
  const inspectedRegion = scheme.regions.find((region) => region.id === selectedRegionId) ?? focusRegion;
  const sceneFocusRegionId = running && phase === 2
    ? focusRegion.id
    : selectedRegionId ?? undefined;
  const textureTypeCount = new Set(engravedRegions.map((region) => region.topology)).size;
  const simulationState = resolveSimulationState(phase, phaseProgress, complete);
  const simulationField = simulationState.field;
  const sceneMode = useMemo<DentalSceneMode>(() => {
    if (phase === 0) return "porcelain";
    if (phase === 1) return "porcelain";
    if (phase === 2) return "texture";
    if (phase === 3) return simulationField === "fluid" ? "flow" : "texture";
    return "texture";
  }, [phase, simulationField]);
  const visibleScheme = phase >= 2 || complete;
  const simulationReady = phase >= 3 || complete;
  const parallelEnsembleVisible = running && phase >= 2;
  const schemeRailVisible = parallelEnsembleVisible || complete;
  const regionalLayoutVisible = complete || (running && phase >= 2);
  const regionalCalloutsVisible = complete || (running && phase === 4 && phaseProgress > 0.72);
  const scenePhase: DentalScenePhase = complete ? "converge" : running ? visualPhases[phase] : "idle";
  const simulationFieldIndex = simulationFields.findIndex((field) => field.id === simulationField);
  const activeSimulationField = simulationFields[Math.max(0, simulationFieldIndex)];
  const activeSimulationStage = simulationStages[activeSimulationField.id].find((stage) => simulationState.progress <= stage.end)
    ?? simulationStages[activeSimulationField.id].at(-1)!;
  const simulationVisible = running && (phase === 1 || phase === 3);
  const overallProgress = complete ? 100 : running ? (phase + ease(phaseProgress)) / phases.length * 100 : 0;
  const modelingSequenceVisible = running && phase === 2 && !parallelEnsembleVisible;
  const modelingStep = phase === 2 ? Math.min(3, Math.floor(phaseProgress * 4)) : 0;
  return (
    <main className="product-page twin-page">
      <ProductNav section="双微AI设计智能体及验证平台" />

      <section className="twin-heading">
        <div>
          <span className="eyebrow">PRODUCT 02 · MICROTEXTURE × DIGITAL TWIN</span>
          <h1>每一处微织构，<br />都经过<em>数字孪生</em><br /><span>预演。</span></h1>
        </div>
        <div className="twin-heading-copy">
          <p>AI决定何处雕刻、雕刻何种微织构；数字孪生在制造前验证力学与生物特性。</p>
          <span><i className="live-dot" /> DIGITAL TWIN READY</span>
        </div>
      </section>

      <section className="twin-workspace">
        <div className="twin-scene-wrap">
          <DentalScene src={modelSrc} mode={sceneMode} phase={scenePhase} stageProgress={complete ? 1 : phaseProgress} simulationField={simulationField} simulationProgress={simulationState.progress} textureSides={focusRegion.sides} wave={focusRegion.wave} regionalTextures={scheme.regions} parallelSchemes={parallelSchemeRegions} selectedSchemeIndex={schemeIndex} focusRegionId={sceneFocusRegionId} interactive={!running} className="dental-scene twin-scene" />
          {running && <div key={`twin-bridge-${phase}`} className="stage-transition-veil twin-transition-veil" aria-hidden="true" />}
          <div key={`region-labels-${schemeIndex}`} className="regional-callout-layer">
            {scheme.regions.map((region, index) => (
              <button
                type="button"
                key={region.id}
                disabled={running || !regionalCalloutsVisible}
                aria-pressed={selectedRegionId === region.id}
                onClick={() => setSelectedRegionId((current) => current === region.id ? null : region.id)}
                onMouseEnter={() => { if (complete) setSelectedRegionId(region.id); }}
                className={`zone-callout zone-${index + 1} ${region.enabled ? "" : "is-untextured"} ${regionalCalloutsVisible ? "is-visible" : ""} ${sceneFocusRegionId === region.id || selectedRegionId === region.id ? "is-current" : ""}`}
                style={microtextureColorStyle(region)}
              >
                <i />{region.id} · {region.name}<b>{visibleScheme ? region.enabled ? region.topology : "不雕刻" : "候选区"}</b>
              </button>
            ))}
          </div>
          <div className="twin-scene-label"><span>曲面级数字镜像</span><strong>MICRO GEOMETRY / DT-2408</strong></div>
          {schemeRailVisible && (
            <div className={`parallel-scheme-rail ${running && phase === 4 ? "is-converging" : ""} ${complete ? "is-interactive" : ""}`} aria-label="三套并行候选方案">
              {schemes.map((candidate, index) => {
                const activeCandidateRegion = candidate.regions.filter((region) => region.enabled)[Math.min(candidate.regions.filter((region) => region.enabled).length - 1, Math.floor(phaseProgress * candidate.regions.filter((region) => region.enabled).length))] ?? candidate.regions[0];
                const fieldScore = simulationField === "mechanics" ? candidate.metrics[0]
                  : simulationField === "fluid" ? candidate.metrics[1]
                    : simulationField === "bio" ? candidate.metrics[3]
                      : candidate.fit;
                const labelOpacity = complete
                  ? schemeIndex === index ? 1 : 0.52
                  : phase === 4 && index !== 0 ? 1 - phaseProgress * 0.48 : 1;
                return (
                  <div
                    key={candidate.code}
                    className={`${complete ? schemeIndex === index ? "is-selected" : "" : phase === 4 && index === 0 ? "is-selected" : ""}`}
                    style={{ opacity: labelOpacity }}
                  >
                    <i />
                    <span>{candidate.code}</span>
                    <strong>{candidate.name}</strong>
                    <small>{complete ? schemeIndex === index ? "当前查看 · 空间聚焦" : "候选方案 · 保持可见" : phase === 2 ? `${activeCandidateRegion.id} · ${activeCandidateRegion.enabled ? activeCandidateRegion.topology : "保留原表面"}` : phase === 3 ? `${activeSimulationField.name} · ${fieldScore}` : index === 0 ? "联合收敛 · 优先推荐" : "候选权重降低"}</small>
                  </div>
                );
              })}
            </div>
          )}
          <div className={`simulation-director ${simulationVisible ? "is-visible" : ""}`} aria-hidden={!simulationVisible}>
            <div className="simulation-director-head">
              <span>{phase === 3 ? "CANDIDATE RE-SOLVE" : "BASELINE TWIN"}</span>
              <em>STEP {Math.round(simulationState.progress * 100).toString().padStart(3, "0")}</em>
            </div>
            <strong>{activeSimulationField.name}</strong>
            <small><b>{activeSimulationStage.code}</b><span>{activeSimulationStage.label} · {activeSimulationField.note}</span></small>
            <div className="simulation-field-sequence">
              {simulationFields.map((field, index) => (
                <i key={field.id} className={`${index === simulationFieldIndex ? "is-active" : ""} ${index < simulationFieldIndex ? "is-done" : ""}`}>
                  <b>0{index + 1}</b><span>{field.code}</span><em />
                </i>
              ))}
            </div>
          </div>
          <div className={`region-color-legend ${regionalLayoutVisible ? "is-visible" : ""}`} aria-label="微织构类型图例">
            <span>MICROTEXTURE TYPES</span>
            {scheme.regions.map((region) => (
              <button
                type="button"
                key={region.id}
                disabled={running}
                aria-pressed={selectedRegionId === region.id}
                onClick={() => setSelectedRegionId((current) => current === region.id ? null : region.id)}
                className={`${selectedRegionId === region.id || sceneFocusRegionId === region.id ? "is-current" : ""} ${region.enabled ? "" : "is-untextured"}`}
              >
                <i style={microtextureColorStyle(region)} /><strong>{region.id}</strong><small>{visibleScheme ? region.enabled ? region.topology : "保留原表面" : "候选表面区域"}</small>
              </button>
            ))}
          </div>
          <div className={`surface-design-readout ${regionalLayoutVisible ? "is-visible" : ""}`}>
            <span>{complete && !selectedRegionId ? "WHOLE-TOOTH LAYOUT" : `SURFACE REGION / ${inspectedRegion.id}`}</span>
            <strong>{complete && !selectedRegionId ? "整牙微织构布局已生成" : `${inspectedRegion.name} · ${inspectedRegion.enabled ? inspectedRegion.topology : "不雕刻"}`}</strong>
            <small>{complete && !selectedRegionId ? "颜色与沟槽形态共同对应微织构类型" : inspectedRegion.enabled ? `${inspectedRegion.widthUm} μm 宽 · ${inspectedRegion.depthUm} μm 深 · ${inspectedRegion.pitchUm} μm 间距` : "该区域保留测试 STL 原始陶瓷表面"}</small>
          </div>
          <div className={`micro-modeling-sequence surface-modeling-sequence ${modelingSequenceVisible ? "is-visible" : ""}`} aria-hidden={!modelingSequenceVisible}>
            <div><span>ON-SURFACE MICROGEOMETRY</span><em>{focusRegion.id} · {focusRegion.name}</em></div>
            {modelingSteps.map((step, index) => (
              <i key={step} className={`${index === modelingStep ? "is-active" : ""} ${index < modelingStep ? "is-done" : ""}`}>
                <b>0{index + 1}</b><strong>{step}</strong><span />
              </i>
            ))}
            <small>纹理直接映射于测试 STL 曲面</small>
          </div>
          {(running || complete) && <div key={`phase-readout-${phase}-${complete}-${simulationField}`} className="twin-phase-readout"><i>0{phase + 1}</i><strong>{complete ? "AI RECOMMENDATION READY" : simulationVisible ? activeSimulationStage.label : phases[phase].title}</strong><span>{Math.round(overallProgress).toString().padStart(2, "0")}%</span></div>}
        </div>

        <aside className="twin-intelligence">
          <div className="ai-state">
            <span>双微AI · 当前状态</span>
            <div key={`ai-copy-${phase}-${complete}`} className="ai-state-swap">
              <strong>{complete ? "方案已收敛" : running ? phases[phase].title : "等待启动"}</strong>
              <small>{complete ? "区域选择与纹理类型已通过五维联合评估" : running ? phases[phase].short : "启动后将逐区决定是否雕刻、纹理类型与参数"}</small>
            </div>
          </div>

          <div className={`simulation-evidence ${simulationVisible ? "is-visible" : ""}`}>
            <div><span>{phase === 3 ? "方案复算" : "基线求解"}</span><em>NORMALIZED FIELD</em></div>
            <strong>{activeSimulationField.name}</strong>
            <p>
              {simulationEvidence[activeSimulationField.id].map((item) => (
                <span key={item.label}><small>{item.label}</small><b>{phase === 3 ? `${item.baseline} → ${item.candidate}` : item.baseline}</b></span>
              ))}
            </p>
            <small>当前为前端演示仿真，指标经归一化处理，不用于临床决策。</small>
          </div>

          <div className={`surface-region-inspector ${visibleScheme && !simulationVisible && !parallelEnsembleVisible ? "is-visible" : ""} ${simulationVisible || parallelEnsembleVisible ? "is-suppressed" : ""}`}>
            <div><span><i style={microtextureColorStyle(inspectedRegion)} />SURFACE REGION</span><em>{inspectedRegion.id} / {inspectedRegion.name}</em></div>
            <strong>{inspectedRegion.enabled ? inspectedRegion.topology : "不雕刻 · 保留原表面"}</strong>
            <p><span><small>宽度</small><b>{inspectedRegion.enabled ? inspectedRegion.widthUm : "—"}<i>{inspectedRegion.enabled ? " μm" : ""}</i></b></span><span><small>深度</small><b>{inspectedRegion.enabled ? inspectedRegion.depthUm : "—"}<i>{inspectedRegion.enabled ? " μm" : ""}</i></b></span><span><small>间距*</small><b>{inspectedRegion.enabled ? inspectedRegion.pitchUm : "—"}<i>{inspectedRegion.enabled ? " μm" : ""}</i></b></span></p>
            <small>* 间距为当前 AI 演示方案设定；沟槽宽度与深度遵循资料范围。</small>
          </div>

          <div key={`region-decisions-${schemeIndex}`} className={`region-decision-stream ${visibleScheme && !simulationVisible && !parallelEnsembleVisible ? "is-visible" : ""} ${simulationVisible || parallelEnsembleVisible ? "is-suppressed" : ""}`} aria-label="分区雕刻决策">
            <div className="region-decision-head"><span>区域雕刻决策</span><em>仿真适配</em></div>
            {scheme.regions.map((region) => (
              <button type="button" key={region.id} disabled={running} onClick={() => setSelectedRegionId((current) => current === region.id ? null : region.id)} className={`${region.enabled ? "" : "is-untextured"} ${selectedRegionId === region.id ? "is-current" : ""}`} style={microtextureColorStyle(region)}>
                <i>{region.id}</i>
                <strong>{region.name}<small>{region.enabled ? `${region.widthUm} × ${region.depthUm} μm` : "保留原表面"}</small></strong>
                <em>{region.enabled ? region.topology : "不雕刻"}</em>
                <b>{simulationReady ? region.score : "—"}</b>
              </button>
            ))}
          </div>

          <div className={`parameter-stream ${visibleScheme && !simulationVisible && !parallelEnsembleVisible ? "is-visible" : ""} ${simulationVisible || parallelEnsembleVisible ? "is-suppressed" : ""}`}>
            <span><small>表面区域</small><strong>{scheme.regions.length}<i> 区</i></strong></span>
            <span><small>雕刻区域</small><strong>{engravedRegions.length}<i> 区</i></strong></span>
            <span><small>纹理类型</small><strong>{textureTypeCount}<i> 类</i></strong></span>
          </div>

          <button className="primary-orbit-button twin-run" type="button" onClick={begin} disabled={running}>
            <span>{running ? `正在执行 · ${phase + 1}/5` : complete ? "重新生成方案" : "启动双微AI设计"}</span><i aria-hidden="true">→</i>
          </button>
        </aside>

        <div className="phase-track" aria-label="双微AI流程" style={{ "--phase-progress": `${overallProgress}%` } as CSSProperties}>
          {phases.map((item, index) => (
            <button type="button" key={item.title} disabled={!complete} onClick={() => { if (complete) { setPhase(index); setPhaseProgress(1); } }} className={`${index === phase ? "is-active" : ""} ${index < phase || complete ? "is-done" : ""}`}>
              <i /><span>0{index + 1}</span><strong>{item.title}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className={`scheme-comparison ${complete ? "is-visible" : ""}`} aria-hidden={!complete}>
        <div className="comparison-heading">
          <span className="eyebrow">MULTI-OBJECTIVE CONVERGENCE</span>
          <h2>三套分区组合，<br />收敛为一张设计图。</h2>
          <p>每套方案同时改变雕刻区域、保留区域和各区纹理类型，再由数字孪生进行联合评估。</p>
        </div>

        <div className="scheme-orbit">
          <div className="scheme-orbit-line" aria-hidden="true" />
          {schemes.map((item, index) => (
            <button key={item.code} type="button" onClick={() => { setSchemeIndex(index); setSelectedRegionId(null); }} className={`scheme-node scheme-node-${index + 1} ${schemeIndex === index ? "is-active" : ""}`}>
              <span>{item.code}</span><strong>{item.name}</strong><em>{item.fit}%</em>
            </button>
          ))}
        </div>

        <div className="metric-field">
          {metricNames.map((name, index) => (
            <div className="metric-strand" key={name}>
              <span>{name}</span><i><b style={{ width: `${scheme.metrics[index]}%` }} /></i><strong>{scheme.metrics[index]}</strong>
            </div>
          ))}
        </div>

        <div className="ai-conclusion">
          <span>AI RECOMMENDATION</span>
          <strong>{schemeIndex === 0 ? "优先推荐" : "候选方案"} · {scheme.name}</strong>
          <p>{scheme.reason}</p>
          <div className="fit-number"><b>{scheme.fit}</b><small>/ 100<br />综合适配度</small></div>
        </div>
      </section>
    </main>
  );
}
