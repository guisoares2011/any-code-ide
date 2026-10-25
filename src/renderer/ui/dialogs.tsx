// Small modal dialogs answered with a promise: a name field (New File, Rename…) and a yes/no
// question (Delete). One of each can be open at a time.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useActions } from '../keymap/service'
import { createStore, useStore } from '../state/store'
import { Icon } from './Icon'

export interface InputChoice {
  id: string
  label: string
  icon?: string
}

export interface InputRequest {
  title: string
  /** Label above the field. */
  label?: string
  initial?: string
  /** Characters selected at first, e.g. the name without its extension; all by default. */
  selection?: [start: number, end: number]
  /** A list under the field (IntelliJ's New Java Class: Class, Interface...), chosen with ↑ ↓. */
  choices?: InputChoice[]
  confirmLabel?: string
  /** An error to show instead of accepting, or null when the value is fine. */
  validate?(value: string, choice: string | undefined): string | null | Promise<string | null>
}

export interface InputAnswer {
  value: string
  choice?: string
}

export interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  /** A checkbox under the message, e.g. "Delete local copies". */
  option?: string
}

interface Pending<R, A> {
  request: R
  resolve(answer: A | null): void
}

const inputState = createStore<{ pending: Pending<InputRequest, InputAnswer> | null }>({ pending: null })
const confirmState = createStore<{ pending: Pending<ConfirmRequest, { option: boolean }> | null }>({ pending: null })

export function askInput(request: InputRequest): Promise<InputAnswer | null> {
  inputState.get().pending?.resolve(null)
  return new Promise((resolve) => inputState.set({ pending: { request, resolve } }))
}

export function askConfirm(request: ConfirmRequest): Promise<{ option: boolean } | null> {
  confirmState.get().pending?.resolve(null)
  return new Promise((resolve) => confirmState.set({ pending: { request, resolve } }))
}

function finishInput(answer: InputAnswer | null): void {
  const { pending } = inputState.get()
  inputState.set({ pending: null })
  pending?.resolve(answer)
}

function finishConfirm(answer: { option: boolean } | null): void {
  const { pending } = confirmState.get()
  confirmState.set({ pending: null })
  pending?.resolve(answer)
}

export function DialogHost() {
  const input = useStore(inputState, (s) => s.pending)
  const confirm = useStore(confirmState, (s) => s.pending)
  return (
    <>
      {input && <InputDialog key={input.request.title} request={input.request} />}
      {confirm && <ConfirmDialog key={confirm.request.title + confirm.request.message} request={confirm.request} />}
    </>
  )
}

function InputDialog({ request }: { request: InputRequest }) {
  const [value, setValue] = useState(request.initial ?? '')
  const [choice, setChoice] = useState(request.choices?.[0]?.id)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const cancel = (): void => finishInput(null)

  useEffect(() => {
    const input = field.current
    if (!input) return
    input.focus()
    const [start, end] = request.selection ?? [0, input.value.length]
    input.setSelectionRange(start, end)
  }, [request])

  const accept = async (): Promise<void> => {
    const text = value.trim()
    if (!text) return
    const problem = (await request.validate?.(text, choice)) ?? null
    if (problem) {
      setError(problem)
      return
    }
    finishInput({ value: text, ...(choice ? { choice } : {}) })
  }

  const state = useRef({ accept, choice })
  useLayoutEffect(() => {
    state.current = { accept, choice }
  })
  useActions(() => {
    const open = (c: { focusArea: string }): boolean => c.focusArea === 'dialog' && inputState.get().pending !== null
    const choices = request.choices ?? []
    const move = (delta: number) => () => {
      const index = choices.findIndex((c) => c.id === state.current.choice)
      setChoice(choices[(index + delta + choices.length) % choices.length]?.id)
    }
    return [
      { id: 'Popup.Cancel', isEnabled: open, perform: cancel },
      { id: 'Popup.Confirm', isEnabled: open, perform: () => void state.current.accept() },
      { id: 'List-selectNextRow', isEnabled: (c) => open(c) && choices.length > 0, perform: move(1) },
      { id: 'List-selectPreviousRow', isEnabled: (c) => open(c) && choices.length > 0, perform: move(-1) },
    ]
  }, [request])

  return (
    <div className="popup-backdrop" onMouseDown={cancel}>
      <div className="dialog input-dialog" role="dialog" aria-label={request.title} data-focus-area="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{request.title}</div>
        <div className="dialog-body">
          {request.label && <label className="hint">{request.label}</label>}
          <input
            ref={field}
            className={`text-field${error ? ' invalid' : ''}`}
            aria-label={request.label ?? request.title}
            value={value}
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
          />
          {error && <div className="field-error">{error}</div>}
          {request.choices && (
            <div className="input-dialog-choices" role="listbox">
              {request.choices.map((c) => (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={c.id === choice}
                  className={`popup-item${c.id === choice ? ' selected' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setChoice(c.id)
                  }}
                >
                  {c.icon && <Icon name={c.icon} />}
                  <span>{c.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {request.confirmLabel && (
          <div className="dialog-footer">
            <span className="toolbar-spacer" />
            <button className="button secondary" onClick={cancel}>
              Cancel
            </button>
            <button className="button primary" disabled={!value.trim()} onClick={() => void accept()}>
              {request.confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const [option, setOption] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const cancel = (): void => finishConfirm(null)
  const optionRef = useRef(option)
  useLayoutEffect(() => {
    optionRef.current = option
  })
  const accept = (): void => finishConfirm({ option: optionRef.current })

  useEffect(() => button.current?.focus(), [])
  useActions(() => {
    const open = (c: { focusArea: string }): boolean => c.focusArea === 'dialog' && confirmState.get().pending !== null
    return [
      { id: 'Popup.Cancel', isEnabled: open, perform: cancel },
      { id: 'Popup.Confirm', isEnabled: open, perform: accept },
    ]
  }, [])

  return (
    <div className="popup-backdrop" onMouseDown={cancel}>
      <div className="dialog confirm-dialog" role="dialog" aria-label={request.title} data-focus-area="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-title">{request.title}</div>
        <div className="dialog-body">
          <p>{request.message}</p>
          {request.option && (
            <label className="checkbox-field">
              <input type="checkbox" checked={option} onChange={(e) => setOption(e.target.checked)} />
              {request.option}
            </label>
          )}
        </div>
        <div className="dialog-footer">
          <span className="toolbar-spacer" />
          <button className="button secondary" onClick={cancel}>
            Cancel
          </button>
          <button ref={button} className="button primary" onClick={accept}>
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
