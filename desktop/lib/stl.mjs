export const MAX_STL_BYTES = 24 * 1024 * 1024;
export const MAX_TRIANGLES = 200000;

// Validate before handing untrusted geometry to the expensive Three.js pipeline.
export function inspectSTL(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 15) throw new Error('STL 文件为空或不完整。');
  if (bytes.byteLength > MAX_STL_BYTES) throw new Error('模型超过 24 MB。请先精简网格后再导入。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const point = (x, y, z) => {
    [x, y, z].forEach((v, axis) => {
      if (!Number.isFinite(v) || Math.abs(v) > 1e9) throw new Error('STL 含无效坐标。');
      bounds[axis] = Math.min(bounds[axis], v);
      bounds[axis + 3] = Math.max(bounds[axis + 3], v);
    });
  };
  let triangles = 0;
  if (84 + count * 50 === bytes.byteLength) {
    triangles = count;
    if (!count || count > MAX_TRIANGLES) throw new Error('模型需包含 1–200,000 个三角面。请先精简网格。');
    for (let face = 0; face < count; face++) {
      for (let vertex = 0; vertex < 3; vertex++) {
        const offset = 84 + face * 50 + 12 + vertex * 12;
        point(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      }
    }
  } else {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/^\s*solid\b/i.test(source) || !/endsolid\b/i.test(source)) throw new Error('STL 格式损坏：二进制长度或文本结构不完整。');
    const facets = source.matchAll(/facet\s+normal\s+[^\r\n]+\s+outer\s+loop([\s\S]*?)endloop\s+endfacet/gi);
    for (const facet of facets) {
      const vertices = [...facet[1].matchAll(/vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi)];
      if (vertices.length !== 3) throw new Error('STL 含不完整三角面。');
      for (const v of vertices) point(Number(v[1]), Number(v[2]), Number(v[3]));
      if (++triangles > MAX_TRIANGLES) throw new Error('模型超过 200,000 个三角面。请先精简网格。');
    }
    if (!triangles || (source.match(/\bendfacet\b/gi) || []).length !== triangles) throw new Error('无法读取有效的 STL 三角网格。');
  }
  if (Math.max(...bounds.slice(3).map((v, i) => v - bounds[i])) < 1e-8) throw new Error('STL 空间尺寸为零。');
  return { triangles, bytes: bytes.byteLength, bounds };
}
