"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Props = {
  className?: string;
};

const AQUA = new THREE.Color(0x73cdbd);
const AQUA_PALE = new THREE.Color(0xd9fff5);
const SIGNAL = new THREE.Color(0xff6a43);

function smoothstep(min: number, max: number, value: number) {
  const x = THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
}

function createCrown() {
  const geometry = new THREE.SphereGeometry(1, 104, 72);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  for (let index = 0; index < position.count; index++) {
    const sourceX = position.getX(index);
    const sourceY = position.getY(index);
    const sourceZ = position.getZ(index);
    const angle = Math.atan2(sourceZ, sourceX);
    const height = (sourceY + 1) * 0.5;
    const upper = smoothstep(0.42, 1, height);
    const neck = 0.7 + 0.31 * smoothstep(0.03, 0.48, height);
    const shoulder = 1 - 0.045 * smoothstep(0.78, 1, height);
    const lobe = 1 + Math.cos(angle * 4 + 0.24) * 0.036 * upper;
    const cusp = Math.pow(upper, 2.15) * (0.065 + Math.cos(angle * 4 + 0.32) * 0.065);
    const centralFossa = Math.exp(-(sourceX * sourceX / 0.24 + sourceZ * sourceZ / 0.17)) * upper * 0.12;
    const longitudinalGroove = Math.exp(-(sourceX * sourceX / 0.035)) * Math.exp(-(sourceZ * sourceZ / 0.8)) * upper * 0.038;

    position.setXYZ(
      index,
      sourceX * 1.08 * neck * shoulder * lobe,
      sourceY * 0.73 + 0.37 + cusp - centralFossa - longitudinalGroove,
      sourceZ * 0.87 * neck * shoulder * (1 - Math.cos(angle * 2) * 0.018),
    );
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createRoot(offsetX: number, offsetZ: number, curveX: number, curveZ: number, length: number, radius: number) {
  const geometry = new THREE.CylinderGeometry(radius, 0.035, length, 52, 30, false);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;

  for (let index = 0; index < position.count; index++) {
    const sourceX = position.getX(index);
    const sourceY = position.getY(index);
    const sourceZ = position.getZ(index);
    const normalized = THREE.MathUtils.clamp((sourceY + length * 0.5) / length, 0, 1);
    const tipInfluence = Math.pow(1 - normalized, 1.75);
    const waist = 0.94 + Math.sin(normalized * Math.PI) * 0.08;

    position.setXYZ(
      index,
      sourceX * waist + offsetX + curveX * tipInfluence,
      sourceY - 1.12,
      sourceZ * 0.78 * waist + offsetZ + curveZ * tipInfluence,
    );
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createNeck() {
  const geometry = new THREE.SphereGeometry(1, 72, 42);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index++) {
    position.setXYZ(
      index,
      position.getX(index) * 0.7,
      position.getY(index) * 0.31 - 0.27,
      position.getZ(index) * 0.57,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createAnatomicalTooth() {
  const parts = [
    createCrown(),
    createNeck(),
    createRoot(-0.27, 0.03, -0.17, 0.05, 1.76, 0.27),
    createRoot(0.28, -0.035, 0.15, -0.045, 1.69, 0.255),
  ];
  const geometry = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!geometry) throw new Error("Unable to construct anatomical tooth geometry");
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createPointCloud(source: THREE.BufferGeometry) {
  const sourcePosition = source.getAttribute("position") as THREE.BufferAttribute;
  const stride = 2;
  const count = Math.ceil(sourcePosition.count / stride);
  const positions = new Float32Array(count * 3);
  let cursor = 0;

  for (let index = 0; index < sourcePosition.count; index += stride) {
    positions[cursor++] = sourcePosition.getX(index);
    positions[cursor++] = sourcePosition.getY(index);
    positions[cursor++] = sourcePosition.getZ(index);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function createNormalField(source: THREE.BufferGeometry) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const lines: number[] = [];

  for (let index = 0; index < position.count; index += 86) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const scale = y > -0.35 ? 0.105 : 0.075;
    lines.push(x, y, z, x + normal.getX(index) * scale, y + normal.getY(index) * scale, z + normal.getZ(index) * scale);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  return geometry;
}

function crownCrossSection(y: number) {
  const relative = THREE.MathUtils.clamp((y + 0.34) / 1.48, 0, 1);
  const envelope = Math.sqrt(Math.max(0.03, 1 - Math.pow((y - 0.38) / 0.93, 2)));
  return {
    x: 0.68 + envelope * 0.37 - relative * 0.025,
    z: 0.54 + envelope * 0.27 - relative * 0.02,
  };
}

function updateLoop(attribute: THREE.BufferAttribute, y: number, radiusX: number, radiusZ: number, centerX = 0, centerZ = 0, lobes = true) {
  for (let index = 0; index < attribute.count; index++) {
    const angle = index / attribute.count * Math.PI * 2;
    const lobe = lobes ? 1 + Math.cos(angle * 4 + 0.25) * 0.025 : 1;
    attribute.setXYZ(index, centerX + Math.cos(angle) * radiusX * lobe, y, centerZ + Math.sin(angle) * radiusZ * lobe);
  }
  attribute.needsUpdate = true;
}

function createContour(resolution: number, color: number, opacity: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(resolution * 3), 3));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.LineLoop(geometry, material);
}

export function HeroToothScene({ className }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 100);
    camera.position.set(0.08, -0.08, 6.25);
    camera.lookAt(0, -0.3, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.13;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf8fff8, 0x52605b, 2.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 5.8);
    keyLight.position.set(-3.4, 5.2, 4.6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9ce9d8, 2.1);
    fillLight.position.set(3.8, -0.8, 3.2);
    scene.add(fillLight);
    const warmEdge = new THREE.PointLight(0xff9a72, 1.15, 8);
    warmEdge.position.set(-2.6, 0.9, 2.1);
    scene.add(warmEdge);

    const toothGeometry = createAnatomicalTooth();
    const toothGroup = new THREE.Group();
    toothGroup.rotation.set(-0.08, -0.28, 0.025);
    toothGroup.position.y = 0.24;
    scene.add(toothGroup);

    const toothMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe8eee8,
      roughness: 0.27,
      metalness: 0.015,
      clearcoat: 0.58,
      clearcoatRoughness: 0.19,
      sheen: 0.18,
      sheenColor: new THREE.Color(0xc4eadf),
      iridescence: 0.08,
      iridescenceIOR: 1.34,
    });
    const tooth = new THREE.Mesh(toothGeometry, toothMaterial);
    toothGroup.add(tooth);

    const revealMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uScanY: { value: -2.1 },
        uOpacity: { value: 1 },
        uAqua: { value: AQUA },
        uSignal: { value: SIGNAL },
      },
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
          float activeBand = 1.0 - smoothstep(0.0, 0.2, distanceBehind);
          float retainedField = 1.0 - smoothstep(0.0, 2.5, distanceBehind);
          vec3 color = mix(uAqua, uSignal, activeBand * 0.2);
          float alpha = (0.045 + retainedField * 0.12 + activeBand * 0.32) * uOpacity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      wireframe: true,
    });
    const revealedTopology = new THREE.Mesh(toothGeometry, revealMaterial);
    revealedTopology.scale.setScalar(1.004);
    toothGroup.add(revealedTopology);

    const pointGeometry = createPointCloud(toothGeometry);
    const pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uScanY: { value: -2.1 },
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
          float activeBand = 1.0 - smoothstep(0.015, 0.14, distanceToScan);
          float passed = 1.0 - step(uScanY, position.y);
          float trail = 1.0 - smoothstep(0.0, 1.1, max(0.0, uScanY - position.y));
          vBand = activeBand;
          vAlpha = (activeBand * 0.96 + passed * trail * 0.13) * uOpacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.15 + activeBand * 2.9) * uPixelRatio * (5.8 / max(1.0, -mvPosition.z));
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
          vec3 color = mix(uAqua, uSignal, vBand * 0.12);
          gl_FragColor = vec4(color, vAlpha * core);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const surfaceSamples = new THREE.Points(pointGeometry, pointMaterial);
    toothGroup.add(surfaceSamples);

    const normalGeometry = createNormalField(toothGeometry);
    const normalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uScanY: { value: -2.1 },
        uOpacity: { value: 1 },
        uColor: { value: AQUA },
      },
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
          if (distanceBehind < -0.025 || distanceBehind > 0.46) discard;
          float fade = 1.0 - smoothstep(0.12, 0.46, distanceBehind);
          gl_FragColor = vec4(uColor, fade * 0.34 * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const normalField = new THREE.LineSegments(normalGeometry, normalMaterial);
    toothGroup.add(normalField);

    const scannerGroup = new THREE.Group();
    toothGroup.add(scannerGroup);

    const scanCore = new THREE.Mesh(
      new THREE.BoxGeometry(3.15, 0.012, 2.35),
      new THREE.MeshBasicMaterial({
        color: 0xbff9eb,
        transparent: true,
        opacity: 0.075,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    scannerGroup.add(scanCore);

    const scanVolume = new THREE.Mesh(
      new THREE.BoxGeometry(3.05, 0.085, 2.25),
      new THREE.MeshBasicMaterial({
        color: 0x7bd9c5,
        transparent: true,
        opacity: 0.022,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    scannerGroup.add(scanVolume);

    const scanGrid = new THREE.GridHelper(3.05, 18, 0x8fe1d0, 0x8fe1d0);
    scanGrid.scale.z = 0.74;
    const gridMaterials = Array.isArray(scanGrid.material) ? scanGrid.material : [scanGrid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.07;
      material.depthWrite = false;
      material.blending = THREE.AdditiveBlending;
    });
    scannerGroup.add(scanGrid);

    const crownContour = createContour(128, 0xc8fff2, 0.88);
    const rootContourA = createContour(72, 0x8cdece, 0.72);
    const rootContourB = createContour(72, 0x8cdece, 0.72);
    scannerGroup.add(crownContour, rootContourA, rootContourB);

    const emitterPositions = new Float32Array(24 * 3);
    const emitterGeometry = new THREE.BufferGeometry();
    emitterGeometry.setAttribute("position", new THREE.BufferAttribute(emitterPositions, 3));
    const emitters = new THREE.Points(
      emitterGeometry,
      new THREE.PointsMaterial({
        color: 0xe8fff9,
        size: 0.026,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    scannerGroup.add(emitters);

    const completionMaterial = new THREE.MeshBasicMaterial({
      color: 0x83d6c5,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const completionRing = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.79, 160), completionMaterial);
    completionRing.rotation.x = -Math.PI / 2;
    completionRing.position.y = 1.16;
    toothGroup.add(completionRing);

    const orbitalGeometry = new THREE.BufferGeometry();
    const orbitalCount = 42;
    orbitalGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(orbitalCount * 3), 3));
    const orbitalPoints = new THREE.Points(
      orbitalGeometry,
      new THREE.PointsMaterial({
        color: 0x7bd9c5,
        size: 0.024,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    scene.add(orbitalPoints);

    const clock = new THREE.Clock();
    let frame = 0;

    const updateScannerContours = (scanY: number) => {
      const crownMaterial = crownContour.material as THREE.LineBasicMaterial;
      const rootMaterialA = rootContourA.material as THREE.LineBasicMaterial;
      const rootMaterialB = rootContourB.material as THREE.LineBasicMaterial;
      const emitterAttribute = emitterGeometry.getAttribute("position") as THREE.BufferAttribute;

      if (scanY >= -0.34) {
        const section = crownCrossSection(scanY);
        updateLoop(crownContour.geometry.getAttribute("position") as THREE.BufferAttribute, 0, section.x, section.z);
        crownContour.visible = true;
        rootContourA.visible = false;
        rootContourB.visible = false;
        crownMaterial.opacity = 0.88;
        for (let index = 0; index < emitterAttribute.count; index++) {
          const angle = index / emitterAttribute.count * Math.PI * 2;
          emitterAttribute.setXYZ(index, Math.cos(angle) * section.x * 1.04, 0.006, Math.sin(angle) * section.z * 1.04);
        }
      } else {
        const normalized = THREE.MathUtils.clamp((scanY + 2) / 1.7, 0, 1);
        const radius = 0.04 + normalized * 0.235;
        const bend = Math.pow(1 - normalized, 1.75);
        updateLoop(rootContourA.geometry.getAttribute("position") as THREE.BufferAttribute, 0, radius, radius * 0.78, -0.27 - 0.17 * bend, 0.03 + 0.05 * bend, false);
        updateLoop(rootContourB.geometry.getAttribute("position") as THREE.BufferAttribute, 0, radius * 0.95, radius * 0.75, 0.28 + 0.15 * bend, -0.035 - 0.045 * bend, false);
        crownContour.visible = false;
        rootContourA.visible = true;
        rootContourB.visible = true;
        rootMaterialA.opacity = rootMaterialB.opacity = 0.74;
        for (let index = 0; index < emitterAttribute.count; index++) {
          const angle = index / emitterAttribute.count * Math.PI * 2;
          const rightRoot = index % 2 === 0;
          const centerX = rightRoot ? 0.28 + 0.15 * bend : -0.27 - 0.17 * bend;
          const centerZ = rightRoot ? -0.035 - 0.045 * bend : 0.03 + 0.05 * bend;
          emitterAttribute.setXYZ(index, centerX + Math.cos(angle) * radius, 0.006, centerZ + Math.sin(angle) * radius * 0.78);
        }
      }
      emitterAttribute.needsUpdate = true;
    };

    const render = () => {
      const elapsed = reducedMotion ? 4.35 : clock.getElapsedTime();
      const phase = (elapsed % 8.4) / 8.4;
      const scanProgress = phase < 0.11
        ? 0
        : phase < 0.76
          ? smoothstep(0.11, 0.76, phase)
          : 1;
      const resetFade = phase < 0.86 ? 1 : 1 - smoothstep(0.86, 1, phase);
      const scanY = THREE.MathUtils.lerp(-2.02, 1.17, scanProgress);
      const completion = smoothstep(0.76, 0.82, phase) * (1 - smoothstep(0.91, 1, phase));

      toothGroup.rotation.y = -0.28 + Math.sin(elapsed * 0.22) * 0.13;
      toothGroup.rotation.x = -0.08 + Math.sin(elapsed * 0.17) * 0.022;
      toothGroup.position.y = 0.24 + Math.sin(elapsed * 0.48) * 0.025;
      scannerGroup.position.y = scanY;
      scannerGroup.visible = resetFade > 0.02;
      updateScannerContours(scanY);

      revealMaterial.uniforms.uScanY.value = scanY;
      revealMaterial.uniforms.uOpacity.value = resetFade * (0.82 + completion * 0.18);
      pointMaterial.uniforms.uScanY.value = scanY;
      pointMaterial.uniforms.uOpacity.value = resetFade;
      normalMaterial.uniforms.uScanY.value = scanY;
      normalMaterial.uniforms.uOpacity.value = resetFade;

      completionRing.scale.setScalar(1 + completion * 1.15);
      completionMaterial.opacity = completion * 0.22;

      const orbitalAttribute = orbitalGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < orbitalCount; index++) {
        const lane = index % 3;
        const angle = elapsed * (0.14 + lane * 0.025) + index / orbitalCount * Math.PI * 2;
        const radiusX = 1.48 + lane * 0.13;
        const radiusY = 0.74 + lane * 0.08;
        orbitalAttribute.setXYZ(
          index,
          Math.cos(angle) * radiusX,
          -0.2 + Math.sin(angle) * radiusY,
          0.12 + Math.sin(angle * 0.7 + lane) * 0.22,
        );
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
      pointMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    render();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
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

  return <div ref={mountRef} className={className} aria-label="标准牙齿精密扫描三维模型" />;
}
