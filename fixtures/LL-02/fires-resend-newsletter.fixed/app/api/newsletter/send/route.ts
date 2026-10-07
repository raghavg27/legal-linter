import { db } from '@/lib/db';
import { resend } from '@/lib/resend';
import { signToken } from '@/lib/tokens';
import WeeklyDigest from '@/emails/weekly-digest';

export async function POST() {
  const subscribers = await db.subscriber.findMany({ where: { unsubscribed: false } });
  for (const subscriber of subscribers) {
    const unsubscribeUrl = `https://acme.com/api/unsubscribe?token=${signToken(subscriber.email)}`;
    await resend.emails.send({
      from: 'Acme <news@acme.com>',
      to: subscriber.email,
      subject: 'Your weekly digest',
      react: WeeklyDigest({ name: subscriber.name, unsubscribeUrl }),
      headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
  }
  return Response.json({ ok: true });
}
