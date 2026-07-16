# ORIZON

Aplicação de planejamento e capacidade migrada para Next.js e TypeScript, preservando os fluxos, o armazenamento local, a sincronização por arquivos e a publicação em `https://basilioath-collab.github.io/proto/`.

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

- `src/app`: shell estático e metadados do Next.js.
- `src/client.ts`: inicialização TypeScript compilada como um bundle adiado e cacheável.
- `src/domain`: contratos TypeScript do estado ORIZON.
- `src/legacy`: template e motor funcional preservado durante a migração.
- `src/lib`: busca indexada e integração PWA.
- `src/service-worker.ts`: fonte TypeScript do service worker compilado no build.

O código monolítico original foi separado em HTML estático, CSS e TypeScript. A busca normalizada mantém cache por registro, e o shell é renderizado antes do carregamento do motor funcional.
