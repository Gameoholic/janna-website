import { createRoot } from 'react-dom/client';
import { AppShell } from '../shared/AppShell';
import { VideoApp } from './VideoApp';

createRoot(document.getElementById('root')!).render(
  <AppShell app="video">
    <VideoApp />
  </AppShell>
);
