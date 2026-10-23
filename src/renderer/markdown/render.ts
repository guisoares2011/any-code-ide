// Markdown to sanitized HTML for the preview: GitHub-flavored output with heading anchors and a
// Run button on shell code blocks (the button carries the fence index; commands come from
// findShellFences so the preview and the editor run exactly the same thing).
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { isShellLanguage } from './shellFences'

/** GitHub's heading anchor slug: lowercase, punctuation removed, spaces to dashes. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-')
}

const escape = (text: string): string => text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

/** Per-render state markdown-it passes to rules as `env`. */
interface RenderEnv {
  slugs?: Map<string, number>
  fence?: number
}

function createRenderer() {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false })

  md.renderer.rules.heading_open = (tokens, index, options, renderEnv, self) => {
    const env = renderEnv as RenderEnv
    const inline = tokens[index + 1]
    const base = slugify(inline?.children?.map((t) => t.content).join('') ?? inline?.content ?? '')
    env.slugs ??= new Map()
    const seen = env.slugs.get(base) ?? 0
    env.slugs.set(base, seen + 1)
    tokens[index]!.attrSet('id', seen === 0 ? base : `${base}-${seen}`)
    return self.renderToken(tokens, index, options)
  }

  md.renderer.rules.fence = (tokens, index, _options, renderEnv) => {
    const env = renderEnv as RenderEnv
    const token = tokens[index]!
    const language = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const code = `<pre><code data-lang="${escape(language)}">${escape(token.content)}</code></pre>`
    if (!isShellLanguage(token.info)) return `<div class="md-code">${code}</div>`
    env.fence = (env.fence ?? -1) + 1
    return `<div class="md-code md-shell"><button class="md-run" data-fence="${env.fence}" title="Run in Terminal">▶ Run</button>${code}</div>`
  }

  // Links open outside the preview; the preview decides what that means (tab, browser, anchor).
  const defaultLink = md.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index]!.attrSet('data-href', tokens[index]!.attrGet('href') ?? '')
    return defaultLink(tokens, index, options, env, self)
  }
  return md
}

const renderer = createRenderer()

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(renderer.render(source, {}), {
    ADD_ATTR: ['data-fence', 'data-lang', 'data-href'],
    FORBID_TAGS: ['style', 'form', 'input', 'iframe'],
  })
}
