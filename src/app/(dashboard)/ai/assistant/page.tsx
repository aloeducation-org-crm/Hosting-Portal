import ZeroTerminalStackStudio from "@/components/ai/ZeroTerminalStackStudio";

export const metadata = {
  title: "Zero-Terminal AI Deployment & Stack Presets",
  description:
    "Deploy websites, isolated workspaces, databases, and self-hosted AI agent stacks without SSH or CLI.",
};

export default function AIAssistantPage() {
  return <ZeroTerminalStackStudio />;
}
