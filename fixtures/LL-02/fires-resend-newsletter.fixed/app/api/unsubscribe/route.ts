import { db } from '@/lib/db';
import { verifyToken } from '@/lib/tokens';

export async function POST(request: Request) {
  const email = verifyToken(new URL(request.url).searchParams.get('token'));
  await db.subscriber.update({ where: { email }, data: { unsubscribed: true } });
  return new Response(null, { status: 204 });
}
