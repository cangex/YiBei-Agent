import Link from "next/link";

export function ProductNav({ section }: { section: string }) {
  return (
    <header className="product-nav">
      <Link className="brand-lockup" href="/" aria-label="返回益贝医疗智能体首页">
        <span className="brand-mark" aria-hidden="true"><i /><i /></span>
        <span>益贝医疗智能体</span>
      </Link>
      <div className="product-nav-path"><span>核心产品</span><i />{section}</div>
      <Link className="nav-home" href="/">返回总览 <span>↗</span></Link>
    </header>
  );
}
