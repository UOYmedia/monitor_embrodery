export class HttpError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export class RedThreadClient {
  constructor({ baseUrl, apiKey, fetchImpl = fetch, timeoutMs = 10_000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
    this.fetch = fetchImpl
    this.timeoutMs = timeoutMs
  }

  async #post(path, body) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lan-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new HttpError(`RedThread ${path} trả HTTP ${response.status}`, response.status)
    return response.json()
  }

  heartbeat(machines) {
    return this.#post('/api/v1/lan/heartbeat', { machines })
  }

  event(event) {
    return this.#post('/api/v1/lan/machine-events', event)
  }
}
