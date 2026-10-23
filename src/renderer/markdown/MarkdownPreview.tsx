import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { dirname, normalizePath } from '@shared/paths'
import { openDocument } from '../editor/documents'
import { openFile } from '../state/workbench'
import { runInNewTerminal } from '../terminal/TerminalView'
import { renderMarkdown } from './render'
import { findShellFences } from './shellFences'

const RENDER_DELAY_MS = 150

/** Absolute path of a link or image relative to the Markdown file; null for URLs and anchors. */
export function resolveLocal(markdownPath: string, target: string): string | null {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) return null
  const path = decodeURIComponent(target.split('#')[0]!.split('?')[0]!)
  return normalizePath(path.startsWith('/') ? path : `${dirname(markdownPath)}/${path}`)
}

/** Rendered Markdown of a document, updated as it is edited. */
export function MarkdownPreview({ path }: { path: string }) {
  const container = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState('')
  const source = useRef('')

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let subscription: monaco.IDisposable | undefined
    void openDocument(path).then((document) => {
      if (disposed || document.kind !== 'text') return
      const render = (): void => {
        source.current = document.model.getValue()
        setHtml(renderMarkdown(source.current))
      }
      render()
      subscription = document.model.onDidChangeContent(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(render, RENDER_DELAY_MS)
      })
    })
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      subscription?.dispose()
    }
  }, [path])

  // After each render: syntax colors from the editor theme and images from the project.
  useEffect(() => {
    const root = container.current
    if (!root) return
    for (const code of root.querySelectorAll<HTMLElement>('code[data-lang]')) {
      const language = code.dataset.lang
      if (!language || !monaco.languages.getLanguages().some((l) => l.id === language || l.aliases?.some((a) => a.toLowerCase() === language))) continue
      void monaco.editor.colorize(code.textContent ?? '', language, { tabSize: 2 }).then((colored) => {
        if (code.isConnected) code.innerHTML = colored
      })
    }
    for (const image of root.querySelectorAll('img')) {
      const local = resolveLocal(path, image.getAttribute('src') ?? '')
      if (!local) continue
      image.removeAttribute('src')
      void window.anycode.invoke('fs:readDataUrl', local).then((url) => {
        if (url) image.src = url
      })
    }
  }, [html, path])

  const onClick = (event: React.MouseEvent): void => {
    const target = event.target as HTMLElement
    const run = target.closest<HTMLElement>('.md-run')
    if (run) {
      const fence = findShellFences(source.current)[Number(run.dataset.fence)]
      if (fence?.command) void runInNewTerminal(fence.command, dirname(path))
      return
    }
    const link = target.closest<HTMLAnchorElement>('a[data-href]')
    if (!link) return
    event.preventDefault()
    const href = link.dataset.href ?? ''
    if (href.startsWith('#')) {
      container.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    const local = resolveLocal(path, href)
    if (local) openFile(local)
    // Web links go to the browser (the main process opens window.open targets externally).
    else if (/^https?:/i.test(href)) window.open(href, '_blank')
  }

  return (
    <div className="markdown-preview" ref={container} onClick={onClick}>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
