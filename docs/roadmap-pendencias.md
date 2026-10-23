# Pendências do roadmap

Estado em 2026-10-23. O MVP (itens 1–9 do roadmap no `CLAUDE.md`) está pronto, e os itens 1–5 abaixo também. Do item 6 falta só a assinatura com Developer ID, que depende do usuário. Este arquivo lista o que falta, na ordem sugerida, com o plano e os dados já levantados para quem continuar em outra sessão. Ao concluir um item, marque-o aqui e atualize o `CLAUDE.md`.

Regras que valem para todos os itens (detalhes no `CLAUDE.md`):
- Nenhuma janela na tela: verificação só com `ANYCODE_HEADLESS=1` (E2E e `npm run screenshot`).
- Action IDs e atalhos iguais aos do IntelliJ; cada atalho novo ganha teste carregando o XML real do keymap.
- Antes de encerrar: `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e`.
- Commit só quando o usuário pedir.

Os atalhos abaixo vêm de `reference/jetbrains/derived/actions-catalog.mac.json` (chave `actions`).

## 1. Git: Rollback

- [x] **Feito.** Ação `ChangesView.Revert` ("Rollback…", ⌥⌘Z) na tool window Commit, sobre os arquivos marcados/selecionados.
- Diálogo de confirmação como o do IntelliJ: lista dos arquivos e a opção "Delete local copies of the added files".
- Main (`src/main/git.ts`), novo `git:rollback(root, paths, deleteAdded)`:
  - modificados/deletados: `git restore --staged --worktree --source=HEAD -- <paths>`;
  - renomeados: restaurar a origem e remover o destino do índice;
  - adicionados (staged, fora do HEAD): `git rm --cached`, e apagar o arquivo se `deleteAdded`;
  - repositório sem commit: só `git rm --cached`;
  - arquivos unversioned não entram no Rollback (no IntelliJ eles são apagados com Delete).
- Conferir se os documentos abertos no Monaco recarregam do disco depois do rollback (o fluxo de `fs:changed` em `editor/documents.ts`). Documento sujo: perguntar ou descartar, como o IntelliJ.
- Opcional: `Vcs.RollbackChangedLines` (⌥⌘Z no editor) reverte o trecho sob o cursor. Depende de marcadores de alteração no gutter, que ainda não existem.

## 2. Git: Log (tool window Version Control)

- [x] **Feito** (sem o grafo de branches). Tool window `Version Control` (stripe inferior, `ActivateVersionControlToolWindow` ⌘9), aba Log.
- Lista de commits via `git log --date-order --format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e -n 500 [--all]`, paginada sob demanda; colunas assunto + refs, autor, data.
- Filtros: texto (`Vcs.Log.FocusTextFilter` ⌘L), branch, autor.
- Painel de detalhes do commit selecionado: mensagem completa, hash, autor/data e arquivos alterados (`git show --name-status --format= <hash>`, com `-M` para renames).
- Duplo clique ou ⌘D (`Diff.ShowDiff`) num arquivo: diff `<hash>^` ↔ `<hash>`, os dois lados somente leitura.
  - Generalizar `VcsDiffHost`/`EditorTab` (`kind: 'vcs-diff'`) com `leftRevision`/`rightRevision`. Ausente = arquivo local.
  - Novo IPC `git:show(root, revision, path)`: conteúdo ou `null`.
  - Commit raiz: usar a árvore vazia como lado esquerdo.
- `Vcs.CopyRevisionNumberAction` (⌥⇧⌘C) copia o hash. `Vcs.ShowTabbedFileHistory` ("Show History") abre o log filtrado por arquivo (`git log --follow -- <path>`).
- O grafo de branches fica para depois; começar com a lista linear em `--date-order`.

## 3. JUnit nas run configurations

- [x] **Feito.** Novo tipo `junit` em `src/shared/runConfigurations.ts`: escopo (all in module / package / class / method), módulo, classe, método, VM options, env e diretório.
- Execução:
  - Maven: `mvn -pl <módulo> -am test -Dsurefire.failIfNoSpecifiedTests=false -Dtest=<Classe>[#<método>]`;
  - Gradle: `gradle :<módulo>:test --tests <Classe>[.<método>]`.
