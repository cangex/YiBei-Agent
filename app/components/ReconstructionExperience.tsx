"use client";

import { CSSProperties, ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { DentalScene, DentalSceneMode, DentalScenePhase } from "./DentalScene";
import { ProductNav } from "./ProductNav";

const steps = [
  { id: "01", title: "解析几何", titleEn: "MESH PARSING", note: "读取三角网格与空间边界", noteEn: "READ TRIANGLE MESH AND SPATIAL BOUNDS" },
  { id: "02", title: "全域扫描", titleEn: "GLOBAL SCAN", note: "建立轮廓与曲率特征场", noteEn: "BUILD CONTOUR AND CURVATURE FEATURE FIELDS" },
  { id: "03", title: "异常识别", titleEn: "ANOMALY DETECTION", note: "定位噪声、孔洞与非流形区域", noteEn: "LOCATE NOISE, HOLES AND NON-MANIFOLD REGIONS" },
  { id: "04", title: "智能补全", titleEn: "CONTOUR COMPLETION", note: "生成连续、平滑的候选轮廓", noteEn: "GENERATE CONTINUOUS AND SMOOTH CONTOURS" },
  { id: "05", title: "精度校验", titleEn: "PRECISION VALIDATION", note: "执行重建前后误差映射", noteEn: "MAP ERRORS BEFORE AND AFTER RECONSTRUCTION" },
  { id: "06", title: "模型就绪", titleEn: "MODEL READY", note: "输出可进入双微设计的STL", noteEn: "OUTPUT STL READY FOR DUAL-MICRO DESIGN" },
];

const modes: DentalSceneMode[] = ["porcelain", "scan", "heatmap", "repaired", "heatmap", "repaired"];
const visualPhases: DentalScenePhase[] = ["parse", "scan", "defect", "repair", "validate", "ready"];
const stepDurations = [1800, 3000, 2400, 4200, 2400, 1600];

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
  const comparisonMetrics = useMemo(() => {
    const beforeContinuity = Math.max(88.6, 95.4 - defectCount * 0.33);
    const beforeTopology = Math.max(84.2, 91.6 - defectCount * 0.3);
    const beforeSmoothness = Math.max(78.4, 85.4 - defectCount * 0.3);
    const remainingDefects = Math.max(1, Math.round(defectCount * 0.1));
    return [
      { label: "轮廓连续度", before: `${beforeContinuity.toFixed(1)}%`, after: "99.2%", delta: `+${(99.2 - beforeContinuity).toFixed(1)}%` },
      { label: "异常轮廓", before: `${defectCount} 处`, after: `${remainingDefects} 处`, delta: `−${defectCount - remainingDefects}` },
      { label: "拓扑完整性", before: beforeTopology.toFixed(1), after: "98.7", delta: `+${(98.7 - beforeTopology).toFixed(1)}` },
      { label: "表面平滑度", before: beforeSmoothness.toFixed(1), after: "96.8", delta: `+${(96.8 - beforeSmoothness).toFixed(1)}` },
    ];
  }, [defectCount]);

  return (
    <main className="product-page reconstruction-page">
      <ProductNav section="义齿三维轮廓超精准重建" brandVariant="reconstruction" />

      <section className="product-intro">
        <div>
          <span className="eyebrow">PRODUCT 01 · GEOMETRY RECONSTRUCTION</span>
          <h1>让每一处缺失的轮廓，<em>重新连续。</em></h1>
        </div>
        <div className={`reconstruction-intro-action ${running ? "is-running" : ""}`} aria-live="polite">
          {!complete ? (
            <button className="primary-orbit-button" type="button" onClick={start} disabled={running}>
              <span>{running ? `智能体运行中 · ${String(progress).padStart(2, "0")}%` : "启动超精准重建"}</span><i aria-hidden="true">→</i>
            </button>
          ) : (
            <a className="primary-orbit-button is-ready" href="/twin-ai?source=processed">
              <span>进入双微AI设计</span><i aria-hidden="true">→</i>
            </a>
          )}
        </div>
      </section>

      <section className={`reconstruction-workspace ${dragging ? "is-dragging" : ""} ${complete ? "is-complete" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <div className={`scene-column ${complete ? "is-complete" : ""}`}>
          <div className="scene-meta scene-meta-top">
            <span><i className="live-dot" /> {complete ? "SYNCHRONIZED COMPARISON" : "REAL-TIME MESH"}</span>
            <span>{fileName}</span>
          </div>
          {!complete ? (
            <DentalScene
              src={modelSrc}
              mode={currentMode}
              phase={currentPhase}
              stageProgress={stageProgress}
              visualPalette="brand-cyan"
              reconstructionLightWave
              reconstructionMaterialProgress={!running || activeStep <= 2 ? 0 : activeStep === 3 ? stageProgress : 1}
              synchronizedPose={!running}
              interactive={!running}
              className="dental-scene reconstruction-scene"
              onLoaded={({ triangles: count }) => setTriangles(Math.round(count))}
            />
          ) : (
            <div className="reconstruction-comparison" aria-label="重建前后模型与参数对比">
              <div className="comparison-model-stage">
                <article className="comparison-model comparison-model-before">
                  <header><span>BEFORE / ORIGINAL MESH</span><strong>重建前</strong></header>
                  <DentalScene
                    src={modelSrc}
                    mode="porcelain"
                    phase="idle"
                    stageProgress={0}
                    visualPalette="brand-cyan"
                    comparisonAppearance="before"
                    showScannerOverlay={false}
                    synchronizedPose
                    interactive={false}
                    className="dental-scene comparison-dental-scene"
                    onLoaded={({ triangles: count }) => setTriangles(Math.round(count))}
                  />
                </article>
                <i className="comparison-centerline" aria-hidden="true"><b /></i>
                <article className="comparison-model comparison-model-after">
                  <header><span>AFTER / CONTINUOUS SURFACE</span><strong>重建后</strong></header>
                  <DentalScene
                    src={modelSrc}
                    mode="repaired"
                    phase="ready"
                    stageProgress={1}
                    visualPalette="brand-cyan"
                    reconstructionLightWave
                    comparisonAppearance="after"
                    synchronizedPose
                    interactive={false}
                    className="dental-scene comparison-dental-scene"
                  />
                </article>
              </div>
              <div className="comparison-metrics" aria-label="重建参数对比">
                {comparisonMetrics.map((metric, index) => (
                  <article key={metric.label} style={{ "--metric-order": index } as CSSProperties}>
                    <span>{metric.label}</span>
                    <div><small>重建前</small><strong>{metric.before}</strong></div>
                    <i><b /></i>
                    <div className="is-after"><small>重建后</small><strong>{metric.after}</strong></div>
                    <em>{metric.delta}</em>
                  </article>
                ))}
              </div>
            </div>
          )}
          {running && <div key={`bridge-${activeStep}`} className="stage-transition-veil" aria-hidden="true" />}
          {running && <div className="processing-caption">
            <span key={`caption-${activeStep}`} className="processing-caption-copy">
              <i>{steps[activeStep].id}</i>
              <span className="processing-caption-heading">
                <b>{steps[activeStep].title}</b>
                <em><span>{steps[activeStep].titleEn}</span></em>
              </span>
              <small>{steps[activeStep].note}</small>
            </span>
            <strong>{String(progress).padStart(2, "0")}%</strong>
            <em className="processing-progress"><i style={{ width: `${progress}%` }} /></em>
          </div>}
          {!complete && <div className="scene-axis" aria-hidden="true"><span>X</span><span>Y</span><span>Z</span></div>}
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
              <div key={step.id} style={!complete && index === activeStep ? { "--step-progress": stageProgress } as CSSProperties : undefined} className={`process-step ${!complete && index === activeStep ? "is-active" : ""} ${index < activeStep || complete ? "is-done" : ""}`}>
                <span className="step-index">{step.id}</span>
                <span className="step-marker"><i /></span>
                <span className="step-copy">
                  <span className="step-title-row"><strong>{step.title}</strong><em>{step.titleEn}</em></span>
                  <span className="step-note-cn">{step.note}</span>
                  <span className="step-note-en">{step.noteEn}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="metric-ribbon">
            <span><small>三角面</small><strong>{triangles.toLocaleString("zh-CN")}</strong></span>
            <span><small>{complete ? "输出网格" : "识别异常"}</small><strong>{complete ? "STL" : "—"}</strong></span>
            <span><small>{complete ? "设计链路" : "轮廓连续度"}</small><strong>{complete ? "READY" : "—"}</strong></span>
          </div>

        </aside>
      </section>

    </main>
  );
}
