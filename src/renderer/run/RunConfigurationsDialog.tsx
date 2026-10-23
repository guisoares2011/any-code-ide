import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MavenModule } from '@shared/maven'
import {
  emptyConfiguration,
  formatEnv,
  parseEnv,
  RUN_CONFIGURATION_TYPES,
  type RunConfigurationSpec,
  type RunConfigurationType,
} from '@shared/runConfigurations'
import { useActions } from '../keymap/service'
import { notify } from '../state/notifications'
import { useStore } from '../state/store'
import { workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'
import { closeRunConfigurationsEditor, reloadRunConfigurations, runConfiguration, runState } from './runState'

interface Draft {
  spec: RunConfigurationSpec
  asProjectFile: boolean
  changed: boolean
}

const ORIGIN_NOTES: Partial<Record<RunConfigurationSpec['origin'], string>> = {
  detected: 'Detected from the project. Saving creates an editable copy.',
  intellij: "Imported from IntelliJ's workspace (read-only there). Saving creates an AnyCode copy.",
}

let counter = 0

/** IntelliJ's Run/Debug Configurations dialog (editRunConfigurations). */
export function RunConfigurationsDialog() {
  const editing = useStore(runState, (s) => s.editing)
  return editing ? <Dialog /> : null
}

function Dialog() {
  const project = useStore(workbench, (s) => s.project)
  const saved = useStore(runState, (s) => s.configurations)
  const initialSelection = useStore(runState, (s) => s.selected)
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    saved.map((spec) => ({ spec, asProjectFile: spec.origin === 'project-file', changed: false })),
  )
  const [removed, setRemoved] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection ?? saved[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const [modules, setModules] = useState<MavenModule[]>([])
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (project) void window.anycode.invoke('maven:modules', project.root).then(setModules)
  }, [project])

  const selected = drafts.find((d) => d.spec.id === selectedId)
  const grouped = useMemo(
    () => RUN_CONFIGURATION_TYPES.map((t) => ({ ...t, drafts: drafts.filter((d) => d.spec.type === t.type) })).filter((g) => g.drafts.length > 0),
    [drafts],
  )

  const update = (patch: Partial<RunConfigurationSpec>, asProjectFile?: boolean): void =>
    setDrafts((list) =>
      list.map((d) =>
        d.spec.id === selectedId
          ? { spec: { ...d.spec, ...patch } as RunConfigurationSpec, asProjectFile: asProjectFile ?? d.asProjectFile, changed: true }
          : d,
      ),
    )

  const add = (type: RunConfigurationType): void => {
    const title = RUN_CONFIGURATION_TYPES.find((t) => t.type === type)!.title
    const spec = emptyConfiguration(type, `new:${++counter}`, `Unnamed ${title}`)
    setDrafts((list) => [...list, { spec, asProjectFile: false, changed: true }])
    setSelectedId(spec.id)
    setAdding(false)
    setTimeout(() => nameRef.current?.select())
  }

  const copy = (): void => {
    if (!selected) return
    const spec = { ...selected.spec, id: `new:${++counter}`, name: `${selected.spec.name} (copy)`, origin: 'anycode' as const }
    setDrafts((list) => [...list, { spec, asProjectFile: false, changed: true }])
    setSelectedId(spec.id)
  }

  const remove = (): void => {
    if (!selected || !canRemove(selected.spec)) return
    if (!selected.spec.id.startsWith('new:')) setRemoved((r) => [...r, selected.spec.id])
    const index = drafts.indexOf(selected)
    const rest = drafts.filter((d) => d !== selected)
    setDrafts(rest)
    setSelectedId(rest[Math.min(index, rest.length - 1)]?.spec.id ?? null)
  }

  /** Saves changed drafts and deletions; returns the saved version of the selected configuration. */
  const apply = async (): Promise<RunConfigurationSpec | undefined> => {
    if (!project) return undefined
    let selectedSaved = selected?.spec
    try {
      for (const id of removed) await window.anycode.invoke('run:delete', project.root, id)
      for (const draft of drafts.filter((d) => d.changed)) {
        const result = await window.anycode.invoke('run:save', project.root, draft.spec, draft.asProjectFile)
        if (draft.spec.id === selectedId) selectedSaved = result
      }
    } catch (error) {
      notify('error', 'Cannot save run configurations', error instanceof Error ? error.message : String(error))
      return undefined
    }
    await reloadRunConfigurations()
    if (selectedSaved) runState.set({ selected: selectedSaved.id })
    setRemoved([])
    setDrafts(runState.get().configurations.map((spec) => ({ spec, asProjectFile: spec.origin === 'project-file', changed: false })))
    if (selectedSaved) setSelectedId(selectedSaved.id)
    return selectedSaved
  }

  const ok = async (): Promise<void> => {
    await apply()
    closeRunConfigurationsEditor()
  }

  const state = useRef({ ok })
  useEffect(() => {
    state.current = { ok }
  })
  useActions(
    () => [
      { id: 'Popup.Cancel', isEnabled: (c) => c.focusArea === 'dialog', perform: closeRunConfigurationsEditor },
      {
        id: 'Popup.Confirm',
        // Enter confirms, except inside the multi-line script field.
        isEnabled: (c) => c.focusArea === 'dialog' && !(document.activeElement instanceof HTMLTextAreaElement),
        perform: () => void state.current.ok(),
      },
    ],
    [],
  )

  return (
    <div className="popup-backdrop" onMouseDown={closeRunConfigurationsEditor}>
      <div
        className="dialog run-dialog"
        role="dialog"
        aria-label="Run/Debug Configurations"
        data-focus-area="dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">Run/Debug Configurations</div>
        <div className="run-dialog-body">
          <div className="run-dialog-list">
            <div className="run-dialog-toolbar">
              <button className="icon-button" title="Add New Configuration" aria-label="Add New Configuration" onClick={() => setAdding((a) => !a)}>
                <Icon name="general/add" />
              </button>
              <button className="icon-button" title="Remove Configuration" aria-label="Remove Configuration" disabled={!selected || !canRemove(selected.spec)} onClick={remove}>
                <Icon name="general/remove" />
              </button>
              <button className="icon-button" title="Copy Configuration" aria-label="Copy Configuration" disabled={!selected} onClick={copy}>
                <Icon name="general/copy" />
              </button>
            </div>
            {adding && (
              <div className="run-dialog-add" role="menu" aria-label="Add New Configuration">
                {RUN_CONFIGURATION_TYPES.map((t) => (
                  <button key={t.type} role="menuitem" className="popup-item" onClick={() => add(t.type)}>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
            <div className="tree" role="tree" aria-label="Run Configurations">
              {grouped.map((group) => (
                <div key={group.type}>
                  <div className="popup-group">{group.title}</div>
                  {group.drafts.map((d) => (
                    <div
                      key={d.spec.id}
                      role="treeitem"
                      aria-selected={d.spec.id === selectedId}
                      className={`tree-row${d.spec.id === selectedId ? ' selected' : ''}`}
                      style={{ paddingLeft: 12 }}
                      onMouseDown={() => setSelectedId(d.spec.id)}
                    >
                      <Icon name="run/run" size={14} />
                      <span>{d.spec.name}</span>
                      {d.changed && <span className="hint">modified</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="run-dialog-form">
            {selected ? (
              <Form
                draft={selected}
                modules={modules}
                nameRef={nameRef}
                onChange={update}
              />
            ) : (
              <div className="empty-state">Add a configuration with +</div>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          <button
            className="button secondary"
            disabled={!selected}
            onClick={async () => {
              const spec = await apply()
              closeRunConfigurationsEditor()
              if (spec) void runConfiguration(spec)
            }}
          >
            Run
          </button>
          <span className="toolbar-spacer" />
          <button className="button secondary" onClick={closeRunConfigurationsEditor}>
            Cancel
          </button>
          <button className="button secondary" onClick={() => void apply()}>
            Apply
          </button>
          <button className="button primary" onClick={() => void ok()}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

const canRemove = (spec: RunConfigurationSpec): boolean =>
  spec.origin === 'anycode' || spec.origin === 'project-file' || spec.id.startsWith('new:')

interface FormProps {
  draft: Draft
  modules: MavenModule[]
  nameRef: React.RefObject<HTMLInputElement | null>
  onChange(patch: Partial<RunConfigurationSpec>, asProjectFile?: boolean): void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {children}
    </label>
  )
}

function Form({ draft, modules, nameRef, onChange }: FormProps) {
  const { spec } = draft
  const text = (label: string, value: string, patch: (v: string) => Partial<RunConfigurationSpec>, placeholder = '') => (
    <Field label={label}>
      <input className="text-field" value={value} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(patch(e.target.value))} />
    </Field>
  )
  return (
    <div className="form">
      <Field label="Name">
        <input ref={nameRef} className="text-field" value={spec.name} spellCheck={false} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      {ORIGIN_NOTES[spec.origin] && !draft.changed && <div className="form-note">{ORIGIN_NOTES[spec.origin]}</div>}
      {spec.type === 'spring-boot' && (
        <>
          {text('Main class', spec.mainClass, (v) => ({ mainClass: v }), 'com.example.Application')}
          <Field label="Module">
            <select
              className="text-field"
              value={modules.find((m) => m.directory === spec.module || m.artifactId === spec.module)?.directory ?? ''}
              onChange={(e) => onChange({ module: e.target.value })}
            >
              <option value="">(find by main class)</option>
              {modules
                .filter((m) => m.packaging !== 'pom')
                .map((m) => (
                  <option key={m.directory} value={m.directory}>
                    {m.artifactId}
                    {m.directory ? ` (${m.directory})` : ''}
                  </option>
                ))}
            </select>
          </Field>
          {text('Active profiles', spec.activeProfiles, (v) => ({ activeProfiles: v }), 'local,dev')}
          {text('VM options', spec.vmOptions, (v) => ({ vmOptions: v }), '-Xmx1g')}
          {text('Program arguments', spec.programArguments, (v) => ({ programArguments: v }))}
        </>
      )}
      {spec.type === 'maven' && (
        <>
          {text('Command line', spec.goals, (v) => ({ goals: v }), 'clean install -DskipTests')}
          {text('Profiles', spec.profiles, (v) => ({ profiles: v }), 'dev,ci')}
        </>
      )}
      {spec.type === 'npm' && (
        <>
          {text('Script', spec.script, (v) => ({ script: v }), 'dev')}
          {text('Arguments', spec.arguments, (v) => ({ arguments: v }))}
        </>
      )}
      {spec.type === 'shell' && (
        <Field label="Script text">
          <textarea className="text-field script-field" value={spec.script} spellCheck={false} onChange={(e) => onChange({ script: e.target.value })} />
        </Field>
      )}
      {spec.type === 'gradle' && text('Tasks', spec.tasks, (v) => ({ tasks: v }), 'clean build')}
      {spec.type !== 'spring-boot' && text('Working directory', spec.workingDirectory, (v) => ({ workingDirectory: v }), '(project root)')}
      <Field label="Environment variables">
        <EnvField value={spec.env} onChange={(env) => onChange({ env })} />
      </Field>
      <label className="form-check">
        <input type="checkbox" checked={draft.asProjectFile} onChange={(e) => onChange({}, e.target.checked)} />
        Store as project file <span className="hint">(.run/, shared with the team and with IntelliJ)</span>
      </label>
    </div>
  )
}

/** The env field keeps the typed text while editing so separators can be typed freely. */
function EnvField({ value, onChange }: { value: Record<string, string>; onChange(env: Record<string, string>): void }) {
  const [textValue, setTextValue] = useState(() => formatEnv(value))
  return (
    <input
      className="text-field"
      value={textValue}
      placeholder="KEY=value;OTHER=value"
      spellCheck={false}
      onChange={(e) => {
        setTextValue(e.target.value)
        onChange(parseEnv(e.target.value))
      }}
    />
  )
}
