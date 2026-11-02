globalThis.paintSMYSPlugin = {
  activate(api) {
    api.registerCommand('generate-win95-window', async (host) => {
      const showForm = host.ui?.showForm
      if (typeof showForm !== 'function') {
        await host.showError('This paintSMYS version does not support plugin forms.')
        return
      }
      const formResult = await showForm({
        title: 'Generate Win95 Window',
        fields: [
          {
            id: 'windowTitle',
            type: 'text',
            label: 'Window title',
            defaultValue: 'Program Manager',
            required: true,
          },
          {
            id: 'welcomeMessage',
            type: 'text',
            label: 'Welcome message',
            defaultValue: 'Welcome to Windows 95',
            required: true,
          },
        ],
        submitLabel: 'Generate',
      })
      if (formResult.status === 'cancelled') return

      const { windowTitle, welcomeMessage } = formResult.values
      const document = await host.snapshotDocument()
      const { width: artboardWidth, height: artboardHeight } = document.artboard
      if (artboardWidth < 220 || artboardHeight < 180) {
        await host.showError('Generate Win95 Window needs an Artboard at least 220 × 180 px.')
        return
      }

      const width = Math.min(480, artboardWidth - 48)
      const height = Math.min(340, artboardHeight - 48)
      const x = Math.round((artboardWidth - width) / 2)
      const y = Math.round((artboardHeight - height) / 2)
      const contentX = x + 12
      const contentY = y + 48
      const contentWidth = width - 24
      const contentHeight = height - 82
      const statusY = y + height - 28

      await host.addObjects([
        { type: 'rectangle', x: x + 7, y: y + 7, width, height, fill: '#404040', stroke: '#000000', strokeWidth: 2 },
        { type: 'rectangle', x, y, width, height, fill: '#c0c0c0', stroke: '#000000', strokeWidth: 2 },
        { type: 'rectangle', x: x + 4, y: y + 4, width: width - 8, height: height - 8, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'rectangle', x: x + 8, y: y + 8, width: width - 16, height: 28, fill: '#000080', stroke: '#000080', strokeWidth: 1 },
        { type: 'text', x: x + 16, y: y + 13, text: windowTitle, fontFamily: 'Arial', fontSize: 16, color: '#ffffff' },
        { type: 'rectangle', x: x + width - 76, y: y + 13, width: 18, height: 17, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'text', x: x + width - 73, y: y + 12, text: '_', fontFamily: 'Arial', fontSize: 15, color: '#000000' },
        { type: 'rectangle', x: x + width - 52, y: y + 13, width: 18, height: 17, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'text', x: x + width - 50, y: y + 13, text: '□', fontFamily: 'Arial', fontSize: 13, color: '#000000' },
        { type: 'rectangle', x: x + width - 28, y: y + 13, width: 18, height: 17, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'text', x: x + width - 25, y: y + 12, text: '×', fontFamily: 'Arial', fontSize: 16, color: '#000000' },
        { type: 'rectangle', x: contentX, y: contentY, width: contentWidth, height: contentHeight, fill: '#ffffff', stroke: '#808080', strokeWidth: 2 },
        { type: 'rectangle', x: contentX + 12, y: contentY + 12, width: 52, height: 52, fill: '#000080', stroke: '#000000', strokeWidth: 1 },
        { type: 'rectangle', x: contentX + 20, y: contentY + 20, width: 36, height: 25, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'text', x: contentX + 15, y: contentY + 68, text: 'Main', fontFamily: 'Arial', fontSize: 12, color: '#000000' },
        { type: 'text', x: contentX + 82, y: contentY + 18, text: welcomeMessage, fontFamily: 'Arial', fontSize: 18, color: '#000080' },
        { type: 'text', x: contentX + 82, y: contentY + 45, text: 'Your desktop is ready.', fontFamily: 'Arial', fontSize: 14, color: '#000000' },
        { type: 'text', x: contentX + 82, y: contentY + 68, text: 'Double-click an icon to begin.', fontFamily: 'Arial', fontSize: 12, color: '#000000' },
        { type: 'rectangle', x: contentX, y: statusY, width: contentWidth, height: 18, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'text', x: contentX + 8, y: statusY + 2, text: '3 items', fontFamily: 'Arial', fontSize: 12, color: '#000000' },
        { type: 'rectangle', x: x + 12, y: y + height - 6, width: 72, height: 25, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'text', x: x + 28, y: y + height - 2, text: 'Start', fontFamily: 'Arial', fontSize: 14, color: '#000000' },
        { type: 'text', x: x + 98, y: y + height - 1, text: 'Programs     Settings     Help', fontFamily: 'Arial', fontSize: 12, color: '#000000' },
      ])
    })
  },
}
