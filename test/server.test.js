// Boots the built server on an ephemeral port and probes it. Requires `npm run build`.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

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
