import { createRoot } from 'react-dom/client';
import { AppShell } from '../shared/AppShell';
import { VoiceApp } from './VoiceApp';

createRoot(document.getElementById('root')!).render(
  <AppShell app="voice">
    <VoiceApp />
  </AppShell>
);
