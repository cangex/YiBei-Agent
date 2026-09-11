import { writeFile } from "node:fs/promises";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("Usage: node scripts/build-cad-upper-denture.mjs <output.glb>");
}

const TAU = Math.PI * 2;

const toothPlan = [
  { kind: "central", x: 0.215, z: 1.015, yaw: 0.045, width: 0.43, height: 0.595, depth: 0.29, neck: 0.08 },
  { kind: "lateral", x: 0.58, z: 0.925, yaw: 0.205, width: 0.345, height: 0.545, depth: 0.28, neck: 0.105 },
  { kind: "canine", x: 0.875, z: 0.745, yaw: 0.405, width: 0.365, height: 0.605, depth: 0.34, neck: 0.125 },
  { kind: "premolar1", x: 1.11, z: 0.475, yaw: 0.61, width: 0.375, height: 0.475, depth: 0.42, neck: 0.15 },
  { kind: "premolar2", x: 1.305, z: 0.145, yaw: 0.79, width: 0.395, height: 0.455, depth: 0.455, neck: 0.175 },
  { kind: "molar1", x: 1.45, z: -0.235, yaw: 0.975, width: 0.47, height: 0.425, depth: 0.545, neck: 0.20 },
  { kind: "molar2", x: 1.525, z: -0.655, yaw: 1.13, width: 0.45, height: 0.395, depth: 0.525, neck: 0.225 },
];

function signedPow(value, power) {
  return Math.sign(value) * Math.pow(Math.abs(value), power);
}

function toothShape(kind) {
  if (kind === "central") return { exponent: 3.05, crownBias: 0.045, edgeCurve: 0.052, cusp: 0, body: 1.03 };
  if (kind === "lateral") return { exponent: 2.85, crownBias: 0.035, edgeCurve: 0.062, cusp: 0.008, body: 0.98 };
  if (kind === "canine") return { exponent: 2.48, crownBias: 0.05, edgeCurve: 0.026, cusp: 0.052, body: 0.94 };
  if (kind.startsWith("premolar")) return { exponent: 3.05, crownBias: 0.022, edgeCurve: 0.034, cusp: 0, body: 1.02 };
  return { exponent: 3.35, crownBias: 0.016, edgeCurve: 0.03, cusp: 0, body: 1.04 };
}

