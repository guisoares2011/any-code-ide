# Engenharia reversa: IntelliJ IDEA e WebStorm

Registro de achados (finding ledger) da investigação das IDEs instaladas. Cada achado aponta para a evidência que o sustenta: um Evidence ID do REA, um arquivo extraído em `reference/` (não versionado) ou um arquivo-fonte do `JetBrains/intellij-community` (Apache-2.0).

Tipos de evidência:
- **observado**: lido direto do artefato instalado (bytes do bundle ou dos jars);
- **fonte**: lido do código aberto em `intellij-community`;
- **inferido**: conclusão a partir dos dois anteriores, sem execução.

Nenhuma IDE foi executada. Tudo aqui é estático.

## Alvos

| | IntelliJ IDEA | WebStorm |
|---|---|---|
| Versão / build | 2026.1 / `IU-261.22158.277` | 2025.3.4 / `WS-253.32098.39` |
| Bundle ID | `com.jetbrains.intellij` | `com.jetbrains.WebStorm` |
| URL scheme | `idea://` | `webstorm://` |
| Jars em `lib/` / plugins empacotados | 387 / 150 | 146 / 99 |
| Inventário REA (`inspect_artifact`) | `ev_fc840ede…39fa7` | `ev_35767b48…322c` |
| `Info.plist` (`inspect_plist`) | `ev_78114ad4…bb91` | `ev_b103cfc2…038a` |

Os dois inventários terminaram com `complete-within-substeps` e sem contradições de integridade. O REA sugeriu como próximos passos `analyze_javascript_application`, `open_binary`, `inspect_managed_artifact` e `inspect_plist`. Só o `inspect_plist` serve aqui: as IDEs são JVM, e o REA não decompila JVM fora de APK.

Os JSONs ficam em `reference/rea/`. Plugins instalados pelo usuário: `jvm-dfa-analysis` e `ml-llm` (IntelliJ); `intellij-csv-validator` e `terraform` (WebStorm). **Não há plugin Claude Code instalado em nenhuma das duas**, então o protocolo do bridge continua vindo do `claudecode.nvim` + `capture-process` (roadmap item 4).

## Keymap

