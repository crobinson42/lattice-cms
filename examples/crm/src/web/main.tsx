import '@latticecms/admin/admin.css';
import './page.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';

// The page serves every path that is not the API's. Until the app at / is
// built, every path outside the admin goes to it.
if (!/^\/admin(\/|$)/.test(window.location.pathname)) {
  window.history.replaceState(null, '', '/admin');
}

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
