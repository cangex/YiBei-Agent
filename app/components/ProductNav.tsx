/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */

type ProductNavProps = {
  section: string;
  brandVariant?: "default" | "reconstruction";
};

export function ProductNav({ section, brandVariant = "default" }: ProductNavProps) {
  const reconstructionBrand = brandVariant === "reconstruction";

  return (
    <header className="product-nav">
      <a className={`brand-lockup ${reconstructionBrand ? "is-reconstruction-brand" : ""}`} href="/" aria-label="返回益贝医疗智能体首页">
        {reconstructionBrand ? (
          <span className="product-brand-logo" aria-hidden="true">
            <img src="/brand/yibei-medical-logo.png" width="1608" height="1998" alt="" />
          </span>
        ) : (
          <span className="brand-mark" aria-hidden="true"><i /><i /></span>
        )}
        <span>益贝医疗智能体</span>
      </a>
      <div className="product-nav-path"><span>核心产品</span><i />{section}</div>
      <a className="nav-home" href="/">返回总览 <span>↗</span></a>
    </header>
  );
}