| # | Achado | Tipo | Evidência |
|---|---|---|---|
| K1 | `Mac OS X 10.5+` herda **direto** de `$default`, não de `Mac OS X`. A cadeia efetiva no macOS é `$default` → `Mac OS X 10.5+`. | observado | atributo `parent` em `reference/jetbrains/keymaps/*.xml` |
| K2 | Atalhos herdados de `$default` por um keymap `Mac OS X*` têm **⌃ e ⌘ trocados** (`control`↔`meta`, nos dois sentidos, inclusive em mouse shortcuts). Ex.: `GotoAction` `control shift A` → ⌘⇧A. | fonte | `MacOSDefaultKeymap.kt` (`mapModifiers`), `DefaultKeymap.kt:95` |
| K3 | Resolução de um action ID: `own[id]` → `own[use-shortcut-of(id)]` → resolução do pai (convertida por K2). Uma entrada própria, mesmo vazia, **substitui** os atalhos do pai. | fonte | `KeymapImpl.getShortcutList` |
| K4 | No macOS, keystrokes com `INSERT` são ignorados nos keymaps empacotados. | fonte | `KeymapImpl.readExternal` (`skipInserts`) |
| K5 | Plugins declaram atalhos no próprio `plugin.xml` (`<keyboard-shortcut>`/`<mouse-shortcut keymap=…>`), fora dos XMLs de keymap. A plataforma aplica esses atalhos depois do XML: *add* acrescenta à lista própria (partindo da do pai convertida), `remove` tira um atalho, `replace-all` limpa antes de adicionar. No IntelliJ são 336 de teclado e 14 de mouse; no WebStorm, 261 e 15. | observado + fonte | `reference/jetbrains/derived/plugin-scan.json`; `KeymapImpl.doAddShortcut`, `KeymapShortcutOperation.kt` |
| K6 | No 2026.1 instalado, o **double-Shift (`SearchEverywhere`) e o double-Ctrl (`RunAnything`) não estão em nenhum XML**: são registrados em código no `ModifierKeyDoubleClickHandler`. No `master`, o commit `11c6da14af` (2026-05-22, IJPL-61450, "support declarative modifier double-click shortcuts") passou a declará-los no `$default.xml` como `<keyboard-gesture-shortcut keystroke="shift SHIFT" modifier="dblClick"/>` e `keystroke="ctrl control"`. **O AnyCode deve aceitar esse formato** e embutir essas duas entradas enquanto carrega os XMLs do 2026.1. | observado + fonte | catálogo: `SearchEverywhere.mac = null`; `$default.xml` no master |
| K6a | Detecção do double-tap de modificador: sequência *press → release → press → release* da mesma tecla, com no máximo 300 ms entre eventos. O estado zera se o primeiro press tiver mais de 500 ms, e o gesto é ignorado se outra tecla foi pressionada menos de 100 ms antes. Esc e Tab também zeram. A ação dispara no segundo *release*. O mesmo handler faz double-modificador + seta clonar cursor acima/abaixo (`EditorCloneCaretAbove/Below`). | fonte | `ModifierKeyDoubleClickHandler.kt` |
| K6b | Em aberto: no macOS, o double-Ctrl herdado de `$default` passa pela troca ⌃↔⌘ de K2 (`ctrl control` → modificador ⌘ + tecla CONTROL). Não verifiquei como `toDoubleClickShortcut` trata esse caso. Antes de implementar `RunAnything`, confirme se o gesto no Mac fica ⌃⌃. | inferido | — |
| K7 | Keymaps macOS (`Mac OS X 10.5+`, `Mac OS X`, `macOS System Shortcuts`) são **idênticos byte a byte** entre IntelliJ 2026.1 e WebStorm 2025.3. Em `$default` mudam só 3 mouse shortcuts: no IJ 2026.1, ⌥+clique = seleção retangular / Quick Evaluate e ⌥⇧+clique = adicionar cursor. No WS 2025.3 é o contrário. | observado | `cmp`/`diff` dos XMLs extraídos dos dois jars |
| K8 | Terminal no macOS (plugin `terminal`, que está no intellij-community): `Terminal.NewTab` ⌘T, `Terminal.ClearBuffer` ⌘K, `Terminal.ClearPrompt` ⌃C (replace-all), `Terminal.CloseSession` ⌃D, `Terminal.CopySelectedText` ⌘C, `Terminal.Paste` ⌘V, `ActivateTerminalToolWindow` ⌥F12. | observado | catálogo + `plugin-shortcuts.json` |
| K9 | O WebStorm 2025.3 liga `Terminal.SwitchFocusToEditor` a `ESCAPE`; o IntelliJ 2026.1 **removeu** esse binding. Isso importa para o AnyCode porque o `claude` usa Esc para interromper: o terminal não deve roubar o Esc. | observado | diff de `plugin-shortcuts.json` entre as IDEs |

Spot-check do catálogo contra atalhos conhecidos do IntelliJ no Mac (todos batem): `GotoFile` ⌘⇧O, `ReformatCode` ⌥⌘L, `OptimizeImports` ⌃⌥O, `GotoDeclaration` ⌘B, `CommentByLineComment` ⌘/, `Vcs.QuickListPopupAction` ⌃V, `Switcher` ⌃⇥, `ActivateProjectToolWindow` ⌘1, `ActivateCommitToolWindow` ⌘0, `ShowSettings` ⌘,.

Produto derivado: `reference/jetbrains/derived/actions-catalog.mac.json`. São 2594 action IDs, 2283 com texto e 930 com binding efetivo no macOS (IntelliJ 2026.1, já com os atalhos de teclado e de mouse dos plugins). O texto vem, em ordem de preferência, de: `ActionsBundle.properties`; bundles e atributos `text=` dos plugins (`text_source` diz qual), ignorando os pacotes de idioma `plugins/localization-*`; e, para `Activate<X>ToolWindow`, do título da stripe (`toolwindow.stripe.<X>`). Cada entrada traz também `description`, o XML que declara a ação, `use_shortcut_of`, atalhos (`keyboard` como `[primeiro, segundo]`, `mouse`, `gesture`) e de qual keymap o binding veio. Ficam sem texto ações com nome dinâmico (`Run`/`Debug` mostram o nome da run configuration) e `ShowSettings`, cujo texto vem do código. Nota para o parser do AnyCode: os XMLs usam `control` e `ctrl` como sinônimos.

