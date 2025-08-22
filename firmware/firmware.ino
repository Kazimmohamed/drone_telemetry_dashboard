#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ---------------- OLED Setup ----------------
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define SDA_PIN 21
#define SCL_PIN 22

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
volatile bool wsConnected = false;   // shared flag for connection status

// ---------------- Telemetry Setup ----------------
#define SEND_BINARY true
#define PRINT_EVERY_N 10
#define SENSOR_DELAY_MS 50
#define SEND_INTERVAL_MS 50

const char* ssid = "Sidco anwar_5GHz";
const char* password = "kazim@331973";

WebSocketsClient webSocket;
const char* websocket_host = "192.168.1.9";
const uint16_t websocket_port = 3000;
const char* websocket_path = "/";

Adafruit_MPU6050 mpu;
#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);
#define BATTERY_PIN 34

TaskHandle_t sensorTaskHandle = NULL;
TaskHandle_t sendTaskHandle = NULL;
TaskHandle_t oledTaskHandle = NULL;
SemaphoreHandle_t dataMutex = NULL;

struct TelemetryData {
  float pitch;
  float roll;
  float yaw;
  float temperature;
  float humidity;
  float batteryVoltage;
} telemetry;

volatile uint32_t sendSeq = 0;
volatile uint32_t serialPrintCounter = 0;

// ---------------- Helpers ----------------
static inline void packUint32LE(uint8_t *buf, size_t offset, uint32_t v) {
  buf[offset + 0] = (uint8_t)(v & 0xFF);
  buf[offset + 1] = (uint8_t)((v >> 8) & 0xFF);
  buf[offset + 2] = (uint8_t)((v >> 16) & 0xFF);
  buf[offset + 3] = (uint8_t)((v >> 24) & 0xFF);
}
static inline void packFloatLE(uint8_t *buf, size_t offset, float f) {
  uint8_t tmp[4];
  memcpy(tmp, &f, 4);
  buf[offset + 0] = tmp[0];
  buf[offset + 1] = tmp[1];
  buf[offset + 2] = tmp[2];
  buf[offset + 3] = tmp[3];
}

// ---------------- WebSocket Events ----------------
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[WS] Connected");
      wsConnected = true;
      break;
    case WStype_DISCONNECTED:
      Serial.println("[WS] Disconnected");
      wsConnected = false;
      break;
    default:
      break;
  }
}

// ---------------- Sensor Task ----------------
void sensorTask(void *parameter) {
  sensors_event_t a, g, tempSensor;
  (void) parameter;
  for (;;) {
    mpu.getEvent(&a, &g, &tempSensor);
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    if (isnan(t)) t = -127.0f;
    if (isnan(h)) h = -127.0f;
    int raw = analogRead(BATTERY_PIN);
    float voltage = raw * (3.3f / 4095.0f) * 2.0f;
    float pitch = atan2(a.acceleration.y, a.acceleration.z) * 180.0f / PI;
    float roll  = atan2(-a.acceleration.x, sqrt(a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z)) * 180.0f / PI;
    float yaw   = g.gyro.z * 57.29577951308232f;

    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      telemetry.pitch = pitch;
      telemetry.roll  = roll;
      telemetry.yaw   = yaw;
      telemetry.temperature = t;
      telemetry.humidity = h;
      telemetry.batteryVoltage = voltage;
      xSemaphoreGive(dataMutex);
    }
    vTaskDelay(pdMS_TO_TICKS(SENSOR_DELAY_MS));
  }
}

