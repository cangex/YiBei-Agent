import type { Metadata } from "next";
import { ReconstructionExperience } from "../components/ReconstructionExperience";

const title = "义齿三维轮廓超精准重建智能体｜益贝医疗智能体";
const description = "上传STL，体验义齿网格解析、异常识别、智能补全与误差校验的完整三维重建过程。";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, images: [] },
  twitter: { card: "summary", title, description, images: [] },
};

export default function ReconstructionPage() {
  return <ReconstructionExperience />;
}
