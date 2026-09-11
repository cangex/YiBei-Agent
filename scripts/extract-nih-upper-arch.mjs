import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/extract-nih-upper-arch.mjs <source.glb> <output.glb>");
}

const source = await readFile(inputPath);
if (source.toString("ascii", 0, 4) !== "glTF" || source.readUInt32LE(4) !== 2) {
  throw new Error("The source must be a binary glTF 2.0 file.");
}

const jsonChunkLength = source.readUInt32LE(12);
const jsonChunkType = source.readUInt32LE(16);
if (jsonChunkType !== 0x4e4f534a) throw new Error("Missing GLB JSON chunk.");

let sourceJsonText = source.subarray(20, 20 + jsonChunkLength).toString("utf8");
while (sourceJsonText.endsWith(String.fromCharCode(0))) sourceJsonText = sourceJsonText.slice(0, -1);
const sourceJson = JSON.parse(sourceJsonText);
const binHeaderOffset = 20 + jsonChunkLength;
const binChunkLength = source.readUInt32LE(binHeaderOffset);
const binChunkType = source.readUInt32LE(binHeaderOffset + 4);
if (binChunkType !== 0x004e4942) throw new Error("Missing GLB BIN chunk.");
const sourceBin = source.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binChunkLength);

const componentBytes = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);
const componentCounts = new Map([
  ["SCALAR", 1],
  ["VEC2", 2],
  ["VEC3", 3],
  ["VEC4", 4],
  ["MAT2", 4],
  ["MAT3", 9],
  ["MAT4", 16],
]);

function copyAccessor(accessorIndex, targetViews, targetAccessors, chunks, byteLengthRef) {
  const accessor = sourceJson.accessors[accessorIndex];
  const sourceView = sourceJson.bufferViews[accessor.bufferView];
  const bytesPerComponent = componentBytes.get(accessor.componentType);
  const components = componentCounts.get(accessor.type);
  if (!bytesPerComponent || !components) throw new Error(`Unsupported accessor ${accessorIndex}.`);
  const elementBytes = bytesPerComponent * components;
  const stride = sourceView.byteStride ?? elementBytes;
  const start = (sourceView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const packed = Buffer.allocUnsafe(accessor.count * elementBytes);
  for (let index = 0; index < accessor.count; index++) {
    sourceBin.copy(packed, index * elementBytes, start + index * stride, start + index * stride + elementBytes);
  }

  const alignedOffset = (byteLengthRef.value + 3) & ~3;
  if (alignedOffset > byteLengthRef.value) chunks.push(Buffer.alloc(alignedOffset - byteLengthRef.value));
  const viewIndex = targetViews.length;
  targetViews.push({ buffer: 0, byteOffset: alignedOffset, byteLength: packed.length });
  const targetAccessor = {
    bufferView: viewIndex,
    byteOffset: 0,
    componentType: accessor.componentType,
    count: accessor.count,
    type: accessor.type,
  };
  if (accessor.normalized) targetAccessor.normalized = true;
  if (accessor.min) targetAccessor.min = accessor.min;
  if (accessor.max) targetAccessor.max = accessor.max;
  targetAccessors.push(targetAccessor);
  chunks.push(packed);
  byteLengthRef.value = alignedOffset + packed.length;
  return targetAccessors.length - 1;
}

const selections = [
  { nodeName: "VH_F_ginviva_of_upper_jaw", displayName: "upper_gingiva", material: 0 },
  { nodeName: "VH_F_set_of_upper_jaw_teeth", displayName: "upper_teeth", material: 1 },
];
const targetViews = [];
const targetAccessors = [];
const targetMeshes = [];
const targetNodes = [];
const chunks = [];
const byteLengthRef = { value: 0 };

for (const selection of selections) {
  const sourceNode = sourceJson.nodes.find((node) => node.name === selection.nodeName);
  if (!sourceNode || sourceNode.mesh === undefined) throw new Error(`Missing ${selection.nodeName}.`);
  const sourceMesh = sourceJson.meshes[sourceNode.mesh];
  const sourcePrimitive = sourceMesh.primitives[0];
  const indices = copyAccessor(sourcePrimitive.indices, targetViews, targetAccessors, chunks, byteLengthRef);
  const position = copyAccessor(sourcePrimitive.attributes.POSITION, targetViews, targetAccessors, chunks, byteLengthRef);
  const normal = copyAccessor(sourcePrimitive.attributes.NORMAL, targetViews, targetAccessors, chunks, byteLengthRef);
  targetMeshes.push({
    name: selection.displayName,
    primitives: [{ indices, attributes: { POSITION: position, NORMAL: normal }, material: selection.material }],
  });
  targetNodes.push({ name: selection.displayName, mesh: targetMeshes.length - 1 });
}

const targetBin = Buffer.concat(chunks);
const targetJson = {
  asset: {
    version: "2.0",
    generator: "Yibei web extraction of NIH HRA Mouth, Female v1.2",
    copyright: "Human Reference Atlas / NIH 3D, CC BY 4.0",
  },
  scene: 0,
  scenes: [{ nodes: targetNodes.map((_, index) => index) }],
  nodes: targetNodes,
  meshes: targetMeshes,
  materials: [
    {
      name: "gingiva",
      pbrMetallicRoughness: { baseColorFactor: [0.78, 0.48, 0.49, 1], metallicFactor: 0, roughnessFactor: 0.42 },
    },
    {
      name: "teeth",
      pbrMetallicRoughness: { baseColorFactor: [0.95, 0.93, 0.86, 1], metallicFactor: 0, roughnessFactor: 0.2 },
    },
  ],
  accessors: targetAccessors,
  bufferViews: targetViews,
  buffers: [{ byteLength: targetBin.length }],
  extras: {
    source: "https://3d.nih.gov/entries/3DPX-022826",
    sourceVersion: "Mouth, Female v1.2",
    license: "CC BY 4.0",
    modification: "Selected the existing upper gingiva and upper tooth-row meshes for real-time web display.",
  },
};

let jsonBuffer = Buffer.from(JSON.stringify(targetJson), "utf8");
const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
if (jsonPadding) jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]);
const binPadding = (4 - (targetBin.length % 4)) % 4;
const paddedBin = binPadding ? Buffer.concat([targetBin, Buffer.alloc(binPadding)]) : targetBin;
const totalLength = 12 + 8 + jsonBuffer.length + 8 + paddedBin.length;
const header = Buffer.alloc(12);
header.write("glTF", 0, "ascii");
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(paddedBin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

await writeFile(outputPath, Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, paddedBin]));
console.log(`Wrote ${outputPath} (${(totalLength / 1024 / 1024).toFixed(2)} MiB).`);
