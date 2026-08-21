"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

type Props = { className?: string };
type SliceSample = { centerX: number; centerZ: number; radiusX: number; radiusZ: number };
type ScanRig = {
  group: THREE.Group;
  scanner: THREE.Group;
  contour: THREE.LineLoop;
  emitters: THREE.Points;
  revealMaterial: THREE.ShaderMaterial;
  pointMaterial: THREE.ShaderMaterial;
  normalMaterial: THREE.ShaderMaterial;
  completionRing: THREE.Mesh;
  completionMaterial: THREE.MeshBasicMaterial;
  profile: SliceSample[];
  minY: number;
  maxY: number;
  baseRotationY: number;
};

const AQUA = new THREE.Color(0x73cdbd);
const AQUA_PALE = new THREE.Color(0xd9fff5);
const SIGNAL = new THREE.Color(0xff6a43);
const MODEL_URL = "/models/standard-molar.stl";
const CROWN_START_RATIO = 0.53;
const ROOT_COMPRESSION = 0.18;

function smoothstep(min: number, max: number, value: number) {
  const x = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
}

function prepareToothGeometry(geometry: THREE.BufferGeometry) {
  // The source molar uses Z as its long axis. Reorient and normalize it once so every
  // scanning layer shares the same anatomical coordinate system.
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingBox();
  const sourceBounds = geometry.boundingBox;
  if (sourceBounds) {
    const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
    const crownStart = sourceBounds.min.y + sourceHeight * CROWN_START_RATIO;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < position.count; index++) {
      const y = position.getY(index);
      if (y < crownStart) position.setY(index, crownStart + (y - crownStart) * ROOT_COMPRESSION);
    }
    position.needsUpdate = true;
    geometry.computeBoundingBox();
  }
  const center = new THREE.Vector3();
  geometry.boundingBox?.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox?.getSize(size);
  const scale = 2.5 / Math.max(size.y, 0.001);
  geometry.scale(scale, scale, scale);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPointCloud(source: THREE.BufferGeometry) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / 18_000));
  const values = new Float32Array(Math.ceil(position.count / stride) * 3);
  let cursor = 0;
  for (let index = 0; index < position.count; index += stride) {
    values[cursor++] = position.getX(index);
    values[cursor++] = position.getY(index);
    values[cursor++] = position.getZ(index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
  return geometry;
}

function createNormalField(source: THREE.BufferGeometry) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / 760));
  const lines: number[] = [];
  for (let index = 0; index < position.count; index += stride) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const scale = 0.064 + smoothstep(-0.2, 1.5, y) * 0.026;
    lines.push(x, y, z, x + normal.getX(index) * scale, y + normal.getY(index) * scale, z + normal.getZ(index) * scale);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  return geometry;
}

function createSliceProfile(source: THREE.BufferGeometry, minY: number, maxY: number, bins = 112) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const raw = Array.from({ length: bins }, () => ({
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    count: 0,
  }));
  const span = Math.max(maxY - minY, 0.001);
  for (let index = 0; index < position.count; index++) {
    const bin = THREE.MathUtils.clamp(Math.floor((position.getY(index) - minY) / span * bins), 0, bins - 1);
    const sample = raw[bin];
    const x = position.getX(index);
    const z = position.getZ(index);
    sample.minX = Math.min(sample.minX, x);
    sample.maxX = Math.max(sample.maxX, x);
    sample.minZ = Math.min(sample.minZ, z);
    sample.maxZ = Math.max(sample.maxZ, z);
    sample.count++;
  }
  const valid = raw.map((sample, index) => sample.count > 0 ? index : -1).filter((index) => index >= 0);
  return raw.map((sample, index): SliceSample => {
    let resolved = sample;
    if (!sample.count) {
      const nearest = valid.reduce((best, candidate) => Math.abs(candidate - index) < Math.abs(best - index) ? candidate : best, valid[0] ?? 0);
      resolved = raw[nearest];
    }
    return {
      centerX: (resolved.minX + resolved.maxX) * 0.5,
      centerZ: (resolved.minZ + resolved.maxZ) * 0.5,
      radiusX: Math.max(0.026, (resolved.maxX - resolved.minX) * 0.51),
      radiusZ: Math.max(0.026, (resolved.maxZ - resolved.minZ) * 0.51),
    };
  });
}

