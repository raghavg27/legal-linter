import Clarity from '@microsoft/clarity';
import * as CookieConsent from 'vanilla-cookieconsent';

CookieConsent.run({
  categories: { analytics: {} },
  onConsent: () => {
    if (CookieConsent.acceptedCategory('analytics')) Clarity.init('abc123');
  },
});
