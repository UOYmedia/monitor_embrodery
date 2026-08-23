/*
 * L1 sensor node: an ESP32 that watches an embroidery machine from the outside and serves the
 * bridge's telemetry contract over HTTP.
 *
 * WHAT THIS IS NOT. It is not a Dahao client and it speaks no Dahao protocol. It never connects
 * to the controller, never sends the machine a byte, and takes no power from it. Everything it
 * reports comes from two sensors stuck on the outside of the machine: one pulse per revolution
 * of the main shaft, and the state of the machine's own indicator lamp.
 *
 * WHY IT EXISTS. The A15's documented network features are pattern upload, Dahao's own remote
 * maintenance and the instalment lock — none of them publishes production data to the workshop's
 * server. See PRD_LAN_MA_NGUON_MO.md: this node is layer L1, the only path to real numbers that
 * does not depend on Dahao opening a protocol.
 *
 * READ-ONLY BY CONSTRUCTION. The HTTP server answers GET on three paths and nothing else: no
 * POST, no configuration endpoint, no OTA, and no code path that writes anywhere except this
 * node's own NVS counter.
 *
 * Board: ESP32 (WROOM-32 DevKit and friends), Arduino-ESP32 core 3.x.
 * Copy config.example.h to config.h and fill it in before flashing. config.h is gitignored: the
 * WiFi password must never enter this repository.
 */
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_timer.h>
#include <time.h>

#include "config.h"
#include "stitch_logic.h"
#include "telemetry_payload.h"

static WebServer server(NODE_HTTP_PORT);
static Preferences prefs;
static sl_state logic;
static portMUX_TYPE logicMux = portMUX_INITIALIZER_UNLOCKED;

static uint64_t persistedStitches = 0;
static bool lampAsserted = false;
static bool lampCandidate = false;
static uint64_t lampCandidateSince = 0;
static uint64_t lastTickAt = 0;
static bool sntpArmed = false;

/* SNTP phai duoc arm khi link LEN LAN DAU, khong chi o lan boot noi duoc trong 20 s: sau khi
   xuong mat dien, AP thuong hien sau node, va neu khong arm lai thi observedAt se bi bo suot ca
   phien. Ham nay idempotent. */
static void armSntp() {
  if (sntpArmed) return;
  configTime(0, 0, NODE_NTP_SERVER); /* UTC only: the contract wants a zoned timestamp */
  sntpArmed = true;
}

/* esp_timer_get_time() lives in IRAM and is 64-bit, so it is safe inside the ISR and never wraps
   the way micros() does after 71 minutes. */
static inline uint64_t nowMicros() { return (uint64_t)esp_timer_get_time(); }

static void IRAM_ATTR onStitchPulse() {
  uint64_t at = nowMicros();
  portENTER_CRITICAL_ISR(&logicMux);
  sl_on_pulse(&logic, at);
  portEXIT_CRITICAL_ISR(&logicMux);
}

/* ------------------------------------------------------------------ clock */

/**
 * The contract wants ISO 8601 with a zone. Until SNTP has actually set the clock this is false
 * and `observedAt` is omitted, so the bridge stamps `receivedAt` instead of trusting a node whose
 * clock says 1970. A workshop LAN without Internet is a normal case, not an error.
 */
static bool nodeTimeSynced() {
  return time(nullptr) > 1735689600; /* 2025-01-01; anything below is the un-synced epoch */
}

static bool formatIsoUtc(char *out, size_t size) {
  time_t now = time(nullptr);
  struct tm parts;
  if (!nodeTimeSynced()) return false;
  gmtime_r(&now, &parts);
  return strftime(out, size, "%Y-%m-%dT%H:%M:%SZ", &parts) > 0;
}

/* ------------------------------------------------------------------ counter persistence */

