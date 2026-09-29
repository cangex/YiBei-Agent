import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { WebProjectProvider } from "./components/ProjectSession";

const title = "益贝医疗智能体｜智能义齿设计与数字孪生验证";
const description = "从义齿三维轮廓超精准重建，到仿生微织构AI设计与数字孪生验证。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, images: [{ url: image, width: 1536, height: 1024, alt: "益贝医疗智能体" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><WebProjectProvider>{children}</WebProjectProvider></body></html>;
}
