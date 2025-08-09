// server.js
// Simple low-latency WebSocket relay for ESP32 binary telemetry (32 bytes packets).
// - Forwards binary packets unchanged to other connected clients (browsers).
// - Disables permessage-deflate (compression) for lower latency.
// - Sets TCP_NODELAY to reduce small-packet buffering.

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public'); // serves front-end

// ---------- Express + HTTP server ----------
const app = express();
app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);

// ---------- WebSocket server (no compression) ----------
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false // disable compression to reduce latency
});

console.log('Starting WebSocket server...');

wss.on('connection', (ws, req) => {
  const remote = req.socket.remoteAddress + ':' + req.socket.remotePort;
  console.log(`Client connected: ${remote}`);

  // Disable Nagle's algorithm (send small packets immediately)
  if (ws._socket && typeof ws._socket.setNoDelay === 'function') {
    ws._socket.setNoDelay(true);
  }

  ws.on('message', (message, isBinary) => {
    // Fast path: binary telemetry packets (expected 32 bytes)
    if (isBinary && Buffer.isBuffer(message) && message.length === 32) {
      // Optional: quick parse for logging (non-blocking, low-cost)
      try {
        // seq: uint32le, ts_ms: uint32le, then 6 floats (little-endian)
        const seq = message.readUInt32LE(0);
        const ts_ms = message.readUInt32LE(4);
        const pitch = message.readFloatLE(8);
        const roll  = message.readFloatLE(12);
        const yaw   = message.readFloatLE(16);
        const temp  = message.readFloatLE(20);
        const hum   = message.readFloatLE(24);
        const batt  = message.readFloatLE(28);

        const now = Date.now();
        const latencyEstimateMs = now - ts_ms; // coarse E2E estimate (ESP32 millis -> server epoch might differ)

        // Light logging (one line)
        // Comment out if too chatty for performance
        console.log(`T#${seq} | lat~${latencyEstimateMs}ms | P:${pitch.toFixed(1)} R:${roll.toFixed(1)} Y:${yaw.toFixed(1)} | T:${temp.toFixed(1)}C H:${hum.toFixed(1)}% V:${batt.toFixed(2)}V`);
      } catch (err) {
        // ignore parse errors, still forward below
        // (we intentionally don't fail on parse errors)
      }

      // Broadcast the binary packet to all other connected clients (browsers)
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message, { binary: true }, (err) => {
            if (err) {
              // small error reporting; don't crash
              console.warn('Forward error (binary):', err.message || err);
            }
          });
        }
      });

      return; // done with this message
    }

    // Text / JSON path: forward as text to other clients
    if (!isBinary) {
      // optionally validate JSON, but here we just forward quickly
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message, { binary: false }, (err) => {
            if (err) {
              console.warn('Forward error (text):', err.message || err);
            }
          });
        }
      });
      return;
    }

    // Other binary sizes: forward as-is (generic)
    if (isBinary && Buffer.isBuffer(message)) {
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message, { binary: true }, (err) => {
            if (err) console.warn('Forward error (other-binary):', err.message || err);
          });
        }
      });
      return;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`Client disconnected: ${remote} code=${code} reason=${String(reason).slice(0,100)}`);
  });

  ws.on('error', (err) => {
    console.warn(`WS error from ${remote}:`, err && err.message ? err.message : err);
  });
});

// start server
server.listen(PORT, () => {
  console.log(`HTTP + WS server listening on http://localhost:${PORT}`);
});
