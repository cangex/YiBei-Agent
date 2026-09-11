import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/build-upper-arch.mjs <source.stl> <output.stl>");
}

const sourceBuffer = readFileSync(inputPath);
const sourceArrayBuffer = sourceBuffer.buffer.slice(
  sourceBuffer.byteOffset,
  sourceBuffer.byteOffset + sourceBuffer.byteLength,
);
const source = new STLLoader().parse(sourceArrayBuffer);
const position = source.getAttribute("position");
const triangleCount = position.count / 3;
const parent = Array.from({ length: triangleCount }, (_, index) => index);

function find(index) {
  let root = index;
  while (parent[root] !== root) root = parent[root];
  while (parent[index] !== index) {
    const next = parent[index];
    parent[index] = root;
    index = next;
  }
  return root;
}

function union(left, right) {
  const leftRoot = find(left);
  const rightRoot = find(right);
  if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
}

const vertexOwner = new Map();
const vertexKey = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
for (let triangle = 0; triangle < triangleCount; triangle += 1) {
  for (let corner = 0; corner < 3; corner += 1) {
    const index = triangle * 3 + corner;
    const key = vertexKey(position.getX(index), position.getY(index), position.getZ(index));
    const owner = vertexOwner.get(key);
    if (owner === undefined) vertexOwner.set(key, triangle);
    else union(triangle, owner);
  }
}

const components = new Map();
for (let triangle = 0; triangle < triangleCount; triangle += 1) {
  const root = find(triangle);
  let component = components.get(root);
  if (!component) {
    component = { triangles: [], verticalSum: 0, vertices: 0 };
    components.set(root, component);
  }
  component.triangles.push(triangle);
  for (let corner = 0; corner < 3; corner += 1) {
    component.verticalSum += position.getZ(triangle * 3 + corner);
    component.vertices += 1;
  }
}

const upperComponents = [...components.values()]
  .filter((component) => component.triangles.length > 100)
  .sort((left, right) => right.verticalSum / right.vertices - left.verticalSum / left.vertices)
  .slice(0, 14);
const selectedTriangles = upperComponents.flatMap((component) => component.triangles);
const outputPositions = new Float32Array(selectedTriangles.length * 9);

selectedTriangles.forEach((triangle, triangleIndex) => {
  for (let corner = 0; corner < 3; corner += 1) {
    const sourceIndex = triangle * 3 + corner;
    const outputIndex = triangleIndex * 9 + corner * 3;
    outputPositions[outputIndex] = position.getX(sourceIndex);
    outputPositions[outputIndex + 1] = position.getZ(sourceIndex);
    outputPositions[outputIndex + 2] = -position.getY(sourceIndex);
  }
});

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(outputPositions, 3));
geometry.computeBoundingBox();
const originalBounds = geometry.boundingBox;
if (!originalBounds) throw new Error("Unable to resolve upper-arch bounds");

const originalHeight = originalBounds.max.y - originalBounds.min.y;
const rootStart = originalBounds.min.y + originalHeight * 0.48;
const outputAttribute = geometry.getAttribute("position");
for (let index = 0; index < outputAttribute.count; index += 1) {
  const y = outputAttribute.getY(index);
  if (y > rootStart) outputAttribute.setY(index, rootStart + (y - rootStart) * 0.28);
}
outputAttribute.needsUpdate = true;
geometry.computeBoundingBox();
const compressedBounds = geometry.boundingBox;
if (!compressedBounds) throw new Error("Unable to resolve compressed upper-arch bounds");
const center = compressedBounds.getCenter(new THREE.Vector3());
const size = compressedBounds.getSize(new THREE.Vector3());
const normalization = 3.5 / Math.max(size.x, 0.001);
geometry.translate(-center.x, -center.y, -center.z);
geometry.scale(normalization, normalization, normalization);
geometry.computeVertexNormals();
geometry.computeBoundingBox();
geometry.computeBoundingSphere();

const binary = new STLExporter().parse(new THREE.Mesh(geometry), { binary: true });
const binaryBuffer = binary instanceof DataView
  ? Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength)
  : Buffer.from(binary);
writeFileSync(outputPath, binaryBuffer);
console.log(JSON.stringify({
  sourceTriangles: triangleCount,
  selectedTeeth: upperComponents.length,
  outputTriangles: selectedTriangles.length,
  outputBounds: {
    min: geometry.boundingBox?.min.toArray(),
    max: geometry.boundingBox?.max.toArray(),
  },
}, null, 2));
