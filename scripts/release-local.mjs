import { rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const rootDir = path.resolve(import.meta.dirname, '..')
const arch = process.arch

const electronBuilderArchFlagByNodeArch = {
  arm64: '--arm64',
  x64: '--x64'
}

const archFlag = electronBuilderArchFlagByNodeArch[arch]

if (!archFlag) {
  console.error(`Unsupported local release architecture: ${arch}`)
  process.exit(1)
}

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      }
    })

    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })

console.log(`Creating local macOS release for ${arch}.`)
await rm(path.join(rootDir, 'release'), { recursive: true, force: true })
await run('pnpm', ['build'])
await run('pnpm', ['exec', 'electron-builder', '--mac', archFlag])
