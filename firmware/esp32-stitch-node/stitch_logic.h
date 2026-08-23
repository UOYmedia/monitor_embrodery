/*
 * Decision layer of the external sensor node, deliberately free of Arduino headers.
 *
 * Everything that turns pulses and a lamp level into contract fields lives here so it can be
 * compiled and tested on a laptop (see test/stitch_logic_test.c). The .ino only owns I/O:
 * interrupts, WiFi, clock and the HTTP answer.
 *
 * The node measures two things and only two things: revolutions of the main shaft (one pulse =
 * one stitch) and whether the machine's own indicator lamp is lit. Every field it reports must
 * be derivable from those two. Anything else stays out of the payload — the bridge contract
 * (docs/adapter-contract.md) treats a missing field as honest and a guessed field as a bug.
 */
#ifndef STITCH_LOGIC_H
#define STITCH_LOGIC_H

#include <stdint.h>
#ifndef __cplusplus
#include <stdbool.h>
#endif

#define SL_INTERVAL_SAMPLES 8
#define SL_HISTORY_SLOTS 24 /* contract keeps at most 24 rpmHistory samples */
#define SL_BREAK_SLOTS 32

typedef enum {
  SL_UNKNOWN = 0, /* no pulse seen yet: a still machine and a misaligned sensor look identical */
  SL_RUNNING = 1,
  SL_STOPPED = 2,
  SL_FAULT = 3
} sl_status;

typedef struct {
  uint32_t debounce_us;        /* pulses closer than this are contact bounce, not stitches */
  uint32_t running_timeout_us; /* no pulse for longer than this: the shaft is not turning */
  uint32_t history_period_us;  /* one rpmHistory sample per period */
  uint32_t window_stitches;    /* width of the threadBreakWindow, in stitches */
  uint32_t lamp_holdoff_us;    /* a blinking lamp is one alarm, not twenty */
  uint32_t lamp_latch_us;      /* keep reporting fault for this long after an alarm */
  uint16_t max_rpm;            /* contract caps rpm at 5000 */
  bool lamp_reports_break;     /* only true once the operator confirmed what the lamp means */
} sl_config;

typedef struct {
  sl_config cfg;

  uint64_t stitches;    /* pulses counted by THIS node, not the machine's lifetime total */
  uint64_t last_pulse_us;
  uint32_t rejected_pulses; /* debounce rejections, exposed on /health to tune the sensor */
  uint32_t intervals_us[SL_INTERVAL_SAMPLES];
  uint8_t interval_head;
  uint8_t interval_count;
  bool sensor_proven;

  uint16_t history[SL_HISTORY_SLOTS]; /* oldest first */
  uint8_t history_count;
  uint64_t next_history_us;

  uint64_t break_at[SL_BREAK_SLOTS]; /* stitch index of each lamp alarm, newest overwrites oldest */
  uint8_t break_used;
  uint8_t break_head;
  uint32_t break_total;
  uint64_t last_break_us;
  bool lamp_asserted;
} sl_state;

typedef struct {
  sl_status status;
  bool rpm_valid;
  uint16_t rpm;
  bool stitches_valid; /* false while status is unknown: a frozen counter must not look idle */
  uint64_t stitches;
  bool window_valid;
  uint32_t window_stitches;
  uint32_t window_breaks;
  uint8_t history_count;
  uint16_t history[SL_HISTORY_SLOTS];
} sl_view;

static inline sl_config sl_default_config(void) {
  sl_config cfg;
  cfg.debounce_us = 4000;          /* 4 ms: blocks bounce, still allows 15000 stitches/min */
  cfg.running_timeout_us = 2500000; /* 2.5 s without a pulse: below ~24 spm we call it stopped */
  cfg.history_period_us = 10000000; /* 10 s x 24 slots = last 4 minutes */
  cfg.window_stitches = 5000;
  cfg.lamp_holdoff_us = 5000000;
  cfg.lamp_latch_us = 15000000;
  cfg.max_rpm = 5000;
  cfg.lamp_reports_break = false;
  return cfg;
}

