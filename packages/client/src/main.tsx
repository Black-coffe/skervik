// Client entry point — placeholder until E1.6.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('No #root element found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <h1>Skerry — coming soon</h1>
  </StrictMode>,
);
