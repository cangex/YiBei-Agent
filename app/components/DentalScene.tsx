"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type DentalSceneMode = "porcelain" | "scan" | "heatmap" | "repaired" | "texture" | "flow";
export type DentalScenePhase =
  | "idle"
  | "parse"
  | "scan"
  | "defect"
  | "repair"
  | "validate"
  | "ready"
  | "ingress"
  | "segment"
  | "generate"
  | "simulate"
  | "converge";

export type RegionalTextureRegion = {
  id: string;
  enabled: boolean;
  pattern: "topology" | "straight" | "wave";
  sides: 3 | 4 | 5 | 6;
  wave: boolean;
  center: [number, number, number];
  radius: [number, number, number];
};

type Props = {
  src?: string;
  mode?: DentalSceneMode;
  phase?: DentalScenePhase;
  stageProgress?: number;
  textureSides?: 3 | 4 | 5 | 6;
  wave?: boolean;
  regionalTextures?: RegionalTextureRegion[];
  regionalTexturePlans?: RegionalTextureRegion[][];
  interactive?: boolean;
  className?: string;
  onLoaded?: (meta: { triangles: number; dimensions: [number, number, number] }) => void;
};

type SliceSample = { centerX: number; centerZ: number; radiusX: number; radiusZ: number };
type VisualState = { scan: number; heat: number; texture: number; flow: number; repair: number; defects: number };
type LayoutPath = { points: THREE.Vector2[]; closed: boolean; regionIndex: number; sequence: number };
type ModeledGroove = {
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshPhysicalMaterial>;
  points: THREE.Vector3[];
  regionIndex: number;
  sequence: number;
  fullDrawCount: number;
};
type RegionalGeometryRig = {
  group: THREE.Group;
  grooves: ModeledGroove[];
  materials: THREE.MeshPhysicalMaterial[];
  tracer: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  enabledRegions: number[];
};
type SurfaceProjectionIndex = {
  bins: number[][];
  divisions: number;
  bounds: THREE.Box3;
  size: THREE.Vector3;
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
};

const AQUA = new THREE.Color(0x83d6c5);
const AQUA_PALE = new THREE.Color(0xd9fff5);
const SIGNAL = new THREE.Color(0xff6a43);

