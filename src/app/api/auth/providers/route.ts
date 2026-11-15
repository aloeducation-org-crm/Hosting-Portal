import { NextResponse } from 'next/server';
import { apiSuccess } from '@/lib/response';

function isConfigured(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length >= 8 && !trimmed.toLowerCase().includes('replace_with');
}

export async function GET() {
  const providers = [
    {
      id: 'credentials',
      name: 'Email & Password',
      enabled: true,
    },
    {
      id: 'google',
      name: 'Google',
      enabled: isConfigured(process.env.GOOGLE_CLIENT_ID) && isConfigured(process.env.GOOGLE_CLIENT_SECRET),
    },
    {
      id: 'github',
      name: 'GitHub',
      enabled: isConfigured(process.env.GITHUB_CLIENT_ID) && isConfigured(process.env.GITHUB_CLIENT_SECRET),
    },
    {
      id: 'saml',
      name: 'SAML SSO',
      enabled: false,
      note: 'Enterprise SAML/OIDC SSO configuration is stored encrypted for future runtime integration',
    },
  ];
  return NextResponse.json(apiSuccess(providers));
}
