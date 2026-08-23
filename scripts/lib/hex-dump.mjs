/**
 * Formats raw bytes as offset + hex + printable ASCII, side by side.
 *
 * The A15 dials out with an undocumented binary payload, so the first honest step is to look at every
 * byte. `Buffer.toString()` silently mangles the non-printable ones and logging a JSON array drops the
 * alignment that makes framing visible — and framing is exactly what we are trying to find. So the
 * output keeps three views of the same bytes: where they sit, what they are, and what they spell.
 */

/** Bytes outside printable ASCII become '.', because a terminal cannot show them faithfully. */
function readable(byte) {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'
}

/**
 * Returns one string per line. `offset` is the absolute position of `bytes[0]` in the stream, so a
 * caller reading a socket in chunks can keep the addresses continuous across calls.
 */
export function hexDump(bytes, { offset = 0, width = 16 } = {}) {
  const half = Math.ceil(width / 2)
  const lines = []
  for (let i = 0; i < bytes.length; i += width) {
    const chunk = bytes.subarray(i, i + width)
    const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, '0'))
    const left = hex.slice(0, half).join(' ').padEnd(half * 3 - 1, ' ')
    const right = hex.slice(half).join(' ').padEnd((width - half) * 3 - 1, ' ')
    const text = Array.from(chunk, readable).join('')
    lines.push(`${(offset + i).toString(16).padStart(8, '0')}  ${left}  ${right}  |${text}|`)
  }
  return lines
}
