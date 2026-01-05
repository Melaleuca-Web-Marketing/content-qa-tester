// utils/broadcast.js

import { WebSocketServer } from 'ws';

export const wsClients = new Set();

export function initWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      ws.userId = url.searchParams.get('userId') || null;
    } catch {
      ws.userId = null;
    }

    wsClients.add(ws);
    console.log('WebSocket client connected');

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      wsClients.delete(ws);
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log('WebSocket client disconnected');
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
