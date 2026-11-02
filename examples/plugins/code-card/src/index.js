import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import python from 'shiki/langs/python.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import darkPlus from 'shiki/themes/dark-plus.mjs'

const BASE_TEXT_COLOR = '#D4D4D4'
const CODE_BACKGROUND = '#1E1E1E'
const CODE_FONT_FAMILY = 'Consolas'
const MAX_CARD_WIDTH = 1_200
const MAX_CARD_HEIGHT = 900
const MIN_CARD_WIDTH = 520
const MIN_CARD_HEIGHT = 280
const MIN_CODE_FONT_SIZE = 11
const MAX_CODE_FONT_SIZE = 16
const LANGUAGE_OPTIONS = [
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
]

let highlighterPromise

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      langs: [python, javascript, typescript],
      themes: [darkPlus],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n')
}

function isWideCodePoint(codePoint) {
  const value = codePoint.codePointAt(0)
  return (
    (value >= 0x1100 && value <= 0x115f) || value === 0x2329 || value === 0x232a ||
    (value >= 0x2e80 && value <= 0xa4cf && value !== 0x303f) ||
    (value >= 0xac00 && value <= 0xd7a3) || (value >= 0xf900 && value <= 0xfaff) ||
    (value >= 0xfe10 && value <= 0xfe19) || (value >= 0xfe30 && value <= 0xfe6f) ||
    (value >= 0xff00 && value <= 0xff60) || (value >= 0xffe0 && value <= 0xffe6) ||
    (value >= 0x1f300 && value <= 0x1faff) || (value >= 0x20000 && value <= 0x3fffd)
  )
}

function codeLineWidthEm(text) {
  let width = 0
  let columns = 0
  for (const character of text) {
    if (character === '\t') {
      const spaces = 4 - (columns % 4)
      width += spaces * 0.62
      columns += spaces
    } else {
      const columnsForCharacter = isWideCodePoint(character) ? 2 : 1
      width += columnsForCharacter === 2 ? 1 : 0.62
      columns += columnsForCharacter
    }
  }
  return width
}

function titleWidthEm(text) {
  let width = 0
  for (const character of text) {
    width += isWideCodePoint(character) ? 1 : character === ' ' ? 0.35 : 0.58
  }
  return width
}

function appendRun(runs, start, end, color) {
  if (start >= end || color.toUpperCase() === BASE_TEXT_COLOR) return
  const previous = runs[runs.length - 1]
  if (previous && previous.end === start && previous.color === color) {
    previous.end = end
  } else {
    runs.push({ start, end, color })
  }
}

function tokenRuns(text, tokenLines) {
  const runs = []
  let previousEnd = 0

  for (const line of tokenLines) {
    for (const token of line) {
      const start = token.offset
      const end = start + token.content.length
      if (
        !Number.isInteger(start) || start < previousEnd || end > text.length ||
        text.slice(start, end) !== token.content
      ) {
        throw new Error('Shiki returned token offsets that do not match the source text.')
      }
      previousEnd = end
      if (typeof token.color === 'string' && /^#[0-9a-f]{6}$/i.test(token.color)) {
        appendRun(runs, start, end, token.color)
      }
    }
  }

  return runs
}

async function highlightSource(text, language) {
  const highlighter = await getHighlighter()
  const tokenLines = await highlighter.codeToTokensBase(text, { lang: language, theme: 'dark-plus' })
  return tokenRuns(text, tokenLines)
}

function addRectangle(objects, x, y, width, height, fill, stroke = fill, strokeWidth = 0) {
  objects.push({ type: 'rectangle', x, y, width, height, fill, stroke, strokeWidth })
}

function addText(objects, x, y, text, fontFamily, fontSize, color, runs) {
  objects.push({
    type: 'text', x, y, text, fontFamily, fontSize, color,
    ...(runs?.length ? { runs } : {}),
  })
}

