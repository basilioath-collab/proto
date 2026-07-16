# ORIZON

Aplicação de planejamento e capacidade em React, Next.js e TypeScript. Mantém os fluxos de armazenamento local, sincronização por arquivos e a publicação em `https://basilioath-collab.github.io/proto/`.

## Desenvolvimento

```bash
npm install
npm run dev
```

O ambiente local usa o mesmo caminho da publicação: `http://localhost:3000/proto/`.

## Validação e build

```bash
npm run check
npm run build
```

O build estático é gerado em `out/`. O workflow de GitHub Pages valida tipos, lint e testes antes de publicar a branch `main`.

## Arquitetura

- `src/app`: rotas, metadados, tokens visuais e temas do Next.js.
- `src/components`: shell React responsivo, navegação, cabeçalho e diálogos operacionais.
- `src/domain`: contratos TypeScript do estado ORIZON.
- `src/legacy/app.ts`: motor funcional compatível, isolado enquanto as regras são extraídas para módulos tipados.
- `src/lib`: busca indexada e integração PWA.
- `src/service-worker.ts`: fonte TypeScript do service worker compilado no build.

O shell e os diálogos são renderizados diretamente pelo React, sem injeção de template ou bundle paralelo. O tema claro/escuro é persistido no navegador e a interface se adapta de desktop a celular. A busca normalizada mantém cache por registro.
