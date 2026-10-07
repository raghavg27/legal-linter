import sgMail from '@sendgrid/mail';

export async function sendProductUpdates(to: string[]) {
  await sgMail.send({
    to,
    from: 'updates@acme.com',
    subject: 'Product updates for March',
    html: '<p>Three new features shipped.</p><p>Acme Inc., 100 Market Street, San Francisco, CA 94105</p><a href="<%asm_group_unsubscribe_raw_url%>">Unsubscribe</a>',
    asm: { groupId: 12345 },
  });
}
