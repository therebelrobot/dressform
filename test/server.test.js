// Boots the built server on an ephemeral port and probes it. Requires `npm run build`.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

import { aaronMeasurements } from './support/fixtures.js'

const PORT = 18000 + Math.floor(Math.random() * 2000)
let child

before(async () => {
  child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start within 5s')), 5000)
    child.stdout.on('data', (buf) => {
      if (String(buf).includes('listening')) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
})

after(() => {
  child?.kill('SIGTERM')
})

test('GET /healthz answers ok', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/healthz`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'ok' })
})

test('an unknown route is a JSON 404', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/not-a-route`)
  assert.equal(res.status, 404)
  const body = await res.json()
  assert.equal(body.error, 'not found')
})

const url = (path) => `http://127.0.0.1:${PORT}${path}`

test('GET /designs lists the registered design in summary form', async () => {
  const res = await fetch(url('/designs'))
  assert.equal(res.status, 200)
  const designs = await res.json()
  assert.equal(designs.length, 1)
  assert.equal(designs[0].name, 'aaron')
  assert.equal(designs[0].options, undefined)
})

test('GET /designs/:design carries the option schema and the measurements', async () => {
  const res = await fetch(url('/designs/aaron'))
  assert.equal(res.status, 200)
  const detail = await res.json()
  assert.equal(detail.name, 'aaron')
  assert.ok(detail.options.some((option) => option.name === 'chestEase'))
  assert.ok(detail.measurements.some((m) => m.name === 'chest' && m.required))
  assert.ok(detail.measurements.some((m) => m.name === 'highBust' && !m.required))
})

test('GET /designs/:design is a 404 for a design that is not registered', async () => {
  const res = await fetch(url('/designs/nope'))
  assert.equal(res.status, 404)
})

test('POST /draft answers with a DraftResult', async () => {
  const res = await fetch(url('/draft'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ design: 'aaron', measurements: aaronMeasurements }),
  })
  assert.equal(res.status, 200)

  const result = await res.json()
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.units, 'mm')
  assert.match(result.svg, /^<\?xml/)
  assert.deepEqual(
    result.pieces.map((piece) => piece.id),
    ['aaron.front', 'aaron.back', 'aaron.armBinding', 'aaron.neckBinding'],
  )
})

test('POST /draft refuses an unknown design with a 422 naming the field', async () => {
  const res = await fetch(url('/draft'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ design: 'nope', measurements: aaronMeasurements }),
  })
  assert.equal(res.status, 422)

  const body = await res.json()
  assert.deepEqual(body.fields, [{ field: 'design', message: 'no design named `nope`' }])
})

test('POST /draft refuses a missing measurement with a 422 naming it', async () => {
  const { chest, ...withoutChest } = aaronMeasurements
  assert.ok(chest > 0)

  const res = await fetch(url('/draft'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ design: 'aaron', measurements: withoutChest }),
  })
  assert.equal(res.status, 422)

  const body = await res.json()
  assert.deepEqual(body.fields, [
    { field: 'measurements.chest', message: 'required by this design' },
  ])
})

test('POST /draft answers a body it cannot read as a request with a 400', async () => {
  for (const body of ['not json', '[1,2,3]', '"a string"']) {
    const res = await fetch(url('/draft'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(res.status, 400, `expected 400 for ${body}`)
  }
})