function sampleSlice(profile: SliceSample[], minY: number, maxY: number, y: number) {
  const position = THREE.MathUtils.clamp((y - minY) / Math.max(maxY - minY, 0.001), 0, 1) * (profile.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(profile.length - 1, lower + 1);
  const mix = position - lower;
  return {
    centerX: THREE.MathUtils.lerp(profile[lower].centerX, profile[upper].centerX, mix),
    centerZ: THREE.MathUtils.lerp(profile[lower].centerZ, profile[upper].centerZ, mix),
    radiusX: THREE.MathUtils.lerp(profile[lower].radiusX, profile[upper].radiusX, mix),
    radiusZ: THREE.MathUtils.lerp(profile[lower].radiusZ, profile[upper].radiusZ, mix),
  };
}

function updateLoop(attribute: THREE.BufferAttribute, section: SliceSample) {
  for (let index = 0; index < attribute.count; index++) {
    const angle = index / attribute.count * Math.PI * 2;
    attribute.setXYZ(index, section.centerX + Math.cos(angle) * section.radiusX, 0, section.centerZ + Math.sin(angle) * section.radiusZ);
  }
  attribute.needsUpdate = true;
}

function createContour() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(160 * 3), 3));
  return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({
    color: 0xc8fff2,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
}

export function HeroToothScene({ className }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0.05, 0.02, 5.55);
    camera.lookAt(0, -0.04, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);
    mount.dataset.modelState = "loading";

    scene.add(new THREE.HemisphereLight(0xf8fff8, 0x52605b, 2.35));
    const keyLight = new THREE.DirectionalLight(0xffffff, 5.9);
    keyLight.position.set(-3.2, 5.1, 4.8);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9ce9d8, 2.2);
    fillLight.position.set(3.9, -0.7, 3.1);
    scene.add(fillLight);
    const warmEdge = new THREE.PointLight(0xff9a72, 0.72, 8);
    warmEdge.position.set(-2.7, 0.8, 2.2);
    scene.add(warmEdge);

    const orbitalGeometry = new THREE.BufferGeometry();
    const orbitalCount = 42;
    orbitalGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(orbitalCount * 3), 3));
    scene.add(new THREE.Points(orbitalGeometry, new THREE.PointsMaterial({
      color: 0x7bd9c5,
      size: 0.024,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })));

    let disposed = false;
    let frame = 0;
    let rig: ScanRig | null = null;

    new STLLoader().load(MODEL_URL, (loadedGeometry) => {
      if (disposed) {
        loadedGeometry.dispose();
        return;
      }
      const toothGeometry = prepareToothGeometry(loadedGeometry);
      const bounds = toothGeometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(toothGeometry.getAttribute("position") as THREE.BufferAttribute);
      const size = new THREE.Vector3();
      bounds.getSize(size);
      const minY = bounds.min.y;
      const maxY = bounds.max.y;
      const profile = createSliceProfile(toothGeometry, minY, maxY);
      const toothGroup = new THREE.Group();
      const baseRotationY = 0.62;
      toothGroup.rotation.set(0.14, baseRotationY, 0.014);
      toothGroup.position.y = 0.04;
      scene.add(toothGroup);

      toothGroup.add(new THREE.Mesh(toothGeometry, new THREE.MeshPhysicalMaterial({
        color: 0xe9ebe3,
        roughness: 0.3,
        metalness: 0.01,
        clearcoat: 0.5,
        clearcoatRoughness: 0.22,
        sheen: 0.15,
        sheenColor: new THREE.Color(0xc7e8df),
        iridescence: 0.045,
        iridescenceIOR: 1.33,
      })));

      const revealMaterial = new THREE.ShaderMaterial({
        uniforms: { uScanY: { value: minY }, uOpacity: { value: 1 }, uAqua: { value: AQUA }, uSignal: { value: SIGNAL } },
        vertexShader: `
          varying float vLocalY;
          void main() {
            vLocalY = position.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uScanY;
          uniform float uOpacity;
          uniform vec3 uAqua;
          uniform vec3 uSignal;
          varying float vLocalY;
          void main() {
            if (vLocalY > uScanY + 0.035) discard;
            float distanceBehind = max(0.0, uScanY - vLocalY);
            float activeBand = 1.0 - smoothstep(0.0, 0.18, distanceBehind);
            float retainedField = 1.0 - smoothstep(0.0, 2.65, distanceBehind);
            vec3 color = mix(uAqua, uSignal, activeBand * 0.14);
            float alpha = (0.035 + retainedField * 0.1 + activeBand * 0.29) * uOpacity;
            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        wireframe: true,
      });
      const revealedTopology = new THREE.Mesh(toothGeometry, revealMaterial);
      revealedTopology.scale.setScalar(1.003);
      toothGroup.add(revealedTopology);

      const pointGeometry = createPointCloud(toothGeometry);
      const pointMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uScanY: { value: minY },
          uOpacity: { value: 1 },
          uPixelRatio: { value: renderer.getPixelRatio() },
          uAqua: { value: AQUA_PALE },
          uSignal: { value: SIGNAL },
        },
        vertexShader: `
          uniform float uScanY;
          uniform float uOpacity;
          uniform float uPixelRatio;
          varying float vAlpha;
          varying float vBand;
          void main() {
            float distanceToScan = abs(position.y - uScanY);
            float activeBand = 1.0 - smoothstep(0.012, 0.12, distanceToScan);
            float passed = 1.0 - step(uScanY, position.y);
            float trail = 1.0 - smoothstep(0.0, 1.15, max(0.0, uScanY - position.y));
            vBand = activeBand;
            vAlpha = (activeBand * 0.96 + passed * trail * 0.115) * uOpacity;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = (1.05 + activeBand * 2.6) * uPixelRatio * (5.7 / max(1.0, -mvPosition.z));
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 uAqua;
          uniform vec3 uSignal;
          varying float vAlpha;
          varying float vBand;
          void main() {
            vec2 centered = gl_PointCoord - 0.5;
            float radius = length(centered);
            if (radius > 0.5 || vAlpha < 0.01) discard;
            float core = 1.0 - smoothstep(0.08, 0.5, radius);
            vec3 color = mix(uAqua, uSignal, vBand * 0.08);
            gl_FragColor = vec4(color, vAlpha * core);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      toothGroup.add(new THREE.Points(pointGeometry, pointMaterial));

      const normalGeometry = createNormalField(toothGeometry);
      const normalMaterial = new THREE.ShaderMaterial({
        uniforms: { uScanY: { value: minY }, uOpacity: { value: 1 }, uColor: { value: AQUA } },
        vertexShader: `
          varying float vLocalY;
          void main() {
            vLocalY = position.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uScanY;
          uniform float uOpacity;
          uniform vec3 uColor;
          varying float vLocalY;
          void main() {
            float distanceBehind = uScanY - vLocalY;
            if (distanceBehind < -0.02 || distanceBehind > 0.4) discard;
            float fade = 1.0 - smoothstep(0.1, 0.4, distanceBehind);
            gl_FragColor = vec4(uColor, fade * 0.31 * uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      toothGroup.add(new THREE.LineSegments(normalGeometry, normalMaterial));

      const scannerGroup = new THREE.Group();
      toothGroup.add(scannerGroup);
      const scanWidth = Math.max(size.x, size.z) * 1.34;
      scannerGroup.add(new THREE.Mesh(new THREE.BoxGeometry(scanWidth, 0.01, scanWidth), new THREE.MeshBasicMaterial({
        color: 0xbff9eb,
        transparent: true,
        opacity: 0.062,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })));
      scannerGroup.add(new THREE.Mesh(new THREE.BoxGeometry(scanWidth * 0.96, 0.072, scanWidth * 0.96), new THREE.MeshBasicMaterial({
        color: 0x7bd9c5,
        transparent: true,
        opacity: 0.019,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })));
      const scanGrid = new THREE.GridHelper(scanWidth, 20, 0x8fe1d0, 0x8fe1d0);
      const gridMaterials = Array.isArray(scanGrid.material) ? scanGrid.material : [scanGrid.material];
      gridMaterials.forEach((material) => {
        material.transparent = true;
        material.opacity = 0.055;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
      });
      scannerGroup.add(scanGrid);

      const contour = createContour();
      scannerGroup.add(contour);
      const emitterGeometry = new THREE.BufferGeometry();
      emitterGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(32 * 3), 3));
      const emitters = new THREE.Points(emitterGeometry, new THREE.PointsMaterial({
        color: 0xe8fff9,
        size: 0.024,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      scannerGroup.add(emitters);

      const completionMaterial = new THREE.MeshBasicMaterial({
        color: 0x83d6c5,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const crownSection = sampleSlice(profile, minY, maxY, maxY - (maxY - minY) * 0.04);
      const ringRadius = Math.max(crownSection.radiusX, crownSection.radiusZ) * 1.2;
      const completionRing = new THREE.Mesh(new THREE.RingGeometry(ringRadius, ringRadius + 0.012, 160), completionMaterial);
      completionRing.rotation.x = -Math.PI / 2;
      completionRing.position.y = maxY;
      toothGroup.add(completionRing);

      rig = {
        group: toothGroup,
        scanner: scannerGroup,
        contour,
        emitters,
        revealMaterial,
        pointMaterial,
        normalMaterial,
        completionRing,
        completionMaterial,
        profile,
        minY,
        maxY,
        baseRotationY,
      };
      mount.dataset.modelState = "ready";
    }, undefined, () => {
      if (!disposed) mount.dataset.modelState = "error";
    });

    const updateScannerContour = (activeRig: ScanRig, scanY: number) => {
      const section = sampleSlice(activeRig.profile, activeRig.minY, activeRig.maxY, scanY);
      updateLoop(activeRig.contour.geometry.getAttribute("position") as THREE.BufferAttribute, section);
      const emitters = activeRig.emitters.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < emitters.count; index++) {
        const angle = index / emitters.count * Math.PI * 2;
        emitters.setXYZ(
          index,
          section.centerX + Math.cos(angle) * section.radiusX * 1.035,
          0.006,
          section.centerZ + Math.sin(angle) * section.radiusZ * 1.035,
        );
      }
      emitters.needsUpdate = true;
    };

    const clock = new THREE.Clock();
    const render = () => {
      const elapsed = reducedMotion ? 4.35 : clock.getElapsedTime();
      const phase = (elapsed % 8.4) / 8.4;
      const scanProgress = phase < 0.11 ? 0 : phase < 0.76 ? smoothstep(0.11, 0.76, phase) : 1;
      const resetFade = phase < 0.86 ? 1 : 1 - smoothstep(0.86, 1, phase);
      const completion = smoothstep(0.76, 0.82, phase) * (1 - smoothstep(0.91, 1, phase));
      const activeRig = rig;
      if (activeRig) {
        const scanY = THREE.MathUtils.lerp(activeRig.minY + 0.012, activeRig.maxY - 0.012, scanProgress);
        activeRig.group.rotation.y = activeRig.baseRotationY + Math.sin(elapsed * 0.21) * 0.095;
        activeRig.group.rotation.x = 0.14 + Math.sin(elapsed * 0.16) * 0.022;
        activeRig.group.position.y = 0.04 + Math.sin(elapsed * 0.47) * 0.022;
        activeRig.scanner.position.y = scanY;
        activeRig.scanner.visible = resetFade > 0.02;
        updateScannerContour(activeRig, scanY);
        activeRig.revealMaterial.uniforms.uScanY.value = scanY;
        activeRig.revealMaterial.uniforms.uOpacity.value = resetFade * (0.82 + completion * 0.18);
        activeRig.pointMaterial.uniforms.uScanY.value = scanY;
        activeRig.pointMaterial.uniforms.uOpacity.value = resetFade;
        activeRig.normalMaterial.uniforms.uScanY.value = scanY;
        activeRig.normalMaterial.uniforms.uOpacity.value = resetFade;
        activeRig.completionRing.scale.setScalar(1 + completion * 1.2);
        activeRig.completionMaterial.opacity = completion * 0.2;
      }

      const orbitalAttribute = orbitalGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < orbitalCount; index++) {
        const lane = index % 3;
        const angle = elapsed * (0.14 + lane * 0.025) + index / orbitalCount * Math.PI * 2;
        orbitalAttribute.setXYZ(index, Math.cos(angle) * (1.2 + lane * 0.12), -0.1 + Math.sin(angle) * (0.83 + lane * 0.07), 0.1 + Math.sin(angle * 0.7 + lane) * 0.2);
      }
      orbitalAttribute.needsUpdate = true;
      renderer.render(scene, camera);
      if (!reducedMotion) frame = requestAnimationFrame(render);
    };

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (rig) rig.pointMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    render();

    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      delete mount.dataset.modelState;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className={className} aria-label="标准成人磨牙精密扫描三维模型" />;
}
