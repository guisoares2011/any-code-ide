# AnyCode

IDE leve, inspirada no IntelliJ IDEA / WebStorm, para abrir **todos os projetos** (JS/TS, Java, Kotlin…) numa única aplicação, sem alternar entre WebStorm e IntelliJ. É **AI-first**: o fluxo principal de codificação é o Claude Code rodando via CLI, e a IDE existe para orquestrar, revisar e navegar o que a IA produz.

## Princípios de produto (não negociáveis)

1. **Keymap = IntelliJ.** O keymap padrão é o do IntelliJ para macOS (`Mac OS X 10.5+`, que herda de `$default`). Não inventar atalhos que conflitem com ele. Ações internas usam os **mesmos action IDs do IntelliJ** (`GotoFile`, `SearchEverywhere`, `ReformatCode`, `ActivateTerminalToolWindow`…) para que o mapeamento seja 1:1 e os XMLs de keymap sejam carregados direto, sem tradução manual.
2. **Identidade visual = Islands Dark** (tema ativo no IntelliJ do usuário). Cores, espaçamentos, layout em "ilhas" arredondadas, barra superior com projeto/VCS/run e tool windows laterais seguem o IntelliJ New UI. Fonte do editor/terminal: JetBrains Mono (OFL); UI: Inter.
3. **AI-first.** O terminal com `claude` é cidadão de primeira classe (painel inferior padrão, aberto por projeto, sessão preservada). Editor, diff viewer e árvore de projeto existem para revisar e ajustar o que o agente faz.
4. **Simplificada.** Fora do escopo: ferramentas de banco, profiler, refactorings semânticos profundos, sistema de plugins. Se uma feature não serve ao fluxo "IA escreve → humano revisa/navega/executa", ela espera. **Exceções:** Run/Stop e o **debugger** (decisão do usuário em 2026-10-24; ver seções próprias), porque Run/Debug é o terceiro maior uso real do usuário no IntelliJ (`docs/reverse-engineering.md`, U3).
5. **Multi-projeto.** Como no IntelliJ: janelas de projeto, que podem ser mescladas em abas numa janela só; cada projeto com seu terminal Claude, árvore e abas.

## Stack (decisão padrão)

- **Electron + TypeScript (strict) + React + Vite** (electron-vite). Escolhido em vez de Tauri porque não há toolchain Rust na máquina, e `node-pty`, Monaco, LSP clients e o Claude Agent SDK são nativos em TS.
- **Editor:** Monaco. **Terminal:** xterm.js + node-pty.
- **Linguagens via LSP** (processos gerenciados pelo main): **typescript-go** (TypeScript 7 nativo, `tsc --lsp --stdio`, instalado como `typescript-native`) para JS/TS, no lugar de vtsls/typescript-language-server por ser nativo e leve (~115 MB neste projeto); `jdtls` para Java; `kotlin-lsp` (open source da JetBrains) para Kotlin.
- **Servidores Java/Kotlin:** o jdtls roda com o Java 21+ do sistema (`JAVA_HOME` → `/usr/libexec/java_home -v 21+` → `java`), com um diretório `-data` por projeto em `~/Library/Application Support/AnyCode/jdtls-workspaces/`. Os metadados do Eclipse (`.project`, `.classpath`, `.settings`) ficam nesse diretório, não nos módulos do usuário: `-Djava.import.generatesMetadataFilesAtProjectRoot=false` na JVM e o mesmo setting no `initialize`, como o vscode-java. Só o setting não basta, porque o local é decidido no import. O kotlin-lsp roda via `bin/intellij-server --stdio`, com `--system-path` por projeto (`kotlin-system/`) e `--data-sharing=none` (sem telemetria). A licença dele é concedida automaticamente para Kotlin; não aceitar EULA em nome do usuário. Os servidores mandam avisos (`window/showMessage`) para a tool window Notifications.
- Ao testar LSP com diretórios temporários, use `realpath`: `/var/folders` é symlink para `/private/var/folders`, e o jdtls não reconhece arquivos abertos pelo caminho com symlink.
- **ESLint** (`src/main/eslint/`, `src/renderer/lint/eslint.ts`), como o modo automático do IntelliJ: usa o ESLint **do próprio projeto** (`node_modules/eslint`, flat config ou eslintrc via `loadESLint`), num processo separado por raiz (`out/main/eslintWorker.js`, o próprio Electron com `ELECTRON_RUN_AS_NODE=1`), porque a config do projeto é código e não pode carregar no main. Lint ao abrir e ao editar (500 ms) arquivos JS/TS; os problemas viram markers `eslint` ("ESLint: mensagem (regra)"), que aparecem em Problems e no `getDiagnostics` do bridge. Sem ESLint ou sem config, fica em silêncio; mudar `eslint.config.*`, `.eslintrc*` ou `package.json` reinicia o worker. "Fix ESLint Problems" (`AnyCode.ESLintFix`, no Find Action e sem atalho, porque a ação do IntelliJ é de plugin proprietário) aplica os fixes como uma edição desfazível.
- **Cliente LSP:** o `monaco.lsp.MonacoLspClient` que vem com o Monaco 0.57, por trás de `src/renderer/lsp/router.ts`. O roteador filtra documentos por servidor, responde localmente o que não é dele, injeta `rootUri`, completa os `client/registerCapability` sem `registerOptions` (o jdtls manda assim e o cliente do Monaco quebrava), responde `workspace/configuration` e corrige a URI em minúsculas que o cliente envia em `didOpen`/`didChange`/`didClose` (bug do 0.57). Respostas de localização carregam os arquivos de destino como models antes de chegar ao Monaco, e o `registerEditorOpener` abre a aba. O mesmo roteador serve requests próprios do AnyCode (`documentSymbol` → tool window Structure). O servidor de cada linguagem sobe sob demanda, quando o primeiro arquivo dela é aberto.
- **Git:** CLI `git` via processo filho.
- **Testes:** Vitest (unit) e Playwright `_electron` (E2E).
- **Package manager:** npm (Node 24; pnpm não está instalado).