- Importar o tipo `JUnit` do `.run/*.run.xml` e do `RunManager` do `workspace.xml` (`src/main/runConfigurations/intellij.ts`), incluindo as temporárias? Hoje as temporárias são ignoradas. As do usuário são quase todas temporárias, por isso o valor está em criar a partir do código.
- CodeLens/gutter "▶ Run" em classes e métodos `@Test` de `.java`/`.kt`, no mesmo molde do `markdown/markdownSupport.ts`. Detecção por regex ou `documentSymbol` do LSP. `RunClass` (⌃⇧R) roda o teste sob o cursor.
- Saída no Run como hoje (PTY). Árvore de resultados de teste fica fora; no máximo, ler o resumo do Surefire.

## 4. ESLint no TS

- [x] **Feito.** Diagnostics do ESLint do **próprio projeto** (`node_modules/eslint`), sem embutir uma versão.
- Um processo filho por raiz (`child_process.fork` com `ELECTRON_RUN_AS_NODE=1`, nova entrada no build do main em `electron.vite.config.ts`). Ele carrega o ESLint com `createRequire(<root>/package.json)` e responde `lintText(text, { filePath })`. Não carregar código do projeto no processo main.
- Renderer: ao abrir e ao editar (debounce ~500 ms) arquivos JS/TS, chama `eslint:lint` e grava markers com owner `eslint`. Eles aparecem em Problems e no `getDiagnostics` do bridge.
- "Fix ESLint Problems": `lintText` com `fix: true` aplica o `output` como edição desfazível. A ação do IntelliJ vem de plugin proprietário (não está no catálogo community), então use ID próprio `AnyCode.ESLintFix`, sem atalho padrão.
- Projeto sem ESLint ou sem config: silencioso, com um aviso único em Notifications só se houver config e o carregamento falhar.

## 5. Tela de Settings

- [x] **Feito.** Diálogo `ShowSettings` (⌘,), com árvore à esquerda, painel à direita e busca. Persistência em `<userData>/settings.json`, com IPC tipado em `src/shared/`.
- Seções iniciais:
  - **Editor › Font:** tamanho e altura de linha (hoje fixos em 13/20 no Monaco e no diff).
  - **Keymap:** tabela somente leitura de ações e atalhos, com busca por nome e por atalho. Edição de keymap fica para depois.
  - **Tools › Terminal:** shell e comando do agente (`claude`, hoje via `ANYCODE_AGENT_COMMAND`).
  - **Languages & Frameworks:** status dos servidores (TS/jdtls/kotlin-lsp) e o comando de instalação (`scripts/install-language-servers.mjs`); ESLint ligado/desligado.
  - **Markdown:** layout padrão do preview.

## 6. Empacotamento como `.app` assinado

- [x] **Feito com assinatura ad-hoc** (`npm run package`, detalhes no `CLAUDE.md`, seção Empacotamento). electron-builder gerando `AnyCode.app`/`.dmg` arm64.
- [ ] **Falta:** assinatura com Developer ID e notarização. Hoje não há certificado no Keychain (`security find-identity` → 0).
- Itens a resolver:
  - `asarUnpack` para `@lydell/node-pty` (binário N-API) e `typescript-native` (binário do tsgo);
  - `resources/intellij-community` como `extraResources`, revisando como o main resolve o caminho em produção (`app.isPackaged` / `process.resourcesPath`);
  - ícone próprio do AnyCode (sem marcas da JetBrains): gerar o PNG 1024 em modo headless e converter com `iconutil`;
  - `THIRD_PARTY_NOTICES.md` incluído no bundle.
- **Assinatura e notarização dependem do usuário:** é preciso um certificado "Developer ID Application" no Keychain (`security find-identity -v -p codesigning`) e credenciais de notarização (perfil `notarytool`). Sem eles, gerar o `.app` com assinatura ad-hoc e **perguntar** antes de qualquer passo com credenciais.
