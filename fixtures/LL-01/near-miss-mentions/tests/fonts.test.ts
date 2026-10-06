import { expect, it } from 'vitest';
import { render } from './render';

it('does not load Google Fonts', async () => {
  const html = await render('/');
  expect(html).not.toContain('https://fonts.googleapis.com/css2?family=Inter');
});
