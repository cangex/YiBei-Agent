"use client";

import { CSSProperties } from "react";
import { ReconstructionAnomalyKind, ReconstructionPatchScene } from "./ReconstructionPatchScene";

type DetailPhase = { en: string; zh: string; until: number };

type DetailRegion = {
  id: string;
  kind: ReconstructionAnomalyKind;
  name: string;
  locationEn: string;
  issue: string;
  method: string;
  boundaryVertices: number;
  candidates: number;
  continuity: string;
  anchorX: number;
  anchorY: number;
  leaderLength: number;
  leaderAngle: number;
  phases: DetailPhase[];
};

export type ReconstructionDetailState = {
  regionIndex: number;
  localProgress: number;
  repairProgress: number;
  subphaseIndex: number;
  subphaseEn: string;
  subphaseZh: string;
  completedRegions: number;
};

/** The solver intentionally travels from the cervical margin to the occlusal top. */
export const RECONSTRUCTION_DETAIL_REGIONS: DetailRegion[] = [
  {
    id: "P-01", kind: "margin", name: "近中边缘线断口", locationEn: "MESIAL · CERVICAL MARGIN",
    issue: "边缘曲线存在离散断口", method: "端点切向预测 · 多候选样条收敛 · G²边缘缝合",
    boundaryVertices: 112, candidates: 3, continuity: "G²", anchorX: 39, anchorY: 63, leaderLength: 320, leaderAngle: -48,
    phases: [
      { en: "EDGE SEARCH", zh: "边缘搜索", until: 0.15 },
      { en: "BREAKPOINT LOCK", zh: "断口锁定", until: 0.3 },
      { en: "TANGENT PREDICT", zh: "切向推演", until: 0.5 },
      { en: "SPLINE STITCH", zh: "样条缝合", until: 0.86 },
      { en: "G2 VERIFY", zh: "曲率连续校验", until: 1 },
    ],
  },
  {
    id: "P-02", kind: "topology", name: "远中侧壁拓扑噪声", locationEn: "DISTAL SIDEWALL",
    issue: "噪声顶点、翻转法线与非流形连接", method: "异常顶点释放 · 邻域拓扑重连 · 法线协同归一",
    boundaryVertices: 146, candidates: 2, continuity: "C¹", anchorX: 59, anchorY: 56, leaderLength: 158, leaderAngle: -52,
    phases: [
      { en: "NORMAL AUDIT", zh: "法线巡检", until: 0.15 },
      { en: "OUTLIER LOCK", zh: "离群点锁定", until: 0.3 },
      { en: "VERTEX RELEASE", zh: "异常点释放", until: 0.5 },
      { en: "TOPOLOGY RELINK", zh: "拓扑重连", until: 0.84 },
      { en: "NORMAL VERIFY", zh: "法线一致性校验", until: 1 },
    ],
  },
  {
    id: "P-03", kind: "hole", name: "颊侧局部孔洞", locationEn: "BUCCAL SURFACE",
    issue: "闭合边界内部三角面缺失", method: "孔缘脉冲追踪 · 弹性膜生长 · 放射状渐进剖分",
    boundaryVertices: 164, candidates: 4, continuity: "G¹", anchorX: 48, anchorY: 47, leaderLength: 224, leaderAngle: -41,
    phases: [
      { en: "VOID SEARCH", zh: "孔洞搜索", until: 0.15 },
      { en: "BOUNDARY PULSE", zh: "孔缘追踪", until: 0.3 },
      { en: "MEMBRANE GROW", zh: "弹性膜生长", until: 0.5 },
      { en: "RADIAL TESSELLATE", zh: "放射状剖分", until: 0.84 },
      { en: "PATCH RELAX", zh: "补片松弛校验", until: 1 },
    ],
  },
  {
    id: "P-04", kind: "fissure", name: "咬合沟槽中断", locationEn: "OCCLUSAL FISSURE",
    issue: "沟槽流向与曲率轨迹不连续", method: "曲率流线外推 · 沟槽路径择优 · 深度渐进塑形",
    boundaryVertices: 128, candidates: 3, continuity: "G²", anchorX: 45, anchorY: 31, leaderLength: 228, leaderAngle: -13,
    phases: [
      { en: "CURVATURE SEARCH", zh: "曲率搜索", until: 0.15 },
      { en: "FLOW BREAK LOCK", zh: "流向断点锁定", until: 0.3 },
      { en: "PATH PREDICT", zh: "沟槽路径推演", until: 0.5 },
      { en: "GROOVE SCULPT", zh: "沟槽渐进塑形", until: 0.86 },
      { en: "FLOW VERIFY", zh: "流向连续校验", until: 1 },
    ],
  },
];

