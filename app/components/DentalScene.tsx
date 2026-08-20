"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type DentalSceneMode = "porcelain" | "scan" | "heatmap" | "repaired" | "texture" | "flow";

type Props = {
  src?: string;
  mode?: DentalSceneMode;
  textureSides?: 3 | 4 | 5 | 6;
  wave?: boolean;
  interactive?: boolean;
  className?: string;
  onLoaded?: (meta: { triangles: number; dimensions: [number, number, number] }) => void;
};

function makePatternTexture(sides: number, wave: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#d8ded8";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "#68746f";
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";

  const radius = sides === 3 ? 34 : sides === 4 ? 30 : 28;
  const stepX = sides === 6 ? 76 : 70;
  const stepY = sides === 6 ? 66 : 70;

  for (let row = -1; row < 6; row++) {
    for (let col = -1; col < 6; col++) {
      const cx = col * stepX + (sides === 6 && row % 2 ? stepX / 2 : 0);
      const cy = row * stepY;
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
        const wobble = wave ? Math.sin(i * 2.7 + row) * 5 : 0;
        const x = cx + Math.cos(angle) * (radius + wobble);
        const y = cy + Math.sin(angle) * (radius + wobble);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.7, 2.7);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function DentalScene({
  src = "/models/demo.stl",
  mode = "porcelain",
  textureSides = 6,
  wave = false,
  interactive = true,
  className,
  onLoaded,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(onLoaded);

  useEffect(() => { loadedRef.current = onLoaded; }, [onLoaded]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0.15, 0.25, 6.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = interactive;
    controls.enableRotate = interactive;
    controls.minDistance = 4.3;
    controls.maxDistance = 9;
    controls.autoRotate = !interactive;
    controls.autoRotateSpeed = 0.7;

    scene.add(new THREE.HemisphereLight(0xf5fff9, 0x31423d, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 5.2);
    key.position.set(-3, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(mode === "heatmap" ? 0xff5c36 : 0x83d6c5, 3.5);
    rim.position.set(4, -1, 3);
    scene.add(rim);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.Material | null = null;
    let pattern: THREE.Texture | null = null;

    const scanLine = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.024),
      new THREE.MeshBasicMaterial({ color: 0xff6a43, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
    );
    scanLine.position.z = 1.1;
    scanLine.visible = mode === "scan" || mode === "heatmap";
    scene.add(scanLine);

    const scanGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xff6a43, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
    );
    scanGlow.position.z = 1.08;
    scanGlow.visible = scanLine.visible;
    scene.add(scanGlow);

    const particleCount = 150;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({ color: 0x83d6c5, size: 0.035, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    particles.visible = mode === "flow";
    scene.add(particles);

    let disposed = false;
    const loadModel = async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error("STL load failed");
        const buffer = await response.arrayBuffer();
        if (disposed) return;
        geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        geometry.center();

        const bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
        const size = new THREE.Vector3();
        bounds.getSize(size);
        const scale = 2.65 / Math.max(size.x, size.y, size.z);
        modelGroup.scale.setScalar(scale);
        modelGroup.rotation.set(-0.12, -0.38, 0.08);

        const position = geometry.getAttribute("position") as THREE.BufferAttribute;
        const uv = new Float32Array(position.count * 2);
        const colors = new Float32Array(position.count * 3);
        const cool = new THREE.Color(0x4b68ff);
        const warm = new THREE.Color(0xff5c36);
        const cyan = new THREE.Color(0x83d6c5);
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i);
          const y = position.getY(i);
          const z = position.getZ(i);
          uv[i * 2] = ((x - bounds.min.x) / Math.max(size.x, 0.001)) * 3;
          uv[i * 2 + 1] = ((y - bounds.min.y) / Math.max(size.y, 0.001)) * 3;
          const signal = Math.min(1, Math.max(0, 0.48 + Math.sin(x * 2.1 + z * 1.7) * 0.29 + y / Math.max(size.y, 1) * 0.42));
          const c = signal < 0.52 ? cool.clone().lerp(cyan, signal * 1.9) : cyan.clone().lerp(warm, (signal - 0.52) * 2.08);
          colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
        }
        geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        if (mode === "heatmap") {
          material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.04 });
        } else if (mode === "texture" || mode === "flow") {
          pattern = makePatternTexture(textureSides, wave);
          material = new THREE.MeshPhysicalMaterial({
            color: 0xe8ede7,
            map: pattern,
            bumpMap: pattern,
            bumpScale: -0.055,
            roughness: 0.45,
            metalness: 0.02,
            clearcoat: 0.25,
          });
        } else {
          material = new THREE.MeshPhysicalMaterial({
            color: mode === "repaired" ? 0xf2f7f1 : 0xdce3dc,
            roughness: mode === "scan" ? 0.56 : 0.3,
            metalness: 0.02,
            clearcoat: 0.42,
            clearcoatRoughness: 0.22,
          });
        }

        const mesh = new THREE.Mesh(geometry, material);
        modelGroup.add(mesh);
        if (mode === "scan") {
          const wire = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: 0x89d8c8, wireframe: true, transparent: true, opacity: 0.13, depthWrite: false })
          );
          wire.scale.setScalar(1.003);
          modelGroup.add(wire);
        }
        loadedRef.current?.({ triangles: position.count / 3, dimensions: [size.x, size.y, size.z] });
      } catch {
        mount.dataset.error = "true";
      }
    };
    loadModel();

    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const t = clock.getElapsedTime();
      controls.update();
      modelGroup.position.y = Math.sin(t * 0.65) * 0.035;
      if (scanLine.visible) {
        const y = -1.35 + ((t * 0.48) % 1) * 2.7;
        scanLine.position.y = y;
        scanGlow.position.y = y;
      }
      if (particles.visible) {
        const attr = particleGeometry.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < particleCount; i++) {
          const phase = t * 0.52 + i / particleCount * Math.PI * 10;
          const loop = ((t * 0.18 + i / particleCount) % 1) * 2.8 - 1.4;
          attr.setXYZ(i, Math.sin(phase) * (1.18 + 0.12 * Math.cos(i)), loop, Math.cos(phase) * 0.82 + 0.75);
        }
        attr.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    render();

    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      geometry?.dispose();
      material?.dispose();
      pattern?.dispose();
      scanLine.geometry.dispose();
      (scanLine.material as THREE.Material).dispose();
      scanGlow.geometry.dispose();
      (scanGlow.material as THREE.Material).dispose();
      particleGeometry.dispose();
      (particles.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src, mode, textureSides, wave, interactive]);

  return <div ref={mountRef} className={className} aria-label="可交互义齿三维模型" />;
}
