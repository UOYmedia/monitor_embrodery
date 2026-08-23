/*
 * Host test for the sensor node's decision layer. No hardware, no Arduino, no network.
 *
 *   cc -std=c11 -Wall -Wextra -Werror -o /tmp/sl firmware/esp32-stitch-node/test/stitch_logic_test.c && /tmp/sl
 *
 * `npm test` runs the same thing through test/stitch-logic.test.mjs.
 */
#include <stdio.h>
#include <string.h>
#include "../stitch_logic.h"
#include "../telemetry_payload.h"

static int failures = 0;

#define CHECK(cond, label) do { \
  if (!(cond)) { printf("FAIL %s (%s:%d)\n", (label), __FILE__, __LINE__); failures++; } \
} while (0)

#define CHECK_EQ(actual, expected, label) do { \
  long long a_ = (long long)(actual), e_ = (long long)(expected); \
  if (a_ != e_) { printf("FAIL %s: %lld != %lld (%s:%d)\n", (label), a_, e_, __FILE__, __LINE__); failures++; } \
} while (0)

#define CHECK_JSON(actual, expected, label) do { \
  if (strcmp((actual), (expected)) != 0) { \
    printf("FAIL %s (%s:%d)\n  nhan duoc: %s\n  mong doi : %s\n", (label), __FILE__, __LINE__, (actual), (expected)); \
    failures++; \
  } \
} while (0)

static uint64_t run_pulses(sl_state *s, uint64_t start_us, uint32_t count, uint32_t period_us) {
  uint64_t at = start_us;
  uint32_t i;
  for (i = 0; i < count; i++) {
    at += period_us;
    sl_on_pulse(s, at);
    sl_tick(s, at);
  }
  return at;
}

static void test_unknown_before_first_pulse(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  sl_init(&s, &cfg);
  v = sl_snapshot(&s, 30000000ULL);
  CHECK_EQ(v.status, SL_UNKNOWN, "no pulse yet is unknown, not stopped");
  CHECK(!v.rpm_valid, "no rpm before the sensor proved itself");
  CHECK(!v.stitches_valid, "no stitch count before the sensor proved itself");
  CHECK(!v.window_valid, "no thread break window before the sensor proved itself");
  CHECK_EQ(v.history_count, 0, "no rpm history before the sensor proved itself");
  CHECK_EQ(strcmp(sl_status_name(v.status), "unknown"), 0, "unknown maps to the contract string");
}

static void test_running_and_rpm(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  sl_init(&s, &cfg);
  /* 50 ms between pulses = 1200 stitches/min. */
  at = run_pulses(&s, 1000000ULL, 40, 50000);
  v = sl_snapshot(&s, at + 1000);
  CHECK_EQ(v.status, SL_RUNNING, "recent pulses mean running");
  CHECK(v.rpm_valid, "rpm is readable once intervals exist");
  CHECK_EQ(v.rpm, 1200, "50 ms period is 1200 rpm");
  CHECK(v.stitches_valid, "stitch count is readable once the sensor proved itself");
  CHECK_EQ(v.stitches, 40, "every accepted pulse is one stitch");
  CHECK_EQ(strcmp(sl_status_name(v.status), "running"), 0, "running maps to the contract string");
}

static void test_debounce_rejects_contact_bounce(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  sl_init(&s, &cfg);
  CHECK(sl_on_pulse(&s, 1000000ULL), "first pulse is always accepted");
  CHECK(!sl_on_pulse(&s, 1000500ULL), "0.5 ms later is bounce, not a stitch");
  CHECK(sl_on_pulse(&s, 1050000ULL), "50 ms later is a real stitch");
  v = sl_snapshot(&s, 1050000ULL);
  CHECK_EQ(v.stitches, 2, "the rejected bounce was not counted");
  CHECK_EQ(s.rejected_pulses, 1, "rejections are kept for /health so the sensor can be tuned");
}

