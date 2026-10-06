const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;800&display=swap';

export function applyTheme() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_CSS;
  document.head.appendChild(link);
}
