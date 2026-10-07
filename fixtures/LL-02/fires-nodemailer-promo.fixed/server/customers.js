const { pool } = require('./db');

async function getCustomers() {
  const { rows } = await pool.query('SELECT id, email FROM customers WHERE unsubscribed = false');
  return rows;
}

module.exports = { getCustomers };
