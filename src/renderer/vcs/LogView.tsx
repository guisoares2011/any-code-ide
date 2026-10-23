import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitChangedFile, GitCommit, GitCommitDetails, GitLogQuery } from '@shared/git'
import { basename, dirname, relativePath } from '@shared/paths'
import { useActions } from '../keymap/service'
import { gitState } from '../state/git'
import { notify } from '../state/notifications'
import { createStore, useStore } from '../state/store'
import { openCommitDiffTab, showToolWindow, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { fileIconName } from '../ui/icons'
import { useListNavigation } from '../ui/useListNavigation'

const PAGE = 300
const TEXT_DEBOUNCE_MS = 250

/** "Show History" for a file: the Log tab filtered by that path. */
const historyRequest = createStore<{ path: string | null; seq: number }>({ path: null, seq: 0 })

export function showFileHistory(path: string): void {
  historyRequest.set((s) => ({ path, seq: s.seq + 1 }))
  showToolWindow('Version Control')
}

/** IntelliJ's log date column: "Today 14:02", "Yesterday 09:10", or the date. */
export function formatCommitDate(time: number, now = Date.now()): string {
  const date = new Date(time)
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (time >= startOfToday) return `Today ${clock}`
  if (time >= startOfToday - 86_400_000) return `Yesterday ${clock}`
  return `${date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' })}, ${clock}`
}

/** Decorations as labels: the checked-out branch first, HEAD itself dropped. */
function refLabels(refs: readonly string[]): { name: string; kind: 'head' | 'branch' | 'tag' }[] {
  return refs.flatMap((ref): { name: string; kind: 'head' | 'branch' | 'tag' }[] => {
    if (ref === 'HEAD') return []
    if (ref.startsWith('HEAD -> ')) return [{ name: ref.slice(8), kind: 'head' }]
    if (ref.startsWith('tag: ')) return [{ name: ref.slice(5), kind: 'tag' }]
    return [{ name: ref, kind: 'branch' }]
  })
}

/** Absolute path of a renamed file's source. */
const originalAbsolute = (file: GitChangedFile): string | undefined =>
  file.originalPath ? file.path.slice(0, file.path.length - file.relativePath.length) + file.originalPath : undefined

/** The Log tab of the Version Control tool window: commits with filters and the selected commit's changes. */
export function LogView({ visible }: { visible: boolean }) {
  const project = useStore(workbench, (s) => s.project)
  const status = useStore(gitState, (s) => s.status)
  const history = useStore(historyRequest, (s) => s)
  const [text, setText] = useState('')
  const [debouncedText, setDebouncedText] = useState('')
  const [branch, setBranch] = useState('')
  const [author, setAuthor] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [complete, setComplete] = useState(false)
  const [selected, setSelected] = useState(0)
  const [details, setDetails] = useState<GitCommitDetails | null>(null)
  const [selectedFile, setSelectedFile] = useState(0)
  const root = project?.root
  const view = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const filesList = useRef<HTMLDivElement>(null)
  const textField = useRef<HTMLInputElement>(null)
  const loading = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedText(text), TEXT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  // A Show History request replaces the path filter (adjusted while rendering, not in an effect).
  const [historySeq, setHistorySeq] = useState(0)
  if (history.seq !== historySeq) {
    setHistorySeq(history.seq)
    if (history.path && project && history.path.startsWith(`${project.root}/`)) setPath(history.path)
  }

  const commit = commits[selected]
  const selectedHash = useRef<string | undefined>(undefined)
  useEffect(() => {
    selectedHash.current = commit?.hash
  })

  const query = useMemo<GitLogQuery>(
    () => ({ ...(debouncedText ? { text: debouncedText } : {}), ...(branch ? { branch } : {}), ...(author ? { author } : {}), ...(path ? { path } : {}) }),
    [debouncedText, branch, author, path],
  )

  // Reload on filter changes and whenever git state changes (commits, checkouts, the agent's work).
  useEffect(() => {
    if (!visible || !root || !status.repository) return
    let cancelled = false
    void (async () => {
      const [page, names] = await Promise.all([
        window.anycode.invoke('git:log', root, { ...query, limit: PAGE }),
        window.anycode.invoke('git:branches', root),
      ])
      if (cancelled) return
      setBranches(names)
      // The selected commit stays selected when it is still listed.
      const index = page.findIndex((c) => c.hash === selectedHash.current)
      setCommits(page)
      setSelected(Math.max(index, 0))
      setComplete(page.length < PAGE)
    })()
    return () => {
      cancelled = true
    }
  }, [visible, root, status, query])

  const loadMore = useCallback(async () => {
    if (!root || complete || loading.current) return
    loading.current = true
    const page = await window.anycode.invoke('git:log', root, { ...query, skip: commits.length, limit: PAGE })
    loading.current = false
    setCommits((previous) => [...previous, ...page.filter((c) => !previous.some((p) => p.hash === c.hash))])
    setComplete(page.length < PAGE)
  }, [root, complete, query, commits.length])

  useEffect(() => {
    if (!root || !commit) return
    let cancelled = false
    void window.anycode.invoke('git:commitDetails', root, commit.hash).then((result) => {
      if (cancelled) return
      setDetails(result)
      setSelectedFile(0)
    })
    return () => {
      cancelled = true
    }
  }, [root, commit])

  const files = useMemo(() => (details && details.hash === commit?.hash ? details.files : []), [details, commit])
  const openDiff = (file: GitChangedFile | undefined): void => {
    if (file && commit) openCommitDiffTab(commit.hash, file.path, originalAbsolute(file))
  }

  useListNavigation(list, commits, selected, setSelected, () => filesList.current?.focus())
  useListNavigation(filesList, files, selectedFile, setSelectedFile, openDiff)

  const state = useRef({ commit, files, selectedFile, openDiff })
  useEffect(() => {
    state.current = { commit, files, selectedFile, openDiff }
  })
  useActions(() => {
    const inside = (element: HTMLElement | null) => (): boolean => element?.contains(document.activeElement) ?? false
    return [
      {
        id: 'Vcs.Log.FocusTextFilter',
        isEnabled: () => view.current?.contains(document.activeElement) ?? false,
        perform: () => (document.activeElement === textField.current ? list.current?.focus() : textField.current?.focus()),
      },
      {
        id: 'Vcs.CopyRevisionNumberAction',
        isEnabled: () => (list.current?.contains(document.activeElement) ?? false) && state.current.commit !== undefined,
        perform: () => {
          const hash = state.current.commit?.hash
          if (hash) void navigator.clipboard.writeText(hash).then(() => notify('info', 'Copied revision number', hash))
        },
      },
      {
        id: 'Diff.ShowDiff',
        isEnabled: () => inside(list.current)() || inside(filesList.current)(),
        perform: () => {
          const { files: changed, selectedFile: index } = state.current
          state.current.openDiff(filesList.current?.contains(document.activeElement) ? changed[index] : changed[0])
        },
      },
    ]
  }, [])

  if (!project) return <div className="empty-state">No project open</div>
  if (!status.repository) return <div className="empty-state">This project is not a git repository.</div>

  const authors = [...new Set(commits.map((c) => c.author))].sort()
  return (
    <div className="log-view" ref={view}>
      <div className="log-filters">
        <input
          ref={textField}
          className="text-field log-text-filter"
          placeholder="Text or hash"
          aria-label="Filter commits by text or hash"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <select className="text-field" aria-label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">Branch: All</option>
          {branches.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select className="text-field" aria-label="User" value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="">User: All</option>
          {(author && !authors.includes(author) ? [author, ...authors] : authors).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {path && (
          <span className="log-chip" title={path}>
            Path: {relativePath(project.root, path)}
            <button className="icon-button small" aria-label="Clear path filter" onClick={() => setPath(null)}>
              <Icon name="general/closeSmall" size={14} />
            </button>
          </span>
        )}
      </div>
      <div className="log-body">
        <div
          className="tree log-commits"
          tabIndex={0}
          ref={list}
          role="tree"
          aria-label="Commits"
          data-focus-area="tree"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 200) void loadMore()
          }}
        >
          {commits.length === 0 && <div className="empty-state">No commits match the filters</div>}
          {commits.map((c, index) => (
            <div
              key={c.hash}
              role="treeitem"
              aria-selected={index === selected}
              className={`tree-row log-row${index === selected ? ' selected' : ''}`}
              onMouseDown={() => setSelected(index)}
            >
              <span className="log-subject">
                {refLabels(c.refs).map((ref) => (
                  <span key={ref.name} className={`log-ref log-ref-${ref.kind}`}>
                    {ref.name}
                  </span>
                ))}
                {c.subject}
              </span>
              <span className="log-author">{c.author}</span>
              <span className="log-date">{formatCommitDate(c.date)}</span>
            </div>
          ))}
        </div>
        <div className="log-details">
          <div className="tree log-files" tabIndex={0} ref={filesList} role="tree" aria-label="Changed files" data-focus-area="tree">
            {files.map((file, index) => (
              <div
                key={file.path}
                role="treeitem"
                aria-selected={index === selectedFile}
                className={`tree-row${index === selectedFile ? ' selected' : ''}`}
                onMouseDown={() => setSelectedFile(index)}
                onDoubleClick={() => openDiff(file)}
                title={file.originalPath ? `Renamed from ${file.originalPath}` : file.relativePath}
              >
                <Icon name={fileIconName(basename(file.path))} />
                <span className={`vcs-${file.kind}`}>{basename(file.path)}</span>
                <span className="hint">{dirname(`/${file.relativePath}`).slice(1)}</span>
              </div>
            ))}
          </div>
          {commit && details?.hash === commit.hash && (
            <div className="log-message" aria-label="Commit details">
              <pre>{details.message}</pre>
              <div className="hint">
                {commit.hash.slice(0, 8)} {commit.author} &lt;{commit.email}&gt; on {new Date(commit.date).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
