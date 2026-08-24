"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type DentalSceneMode = "porcelain" | "scan" | "heatmap" | "repaired" | "texture" | "flow";
export type AnatomicalCrownZone = "occlusal" | "buccal" | "lingual" | "mesial" | "distal";
export type DentalScenePhase =
  | "idle"
  | "parse"
  | "scan"
  | "defect"
  | "repair"
  | "validate"
  | "ready"
  | "ingress"
  | "baseline"
  | "segment"
  | "generate"
  | "recalculate"
  | "simulate"
  | "converge";

export type RegionalTextureRegion = {
  id: string;
  enabled: boolean;
  pattern: "topology" | "straight" | "wave";
  layout?: "load-pair" | "load-cluster" | "exchange-band" | "flow-network" | "ridge-bridge" | "protect-crescent";
  sides: 3 | 4 | 5 | 6;
  wave: boolean;
  orientation?: number;
  textureAngle?: number;
  widthUm?: number;
  depthUm?: number;
  pitchUm?: number;
  anatomicalZone?: AnatomicalCrownZone;
  /**
   * A region is authored as either a closed anatomical outline or a variable-width
   * surface corridor.  The legacy envelope remains optional for uploaded/fallback
   * plans, but product schemes use the spline description exclusively.
   */
  surfaceShape?: {
    paths: Array<{
      kind: "outline" | "corridor";
      points: Array<[number, number]>;
      widths?: number[];
    }>;
    edgeSoftness?: number;
  };
  center?: [number, number, number];
  radius?: [number, number, number];
};

export type SimulationField = "none" | "mechanics" | "fluid" | "bio" | "fusion";
export type ReconstructionComparisonAppearance = "default" | "before" | "after";

export type MicrotextureVisualKey =
  | "topology-3"
  | "topology-4"
  | "topology-5"
  | "topology-6"
  | "straight"
  | "wave"
  | "none";

export const MICROTEXTURE_COLORS: Record<MicrotextureVisualKey, string> = {
  "topology-3": "#9ea7ff",
  "topology-4": "#d7bc73",
  "topology-5": "#68b8d1",
  "topology-6": "#73d2bd",
  straight: "#7898e8",
  wave: "#ff8064",
  none: "#9ba7a2",
};

export function microtextureVisualKey(
  region: Pick<RegionalTextureRegion, "enabled" | "pattern" | "sides">,
): MicrotextureVisualKey {
  if (!region.enabled) return "none";
  if (region.pattern === "wave") return "wave";
  if (region.pattern === "straight") return "straight";
  return `topology-${region.sides}` as MicrotextureVisualKey;
}

export function microtextureColorCss(
  region: Pick<RegionalTextureRegion, "enabled" | "pattern" | "sides">,
) {
  return MICROTEXTURE_COLORS[microtextureVisualKey(region)];
}

function microtextureColorNumber(
  region: Pick<RegionalTextureRegion, "enabled" | "pattern" | "sides">,
) {
  return Number.parseInt(microtextureColorCss(region).slice(1), 16);
}

type Props = {
  src?: string;
  mode?: DentalSceneMode;
  phase?: DentalScenePhase;
  stageProgress?: number;
  textureSides?: 3 | 4 | 5 | 6;
  wave?: boolean;
  regionalTextures?: RegionalTextureRegion[];
  parallelSchemes?: RegionalTextureRegion[][];
  selectedSchemeIndex?: number;
  focusRegionId?: string;
  simulationField?: SimulationField;
  simulationProgress?: number;
  visualPalette?: "default" | "brand-cyan";
  reconstructionLightWave?: boolean;
  reconstructionMaterialProgress?: number;
  comparisonAppearance?: ReconstructionComparisonAppearance;
  showScannerOverlay?: boolean;
  synchronizedPose?: boolean;
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
  axisBins: Record<"xy" | "xz" | "zy", number[][]>;
  divisions: number;
  bounds: THREE.Box3;
  size: THREE.Vector3;
  position: THREE.BufferAttribute;
  normal: THREE.BufferAttribute;
};
type SurfacePatch = {
  regionId: string;
  regionIndex: number;
  enabled: boolean;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
};
type SurfacePatchRig = {
  group: THREE.Group;
  patches: SurfacePatch[];
};
type OcclusalContactPatch = {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  delay: number;
  strength: number;
  baseScale: THREE.Vector3;
};
type OcclusalShellLayer = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.Material>;
  baseZ: Float32Array;
  phase: number;
  amplitude: number;
  offset: number;
  opacity: number;
};
type SimulationBoundaryRig = {
  group: THREE.Group;
  occlusalShell: THREE.Group;
  shellStartZ: number;
  shellTargetZ: number;
  shellLayers: OcclusalShellLayer[];
  shellWireMaterial: THREE.MeshBasicMaterial;
  contactPatches: OcclusalContactPatch[];
  supports: THREE.Mesh[];
  supportMaterials: THREE.Material[];
};
type MechanicsFieldRig = {
  group: THREE.Group;
  stressLines: Array<THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>;
  displacementMaterial: THREE.LineBasicMaterial;
  ghostMaterial: THREE.MeshBasicMaterial;
};
type BioNetworkRig = {
  group: THREE.Group;
  branches: Array<THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>;
};
type BioEntitySample = {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  risk: number;
  seed: number;
};
type BioEntityRig = {
  group: THREE.Group;
  nuclei: THREE.InstancedMesh<THREE.OctahedronGeometry, THREE.MeshPhysicalMaterial>;
  cells: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
  nucleiSamples: BioEntitySample[];
  cellSamples: BioEntitySample[];
};
type FusionLayerRig = {
  group: THREE.Group;
  materials: THREE.ShaderMaterial[];
  constraintLines: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>[];
  conflictPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  fieldContours: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>[];
  confidenceLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>[];
};
type EnsembleSchemeRig = {
  group: THREE.Group;
  hitMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  regions: RegionalTextureRegion[];
  baseMaterial: THREE.MeshPhysicalMaterial;
  patchRig: SurfacePatchRig;
  simulationMaterial: THREE.ShaderMaterial;
  fluidMaterial: THREE.ShaderMaterial;
  bioMaterial: THREE.ShaderMaterial;
  boundaryRig: SimulationBoundaryRig;
  mechanicsRig: MechanicsFieldRig;
  bioNetworkRig: BioNetworkRig;
  bioRiskMaterial: THREE.ShaderMaterial;
  bioRiskPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  fusionRig: FusionLayerRig;
};

const AQUA = new THREE.Color(0x83d6c5);
const AQUA_PALE = new THREE.Color(0xd9fff5);
const SIGNAL = new THREE.Color(0xff6a43);
const BRAND_CYAN = new THREE.Color(0x24b7c7);
const BRAND_CYAN_SOFT = new THREE.Color(0x79e6ee);
const BRAND_CYAN_PALE = new THREE.Color(0xe8fcff);
const RECONSTRUCTION_BEFORE_SURFACE = new THREE.Color(0x7b8580);
const RECONSTRUCTION_BEFORE_LIGHT = new THREE.Color(0x9ba8a2);
const RECONSTRUCTION_BEFORE_RIM = new THREE.Color(0x5e716b);
const RECONSTRUCTION_AFTER_ENTRY = new THREE.Color(0xaebbb5);
const RECONSTRUCTION_AFTER_SURFACE = new THREE.Color(0xf4faf6);
const RECONSTRUCTION_STANDARD_LIGHT = new THREE.Color(0xffffff);

