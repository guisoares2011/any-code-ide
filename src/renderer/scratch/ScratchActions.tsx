import { useActions } from '../keymap/service'
import { openPopup, workbench } from '../state/workbench'
import { isScratch } from './scratches'

/** Scratch file actions, available everywhere: New Scratch File, Show Scratch Files, Change File Language. */
export function ScratchActions() {
  useActions(
    () => [
      { id: 'NewScratchFile', text: 'New Scratch File', perform: () => openPopup('NewScratchFile') },
      { id: 'Scratch.ShowFilesPopup', perform: () => openPopup('ScratchFiles') },
      {
        id: 'Scratch.ChangeLanguage',
        isEnabled: () => {
          const { activeTab } = workbench.get()
          return activeTab !== null && isScratch(activeTab)
        },
        perform: () => openPopup('ScratchLanguage'),
      },
    ],
    [],
  )
  return null
}
