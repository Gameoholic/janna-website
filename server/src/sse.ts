import { Request, Response } from 'express';

/**
 * Real-time channel to every open app window (any of the three apps).
 * Carries alarm ring/stop events so the takeover appears instantly and a
 * dismiss on one device stops the ringing everywhere (P9).
 */
const clients = new Set<Response>();

export function addSseClient(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
  });
}

export function broadcast(type: string, data: unknown): void {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function sseClientCount(): number {
  return clients.size;
}

setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 25_000).unref();
