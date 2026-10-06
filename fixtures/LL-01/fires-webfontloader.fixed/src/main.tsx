import { createRoot } from 'react-dom/client';
import { loadFonts } from './fonts';

loadFonts();
createRoot(document.getElementById('root')!).render(<h1>Hello</h1>);
