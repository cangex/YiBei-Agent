/* eslint-disable @next/next/no-html-link-for-pages */

export function ProductNav({ section }: { section: string }) {
  return (
    <header className="product-nav">
      <a className="brand-lockup" href="/" aria-label="返回益贝医疗智能体首页">
        <span className="brand-mark" aria-hidden="true"><i /><i /></span>
        <span>益贝医疗智能体</span>
      </a>
      <div className="product-nav-path"><span>核心产品</span><i />{section}</div>
      <a className="nav-home" href="/">返回总览 <span>↗</span></a>
    </header>
  );
}
