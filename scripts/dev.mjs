import { spawn } from 'node:child_process'
import electronPath from 'electron'
import { createServer } from 'vite'

const server = await createServer({
  configFile: 'vite.config.ts',
  server: {
    host: '127.0.0.1'
  }
})

await server.listen()

const url = server.resolvedUrls?.local?.[0]

if (!url) {
  await server.close()
  throw new Error('Vite dev server did not expose a local URL.')
}

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: url
  }
})

const shutdown = async (code = 0) => {
  child.kill()
  await server.close()
  process.exit(code)
}

child.on('exit', async code => {
  await server.close()
  process.exit(code ?? 0)
})

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
