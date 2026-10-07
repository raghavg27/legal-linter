const express = require('express');
const { pool } = require('./db');

const app = express();

app.get('/unsubscribe', async (req, res) => {
  await pool.query('UPDATE customers SET unsubscribed = true WHERE id = $1', [req.query.u]);
  res.send('You have been unsubscribed.');
});

app.listen(3000);
