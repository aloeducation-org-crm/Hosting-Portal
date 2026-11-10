export const runtime = 'nodejs';
export async function GET() {
  return Response.json(
    {
      status: 'ok',
      ts: new Date().toISOString(),
      uptime_s: process.uptime().toFixed(0),
      node: process.version,
      host: process.env.HOSTNAME || 'alo-server-lap'
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