// ---------------- Send Task ----------------
void sendTask(void *parameter) {
  (void) parameter;
  uint8_t binBuf[32];
  StaticJsonDocument<256> jsonDoc;
  char jsonBuf[256];

  for (;;) {
    TelemetryData local;
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      local = telemetry;
      xSemaphoreGive(dataMutex);
    } else {
      vTaskDelay(pdMS_TO_TICKS(SEND_INTERVAL_MS));
      continue;
    }

    uint32_t seq = ++sendSeq;
    uint32_t ts_ms = (uint32_t) millis();

    if (SEND_BINARY) {
      packUint32LE(binBuf, 0, seq);
      packUint32LE(binBuf, 4, ts_ms);
      packFloatLE(binBuf, 8,  local.pitch);
      packFloatLE(binBuf, 12, local.roll);
      packFloatLE(binBuf, 16, local.yaw);
      packFloatLE(binBuf, 20, local.temperature);
      packFloatLE(binBuf, 24, local.humidity);
      packFloatLE(binBuf, 28, local.batteryVoltage);
      webSocket.sendBIN(binBuf, sizeof(binBuf));
    } else {
      jsonDoc.clear();
      jsonDoc["seq"] = seq;
      jsonDoc["ts_ms"] = ts_ms;
      jsonDoc["pitch"] = local.pitch;
      jsonDoc["roll"] = local.roll;
      jsonDoc["yaw"] = local.yaw;
      jsonDoc["temperature"] = local.temperature;
      jsonDoc["humidity"] = local.humidity;
      jsonDoc["battery"] = local.batteryVoltage;
      size_t len = serializeJson(jsonDoc, jsonBuf, sizeof(jsonBuf));
      webSocket.sendTXT((const uint8_t*)jsonBuf, len);
    }

    serialPrintCounter++;
    if (serialPrintCounter >= PRINT_EVERY_N) {
      serialPrintCounter = 0;
      Serial.printf("SENT #%u  t=%lu ms  P/R/Y=%.1f/%.1f/%.1f  T=%.1fC H=%.1f%% V=%.2fV\n",
                    seq, (unsigned long)ts_ms,
                    local.pitch, local.roll, local.yaw,
                    local.temperature, local.humidity, local.batteryVoltage);
    }

    vTaskDelay(pdMS_TO_TICKS(SEND_INTERVAL_MS));
  }
}

// ---------------- OLED Task ----------------
void oledTask(void *parameter) {
  (void) parameter;
  for (;;) {
    display.clearDisplay();
    display.setTextSize(2);
    display.setTextColor(SSD1306_WHITE);

    // Line 1: Drone ON
    display.setCursor(0, 0);
    display.println("Drone ON");

    // Line 2: WiFi
    display.setTextSize(1);
    display.setCursor(0, 25);
    display.print("WiFi: ");
    display.println(WiFi.isConnected() ? "OK" : "No");

    // Line 3: WS Connection
    display.setCursor(0, 40);
    display.print("Server: ");
    display.println(wsConnected ? "Connected" : "No link");

    display.display();
    vTaskDelay(pdMS_TO_TICKS(500));  // update every 0.5s
  }
}

// ---------------- Setup ----------------
void setup() {
  Serial.begin(115200);
  delay(100);

  // Start I2C and OLED
  Wire.begin(SDA_PIN, SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("SSD1306 allocation failed");
    for (;;);
  }
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 10);
  display.println("Booting...");
  display.display();

  // WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");
  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
    if (millis() - wifiStart > 10000) {
      Serial.println();
      wifiStart = millis();
    }
  }
  Serial.println();
  Serial.print("Connected. IP: ");
  Serial.println(WiFi.localIP());
  WiFi.setSleep(false);

  // MPU6050
  if (!mpu.begin()) {
    Serial.println("MPU6050 not found! Halting.");
    while (1) { delay(1000); }
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  // DHT + battery
  dht.begin();
  analogReadResolution(12);

  // WebSocket
  webSocket.begin(websocket_host, websocket_port, websocket_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);

  // Mutex + RTOS tasks
  dataMutex = xSemaphoreCreateMutex();
  if (dataMutex == NULL) {
    Serial.println("Failed to create mutex — halting.");
    while (1) { delay(1000); }
  }
  xTaskCreatePinnedToCore(sensorTask, "SensorTask", 4096, NULL, 2, &sensorTaskHandle, 1);
  xTaskCreatePinnedToCore(sendTask,   "SendTask",   4096, NULL, 2, &sendTaskHandle,   1);
  xTaskCreatePinnedToCore(oledTask,   "OledTask",   4096, NULL, 1, &oledTaskHandle,   1);

  Serial.println("Setup complete.");
}

// ---------------- Loop ----------------
void loop() {
  webSocket.loop();
  delay(2);
}
