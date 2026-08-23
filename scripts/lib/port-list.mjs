/**
 * Parses a port specification like "1600", "80,443,1600" or "1-3865" into an explicit port list.
 *
 * The embroidery controller only accepts a port in the range its own screen prints next to
 * `C41 Server Port`: `<1,3865>`. So when the machine stays silent, "it dialled a port we were not
 * listening on" is a live explanation — and an invisible one, because a SYN to a closed port is
 * answered by the kernel with RST and never reaches us. Listening across the whole advertised range
 * turns that invisible failure into a visible one. This function exists so the range is written once,
 * validated once, and testable without opening a socket.
 *
 * Ranges are inclusive and the result is sorted and de-duplicated, so overlapping items in the spec
 * ("1600,1500-1700") bind one socket per port rather than two on the same port.
 */

const LIMIT = 65535

function parseOne(token) {
  if (!/^\d+$/.test(token)) throw new RangeError(`"${token}" is not a port number`)
  const port = Number(token)
  if (port < 1 || port > LIMIT) throw new RangeError(`port ${port} is outside 1-${LIMIT}`)
  return port
}

export function parsePorts(spec) {
  const tokens = String(spec).split(',').map((part) => part.trim()).filter((part) => part !== '')
  if (tokens.length === 0) throw new RangeError('no port given')
  const ports = new Set()
  for (const token of tokens) {
    const dash = token.indexOf('-')
    if (dash <= 0) { ports.add(parseOne(token)); continue }
    const from = parseOne(token.slice(0, dash).trim())
    const to = parseOne(token.slice(dash + 1).trim())
    if (from > to) throw new RangeError(`range "${token}" runs backwards`)
    for (let port = from; port <= to; port += 1) ports.add(port)
  }
  return [...ports].sort((a, b) => a - b)
}