## Tool windows

| # | Achado | Tipo | Evidência |
|---|---|---|---|
| W1 | Layout padrão do New UI (V2): **esquerda** Project (peso 0.25, conteúdo em `COMBO`), Commit (0.25) e Structure (0.25, `isSplit`, divide a área com a anterior); **baixo** Version Control, Problems, Problems View, Terminal e Services; **direita** Notifications (0.25, `COMBO`), AIAssistant, Database, Gradle e Maven (0.25 cada). Peso padrão 0.33, `sideWeight` 0.5. Todas começam fechadas (`isVisible = false`). Não existe stripe superior. | fonte | `defaultToolWindowlayoutProvider.kt` (`addPlatformDefaultsV2`) |
| W2 | O layout salvo do usuário (`options/window.layouts.xml`, layout `Custom`) é **idêntico** ao W1: mesmos IDs, ordem e pesos. O usuário nunca customizou, então o padrão da plataforma é a referência certa. | observado | `reference/jetbrains/derived/tool-windows.json` |
| W3 | Âncora, ícone e plugin vêm do `<toolWindow>` de cada `plugin.xml`: 49 registros no IJ e 57 no WS. Problems, Services, Maven, Run, Debug e Find são registrados em código, sem XML. Project e Structure aparecem declarados no `frontend-split` (modo split frontend/backend). | observado | `plugin-scan.json` → `tool_windows` |
| W4 | Para o v1 do AnyCode, servem diretamente: Project, Commit, Structure, Version Control, Problems, Terminal e Notifications. Database, Gradle, Maven e AIAssistant são plugins proprietários ou estão fora do escopo do v1. | inferido | W1 + CLAUDE.md |

## Ícones (New UI / expUI)

| # | Achado | Tipo | Evidência |
|---|---|---|---|
| I1 | Os ícones do New UI ficam em `intellij.platform.ide.jar` (`expui/**`, 1665 SVGs), cada um com variantes `_dark`, `@20x20` e `@20x20_dark`. O `PlatformIconMappings.json` mapeia o caminho clássico (o que `AllIcons.Toolwindows.*` referencia) para o caminho expui. Ex.: `toolwindows/toolWindowProject.svg` → `expui/toolwindows/project.svg`. | observado | `reference/jetbrains/icons/PlatformIconMappings.json` |
| I2 | Ícones das tool windows do v1: Project `project.svg`, Commit `commit.svg`, Structure `structure.svg`, Version Control `vcs.svg`, Problems `problems.svg`, Notifications `notifications.svg`, Services `services.svg`, Run `run.svg`, Debug `debug.svg`, Find `find.svg`, todos em `expui/toolwindows/`. O do Terminal vem do próprio plugin: `icons/expui/toolwindow/terminal.svg` em `terminal.jar`, mapeado por `TerminalIconMappings.json`. | observado | `tool-windows.json` + mappings |
| I3 | Dos 168 arquivos em `expui/toolwindows/` do IJ 2026.1, só os 4 de `meetNewUi` **não** estão no `intellij-community` (`platform/icons/src/expui/toolwindows/`, 165 entradas). Todos os da lista I2 estão lá, e os do Terminal estão em `plugins/terminal/resources/icons/`. | observado + fonte | comparação da listagem do jar com a API do GitHub |

## Uso real do usuário (IntelliJ 2026.1)

Fonte: `options/actionSummary.xml` (contador local de ações, com `c` = invocações e `l` = último uso). Foram 274 ações e 32.572 invocações. O resultado cruzado com o catálogo está em `reference/jetbrains/user/action-usage.intellij-2026.1.json` (não versionado).

