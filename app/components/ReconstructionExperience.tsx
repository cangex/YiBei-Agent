"use client";

import { CSSProperties, ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { DentalScene, DentalSceneMode, DentalScenePhase } from "./DentalScene";
import { ProductNav } from "./ProductNav";

const steps = [
  { id: "01", title: "解析几何", note: "读取三角网格与空间边界" },
  { id: "02", title: "全域扫描", note: "建立轮廓与曲率特征场" },
  { id: "03", title: "异常识别", note: "定位噪声、孔洞与非流形区域" },
  { id: "04", title: "智能补全", note: "生成连续、平滑的候选轮廓" },
  { id: "05", title: "精度校验", note: "执行重建前后误差映射" },
  { id: "06", title: "模型就绪", note: "输出可进入双微设计的STL" },
];

const modes: DentalSceneMode[] = ["porcelain", "scan", "heatmap", "repaired", "heatmap", "repaired"];
const visualPhases: DentalScenePhase[] = ["parse", "scan", "defect", "repair", "validate", "ready"];
const stepDurations = [1800, 3000, 2400, 2700, 2400, 1600];

function ease(value: number) {
  return value * value * (3 - 2 * value);
}

export function ReconstructionExperience() {
  const [modelSrc, setModelSrc] = useState("/models/demo.stl");
  const [fileName, setFileName] = useState("测试.stl");
  const [activeStep, setActiveStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const [stageProgress, setStageProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [triangles, setTriangles] = useState(41176);
  const runToken = useRef(0);

  useEffect(() => {
    if (!running) return;
    const token = runToken.current;
    const startedAt = performance.now();
    const duration = stepDurations[activeStep];
    let timer = 0;
    const tick = () => {
      if (token !== runToken.current) return;
      const fraction = Math.min(1, (performance.now() - startedAt) / duration);
      setStageProgress(fraction);
      if (fraction >= 1) {
        if (activeStep >= steps.length - 1) {
          setRunning(false);
          setComplete(true);
        } else {
          setStageProgress(0);
          setActiveStep((value) => value + 1);
        }
        return;
      }
      timer = window.setTimeout(tick, 42);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [activeStep, running]);

  const acceptFile = (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".stl")) {
      setMessage("请选择STL格式的义齿模型");
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setMessage("演示版单个模型请控制在80 MB以内");
      return;
    }
    const url = URL.createObjectURL(file);
    (window as unknown as { __YIBEI_MODEL_URL__?: string }).__YIBEI_MODEL_URL__ = url;
    setModelSrc(url);
    setFileName(file.name);
    setActiveStep(0);
    setStageProgress(0);
    setComplete(false);
    setRunning(false);
    setMessage("");
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => acceptFile(event.target.files?.[0]);
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const start = () => {
    runToken.current += 1;
    setActiveStep(0);
    setStageProgress(0);
    setComplete(false);
    setRunning(true);
    setMessage("");
  };

  const progress = running ? Math.round(((activeStep + ease(stageProgress)) / steps.length) * 100) : complete ? 100 : 0;
  const currentMode = complete ? "repaired" : modes[activeStep];
  const currentPhase: DentalScenePhase = complete ? "ready" : running ? visualPhases[activeStep] : "idle";
  const defectCount = useMemo(() => Math.max(6, Math.round(triangles / 4100)), [triangles]);

  return (
    <main className="product-page reconstruction-page">
      <ProductNav section="义齿三维轮廓超精准重建" />

      <section className="product-intro">
        <div>
          <span className="eyebrow">PRODUCT 01 · GEOMETRY RECONSTRUCTION</span>
          <h1>让每一处缺失的轮廓，<br /><em>重新连续。</em></h1>
        </div>
        <p>以真实STL为入口，将网格解析、异常识别、智能补全与误差校验收束为一次流畅的重建过程。</p>
      </section>

      <section className={`reconstruction-workspace ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <div className="scene-column">
          <div className="scene-meta scene-meta-top">
            <span><i className="live-dot" /> REAL-TIME MESH</span>
            <span>{fileName}</span>
          </div>
          <DentalScene
            src={modelSrc}
            mode={currentMode}
            phase={currentPhase}
            stageProgress={complete ? 1 : stageProgress}
            interactive={!running}
            className="dental-scene reconstruction-scene"
            onLoaded={({ triangles: count }) => setTriangles(Math.round(count))}
          />
          {running && <div key={`bridge-${activeStep}`} className="stage-transition-veil" aria-hidden="true" />}
          {(running || complete) && <div className={`processing-caption ${complete ? "is-complete" : ""}`}>
            <span key={`caption-${activeStep}-${complete}`} className="processing-caption-copy">
              <i>{complete ? "READY" : steps[activeStep].id}</i>
              <b>{complete ? "RECONSTRUCTION COMPLETE" : steps[activeStep].title}</b>
              <small>{complete ? "连续表面已进入可设计状态" : steps[activeStep].note}</small>
            </span>
            <strong>{String(progress).padStart(2, "0")}%</strong>
            <em className="processing-progress"><i style={{ width: `${progress}%` }} /></em>
          </div>}
          <div className="scene-axis" aria-hidden="true"><span>X</span><span>Y</span><span>Z</span></div>
          {dragging && <div className="drop-overlay"><strong>释放以载入模型</strong><span>STL · MAX 80 MB</span></div>}
        </div>

        <aside className="process-column">
          <div className="upload-line">
            <div><span>当前模型</span><strong>{fileName}</strong></div>
            <label className="round-upload">
              <input type="file" accept=".stl,model/stl" onChange={onInput} />
              <span>替换</span>
            </label>
          </div>
          {message && <p className="inline-error" role="alert">{message}</p>}

          <div className="process-rail" aria-label="重建流程" style={{ "--rail-progress": `${complete ? 100 : (activeStep + stageProgress) / steps.length * 100}%` } as CSSProperties}>
            <span className="process-rail-fill" aria-hidden="true" />
            {steps.map((step, index) => (
              <div key={step.id} style={index === activeStep ? { "--step-progress": stageProgress } as CSSProperties : undefined} className={`process-step ${index === activeStep ? "is-active" : ""} ${index < activeStep || complete ? "is-done" : ""}`}>
                <span className="step-index">{step.id}</span>
                <span className="step-marker"><i /></span>
                <span className="step-copy"><strong>{step.title}</strong><small>{step.note}</small></span>
              </div>
            ))}
          </div>

          <div className="metric-ribbon">
            <span><small>三角面</small><strong>{triangles.toLocaleString("zh-CN")}</strong></span>
            <span><small>识别异常</small><strong>{complete ? defectCount : "—"}</strong></span>
            <span><small>轮廓连续度</small><strong>{complete ? "99.2%" : "—"}</strong></span>
          </div>

          {!complete ? (
            <button className="primary-orbit-button" type="button" onClick={start} disabled={running}>
              <span>{running ? "智能体运行中" : "启动超精准重建"}</span><i aria-hidden="true">→</i>
            </button>
          ) : (
            <a className="primary-orbit-button is-ready" href="/twin-ai?source=processed">
              <span>进入双微AI设计</span><i aria-hidden="true">→</i>
            </a>
          )}
        </aside>
      </section>

      <section className="reconstruction-footnote">
        <span>01 / INPUT</span><p>任意STL网格</p><i />
        <span>02 / PROCESS</span><p>几何特征场与确定性重建演示</p><i />
        <span>03 / OUTPUT</span><p>连续、可设计的义齿表面</p>
      </section>
    </main>
  );
}
