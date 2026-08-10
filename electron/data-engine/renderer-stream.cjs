const createRendererProjectionStream = () => {
  const subscribers = new Set()
  let currentPort = null
  let currentGeneration = 0
  let detachCurrentPort = () => {}

  const replacePort = (port, generation) => {
    detachCurrentPort()
    currentPort?.close?.()
    currentPort = port
    currentGeneration = Number(generation) || 0

    if (!port) {
      detachCurrentPort = () => {}
      return
    }

    const handleMessage = event => {
      const data = event?.data ?? event

      if (
        data?.type !== 'projection' ||
        Number(data.generation) !== currentGeneration ||
        !data.projection ||
        typeof data.projection !== 'object'
      ) {
        return
      }

      const projection = {
        ...data.projection,
        generation: currentGeneration
      }

      for (const subscriber of subscribers) {
        subscriber(projection)
      }
    }

    if (typeof port.addEventListener === 'function') {
      port.addEventListener('message', handleMessage)
      detachCurrentPort = () => {
        port.removeEventListener('message', handleMessage)
      }
    } else if (typeof port.on === 'function') {
      port.on('message', handleMessage)
      detachCurrentPort = () => {
        port.off?.('message', handleMessage)
      }
    } else {
      port.onmessage = handleMessage
      detachCurrentPort = () => {
        if (port.onmessage === handleMessage) {
          port.onmessage = null
        }
      }
    }

    port.start?.()
  }

  const subscribe = callback => {
    if (typeof callback !== 'function') {
      throw new Error('Projection subscriber must be a function.')
    }

    subscribers.add(callback)

    return () => {
      subscribers.delete(callback)
    }
  }

  const dispose = () => {
    detachCurrentPort()
    currentPort?.close?.()
    currentPort = null
    currentGeneration = 0
    subscribers.clear()
  }

  return {
    dispose,
    replacePort,
    subscribe
  }
}

module.exports = {
  createRendererProjectionStream
}
