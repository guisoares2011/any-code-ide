import { beforeEach, describe, expect, it } from 'vitest'
import { activateToolWindow, closeTab, openFile, selectAdjacentTab, workbench } from './workbench'

describe('workbench state', () => {
  beforeEach(() => {
    workbench.set({ tabs: [], activeTab: null, visible: { left: 'Project', bottom: 'Terminal', right: null } })
  })

  it('opens files once and tracks recent files', () => {
    openFile('/p/a.ts')
    openFile('/p/b.ts')
    openFile('/p/a.ts')
    expect(workbench.get().tabs.map((t) => t.name)).toEqual(['a.ts', 'b.ts'])
    expect(workbench.get().activeTab).toBe('/p/a.ts')
    expect(workbench.get().recentFiles.slice(0, 2)).toEqual(['/p/a.ts', '/p/b.ts'])
  })

  it('activates the neighbour when the active tab closes', () => {
    openFile('/p/a.ts')
    openFile('/p/b.ts')
    openFile('/p/c.ts')
    openFile('/p/b.ts')
    closeTab('/p/b.ts')
    expect(workbench.get().activeTab).toBe('/p/c.ts')
    selectAdjacentTab(1)
    expect(workbench.get().activeTab).toBe('/p/a.ts')
  })

  it('toggles tool windows like ActivateToolWindowAction', () => {
    activateToolWindow('Terminal', true)
    expect(workbench.get().visible.bottom).toBeNull()
    activateToolWindow('Terminal', false)
    expect(workbench.get().visible.bottom).toBe('Terminal')
    activateToolWindow('Problems View', false)
    expect(workbench.get().visible.bottom).toBe('Problems View')
  })
})

describe('multiple projects', () => {
  it('keeps tabs and tool windows per project', async () => {
    const { addProject, cycleProject, removeProject, switchProject } = await import('./workbench')
    workbench.set({ project: { root: '/a', name: 'a' }, projects: [{ root: '/a', name: 'a' }], tabs: [], activeTab: null })
    openFile('/a/x.ts')
    addProject({ root: '/b', name: 'b' })
    expect(workbench.get().project?.root).toBe('/b')
    expect(workbench.get().tabs).toEqual([])
    openFile('/b/y.ts')
    switchProject('/a')
    expect(workbench.get().tabs.map((t) => t.name)).toEqual(['x.ts'])
    cycleProject(1)
    expect(workbench.get().tabs.map((t) => t.name)).toEqual(['y.ts'])
    expect(removeProject('/b')?.root).toBe('/a')
    expect(workbench.get().projects.map((p) => p.root)).toEqual(['/a'])
    expect(workbench.get().tabs.map((t) => t.name)).toEqual(['x.ts'])
  })
})
