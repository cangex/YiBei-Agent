import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, Component, type ReactNode } from 'react';
import Home from '../app/page';
import { ReconstructionExperience } from '../app/components/ReconstructionExperience';
import { TwinAIExperience } from '../app/components/TwinAIExperience';
import { ProjectContext, type Project, type Workflow } from '../app/components/ProjectSession';
import '../app/globals.css';
import './desktop.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <div className="desktop-error"><h1>当前界面暂时无法显示</h1><p>已保存的项目仍然保留。请重新加载，或重新启动软件。</p><button onClick={() => location.reload()}>重新加载</button></div> : this.props.children; }
}

function DesktopApp({ initial }: { initial: Project }) {
  const [project, setProject] = useState(initial);
  const [route, setRoute] = useState(location.pathname);
  const [status, setStatus] = useState('已保存在本机');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newDialog, setNewDialog] = useState(false);
  const [name, setName] = useState('');
  const [help, setHelp] = useState(false);
  const [quality, setQuality] = useState(initial.quality || 'balanced');
  const [generation, setGeneration] = useState(0);
  const current = useRef(initial);
  const revision = useRef(0), savedRevision = useRef(0);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const busyRef = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (newDialog) nameInput.current?.focus(); }, [newDialog]);
  const updateProject = useCallback((next: Project) => { current.current = next; revision.current = 0; savedRevision.current = 0; setProject(next); setStatus('已保存在本机'); }, []);
  const checkpoint = useCallback((module: 'reconstruction' | 'twin', state: Workflow) => {
    const previous = current.current.state[module];
    if (JSON.stringify(previous) === JSON.stringify(state)) return;
    current.current.state = { ...current.current.state, [module]: state }; revision.current++;
  }, []);
  const save = useCallback(async (force = false) => {
    if (!force && revision.current === savedRevision.current) return;
    const captured = structuredClone(current.current), capturedRevision = revision.current;
    const next = pending.current.catch(() => {}).then(async () => {
      setStatus('正在保存…');
      const saved = await window.yibeiDesktop.save(captured.id, captured.state);
      if (current.current.id === saved.id) { savedRevision.current = capturedRevision; setStatus('已保存在本机'); }
    });
    pending.current = next;
    await next;
  }, []);
  const safely = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试'); setStatus('尚未保存，请重试'); }
    finally { busyRef.current = false; setBusy(false); }
  }, []);
  const navigate = useCallback(async (url: string) => {
    await save(); history.pushState({}, '', url); setRoute(new URL(url, location.origin).pathname); window.scrollTo(0, 0);
  }, [save]);
  const openProject = useCallback(() => safely(async () => { await save(true); const next = await window.yibeiDesktop.open(); if (next) { updateProject(next); await navigate('/reconstruction'); } }), [navigate, safely, save, updateProject]);
  const importFile = useCallback(async (file: File) => {
    if (busyRef.current) throw new Error('请等待当前文件操作完成。');
    if (file.size > 24 * 1024 * 1024) throw new Error('模型超过 24 MB，请先精简网格。');
    busyRef.current = true; setBusy(true); setStatus('正在检查并保存 STL…');
    try {
      await save();
      const next = await window.yibeiDesktop.importSTL(current.current.id, new Uint8Array(await file.arrayBuffer()), file.name);
      updateProject(next); setGeneration((v) => v + 1);
    } finally { busyRef.current = false; setBusy(false); }
  }, [save, updateProject]);
  useEffect(() => {
    document.documentElement.dataset.renderQuality = quality;
    window.dispatchEvent(new Event('yibei-quality-change'));
  }, [quality]);
  useEffect(() => {
    const timer = setInterval(() => { if (!busyRef.current) save().catch((e) => { setError(e.message); setStatus('自动保存失败'); }); }, 1000);
    return () => clearInterval(timer);
  }, [save]);
  useEffect(() => window.yibeiDesktop.onAction((action) => {
    if (action === 'new') setNewDialog(true);
    if (action === 'open') void openProject();
    if (action === 'save') void safely(() => save(true));
    if (action === 'help') setHelp(true);
    if (action === 'reload') void safely(async () => { await save(true); location.reload(); });
    if (action === 'close') void safely(async () => { await save(true); await window.yibeiDesktop.closeReady(); });
  }), [openProject, safely, save]);
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || event.defaultPrevented) return;
      const url = new URL(anchor.href, location.origin);
      if (url.origin !== location.origin) { event.preventDefault(); window.open(url.href, '_blank'); return; }
      if (!['/','/reconstruction','/twin-ai'].includes(url.pathname)) return;
      event.preventDefault(); void safely(() => navigate(url.pathname + url.search));
    };
    const pop = () => setRoute(location.pathname);
    document.addEventListener('click', click); window.addEventListener('popstate', pop);
    return () => { document.removeEventListener('click', click); window.removeEventListener('popstate', pop); };
  }, [navigate, safely]);
  return <>
    <div className="desktop-projectbar">
      <span className="desktop-project-name" title={project.location}><i />{project.name}</span>
      <nav aria-label="本地项目"><button disabled={busy} onClick={() => { setName(''); setNewDialog(true); }}>新建</button><button disabled={busy} onClick={openProject}>打开</button><button disabled={busy} onClick={() => safely(() => save(true))}>保存项目</button></nav>
      <span className="desktop-save-status" role="status">{status}</span>
      <label className="desktop-quality">画质 <select aria-label="渲染质量" value={quality} disabled={busy} onChange={(e) => { const value = e.target.value; void safely(async () => { await window.yibeiDesktop.quality(value); await save(); document.documentElement.dataset.renderQuality = value; setQuality(value); setGeneration((v) => v + 1); }); }}><option value="high">精细</option><option value="balanced">均衡</option><option value="economy">节能</option></select></label>
      <button title="本地项目使用说明" onClick={() => setHelp(true)}>?</button>
    </div>
    {error && <div className="desktop-error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')}>关闭</button></div>}
    <ProjectContext.Provider value={{ project, checkpoint, importFile }}>
      <ErrorBoundary key={`${project.id}/${project.model.sha256}/${generation}`}>
        <div className="desktop-page" key={`${route}/${project.id}/${project.model.sha256}/${generation}`}>
          {route === '/reconstruction' ? <ReconstructionExperience /> : route === '/twin-ai' ? <TwinAIExperience /> : <Home />}
        </div>
      </ErrorBoundary>
    </ProjectContext.Provider>
    {newDialog && <div className="desktop-modal-backdrop"><form className="desktop-modal" onSubmit={(event) => { event.preventDefault(); void safely(async () => { await save(true); updateProject(await window.yibeiDesktop.create(name.trim() || '未命名项目')); setNewDialog(false); await navigate('/reconstruction'); }); }}>
      <span className="eyebrow">LOCAL PROJECT</span><h2>开启新的设计</h2><p>原始模型与演示进度将独立保存在本机。现有项目会自动保存。</p>
      <label>项目名称<input ref={nameInput} maxLength={80} placeholder="例如：客户演示 · 方案研究" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <footer><button type="button" disabled={busy} onClick={() => setNewDialog(false)}>取消</button><button disabled={busy} type="submit">创建项目 →</button></footer>
    </form></div>}
    {help && <div className="desktop-modal-backdrop"><section className="desktop-modal" role="dialog" aria-modal="true" aria-label="使用说明"><span className="eyebrow">OFFLINE WORKSPACE</span><h2>设计，保存在你的电脑中。</h2><p>新建项目后，在重建页面导入 STL。完成重建后进入双微设计，两款产品会使用同一个原始模型。进度每秒自动保存，也可按 Ctrl+S 手动保存。</p><p>重新打开软件会恢复上次项目。未完成流程会从保存的阶段继续；再次运行可重新演示。</p><p>备份或通过 U 盘转移时，请复制整个项目文件夹（含 project.yibei 和 models）。不能只复制项目描述文件。</p><p>重建与仿真为确定性前端演示，未生成真实修复后的 STL，不用于临床决策。模型上限 24 MB / 20 万三角面。</p><footer><button onClick={() => window.yibeiDesktop.reveal()}>打开项目目录</button><button onClick={() => setHelp(false)}>知道了</button></footer></section></div>}
  </>;
}

window.yibeiDesktop.read().then((project) => {
  document.documentElement.dataset.renderQuality = project.quality || 'balanced';
  createRoot(document.getElementById('root')!).render(<DesktopApp initial={project} />);
}).catch((error) => {
  createRoot(document.getElementById('root')!).render(<div className="desktop-error"><h1>项目暂时无法打开</h1><p>{error.message}</p><button onClick={() => location.reload()}>重试</button></div>);
});
