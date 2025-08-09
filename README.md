
# Drone Telemetry Dashboard (Real-time)

This project provides a simple Node.js server and a real-time browser dashboard that visualizes telemetry sent from an ESP32 over WebSocket.

## Features
- 3D drone orientation (pitch, roll, yaw) using Three.js
- Temperature gauge (color-coded)
- Battery indicator (voltage + percentage mapping)
- Humidity display
- WebSocket relay: ESP32 sends telemetry to the server; the server forwards it to connected browser dashboards

## How to run
1. Unzip the package.
2. In the project root, run:
   ```bash
   npm install
   npm start
   ```
3. Open your browser on the machine running the server: `http://localhost:3000` (or replace `localhost` with the server's IP if opening from another device).
4. Make sure your ESP32's `websocket_host` points to the server IP (for example `192.168.1.9`) and `websocket_port` is `3000`.

## Notes & Tips
- The server forwards any valid telemetry JSON it receives (with keys `pitch, roll, yaw, temperature, humidity, battery`) to other connected clients.
- If telemetry isn't showing, check that the ESP32 connects (Serial monitor) and that server logs show incoming telemetry lines.
- The battery percentage calculation attempts to interpret the voltage as a single-cell LiPo (3.0–4.2V). If your battery is multi-cell or uses a different range, adjust the mapping in `public/script.js`.
