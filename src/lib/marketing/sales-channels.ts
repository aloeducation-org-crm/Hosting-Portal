/** Planning metadata only: no channel is represented as connected. */
export const SALES_CHANNELS = [
  { id: "website", name: "Website & landing pages", medium: "website", description: "Capture enquiries from your own storefront.", prerequisite: "Published landing page, consent notice and CRM lead destination." },
  { id: "facebook", name: "Facebook & Instagram", medium: "social", description: "Plan social campaigns and route enquiries to your team.", prerequisite: "Business account access, approved creative and Meta permissions for live integrations." },
  { id: "whatsapp", name: "WhatsApp Business", medium: "messaging", description: "Share offers and follow up with opted-in prospects.", prerequisite: "Customer consent; approved Business Platform credentials and templates for automated sending." },
  { id: "email", name: "Email campaigns", medium: "email", description: "Nurture prospects with targeted follow-ups.", prerequisite: "Consented audience, verified sending domain, mail provider and unsubscribe handling." },
  { id: "marketplace", name: "Marketplaces", medium: "marketplace", description: "Coordinate product listings and marketplace enquiries.", prerequisite: "Seller account, approved listings and provider access for order synchronisation." },
  { id: "partners", name: "Partners & referrals", medium: "referral", description: "Attribute introductions from resellers and partners.", prerequisite: "Partner agreement, referral identifiers and an agreed CRM hand-off." },
] as const;

export function buildCampaignLink(destination: string, channelId: string, campaign: string): string {
  const channel = SALES_CHANNELS.find((item) => item.id === channelId);
  if (!channel) throw new Error("Select a supported sales channel.");
  if (!campaign.trim() || campaign.trim().length > 120) throw new Error("Enter a campaign name of 1–120 characters.");
  let url: URL;
  try { url = new URL(destination); } catch { throw new Error("Enter a complete HTTPS destination URL."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS URL without embedded credentials.");
  url.searchParams.set("utm_source", channel.id);
  url.searchParams.set("utm_medium", channel.medium);
  url.searchParams.set("utm_campaign", campaign.trim());
  return url.toString();
}