/**
 * The counter is written every NODE_PERSIST_EVERY_STITCHES stitches and once more when the machine
 * falls idle, so NVS is not rewritten thousands of times a day.
 *
 * The stored value is therefore deliberately BEHIND the live count. Cutting power mid-run loses
 * the stitches since the last write; after the reboot the odometer is lower than the last value
 * the bridge saw, so the bridge logs `counter-reset` and counts nothing for that interval. That is
 * the intended trade: a visible, logged gap beats silently inflating production by rounding up.
 */
static void persistStitches(uint64_t stitches, bool force) {
  if (stitches == persistedStitches) return;
  if (!force && stitches < persistedStitches + NODE_PERSIST_EVERY_STITCHES) return;
  prefs.putULong64("stitches", stitches);
  persistedStitches = stitches;
}

/* ------------------------------------------------------------------ HTTP handlers */

static sl_view snapshotNow(uint64_t at) {
  sl_view view;
  portENTER_CRITICAL(&logicMux);
  view = sl_snapshot(&logic, at);
  portEXIT_CRITICAL(&logicMux);
  return view;
}

static void handleTelemetry() {
  char body[1024];
  char iso[32];
  sl_view view = snapshotNow(nowMicros());
  const char *observedAt = formatIsoUtc(iso, sizeof(iso)) ? iso : nullptr;
  size_t len = sl_build_payload(body, sizeof(body), &view, observedAt, NODE_ODOMETER_BASE);
  if (len == 0) {
    /* Truncated JSON would be parsed as a malformed payload and could poison a snapshot, so the
       node answers an error and lets the bridge report the machine as unreadable. */
    server.send(500, "text/plain; charset=utf-8", "Bo dem JSON tran.\n");
    return;
  }
  server.send(200, "application/json", body);
}

/**
 * Install and diagnosis aid, NOT contract data — the bridge never polls this path. It exists so
 * the installer can aim the pulse sensor and check the lamp polarity from a phone on the same
 * WiFi, without a laptop and without touching the machine.
 */
static void handleHealth() {
  char body[900];
  char iso[32];
  sl_json j;
  uint64_t at = nowMicros();
  uint64_t sinceLastPulse;
  uint32_t rejected;
  uint32_t alarms;
  bool proven;
  sl_view view;

  portENTER_CRITICAL(&logicMux);
  view = sl_snapshot(&logic, at);
  proven = logic.sensor_proven;
  rejected = logic.rejected_pulses;
  alarms = logic.break_total;
  sinceLastPulse = proven ? at - logic.last_pulse_us : 0;
  portEXIT_CRITICAL(&logicMux);

  sl_json_init(&j, body, sizeof(body));
  sl_json_raw(&j, "{");
  sl_json_string(&j, "note", "Du lieu chan doan cua node, KHONG phai telemetry contract.");
  sl_json_string(&j, "firmware", NODE_FIRMWARE_ID);
  sl_json_string(&j, "ip", WiFi.localIP().toString().c_str());
  /* Printed here so pairing can cite `evidence: "mac"` from something read off the device. */
  sl_json_string(&j, "mac", WiFi.macAddress().c_str());
  sl_json_string(&j, "ssid", WiFi.SSID().c_str());
  sl_json_int(&j, "rssiDbm", WiFi.RSSI());
  sl_json_uint(&j, "uptimeSeconds", at / 1000000ULL);
  sl_json_bool(&j, "timeSynced", nodeTimeSynced());
  if (formatIsoUtc(iso, sizeof(iso))) sl_json_string(&j, "nodeTime", iso);
  sl_json_string(&j, "status", sl_status_name(view.status));
  sl_json_bool(&j, "sensorProven", proven);
  sl_json_uint(&j, "stitchesCounted", view.stitches);
  sl_json_uint(&j, "stitchesPersisted", persistedStitches);
  sl_json_uint(&j, "odometerBase", NODE_ODOMETER_BASE);
  sl_json_uint(&j, "rejectedPulses", rejected);
  sl_json_uint(&j, "msSinceLastPulse", sinceLastPulse / 1000ULL);
  sl_json_uint(&j, "rpm", view.rpm);
  sl_json_bool(&j, "lampInputEnabled", NODE_LAMP_ENABLED ? true : false);
  if (NODE_LAMP_ENABLED) sl_json_bool(&j, "lampPinHigh", digitalRead(NODE_LAMP_PIN) == HIGH);
  sl_json_bool(&j, "lampAsserted", lampAsserted);
  sl_json_bool(&j, "lampReportsBreak", logic.cfg.lamp_reports_break);
  sl_json_uint(&j, "lampAlarmsTotal", alarms);
  sl_json_raw(&j, "}");

  if (j.overflow) {
    server.send(500, "text/plain; charset=utf-8", "Bo dem JSON tran.\n");
    return;
  }
  server.send(200, "application/json", body);
}

