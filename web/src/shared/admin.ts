import { useEffect, useState } from 'react';

/*
 * Developer-only extras (e.g. «Скачать» on videos) appear only when this
 * browser also holds the admin cookie from /dev?key=. She never has it, so
 * she never sees them. Checked once per page load.
 */
let adminCheck: Promise<boolean> | null = null;

function checkAdmin(): Promise<boolean> {
  if (!adminCheck) {
    adminCheck = fetch('/api/admin/whoami', { credentials: 'same-origin' })
      .then((r) => r.ok)
      .catch(() => false);
  }
  return adminCheck;
}

export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    checkAdmin().then((v) => {
      if (alive) setAdmin(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return admin;
}

/** Saves the true original (never the playback proxy) to this computer. */
export function downloadFile(id: string): void {
  const a = document.createElement('a');
  a.href = `/api/download/${id}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