function measureLayout(artboard, title, sourceText) {
  const maxWidth = Math.min(MAX_CARD_WIDTH, artboard.width - 48)
  const maxHeight = Math.min(MAX_CARD_HEIGHT, artboard.height - 48)
  if (maxWidth < MIN_CARD_WIDTH || maxHeight < MIN_CARD_HEIGHT) {
    throw new Error('Generate Code Card needs an Artboard at least 568 × 328 px.')
  }

  const lines = sourceText.split('\n')
  const longestLineEm = Math.max(0, ...lines.map(codeLineWidthEm))
  const gutterDigits = String(lines.length).length
  const chromeHeight = 6 + 30 + 24 + 24 + 6
  const availableCodeWidth = maxWidth - 12 - 18 - (gutterDigits * MAX_CODE_FONT_SIZE * 0.62 + 18) - 14 - 18
  const availableCodeHeight = maxHeight - chromeHeight - 24
  const widthFontSize = longestLineEm > 0 ? availableCodeWidth / longestLineEm : MAX_CODE_FONT_SIZE
  const heightFontSize = availableCodeHeight / (lines.length * 1.35)
  const fontSize = Math.min(MAX_CODE_FONT_SIZE, widthFontSize, heightFontSize)
  if (!Number.isFinite(fontSize) || fontSize < MIN_CODE_FONT_SIZE) {
    throw new Error('This code does not fit the Artboard at a readable size. Use a larger Artboard or shorter lines.')
  }

  const codeFontSize = Math.floor(fontSize * 2) / 2
  const lineHeight = codeFontSize * 1.35
  const gutterWidth = Math.max(30, gutterDigits * codeFontSize * 0.62 + 18)
  const cardWidth = Math.min(maxWidth, Math.max(
    MIN_CARD_WIDTH,
    12 + 18 + gutterWidth + 14 + longestLineEm * codeFontSize + 18,
  ))
  const codePanelHeight = Math.max(MIN_CARD_HEIGHT - chromeHeight, lines.length * lineHeight + 24)
  const cardHeight = chromeHeight + codePanelHeight
  if (cardHeight > maxHeight) {
    throw new Error('This code does not fit the Artboard. Use a taller Artboard or fewer lines.')
  }

  const x = Math.round((artboard.width - cardWidth) / 2)
  const y = Math.round((artboard.height - cardHeight) / 2)
  const titleBarX = x + 6
  const titleBarY = y + 6
  const buttonsRight = titleBarX + cardWidth - 12 - 8
  const buttonWidth = 20
  const buttonGap = 4
  const closeX = buttonsRight - buttonWidth
  const maximizeX = closeX - buttonGap - buttonWidth
  const minimizeX = maximizeX - buttonGap - buttonWidth
  const titleX = titleBarX + 10
  const titleAvailableWidth = minimizeX - 8 - titleX
  const titleFontSize = Math.min(16, titleAvailableWidth / Math.max(titleWidthEm(title), 1) * 0.92)
  if (titleFontSize < 10) {
    throw new Error('The window title is too long to fit beside the title bar buttons.')
  }

  const menuY = titleBarY + 30
  const codePanelY = menuY + 24
  const codePanelX = x + 6
  const codePanelWidth = cardWidth - 12
  const statusY = codePanelY + codePanelHeight
  const codeY = codePanelY + 10
  const lineNumberX = codePanelX + 8
  const codeX = lineNumberX + gutterWidth + 14

  return {
    lines, x, y, cardWidth, cardHeight, titleBarX, titleBarY, titleX, titleFontSize,
    menuY, codePanelX, codePanelY, codePanelWidth, codePanelHeight, codeY,
    statusY, lineNumberX, codeX, gutterWidth, codeFontSize, lineHeight,
    minimizeX, maximizeX, closeX, buttonWidth,
  }
}

