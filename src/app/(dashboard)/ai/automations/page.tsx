import { AutomationsConsole } from "@/components/ai/AutomationsConsole";

export const metadata = {
  title: "AI automations",
  description: "Run server-side AI workflows against the configured provider chain.",
};

export default function AIAutomationsPage() {
  return <AutomationsConsole />;
}
