import { BufferGeometry, BufferAttribute } from 'three';
import STLWorker from './stl.worker.ts?worker';

export function parseSTL(buffer: ArrayBuffer, signal: AbortSignal, reconstruction = false): Promise<BufferGeometry> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('模型加载已取消', 'AbortError'));
      return;
    }
    // Let Vite emit a same-origin worker URL. Vinext's RSC transform rewrites
    // import.meta.url to a build-time file:// path inside client components.
    let worker: Worker;
    try {
      worker = new STLWorker({ name: 'yibei-stl-parser' });
    } catch (error) {
      reject(new Error('模型解析线程无法启动，请刷新页面后重试。', { cause: error }));
      return;
    }
    const finish = () => { worker.terminate(); clearTimeout(timeout); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('模型加载已取消', 'AbortError')); };
    const timeout = setTimeout(() => { finish(); reject(new Error('模型解析超时，请精简网格后重试。')); }, 30000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) { reject(new Error(data.error)); return; }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
      if (data.plan) geometry.userData.reconstructionPlan = data.plan;
      resolve(geometry);
    };
    worker.onerror = () => { finish(); reject(new Error('模型解析线程启动失败，请重新加载。')); };
    try {
      worker.postMessage(reconstruction ? { buffer, reconstruction } : buffer, [buffer]);
    } catch (error) {
      finish();
      reject(new Error('无法将模型发送至解析线程，请重新导入。', { cause: error }));
    }
  });
}
