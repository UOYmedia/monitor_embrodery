import { addDays, resolveShift } from './shifts.mjs'
import { readJsonFile, writeJsonAtomic } from './atomic-file.mjs'

/**
 * Shift production counting from the odometer.
 *
 * The only number a Dahao controller reports that can be turned into payroll is the cumulative
 * stitch counter. Everything here is a *difference between two readings of that counter* — the
 * bridge never invents production, and a shift with no readings shows zero rather than an
 * estimate.
 *
 * Four things can go wrong with a counter, and each has an explicit branch below:
 *
 * - no reading yet (first poll after startup)  -> record a baseline, count nothing
 * - counter went backwards (reset, board swap) -> re-baseline, count nothing, flag `resets`
 * - counter jumped further than the machine     -> re-baseline, count nothing, flag `anomalies`
 *   could physically stitch
 * - readings arrived out of order               -> ignore, keep the newer cursor
 *
 * A flagged interval is visible in the report. Silently counting it would put wrong money in
 * someone's envelope, which is worse than a visible gap.
 *
 * TWO LANES, ONE CURSOR.
 *
 * A reading is either `verified` (a machine produced it) or `manual` (a person read the screen and
 * typed it — see `manual-entry.mjs`). Both advance the SAME cursor, because both are readings of
 * the same physical counter; a separate manual cursor would book the same stitches twice the
 * moment both lanes were live. But they land in different bucket fields — `stitches` versus
 * `manualStitches` — so no report can add them together without saying it did.
 *
 * An interval is attributed entirely to the lane of the reading that *closed* it, the same rule
 * already used at shift boundaries. Splitting it would require pretending we know the rate inside
 * the interval.
 *
 * Manual readings never add `runSeconds`. A person types one number at one instant; treating that
 * as evidence the machine ran for the whole preceding interval would be inventing history, and
 * run time is what "hiệu suất" is computed from.
 */

export const PRODUCTION_SCHEMA_VERSION = 2

/** Fastest industrial embroidery heads run ~1200 spm; 1500 leaves room without excusing a glitch. */
const DEFAULT_MAX_STITCHES_PER_MINUTE = 1_500

const emptyDocument = () => ({ schemaVersion: PRODUCTION_SCHEMA_VERSION, updatedAt: null, cursors: {}, buckets: {} })

export function bucketKey(date, shiftId, machineId) {
  return `${date}|${shiftId}|${machineId}`
}

export class ProductionLog {
  constructor({
    filePath,
    retentionDays = 120,
    maxStitchesPerMinute = DEFAULT_MAX_STITCHES_PER_MINUTE,
    maxRunGapSeconds = 120,
    logger = console,
  } = {}) {
    this.filePath = filePath
    this.retentionDays = retentionDays
    this.maxStitchesPerMinute = maxStitchesPerMinute
    this.maxRunGapSeconds = maxRunGapSeconds
    this.logger = logger
    this.document = emptyDocument()
    this.dirty = false
  }

  /** A corrupt production file must not stop the fleet view: we keep the backup and start clean. */
  async load() {
    if (!this.filePath) return this.document
    const result = await readJsonFile(this.filePath)
    if (result.ok) {
      const value = result.value
      if (value && typeof value === 'object' && value.schemaVersion === PRODUCTION_SCHEMA_VERSION) {
        this.document = {
          schemaVersion: PRODUCTION_SCHEMA_VERSION,
          updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
          cursors: sanitizeCursors(value.cursors),
          buckets: sanitizeBuckets(value.buckets),
        }
      } else {
        this.logger.warn?.('Bỏ qua sổ sản lượng không đúng schema, bắt đầu sổ mới.', { filePath: this.filePath })
        this.dirty = true
      }
    } else if (!result.missing) {
      this.logger.error?.('Không đọc được sổ sản lượng, bắt đầu sổ mới. Bản cũ vẫn còn ở file .bak.', { filePath: this.filePath, reason: result.error?.message })
      this.dirty = true
    }
    return this.document
  }

  /**
   * Folds one telemetry snapshot into the shift buckets.
   * Returns what happened so the caller can log it; never throws on bad data.
   */
  record(snapshot, { machine, site }) {
    const machineId = machine?.id ?? snapshot?.machineId
    if (!machineId) return { counted: false, reason: 'no-machine' }

