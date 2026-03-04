// utils/broadcast.js

import { WebSocketServer } from 'ws';

export const wsClients = new Set();

export function initWebSocket(server, options = {}) {
  const resolveUserId =
    typeof options.resolveUserId === 'function' ? options.resolveUserId : null;
  const allowQueryFallback = options.allowQueryFallback !== false;
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    ws.userId = null;
    if (resolveUserId) {
      ws.userId = resolveUserId(req) || null;
    }
    if (!ws.userId && allowQueryFallback) {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        ws.userId = url.searchParams.get('userId') || null;
      } catch {
        ws.userId = null;
      }
    }

    wsClients.add(ws);
    console.log(`[WebSocket] Client connected | userId: ${ws.userId || '(none - using anonymous)'} | Total clients: ${wsClients.size}`);

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      wsClients.delete(ws);
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`[WebSocket] Client disconnected | userId: ${ws.userId || '(none)'} | Remaining clients: ${wsClients.size}`);
    });
  });
}

export function broadcast(message, userId = null) {
  const data = JSON.stringify(message);
  wsClients.forEach(client => {
    if (userId && client.userId !== userId) {
      return;
    }
    if (client.readyState === 1) {
      try {
        client.send(data);
      } catch (err) {
        console.error('Error broadcasting to client:', err);
        wsClients.delete(client);
      }
    }
  });
}
