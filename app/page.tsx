/* eslint-disable @next/next/no-html-link-for-pages */
import { HeroToothScene } from "./components/HeroToothScene";

export default function Home() {
  return (
    <main className="site-shell home-shell">
      <header className="topbar">
        <a className="brand-lockup" href="/" aria-label="益贝医疗智能体首页">
          <span className="brand-mark" aria-hidden="true"><i /><i /></span>
          <span>益贝医疗智能体</span>
        </a>
        <span className="topbar-note">DENTAL INTELLIGENCE · 2026</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-kicker reveal-1"><span className="pulse-dot" />医疗智能设计系统</div>
        <h1 id="hero-title" className="hero-title reveal-2">
          让义齿，从几何重建<br />走向<span>仿生设计</span>
        </h1>
        <p className="hero-copy reveal-3">
          从超精准三维轮廓重建，到微织构智能生成与数字孪生验证。<br />
          益贝将复杂的口腔修复科研，转化为可感知、可验证的设计过程。
        </p>

        <div className="hero-stage" aria-label="两款核心产品">
          <div className="orbit orbit-a" aria-hidden="true" />
          <div className="orbit orbit-b" aria-hidden="true" />
          <div className="home-model" aria-hidden="true">
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
            <span className="model-index">YB / STANDARD MOLAR · M1</span>
          </div>

          <a className="product-entry product-entry-left" href="/reconstruction">
            <span className="entry-no">01</span>
            <span className="entry-title">义齿三维轮廓<br />超精准重建智能体</span>
            <span className="entry-action" aria-hidden="true">↗</span>
          </a>

          <a className="product-entry product-entry-right" href="/twin-ai">
            <span className="entry-no">02</span>
            <span className="entry-title">双微AI设计智能体<br />及验证平台</span>
            <span className="entry-action" aria-hidden="true">↗</span>
          </a>
        </div>

        <div className="hero-footer reveal-3">
          <span>3D RECONSTRUCTION</span><i /><span>MICROTEXTURE GENERATION</span><i /><span>DIGITAL TWIN VALIDATION</span>
        </div>
      </section>
    </main>
  );
}
