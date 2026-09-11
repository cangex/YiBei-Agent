import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const [inputPath, crownsPath, gingivaPath] = process.argv.slice(2);
if (!inputPath || !crownsPath || !gingivaPath) {
  throw new Error("Usage: node scripts/build-upper-denture.mjs <upper-arch.stl> <crowns.stl> <gingiva.stl>");
}

function parseStl(path) {
  const sourceBuffer = readFileSync(path);
  const sourceArrayBuffer = sourceBuffer.buffer.slice(sourceBuffer.byteOffset, sourceBuffer.byteOffset + sourceBuffer.byteLength);
  return new STLLoader().parse(sourceArrayBuffer);
}

function writeBinaryStl(path, geometry) {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const binary = new STLExporter().parse(new THREE.Mesh(geometry), { binary: true });
  const output = binary instanceof DataView
    ? Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength)
    : Buffer.from(binary);
  writeFileSync(path, output);
}

function createArchCurve(y = 0) {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.67, y, -1.06),
    new THREE.Vector3(-1.58, y, -0.62),
    new THREE.Vector3(-1.34, y, -0.10),
    new THREE.Vector3(-0.92, y, 0.43),
    new THREE.Vector3(-0.46, y, 0.89),
    new THREE.Vector3(0, y, 1.12),
    new THREE.Vector3(0.46, y, 0.89),
    new THREE.Vector3(0.92, y, 0.43),
    new THREE.Vector3(1.34, y, -0.10),
    new THREE.Vector3(1.58, y, -0.62),
    new THREE.Vector3(1.67, y, -1.06),
  ], false, "centripetal", 0.35);
}

function splitComponents(geometry) {
  const position = geometry.getAttribute("position");
  const triangleCount = position.count / 3;
  const parent = Array.from({ length: triangleCount }, (_, index) => index);
  const find = (source) => {
    let root = source;
    while (parent[root] !== root) root = parent[root];
    while (parent[source] !== source) {
      const next = parent[source];
      parent[source] = root;
      source = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const owner = new Map();
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    for (let corner = 0; corner < 3; corner++) {
      const index = triangle * 3 + corner;
      const vertexKey = key(position.getX(index), position.getY(index), position.getZ(index));
      const existing = owner.get(vertexKey);
      if (existing === undefined) owner.set(vertexKey, triangle);
      else union(triangle, existing);
    }
  }
  const components = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const root = find(triangle);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(triangle);
  }
  return [...components.values()].filter((triangles) => triangles.length > 100);
}

function componentBounds(position, triangles) {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner++) {
      const index = triangle * 3 + corner;
      point.set(position.getX(index), position.getY(index), position.getZ(index));
      bounds.expandByPoint(point);
    }
  }
  return bounds;
}

function clipTriangleBelow(vertices, limit) {
  const output = [];
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index];
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const currentInside = current.y <= limit;
    const previousInside = previous.y <= limit;
    if (currentInside !== previousInside) {
      const amount = (limit - previous.y) / (current.y - previous.y);
      output.push(previous.clone().lerp(current, amount));
    }
    if (currentInside) output.push(current.clone());
  }
  return output;
}

function buildCrowns(source, components) {
  const position = source.getAttribute("position");
  const values = [];
  const details = [];
  for (const triangles of components) {
    const bounds = componentBounds(position, triangles);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const crownLimit = bounds.min.y + size.y * 0.705;
    let outputTriangles = 0;
    for (const triangle of triangles) {
      const vertices = [0, 1, 2].map((corner) => {
        const index = triangle * 3 + corner;
        return new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
      });
      const clipped = clipTriangleBelow(vertices, crownLimit);
      if (clipped.length < 3) continue;
      for (let index = 1; index < clipped.length - 1; index++) {
        [clipped[0], clipped[index], clipped[index + 1]].forEach((point) => values.push(point.x, point.y, point.z));
        outputTriangles++;
      }
    }
    details.push({ center: center.toArray(), size: size.toArray(), crownLimit, outputTriangles });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(values, 3));
  return { geometry, details };
}

