import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  DraftValidationError,
  describeDesign,
  draft,
  listDesigns,
  type DraftRequest,
} from '../draft/index'

const PORT = Number(process.env['PORT'] ?? 8091)
const HOST = process.env['HOST'] ?? '0.0.0.0'

/** A draft request is a measurement set and an option bag. A megabyte is generous. */
const MAX_BODY_BYTES = 1024 * 1024

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

const notFound = (res: ServerResponse, pathname: string): void => {
  json(res, 404, { error: 'not found', path: pathname })
}

/** The body as text, or null when the client sent more than the cap. */
const readBody = (req: IncomingMessage): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const parseJsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * `POST /draft`.
 *
 * Two failure modes, drawn where the technical design §6.4 draws them: a body
 * the transport could not read as a request is `400`; a request the design
 * refuses is `422` and names the fields. Anything else is a bug in this
 * process, and it says so loudly rather than answering with half a pattern.
 */
const draftRoute = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const body = await readBody(req)
  if (body === null) {
    json(res, 400, { error: 'malformed request body', detail: `over ${MAX_BODY_BYTES} bytes` })
    return
  }

  const parsed = parseJsonObject(body)
  if (parsed === null) {
    json(res, 400, { error: 'malformed request body', detail: 'expected a JSON object' })
    return
  }

  try {
    json(res, 200, await draft(parsed as unknown as DraftRequest))
  } catch (error) {
    if (error instanceof DraftValidationError) {
      json(res, 422, { error: error.message, fields: error.fields })
      return
    }
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`draft failed: ${detail}\n`)
    json(res, 500, { error: 'internal error' })
  }
}

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'GET' && pathname === '/healthz') {
    json(res, 200, { status: 'ok' })
    return
  }

  if (req.method === 'GET' && pathname === '/designs') {
    json(res, 200, listDesigns())
    return
  }

  if (req.method === 'GET' && pathname.startsWith('/designs/')) {
    const name = decodeURIComponent(pathname.slice('/designs/'.length))
    const detail = describeDesign(name)
    if (detail === undefined) {
      notFound(res, pathname)
      return
    }
    json(res, 200, detail)
    return
  }

  if (req.method === 'POST' && pathname === '/draft') {
    await draftRoute(req, res)
    return
  }

  notFound(res, pathname)
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`unhandled request failure: ${detail}\n`)
    if (!res.headersSent) json(res, 500, { error: 'internal error' })
    else res.end()
  })
})

server.listen(PORT, HOST, () => {
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : PORT
  process.stdout.write(`dressform drafting service listening on http://${HOST}:${bound}\n`)
})
