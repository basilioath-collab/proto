import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrizonApp } from "./orizon-app";

const criticalElementIds = [
  "app",
  "tabs",
  "userName",
  "avatar",
  "eventFolderHeaderStatus",
  "notifyBell",
  "dayModal",
  "demandEditModal",
  "demandStatusModal",
  "demandStagesModal",
  "resourceEditModal",
  "heModal",
  "userModal",
  "mergeModal",
  "toast",
];

describe("OrizonApp", () => {
  it("renders the application shell and integration contracts with React", () => {
    const html = renderToStaticMarkup(<OrizonApp />);

    for (const id of criticalElementIds) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Planning workspace");
    expect(html).toContain("Alternar modo claro ou escuro");
    expect(html).toContain('aria-label="Recolher menu lateral"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("app.js");
  });

  it("keeps every operational dialog available to the existing engine", () => {
    const html = renderToStaticMarkup(<OrizonApp />);

    expect(html.match(/<dialog/g)).toHaveLength(12);
    expect(html).toContain('data-action="he-save"');
    expect(html).toContain('id="btnUserSelectEventFolder"');
  });
});
