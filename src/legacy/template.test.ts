import { describe, expect, it } from "vitest";

import { legacyTemplate } from "./template";

const navigationItems = [
  "Visão Geral",
  "Apontamentos",
  "Demandas",
  "Recursos",
  "Bloqueio de Janela",
  "Horas Extras (HE)",
  "Janelas Livres",
  "Lançamentos",
  "Execução diária",
  "Sincronização de BD",
];

const criticalElementIds = [
  "tabs",
  "app",
  "userName",
  "eventFolderHeaderStatus",
  "userModal",
  "mergeModal",
  "dayModal",
  "demandEditModal",
  "resourceEditModal",
  "heModal",
];

describe("legacyTemplate", () => {
  it("preserva as dez áreas de navegação do ORIZON", () => {
    const navigation = legacyTemplate.match(/<nav id="tabs">([\s\S]*?)<\/nav>/)?.[1] ?? "";

    expect(navigation.match(/<button/g)).toHaveLength(10);
    for (const item of navigationItems) expect(navigation).toContain(item);
  });

  it("preserva os pontos de integração usados pelo motor funcional", () => {
    for (const id of criticalElementIds) expect(legacyTemplate).toContain(`id="${id}"`);
  });

  it("mantém a identidade visual e a estrutura semântica principal", () => {
    expect(legacyTemplate).toContain("./icons/orizon-logo.png");
    expect(legacyTemplate).toContain("<header>");
    expect(legacyTemplate).toContain('<main id="app">');
    expect(legacyTemplate).toContain('<footer class="appFooter">');
  });
});
