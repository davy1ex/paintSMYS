globalThis.paintSMYSPlugin = {
  activate(api) {
    api.registerCommand('create-hello-world', async (host) => {
      const document = await host.snapshotDocument()
      const artboard = document.artboard

      // Edit these values to change the color, size, or position.
      const width = Math.max(1, Math.min(560, artboard.width - 48))
      const height = Math.max(1, Math.min(180, artboard.height - 48))
      const x = Math.round((artboard.width - width) / 2)
      const y = Math.round((artboard.height - height) / 2)
      const fill = '#2f6fed'
      const message = 'Hello from paintSMYS!'

      await host.addObjects([
        {
          type: 'rectangle',
          x,
          y,
          width,
          height,
          fill,
          stroke: '#1d3f91',
          strokeWidth: 2,
        },
        {
          type: 'text',
          x: x + 32,
          y: y + Math.round(height / 2) + 10,
          text: message,
          fontFamily: 'Arial',
          fontSize: 30,
          color: '#ffffff',
        },
      ])
    })
  },
}
