import LogRocket from 'logrocket';
import { createRoot } from 'react-dom/client';
import App from './App';
import { REPLAY_OPTIONS } from './CookieBanner';

if (localStorage.getItem('consent') === 'yes') {
  LogRocket.init('acme/web-app', REPLAY_OPTIONS);
}

createRoot(document.getElementById('root')!).render(<App />);
