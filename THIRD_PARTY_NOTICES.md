# Third-party notices

AnyCode includes or is derived from the following third-party material.

## IntelliJ Platform data (JetBrains/intellij-community)

- Source: https://github.com/JetBrains/intellij-community, tag `idea/261.22158.277`
- License: Apache License 2.0 (`resources/intellij-community/LICENSE.txt`, `resources/intellij-community/NOTICE.txt`)
- Copyright 2000-2026 JetBrains s.r.o. and contributors

Files shipped unmodified under `resources/intellij-community/`, keeping their repository paths and listed with SHA-256 hashes in `resources/intellij-community/manifest.json`:

- keymaps `$default.xml` and `Mac OS X 10.5+.xml`
- `ActionsBundle.properties` and `TerminalBundle.properties` (action names)
- terminal plugin descriptors (`plugin.xml`, `terminal.xml`, `intellij.terminal.frontend.xml`) and VCS action descriptors (`VcsActions.xml`, `intellij.platform.vcs.dvcs.impl.xml`, `intellij.platform.vcs.log.impl.xml`), read for their keymap entries
- themes `ManyIslandsDark.theme.json`, `expUI_dark.theme.json`, `darcula.theme.json` and the editor color schemes `IslandSchemeDark.xml`, `expUI_darkScheme.xml`, `DefaultColorSchemesManager.xml`
- New UI (expui) SVG icons

Behavior recreated in AnyCode's own code from the Apache-2.0 sources of the same project:

- shortcut resolution and the macOS control/meta conversion (`KeymapImpl`, `MacOSDefaultKeymap`, `KeymapShortcutOperation`): `src/renderer/keymap/keymap.ts`, `shortcut.ts`, `keymapXml.ts`
- modifier double-click timings (`ModifierKeyDoubleClickHandler`): `src/renderer/keymap/doubleModifier.ts`
- the list of actions allowed while the terminal has focus (`TerminalEventDispatcher.ALLOWED_ACTION_IDS`): `src/renderer/keymap/terminalAllowedActions.ts`
- the New UI default tool window layout (`defaultToolWindowlayoutProvider.kt`): `src/renderer/state/workbench.ts`
- the Markdown preview layouts (`TextEditorWithPreview`) and the prompt trimming of runnable shell blocks (`CommandRunnerExtension.trimPrompt`): `src/renderer/markdown/`

AnyCode is not affiliated with or endorsed by JetBrains. It does not use JetBrains product names, logos or product icons in its branding.

## Fonts

- Inter, SIL Open Font License 1.1, via `@fontsource/inter`
- JetBrains Mono, SIL Open Font License 1.1, via `@fontsource/jetbrains-mono`

## Libraries

| Package | License |
|---|---|
| monaco-editor | MIT |
| @xterm/xterm, @xterm/addon-fit | MIT |
| @lydell/node-pty (fork of node-pty) | MIT |
| react, react-dom | MIT |
| fast-xml-parser | MIT |
| electron | MIT |
| markdown-it | MIT |
| dompurify | MPL-2.0 OR Apache-2.0 (used under Apache-2.0) |
| ws | MIT |
| typescript-go (`@typescript/typescript-darwin-arm64`, bundled as `Resources/typescript-go`) | Apache-2.0 (its LICENSE and NOTICE.txt ship beside the binary) |
