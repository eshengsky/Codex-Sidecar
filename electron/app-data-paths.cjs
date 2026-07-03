const path = require('node:path')

const PACKAGED_USER_DATA_NAME = 'Codex Sidecar'
const DEVELOPMENT_USER_DATA_NAME = 'Codex Sidecar Dev'
const SESSION_DATA_DIR_NAME = 'session-data'

const resolveAppDataPaths = ({ appDataPath, isPackaged }) => {
  if (!appDataPath || typeof appDataPath !== 'string') {
    throw new Error('appDataPath is required.')
  }

  const userDataName = isPackaged ? PACKAGED_USER_DATA_NAME : DEVELOPMENT_USER_DATA_NAME
  const userDataPath = path.join(appDataPath, userDataName)

  return {
    userDataPath,
    sessionDataPath: path.join(userDataPath, SESSION_DATA_DIR_NAME)
  }
}

const configureAppDataPaths = ({ app, fs }) => {
  const paths = resolveAppDataPaths({
    appDataPath: app.getPath('appData'),
    isPackaged: app.isPackaged
  })

  fs.mkdirSync(paths.userDataPath, { recursive: true })
  fs.mkdirSync(paths.sessionDataPath, { recursive: true })

  app.setPath('userData', paths.userDataPath)
  app.setPath('sessionData', paths.sessionDataPath)

  return paths
}

module.exports = {
  configureAppDataPaths,
  resolveAppDataPaths
}