| # | Achado | Tipo |
|---|---|---|
| U1 | **43% de tudo (14.147 invocações) acontece no terminal.** A ação mais usada, `SendShortcutToTerminalAction` (11.884), é o repasse de atalhos de teclado ao processo do terminal em vez de executar a ação da IDE. Depois vêm `Terminal.Paste` (958), `Terminal.CopySelectedText` (376) e `Terminal.NewTab` (353). Isso confirma o princípio AI-first: o terminal do AnyCode precisa repassar atalhos ao `claude` por padrão, com uma lista explícita de exceções. Ver também K9. | observado |
| U2 | Navegação e busca somam 2.091: `SearchEverywhere` 683, `GotoDeclaration` ⌘B 604, `FindInPath` ⌘⇧F 580, `Find` 114, `ReplaceInPath` 79. | observado |
| U3 | **Run/Debug somam cerca de 2.184**: `Debug` 416, `RedesignedRunConfigurationSelector` 432, `Resume` 177, `Run` 173, `Stop` 158, `Rerun` 148, `StepOver` 127, além de ações de breakpoint. Maven/Gradle somam 294. **Decisão (2026-10-23):** Run/Stop básico entra no v1 (roadmap item 7 do `CLAUDE.md`); o debugger continua fora. | observado |
| U4 | Git pelas ações da IDE é pouco usado (cerca de 162). É coerente com o fluxo em que o Claude faz os commits. | observado (inferência fraca) |
| U5 | 131 dos 274 IDs não têm texto no catálogo. Quase todos são nomes de classe Java: ações sem registro, gravadas pela classe (`CloseTab`, `SquareAnActionButton`…). Não fazem parte do keymap. | observado |

Outras configurações do usuário relevantes: as fontes do editor, terminal e console estão no padrão (sem override). O `ui.lnf.xml` traz regras de *file nesting* da árvore de projeto para JS/TS (ex.: `.js`/`.js.map`/`.d.ts` aninhados sob `.ts`; `.min.css` sob `.css`), que vale replicar na árvore do AnyCode.

## Tema Islands Dark

| # | Achado | Tipo | Evidência |
|---|---|---|---|
| T1 | Cadeia: `Islands Dark` → `ExperimentalDark` (`expUI_dark`) → `Darcula`. O esquema do editor é `Islands Dark` (`IslandSchemeDark.xml`). | observado | campos `parentTheme`/`editorScheme` |
| T2 | No IntelliJ 2026.1, o Islands Dark usa um **sistema de tokens em 3 camadas**: paleta (`gray-10` = `#191A1C`, `blue-60`…) → camadas (`layer-0-bg`, `layer-1-bg`…) → semânticos (`container-tool-window-bg`, `text-default`, `selection-bg-active`, `tab-selected-bg-active`, `toolbar-bg-hovered`…). As chaves de `ui` referenciam os semânticos. É o mapeamento natural para CSS custom properties. | observado | `ManyIslandsDark.theme.json` (325 cores próprias) |
| T3 | O WebStorm 2025.3 tem uma versão **anterior** do mesmo tema: só 445 chaves achatadas, contra 1115 no IJ, com nomes estilo Darcula (`PanelBackground`, `BorderDark`). O `IslandSchemeDark.xml` do editor é idêntico nos dois. **Use a versão do IntelliJ 2026.1**, que é o tema ativo do usuário. | observado | diff dos JSONs |
| T4 | Geometria das ilhas: `Island.arc` 20 (compact 16), `Island.borderWidth` 6 (compact 4), `Island.borderArcLength` 14, `Island.inactiveAlpha` 0.56, `Island.toolWindowAlpha` 0.2. Outros valores: `Component.arc` 8, `Button.arc` 8, `EditorTabs.underlineHeight` 4 e `underlineArc` 4, `EditorTabs.tabInsets` `-6,8,-6,8`, `List.rowHeight` 24, `MainToolbar.Icon.insets` 5. | observado | `ui_other` em `islands-dark.resolved.json` |
| T5 | Superfícies principais: janela/toolbar/status bar `#26282C` (`layer-1-bg`); tool windows, editor e abas `#191A1C` (`layer-0-bg`); popups `#26282C`; texto `#D1D3D9` e muted `#9FA2A8`; seleção ativa `#2A4371`; aba selecionada `#233558`; acento `#3871E1`. | observado | `islands-dark.resolved.json` |