function phaseProgress(progress: number, start: number, end: number) {
  const value = Math.max(0, Math.min(1, (progress - start) / Math.max(0.0001, end - start)));
  return value * value * (3 - 2 * value);
}

export function resolveReconstructionDetail(activeStep: number, stageProgress: number, running: boolean): ReconstructionDetailState | null {
  if (!running || activeStep !== 2) return null;
  const regionPosition = Math.min(3.9999, Math.max(0, stageProgress) * RECONSTRUCTION_DETAIL_REGIONS.length);
  const regionIndex = Math.floor(regionPosition);
  const localProgress = regionPosition - regionIndex;
  const region = RECONSTRUCTION_DETAIL_REGIONS[regionIndex];
  const subphaseIndex = Math.max(0, region.phases.findIndex((phase) => localProgress <= phase.until));
  const subphase = region.phases[subphaseIndex];
  const localRepair = phaseProgress(localProgress, 0.3, 0.86);
  return {
    regionIndex,
    localProgress,
    repairProgress: (regionIndex + localRepair) / RECONSTRUCTION_DETAIL_REGIONS.length,
    subphaseIndex,
    subphaseEn: subphase.en,
    subphaseZh: subphase.zh,
    completedRegions: regionIndex,
  };
}

export function ReconstructionDetailOverlay({ detail }: { detail: ReconstructionDetailState }) {
  const region = RECONSTRUCTION_DETAIL_REGIONS[detail.regionIndex];
  const residual = Math.max(0.016, 0.38 - detail.localProgress * 0.35);
  const style = {
    "--focus-x": `${region.anchorX}%`, "--focus-y": `${region.anchorY}%`,
    "--leader-length": `${region.leaderLength}px`, "--leader-angle": `${region.leaderAngle}deg`,
  } as CSSProperties;

  return (
    <div className={`reconstruction-detail-overlay anomaly-${region.kind}`} style={style} aria-label="局部三维异常发现与轮廓修复计算细节">
      <div className="reconstruction-patch-atlas" aria-hidden="true">
        {RECONSTRUCTION_DETAIL_REGIONS.slice(0, detail.regionIndex + 1).map((patch, index) => (
          <i key={patch.id} className={`patch-memory-marker ${index === detail.regionIndex ? "is-current" : ""} ${index < detail.completedRegions ? "is-complete" : ""}`} style={{ left: `${patch.anchorX}%`, top: `${patch.anchorY}%` }} />
        ))}
        <span className="detail-focus-locator"><i /><b /></span>
        <span className="detail-focus-leader"><i /></span>
      </div>

      <section className="reconstruction-detail-viewport">
        <header>
          <span>3D LOCAL REPAIR · PATCH {String(detail.regionIndex + 1).padStart(2, "0")} / 04</span>
          <i>{region.id}</i><strong>{region.name}</strong>
          <small>{region.locationEn} · {region.issue}</small>
        </header>

        <div className="reconstruction-detail-canvas">
          <ReconstructionPatchScene kind={region.kind} progress={detail.localProgress} />
          <span><i /> LIVE 3D LOCAL SOLVER</span><em>{region.kind.toUpperCase()} REPAIR RIG</em>
        </div>

        <div className="reconstruction-detail-phase">
          <b>{detail.subphaseZh}</b><span>{detail.subphaseEn}</span>
          <div>{region.phases.map((phase, index) => <i key={phase.en} className={index < detail.subphaseIndex ? "is-done" : index === detail.subphaseIndex ? "is-active" : ""} />)}</div>
        </div>

        <footer>
          <span><small>边界顶点</small><strong>{region.boundaryVertices + Math.round(detail.localProgress * 14)}</strong></span>
          <span><small>候选路径</small><strong>{detail.localProgress < 0.3 ? "—" : String(region.candidates).padStart(2, "0")}</strong></span>
          <span><small>连续约束</small><strong>{region.continuity}</strong></span>
          <span><small>局部残差</small><strong>{residual.toFixed(3)}</strong></span>
        </footer>
        <p>{region.method}</p>
      </section>
    </div>
  );
}
