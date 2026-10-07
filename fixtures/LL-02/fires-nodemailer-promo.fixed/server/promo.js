const nodemailer = require('nodemailer');
const { getCustomers } = require('./customers');

const transporter = nodemailer.createTransport({ host: 'smtp.example.com', port: 587 });

async function sendSpringSale() {
  const customers = await getCustomers();
  for (const c of customers) {
    await transporter.sendMail({
      to: c.email,
      subject: 'Spring sale: 20% off this week',
      html: `<h1>Spring sale</h1><p>Take 20% off any plan.</p><p>Shop Example Inc., 500 Main Street, Austin, TX 78701</p><p><a href="https://shop.example/unsubscribe?u=${c.id}">Unsubscribe</a></p>`,
    });
  }
}

module.exports = { sendSpringSale };
