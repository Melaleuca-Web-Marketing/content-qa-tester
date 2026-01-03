// utils/broadcast.js

import { WebSocketServer } from 'ws';

export const wsClients = new Set();

export function initWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
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

export function broadcast(message) {
  const data = JSON.stringify(message);
  wsClients.forEach(client => {
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