function buildCardObjects(title, language, sourceText, runs, layout) {
  const objects = []
  const {
    lines, x, y, cardWidth, cardHeight, titleBarX, titleBarY, titleX, titleFontSize,
    menuY, codePanelX, codePanelY, codePanelWidth, codePanelHeight, codeY,
    statusY, lineNumberX, codeX, codeFontSize, lineHeight,
    minimizeX, maximizeX, closeX, buttonWidth,
  } = layout

  // Raised Win95 frame with a dark offset shadow and a four-sided bevel.
  addRectangle(objects, x + 7, y + 7, cardWidth, cardHeight, '#404040', '#000000', 1)
  addRectangle(objects, x, y, cardWidth, cardHeight, '#C0C0C0', '#000000', 2)
  addRectangle(objects, x + 3, y + 3, cardWidth - 6, 2, '#FFFFFF')
  addRectangle(objects, x + 3, y + 3, 2, cardHeight - 6, '#FFFFFF')
  addRectangle(objects, x + 3, y + cardHeight - 5, cardWidth - 6, 2, '#808080')
  addRectangle(objects, x + cardWidth - 5, y + 3, 2, cardHeight - 6, '#808080')
  addRectangle(objects, titleBarX, titleBarY, cardWidth - 12, 30, '#000080')
  addRectangle(objects, codePanelX, codePanelY, codePanelWidth, codePanelHeight, CODE_BACKGROUND, '#808080', 2)
  addRectangle(objects, codePanelX + 12 + Math.max(30, String(lines.length).length * codeFontSize * 0.62 + 18), codePanelY + 8, 1, codePanelHeight - 16, '#454545')
  addRectangle(objects, codePanelX, statusY, codePanelWidth, 24, '#C0C0C0', '#FFFFFF', 2)

  const buttonY = titleBarY + 5
  for (const buttonX of [minimizeX, maximizeX, closeX]) {
    addRectangle(objects, buttonX, buttonY, buttonWidth, 19, '#C0C0C0', '#FFFFFF', 2)
    addRectangle(objects, buttonX + buttonWidth - 2, buttonY + 2, 2, 15, '#808080')
    addRectangle(objects, buttonX + 2, buttonY + 17, buttonWidth - 4, 2, '#808080')
  }

  addText(objects, titleX, titleBarY + 6, title, 'Arial', titleFontSize, '#FFFFFF')
  addText(objects, minimizeX + 6, buttonY + 1, '_', 'Arial', 14, '#000000')
  addText(objects, maximizeX + 3, buttonY + 2, '□', 'Arial', 13, '#000000')
  addText(objects, closeX + 4, buttonY, '×', 'Arial', 16, '#000000')
  addText(objects, codePanelX + 12, menuY + 2, 'File   Edit   Search   Help', 'Arial', 13, '#000000')

  const lineNumbers = lines.map((_, index) => String(index + 1).padStart(String(lines.length).length, ' ')).join('\n')
  addText(objects, lineNumberX, codeY, lineNumbers, CODE_FONT_FAMILY, codeFontSize, '#858585')
  addText(objects, codeX, codeY, sourceText, CODE_FONT_FAMILY, codeFontSize, BASE_TEXT_COLOR, runs)
  addText(objects, codePanelX + 12, statusY + 3, `Ready   |   ${language}   |   ${lines.length} lines`, 'Arial', 12, '#000000')

  return objects
}

globalThis.paintSMYSPlugin = {
  activate(api) {
    api.registerCommand('generate-code-card', async (host) => {
      const showForm = host.ui?.showForm
      if (typeof showForm !== 'function') {
        await host.showError('This paintSMYS version does not support plugin forms.')
        return
      }

      const formResult = await showForm({
        title: 'Generate Code Card',
        fields: [
          {
            id: 'windowTitle',
            type: 'text',
            label: 'Window title',
            defaultValue: 'Code Editor',
            required: true,
          },
          {
            id: 'language',
            type: 'select',
            label: 'Language',
            options: LANGUAGE_OPTIONS,
            defaultValue: 'python',
            required: true,
          },
          {
            id: 'sourceCode',
            type: 'textarea',
            label: 'Source code',
          },
        ],
        submitLabel: 'Generate',
      })
      if (formResult.status === 'cancelled') return

      const { windowTitle, language, sourceCode } = formResult.values
      if (!LANGUAGE_OPTIONS.some((option) => option.value === language)) {
        await host.showError('Choose Python, JavaScript, or TypeScript for the code card.')
        return
      }
      if (typeof windowTitle !== 'string' || !windowTitle.trim()) {
        await host.showError('Enter a window title for the code card.')
        return
      }

      const document = await host.snapshotDocument()
      const normalizedSource = normalizeNewlines(sourceCode)
      const layout = measureLayout(document.artboard, windowTitle, normalizedSource)
      const runs = await highlightSource(normalizedSource, language)
      await host.addObjects(buildCardObjects(windowTitle, language, normalizedSource, runs, layout))
    })
  },
}
