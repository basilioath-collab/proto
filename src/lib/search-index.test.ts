import { describe, expect, it } from "vitest";

import { normalizeSearchText, SearchTextCache } from "./search-index";

describe("normalizeSearchText", () => {
  it("normaliza acentos e caixa sem perder os termos", () => {
    expect(normalizeSearchText("  Execução DIÁRIA  ")).toBe("execucao diaria");
  });
});

describe("SearchTextCache", () => {
  it("encontra por título ou status", () => {
    const cache = new SearchTextCache<{ titulo: string; status: string }>();
    const demand = { titulo: "Revisão elétrica", status: "Em andamento" };

    expect(cache.matches(demand, [demand.titulo, demand.status], "eletrica")).toBe(true);
    expect(cache.matches(demand, [demand.titulo, demand.status], "andamento")).toBe(true);
    expect(cache.matches(demand, [demand.titulo, demand.status], "concluida")).toBe(false);
  });

  it("recalcula quando um registro é alterado no mesmo objeto", () => {
    const cache = new SearchTextCache<{ titulo: string }>();
    const demand = { titulo: "Planejamento" };

    expect(cache.matches(demand, [demand.titulo], "planejamento")).toBe(true);
    demand.titulo = "Execução";
    expect(cache.matches(demand, [demand.titulo], "execucao")).toBe(true);
    expect(cache.matches(demand, [demand.titulo], "planejamento")).toBe(false);
  });
});