static void test_rpm_is_zero_when_the_shaft_stops(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  sl_init(&s, &cfg);
  at = run_pulses(&s, 1000000ULL, 20, 50000);

  /* Inside the running window the rate decays instead of holding the last average. */
  v = sl_snapshot(&s, at + 200000ULL);
  CHECK_EQ(v.status, SL_RUNNING, "200 ms without a pulse is still running");
  CHECK_EQ(v.rpm, 300, "a widening gap lowers rpm before the next pulse arrives");

  v = sl_snapshot(&s, at + 4000000ULL);
  CHECK_EQ(v.status, SL_STOPPED, "past the timeout the shaft is not turning");
  CHECK_EQ(v.rpm, 0, "a stopped machine reports 0, never a stale average");
  CHECK(v.rpm_valid, "0 rpm is a reading, not a missing field");
}

static void test_restart_after_idle_drops_stale_intervals(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  sl_init(&s, &cfg);
  at = run_pulses(&s, 1000000ULL, 20, 50000);
  at += 600000000ULL; /* ten minutes idle */
  sl_on_pulse(&s, at);
  v = sl_snapshot(&s, at);
  CHECK(!v.rpm_valid, "the first pulse after idle gives no rate yet");
  at += 200000ULL; /* restart at 300 rpm */
  sl_on_pulse(&s, at);
  v = sl_snapshot(&s, at);
  CHECK_EQ(v.rpm, 300, "rpm follows the new speed, not the speed before the stop");
}

static void test_lamp_is_ignored_until_the_operator_confirms_it(void) {
  sl_config cfg = sl_default_config(); /* lamp_reports_break stays false */
  sl_state s;
  sl_view v;
  uint64_t at;
  sl_init(&s, &cfg);
  at = run_pulses(&s, 1000000ULL, 100, 50000);
  CHECK(!sl_on_lamp(&s, true, at), "an unconfirmed lamp registers nothing");
  v = sl_snapshot(&s, at + 4000000ULL);
  CHECK_EQ(v.status, SL_STOPPED, "an unconfirmed lamp cannot turn a stop into a fault");
  CHECK(!v.window_valid, "no break window without a confirmed lamp");
}

static void test_confirmed_lamp_reports_fault_and_breaks(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  cfg.lamp_reports_break = true;
  sl_init(&s, &cfg);
  at = run_pulses(&s, 1000000ULL, 100, 50000);
  CHECK(sl_on_lamp(&s, true, at), "a confirmed lamp registers one alarm");

  v = sl_snapshot(&s, at + 4000000ULL);
  CHECK_EQ(v.status, SL_FAULT, "lamp on and shaft stopped is a fault");
  CHECK(v.window_valid, "the window is reportable once stitches exist");
  CHECK_EQ(v.window_breaks, 1, "one alarm in the window");
  CHECK_EQ(v.window_stitches, 100, "the window never claims more stitches than were counted");
  CHECK_EQ(strcmp(sl_status_name(v.status), "fault"), 0, "fault maps to the contract string");

  /* A blinking lamp is one alarm: without the hold-off every flash would look like a break. */
  CHECK(!sl_on_lamp(&s, false, at + 500000ULL), "lamp off registers nothing");
  CHECK(!sl_on_lamp(&s, true, at + 1000000ULL), "a flash inside the hold-off is the same alarm");
  v = sl_snapshot(&s, at + 4000000ULL);
  CHECK_EQ(v.window_breaks, 1, "a blinking lamp is still one break");

  /* The latch keeps the fault stable while the lamp blinks between two polls. */
  sl_on_lamp(&s, false, at + 5000000ULL);
  v = sl_snapshot(&s, at + 6000000ULL);
  CHECK_EQ(v.status, SL_FAULT, "a dark half of the blink does not clear the fault");
  v = sl_snapshot(&s, at + 30000000ULL);
  CHECK_EQ(v.status, SL_STOPPED, "once the latch expires an unlit lamp means stopped");
}

static void test_break_window_slides(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  cfg.lamp_reports_break = true;
  cfg.window_stitches = 1000;
  sl_init(&s, &cfg);
  at = run_pulses(&s, 1000000ULL, 100, 50000);
  sl_on_lamp(&s, true, at);
  sl_on_lamp(&s, false, at + 1000000ULL);
  at = run_pulses(&s, at + 2000000ULL, 900, 50000);
  v = sl_snapshot(&s, at);
  CHECK_EQ(v.window_stitches, 1000, "the window is capped at its configured width");
  CHECK_EQ(v.window_breaks, 1, "the alarm is still inside the last 1000 stitches");
  at = run_pulses(&s, at, 200, 50000);
  v = sl_snapshot(&s, at);
  CHECK_EQ(v.window_breaks, 0, "an alarm older than the window is out of the count");
}

