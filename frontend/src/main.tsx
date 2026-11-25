import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Hausschrift Ubuntu (UFL-1.0), wird mitgebaut – kein Abruf aus dem Internet
import '@fontsource/ubuntu/latin-400.css';
import '@fontsource/ubuntu/latin-500.css';
import '@fontsource/ubuntu/latin-700.css';
import '@fontsource/ubuntu/latin-ext-400.css';
import '@fontsource/ubuntu/latin-ext-700.css';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
