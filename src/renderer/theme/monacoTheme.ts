// Converts an IntelliJ editor scheme into a Monaco theme. Token names are the ones produced by
// Monaco's Monarch tokenizers (typescript, javascript, json, java, kotlin, html, css, markdown...).
import type { editor } from 'monaco-editor'
import type { SchemeChain, TextAttributes } from './editorScheme'

/** Monaco token -> IntelliJ text attribute key. More specific Monaco tokens win by prefix match. */
const TOKEN_ATTRIBUTES: readonly (readonly [token: string, attribute: string])[] = [
  ['', 'TEXT'],
  ['keyword', 'DEFAULT_KEYWORD'],
  ['string', 'DEFAULT_STRING'],
  ['string.escape', 'DEFAULT_VALID_STRING_ESCAPE'],
  ['string.key.json', 'DEFAULT_INSTANCE_FIELD'],
  ['string.value.json', 'DEFAULT_STRING'],
  ['number', 'DEFAULT_NUMBER'],
  ['comment', 'DEFAULT_LINE_COMMENT'],
  ['comment.doc', 'DEFAULT_DOC_COMMENT'],
  ['regexp', 'DEFAULT_STRING'],
  ['identifier', 'DEFAULT_IDENTIFIER'],
  ['type', 'DEFAULT_CLASS_NAME'],
  ['type.identifier', 'DEFAULT_CLASS_NAME'],
  ['annotation', 'DEFAULT_METADATA'],
  ['metatag', 'DEFAULT_METADATA'],
  ['constant', 'DEFAULT_CONSTANT'],
  ['delimiter', 'DEFAULT_OPERATION_SIGN'],
  ['operator', 'DEFAULT_OPERATION_SIGN'],
  ['tag', 'DEFAULT_TAG'],
  ['attribute.name', 'DEFAULT_ATTRIBUTE'],
  ['attribute.value', 'DEFAULT_STRING'],
  ['predefined', 'DEFAULT_PREDEFINED_SYMBOL'],
  ['variable', 'DEFAULT_LOCAL_VARIABLE'],
  ['invalid', 'BAD_CHARACTER'],
]

const strip = (hex: string): string => hex.replace(/^#/, '')

function rule(token: string, attributes: TextAttributes | undefined): editor.ITokenThemeRule | null {
  if (!attributes) return null
  const fontStyle = [attributes.fontType && attributes.fontType & 1 ? 'bold' : '', attributes.fontType && attributes.fontType & 2 ? 'italic' : '']
    .filter(Boolean)
    .join(' ')
  if (!attributes.foreground && !fontStyle) return null
  return {
    token,
    ...(attributes.foreground ? { foreground: strip(attributes.foreground) } : {}),
    ...(fontStyle ? { fontStyle } : {}),
  }
}

export function monacoThemeFromScheme(scheme: SchemeChain): editor.IStandaloneThemeData {
  const text = scheme.attributes('TEXT')
  const rules = TOKEN_ATTRIBUTES.map(([token, key]) => rule(token, scheme.attributes(key))).filter(
    (r): r is editor.ITokenThemeRule => r !== null,
  )

  const colors: Record<string, string> = {}
  const set = (monacoKey: string, value: string | undefined): void => {
    if (value) colors[monacoKey] = value
  }
  set('editor.background', text?.background)
  set('editor.foreground', text?.foreground)
  set('editorGutter.background', scheme.color('GUTTER_BACKGROUND') ?? text?.background)
  set('editor.lineHighlightBackground', scheme.color('CARET_ROW_COLOR'))
  set('editor.lineHighlightBorder', scheme.color('CARET_ROW_COLOR'))
  set('editor.selectionBackground', scheme.color('SELECTION_BACKGROUND'))
  set('editor.inactiveSelectionBackground', scheme.color('SELECTION_BACKGROUND'))
  set('editorCursor.foreground', scheme.color('CARET_COLOR'))
  set('editorLineNumber.foreground', scheme.color('LINE_NUMBERS_COLOR'))
  set('editorLineNumber.activeForeground', scheme.color('LINE_NUMBER_ON_CARET_ROW_COLOR'))
  set('editorIndentGuide.background1', scheme.color('INDENT_GUIDE'))
  set('editorIndentGuide.activeBackground1', scheme.color('SELECTED_INDENT_GUIDE'))
  set('editorWhitespace.foreground', scheme.color('WHITESPACES'))
  set('editorRuler.foreground', scheme.color('RIGHT_MARGIN_COLOR'))
  set('editor.wordHighlightBackground', scheme.attributes('IDENTIFIER_UNDER_CARET_ATTRIBUTES')?.background)
  set('editor.wordHighlightStrongBackground', scheme.attributes('WRITE_IDENTIFIER_UNDER_CARET_ATTRIBUTES')?.background)
  set('editor.findMatchHighlightBackground', scheme.attributes('SEARCH_RESULT_ATTRIBUTES')?.background)
  set('editor.findMatchBackground', scheme.attributes('TEXT_SEARCH_RESULT_ATTRIBUTES')?.background)
  set('editorBracketMatch.background', scheme.attributes('MATCHED_BRACE_ATTRIBUTES')?.background)
  set('editorBracketMatch.border', scheme.attributes('MATCHED_BRACE_ATTRIBUTES')?.background)
  set('editorError.foreground', scheme.attributes('ERRORS_ATTRIBUTES')?.effectColor)
  set('editorWarning.foreground', scheme.attributes('WARNING_ATTRIBUTES')?.effectColor)
  set('editorGutter.addedBackground', scheme.color('ADDED_LINES_COLOR'))
  set('editorGutter.modifiedBackground', scheme.color('MODIFIED_LINES_COLOR'))
  set('editorGutter.deletedBackground', scheme.color('DELETED_LINES_COLOR'))

  return { base: 'vs-dark', inherit: true, rules, colors }
}
