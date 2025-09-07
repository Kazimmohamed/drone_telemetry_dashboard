# Drone Telemetry Dashboard

A real-time drone telemetry system powered by **ESP32**, **MPU6050**, **DHT11**, and a **battery monitor**.  
Sensor data is encoded as compact JSON, streamed via **WebSocket** to a **Node.js server**, and visualized on a **live browser dashboard**.  
Designed with **RTOS multitasking** for responsiveness and extensibility.

---

## ✨ Features
- **Real-time telemetry over WebSocket** → Low-latency streaming from ESP32 to Node.js and browser.  
- **RTOS multitasking on ESP32** → Separate tasks for IMU, environment, battery, and transport.  
- **JSON telemetry schema** → Self-describing packets, easily extendable with new sensors/fields.  
- **Live dashboard** → Browser-based gauges, charts, and cards for IMU, temperature/humidity, and battery.  
- **Modular design** → Add sensors or swap backends (MQTT/REST) with minimal changes.  

---

## 🔧 Hardware
- **ESP32 Dev Board** (ESP32-WROOM or similar)  
- **MPU6050** (Accelerometer + Gyroscope, I2C)  
- **DHT11** Temperature/Humidity sensor (GPIO)  
- **Battery voltage monitor** (resistor divider to ADC; ensure safe scaling to ADC range)  

**Example wiring:**
- ESP32 ↔ MPU6050 via I2C (SDA/SCL + 3V3/GND)  
- ESP32 ↔ DHT11 (GPIO + 10k pull-up if not included on breakout)  
- ESP32 ↔ Battery divider → ADC input  

---

## 🏗️ System Architecture

### ESP32 Firmware
- **Tasks:**  
  - `imuTask` → IMU readings  
  - `envTask` → Temperature & humidity  
  - `battTask` → Battery voltage/percentage  
  - `wsTask` → WebSocket transport  
- **Packetizer:** Builds JSON frames with timestamps. Fields are optional and versioned.  
- **Transport:** WebSocket client or server mode (configurable).  

### Node.js Relay Server
- Accepts WebSocket connections from ESP32.  
- Optionally validates schema.  
- Rebroadcasts telemetry to browser clients.  

### Browser Dashboard
- Subscribes to WebSocket stream.  
- Renders gauges, charts, and cards for live telemetry.  

---

## 📦 Telemetry JSON Schema
Example frame:
```json
{
  "ts": 1736328451,          // Unix seconds
  "fw": "1.0.0",             // Firmware semantic version
  "imu": { "ax": 0.01, "ay": 0.02, "az": 9.80, "gx": -0.1, "gy": 0.0, "gz": 0.2 },
  "env": { "t": 29.4, "h": 62.1 },
  "bat": { "v": 11.7, "pct": 78 }
}