## Integração com Claude Code

Três camadas, em ordem de prioridade:

1. **Terminal embutido** rodando `claude` num PTY com `cwd` = raiz do projeto. Uma sessão por projeto; ao trocar de projeto, a sessão continua viva.
2. **Bridge IDE ↔ Claude Code** (o mesmo mecanismo do `/ide` usado pelas extensões oficiais de VS Code e JetBrains): o AnyCode sobe um servidor MCP via WebSocket em `127.0.0.1`, escreve um lockfile em `~/.claude/ide/<porta>.lock` (com `pid`, `workspaceFolders`, `ideName: "AnyCode"`, `transport: "ws"`, `authToken`) e injeta `CLAUDE_CODE_SSE_PORT` + `ENABLE_IDE_INTEGRATION=true` no ambiente do terminal. Isso permite que o Claude abra arquivos, mostre diffs no diff viewer do AnyCode para aceitar/rejeitar, leia diagnostics do LSP e receba a seleção atual. O protocolo **não tem documentação oficial**. A referência de implementação é o `PROTOCOL.md` do [coder/claudecode.nvim](https://github.com/coder/claudecode.nvim) (MIT), que descreve o lockfile, a autenticação e as tools (`openFile`, `openDiff`, `getDiagnostics`, `getCurrentSelection`, `getOpenEditors`, notificação `selection_changed`…). Valide contra a versão instalada do `claude` (2.1.309 no momento) observando o comportamento com `capture-process` do REA. Não decompile o binário do Claude Code. Nunca logar o `authToken`.
Estado (2026-10-23): camadas 1 e 2 implementadas (`src/main/bridge/`, `src/renderer/bridge/`) e validadas contra o `claude` 2.1.309, que conecta sozinho (ver `docs/reverse-engineering.md`, B1–B6). Para revalidar depois de atualizar o `claude`, rode `node scripts/run-bridge-probe.mjs`. Tools implementadas: `openFile`, `openDiff` (bloqueante: aceitar devolve `FILE_SAVED` + conteúdo final, e quem escreve o arquivo é o Claude; rejeitar ou fechar a aba devolve `DIFF_REJECTED`), `getCurrentSelection`, `getLatestSelection`, `getOpenEditors`, `getWorkspaceFolders`, `getDiagnostics` (markers do Monaco por enquanto), `checkDocumentDirty`, `saveDocument`, `close_tab` (não anunciada) e `closeAllDiffTabs`. Notificações: `selection_changed` (debounce de 100 ms) e `at_mentioned` (ação `AnyCode.SendSelectionToClaude`, sem atalho padrão porque ⌥⌘K é Commit and Push no keymap do IntelliJ). O lockfile respeita `CLAUDE_CONFIG_DIR`; os E2E usam um diretório temporário. Shift+Enter no terminal envia LF (o Ctrl+J que o Claude Code documenta como nova linha), já que o xterm.js 6 não implementa o protocolo de teclado do kitty (B4).
3. **Futuro:** painel de chat nativo via Claude Agent SDK ou ACP (o IntelliJ do usuário já tem o agente `claude-acp` instalado em `~/Library/Application Support/JetBrains/acp-agents/`). Só depois que 1 e 2 estiverem sólidos.

## Run configurations e Maven

Executar e parar o projeto sem sair da IDE. Não é um debugger.

- **Tipos** (`src/shared/runConfigurations.ts`), espelhando o IntelliJ: Spring Boot (main class, módulo, perfis, VM options, argumentos), Maven (linha de comando e perfis), npm, Shell Script, Gradle e JUnit. Todos têm variáveis de ambiente (campo `KEY=value;…`, como o IntelliJ) e diretório de trabalho.
- **Origens**, com precedência por nome nesta ordem:
  1. `.run/<nome>.run.xml` (arquivo de projeto, **formato do IntelliJ**, que lê o mesmo arquivo);
  2. privadas do AnyCode (`<userData>/run-configurations/<sha1(root)>.json`);
  3. importadas, somente leitura, do `RunManager` do `.idea/workspace.xml` (sem as temporárias; nunca escrever nesse arquivo);
  4. detectadas: scripts do `package.json`, tasks do Gradle e uma Spring Boot por classe com `@SpringBootApplication`.

  Editar uma configuração importada ou detectada cria uma cópia do AnyCode com o mesmo nome. "Store as project file" grava em `.run/`.
- **Diálogo Run/Debug Configurations** (`editRunConfigurations`): toolbar do run widget → "Edit Configurations…" ou Find Action.
- **Execução:** o main monta o script (`runConfigurations/command.ts`) e o renderer roda num PTY da tool window Run (`$SHELL -l -c`, então o PATH do usuário vale).
  - **Spring Boot multi-módulo:** `mvn -q -pl <módulo> -am install -DskipTests && mvn -pl <módulo> spring-boot:run -Dspring-boot.run.main-class=… [-Dspring-boot.run.profiles/jvmArguments/arguments]`. O `install` grava os módulos do projeto no `~/.m2`, a prática comum de quem delega o build ao Maven.
  - **Validado** num projeto temporário (lib + app) com o Spring Boot 3.5.7 do `~/.m2`.
- **Maven:** o executável vem do `./mvnw` do projeto; depois de `mvn` no PATH da shell de login; por fim, da distribuição mais nova em `~/.m2/wrapper/dists`.
- **Tool window Maven** (stripe direita, `ActivateMavenToolWindow`):
  - reator lido dos `pom.xml`, com Lifecycle (duplo clique roda `<artifactId> [<fase>]`), Profiles, Plugins e Dependencies;
  - as dependências vêm de `org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree`, com versão fixada porque o 3.9.4 usa por padrão a 3.6.0;
  - "Reload All Maven Projects" (`Maven.Reimport`).
- **Árvore do projeto:** como no IntelliJ depois do import, os diretórios dos módulos do reator ficam em negrito, com o ícone de módulo e `[artifactId]` quando o nome difere da pasta. `src/main/java|kotlin`, `src/test/java|kotlin`, `resources` e `target` ganham os ícones de source/test/resources/excluded root (`project/moduleRoots.ts`). Mudar um `pom.xml` relê o reator.
- **JUnit** (escopo módulo / pacote / classe / método), sempre pelo build, como o "delegate to build tool" do IntelliJ:
  - Maven: `mvn [-pl <módulo> -am] test -Dtest=<Classe>[#<método>] -Dsurefire.failIfNoSpecifiedTests=false [-DargLine=<VM options>]`; pacote vira `-Dtest=com/acme/**/*`. Validado offline com Maven 3.9.4 + Surefire 3.5.4 num projeto lib + app.
  - Gradle (projeto com `gradlew`/`build.gradle`/`settings.gradle` e sem `pom.xml`): `./gradlew [:<módulo>:]test --tests <filtro>`; VM options não se aplicam.
  - No editor, `.java`/`.kt` com `@Test` (também `@ParameterizedTest`, `@RepeatedTest`…) ganham o CodeLens "▶ Run '<classe>'" / "▶ Run '<método>()'" (`run/testDetection.ts` lê o texto, sem compilador). `RunClass` ⌃⇧R roda o método na linha do cursor, ou a classe. O módulo vem do caminho (`<módulo>/src/test/…`).
  - Cada execução vira uma configuração **temporária** (até 5 por projeto), selecionada no run widget para o Rerun, como no IntelliJ.
  - Import/export no formato `JUnit` do IntelliJ (`TEST_OBJECT` class/method/package; pacote vazio = módulo inteiro). Padrões, tags e diretórios ficam de fora. O import de Gradle agora inclui os `scriptParameters` (`--tests …`).
- **Atalhos:** `Run` ⌃R, `Stop` ⌘F2, `Rerun` ⌘R (no Run), `ChooseRunConfiguration` ⌃⌥R, `ActivateRunToolWindow` ⌘4, `RunClass` ⌃⇧R.
- **Fora:** cobertura e profiler; árvore de resultados de teste (a saída é a do build, no Run); Docker. O debugger tem seção própria.

## Debugger

Debug Adapter Protocol (DAP), com os adaptadores open source do VS Code, baixados pelo `install-language-servers.mjs` (não vão no `.app`): **java-debug** 0.53.1 (EPL-1.0, Maven Central) e **js-debug** 1.140.0 (MIT, GitHub).

- **Main** (`src/main/debug/`): conexões DAP por TCP em `127.0.0.1` (`debug:connect`/`debug:send`/`debug:message`, mesmo framing do LSP), o servidor do js-debug (`dapDebugServer.js 0 127.0.0.1`, com `ELECTRON_RUN_AS_NODE=1`, um por janela) e `debug:freePort`. O jar do java-debug entra como `bundles` no `initialize` do jdtls (`withJavaDebugBundle`, em `lsp/manager.ts`); um jdtls iniciado antes da instalação só ganha o java-debug depois de reiniciar o app.
- **Java (Spring Boot, JUnit)**, sempre pelo build, como o Run: o `run:command` recebe `{ port }` e o JVM espera o debugger (`-agentlib:jdwp=…,server=y,suspend=y,address=127.0.0.1:<porta>`): em `spring-boot.run.jvmArguments`, em `-Dmaven.surefire.debug` ou, no Gradle, `--debug-jvm` (porta fixa 5005). O renderer espera "Listening for transport dt_socket" no console, pede `vscode.java.startDebugSession` ao jdtls (`workspace/executeCommand`, depois do `initialize`) e faz `attach`. Breakpoints só em `.java` (o java-debug resolve a classe pelo JDT; Kotlin fica sem breakpoint por enquanto).
- **Node (npm e scripts .js/.ts)**: `launch` `pwa-node` com `console: integratedTerminal`; o js-debug pede `runInTerminal` (vira um PTY no Console) e abre uma sessão filha por processo Node (`startDebugging` → nova conexão na mesma porta). npm roda como `/bin/sh -c <script do run:command>`. Validado em `e2e/debugger.spec.ts`.
- **Renderer** (`src/renderer/debug/`): `dap.ts` (cliente), `session.ts` (estado, threads, frames, steps, Run to Cursor com breakpoint temporário, `evaluate`), `launch.ts`, `breakpoints.ts` (por arquivo, em `localStorage`, seguem as linhas editadas e as renomeações), `editorDebug.ts` (gutter: clique ou ⌘F8; linha de execução com as cores `EXECUTIONPOINT_ATTRIBUTES`/`BREAKPOINT_ATTRIBUTES` do esquema; valor no hover quando pausado) e a tool window **Debug** (stripe inferior, ⌘5): abas de sessão, toolbar, "Threads & Variables" (thread, Frames, Variables com os escopos baratos abertos, campo de expressão com `Console.Execute` ↩) e "Console" (grupo de PTY `debug` por projeto).
- **Onde começa:** botão Debug do run widget, CodeLens "Debug" ao lado de "▶ Run" nos testes, "Debug '<nome>'" no menu da árvore, `Debug` ⌃D e `DebugClass` ⌃⇧D.
- **Atalhos:** `ToggleLineBreakpoint` ⌘F8, `ViewBreakpoints` ⇧⌘F8 (diálogo para habilitar, remover ou ir até o breakpoint), `Resume` ⌥⌘R/F9, `Pause`, `StepOver` F8, `StepInto` F7 (`SmartStepInto` ⇧F7 e `ForceStepInto` ⌥⇧F7 fazem o mesmo), `StepOut` ⇧F8, `RunToCursor` ⌥F9, `EvaluateExpression` ⌥F8, `ShowExecutionPoint` ⌥F10, `XDebugger.MuteBreakpoints`; `Stop` ⌘F2 e `Rerun` ⌘R valem para a sessão quando a Debug tem foco (ou quando nada roda no Run).
- **Fora:** watches, breakpoints condicionais, de exceção e de método, hot swap, Kotlin, attach a processo já rodando.

## Árvore do projeto: menu de contexto

Botão direito (ou `ShowPopupMenu`) abre o `ProjectViewPopupMenu` reduzido (`project/projectMenu.ts`, com o componente genérico `ui/ContextMenu.tsx`, navegável por ↑↓; → entra no submenu e ← volta, via `List-select*`):
- **New** (`NewElement` ⌘N abre o mesmo submenu sob a seleção): File (aceita `a/b/c.txt`), Scratch File, Directory; dentro de `src/*/java|kotlin`, Package (pontos viram pastas), **Java Class** (Class/Interface/Enum/Record/Annotation) e **Kotlin Class/File**, com o `package` vindo do caminho e "sub.Nome" criando o subpacote.
- Cut/Copy/Paste (⌘X/⌘C/⌘V; colar sobre um arquivo vai para a pasta dele; a cópia ganha um nome livre, "x copy.ts"), **Copy Path/Reference…** (⇧⌘C: absoluto, nome ou relativo à raiz), **Rename…** (⇧F6, seleciona o nome sem a extensão; abas, edições não salvas e breakpoints acompanham), **Delete…** (⌫, confirma e manda para a Lixeira; em headless apaga de verdade).
- **Run/Debug '<nome>'**: testes JUnit (classe, ou pacote e módulo pela pasta de teste) e scripts (`.sh`, `.js`/`.ts` com `node`, `.py`…), que rodam na pasta do arquivo.
- **Open In** › Finder (`RevealIn`), Terminal (`Terminal.OpenInTerminal`, nova aba na pasta), Associated Application; **Git** › Show History / Rollback…; **Reload from Disk** (`SynchronizeCurrentFile`). Em headless, o Finder e os apps externos não abrem.
- Main: `fs:createFile`, `fs:createDirectory`, `fs:rename`, `fs:copyInto`, `fs:moveInto`, `fs:trash`, `fs:exists`, `shell:reveal`, `shell:openPath`, todos limitados aos projetos abertos (e às scratches). Os diálogos de nome e de confirmação ficam em `ui/dialogs.tsx` (`askInput`, `askConfirm`).

## Scratch Files

Arquivos fora dos projetos, em `<userData>/scratches/`, compartilhados por todas as janelas (como o `config/scratches` do IntelliJ): `NewScratchFile` ⇧⌘N (popup de linguagens, com a do editor ativo primeiro; cria `scratch.<ext>`, `scratch_1.<ext>`…), `Scratch.ShowFilesPopup` e `Scratch.ChangeLanguage` (troca a extensão). Aparecem no fim da árvore, em "Scratches and Consoles › Scratches", com o mesmo menu de contexto (inclusive Run/Debug de scripts). O main libera o diretório com `allowRoot` e o observa para todas as janelas. LSP e ESLint não analisam scratches, que ficam fora de qualquer raiz.

## Markdown

Preview renderizado de `.md` com blocos de shell executáveis (`src/renderer/markdown/`).

- **Layouts** iguais ao `TextEditorWithPreview` do IntelliJ, com os mesmos action IDs: `TextEditorWithPreview.Layout.EditorOnly`, `…EditorAndPreview`, `…PreviewOnly`. A toolbar fica no canto do editor e a escolha vale por arquivo. README abre em Preview Only; os demais `.md`, em Editor and Preview.
- **Renderização:** markdown-it (GFM: tabelas, linkify, HTML) sanitizado com DOMPurify, sem `style`/`form`/`input`/`iframe`.
  - Código colorido com `monaco.editor.colorize` e âncoras de heading no formato do GitHub.
  - Imagens relativas são lidas via `fs:readDataUrl`, restrito ao projeto.
  - Links: `#âncora` rola o preview; caminho relativo abre o arquivo numa aba; `http(s)` vai para o navegador.
- **Blocos de shell** (`bash`, `sh`, `shell`, `zsh`, `console`, `fish`…):
  - têm ▶ Run no preview e o CodeLens "▶ Run in Terminal" no editor;
  - os dois rodam o mesmo comando (`findShellFences`) numa **nova aba do terminal**, com `cwd` = pasta do arquivo;
  - como o `trimPrompt` do IntelliJ: se alguma linha começa com `$`, só essas rodam (o resto é saída), sem o prompt nem o `# comentário` final.

## Empacotamento

- `electron-builder.yml`: `AnyCode.app` arm64, ícone próprio (`build/icon.svg`: chaves com um prompt, sem marcas da JetBrains), `THIRD_PARTY_NOTICES.md` e as licenças do intellij-community em `Resources/`.
- Só as dependências do **main** ficam em `dependencies` (`@lydell/node-pty`, `fast-xml-parser`, `typescript-native`, `ws`), porque o electron-builder empacota só elas. Tudo que o renderer usa é embutido pelo Vite e fica em `devDependencies`. Dependência nova usada no main vai em `dependencies`.
- O node-pty fica fora do asar (`asarUnpack`). O typescript-go vai inteiro para `Resources/typescript-go/` (binário + `lib.*.d.ts`, que o electron-builder removeria de `node_modules`), e `typescriptGoBinary()` usa essa cópia quando ela existe. O worker do ESLint roda de dentro do asar.
- **PATH fora do terminal:** aberto pelo Dock/Finder, o app recebe o ambiente mínimo do launchd, e `$SHELL -l` não lê o `.zshrc` (onde ficam `~/.local/bin`, com o `claude`, e outros). Por isso, sem `TERM` no ambiente, `src/main/shellEnv.ts` pergunta o ambiente a `$SHELL -i -l -c env -0` antes de abrir a janela, como o VS Code, e o mescla no `process.env` (terminais, LSPs, Maven). Iniciado de um terminal, nada muda.
- **Uso só local (decisão do usuário):** o app não é distribuído, então fica com assinatura ad-hoc (`identity: '-'`) e sem notarização. Não pedir certificado nem configurar notarização. Gerado nesta máquina, não recebe quarentena e abre normalmente.

## Settings

Diálogo `ShowSettings` (⌘,, também no ícone de engrenagem), com busca, árvore de páginas, Apply/OK/Cancel. Gravado em `<userData>/settings.json` (`src/shared/settings.ts` normaliza valores e limita os números; `src/main/settings.ts` guarda).
- **Editor › Font:** tamanho e altura de linha (editores e diffs, aplicados ao vivo).
- **Tools › Terminal:** shell (vazio = `$SHELL`; vale para terminais e run configurations), comando do agente (padrão `claude`; `ANYCODE_AGENT_COMMAND` tem precedência e o modo headless abre shell) e tamanho da fonte.
- **Languages & Frameworks:** status dos servidores de linguagem com o comando de instalação; ESLint ligado/desligado ("Automatic ESLint configuration"); layout padrão do Markdown.
- **Keymap:** somente leitura, com busca por nome, action ID ou atalho (`⌘K`, `meta K`). Editar keymap fica para depois.

## Engenharia reversa com REA

A engenharia reversa é feita com o **REA** ([morluto/rea](https://github.com/morluto/rea), pacote npm `rea-agents`), servidor MCP que inspeciona apps instalados sem código-fonte e devolve conclusões com evidência.

- **Registro:** MCP `rea` no escopo *local* deste projeto (só aparece aqui), fixado em `rea-agents@6.7.0`. O REA exige Node ≥ 24.22.1, e o Node do sistema (`/usr/local/bin/node`) é 24.14.1. Por isso o servidor roda com o Node keg-only do Homebrew em `/opt/homebrew/opt/node@24/bin`. Para usar a CLI: `PATH=/opt/homebrew/opt/node@24/bin:$PATH npx -y rea-agents@6.7.0 <comando> --json`.
- **Skill:** `.claude/skills/reverse-engineer-anything/` (versão da tag `rea-agents-6.7.0`). Carregue-a antes de qualquer investigação.
- **Atualizar:** trocar a versão em `claude mcp add --scope local rea …` e na skill, sempre juntas.
- **Saída das análises:** o JSON de evidência é grande (≈5 MB para o bundle do IntelliJ). Salve em `reference/rea/` e consulte com `inspect-analysis-view` ou `jq`; não despeje no contexto.
- **Ferramentas por alvo:**
  - Bundles `.app`: `inspect-artifact`, `decode-interface-builder`, `inspect-asset-catalog` (estáticas, não abrem o app).
  - Comportamento do `claude` CLI no terminal: `capture-process` (PTY), sem janelas.
  - Apps Electron/JS: `analyze-javascript-application`.
- **Proibido (background):** `capture-native-ui-scenario`, `capture-electron-scenario` de apps de terceiros e qualquer operação que abra Hopper/Ghidra ou a janela do alvo, a menos que o usuário peça. Hopper/Ghidra não estão configurados; não instalar sem aprovação.
- O REA não decompila JVM fora de APK. Para os jars das IDEs JetBrains, use a extração direta descrita abaixo.

## Referências das IDEs instaladas

IntelliJ IDEA 2026.1 (`/Applications/IntelliJ IDEA.app`) e WebStorm 2025.3.4 (`/Applications/WebStorm.app`) servem de **referência somente leitura**.

- Recursos ficam nos jars em `Contents/lib/`. Keymaps e temas estão em `intellij.platform.ide.impl.jar` (`keymaps/*.xml`, `themes/islands/*`, `themes/expUI/*`). Inspecione com `unzip -Z1 <jar>` e extraia com `unzip -p`/`unzip -j`.
- Configuração do usuário (keymap/tema ativos, projetos recentes): `~/Library/Application Support/JetBrains/IntelliJIdea2026.1/options/`. Hoje não há keymap customizado (usa o padrão macOS) e o esquema de cores é `Islands Dark`. Nunca leia nem copie `idea.key`, `user.web.token` ou outros arquivos de licença/credencial.
- Cópias já extraídas para estudo em `reference/jetbrains/` (gitignored):
  - `keymaps/$default.xml`, `keymaps/Mac OS X 10.5+.xml`, `keymaps/Mac OS X.xml`, `keymaps/macOS System Shortcuts.xml`
  - `themes/ManyIslandsDark.theme.json` (UI), `themes/IslandSchemeDark.xml` (cores do editor), além de Darcula/expUI/Light como base
  - `actions/` (`*Actions.xml` + `ActionsBundle.properties`), `icons/PlatformIconMappings.json` e `derived/` (gerado por `scripts/reference/*.py`): `actions-catalog.mac.json` (action ID → nome + atalho efetivo no macOS), `islands-dark.resolved.json` (tokens do tema resolvidos em hex), `tool-windows.json` (layout + ícones expUI), `plugin-scan.json`
  - `user/action-usage.intellij-2026.1.json`: ranking de uso real das ações pelo usuário
- **Achados da engenharia reversa:** `docs/reverse-engineering.md`. Leia antes de implementar keymap/tema. Ponto crítico: `Mac OS X 10.5+` herda de `$default` com ⌃↔⌘ trocados nos atalhos herdados.
- **Limite legal:** dados como keymaps, themes e ícones existem no repositório open source `JetBrains/intellij-community` (Apache-2.0). Qualquer coisa que **entre no produto** deve vir de lá, com atribuição em `THIRD_PARTY_NOTICES`. Não decompilar nem portar código de produtos proprietários (WebStorm, plugins Ultimate); comportamento é recriado a partir de observação e dos arquivos de dados. Não usar nomes, logos ou ícones de produto da JetBrains no branding do AnyCode.

## Trabalhar em background (regra do usuário)

O usuário trabalha em outras coisas enquanto o agente roda. **Nenhuma janela pode aparecer na tela.**

- Nunca executar `open`, iniciar IntelliJ/WebStorm ou rodar `npm run dev` (abre janela Electron) sem o usuário pedir.
- Para verificação visual, o app deve suportar `ANYCODE_HEADLESS=1`: `BrowserWindow` com `show: false`, screenshots via `webContents.capturePage()` salvos em disco. Os E2E com Playwright usam esse modo.
- Comandos longos (builds, testes E2E, LSPs) rodam em background, nunca bloqueando o terminal.

## Estrutura planejada

```
src/main/         processo main: janelas, fs, pty, gerenciador de LSP, servidor MCP do bridge Claude
src/preload/      ponte IPC tipada (contextBridge)
src/renderer/     UI React
  keymap/         parser dos XMLs JetBrains → registry de ações por action ID
  theme/          tokens do Islands Dark → CSS custom properties
  editor/         Monaco + integração LSP
  terminal/       xterm.js
src/shared/       tipos e contratos de IPC compartilhados entre main e renderer
build/            ícone e entitlements do empacotamento
resources/intellij-community/  dados Apache-2.0 do intellij-community (tag fixo, com manifest.json)
reference/        material extraído das IDEs (não versionado)
e2e/              testes Playwright `_electron`
```

Mapa do que existe hoje no renderer:
- `keymap/`: `keystroke`/`shortcut` (formato Swing), `keymapXml` (XML de keymap e de plugin), `keymap` (resolução com semântica do IntelliJ), `macKeymap` (carrega `$default` → `Mac OS X 10.5+` + atalhos do plugin de terminal + gestos double-Shift/Ctrl + `componentShortcuts`), `dispatcher` (captura de teclas, chords, double-modifier, allowlist do terminal), `actions` (registry; vários handlers por ID, executa o primeiro habilitado) e `service` (singleton + `useActions`).
- `theme/`: resolve o tema e expõe tokens como `--c-<cor>`/`--ui-<Chave>`. Também gera os temas do Monaco e do xterm a partir do esquema do editor.
- `state/workbench.ts`: tool windows (layout padrão V2), abas, popups e pedidos de foco. `terminal/ptySessions.ts`: sessões PTY por grupo (Terminal, Run) que sobrevivem a esconder o painel.
- `markdown/`: `shellFences` (blocos executáveis e corte do prompt), `render` (HTML sanitizado), `MarkdownPreview`, `layout` (Editor/Split/Preview por arquivo) e `markdownSupport` (CodeLens "Run in Terminal").
- `debug/`: debugger (DAP, sessões, breakpoints, tool window Debug); `scratch/`: Scratch Files; `project/fileActions.ts` e `projectMenu.ts`: operações e menu de contexto da árvore; `ui/ContextMenu.tsx` e `ui/dialogs.tsx`: menus e diálogos genéricos.
- Áreas de foco: `data-focus-area` (`editor`, `terminal`, `run`, `tree`, `popup`) decide quais handlers ficam habilitados.

## Comandos

- `npm run typecheck` / `npm run lint` / `npm test` (Vitest, unit)
- `npm run test:e2e`: build + Playwright `_electron` com `ANYCODE_HEADLESS=1`. Os testes criam um projeto temporário e rodam com `ANYCODE_AGENT_COMMAND=""` (shell comum na aba do agente).
- `npm run screenshot`: build + captura headless em `out/screenshots/main.png`. O app sai sozinho; prazo máximo de 60 s.
- `npm run build` (saída em `out/`). `npm run dev` abre janela: **só quando o usuário pedir**.
- `node scripts/install-language-servers.mjs [jdtls] [kotlin] [java-debug] [js-debug]`: baixa os servidores de Java (jdtls, ~50 MB) e Kotlin (kotlin-lsp, ~360 MB, 1,1 GB descompactado) e os adaptadores de debug (java-debug e js-debug, ~1 MB cada) para `~/Library/Application Support/AnyCode/language-servers/`, com verificação de checksum (SHA-1 do Maven Central para o java-debug; SHA-256 fixado no script para o js-debug, que não publica checksum). O TypeScript não precisa de download. Os E2E de Java, Kotlin e debugger são pulados se o que usam não estiver instalado.
- `npm run package` (`.dmg` + `.zip` arm64 em `dist/`) / `npm run package:dir` (só o `AnyCode.app`, mais rápido). Usam o electron-builder (`electron-builder.yml`); nenhuma janela abre.
- `npm run test:packaged`: smoke test headless do `dist/mac-arm64/AnyCode.app` (terminal, typescript-go, ESLint, Git). Rode depois do `package:dir`.
- `npx electron scripts/make-icon.mjs`: renderiza `build/icon.svg` em `build/icon.icns` (offscreen, sem janela).
- `npm run fetch:intellij`: baixa de novo os recursos do intellij-community no tag fixado em `scripts/fetch-intellij-community.mjs`. Rode depois de mudar `TAG` ou `FILES` e confira o `manifest.json`.

Variáveis de ambiente do app:
- `ANYCODE_HEADLESS=1`: janela oculta e sem ícone no Dock.
- `ANYCODE_SCREENSHOT=<png>`: captura a janela quando o renderer avisa que está pronto.
- `ANYCODE_EXIT_AFTER_SCREENSHOT=1`: sai depois da captura.
- `ANYCODE_PROJECT=<dir>` ou `--project=<dir>`: projeto aberto no início (o padrão é o cwd).
- `ANYCODE_AGENT_COMMAND`: comando da aba do agente (padrão `claude`; em headless, shell comum).
- `ANYCODE_USER_DATA=<dir>`: diretório de dados do app (recentes…). Os E2E usam um temporário.
- `ANYCODE_LSP_TRACE=1`: loga no main todas as mensagens LSP (método, id e trecho do payload), nos dois sentidos.
- `ANYCODE_JDTLS_HOME` / `ANYCODE_KOTLIN_LSP_HOME`: usam um servidor instalado em outro lugar.
- `ANYCODE_JAVA_DEBUG_JAR` / `ANYCODE_JS_DEBUG_HOME`: o mesmo para os adaptadores de debug.
- `ANYCODE_DAP_TRACE=1`: loga no main as mensagens DAP, nos dois sentidos.
- `ANYCODE_SCREENSHOT_DELAY_MS`: espera extra antes do screenshot (ex.: para o `claude` conectar).

Notas de ambiente: o npm 11 bloqueia install scripts por padrão. O Electron 45 baixa o binário sob demanda (`node node_modules/electron/install.js`). O `@lydell/node-pty` traz prebuilds N-API, sem compilação.

## Convenções

- TypeScript `strict`, sem `any`. Contratos de IPC definidos uma vez em `src/shared/` e usados dos dois lados.
- Segurança do Electron: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. O renderer não acessa Node; tudo passa pelo preload.
- Cores sempre via tokens do tema; nada de hex solto em componente.
- Atalhos sempre registrados por action ID; nunca `onKeyDown` com tecla hardcoded em componente.
- Cada atalho implementado ganha um teste que carrega o XML real do keymap e verifica o binding.

## Roadmap do MVP (ordem)

1. ✅ Shell da janela com layout Islands Dark: árvore de projeto, abas, editor Monaco, status bar
2. ✅ Engine de keymap lendo os XMLs do IntelliJ
3. ✅ Terminal embutido com `claude` por projeto
4. ✅ Bridge IDE ↔ Claude Code (diffs, seleção, diagnostics)
5. ✅ LSP de JS/TS (diagnostics → Problems e `getDiagnostics` do bridge, ⌘B, hover, completion, Structure) e ESLint do projeto
6. ✅ LSP de Java/Kotlin. O jdtls traz erros e ⌘B, mesmo sem build tool. O kotlin-lsp só analisa projetos Gradle/Maven; sem eles, Structure funciona e o aviso aparece em Notifications.
7. ✅ Run/Stop e run configurations editáveis (Spring Boot, Maven, npm, Shell, Gradle, JUnit), compatíveis com `.run/*.run.xml` do IntelliJ e importando o `workspace.xml`; tool window Maven com árvore de dependências.
8. ✅ Painel Git: tool window Commit com checkboxes, diff HEAD ↔ Local, commit parcial com `git commit --only`, Commit and Push (define o upstream no primeiro push), cores `FILESTATUS_*` na árvore e nas abas, e atualização quando o agente commita (o watcher deixa passar `.git/index`, `HEAD` e `refs/heads`). Atalhos: `CheckinProject` ⌘K, `Vcs.Push` ⇧⌘K, `Diff.ShowDiff` ⌘D, ⌘⏎ (`Commit.Execute`).
   - **Rollback** (`ChangesView.Revert` ⌥⌘Z, também na toolbar do Commit): diálogo "Rollback Changes" com os arquivos do contexto (seleção no Commit, arquivo do editor ou todos). Modificados e deletados voltam ao HEAD (`git restore --source=HEAD --staged --worktree`); adicionados saem do índice e, com "Delete local copies of the added files", do disco; renomeações são desfeitas. Edições não salvas desses arquivos são descartadas, como no IntelliJ.
   - **Log** (tool window Version Control, título "Git", ⌘9): commits em `--date-order` de todos os refs, paginados de 300 em 300, com labels de branch/tag e filtros de texto ou hash (`Vcs.Log.FocusTextFilter` ⌘L), branch e usuário. À direita, os arquivos do commit (duplo clique, Enter ou ⌘D abrem o diff `<hash>^` ↔ `<hash>`, somente leitura) e a mensagem. `Vcs.CopyRevisionNumberAction` ⌥⇧⌘C copia o hash. `Vcs.ShowTabbedFileHistory` ("Show History") filtra pelo arquivo ativo. Falta o grafo de branches.
   - **Branches** (`Git.Branches`, sem atalho no macOS): o widget de branch da barra superior abre o popup com Commit/Push, branches locais (a atual primeiro, com upstream e ↑↓) e remotas. Enter faz checkout; numa remota, cria a branch local que a acompanha (ou usa a local de mesmo nome). Um nome digitado que não existe vira "Create new branch '<nome>'" (`git checkout -b`). O widget acompanha o `gitState`, então checkouts do agente aparecem.
   - A árvore do projeto esconde a lista padrão "Ignored files and folders" do IntelliJ (`.git`, `.DS_Store`, `__pycache__`…).
9. ✅ Multi-projeto: janelas de projeto e abas de projeto, como o IntelliJ no macOS com as janelas mescladas. Com dois ou mais projetos numa janela, uma barra de abas abaixo da toolbar (`workbench/ProjectTabs.tsx`) mostra "projeto – arquivo ativo", com × e clique do meio para fechar. Cada aba é um projeto completo: abas de editor, layout das tool windows, arquivos recentes, terminais (com o seu `claude`), execuções e LSPs próprios. O widget de projeto abre o popup Projects, que lista as abas, os projetos de outras janelas, os recentes (AnyCode + `recentProjects.xml` de todas as IDEs JetBrains instaladas), "Open…" e aceita um caminho digitado. Atalhos: `NextProjectWindow` ⌥⌘\`, `PreviousProjectWindow` ⇧⌥⌘\`, `CloseProject`, `$LRU`, `OpenFile`. Abrir um projeto com outro já aberto (recentes, caminho digitado, "Open…") pergunta: "New Tab" (padrão, Enter), "New Window" ou "This Window" (substitui o projeto atual). Um projeto aberto em outra janela não abre de novo: aquela janela vem para frente (`project:focusIfOpen`).
   - **Merge All Project Windows** (`MergeAllWindowsAction`, o ID do IntelliJ) traz os projetos das outras janelas como abas desta; **Move Tab to New Window** (`AnyCode.MoveTabToNewWindow`) leva a aba atual para uma janela nova. Os terminais do projeto recomeçam na janela de destino, e o `claude` roda com `--continue` (com fallback para `claude` se não houver conversa), retomando a conversa daquela pasta. Não usamos as abas nativas do macOS porque elas exigem a barra de título nativa (o VS Code também força isso).
   - **Janelas** (`src/main/index.ts`, `ProjectWindow`): cada janela tem seus projetos, o atual e **o próprio bridge** (porta e lockfile), cujo `workspaceFolders` são só os projetos dela. Assim o `claude` de cada janela abre diffs e lê a seleção daquela janela. PTYs, LSPs e o watcher respondem à janela que os iniciou (`handleFrom`/`onSendFrom` em `ipc.ts`). Um LSP cujo projeto muda de janela é reiniciado. Fechar uma janela mata os terminais e os LSPs dela e remove o lockfile.
   - `NextProjectWindow` cicla as abas de projeto; com uma só, passa para a próxima janela.
   - A sessão (`open-projects.json`, `{ windows: [{ roots, current }] }`, que também lê o formato antigo `{ roots, current }`) reabre todas as janelas. Fechar a última janela (ou sair) a mantém na sessão; aberto pelo Dock (cwd `/`), nunca abre `/` como projeto.

10. ✅ Menu de contexto da árvore, Scratch Files e debugger (Java via java-debug, Node via js-debug). Ver as seções próprias.

Pendências conhecidas: grafo de branches no Log; edição de keymap; breakpoints em Kotlin, watches e breakpoints condicionais. Plano detalhado e estado de cada uma em `docs/roadmap-pendencias.md`.