    const odometer = readValue(snapshot?.odometer)
    if (odometer === null || !Number.isFinite(odometer) || odometer < 0) return { counted: false, reason: 'no-odometer' }
    // Anything that is neither a machine reading nor a declared hand-typed one is not bookable.
    // Keeping this as a rejection rather than a default means a future third quality cannot start
    // silently counting as production just because nobody updated this line.
    const quality = snapshot?.odometer?.quality ?? 'verified'
    if (quality !== 'verified' && quality !== 'manual') return { counted: false, reason: 'unverified-reading' }
    const manual = quality === 'manual'
    const lane = manual ? 'manual' : 'machine'

    const observedAt = snapshot?.odometer?.observedAt ?? snapshot?.observedAt ?? null
    const observedMs = observedAt ? Date.parse(observedAt) : Number.NaN
    if (Number.isNaN(observedMs)) return { counted: false, reason: 'no-timestamp' }

    const cursor = this.document.cursors[machineId]
    this.document.cursors[machineId] = { odometer, at: new Date(observedMs).toISOString(), quality }
    this.dirty = true

    if (!cursor) return { counted: false, reason: 'baseline', lane }

    const previousMs = Date.parse(cursor.at)
    if (Number.isNaN(previousMs) || observedMs < previousMs) {
      // Out-of-order or undated history: keep the newest cursor, count nothing.
      return { counted: false, reason: 'out-of-order', lane }
    }

    const bucket = this.bucketFor(observedAt, { machine, site, machineId })
    const elapsedSeconds = Math.max(0, (observedMs - previousMs) / 1_000)
    bucket.lastAt = new Date(observedMs).toISOString()
    // Counted separately so "3 lượt đọc" never turns out to mean "3 lần có người gõ tay". The two
    // numbers answer different questions: one is adapter coverage, the other is how much of this
    // bucket rests on somebody's eyesight.
    if (manual) bucket.manualReadings += 1
    else bucket.readings += 1

    if (!manual && readValue(snapshot?.status) === 'running') {
      // Cap the attributed run time: a gap caused by an outage is not machine run time.
      bucket.runSeconds += Math.round(Math.min(elapsedSeconds, this.maxRunGapSeconds))
    }

    const delta = odometer - cursor.odometer
    if (delta < 0) {
      bucket.resets += 1
      return { counted: false, reason: 'counter-reset', bucketKey: bucket.key, lane }
    }

    const plausibleMax = Math.ceil((elapsedSeconds / 60 + 1) * this.maxStitchesPerMinute)
    if (delta > plausibleMax) {
      bucket.anomalies += 1
      return { counted: false, reason: 'implausible-jump', delta, plausibleMax, bucketKey: bucket.key, lane }
    }

    if (manual) bucket.manualStitches += delta
    else bucket.stitches += delta
    return { counted: true, stitches: delta, bucketKey: bucket.key, lane, reason: delta === 0 ? 'idle' : 'counted' }
  }

  /**
   * Stitches are attributed to the shift the interval *ended* in. An interval that straddles a
   * shift change lands entirely in the incoming shift; at a 30s poll interval the error is at
   * most half a minute of stitching, and splitting it would require pretending we know the
   * per-second rate inside the interval.
   */
  bucketFor(observedAt, { machine, site, machineId }) {
    const resolved = resolveShift(observedAt, { timeZone: site?.timeZone, shifts: site?.shifts })
    const key = bucketKey(resolved.date, resolved.shiftId, machineId)
    let bucket = this.document.buckets[key]
    if (!bucket) {
      bucket = {
        key,
        date: resolved.date,
        shiftId: resolved.shiftId,
        shiftName: resolved.shiftName,
        machineId,
        siteId: machine?.siteId ?? site?.id ?? null,
        stitches: 0,
        manualStitches: 0,
        runSeconds: 0,
        readings: 0,
        manualReadings: 0,
        resets: 0,
        anomalies: 0,
        firstAt: new Date(Date.parse(observedAt)).toISOString(),
        lastAt: null,
      }
      this.document.buckets[key] = bucket
    }
    // The shift name can change in config; the report should read the current one.
    bucket.shiftName = resolved.shiftName
    return bucket
  }

  /** Drops buckets older than the retention window. Cursors stay: they are one row per machine. */
  prune(now = new Date()) {
    const today = new Date(now).toISOString().slice(0, 10)
    const cutoff = addDays(today, -this.retentionDays)
    let removed = 0
    for (const [key, bucket] of Object.entries(this.document.buckets)) {
      if (bucket.date < cutoff) {
        delete this.document.buckets[key]
        removed += 1
      }
    }
    if (removed) this.dirty = true
    return { removed, cutoff }
  }