static void handleRoot() {
  char body[512];
  String ip = WiFi.localIP().toString();
  snprintf(body, sizeof(body),
    "Node cam bien may theu (chi doc).\n"
    "Firmware: %s\n"
    "Telemetry cho bridge: GET http://%s:%u%s\n"
    "Chan doan khi lap dat:  GET http://%s:%u/health\n"
    "Node khong noi vao bo dieu khien va khong gui lenh cho may.\n",
    NODE_FIRMWARE_ID, ip.c_str(), (unsigned)NODE_HTTP_PORT, NODE_TELEMETRY_PATH,
    ip.c_str(), (unsigned)NODE_HTTP_PORT);
  server.send(200, "text/plain; charset=utf-8", body);
}

/* ------------------------------------------------------------------ lamp sampling */

/**
 * Debounces the lamp level in the main loop: a level must hold for NODE_LAMP_DEBOUNCE_MS before
 * it counts. Indicator lamps flicker, and a flicker must not become a production statistic.
 */
static void sampleLamp(uint64_t at) {
  if (!NODE_LAMP_ENABLED) return;
  bool high = digitalRead(NODE_LAMP_PIN) == HIGH;
  bool lit = NODE_LAMP_ACTIVE_LOW ? !high : high;
  if (lit != lampCandidate) {
    lampCandidate = lit;
    lampCandidateSince = at;
    return;
  }
  if (lit == lampAsserted) return;
  if (at - lampCandidateSince < (uint64_t)NODE_LAMP_DEBOUNCE_MS * 1000ULL) return;
  lampAsserted = lit;
  portENTER_CRITICAL(&logicMux);
  bool registered = sl_on_lamp(&logic, lit, at);
  portEXIT_CRITICAL(&logicMux);
  if (registered) Serial.println("[node] Den bao sang -> ghi nhan 1 lan bao dung.");
}

/* ------------------------------------------------------------------ wifi */

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(NODE_HOSTNAME);
  WiFi.setSleep(false); /* modem sleep would add seconds of latency to every poll */
  static bool scannedOnce = false;
  if (!scannedOnce) {
    scannedOnce = true;
    Serial.println("[node] === Quet WiFi 2.4GHz ESP nhin thay ===");
    int n = WiFi.scanNetworks();
    if (n <= 0) {
      Serial.println("[node] (khong thay mang 2.4GHz nao)");
    } else {
      for (int i = 0; i < n; i++) {
        Serial.printf("[node]  %2d) RSSI %4d dBm  ch%-2d  \"%s\"%s\n",
                      i + 1, (int)WiFi.RSSI(i), (int)WiFi.channel(i),
                      WiFi.SSID(i).c_str(),
                      WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "  (mo, khong mat khau)" : "");
      }
    }
    WiFi.scanDelete();
    Serial.println("[node] === Het danh sach ===");
  }
#ifdef NODE_STATIC_IP
  IPAddress ip, gateway, mask, dns;
  if (ip.fromString(NODE_STATIC_IP) && gateway.fromString(NODE_GATEWAY) &&
      mask.fromString(NODE_SUBNET) && dns.fromString(NODE_DNS)) {
    WiFi.config(ip, gateway, mask, dns);
  } else {
    Serial.println("[node] Cau hinh IP tinh sai dinh dang, chuyen sang DHCP.");
  }
