import WebFont from 'webfontloader';

export function loadFonts() {
  WebFont.load({
    google: { families: ['Lato:400,700'] },
  });
}