function closestCurveT(curve, point) {
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= 320; index++) {
    const t = index / 320;
    const candidate = curve.getPointAt(t);
    const dx = candidate.x - point.x;
    const dz = candidate.z - point.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }
  return bestT;
}

function gingivalMargin(t, toothLocations) {
  let closestDistance = Number.POSITIVE_INFINITY;
  let localSpacing = 0.07;
  for (let index = 0; index < toothLocations.length; index++) {
    const distance = Math.abs(t - toothLocations[index]);
    if (distance < closestDistance) {
      closestDistance = distance;
      const left = toothLocations[Math.max(0, index - 1)];
      const right = toothLocations[Math.min(toothLocations.length - 1, index + 1)];
      localSpacing = Math.max(0.035, Math.min(0.095, (right - left) * 0.32));
    }
  }
  const zenith = Math.exp(-(closestDistance * closestDistance) / (2 * localSpacing * localSpacing));
  return -0.105 + zenith * 0.115;
}

function buildGingiva(curve, toothLocations) {
  const segments = 220;
  const section = [
    { normal: 1.03, height: 0 },
    { normal: 1.15, height: 0.14 },
    { normal: 0.88, height: 0.43 },
    { normal: 0.22, height: 0.50 },
    { normal: -0.72, height: 0.43 },
    { normal: -0.94, height: 0.20 },
    { normal: -0.82, height: 0.035 },
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
    const anterior = Math.exp(-Math.pow((t - 0.5) / 0.2, 2));
    const endDistance = Math.min(t, 1 - t);
    const endTaper = 0.62 + 0.38 * THREE.MathUtils.smoothstep(endDistance, 0, 0.1);
    const halfWidth = THREE.MathUtils.lerp(0.33, 0.245, anterior) * endTaper;
    const margin = gingivalMargin(t, toothLocations);
    for (const point of section) {
      const width = halfWidth * point.normal;
      const height = margin + point.height + (point.normal < 0 ? 0.018 : 0);
      vertices.push(center.x + outward.x * width, height, center.z + outward.z * width);
    }
  }

  const sectionCount = section.length;
  for (let segment = 0; segment < segments; segment++) {
    for (let side = 0; side < sectionCount; side++) {
      const nextSide = (side + 1) % sectionCount;
      const a = segment * sectionCount + side;
      const b = (segment + 1) * sectionCount + side;
      const c = (segment + 1) * sectionCount + nextSide;
      const d = segment * sectionCount + nextSide;
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
      const next = (side + 1) % sectionCount;
      if (end === 0) indices.push(centerIndex, base + next, base + side);
      else indices.push(centerIndex, base + side, base + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  return geometry.toNonIndexed();
}

const source = parseStl(inputPath);
const components = splitComponents(source);
if (components.length !== 14) throw new Error(`Expected 14 teeth, found ${components.length}`);
const { geometry: crowns, details } = buildCrowns(source, components);
const curve = createArchCurve();
const toothLocations = details
  .map(({ center }) => closestCurveT(curve, new THREE.Vector3(...center)))
  .sort((left, right) => left - right);
const gingiva = buildGingiva(curve, toothLocations);
writeBinaryStl(crownsPath, crowns);
writeBinaryStl(gingivaPath, gingiva);

console.log(JSON.stringify({
  teeth: components.length,
  toothLocations,
  crowns: { triangles: crowns.getAttribute("position").count / 3, bounds: [crowns.boundingBox?.min.toArray(), crowns.boundingBox?.max.toArray()] },
  gingiva: { triangles: gingiva.getAttribute("position").count / 3, bounds: [gingiva.boundingBox?.min.toArray(), gingiva.boundingBox?.max.toArray()] },
  details,
}, null, 2));
