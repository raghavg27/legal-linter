import { resend } from './resend';
import Welcome from '../emails/welcome';

export async function sendWelcome(email: string, name: string) {
  await resend.emails.send({
    from: 'Acme <hello@acme.com>',
    to: email,
    subject: 'Welcome to Acme',
    react: Welcome({ name }),
  });
}