#endif
  WiFi.begin(NODE_WIFI_SSID, NODE_WIFI_PASSWORD);
  Serial.printf("[node] Dang noi WiFi %s\n", NODE_WIFI_SSID);
}

/* ------------------------------------------------------------------ setup / loop */

void setup() {
  sl_config cfg = sl_default_config();
  Serial.begin(115200);
  delay(200);

  cfg.debounce_us = NODE_PULSE_DEBOUNCE_US;
  cfg.running_timeout_us = (uint32_t)NODE_RUNNING_TIMEOUT_MS * 1000UL;
  cfg.history_period_us = (uint32_t)NODE_HISTORY_PERIOD_MS * 1000UL;
  cfg.window_stitches = NODE_BREAK_WINDOW_STITCHES;
  cfg.lamp_holdoff_us = (uint32_t)NODE_LAMP_HOLDOFF_MS * 1000UL;
  cfg.lamp_latch_us = (uint32_t)NODE_LAMP_LATCH_MS * 1000UL;
  /* Both switches must be on. An enabled input whose meaning nobody confirmed would produce a
     thread-break number that is a guess, and the contract has no room for guesses. */
  cfg.lamp_reports_break = (NODE_LAMP_ENABLED && NODE_LAMP_MEANS_STOP) ? true : false;
  sl_init(&logic, &cfg);

  prefs.begin("stitchnode", false);
  persistedStitches = prefs.getULong64("stitches", 0);
  sl_restore_stitches(&logic, persistedStitches);
  Serial.printf("[node] Bo dem phuc hoi tu NVS: %llu mui.\n", (unsigned long long)persistedStitches);

  pinMode(NODE_PULSE_PIN, NODE_PULSE_PULLUP ? INPUT_PULLUP : INPUT);
  attachInterrupt(digitalPinToInterrupt(NODE_PULSE_PIN), onStitchPulse, NODE_PULSE_EDGE);
  if (NODE_LAMP_ENABLED) pinMode(NODE_LAMP_PIN, NODE_LAMP_PULLUP ? INPUT_PULLUP : INPUT);

  connectWifi();
  unsigned long deadline = millis() + 20000;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[node] IP: ");
    Serial.println(WiFi.localIP());
    armSntp();
  } else {
    Serial.println("[node] Chua noi duoc WiFi, se thu lai trong loop.");
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on(NODE_TELEMETRY_PATH, HTTP_GET, handleTelemetry);
  server.on("/health", HTTP_GET, handleHealth);
  server.onNotFound([]() {
    server.send(404, "text/plain; charset=utf-8", "Chi ho tro GET / , GET /health va GET telemetry.\n");
  });
  server.begin();
  Serial.printf("[node] HTTP mo tren cong %u, telemetry tai %s\n", (unsigned)NODE_HTTP_PORT, NODE_TELEMETRY_PATH);
}

void loop() {
  static unsigned long lastWifiCheck = 0;
  static uint64_t lastIdlePersist = 0;
  uint64_t at = nowMicros();

  server.handleClient();
  sampleLamp(at);

  if (at - lastTickAt > 200000ULL) { /* 5 Hz is plenty for a 10 s sampling period */
    uint64_t stitches;
    bool running;
    lastTickAt = at;
    portENTER_CRITICAL(&logicMux);
    sl_tick(&logic, at);
    stitches = logic.stitches;
    running = sl_status_at(&logic, at) == SL_RUNNING;
    portEXIT_CRITICAL(&logicMux);

    persistStitches(stitches, false);
    /* One extra write when the machine falls idle, so switching the power off between jobs — the
       normal case in a workshop — loses nothing at all. */
    if (!running && stitches != lastIdlePersist) {
      persistStitches(stitches, true);
      lastIdlePersist = stitches;
    }
  }

  if (millis() - lastWifiCheck > 10000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[node] Mat WiFi, dang noi lai.");
      WiFi.disconnect();
      connectWifi();
    } else {
      armSntp(); /* link len sau cua so boot -> arm SNTP bay gio */
    }
  }
  delay(2);
}