Produto derivado: `reference/jetbrains/derived/islands-dark.resolved.json`, com 422 cores e 941 chaves de UI resolvidas para hex. Cada uma traz a cadeia de referências (`via`) e o tema de origem (`from`). Restam 4 referências sem resolver (`panel` e `underline`), que vêm de defaults em código do Darcula.

## Bridge Claude Code (validado com `claude` 2.1.309)

Sonda: `node scripts/run-bridge-probe.mjs [segundos] [saida.json]`. Ela sobe o servidor do AnyCode (`src/main/bridge/server.ts`), roda o `claude` instalado num PTY com `CLAUDE_CODE_SSE_PORT`/`ENABLE_IDE_INTEGRATION` e grava todas as mensagens JSON-RPC. Não envia prompt. O transcript fica em `out/bridge-probe.json` (não versionado). Foi usada no lugar do `capture-process` do REA porque registra os dois lados do JSON-RPC, não só o terminal.

| # | Achado | Tipo |
|---|---|---|
| B1 | Sequência na conexão: `initialize` (request) → `notifications/initialized` → `ide_connected` (notificação, `{pid: <pid do claude>}`) → `tools/list` → `prompts/list`. Tudo em cerca de 10 ms depois de abrir o socket. | observado |
| B2 | O cliente se identifica como `{name: "claude-code", title: "Claude Code", version: "2.1.309"}`, pede `protocolVersion: "2025-11-25"` e capabilities `roots`, `elicitation` e a extensão `io.modelcontextprotocol/tasks`. Aceita servidor respondendo `2024-11-05` (igual ao claudecode.nvim). | observado |
| B3 | O `claude` dentro do AnyCode descobre o lockfile e conecta sozinho (status bar "Claude connected"), com o `ideName: "AnyCode"`. | observado (app headless + screenshot) |
| B4 | Na inicialização, a TUI consulta o protocolo de teclado do kitty (`CSI > 0 q`, `CSI < u`, `CSI ? u`) e `modifyOtherKeys` (`CSI > 4 m`). O xterm.js 6 não implementa esse protocolo, então Shift+Enter chegaria como Enter. Resolvido assim: Shift+Enter envia LF, que é o Ctrl+J que a documentação oficial dá como nova linha "em qualquer terminal" (code.claude.com/docs/en/terminal-config). Confirmado com o `claude` real: a linha quebra no prompt sem submeter. | observado |
| B5 | Variáveis `CLAUDECODE`/`CLAUDE_CODE_*` herdadas do processo pai (ex.: AnyCode aberto de dentro de uma sessão do Claude) mudam o comportamento do `claude` filho (`CLAUDE_CODE_CHILD_SESSION` desliga o salvamento do transcript). O AnyCode remove essas variáveis do ambiente dos terminais (`terminalEnv` em `src/main/pty.ts`). | observado |
| B6 | O `claude` desenha a TUI para o tamanho do PTY no primeiro frame. Um PTY criado com 80×24 e redimensionado depois deixava a caixa de prompt fora da tela. As sessões agora são medidas antes do spawn (`ptySessions.ts`); o teste E2E com `stty size` cobre isso. | observado (raw PTY) |

Ainda não observado com o `claude` real: chamadas de tools (`openDiff`, `openFile`…), que só acontecem durante uma tarefa. O contrato está coberto pelos E2E com um cliente falso (`e2e/claudeClient.ts`) que segue o `PROTOCOL.md` do claudecode.nvim.

## Limite legal (verificado)

Os arquivos de dados usados acima existem no `JetBrains/intellij-community` (Apache-2.0):
`platform/platform-resources/src/themes/islands/{ManyIslandsDark.theme.json,IslandSchemeDark.xml}`, `platform/platform-resources/src/keymaps/*.xml` e `platform/platform-resources-en/src/messages/ActionsBundle.properties`. O plugin de terminal também está no repositório (`plugins/terminal`). O que entrar no produto deve ser buscado de lá, de preferência na tag do build `261.22158.277`, com atribuição em `THIRD_PARTY_NOTICES`, e não copiado do bundle instalado.

