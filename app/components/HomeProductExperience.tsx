"use client";

import { useEffect, useState } from "react";
import { HeroToothScene } from "./HeroToothScene";

type SurfaceMode = 0 | 1 | 2 | 3 | null;

const phases = [
  { number: "01", en: "CAPTURE", aria: "口腔修复体扫描平台", title: <>口腔修复体<br />扫描平台</> },
  { number: "02", en: "RECONSTRUCT", aria: "义齿三维轮廓超精准重建智能体", title: <>义齿三维轮廓<br />超精准重建智能体</>, href: "/reconstruction" },
  { number: "03", en: "DESIGN · VERIFY", aria: "双微AI设计智能体及验证平台", title: <>双微AI设计智能体<br />及验证平台</>, href: "/twin-ai" },
  { number: "04", en: "FABRICATE", aria: "仿生微纳织构加工平台", title: <>仿生微纳织构<br />加工平台</> },
] as const;

export function HomeProductExperience() {
  const [mode, setMode] = useState<SurfaceMode>(null);
  const [autoMode, setAutoMode] = useState<Exclude<SurfaceMode, null>>(0);
  const effectiveMode = mode ?? autoMode;
  const activate = (index: number) => setMode(index as Exclude<SurfaceMode, null>);
  const deactivate = () => setMode(null);

  useEffect(() => {
    if (mode !== null) return;
    const timer = window.setInterval(() => setAutoMode((current) => ((current + 1) % 4) as Exclude<SurfaceMode, null>), 5200);
    return () => window.clearInterval(timer);
  }, [mode]);

  return (
    <div className="home-product-experience">
      <div className="hero-stage single-tooth-hero-stage" aria-label="单颗牙齿精密扫描主视觉">
        <div className="orbit orbit-a" aria-hidden="true" />
        <div className="orbit orbit-b" aria-hidden="true" />
        <div className="home-model home-single-tooth-model" aria-hidden="true">
          <HeroToothScene className="dental-scene home-dental-scene" />
          <span className="scan-frame-corner corner-a" />
          <span className="scan-frame-corner corner-b" />
          <span className="scan-frame-corner corner-c" />
          <span className="scan-frame-corner corner-d" />
          <span className="scan-readout">
            <b>STRUCTURED SURFACE CAPTURE</b>
            <small>NORMAL · CURVATURE · DEPTH</small>
          </span>
          <span className="scan-depth-rail"><i /><i /><i /><i /><i /><i /><i /></span>
          <span className="model-index">YB / SQUARE CROWN · M1</span>
        </div>
      </div>

      <nav className="home-product-rail reveal-3" aria-label="口腔修复体智能设计产品链路">
        <div className="home-product-track">
          {phases.map((phase, index) => {
            const content = (
              <>
                <span className="home-product-node" aria-hidden="true"><i>↗</i></span>
                <span className="home-product-meta"><b>{phase.number}</b><em>{phase.en}</em></span>
                <strong>{phase.title}</strong>
              </>
            );
            const interaction = {
              onMouseEnter: () => activate(index),
              onMouseLeave: deactivate,
              onFocus: () => activate(index),
              onBlur: deactivate,
            };
            if ("href" in phase) {
              return <a key={phase.number} className={`home-product-entry is-available${effectiveMode === index ? " is-active" : ""}`} href={phase.href} aria-label={`进入${phase.aria}`} {...interaction}>{content}</a>;
            }
            return <button key={phase.number} className={`home-product-entry is-available${effectiveMode === index ? " is-active" : ""}`} type="button" aria-disabled="true" aria-label={`${phase.aria}，规划中`} {...interaction}>{content}</button>;
          })}
        </div>
      </nav>
    </div>
  );
}
