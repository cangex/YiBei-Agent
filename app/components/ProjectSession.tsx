"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type Workflow = { step: number; progress: number; complete: boolean; started: boolean; triangles?: number; repairVersion?: 'surface-demo-2'; schemeIndex?: number; selectedRegionId?: string | null; candidates?: unknown[] };
export type Project = { id: string; name: string; updatedAt: string; model: { originalName: string; sha256: string; triangles: number }; modelUrl: string; state: Record<string, Workflow>; location?: string; quality?: string };
export type ProjectSession = {
  project: Project;
  ready?: boolean;
  checkpoint: (module: 'reconstruction' | 'twin', state: Workflow) => void;
  importFile: (file: File) => Promise<void>;
};
export const ProjectContext = createContext<ProjectSession | null>(null);
export const useProjectSession = () => useContext(ProjectContext);

// Web-only persistence. Desktop uses the main-process atomic filesystem store.
async function webDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('yibei-local-project', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('session');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('浏览器本地存储不可用。'));
  });
}
async function webRead() {
  const db = await webDB();
  try { return await new Promise<{ project: Project; file?: File } | undefined>((resolve, reject) => {
    const request = db.transaction('session').objectStore('session').get('active');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
async function webWrite(value: { project: Project; file?: File }) {
  const db = await webDB();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('session', 'readwrite');
    transaction.objectStore('session').put(value, 'active');
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  }); } finally { db.close(); }
}
const defaultProject: Project = { id: 'web-default', name: '本地演示', updatedAt: '', model: { originalName: '测试.stl', sha256: 'default', triangles: 41176 }, modelUrl: '/models/demo.stl', state: {} };

export function WebProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(() => ({ ...defaultProject, state: {} }));
  const [warning, setWarning] = useState('');
  const current = useRef<{ project: Project; file?: File }>({ project });
  const objectURL = useRef<string | undefined>(undefined);
  const changed = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let disposed = false;
    webRead().then((saved) => {
      if (!saved || disposed) return;
      if (saved.file) objectURL.current = URL.createObjectURL(saved.file);
      saved.project.modelUrl = objectURL.current || '/models/demo.stl';
      current.current = saved; setProject(saved.project);
    }).catch(() => setWarning('浏览器无法保存项目，刷新后可能需要重新导入模型。')).finally(() => { if (!disposed) setHydrated(true); });
    const timer = setInterval(() => {
      if (!changed.current) return;
      changed.current = false;
      webWrite(current.current).catch(() => { changed.current = true; setWarning('本地保存失败，请检查浏览器存储空间。'); });
    }, 1000);
    return () => { disposed = true; clearInterval(timer); if (objectURL.current) URL.revokeObjectURL(objectURL.current); };
  }, []);
  const checkpoint = useCallback((module: 'reconstruction' | 'twin', state: Workflow) => {
    const previous = current.current.project.state[module];
    current.current.project.state[module] = state; changed.current = true;
    if (previous && (previous.step !== state.step || previous.complete !== state.complete || previous.started !== state.started)) {
      webWrite(current.current).catch(() => { changed.current = true; setWarning('本地保存失败，请检查浏览器存储空间。'); });
    }
  }, []);
  const importFile = useCallback(async (file: File) => {
    const { inspectSTL } = await import('../../desktop/lib/stl.mjs');
    const geometry = inspectSTL(new Uint8Array(await file.arrayBuffer()));
    const next: Project = { ...defaultProject, id: crypto.randomUUID(), state: {}, model: { originalName: file.name, sha256: crypto.randomUUID(), triangles: geometry.triangles }, modelUrl: '' };
    await webWrite({ project: next, file });
    if (objectURL.current) URL.revokeObjectURL(objectURL.current);
    objectURL.current = URL.createObjectURL(file); next.modelUrl = objectURL.current;
    current.current = { project: next, file }; changed.current = false; setProject(next); setWarning('');
  }, []);
  return <ProjectContext.Provider value={{ project, checkpoint, importFile, ready: hydrated }}>
    {warning && <div role="status" style={{ padding: '8px 24px', background: '#fff3df', color: '#6e4a18', fontSize: 13 }}>{warning}</div>}
    <div key={`${project.id}/${project.model.sha256}/${hydrated ? 'restored' : 'loading'}`}>{children}</div>
  </ProjectContext.Provider>;
}
