import { db } from '@/lib/db';
import { resend } from '@/lib/resend';
import WeeklyDigest from '@/emails/weekly-digest';

export async function POST() {
  const subscribers = await db.subscriber.findMany();
  for (const subscriber of subscribers) {
    await resend.emails.send({
      from: 'Acme <news@acme.com>',
      to: subscriber.email,
      subject: 'Your weekly digest',
      react: WeeklyDigest({ name: subscriber.name }),
    });
  }
  return Response.json({ ok: true });
}
