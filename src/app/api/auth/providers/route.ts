import { NextResponse } from 'next/server';
import { apiSuccess } from '@/lib/response';

const providers = [
  {
    id: 'credentials',
    name: 'Email & Password',
    enabled: true,
  },
  {
    id: 'google',
    name: 'Google',
    enabled: !!process.env.GOOGLE_CLIENT_ID,
  },
  {
    id: 'github',
    name: 'GitHub',
    enabled: !!process.env.GITHUB_CLIENT_ID,
  },
  {
    id: 'saml',
    name: 'SAML SSO',
    enabled: process.env.SSO_ENABLED === 'true',
  },
];

export async function GET() {
  return NextResponse.json(apiSuccess(providers));
}
