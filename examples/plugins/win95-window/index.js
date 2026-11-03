globalThis.paintSMYSPlugin = {
  activate(api) {
    api.registerCommand('generate-win95-window', async (host) => {
      const WINDOW_MAX_WIDTH = 480
      const WINDOW_MAX_HEIGHT = 340
      const WINDOW_VERTICAL_MARGIN = 24
      const MIN_ARTBOARD_WIDTH = 404
      const MIN_WINDOW_HEIGHT = 168
      const MIN_TITLE_FONT_SIZE = 10
      const MIN_WELCOME_FONT_SIZE = 12
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
      const availableWindowHeight = artboardHeight - WINDOW_VERTICAL_MARGIN * 2
      if (artboardWidth < MIN_ARTBOARD_WIDTH || availableWindowHeight < MIN_WINDOW_HEIGHT) {
        await host.showError('Generate Win95 Window needs an Artboard at least 404 × 216 px to fit the window.')
        return
      }

      const width = Math.min(WINDOW_MAX_WIDTH, artboardWidth - 48)
      const height = Math.min(WINDOW_MAX_HEIGHT, availableWindowHeight)
      const x = Math.round((artboardWidth - width) / 2)
      const y = Math.round((artboardHeight - height) / 2)
      const contentX = x + 12
      const contentY = y + 48
      const contentWidth = width - 24
      const contentHeight = height - 82
      const statusY = y + height - 28
      const titleTextWidth = width - 100
      const titleFontSize = Math.min(16, titleTextWidth / (windowTitle.length * 0.6))
      const welcomeTextWidth = contentWidth - 94
      const welcomeFontSize = Math.min(18, welcomeTextWidth / (welcomeMessage.length * 0.6))
      if (titleFontSize < MIN_TITLE_FONT_SIZE || welcomeFontSize < MIN_WELCOME_FONT_SIZE) {
        await host.showError('The window title or welcome message is too long. Shorten it or use a larger Artboard.')
        return
      }
      await host.addObjects([
        { type: 'rectangle', x: x + 7, y: y + 7, width, height, fill: '#404040', stroke: '#000000', strokeWidth: 2 },
        { type: 'rectangle', x, y, width, height, fill: '#c0c0c0', stroke: '#000000', strokeWidth: 2 },
        { type: 'rectangle', x: x + 4, y: y + 4, width: width - 8, height: height - 8, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'rectangle', x: x + 8, y: y + 8, width: width - 16, height: 28, fill: '#000080', stroke: '#000080', strokeWidth: 1 },
        { type: 'text', x: x + 16, y: y + 13, text: windowTitle, fontFamily: 'Arial', fontSize: titleFontSize, color: '#ffffff' },
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
        { type: 'text', x: contentX + 82, y: contentY + 18, text: welcomeMessage, fontFamily: 'Arial', fontSize: welcomeFontSize, color: '#000080' },
        { type: 'text', x: contentX + 82, y: contentY + 45, text: 'Your desktop is ready.', fontFamily: 'Arial', fontSize: 14, color: '#000000' },
        { type: 'text', x: contentX + 82, y: contentY + 68, text: 'Double-click an icon to begin.', fontFamily: 'Arial', fontSize: 12, color: '#000000' },
        { type: 'rectangle', x: contentX, y: statusY, width: contentWidth, height: 18, fill: '#c0c0c0', stroke: '#ffffff', strokeWidth: 2 },
        { type: 'text', x: contentX + 8, y: statusY + 2, text: '3 items', fontFamily: 'Arial', fontSize: 12, color: '#000000' },
      ])
    })
  },
}
