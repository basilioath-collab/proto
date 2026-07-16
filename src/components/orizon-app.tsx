"use client";

import { useEffect, useState } from "react";

import { bootstrapOrizon } from "@/legacy/app";
import { registerOrizonServiceWorker } from "@/lib/register-service-worker";

declare global {
  interface Window {
    __orizonBootstrapped?: boolean;
  }
}

type IconName =
  | "bell"
  | "chevron"
  | "database"
  | "moon"
  | "search"
  | "sun";

const iconPaths: Record<IconName, React.ReactNode> = {
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  moon: <path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14Z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
    </>
  ),
};

function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="uiIcon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {iconPaths[name]}
      </g>
    </svg>
  );
}

function ThemeToggle() {
  const toggleTheme = () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("orizon-theme", nextTheme);
  };

  return (
    <button
      aria-label="Alternar modo claro ou escuro"
      className="shellIconButton themeToggle"
      onClick={toggleTheme}
      title="Alternar tema"
      type="button"
    >
      <span className="themeIcon themeIconDark"><Icon name="moon" /></span>
      <span className="themeIcon themeIconLight"><Icon name="sun" /></span>
    </button>
  );
}

function CurrentSection() {
  const [section, setSection] = useState("Visão Geral");

  useEffect(() => {
    const tabs = document.querySelector("#tabs");
    if (!tabs) return;

    const update = () => {
      const active = tabs.querySelector("button.active");
      if (active?.textContent) setSection(active.textContent.replace(/^[^\p{L}\p{N}]+/u, "").trim());
    };
    const observer = new MutationObserver(update);
    observer.observe(tabs, { attributes: true, childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sectionHeading">
      <span className="eyebrow">Workspace de planejamento</span>
      <div className="sectionTitleRow">
        <h1>{section}</h1>
        <span className="liveBadge"><span /> Atualizado em tempo real</span>
      </div>
    </div>
  );
}

function QuickFind() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      focusCurrentSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <button className="quickFind" onClick={focusCurrentSearch} title="Buscar nesta tela (/)" type="button">
      <Icon name="search" size={17} />
      <span>Buscar</span>
      <kbd>/</kbd>
    </button>
  );
}

function focusCurrentSearch() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      "#app input[type='search'], #app input[placeholder*='Pesquisar'], #app input[placeholder*='pesquisar'], #app input[placeholder*='Digite']",
    ),
  );
  const target = candidates.find((input) => input.offsetParent !== null && !input.disabled);
  target?.focus();
}

function ModalFrame({
  bodyId,
  closeId,
  id,
  subId,
  titleId,
}: {
  bodyId: string;
  closeId: string;
  id: string;
  subId: string;
  titleId: string;
}) {
  return (
    <dialog className="modal" id={id}>
      <div className="modalCard">
        <div className="modalHd">
          <div>
            <div className="modalTitle" id={titleId} />
            <div className="modalSub" id={subId} />
          </div>
          <button aria-label="Fechar" className="btn ghost modalCloseBtn" id={closeId} type="button">×</button>
        </div>
        <div className="modalBd" id={bodyId} />
      </div>
    </dialog>
  );
}

