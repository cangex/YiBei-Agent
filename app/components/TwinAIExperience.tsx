"use client";

import { useEffect, useMemo, useState } from "react";
import { DentalScene, DentalSceneMode } from "./DentalScene";
import { MicroTextureLens } from "./MicroTextureLens";
import { ProductNav } from "./ProductNav";

const phases = [
  { title: "模型接入", short: "接收重建表面" },
  { title: "区域解析", short: "定位仿生雕刻区" },
  { title: "方案生成", short: "组合拓扑与流道" },
  { title: "孪生仿真", short: "演化力学与生物场" },
  { title: "方案收敛", short: "输出AI推荐" },
];

const schemes = [
  {
    code: "A-06",
    name: "六边贯通型",
    sides: 6 as const,
    wave: false,
    width: 38,
    depth: 19,
    angle: "120°",
    fit: 94,
    reason: "连续六边流道兼顾结构稳定与唾液交换，降低局部流体滞留，并减少菌群在深沟槽内持续定植的机会。",
    metrics: [92, 89, 86, 91, 88],
  },
  {
    code: "B-04",
    name: "波浪四边型",
    sides: 4 as const,
    wave: true,
    width: 42,
    depth: 17,
    angle: "90°",
    fit: 87,
    reason: "宽幅浅流道提升封闭区域的液体交换，波浪线增加有效界面，适合低流速条件下的局部功能增强。",
    metrics: [84, 93, 80, 83, 85],
  },
  {
    code: "C-03",
    name: "梯度三边型",
    sides: 3 as const,
    wave: false,
    width: 31,
    depth: 24,
    angle: "60°",
    fit: 81,
    reason: "梯度三边拓扑强化局部导向性，适合特定受力区，但尖角与较深流道使沉积风险相对提高。",
    metrics: [78, 76, 91, 72, 79],
  },
];

const metricNames = ["结构稳定", "流体交换", "抗沉积", "抗菌定植", "疲劳耐受"];

export function TwinAIExperience() {
  const [modelSrc] = useState(() => {
    if (typeof window === "undefined") return "/models/demo.stl";
    return (window as unknown as { __YIBEI_MODEL_URL__?: string }).__YIBEI_MODEL_URL__ || "/models/demo.stl";
  });
  const [phase, setPhase] = useState(0);
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [schemeIndex, setSchemeIndex] = useState(0);

  useEffect(() => {
    if (!running) return;
    if (phase >= phases.length - 1) {
      const timer = window.setTimeout(() => { setRunning(false); setComplete(true); }, 900);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setPhase((value) => value + 1), phase === 0 ? 950 : 1450);
    return () => window.clearTimeout(timer);
  }, [phase, running]);

  const begin = () => {
    setPhase(0);
    setSchemeIndex(0);
    setComplete(false);
    setRunning(true);
  };

  const scheme = schemes[schemeIndex];
  const sceneMode = useMemo<DentalSceneMode>(() => {
    if (phase === 0) return "porcelain";
    if (phase === 1) return "heatmap";
    if (phase === 2) return "texture";
    if (phase === 3) return "flow";
    return "texture";
  }, [phase]);
  const visibleScheme = phase >= 2 || complete;
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
          <DentalScene src={modelSrc} mode={sceneMode} textureSides={scheme.sides} wave={scheme.wave} interactive={!running} className="dental-scene twin-scene" />
          <div className="zone-callout zone-one"><i />高适配区 <b>92%</b></div>
          <div className="zone-callout zone-two"><i />流体交换区 <b>87%</b></div>
          <div className="twin-scene-label"><span>活体数字镜像</span><strong>DT-2408 / YB</strong></div>
          {(phase === 1 || running) && <div className="radial-scan" aria-hidden="true" />}
          {phase === 3 && <div className="flow-legend"><i /><span>仿真流体轨迹</span></div>}
        </div>

        <aside className="twin-intelligence">
          <div className="ai-state">
            <span>双微AI · 当前状态</span>
            <strong>{complete ? "方案已收敛" : running ? phases[phase].title : "等待启动"}</strong>
            <small>{complete ? "推荐方案已通过五维联合评估" : running ? phases[phase].short : "启动后将完成区域识别、生成与仿真"}</small>
          </div>

          <div className={`texture-lens ${visibleScheme ? "is-visible" : ""}`}>
            <MicroTextureLens sides={scheme.sides} wave={scheme.wave} />
            <div className="lens-caption"><span>{scheme.code}</span><strong>{scheme.name}</strong><small>{scheme.wave ? "波浪线流道" : "直线流道"}</small></div>
          </div>

          <div className={`parameter-stream ${visibleScheme ? "is-visible" : ""}`}>
            <span><small>流道宽度</small><strong>{scheme.width}<i> μm</i></strong></span>
            <span><small>流道深度</small><strong>{scheme.depth}<i> μm</i></strong></span>
            <span><small>邻边夹角</small><strong>{scheme.angle}</strong></span>
          </div>

          <button className="primary-orbit-button twin-run" type="button" onClick={begin} disabled={running}>
            <span>{running ? `正在执行 · ${phase + 1}/5` : complete ? "重新生成方案" : "启动双微AI设计"}</span><i aria-hidden="true">→</i>
          </button>
        </aside>

        <div className="phase-track" aria-label="双微AI流程">
          {phases.map((item, index) => (
            <button type="button" key={item.title} disabled={!complete} onClick={() => complete && setPhase(index)} className={`${index === phase ? "is-active" : ""} ${index < phase || complete ? "is-done" : ""}`}>
              <i /><span>0{index + 1}</span><strong>{item.title}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className={`scheme-comparison ${complete ? "is-visible" : ""}`} aria-hidden={!complete}>
        <div className="comparison-heading">
          <span className="eyebrow">MULTI-OBJECTIVE CONVERGENCE</span>
          <h2>三个候选方案，<br />收敛为一个答案。</h2>
          <p>切换方案，观察三维表面、参数与数字孪生结果如何同步变化。</p>
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
