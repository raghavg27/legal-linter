const express = require('express');
const multer = require('multer');

const upload = multer({ dest: 'public/uploads/' });
const app = express();

app.use(express.static('public'));
app.post('/api/photos', upload.single('photo'), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.listen(3000);
