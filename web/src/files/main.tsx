import { createRoot } from 'react-dom/client';
import { AppShell } from '../shared/AppShell';
import { FilesApp } from './FilesApp';

createRoot(document.getElementById('root')!).render(
  <AppShell app="files">
    <FilesApp />
  </AppShell>
);