static inline void sl_init(sl_state *s, const sl_config *cfg) {
  uint8_t i;
  s->cfg = *cfg;
  s->stitches = 0;
  s->last_pulse_us = 0;
  s->rejected_pulses = 0;
  for (i = 0; i < SL_INTERVAL_SAMPLES; i++) s->intervals_us[i] = 0;
  s->interval_head = 0;
  s->interval_count = 0;
  s->sensor_proven = false;
  for (i = 0; i < SL_HISTORY_SLOTS; i++) s->history[i] = 0;
  s->history_count = 0;
  s->next_history_us = 0;
  for (i = 0; i < SL_BREAK_SLOTS; i++) s->break_at[i] = 0;
  s->break_used = 0;
  s->break_head = 0;
  s->break_total = 0;
  s->last_break_us = 0;
  s->lamp_asserted = false;
}

/** Restores a counter persisted before a reboot. See README: the value is deliberately behind. */
static inline void sl_restore_stitches(sl_state *s, uint64_t stitches) {
  s->stitches = stitches;
}

/**
 * Called from the pulse interrupt. Returns false when the pulse was rejected as bounce.
 *
 * After a long silence the interval ring is cleared: the average of intervals recorded before a
 * break tells nothing about the speed the machine just restarted at.
 */
static inline bool sl_on_pulse(sl_state *s, uint64_t now_us) {
  if (s->sensor_proven) {
    uint64_t gap = now_us - s->last_pulse_us;
    if (gap < (uint64_t)s->cfg.debounce_us) {
      s->rejected_pulses++;
      return false;
    }
    if (gap <= (uint64_t)s->cfg.running_timeout_us) {
      s->intervals_us[s->interval_head] = (uint32_t)gap;
      s->interval_head = (uint8_t)((s->interval_head + 1) % SL_INTERVAL_SAMPLES);
      if (s->interval_count < SL_INTERVAL_SAMPLES) s->interval_count++;
    } else {
      s->interval_head = 0;
      s->interval_count = 0;
    }
  }
  s->stitches++;
  s->last_pulse_us = now_us;
  s->sensor_proven = true;
  return true;
}

/**
 * Feeds the debounced lamp level. Returns true when a new alarm was registered.
 *
 * `breaks` counts lamp alarms, not verified thread breaks — that is why the whole field is
 * withheld unless the operator set lamp_reports_break after checking what the lamp does on
 * their own machine.
 */
static inline bool sl_on_lamp(sl_state *s, bool asserted, uint64_t now_us) {
  bool rising = asserted && !s->lamp_asserted;
  s->lamp_asserted = asserted;
  if (!rising || !s->cfg.lamp_reports_break) return false;
  if (s->break_total > 0 && now_us - s->last_break_us < (uint64_t)s->cfg.lamp_holdoff_us) return false;
  s->break_at[s->break_head] = s->stitches;
  s->break_head = (uint8_t)((s->break_head + 1) % SL_BREAK_SLOTS);
  if (s->break_used < SL_BREAK_SLOTS) s->break_used++;
  s->break_total++;
  s->last_break_us = now_us;
  return true;
}

static inline sl_status sl_status_at(const sl_state *s, uint64_t now_us) {
  if (!s->sensor_proven) return SL_UNKNOWN;
  if (now_us - s->last_pulse_us <= (uint64_t)s->cfg.running_timeout_us) return SL_RUNNING;
  if (s->cfg.lamp_reports_break) {
    bool latched = s->break_total > 0 && now_us - s->last_break_us < (uint64_t)s->cfg.lamp_latch_us;
    if (s->lamp_asserted || latched) return SL_FAULT;
  }
  /* `paused` is never reported: no external sensor can tell a pause from a stop. */
  return SL_STOPPED;
}

