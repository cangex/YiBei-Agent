"use client";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { DentalScene, type DentalScenePhase } from './DentalScene';
import { ProductNav } from './ProductNav';
import { useProjectSession } from './ProjectSession';
import { ReconstructionObservations } from './ReconstructionObservations';
import { reconstructionState, RECONSTRUCTION_DURATIONS, type ReconstructionPlan } from '../lib/reconstruction-plan';

const steps = [['轮廓解析', 'CONTOUR ANALYSIS'], ['全域扫描', 'GLOBAL SCANNING'], ['缺陷重建', 'DEFECT RECONSTRUCTION'], ['精度校验', 'GEOMETRY VERIFICATION'], ['模型输出', 'MODEL OUTPUT']];
const phases: DentalScenePhase[] = ['parse', 'scan', 'repair', 'validate', 'ready'];
const number = (v: number | undefined, digits = 2) => v === undefined ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: digits });

export function ReconstructionStudio() {
  const session = useProjectSession(), restored = session?.project.state.reconstruction;
  const src = session?.project.modelUrl || '/models/demo.stl', fileName = session?.project.model.originalName || '测试.stl';
  const [step, setStep] = useState(restored?.step ?? 0), [progress, setProgress] = useState(restored?.progress ?? 0);
  const [started, setStarted] = useState(!!restored?.started), [running, setRunning] = useState(!!restored?.started && !restored.complete), [complete, setComplete] = useState(!!restored?.complete);
  const [plan, setPlan] = useState<ReconstructionPlan>(), [message, setMessage] = useState(''), [dragging, setDragging] = useState(false);
  const [resultView, setResultView] = useState<'material' | 'amount'>('material'), [selectedRegion, setSelectedRegion] = useState(0);
  const progressRef = useRef(progress); progressRef.current = progress;
  const state = reconstructionState(step, progress, started), focus = complete ? selectedRegion : state.region;
  const region = plan?.regions[focus], active = started && step >= 2;
  const total = complete ? 100 : state.total;
  const drive = { factors: state.factors, cleanup: state.cleanup, focus, amount: complete ? resultView === 'amount' : step === 3, active: active && (!complete || resultView === 'amount') };
  const materialProgress = step < 2 ? 0 : step > 2 ? 1 : state.factors.reduce((s, n) => s + n, 0) / 4;
  useEffect(() => { session?.checkpoint('reconstruction', { step, progress: complete ? 1 : progress, complete, started, triangles: plan?.stats.triangles || session.project.model.triangles, repairVersion: 'surface-demo-2' }); }, [session, step, progress, complete, started, plan]);
  useEffect(() => {
    if (!running || !plan) return;
    let last = performance.now(), value = progressRef.current;
    const timer = window.setInterval(() => {
      const now = performance.now(), elapsed = now - last; last = now;
      if (document.hidden) return;
      value = Math.min(1, value + Math.min(elapsed, 250) / RECONSTRUCTION_DURATIONS[step]);
      progressRef.current = value; setProgress(value);
      if (value === 1) {
        window.clearInterval(timer);
        if (step === 4) { setComplete(true); setRunning(false); }
        else { progressRef.current = 0; setProgress(0); setStep(n => n + 1); }
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [running, step, plan]);
  const reset = () => { setRunning(false); setStarted(false); setComplete(false); setStep(0); setProgress(0); progressRef.current = 0; setResultView('material'); setSelectedRegion(0); setMessage(''); };
  const start = () => { reset(); setStarted(true); setRunning(true); };
  const importFile = async (file?: File) => {
    if (!file) return;
    try { if (!session) throw new Error('项目正在准备，请稍后重试'); setMessage('正在校验并保存STL…'); await session.importFile(file); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '模型导入失败'); }
  };
  const stats = plan?.stats;
  const stageMetrics: Array<[string, string]> = !started ? [['运行状态', plan ? '可以开始' : '解析模型中'], ['处理方式', '确定性几何演示']] : step === 0 ? [['读取三角面', number(stats?.triangles, 0)], ['坐标单位', '模型单位（STL未声明）']] : step === 1 ? [['扫描覆盖', `${Math.floor(progress * 100)}%`], ['已检查几何分区', `${Math.min(4, Math.floor(progress * 4))} / 4`], ['异常诊断', '未执行真实诊断']] : step === 2 ? [['当前操作', state.denoising ? '降噪清理' : `${region?.id} · ${region?.name}`], ['可平滑独立顶点', number(stats?.cleanupVertices, 0)], ['已复核示范区域', `${state.completedRegions} / 4`], ['网格补面', '未增删三角面']] : step === 3 ? [['复核区域', `${region?.id} / R04`], ['最大表面变化', `${number(stats?.max, 5)} 单位`], ['原始开放边', `${number(stats?.boundaryEdges, 0)} 条 · 保留`], ['参考真值', '无 · 不评价临床精度']] : [['修改独立顶点', number(stats?.changedVertices, 0)], ['最大表面变化', `${number(stats?.max, 5)} 单位`], ['数据类型', '原始STL + 演示参数']];
  return <main className="product-page reconstruction-page reconstruction-studio">
    <ProductNav section="义齿三维轮廓超精准重建" brandVariant="reconstruction"/>
    <section className="studio-intro"><div><span className="eyebrow">GEOMETRY RECONSTRUCTION</span><h1>让每一处缺失的轮廓，<em>重新连续。</em></h1></div><div className="studio-actions">{complete ? <a className="primary-orbit-button" href="/twin-ai?source=processed"><span>进入双微AI设计</span><i>→</i></a> : <button className="primary-orbit-button" disabled={!plan || running} onClick={start}><span>{running ? '重建进行中' : started ? '重新运行' : '启动超精准重建'}</span><i>→</i></button>}{started && <button className="studio-text-button" onClick={reset}>重置</button>}</div></section>
    <section className={`studio-workspace ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); importFile(e.dataTransfer.files[0]); }}>
      <div className={`studio-theater ${complete ? 'is-complete' : ''}`}>
        <div className="studio-model-meta"><span><i className="live-dot"/>{complete ? '重建结果' : '三维工作区'}</span><span title={fileName}>{fileName}</span></div>
        {complete ? <><div className="studio-result-switch" aria-label="结果观察方式"><button aria-pressed={resultView === 'material'} onClick={() => setResultView('material')}>材质视图</button><button aria-pressed={resultView === 'amount'} onClick={() => setResultView('amount')}>修补量视图</button></div><div className="studio-comparison"><div><h2>重建前</h2><DentalScene src={src} mode="porcelain" phase="idle" visualPalette="brand-cyan" comparisonAppearance="before" synchronizedPose showScannerOverlay={false} repairDrive={{ factors: [0, 0, 0, 0], cleanup: 0, focus, amount: false, active: false }} className="studio-result-scene"/></div><div><h2>演示重建后</h2><DentalScene src={src} mode="repaired" phase="ready" visualPalette="brand-cyan" comparisonAppearance="after" reconstructionLightWave synchronizedPose showScannerOverlay={false} repairDrive={drive} onRepairPlan={setPlan} onRepairRegion={setSelectedRegion} className="studio-result-scene"/></div></div></> : <div className="studio-main-model">{session?.ready !== false && <DentalScene src={src} mode={step === 1 ? 'scan' : step >= 2 ? 'repaired' : 'porcelain'} phase={started ? phases[step] : 'idle'} stageProgress={progress} visualPalette="brand-cyan" reconstructionLightWave reconstructionMaterialProgress={materialProgress} reconstructionFocusIndex={active && !state.denoising ? focus : undefined} synchronizedPose={!running} interactive={!running} repairDrive={drive} onRepairPlan={setPlan} className={`studio-dental-scene ${active ? 'show-region' : ''}`}/>}</div>}
        <div className="studio-model-caption">{complete ? resultView === 'amount' ? '点击着色区域或下方编号，查看对应截面' : '原始STL保留 · 演示处理网格独立呈现' : active ? `${region?.id} · ${region?.name} · 几何选区` : '拖动旋转 · 滚轮缩放 · 支持拖入STL'}</div>
        <ReconstructionObservations plan={plan} step={step} progress={progress} started={started} complete={complete} focus={focus}/>
      </div>
      <aside className="studio-metrics"><label className="studio-upload"><span>导入STL模型</span><b>↗</b><input type="file" accept=".stl" onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }}/></label><section><header><span>01 / MODEL</span><h2>模型基础信息</h2><small>真实几何统计 · 原始模型</small></header><dl><div><dt>三角面片</dt><dd>{number(stats?.triangles, 0)}</dd></div><div><dt>独立顶点</dt><dd>{number(stats?.uniqueVertices, 0)}</dd></div><div className="metric-wide"><dt>空间尺寸 <small>X × Y × Z</small></dt><dd>{stats?.dimensions.map(v => number(v)).join(' × ') || '—'}</dd></div><div><dt>表面积</dt><dd>{number(stats?.area)}<small> 单位²</small></dd></div></dl><p>按坐标去重；STL存储顶点 {number(stats?.storedVertices, 0)}。未确认物理单位。</p></section><section className="studio-stage-metrics"><header><span>02 / PROCESS</span><h2>{started ? steps[step][0] : '等待开始'}<i className={running ? 'metric-pulse' : ''}/></h2><small>{step < 2 ? '几何读取与流程覆盖' : '演示处理 · 可复算的几何变化'}</small></header><dl>{stageMetrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><p className="studio-provenance">{active ? region?.reason : '按模型Y轴自下而上组织几何选区；未自动认定牙根、颈缘或解剖方向。'}</p></aside>
      {message && <div role="alert" className="studio-message">{message}</div>}
    </section>
    <section className="studio-timeline" aria-label="重建流程" data-step={step} data-progress={progress.toFixed(3)} style={{ '--overall-progress': `${total}%` } as CSSProperties}><div className="studio-progress-heading"><div><b>{started ? steps[step][0] : '准备就绪'}</b><span>{state.denoising ? '降噪清理 · ' : step === 2 ? `第 ${focus + 1}/4 区域 · ` : ''}{state.action}</span></div><div><strong>{Math.floor(total)}<small>%</small></strong><span>总体进度</span>{started && !complete && <button className="studio-text-button" onClick={() => setRunning(v => !v)}>{running ? '暂停' : '继续'}</button>}</div></div><div className="studio-progress-track" role="progressbar" aria-label="总体进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(total)}><i/></div><ol>{steps.map(([zh, en], i) => <li key={zh} aria-current={started && step === i ? 'step' : undefined} className={complete || step > i ? 'is-done' : started && step === i ? 'is-active' : ''}><span>{String(i + 1).padStart(2, '0')}</span><div><b>{zh}</b><small>{en}</small>{started && step === i && !complete && <em>阶段进度 {Math.floor(progress * 100)}%</em>}</div></li>)}</ol></section>
    {complete && <section className="studio-results"><div className="studio-region-selector"><span>查看区域</span>{plan?.regions.map((r, i) => <button key={r.id} aria-pressed={focus === i} onClick={() => setSelectedRegion(i)}>{r.id} {r.name}</button>)}</div><div className="studio-result-numbers"><div><span>三角面片</span><b>{number(stats?.triangles, 0)} <i>→</i> {number(stats?.triangles, 0)}</b><small>未增删网格面</small></div><div><span>表面积 / 模型单位²</span><b>{number(stats?.area)} <i>→</i> {number(stats?.afterArea)}</b><small>实际计算前后表面</small></div><div><span>最大修补位移 / 模型单位</span><b>0 <i>→</i> {number(stats?.max, 5)}</b><small>确定性演示 · 非精度误差</small></div></div><p>进入双微设计传递原始STL与已保存的演示参数；当前不导出临床修复网格。</p></section>}
  </main>;
}
