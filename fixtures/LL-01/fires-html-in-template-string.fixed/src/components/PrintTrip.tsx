export function printTrip(title: string, bodyHtml: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html>
<html>
<head>
<title>${title}</title>
<style>
@font-face { font-family: 'Inter'; src: url('${window.location.origin}/fonts/inter-400.woff2') format('woff2'); }
body { font-family: 'Inter', sans-serif; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`);
  win.document.close();
  win.print();
}