static inline uint16_t sl_rpm_at(const sl_state *s, uint64_t now_us) {
  uint64_t sum = 0, avg, period, rpm, since;
  uint8_t i;
  if (!s->sensor_proven || s->interval_count == 0) return 0;
  /* When sl_tick() samples a slot at its past boundary, an ISR pulse may already have advanced
     last_pulse_us beyond now_us; guard the unsigned subtraction so a running machine's history
     slot records its average rate instead of underflowing to a phantom 0 rpm. */
  since = now_us > s->last_pulse_us ? now_us - s->last_pulse_us : 0;
  if (since > (uint64_t)s->cfg.running_timeout_us) return 0;
  for (i = 0; i < s->interval_count; i++) sum += s->intervals_us[i];
  avg = sum / s->interval_count;
  /* A machine slowing down must show up before the next pulse arrives, so the gap since the
     last pulse competes with the average instead of waiting to enter the ring. */
  period = avg > since ? avg : since;
  if (period == 0) return s->cfg.max_rpm;
  rpm = 60000000ULL / period;
  if (rpm > (uint64_t)s->cfg.max_rpm) rpm = s->cfg.max_rpm;
  return (uint16_t)rpm;
}

/** Appends rpmHistory samples that fell due. Call it from the main loop, never from an ISR. */
static inline void sl_tick(sl_state *s, uint64_t now_us) {
  uint8_t guard = 0;
  if (!s->sensor_proven) return;
  if (s->next_history_us == 0) {
    s->next_history_us = now_us + s->cfg.history_period_us;
    return;
  }
  while (now_us >= s->next_history_us && guard < SL_HISTORY_SLOTS) {
    uint16_t sample = sl_rpm_at(s, s->next_history_us);
    if (s->history_count < SL_HISTORY_SLOTS) {
      s->history[s->history_count++] = sample;
    } else {
      uint8_t i;
      for (i = 1; i < SL_HISTORY_SLOTS; i++) s->history[i - 1] = s->history[i];
      s->history[SL_HISTORY_SLOTS - 1] = sample;
    }
    s->next_history_us += s->cfg.history_period_us;
    guard++;
  }
  /* Long stall (WiFi reconnect, watchdog): resync instead of back-filling invented samples. */
  if (now_us >= s->next_history_us) s->next_history_us = now_us + s->cfg.history_period_us;
}

static inline sl_view sl_snapshot(const sl_state *s, uint64_t now_us) {
  sl_view view;
  uint8_t i;
  view.status = sl_status_at(s, now_us);
  view.rpm = sl_rpm_at(s, now_us);
  view.rpm_valid = s->sensor_proven && s->interval_count > 0;
  /* While the status is unknown the counter is withheld: a sensor that never fired would
     otherwise publish a frozen odometer, and the bridge would book that as an idle machine
     instead of as no data at all. */
  view.stitches_valid = s->sensor_proven;
  view.stitches = s->stitches;
  view.history_count = s->history_count;
  for (i = 0; i < SL_HISTORY_SLOTS; i++) view.history[i] = s->history[i];

  view.window_valid = false;
  view.window_stitches = 0;
  view.window_breaks = 0;
  if (s->cfg.lamp_reports_break && s->sensor_proven && s->stitches > 0) {
    uint32_t span = s->stitches < (uint64_t)s->cfg.window_stitches
      ? (uint32_t)s->stitches
      : s->cfg.window_stitches;
    uint64_t floor_stitch = s->stitches - span;
    uint32_t breaks = 0;
    for (i = 0; i < s->break_used; i++) {
      if (s->break_at[i] >= floor_stitch) breaks++;
    }
    view.window_valid = span > 0;
    view.window_stitches = span;
    view.window_breaks = breaks;
  }
  return view;
}

static inline const char *sl_status_name(sl_status status) {
  switch (status) {
    case SL_RUNNING: return "running";
    case SL_STOPPED: return "stopped";
    case SL_FAULT: return "fault";
    case SL_UNKNOWN:
    default: return "unknown";
  }
}

#endif /* STITCH_LOGIC_H */
