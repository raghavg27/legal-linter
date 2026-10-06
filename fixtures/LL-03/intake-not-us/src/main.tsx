import LogRocket from 'logrocket';
import { createRoot } from 'react-dom/client';
import App from './App';

LogRocket.init('acme/web-app');

createRoot(document.getElementById('root')!).render(<App />);