  /**
   * The machine's current odometer baseline, or null if it has none yet.
   *
   * Exposed because the manual-entry path has to validate a typed number against the same cursor
   * the automatic lane uses — reaching into `document.cursors` from outside would make that
   * sharing an accident of reach rather than a stated rule.
   */
  cursorFor(machineId) {
    const cursor = this.document.cursors[machineId]
    return cursor ? { ...cursor } : null
  }

  /** Forgets a machine entirely — used when a machine is unpaired so its counter cannot resume. */
  forget(machineId) {
    if (this.document.cursors[machineId]) {
      delete this.document.cursors[machineId]
      this.dirty = true
    }
  }

  /** Buckets in a business-date range, newest first. Dates are inclusive and local to the site. */
  query({ from = null, to = null, siteId = null, machineIds = null } = {}) {
    const allowed = machineIds ? new Set(machineIds) : null
    return Object.values(this.document.buckets)
      .filter((bucket) => (from ? bucket.date >= from : true))
      .filter((bucket) => (to ? bucket.date <= to : true))
      .filter((bucket) => (siteId ? bucket.siteId === siteId : true))
      .filter((bucket) => (allowed ? allowed.has(bucket.machineId) : true))
      .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : b.date.localeCompare(a.date)))
      .map((bucket) => ({ ...bucket }))
  }

  async flush(now = new Date()) {
    if (!this.dirty || !this.filePath) return false
    this.document.updatedAt = new Date(now).toISOString()
    this.dirty = false
    try {
      await writeJsonAtomic(this.filePath, this.document)
      return true
    } catch (error) {
      this.dirty = true
      this.logger.error?.('Không ghi được sổ sản lượng.', { filePath: this.filePath, reason: error.message })
      return false
    }
  }
}

function readValue(reading) {
  if (reading === null || reading === undefined) return null
  return typeof reading === 'object' && 'value' in reading ? reading.value : reading
}

function sanitizeCursors(raw) {
  const cursors = {}
  if (!raw || typeof raw !== 'object') return cursors
  for (const [machineId, entry] of Object.entries(raw)) {
    const odometer = Number(entry?.odometer)
    if (!Number.isFinite(odometer) || odometer < 0) continue
    if (typeof entry?.at !== 'string' || Number.isNaN(Date.parse(entry.at))) continue
    // An older file has no `quality`; those cursors were all machine readings by construction,
    // because the manual lane did not exist when they were written.
    const quality = entry.quality === 'manual' ? 'manual' : 'verified'
    cursors[machineId] = { odometer, at: entry.at, quality }
  }
  return cursors
}

function sanitizeBuckets(raw) {
  const buckets = {}
  if (!raw || typeof raw !== 'object') return buckets
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date))) continue
    if (!entry.shiftId || !entry.machineId) continue
    buckets[key] = {
      key,
      date: String(entry.date),
      shiftId: String(entry.shiftId),
      shiftName: String(entry.shiftName ?? entry.shiftId),
      machineId: String(entry.machineId),
      siteId: entry.siteId ? String(entry.siteId) : null,
      stitches: nonNegative(entry.stitches),
      manualStitches: nonNegative(entry.manualStitches),
      runSeconds: nonNegative(entry.runSeconds),
      readings: nonNegative(entry.readings),
      manualReadings: nonNegative(entry.manualReadings),
      resets: nonNegative(entry.resets),
      anomalies: nonNegative(entry.anomalies),
      firstAt: typeof entry.firstAt === 'string' ? entry.firstAt : null,
      lastAt: typeof entry.lastAt === 'string' ? entry.lastAt : null,
    }
  }
  return buckets
}

function nonNegative(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
}

/**
 * Piece-rate money for one bucket. VND has no sub-unit in practice, so the result is rounded to
 * whole đồng; the caller keeps the rate it used so a later rate change cannot silently rewrite
 * a printed payslip.
 */
export function pieceRateAmount(stitches, pricePer1000Stitches) {
  const rate = Number(pricePer1000Stitches)
  if (!Number.isFinite(rate) || rate <= 0) return null
  const count = Number(stitches)
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.round((count / 1_000) * rate)
}
