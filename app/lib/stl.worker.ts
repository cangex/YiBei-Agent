import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { inspectSTL } from '../../desktop/lib/stl.mjs';
import { buildReconstructionPlan } from './reconstruction-plan';
self.onmessage = (event: MessageEvent<ArrayBuffer | { buffer: ArrayBuffer; reconstruction: boolean }>) => {
  try {
    const buffer = event.data instanceof ArrayBuffer ? event.data : event.data.buffer;
    inspectSTL(new Uint8Array(buffer));
    const geometry = new STLLoader().parse(buffer);
    geometry.computeVertexNormals();
    const positions = new Float32Array(geometry.getAttribute('position').array);
    const normals = new Float32Array(geometry.getAttribute('normal').array);
    const plan = !(event.data instanceof ArrayBuffer) && event.data.reconstruction ? buildReconstructionPlan(positions) : undefined;
    self.postMessage({ positions, normals, plan }, { transfer: [positions.buffer, normals.buffer] });
    geometry.dispose();
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'STL 解析失败' }); }
};
