const { pool } = require('./db');

async function getCustomers() {
  const { rows } = await pool.query('SELECT id, email FROM customers');
  return rows;
}

module.exports = { getCustomers };
