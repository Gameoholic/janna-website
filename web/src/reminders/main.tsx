import { createRoot } from 'react-dom/client';
import { AppShell } from '../shared/AppShell';
import { RemindersApp } from './RemindersApp';

createRoot(document.getElementById('root')!).render(
  <AppShell app="reminders">
    <RemindersApp />
  </AppShell>
);