static void test_history_fills_then_slides(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  cfg.history_period_us = 1000000; /* 1 s per sample keeps the test short */
  sl_init(&s, &cfg);
  at = run_pulses(&s, 1000000ULL, 200, 50000); /* 10 s at 1200 rpm */
  v = sl_snapshot(&s, at);
  CHECK_EQ(v.history_count, 9, "one sample per elapsed period, none invented up front");
  CHECK_EQ(v.history[0], 1200, "samples carry the measured rate");

  at = run_pulses(&s, at, 600, 50000); /* 30 s more: more samples than slots */
  v = sl_snapshot(&s, at);
  CHECK_EQ(v.history_count, SL_HISTORY_SLOTS, "history never grows past the contract's 24");

  sl_tick(&s, at + 3600000000ULL); /* an hour-long stall must not back-fill 3600 samples */
  v = sl_snapshot(&s, at + 3600000000ULL);
  CHECK_EQ(v.history_count, SL_HISTORY_SLOTS, "a stall resyncs instead of back-filling");
  CHECK_EQ(v.history[SL_HISTORY_SLOTS - 1], 0, "samples taken while stopped are zero, not blank");
}

static void test_rpm_is_capped_at_the_contract_maximum(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  cfg.debounce_us = 100;
  sl_init(&s, &cfg);
  /* 200 us between pulses would be 300000 rpm: electrical noise, not a machine. */
  at = run_pulses(&s, 1000000ULL, 20, 200);
  v = sl_snapshot(&s, at);
  CHECK_EQ(v.rpm, 5000, "rpm is clamped to what the contract accepts");
}

static void test_restored_counter_keeps_climbing(void) {
  sl_config cfg = sl_default_config();
  sl_state s;
  sl_view v;
  uint64_t at;
  sl_init(&s, &cfg);
  sl_restore_stitches(&s, 5000);
  at = run_pulses(&s, 1000000ULL, 10, 50000);
  v = sl_snapshot(&s, at);
  CHECK_EQ(v.stitches, 5010, "the counter continues from the persisted value after a reboot");
}

/* ---------------------------------------------------------------- payload bytes */

/* The exact body GET /telemetry returns when the node has measured nothing yet. Copied verbatim
   into bridge/lib/contract.test.mjs so the bridge is tested against the real firmware output. */
#define EXPECTED_UNKNOWN_PAYLOAD "{\"schemaVersion\":2,\"status\":\"unknown\"}"

/* The same for a machine running, with the clock synced and a confirmed lamp. */
#define EXPECTED_RUNNING_PAYLOAD \
  "{\"schemaVersion\":2,\"observedAt\":\"2026-08-17T09:12:30Z\",\"status\":\"running\"," \
  "\"rpm\":712,\"rpmHistory\":[680,700,712],\"odometer\":48210," \
  "\"threadBreakWindow\":{\"breaks\":1,\"stitches\":5000}}"

static sl_view running_view(void) {
  sl_view v;
  memset(&v, 0, sizeof(v));
  v.status = SL_RUNNING;
  v.rpm_valid = true;
  v.rpm = 712;
  v.stitches_valid = true;
  v.stitches = 48210;
  v.history_count = 3;
  v.history[0] = 680;
  v.history[1] = 700;
  v.history[2] = 712;
  v.window_valid = true;
  v.window_stitches = 5000;
  v.window_breaks = 1;
  return v;
}

static void test_payload_of_a_node_that_measured_nothing(void) {
  sl_view v;
  char buffer[256];
  size_t len;
  memset(&v, 0, sizeof(v));
  v.status = SL_UNKNOWN;
  len = sl_build_payload(buffer, sizeof(buffer), &v, NULL, 0);
  CHECK(len > 0, "an empty snapshot still serialises");
  CHECK_JSON(buffer, EXPECTED_UNKNOWN_PAYLOAD, "only the mandatory status is sent");
  CHECK_EQ(len, strlen(buffer), "the returned length matches the body");
}

