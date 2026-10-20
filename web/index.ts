// M0 smoke test. Proves the static asset is served, the bundle loaded, and the
// drafting service is reachable through the same origin — in one page load.

const mark = (id: string, ok: boolean, text: string): void => {
  const el = document.getElementById(id)
  if (el === null) return
  el.textContent = text
  el.className = ok ? 'ok' : 'bad'
}

mark('static', true, 'served')
mark('bundle', true, 'loaded')

try {
  const res = await fetch('/healthz', { headers: { accept: 'application/json' } })

  if (!res.ok) {
    mark('api', false, `HTTP ${res.status}`)
  } else {
    const body: unknown = await res.json()
    const status =
      typeof body === 'object' && body !== null && 'status' in body
        ? String((body as { status: unknown }).status)
        : 'unknown'
    mark('api', status === 'ok', status)
  }
} catch (error) {
  mark('api', false, error instanceof Error ? error.message : 'unreachable')
}
