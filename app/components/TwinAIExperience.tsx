"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { DentalScene, DentalSceneMode, DentalScenePhase, RegionalTextureRegion } from "./DentalScene";
import { MicroTextureLens } from "./MicroTextureLens";
import { ProductNav } from "./ProductNav";

const phases = [
  { title: "模型接入", short: "接收重建表面" },
  { title: "区域解析", short: "分割承力、交换与保留区" },
  { title: "分区设计", short: "逐区决定是否雕刻及纹理类型" },
  { title: "孪生仿真", short: "评估每套分区组合的力学与微生态响应" },
  { title: "联合收敛", short: "输出区域—纹理联合推荐" },
];

type SchemeRegion = RegionalTextureRegion & {
  name: string;
  topology: string;
  width: number;
  depth: number;
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
    name: "分区均衡方案",
    fit: 94,
    reason: "孪生评估表明：咬合承力区采用六边拓扑，龈侧交换区采用波浪流道，邻接过渡区保持光滑，在结构稳定、流体交换与沉积风险之间取得最优平衡。",
    metrics: [92, 89, 86, 91, 88],
    regions: [
      { id: "R1", name: "咬合承力区", enabled: true, pattern: "topology", topology: "六边拓扑", sides: 6, wave: false, width: 38, depth: 19, score: 96, center: [0.34, 0.64, 0.55], radius: [0.29, 0.24, 0.78] },
      { id: "R2", name: "龈侧交换区", enabled: true, pattern: "wave", topology: "波浪线流道", sides: 4, wave: true, width: 42, depth: 17, score: 93, center: [0.69, 0.39, 0.52], radius: [0.23, 0.22, 0.76] },
      { id: "R3", name: "邻接过渡区", enabled: false, pattern: "topology", topology: "保持光滑", sides: 3, wave: false, width: 0, depth: 0, score: 91, center: [0.53, 0.82, 0.5], radius: [0.2, 0.16, 0.72] },
    ],
  },
  {
    code: "B-FL",
    name: "交换优先方案",
    fit: 87,
    reason: "两个流体薄弱区分别布置波浪线与直线流道，交换能力更强，但额外雕刻区使疲劳耐受和抗沉积表现略低于均衡方案。",
    metrics: [84, 93, 80, 83, 85],
    regions: [
      { id: "R1", name: "咬合承力区", enabled: true, pattern: "topology", topology: "四边拓扑", sides: 4, wave: false, width: 40, depth: 17, score: 87, center: [0.34, 0.64, 0.55], radius: [0.29, 0.24, 0.78] },
      { id: "R2", name: "龈侧交换区", enabled: true, pattern: "wave", topology: "波浪线流道", sides: 4, wave: true, width: 45, depth: 16, score: 97, center: [0.69, 0.39, 0.52], radius: [0.25, 0.23, 0.76] },
      { id: "R3", name: "邻接过渡区", enabled: true, pattern: "straight", topology: "直线流道", sides: 4, wave: false, width: 32, depth: 15, score: 83, center: [0.53, 0.82, 0.5], radius: [0.2, 0.16, 0.72] },
    ],
  },
  {
    code: "C-ST",
    name: "承力优先方案",
    fit: 81,
    reason: "仅在两个明确承力区雕刻六边与三边拓扑，其余表面保持光滑。结构表现稳定，但龈侧区不雕刻使流体交换能力有限。",
    metrics: [95, 74, 90, 82, 93],
    regions: [
      { id: "R1", name: "咬合承力区", enabled: true, pattern: "topology", topology: "六边拓扑", sides: 6, wave: false, width: 34, depth: 21, score: 98, center: [0.34, 0.64, 0.55], radius: [0.27, 0.23, 0.78] },
      { id: "R2", name: "龈侧交换区", enabled: false, pattern: "topology", topology: "保持光滑", sides: 4, wave: false, width: 0, depth: 0, score: 76, center: [0.69, 0.39, 0.52], radius: [0.23, 0.22, 0.76] },
      { id: "R3", name: "邻接过渡区", enabled: true, pattern: "topology", topology: "三边拓扑", sides: 3, wave: false, width: 29, depth: 23, score: 89, center: [0.53, 0.82, 0.5], radius: [0.19, 0.16, 0.72] },
    ],
  },
];
const schemeTexturePlans = schemes.map((scheme) => scheme.regions);