static void test_payload_of_a_running_machine(void) {
  sl_view v = running_view();
  char buffer[512];
  size_t len = sl_build_payload(buffer, sizeof(buffer), &v, "2026-08-17T09:12:30Z", 0);
  CHECK(len > 0, "a full snapshot serialises");
  CHECK_JSON(buffer, EXPECTED_RUNNING_PAYLOAD, "every measured field is sent, in contract shape");
  CHECK(strstr(buffer, "job") == NULL, "an external sensor never claims to know the job");
  CHECK(strstr(buffer, "controller") == NULL, "the node is not the controller and says nothing for it");
  CHECK(strstr(buffer, "needlePosition") == NULL, "the node cannot see the frame position");
  CHECK(strstr(buffer, "events") == NULL, "no events: the bridge would label them controller-sourced");
  CHECK(strstr(buffer, "needle") == NULL, "the lamp does not say which needle broke");
}

static void test_payload_omits_the_timestamp_until_the_clock_is_set(void) {
  sl_view v = running_view();
  char buffer[512];
  sl_build_payload(buffer, sizeof(buffer), &v, NULL, 0);
  CHECK(strstr(buffer, "observedAt") == NULL, "an unsynced clock dates nothing; the bridge stamps it");
  CHECK(strstr(buffer, "\"status\":\"running\"") != NULL, "the rest of the payload is unaffected");
}

static void test_payload_adds_the_operator_baseline(void) {
  sl_view v = running_view();
  char buffer[512];
  sl_build_payload(buffer, sizeof(buffer), &v, NULL, 12750000ULL);
  CHECK(strstr(buffer, "\"odometer\":12798210") != NULL, "odometer is baseline plus counted stitches");
}

static void test_payload_refuses_to_truncate(void) {
  sl_view v = running_view();
  char buffer[40];
  size_t len = sl_build_payload(buffer, sizeof(buffer), &v, "2026-08-17T09:12:30Z", 0);
  CHECK_EQ(len, 0, "a buffer too small returns 0 so the node answers an error, not half a JSON");
}

static void test_json_strings_are_escaped(void) {
  sl_json j;
  char buffer[64];
  sl_json_init(&j, buffer, sizeof(buffer));
  sl_json_raw(&j, "{");
  sl_json_string(&j, "ssid", "XUONG\"THEU\\5G");
  sl_json_raw(&j, "}");
  CHECK_JSON(buffer, "{\"ssid\":\"XUONG\\\"THEU\\\\5G\"}", "quotes and backslashes are escaped");

  sl_json_init(&j, buffer, sizeof(buffer));
  sl_json_raw(&j, "{");
  sl_json_string(&j, "ssid", "MAY\x01\nTHEU");
  sl_json_raw(&j, "}");
  CHECK_JSON(buffer, "{\"ssid\":\"MAYTHEU\"}", "control bytes are dropped, not passed through");
}

int main(void) {
  test_unknown_before_first_pulse();
  test_running_and_rpm();
  test_debounce_rejects_contact_bounce();
  test_rpm_is_zero_when_the_shaft_stops();
  test_restart_after_idle_drops_stale_intervals();
  test_lamp_is_ignored_until_the_operator_confirms_it();
  test_confirmed_lamp_reports_fault_and_breaks();
  test_break_window_slides();
  test_history_fills_then_slides();
  test_rpm_is_capped_at_the_contract_maximum();
  test_restored_counter_keeps_climbing();
  test_payload_of_a_node_that_measured_nothing();
  test_payload_of_a_running_machine();
  test_payload_omits_the_timestamp_until_the_clock_is_set();
  test_payload_adds_the_operator_baseline();
  test_payload_refuses_to_truncate();
  test_json_strings_are_escaped();

  if (failures) {
    printf("%d kiem tra that bai\n", failures);
    return 1;
  }
  printf("stitch_logic: tat ca kiem tra dat\n");
  return 0;
}