function createToothGeometry(spec, side) {
  const thetaSegments = 48;
  const verticalSegments = 30;
  const vertices = [];
  const indices = [];
  const shape = toothShape(spec.kind);
  const anterior = ["central", "lateral", "canine"].includes(spec.kind);

  for (let ring = 0; ring <= verticalSegments; ring++) {
    const v = ring / verticalSegments;
    const eased = v * v * (3 - 2 * v);
    const widthProfile = anterior
      ? 0.755 + 0.16 * eased + 0.105 * Math.pow(Math.sin(Math.PI * v), 0.82)
      : 0.78 + 0.105 * eased + 0.125 * Math.pow(Math.sin(Math.PI * v), 0.88);
    const depthProfile = anterior
      ? 0.69 + 0.095 * eased + 0.19 * Math.sin(Math.PI * v)
      : 0.72 + 0.13 * eased + 0.16 * Math.sin(Math.PI * v);

    for (let segment = 0; segment < thetaSegments; segment++) {
      const theta = segment / thetaSegments * TAU;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const localXn = signedPow(cos, 2 / shape.exponent);
      const localZn = signedPow(sin, 2 / (shape.exponent - 0.42));
      let localX = spec.width * 0.5 * widthProfile * localXn;
      let localZ = spec.depth * 0.5 * depthProfile * localZn;

      const facial = Math.max(0, localZn);
      const proximalSoftening = Math.pow(Math.abs(localXn), 1.9);
      localZ += shape.crownBias * facial * Math.sin(Math.PI * v);
      localZ += facial * 0.0085 * Math.cos(localXn * Math.PI * 2.7) * Math.pow(Math.sin(Math.PI * v), 1.35);
      localZ -= 0.012 * Math.max(0, -localZn) * Math.sin(Math.PI * v);
      localX *= 1 - 0.025 * side * localXn * Math.sin(Math.PI * v);

      let localY = spec.neck - spec.height * v;
      const terminal = Math.pow(v, 8);
      localY += terminal * shape.edgeCurve * proximalSoftening;
      if (shape.cusp) {
        const cuspFocus = Math.pow(Math.max(0, 1 - Math.abs(localXn)), anterior ? 1.25 : 1.7);
        localY -= terminal * shape.cusp * cuspFocus;
      }
      localY -= 0.01 * facial * Math.sin(Math.PI * v) * shape.body;

      const yaw = spec.yaw * side;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const worldX = spec.x * side + localX * cosYaw + localZ * sinYaw;
      const worldZ = spec.z - localX * sinYaw + localZ * cosYaw;
      vertices.push(worldX, localY, worldZ);
    }
  }

  for (let ring = 0; ring < verticalSegments; ring++) {
    const current = ring * thetaSegments;
    const next = (ring + 1) * thetaSegments;
    for (let segment = 0; segment < thetaSegments; segment++) {
      const following = (segment + 1) % thetaSegments;
      indices.push(current + segment, next + segment, current + following);
      indices.push(next + segment, next + following, current + following);
    }
  }

  const topCenter = vertices.length / 3;
  vertices.push(spec.x * side, spec.neck + 0.005, spec.z);
  const bottomCenter = vertices.length / 3;
  const bottomY = spec.neck - spec.height - (spec.kind === "canine" ? 0.045 : 0.012);
  vertices.push(spec.x * side, bottomY, spec.z + (anterior ? 0.018 : 0));
  const lastRing = verticalSegments * thetaSegments;
  for (let segment = 0; segment < thetaSegments; segment++) {
    const following = (segment + 1) % thetaSegments;
    indices.push(topCenter, following, segment);
    indices.push(bottomCenter, lastRing + segment, lastRing + following);
  }

  for (let index = 0; index < indices.length; index += 3) {
    const second = indices[index + 1];
    indices[index + 1] = indices[index + 2];
    indices[index + 2] = second;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createPalatalPlate() {
  const radialSegments = 38;
  const angularSegments = 112;
  const vertices = [0, 0.69, -0.13, 0, 0.33, -0.13];
  const indices = [];
  const topStart = 2;
  const ringVertexCount = radialSegments * angularSegments;
  const bottomStart = topStart + ringVertexCount;

  const pointAt = (radiusIndex, angularIndex, top) => {
    const r = radiusIndex / radialSegments;
    const angle = angularIndex / angularSegments * TAU;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const sideTaper = 0.94 + 0.06 * Math.max(0, s);
    const x = 1.59 * r * c * sideTaper;
    const z = -0.14 + 1.19 * r * s;
    const dome = Math.pow(Math.max(0, 1 - r * r), 0.72);
    const frontLift = Math.max(0, s) * 0.055 * Math.pow(r, 1.4);
    const upperY = 0.205 + 0.485 * dome + frontLift;
    const thickness = 0.24 + 0.12 * dome;
    return [x, top ? upperY : upperY - thickness, z];
  };

  for (let top = 1; top >= 0; top--) {
    for (let ring = 1; ring <= radialSegments; ring++) {
      for (let segment = 0; segment < angularSegments; segment++) {
        vertices.push(...pointAt(ring, segment, Boolean(top)));
      }
    }
  }

  for (let segment = 0; segment < angularSegments; segment++) {
    const following = (segment + 1) % angularSegments;
    indices.push(0, topStart + segment, topStart + following);
    indices.push(1, bottomStart + following, bottomStart + segment);
  }

  for (let ring = 1; ring < radialSegments; ring++) {
    for (let segment = 0; segment < angularSegments; segment++) {
      const following = (segment + 1) % angularSegments;
      const topA = topStart + (ring - 1) * angularSegments + segment;
      const topB = topStart + ring * angularSegments + segment;
      const topC = topStart + ring * angularSegments + following;
      const topD = topStart + (ring - 1) * angularSegments + following;
      indices.push(topA, topB, topD, topB, topC, topD);
      const bottomA = bottomStart + (ring - 1) * angularSegments + segment;
      const bottomB = bottomStart + ring * angularSegments + segment;
      const bottomC = bottomStart + ring * angularSegments + following;
      const bottomD = bottomStart + (ring - 1) * angularSegments + following;
      indices.push(bottomA, bottomD, bottomB, bottomB, bottomD, bottomC);
    }
  }

  const topOuter = topStart + (radialSegments - 1) * angularSegments;
  const bottomOuter = bottomStart + (radialSegments - 1) * angularSegments;
  for (let segment = 0; segment < angularSegments; segment++) {
    const following = (segment + 1) % angularSegments;
    indices.push(topOuter + segment, bottomOuter + segment, topOuter + following);
    indices.push(bottomOuter + segment, bottomOuter + following, topOuter + following);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createArchCurve() {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.51, 0, -0.67),
    new THREE.Vector3(-1.43, 0, -0.24),
    new THREE.Vector3(-1.28, 0, 0.15),
    new THREE.Vector3(-1.08, 0, 0.48),
    new THREE.Vector3(-0.85, 0, 0.75),
    new THREE.Vector3(-0.56, 0, 0.93),
    new THREE.Vector3(-0.205, 0, 1.015),
    new THREE.Vector3(0.205, 0, 1.015),
    new THREE.Vector3(0.56, 0, 0.93),
    new THREE.Vector3(0.85, 0, 0.75),
    new THREE.Vector3(1.08, 0, 0.48),
    new THREE.Vector3(1.28, 0, 0.15),
    new THREE.Vector3(1.43, 0, -0.24),
    new THREE.Vector3(1.51, 0, -0.67),
  ], false, "centripetal", 0.35);
}

function createLabialFlange() {
  const curve = createArchCurve();
  const segments = 224;
  const section = [
    { outward: 0.285, y: 0.055 },
    { outward: 0.345, y: 0.19 },
    { outward: 0.31, y: 0.39 },
    { outward: 0.13, y: 0.53 },
    { outward: -0.17, y: 0.49 },
    { outward: -0.29, y: 0.31 },
    { outward: -0.235, y: 0.13 },
    { outward: -0.04, y: 0.035 },
  ];
  const vertices = [];
  const indices = [];
  const tangent = new THREE.Vector3();
  const outward = new THREE.Vector3();

  for (let segment = 0; segment <= segments; segment++) {
    const t = segment / segments;
    const center = curve.getPointAt(t);
    curve.getTangentAt(t, tangent).normalize();
    outward.set(-tangent.z, 0, tangent.x).normalize();
    const end = Math.min(t, 1 - t);
    const endTaper = 0.72 + 0.28 * THREE.MathUtils.smoothstep(end, 0, 0.08);
    const front = Math.exp(-Math.pow((t - 0.5) / 0.22, 2));
    for (const point of section) {
      const width = point.outward * endTaper;
      const y = point.y + front * (point.y > 0.4 ? 0.055 : 0.012);
      vertices.push(center.x + outward.x * width, y, center.z + outward.z * width);
    }
  }

  const sectionCount = section.length;
  for (let segment = 0; segment < segments; segment++) {
    for (let side = 0; side < sectionCount; side++) {
      const following = (side + 1) % sectionCount;
      const a = segment * sectionCount + side;
      const b = (segment + 1) * sectionCount + side;
      const c = (segment + 1) * sectionCount + following;
      const d = segment * sectionCount + following;
      indices.push(a, b, d, b, c, d);
    }
  }

  for (const end of [0, segments]) {
    const centerIndex = vertices.length / 3;
    const base = end * sectionCount;
    const center = new THREE.Vector3();
    for (let side = 0; side < sectionCount; side++) {
      center.x += vertices[(base + side) * 3];
      center.y += vertices[(base + side) * 3 + 1];
      center.z += vertices[(base + side) * 3 + 2];
    }
    center.multiplyScalar(1 / sectionCount);
    vertices.push(center.x, center.y, center.z);
    for (let side = 0; side < sectionCount; side++) {
      const following = (side + 1) % sectionCount;
      if (end === 0) indices.push(centerIndex, base + following, base + side);
      else indices.push(centerIndex, base + side, base + following);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createGingivalDetails() {
  const geometries = [];
  for (const side of [-1, 1]) {
    for (const spec of toothPlan) {
      const anterior = ["central", "lateral", "canine"].includes(spec.kind);
      const mound = new THREE.SphereGeometry(1, 28, 18);
      mound.scale(spec.width * (anterior ? 0.52 : 0.47), anterior ? 0.145 : 0.12, spec.depth * 0.39);
      mound.rotateY(spec.yaw * side);
      mound.translate(spec.x * side, spec.neck + (anterior ? 0.115 : 0.105), spec.z + 0.075);
      mound.deleteAttribute("uv");
      mound.computeVertexNormals();
      geometries.push(mound);
    }
  }
  const ordered = [
    ...toothPlan.slice().reverse().map((spec) => ({ ...spec, x: -spec.x, yaw: -spec.yaw })),
    ...toothPlan,
  ];
  for (let index = 0; index < ordered.length - 1; index++) {
    const left = ordered[index];
    const right = ordered[index + 1];
    const center = new THREE.Vector3(
      (left.x + right.x) * 0.5,
      (left.neck + right.neck) * 0.5 + 0.015,
      (left.z + right.z) * 0.5 + 0.105,
    );
    const yaw = (left.yaw + right.yaw) * 0.5;
    const papilla = new THREE.ConeGeometry(index === 6 ? 0.062 : 0.054, index === 6 ? 0.18 : 0.15, 24, 5, false);
    papilla.scale(1, 1, 0.72);
    papilla.rotateZ(Math.PI);
    papilla.rotateY(yaw);
    papilla.translate(center.x, center.y - 0.035, center.z);
    papilla.deleteAttribute("uv");
    papilla.computeVertexNormals();
    geometries.push(papilla);
  }
  return mergeGeometries(geometries, false);
}

function geometryPayload(geometry) {
  const output = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!output.getAttribute("normal")) output.computeVertexNormals();
  output.computeBoundingBox();
  const position = output.getAttribute("position");
  const normal = output.getAttribute("normal");
  return {
    position: new Float32Array(position.array),
    normal: new Float32Array(normal.array),
    min: output.boundingBox.min.toArray(),
    max: output.boundingBox.max.toArray(),
  };
}

async function writeGlb(path, teethGeometry, gingivaGeometry) {
  const payloads = [geometryPayload(gingivaGeometry), geometryPayload(teethGeometry)];
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;

  const addArray = (array, type, count, min, max) => {
    const padding = (4 - (byteOffset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      byteOffset += padding;
    }
    const source = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: source.length, target: 34962 });
    chunks.push(source);
    byteOffset += source.length;
    const accessor = accessors.length;
    accessors.push({ bufferView: view, componentType: 5126, count, type, ...(min ? { min, max } : {}) });
    return accessor;
  };

  const meshes = payloads.map((payload, index) => {
    const count = payload.position.length / 3;
    const position = addArray(payload.position, "VEC3", count, payload.min, payload.max);
    const normal = addArray(payload.normal, "VEC3", count);
    return {
      name: index === 0 ? "upper_gingiva" : "upper_teeth",
      primitives: [{ attributes: { POSITION: position, NORMAL: normal }, material: index }],
    };
  });

  const binary = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "Yibei custom dental CAD display model" },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: "upper_gingiva", mesh: 0 },
      { name: "upper_teeth", mesh: 1 },
    ],
    meshes,
    materials: [
      { name: "gingiva_resin", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.82, 0.43, 0.46, 1], metallicFactor: 0, roughnessFactor: 0.34 } },
      { name: "tooth_resin", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.96, 0.93, 0.84, 1], metallicFactor: 0, roughnessFactor: 0.2 } },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
    extras: {
      purpose: "Stylized, non-clinical maxillary complete-denture visualization for the Yibei homepage",
      structure: "Fourteen position-specific artificial teeth with a continuous palatal plate and labial flange",
    },
  };

  let json = Buffer.from(JSON.stringify(gltf));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  if (jsonPadding) json = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (binary.length % 4)) % 4;
  const paddedBinary = binPadding ? Buffer.concat([binary, Buffer.alloc(binPadding)]) : binary;
  const totalLength = 12 + 8 + json.length + 8 + paddedBinary.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBinary.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  await writeFile(path, Buffer.concat([header, jsonHeader, json, binHeader, paddedBinary]));
}

const teeth = mergeGeometries(
  [-1, 1].flatMap((side) => toothPlan.map((spec) => createToothGeometry(spec, side))),
  false,
);
if (!teeth) throw new Error("Unable to merge tooth geometry.");
const gingivalDetails = createGingivalDetails();
const gingiva = mergeGeometries([createPalatalPlate(), createLabialFlange(), gingivalDetails], false);
if (!gingiva) throw new Error("Unable to merge gingiva geometry.");

await writeGlb(outputPath, teeth, gingiva);
console.log(JSON.stringify({
  outputPath,
  teeth: 14,
  toothTriangles: geometryPayload(teeth).position.length / 9,
  gingivaTriangles: geometryPayload(gingiva).position.length / 9,
}, null, 2));
