/*
 * Serialises a sensor-node snapshot into the bridge's telemetry contract, with no Arduino
 * dependency so the exact bytes the node puts on the wire can be asserted on a laptop
 * (test/stitch_logic_test.c) and fed straight into bridge/lib/contract.test.mjs.
 *
 * The rule this file exists to enforce: a field the node did not measure is ABSENT. The bridge
 * treats an absent field as "chưa đọc được" and shows it as such; a defaulted zero would be
 * indistinguishable from a real reading. So there is no branch here that invents a value.
 *
 * Deliberately never emitted, because an external sensor cannot know them:
 *   job.*              - which design, which needle, which colour, how far along
 *   needlePosition     - X/Y of the frame
 *   controller.*       - firmware, hoop, design list, and the controller's own network
 *   events[]           - the bridge stamps every event `source: 'controller'`, which would
 *                        credit this node's inference to the Dahao box
 */
#ifndef TELEMETRY_PAYLOAD_H
#define TELEMETRY_PAYLOAD_H

#include <stdio.h>
#include <string.h>

#include "stitch_logic.h"

typedef struct {
  char *data;
  size_t size;
  size_t len;
  bool overflow;
  bool need_comma;
} sl_json;

static inline void sl_json_init(sl_json *j, char *data, size_t size) {
  j->data = data;
  j->size = size;
  j->len = 0;
  j->overflow = false;
  j->need_comma = false;
  if (size > 0) data[0] = '\0';
}

static inline void sl_json_raw(sl_json *j, const char *text) {
  size_t n = strlen(text);
  if (j->overflow || j->len + n + 1 > j->size) {
    j->overflow = true;
    return;
  }
  memcpy(j->data + j->len, text, n);
  j->len += n;
  j->data[j->len] = '\0';
}

static inline void sl_json_key(sl_json *j, const char *name) {
  if (j->need_comma) sl_json_raw(j, ",");
  sl_json_raw(j, "\"");
  sl_json_raw(j, name);
  sl_json_raw(j, "\":");
  j->need_comma = true;
}

/** Escapes the two characters that can break a JSON string and drops control bytes. */
static inline void sl_json_string(sl_json *j, const char *name, const char *value) {
  size_t i;
  sl_json_key(j, name);
  sl_json_raw(j, "\"");
  for (i = 0; value[i] != '\0'; i++) {
    char pair[3];
    unsigned char c = (unsigned char)value[i];
    if (c < 0x20) continue;
    if (c == '"' || c == '\\') {
      pair[0] = '\\';
      pair[1] = (char)c;
      pair[2] = '\0';
    } else {
      pair[0] = (char)c;
      pair[1] = '\0';
    }
    sl_json_raw(j, pair);
  }
  sl_json_raw(j, "\"");
}

static inline void sl_json_uint(sl_json *j, const char *name, uint64_t value) {
  char buffer[24];
  snprintf(buffer, sizeof(buffer), "%llu", (unsigned long long)value);
  sl_json_key(j, name);
  sl_json_raw(j, buffer);
}

static inline void sl_json_int(sl_json *j, const char *name, int64_t value) {
  char buffer[24];
  snprintf(buffer, sizeof(buffer), "%lld", (long long)value);
  sl_json_key(j, name);
  sl_json_raw(j, buffer);
}

static inline void sl_json_bool(sl_json *j, const char *name, bool value) {
  sl_json_key(j, name);
  sl_json_raw(j, value ? "true" : "false");
}

static inline void sl_json_begin_object(sl_json *j, const char *name) {
  sl_json_key(j, name);
  sl_json_raw(j, "{");
  j->need_comma = false;
}

static inline void sl_json_end_object(sl_json *j) {
  sl_json_raw(j, "}");
  j->need_comma = true;
}

/**
 * Writes the payload for GET /telemetry. Returns the byte count, or 0 if the buffer was too
 * small — in which case the caller must answer with an error, never with truncated JSON.
 *
 * `observed_at_iso` is NULL until the node's clock is actually synced; the field is then omitted
 * so the bridge stamps `receivedAt` instead of trusting a wrong clock.
 */
static inline size_t sl_build_payload(char *out, size_t size, const sl_view *view,
                                     const char *observed_at_iso, uint64_t odometer_base) {
  sl_json j;
  sl_json_init(&j, out, size);
  sl_json_raw(&j, "{");
  sl_json_uint(&j, "schemaVersion", 2);
  if (observed_at_iso != NULL) sl_json_string(&j, "observedAt", observed_at_iso);
  /* The one mandatory field. `unknown` is a real answer and the contract insists on it. */
  sl_json_string(&j, "status", sl_status_name(view->status));

  if (view->rpm_valid) sl_json_uint(&j, "rpm", view->rpm);

  if (view->history_count > 0) {
    uint8_t i;
    sl_json_key(&j, "rpmHistory");
    sl_json_raw(&j, "[");
    for (i = 0; i < view->history_count; i++) {
      char sample[10];
      snprintf(sample, sizeof(sample), "%s%u", i ? "," : "", (unsigned)view->history[i]);
      sl_json_raw(&j, sample);
    }
    sl_json_raw(&j, "]");
  }

  /* odometer = the operator's baseline + what this node counted. The shift ledger works from
     differences, so a baseline of 0 still yields correct production; only the absolute number
     then means "since this node was installed" rather than "since the machine was built". */
  if (view->stitches_valid) sl_json_uint(&j, "odometer", odometer_base + view->stitches);

  if (view->window_valid) {
    sl_json_begin_object(&j, "threadBreakWindow");
    /* `needle` is left out: the lamp says the machine stopped, not which needle broke. */
    sl_json_uint(&j, "breaks", view->window_breaks);
    sl_json_uint(&j, "stitches", view->window_stitches);
    sl_json_end_object(&j);
  }

  sl_json_raw(&j, "}");
  return j.overflow ? 0 : j.len;
}

#endif /* TELEMETRY_PAYLOAD_H */
