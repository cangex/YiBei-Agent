"use client";

import { useEffect, useRef } from "react";

export function MicroTextureLens({ sides, wave }: { sides: 3 | 4 | 5 | 6; wave: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let raf = 0;

    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio, 2);
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * ratio || canvas.height !== rect.height * ratio) {
        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const gradient = ctx.createRadialGradient(w * .48, h * .45, 5, w * .5, h * .5, w * .6);
      gradient.addColorStop(0, "rgba(131,214,197,.16)");
      gradient.addColorStop(1, "rgba(131,214,197,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      const radius = sides === 3 ? 26 : sides === 4 ? 24 : 22;
      const sx = sides === 6 ? 58 : 55;
      const sy = sides === 6 ? 50 : 55;
      const drift = (frame * .12) % sy;
      ctx.strokeStyle = "rgba(231,239,234,.62)";
      ctx.lineWidth = 1.15;
      ctx.lineJoin = "round";

      for (let row = -2; row < h / sy + 2; row++) {
        for (let col = -2; col < w / sx + 2; col++) {
          const cx = col * sx + (sides === 6 && row % 2 ? sx / 2 : 0);
          const cy = row * sy + drift;
          ctx.beginPath();
          for (let i = 0; i <= sides; i++) {
            const a = -Math.PI / 2 + Math.PI * 2 * i / sides;
            const distortion = wave ? Math.sin(frame * .025 + i * 2.3 + row * .7) * 3.5 : 0;
            const x = cx + Math.cos(a) * (radius + distortion);
            const y = cy + Math.sin(a) * (radius + distortion);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      ctx.strokeStyle = "rgba(255,92,54,.85)";
      ctx.lineWidth = 1;
      const scanY = (frame * .9) % Math.max(h, 1);
      ctx.beginPath();
      ctx.moveTo(0, scanY);
      ctx.lineTo(w, scanY);
      ctx.stroke();
      frame += 1;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [sides, wave]);

  return <canvas ref={ref} className="texture-lens-canvas" aria-label={`${sides}边${wave ? "波浪线" : "直线"}仿生微织构动态预览`} />;
}
