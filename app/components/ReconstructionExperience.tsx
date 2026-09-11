"use client";

import { CSSProperties, ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { DentalScene, DentalSceneMode, DentalScenePhase } from "./DentalScene";
import { ProductNav } from "./ProductNav";
import { ReconstructionDetailOverlay, resolveReconstructionDetail } from "./ReconstructionDetailOverlay";

const steps = [
  { id: "01", title: "解析几何", titleEn: "MESH PARSING", note: "读取三角网格与空间边界", noteEn: "READ TRIANGLE MESH AND SPATIAL BOUNDS" },
  { id: "02", title: "全域扫描", titleEn: "GLOBAL SCAN", note: "建立轮廓与曲率特征场", noteEn: "BUILD CONTOUR AND CURVATURE FEATURE FIELDS" },
  { id: "03", title: "异常修复", titleEn: "ANOMALY REPAIR", note: "自下而上发现一处，即刻修复一处", noteEn: "DISCOVER AND REPAIR EACH REGION FROM CERVICAL MARGIN UPWARD" },
  { id: "04", title: "精度校验", titleEn: "PRECISION VALIDATION", note: "执行重建前后误差映射", noteEn: "MAP ERRORS BEFORE AND AFTER RECONSTRUCTION" },
  { id: "05", title: "模型就绪", titleEn: "MODEL READY", note: "输出可进入双微设计的STL", noteEn: "OUTPUT STL READY FOR DUAL-MICRO DESIGN" },
];

const modes: DentalSceneMode[] = ["porcelain", "scan", "repaired", "heatmap", "repaired"];
const visualPhases: DentalScenePhase[] = ["parse", "scan", "repair", "validate", "ready"];
const stepDurations = [2800, 6800, 52000, 14000, 2800];

const validationPhases = [
  { zh: "空间配准", en: "SPATIAL REGISTRATION", note: "重建前后表面进入同一坐标基准", until: 0.2 },
  { zh: "三维残差测量", en: "3D RESIDUAL MAPPING", note: "扫描截面生成误差云图与偏差向量", until: 0.55 },
  { zh: "连续性复核", en: "CONTINUITY VERIFICATION", note: "逐区复核边缘、拓扑、孔洞与沟槽", until: 0.82 },
  { zh: "全局置信收敛", en: "GLOBAL CONFIDENCE CONVERGENCE", note: "残差场收束为连续可信的表面包络", until: 1 },
];

function ease(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
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
  const reconstructionDetail = resolveReconstructionDetail(activeStep, stageProgress, running);
  const validationDetail = running && activeStep === 3
    ? (() => {
        const phaseIndex = Math.max(0, validationPhases.findIndex((phase) => stageProgress <= phase.until));
        return { phaseIndex, phase: validationPhases[phaseIndex] };
      })()
    : null;
  const runtimePhases = [
    ["读取网格缓冲", "计算表面法向", "归一化空间边界"],
    ["追踪全域轮廓", "构建曲率特征场", "收束扫描结果"],
    ["定位异常区域", "生成修复候选", "验证局部连续性"],
    ["建立坐标基准", "测量三维残差", "收束全局置信"],
    ["整理连续表面", "编排输出网格", "连接双微设计"],
  ];
  const fallbackRuntimeIndex = Math.min(2, Math.floor(stageProgress * 3));
  const runtimeStatus = reconstructionDetail
    ? `区域 ${String(reconstructionDetail.regionIndex + 1).padStart(2, "0")} / 04 · ${reconstructionDetail.subphaseZh}`
    : validationDetail
      ? `校验 ${String(validationDetail.phaseIndex + 1).padStart(2, "0")} / 04 · ${validationDetail.phase.zh}`
      : runtimePhases[activeStep][fallbackRuntimeIndex];
  const railProgress = complete ? 100 : running ? ((activeStep + stageProgress) / steps.length) * 100 : 0;
  const stagePercent = Math.round(stageProgress * 100);
  const reconstructionMaterialProgress = !running || activeStep < 2
    ? 0
    : activeStep === 2
      ? reconstructionDetail?.repairProgress ?? 0
      : 1;
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
        <div className={`scene-column ${complete ? "is-complete" : ""} ${reconstructionDetail ? "has-detail-overlay" : ""}`}>
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
              reconstructionFocusIndex={reconstructionDetail?.regionIndex}
              reconstructionLightWave
              reconstructionMaterialProgress={reconstructionMaterialProgress}
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
          {reconstructionDetail && <ReconstructionDetailOverlay key={`repair-${reconstructionDetail.regionIndex}`} detail={reconstructionDetail} />}
          {validationDetail && (
            <section className={`precision-validation-hud phase-${validationDetail.phaseIndex + 1}`} aria-label="三维精度校验实时过程">
              <header><span>PRECISION VALIDATION · LIVE 3D</span><i>{String(validationDetail.phaseIndex + 1).padStart(2, "0")} / 04</i></header>
              <strong>{validationDetail.phase.zh}</strong>
              <em>{validationDetail.phase.en}</em>
              <p>{validationDetail.phase.note}</p>
              <div className="validation-live-metrics">
                <span><small>配准残差</small><b>{(0.006 + 0.158 * (1 - ease(Math.min(1, stageProgress / 0.2)))).toFixed(3)}</b></span>
                <span><small>局部最大偏差</small><b>{stageProgress < 0.2 ? "—" : (0.029 + 0.063 * (1 - ease((stageProgress - 0.2) / 0.8))).toFixed(3)}</b></span>
                <span><small>法线连续度</small><b>{(96.1 + 3.0 * ease((stageProgress - 0.52) / 0.48)).toFixed(1)}%</b></span>
              </div>
              <div className="validation-residual-legend" aria-label="表面残差颜色图例">
                <span>0.00</span><i /><span>0.10</span><small>SURFACE RESIDUAL FIELD</small>
              </div>
              <div className="validation-phase-track" aria-hidden="true">
                {validationPhases.map((phase, index) => <i key={phase.en} className={index < validationDetail.phaseIndex ? "is-done" : index === validationDetail.phaseIndex ? "is-active" : ""} />)}
              </div>
            </section>
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

          <div className="process-rail" aria-label="重建流程" style={{ "--rail-progress": `${railProgress}%` } as CSSProperties}>
            <span className="process-rail-track" aria-hidden="true">
              <i className="process-rail-fill" />
              {running && <b className="process-rail-pulse" />}
            </span>
            {steps.map((step, index) => (
              <div
                key={step.id}
                aria-current={running && !complete && index === activeStep ? "step" : undefined}
                style={running && !complete && index === activeStep ? {
                  "--step-progress": stageProgress,
                  "--step-angle": `${stageProgress * 360}deg`,
                  "--step-percent": `${stagePercent}%`,
                } as CSSProperties : undefined}
                className={`process-step ${running && !complete && index === activeStep ? "is-active" : ""} ${index < activeStep || complete ? "is-done" : ""}`}
              >
                <span className="step-index">{step.id}</span>
                <span className="step-marker"><i /><b /></span>
                <span className="step-copy">
                  <span className="step-title-row"><strong>{step.title}</strong><em>{step.titleEn}</em></span>
                  <span className="step-note-cn">{step.note}</span>
                  <span className="step-note-en">{step.noteEn}</span>
                  {running && !complete && index === activeStep && (
                    <span className="step-live-status">
                      <b>{runtimeStatus}</b><em>RUNNING · {String(stagePercent).padStart(2, "0")}%</em>
                    </span>
                  )}
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
