export function printTrip(title: string, bodyHtml: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html>
<html>
<head>
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
<style>body { font-family: 'Inter', sans-serif; }</style>
</head>
<body>${bodyHtml}</body>
</html>`);
  win.document.close();
  win.print();
}