function ease(value: number) {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function createRegionalTextureMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uBoundsMin: { value: new THREE.Vector3(-1, -1, -1) },
      uBoundsSize: { value: new THREE.Vector3(2, 2, 2) },
      uCenter0: { value: new THREE.Vector3(0.34, 0.62, 0.55) },
      uCenter1: { value: new THREE.Vector3(0.68, 0.4, 0.55) },
      uCenter2: { value: new THREE.Vector3(0.52, 0.78, 0.5) },
      uRadius0: { value: new THREE.Vector3(0.28, 0.24, 0.75) },
      uRadius1: { value: new THREE.Vector3(0.24, 0.22, 0.75) },
      uRadius2: { value: new THREE.Vector3(0.2, 0.18, 0.75) },
      uMeta0: { value: new THREE.Vector4(6, 0, 13, 1) },
      uMeta1: { value: new THREE.Vector4(4, 1, 12, 1) },
      uMeta2: { value: new THREE.Vector4(3, 0, 14, 0) },
      uColor0: { value: new THREE.Color(0xa7efe0) },
      uColor1: { value: new THREE.Color(0xff8f70) },
      uColor2: { value: new THREE.Color(0xbfc9c4) },
    },
    vertexShader: `
      uniform vec3 uBoundsMin;
      uniform vec3 uBoundsSize;
      varying vec3 vNormalized;
      void main() {
        vNormalized = (position - uBoundsMin) / max(uBoundsSize, vec3(0.0001));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uCenter0;
      uniform vec3 uCenter1;
      uniform vec3 uCenter2;
      uniform vec3 uRadius0;
      uniform vec3 uRadius1;
      uniform vec3 uRadius2;
      uniform vec4 uMeta0;
      uniform vec4 uMeta1;
      uniform vec4 uMeta2;
      uniform vec3 uColor0;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      varying vec3 vNormalized;

      float ridge(float value) {
        float distanceToCell = abs(fract(value) - 0.5);
        return smoothstep(0.42, 0.49, distanceToCell);
      }

      float topologyPattern(vec2 sourceUv, vec4 meta) {
        vec2 uv = sourceUv * meta.z;
        if (meta.y > 1.5) return ridge(uv.y);
        if (meta.y > 0.5) return ridge(uv.y + sin(uv.x * 0.82) * 0.34);
        float diagonalA = ridge(uv.x * 0.5 + uv.y * 0.866);
        float diagonalB = ridge(-uv.x * 0.5 + uv.y * 0.866);
        float triangular = max(ridge(uv.x), max(diagonalA, diagonalB));
        float quadrilateral = max(ridge(uv.x), ridge(uv.y));
        float pentagonal = max(quadrilateral, ridge(uv.x * 0.31 + uv.y * 0.95));
        float hexagonal = max(diagonalA, max(diagonalB, ridge(uv.y)));
        if (meta.x < 3.5) return triangular;
        if (meta.x < 4.5) return quadrilateral;
        if (meta.x < 5.5) return pentagonal;
        return hexagonal;
      }

      float regionMask(vec3 center, vec3 radius, float enabled) {
        float distanceFromCenter = length((vNormalized - center) / max(radius, vec3(0.001)));
        return (1.0 - smoothstep(0.76, 1.0, distanceFromCenter)) * enabled;
      }

      void main() {
        float mask0 = regionMask(uCenter0, uRadius0, uMeta0.w);
        float mask1 = regionMask(uCenter1, uRadius1, uMeta1.w);
        float mask2 = regionMask(uCenter2, uRadius2, uMeta2.w);
        float line0 = topologyPattern(vNormalized.xy, uMeta0) * mask0;
        float line1 = topologyPattern(vNormalized.xy + vec2(0.17, 0.08), uMeta1) * mask1;
        float line2 = topologyPattern(vNormalized.xy + vec2(0.31, 0.14), uMeta2) * mask2;
        float field = max(mask0, max(mask1, mask2));
        float lines = max(line0, max(line1, line2));
        if (field < 0.008) discard;
        vec3 weightedColor = uColor0 * (mask0 + line0) + uColor1 * (mask1 + line1) + uColor2 * (mask2 + line2);
        float weight = max(0.001, mask0 + line0 + mask1 + line1 + mask2 + line2);
        vec3 color = weightedColor / weight;
        float alpha = (field * 0.09 + lines * 0.48) * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

function configureRegionalTexture(material: THREE.ShaderMaterial, regions: RegionalTextureRegion[], bounds: THREE.Box3) {
  const fallback: RegionalTextureRegion[] = [
    { id: "R1", enabled: true, pattern: "topology", sides: 6, wave: false, center: [0.35, 0.62, 0.55], radius: [0.28, 0.24, 0.75] },
    { id: "R2", enabled: false, pattern: "straight", sides: 4, wave: false, center: [0.68, 0.4, 0.55], radius: [0.24, 0.22, 0.75] },
    { id: "R3", enabled: false, pattern: "topology", sides: 3, wave: false, center: [0.52, 0.78, 0.5], radius: [0.2, 0.18, 0.75] },
  ];
  const selected = regions.length ? regions : fallback;
  material.uniforms.uBoundsMin.value.copy(bounds.min);
  material.uniforms.uBoundsSize.value.copy(bounds.getSize(new THREE.Vector3()));
  for (let index = 0; index < 3; index++) {
    const region = selected[index] ?? fallback[index];
    material.uniforms[`uCenter${index}`].value.set(...region.center);
    material.uniforms[`uRadius${index}`].value.set(...region.radius);
    const patternCode = region.pattern === "wave" ? 1 : region.pattern === "straight" ? 2 : 0;
    material.uniforms[`uMeta${index}`].value.set(region.sides, patternCode, 10 + region.sides * 0.8, region.enabled ? 1 : 0);
  }
}

function createRegionLayout(region: RegionalTextureRegion, regionIndex: number): LayoutPath[] {
  if (!region.enabled) return [];
  const [centerX, centerY] = region.center;
  const radiusX = region.radius[0] * 0.88;
  const radiusY = region.radius[1] * 0.88;
  const paths: LayoutPath[] = [];

  if (region.pattern === "straight" || region.pattern === "wave") {
    const laneCount = 7;
    for (let lane = 0; lane < laneCount; lane++) {
      const laneOffset = (lane / (laneCount - 1) - 0.5) * radiusY * 1.34;
      const points: THREE.Vector2[] = [];
      const samples = 42;
      for (let sample = 0; sample < samples; sample++) {
        const unit = sample / (samples - 1);
        const normalizedX = unit * 2 - 1;
        const waveOffset = region.pattern === "wave"
          ? Math.sin(unit * Math.PI * 2.35 + lane * 0.46) * radiusY * 0.115
          : 0;
        points.push(new THREE.Vector2(
          centerX + normalizedX * radiusX * 0.82,
          centerY + laneOffset + waveOffset,
        ));
      }
      paths.push({ points, closed: false, regionIndex, sequence: lane });
    }
    return paths;
  }

  const cellRadius = Math.min(radiusX, radiusY) * 0.255;
  let sequence = 0;
  for (let row = -1; row <= 1; row++) {
    for (let column = -1; column <= 1; column++) {
      const offsetX = column * cellRadius * 1.56 + (Math.abs(row) % 2) * cellRadius * 0.72;
      const offsetY = row * cellRadius * 1.48;
      const ellipseDistance = (offsetX / radiusX) ** 2 + (offsetY / radiusY) ** 2;
      if (ellipseDistance > 0.66) continue;
      const points: THREE.Vector2[] = [];
      const subdivisions = 4;
      const angleOffset = region.sides % 2 === 0 ? Math.PI / region.sides : -Math.PI / 2;
      for (let side = 0; side < region.sides; side++) {
        const startAngle = angleOffset + side / region.sides * Math.PI * 2;
        const endAngle = angleOffset + (side + 1) / region.sides * Math.PI * 2;
        for (let subdivision = 0; subdivision < subdivisions; subdivision++) {
          const angle = THREE.MathUtils.lerp(startAngle, endAngle, subdivision / subdivisions);
          points.push(new THREE.Vector2(
            centerX + offsetX + Math.cos(angle) * cellRadius,
            centerY + offsetY + Math.sin(angle) * cellRadius,
          ));
        }
      }
      paths.push({ points, closed: true, regionIndex, sequence: sequence++ });
    }
  }
  return paths;
}

function createSurfaceProjectionIndex(source: THREE.BufferGeometry, bounds: THREE.Box3): SurfaceProjectionIndex {
  const divisions = 42;
  const bins = Array.from({ length: divisions * divisions }, () => [] as number[]);
  const size = bounds.getSize(new THREE.Vector3());
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const ax = (position.getX(triangle) - bounds.min.x) / Math.max(size.x, 0.001);
    const ay = (position.getY(triangle) - bounds.min.y) / Math.max(size.y, 0.001);
    const bx = (position.getX(triangle + 1) - bounds.min.x) / Math.max(size.x, 0.001);
    const by = (position.getY(triangle + 1) - bounds.min.y) / Math.max(size.y, 0.001);
    const cx = (position.getX(triangle + 2) - bounds.min.x) / Math.max(size.x, 0.001);
    const cy = (position.getY(triangle + 2) - bounds.min.y) / Math.max(size.y, 0.001);
    const minColumn = THREE.MathUtils.clamp(Math.floor(Math.min(ax, bx, cx) * divisions), 0, divisions - 1);
    const maxColumn = THREE.MathUtils.clamp(Math.floor(Math.max(ax, bx, cx) * divisions), 0, divisions - 1);
    const minRow = THREE.MathUtils.clamp(Math.floor(Math.min(ay, by, cy) * divisions), 0, divisions - 1);
    const maxRow = THREE.MathUtils.clamp(Math.floor(Math.max(ay, by, cy) * divisions), 0, divisions - 1);
    for (let row = minRow; row <= maxRow; row++) {
      for (let column = minColumn; column <= maxColumn; column++) {
        bins[row * divisions + column].push(triangle);
      }
    }
  }
  return { bins, divisions, bounds: bounds.clone(), size, position, normal };
}

function projectLayoutPath(layout: LayoutPath, surface: SurfaceProjectionIndex, surfaceOffset: number) {
  const projected: THREE.Vector3[] = [];
  const normal = new THREE.Vector3();
  for (const point of layout.points) {
    const column = THREE.MathUtils.clamp(Math.floor(point.x * surface.divisions), 0, surface.divisions - 1);
    const row = THREE.MathUtils.clamp(Math.floor(point.y * surface.divisions), 0, surface.divisions - 1);
    const candidates = surface.bins[row * surface.divisions + column];
    const localX = THREE.MathUtils.lerp(surface.bounds.min.x, surface.bounds.max.x, point.x);
    const localY = THREE.MathUtils.lerp(surface.bounds.min.y, surface.bounds.max.y, point.y);
    let highestZ = Number.NEGATIVE_INFINITY;
    let hitTriangle = -1;
    let hitA = 0;
    let hitB = 0;
    for (const triangle of candidates) {
      const ax = surface.position.getX(triangle);
      const ay = surface.position.getY(triangle);
      const bx = surface.position.getX(triangle + 1);
      const by = surface.position.getY(triangle + 1);
      const cx = surface.position.getX(triangle + 2);
      const cy = surface.position.getY(triangle + 2);
      const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(denominator) < 1e-8) continue;
      const weightA = ((by - cy) * (localX - cx) + (cx - bx) * (localY - cy)) / denominator;
      const weightB = ((cy - ay) * (localX - cx) + (ax - cx) * (localY - cy)) / denominator;
      const weightC = 1 - weightA - weightB;
      if (weightA < -0.0005 || weightB < -0.0005 || weightC < -0.0005) continue;
      const z = weightA * surface.position.getZ(triangle)
        + weightB * surface.position.getZ(triangle + 1)
        + weightC * surface.position.getZ(triangle + 2);
      if (z > highestZ) {
        highestZ = z;
        hitTriangle = triangle;
        hitA = weightA;
        hitB = weightB;
      }
    }
    if (hitTriangle < 0) continue;
    const hitC = 1 - hitA - hitB;
    normal.set(
      hitA * surface.normal.getX(hitTriangle) + hitB * surface.normal.getX(hitTriangle + 1) + hitC * surface.normal.getX(hitTriangle + 2),
      hitA * surface.normal.getY(hitTriangle) + hitB * surface.normal.getY(hitTriangle + 1) + hitC * surface.normal.getY(hitTriangle + 2),
      hitA * surface.normal.getZ(hitTriangle) + hitB * surface.normal.getZ(hitTriangle + 1) + hitC * surface.normal.getZ(hitTriangle + 2),
    ).normalize();
    if (normal.z < 0) normal.negate();
    projected.push(new THREE.Vector3(localX, localY, highestZ).addScaledVector(normal, surfaceOffset));
  }
  return projected;
}

function createRegionalGeometryRig(
  surface: SurfaceProjectionIndex,
  modelSize: THREE.Vector3,
  regions: RegionalTextureRegion[],
): RegionalGeometryRig {
  const group = new THREE.Group();
  group.name = "regional-microtexture-geometry";
  const extent = Math.max(modelSize.x, modelSize.y, modelSize.z);
  const grooveRadius = extent * 0.0042;
  const surfaceOffset = grooveRadius * 0.18;
  const palette = [0x315d55, 0x75463d, 0x56645f];
  const emissive = [0x143e36, 0x4d2119, 0x273b35];
  const grooves: ModeledGroove[] = [];
  const materials: THREE.MeshPhysicalMaterial[] = [];
  const enabledRegions = regions.map((region, index) => region.enabled ? index : -1).filter((index) => index >= 0);

  regions.forEach((region, regionIndex) => {
    if (!region.enabled) return;
    const material = new THREE.MeshPhysicalMaterial({
      color: palette[regionIndex % palette.length],
      emissive: emissive[regionIndex % emissive.length],
      emissiveIntensity: 0.24,
      roughness: 0.38,
      metalness: 0.08,
      clearcoat: 0.3,
      clearcoatRoughness: 0.36,
      transparent: true,
      opacity: 0,
      depthWrite: true,
    });
    materials.push(material);
    const layouts = createRegionLayout(region, regionIndex);
    layouts.forEach((layout) => {
      const projected = projectLayoutPath(layout, surface, surfaceOffset);
      if (projected.length < 4) return;
      const curve = new THREE.CatmullRomCurve3(projected, layout.closed, "centripetal", 0.35);
      const tubularSegments = THREE.MathUtils.clamp(projected.length * 2, 28, 96);
      const geometry = new THREE.TubeGeometry(curve, tubularSegments, grooveRadius, 8, layout.closed);
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 4;
      group.add(mesh);
      grooves.push({
        mesh,
        points: projected,
        regionIndex,
        sequence: layout.sequence,
        fullDrawCount: geometry.index?.count ?? geometry.getAttribute("position").count,
      });
    });
  });

  const tracerMaterial = new THREE.MeshBasicMaterial({
    color: 0xe1fff7,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tracer = new THREE.Mesh(new THREE.SphereGeometry(extent * 0.012, 18, 12), tracerMaterial);
  tracer.renderOrder = 7;
  tracer.visible = false;
  group.add(tracer);
  group.visible = false;
  return { group, grooves, materials, tracer, enabledRegions };
}

function createPointCloud(source: THREE.BufferGeometry) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / 16_000));
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

function createNormalField(source: THREE.BufferGeometry, extent: number) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / 680));
  const length = extent * 0.032;
  const lines: number[] = [];
  for (let index = 0; index < position.count; index += stride) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    lines.push(x, y, z, x + normal.getX(index) * length, y + normal.getY(index) * length, z + normal.getZ(index) * length);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  return geometry;
}

function createDefectMarkers(source: THREE.BufferGeometry, count = 18) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const values = new Float32Array(count * 3);
  for (let marker = 0; marker < count; marker++) {
    const index = (marker * 7919 + 137) % position.count;
    values[marker * 3] = position.getX(index);
    values[marker * 3 + 1] = position.getY(index);
    values[marker * 3 + 2] = position.getZ(index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
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
      radiusX: Math.max(span * 0.008, (resolved.maxX - resolved.minX) * 0.51),
      radiusZ: Math.max(span * 0.008, (resolved.maxZ - resolved.minZ) * 0.51),
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
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
}

function visualTargets(mode: DentalSceneMode, phase: DentalScenePhase): VisualState {
  const scan = phase === "scan" || phase === "segment" ? 1 : phase === "defect" ? 0.82 : phase === "validate" ? 0.5 : mode === "scan" ? 1 : 0;
  const heat = phase === "defect" || phase === "segment" ? 0.9 : phase === "validate" ? 0.78 : mode === "heatmap" ? 0.88 : 0;
  const texture = phase === "generate" || phase === "simulate" || phase === "converge" || mode === "texture" || mode === "flow" ? 1 : 0;
  const flow = phase === "simulate" || mode === "flow" ? 1 : 0;
  const repair = phase === "repair" ? 1 : phase === "ready" ? 0.28 : mode === "repaired" ? 0.42 : 0;
  const defects = phase === "defect" ? 1 : phase === "validate" ? 0.22 : 0;
  return { scan, heat, texture, flow, repair, defects };
}

function phaseRotation(phase: DentalScenePhase) {
  switch (phase) {
    case "scan": return -0.18;
    case "defect": return 0.16;
    case "repair": return -0.52;
    case "validate": return 0.36;
    case "ready": return -0.24;
    case "segment": return 0.22;
    case "generate": return -0.42;
    case "simulate": return 0.42;
    case "converge": return -0.12;
    default: return -0.38;
  }
}

export function DentalScene({
  src = "/models/demo.stl",
  mode = "porcelain",
  phase = "idle",
  stageProgress = 0,
  textureSides = 6,
  wave = false,
  regionalTextures = [],
  regionalTexturePlans = [],
  interactive = true,
  className,
  onLoaded,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(onLoaded);
  const regionalPlansRef = useRef(regionalTexturePlans);
  const visualRef = useRef({ mode, phase, stageProgress, textureSides, wave, regionalTextures, interactive });

  useEffect(() => { loadedRef.current = onLoaded; }, [onLoaded]);
  useEffect(() => { regionalPlansRef.current = regionalTexturePlans; }, [regionalTexturePlans]);
  useEffect(() => {
    visualRef.current = { mode, phase, stageProgress, textureSides, wave, regionalTextures, interactive };
  }, [mode, phase, stageProgress, textureSides, wave, regionalTextures, interactive]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0.15, 0.25, 6.6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    mount.appendChild(renderer.domElement);
    mount.dataset.modelState = "loading";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4.3;
    controls.maxDistance = 9;
    controls.autoRotateSpeed = 0.32;

    scene.add(new THREE.HemisphereLight(0xf5fff9, 0x31423d, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 5.2);
    key.position.set(-3, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x83d6c5, 3.5);
    rim.position.set(4, -1, 3);
    scene.add(rim);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    let disposed = false;
    let frame = 0;
    let baseScale = 1;
    let scannerReady = false;
    let minY = -1;
    let maxY = 1;
    const size = new THREE.Vector3(1, 1, 1);
    let profile: SliceSample[] = [];
    let scanY = -1;
    const state: VisualState = { scan: 0, heat: 0, texture: 0, flow: 0, repair: 0, defects: 0 };

    const baseMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xdce3dc,
      roughness: 0.31,
      metalness: 0.02,
      clearcoat: 0.42,
      clearcoatRoughness: 0.22,
    });
    const heatMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.48,
      metalness: 0.03,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const textureMaterials = [createRegionalTextureMaterial(), createRegionalTextureMaterial()];
    let textureSlot = 0;
    let textureBlend = 1;
    let textureKey = "";
    let regionalBounds: THREE.Box3 | null = null;
    let regionalProjectionIndex: SurfaceProjectionIndex | null = null;
    let activeGeometryKey = "";
    let previousGeometryKey = "";
    let geometryBlend = 1;
    const geometryRigCache = new Map<string, RegionalGeometryRig>();
    const planPrebuildTimers: number[] = [];

    const revealMaterial = new THREE.ShaderMaterial({
      uniforms: { uScanY: { value: -1 }, uOpacity: { value: 0 }, uAqua: { value: AQUA }, uSignal: { value: SIGNAL } },
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
          vec3 color = mix(uAqua, uSignal, activeBand * 0.12);
          gl_FragColor = vec4(color, (0.035 + retainedField * 0.1 + activeBand * 0.29) * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      wireframe: true,
    });
    const pointMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uScanY: { value: -1 }, uOpacity: { value: 0 }, uPixelRatio: { value: renderer.getPixelRatio() },
        uAqua: { value: AQUA_PALE }, uSignal: { value: SIGNAL },
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
          gl_FragColor = vec4(mix(uAqua, uSignal, vBand * 0.08), vAlpha * core);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const normalMaterial = new THREE.ShaderMaterial({
      uniforms: { uScanY: { value: -1 }, uOpacity: { value: 0 }, uColor: { value: AQUA } },
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
    const repairMaterial = new THREE.ShaderMaterial({
      uniforms: { uRepairY: { value: -1 }, uOpacity: { value: 0 }, uColor: { value: AQUA_PALE } },
      vertexShader: `
        varying float vLocalY;
        void main() {
          vLocalY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uRepairY;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vLocalY;
        void main() {
          float band = 1.0 - smoothstep(0.0, 0.16, abs(vLocalY - uRepairY));
          float restored = 1.0 - step(uRepairY, vLocalY);
          if (band + restored < 0.01) discard;
          gl_FragColor = vec4(uColor, (band * 0.42 + restored * 0.055) * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      wireframe: true,
    });

    const scannerGroup = new THREE.Group();
    modelGroup.add(scannerGroup);
    const scanCoreMaterial = new THREE.MeshBasicMaterial({ color: 0xbff9eb, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const scanVolumeMaterial = new THREE.MeshBasicMaterial({ color: 0x7bd9c5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const contour = createContour();
    const emitterGeometry = new THREE.BufferGeometry();
    emitterGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(32 * 3), 3));
    const emitterMaterial = new THREE.PointsMaterial({ color: 0xe8fff9, size: 0.024, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const emitters = new THREE.Points(emitterGeometry, emitterMaterial);
    const gridMaterials: THREE.Material[] = [];

    const defectMaterial = new THREE.PointsMaterial({ color: 0xff6a43, size: 0.058, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    let defectPoints: THREE.Points | null = null;
    const particleCount = 220;
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(particleCount * 3), 3));
    const particleMaterial = new THREE.PointsMaterial({ color: 0x83d6c5, size: 0.032, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    modelGroup.add(particles);

    const ensureRegionalGeometry = (regions: RegionalTextureRegion[]) => {
      if (!regionalProjectionIndex) return;
      const keyName = JSON.stringify(regions);
      if (geometryRigCache.has(keyName)) return;
      const rig = createRegionalGeometryRig(regionalProjectionIndex, size, regions);
      geometryRigCache.set(keyName, rig);
      modelGroup.add(rig.group);
    };

    const installRegionalPlan = (regions: RegionalTextureRegion[], sides: number, isWave: boolean) => {
      if (!regionalBounds) return;
      const fallbackRegion: RegionalTextureRegion = {
        id: "R1",
        enabled: true,
        pattern: isWave ? "wave" : "topology",
        sides,
        wave: isWave,
        center: [0.5, 0.58, 0.52],
        radius: [0.34, 0.3, 0.78],
      };
      const selected = regions.length ? regions : [fallbackRegion];
      const nextKey = JSON.stringify(selected);
      if (nextKey === textureKey) {
        if (visualRef.current.phase === "generate" || visualRef.current.phase === "simulate" || visualRef.current.phase === "converge") {
          ensureRegionalGeometry(selected);
        }
        return;
      }
      previousGeometryKey = activeGeometryKey;
      activeGeometryKey = nextKey;
      geometryBlend = previousGeometryKey ? 0 : 1;
      const nextSlot = textureKey ? 1 - textureSlot : textureSlot;
      configureRegionalTexture(textureMaterials[nextSlot], selected, regionalBounds);
      textureSlot = nextSlot;
      textureBlend = textureKey ? 0 : 1;
      textureKey = nextKey;
    };

    const buildModel = async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error("STL load failed");
        const buffer = await response.arrayBuffer();
        if (disposed) return;
        const geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        geometry.center();
        const sourceBounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
        const sourceSize = new THREE.Vector3();
        sourceBounds.getSize(sourceSize);
        const normalization = 2.65 / Math.max(sourceSize.x, sourceSize.y, sourceSize.z, 0.001);
        geometry.scale(normalization, normalization, normalization);
        geometry.computeVertexNormals();
        const bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
        regionalBounds = bounds.clone();
        regionalProjectionIndex = createSurfaceProjectionIndex(geometry, bounds);
        bounds.getSize(size);
        minY = bounds.min.y;
        maxY = bounds.max.y;
        const maxExtent = Math.max(size.x, size.y, size.z);
        baseScale = 1;
        modelGroup.scale.setScalar(baseScale);
        modelGroup.rotation.set(-0.12, -0.38, 0.08);
        profile = createSliceProfile(geometry, minY, maxY);

        const position = geometry.getAttribute("position") as THREE.BufferAttribute;
        const uv = new Float32Array(position.count * 2);
        const colors = new Float32Array(position.count * 3);
        const cool = new THREE.Color(0x4b68ff);
        const warm = new THREE.Color(0xff5c36);
        const cyan = new THREE.Color(0x83d6c5);
        for (let index = 0; index < position.count; index++) {
          const x = position.getX(index);
          const y = position.getY(index);
          const z = position.getZ(index);
          uv[index * 2] = (x - bounds.min.x) / Math.max(size.x, 0.001) * 3;
          uv[index * 2 + 1] = (y - bounds.min.y) / Math.max(size.y, 0.001) * 3;
          const signal = THREE.MathUtils.clamp(0.48 + Math.sin(x * 2.1 + z * 1.7) * 0.29 + y / Math.max(size.y, 1) * 0.42, 0, 1);
          const color = signal < 0.52 ? cool.clone().lerp(cyan, signal * 1.9) : cyan.clone().lerp(warm, (signal - 0.52) * 2.08);
          colors[index * 3] = color.r;
          colors[index * 3 + 1] = color.g;
          colors[index * 3 + 2] = color.b;
        }
        geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        modelGroup.add(new THREE.Mesh(geometry, baseMaterial));
        const heatMesh = new THREE.Mesh(geometry, heatMaterial);
        heatMesh.scale.setScalar(1.002);
        modelGroup.add(heatMesh);
        textureMaterials.forEach((material) => {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.scale.setScalar(1.003);
          modelGroup.add(mesh);
        });
        const topology = new THREE.Mesh(geometry, revealMaterial);
        topology.scale.setScalar(1.004);
        modelGroup.add(topology);
        modelGroup.add(new THREE.Points(createPointCloud(geometry), pointMaterial));
        modelGroup.add(new THREE.LineSegments(createNormalField(geometry, maxExtent), normalMaterial));
        const repairMesh = new THREE.Mesh(geometry, repairMaterial);
        repairMesh.scale.setScalar(1.005);
        modelGroup.add(repairMesh);
        defectPoints = new THREE.Points(createDefectMarkers(geometry), defectMaterial);
        modelGroup.add(defectPoints);

        const scanWidth = Math.max(size.x, size.z) * 1.76;
        scannerGroup.add(new THREE.Mesh(new THREE.BoxGeometry(scanWidth, size.y * 0.005, scanWidth), scanCoreMaterial));
        scannerGroup.add(new THREE.Mesh(new THREE.BoxGeometry(scanWidth * 0.96, size.y * 0.036, scanWidth * 0.96), scanVolumeMaterial));
        const scanGrid = new THREE.GridHelper(scanWidth, 20, 0x8fe1d0, 0x8fe1d0);
        const materials = Array.isArray(scanGrid.material) ? scanGrid.material : [scanGrid.material];
        materials.forEach((material) => {
          material.transparent = true;
          material.opacity = 0;
          material.depthWrite = false;
          material.blending = THREE.AdditiveBlending;
          gridMaterials.push(material);
        });
        scannerGroup.add(scanGrid);
        scannerGroup.add(contour, emitters);
        scannerReady = true;
        installRegionalPlan(visualRef.current.regionalTextures, visualRef.current.textureSides, visualRef.current.wave);
        const plansToPrebuild = [visualRef.current.regionalTextures, ...regionalPlansRef.current]
          .filter((plan) => plan.length)
          .filter((plan, index, allPlans) => allPlans.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(plan)) === index);
        plansToPrebuild.forEach((plan, index) => {
          planPrebuildTimers.push(window.setTimeout(() => {
            if (!disposed) ensureRegionalGeometry(plan);
          }, 650 + index * 1450));
        });
        mount.dataset.modelState = "ready";
        loadedRef.current?.({ triangles: position.count / 3, dimensions: [sourceSize.x, sourceSize.y, sourceSize.z] });
      } catch {
        if (!disposed) mount.dataset.error = "true";
      }
    };
    buildModel();

    const updateScanner = (progress: number) => {
      if (!scannerReady) return;
      scanY = THREE.MathUtils.lerp(minY + size.y * 0.006, maxY - size.y * 0.006, ease(progress));
      scannerGroup.position.y = scanY;
      const section = sampleSlice(profile, minY, maxY, scanY);
      updateLoop(contour.geometry.getAttribute("position") as THREE.BufferAttribute, section);
      const emitterAttribute = emitterGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < emitterAttribute.count; index++) {
        const angle = index / emitterAttribute.count * Math.PI * 2;
        emitterAttribute.setXYZ(index, section.centerX + Math.cos(angle) * section.radiusX * 1.035, size.y * 0.002, section.centerZ + Math.sin(angle) * section.radiusZ * 1.035);
      }
      emitterAttribute.needsUpdate = true;
    };

    const updateRegionalGeometry = (visual: typeof visualRef.current, delta: number, elapsedTime: number) => {
      geometryBlend = reducedMotion ? 1 : THREE.MathUtils.damp(geometryBlend, 1, 4.8, delta);
      const generationProgress = visual.phase === "generate" ? ease(visual.stageProgress) : 1;

      geometryRigCache.forEach((rig, keyName) => {
        const planWeight = keyName === activeGeometryKey
          ? geometryBlend
          : keyName === previousGeometryKey
            ? 1 - geometryBlend
            : 0;
        const rigOpacity = state.texture * planWeight;
        rig.group.visible = rigOpacity > 0.008;
        rig.materials.forEach((material) => {
          material.opacity = rigOpacity * 0.96;
          material.emissiveIntensity = 0.2 + state.flow * 0.24;
        });

        rig.grooves.forEach((groove) => {
          const enabledOrder = rig.enabledRegions.indexOf(groove.regionIndex);
          const regionCount = Math.max(1, rig.enabledRegions.length);
          const regionStart = 0.08 + enabledOrder * (0.78 / regionCount);
          const regionDuration = 0.78 / regionCount + 0.16;
          const regionProgress = visual.phase === "generate" && keyName === activeGeometryKey
            ? ease(THREE.MathUtils.clamp((generationProgress - regionStart) / regionDuration, 0, 1))
            : 1;
          const regionGrooveCount = rig.grooves.filter((item) => item.regionIndex === groove.regionIndex).length;
          const pathProgress = THREE.MathUtils.clamp(
            regionProgress * (regionGrooveCount + 0.72) - groove.sequence * 0.78,
            0,
            1,
          );
          const revealCount = reducedMotion
            ? groove.fullDrawCount
            : Math.floor(groove.fullDrawCount * ease(pathProgress) / 6) * 6;
          groove.mesh.geometry.setDrawRange(0, revealCount);
        });

        const tracerMaterial = rig.tracer.material;
        const showTracer = keyName === activeGeometryKey
          && visual.phase === "generate"
          && generationProgress > 0.075
          && generationProgress < 0.985
          && rigOpacity > 0.08
          && !reducedMotion;
        rig.tracer.visible = showTracer;
        tracerMaterial.opacity = showTracer ? rigOpacity * (0.72 + Math.sin(elapsedTime * 8.5) * 0.22) : 0;
        if (showTracer) {
          const regionCount = Math.max(1, rig.enabledRegions.length);
          const activeOrder = THREE.MathUtils.clamp(Math.floor((generationProgress - 0.08) / (0.78 / regionCount)), 0, regionCount - 1);
          const activeRegion = rig.enabledRegions[activeOrder];
          const regionStart = 0.08 + activeOrder * (0.78 / regionCount);
          const localProgress = ease(THREE.MathUtils.clamp((generationProgress - regionStart) / (0.78 / regionCount + 0.16), 0, 1));
          const representative = rig.grooves.find((groove) => groove.regionIndex === activeRegion);
          if (representative) {
            const pathIndex = Math.min(representative.points.length - 1, Math.floor(localProgress * (representative.points.length - 1)));
            rig.tracer.position.copy(representative.points[pathIndex]);
            const pulse = 0.82 + Math.sin(elapsedTime * 8.5) * 0.18;
            rig.tracer.scale.setScalar(pulse);
          }
        }
      });
    };

    const clock = new THREE.Clock();
    let elapsed = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!reducedMotion) elapsed += delta;
      const visual = visualRef.current;
      controls.enableZoom = visual.interactive;
      controls.enableRotate = visual.interactive;
      controls.autoRotate = !visual.interactive && !reducedMotion && visual.phase !== "generate";
      controls.update();
      installRegionalPlan(visual.regionalTextures, visual.textureSides, visual.wave);
      textureBlend = reducedMotion ? 1 : THREE.MathUtils.damp(textureBlend, 1, 5.2, delta);

      const targets = visualTargets(visual.mode, visual.phase);
      (Object.keys(state) as Array<keyof VisualState>).forEach((keyName) => {
        state[keyName] = reducedMotion ? targets[keyName] : THREE.MathUtils.damp(state[keyName], targets[keyName], 4.1, delta);
      });

      const previousSlot = 1 - textureSlot;
      const blueprintOpacity = visual.phase === "generate"
        ? state.texture * (1 - ease(THREE.MathUtils.clamp((visual.stageProgress - 0.06) / 0.8, 0, 1))) * 0.5
        : 0;
      textureMaterials[textureSlot].uniforms.uOpacity.value = blueprintOpacity * textureBlend;
      textureMaterials[previousSlot].uniforms.uOpacity.value = blueprintOpacity * (1 - textureBlend);
      updateRegionalGeometry(visual, delta, elapsed);
      heatMaterial.opacity = state.heat * 0.9;
      defectMaterial.opacity = state.defects * (0.55 + Math.sin(elapsed * 5.2) * 0.25);
      particleMaterial.opacity = state.flow * 0.76;
      scanCoreMaterial.opacity = state.scan * 0.065;
      scanVolumeMaterial.opacity = state.scan * 0.022;
      gridMaterials.forEach((material) => { material.opacity = state.scan * 0.06; });
      (contour.material as THREE.LineBasicMaterial).opacity = state.scan * 0.92;
      emitterMaterial.opacity = state.scan * 0.9;
      scannerGroup.visible = state.scan > 0.01;

      updateScanner(visual.stageProgress);
      revealMaterial.uniforms.uScanY.value = scanY;
      revealMaterial.uniforms.uOpacity.value = state.scan;
      pointMaterial.uniforms.uScanY.value = scanY;
      pointMaterial.uniforms.uOpacity.value = state.scan;
      normalMaterial.uniforms.uScanY.value = scanY;
      normalMaterial.uniforms.uOpacity.value = state.scan;
      repairMaterial.uniforms.uRepairY.value = THREE.MathUtils.lerp(minY, maxY, ease(visual.stageProgress));
      repairMaterial.uniforms.uOpacity.value = state.repair;

      const warmLight = targets.heat > 0.2 ? SIGNAL : AQUA;
      rim.color.lerp(warmLight, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2));
      const baseTarget = targets.repair > 0.2 ? new THREE.Color(0xf1f6f0) : new THREE.Color(0xdce3dc);
      baseMaterial.color.lerp(baseTarget, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2));
      baseMaterial.roughness = THREE.MathUtils.damp(baseMaterial.roughness, targets.scan > 0.2 ? 0.48 : 0.31, 3.2, delta);

      const modelingSweep = visual.phase === "generate" ? (ease(visual.stageProgress) - 0.5) * 0.34 : 0;
      const targetRotationY = phaseRotation(visual.phase) + modelingSweep;
      const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.25) * 0.035;
      modelGroup.rotation.y = THREE.MathUtils.damp(modelGroup.rotation.y, targetRotationY + drift, 2.2, delta);
      const modelingTilt = visual.phase === "generate" ? THREE.MathUtils.lerp(-0.2, -0.04, ease(visual.stageProgress)) : -0.12;
      modelGroup.rotation.x = THREE.MathUtils.damp(modelGroup.rotation.x, visual.phase === "simulate" ? -0.2 : modelingTilt, 2.4, delta);
      modelGroup.position.y = reducedMotion ? 0 : Math.sin(elapsed * 0.62) * 0.028;
      const arrival = visual.phase === "parse" || visual.phase === "ingress" ? 0.94 + ease(visual.stageProgress) * 0.06 : 1;
      const targetScale = baseScale * arrival;
      const scale = THREE.MathUtils.damp(modelGroup.scale.x, targetScale, 3.5, delta);
      modelGroup.scale.setScalar(scale);
      if (!visual.interactive) {
        const cameraDistance = visual.phase === "generate" ? 5.78 : 6.6;
        camera.position.z = THREE.MathUtils.damp(camera.position.z, cameraDistance, 2.7, delta);
      }

      if (state.flow > 0.01 && scannerReady) {
        const attribute = particleGeometry.getAttribute("position") as THREE.BufferAttribute;
        for (let index = 0; index < particleCount; index++) {
          const lane = index % 4;
          const cycle = (elapsed * (0.13 + lane * 0.012) + index / particleCount) % 1;
          const angle = elapsed * 0.52 + index / particleCount * Math.PI * 10;
          attribute.setXYZ(
            index,
            Math.sin(angle) * size.x * (0.46 + lane * 0.035),
            THREE.MathUtils.lerp(minY, maxY, cycle),
            Math.cos(angle * 0.76) * size.z * 0.52,
          );
        }
        attribute.needsUpdate = true;
      }

      renderer.render(scene, camera);
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
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      planPrebuildTimers.forEach((timer) => window.clearTimeout(timer));
      controls.dispose();
      const disposedGeometries = new Set<THREE.BufferGeometry>();
      const disposedMaterials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          if (!disposedGeometries.has(object.geometry)) {
            object.geometry.dispose();
            disposedGeometries.add(object.geometry);
          }
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            if (!disposedMaterials.has(material)) {
              material.dispose();
              disposedMaterials.add(material);
            }
          });
        }
      });
      [baseMaterial, heatMaterial, revealMaterial, pointMaterial, normalMaterial, repairMaterial, defectMaterial, particleMaterial, scanCoreMaterial, scanVolumeMaterial, emitterMaterial, ...textureMaterials].forEach((material) => {
        if (!disposedMaterials.has(material)) material.dispose();
      });
      geometryRigCache.forEach((rig) => {
        rig.materials.forEach((material) => {
          if (!disposedMaterials.has(material)) material.dispose();
        });
      });
      geometryRigCache.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [src]);

  return <div ref={mountRef} className={className} aria-label="可交互义齿精密扫描与仿真三维模型" />;
}