function OvertimeDialogs() {
  return (
    <>
      <dialog className="modal" id="heModal">
        <div className="modalCard">
          <div className="modalHd">
            <div>
              <div className="modalTitle" id="heModalTitle">Adicionar hora extra</div>
              <div className="modalSub" id="heModalSub">Registre capacidade adicional com contexto e rastreabilidade.</div>
            </div>
            <button aria-label="Fechar" className="btn ghost modalCloseBtn" id="heModalClose" type="button">×</button>
          </div>
          <div className="modalBd">
            <div className="grid modalFormGrid">
              <div className="field fieldWide"><label htmlFor="heModalTitulo">Atividade</label><input id="heModalTitulo" placeholder="Título da atividade" /></div>
              <div className="field"><label htmlFor="heModalResource">Recurso</label><select id="heModalResource" /></div>
              <div className="field"><label htmlFor="heModalDate">Data</label><input id="heModalDate" type="date" /></div>
              <div className="field"><label htmlFor="heModalHours">Horas</label><input id="heModalHours" max="24" min="0" step="0.5" type="number" /></div>
              <div className="field"><label htmlFor="heModalPredio">Prédio</label><input id="heModalPredio" placeholder="Ex.: Prédio A" /></div>
              <div className="field"><label htmlFor="heModalFocal">Focal</label><input id="heModalFocal" placeholder="Responsável ou focal" /></div>
              <div className="field">
                <label htmlFor="heModalPrioridade">Prioridade</label>
                <select id="heModalPrioridade">
                  <option>Baixa</option><option>Média</option><option>Alta</option><option>Crítica</option>
                </select>
              </div>
              <div className="field fieldWide"><label htmlFor="heModalMotivo">Motivo *</label><input id="heModalMotivo" placeholder="Descreva o motivo" /></div>
              <div className="field fieldWide"><label htmlFor="heModalObs">Observações</label><textarea id="heModalObs" placeholder="Observações complementares" /></div>
              <div className="row end fieldWide">
                <button className="btn" data-action="he-cancel" type="button">Cancelar</button>
                <button className="btn primary" data-action="he-save" type="button">Salvar HE</button>
              </div>
            </div>
          </div>
        </div>
      </dialog>

      <dialog className="modal" id="heConfirmModal">
        <div className="modalCard modalCardCompact">
          <div className="modalHd">
            <div><div className="modalTitle" id="heConfirmTitle">Confirmar exclusão</div><div className="modalSub" id="heConfirmSub">Esta ação não pode ser desfeita.</div></div>
            <button aria-label="Fechar" className="btn ghost modalCloseBtn" id="heConfirmClose" type="button">×</button>
          </div>
          <div className="modalBd">
            <div id="heConfirmBody" />
            <div className="row end modalActionsInline">
              <button className="btn" data-action="he-delete-cancel" type="button">Cancelar</button>
              <button className="btn danger" data-action="he-delete-confirm" type="button">Excluir HE</button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

function UserDialog() {
  return (
    <dialog className="modal" id="userModal">
      <div className="modalCard modalUserPremium">
        <div className="modalHd modalUserHd">
          <div><div className="modalTitle">Identificação do usuário</div><div className="modalSub">Conecte a pasta ORIZONData e escolha sua identidade de trabalho.</div></div>
          <div className="modalHeaderActions">
            <ThemeToggle />
            <button aria-label="Fechar" className="btn ghost modalCloseBtn" id="userModalClose" type="button">×</button>
          </div>
        </div>
        <div className="userWarningBox userWarningCompact" id="userWarningBox"><span className="pill">Obrigatório</span><div>Selecione a pasta de eventos para reutilizar usuários cadastrados e evitar duplicidade.</div></div>
        <div className="userWarningBox userWarningCompact" id="userLocalWarning" style={{ display: "none" }}><span className="pill">Atenção</span><div>Usuário local não encontrado na pasta de eventos selecionada.</div></div>
        <div className="formStack">
          <div className="userFlowBlock">
            <div className="rowBetween"><label className="lbl">1. Pasta de eventos</label><button className="btn small" id="btnUserSelectEventFolder" type="button">Selecionar ORIZONData</button></div>
            <div className="hint tiny" id="userFolderStatus">Nenhuma pasta selecionada.</div>
          </div>
          <div className="userFlowBlock">
            <label className="lbl" htmlFor="userExistingSelect">2. Usuário existente</label>
            <select disabled id="userExistingSelect"><option>Selecione a pasta para carregar usuários</option></select>
            <div className="hint tiny" id="userExistingHint">Os usuários serão carregados a partir dos eventos e snapshots.</div>
          </div>
          <div className="userFlowBlock">
            <label className="lbl">3. Criar novo usuário</label>
            <label className="checkLabel"><input disabled id="userCreateMode" type="checkbox" /> Criar novo usuário</label>
            <input disabled id="userModalName" maxLength={30} placeholder="Ex.: Arthur Basílio" />
          </div>
          <div className="userFlowBlock">
            <div className="rowBetween"><label className="lbl" htmlFor="userModalId">4. ID automático</label><button className="btn ghost small" id="btnCopyUserId" type="button">Copiar</button></div>
            <input disabled id="userModalId" />
            <div className="hint tiny">O ID identifica suas ações e fica salvo apenas neste navegador.</div>
          </div>
        </div>
        <div className="modalActions"><button className="btn ghost" id="userModalCancel" type="button">Agora não</button><button className="btn primary" id="userModalSave" type="button">Continuar</button></div>
      </div>
    </dialog>
  );
}

function MergeDialog() {
  return (
    <dialog className="modal" id="mergeModal">
      <div className="modalCard modalCardCompact">
        <div className="modalHd"><div><div className="modalTitle">Conflito de versão detectado</div><div className="modalSub" id="mergeModalSub">O banco foi alterado por outra sessão.</div></div></div>
        <div className="modalBd">
          <div className="hint tiny" id="mergeModalStats" style={{ display: "none" }} />
          <div className="grid mergeActions" id="mergeModalActions">
            <button className="btn primary decisionBtn" id="mergeModalMerge" type="button"><strong>Mesclar alterações</strong><span>Une suas alterações com a versão mais nova, sem perda de dados.</span></button>
            <button className="btn decisionBtn" id="mergeModalReload" type="button"><strong>Recarregar banco</strong><span>Descarta alterações locais e abre a versão mais recente.</span></button>
            <button className="btn decisionBtn" id="mergeModalCopy" type="button"><strong>Salvar cópia local</strong><span>Exporta suas alterações para revisão, sem alterar o arquivo compartilhado.</span></button>
            <button className="btn ghost" id="mergeModalCancel" type="button">Cancelar</button>
          </div>
          <div className="tiny muted" id="mergeModalProgress" style={{ display: "none" }}>Processando mesclagem...</div>
          <div id="mergeModalResult" style={{ display: "none" }} />
        </div>
      </div>
    </dialog>
  );
}

function OrizonDialogs() {
  return (
    <>
      <ModalFrame bodyId="dayModalBody" closeId="dayModalClose" id="dayModal" subId="dayModalSub" titleId="dayModalTitle" />
      <ModalFrame bodyId="donutModalBody" closeId="donutModalClose" id="donutModal" subId="donutModalSub" titleId="donutModalTitle" />
      <ModalFrame bodyId="monthModalBody" closeId="monthModalClose" id="monthModal" subId="monthModalSub" titleId="monthModalTitle" />
      <ModalFrame bodyId="demandEditModalBody" closeId="demandEditModalClose" id="demandEditModal" subId="demandEditModalSub" titleId="demandEditModalTitle" />
      <ModalFrame bodyId="demandStatusModalBody" closeId="demandStatusModalClose" id="demandStatusModal" subId="demandStatusModalSub" titleId="demandStatusModalTitle" />
      <ModalFrame bodyId="demandReprogramModalBody" closeId="demandReprogramModalClose" id="demandReprogramModal" subId="demandReprogramModalSub" titleId="demandReprogramModalTitle" />
      <ModalFrame bodyId="demandStagesModalBody" closeId="demandStagesModalClose" id="demandStagesModal" subId="demandStagesModalSub" titleId="demandStagesModalTitle" />
      <ModalFrame bodyId="resourceEditModalBody" closeId="resourceEditModalClose" id="resourceEditModal" subId="resourceEditModalSub" titleId="resourceEditModalTitle" />
      <OvertimeDialogs />
      <UserDialog />
      <MergeDialog />
    </>
  );
}

export function OrizonApp() {
  useEffect(() => {
    if (window.__orizonBootstrapped) return;
    window.__orizonBootstrapped = true;
    try {
      bootstrapOrizon();
      void registerOrizonServiceWorker();
    } catch (error) {
      window.__orizonBootstrapped = false;
      throw error;
    }
  }, []);

  return (
    <div id="orizon-root">
      <div className="appShell">
        <aside className="sidebar">
          <div className="brandWrap">
            <div aria-hidden="true" className="brandGlyph"><span /></div>
            <div className="brandLockup"><strong>ORIZON</strong><span>Planning workspace</span></div>
          </div>
          <div className="navCaption">Navegação</div>
          <nav aria-label="Navegação principal" id="tabs" />
          <div className="sidebarFooter">
            <button className="eventFolderStatus disconnected" id="eventFolderHeaderStatus" title="Conectar pasta ORIZONData" type="button">
              <span className="eventFolderIcon"><Icon name="database" size={17} /></span>
              <span className="eventFolderCopy"><small>Base de eventos</small><span className="eventFolderText">Conectar pasta</span></span>
              <Icon name="chevron" size={15} />
            </button>
            <div className="appVersion"><span /> ORIZON v0.3</div>
          </div>
        </aside>

        <section className="workspace">
          <header className="topbar">
            <CurrentSection />
            <div className="topbarActions">
              <QuickFind />
              <ThemeToggle />
              <div className="notifyWrap" id="notifyWrap">
                <button aria-expanded="false" aria-label="Notificações" className="shellIconButton notifyBell" id="notifyBell" title="Notificações" type="button">
                  <Icon name="bell" />
                  <span className="notifyBadge" id="notifyBadge">0</span>
                </button>
                <div aria-label="Atividades atribuídas" className="notifyPanel" id="notifyPanel" role="menu" />
              </div>
              <div className="topbarDivider" />
              <div className="userBox">
                <div className="meta"><label htmlFor="userName">Usuário ativo</label><input id="userName" maxLength={30} placeholder="Definir usuário" /></div>
                <div aria-label="Abrir perfil" className="avatar" id="avatar" role="button" tabIndex={0}>A</div>
              </div>
            </div>
            <div className="userReqBanner" id="userReqBanner">
              <span className="userReqIcon">!</span>
              <div><strong>Defina seu usuário</strong><span>Necessário para registrar autoria e evitar conflitos.</span></div>
              <button className="btn small primary" id="btnOpenUserModal" type="button">Definir agora</button>
            </div>
          </header>
          <main className="workspaceContent" id="app">
            <div className="appLoading"><span className="loadingSpinner" /><div><strong>Preparando seu workspace</strong><span>Carregando planejamento e indicadores...</span></div></div>
          </main>
        </section>
      </div>
      <OrizonDialogs />
      <div aria-live="polite" id="toast" />
    </div>
  );
}
