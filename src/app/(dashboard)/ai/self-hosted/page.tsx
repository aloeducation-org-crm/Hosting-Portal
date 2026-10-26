import { ZeroTerminalDeployAssistant } from "@/components/ai/ZeroTerminalDeployAssistant";

export const metadata = {
  title: "Self-Hosted AI Agents & Sizing",
  description:
    "Deploy hardened self-hosted AI agents, evaluate licensing, and estimate GPU/CPU/RAM capacity.",
};

export default function SelfHostedAgentsPage() {
  return (
    <div className="p-6">
      <ZeroTerminalDeployAssistant />
    </div>
  );
}
