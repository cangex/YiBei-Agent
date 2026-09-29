"use client";
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { reconstructionState, type ReconstructionPlan } from '../lib/reconstruction-plan';
import { ReconstructionPatchScene } from './ReconstructionPatchScene';

type Props = { plan?: ReconstructionPlan; step: number; progress: number; started: boolean; focus: number; complete: boolean };
const titles = ['局部三维修复', '截面轮廓', '表面修补量', '过程曲线'];
const english = ['LOCAL RECONSTRUCTION', 'SECTION PROFILE', 'SURFACE DISPLACEMENT', 'PROCESS HISTORY'];

export function ReconstructionObservations({ plan, step, progress, started, focus, complete }: Props) {
  const root = useRef<HTMLDivElement>(null), local = useRef<HTMLDivElement>(null), heat = useRef<HTMLDivElement>(null);
  const state = reconstructionState(step, progress, started);
  const active = started && step >= 2, region = plan?.regions[focus];
  const [tab, setTab] = useState(0), [error, setError] = useState('');
  const [mechanism, setMechanism] = useState(false);
  const current = useRef({ state, active, focus });
  useEffect(() => { current.current = { state, active, focus }; }, [state, active, focus]);
  useEffect(() => {
    const host = root.current; if (!host || !plan) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch { setError('局部三维视图初始化失败；截面与统计仍可查看。'); return; }
    setError('');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setScissorTest(true); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'observation-shared-canvas'; host.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, .01, 30);
    const light = new THREE.DirectionalLight(0xffffff, 4); light.position.set(-2, 4, 5); scene.add(light, new THREE.HemisphereLight(0xf6ffff, 0x41696f, 2));
    const group = new THREE.Group(); scene.add(group);
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshStandardMaterial({ color: 0xe8f4f1, metalness: .13, roughness: .32, side: THREE.DoubleSide });
    const heatMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, material); group.add(mesh);
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x258c99, wireframe: true, transparent: true, opacity: .16, depthWrite: false });
    const wire = new THREE.Mesh(geometry, wireMat); group.add(wire);
    const toolGeometry = new THREE.BufferGeometry(), toolMat = new THREE.LineBasicMaterial({ color: 0xd17b57, transparent: true, opacity: .8 });
    const tool = new THREE.LineSegments(toolGeometry, toolMat); group.add(tool);
    let indices: number[] = [], currentRegion = -1, lastKey = '', frame = 0, lastTime = 0, visible = true, disposed = false, lastWidth = 0, lastHeight = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const render = (time: number) => {
      frame = 0; if (disposed || document.hidden || !visible) return;
      frame = requestAnimationFrame(render); if (time - lastTime < 40) return; lastTime = time;
      const live = current.current, r = plan.regions[live.focus];
      if (currentRegion !== live.focus) {
        currentRegion = live.focus; indices = Array.from(r.triangles).flatMap(i => [i, i + 1, i + 2]);
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(indices.length * 3), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(indices.length * 3), 3));
        group.position.set(-r.center[0], -r.center[1], -r.center[2]);
        camera.position.set(.1, .18, Math.max(.7, r.radius * 3.5)); camera.lookAt(0, 0, 0); lastKey = '';
      }
      const key = `${live.focus}:${live.state.cleanup.toFixed(3)}:${live.state.factors.map(x => x.toFixed(3)).join(':')}`;
      if (key !== lastKey) {
        const positions = geometry.getAttribute('position'), colors = geometry.getAttribute('color'), tools: number[] = [];
        indices.forEach((index, i) => {
          const regionFactor = live.state.factors[plan.regionIds[index]] || 0;
          const d = [0, 1, 2].map(k => plan.delta[index * 3 + k] * regionFactor + plan.cleanup[index * 3 + k] * live.state.cleanup);
          for (let k = 0; k < 3; k++) (positions.array as Float32Array)[i * 3 + k] = plan.original[index * 3 + k] + d[k];
          const magnitude = Math.hypot(...d) / plan.scale / Math.max(plan.stats.max, 1e-9);
          const color = magnitude < .00001 ? new THREE.Color('#f1f5f2') : new THREE.Color('#25a9b9').lerp(new THREE.Color('#e9824d'), magnitude);
          colors.setXYZ(i, color.r, color.g, color.b);
          if (i % 24 === 0 && plan.regionIds[index] === live.focus) {
            const p = [0, 1, 2].map(k => plan.original[index * 3 + k]);
            // Displacement vectors on actual vertices; distinct tools, not unrelated procedural geometry.
            if (r.kind === 'topology') tools.push(...p, ...p.map((v, k) => v + d[k] * 8));
            else if (r.kind === 'hole') tools.push(p[0], p[1], p[2] + .045 * (1 - regionFactor), p[0] + d[0], p[1] + d[1], p[2] + d[2]);
            else if (r.kind === 'margin' && i + 1 < indices.length) { const j = indices[i + 1]; tools.push(...p, ...[0, 1, 2].map(k => plan.original[j * 3 + k] + plan.delta[j * 3 + k] * regionFactor)); }
          }
        });
        if (r.kind === 'fissure') for (let i = 0; i < r.section.length / 9; i++) tools.push(...[0, 1, 2].map(k => r.section[i * 9 + k] + r.section[i * 9 + k + 3] * live.state.factors[live.focus] + r.section[i * 9 + k + 6] * live.state.cleanup));
        positions.needsUpdate = true; colors.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingSphere();
        toolGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tools), 3)); lastKey = key;
      }
      const rect = host.getBoundingClientRect();
      if (rect.width !== lastWidth || rect.height !== lastHeight) { renderer.setSize(rect.width, rect.height, false); lastWidth = rect.width; lastHeight = rect.height; }
      for (const [index, viewport] of [local.current, heat.current].entries()) {
        if (!viewport || viewport.offsetParent === null) continue;
        const box = viewport.getBoundingClientRect(); if (box.width < 1) continue;
        renderer.setViewport(box.left - rect.left, rect.bottom - box.bottom, box.width, box.height);
        renderer.setScissor(box.left - rect.left, rect.bottom - box.bottom, box.width, box.height);
        renderer.setClearColor(0xf0f9f8, 0); renderer.clear();
        if (!live.active) continue;
        camera.aspect = box.width / box.height; camera.updateProjectionMatrix();
        mesh.material = index === 0 ? material : heatMaterial; wire.visible = index === 0; tool.visible = index === 0 && live.state.factors[live.focus] < 1;
        // A restrained orbit reveals actual depth; progress determines the pose.
        camera.position.x = reduced ? .1 : Math.sin(live.state.local * Math.PI) * .22;
        camera.lookAt(0, 0, 0); renderer.render(scene, camera);
      }
    };
    const restart = () => { if (!frame && !disposed) frame = requestAnimationFrame(render); };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; if (visible) restart(); }); observer.observe(host);
    document.addEventListener('visibilitychange', restart); restart();
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', restart); geometry.dispose(); toolGeometry.dispose(); material.dispose(); heatMaterial.dispose(); wireMat.dispose(); toolMat.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  }, [plan]);

  let before = '', after = '';
  if (region && active) {
    const section = region.section, scale = 210 / (region.radius * 2.3);
    const project = (i: number, processed: boolean) => {
      const f = processed ? state.factors[focus] : 0, c = processed ? state.cleanup : 0;
      const x = section[i] + section[i + 3] * f + section[i + 6] * c;
      const z = section[i + 2] + section[i + 5] * f + section[i + 8] * c;
      return `${(120 + (x - region.center[0]) * scale).toFixed(2)},${(75 - (z - region.center[2]) * scale).toFixed(2)}`;
    };
    for (let i = 0; i < section.length; i += 18) { before += `M${project(i, false)}L${project(i + 9, false)}`; after += `M${project(i, true)}L${project(i + 9, true)}`; }
  }
  const max = (plan?.stats.mean || 1) * 1.15;
  const curve: string[] = [];
  if (active && plan) for (let i = 0; i <= 100; i++) {
    const p = i / 100; if (step === 2 && p > progress) break;
    const value = plan.history[i];
    curve.push(`${14 + p * 212},${133 - value / max * 105}`);
  }
  return <div className={`reconstruction-observations selected-${tab}`} ref={root} data-region={region?.id}>
    <div className="observation-tabs" role="tablist" aria-label="观察屏切换">{titles.map((title, i) => <button key={title} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>{title}</button>)}</div>
    {titles.map((title, i) => <section key={title} className={`observation observation-${i} ${tab === i ? 'is-selected' : ''} ${active && (state.denoising ? i === 0 : step === 3 ? i === 2 : i === 0) ? 'is-primary' : ''}`}>
      <header><span className="observation-number">0{i + 1}</span><div><h3>{title}</h3><small>{english[i]}</small></div><b>{active ? region?.id : '—'}</b></header>
      {i === 0 ? <div className="observation-viewport" ref={local}>{!active && <span className="observation-standby">等待区域定位</span>}{error && <span>{error}</span>}{active && mechanism && region && <div className="observation-mechanism"><ReconstructionPatchScene kind={region.kind} progress={state.local}/><small>机制示意 · 非输入网格</small></div>}</div> : i === 2 ? <div className="observation-viewport" ref={heat}>{!active && <span className="observation-standby">处理后形成位移云图</span>}</div> : i === 1 ? <svg viewBox="0 0 240 150" aria-label="同一截面的原始与处理轮廓"><path className="chart-grid" d="M12 45H228M12 90H228M12 135H228M60 15V135M120 15V135M180 15V135"/><path d={before} stroke="#6b8185" strokeWidth="2.5" fill="none"/><path d={after} stroke="#d87555" strokeWidth="1.5" fill="none"/>{!active && <text x="120" y="80" textAnchor="middle">等待截面建立</text>}</svg> : <svg viewBox="0 0 240 150" aria-label="平均修补位移随处理过程变化"><path className="chart-grid" d="M14 30H226M14 80H226M14 133H226"/>{[.37, .58, .79, 1].map((p, ri) => <g key={p}><path d={`M${14 + p * 212} 24V133`} stroke="#c7dedc" strokeDasharray="2 4"/><text x={14 + p * 212 - 8} y="146">{ri + 1}</text></g>)}<polyline points={curve.join(' ')} fill="none" stroke="#238e9a" strokeWidth="2.5"/>{curve.length > 0 && <circle cx={curve.at(-1)!.split(',')[0]} cy={curve.at(-1)!.split(',')[1]} r="4" fill="#d87555"/>}{!active && <text x="120" y="80" textAnchor="middle">等待处理事件</text>}</svg>}
      <footer>{i === 0 ? <><span>{active ? state.denoising ? '特征保留 · 降噪筛选' : region?.action : '同源网格 · 立体观察'}</span><small>{active && region?.kind === 'topology' ? '位移向量 ×8；曲面实际比例' : '原始几何的确定性演示'}</small></> : i === 1 ? <><span><i className="legend-dot original"/>原始 <i className="legend-dot processed"/>处理中</span><small>Y截面 · 与模型橙色截线一致</small></> : i === 2 ? <><div className="repair-legend"><span>0</span><i/><span>{(plan?.stats.max || 0).toPrecision(3)}</span></div><small>位移模长 · 模型单位 · 白色为未修改</small></> : <><span>平均修补位移 · 非精度误差</span><small>{complete ? '处理完成 · 四区事件已记录' : active ? `已完成 ${state.completedRegions}/4 区域` : '曲线随区域处理生成'}</small></>}</footer>
    </section>)}
    {active && <button className="observation-mechanism-toggle" onClick={() => { setMechanism(v => !v); setTab(0); }}>{mechanism ? '返回输入网格' : '查看修补机制'}</button>}
  </div>;
}
