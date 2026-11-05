import { isHealthResponse } from '@babmatj/contracts';
export const dynamic = 'force-dynamic';

export async function GET() {
 try {
  const base = new URL(process.env.API_BASE_URL ?? 'http://127.0.0.1:3001');
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Invalid API protocol');
  const response = await fetch(new URL('/api/health', base), {
   cache: 'no-store', signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error('API unavailable');
  const data: unknown = await response.json();
  if (!isHealthResponse(data)) throw new Error('Unexpected API response');
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
 } catch {
  return Response.json({ message: '서버에 연결할 수 없습니다. 잠시 후 다시 확인해주세요.' },
   { status: 503, headers: { 'Cache-Control': 'no-store' } });
 }
}