function ease(value: number) {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function createReconstructionSurfaceMaterial() {
  const uniforms = {
    uRepairProgress: { value: 0 },
    uRepairTime: { value: 0 },
    uBoundsMin: { value: new THREE.Vector3(-1, -1, -1) },
    uBoundsSize: { value: new THREE.Vector3(2, 2, 2) },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf4faf6,
    roughness: 0.18,
    metalness: 0.015,
    clearcoat: 0.88,
    clearcoatRoughness: 0.075,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  material.name = "reconstruction-surface-reveal";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `
        #include <common>
        uniform vec3 uBoundsMin;
        uniform vec3 uBoundsSize;
        varying vec3 vRepairNormalized;
      `)
      .replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vRepairNormalized = (transformed - uBoundsMin) / max(uBoundsSize, vec3(0.0001));
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        uniform float uRepairProgress;
        uniform float uRepairTime;
        varying vec3 vRepairNormalized;
      `)
      .replace("#include <color_fragment>", `
        #include <color_fragment>
        float repairCurve = vRepairNormalized.y
          + sin(vRepairNormalized.x * 6.283 + uRepairTime * 0.11) * 0.034
          + sin(vRepairNormalized.z * 8.4 - uRepairTime * 0.08) * 0.022;
        float repairFront = mix(-0.16, 1.18, smoothstep(0.0, 1.0, uRepairProgress));
        float repairedReveal = 1.0 - smoothstep(repairFront - 0.052, repairFront + 0.024, repairCurve);
        diffuseColor.a *= repairedReveal;
        if (diffuseColor.a < 0.004) discard;
      `);
  };
  material.customProgramCacheKey = () => "reconstruction-surface-reveal-v1";
  return { material, uniforms };
}

function createRegionalTextureMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uPatternOpacity: { value: 0 },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uFocusIndex: { value: -1 },
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
      uPhysical0: { value: new THREE.Vector4(0.23, 0.63, 168, 1) },
      uPhysical1: { value: new THREE.Vector4(0.36, 0.57, 118, 1) },
      uPhysical2: { value: new THREE.Vector4(0.2, 0.5, 160, 0) },
      uReveal0: { value: 0 },
      uReveal1: { value: 0 },
      uReveal2: { value: 0 },
      uCarve0: { value: 0 },
      uCarve1: { value: 0 },
      uCarve2: { value: 0 },
      uColor0: { value: new THREE.Color(0x73d2bd) },
      uColor1: { value: new THREE.Color(0x7898e8) },
      uColor2: { value: new THREE.Color(0x9ea7ff) },
    },
    vertexShader: `
      uniform vec3 uBoundsMin;
      uniform vec3 uBoundsSize;
      varying vec3 vNormalized;
      varying vec3 vLocalNormal;
      void main() {
        vNormalized = (position - uBoundsMin) / max(uBoundsSize, vec3(0.0001));
        vLocalNormal = normalize(normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uPatternOpacity;
      uniform float uTime;
      uniform float uFlow;
      uniform float uFocusIndex;
      uniform vec3 uCenter0;
      uniform vec3 uCenter1;
      uniform vec3 uCenter2;
      uniform vec3 uRadius0;
      uniform vec3 uRadius1;
      uniform vec3 uRadius2;
      uniform vec4 uMeta0;
      uniform vec4 uMeta1;
      uniform vec4 uMeta2;
      uniform vec4 uPhysical0;
      uniform vec4 uPhysical1;
      uniform vec4 uPhysical2;
      uniform float uReveal0;
      uniform float uReveal1;
      uniform float uReveal2;
      uniform float uCarve0;
      uniform float uCarve1;
      uniform float uCarve2;
      uniform vec3 uColor0;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      varying vec3 vNormalized;
      varying vec3 vLocalNormal;

      float grooveLine(float value, float widthRatio) {
        float distanceToCell = abs(fract(value) - 0.5);
        float halfWidth = clamp(widthRatio * 0.5, 0.035, 0.22);
        float antialias = max(fwidth(value) * 0.58, 0.004);
        return 1.0 - smoothstep(halfWidth - antialias, halfWidth + antialias, distanceToCell);
      }

      float pattern2D(vec2 sourceUv, vec4 meta, float widthRatio) {
        vec2 uv = sourceUv * meta.z;
        if (meta.y > 1.5) return grooveLine(uv.y, widthRatio);
        if (meta.y > 0.5) return grooveLine(uv.y + sin(uv.x * 0.16) * 0.82, widthRatio);
        float horizontal = grooveLine(uv.y, widthRatio);
        float vertical = grooveLine(uv.x, widthRatio);
        float diagonalA = grooveLine(uv.x * 0.5 + uv.y * 0.866, widthRatio);
        float diagonalB = grooveLine(-uv.x * 0.5 + uv.y * 0.866, widthRatio);
        if (meta.x < 3.5) return max(horizontal, max(diagonalA, diagonalB));
        if (meta.x < 4.5) return max(horizontal, vertical);
        if (meta.x < 5.5) return max(max(horizontal, vertical), diagonalA);
        return max(horizontal, max(diagonalA, diagonalB));
      }

      float surfacePattern(vec4 meta, vec4 physical, vec2 offset, float expanded) {
        vec3 weights = pow(abs(normalize(vLocalNormal)), vec3(7.0));
        weights /= max(0.001, weights.x + weights.y + weights.z);
        float widthRatio = physical.x + expanded;
        float xy = pattern2D(vNormalized.xy + offset, meta, widthRatio);
        float xz = pattern2D(vNormalized.xz + offset * vec2(0.7, 1.1), meta, widthRatio);
        float yz = pattern2D(vNormalized.yz + offset * vec2(1.2, 0.65), meta, widthRatio);
        return (xy * weights.z + xz * weights.y + yz * weights.x) * physical.w;
      }

      float regionMask(vec3 center, vec3 radius, float enabled, float reveal) {
        float distanceFromCenter = length((vNormalized - center) / max(radius, vec3(0.001)));
        float field = 1.0 - smoothstep(0.76, 1.0, distanceFromCenter);
        float revealCoordinate = clamp(vNormalized.y * 0.72 + vNormalized.x * 0.28, 0.0, 1.0);
        float revealMask = smoothstep(revealCoordinate - 0.13, revealCoordinate + 0.03, reveal);
        return field * enabled * revealMask;
      }

      float carveMask(float progress, float seed) {
        float pathOrder = clamp(vNormalized.y * 0.58 + vNormalized.x * 0.31 + sin((vNormalized.z + seed) * 14.0) * 0.055, 0.0, 1.0);
        return smoothstep(pathOrder - 0.09, pathOrder + 0.025, progress);
      }

      float carveFront(float progress, float seed) {
        float pathOrder = clamp(vNormalized.y * 0.58 + vNormalized.x * 0.31 + sin((vNormalized.z + seed) * 14.0) * 0.055, 0.0, 1.0);
        float activation = smoothstep(0.015, 0.08, progress) * (1.0 - smoothstep(0.9, 0.99, progress));
        return (1.0 - smoothstep(0.0, 0.026, abs(pathOrder - progress))) * activation;
      }

      float focusWeight(float regionIndex) {
        if (uFocusIndex < -0.5) return 1.0;
        return mix(0.34, 1.0, 1.0 - step(0.45, abs(regionIndex - uFocusIndex)));
      }

      void main() {
        float mask0 = regionMask(uCenter0, uRadius0, uMeta0.w, uReveal0) * focusWeight(0.0);
        float mask1 = regionMask(uCenter1, uRadius1, uMeta1.w, uReveal1) * focusWeight(1.0);
        float mask2 = regionMask(uCenter2, uRadius2, uMeta2.w, uReveal2) * focusWeight(2.0);
        float raw0 = surfacePattern(uMeta0, uPhysical0, vec2(0.03, 0.07), 0.0);
        float raw1 = surfacePattern(uMeta1, uPhysical1, vec2(0.17, 0.08), 0.0);
        float raw2 = surfacePattern(uMeta2, uPhysical2, vec2(0.31, 0.14), 0.0);
        float carve0 = carveMask(uCarve0, 0.1);
        float carve1 = carveMask(uCarve1, 0.5);
        float carve2 = carveMask(uCarve2, 0.9);
        float pattern0 = raw0 * carve0 * mask0;
        float pattern1 = raw1 * carve1 * mask1;
        float pattern2 = raw2 * carve2 * mask2;
        float wide0 = surfacePattern(uMeta0, uPhysical0, vec2(0.03, 0.07), 0.075) * carveMask(uCarve0, 0.1) * mask0;
        float wide1 = surfacePattern(uMeta1, uPhysical1, vec2(0.17, 0.08), 0.075) * carveMask(uCarve1, 0.5) * mask1;
        float wide2 = surfacePattern(uMeta2, uPhysical2, vec2(0.31, 0.14), 0.075) * carveMask(uCarve2, 0.9) * mask2;
        float field = max(mask0, max(mask1, mask2));
        float grooves = max(pattern0, max(pattern1, pattern2));
        float grooveEdges = max(wide0 - pattern0, max(wide1 - pattern1, wide2 - pattern2));
        float pathBlueprint = max(raw0 * (1.0 - carve0) * mask0, max(raw1 * (1.0 - carve1) * mask1, raw2 * (1.0 - carve2) * mask2));
        float carveFrontier = max(carveFront(uCarve0, 0.1) * mask0 * uPhysical0.w, max(carveFront(uCarve1, 0.5) * mask1 * uPhysical1.w, carveFront(uCarve2, 0.9) * mask2 * uPhysical2.w));
        if (field < 0.008) discard;
        vec3 weightedColor = uColor0 * mask0 + uColor1 * mask1 + uColor2 * mask2;
        float weight = max(0.001, mask0 + mask1 + mask2);
        vec3 color = weightedColor / weight;
        float boundary = smoothstep(0.035, 0.13, field) * (1.0 - smoothstep(0.2, 0.42, field));
        float depth = max(pattern0 * uPhysical0.y, max(pattern1 * uPhysical1.y, pattern2 * uPhysical2.y));
        color = mix(color * 0.86, vec3(0.025, 0.055, 0.047), depth * 0.9 * uPatternOpacity);
        color += grooveEdges * vec3(0.52, 0.68, 0.62) * 0.32 * uPatternOpacity;
        color += pathBlueprint * vec3(0.57, 0.95, 0.86) * 0.24 * uPatternOpacity;
        color += carveFrontier * vec3(0.78, 1.0, 0.94) * 0.72;
        float flowPulse = (0.5 + 0.5 * sin((vNormalized.x + vNormalized.y * 1.7) * 88.0 - uTime * 5.0));
        color += grooves * flowPulse * uFlow * vec3(0.25, 0.9, 0.76) * 0.35;
        float fieldAlpha = max(mask0 * (0.14 + uPhysical0.w * 0.16), max(mask1 * (0.14 + uPhysical1.w * 0.16), mask2 * (0.14 + uPhysical2.w * 0.16)));
        float alpha = (fieldAlpha + boundary * 0.46 + grooves * 0.68 * uPatternOpacity + grooveEdges * 0.24 * uPatternOpacity + pathBlueprint * 0.12 * uPatternOpacity + carveFrontier * 0.72) * uOpacity;
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

type SampledRegionPath = {
  kind: "outline" | "corridor";
  points: THREE.Vector2[];
  widths: number[];
  cumulative: number[];
  totalLength: number;
  centroid: THREE.Vector2;
};

const sampledRegionShapeCache = new Map<string, SampledRegionPath[]>();

function regionEnvelope(region: RegionalTextureRegion) {
  if (!region.surfaceShape?.paths.length) {
    const center = region.center ?? [0.5, 0.55, 0.52];
    const radius = region.radius ?? [0.32, 0.28, 0.72];
    return { centerX: center[0], centerY: center[1], radiusX: radius[0], radiusY: radius[1] };
  }
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  region.surfaceShape.paths.forEach((path) => {
    path.points.forEach((point, index) => {
      const width = path.kind === "corridor" ? path.widths?.[index] ?? path.widths?.[0] ?? 0.06 : 0.012;
      minX = Math.min(minX, point[0] - width);
      minY = Math.min(minY, point[1] - width);
      maxX = Math.max(maxX, point[0] + width);
      maxY = Math.max(maxY, point[1] + width);
    });
  });
  const padding = 0.025;
  minX = THREE.MathUtils.clamp(minX - padding, 0, 1);
  minY = THREE.MathUtils.clamp(minY - padding, 0, 1);
  maxX = THREE.MathUtils.clamp(maxX + padding, 0, 1);
  maxY = THREE.MathUtils.clamp(maxY + padding, 0, 1);
  return {
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
    radiusX: Math.max(0.035, (maxX - minX) * 0.5),
    radiusY: Math.max(0.035, (maxY - minY) * 0.5),
  };
}

function sampledRegionPaths(region: RegionalTextureRegion) {
  if (!region.surfaceShape?.paths.length) return [];
  const cacheKey = JSON.stringify(region.surfaceShape);
  const cached = sampledRegionShapeCache.get(cacheKey);
  if (cached) return cached;
  const sampled = region.surfaceShape.paths.map((path) => {
    const controlPoints = path.points.map(([x, y]) => new THREE.Vector3(x, y, 0));
    const closed = path.kind === "outline";
    const curve = new THREE.CatmullRomCurve3(controlPoints, closed, "centripetal", 0.28);
    const sampleCount = Math.max(32, controlPoints.length * 10);
    const points = curve.getPoints(sampleCount).map((point) => new THREE.Vector2(point.x, point.y));
    if (closed) points.pop();
    const widths = points.map((_, sampleIndex) => {
      if (path.kind === "outline") return 0;
      const unit = sampleIndex / Math.max(1, points.length - 1);
      const widthProfile = path.widths?.length ? path.widths : [0.06];
      const scaled = unit * Math.max(0, widthProfile.length - 1);
      const lower = Math.floor(scaled);
      const upper = Math.min(widthProfile.length - 1, lower + 1);
      return THREE.MathUtils.lerp(widthProfile[lower], widthProfile[upper], scaled - lower);
    });
    const cumulative = [0];
    let totalLength = 0;
    for (let index = 1; index < points.length; index++) {
      totalLength += points[index].distanceTo(points[index - 1]);
      cumulative.push(totalLength);
    }
    if (closed && points.length > 2) totalLength += points[0].distanceTo(points.at(-1)!);
    const centroid = points.reduce((sum, point) => sum.add(point), new THREE.Vector2()).multiplyScalar(1 / Math.max(1, points.length));
    return { kind: path.kind, points, widths, cumulative, totalLength, centroid };
  });
  sampledRegionShapeCache.set(cacheKey, sampled);
  return sampled;
}

function configureRegionalTexture(material: THREE.ShaderMaterial, regions: RegionalTextureRegion[], bounds: THREE.Box3) {
  const fallback: RegionalTextureRegion[] = [
    { id: "R1", enabled: true, pattern: "topology", sides: 6, wave: false, widthUm: 38, depthUm: 19, pitchUm: 168, center: [0.35, 0.62, 0.55], radius: [0.28, 0.24, 0.75] },
    { id: "R2", enabled: false, pattern: "straight", sides: 4, wave: false, widthUm: 40, depthUm: 18, pitchUm: 150, center: [0.68, 0.4, 0.55], radius: [0.24, 0.22, 0.75] },
    { id: "R3", enabled: false, pattern: "topology", sides: 3, wave: false, widthUm: 32, depthUm: 20, pitchUm: 146, center: [0.52, 0.78, 0.5], radius: [0.2, 0.18, 0.75] },
  ];
  const selected = regions.length ? regions : fallback;
  material.uniforms.uBoundsMin.value.copy(bounds.min);
  material.uniforms.uBoundsSize.value.copy(bounds.getSize(new THREE.Vector3()));
  for (let index = 0; index < 3; index++) {
    const region = selected[index] ?? fallback[index];
    const envelope = regionEnvelope(region);
    material.uniforms[`uCenter${index}`].value.set(envelope.centerX, envelope.centerY, region.center?.[2] ?? 0.55);
    material.uniforms[`uRadius${index}`].value.set(envelope.radiusX, envelope.radiusY, region.radius?.[2] ?? 0.72);
    const patternCode = region.pattern === "wave" ? 1 : region.pattern === "straight" ? 2 : 0;
    const widthUm = region.widthUm ?? 38;
    const depthUm = region.depthUm ?? 19;
    const pitchUm = region.pitchUm ?? 160;
    material.uniforms[`uMeta${index}`].value.set(region.sides, patternCode, 13_062 / pitchUm, region.enabled ? 1 : 0.28);
    material.uniforms[`uPhysical${index}`].value.set(widthUm / pitchUm, depthUm / 30, pitchUm, region.enabled ? 1 : 0);
    material.uniforms[`uColor${index}`].value.setHex(microtextureColorNumber(region));
  }
}

function createRegionLayout(region: RegionalTextureRegion, regionIndex: number): LayoutPath[] {
  if (!region.enabled) return [];
  const envelope = regionEnvelope(region);
  const centerX = envelope.centerX;
  const centerY = envelope.centerY;
  const radiusX = envelope.radiusX * 0.88;
  const radiusY = envelope.radiusY * 0.88;
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
  const axisBins: Record<"xy" | "xz" | "zy", number[][]> = {
    xy: Array.from({ length: divisions * divisions }, () => [] as number[]),
    xz: Array.from({ length: divisions * divisions }, () => [] as number[]),
    zy: Array.from({ length: divisions * divisions }, () => [] as number[]),
  };
  const size = bounds.getSize(new THREE.Vector3());
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const normalizedCoordinate = (axis: "x" | "y" | "z", index: number) => {
    const value = axis === "x" ? position.getX(index) : axis === "y" ? position.getY(index) : position.getZ(index);
    const minimum = axis === "x" ? bounds.min.x : axis === "y" ? bounds.min.y : bounds.min.z;
    const span = axis === "x" ? size.x : axis === "y" ? size.y : size.z;
    return (value - minimum) / Math.max(span, 0.001);
  };
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const fillAxisBins = (plane: "xy" | "xz" | "zy", horizontal: "x" | "z", vertical: "y" | "z") => {
      const aU = normalizedCoordinate(horizontal, triangle);
      const aV = normalizedCoordinate(vertical, triangle);
      const bU = normalizedCoordinate(horizontal, triangle + 1);
      const bV = normalizedCoordinate(vertical, triangle + 1);
      const cU = normalizedCoordinate(horizontal, triangle + 2);
      const cV = normalizedCoordinate(vertical, triangle + 2);
      const minColumn = THREE.MathUtils.clamp(Math.floor(Math.min(aU, bU, cU) * divisions), 0, divisions - 1);
      const maxColumn = THREE.MathUtils.clamp(Math.floor(Math.max(aU, bU, cU) * divisions), 0, divisions - 1);
      const minRow = THREE.MathUtils.clamp(Math.floor(Math.min(aV, bV, cV) * divisions), 0, divisions - 1);
      const maxRow = THREE.MathUtils.clamp(Math.floor(Math.max(aV, bV, cV) * divisions), 0, divisions - 1);
      for (let row = minRow; row <= maxRow; row++) {
        for (let column = minColumn; column <= maxColumn; column++) {
          axisBins[plane][row * divisions + column].push(triangle);
        }
      }
    };
    fillAxisBins("xy", "x", "y");
    fillAxisBins("xz", "x", "z");
    fillAxisBins("zy", "z", "y");
  }
  return { bins: axisBins.xy, axisBins, divisions, bounds: bounds.clone(), size, position, normal };
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

function projectSurfacePoint(
  normalizedX: number,
  normalizedY: number,
  surface: SurfaceProjectionIndex,
  targetPosition: THREE.Vector3,
  targetNormal: THREE.Vector3,
) {
  const column = THREE.MathUtils.clamp(Math.floor(normalizedX * surface.divisions), 0, surface.divisions - 1);
  const row = THREE.MathUtils.clamp(Math.floor(normalizedY * surface.divisions), 0, surface.divisions - 1);
  const candidates = surface.bins[row * surface.divisions + column];
  const localX = THREE.MathUtils.lerp(surface.bounds.min.x, surface.bounds.max.x, normalizedX);
  const localY = THREE.MathUtils.lerp(surface.bounds.min.y, surface.bounds.max.y, normalizedY);
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
    if (weightA < -0.001 || weightB < -0.001 || weightC < -0.001) continue;
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
  if (hitTriangle < 0) return false;
  const hitC = 1 - hitA - hitB;
  targetNormal.set(
    hitA * surface.normal.getX(hitTriangle) + hitB * surface.normal.getX(hitTriangle + 1) + hitC * surface.normal.getX(hitTriangle + 2),
    hitA * surface.normal.getY(hitTriangle) + hitB * surface.normal.getY(hitTriangle + 1) + hitC * surface.normal.getY(hitTriangle + 2),
    hitA * surface.normal.getZ(hitTriangle) + hitB * surface.normal.getZ(hitTriangle + 1) + hitC * surface.normal.getZ(hitTriangle + 2),
  ).normalize();
  if (targetNormal.z < 0) targetNormal.negate();
  targetPosition.set(localX, localY, highestZ);
  return true;
}

function periodicDistance(value: number, period: number) {
  const wrapped = ((value + period * 0.5) % period + period) % period - period * 0.5;
  return Math.abs(wrapped);
}

function honeycombBoundaryDistanceUm(xUm: number, yUm: number, pitchUm: number) {
  const radius = pitchUm / Math.sqrt(3);
  const horizontalStep = radius * 1.5;
  const verticalStep = radius * Math.sqrt(3);
  const baseColumn = Math.round(xUm / horizontalStep);
  let nearest = Number.POSITIVE_INFINITY;
  let secondNearest = Number.POSITIVE_INFINITY;
  for (let columnOffset = -2; columnOffset <= 2; columnOffset++) {
    const column = baseColumn + columnOffset;
    const rowOffset = Math.abs(column % 2) * 0.5;
    const baseRow = Math.round(yUm / verticalStep - rowOffset);
    for (let rowDelta = -2; rowDelta <= 2; rowDelta++) {
      const centerX = column * horizontalStep;
      const centerY = (baseRow + rowDelta + rowOffset) * verticalStep;
      const distance = Math.hypot(xUm - centerX, yUm - centerY);
      if (distance < nearest) {
        secondNearest = nearest;
        nearest = distance;
      } else if (distance < secondNearest) {
        secondNearest = distance;
      }
    }
  }
  return Math.max(0, (secondNearest - nearest) * 0.5);
}

function microtextureDistanceUm(xUm: number, yUm: number, region: RegionalTextureRegion, orientation = region.textureAngle ?? 0) {
  const pitchUm = Math.max(60, region.pitchUm ?? 160);
  const [orientedX, orientedY] = rotateRegionCoordinates(xUm, yUm, orientation);
  if (region.pattern === "straight") return periodicDistance(orientedY, pitchUm);
  if (region.pattern === "wave") {
    const displacedY = orientedY - Math.sin(orientedX / pitchUm * Math.PI * 2) * pitchUm * 0.22;
    return periodicDistance(displacedY, pitchUm);
  }
  if (region.sides === 6) return honeycombBoundaryDistanceUm(orientedX, orientedY, pitchUm);
  const directions = region.sides === 4
    ? [[1, 0], [0, 1]]
    : region.sides === 5
      ? [[1, 0], [0.309, 0.951], [-0.809, 0.588], [-0.809, -0.588], [0.309, -0.951]]
      : [[0, 1], [0.866, 0.5], [-0.866, 0.5]];
  let nearest = Number.POSITIVE_INFINITY;
  for (const [directionX, directionY] of directions) {
    nearest = Math.min(nearest, periodicDistance(orientedX * directionX + orientedY * directionY, pitchUm));
  }
  return nearest;
}

function regionTextureOrientation(normalizedX: number, normalizedY: number, region: RegionalTextureRegion) {
  const corridors = sampledRegionPaths(region).filter((path) => path.kind === "corridor");
  if (!corridors.length) return region.textureAngle ?? 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let tangentAngle = 0;
  corridors.forEach((path) => {
    const location = nearestSplineLocation(normalizedX, normalizedY, path);
    if (location.distance >= nearestDistance) return;
    nearestDistance = location.distance;
    tangentAngle = location.angle;
  });
  // Rotate the procedural grid into the local tangent frame.  The authored angle
  // is retained as a small design bias rather than overriding the surface path.
  return -tangentAngle + (region.textureAngle ?? 0) * 0.22;
}

function rotateRegionCoordinates(x: number, y: number, angle: number) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [x * cosine - y * sine, x * sine + y * cosine] as const;
}

function ellipseField(x: number, y: number, centerX: number, centerY: number, radiusX: number, radiusY: number) {
  return 1 - Math.hypot((x - centerX) / radiusX, (y - centerY) / radiusY);
}

function segmentField(x: number, y: number, startX: number, startY: number, endX: number, endY: number, width: number) {
  const segmentX = endX - startX;
  const segmentY = endY - startY;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const mix = THREE.MathUtils.clamp(((x - startX) * segmentX + (y - startY) * segmentY) / Math.max(lengthSquared, 0.0001), 0, 1);
  const distance = Math.hypot(x - THREE.MathUtils.lerp(startX, endX, mix), y - THREE.MathUtils.lerp(startY, endY, mix));
  const taperedWidth = width * (0.72 + Math.sin(mix * Math.PI) * 0.28);
  return 1 - distance / Math.max(taperedWidth, 0.01);
}

function pointInsideSplineOutline(pointX: number, pointY: number, path: SampledRegionPath) {
  let inside = false;
  for (let index = 0, previous = path.points.length - 1; index < path.points.length; previous = index++) {
    const currentPoint = path.points[index];
    const previousPoint = path.points[previous];
    const crosses = (currentPoint.y > pointY) !== (previousPoint.y > pointY)
      && pointX < (previousPoint.x - currentPoint.x) * (pointY - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function nearestSplineLocation(pointX: number, pointY: number, path: SampledRegionPath) {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestWidth = path.widths[0] ?? 0;
  let nearestProgress = 0;
  let nearestAngle = 0;
  const segmentCount = path.kind === "outline" ? path.points.length : path.points.length - 1;
  for (let index = 0; index < segmentCount; index++) {
    const start = path.points[index];
    const end = path.points[(index + 1) % path.points.length];
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const mix = THREE.MathUtils.clamp(
      ((pointX - start.x) * segmentX + (pointY - start.y) * segmentY) / Math.max(0.000001, segmentLengthSquared),
      0,
      1,
    );
    const distance = Math.hypot(pointX - THREE.MathUtils.lerp(start.x, end.x, mix), pointY - THREE.MathUtils.lerp(start.y, end.y, mix));
    if (distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearestWidth = THREE.MathUtils.lerp(path.widths[index] ?? 0, path.widths[(index + 1) % path.widths.length] ?? path.widths[index] ?? 0, mix);
    const segmentLength = Math.sqrt(segmentLengthSquared);
    nearestProgress = (path.cumulative[index] + segmentLength * mix) / Math.max(0.0001, path.totalLength);
    nearestAngle = Math.atan2(segmentY, segmentX);
  }
  return { distance: nearestDistance, width: nearestWidth, progress: nearestProgress, angle: nearestAngle };
}

function splineRegionScore(normalizedX: number, normalizedY: number, region: RegionalTextureRegion) {
  const paths = sampledRegionPaths(region);
  if (!paths.length) return null;
  const edgeSoftness = region.surfaceShape?.edgeSoftness ?? 0.018;
  let field = -1;
  paths.forEach((path) => {
    const nearest = nearestSplineLocation(normalizedX, normalizedY, path);
    if (path.kind === "outline") {
      const inside = pointInsideSplineOutline(normalizedX, normalizedY, path);
      const outlineField = inside
        ? 0.26 + Math.min(0.72, nearest.distance / Math.max(edgeSoftness * 2.3, 0.02) * 0.72)
        : -nearest.distance / Math.max(edgeSoftness, 0.01);
      field = Math.max(field, outlineField);
      return;
    }
    const corridorField = 1 - nearest.distance / Math.max(nearest.width, 0.025);
    field = Math.max(field, corridorField);
  });
  return field;
}

function regionSuitabilityScore(
  normalizedX: number,
  normalizedY: number,
  normalizedZ: number,
  surfaceNormal: THREE.Vector3,
  region: RegionalTextureRegion,
  regionIndex: number,
) {
  const splineField = splineRegionScore(normalizedX, normalizedY, region);
  if (splineField !== null) {
    // The boundary is entirely authored by anatomical splines.  Surface terms are
    // deliberately low-frequency so the outline stays controlled rather than noisy.
    const surfaceAffinity = Math.abs(surfaceNormal.x) * 0.025
      + Math.abs(surfaceNormal.y) * 0.018
      + (normalizedZ - 0.5) * 0.018;
    return splineField + surfaceAffinity;
  }
  const envelope = regionEnvelope(region);
  const localX = (normalizedX - envelope.centerX) / Math.max(envelope.radiusX, 0.001);
  const localY = (normalizedY - envelope.centerY) / Math.max(envelope.radiusY, 0.001);
  const [shapeX, shapeY] = rotateRegionCoordinates(localX, localY, region.orientation ?? 0);
  const surfaceRidge = Math.abs(surfaceNormal.x) * 0.46 + Math.abs(surfaceNormal.y) * 0.28 + normalizedZ * 0.16;
  const layout = region.layout ?? (regionIndex === 0 ? "load-pair" : regionIndex === 1 ? "exchange-band" : "protect-crescent");
  let field = -1;

  if (layout === "load-pair") {
    const primaryLobe = ellipseField(shapeX, shapeY, -0.32, -0.05, 0.58, 0.52);
    const secondaryLobe = ellipseField(shapeX, shapeY, 0.42, 0.18, 0.48, 0.42) * 0.96;
    const saddleNotch = Math.exp(-(((shapeX - 0.02) / 0.2) ** 2 + ((shapeY + 0.48) / 0.18) ** 2));
    field = Math.max(primaryLobe, secondaryLobe) - saddleNotch * 0.22 + surfaceRidge * 0.09;
  } else if (layout === "load-cluster") {
    const mesial = ellipseField(shapeX, shapeY, -0.48, -0.08, 0.42, 0.44);
    const central = ellipseField(shapeX, shapeY, 0.02, 0.16, 0.38, 0.34) * 0.97;
    const distal = ellipseField(shapeX, shapeY, 0.5, -0.03, 0.34, 0.39) * 0.91;
    const valley = Math.exp(-(((shapeX + 0.2) / 0.14) ** 2 + ((shapeY - 0.22) / 0.2) ** 2));
    field = Math.max(mesial, central, distal) - valley * 0.17 + surfaceRidge * 0.12;
  } else if (layout === "exchange-band") {
    const centerLine = Math.sin((shapeX + 0.68) * 2.35) * 0.15 + shapeX * shapeX * 0.11 - 0.06;
    const variableWidth = 0.29 + (1 - Math.abs(shapeX)) * 0.1 + Math.sin(shapeX * 4.1) * 0.025;
    const acrossBand = 1 - Math.abs(shapeY - centerLine) / Math.max(variableWidth, 0.2);
    const taperedEnds = 1 - Math.abs(shapeX) / 1.05;
    field = Math.min(acrossBand, taperedEnds) + (1 - normalizedY) * 0.055;
  } else if (layout === "flow-network") {
    const trunkX = Math.sin((shapeY + 0.72) * 2.1) * 0.11 - 0.05;
    const trunk = 1 - Math.abs(shapeX - trunkX) / 0.23;
    const trunkTaper = 1 - Math.abs(shapeY) / 1.04;
    const branchLeft = segmentField(shapeX, shapeY, -0.03, -0.08, -0.82, 0.72, 0.2);
    const branchRight = segmentField(shapeX, shapeY, 0.02, 0.05, 0.78, 0.64, 0.18);
    field = Math.max(Math.min(trunk, trunkTaper), branchLeft * 0.95, branchRight * 0.9) + (1 - normalizedY) * 0.035;
  } else if (layout === "ridge-bridge") {
    const centerLine = -shapeX * 0.18 + Math.sin(shapeX * 2.8) * 0.065;
    const bridge = Math.min(1 - Math.abs(shapeY - centerLine) / 0.22, 1 - Math.abs(shapeX) / 1.04);
    const origin = ellipseField(shapeX, shapeY, -0.63, 0.12, 0.36, 0.4);
    const terminus = ellipseField(shapeX, shapeY, 0.61, -0.11, 0.31, 0.34) * 0.92;
    field = Math.max(bridge, origin, terminus) + surfaceRidge * 0.08;
  } else {
    const radial = Math.hypot((shapeX + 0.03) / 1.02, (shapeY + 0.08) / 0.84);
    const crescent = 1 - Math.abs(radial - 0.7) / 0.22;
    const opening = 1 - Math.max(0, -shapeX - 0.34) * 0.34;
    field = Math.min(crescent, opening) + surfaceRidge * 0.035;
  }

  return field;
}

function assignedSurfaceRegion(
  normalizedX: number,
  normalizedY: number,
  normalizedZ: number,
  surfaceNormal: THREE.Vector3,
  regions: RegionalTextureRegion[],
) {
  let winner = -1;
  let winningScore = 0;
  let runnerUpScore = 0;
  regions.forEach((region, regionIndex) => {
    const score = regionSuitabilityScore(normalizedX, normalizedY, normalizedZ, surfaceNormal, region, regionIndex);
    if (score > winningScore) {
      runnerUpScore = winningScore;
      winner = regionIndex;
      winningScore = score;
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  });
  if (winningScore < 0.045) return { winner: -1, confidence: 0 };
  const interiorConfidence = winningScore / 0.72;
  const ownershipConfidence = (winningScore - runnerUpScore + 0.025) / 0.2;
  return { winner, confidence: THREE.MathUtils.clamp(Math.min(interiorConfidence, ownershipConfidence), 0, 1) };
}

function regionGrowthOrder(normalizedX: number, normalizedY: number, region: RegionalTextureRegion, regionIndex: number) {
  const splinePaths = sampledRegionPaths(region);
  if (splinePaths.length) {
    let growthOrder = 1;
    splinePaths.forEach((path, pathIndex) => {
      const nearest = nearestSplineLocation(normalizedX, normalizedY, path);
      const localOrder = path.kind === "corridor"
        ? nearest.progress * 0.82 + Math.min(0.14, nearest.distance / Math.max(nearest.width, 0.025) * 0.14)
        : THREE.MathUtils.clamp(
          Math.hypot(normalizedX - path.centroid.x, normalizedY - path.centroid.y)
            / Math.max(0.08, Math.sqrt(Math.abs(path.totalLength)) * 0.34),
          0,
          1,
        ) * 0.78;
      growthOrder = Math.min(growthOrder, localOrder + pathIndex * 0.13);
    });
    return THREE.MathUtils.clamp(growthOrder, 0, 1);
  }
  const envelope = regionEnvelope(region);
  const localX = (normalizedX - envelope.centerX) / Math.max(envelope.radiusX, 0.001);
  const localY = (normalizedY - envelope.centerY) / Math.max(envelope.radiusY, 0.001);
  const [shapeX, shapeY] = rotateRegionCoordinates(localX, localY, region.orientation ?? 0);
  const layout = region.layout ?? (regionIndex === 0 ? "load-pair" : regionIndex === 1 ? "exchange-band" : "protect-crescent");
  if (layout === "load-pair") {
    const primarySeed = Math.hypot(shapeX + 0.32, shapeY + 0.05);
    const secondarySeed = Math.hypot(shapeX - 0.42, shapeY - 0.18) + 0.08;
    return THREE.MathUtils.clamp(Math.min(primarySeed, secondarySeed) * 0.76, 0, 1);
  }
  if (layout === "load-cluster") {
    return THREE.MathUtils.clamp(Math.min(
      Math.hypot(shapeX + 0.48, shapeY + 0.08),
      Math.hypot(shapeX - 0.02, shapeY - 0.16) + 0.06,
      Math.hypot(shapeX - 0.5, shapeY + 0.03) + 0.12,
    ) * 0.82, 0, 1);
  }
  if (layout === "exchange-band") return THREE.MathUtils.clamp((shapeX + 1.08) * 0.44 + Math.abs(shapeY) * 0.1, 0, 1);
  if (layout === "flow-network") return THREE.MathUtils.clamp((shapeY + 1.04) * 0.42 + Math.abs(shapeX) * 0.08, 0, 1);
  if (layout === "ridge-bridge") return THREE.MathUtils.clamp(Math.min(Math.abs(shapeX + 0.72), Math.abs(shapeX - 0.72)) * 0.55 + Math.abs(shapeY) * 0.14, 0, 1);
  return THREE.MathUtils.clamp(Math.abs(Math.hypot(shapeX, shapeY) - 0.7) * 0.9 + (shapeX + 1) * 0.16, 0, 1);
}

function regionCarveProgress(region: RegionalTextureRegion, stageProgress: number, enabledOrder: number) {
  if (region.anatomicalZone) {
    const zoneIndex = Math.max(0, anatomicalZoneOrder.indexOf(region.anatomicalZone));
    const delay = 0.16 + zoneIndex * 0.035 + Math.max(0, enabledOrder) * 0.035;
    return ease(THREE.MathUtils.clamp((stageProgress - delay) / 0.58, 0, 1));
  }
  const layout = region.layout ?? "load-pair";
  const layoutDelay = layout === "load-pair" || layout === "load-cluster" ? 0.03
    : layout === "ridge-bridge" ? 0.12
      : layout === "exchange-band" ? 0.16
        : layout === "flow-network" ? 0.27 : 0.2;
  const duration = layout === "flow-network" ? 0.44
    : layout === "exchange-band" ? 0.4
      : layout === "ridge-bridge" ? 0.34 : 0.3;
  const stagger = Math.max(0, enabledOrder) * 0.075;
  return ease(THREE.MathUtils.clamp((stageProgress - 0.2 - layoutDelay - stagger) / duration, 0, 1));
}

function createSurfacePatchMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uReveal: { value: 0 },
      uCarve: { value: 0 },
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uFocus: { value: 1 },
      uDecision: { value: 0 },
    },
    vertexShader: `
      attribute float aGrooveDepth;
      attribute float aGrooveProfile;
      attribute float aRevealOrder;
      attribute float aFlowCoordinate;
      attribute float aRegionConfidence;
      uniform float uCarve;
      uniform float uTime;
      uniform float uDecision;
      varying float vGrooveProfile;
      varying float vCarveAmount;
      varying float vRevealOrder;
      varying float vFlowCoordinate;
      varying float vRegionConfidence;
      varying vec3 vViewPosition;
      void main() {
        float carveAmount = smoothstep(aRevealOrder - 0.09, aRevealOrder + 0.025, uCarve);
        float boundaryInfluence = 1.0 - smoothstep(0.025, 0.24, aRegionConfidence);
        float boundaryBreath = (0.0032 + sin(aRevealOrder * 24.0 - uTime * 4.2) * 0.0014) * boundaryInfluence * uDecision;
        vec3 displaced = position + normal * boundaryBreath - normal * aGrooveDepth * carveAmount;
        vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
        vGrooveProfile = aGrooveProfile;
        vCarveAmount = carveAmount;
        vRevealOrder = aRevealOrder;
        vFlowCoordinate = aFlowCoordinate;
        vRegionConfidence = aRegionConfidence;
        vViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uReveal;
      uniform float uTime;
      uniform float uFlow;
      uniform float uFocus;
      uniform float uDecision;
      varying float vGrooveProfile;
      varying float vCarveAmount;
      varying float vRevealOrder;
      varying float vFlowCoordinate;
      varying float vRegionConfidence;
      varying vec3 vViewPosition;
      void main() {
        float revealAlpha = smoothstep(vRevealOrder - 0.055, vRevealOrder + 0.018, uReveal);
        if (revealAlpha < 0.004) discard;
        vec3 geometricNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        if (!gl_FrontFacing) geometricNormal = -geometricNormal;
        vec3 lightDirection = normalize(vec3(-0.34, 0.58, 0.74));
        float diffuse = 0.42 + max(0.0, dot(geometricNormal, lightDirection)) * 0.66;
        float groove = vGrooveProfile * vCarveAmount;
        float shoulder = smoothstep(0.04, 0.38, vGrooveProfile) * (1.0 - smoothstep(0.58, 0.96, vGrooveProfile));
        float blueprint = vGrooveProfile * (1.0 - vCarveAmount);
        float boundary = 1.0 - smoothstep(0.02, 0.18, vRegionConfidence);
        float growthFront = (1.0 - smoothstep(0.018, 0.075, abs(vRevealOrder - uReveal))) * (1.0 - smoothstep(0.9, 1.0, uReveal));
        vec3 color = uColor * diffuse;
        color = mix(color, vec3(0.018, 0.045, 0.038), groove * 0.82);
        color += shoulder * vec3(0.28, 0.45, 0.4) * vCarveAmount;
        color += blueprint * vec3(0.48, 0.95, 0.83) * 0.36;
        color += boundary * vec3(0.5, 0.86, 0.78) * (0.16 + uDecision * 0.38);
        color += growthFront * vec3(0.72, 1.0, 0.94) * 0.62;
        float capillaryPhase = fract(vFlowCoordinate - uTime * 0.78);
        float capillaryBody = smoothstep(0.04, 0.18, capillaryPhase) * (1.0 - smoothstep(0.58, 0.92, capillaryPhase));
        float capillaryEchoPhase = fract(vFlowCoordinate * 0.63 - uTime * 0.38 + 0.46);
        float capillaryEcho = smoothstep(0.12, 0.28, capillaryEchoPhase) * (1.0 - smoothstep(0.5, 0.82, capillaryEchoPhase));
        float capillaryFlow = groove * uFlow * (capillaryBody * 0.78 + capillaryEcho * 0.28);
        color = mix(color, vec3(0.055, 0.28, 0.27), groove * uFlow * 0.28);
        color += capillaryFlow * vec3(0.5, 1.0, 0.88) * 0.58;
        color += shoulder * uFlow * vec3(0.22, 0.55, 0.5) * 0.12;
        color *= mix(0.58, 1.0, uFocus);
        float alpha = uOpacity * revealAlpha * mix(0.76, 0.96, uFocus);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
}

function createProjectedSurfacePatchRig(
  surface: SurfaceProjectionIndex,
  regions: RegionalTextureRegion[],
  modelUnitsPerUm: number,
): SurfacePatchRig {
  const group = new THREE.Group();
  group.name = "regional-surface-patch-geometry";
  const patches: SurfacePatch[] = [];
  const projectedPosition = new THREE.Vector3();
  const projectedNormal = new THREE.Vector3();

  regions.forEach((region, regionIndex) => {
    const envelope = regionEnvelope(region);
    const radiusX = envelope.radiusX * 1.12;
    const radiusY = envelope.radiusY * 1.12;
    const minNormalizedX = THREE.MathUtils.clamp(envelope.centerX - radiusX, 0, 1);
    const maxNormalizedX = THREE.MathUtils.clamp(envelope.centerX + radiusX, 0, 1);
    const minNormalizedY = THREE.MathUtils.clamp(envelope.centerY - radiusY, 0, 1);
    const maxNormalizedY = THREE.MathUtils.clamp(envelope.centerY + radiusY, 0, 1);
    const physicalWidthUm = (maxNormalizedX - minNormalizedX) * surface.size.x / modelUnitsPerUm;
    const physicalHeightUm = (maxNormalizedY - minNormalizedY) * surface.size.y / modelUnitsPerUm;
    const targetSpacingUm = Math.max(16, Math.min(24, (region.widthUm || 38) * 0.52));
    const columns = THREE.MathUtils.clamp(Math.ceil(physicalWidthUm / targetSpacingUm), 120, 280);
    const rows = THREE.MathUtils.clamp(Math.ceil(physicalHeightUm / targetSpacingUm), 100, 240);
    const vertexCount = (columns + 1) * (rows + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const grooveDepths = new Float32Array(vertexCount);
    const grooveProfiles = new Float32Array(vertexCount);
    const revealOrders = new Float32Array(vertexCount);
    const flowCoordinates = new Float32Array(vertexCount);
    const regionConfidences = new Float32Array(vertexCount);
    const valid = new Uint8Array(vertexCount);
    const depthModelUnits = (region.enabled ? region.depthUm ?? 19 : 0) * modelUnitsPerUm;
    const surfaceLift = Math.max(modelUnitsPerUm * 3, depthModelUnits * 1.04);
    const widthUm = Math.max(1, region.widthUm ?? 38);
    const pitchUm = Math.max(60, region.pitchUm ?? 160);

    for (let row = 0; row <= rows; row++) {
      const rowUnit = row / rows;
      const normalizedY = THREE.MathUtils.lerp(minNormalizedY, maxNormalizedY, rowUnit);
      for (let column = 0; column <= columns; column++) {
        const columnUnit = column / columns;
        const normalizedX = THREE.MathUtils.lerp(minNormalizedX, maxNormalizedX, columnUnit);
        const index = row * (columns + 1) + column;
        if (!projectSurfacePoint(normalizedX, normalizedY, surface, projectedPosition, projectedNormal)) continue;
        const normalizedZ = (projectedPosition.z - surface.bounds.min.z) / Math.max(surface.size.z, 0.001);
        const assignment = assignedSurfaceRegion(normalizedX, normalizedY, normalizedZ, projectedNormal, regions);
        if (assignment.winner !== regionIndex) continue;
        valid[index] = 1;
        const xUm = (normalizedX - minNormalizedX) * surface.size.x / modelUnitsPerUm;
        const yUm = (normalizedY - minNormalizedY) * surface.size.y / modelUnitsPerUm;
        const localOrientation = regionTextureOrientation(normalizedX, normalizedY, region);
        const distanceUm = region.enabled ? microtextureDistanceUm(xUm, yUm, region, localOrientation) : Number.POSITIVE_INFINITY;
        const halfWidth = widthUm * 0.5;
        const grooveProfile = distanceUm < halfWidth ? 0.5 + 0.5 * Math.cos(Math.PI * distanceUm / halfWidth) : 0;
        projectedPosition.addScaledVector(projectedNormal, surfaceLift);
        positions[index * 3] = projectedPosition.x;
        positions[index * 3 + 1] = projectedPosition.y;
        positions[index * 3 + 2] = projectedPosition.z;
        normals[index * 3] = projectedNormal.x;
        normals[index * 3 + 1] = projectedNormal.y;
        normals[index * 3 + 2] = projectedNormal.z;
        grooveProfiles[index] = grooveProfile;
        grooveDepths[index] = depthModelUnits * grooveProfile;
        revealOrders[index] = regionGrowthOrder(normalizedX, normalizedY, region, regionIndex);
        flowCoordinates[index] = (xUm + yUm * 0.36) / pitchUm;
        regionConfidences[index] = assignment.confidence;
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const topLeft = row * (columns + 1) + column;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + columns + 1;
        const bottomRight = bottomLeft + 1;
        if (!valid[topLeft] || !valid[topRight] || !valid[bottomLeft] || !valid[bottomRight]) continue;
        indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("aGrooveDepth", new THREE.BufferAttribute(grooveDepths, 1));
    geometry.setAttribute("aGrooveProfile", new THREE.BufferAttribute(grooveProfiles, 1));
    geometry.setAttribute("aRevealOrder", new THREE.BufferAttribute(revealOrders, 1));
    geometry.setAttribute("aFlowCoordinate", new THREE.BufferAttribute(flowCoordinates, 1));
    geometry.setAttribute("aRegionConfidence", new THREE.BufferAttribute(regionConfidences, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = createSurfacePatchMaterial(microtextureColorNumber(region));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 5 + regionIndex;
    mesh.frustumCulled = false;
    group.add(mesh);
    patches.push({ regionId: region.id, regionIndex, enabled: region.enabled, mesh, material });
  });
  group.visible = false;
  return { group, patches };
}

const anatomicalZoneOrder: AnatomicalCrownZone[] = ["occlusal", "buccal", "lingual", "mesial", "distal"];

function classifyCrownTriangle(
  x: number,
  y: number,
  z: number,
  normalY: number,
  bounds: THREE.Box3,
  size: THREE.Vector3,
) {
  const normalizedY = (y - bounds.min.y) / Math.max(size.y, 0.001);
  const radialX = (x - (bounds.min.x + bounds.max.x) * 0.5) / Math.max(size.x * 0.5, 0.001);
  const radialZ = (z - (bounds.min.z + bounds.max.z) * 0.5) / Math.max(size.z * 0.5, 0.001);
  const azimuth = Math.atan2(radialZ, radialX);
  const radial = Math.hypot(radialX, radialZ);
  // A softly undulating shoulder line follows the crown rather than cutting it
  // with a flat plane.  It is deterministic and identical across all schemes.
  const occlusalBoundary = 0.675
    + Math.cos(azimuth * 2) * 0.024
    - Math.sin(azimuth * 3) * 0.012
    + THREE.MathUtils.clamp(radial - 0.72, 0, 0.35) * 0.055;
  const capAffinity = normalizedY - occlusalBoundary + Math.max(0, normalY) * 0.045;
  if (capAffinity >= 0) {
    return {
      zone: "occlusal" as const,
      confidence: THREE.MathUtils.clamp(Math.abs(capAffinity) / 0.075, 0, 1),
      growth: THREE.MathUtils.clamp(0.08 + radial * 0.62 + (1 - normalizedY) * 0.12, 0, 1),
    };
  }
  // Keep the fitting underside ceramic.  The visible axial wall remains one
  // continuous ring from the shoulder to the cervical margin.
  if (normalizedY < 0.055 || (normalizedY < 0.14 && normalY < -0.46)) return null;
  const horizontalDominance = Math.abs(radialX);
  const depthDominance = Math.abs(radialZ);
  let zone: AnatomicalCrownZone;
  if (depthDominance >= horizontalDominance) zone = radialZ >= 0 ? "buccal" : "lingual";
  else zone = radialX < 0 ? "mesial" : "distal";
  const sectorSeparation = Math.abs(depthDominance - horizontalDominance) / Math.max(0.12, depthDominance + horizontalDominance);
  const shoulderSeparation = Math.abs(capAffinity) / 0.085;
  return {
    zone,
    confidence: THREE.MathUtils.clamp(Math.min(1, sectorSeparation * 1.8, shoulderSeparation), 0, 1),
    growth: THREE.MathUtils.clamp(0.08 + (1 - normalizedY) * 0.74 + sectorSeparation * 0.08, 0, 1),
  };
}

type AnatomicalProjectionConfig = {
  plane: "xy" | "xz" | "zy";
  horizontalAxis: "x" | "z";
  verticalAxis: "y" | "z";
  depthAxis: "x" | "y" | "z";
  positiveDepth: boolean;
  reverseWinding: boolean;
};

function anatomicalProjectionConfig(zone: AnatomicalCrownZone): AnatomicalProjectionConfig {
  if (zone === "occlusal") return { plane: "xz", horizontalAxis: "x", verticalAxis: "z", depthAxis: "y", positiveDepth: true, reverseWinding: true };
  if (zone === "buccal") return { plane: "xy", horizontalAxis: "x", verticalAxis: "y", depthAxis: "z", positiveDepth: true, reverseWinding: false };
  if (zone === "lingual") return { plane: "xy", horizontalAxis: "x", verticalAxis: "y", depthAxis: "z", positiveDepth: false, reverseWinding: true };
  if (zone === "mesial") return { plane: "zy", horizontalAxis: "z", verticalAxis: "y", depthAxis: "x", positiveDepth: false, reverseWinding: false };
  return { plane: "zy", horizontalAxis: "z", verticalAxis: "y", depthAxis: "x", positiveDepth: true, reverseWinding: true };
}

function surfaceAxisValue(attribute: THREE.BufferAttribute, axis: "x" | "y" | "z", index: number) {
  return axis === "x" ? attribute.getX(index) : axis === "y" ? attribute.getY(index) : attribute.getZ(index);
}

function surfaceAxisBounds(bounds: THREE.Box3, size: THREE.Vector3, axis: "x" | "y" | "z") {
  if (axis === "x") return { minimum: bounds.min.x, span: size.x };
  if (axis === "y") return { minimum: bounds.min.y, span: size.y };
  return { minimum: bounds.min.z, span: size.z };
}

function projectAnatomicalSurfacePoint(
  zone: AnatomicalCrownZone,
  normalizedU: number,
  normalizedV: number,
  surface: SurfaceProjectionIndex,
  targetPosition: THREE.Vector3,
  targetNormal: THREE.Vector3,
) {
  const config = anatomicalProjectionConfig(zone);
  const column = THREE.MathUtils.clamp(Math.floor(normalizedU * surface.divisions), 0, surface.divisions - 1);
  const row = THREE.MathUtils.clamp(Math.floor(normalizedV * surface.divisions), 0, surface.divisions - 1);
  const candidates = surface.axisBins[config.plane][row * surface.divisions + column];
  const horizontalBounds = surfaceAxisBounds(surface.bounds, surface.size, config.horizontalAxis);
  const verticalBounds = surfaceAxisBounds(surface.bounds, surface.size, config.verticalAxis);
  const localU = THREE.MathUtils.lerp(horizontalBounds.minimum, horizontalBounds.minimum + horizontalBounds.span, normalizedU);
  const localV = THREE.MathUtils.lerp(verticalBounds.minimum, verticalBounds.minimum + verticalBounds.span, normalizedV);
  let selectedDepth = config.positiveDepth ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let selectedTriangle = -1;
  let selectedA = 0;
  let selectedB = 0;
  let selectedClassification: ReturnType<typeof classifyCrownTriangle> = null;

  for (const triangle of candidates) {
    const aU = surfaceAxisValue(surface.position, config.horizontalAxis, triangle);
    const aV = surfaceAxisValue(surface.position, config.verticalAxis, triangle);
    const bU = surfaceAxisValue(surface.position, config.horizontalAxis, triangle + 1);
    const bV = surfaceAxisValue(surface.position, config.verticalAxis, triangle + 1);
    const cU = surfaceAxisValue(surface.position, config.horizontalAxis, triangle + 2);
    const cV = surfaceAxisValue(surface.position, config.verticalAxis, triangle + 2);
    const denominator = (bV - cV) * (aU - cU) + (cU - bU) * (aV - cV);
    if (Math.abs(denominator) < 1e-8) continue;
    const weightA = ((bV - cV) * (localU - cU) + (cU - bU) * (localV - cV)) / denominator;
    const weightB = ((cV - aV) * (localU - cU) + (aU - cU) * (localV - cV)) / denominator;
    const weightC = 1 - weightA - weightB;
    if (weightA < -0.0005 || weightB < -0.0005 || weightC < -0.0005) continue;
    const depth = weightA * surfaceAxisValue(surface.position, config.depthAxis, triangle)
      + weightB * surfaceAxisValue(surface.position, config.depthAxis, triangle + 1)
      + weightC * surfaceAxisValue(surface.position, config.depthAxis, triangle + 2);
    const winsDepth = config.positiveDepth ? depth > selectedDepth : depth < selectedDepth;
    if (!winsDepth) continue;
    const x = weightA * surface.position.getX(triangle) + weightB * surface.position.getX(triangle + 1) + weightC * surface.position.getX(triangle + 2);
    const y = weightA * surface.position.getY(triangle) + weightB * surface.position.getY(triangle + 1) + weightC * surface.position.getY(triangle + 2);
    const z = weightA * surface.position.getZ(triangle) + weightB * surface.position.getZ(triangle + 1) + weightC * surface.position.getZ(triangle + 2);
    const normalY = weightA * surface.normal.getY(triangle) + weightB * surface.normal.getY(triangle + 1) + weightC * surface.normal.getY(triangle + 2);
    const classification = classifyCrownTriangle(x, y, z, normalY, surface.bounds, surface.size);
    if (!classification || classification.zone !== zone) continue;
    selectedDepth = depth;
    selectedTriangle = triangle;
    selectedA = weightA;
    selectedB = weightB;
    selectedClassification = classification;
  }

  if (selectedTriangle < 0 || !selectedClassification) return null;
  const selectedC = 1 - selectedA - selectedB;
  targetPosition.set(
    selectedA * surface.position.getX(selectedTriangle) + selectedB * surface.position.getX(selectedTriangle + 1) + selectedC * surface.position.getX(selectedTriangle + 2),
    selectedA * surface.position.getY(selectedTriangle) + selectedB * surface.position.getY(selectedTriangle + 1) + selectedC * surface.position.getY(selectedTriangle + 2),
    selectedA * surface.position.getZ(selectedTriangle) + selectedB * surface.position.getZ(selectedTriangle + 1) + selectedC * surface.position.getZ(selectedTriangle + 2),
  );
  targetNormal.set(
    selectedA * surface.normal.getX(selectedTriangle) + selectedB * surface.normal.getX(selectedTriangle + 1) + selectedC * surface.normal.getX(selectedTriangle + 2),
    selectedA * surface.normal.getY(selectedTriangle) + selectedB * surface.normal.getY(selectedTriangle + 1) + selectedC * surface.normal.getY(selectedTriangle + 2),
    selectedA * surface.normal.getZ(selectedTriangle) + selectedB * surface.normal.getZ(selectedTriangle + 1) + selectedC * surface.normal.getZ(selectedTriangle + 2),
  ).normalize();
  const outwardComponent = config.depthAxis === "x" ? targetNormal.x : config.depthAxis === "y" ? targetNormal.y : targetNormal.z;
  if ((config.positiveDepth ? 1 : -1) * outwardComponent < 0) targetNormal.negate();
  return selectedClassification;
}

function createAnatomicalSurfacePatchRig(
  surface: SurfaceProjectionIndex,
  regions: RegionalTextureRegion[],
  modelUnitsPerUm: number,
): SurfacePatchRig {
  const group = new THREE.Group();
  group.name = "five-zone-anatomical-crown-atlas";
  const patches: SurfacePatch[] = [];
  const regionByZone = new Map(regions.map((region, index) => [region.anatomicalZone, { region, index }]));
  const projectedPosition = new THREE.Vector3();
  const projectedNormal = new THREE.Vector3();

  anatomicalZoneOrder.forEach((zone, zoneIndex) => {
    const zonePlan = regionByZone.get(zone);
    if (!zonePlan) return;
    const { region, index: regionIndex } = zonePlan;
    const material = createSurfacePatchMaterial(microtextureColorNumber(region));
    if (!region.enabled) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.name = `anatomical-zone-${zone}`;
      group.add(mesh);
      patches.push({ regionId: region.id, regionIndex, enabled: false, mesh, material });
      return;
    }
    const projection = anatomicalProjectionConfig(zone);
    const horizontalSpan = surfaceAxisBounds(surface.bounds, surface.size, projection.horizontalAxis).span;
    const verticalSpan = surfaceAxisBounds(surface.bounds, surface.size, projection.verticalAxis).span;
    const targetSpacingUm = Math.max(16, Math.min(24, (region.widthUm || 38) * 0.52));
    const columns = THREE.MathUtils.clamp(Math.ceil(horizontalSpan / modelUnitsPerUm / targetSpacingUm), 120, 280);
    const rows = THREE.MathUtils.clamp(Math.ceil(verticalSpan / modelUnitsPerUm / targetSpacingUm), 100, 240);
    const vertexCount = (columns + 1) * (rows + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const grooveDepths = new Float32Array(vertexCount);
    const grooveProfiles = new Float32Array(vertexCount);
    const revealOrders = new Float32Array(vertexCount);
    const flowCoordinates = new Float32Array(vertexCount);
    const regionConfidences = new Float32Array(vertexCount);
    const valid = new Uint8Array(vertexCount);
    const depthModelUnits = (region.enabled ? region.depthUm ?? 19 : 0) * modelUnitsPerUm;
    const surfaceLift = Math.max(modelUnitsPerUm * 3, depthModelUnits * 1.04);
    const halfWidthUm = Math.max(1, region.widthUm ?? 38) * 0.5;
    const pitchUm = Math.max(60, region.pitchUm ?? 160);

    for (let row = 0; row <= rows; row++) {
      const normalizedV = row / rows;
      for (let column = 0; column <= columns; column++) {
        const normalizedU = column / columns;
        const index = row * (columns + 1) + column;
        const classification = projectAnatomicalSurfacePoint(zone, normalizedU, normalizedV, surface, projectedPosition, projectedNormal);
        if (!classification) continue;
        valid[index] = 1;
        const uUm = normalizedU * horizontalSpan / modelUnitsPerUm;
        const vUm = normalizedV * verticalSpan / modelUnitsPerUm;
        const distanceUm = microtextureDistanceUm(uUm, vUm, region);
        const grooveProfile = distanceUm < halfWidthUm ? 0.5 + 0.5 * Math.cos(Math.PI * distanceUm / halfWidthUm) : 0;
        projectedPosition.addScaledVector(projectedNormal, surfaceLift);
        positions[index * 3] = projectedPosition.x;
        positions[index * 3 + 1] = projectedPosition.y;
        positions[index * 3 + 2] = projectedPosition.z;
        normals[index * 3] = projectedNormal.x;
        normals[index * 3 + 1] = projectedNormal.y;
        normals[index * 3 + 2] = projectedNormal.z;
        grooveProfiles[index] = grooveProfile;
        grooveDepths[index] = depthModelUnits * grooveProfile;
        revealOrders[index] = THREE.MathUtils.clamp(classification.growth + zoneIndex * 0.035, 0, 1);
        flowCoordinates[index] = (uUm + vUm * 0.36) / pitchUm;
        regionConfidences[index] = classification.confidence;
      }
    }

    const indices: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const topLeft = row * (columns + 1) + column;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + columns + 1;
        const bottomRight = bottomLeft + 1;
        if (!valid[topLeft] || !valid[topRight] || !valid[bottomLeft] || !valid[bottomRight]) continue;
        if (projection.reverseWinding) {
          indices.push(topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight);
        } else {
          indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("aGrooveDepth", new THREE.BufferAttribute(grooveDepths, 1));
    geometry.setAttribute("aGrooveProfile", new THREE.BufferAttribute(grooveProfiles, 1));
    geometry.setAttribute("aRevealOrder", new THREE.BufferAttribute(revealOrders, 1));
    geometry.setAttribute("aFlowCoordinate", new THREE.BufferAttribute(flowCoordinates, 1));
    geometry.setAttribute("aRegionConfidence", new THREE.BufferAttribute(regionConfidences, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `anatomical-zone-${zone}`;
    mesh.renderOrder = 5 + zoneIndex;
    mesh.frustumCulled = false;
    group.add(mesh);
    patches.push({ regionId: region.id, regionIndex, enabled: region.enabled, mesh, material });
  });
  group.visible = false;
  return { group, patches };
}

function createSurfacePatchRig(
  surface: SurfaceProjectionIndex,
  regions: RegionalTextureRegion[],
  modelUnitsPerUm: number,
) {
  return regions.some((region) => region.anatomicalZone)
    ? createAnatomicalSurfacePatchRig(surface, regions, modelUnitsPerUm)
    : createProjectedSurfacePatchRig(surface, regions, modelUnitsPerUm);
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

function createSimulationFieldMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
      uLowColor: { value: new THREE.Color(0x17352f) },
      uHighColor: { value: new THREE.Color(0xff7457) },
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uDeform: { value: 0 },
      uRecalculation: { value: 0 },
    },
    vertexShader: `
      attribute float aStress;
      attribute float aFluid;
      attribute float aBio;
      attribute float aFusion;
      attribute float aFieldOrder;
      uniform vec4 uWeights;
      uniform float uDeform;
      varying float vField;
      varying float vOrder;
      varying vec3 vViewPosition;
      void main() {
        vec4 fields = vec4(aStress, aFluid, aBio, aFusion);
        vField = dot(fields, uWeights);
        vOrder = aFieldOrder;
        vec3 displaced = position - normal * aStress * uDeform * 0.013;
        vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
        vViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uLowColor;
      uniform vec3 uHighColor;
      uniform float uOpacity;
      uniform float uProgress;
      uniform float uTime;
      uniform float uRecalculation;
      varying float vField;
      varying float vOrder;
      varying vec3 vViewPosition;
      void main() {
        float fieldValue = mix(vField, vField * 0.76, uRecalculation);
        float reveal = smoothstep(vOrder - 0.14, vOrder + 0.035, uProgress);
        if (reveal < 0.004 || fieldValue < 0.035) discard;
        vec3 geometricNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        float light = 0.48 + max(0.0, dot(geometricNormal, normalize(vec3(-0.25, 0.55, 0.8)))) * 0.62;
        float contourDistance = abs(fract(fieldValue * 8.0 - uTime * 0.055) - 0.5);
        float contour = 1.0 - smoothstep(0.455, 0.5, contourDistance);
        float solveFront = (1.0 - smoothstep(0.0, 0.045, abs(vOrder - uProgress))) * (1.0 - smoothstep(0.91, 1.0, uProgress));
        vec3 color = mix(uLowColor, uHighColor, smoothstep(0.08, 0.92, fieldValue)) * light;
        color += contour * mix(vec3(0.28, 0.48, 0.43), vec3(0.88, 1.0, 0.96), fieldValue) * 0.26;
        color += solveFront * vec3(0.82, 1.0, 0.96) * 0.72;
        float alpha = (0.11 + fieldValue * 0.72 + contour * 0.12) * reveal * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function createThinFilmFlowMaterial(bounds?: THREE.Box3) {
  const initialBounds = bounds ?? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uCandidate: { value: 0 },
      uVelocity: { value: 0.82 },
      uRetention: { value: 1 },
      uExchange: { value: 0.42 },
      uStabilize: { value: 0 },
      uMotion: { value: 1 },
      uReadability: { value: 1 },
      uScheme: { value: 0 },
      uBoundsMin: { value: initialBounds.min.clone() },
      uBoundsSize: { value: initialBounds.getSize(new THREE.Vector3()) },
    },
    vertexShader: `
      attribute float aFluid;
      uniform vec3 uBoundsMin;
      uniform vec3 uBoundsSize;
      uniform float uCandidate;
      uniform float uRetention;
      uniform float uExchange;
      uniform float uVelocity;
      uniform float uProgress;
      uniform float uTime;
      uniform float uStabilize;
      uniform float uMotion;
      uniform float uReadability;
      uniform float uScheme;
      varying float vFluid;
      varying vec3 vPosition;
      varying vec3 vNormalized;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      varying float vFilmHeight;
      varying float vFilmCrest;
      void main() {
        vFluid = aFluid;
        vPosition = position;
        vNormalized = (position - uBoundsMin) / max(uBoundsSize, vec3(0.0001));
        float wetOrder = clamp(
          (1.0 - vNormalized.y) * 0.72
          + abs(vNormalized.x - 0.5) * 0.16
          + abs(vNormalized.z - 0.5) * 0.12,
          0.0,
          1.0
        );
        float wetTimeline = smoothstep(0.0, 0.3, uProgress) * 1.12;
        float wetMask = 1.0 - smoothstep(wetTimeline - 0.035, wetTimeline + 0.08, wetOrder);
        float wetFront = 1.0 - smoothstep(0.01, 0.085, abs(wetOrder - wetTimeline));
        float transport = smoothstep(0.18, 0.32, uProgress);
        float retentionBuild = smoothstep(0.5, 0.8, uProgress);
        float motionRate = mix(1.0, 0.42, uStabilize) * uMotion;
        float activeVelocity = mix(0.9, uVelocity, uCandidate);
        float flowTime = uTime * activeVelocity * motionRate;
        vec2 surfacePlane = vec2(
          clamp(vNormalized.x * 0.72 + vNormalized.z * 0.28, 0.0, 1.0),
          vNormalized.y
        );
        float schemeShift = (uScheme - 1.0) * 0.055;
        vec2 poolDeltaA = (surfacePlane - vec2(0.72 + schemeShift, 0.42)) / vec2(0.18, 0.15);
        vec2 poolDeltaB = (surfacePlane - vec2(0.38 - schemeShift * 0.6, 0.62)) / vec2(0.14, 0.12);
        float poolField = clamp(exp(-dot(poolDeltaA, poolDeltaA)) * 0.82 + exp(-dot(poolDeltaB, poolDeltaB)) * 0.42, 0.0, 1.0);
        float retained = clamp(aFluid * uRetention * 0.74 + poolField * uRetention * 0.4, 0.0, 1.0);
        float longitudinal = wetOrder * 1.62
          + surfacePlane.x * 0.18
          + sin(surfacePlane.x * 10.0 + vNormalized.z * 5.0 - flowTime * 0.8) * 0.025;
        float slowedTime = flowTime * mix(1.0, 0.48, retained);
        float pulseA = fract(longitudinal * 0.92 - slowedTime * 0.54);
        float pulseB = fract(longitudinal * 0.86 - slowedTime * 0.47 + 0.34 + uScheme * 0.11);
        float pulseC = fract(longitudinal * 0.78 - slowedTime * 0.41 + 0.68 - uScheme * 0.08);
        float crestA = exp(-pow((pulseA - 0.25) / 0.14, 2.0));
        float crestB = exp(-pow((pulseB - 0.28) / 0.16, 2.0));
        float crestC = exp(-pow((pulseC - 0.3) / 0.18, 2.0));
        float hydrodynamicWidth = clamp(0.88 + uRetention * 0.22 - uExchange * 0.09, 0.82, 1.12);
        float centerA = 0.27 + sin(longitudinal * 7.5 - flowTime * 1.35 + uScheme * 0.7) * (0.055 + uExchange * 0.012);
        float centerB = 0.51 + sin(longitudinal * 6.1 - flowTime * 1.12 + 1.8 - uScheme * 0.45) * 0.075;
        float centerC = 0.75 + sin(longitudinal * 7.0 - flowTime * 1.24 + 3.7 + uScheme * 0.38) * (0.045 + uRetention * 0.018);
        float ribbonA = exp(-pow((surfacePlane.x - centerA) / (0.12 * hydrodynamicWidth), 2.0));
        float ribbonB = exp(-pow((surfacePlane.x - centerB) / (0.135 * hydrodynamicWidth), 2.0));
        float ribbonC = exp(-pow((surfacePlane.x - centerC) / (0.115 * hydrodynamicWidth), 2.0));
        float travelingCrest = max(ribbonA * crestA, max(ribbonB * crestB, ribbonC * crestC)) * transport;
        float shoulderWave = (0.5 + 0.5 * sin(longitudinal * 19.0 - slowedTime * 3.5 + surfacePlane.x * 7.0))
          * travelingCrest;
        float poolSwell = retained * retentionBuild
          * (0.78 + sin(flowTime * 1.45 + poolField * 6.0 + uScheme) * 0.22);
        float capillaryRipple = sin(longitudinal * 37.0 - flowTime * 4.2 + surfacePlane.x * 13.0)
          * (0.5 + aFluid * 0.5)
          * transport;
        float thicknessResponse = clamp(1.08 + uRetention * 0.3 - uExchange * 0.16, 0.88, 1.28);
        float readabilityLift = mix(1.0, 1.34, clamp(uReadability - 1.0, 0.0, 1.0));
        float filmLift = (
          0.009
          + aFluid * uRetention * 0.005
          + travelingCrest * 0.017
          + shoulderWave * 0.0045
          + poolSwell * 0.009
          + wetFront * 0.006
          + capillaryRipple * 0.0018
        ) * wetMask * thicknessResponse * readabilityLift;
        vFilmHeight = max(0.0, filmLift);
        vFilmCrest = clamp(travelingCrest * 0.82 + shoulderWave * 0.28 + poolSwell * 0.38, 0.0, 1.0);
        vec3 lifted = position + normal * filmLift;
        vec4 viewPosition = modelViewMatrix * vec4(lifted, 1.0);
        vViewPosition = viewPosition.xyz;
        vViewNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uProgress;
      uniform float uTime;
      uniform float uCandidate;
      uniform float uVelocity;
      uniform float uRetention;
      uniform float uExchange;
      uniform float uStabilize;
      uniform float uMotion;
      uniform float uReadability;
      uniform float uScheme;
      varying float vFluid;
      varying vec3 vPosition;
      varying vec3 vNormalized;
      varying vec3 vViewNormal;
      varying vec3 vViewPosition;
      varying float vFilmHeight;
      varying float vFilmCrest;
      float hash21(vec2 value) {
        value = fract(value * vec2(123.34, 456.21));
        value += dot(value, value + 45.32);
        return fract(value.x * value.y);
      }
      float noise21(vec2 value) {
        vec2 index = floor(value);
        vec2 fraction = fract(value);
        fraction = fraction * fraction * (3.0 - 2.0 * fraction);
        return mix(
          mix(hash21(index), hash21(index + vec2(1.0, 0.0)), fraction.x),
          mix(hash21(index + vec2(0.0, 1.0)), hash21(index + vec2(1.0, 1.0)), fraction.x),
          fraction.y
        );
      }
      float softPool(vec2 point, vec2 center, vec2 radius) {
        vec2 delta = (point - center) / radius;
        return exp(-dot(delta, delta));
      }
      void main() {
        vec3 surface = clamp(vNormalized, 0.0, 1.0);
        float wetOrder = clamp(
          (1.0 - surface.y) * 0.72
          + abs(surface.x - 0.5) * 0.16
          + abs(surface.z - 0.5) * 0.12,
          0.0,
          1.0
        );
        float wetTimeline = smoothstep(0.0, 0.3, uProgress) * 1.12;
        float wetFilm = 1.0 - smoothstep(wetTimeline - 0.035, wetTimeline + 0.08, wetOrder);
        float wetEdge = (1.0 - smoothstep(0.008, 0.075, abs(wetOrder - wetTimeline)))
          * (1.0 - smoothstep(0.3, 0.4, uProgress));
        float transport = smoothstep(0.18, 0.32, uProgress);
        float retentionBuild = smoothstep(0.5, 0.8, uProgress);
        float stabilized = smoothstep(0.82, 1.0, uProgress);

        vec2 surfacePlane = vec2(
          clamp(surface.x * 0.72 + surface.z * 0.28, 0.0, 1.0),
          surface.y
        );
        float schemeShift = (uScheme - 1.0) * 0.055;
        float poolA = softPool(surfacePlane, vec2(0.72 + schemeShift, 0.42), vec2(0.18, 0.15));
        float poolB = softPool(surfacePlane, vec2(0.38 - schemeShift * 0.6, 0.62), vec2(0.14, 0.12));
        float poolC = softPool(surfacePlane, vec2(0.56 + schemeShift * 0.35, 0.28), vec2(0.11, 0.09));
        float poolField = clamp(poolA * 0.82 + poolB * (0.4 + uScheme * 0.08) + poolC * 0.36, 0.0, 1.0);
        float retained = clamp(vFluid * uRetention * 0.72 + poolField * uRetention * 0.42, 0.0, 1.0);

        float motionRate = mix(1.0, 0.42, uStabilize) * uMotion;
        float activeVelocity = mix(0.9, uVelocity, uCandidate);
        float flowTime = uTime * activeVelocity * motionRate;
        float broadNoise = noise21(vec2(surfacePlane.x * 5.4 - flowTime * 0.2, surfacePlane.y * 5.1 + flowTime * 0.09));
        float fineNoise = noise21(vec2(surfacePlane.x * 12.0 + flowTime * 0.13, surfacePlane.y * 10.0 - flowTime * 0.21));
        float longitudinal = wetOrder * 1.62
          + surfacePlane.x * 0.18
          + (broadNoise - 0.5) * 0.13
          + sin(surfacePlane.x * 10.0 + surface.z * 5.0 - flowTime * 0.8) * 0.025;
        float slowedTime = flowTime * mix(1.0, 0.48, retained);
        float pulseA = fract(longitudinal * 0.92 - slowedTime * 0.54);
        float pulseB = fract(longitudinal * 0.86 - slowedTime * 0.47 + 0.34 + uScheme * 0.11);
        float pulseC = fract(longitudinal * 0.78 - slowedTime * 0.41 + 0.68 - uScheme * 0.08);
        float trainA = smoothstep(0.03, 0.13, pulseA) * (1.0 - smoothstep(0.58, 0.9, pulseA));
        float trainB = smoothstep(0.04, 0.16, pulseB) * (1.0 - smoothstep(0.55, 0.88, pulseB));
        float trainC = smoothstep(0.05, 0.18, pulseC) * (1.0 - smoothstep(0.5, 0.84, pulseC));

        float readabilityWidth = mix(1.0, 1.24, clamp(uReadability - 1.0, 0.0, 1.0));
        float hydrodynamicWidth = clamp(0.88 + uRetention * 0.22 - uExchange * 0.09, 0.82, 1.12);
        float visualWidth = readabilityWidth * hydrodynamicWidth;
        float centerA = 0.27 + sin(longitudinal * 7.5 - flowTime * 1.35 + uScheme * 0.7) * (0.055 + uExchange * 0.012);
        float centerB = 0.51 + sin(longitudinal * 6.1 - flowTime * 1.12 + 1.8 - uScheme * 0.45) * 0.075;
        float centerC = 0.75 + sin(longitudinal * 7.0 - flowTime * 1.24 + 3.7 + uScheme * 0.38) * (0.045 + uRetention * 0.018);
        float ribbonA = exp(-pow((surfacePlane.x - centerA) / (0.11 * visualWidth), 2.0));
        float ribbonB = exp(-pow((surfacePlane.x - centerB) / (0.125 * visualWidth), 2.0));
        float ribbonC = exp(-pow((surfacePlane.x - centerC) / (0.105 * visualWidth), 2.0));
        float splitGate = smoothstep(0.25, 0.58, surface.y) * (1.0 - smoothstep(0.78, 0.97, surface.y));
        float mergeBridge = exp(-pow((surfacePlane.x - mix(centerA, centerB, 0.5)) / (0.17 * visualWidth), 2.0))
          * sin(longitudinal * 5.4 - flowTime * 1.6) * 0.5 + 0.5;
        float movingRibbons = max(ribbonA * trainA, max(ribbonB * trainB, ribbonC * trainC));
        movingRibbons = max(movingRibbons, mergeBridge * splitGate * trainB * 0.52);
        movingRibbons *= transport * mix(1.0, 0.82, stabilized) * wetFilm;

        vec2 vortexPoint = surfacePlane - vec2(0.7 + schemeShift, 0.43);
        float vortexRadius = length(vortexPoint);
        float vortexAngle = atan(vortexPoint.y, vortexPoint.x) / 6.2831853;
        float vortexPhase = fract(vortexAngle + vortexRadius * 3.1 - flowTime * (0.22 + uRetention * 0.08));
        float vortexRibbon = smoothstep(0.04, 0.18, vortexPhase)
          * (1.0 - smoothstep(0.48, 0.8, vortexPhase))
          * (1.0 - smoothstep(0.05, 0.25, vortexRadius))
          * retained
          * retentionBuild
          * wetFilm;

        float exchangeThreads = pow(
          max(0.0, sin((surface.x + surface.z * 0.42) * 72.0 + surface.y * 39.0 - flowTime * 4.8)),
          10.0
        ) * uExchange * uCandidate * transport * (1.0 - retained * 0.58);
        float poolBreath = retained * retentionBuild
          * (0.82 + sin(flowTime * 1.5 + poolField * 6.0 + uScheme) * 0.18);
        float thicknessRipple = (fineNoise - 0.5) * 0.22
          + sin(flowTime * 1.1 + retained * 8.0) * retained * 0.1;
        float filmThickness = clamp(0.3 + poolBreath * 0.62 + thicknessRipple, 0.14, 1.0);

        float normalWaveA = sin(longitudinal * 34.0 - flowTime * 3.6 + surfacePlane.x * 8.0);
        float normalWaveB = cos(surfacePlane.x * 29.0 + flowTime * 2.7 + retained * 6.0);
        float opticalActivity = wetFilm * (0.03 + movingRibbons * 0.11 + poolBreath * 0.055);
        vec2 heightGradient = vec2(dFdx(vFilmHeight), dFdy(vFilmHeight));
        vec3 filmNormal = normalize(
          vViewNormal
          + vec3(normalWaveA, normalWaveB, 0.0) * opticalActivity
          + vec3(-heightGradient.x, -heightGradient.y, 0.0) * 28.0
        );
        vec3 viewDirection = normalize(-vViewPosition);
        float facing = max(0.0, dot(filmNormal, viewDirection));
        float fresnel = pow(1.0 - facing, 2.1);
        vec3 lightDirection = normalize(vec3(-0.3, 0.62, 0.72));
        vec3 halfDirection = normalize(lightDirection + viewDirection);
        float specular = pow(max(0.0, dot(filmNormal, halfDirection)), mix(38.0, 25.0, vFilmCrest))
          * (0.42 + movingRibbons * 0.78 + vFilmCrest * 0.72 + wetEdge * 0.7);
        float caustic = pow(max(0.0, sin(
          longitudinal * 24.0
          + surfacePlane.x * 18.0
          - flowTime * 4.2
          + broadNoise * 3.0
        )), 9.0) * movingRibbons;
        float softLight = 0.69 + max(0.0, dot(filmNormal, lightDirection)) * 0.34;

        vec3 deepFilm = vec3(0.075, 0.29, 0.31);
        vec3 clearFilm = vec3(0.34, 0.74, 0.69);
        vec3 dyeColor = vec3(0.76, 1.0, 0.92);
        float visibleThickness = smoothstep(0.007, 0.038, vFilmHeight);
        vec3 color = mix(deepFilm, clearFilm, 0.38 + movingRibbons * 0.42 + (1.0 - retained) * 0.1) * softLight;
        color = mix(color, vec3(0.09, 0.32, 0.34), visibleThickness * 0.22 + poolBreath * 0.22);
        color += dyeColor * movingRibbons * 0.64;
        color += vec3(0.62, 0.94, 0.88) * visibleThickness * 0.16;
        color += vec3(0.82, 1.0, 0.95) * vFilmCrest * (0.18 + specular * 0.42);
        color += dyeColor * wetEdge * 0.85;
        color += vec3(0.56, 0.96, 0.86) * exchangeThreads * 0.42;
        color += vec3(0.7, 1.0, 0.94) * (specular * 0.66 + caustic * 0.34);
        color += vec3(0.27, 0.62, 0.61) * fresnel * 0.24;
        float alpha = wetFilm * (
          0.09
          + filmThickness * 0.085
          + visibleThickness * 0.075
          + vFilmCrest * 0.065
          + movingRibbons * 0.19
          + poolBreath * 0.06
          + fresnel * 0.055
          + exchangeThreads * 0.075
          + caustic * 0.08
        ) + wetEdge * 0.38;
        alpha *= uOpacity * uReadability;
        alpha = min(alpha, 0.62);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function configureThinFilmFlowBounds(material: THREE.ShaderMaterial, bounds: THREE.Box3) {
  material.uniforms.uBoundsMin.value.copy(bounds.min);
  material.uniforms.uBoundsSize.value.copy(bounds.getSize(new THREE.Vector3()));
}

function configureThinFilmFlowResponse(
  material: THREE.ShaderMaterial,
  response: {
    candidate: number;
    velocity: number;
    retention: number;
    exchange: number;
    stabilize?: number;
    motion?: number;
    readability?: number;
    scheme?: number;
  },
) {
  material.uniforms.uCandidate.value = response.candidate;
  material.uniforms.uVelocity.value = response.velocity;
  material.uniforms.uRetention.value = response.retention;
  material.uniforms.uExchange.value = response.exchange;
  material.uniforms.uStabilize.value = response.stabilize ?? 0;
  material.uniforms.uMotion.value = response.motion ?? 1;
  material.uniforms.uReadability.value = response.readability ?? 1;
  material.uniforms.uScheme.value = response.scheme ?? 0;
}

function createBioFilmMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uRecalculation: { value: 0 },
    },
    vertexShader: `
      attribute float aBio;
      attribute float aFieldOrder;
      uniform float uRecalculation;
      varying float vRisk;
      varying float vSeed;
      varying vec3 vPosition;
      void main() {
        vRisk = aBio * mix(1.0, 0.64, uRecalculation);
        vSeed = aFieldOrder;
        vPosition = position;
        vec3 filmPosition = position + normal * (0.009 + aBio * 0.007);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(filmPosition, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uProgress;
      uniform float uTime;
      varying float vRisk;
      varying float vSeed;
      varying vec3 vPosition;
      float hash21(vec2 value) {
        value = fract(value * vec2(123.34, 345.45));
        value += dot(value, value + 34.345);
        return fract(value.x * value.y);
      }
      void main() {
        float conditioningTimeline = clamp(uProgress / 0.22, 0.0, 1.0);
        float conditioningFilm = smoothstep(vSeed - 0.24, vSeed + 0.08, conditioningTimeline) * (0.28 + vRisk * 0.24);
        float adsorptionTimeline = smoothstep(0.18, 0.44, uProgress);
        float adsorption = smoothstep(vSeed - 0.28, vSeed + 0.08, adsorptionTimeline) * smoothstep(0.28, 0.76, vRisk);
        float cellNoise = hash21(floor(vPosition.xy * 72.0));
        float nuclei = smoothstep(0.82, 0.96, cellNoise) * smoothstep(0.4, 0.66, uProgress) * vRisk;
        float networkA = abs(sin(vPosition.x * 29.0 + vPosition.y * 17.0));
        float networkB = abs(sin(vPosition.x * 16.0 - vPosition.y * 31.0));
        float network = (1.0 - smoothstep(0.0, 0.075, min(networkA, networkB))) * smoothstep(0.7, 0.96, uProgress) * vRisk;
        float growthEdge = (1.0 - smoothstep(0.0, 0.06, abs(vSeed - uProgress))) * (1.0 - smoothstep(0.91, 1.0, uProgress));
        if (conditioningFilm + adsorption + nuclei + network < 0.008) discard;
        vec3 film = mix(vec3(0.24, 0.26, 0.34), vec3(0.63, 0.46, 0.78), vRisk);
        film += nuclei * vec3(0.38, 0.2, 0.08);
        film += network * vec3(0.26, 0.13, 0.38);
        film += growthEdge * vec3(0.76, 0.66, 0.92) * 0.52;
        float breathing = 0.94 + sin(uTime * 1.1 + vSeed * 16.0) * 0.06;
        float alpha = (conditioningFilm * 0.055 + adsorption * 0.16 + nuclei * 0.34 + network * 0.3 + growthEdge * 0.14) * breathing * uOpacity;
        gl_FragColor = vec4(film, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  });
}

function createSimulationBoundaryRig(surface: SurfaceProjectionIndex): SimulationBoundaryRig {
  const group = new THREE.Group();
  group.name = "simulation-boundary-conditions";
  const contactPatches: OcclusalContactPatch[] = [];
  const supports: THREE.Mesh[] = [];
  const supportMaterials: THREE.Material[] = [];
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const shellSize = surface.size;
  const shellGeometry = new THREE.PlaneGeometry(shellSize.x * 0.84, shellSize.y * 0.54, 38, 28);
  const shellPositions = shellGeometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < shellPositions.count; index++) {
    const normalizedX = shellPositions.getX(index) / (shellSize.x * 0.84) + 0.5;
    const normalizedY = shellPositions.getY(index) / (shellSize.y * 0.54) + 0.5;
    const cuspA = Math.exp(-(((normalizedX - 0.26) / 0.17) ** 2 + ((normalizedY - 0.66) / 0.2) ** 2));
    const cuspB = Math.exp(-(((normalizedX - 0.53) / 0.19) ** 2 + ((normalizedY - 0.7) / 0.18) ** 2));
    const cuspC = Math.exp(-(((normalizedX - 0.76) / 0.16) ** 2 + ((normalizedY - 0.55) / 0.2) ** 2));
    const marginalRidge = Math.exp(-Math.pow((normalizedY - 0.18) / 0.18, 2)) * 0.035;
    shellPositions.setZ(index, -(cuspA * 0.11 + cuspB * 0.135 + cuspC * 0.095 + marginalRidge));
  }
  shellPositions.needsUpdate = true;
  shellGeometry.computeVertexNormals();
  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc8d7d1,
    emissive: 0x345049,
    emissiveIntensity: 0.08,
    roughness: 0.3,
    metalness: 0.02,
    transmission: 0.24,
    thickness: 0.08,
    clearcoat: 0.58,
    clearcoatRoughness: 0.22,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shellWireMaterial = new THREE.MeshBasicMaterial({
    color: 0xa8dbcf,
    wireframe: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const occlusalShell = new THREE.Group();
  occlusalShell.name = "anatomical-occlusal-boundary";
  const shellLayers: OcclusalShellLayer[] = [];
  const captureBaseZ = (geometry: THREE.PlaneGeometry) => {
    const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    const values = new Float32Array(attribute.count);
    for (let index = 0; index < attribute.count; index++) values[index] = attribute.getZ(index);
    return values;
  };
  const mainShell = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(shellGeometry, shellMaterial);
  mainShell.renderOrder = 5;
  occlusalShell.add(mainShell);
  shellLayers.push({
    mesh: mainShell,
    baseZ: captureBaseZ(shellGeometry),
    phase: 0,
    amplitude: 0.0065,
    offset: 0,
    opacity: 0.24,
  });
  [
    { color: 0xaed6cd, phase: 0.42, amplitude: 0.0085, offset: 0.034, opacity: 0.085 },
    { color: 0x8fbdb3, phase: 0.84, amplitude: 0.0105, offset: 0.066, opacity: 0.052 },
    { color: 0x769f97, phase: 1.26, amplitude: 0.012, offset: 0.098, opacity: 0.03 },
  ].forEach((definition, index) => {
    const ghostGeometry = shellGeometry.clone();
    const ghostMaterial = new THREE.MeshBasicMaterial({
      color: definition.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ghostMesh = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(ghostGeometry, ghostMaterial);
    ghostMesh.position.z = definition.offset;
    ghostMesh.renderOrder = 4 - index;
    occlusalShell.add(ghostMesh);
    shellLayers.push({
      mesh: ghostMesh,
      baseZ: captureBaseZ(ghostGeometry),
      phase: definition.phase,
      amplitude: definition.amplitude,
      offset: definition.offset,
      opacity: definition.opacity,
    });
  });
  const shellWire = new THREE.Mesh(shellGeometry, shellWireMaterial);
  shellWire.scale.setScalar(1.002);
  occlusalShell.add(shellWire);
  const shellStartZ = surface.bounds.max.z + 0.52;
  const shellTargetZ = surface.bounds.max.z + 0.16;
  occlusalShell.position.set(
    surface.bounds.getCenter(new THREE.Vector3()).x,
    surface.bounds.min.y + shellSize.y * 0.69,
    shellStartZ,
  );
  occlusalShell.scale.setScalar(0.001);
  group.add(occlusalShell);

  const contactCoordinates = [
    [0.23, 0.73, 1, 0], [0.34, 0.82, 0.82, 0.08], [0.46, 0.7, 0.72, 0.16],
    [0.55, 0.84, 1, 0.22], [0.65, 0.72, 0.74, 0.3], [0.76, 0.77, 0.88, 0.38],
    [0.29, 0.58, 0.58, 0.46], [0.43, 0.6, 0.66, 0.53], [0.61, 0.58, 0.62, 0.6],
    [0.72, 0.52, 0.5, 0.67], [0.51, 0.49, 0.44, 0.74],
  ];
  contactCoordinates.forEach(([normalizedX, normalizedY, strength, delay], index) => {
    if (!projectSurfacePoint(normalizedX, normalizedY, surface, position, normal)) return;
    const patchMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uStrength: { value: strength },
        uPulse: { value: 0 },
        uSeed: { value: index * 1.73 },
        uCandidate: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uOpacity;
        uniform float uStrength;
        uniform float uPulse;
        uniform float uSeed;
        uniform float uCandidate;
        varying vec2 vUv;
        void main(){
          vec2 point=(vUv-0.5)*2.0;
          float angle=atan(point.y,point.x);
          float irregular=0.82+sin(angle*3.0+uSeed)*0.075+sin(angle*5.0-uSeed*0.7)*0.045;
          float distanceToCenter=length(point);
          float body=1.0-smoothstep(irregular-0.13,irregular,distanceToCenter);
          float rim=1.0-smoothstep(0.0,0.08,abs(distanceToCenter-irregular*mix(0.3,0.82,uPulse)));
          if(body+rim<0.008) discard;
          vec3 base=mix(vec3(1.0,0.31,0.2),vec3(0.45,0.9,0.79),uCandidate);
          vec3 color=mix(base*0.54,base,1.0-distanceToCenter*0.58)+rim*vec3(1.0,0.78,0.64)*0.44;
          gl_FragColor=vec4(color,(body*0.42+rim*0.54)*uOpacity*uStrength);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 52), patchMaterial);
    patch.position.copy(position).addScaledVector(normal, 0.031 + index * 0.0004);
    patch.quaternion.setFromUnitVectors(zAxis, normal);
    const baseScale = new THREE.Vector3(
      0.055 + strength * 0.026,
      (0.038 + strength * 0.018) * (index % 2 ? 1.2 : 0.86),
      1,
    );
    patch.scale.setScalar(0.001);
    patch.renderOrder = 7;
    group.add(patch);
    contactPatches.push({ mesh: patch, delay, strength, baseScale });
  });

  [0.22, 0.4, 0.6, 0.78].forEach((normalizedX) => {
    if (!projectSurfacePoint(normalizedX, 0.1, surface, position, normal)) return;
    const material = new THREE.MeshBasicMaterial({ color: 0x7bd8c4, transparent: true, opacity: 0, depthWrite: false });
    const support = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.095), material);
    support.position.copy(position).addScaledVector(normal, 0.02);
    support.quaternion.setFromUnitVectors(zAxis, normal);
    support.scale.setScalar(0.001);
    group.add(support);
    supports.push(support);
    supportMaterials.push(material);
  });
  group.visible = false;
  return {
    group,
    occlusalShell,
    shellStartZ,
    shellTargetZ,
    shellLayers,
    shellWireMaterial,
    contactPatches,
    supports,
    supportMaterials,
  };
}

function createMechanicsFieldRig(surface: SurfaceProjectionIndex, source: THREE.BufferGeometry): MechanicsFieldRig {
  const group = new THREE.Group();
  group.name = "mechanics-principal-stress-rig";
  const stressLines: Array<THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>> = [];
  const projectedPosition = new THREE.Vector3();
  const projectedNormal = new THREE.Vector3();
  const contacts = [[0.23, 0.73], [0.34, 0.82], [0.55, 0.84], [0.65, 0.72], [0.76, 0.77], [0.43, 0.6]];
  contacts.forEach(([contactX, contactY], contactIndex) => {
    [-1, 0, 1].forEach((direction, directionIndex) => {
      const points: THREE.Vector3[] = [];
      for (let sample = 0; sample < 86; sample++) {
        const t = sample / 85;
        const normalizedY = contactY - t * (0.42 + (contactIndex % 3) * 0.035);
        const fan = Math.sin(t * Math.PI) * direction * (0.085 + directionIndex * 0.012);
        const normalizedX = contactX + fan + Math.sin(t * Math.PI * 2 + contactIndex) * 0.014;
        if (!projectSurfacePoint(normalizedX, normalizedY, surface, projectedPosition, projectedNormal)) continue;
        points.push(projectedPosition.clone().addScaledVector(projectedNormal, 0.03));
      }
      if (points.length < 2) return;
      const material = new THREE.LineBasicMaterial({ color: direction === 0 ? 0xffa07f : 0xff7252, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      geometry.setDrawRange(0, 0);
      const line = new THREE.Line(geometry, material);
      group.add(line);
      stressLines.push(line);
    });
  });

  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const stress = source.getAttribute("aStress") as THREE.BufferAttribute;
  const displacementSegments: number[] = [];
  const stride = Math.max(1, Math.floor(position.count / 240));
  for (let index = 0; index < position.count; index += stride) {
    const stressValue = stress.getX(index);
    if (stressValue < 0.34 || normal.getZ(index) < 0.08) continue;
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const normalX = normal.getX(index);
    const normalY = normal.getY(index);
    const normalZ = normal.getZ(index);
    displacementSegments.push(
      x + normalX * 0.014, y + normalY * 0.014, z + normalZ * 0.014,
      x - normalX * stressValue * 0.034, y - normalY * stressValue * 0.034, z - normalZ * stressValue * 0.034,
    );
  }
  const displacementGeometry = new THREE.BufferGeometry();
  displacementGeometry.setAttribute("position", new THREE.Float32BufferAttribute(displacementSegments, 3));
  const displacementMaterial = new THREE.LineBasicMaterial({ color: 0xf2fff9, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  group.add(new THREE.LineSegments(displacementGeometry, displacementMaterial));

  const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xb8d8d0, transparent: true, opacity: 0, wireframe: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const ghost = new THREE.Mesh(source, ghostMaterial);
  ghost.scale.setScalar(1.0015);
  group.add(ghost);
  group.visible = false;
  return { group, stressLines, displacementMaterial, ghostMaterial };
}

function createBioNetworkRig(surface: SurfaceProjectionIndex): BioNetworkRig {
  const group = new THREE.Group();
  group.name = "microecology-colonization-network";
  const branches: Array<THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>> = [];
  const projectedPosition = new THREE.Vector3();
  const projectedNormal = new THREE.Vector3();
  const colonies = [
    { center: [0.69, 0.39], spread: [0.19, 0.13], branches: 7 },
    { center: [0.42, 0.58], spread: [0.14, 0.1], branches: 5 },
  ];
  colonies.forEach((colony, colonyIndex) => {
    for (let branchIndex = 0; branchIndex < colony.branches; branchIndex++) {
      const points: THREE.Vector3[] = [];
      const heading = branchIndex / colony.branches * Math.PI * 2 + colonyIndex * 0.36;
      for (let sample = 0; sample < 62; sample++) {
        const t = sample / 61;
        const fork = Math.sin(t * Math.PI * (1.5 + branchIndex % 3) + branchIndex) * 0.012 * t;
        const normalizedX = colony.center[0]
          + Math.cos(heading) * colony.spread[0] * t
          + Math.cos(heading + Math.PI * 0.5) * fork;
        const normalizedY = colony.center[1]
          + Math.sin(heading) * colony.spread[1] * t
          + Math.sin(heading + Math.PI * 0.5) * fork;
        if (!projectSurfacePoint(normalizedX, normalizedY, surface, projectedPosition, projectedNormal)) continue;
        points.push(projectedPosition.clone().addScaledVector(projectedNormal, 0.032 + colonyIndex * 0.003));
      }
      if (points.length < 6) continue;
      const material = new THREE.LineBasicMaterial({
        color: colonyIndex === 0 ? 0xc6a3ef : 0xa579d3,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      geometry.setDrawRange(0, 0);
      const branch = new THREE.Line(geometry, material);
      group.add(branch);
      branches.push(branch);
    }
  });
  group.visible = false;
  return { group, branches };
}

function createBioEntityRig(source: THREE.BufferGeometry): BioEntityRig {
  const group = new THREE.Group();
  group.name = "microecology-physical-entities";
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const risk = source.getAttribute("aBio") as THREE.BufferAttribute;
  const candidates: BioEntitySample[] = [];
  const stride = Math.max(1, Math.floor(position.count / 1200));
  for (let index = 0; index < position.count; index += stride) {
    const riskValue = risk.getX(index);
    if (riskValue < 0.43 || normal.getZ(index) < 0.08) continue;
    const seed = Math.sin(index * 12.9898) * 43758.5453;
    candidates.push({
      position: new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)),
      normal: new THREE.Vector3(normal.getX(index), normal.getY(index), normal.getZ(index)).normalize(),
      risk: riskValue,
      seed: seed - Math.floor(seed),
    });
  }
  candidates.sort((a, b) => b.risk + b.seed * 0.08 - a.risk - a.seed * 0.08);
  const nucleiSamples = candidates.filter((_, index) => index % 2 === 0).slice(0, 72);
  const cellSamples = candidates.filter((_, index) => index % 3 !== 0).slice(0, 86);
  const nucleiMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc9a875,
    emissive: 0x5a3820,
    emissiveIntensity: 0.24,
    roughness: 0.3,
    metalness: 0.16,
    clearcoat: 0.3,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const cellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x9a75bc,
    emissive: 0x33203f,
    emissiveIntensity: 0.28,
    roughness: 0.4,
    metalness: 0.02,
    clearcoat: 0.48,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const nuclei = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.018, 1), nucleiMaterial, nucleiSamples.length);
  const cells = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 12, 8), cellMaterial, cellSamples.length);
  nuclei.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nuclei.renderOrder = 7;
  cells.renderOrder = 8;
  group.add(nuclei, cells);
  group.visible = false;
  return { group, nuclei, cells, nucleiSamples, cellSamples };
}

function createFusionLayerMaterial(weights: THREE.Vector3, color: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uWeights: { value: weights },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uSeparation: { value: 0 },
      uTime: { value: 0 },
      uAlign: { value: 0 },
      uConflict: { value: 0 },
      uConverge: { value: 0 },
    },
    vertexShader: `
      attribute float aStress;
      attribute float aFluid;
      attribute float aBio;
      attribute float aFieldOrder;
      uniform vec3 uWeights;
      uniform float uSeparation;
      uniform float uAlign;
      varying float vValue;
      varying float vOrder;
      varying vec3 vNormal;
      void main() {
        vValue = dot(vec3(aStress, aFluid, aBio), uWeights);
        vOrder = aFieldOrder;
        vNormal = normalize(normalMatrix * normal);
        float surfaceBreath = sin(aFieldOrder * 19.0) * 0.004 * uAlign;
        vec3 displaced = position + normal * (uSeparation + surfaceBreath);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uProgress;
      uniform float uTime;
      uniform float uConflict;
      uniform float uConverge;
      varying float vValue;
      varying float vOrder;
      varying vec3 vNormal;
      void main() {
        float reveal = smoothstep(vOrder - 0.13, vOrder + 0.04, uProgress);
        float contour = 1.0 - smoothstep(0.035, 0.105, abs(fract(vValue * 10.0 - uTime * 0.026) - 0.5));
        float fresnel = pow(1.0 - abs(vNormal.z), 2.2);
        float intensity = smoothstep(0.24, 0.9, vValue);
        float interference = pow(0.5 + 0.5 * sin(vValue * 44.0 + vOrder * 31.0 - uTime * 3.4), 3.0) * uConflict;
        if (reveal * intensity < 0.008) discard;
        vec3 color = uColor * (0.72 + intensity * 0.45) + contour * vec3(0.35, 0.48, 0.45);
        color += interference * vec3(1.0, 0.72, 0.44) * 0.62;
        color = mix(color, vec3(0.72, 1.0, 0.92), uConverge * contour * 0.34);
        float alpha = reveal * intensity * (0.075 + contour * 0.17 + fresnel * 0.07 + interference * 0.16) * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

function createFusionConstraintMaterial(color: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uSeparation: { value: 0.1 },
      uAlign: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute vec3 aSurfaceNormal;
      attribute float aEndpoint;
      attribute float aOrder;
      uniform float uSeparation;
      uniform float uAlign;
      varying float vEndpoint;
      varying float vOrder;
      void main() {
        vEndpoint = aEndpoint;
        vOrder = aOrder;
        float tether = uSeparation * aEndpoint * (1.0 - uAlign * 0.16);
        vec3 displaced = position + aSurfaceNormal * tether;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uAlign;
      uniform float uTime;
      varying float vEndpoint;
      varying float vOrder;
      void main() {
        float directionalPulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(vEndpoint * 8.0 - uTime * 5.2 + vOrder * 11.0), 4.0);
        vec3 color = mix(uColor * 0.62, vec3(0.83, 1.0, 0.95), vEndpoint * uAlign);
        gl_FragColor = vec4(color, uOpacity * (0.22 + directionalPulse * 0.62));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createFusionConstraintGeometry(source: THREE.BufferGeometry, attributeName: string, density: number) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const value = source.getAttribute(attributeName) as THREE.BufferAttribute;
  const order = source.getAttribute("aFieldOrder") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / Math.max(80, 280 * density)));
  const positions: number[] = [];
  const normals: number[] = [];
  const endpoints: number[] = [];
  const orders: number[] = [];
  for (let index = 0; index < position.count; index += stride) {
    if (value.getX(index) < 0.5 || normal.getZ(index) < 0.08) continue;
    const point = [position.getX(index), position.getY(index), position.getZ(index)];
    const direction = [normal.getX(index), normal.getY(index), normal.getZ(index)];
    positions.push(...point, ...point);
    normals.push(...direction, ...direction);
    endpoints.push(0, 1);
    orders.push(order.getX(index), order.getX(index));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aSurfaceNormal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("aEndpoint", new THREE.Float32BufferAttribute(endpoints, 1));
  geometry.setAttribute("aOrder", new THREE.Float32BufferAttribute(orders, 1));
  return geometry;
}

function createIsoContourGeometry(source: THREE.BufferGeometry, attributeName: string, levels: number[], density: number) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const scalar = source.getAttribute(attributeName) as THREE.BufferAttribute;
  const positions: number[] = [];
  const triangleStride = Math.max(1, Math.round(1 / Math.max(0.2, density)));
  const interpolateEdge = (start: number, end: number, level: number) => {
    const startValue = scalar.getX(start);
    const endValue = scalar.getX(end);
    if ((startValue - level) * (endValue - level) > 0 || Math.abs(endValue - startValue) < 0.00001) return null;
    const mix = THREE.MathUtils.clamp((level - startValue) / (endValue - startValue), 0, 1);
    const normalX = THREE.MathUtils.lerp(normal.getX(start), normal.getX(end), mix);
    const normalY = THREE.MathUtils.lerp(normal.getY(start), normal.getY(end), mix);
    const normalZ = THREE.MathUtils.lerp(normal.getZ(start), normal.getZ(end), mix);
    const inverseLength = 1 / Math.max(0.0001, Math.hypot(normalX, normalY, normalZ));
    const lift = 0.014;
    return new THREE.Vector3(
      THREE.MathUtils.lerp(position.getX(start), position.getX(end), mix) + normalX * inverseLength * lift,
      THREE.MathUtils.lerp(position.getY(start), position.getY(end), mix) + normalY * inverseLength * lift,
      THREE.MathUtils.lerp(position.getZ(start), position.getZ(end), mix) + normalZ * inverseLength * lift,
    );
  };
  for (let triangle = 0; triangle < position.count; triangle += 3 * triangleStride) {
    for (const level of levels) {
      const intersections = [
        interpolateEdge(triangle, triangle + 1, level),
        interpolateEdge(triangle + 1, triangle + 2, level),
        interpolateEdge(triangle + 2, triangle, level),
      ].filter((point): point is THREE.Vector3 => Boolean(point));
      if (intersections.length < 2) continue;
      positions.push(...intersections[0].toArray(), ...intersections[1].toArray());
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  return geometry;
}

function createFusionConflictGeometry(source: THREE.BufferGeometry, density: number) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const stress = source.getAttribute("aStress") as THREE.BufferAttribute;
  const fluid = source.getAttribute("aFluid") as THREE.BufferAttribute;
  const bio = source.getAttribute("aBio") as THREE.BufferAttribute;
  const order = source.getAttribute("aFieldOrder") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / Math.max(110, 520 * density)));
  const positions: number[] = [];
  const conflicts: number[] = [];
  const orders: number[] = [];
  for (let index = 0; index < position.count; index += stride) {
    const values = [stress.getX(index), fluid.getX(index), bio.getX(index)].sort((a, b) => b - a);
    const conflict = THREE.MathUtils.clamp((values[1] - 0.32) * 1.8, 0, 1)
      * THREE.MathUtils.clamp(1 - (values[0] - values[1]) / 0.28, 0, 1);
    if (conflict < 0.18 || normal.getZ(index) < 0.04) continue;
    positions.push(
      position.getX(index) + normal.getX(index) * 0.022,
      position.getY(index) + normal.getY(index) * 0.022,
      position.getZ(index) + normal.getZ(index) * 0.022,
    );
    conflicts.push(conflict);
    orders.push(order.getX(index));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aConflict", new THREE.Float32BufferAttribute(conflicts, 1));
  geometry.setAttribute("aOrder", new THREE.Float32BufferAttribute(orders, 1));
  return geometry;
}

function createFusionConflictMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float aConflict;
      attribute float aOrder;
      uniform float uProgress;
      uniform float uTime;
      varying float vConflict;
      void main() {
        float reveal = smoothstep(aOrder - 0.2, aOrder + 0.08, uProgress);
        float pulse = 0.78 + sin(uTime * 4.8 + aOrder * 23.0) * 0.22;
        vConflict = aConflict * reveal;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (2.3 + aConflict * 5.2) * pulse * (5.8 / max(1.0, -viewPosition.z));
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying float vConflict;
      void main() {
        float radius = length(gl_PointCoord - 0.5);
        if (radius > 0.5 || vConflict < 0.01) discard;
        float ring = smoothstep(0.48, 0.24, radius) - smoothstep(0.2, 0.06, radius);
        float core = 1.0 - smoothstep(0.02, 0.19, radius);
        vec3 color = mix(vec3(1.0, 0.46, 0.26), vec3(1.0, 0.91, 0.66), core);
        gl_FragColor = vec4(color, (ring * 0.76 + core) * vConflict * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createFusionLayerRig(source: THREE.BufferGeometry, density = 1): FusionLayerRig {
  const group = new THREE.Group();
  group.name = "multiphysics-fusion-layers";
  const colors = [0xff8062, 0x75dac9, 0xa982d1];
  const attributes = ["aStress", "aFluid", "aBio"];
  const materials = [
    createFusionLayerMaterial(new THREE.Vector3(1, 0, 0), colors[0]),
    createFusionLayerMaterial(new THREE.Vector3(0, 1, 0), colors[1]),
    createFusionLayerMaterial(new THREE.Vector3(0, 0, 1), colors[2]),
  ];
  materials.forEach((material, index) => {
    const mesh = new THREE.Mesh(source, material);
    mesh.renderOrder = 4 + index;
    group.add(mesh);
  });
  const fieldContours = attributes.map((attributeName, index) => {
    const material = new THREE.LineBasicMaterial({ color: colors[index], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const line = new THREE.LineSegments(createIsoContourGeometry(source, attributeName, [0.46, 0.62, 0.78], density), material);
    line.renderOrder = 8;
    group.add(line);
    return line;
  });
  const constraintLines = attributes.map((attributeName, index) => {
    const line = new THREE.LineSegments(createFusionConstraintGeometry(source, attributeName, density), createFusionConstraintMaterial(colors[index]));
    line.renderOrder = 9;
    group.add(line);
    return line;
  });
  const conflictPoints = new THREE.Points(createFusionConflictGeometry(source, density), createFusionConflictMaterial());
  conflictPoints.renderOrder = 10;
  group.add(conflictPoints);
  const confidenceColors = [0xb9f6e7, 0xf0fffa];
  const confidenceLines = [
    new THREE.LineSegments(
      createIsoContourGeometry(source, "aFusion", [0.5, 0.62, 0.74, 0.84], density),
      new THREE.LineBasicMaterial({ color: confidenceColors[0], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
    new THREE.LineSegments(
      createIsoContourGeometry(source, "aFusion", [0.57, 0.69, 0.8], density * 0.82),
      new THREE.LineBasicMaterial({ color: confidenceColors[1], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    ),
  ];
  confidenceLines.forEach((line, index) => {
    line.renderOrder = 11 + index;
    group.add(line);
  });
  group.visible = false;
  return { group, materials, constraintLines, conflictPoints, fieldContours, confidenceLines };
}

function updateFusionLayerRig(
  rig: FusionLayerRig,
  progress: number,
  elapsed: number,
  opacity: number,
  reducedMotion: boolean,
) {
  const separation = reducedMotion ? 1 : ease(THREE.MathUtils.clamp(progress / 0.18, 0, 1));
  const alignment = reducedMotion ? 1 : ease(THREE.MathUtils.clamp((progress - 0.18) / 0.27, 0, 1));
  const conflictIn = reducedMotion ? 0 : ease(THREE.MathUtils.clamp((progress - 0.39) / 0.13, 0, 1));
  const conflictOut = reducedMotion ? 1 : ease(THREE.MathUtils.clamp((progress - 0.63) / 0.18, 0, 1));
  const conflict = conflictIn * (1 - conflictOut);
  const convergence = reducedMotion ? 1 : ease(THREE.MathUtils.clamp((progress - 0.68) / 0.32, 0, 1));
  const separations = [0.13, 0.085, 0.045];
  rig.group.visible = opacity > 0.008;
  rig.materials.forEach((material, layerIndex) => {
    const layerReveal = ease(THREE.MathUtils.clamp(progress * 1.2 - layerIndex * 0.075, 0, 1));
    const currentSeparation = separations[layerIndex] * separation * (1 - convergence);
    material.uniforms.uOpacity.value = opacity * layerReveal * (1 - convergence * 0.78);
    material.uniforms.uProgress.value = layerReveal;
    material.uniforms.uSeparation.value = currentSeparation;
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uAlign.value = alignment;
    material.uniforms.uConflict.value = conflict;
    material.uniforms.uConverge.value = convergence;

    const contour = rig.fieldContours[layerIndex];
    const contourCount = contour.geometry.getAttribute("position").count;
    const contourReveal = ease(THREE.MathUtils.clamp(separation * 1.14 - layerIndex * 0.08, 0, 1));
    contour.geometry.setDrawRange(0, Math.floor(contourCount * contourReveal / 2) * 2);
    contour.material.opacity = opacity * contourReveal * (0.42 + alignment * 0.2) * (1 - convergence * 0.72);

    const constraint = rig.constraintLines[layerIndex];
    constraint.material.uniforms.uOpacity.value = opacity * alignment * (0.34 + conflict * 0.46) * (1 - convergence * 0.72);
    constraint.material.uniforms.uSeparation.value = currentSeparation;
    constraint.material.uniforms.uAlign.value = alignment;
    constraint.material.uniforms.uTime.value = elapsed;
  });
  rig.conflictPoints.material.uniforms.uOpacity.value = opacity * conflict;
  rig.conflictPoints.material.uniforms.uProgress.value = alignment;
  rig.conflictPoints.material.uniforms.uTime.value = elapsed;
  rig.confidenceLines.forEach((line, index) => {
    const lineProgress = ease(THREE.MathUtils.clamp(convergence * 1.24 - index * 0.16, 0, 1));
    const count = line.geometry.getAttribute("position").count;
    line.geometry.setDrawRange(0, Math.floor(count * lineProgress / 2) * 2);
    line.material.opacity = opacity * lineProgress * (index ? 0.72 : 0.48);
  });
}

function createBioRiskMaterial(pixelRatio: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uRecalculation: { value: 0 },
    },
    vertexShader: `
      attribute float aRisk;
      attribute float aSeed;
      uniform float uProgress;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uRecalculation;
      varying float vAlpha;
      void main() {
        float reveal = smoothstep(aSeed - 0.12, aSeed + 0.035, uProgress);
        float pulse = 0.82 + sin(uTime * 2.7 + aSeed * 21.0) * 0.18;
        vAlpha = reveal * aRisk;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (1.2 + aRisk * 4.2) * pulse * mix(1.0, 0.72, uRecalculation) * uPixelRatio * (5.8 / max(1.0, -viewPosition.z));
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uRecalculation;
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - 0.5);
        if (radius > 0.5 || vAlpha < 0.01) discard;
        float core = 1.0 - smoothstep(0.08, 0.5, radius);
        vec3 color = mix(vec3(0.57, 0.42, 0.78), vec3(0.82, 0.66, 1.0), core);
        gl_FragColor = vec4(color, core * vAlpha * uOpacity * mix(1.0, 0.68, uRecalculation));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function createBioRiskGeometry(source: THREE.BufferGeometry) {
  const position = source.getAttribute("position") as THREE.BufferAttribute;
  const normal = source.getAttribute("normal") as THREE.BufferAttribute;
  const risk = source.getAttribute("aBio") as THREE.BufferAttribute;
  const stride = Math.max(1, Math.floor(position.count / 1800));
  const positions: number[] = [];
  const risks: number[] = [];
  const seeds: number[] = [];
  for (let index = 0; index < position.count; index += stride) {
    const value = risk.getX(index);
    if (value < 0.4 || normal.getZ(index) < 0.12) continue;
    positions.push(
      position.getX(index) + normal.getX(index) * 0.022,
      position.getY(index) + normal.getY(index) * 0.022,
      position.getZ(index) + normal.getZ(index) * 0.022,
    );
    risks.push(value);
    seeds.push(THREE.MathUtils.clamp((Math.sin(index * 0.017) * 0.5 + 0.5) * 0.74 + (1 - value) * 0.26, 0, 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aRisk", new THREE.Float32BufferAttribute(risks, 1));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  return geometry;
}

function createEnsembleSchemeRig(
  source: THREE.BufferGeometry,
  surface: SurfaceProjectionIndex,
  regions: RegionalTextureRegion[],
  modelUnitsPerUm: number,
  pixelRatio: number,
): EnsembleSchemeRig {
  const group = new THREE.Group();
  group.name = "parallel-scheme-model";
  const baseMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd6dfda,
    roughness: 0.34,
    metalness: 0.02,
    clearcoat: 0.44,
    clearcoatRoughness: 0.22,
    transparent: true,
    opacity: 0,
  });
  const hitMesh = new THREE.Mesh(source, baseMaterial);
  hitMesh.name = "scheme-surface-hit-target";
  group.add(hitMesh);
  const patchRig = createSurfacePatchRig(surface, regions, modelUnitsPerUm);
  group.add(patchRig.group);
  const simulationMaterial = createSimulationFieldMaterial();
  const simulationMesh = new THREE.Mesh(source, simulationMaterial);
  simulationMesh.scale.setScalar(1.006);
  simulationMesh.renderOrder = 4;
  group.add(simulationMesh);
  const fluidMaterial = createThinFilmFlowMaterial(surface.bounds);
  const fluidMesh = new THREE.Mesh(source, fluidMaterial);
  fluidMesh.renderOrder = 5;
  group.add(fluidMesh);
  const bioMaterial = createBioFilmMaterial();
  const bioMesh = new THREE.Mesh(source, bioMaterial);
  bioMesh.renderOrder = 6;
  group.add(bioMesh);
  const boundaryRig = createSimulationBoundaryRig(surface);
  group.add(boundaryRig.group);
  const mechanicsRig = createMechanicsFieldRig(surface, source);
  group.add(mechanicsRig.group);
  const bioNetworkRig = createBioNetworkRig(surface);
  group.add(bioNetworkRig.group);
  const bioRiskMaterial = createBioRiskMaterial(pixelRatio);
  const bioRiskPoints = new THREE.Points(createBioRiskGeometry(source), bioRiskMaterial);
  bioRiskPoints.renderOrder = 7;
  group.add(bioRiskPoints);
  const fusionRig = createFusionLayerRig(source, 0.42);
  group.add(fusionRig.group);
  group.visible = false;
  return {
    group,
    hitMesh,
    regions,
    baseMaterial,
    patchRig,
    simulationMaterial,
    fluidMaterial,
    bioMaterial,
    boundaryRig,
    mechanicsRig,
    bioNetworkRig,
    bioRiskMaterial,
    bioRiskPoints,
    fusionRig,
  };
}

function updateEnsembleSchemeRig(
  rig: EnsembleSchemeRig,
  schemeIndex: number,
  phase: DentalScenePhase,
  stageProgress: number,
  simulationField: SimulationField,
  simulationProgress: number,
  elapsed: number,
  opacity: number,
  reducedMotion: boolean,
  selectedSchemeIndex: number,
  focusRegionId?: string,
) {
  rig.baseMaterial.opacity = opacity;
  const designReveal = phase === "generate"
    ? ease(THREE.MathUtils.clamp((stageProgress - 0.1) / 0.3, 0, 1))
    : 1;
  const enabledRegions = rig.regions.filter((region) => region.enabled);
  rig.patchRig.group.visible = opacity > 0.01;
  rig.patchRig.patches.forEach((patch) => {
    const enabledOrder = enabledRegions.findIndex((region) => region.id === patch.regionId);
    const carveProgress = phase === "generate" && enabledOrder >= 0
      ? regionCarveProgress(rig.regions[patch.regionIndex], stageProgress, enabledOrder)
      : patch.enabled ? 1 : 0;
    patch.material.uniforms.uOpacity.value = patch.enabled ? opacity * 0.98 : 0;
    patch.material.uniforms.uReveal.value = designReveal;
    patch.material.uniforms.uCarve.value = carveProgress;
    patch.material.uniforms.uTime.value = elapsed;
    patch.material.uniforms.uFlow.value = simulationField === "fluid" ? 1 : 0;
    patch.material.uniforms.uFocus.value = !focusRegionId || patch.regionId === focusRegionId ? 1 : 0.24;
    patch.material.uniforms.uDecision.value = phase === "generate" ? (1 - designReveal) * 0.45 : 0;
  });

  const isRecalculation = phase === "recalculate";
  updateFusionLayerRig(
    rig.fusionRig,
    simulationField === "fusion" ? simulationProgress : 0,
    elapsed,
    simulationField === "fusion" ? opacity : 0,
    reducedMotion,
  );
  const fieldWeights = rig.simulationMaterial.uniforms.uWeights.value as THREE.Vector4;
  fieldWeights.set(
    simulationField === "mechanics" ? 1 : 0,
    0,
    0,
    simulationField === "fusion" ? 1 : 0,
  );
  const mechanicsReduction = [0.84, 0.36, 1.28][schemeIndex];
  rig.simulationMaterial.uniforms.uOpacity.value = opacity * Number(simulationField === "mechanics" || simulationField === "fusion");
  rig.simulationMaterial.uniforms.uProgress.value = simulationProgress;
  rig.simulationMaterial.uniforms.uTime.value = elapsed;
  rig.simulationMaterial.uniforms.uRecalculation.value = isRecalculation ? mechanicsReduction : 0;
  rig.simulationMaterial.uniforms.uDeform.value = simulationField === "mechanics" && !reducedMotion
    ? ease(THREE.MathUtils.clamp((simulationProgress - 0.25) / 0.45, 0, 1)) * [0.56, 0.72, 0.44][schemeIndex]
    : 0;

  const mechanicsActive = simulationField === "mechanics" ? opacity : 0;
  rig.boundaryRig.group.visible = mechanicsActive > 0.01;
  rig.mechanicsRig.group.visible = mechanicsActive > 0.01;
  if (mechanicsActive > 0.01) {
    const shellReveal = ease(THREE.MathUtils.clamp(simulationProgress / 0.12, 0, 1));
    const shellArrival = ease(THREE.MathUtils.clamp((simulationProgress - 0.08) / 0.25, 0, 1));
    const loadRamp = ease(THREE.MathUtils.clamp((simulationProgress - 0.28) / 0.34, 0, 1));
    rig.boundaryRig.occlusalShell.scale.setScalar(Math.max(0.001, shellReveal));
    rig.boundaryRig.occlusalShell.position.z = THREE.MathUtils.lerp(rig.boundaryRig.shellStartZ, rig.boundaryRig.shellTargetZ - loadRamp * 0.016, shellArrival);
    rig.boundaryRig.shellLayers.forEach((layer, layerIndex) => {
      layer.mesh.material.opacity = mechanicsActive * shellReveal * layer.opacity * (layerIndex ? loadRamp : 1);
    });
    rig.boundaryRig.shellWireMaterial.opacity = mechanicsActive * shellReveal * 0.09;
    rig.boundaryRig.supportMaterials.forEach((material, index) => {
      const reveal = ease(THREE.MathUtils.clamp(simulationProgress * 7 - index * 0.15, 0, 1));
      material.opacity = mechanicsActive * reveal * 0.62;
      rig.boundaryRig.supports[index]?.scale.setScalar(Math.max(0.001, reveal));
    });
    rig.boundaryRig.contactPatches.forEach((patch) => {
      const reveal = ease(THREE.MathUtils.clamp((simulationProgress - 0.25 - patch.delay * 0.15) / 0.18, 0, 1));
      patch.mesh.scale.copy(patch.baseScale).multiplyScalar(Math.max(0.001, reveal));
      patch.mesh.material.uniforms.uOpacity.value = mechanicsActive * reveal;
      patch.mesh.material.uniforms.uPulse.value = loadRamp;
      patch.mesh.material.uniforms.uCandidate.value = 1;
    });
    const stressProgress = ease(THREE.MathUtils.clamp((simulationProgress - 0.38) / 0.4, 0, 1));
    rig.mechanicsRig.stressLines.forEach((line, index) => {
      const count = line.geometry.getAttribute("position").count;
      const lineReveal = ease(THREE.MathUtils.clamp(stressProgress * 1.2 - index * 0.018, 0, 1));
      line.geometry.setDrawRange(0, Math.floor(count * lineReveal));
      line.material.opacity = mechanicsActive * lineReveal * (schemeIndex === 2 ? 0.34 : schemeIndex === 1 ? 0.58 : 0.46);
      line.material.color.setHex(schemeIndex === 2 ? 0x86ddcb : schemeIndex === 1 ? 0xff8467 : 0xe5ad82);
    });
    rig.mechanicsRig.displacementMaterial.opacity = mechanicsActive * loadRamp * [0.28, 0.44, 0.2][schemeIndex];
    rig.mechanicsRig.ghostMaterial.opacity = mechanicsActive * loadRamp * 0.06;
  }

  const isSelectedScheme = schemeIndex === selectedSchemeIndex;
  const convergenceFilm = phase === "converge" ? opacity * (isSelectedScheme ? 0.52 : 0.13) : 0;
  const fluidActive = Math.max(simulationField === "fluid" ? opacity : 0, convergenceFilm);
  const fluidResponses = [
    { velocity: 0.94, retention: 0.72, exchange: 0.76 },
    { velocity: 1.18, retention: 0.48, exchange: 1.18 },
    { velocity: 0.8, retention: 0.88, exchange: 0.56 },
  ];
  const fluidResponse = fluidResponses[schemeIndex];
  rig.fluidMaterial.uniforms.uOpacity.value = fluidActive;
  rig.fluidMaterial.uniforms.uProgress.value = simulationField === "fluid" ? simulationProgress : 1;
  rig.fluidMaterial.uniforms.uTime.value = elapsed;
  configureThinFilmFlowResponse(rig.fluidMaterial, {
    candidate: isRecalculation || phase === "converge" ? 1 : 0,
    velocity: fluidResponse.velocity,
    retention: fluidResponse.retention,
    exchange: fluidResponse.exchange,
    stabilize: reducedMotion ? 1 : phase === "converge" ? isSelectedScheme ? 0.42 : 0.92 : 0,
    motion: reducedMotion ? 0 : phase === "converge" ? isSelectedScheme ? 0.46 : 0 : 1,
    readability: phase === "converge" ? isSelectedScheme ? 1.34 : 1.16 : 1.28,
    scheme: schemeIndex,
  });
  const wetSurface = THREE.MathUtils.clamp(fluidActive, 0, 1);
  rig.baseMaterial.roughness = THREE.MathUtils.lerp(0.34, 0.2, wetSurface);
  rig.baseMaterial.clearcoat = THREE.MathUtils.lerp(0.44, 0.72, wetSurface);
  rig.baseMaterial.clearcoatRoughness = THREE.MathUtils.lerp(0.22, 0.1, wetSurface);

  const bioActive = simulationField === "bio" ? opacity : 0;
  rig.bioRiskPoints.visible = bioActive > 0.01;
  rig.bioMaterial.uniforms.uOpacity.value = bioActive;
  rig.bioMaterial.uniforms.uProgress.value = simulationProgress;
  rig.bioMaterial.uniforms.uTime.value = elapsed;
  rig.bioMaterial.uniforms.uRecalculation.value = isRecalculation ? [1.1, 0.68, 0.32][schemeIndex] : 0;
  rig.bioRiskMaterial.uniforms.uOpacity.value = bioActive * [0.54, 0.72, 0.86][schemeIndex];
  rig.bioRiskMaterial.uniforms.uProgress.value = simulationProgress;
  rig.bioRiskMaterial.uniforms.uTime.value = elapsed;
  rig.bioRiskMaterial.uniforms.uRecalculation.value = isRecalculation ? [1.1, 0.68, 0.32][schemeIndex] : 0;
  rig.bioNetworkRig.group.visible = bioActive > 0.01;
  rig.bioNetworkRig.branches.forEach((branch, index) => {
    const count = branch.geometry.getAttribute("position").count;
    const reveal = ease(THREE.MathUtils.clamp((simulationProgress - 0.66) / 0.3 * 1.2 - index * 0.02, 0, 1));
    branch.geometry.setDrawRange(0, Math.floor(count * reveal));
    branch.material.opacity = bioActive * reveal * [0.2, 0.3, 0.4][schemeIndex];
  });
}

function visualTargets(mode: DentalSceneMode, phase: DentalScenePhase): VisualState {
  const scan = phase === "scan" || phase === "segment" ? 1 : phase === "defect" ? 0.82 : phase === "validate" ? 0.5 : mode === "scan" ? 1 : 0;
  const heat = phase === "defect" || phase === "segment" ? 0.9 : phase === "validate" ? 0.78 : mode === "heatmap" ? 0.88 : 0;
  const texture = phase === "generate" || phase === "recalculate" || phase === "simulate" || phase === "converge" || mode === "texture" || mode === "flow" ? 1 : 0;
  const flow = phase === "simulate" || mode === "flow" ? 1 : 0;
  const repair = phase === "repair" ? 1 : phase === "ready" ? 0.28 : mode === "repaired" ? 0.42 : 0;
  const defects = phase === "defect" ? 1 : phase === "validate" ? 0.22 : 0;
  return { scan, heat, texture, flow, repair, defects };
}

function phaseShowsRegionalDesign(phase: DentalScenePhase) {
  return phase === "segment"
    || phase === "generate"
    || phase === "recalculate"
    || phase === "simulate"
    || phase === "converge";
}

function phaseRotation(phase: DentalScenePhase) {
  switch (phase) {
    case "scan": return -0.18;
    case "defect": return 0.16;
    case "repair": return -0.52;
    case "validate": return 0.36;
    case "ready": return -0.24;
    case "baseline": return 0.08;
    case "segment": return 0.22;
    case "generate": return -0.42;
    case "recalculate": return 0.34;
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
  parallelSchemes = [],
  selectedSchemeIndex = 0,
  focusRegionId,
  simulationField = "none",
  simulationProgress = 0,
  visualPalette = "default",
  reconstructionLightWave = false,
  reconstructionMaterialProgress,
  comparisonAppearance = "default",
  showScannerOverlay = true,
  synchronizedPose = false,
  interactive = true,
  className,
  onLoaded,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(onLoaded);
  const visualRef = useRef({ mode, phase, stageProgress, textureSides, wave, regionalTextures, parallelSchemes, selectedSchemeIndex, focusRegionId, simulationField, simulationProgress, reconstructionMaterialProgress, comparisonAppearance, showScannerOverlay, synchronizedPose, interactive });

  useEffect(() => { loadedRef.current = onLoaded; }, [onLoaded]);
  useEffect(() => {
    visualRef.current = { mode, phase, stageProgress, textureSides, wave, regionalTextures, parallelSchemes, selectedSchemeIndex, focusRegionId, simulationField, simulationProgress, reconstructionMaterialProgress, comparisonAppearance, showScannerOverlay, synchronizedPose, interactive };
  }, [mode, phase, stageProgress, textureSides, wave, regionalTextures, parallelSchemes, selectedSchemeIndex, focusRegionId, simulationField, simulationProgress, reconstructionMaterialProgress, comparisonAppearance, showScannerOverlay, synchronizedPose, interactive]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const initialComparisonAppearance = visualRef.current.comparisonAppearance;
    const initialWorkflowActive = visualRef.current.reconstructionMaterialProgress !== undefined;
    const initialWorkflowProgress = THREE.MathUtils.clamp(visualRef.current.reconstructionMaterialProgress ?? 0, 0, 1);
    const initialWorkflowEase = ease(initialWorkflowProgress);
    const initialComparisonBefore = initialComparisonAppearance === "before" || initialWorkflowActive;
    const initialComparisonAfter = initialComparisonAppearance === "after";
    const brandCyanPalette = visualPalette === "brand-cyan";
    const paletteAqua = brandCyanPalette ? BRAND_CYAN : AQUA;
    const paletteSoft = brandCyanPalette ? BRAND_CYAN_SOFT : SIGNAL;
    const palettePale = brandCyanPalette ? BRAND_CYAN_PALE : AQUA_PALE;
    const paletteScanner = brandCyanPalette ? BRAND_CYAN_PALE : paletteAqua;
    const paletteRim = brandCyanPalette ? BRAND_CYAN_SOFT : paletteAqua;
    const paletteWave = brandCyanPalette ? BRAND_CYAN_SOFT : paletteAqua;
    const paletteBeforeRim = brandCyanPalette ? new THREE.Color(0x45666b) : RECONSTRUCTION_BEFORE_RIM;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0.15, 0.25, 6.6);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = initialWorkflowActive ? THREE.MathUtils.lerp(0.82, 1.12, initialWorkflowEase) : initialComparisonBefore ? 0.82 : initialComparisonAfter ? 1.25 : 1.12;
    mount.appendChild(renderer.domElement);
    mount.dataset.modelState = "loading";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4.3;
    controls.maxDistance = 9;
    controls.autoRotateSpeed = 0.32;

    const hemisphere = new THREE.HemisphereLight(0xf5fff9, 0x31423d, initialWorkflowActive ? THREE.MathUtils.lerp(1.18, 2.4, initialWorkflowEase) : initialComparisonBefore ? 1.18 : initialComparisonAfter ? 2.75 : 2.4);
    scene.add(hemisphere);
    const key = new THREE.DirectionalLight(initialComparisonBefore ? 0x9ba8a2 : 0xffffff, initialWorkflowActive ? THREE.MathUtils.lerp(2.6, 5.2, initialWorkflowEase) : initialComparisonBefore ? 2.6 : initialComparisonAfter ? 6.25 : 5.2);
    key.position.set(-3, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(initialComparisonBefore ? paletteBeforeRim : paletteRim, initialWorkflowActive ? THREE.MathUtils.lerp(0.8, 3.5, initialWorkflowEase) : initialComparisonBefore ? 0.8 : initialComparisonAfter ? 5.15 : 3.5);
    rim.position.set(4, -1, 3);
    scene.add(rim);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    const ensembleRoot = new THREE.Group();
    ensembleRoot.name = "three-scheme-ensemble";
    ensembleRoot.visible = false;
    scene.add(ensembleRoot);
    const ensembleRigs: EnsembleSchemeRig[] = [];
    const layoutHost = mount.parentElement;
    const projectedSchemeCenter = new THREE.Vector3();
    const lastSchemeLabelX = [Number.NaN, Number.NaN, Number.NaN];
    let ensembleCarouselAngle = 0;
    const schemeUserYaw = [0, 0, 0];
    const schemeYawVelocity = [0, 0, 0];
    const schemeRaycaster = new THREE.Raycaster();
    const schemePointer = new THREE.Vector2();
    let draggedSchemeIndex = -1;
    let dragPointerId = -1;
    let dragLastClientX = 0;
    let dragLastTimestamp = 0;
    let disposed = false;
    let frame = 0;
    let baseScale = 1;
    let scannerReady = false;
    let minY = -1;
    let maxY = 1;
    const size = new THREE.Vector3(1, 1, 1);
    let profile: SliceSample[] = [];
    let scanY = -1;
    let readyEnteredAt: number | null = null;
    const comparisonBaseTarget = new THREE.Color();
    const workflowKeyTarget = new THREE.Color();
    const workflowRimTarget = new THREE.Color();
    const state: VisualState = { scan: 0, heat: 0, texture: 0, flow: 0, repair: 0, defects: 0 };
    // 保留旧管状路径作为兼容实现，真正可见的微织构由贴合 STL 的高密度曲面网格承载。
    const enableMacroMicroGeometry = false;

    const baseMaterial = new THREE.MeshPhysicalMaterial({
      color: initialComparisonBefore ? 0x7b8580 : initialComparisonAfter ? 0xaebbb5 : 0xdce3dc,
      roughness: initialComparisonBefore ? 0.72 : initialComparisonAfter ? 0.18 : 0.31,
      metalness: 0.02,
      clearcoat: initialComparisonBefore ? 0.06 : initialComparisonAfter ? 0.88 : 0.42,
      clearcoatRoughness: initialComparisonBefore ? 0.68 : initialComparisonAfter ? 0.075 : 0.22,
    });
    const { material: reconstructionSurfaceMaterial, uniforms: reconstructionSurfaceUniforms } = createReconstructionSurfaceMaterial();
    const heatMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.48,
      metalness: 0.03,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const simulationMaterial = createSimulationFieldMaterial();
    const fluidRetentionMaterial = createThinFilmFlowMaterial();
    const bioFilmMaterial = createBioFilmMaterial();
    let simulationOpacity = 0;
    let mechanicsOpacity = 0;
    let surfaceFlowOpacity = 0;
    let bioRiskOpacity = 0;
    const simulationWeightTarget = new THREE.Vector4();
    const simulationLowTarget = new THREE.Color();
    const simulationHighTarget = new THREE.Color();
    const textureMaterials = [createRegionalTextureMaterial(), createRegionalTextureMaterial()];
    let textureSlot = 0;
    let textureBlend = 1;
    let regionalOpacity = 0;
    let patternOpacity = 0;
    let textureKey = "";
    let regionalBounds: THREE.Box3 | null = null;
    let regionalProjectionIndex: SurfaceProjectionIndex | null = null;
    let activeGeometryKey = "";
    let previousGeometryKey = "";
    let geometryBlend = 1;
    let modelUnitsPerUm = 2.65 / 13_062;
    let activePatchKey = "";
    let previousPatchKey = "";
    let patchBlend = 1;
    const geometryRigCache = new Map<string, RegionalGeometryRig>();
    const surfacePatchCache = new Map<string, SurfacePatchRig>();
    const planPrebuildTimers: number[] = [];

    const revealMaterial = new THREE.ShaderMaterial({
      uniforms: { uScanY: { value: -1 }, uOpacity: { value: 0 }, uAqua: { value: paletteScanner }, uSignal: { value: paletteSoft } },
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
        uAqua: { value: palettePale }, uSignal: { value: paletteSoft },
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
      uniforms: { uScanY: { value: -1 }, uOpacity: { value: 0 }, uColor: { value: paletteScanner } },
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
      uniforms: { uRepairY: { value: -1 }, uOpacity: { value: 0 }, uColor: { value: palettePale } },
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
    const reconstructionLightWaveMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uOpacity: { value: 0 },
        uWavePosition: { value: -0.2 },
        uTime: { value: 0 },
        uBoundsMin: { value: new THREE.Vector3(-1, -1, -1) },
        uBoundsSize: { value: new THREE.Vector3(2, 2, 2) },
        uAqua: { value: paletteWave },
        uPearl: { value: palettePale },
        uVitality: { value: 1 },
      },
      vertexShader: `
        uniform vec3 uBoundsMin;
        uniform vec3 uBoundsSize;
        varying vec3 vNormalized;
        varying vec3 vViewNormal;
        varying vec3 vViewPosition;
        void main() {
          vNormalized = (position - uBoundsMin) / max(uBoundsSize, vec3(0.0001));
          vViewNormal = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        uniform float uWavePosition;
        uniform float uTime;
        uniform vec3 uAqua;
        uniform vec3 uPearl;
        uniform float uVitality;
        varying vec3 vNormalized;
        varying vec3 vViewNormal;
        varying vec3 vViewPosition;
        void main() {
          if (uOpacity < 0.008) discard;
          vec3 geometricNormal = normalize(vViewNormal);
          vec3 viewDirection = normalize(-vViewPosition);
          float curvedCoordinate = vNormalized.y
            + sin(vNormalized.x * 6.283 + uTime * 0.16) * 0.035
            + sin(vNormalized.z * 8.2 - uTime * 0.12) * 0.024;
          float mainWave = 1.0 - smoothstep(0.018, 0.076, abs(curvedCoordinate - uWavePosition));
          float softHalo = 1.0 - smoothstep(0.05, 0.19, abs(curvedCoordinate - uWavePosition));
          float echoWave = 1.0 - smoothstep(0.025, 0.09, abs(curvedCoordinate - (uWavePosition - 0.145)));
          float surfaceResponse = 0.64 + pow(max(0.0, dot(geometricNormal, viewDirection)), 1.6) * 0.36;
          float fresnel = pow(1.0 - max(0.0, dot(geometricNormal, viewDirection)), 2.3);
          float shimmer = 0.88 + sin(vNormalized.x * 29.0 + vNormalized.z * 21.0 - uTime * 0.8) * 0.12;
          float energy = (mainWave * 0.72 + softHalo * 0.16 + echoWave * 0.22) * surfaceResponse * shimmer * uVitality;
          vec3 color = mix(uAqua, uPearl, mainWave * 0.72 + fresnel * 0.16);
          float alpha = energy * uOpacity * (0.82 + fresnel * 0.18);
          if (alpha < 0.006) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });

    const scannerGroup = new THREE.Group();
    modelGroup.add(scannerGroup);
    const scanCoreMaterial = new THREE.MeshBasicMaterial({ color: brandCyanPalette ? 0xe8fcff : 0xbff9eb, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const scanVolumeMaterial = new THREE.MeshBasicMaterial({ color: brandCyanPalette ? 0x79e6ee : 0x7bd9c5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const contour = createContour();
    const emitterGeometry = new THREE.BufferGeometry();
    emitterGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(32 * 3), 3));
    const emitterMaterial = new THREE.PointsMaterial({ color: brandCyanPalette ? 0xf4feff : 0xe8fff9, size: 0.024, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const emitters = new THREE.Points(emitterGeometry, emitterMaterial);
    const gridMaterials: THREE.Material[] = [];

    const defectMaterial = new THREE.PointsMaterial({ color: brandCyanPalette ? 0x79e6ee : 0xff6a43, size: 0.058, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    let defectPoints: THREE.Points | null = null;
    const bioDummy = new THREE.Object3D();
    const bioApproachPosition = new THREE.Vector3();
    const bioYAxis = new THREE.Vector3(0, 1, 0);
    let simulationBoundaryRig: SimulationBoundaryRig | null = null;
    let mechanicsFieldRig: MechanicsFieldRig | null = null;
    let bioNetworkRig: BioNetworkRig | null = null;
    let bioEntityRig: BioEntityRig | null = null;
    let fusionLayerRig: FusionLayerRig | null = null;
    let fusionLayerOpacity = 0;
    const bioRiskMaterial = createBioRiskMaterial(renderer.getPixelRatio());
    let bioRiskPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;

    const ensureRegionalGeometry = (regions: RegionalTextureRegion[]) => {
      if (!enableMacroMicroGeometry) return;
      if (!regionalProjectionIndex) return;
      const keyName = JSON.stringify(regions);
      if (geometryRigCache.has(keyName)) return;
      const rig = createRegionalGeometryRig(regionalProjectionIndex, size, regions);
      geometryRigCache.set(keyName, rig);
      modelGroup.add(rig.group);
    };

    const ensureSurfacePatchGeometry = (regions: RegionalTextureRegion[]) => {
      if (!regionalProjectionIndex) return;
      const keyName = JSON.stringify(regions);
      if (surfacePatchCache.has(keyName)) return;
      const rig = createSurfacePatchRig(regionalProjectionIndex, regions, modelUnitsPerUm);
      surfacePatchCache.set(keyName, rig);
      modelGroup.add(rig.group);
    };

    const installRegionalPlan = (regions: RegionalTextureRegion[], sides: 3 | 4 | 5 | 6, isWave: boolean) => {
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
          ensureSurfacePatchGeometry(selected);
        }
        return;
      }
      previousGeometryKey = activeGeometryKey;
      activeGeometryKey = nextKey;
      geometryBlend = previousGeometryKey ? 0 : 1;
      previousPatchKey = activePatchKey;
      activePatchKey = nextKey;
      patchBlend = previousPatchKey ? 0 : 1;
      ensureSurfacePatchGeometry(selected);
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
        modelUnitsPerUm = normalization / 1000;
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
        const stressField = new Float32Array(position.count);
        const fluidField = new Float32Array(position.count);
        const bioField = new Float32Array(position.count);
        const fusionField = new Float32Array(position.count);
        const fieldOrder = new Float32Array(position.count);
        const sourceNormals = geometry.getAttribute("normal") as THREE.BufferAttribute;
        const cool = new THREE.Color(brandCyanPalette ? 0x164b52 : 0x4b68ff);
        const warm = new THREE.Color(brandCyanPalette ? 0xe8fcff : 0xff5c36);
        const cyan = new THREE.Color(brandCyanPalette ? 0x24b7c7 : 0x83d6c5);
        const mechanicalContacts = [
          [0.23, 0.73, 0.11, 0.1, 1], [0.34, 0.82, 0.1, 0.085, 0.82], [0.46, 0.7, 0.09, 0.1, 0.72],
          [0.55, 0.84, 0.11, 0.09, 1], [0.65, 0.72, 0.1, 0.105, 0.74], [0.76, 0.77, 0.09, 0.1, 0.88],
          [0.29, 0.58, 0.11, 0.12, 0.58], [0.43, 0.6, 0.1, 0.11, 0.66], [0.61, 0.58, 0.1, 0.115, 0.62],
          [0.72, 0.52, 0.09, 0.12, 0.5], [0.51, 0.49, 0.105, 0.12, 0.44],
        ];
        for (let index = 0; index < position.count; index++) {
          const x = position.getX(index);
          const y = position.getY(index);
          const z = position.getZ(index);
          const normalizedX = (x - bounds.min.x) / Math.max(size.x, 0.001);
          const normalizedY = (y - bounds.min.y) / Math.max(size.y, 0.001);
          const normalizedZ = (z - bounds.min.z) / Math.max(size.z, 0.001);
          uv[index * 2] = (x - bounds.min.x) / Math.max(size.x, 0.001) * 3;
          uv[index * 2 + 1] = (y - bounds.min.y) / Math.max(size.y, 0.001) * 3;
          const signal = THREE.MathUtils.clamp(0.48 + Math.sin(x * 2.1 + z * 1.7) * 0.29 + y / Math.max(size.y, 1) * 0.42, 0, 1);
          const color = signal < 0.52 ? cool.clone().lerp(cyan, signal * 1.9) : cyan.clone().lerp(warm, (signal - 0.52) * 2.08);
          colors[index * 3] = color.r;
          colors[index * 3 + 1] = color.g;
          colors[index * 3 + 2] = color.b;
          let contactPressure = 0;
          for (const [contactX, contactY, radiusX, radiusY, strength] of mechanicalContacts) {
            contactPressure = Math.max(contactPressure, Math.exp(-(((normalizedX - contactX) / radiusX) ** 2 + ((normalizedY - contactY) / radiusY) ** 2)) * strength);
          }
          const slope = Math.abs(sourceNormals.getX(index)) * 0.62 + Math.abs(sourceNormals.getY(index)) * 0.38;
          const stress = THREE.MathUtils.clamp(contactPressure * 0.84 + slope * 0.2, 0, 1);
          const slowZone = Math.exp(-(((normalizedX - 0.69) / 0.21) ** 2 + ((normalizedY - 0.38) / 0.2) ** 2));
          const channelVariation = 0.5 + Math.sin(normalizedY * 17 + normalizedX * 5.5) * 0.16;
          const fluid = THREE.MathUtils.clamp(slowZone * 0.68 + (1 - normalizedY) * 0.18 + channelVariation * slope * 0.21, 0, 1);
          const adsorption = Math.exp(-(((normalizedX - 0.57) / 0.26) ** 2 + ((normalizedY - 0.47) / 0.26) ** 2));
          const bio = THREE.MathUtils.clamp(fluid * 0.64 + adsorption * 0.27 + (1 - normalizedZ) * 0.09, 0, 1);
          const fusion = THREE.MathUtils.clamp(stress * 0.42 + fluid * 0.29 + bio * 0.29, 0, 1);
          stressField[index] = stress;
          fluidField[index] = fluid;
          bioField[index] = bio;
          fusionField[index] = fusion;
          fieldOrder[index] = THREE.MathUtils.clamp(normalizedY * 0.56 + normalizedX * 0.2 + normalizedZ * 0.16 + Math.sin(normalizedX * 13) * 0.025, 0, 1);
        }
        geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute("aStress", new THREE.BufferAttribute(stressField, 1));
        geometry.setAttribute("aFluid", new THREE.BufferAttribute(fluidField, 1));
        geometry.setAttribute("aBio", new THREE.BufferAttribute(bioField, 1));
        geometry.setAttribute("aFusion", new THREE.BufferAttribute(fusionField, 1));
        geometry.setAttribute("aFieldOrder", new THREE.BufferAttribute(fieldOrder, 1));
        reconstructionLightWaveMaterial.uniforms.uBoundsMin.value.copy(bounds.min);
        reconstructionLightWaveMaterial.uniforms.uBoundsSize.value.copy(size);
        reconstructionSurfaceUniforms.uBoundsMin.value.copy(bounds.min);
        reconstructionSurfaceUniforms.uBoundsSize.value.copy(size);
        configureThinFilmFlowBounds(fluidRetentionMaterial, bounds);

        modelGroup.add(new THREE.Mesh(geometry, baseMaterial));
        const reconstructionSurfaceMesh = new THREE.Mesh(geometry, reconstructionSurfaceMaterial);
        reconstructionSurfaceMesh.scale.setScalar(1.0015);
        reconstructionSurfaceMesh.renderOrder = 1;
        modelGroup.add(reconstructionSurfaceMesh);
        const lightWaveMesh = new THREE.Mesh(geometry, reconstructionLightWaveMaterial);
        lightWaveMesh.scale.setScalar(1.0025);
        lightWaveMesh.renderOrder = 2;
        modelGroup.add(lightWaveMesh);
        const heatMesh = new THREE.Mesh(geometry, heatMaterial);
        heatMesh.scale.setScalar(1.002);
        modelGroup.add(heatMesh);
        const simulationMesh = new THREE.Mesh(geometry, simulationMaterial);
        simulationMesh.scale.setScalar(1.006);
        simulationMesh.renderOrder = 4;
        modelGroup.add(simulationMesh);
        const fluidRetentionMesh = new THREE.Mesh(geometry, fluidRetentionMaterial);
        fluidRetentionMesh.renderOrder = 4;
        modelGroup.add(fluidRetentionMesh);
        const bioFilmMesh = new THREE.Mesh(geometry, bioFilmMaterial);
        bioFilmMesh.renderOrder = 5;
        modelGroup.add(bioFilmMesh);
        simulationBoundaryRig = createSimulationBoundaryRig(regionalProjectionIndex);
        modelGroup.add(simulationBoundaryRig.group);
        mechanicsFieldRig = createMechanicsFieldRig(regionalProjectionIndex, geometry);
        modelGroup.add(mechanicsFieldRig.group);
        bioNetworkRig = createBioNetworkRig(regionalProjectionIndex);
        modelGroup.add(bioNetworkRig.group);
        bioEntityRig = createBioEntityRig(geometry);
        modelGroup.add(bioEntityRig.group);
        fusionLayerRig = createFusionLayerRig(geometry);
        modelGroup.add(fusionLayerRig.group);
        visualRef.current.parallelSchemes.slice(0, 3).forEach((schemeRegions) => {
          const ensembleRig = createEnsembleSchemeRig(
            geometry,
            regionalProjectionIndex!,
            schemeRegions,
            modelUnitsPerUm,
            renderer.getPixelRatio(),
          );
          ensembleRigs.push(ensembleRig);
          ensembleRoot.add(ensembleRig.group);
        });
        bioRiskPoints = new THREE.Points(createBioRiskGeometry(geometry), bioRiskMaterial);
        bioRiskPoints.renderOrder = 6;
        modelGroup.add(bioRiskPoints);
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
        const scanGrid = new THREE.GridHelper(scanWidth, 20, brandCyanPalette ? 0x79e6ee : 0x8fe1d0, brandCyanPalette ? 0x79e6ee : 0x8fe1d0);
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

    const updateSurfacePatchGeometry = (
      visual: typeof visualRef.current,
      delta: number,
      elapsedTime: number,
      focusRegionIndex: number,
      enabledIndices: number[],
    ) => {
      patchBlend = reducedMotion ? 1 : THREE.MathUtils.damp(patchBlend, 1, 5.2, delta);
      const regionalLayerAllowed = phaseShowsRegionalDesign(visual.phase);
      surfacePatchCache.forEach((rig, keyName) => {
        const planWeight = keyName === activePatchKey
          ? patchBlend
          : keyName === previousPatchKey
            ? 1 - patchBlend
            : 0;
        const rigOpacity = regionalLayerAllowed ? regionalOpacity * planWeight : 0;
        rig.group.visible = rigOpacity > 0.008;

        rig.patches.forEach((patch) => {
          const enabledOrder = enabledIndices.indexOf(patch.regionIndex);
          const region = visual.regionalTextures[patch.regionIndex];
          const segmentReveal = ease(THREE.MathUtils.clamp(visual.stageProgress * 3.15 - patch.regionIndex * 0.68, 0, 1));
          const reveal = visual.phase === "segment"
            ? segmentReveal
            : regionalLayerAllowed && regionalOpacity > 0.01 ? 1 : 0;
          const carve = visual.phase === "generate" && enabledOrder >= 0 && region
            ? regionCarveProgress(region, visual.stageProgress, enabledOrder)
            : visual.phase === "recalculate" || visual.phase === "simulate" || visual.phase === "converge" ? Number(patch.enabled) : 0;
          const focus = focusRegionIndex < 0 || patch.regionIndex === focusRegionIndex ? 1 : 0.28;
          const undecidedOutline = visual.phase === "segment" ? 0.1 : 0;
          patch.material.uniforms.uOpacity.value = rigOpacity * (patch.enabled ? 0.98 : undecidedOutline);
          patch.material.uniforms.uReveal.value = reveal;
          patch.material.uniforms.uCarve.value = patch.enabled ? carve : 0;
          patch.material.uniforms.uTime.value = elapsedTime;
          patch.material.uniforms.uFlow.value = state.flow;
          patch.material.uniforms.uFocus.value = focus;
          patch.material.uniforms.uDecision.value = visual.phase === "segment" && !reducedMotion
            ? (1 - ease(visual.stageProgress)) * 0.52 + Math.sin(visual.stageProgress * Math.PI * 5) ** 2 * 0.48
            : 0;
        });
      });
    };

    const clock = new THREE.Clock();
    let elapsed = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!reducedMotion) elapsed += delta;
      const visual = visualRef.current;
      const comparisonBefore = visual.comparisonAppearance === "before";
      const comparisonAfter = visual.comparisonAppearance === "after";
      const workflowActive = visual.reconstructionMaterialProgress !== undefined;
      const workflowProgress = THREE.MathUtils.clamp(visual.reconstructionMaterialProgress ?? 0, 0, 1);
      const workflowReveal = ease(workflowProgress);
      const ensembleActive = ensembleRigs.length === 3
        && (visual.phase === "generate" || visual.phase === "recalculate" || visual.phase === "converge");
      const selectedSchemeCanRotate = ensembleActive && visual.phase === "converge" && visual.interactive;
      renderer.domElement.style.cursor = draggedSchemeIndex >= 0 ? "grabbing" : selectedSchemeCanRotate ? "grab" : "";
      if (draggedSchemeIndex < 0 && selectedSchemeCanRotate) {
        const selectedIndex = THREE.MathUtils.clamp(Math.round(visual.selectedSchemeIndex), 0, 2);
        const velocity = schemeYawVelocity[selectedIndex];
        if (Math.abs(velocity) > 0.0001) {
          schemeUserYaw[selectedIndex] += velocity * delta;
          schemeYawVelocity[selectedIndex] *= Math.exp(-delta * 7.5);
        }
      }
      ensembleRoot.visible = ensembleActive;
      modelGroup.visible = !ensembleActive || (visual.phase === "generate" && visual.stageProgress < 0.12);
      if (ensembleActive) {
        const spread = visual.phase === "generate" ? ease(THREE.MathUtils.clamp(visual.stageProgress / 0.2, 0, 1)) : 1;
        const ensembleReveal = visual.phase === "generate" ? ease(THREE.MathUtils.clamp((visual.stageProgress - 0.035) / 0.14, 0, 1)) : 1;
        const convergence = visual.phase === "converge" ? ease(visual.stageProgress) : 0;
        const carouselInteractive = visual.phase === "converge" && visual.interactive;
        const carouselStep = Math.PI * 2 / 3;
        let carouselTarget = THREE.MathUtils.clamp(Math.round(visual.selectedSchemeIndex), 0, 2) * carouselStep;
        while (carouselTarget - ensembleCarouselAngle > Math.PI) carouselTarget -= Math.PI * 2;
        while (carouselTarget - ensembleCarouselAngle < -Math.PI) carouselTarget += Math.PI * 2;
        ensembleCarouselAngle = reducedMotion
          ? carouselTarget
          : THREE.MathUtils.damp(ensembleCarouselAngle, carouselTarget, 3.8, delta);
        const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
        const parallelScreenOffset = 0.52;
        const parallelHalfWidth = tanHalfFov * Math.max(6.5, camera.position.z) * camera.aspect;
        const parallelWorldOffset = parallelHalfWidth * parallelScreenOffset;
        const basePositions = [-parallelWorldOffset, 0, parallelWorldOffset];
        const responsiveEnsembleScale = THREE.MathUtils.clamp(camera.aspect / 1.28, 0.58, 1);
        ensembleRigs.forEach((rig, schemeIndex) => {
          rig.group.visible = true;
          let targetX = basePositions[schemeIndex] * spread;
          let targetY = 0;
          let targetZ = 0;
          let targetScale = THREE.MathUtils.lerp(0.76, 0.51, spread);
          let schemeOpacity = ensembleReveal;
          let targetRotationX = -0.12;
          let targetRotationY = [-0.16, 0, 0.16][schemeIndex];
          let targetRotationZ = 0;
          if (carouselInteractive) {
            const orbitAngle = ensembleCarouselAngle - schemeIndex * carouselStep;
            const prominence = THREE.MathUtils.clamp((Math.cos(orbitAngle) + 0.5) / 1.5, 0, 1);
            targetY = 0;
            targetZ = -0.82 + prominence * 0.9;
            const orbitHalfWidth = tanHalfFov * Math.max(6.5, camera.position.z - targetZ) * camera.aspect;
            targetX = Math.sin(orbitAngle) * orbitHalfWidth * (parallelScreenOffset / Math.sin(carouselStep));
            targetScale = 0.46 + prominence * 0.48;
            schemeOpacity = 0.5 + prominence * 0.5;
            targetRotationY = -0.12 + Math.sin(orbitAngle) * 0.28;
            targetRotationZ = Math.sin(orbitAngle) * 0.035;
            const focusedZone = schemeIndex === visual.selectedSchemeIndex
              ? rig.regions.find((region) => region.id === visual.focusRegionId)?.anatomicalZone
              : undefined;
            if (focusedZone) {
              targetRotationX = focusedZone === "occlusal" ? 0.82 : -0.12;
              targetRotationY = focusedZone === "lingual" ? Math.PI
                : focusedZone === "mesial" ? Math.PI * 0.5
                  : focusedZone === "distal" ? -Math.PI * 0.5 : 0;
              targetRotationZ = 0;
            }
            if (schemeIndex === visual.selectedSchemeIndex) targetRotationY += schemeUserYaw[schemeIndex];
          } else if (visual.phase === "converge") {
            if (schemeIndex === 0) {
              targetX = THREE.MathUtils.lerp(basePositions[0], 0, convergence);
              targetY = 0;
              targetZ = THREE.MathUtils.lerp(0, 0.08, convergence);
              targetScale = THREE.MathUtils.lerp(0.51, 0.94, convergence);
              targetRotationY = THREE.MathUtils.lerp(-0.16, -0.12, convergence);
            } else {
              const exitZ = -0.82;
              const exitHalfWidth = tanHalfFov * Math.max(6.5, camera.position.z - exitZ) * camera.aspect;
              const exitX = (schemeIndex === 1 ? -1 : 1) * exitHalfWidth * parallelScreenOffset;
              targetX = THREE.MathUtils.lerp(basePositions[schemeIndex], exitX, convergence);
              targetY = 0;
              targetZ = THREE.MathUtils.lerp(0, exitZ, convergence);
              targetScale = THREE.MathUtils.lerp(0.51, 0.46, convergence);
              schemeOpacity = 1 - convergence * 0.5;
              targetRotationY = THREE.MathUtils.lerp(targetRotationY, schemeIndex === 1 ? -0.36 : 0.36, convergence);
              targetRotationZ = THREE.MathUtils.lerp(0, schemeIndex === 1 ? -0.035 : 0.035, convergence);
            }
          }
          rig.group.position.set(targetX, targetY, targetZ);
          rig.group.scale.setScalar(targetScale * responsiveEnsembleScale);
          rig.group.rotation.x = reducedMotion ? targetRotationX : THREE.MathUtils.damp(rig.group.rotation.x, targetRotationX, 4.2, delta);
          rig.group.rotation.y = reducedMotion ? targetRotationY : THREE.MathUtils.damp(rig.group.rotation.y, targetRotationY, 4.2, delta);
          rig.group.rotation.z = reducedMotion ? targetRotationZ : THREE.MathUtils.damp(rig.group.rotation.z, targetRotationZ, 4.2, delta);
          if (!reducedMotion && visual.phase !== "converge") rig.group.position.y += Math.sin(elapsed * 0.55 + schemeIndex * 1.8) * 0.018;
          updateEnsembleSchemeRig(
            rig,
            schemeIndex,
            visual.phase,
            visual.stageProgress,
            visual.simulationField,
            visual.simulationProgress,
            elapsed,
            schemeOpacity,
            reducedMotion,
            visual.selectedSchemeIndex,
            visual.focusRegionId,
          );
        });
      }
      const focusRegionIndex = visual.regionalTextures.findIndex((region) => region.id === visual.focusRegionId);
      const regionalPhase = visual.phase === "segment" || visual.phase === "generate" || visual.phase === "recalculate" || visual.phase === "simulate" || visual.phase === "converge";
      controls.enableZoom = visual.interactive;
      // Orbiting the camera rotates the whole three-scheme composition.  Once a
      // scheme converges, horizontal dragging is therefore routed to the selected
      // tooth only; the two reference schemes retain their world-space pose.
      controls.enableRotate = visual.interactive && !selectedSchemeCanRotate;
      controls.autoRotate = !visual.interactive && !reducedMotion && !regionalPhase && focusRegionIndex < 0;
      controls.update();
      installRegionalPlan(visual.regionalTextures, visual.textureSides, visual.wave);
      textureBlend = reducedMotion ? 1 : THREE.MathUtils.damp(textureBlend, 1, 5.2, delta);

      const targets = visualTargets(visual.mode, visual.phase);
      (Object.keys(state) as Array<keyof VisualState>).forEach((keyName) => {
        state[keyName] = reducedMotion ? targets[keyName] : THREE.MathUtils.damp(state[keyName], targets[keyName], 4.1, delta);
      });

      const showRegionalDesign = phaseShowsRegionalDesign(visual.phase);
      const patternTarget = visual.phase === "generate"
        ? ease(THREE.MathUtils.clamp(visual.stageProgress * 1.08, 0, 1))
        : visual.phase === "recalculate" || visual.phase === "simulate" || visual.phase === "converge" ? 1 : 0;
      regionalOpacity = !showRegionalDesign
        ? 0
        : reducedMotion ? 1 : THREE.MathUtils.damp(regionalOpacity, 1, 4.6, delta);
      patternOpacity = reducedMotion ? patternTarget : THREE.MathUtils.damp(patternOpacity, patternTarget, 4.3, delta);
      const enabledIndices = visual.regionalTextures
        .map((region, index) => region.enabled ? index : -1)
        .filter((index) => index >= 0);
      textureMaterials.forEach((material, materialIndex) => {
        const slotWeight = materialIndex === textureSlot ? textureBlend : 1 - textureBlend;
        // 低透明边界场只负责分区轮廓，沟槽与颜色由高密度曲面网格真实呈现。
        material.uniforms.uOpacity.value = regionalOpacity * slotWeight * 0;
        material.uniforms.uPatternOpacity.value = 0;
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uFlow.value = state.flow;
        material.uniforms.uFocusIndex.value = focusRegionIndex;
        for (let regionIndex = 0; regionIndex < 3; regionIndex++) {
          const enabledOrder = enabledIndices.indexOf(regionIndex);
          const segmentReveal = ease(THREE.MathUtils.clamp(visual.stageProgress * 3.15 - regionIndex * 0.68, 0, 1));
          const reveal = visual.phase === "segment" ? segmentReveal : showRegionalDesign ? 1 : 0;
          const carve = visual.phase === "generate" && enabledOrder >= 0
            ? ease(THREE.MathUtils.clamp(visual.stageProgress * enabledIndices.length - enabledOrder, 0, 1))
            : visual.phase === "recalculate" || visual.phase === "simulate" || visual.phase === "converge" ? 1 : 0;
          material.uniforms[`uReveal${regionIndex}`].value = reveal;
          material.uniforms[`uCarve${regionIndex}`].value = carve;
        }
      });
      updateRegionalGeometry(visual, delta, elapsed);
      updateSurfacePatchGeometry(visual, delta, elapsed, focusRegionIndex, enabledIndices);
      simulationWeightTarget.set(0, 0, 0, 0);
      if (visual.simulationField === "mechanics") {
        simulationWeightTarget.x = 1;
        simulationLowTarget.set(0x17352f);
        simulationHighTarget.set(0xff7457);
      } else if (visual.simulationField === "fluid") {
        simulationWeightTarget.y = 1;
        simulationLowTarget.set(0x102f31);
        simulationHighTarget.set(0x74dfd0);
      } else if (visual.simulationField === "bio") {
        simulationWeightTarget.z = 1;
        simulationLowTarget.set(0x282438);
        simulationHighTarget.set(0xc39aff);
      } else if (visual.simulationField === "fusion") {
        simulationWeightTarget.w = 1;
        simulationLowTarget.set(0x17322e);
        simulationHighTarget.set(0xffa078);
      }
      const simulationBlend = reducedMotion ? 1 : 1 - Math.exp(-delta * 4.8);
      simulationMaterial.uniforms.uWeights.value.lerp(simulationWeightTarget, simulationBlend);
      simulationMaterial.uniforms.uLowColor.value.lerp(simulationLowTarget, simulationBlend);
      simulationMaterial.uniforms.uHighColor.value.lerp(simulationHighTarget, simulationBlend);
      const scalarFieldVisible = visual.simulationField === "mechanics" || visual.simulationField === "fusion";
      simulationOpacity = reducedMotion
        ? Number(scalarFieldVisible)
        : THREE.MathUtils.damp(simulationOpacity, scalarFieldVisible ? 1 : 0, 4.8, delta);
      const fusionResolve = visual.simulationField === "fusion"
        ? ease(THREE.MathUtils.clamp((visual.simulationProgress - 0.62) / 0.34, 0, 1))
        : 1;
      const mechanicsFieldReveal = visual.simulationField === "mechanics"
        ? ease(THREE.MathUtils.clamp((visual.simulationProgress - 0.34) / 0.32, 0, 1))
        : 1;
      const fieldSolveProgress = visual.simulationField === "mechanics"
        ? ease(THREE.MathUtils.clamp((visual.simulationProgress - 0.36) / 0.46, 0, 1))
        : visual.simulationProgress;
      simulationMaterial.uniforms.uOpacity.value = simulationOpacity * fusionResolve * mechanicsFieldReveal;
      simulationMaterial.uniforms.uProgress.value = fieldSolveProgress;
      simulationMaterial.uniforms.uTime.value = elapsed;
      simulationMaterial.uniforms.uRecalculation.value = visual.phase === "recalculate" ? 1 : 0;
      const mechanicsLoad = ease(THREE.MathUtils.clamp((visual.simulationProgress - 0.28) / 0.34, 0, 1));
      const mechanicsCycle = visual.simulationProgress > 0.68 && !reducedMotion
        ? 0.9 + Math.sin((visual.simulationProgress - 0.68) * Math.PI * 18) * 0.1
        : 1;
      simulationMaterial.uniforms.uDeform.value = visual.simulationField === "mechanics" && !reducedMotion
        ? mechanicsLoad * mechanicsCycle * (visual.phase === "recalculate" ? 0.52 : 0.78)
        : 0;
      mechanicsOpacity = reducedMotion
        ? Number(visual.simulationField === "mechanics")
        : THREE.MathUtils.damp(mechanicsOpacity, visual.simulationField === "mechanics" ? 1 : 0, 5.2, delta);
      const mechanicsActivity = mechanicsOpacity * simulationOpacity;
      if (simulationBoundaryRig) {
        simulationBoundaryRig.group.visible = mechanicsActivity > 0.01;
        const contactProgress = visual.simulationField === "mechanics" ? visual.simulationProgress : 1;
        const boundaryReveal = ease(THREE.MathUtils.clamp(contactProgress / 0.14, 0, 1));
        const shellReveal = ease(THREE.MathUtils.clamp(contactProgress / 0.1, 0, 1));
        const shellArrival = ease(THREE.MathUtils.clamp((contactProgress - 0.08) / 0.24, 0, 1));
        const loadRamp = ease(THREE.MathUtils.clamp((contactProgress - 0.28) / 0.34, 0, 1));
        const fatigueCycle = contactProgress > 0.68 && !reducedMotion
          ? 0.88 + Math.sin((contactProgress - 0.68) * Math.PI * 18) * 0.1
          : 1;
        simulationBoundaryRig.occlusalShell.scale.setScalar(Math.max(0.001, shellReveal));
        simulationBoundaryRig.occlusalShell.position.z = THREE.MathUtils.lerp(
          simulationBoundaryRig.shellStartZ,
          simulationBoundaryRig.shellTargetZ - loadRamp * fatigueCycle * 0.018,
          shellArrival,
        );
        const ghostReveal = ease(THREE.MathUtils.clamp((contactProgress - 0.25) / 0.25, 0, 1));
        const localCycleEnvelope = reducedMotion
          ? 0
          : ease(THREE.MathUtils.clamp((contactProgress - 0.68) / 0.08, 0, 1));
        const localCyclePhase = THREE.MathUtils.clamp((contactProgress - 0.68) / 0.32, 0, 1) * Math.PI * 6;
        simulationBoundaryRig.shellLayers.forEach((layer, layerIndex) => {
          const layerReveal = layerIndex === 0 ? shellReveal : shellReveal * ghostReveal;
          layer.mesh.material.opacity = mechanicsActivity * layerReveal * layer.opacity;
          layer.mesh.position.z = layer.offset + (layerIndex > 0 ? Math.sin(localCyclePhase + layer.phase) * 0.004 * localCycleEnvelope : 0);
          const attribute = layer.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
          const width = layer.mesh.geometry.parameters.width;
          const height = layer.mesh.geometry.parameters.height;
          for (let vertexIndex = 0; vertexIndex < attribute.count; vertexIndex++) {
            const normalizedX = attribute.getX(vertexIndex) / width + 0.5;
            const normalizedY = attribute.getY(vertexIndex) / height + 0.5;
            const buccalZone = Math.exp(-(((normalizedX - 0.25) / 0.2) ** 2 + ((normalizedY - 0.62) / 0.28) ** 2));
            const centralZone = Math.exp(-(((normalizedX - 0.52) / 0.22) ** 2 + ((normalizedY - 0.68) / 0.25) ** 2));
            const lingualZone = Math.exp(-(((normalizedX - 0.76) / 0.18) ** 2 + ((normalizedY - 0.56) / 0.27) ** 2));
            const loadingIndent = loadRamp * (buccalZone * 0.0035 + centralZone * 0.0048 + lingualZone * 0.0032);
            const localWave = (
              Math.sin(localCyclePhase + layer.phase) * buccalZone
              + Math.sin(localCyclePhase + layer.phase + 1.08) * centralZone
              + Math.sin(localCyclePhase + layer.phase + 2.02) * lingualZone
            ) * layer.amplitude * localCycleEnvelope;
            attribute.setZ(vertexIndex, layer.baseZ[vertexIndex] - loadingIndent + localWave);
          }
          attribute.needsUpdate = true;
        });
        simulationBoundaryRig.shellWireMaterial.opacity = mechanicsActivity * shellReveal * 0.1;
        simulationBoundaryRig.supportMaterials.forEach((material, index) => {
          const supportReveal = ease(THREE.MathUtils.clamp(boundaryReveal * 1.45 - index * 0.12, 0, 1));
          material.opacity = mechanicsActivity * supportReveal * 0.68;
          simulationBoundaryRig?.supports[index]?.scale.setScalar(Math.max(0.001, supportReveal));
        });
        simulationBoundaryRig.contactPatches.forEach((patch) => {
          const contactReveal = ease(THREE.MathUtils.clamp((contactProgress - 0.26 - patch.delay * 0.16) / 0.16, 0, 1));
          const pressureGrowth = ease(THREE.MathUtils.clamp((loadRamp - patch.delay * 0.22) / 0.78, 0, 1));
          patch.mesh.scale.copy(patch.baseScale).multiplyScalar(Math.max(0.001, contactReveal * (0.48 + pressureGrowth * 0.52)));
          patch.mesh.material.uniforms.uOpacity.value = mechanicsActivity * contactReveal * (0.54 + pressureGrowth * 0.46);
          patch.mesh.material.uniforms.uPulse.value = pressureGrowth * fatigueCycle;
          patch.mesh.material.uniforms.uCandidate.value = visual.phase === "recalculate" ? 1 : 0;
        });
      }
      if (mechanicsFieldRig) {
        mechanicsFieldRig.group.visible = mechanicsActivity > 0.01;
        const mechanicsProgress = visual.simulationField === "mechanics" ? visual.simulationProgress : 1;
        const stressProgress = ease(THREE.MathUtils.clamp((mechanicsProgress - 0.38) / 0.36, 0, 1));
        const fatiguePulse = mechanicsProgress > 0.69 && !reducedMotion
          ? 0.76 + Math.sin((mechanicsProgress - 0.69) * Math.PI * 18) * 0.18
          : 1;
        mechanicsFieldRig.stressLines.forEach((line, index) => {
          const count = line.geometry.getAttribute("position").count;
          const lineProgress = ease(THREE.MathUtils.clamp(stressProgress * 1.24 - index * 0.035, 0, 1));
          line.geometry.setDrawRange(0, Math.max(0, Math.floor(count * lineProgress)));
          line.material.opacity = mechanicsActivity * (index % 3 === 1 ? 0.72 : 0.42) * fatiguePulse;
          line.material.color.setHex(visual.phase === "recalculate" ? 0x8ce2d1 : index % 3 === 1 ? 0xffa07f : 0xff7252);
        });
        mechanicsFieldRig.displacementMaterial.opacity = mechanicsActivity
          * ease(THREE.MathUtils.clamp((mechanicsProgress - 0.46) / 0.26, 0, 1))
          * (visual.phase === "recalculate" ? 0.24 : 0.48);
        mechanicsFieldRig.ghostMaterial.opacity = mechanicsActivity
          * ease(THREE.MathUtils.clamp((mechanicsProgress - 0.36) / 0.25, 0, 1))
          * 0.09;
      }
      surfaceFlowOpacity = reducedMotion
        ? Number(visual.simulationField === "fluid")
        : THREE.MathUtils.damp(surfaceFlowOpacity, visual.simulationField === "fluid" ? 1 : 0, 4.8, delta);
      const fluidActivity = surfaceFlowOpacity;
      fluidRetentionMaterial.uniforms.uOpacity.value = fluidActivity;
      fluidRetentionMaterial.uniforms.uProgress.value = visual.simulationField === "fluid" ? visual.simulationProgress : 1;
      fluidRetentionMaterial.uniforms.uTime.value = elapsed;
      configureThinFilmFlowResponse(fluidRetentionMaterial, {
        candidate: visual.phase === "recalculate" ? 1 : 0,
        velocity: visual.phase === "recalculate" ? 1.02 : 0.82,
        retention: visual.phase === "recalculate" ? 0.66 : 1,
        exchange: visual.phase === "recalculate" ? 0.9 : 0.42,
        stabilize: reducedMotion ? 1 : 0,
        motion: reducedMotion ? 0 : 1,
        readability: 1.05,
        scheme: 0,
      });
      bioRiskOpacity = reducedMotion
        ? Number(visual.simulationField === "bio")
        : THREE.MathUtils.damp(bioRiskOpacity, visual.simulationField === "bio" ? 1 : 0, 4.5, delta);
      const bioActivity = bioRiskOpacity;
      const bioProgress = visual.simulationField === "bio" ? visual.simulationProgress : 1;
      const adsorptionProgress = ease(THREE.MathUtils.clamp((bioProgress - 0.16) / 0.36, 0, 1));
      const adsorptionFade = 1 - ease(THREE.MathUtils.clamp((bioProgress - 0.62) / 0.25, 0, 1)) * 0.54;
      if (bioRiskPoints) bioRiskPoints.visible = bioActivity > 0.01;
      bioRiskMaterial.uniforms.uOpacity.value = bioActivity * adsorptionFade;
      bioRiskMaterial.uniforms.uProgress.value = adsorptionProgress;
      bioRiskMaterial.uniforms.uTime.value = elapsed;
      bioRiskMaterial.uniforms.uRecalculation.value = visual.phase === "recalculate" ? 1 : 0;
      bioFilmMaterial.uniforms.uOpacity.value = bioActivity;
      bioFilmMaterial.uniforms.uProgress.value = visual.simulationField === "bio" ? visual.simulationProgress : 1;
      bioFilmMaterial.uniforms.uTime.value = elapsed;
      bioFilmMaterial.uniforms.uRecalculation.value = visual.phase === "recalculate" ? 1 : 0;
      if (bioNetworkRig) {
        bioNetworkRig.group.visible = bioActivity > 0.01;
        const networkProgress = ease(THREE.MathUtils.clamp((bioProgress - 0.7) / 0.27, 0, 1));
        bioNetworkRig.branches.forEach((branch, branchIndex) => {
          const count = branch.geometry.getAttribute("position").count;
          const branchProgress = ease(THREE.MathUtils.clamp(networkProgress * 1.3 - branchIndex * 0.025, 0, 1));
          branch.geometry.setDrawRange(0, Math.floor(count * branchProgress));
          branch.material.opacity = bioActivity
            * (visual.phase === "recalculate" ? 0.18 : 0.42)
            * (0.88 + Math.sin(elapsed * 1.2 + branchIndex) * 0.12);
        });
      }
      if (bioEntityRig) {
        bioEntityRig.group.visible = bioActivity > 0.01;
        const isRecalculation = visual.phase === "recalculate";
        const nucleiGlobal = ease(THREE.MathUtils.clamp((bioProgress - 0.38) / 0.27, 0, 1));
        const adhesionGlobal = ease(THREE.MathUtils.clamp((bioProgress - 0.52) / 0.26, 0, 1));
        bioEntityRig.nuclei.material.opacity = bioActivity * nucleiGlobal * (isRecalculation ? 0.52 : 0.86);
        bioEntityRig.cells.material.opacity = bioActivity * adhesionGlobal * (isRecalculation ? 0.58 : 0.82);
        bioEntityRig.nucleiSamples.forEach((sample, index) => {
          const localGrowth = ease(THREE.MathUtils.clamp((bioProgress - 0.38 - sample.seed * 0.16) / 0.18, 0, 1));
          const survival = isRecalculation ? THREE.MathUtils.clamp((sample.risk - 0.44) * 1.35, 0.16, 0.62) : 1;
          const scale = Math.max(0.001, localGrowth * survival * (0.52 + sample.risk * 0.78));
          bioDummy.position.copy(sample.position).addScaledVector(sample.normal, 0.024);
          bioDummy.quaternion.setFromUnitVectors(bioYAxis, sample.normal);
          bioDummy.rotation.y += sample.seed * Math.PI;
          bioDummy.scale.set(scale * 0.72, scale * 1.25, scale * 0.72);
          bioDummy.updateMatrix();
          bioEntityRig?.nuclei.setMatrixAt(index, bioDummy.matrix);
        });
        bioEntityRig.nuclei.instanceMatrix.needsUpdate = true;
        bioEntityRig.cellSamples.forEach((sample, index) => {
          const landingStart = 0.47 + sample.seed * 0.18;
          const adhesion = ease(THREE.MathUtils.clamp((bioProgress - landingStart) / 0.19, 0, 1));
          const survival = isRecalculation ? (sample.seed < sample.risk * 0.42 ? 0.72 : 0.08) : 1;
          const detachment = isRecalculation ? ease(THREE.MathUtils.clamp((bioProgress - 0.75) / 0.2, 0, 1)) * (1 - survival) : 0;
          const normalDistance = THREE.MathUtils.lerp(0.17, 0.028, adhesion) + detachment * 0.08;
          bioApproachPosition.copy(sample.position).addScaledVector(sample.normal, normalDistance);
          if (!reducedMotion && adhesion < 0.96) {
            bioApproachPosition.x += Math.sin(elapsed * 1.35 + sample.seed * 19) * 0.008 * (1 - adhesion);
            bioApproachPosition.y += Math.cos(elapsed * 1.1 + sample.seed * 13) * 0.006 * (1 - adhesion);
          }
          const scale = Math.max(0.001, adhesionGlobal * (0.62 + sample.risk * 0.52) * (survival + detachment * 0.28));
          bioDummy.position.copy(bioApproachPosition);
          bioDummy.quaternion.setFromUnitVectors(bioYAxis, sample.normal);
          bioDummy.scale.set(scale * 0.72, scale * 1.35, scale * 0.72);
          bioDummy.updateMatrix();
          bioEntityRig?.cells.setMatrixAt(index, bioDummy.matrix);
        });
        bioEntityRig.cells.instanceMatrix.needsUpdate = true;
      }
      fusionLayerOpacity = reducedMotion
        ? Number(visual.simulationField === "fusion")
        : THREE.MathUtils.damp(fusionLayerOpacity, visual.simulationField === "fusion" ? 1 : 0, 5.1, delta);
      if (fusionLayerRig) {
        const fusionProgress = visual.simulationField === "fusion" ? visual.simulationProgress : 1;
        updateFusionLayerRig(fusionLayerRig, fusionProgress, elapsed, fusionLayerOpacity, reducedMotion);
      }
      const heatAppearance = comparisonBefore ? 0.48 : 0.9;
      heatMaterial.opacity = visual.phase === "segment"
        ? state.heat * (1 - ease(visual.stageProgress)) * 0.62
        : state.heat * heatAppearance;
      defectMaterial.opacity = state.defects * (comparisonBefore ? 0.44 : 0.55 + Math.sin(elapsed * 5.2) * 0.25);
      scanCoreMaterial.opacity = state.scan * 0.065;
      scanVolumeMaterial.opacity = state.scan * 0.022;
      gridMaterials.forEach((material) => { material.opacity = state.scan * 0.06; });
      (contour.material as THREE.LineBasicMaterial).opacity = state.scan * 0.92;
      emitterMaterial.opacity = state.scan * 0.9;
      scannerGroup.visible = visual.showScannerOverlay && state.scan > 0.01;

      updateScanner(visual.stageProgress);
      revealMaterial.uniforms.uScanY.value = scanY;
      revealMaterial.uniforms.uOpacity.value = state.scan;
      pointMaterial.uniforms.uScanY.value = scanY;
      pointMaterial.uniforms.uOpacity.value = state.scan;
      normalMaterial.uniforms.uScanY.value = scanY;
      normalMaterial.uniforms.uOpacity.value = state.scan;
      repairMaterial.uniforms.uRepairY.value = THREE.MathUtils.lerp(minY, maxY, ease(visual.stageProgress));
      repairMaterial.uniforms.uOpacity.value = state.repair * (workflowActive ? 0.34 : 1);
      reconstructionSurfaceUniforms.uRepairProgress.value = workflowActive ? workflowProgress : 0;
      reconstructionSurfaceUniforms.uRepairTime.value = elapsed;
      const repairSweepActive = reconstructionLightWave && workflowActive && visual.phase === "repair";
      const readyLightWaveActive = reconstructionLightWave && visual.phase === "ready";
      if (readyLightWaveActive && readyEnteredAt === null) readyEnteredAt = elapsed;
      if (!readyLightWaveActive) readyEnteredAt = null;
      const readyElapsed = readyEnteredAt === null ? 0 : Math.max(0, elapsed - readyEnteredAt);
      let lightWavePosition = -0.2;
      let lightWaveOpacity = 0;
      if (repairSweepActive) {
        lightWavePosition = THREE.MathUtils.lerp(-0.18, 1.18, workflowReveal);
        lightWaveOpacity = reducedMotion ? 0.24 : 0.9;
      } else if (readyLightWaveActive) {
        if (reducedMotion) {
          lightWavePosition = 0.62;
          lightWaveOpacity = 0.2;
        } else if (readyElapsed < 2.2) {
          lightWavePosition = THREE.MathUtils.lerp(-0.18, 1.18, ease(THREE.MathUtils.clamp(readyElapsed / 1.65, 0, 1)));
          lightWaveOpacity = 0.92;
        } else {
          const loopProgress = ((readyElapsed - 2.2) / 5.2) % 1;
          lightWavePosition = THREE.MathUtils.lerp(-0.18, 1.18, ease(loopProgress));
          lightWaveOpacity = 0.58;
        }
        const arrivalFade = ease(THREE.MathUtils.clamp((lightWavePosition + 0.16) / 0.2, 0, 1));
        const departureFade = 1 - ease(THREE.MathUtils.clamp((lightWavePosition - 1.02) / 0.16, 0, 1));
        lightWaveOpacity *= arrivalFade * departureFade;
      }
      reconstructionLightWaveMaterial.uniforms.uOpacity.value = lightWaveOpacity;
      reconstructionLightWaveMaterial.uniforms.uWavePosition.value = lightWavePosition;
      reconstructionLightWaveMaterial.uniforms.uTime.value = elapsed;
      reconstructionLightWaveMaterial.uniforms.uVitality.value = comparisonAfter ? 1.24 : repairSweepActive ? 1.1 : 1;

      const exposureTarget = workflowActive ? THREE.MathUtils.lerp(0.82, 1.12, workflowReveal) : comparisonBefore ? 0.82 : comparisonAfter ? 1.25 : 1.12;
      renderer.toneMappingExposure = THREE.MathUtils.damp(renderer.toneMappingExposure, exposureTarget, 3.4, delta);
      hemisphere.intensity = THREE.MathUtils.damp(hemisphere.intensity, workflowActive ? THREE.MathUtils.lerp(1.18, 2.4, workflowReveal) : comparisonBefore ? 1.18 : comparisonAfter ? 2.75 : 2.4, 3.4, delta);
      key.intensity = THREE.MathUtils.damp(key.intensity, workflowActive ? THREE.MathUtils.lerp(2.6, 5.2, workflowReveal) : comparisonBefore ? 2.6 : comparisonAfter ? 6.25 : 5.2, 3.4, delta);
      rim.intensity = THREE.MathUtils.damp(rim.intensity, workflowActive ? THREE.MathUtils.lerp(0.8, 3.5, workflowReveal) : comparisonBefore ? 0.8 : comparisonAfter ? 5.15 : 3.5, 3.4, delta);
      const keyTarget = workflowActive ? workflowKeyTarget.copy(RECONSTRUCTION_BEFORE_LIGHT).lerp(RECONSTRUCTION_STANDARD_LIGHT, workflowReveal) : comparisonBefore ? RECONSTRUCTION_BEFORE_LIGHT : RECONSTRUCTION_STANDARD_LIGHT;
      key.color.lerp(keyTarget, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2));
      const warmLight = workflowActive
        ? workflowRimTarget.copy(paletteBeforeRim).lerp(paletteRim, workflowReveal)
        : comparisonBefore ? paletteBeforeRim : targets.heat > 0.2 && !comparisonAfter ? paletteSoft : paletteRim;
      rim.color.lerp(warmLight, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2));
      const afterArrival = comparisonAfter ? ease(THREE.MathUtils.clamp(readyElapsed / 1.25, 0, 1)) : 1;
      const baseTarget = workflowActive
        ? RECONSTRUCTION_BEFORE_SURFACE
        : comparisonBefore
        ? RECONSTRUCTION_BEFORE_SURFACE
        : comparisonAfter
          ? comparisonBaseTarget.copy(RECONSTRUCTION_AFTER_ENTRY).lerp(RECONSTRUCTION_AFTER_SURFACE, afterArrival)
          : targets.repair > 0.2
            ? new THREE.Color(0xf1f6f0)
            : fluidActivity > 0.08 ? new THREE.Color(0xb9c5c0) : new THREE.Color(0xdce3dc);
      baseMaterial.color.lerp(baseTarget, reducedMotion ? 1 : 1 - Math.exp(-delta * 3.2));
      const targetRoughness = workflowActive ? 0.72 : comparisonBefore ? 0.72 : comparisonAfter ? 0.18 : fluidActivity > 0.08 ? 0.21 : targets.scan > 0.2 ? 0.48 : 0.31;
      baseMaterial.roughness = THREE.MathUtils.damp(baseMaterial.roughness, targetRoughness, 3.2, delta);
      baseMaterial.clearcoat = THREE.MathUtils.damp(baseMaterial.clearcoat, workflowActive ? 0.06 : comparisonBefore ? 0.06 : comparisonAfter ? 0.88 : fluidActivity > 0.08 ? 0.74 : 0.42, 3.2, delta);
      baseMaterial.clearcoatRoughness = THREE.MathUtils.damp(baseMaterial.clearcoatRoughness, workflowActive ? 0.68 : comparisonBefore ? 0.68 : comparisonAfter ? 0.075 : fluidActivity > 0.08 ? 0.1 : 0.22, 3.2, delta);

      const focusRotations = [0, 0, Math.PI, Math.PI * 0.5, -Math.PI * 0.5];
      const focusTilts = [0.82, -0.12, -0.12, -0.12, -0.12];
      const modelingSweep = visual.phase === "generate" && focusRegionIndex < 0 ? (ease(visual.stageProgress) - 0.5) * 0.34 : 0;
      const fieldRotation = visual.synchronizedPose ? -0.12
        : visual.simulationField === "mechanics" ? -0.08
        : visual.simulationField === "fluid" ? 0.24 + visual.simulationProgress * 0.1
          : visual.simulationField === "bio" ? -0.64 + visual.simulationProgress * 0.1
            : visual.simulationField === "fusion" ? 0.12 : phaseRotation(visual.phase);
      const targetRotationY = focusRegionIndex >= 0 ? focusRotations[focusRegionIndex] : fieldRotation + modelingSweep;
      const driftAmplitude = visual.synchronizedPose ? 0 : visual.simulationField === "bio" ? 0.012 : visual.simulationField === "fluid" ? 0.024 : 0.035;
      const drift = reducedMotion ? 0 : Math.sin(elapsed * 0.25) * driftAmplitude;
      modelGroup.rotation.y = THREE.MathUtils.damp(modelGroup.rotation.y, targetRotationY + drift, 2.2, delta);
      const modelingTilt = visual.phase === "generate" ? THREE.MathUtils.lerp(-0.2, -0.04, ease(visual.stageProgress)) : -0.12;
      const fieldTilt = visual.synchronizedPose ? -0.12
        : focusRegionIndex >= 0 ? focusTilts[focusRegionIndex]
        : visual.simulationField === "fluid" ? -0.21
          : visual.simulationField === "bio" ? -0.06
            : visual.simulationField === "mechanics" ? -0.15
              : visual.simulationField === "fusion" ? -0.18 : modelingTilt;
      modelGroup.rotation.x = THREE.MathUtils.damp(modelGroup.rotation.x, fieldTilt, 2.4, delta);
      modelGroup.position.y = reducedMotion || visual.synchronizedPose ? 0 : Math.sin(elapsed * 0.62) * 0.028;
      const arrival = visual.phase === "parse" || visual.phase === "ingress" ? 0.94 + ease(visual.stageProgress) * 0.06 : 1;
      const targetScale = baseScale * arrival;
      const scale = THREE.MathUtils.damp(modelGroup.scale.x, targetScale, 3.5, delta);
      modelGroup.scale.setScalar(scale);
      if (!visual.interactive || focusRegionIndex >= 0 || visual.phase === "converge") {
        const ensembleDistance = ensembleActive
          ? visual.phase === "converge"
            ? visual.interactive ? 8.45 : THREE.MathUtils.lerp(8.55, 8.45, ease(visual.stageProgress))
            : 8.55
          : 0;
        const cameraDistance = ensembleActive ? ensembleDistance
          : focusRegionIndex >= 0 ? 5.18
          : visual.simulationField === "mechanics" ? 6.35
            : visual.simulationField === "fluid" ? 5.34
              : visual.simulationField === "bio" ? 5.5
                : visual.phase === "generate" ? 5.72 : 6.6;
        camera.position.z = THREE.MathUtils.damp(camera.position.z, cameraDistance, 2.7, delta);
      }

      if (ensembleActive && layoutHost) {
        camera.updateMatrixWorld();
        ensembleRoot.updateMatrixWorld(true);
        ensembleRigs.forEach((rig, schemeIndex) => {
          rig.group.getWorldPosition(projectedSchemeCenter).project(camera);
          const projectedX = THREE.MathUtils.clamp((projectedSchemeCenter.x * 0.5 + 0.5) * 100, 6, 94);
          if (!Number.isFinite(lastSchemeLabelX[schemeIndex]) || Math.abs(lastSchemeLabelX[schemeIndex] - projectedX) > 0.025) {
            layoutHost.style.setProperty(`--scheme-${schemeIndex + 1}-x`, `${projectedX.toFixed(3)}%`);
            lastSchemeLabelX[schemeIndex] = projectedX;
          }
        });
      }

      renderer.render(scene, camera);
    };

    const pointerHitsSelectedScheme = (event: PointerEvent, schemeIndex: number) => {
      const rig = ensembleRigs[schemeIndex];
      if (!rig) return false;
      const bounds = renderer.domElement.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return false;
      schemePointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      schemeRaycaster.setFromCamera(schemePointer, camera);
      return schemeRaycaster.intersectObject(rig.hitMesh, false).length > 0;
    };

    const handleSchemePointerDown = (event: PointerEvent) => {
      const visual = visualRef.current;
      if (event.button !== 0 || visual.phase !== "converge" || !visual.interactive || ensembleRigs.length !== 3) return;
      const selectedIndex = THREE.MathUtils.clamp(Math.round(visual.selectedSchemeIndex), 0, 2);
      if (!pointerHitsSelectedScheme(event, selectedIndex)) return;
      draggedSchemeIndex = selectedIndex;
      dragPointerId = event.pointerId;
      dragLastClientX = event.clientX;
      dragLastTimestamp = event.timeStamp;
      schemeYawVelocity[selectedIndex] = 0;
      renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const handleSchemePointerMove = (event: PointerEvent) => {
      if (draggedSchemeIndex < 0 || event.pointerId !== dragPointerId) return;
      const deltaX = event.clientX - dragLastClientX;
      const elapsedMs = Math.max(8, event.timeStamp - dragLastTimestamp);
      const deltaYaw = deltaX * 0.0082;
      schemeUserYaw[draggedSchemeIndex] += deltaYaw;
      schemeYawVelocity[draggedSchemeIndex] = THREE.MathUtils.clamp(deltaYaw / (elapsedMs / 1000), -4.2, 4.2);
      dragLastClientX = event.clientX;
      dragLastTimestamp = event.timeStamp;
      event.preventDefault();
    };

    const finishSchemePointerDrag = (event: PointerEvent) => {
      if (event.pointerId !== dragPointerId) return;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      draggedSchemeIndex = -1;
      dragPointerId = -1;
    };

    renderer.domElement.addEventListener("pointerdown", handleSchemePointerDown);
    renderer.domElement.addEventListener("pointermove", handleSchemePointerMove);
    renderer.domElement.addEventListener("pointerup", finishSchemePointerDrag);
    renderer.domElement.addEventListener("pointercancel", finishSchemePointerDrag);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      pointMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      bioRiskMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      ensembleRigs.forEach((rig) => {
        rig.bioRiskMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    render();

    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", handleSchemePointerDown);
      renderer.domElement.removeEventListener("pointermove", handleSchemePointerMove);
      renderer.domElement.removeEventListener("pointerup", finishSchemePointerDrag);
      renderer.domElement.removeEventListener("pointercancel", finishSchemePointerDrag);
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
      [baseMaterial, reconstructionSurfaceMaterial, heatMaterial, simulationMaterial, fluidRetentionMaterial, bioFilmMaterial, bioRiskMaterial, revealMaterial, pointMaterial, normalMaterial, repairMaterial, reconstructionLightWaveMaterial, defectMaterial, scanCoreMaterial, scanVolumeMaterial, emitterMaterial, ...textureMaterials].forEach((material) => {
        if (!disposedMaterials.has(material)) material.dispose();
      });
      geometryRigCache.forEach((rig) => {
        rig.materials.forEach((material) => {
          if (!disposedMaterials.has(material)) material.dispose();
        });
      });
      geometryRigCache.clear();
      surfacePatchCache.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      if (layoutHost) {
        [1, 2, 3].forEach((schemeNumber) => layoutHost.style.removeProperty(`--scheme-${schemeNumber}-x`));
      }
    };
  }, [src, reconstructionLightWave, visualPalette]);

  return <div ref={mountRef} className={className} aria-label="可交互义齿精密扫描与仿真三维模型" />;
}
