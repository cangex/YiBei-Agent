/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */
import { HomeProductExperience } from "./components/HomeProductExperience";

export default function Home() {
  return (
    <main className="site-shell home-shell">
      <header className="topbar">
        <a className="brand-lockup home-brand-lockup" href="/" aria-label="益贝医疗智能体首页">
          <span className="home-brand-logo" aria-hidden="true">
            <img src="/brand/yibei-medical-logo.png" width="1608" height="1998" alt="" />
          </span>
          <span>益贝医疗智能体</span>
        </a>
        <span className="topbar-note">DENTAL INTELLIGENCE · 2026</span>
      </header>

      <section className="hero home-hero" aria-labelledby="hero-title">
        <div className="hero-kicker reveal-1"><span className="pulse-dot" />精准口腔微生态调控专家</div>
        <h1 id="hero-title" className="hero-title reveal-2">
          以仿生微织构，探寻智能口腔修复体<span>未来式</span>
        </h1>

        <HomeProductExperience />
      </section>
    </main>
  );
}
