import { closeProjectTab } from '../state/projects'
import { useStore } from '../state/store'
import { projectActiveFileName, switchProject, workbench } from '../state/workbench'
import { Icon } from '../ui/Icon'

/**
 * Project tabs below the main toolbar, like IntelliJ's merged project windows on macOS: one tab per
 * project of the window, titled "project – active file". Shown only with two or more projects.
 */
export function ProjectTabs() {
  const projects = useStore(workbench, (s) => s.projects)
  const current = useStore(workbench, (s) => s.project?.root)
  // Re-render when the shown project's active file changes (its tab title).
  useStore(workbench, (s) => s.activeTab)
  if (projects.length < 2) return <div />
  return (
    <div className="project-tabs" role="tablist" aria-label="Projects">
      {projects.map((project) => {
        const file = projectActiveFileName(project.root)
        const selected = project.root === current
        return (
          <div
            key={project.root}
            role="tab"
            aria-selected={selected}
            className={`project-tab${selected ? ' selected' : ''}`}
            title={project.root}
            onMouseDown={(event) => {
              if (event.button === 1) void closeProjectTab(project.root)
              else if (event.button === 0) switchProject(project.root)
            }}
          >
            <span className="project-tab-title">{file ? `${project.name} – ${file}` : project.name}</span>
            <button
              className="icon-button small tab-close"
              title="Close Project"
              aria-label={`Close ${project.name}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => void closeProjectTab(project.root)}
            >
              <Icon name="general/closeSmall" size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