## Reproduzir

```bash
# inventário e plist (REA; Node keg-only do Homebrew)
PATH=/opt/homebrew/opt/node@24/bin:$PATH npx -y rea-agents@6.7.0 inspect-artifact "/Applications/WebStorm.app" --format json > reference/rea/webstorm-2025.3.4.inspect-artifact.json
PATH=/opt/homebrew/opt/node@24/bin:$PATH npx -y rea-agents@6.7.0 inspect-plist "/Applications/WebStorm.app/Contents/Info.plist" --format json

# dados derivados (scripts/reference/)
python3 -I scripts/reference/resolve_theme.py reference/jetbrains/derived/islands-dark.resolved.json \
  reference/jetbrains/themes/ManyIslandsDark.theme.json reference/jetbrains/themes/expUI_dark.theme.json reference/jetbrains/themes/darcula.theme.json
python3 -I scripts/reference/plugin_scan.py reference/jetbrains/derived/plugin-scan.json "/Applications/IntelliJ IDEA.app" "/Applications/WebStorm.app"
python3 -I scripts/reference/action_catalog.py --plugins reference/jetbrains/derived/plugin-scan.json "IntelliJ IDEA.app" \
  reference/jetbrains/derived/actions-catalog.mac.json reference/jetbrains/actions/ActionsBundle.properties reference/jetbrains/keymaps reference/jetbrains/actions/*Actions.xml
OPTS="$HOME/Library/Application Support/JetBrains/IntelliJIdea2026.1/options"
python3 -I scripts/reference/tool_windows.py reference/jetbrains/derived/tool-windows.json "$OPTS/window.layouts.xml" \
  reference/jetbrains/derived/plugin-scan.json "IntelliJ IDEA.app" reference/jetbrains/icons/PlatformIconMappings.json
python3 -I scripts/reference/action_usage.py reference/jetbrains/user/action-usage.intellij-2026.1.json "$OPTS/actionSummary.xml" \
  reference/jetbrains/derived/actions-catalog.mac.json
```

`reference/jetbrains/actions/` foi extraído de `intellij.platform.ide.impl.jar` (`idea/*Actions.xml`, `messages/ActionsBundle.properties`) e de `app.jar` (`idea/UsageViewActions.xml`). `reference/jetbrains/icons/PlatformIconMappings.json` vem de `intellij.platform.ide.jar`. Dos arquivos em `options/`, só foram lidos `window.layouts.xml`, `actionSummary.xml`, `ui.lnf.xml` e `*-font.xml`. Arquivos com credenciais ou tokens (`idea.key`, `user.web.token`, `CodeiumSettings.xml`…) não foram abertos.

## Checklist

| Pergunta | Status |
|---|---|
| Identidade e versões das duas IDEs | respondida |
| Keymap efetivo do macOS, com semântica de herança | respondida (K1–K5), incluindo os atalhos de mouse dos plugins |
| Diferenças IntelliJ × WebStorm relevantes ao AnyCode | respondida (K7, K9, T3) |
| Tokens do Islands Dark prontos para CSS | respondida (T2–T5) |
| Nomes legíveis das ações (para Find Action) | respondida: 2283 de 2594 IDs. Os restantes têm nome dinâmico ou definido em código (ver catálogo). |
| Double-Shift / gestos fora do keymap | respondida (K6, K6a). Sub-questão em aberto: double-Ctrl no Mac (K6b). |
| Layout padrão das tool windows (lados, ordem, tamanhos) | respondida (W1–W3) |
| Ícones expUI das tool windows (SVG) | respondida (I1–I3) |
| O que o usuário realmente usa | respondida (U1–U5). Run/Stop básico incluído no v1 (U3). |
| Protocolo do bridge Claude Code | fora deste escopo (não há plugin instalado). Seguir `claudecode.nvim` + `capture-process`. |