const metricNames = ["结构稳定", "流体交换", "抗沉积", "抗菌定植", "疲劳耐受"];
const visualPhases: DentalScenePhase[] = ["ingress", "segment", "generate", "simulate", "converge"];
const phaseDurations = [1800, 3000, 4800, 3800, 2300];
const modelingSteps = ["区域锁定", "路径求解", "沟槽建模"];

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
    setComplete(false);
    setRunning(true);
  };

  const scheme = schemes[schemeIndex];
  const focusRegion = scheme.regions.find((region) => region.enabled) ?? scheme.regions[0];
  const engravedRegions = scheme.regions.filter((region) => region.enabled);
  const textureTypeCount = new Set(engravedRegions.map((region) => region.topology)).size;
  const sceneMode = useMemo<DentalSceneMode>(() => {
    if (phase === 0) return "porcelain";
    if (phase === 1) return "heatmap";
    if (phase === 2) return "texture";
    if (phase === 3) return "flow";
    return "texture";
  }, [phase]);
  const visibleScheme = phase >= 2 || complete;
  const simulationReady = phase >= 3 || complete;
  const scenePhase: DentalScenePhase = complete ? "converge" : running ? visualPhases[phase] : "idle";
  const overallProgress = complete ? 100 : running ? (phase + ease(phaseProgress)) / phases.length * 100 : 0;
  const modelingStep = Math.min(modelingSteps.length - 1, Math.floor(phaseProgress * modelingSteps.length));
  return (
    <main className="product-page twin-page">
      <ProductNav section="双微AI设计智能体及验证平台" />

      <section className="twin-heading">
        <div>
          <span className="eyebrow">PRODUCT 02 · MICROTEXTURE × DIGITAL TWIN</span>
          <h1>在微米尺度，<br />预演一副义齿的<span>未来。</span></h1>
        </div>
        <div className="twin-heading-copy">
          <p>AI决定何处雕刻、雕刻何种微织构；数字孪生在制造前验证力学与生物特性。</p>
          <span><i className="live-dot" /> DIGITAL TWIN READY</span>
        </div>
      </section>

      <section className="twin-workspace">
        <div className="twin-scene-wrap">
          <DentalScene src={modelSrc} mode={sceneMode} phase={scenePhase} stageProgress={complete ? 1 : phaseProgress} textureSides={focusRegion.sides} wave={focusRegion.wave} regionalTextures={scheme.regions} regionalTexturePlans={schemeTexturePlans} interactive={!running} className="dental-scene twin-scene" />
          {running && <div key={`twin-bridge-${phase}`} className="stage-transition-veil twin-transition-veil" aria-hidden="true" />}
          <div key={`region-labels-${schemeIndex}`} className="regional-callout-layer">
            {scheme.regions.map((region, index) => (
              <div key={region.id} className={`zone-callout zone-${index + 1} ${region.enabled ? "" : "is-untextured"} ${phase >= 1 || complete ? "is-visible" : ""}`}>
                <i />{region.id} · {region.name}<b>{visibleScheme ? region.enabled ? region.topology : "不雕刻" : "候选区"}</b>
              </div>
            ))}
          </div>
          <div className="twin-scene-label"><span>曲面级数字镜像</span><strong>MICRO GEOMETRY / DT-2408</strong></div>
          <div className={`micro-modeling-sequence ${running && phase === 2 ? "is-visible" : ""}`} aria-hidden={!(running && phase === 2)}>
            <div><span>3D MICROSTRUCTURE</span><em>曲面法向贴合</em></div>
            {modelingSteps.map((step, index) => (
              <i key={step} className={`${index === modelingStep ? "is-active" : ""} ${index < modelingStep ? "is-done" : ""}`}>
                <b>0{index + 1}</b><strong>{step}</strong><span />
              </i>
            ))}
            <small>微结构视觉比例经增强</small>
          </div>
          {(running || complete) && <div key={`phase-readout-${phase}-${complete}`} className="twin-phase-readout"><i>0{phase + 1}</i><strong>{complete ? "AI RECOMMENDATION READY" : phases[phase].title}</strong><span>{Math.round(overallProgress).toString().padStart(2, "0")}%</span></div>}
          <div className={`flow-legend ${phase === 3 ? "is-visible" : ""}`}><i /><span>仿真流体轨迹</span></div>
        </div>

        <aside className="twin-intelligence">
          <div className="ai-state">
            <span>双微AI · 当前状态</span>
            <div key={`ai-copy-${phase}-${complete}`} className="ai-state-swap">
              <strong>{complete ? "方案已收敛" : running ? phases[phase].title : "等待启动"}</strong>
              <small>{complete ? "区域选择与纹理类型已通过五维联合评估" : running ? phases[phase].short : "启动后将逐区决定是否雕刻、纹理类型与参数"}</small>
            </div>
          </div>

          <div className={`texture-lens has-regional-decisions ${visibleScheme ? "is-visible" : ""}`}>
            <MicroTextureLens sides={focusRegion.sides} wave={focusRegion.wave} />
            <div className="lens-caption"><span>{scheme.code} · {focusRegion.id}</span><strong>{focusRegion.topology}</strong><small>局部纹理预览</small></div>
          </div>

          <div key={`region-decisions-${schemeIndex}`} className={`region-decision-stream ${visibleScheme ? "is-visible" : ""}`} aria-label="分区雕刻决策">
            <div className="region-decision-head"><span>区域雕刻决策</span><em>仿真适配</em></div>
            {scheme.regions.map((region) => (
              <span key={region.id} className={region.enabled ? "" : "is-untextured"}>
                <i>{region.id}</i>
                <strong>{region.name}<small>{region.enabled ? `${region.width} × ${region.depth} μm` : "保留原表面"}</small></strong>
                <em>{region.enabled ? region.topology : "不雕刻"}</em>
                <b>{simulationReady ? region.score : "—"}</b>
              </span>
            ))}
          </div>

          <div className={`parameter-stream ${visibleScheme ? "is-visible" : ""}`}>
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
            <button key={item.code} type="button" onClick={() => setSchemeIndex(index)} className={`scheme-node scheme-node-${index + 1} ${schemeIndex === index ? "is-active" : ""}`}>
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
