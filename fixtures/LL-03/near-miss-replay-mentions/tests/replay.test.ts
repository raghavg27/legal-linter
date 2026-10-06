import LogRocket from 'logrocket';
import { it } from 'vitest';

it('initialises in tests only', () => {
  LogRocket.init('acme/test');
});
