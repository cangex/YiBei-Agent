import type { Metadata } from "next";
import { TwinAIExperience } from "../components/TwinAIExperience";

const title = "双微AI设计智能体及验证平台｜益贝医疗智能体";
const description = "AI生成义齿仿生微织构设计，并通过数字孪生预演力学、流体交换与生物特性。";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, images: [] },
  twitter: { card: "summary", title, description, images: [] },
};

export default function TwinAIPage() {
  return <TwinAIExperience />;
}
