import { resend } from '@/lib/resend';
import ResetPassword from '@/emails/reset-password';

export async function POST(request: Request) {
  const { email, url } = await request.json();
  await resend.emails.send({
    from: 'Acme <security@acme.com>',
    to: email,
    subject: 'Reset your password',
    react: ResetPassword({ url }),
  });
  return new Response(null, { status: 204 });
}
