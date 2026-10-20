import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const PORT = Number(process.env['PORT'] ?? 8091)
const HOST = process.env['HOST'] ?? '0.0.0.0'

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

const routes = (req: IncomingMessage, res: ServerResponse): void => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && pathname === '/healthz') {
    json(res, 200, { status: 'ok' })
    return
  }

  // GET /designs, GET /designs/:design, and POST /draft arrive with M1.
  json(res, 404, { error: 'not found', path: pathname })
}

const server = createServer(routes)

server.listen(PORT, HOST, () => {
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : PORT
  process.stdout.write(`dressform drafting service listening on http://${HOST}:${bound}\n`)
})
