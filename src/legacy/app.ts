// @ts-nocheck -- parity layer isolated while domain modules are progressively typed.
import { normalizeSearchText as normalizeIndexedSearchText, SearchTextCache } from "../lib/search-index";

// ORIZON Core Clean v0.2.3 ? Métricas planejado x executado por demanda.

export function bootstrapOrizon(): void {
  // ----------------------
  // State + helpers
  // ----------------------
  const STORAGE_KEY = 'resource_planner_state';
  const USER_KEY = 'resource_planner_user';
  const DB_PATH_KEY = 'capview_db_network_path';
  const DB_META_KEY = 'capview_db_meta';
  const DB_BASELINE_KEY = 'capview_db_baseline';
  const APP_SCHEMA_VERSION = '0.2.3-demand-metrics';
  const HOURS_PER_DAY = 9; // Interno: 9h/dia (sexta-feira conta 8h nos cálculos diários)
  const HOURS_PER_DAY_THIRD = 8; // Terceiro: 8h/dia
  const PAGE_SIZE = 10; // itens por página (Demandas e Recursos)
  const CALENDAR_PAGE_SIZE = 10; // itens por página (Bloqueios e Feriados)
  const DASH_PER_RESOURCE_PAGE_SIZE = 5; // Dashboard: Por Recurso (mês)
  const DASH_SHEET_PAGE_SIZE = 10; // Visão Geral: linhas por página
  const MODAL_DEMANDS_PAGE_SIZE = 10; // Modais com lista de demandas: 10 por página
  const INTERNAL_ACTIVITY_PAGE_SIZE = 10; // Atividades internas: 10 por página

  const qs = (sel, el=document) => el.querySelector(sel);
  const qsa = (sel, el=document) => [...el.querySelectorAll(sel)];

  // Keep the background blur consistent whenever any <dialog> is open.
  const syncModalBlur = () => {
    const anyOpen = !!document.querySelector('dialog[open]');
    document.body.classList.toggle('modal-open', anyOpen);
  };

  const openDialog = (dlg) => {
    if (!dlg) return;
    try { dlg.showModal(); } catch { dlg.setAttribute('open',''); }
    syncModalBlur();
  };

  const closeDialog = (dlg) => {
    if (!dlg) return;
    try { dlg.close(); } catch { dlg.removeAttribute('open'); }
    syncModalBlur();
  };

  // Backwards-compat helper (algumas partes usavam uid())
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

  // ----------------------
  // HE (Hora Extra) Modals
  // ----------------------
  let hePendingDeleteId = null;

  const fillHeResourceOptions = (sel) => {
    if (!sel) return;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value:'__ALL__' }, ['Todos os recursos']));
    for (const r of (state.resources||[])) sel.appendChild(el('option', { value:r.id }, [r.nome]));
  };

  const openHeModal = (prefill={}) => {
    const dlg = qs('#heModal');
    const sel = qs('#heModalResource');
    const dateInp = qs('#heModalDate');
    const hoursInp = qs('#heModalHours');
    const motivoInp = qs('#heModalMotivo');
    const tituloInp = qs('#heModalTitulo');
    const predioInp = qs('#heModalPredio');
    const focalInp = qs('#heModalFocal');
    const prioridadeInp = qs('#heModalPrioridade');
    const obsInp = qs('#heModalObs');

    fillHeResourceOptions(sel);
    sel.value = String(prefill.resourceId || '__ALL__');
    dateInp.value = String(prefill.date || formatDate(new Date()));
    hoursInp.value = String(prefill.horas ?? 9);
    motivoInp.value = String(prefill.motivo || '');
    if (tituloInp) tituloInp.value = String(prefill.titulo || prefill.atividade || '');
    if (predioInp) predioInp.value = String(prefill.predio || '');
    if (focalInp) focalInp.value = String(prefill.focal || '');
    if (prioridadeInp) prioridadeInp.value = String(prefill.prioridade || 'Média');
    if (obsInp) obsInp.value = String(prefill.observacoes || '');

    openDialog(dlg);
    setTimeout(() => { try{ (tituloInp || motivoInp).focus(); }catch{} }, 0);
  };

  const openHeConfirm = (ot) => {
    const dlg = qs('#heConfirmModal');
    const body = qs('#heConfirmBody');
    const rid = ot?.resourceId || '__ALL__';
    const rname = rid === '__ALL__' ? 'Todos' : (state.resources||[]).find(r=>r.id===rid)?.nome || rid;
    body.innerHTML = '';
    body.appendChild(el('div', {}, [
      'Você confirma excluir esta HE?'
    ]));
    body.appendChild(el('div', { class:'tiny muted', style:'margin-top:8px' }, [
      el('div', {}, ['Data: ', el('span', { class:'mono' }, [formatDateBR(ot?.date)])]),
      el('div', {}, ['Recurso: ', rname]),
      el('div', {}, ['Horas: ', el('span', { class:'mono' }, [`${Number(ot?.horas||0).toFixed(1)}h`])]),
      el('div', {}, ['Atividade: ', String(ot?.titulo || ot?.atividade || '-')]),
      el('div', {}, ['Motivo: ', String(ot?.motivo||'')]),
    ]));
    openDialog(dlg);
  };

  const closeHeModal = () => closeDialog(qs('#heModal'));
  const closeHeConfirm = () => { hePendingDeleteId = null; closeDialog(qs('#heConfirmModal')); };

  const safeUUID = () => {
    try { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : null; } catch { return null; }
  };

  const slugify = (s) => String(s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/(^-|-$)/g,'')
    .slice(0, 40);

  

  // Preview-only identity (does NOT persist). Used while typing in the modal.
  const previewUserIdentity = (displayName) => {
    const nm = String(displayName||'').trim();
    if (!nm) return { displayName:'', userId:'' };
    const slug = slugify(nm) || 'user';
    const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
    return { displayName: nm, userId: `${slug}__${suffix}` };
  };

// Compat: uid() existed in older builds (definido acima)

  let userName = '';
  let userId = '';

  const loadUserIdentity = () => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return { displayName:'', userId:'' };
    try {
      const obj = JSON.parse(raw);
      // support legacy shapes and auto-generate a stable userId when missing
      if (typeof obj === 'string') {
        const nm = String(obj||'').trim();
        return ensureUserIdentity(nm);
      }
      if (obj && typeof obj === 'object') {
        const nm = String(obj.displayName || obj.name || obj.userName || '').trim();
        let id = String(obj.userId || obj.id || '').trim();
        if (nm && !id) {
          const slug = slugify(nm) || 'user';
          const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
          id = `${slug}__${suffix}`;
          localStorage.setItem(USER_KEY, JSON.stringify({ displayName: nm, userId: id }));
        }
        return { displayName: nm, userId: id };
      }
    } catch {
      // legacy: raw string with the name
      const nm = String(raw||'').trim();
      if (!nm) return { displayName:'', userId:'' };
      const slug = slugify(nm) || 'user';
      const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
      const id = `${slug}__${suffix}`;
      const u = { displayName: nm, userId: id };
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      return u;
    }
    return { displayName:'', userId:'' };
  };

  const persistUserIdentity = (u) => {
    localStorage.setItem(USER_KEY, JSON.stringify({ displayName:u.displayName||'', userId:u.userId||'' }));
  };

  const ensureUserIdentity = (displayName) => {
    const nm = String(displayName||'').trim();
    if (!nm) return { displayName:'', userId:'' };
    let existing = loadUserIdentity();
    // keep the same userId on this PC/browser once created
    if (!existing.userId) {
      const slug = slugify(nm) || 'user';
      const suffix = (safeUUID()||uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
      existing.userId = `${slug}__${suffix}`;
    }
    existing.displayName = nm;
    persistUserIdentity(existing);
    return existing;
  };

  const idPrefix = () => (userId && userName) ? userId : 'unknown';

  // IDs prefixados por userId (com fallback) ? evita colisões na consolidação
  const generateId = (kind='id') => {
    const u = safeUUID() || uid();
    return `${idPrefix()}::${kind}::${u}`;
  };
  const normalizeLegacyIdKind = (id, fromKind='id', toKind='resource') => {
    const raw = String(id || '').trim();
    if (!raw) return raw;
    return raw.replace(`::${fromKind}::`, `::${toKind}::`);
  };

  const normalizedPersonName = (name) => String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g,' ');

  const ownerFromLegacyResourceId = (id) => {
    const raw = String(id || '').trim();
    const match = raw.match(/^(.+)::(?:resource|id)::/);
    const owner = String(match?.[1] || '').trim();
    if (!owner || owner === 'unknown' || owner.startsWith('sessao-local__')) return '';
    return owner;
  };

  const legacyOwnerFallbackForName = (name) => {
    const slug = slugify(name) || 'recurso';
    return `legacy-owner::${slug}`;
  };

  const isSyntheticLegacyOwnerId = (id) => {
    const raw = String(id || '').trim().toLowerCase();
    return raw.startsWith('legacy-owner::') || raw.startsWith('legacy-owner_') || raw.startsWith('legacy-owner-');
  };

  const isSyntheticLegacyOwnerEventFilename = (filename='') => {
    const base = String(filename || '').trim().replace(/\.json$/i, '').toLowerCase();
    return isSyntheticLegacyOwnerId(base);
  };

  const normalizeEventFilenameBaseToOwnerId = (filename='') =>
    String(filename || '').trim().replace(/\.json$/i, '').replace(/^legacy-owner_/, 'legacy-owner::');

  const normalizeLegacyResource = (resource, opts={}) => {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return resource;
    const out = { ...resource };
    const originalId = String(out.id || '').trim();
    if (originalId && originalId.includes('::id::')) {
      out.id = normalizeLegacyIdKind(originalId, 'id', 'resource');
      out.legacy_id = out.legacy_id || originalId;
      out.migrated_id_kind = true;
    }
    const owner = String(out.owner_user_id || out.ownerUserId || '').trim();
    if (!owner) {
      const inferred = ownerFromLegacyResourceId(out.id || originalId)
        || String(opts.ownerByName?.get(normalizedPersonName(out.nome)) || '').trim()
        || legacyOwnerFallbackForName(out.nome || out.name || out.id || 'recurso');
      out.owner_user_id = inferred;
      out.migrated_owner_user_id = true;
    } else {
      out.owner_user_id = owner;
    }
    if (out.ownerUserId && out.ownerUserId !== out.owner_user_id) out.legacy_ownerUserId = out.ownerUserId;
    delete out.ownerUserId;
    return out;
  };

  const updateResourceReferencesForMigration = (obj, idMap) => {
    if (!obj || !idMap || !idMap.size) return obj;
    const mapVal = (v) => idMap.get(String(v || '')) || v;
    for (const d of (Array.isArray(obj.demands) ? obj.demands : [])) {
      if (d.responsavel_id) d.responsavel_id = mapVal(d.responsavel_id);
      if (d.resourceId) d.resourceId = mapVal(d.resourceId);
      if (Array.isArray(d.allocations)) d.allocations = d.allocations.map(a => ({ ...a, resourceId: mapVal(a.resourceId) }));
    }
    for (const b of (Array.isArray(obj.blockings) ? obj.blockings : [])) {
      if (b.recurso_id) b.recurso_id = mapVal(b.recurso_id);
      if (b.resourceId) b.resourceId = mapVal(b.resourceId);
    }
    for (const o of (Array.isArray(obj.overtimes) ? obj.overtimes : [])) {
      if (o.resourceId) o.resourceId = mapVal(o.resourceId);
      if (o.recurso_id) o.recurso_id = mapVal(o.recurso_id);
    }
    for (const ia of (Array.isArray(obj.internalActivities) ? obj.internalActivities : [])) {
      if (ia.resourceId) ia.resourceId = mapVal(ia.resourceId);
      if (ia.recurso_id) ia.recurso_id = mapVal(ia.recurso_id);
    }
    for (const ev of (Array.isArray(obj.events) ? obj.events : [])) {
      const p = ev && ev.payload;
      if (!p || typeof p !== 'object') continue;
      if (p.id) p.id = mapVal(p.id);
      if (p.resource_id) p.resource_id = mapVal(p.resource_id);
      if (p.resourceId) p.resourceId = mapVal(p.resourceId);
      if (p.responsavel_id) p.responsavel_id = mapVal(p.responsavel_id);
    }
    return obj;
  };

  const migrateLegacyResources = (obj) => {
    const base = obj && typeof obj === 'object' ? obj : {};
    const out = { ...base };
    const ownerByName = new Map();
    for (const r of (Array.isArray(base.resources) ? base.resources : [])) {
      const owner = String(r?.owner_user_id || r?.ownerUserId || ownerFromLegacyResourceId(r?.id) || '').trim();
      const key = normalizedPersonName(r?.nome);
      if (key && owner && !ownerByName.has(key)) ownerByName.set(key, owner);
    }
    const idMap = new Map();
    const byId = new Map();
    const byNameOwner = new Map();
    const resources = [];
    let migrationChanged = false;
    for (const raw of (Array.isArray(base.resources) ? base.resources : [])) {
      const migrated = normalizeLegacyResource(raw, { ownerByName });
      if (!migrated || !migrated.id) continue;
      if (raw?.id && String(raw.id) !== String(migrated.id)) { idMap.set(String(raw.id), String(migrated.id)); migrationChanged = true; }
      if (migrated.migrated_owner_user_id || migrated.migrated_id_kind) migrationChanged = true;
      const id = String(migrated.id);
      const nameOwnerKey = `${normalizedPersonName(migrated.nome)}|${String(migrated.owner_user_id || '')}`;
      if (byId.has(id)) {
        Object.assign(byId.get(id), { ...migrated, ...byId.get(id) });
        continue;
      }
      if (nameOwnerKey !== '|' && byNameOwner.has(nameOwnerKey)) {
        const kept = byNameOwner.get(nameOwnerKey);
        kept.duplicate_resource_ids = [...new Set([...(kept.duplicate_resource_ids || []), id])];
        idMap.set(id, kept.id);
        migrationChanged = true;
        continue;
      }
      byId.set(id, migrated);
      byNameOwner.set(nameOwnerKey, migrated);
      resources.push(migrated);
    }
    out.resources = resources;
    updateResourceReferencesForMigration(out, idMap);
    const duplicateNames = new Map();
    for (const r of resources) {
      const key = normalizedPersonName(r.nome);
      if (!key) continue;
      if (!duplicateNames.has(key)) duplicateNames.set(key, new Set());
      duplicateNames.get(key).add(String(r.owner_user_id || ''));
    }
    const flagged = [...duplicateNames.entries()].filter(([, owners]) => owners.size > 1).map(([name, owners]) => ({ name, owners:[...owners] }));
    out.meta = { ...(out.meta && typeof out.meta === 'object' ? out.meta : {}), duplicateUserNameDiagnostics: flagged };
    if (migrationChanged) out.meta.legacyResourceMigrationAt = out.meta.legacyResourceMigrationAt || new Date().toISOString();
    return out;
  };
  const isWeekend = (d) => { const day = d.getDay(); return day === 0 || day === 6; };
  const isFriday = (d) => d instanceof Date && !Number.isNaN(d.getTime()) && d.getDay() === 5;
  const getResourceHoursPerDay = (resource) => {
    if (!resource) return HOURS_PER_DAY;
    if (String(resource.tipo || '').trim() === 'Terceiro') return HOURS_PER_DAY_THIRD;
    return HOURS_PER_DAY;
  };
  const getResourceHoursForDate = (resource, dateObj) => {
    const base = getResourceHoursPerDay(resource);
    if (!resource || String(resource.tipo || '').trim() === 'Terceiro') return base;
    return isFriday(dateObj) ? HOURS_PER_DAY_THIRD : base;
  };
  const resourceHoursLabel = (resource) => {
    if (String(resource?.tipo || '').trim() === 'Terceiro') return `${HOURS_PER_DAY_THIRD}h/dia`;
    return `${HOURS_PER_DAY}h/dia (sexta ${HOURS_PER_DAY_THIRD}h)`;
  };

  const roundDemandHours = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) / 100 : 0;
  };

  const numberOrNull = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const parseHoursLikeToDecimal = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const hhmm = raw.match(/^(\d{1,3}):([0-5]\d)$/);
    if (hhmm) return roundDemandHours(Number(hhmm[1] || 0) + (Number(hhmm[2] || 0) / 60));
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? roundDemandHours(n) : null;
  };

  const resourceByIdFromList = (resourceId, resources=[]) => {
    const rid = String(resourceId || '').trim();
    return (Array.isArray(resources) ? resources : []).find(r => String(r?.id || '').trim() === rid) || null;
  };

  const resourceHoursById = (resourceId, resources=[]) => getResourceHoursPerDay(resourceByIdFromList(resourceId, resources));

  const percentToDemandHours = (percent, resourceId, resources=[]) => {
    const pct = Number(percent);
    if (!Number.isFinite(pct)) return 0;
    return roundDemandHours((Math.max(0, pct) / 100) * resourceHoursById(resourceId, resources));
  };

  const demandHoursToPercent = (hours, resourceId, resources=[]) => {
    const base = resourceHoursById(resourceId, resources);
    if (!base) return 0;
    return Math.round((roundDemandHours(hours) / base) * 1000) / 10;
  };

  const firstHoursLike = (...values) => {
    for (const value of values) {
      const parsed = parseHoursLikeToDecimal(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };

  const makeDemandAllocation = (resourceId, hoursRaw, resources=[]) => {
    const rid = String(resourceId || '').trim();
    const raw = Number(hoursRaw);
    const horas = Number.isFinite(raw) ? roundDemandHours(raw) : NaN;
    return {
      resourceId: rid,
      horas_planejadas_dia: horas,
      percentual_diario: Number.isFinite(horas) ? demandHoursToPercent(horas, rid, resources) : NaN,
    };
  };

  const demandAllocationHoursForDate = (allocation={}, resourceId='', dateObj=null, resources=[]) => {
    const rid = String(resourceId || allocation.resourceId || '').trim();
    const pct = Number(allocation.percentual_diario ?? allocation.dailyPercent ?? allocation.percent);
    const explicitHours = firstHoursLike(
      allocation.horas_planejadas_dia,
      allocation.horas_dia,
      allocation.horas,
      allocation.hours_per_day
    );
    const dateStr = dateObj ? formatDate(dateObj) : '';
    const dailyOverride = allocationDailyHoursForDate(allocation, dateStr);
    if (dailyOverride !== null) return dailyOverride;
    if (explicitHours !== null) return roundDemandHours(explicitHours);
    const res = resourceByIdFromList(rid, resources);
    const baseForDate = getResourceHoursForDate(res, dateObj);
    if (Number.isFinite(pct) && pct >= 0 && baseForDate > 0) {
      return roundDemandHours((pct / 100) * baseForDate);
    }
    return 0;
  };
  const demandAllocationActiveOnDate = (allocation={}, demand={}, dateStr='') => {
    const date = String(dateStr || '').trim();
    if (!date) return true;
    const start = normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || normalizeDateLikeToISO(demand.data_inicio || '');
    const end = normalizeDateLikeToISO(allocation.data_fim || allocation.dataFim || allocation.end_date || '') || normalizeDateLikeToISO(demand.data_fim || '');
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  };

  const demandHistoricalStart = (demand={}) => {
    const candidates = [
      demand?.baseline_inicio,
      demand?.baselineInicio,
      demand?.original_data_inicio,
      demand?.data_inicio_original,
      demand?.data_inicio,
    ].map(normalizeDateLikeToISO).filter(Boolean).sort();
    return candidates[0] || '';
  };

  const demandHistoricalEnd = (demand={}) => {
    const candidates = [
      demand?.data_fim,
      demand?.baseline_fim,
      demand?.baselineFim,
      demand?.original_data_fim,
      demand?.data_fim_original,
      demand?.prazo_original,
    ].map(normalizeDateLikeToISO).filter(Boolean).sort();
    return candidates[candidates.length - 1] || '';
  };

  const demandHasActualWorkInRange = (demand={}, rangeStart='', rangeEnd='') => {
    const apontamentos = normalizeDemandApontamentos(demand);
    if (!apontamentos.length) return false;
    const rs = rangeStart || '0000-01-01';
    const re = rangeEnd || '9999-12-31';
    return apontamentos.some(a => {
      const date = normalizeDateLikeToISO(a?.data || '');
      return !!date && date >= rs && date <= re;
    });
  };

  const demandHistoricalWindowOverlapsRange = (demand={}, rangeStart='', rangeEnd='') => {
    const start = demandHistoricalStart(demand) || normalizeDateLikeToISO(demand?.data_inicio || '');
    const end = demandHistoricalEnd(demand) || normalizeDateLikeToISO(demand?.data_fim || '');
    return overlapsRange(start, end, rangeStart, rangeEnd) || demandHasActualWorkInRange(demand, rangeStart, rangeEnd);
  };

  const demandHistoricalWindowContainsDate = (demand={}, dateStr='') => {
    const date = String(dateStr || '').trim();
    if (!date) return false;
    const start = demandHistoricalStart(demand) || normalizeDateLikeToISO(demand?.data_inicio || '');
    const end = demandHistoricalEnd(demand) || normalizeDateLikeToISO(demand?.data_fim || '');
    return (!start || date >= start) && (!end || date <= end);
  };

  const formatDate = (date) => {
    const d = (date instanceof Date) ? date : new Date(date);
    const z = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return z.toISOString().slice(0,10);
  };
  const formatDateBR = (value) => {
    if (!value) return '';
    // Accept Date or ISO-like string (YYYY-MM-DD)
    if (value instanceof Date) {
      const dd = String(value.getDate()).padStart(2,'0');
      const mm = String(value.getMonth()+1).padStart(2,'0');
      const yy = value.getFullYear();
      return `${dd}/${mm}/${yy}`;
    }
    const s = String(value).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    // Fallback: try Date parsing
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2,'0');
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const yy = d.getFullYear();
      return `${dd}/${mm}/${yy}`;
    }
    return s;
  };
  const normalizeDateLikeToISO = (value) => {
    const s = String(value || '').trim();
    if (!s) return '';
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return '';
    return formatDate(d);
  };
  const getDaysInMonth = (year, month) => {
    const date = new Date(year, month, 1);
    const days = [];
    while (date.getMonth() === month) { days.push(new Date(date)); date.setDate(date.getDate() + 1); }
    return days;
  };
  const downloadFile = (content, fileName, contentType) => {
    const a = document.createElement('a');
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  };

    const readFileText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result||''));
    reader.onerror = reject;
    reader.readAsText(file);
  });


  const normalizeAllocationDailyHours = (dailyHours={}) => {
    const out = {};
    const source = dailyHours && typeof dailyHours === 'object' && !Array.isArray(dailyHours) ? dailyHours : {};
    for (const [rawDate, rawHours] of Object.entries(source)) {
      const date = normalizeDateLikeToISO(rawDate || '') || '';
      const hours = parseHoursLikeToDecimal(rawHours);
      if (!date || hours === null || hours < 0) continue;
      out[date] = roundDemandHours(hours);
    }
    return out;
  };

  const allocationDailyHoursForDate = (allocation={}, dateStr='') => {
    const date = normalizeDateLikeToISO(dateStr || '') || '';
    if (!date) return null;
    const daily = normalizeAllocationDailyHours(allocation.daily_hours || allocation.dailyHours || allocation.horas_por_dia || {});
    return Object.prototype.hasOwnProperty.call(daily, date) ? daily[date] : null;
  };

  const allocationRepresentativeDate = (allocation={}, demand={}) => {
    const start = normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || normalizeDateLikeToISO(demand.data_inicio || '') || '';
    const end = normalizeDateLikeToISO(allocation.data_fim || allocation.dataFim || allocation.end_date || '') || normalizeDateLikeToISO(demand.data_fim || '') || '';
    const today = todayISO();
    if ((!start || today >= start) && (!end || today <= end)) return today;
    return start || end || today;
  };

  const demandAllocationDisplayHours = (allocation={}, demand={}, resources=state.resources || []) => {
    const dateStr = allocationRepresentativeDate(allocation, demand);
    return demandAllocationHoursForDate(allocation, allocation.resourceId || demand.responsavel_id || '', isoToLocalMidnight(dateStr), resources);
  };


  const fillAllocationDailyHoursRange = (dailyHours={}, startStr='', endStr='', hours=0) => {
    const daily = normalizeAllocationDailyHours(dailyHours || {});
    let cursor = normalizeDateLikeToISO(startStr || '') || '';
    const end = normalizeDateLikeToISO(endStr || '') || '';
    const value = roundDemandHours(hours);
    let guard = 0;
    while (cursor && end && cursor <= end && guard < 8000) {
      daily[cursor] = value;
      cursor = addDaysISO(cursor, 1);
      guard++;
    }
    return daily;
  };

  const applyIndividualAllocationHourChange = ({ rid, nextHours, changeFrom, respHoursById, respStartById, respEndById, respDailyById, fallbackStart='', fallbackEnd='' }) => {
    if (!rid) return;
    const previousHours = Number(respHoursById.get(rid) ?? 0);
    const originalStart = normalizeDateLikeToISO(respStartById.get(rid) || fallbackStart || '') || '';
    const end = normalizeDateLikeToISO(respEndById.get(rid) || fallbackEnd || '') || '';
    const from = normalizeDateLikeToISO(changeFrom || '') || originalStart;
    let daily = normalizeAllocationDailyHours(respDailyById.get(rid) || {});
    if (originalStart && from && from > originalStart && Number.isFinite(previousHours)) {
      const historyEnd = addDaysISO(from, -1);
      daily = fillAllocationDailyHoursRange(daily, originalStart, historyEnd, previousHours);
    }
    if (end && from && from <= end) {
      daily = fillAllocationDailyHoursRange(daily, from, end, nextHours);
    }
    respDailyById.set(rid, daily);
    respHoursById.set(rid, roundDemandHours(nextHours));
  };

  const normalizeDemandAllocations = (demand, resources=[]) => {
    const out = [];
    const add = (resourceId, source={}) => {
      const rid = String(resourceId || '').trim();
      if (!rid) return;
      const pctRaw = source?.percentual_diario ?? source?.dailyPercent ?? source?.percent ?? demand?.percentual_diario ?? demand?.dailyPercent ?? demand?.percent;
      const pct = numberOrNull(pctRaw);
      let horas = firstHoursLike(
        source?.horas_planejadas_dia,
        source?.horas_dia,
        source?.horas,
        source?.hours_per_day,
        demand?.horas_planejadas_dia,
        demand?.horas_dia
      );
      const hasExplicitHours = horas !== null;
      if (horas === null) horas = percentToDemandHours(pct ?? 0, rid, resources);
      const pctFinal = hasExplicitHours ? demandHoursToPercent(horas, rid, resources) : (pct !== null ? Math.round(Math.max(0, pct) * 10) / 10 : 0);
      out.push({
        resourceId: rid,
        horas_planejadas_dia: roundDemandHours(horas),
        percentual_diario: pctFinal,
        data_inicio: normalizeDateLikeToISO(source?.data_inicio || source?.dataInicio || source?.start_date || '') || normalizeDateLikeToISO(demand?.data_inicio || '') || '',
        data_fim: normalizeDateLikeToISO(source?.data_fim || source?.dataFim || source?.end_date || '') || normalizeDateLikeToISO(demand?.data_fim || '') || '',
        daily_hours: normalizeAllocationDailyHours(source?.daily_hours || source?.dailyHours || source?.horas_por_dia || {}),
        created_at: source?.created_at || source?.createdAt || source?.timestamp || '',
      });
    };
    const sourceAllocations = Array.isArray(demand?.allocations) ? demand.allocations : [];
    if (Array.isArray(demand?.allocations)) {
      for (const a of demand.allocations) add(a?.resourceId || a?.responsavel_id, a);
    }
    const directRid = String(demand?.responsavel_id || demand?.resourceId || '').trim();
    const hasDirectAllocation = directRid && sourceAllocations.some(a => String(a?.resourceId || a?.responsavel_id || '').trim() === directRid);
    // Regra de negócio: alocação conta somente para responsáveis explícitos.
    // Se a demanda já possui `allocations`, não promovemos campos legados
    // (`responsavel_id`/`resourceId`) a uma alocação extra, pois em bases antigas
    // esses campos podem carregar metadados como focal/criador e duplicar carga.
    if (!sourceAllocations.length && !hasDirectAllocation) add(directRid, demand);
    const deduped = [];
    const seen = new Set();
    for (const allocation of out) {
      const key = [
        String(allocation.resourceId || '').trim(),
        normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || '',
        normalizeDateLikeToISO(allocation.data_fim || allocation.dataFim || allocation.end_date || '') || '',
        String(roundDemandHours(allocation.horas_planejadas_dia ?? allocation.horas_dia ?? 0)),
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(allocation);
    }
    if (!transferHistoryEntries(demand).length) return deduped;
    return reconcileAllocationsWithTransferHistory(demand, deduped, resources);
  };

  const transferHistoryEntries = (demand={}) => (Array.isArray(demand.transfer_history) ? demand.transfer_history : [])
    .map((t, idx) => ({ ...t, __idx:idx, timestamp:Number(t?.timestamp || 0) || 0, transferDate:normalizeDateLikeToISO(t?.transferDate || t?.data_transferencia || t?.date || '') || '' }))
    .filter(t => String(t.fromResourceId || t.from_resource_id || '').trim() || String(t.toResourceId || t.to_resource_id || '').trim())
    // A janela de atuação precisa seguir a data efetiva da transferência, não a ordem
    // em que o evento foi criado/sincronizado. Ex.: Arthur atua até 18, Teste de
    // 19 a 24 e Fulano a partir de 25, mesmo que os eventos cheguem fora de ordem.
    .sort((a,b) => String(a.transferDate).localeCompare(String(b.transferDate)) || (a.timestamp - b.timestamp) || (a.__idx - b.__idx));

  const allocationStartedAfterTransfer = (allocation={}, transfer={}) => {
    const start = normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || '';
    const nextStart = normalizeDateLikeToISO(transfer.nextStart || '') || (transfer.transferDate ? addDaysISO(transfer.transferDate, 1) : '');
    if (start && nextStart) return start >= nextStart;
    return Number(allocation.created_at || allocation.timestamp || 0) > Number(transfer.timestamp || 0);
  };

  const transferSegmentStartForResource = (demand={}, resourceId='', transferDate='') => {
    const rid = String(resourceId || '').trim();
    const limit = normalizeDateLikeToISO(transferDate || '') || '';
    const priorInbound = transferHistoryEntries(demand)
      .filter(t => String(t.toResourceId || t.to_resource_id || '').trim() === rid)
      .map(t => normalizeDateLikeToISO(t.transferDate || t.data_transferencia || t.date || '') || '')
      .filter(date => date && (!limit || date < limit))
      .sort();
    return priorInbound[priorInbound.length - 1] || normalizeDateLikeToISO(demand.data_inicio || '') || '';
  };

  const reconcileAllocationsWithTransferHistory = (demand={}, allocations=[], resources=[]) => {
    const out = (Array.isArray(allocations) ? allocations : []).map(a => ({ ...a }));
    for (const transfer of transferHistoryEntries(demand)) {
      const fromId = String(transfer.fromResourceId || transfer.from_resource_id || '').trim();
      const toId = String(transfer.toResourceId || transfer.to_resource_id || '').trim();
      const transferDate = normalizeDateLikeToISO(transfer.transferDate || '') || todayISO();
      const previousEnd = addDaysISO(transferDate, -1) || transferDate;
      const nextStart = transferDate;
      if (fromId) {
        let touchedFrom = false;
        for (const allocation of out) {
          if (String(allocation.resourceId || '').trim() !== fromId) continue;
          if (allocationStartedAfterTransfer(allocation, { ...transfer, transferDate, nextStart })) continue;
          if (!demandAllocationActiveOnDate(allocation, demand, transferDate)) continue;
          allocation.data_inicio = allocation.data_inicio || normalizeDateLikeToISO(demand.data_inicio || '') || '';
          allocation.data_fim = previousEnd;
          touchedFrom = true;
        }
        if (!touchedFrom) {
          const alreadyClosedFrom = out.some(a =>
            String(a.resourceId || '').trim() === fromId &&
            (normalizeDateLikeToISO(a.data_fim || a.dataFim || a.end_date || '') || '') === previousEnd
          );
          if (!alreadyClosedFrom) {
            const hours = firstHoursLike(transfer.horas_planejadas_dia, transfer.horas_dia, demand.horas_planejadas_dia, demand.horas_dia) ?? 0;
            const previousAlloc = makeDemandAllocation(fromId, hours, resources);
            previousAlloc.data_inicio = transferSegmentStartForResource(demand, fromId, transferDate);
            previousAlloc.data_fim = previousEnd;
            previousAlloc.created_at = transfer.timestamp || '';
            out.push(previousAlloc);
          }
        }
      }
      if (toId) {
        const hours = firstHoursLike(transfer.horas_planejadas_dia, transfer.horas_dia, demand.horas_planejadas_dia, demand.horas_dia) ?? 0;
        const hasSegment = out.some(a =>
          String(a.resourceId || '').trim() === toId &&
          (normalizeDateLikeToISO(a.data_inicio || a.dataInicio || a.start_date || '') || '') === nextStart
        );
        if (hasSegment) {
          for (const allocation of out) {
            if (String(allocation.resourceId || '').trim() !== toId) continue;
            const start = normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || normalizeDateLikeToISO(demand.data_inicio || '') || '';
            if (start && start < nextStart && demandAllocationActiveOnDate(allocation, demand, nextStart)) allocation.__drop_transfer_overlap = true;
          }
        } else {
          const existingActive = out.find(a =>
            String(a.resourceId || '').trim() === toId &&
            demandAllocationActiveOnDate(a, demand, nextStart) &&
            !allocationStartedAfterTransfer(a, { ...transfer, transferDate, nextStart })
          );
          if (existingActive) {
            existingActive.data_inicio = nextStart;
            existingActive.data_fim = normalizeDateLikeToISO(existingActive.data_fim || existingActive.dataFim || existingActive.end_date || '') || normalizeDateLikeToISO(demand.data_fim || '') || '';
            if (hours > 0) {
              existingActive.horas_planejadas_dia = roundDemandHours(hours);
              existingActive.percentual_diario = demandHoursToPercent(hours, toId, resources);
            }
          } else {
            const nextAlloc = makeDemandAllocation(toId, hours, resources);
            nextAlloc.data_inicio = nextStart;
            nextAlloc.data_fim = normalizeDateLikeToISO(demand.data_fim || '') || '';
            nextAlloc.created_at = transfer.timestamp || '';
            out.push(nextAlloc);
          }
        }
      }
    }
    const seen = new Set();
    return out
      .filter(a => String(a.resourceId || '').trim() && !a.__drop_transfer_overlap)
      .sort((a,b) =>
        String(a.resourceId || '').localeCompare(String(b.resourceId || '')) ||
        String(a.data_inicio || '').localeCompare(String(b.data_inicio || '')) ||
        String(a.data_fim || '').localeCompare(String(b.data_fim || ''))
      )
      .filter(a => {
        const key = [
          String(a.resourceId || '').trim(),
          normalizeDateLikeToISO(a.data_inicio || a.dataInicio || a.start_date || '') || '',
          normalizeDateLikeToISO(a.data_fim || a.dataFim || a.end_date || '') || '',
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const primaryDemandResourceId = (demand={}, allocations=[]) => {
    const allocs = Array.isArray(allocations) ? allocations : [];
    const explicitRid = String(demand?.responsavel_id || demand?.resourceId || '').trim();
    if (explicitRid && allocs.some(a => String(a?.resourceId || '').trim() === explicitRid)) return explicitRid;

    const today = todayISO();
    const active = allocs
      .filter(a => demandAllocationActiveOnDate(a, demand, today))
      .sort((a,b) => String(b?.data_inicio || '').localeCompare(String(a?.data_inicio || '')));
    if (active[0]?.resourceId) return String(active[0].resourceId).trim();

    const latest = [...allocs]
      .sort((a,b) => String(b?.data_inicio || '').localeCompare(String(a?.data_inicio || '')))[0];
    return String(latest?.resourceId || explicitRid || '').trim();
  };

  const relatedDemandReprogrammings = (demand, reprogrammings=[]) => {
    const id = String(demand?.id || '').trim();
    if (!id) return [];
    return (Array.isArray(reprogrammings) ? reprogrammings : [])
      .filter(rp => String(rp?.demanda_id || rp?.demandId || '') === id)
      .sort((a,b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
  };

  const normalizeDemandBaseline = (demand, reprogrammings=[]) => {
    if (!demand || typeof demand !== 'object' || Array.isArray(demand)) return demand;
    const out = { ...demand };
    const firstRp = relatedDemandReprogrammings(out, reprogrammings)[0] || {};
    const baselineInicio = String(
      out.baseline_inicio || out.baselineInicio || out.original_data_inicio || out.data_inicio_original ||
      firstRp.inicio_original || firstRp.data_inicio_original || out.data_inicio || ''
    ).trim();
    const baselineFim = String(
      out.baseline_fim || out.baselineFim || out.original_data_fim || out.data_fim_original || out.prazo_original ||
      firstRp.prazo_anterior || firstRp.data_fim_anterior || firstRp.prazo_original || out.data_fim || ''
    ).trim();
    out.baseline_inicio = baselineInicio;
    out.baseline_fim = baselineFim;
    return out;
  };

  const normalizeDemandsV02 = (arr, reprogrammings=[], resources=[]) => {
    const inList = Array.isArray(arr) ? arr : [];
    const grouped = new Map();
    const normTxt = (v='') => String(v || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .trim().toLowerCase().replace(/\s+/g, ' ');
    const normStatus = (v='') => {
      const raw = String(v || '').trim().toLowerCase();
      if (!raw) return 'Mapeada';
      if (raw === 'atrasada') return 'Atrasada';
      if (raw === 'concluída' || raw === 'concluida') return 'Concluída';
      if (raw === 'em andamento') return 'Em andamento';
      if (raw === 'mapeada') return 'Mapeada';
      if (raw === 'congelada') return 'Congelada';
      return 'Mapeada';
    };
    const makeKey = (d) => [
      String(d?.logical_group_id || '').trim(),
      normTxt(d?.titulo),
      normTxt(d?.predio),
      normTxt(d?.focal),
      String(d?.data_inicio || ''),
      String(d?.data_fim || ''),
      normStatus(d?.status || 'Mapeada'),
      normTxt(d?.prioridade),
      normTxt(d?.observacoes),
    ].join('|');
    for (const raw of inList) {
      if (!raw || typeof raw !== 'object') continue;
      const d = normalizeDemandBaseline({ ...raw }, reprogrammings);
      const key = makeKey(d);
      const existing = grouped.get(key);
      const allocs = normalizeDemandAllocations(d, resources);
      if (!existing) {
        const primaryRid = primaryDemandResourceId(d, allocs) || allocs[0]?.resourceId || String(d.responsavel_id || d.resourceId || '').trim();
        grouped.set(key, {
          ...d,
          responsavel_id: primaryRid,
          percentual_diario: Number(allocs[0]?.percentual_diario ?? d.percentual_diario ?? 0),
          horas_planejadas_dia: Number(allocs[0]?.horas_planejadas_dia ?? d.horas_planejadas_dia ?? d.horas_dia ?? 0),
          allocations: allocs,
        });
        continue;
      }
      const seen = new Set((existing.allocations || []).map(a => String(a.resourceId || '').trim()).filter(Boolean));
      for (const a of allocs) {
        const rid = String(a.resourceId || '').trim();
        if (!rid || seen.has(rid)) continue;
        existing.allocations.push({ ...a });
        seen.add(rid);
      }
      existing.responsavel_id = primaryDemandResourceId(existing, existing.allocations) || existing.responsavel_id || existing.allocations[0]?.resourceId || '';
    }
    return [...grouped.values()];
  };

  const normalizeImportedState = (obj) => {
    const migrated = migrateLegacyResources(obj && typeof obj === 'object' ? obj : {});
    return {
      ...defaultState(),
      ...migrated,
      schemaVersion: '0.2',
      resources: Array.isArray(migrated.resources) ? migrated.resources : [],
      demands: normalizeDemandsV02(migrated.demands, migrated.reprogrammings, Array.isArray(migrated.resources) ? migrated.resources : []),
      internalActivities: Array.isArray(migrated.internalActivities) ? migrated.internalActivities : [],
      blockings: Array.isArray(migrated.blockings) ? migrated.blockings : [],
      holidays: Array.isArray(migrated.holidays) ? migrated.holidays : [],
      reprogrammings: Array.isArray(migrated.reprogrammings) ? migrated.reprogrammings : [],
      overtimes: Array.isArray(migrated.overtimes) ? migrated.overtimes : [],
      events: Array.isArray(migrated.events) ? migrated.events : [],
    };
  };

  const parseSnapshotText = (txt) => {
    const obj = JSON.parse(String(txt||'{}'));
    if (!obj || typeof obj !== 'object') throw new Error('Arquivo inválido.');
    return normalizeImportedState(obj);
  };


  const DB_COLLECTION_KEYS = ['resources','demands','internalActivities','blockings','holidays','reprogrammings','overtimes','events'];
  const stableStringify = (value) => {
    const seen = new WeakSet();
    const sortAny = (v) => {
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(sortAny);
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortAny(v[k]);
      return out;
    };
    return JSON.stringify(sortAny(value));
  };

  const simpleHash = (txt) => {
    const s = String(txt || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  };

  const normalizeDbStateOnly = (obj) => normalizeImportedState(obj);

  const sameItem = (a,b) => stableStringify(a) === stableStringify(b);
  const deepClone = (value) => JSON.parse(JSON.stringify(value ?? null));
  const META_MERGE_KEYS = new Set(['createdAt','createdBy','updatedAt','updatedBy','version','last_edit_at','last_edit_by','last_edit_justification','timestamp','user','user_id']);

  const nowIso = () => new Date().toISOString();

  const applyCreateMeta = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out = { ...item };
    if (!out.createdAt) out.createdAt = nowIso();
    if (!out.createdBy) out.createdBy = userName || out.createdBy || '';
    if (!out.createdById && !out.created_by_id) out.createdById = userId || '';
    out.updatedAt = nowIso();
    out.updatedBy = userName || out.updatedBy || '';
    out.updatedById = userId || out.updatedById || out.updated_by_id || '';
    out.version = Number(out.version || 0) > 0 ? Number(out.version) : 1;
    return out;
  };

  const applyUpdateMeta = (next, previous) => {
    if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
    const prev = (previous && typeof previous === 'object' && !Array.isArray(previous)) ? previous : {};
    const out = { ...next };
    out.createdAt = out.createdAt || prev.createdAt || nowIso();
    out.createdBy = out.createdBy || prev.createdBy || userName || '';
    out.createdById = out.createdById || out.created_by_id || prev.createdById || prev.created_by_id || userId || '';
    out.updatedAt = nowIso();
    out.updatedBy = userName || out.updatedBy || '';
    out.updatedById = userId || out.updatedById || out.updated_by_id || '';
    out.version = Math.max(Number(prev.version || 0), Number(out.version || 0), 0) + 1;
    return out;
  };

  const toMapById = (arr) => {
    const m = new Map();
    for (const item of (Array.isArray(arr) ? arr : [])) {
      if (!item || typeof item !== 'object') continue;
      const id = String(item.id || '');
      if (!id) continue;
      m.set(id, item);
    }
    return m;
  };

  const changedKeys = (baseItem, nextItem) => {
    const keys = new Set([
      ...Object.keys((baseItem && typeof baseItem === 'object') ? baseItem : {}),
      ...Object.keys((nextItem && typeof nextItem === 'object') ? nextItem : {}),
    ]);
    const out = [];
    for (const key of keys) {
      if (key === 'id') continue;
      const before = baseItem ? baseItem[key] : undefined;
      const after = nextItem ? nextItem[key] : undefined;
      if (stableStringify(before) !== stableStringify(after)) out.push(key);
    }
    return out;
  };

  const buildConflictRecord = ({ collection, id, reason, baseItem, localItem, remoteItem, localChangedKeys=[], remoteChangedKeys=[] }) => ({
    collection,
    id,
    reason,
    baseItem: deepClone(baseItem),
    localItem: deepClone(localItem),
    remoteItem: deepClone(remoteItem),
    localChangedKeys: [...localChangedKeys],
    remoteChangedKeys: [...remoteChangedKeys],
  });

  const mergeObjectFields = ({ collection, id, baseItem, localItem, remoteItem }) => {
    const localKeysAll = changedKeys(baseItem, localItem);
    const remoteKeysAll = changedKeys(baseItem, remoteItem);
    const localDataKeys = localKeysAll.filter(k => !META_MERGE_KEYS.has(k));
    const remoteDataKeys = remoteKeysAll.filter(k => !META_MERGE_KEYS.has(k));
    const overlap = localDataKeys.filter(k => remoteDataKeys.includes(k));
    if (overlap.length) {
      return {
        merged: null,
        conflict: buildConflictRecord({
          collection, id, reason: 'same_field_changed', baseItem, localItem, remoteItem,
          localChangedKeys: localKeysAll, remoteChangedKeys: remoteKeysAll,
        })
      };
    }
    const merged = deepClone(baseItem || {});
    merged.id = String((localItem && localItem.id) || (remoteItem && remoteItem.id) || (baseItem && baseItem.id) || id);
    for (const key of localDataKeys) merged[key] = deepClone(localItem[key]);
    for (const key of remoteDataKeys) merged[key] = deepClone(remoteItem[key]);
    const createdAtCandidates = [baseItem?.createdAt, localItem?.createdAt, remoteItem?.createdAt].filter(Boolean).sort();
    const versionMax = Math.max(Number(baseItem?.version || 0), Number(localItem?.version || 0), Number(remoteItem?.version || 0), 0);
    merged.createdAt = createdAtCandidates[0] || nowIso();
    merged.createdBy = localItem?.createdBy || remoteItem?.createdBy || baseItem?.createdBy || '';
    merged.updatedAt = nowIso();
    merged.updatedBy = `merge:${userName || 'sistema'}`;
    merged.version = versionMax + 1;
    if (localItem?.last_edit_justification || remoteItem?.last_edit_justification) {
      merged.last_edit_justification = [localItem?.last_edit_justification, remoteItem?.last_edit_justification].filter(Boolean).join(' | ');
    }
    return { merged, conflict: null };
  };

  const mergeThreeWayCollection = (collectionKey, baseArr, localArr, remoteArr) => {
    const base = toMapById(baseArr), local = toMapById(localArr), remote = toMapById(remoteArr);
    const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
    const out = [];
    const conflicts = [];
    let autoMerged = 0;
    for (const id of ids) {
      const b = base.has(id) ? base.get(id) : undefined;
      const l = local.has(id) ? local.get(id) : undefined;
      const r = remote.has(id) ? remote.get(id) : undefined;
      const localChanged = (b === undefined) ? (l !== undefined) : !sameItem(l, b);
      const remoteChanged = (b === undefined) ? (r !== undefined) : !sameItem(r, b);

      if (!localChanged && !remoteChanged) {
        if (r !== undefined) out.push(deepClone(r));
        else if (l !== undefined) out.push(deepClone(l));
        continue;
      }
      if (localChanged && !remoteChanged) {
        if (l !== undefined) out.push(deepClone(l));
        continue;
      }
      if (!localChanged && remoteChanged) {
        if (r !== undefined) out.push(deepClone(r));
        continue;
      }
      if (sameItem(l, r)) {
        if (l !== undefined) out.push(deepClone(l));
        continue;
      }

      // Ambos criaram item novo com mesmo ID.
      // Tenta mesclar campos em vez de bloquear imediatamente.
      if (b === undefined) {
        if (sameItem(l, r)) {
          if (l !== undefined) out.push(deepClone(l));
          continue;
        }
        // Usa objeto vazio como base para tentar merge de campos
        const fieldMergeNew = mergeObjectFields({ collection: collectionKey, id, baseItem: {id}, localItem: l, remoteItem: r });
        if (fieldMergeNew.conflict) {
          conflicts.push(fieldMergeNew.conflict);
        } else {
          out.push(fieldMergeNew.merged);
          autoMerged += 1;
        }
        continue;
      }

      if (l === undefined || r === undefined) {
        conflicts.push(buildConflictRecord({
          collection: collectionKey, id, reason: 'edit_vs_delete', baseItem: b, localItem: l, remoteItem: r,
          localChangedKeys: changedKeys(b, l), remoteChangedKeys: changedKeys(b, r),
        }));
        continue;
      }

      const fieldMerge = mergeObjectFields({ collection: collectionKey, id, baseItem: b, localItem: l, remoteItem: r });
      if (fieldMerge.conflict) {
        conflicts.push(fieldMerge.conflict);
        continue;
      }
      out.push(fieldMerge.merged);
      autoMerged += 1;
    }
    return { items: out, conflicts, autoMerged };
  };

  const normalizeDemandTextForDedupe = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .trim().toLowerCase().replace(/\s+/g, ' ');

  const demandBusinessKey = (d) => {
    if (!d || typeof d !== 'object') return '';
    return [
      normalizeDemandTextForDedupe(d.titulo),
      normalizeDemandTextForDedupe(d.predio),
      normalizeDemandTextForDedupe(d.focal),
      String(d.data_inicio || ''),
      String(d.data_fim || ''),
      String(d.responsavel_id || d.resourceId || ''),
      String(Number(d.horas_planejadas_dia ?? d.horas_dia ?? 0)),
      normalizeStatus(d.status || 'Mapeada'),
      normalizeDemandTextForDedupe(d.prioridade),
      normalizeDemandTextForDedupe(d.observacoes)
    ].join('|');
  };

  const demandDisplayGroupKey = (d) => {
    if (!d || typeof d !== 'object') return '';
    if (d.logical_group_id) return `group:${String(d.logical_group_id)}`;
    return [
      normalizeDemandTextForDedupe(d.titulo),
      normalizeDemandTextForDedupe(d.predio),
      normalizeDemandTextForDedupe(d.focal),
      String(d.data_inicio || ''),
      String(d.data_fim || ''),
      String(Number(d.horas_planejadas_dia ?? d.horas_dia ?? 0)),
      normalizeStatus(d.status || 'Mapeada'),
      normalizeDemandTextForDedupe(d.prioridade),
      normalizeDemandTextForDedupe(d.observacoes)
    ].join('|');
  };

  const demandMatchesDeletePayload = (d, payload) => {
    if (!d) return false;
    const id = String(d.id || '');
    const ids = new Set((Array.isArray(payload?.ids) ? payload.ids : []).map(String).filter(Boolean));
    if (id && ids.has(id)) return true;
    const groupKeys = new Set((Array.isArray(payload?.groupKeys) ? payload.groupKeys : []).map(String).filter(Boolean));
    if (groupKeys.size && groupKeys.has(demandDisplayGroupKey(d))) return true;
    const groupIds = new Set((Array.isArray(payload?.logicalGroupIds) ? payload.logicalGroupIds : []).map(String).filter(Boolean));
    if (groupIds.size && groupIds.has(String(d.logical_group_id || ''))) return true;
    return false;
  };

  const groupDemandsForDisplay = (demands) => {
    const groups = [];
    const byKey = new Map();
    let fallbackIdx = 0;
    for (const demand of (Array.isArray(demands) ? demands : [])) {
      const key = demandDisplayGroupKey(demand) || String(demand?.id || `display-${fallbackIdx++}`);
      let group = byKey.get(key);
      if (!group) {
        group = { ...demand, display_group_key:key, display_demands:[], display_responsavel_ids:[] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.display_demands.push(demand);
      const activeIds = activeDemandAllocations(demand).map(a => String(a.resourceId || '').trim()).filter(Boolean);
      if (!activeIds.length) activeIds.push(String(demand.responsavel_id || demand.resourceId || '').trim());
      for (const rid of activeIds) {
        if (rid && !group.display_responsavel_ids.includes(rid)) group.display_responsavel_ids.push(rid);
      }
      group.createdAt = demandCreatedMs(demand) > demandCreatedMs(group) ? demand.createdAt : group.createdAt;
      group.updatedAt = demandCreatedMs({ createdAt:demand.updatedAt || demand.createdAt }) > demandCreatedMs({ createdAt:group.updatedAt || group.createdAt })
        ? demand.updatedAt
        : group.updatedAt;
    }
    return groups;
  };

  const demandCreatedMs = (d) => {
    const raw = d?.createdAt || d?.updatedAt || d?.timestamp || '';
    const n = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(n) ? n : 0;
  };

  const areLikelyDuplicateDemandRecords = (a, b) => {
    if (!a || !b || String(a.id || '') === String(b.id || '')) return false;
    const at = demandCreatedMs(a);
    const bt = demandCreatedMs(b);
    if (!at || !bt) return true;
    return Math.abs(at - bt) <= 10 * 60 * 1000;
  };

  const chooseDemandRecordToKeep = (current, candidate) => {
    const currentVersion = Number(current?.version || 0);
    const candidateVersion = Number(candidate?.version || 0);
    if (candidateVersion > currentVersion) return candidate;
    if (candidateVersion < currentVersion) return current;
    const currentUpdated = demandCreatedMs({ createdAt: current?.updatedAt || current?.createdAt });
    const candidateUpdated = demandCreatedMs({ createdAt: candidate?.updatedAt || candidate?.createdAt });
    return candidateUpdated > currentUpdated ? candidate : current;
  };

  const dedupeLikelyDuplicateDemands = (demands) => {
    const out = [];
    const indexByBusinessKey = new Map();
    for (const demand of (Array.isArray(demands) ? demands : [])) {
      const key = demandBusinessKey(demand);
      const idx = key ? indexByBusinessKey.get(key) : undefined;
      if (idx === undefined || !areLikelyDuplicateDemandRecords(out[idx], demand)) {
        indexByBusinessKey.set(key, out.length);
        out.push(demand);
      } else {
        out[idx] = chooseDemandRecordToKeep(out[idx], demand);
      }
    }
    return out;
  };

  const hasLikelyDuplicateDemand = (demands, payload) => {
    const key = demandBusinessKey(payload);
    if (!key) return false;
    for (const demand of (Array.isArray(demands) ? demands : [])) {
      if (demandBusinessKey(demand) === key && areLikelyDuplicateDemandRecords(demand, payload)) return true;
    }
    return false;
  };

  const mergeStatesThreeWay = (baseState, localState, remoteState) => {
    const base = normalizeDbStateOnly(baseState || {});
    const local = normalizeDbStateOnly(localState || {});
    const remote = normalizeDbStateOnly(remoteState || {});
    const merged = normalizeDbStateOnly(remote);
    const conflicts = [];
    const summary = {};
    let autoMergedCount = 0;
    for (const key of DB_COLLECTION_KEYS) {
      const beforeRemote = Array.isArray(remote[key]) ? remote[key].length : 0;
      const beforeLocal = Array.isArray(local[key]) ? local[key].length : 0;
      const res = mergeThreeWayCollection(key, base[key], local[key], remote[key]);
      merged[key] = res.items;
      conflicts.push(...res.conflicts);
      autoMergedCount += Number(res.autoMerged || 0);
      summary[key] = {
        remote: beforeRemote,
        local: beforeLocal,
        merged: Array.isArray(res.items) ? res.items.length : 0,
        conflicts: res.conflicts.length,
        autoMerged: Number(res.autoMerged || 0),
      };
    }
    const beforeDemandDedupe = Array.isArray(merged.demands) ? merged.demands.length : 0;
    merged.demands = dedupeLikelyDuplicateDemands(merged.demands);
    const demandDedupeCount = Math.max(0, beforeDemandDedupe - (Array.isArray(merged.demands) ? merged.demands.length : 0));
    if (summary.demands && demandDedupeCount) {
      summary.demands.deduped = demandDedupeCount;
      summary.demands.merged = merged.demands.length;
      autoMergedCount += demandDedupeCount;
    }
    merged.meta = {
      ...(remote.meta && typeof remote.meta === 'object' ? remote.meta : {}),
      ...(local.meta && typeof local.meta === 'object' ? local.meta : {}),
      mergedAt: nowIso(),
      mergedBy: userName || '',
      mergedById: userId || '',
      mergeConflictCount: conflicts.length,
      mergeAutoMergedCount: autoMergedCount,
      mergeSummary: summary,
      mergeHasBlockingConflicts: conflicts.length > 0,
    };
    return { merged, conflicts, conflictCount: conflicts.length, autoMergedCount, summary };
  };

  const getDbFileMeta = (file, txt='') => ({
    lastModified: Number(file?.lastModified || 0),
    size: Number(file?.size || String(txt || '').length || 0),
    hash: simpleHash(txt),
  });

  const loadDbMeta = () => {
    try {
      const raw = localStorage.getItem(DB_META_KEY);
      if (!raw) return { mode:'none', name:'', lastLoadedAt:'', writable:false, baselineHash:'', baselineLastModified:0, baselineSize:0 };
      const obj = JSON.parse(raw);
      return {
        mode: String(obj.mode || 'none'),
        name: String(obj.name || ''),
        lastLoadedAt: String(obj.lastLoadedAt || ''),
        writable: !!obj.writable,
        baselineHash: String(obj.baselineHash || ''),
        baselineLastModified: Number(obj.baselineLastModified || 0),
        baselineSize: Number(obj.baselineSize || 0),
      };
    } catch {
      return { mode:'none', name:'', lastLoadedAt:'', writable:false, baselineHash:'', baselineLastModified:0, baselineSize:0 };
    }
  };

  const persistDbMeta = (meta) => {
    localStorage.setItem(DB_META_KEY, JSON.stringify({
      mode: String(meta?.mode || 'none'),
      name: String(meta?.name || ''),
      lastLoadedAt: String(meta?.lastLoadedAt || ''),
      writable: !!meta?.writable,
      baselineHash: String(meta?.baselineHash || ''),
      baselineLastModified: Number(meta?.baselineLastModified || 0),
      baselineSize: Number(meta?.baselineSize || 0),
    }));
  };

  const loadDbBaseline = () => {
    try {
      const raw = localStorage.getItem(DB_BASELINE_KEY);
      if (!raw) return null;
      return normalizeDbStateOnly(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const persistDbBaseline = (snapshot) => {
    try {
      if (!snapshot) {
        localStorage.removeItem(DB_BASELINE_KEY);
        return;
      }
      localStorage.setItem(DB_BASELINE_KEY, JSON.stringify(normalizeDbStateOnly(snapshot)));
    } catch (e) {
      // Bancos grandes podem ultrapassar a cota do localStorage.
      // O snapshot continua válido em memória e/ou no arquivo JSON selecionado;
      // apenas deixamos de duplicar o BD inteiro dentro do navegador.
      try { localStorage.removeItem(DB_BASELINE_KEY); } catch {}
      console.warn('[ORIZON Storage] Baseline grande demais para localStorage. Mantido fora do cache local.', e);
    }
  };

  let dbBinding = loadDbMeta();
  let dbFileHandle = null;
  let dbLoadedSnapshot = loadDbBaseline();
  const setDbBinding = (meta, handle=null, loadedSnapshot=null) => {
    dbBinding = {
      mode: String(meta?.mode || 'none'),
      name: String(meta?.name || ''),
      lastLoadedAt: String(meta?.lastLoadedAt || ''),
      writable: !!meta?.writable,
      baselineHash: String(meta?.baselineHash || ''),
      baselineLastModified: Number(meta?.baselineLastModified || 0),
      baselineSize: Number(meta?.baselineSize || 0),
    };
    dbFileHandle = handle || null;
    dbLoadedSnapshot = loadedSnapshot ? normalizeDbStateOnly(loadedSnapshot) : null;
    persistDbMeta(dbBinding);
    persistDbBaseline(dbLoadedSnapshot);
  };

  const resetDbBinding = () => {
    setDbBinding({ mode:'none', name:'', lastLoadedAt:'', writable:false, baselineHash:'', baselineLastModified:0, baselineSize:0 }, null, null);
  };

  const hasDbBinding = () => String(dbBinding?.mode || 'none') !== 'none';
  const hasDbReconnectNeeded = () => {
    if (capviewEventMode?.enabled) return false;
    const reason = String(dbAutoSyncPauseReason || '').trim();
    if (!reason) return false;
    if (!/(v[ií]nculo|inv[aá]lid|permiss|arquivo|json|notfound|security|selecion)/i.test(reason)) return false;
    const mode = String(dbBinding?.mode || 'none');
    return mode === 'rw' || !!dbBinding?.name;
  };

  const clearOrizonLocalStorage = () => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (
          key === STORAGE_KEY ||
          key === USER_KEY ||
          key === DB_PATH_KEY ||
          key === DB_META_KEY ||
          key === DB_BASELINE_KEY ||
          key.startsWith('capview_') ||
          key.startsWith('resource_planner_') ||
          key.startsWith('orizon_')
        ) keys.push(key);
      }
      for (const key of keys) localStorage.removeItem(key);
      clearDemandCreateDraft();
    } catch (e) {
      console.warn('[ORIZON Clear] Falha ao limpar localStorage:', e);
    }
  };

  const resetRuntimeStateAfterClear = () => {
    try { stopEventAutoSync(); } catch {}
    try { stopDbWatcher(); } catch {}
    if (dbAutoSaveTimer) clearTimeout(dbAutoSaveTimer);
    dbAutoSaveTimer = null;
    dbAutoSaveRunning = false;
    dbAutoSaveStartedAt = 0;
    dbAutoSavePending = false;
    dbAutoSaveDirtySince = 0;
    dbWatcherTimer = null;
    dbWatcherRunning = false;
    suppressDbAutoSave = false;
    dbLastSyncLabel = '';
    dbAutoSyncEnabled = false;
    dbAutoSyncPauseReason = '';
    dbOperationQueue = [];
    dbFileHandle = null;
    dbLoadedSnapshot = null;
    dbBinding = { mode:'none', name:'', lastLoadedAt:'', writable:false, baselineHash:'', baselineLastModified:0, baselineSize:0 };
    capviewDataDirHandle = null;
    capviewEventsDirHandle = null;
    capviewSnapshotFileHandle = null;
    capviewEventWriteInFlight = false;
    capviewEventMode = {
      enabled: false,
      folderName: '',
      lastReadAt: '',
      lastWriteAt: '',
      lastStatus: '',
      pendingReadCount: 0,
      autoSyncEnabled: true,
      autoSyncMs: 4000,
      autoSyncRunning: false,
      autoSyncLastTickAt: '',
      autoSyncError: '',
    };
  };

  const confirmClearAllData = () => {
    const pwd = prompt('Informe a senha para limpar os dados locais do sistema:');
    if (pwd === null) return false;
    if (String(pwd) !== 'CAPVIEW') {
      alert('Senha inválida.');
      return false;
    }
    if (!confirm('Isso limpar? todos os dados locais do sistema, incluindo localStorage, vínculo com BD e usuário salvo neste navegador. Continuar?')) return false;
    clearOrizonLocalStorage();
    resetRuntimeStateAfterClear();
    state = defaultState();
    invalidateDashboardCapacityCache();
    userName = '';
    userId = '';
    try {
      Object.keys(uiFilters || {}).forEach(k => {
        if (typeof uiFilters[k] === 'string') uiFilters[k] = '';
        else if (typeof uiFilters[k] === 'boolean') uiFilters[k] = false;
        else uiFilters[k] = null;
      });
      Object.keys(uiPagination || {}).forEach(k => { uiPagination[k] = 1; });
    } catch {}
    updateAvatar();
    activeTab = 'dashboard';
    persist({ skipAutoSave:true });
    render();
    toast('Dados locais, cache, BD e modo Eventos limpos com sucesso.');
    setTimeout(() => openUserModal(true), 150);
    return true;
  };

  const canUseFileSystemAccess = () => !!window.showOpenFilePicker;
  const isFileOrigin = () => String(window.location?.protocol || '') === 'file:';

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const isDbHandleRecoverableError = (e) => {
    const name = String(e?.name || '');
    const msg = String(e?.message || '');
    return (
      name === 'InvalidStateError' ||
      name === 'SecurityError' ||
      name === 'NotFoundError' ||
      /state had changed since it was read from disk/i.test(msg) ||
      /depends on state cached in an interface object/i.test(msg) ||
      /permission|createWritable|user activation/i.test(msg) ||
      /unsafe attempt to load url/i.test(msg)
    );
  };

  const clearDbHandleOnly = () => {
    dbFileHandle = null;
    setDbBinding({
      ...dbBinding,
      mode:'none',
      writable:false,
      baselineHash:'',
      baselineLastModified:0,
      baselineSize:0,
      lastLoadedAt:new Date().toISOString(),
    }, null, null);
  };

  let selectDbReadWrite = async () => false;

  const recoverDbHandleByReselect = async (reason='') => {
    clearDbHandleOnly();
    toast(reason || 'O vínculo com o BD ficou inválido. Selecione o arquivo JSON novamente.');
    await sleep(50);
    await selectDbReadWrite();
    return !!(dbFileHandle && dbBinding.mode === 'rw');
  };

  const holidayKey = (h) => String(h?.id || h?.data || h?.date || '').trim();

  const mergeHolidaysNonDestructive = (incomingHolidays, currentHolidays) => {
    const out = [];
    const seen = new Set();
    const add = (h) => {
      if (!h || typeof h !== 'object') return;
      const key = holidayKey(h);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ ...h });
    };
    // Prioriza o que veio do BD, mas preserva feriados já cadastrados localmente.
    for (const h of (Array.isArray(incomingHolidays) ? incomingHolidays : [])) add(h);
    for (const h of (Array.isArray(currentHolidays) ? currentHolidays : [])) add(h);
    return out;
  };

  const applyImportedSnapshot = (snapshot, opts={}) => {
    const currentHolidays = Array.isArray(state?.holidays) ? state.holidays : [];
    const next = normalizeImportedState(snapshot);
    if (opts?.preserveHolidays !== false) {
      next.holidays = mergeHolidaysNonDestructive(next.holidays, currentHolidays);
    }
    state = next;
    invalidateDashboardCapacityCache();
    const prevSuppress = suppressDbAutoSave;
    suppressDbAutoSave = true;
    try { persist({ skipAutoSave:true }); } finally { suppressDbAutoSave = prevSuppress; }
    render();
    return state;
  };

  const ensureHandlePermission = async (handle, mode='readwrite', { prompt=true } = {}) => {
    if (!handle) return false;
    if (typeof handle.queryPermission !== 'function') return true;
    const opts = { mode };
    let status = 'prompt';
    try { status = await handle.queryPermission(opts); } catch {}
    if (status === 'granted') return true;
    if (!prompt || typeof handle.requestPermission !== 'function') return false;
    try { status = await handle.requestPermission(opts); } catch { status = 'denied'; }
    return status === 'granted';
  };

  const ensureDbHandlePermission = async (mode='readwrite', opts={}) => ensureHandlePermission(dbFileHandle, mode, opts);

  const dbWriteHelpText = () => {
    if (isFileOrigin()) {
      return 'Permissão de escrita não concedida pelo navegador. Como o app está aberto via file://, o navegador pode exigir um novo gesto do usuário. Clique em "Selecionar arquivo JSON" novamente e tente salvar de novo.';
    }
    return 'Permissão de escrita não concedida pelo navegador. Clique em "Selecionar arquivo JSON" novamente e autorize acesso de leitura/gravação.';
  };

  const isDbPermissionError = (e) => {
    const msg = String(e?.message || '');
    return e?.name === 'SecurityError' || /permission|createWritable|user activation/i.test(msg);
  };

  const buildDbExportObject = () => ({
    ...state,
    schemaVersion: APP_SCHEMA_VERSION,
    meta: {
      ...(state.meta && typeof state.meta==='object' ? state.meta : {}),
      authorName: userName || '',
      authorUserId: userId || '',
      exportedAt: new Date().toISOString(),
      exportSource: 'ORIZON',
      schemaVersion: APP_SCHEMA_VERSION,
    }
  });

  // ----------------------
  // Demand filters + donut modal
  // ----------------------
  const overlapsRange = (start, end, rangeStart, rangeEnd) => {
    // all args are ISO date strings (YYYY-MM-DD). Empty rangeStart/rangeEnd means open-ended.
    const rs = rangeStart || '0000-01-01';
    const re = rangeEnd   || '9999-12-31';
    const s = start || '0000-01-01';
    const e = end   || '9999-12-31';
    return !(e < rs || s > re);
  };

  const normalizeSearchText = normalizeIndexedSearchText;
  const demandSearchTextCache = new SearchTextCache();

  const filterDemands = ({ status='', resourceId='', dateStart='', dateEnd='', titleQuery='' } = {}) => {
    const st = (status||'').trim();
    const rid = (resourceId||'').trim();
    const ds = (dateStart||'').trim();
    const de = (dateEnd||'').trim();
    const tq = normalizeSearchText(titleQuery);

    return (state.demands||[]).filter(d => {
      const dStatus = effectiveStatus(d);
      if (st && dStatus != st) return false;

      const searchable = demandSearchTextCache.get(d, [d.titulo, d.nome, dStatus, d.status]);
      if (tq && !searchable.includes(tq)) return false;

      if (rid) {
        const allocs = demandAllocations(d);
        if (rid === '__NONE__') {
          if (allocs.length > 0 || (d.responsavel_id||'').trim()) return false;
        } else {
          const match = allocs.some(a =>
            String(a.resourceId || '') === rid &&
            (!(ds || de) || demandAllocationOverlapsRange(a, d, ds, de))
          );
          if (!match) return false;
        }
      }

      if (ds || de) {
        if (!demandHistoricalWindowOverlapsRange(d, ds, de)) return false;
      }
      return true;
    });
  };

  const renderDemandsTable = (demands, { compact=false, resourceId='' } = {}) => {
    const resMap = resourceById();
    const t = el('table');
    t.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', {}, ['Título']),
      el('th', {}, ['Responsável']),
      el('th', {}, ['Período']),
      el('th', {}, ['Horas/dia']),
      el('th', {}, ['Prioridade']),
      el('th', {}, ['Status']),
    ])]));
    const tb = el('tbody');

    for (const d of demands) {
      const tr = el('tr');
        if (effectiveStatus(d) === 'Atrasada') tr.classList.add('overdueRow');
      const timelineLabels = demandAllocationTimelineLabels(d);
      tr.appendChild(el('td', {}, [
        el('div', { style:'font-weight:950' }, [d.titulo]),
        d.predio || d.focal ? el('div', { class:'tiny' }, [`${(d.predio||'').trim()}${d.predio && d.focal ? ' ? ' : ''}${(d.focal||'').trim()}`.trim()]) : el('div', { class:'tiny', style:'display:none' }, [''])
      ].filter(Boolean)));
      const contextRid = String(resourceId || '').trim();
      const allocs = demandAllocations(d);
      const contextAlloc = contextRid && contextRid !== '__NONE__'
        ? allocs.find(a => String(a.resourceId || '') === contextRid)
        : null;
      const displayRid = contextAlloc ? contextRid : String(d.responsavel_id || allocs[0]?.resourceId || '').trim();
      const respName = displayRid ? (resMap[displayRid]?.nome || displayRid || '-') : '-';
      const primaryAlloc = contextAlloc || allocs.find(a => String(a.resourceId || '') === String(d.responsavel_id || '')) || allocs[0] || {};
      tr.appendChild(el('td', {}, [
        el('div', {}, [respName])
      ]));
      tr.appendChild(el('td', { class:'mono tiny' }, [
        el('div', {}, [`Demanda: ${formatDateBR(d.data_inicio)} - ${formatDateBR(d.data_fim)}`]),
        timelineLabels.length ? el('div', { class:'muted' }, [`Atuação: ${timelineLabels.map(x => (x.match(/\(([^)]+)\)/)?.[1] || '')).filter(Boolean).join(' | ') || '-'}`]) : null
      ].filter(Boolean)));
      tr.appendChild(el('td', { class:'mono' }, [timelineLabels.length ? timelineLabels.map(x => x.split(': ').pop()).join(' | ') : decimalHoursToHHMM(primaryAlloc.horas_planejadas_dia ?? d.horas_planejadas_dia ?? d.horas_dia ?? 0)]));
      tr.appendChild(el('td', {}, [d.prioridade || '-']));
      const st = effectiveStatus(d);
      tr.appendChild(el('td', {}, [statusPill(d)]));
      tb.appendChild(tr);
    }

    if (demands.length === 0) {
      tb.appendChild(el('tr', {}, [el('td', { colspan:'7', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Nenhuma demanda para este filtro.'])]));
    }

    t.appendChild(tb);
    return t;
  };

  const openDonutModal = (status) => {
    const modal = qs('#donutModal');
    const title = qs('#donutModalTitle');
    const sub = qs('#donutModalSub');
    const body = qs('#donutModalBody');

    const list = filterDemands({
      status,
      resourceId: uiFilters.demandResourceId,
      dateStart: uiFilters.demandDateStart,
      dateEnd: uiFilters.demandDateEnd,
      titleQuery: getDemandTitleFilter('demands')
    });
    // sempre começa na primeira página ao abrir o modal
    uiPagination.donutModalPage = 1;

    const renderModal = () => {
      title.textContent = `Demandas - ${status}`;
      sub.textContent = `${list.length} demanda(s) ? clique em "Ir para Demandas" para aplicar filtro na tela`;

      body.innerHTML = '';

      const activePills = buildFilterPills({ includeClear:false });
      if (activePills) {
        body.appendChild(el('div', { class:'tiny muted', style:'margin-bottom:6px' }, ['Filtros ativos (além do status clicado):']));
        body.appendChild(activePills);
        body.appendChild(el('div', { style:'height:8px' }));
      }

      body.appendChild(el('div', { class:'row', style:'margin-bottom:10px' }, [
        button('Ir para Demandas (aplicar filtro)', 'primary', () => {
          uiFilters.demandStatus = status;
          uiPagination.demandsPage=1;
          activeTab = 'demands';
          uiFilters.focusDemandsList = true;
          modal.close();
          render();
        }),
        button('Limpar filtro', '', () => {
          uiFilters.demandStatus = '';
          uiFilters.demandResourceId = '';
          uiFilters.demandDateStart = '';
          uiFilters.demandDateEnd = '';
          setDemandTitleFilter('demands', '');
          toast('Filtro limpo.');
          render();
        })
      ]));

      const total = list.length;
      const totalPages = Math.max(1, Math.ceil(total / MODAL_DEMANDS_PAGE_SIZE));
      uiPagination.donutModalPage = Math.min(Math.max(1, uiPagination.donutModalPage), totalPages);
      const startIdx = (uiPagination.donutModalPage - 1) * MODAL_DEMANDS_PAGE_SIZE;
      const pageItems = list.slice(startIdx, startIdx + MODAL_DEMANDS_PAGE_SIZE);

      body.appendChild(renderDemandsTable(pageItems, { compact:true, resourceId:uiFilters.demandResourceId }));

      if (total > MODAL_DEMANDS_PAGE_SIZE) {
        body.appendChild(buildPager({
          page: uiPagination.donutModalPage,
          totalPages,
          total,
          startIdx,
          shown: pageItems.length,
          onPrev: () => { uiPagination.donutModalPage--; renderModal(); },
          onNext: () => { uiPagination.donutModalPage++; renderModal(); },
          onFirst: () => { uiPagination.donutModalPage = 1; renderModal(); },
          onLast: () => { uiPagination.donutModalPage = totalPages; renderModal(); },
        }));
      }
    };

    renderModal();
    if (!modal.open) openDialog(modal);
  };

  // close button
  setTimeout(() => {
    const closeBtn = qs('#donutModalClose');
    if (closeBtn && !closeBtn.__bound) {
      closeBtn.__bound = true;
      closeBtn.addEventListener('click', () => qs('#donutModal')?.close());
    }
  }, 0);

  const toast = (msg) => {
    const el = qs('#toast');
    const openDialogs = qsa('dialog[open]');
    const topDialog = openDialogs.length ? openDialogs[openDialogs.length - 1] : null;
    if (topDialog && !topDialog.contains(el)) {
      topDialog.appendChild(el);
    } else if (!topDialog && el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  };

  const defaultState = () => ({
    resources: [],
    demands: [],
    internalActivities: [],
    blockings: [],
    holidays: [],
    reprogrammings: [],
    overtimes: [],
    events: []
  });

  // ----------------------
  // Status (padrão)
  // ----------------------
  const STATUS = ['Em andamento','Atrasada','Concluída','Cancelada','Mapeada','Congelada'];
  const STATUS_COUNTS_IN_ALLOCATION = new Set(['Em andamento','Atrasada']);

  const normalizeStatus = (s) => {
    const v = String(s||'').trim();
    if (!v) return 'Mapeada';
    // compatibilidade com versões anteriores
    if (v.toLowerCase() === 'planejada') return 'Mapeada';
    if (v.toLowerCase() === 'em andamento') return 'Em andamento';
    if (v.toLowerCase() === 'concluída' || v.toLowerCase() === 'concluida') return 'Concluída';
    if (v.toLowerCase() === 'cancelada' || v.toLowerCase() === 'cancelado' || v.toLowerCase() === 'cancelada') return 'Cancelada';
    if (v.toLowerCase() === 'suspensa') return 'Congelada';
    if (v.toLowerCase() === 'atrasada') return 'Atrasada';
    if (v.toLowerCase() === 'mapeada') return 'Mapeada';
    if (v.toLowerCase() === 'congelada') return 'Congelada';
    return v;
  };

  // ----------------------
  // Status derivado: Atrasada (automático por prazo)
  // Regra: se HOJE > data_fim e status base não ? Concluída/Congelada, então fica Atrasada.
  // Importante: HOJE ? calculado em DATA LOCAL (não UTC) para evitar virar "amanh?" antes da hora no Brasil.
  // ----------------------
  const todayISO = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2,'0');
    const d = String(now.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  };


  // ----------------------
  // Execution Layer ? Apontamentos de Atividades e Métricas (v0.2.3)
  // ----------------------
  const PROJECT_STEP_OPTIONS = [
    'ARI', 'PV', 'ANR', 'QI', 'QO', 'QP', 'RP', 'ERU', 'URS', 'RTM',
    'Revisão', 'Reunião', 'Execução de Teste', 'Correção', 'Evidência', 'Outro'
  ];

  const normalizeProjectStep = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const found = PROJECT_STEP_OPTIONS.find(x => x.toLowerCase() === raw.toLowerCase());
    return found || raw;
  };

  const parseHoursInput = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return NaN;
    const hhmm = raw.match(/^(\d{1,2}):([0-5]\d)$/);
    if (hhmm) {
      const hh = Number(hhmm[1] || 0);
      const mm = Number(hhmm[2] || 0);
      return Math.round((hh + (mm / 60)) * 100) / 100;
    }
    const normalized = raw.replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };
  const parseApontamentoHours = (value) => parseHoursInput(value);

  const decimalHoursToHHMM = (value) => {
    const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const isISODateString = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());

  const sortApontamentosChronological = (items=[]) => [...items].sort((a,b) => {
    const d = String(a.data || '').localeCompare(String(b.data || ''));
    if (d !== 0) return d;
    return Number(a.created_at || 0) - Number(b.created_at || 0);
  });

  const normalizeApontamento = (item={}) => {
    const now = Date.now();
    const createdAt = Number(item.created_at || item.createdAt || now);
    const horas = parseApontamentoHours(item.horas);
    return {
      id: String(item.id || generateId('apt')),
      data: String(item.data || todayISO()).trim(),
      etapa: normalizeProjectStep(item.etapa || item.tipo || 'Outro'),
      horas: Number.isFinite(horas) && horas > 0 ? horas : 0,
      observacao: String(item.observacao || item['observacoes'] || item.obs || '').trim(),
      usuario: String(item.usuario || item.user || item.created_by || userName || 'Sessão local').trim(),
      user_id: String(item.user_id || item.userId || userId || '').trim(),
      created_at: createdAt,
      updated_at: Number(item.updated_at || item.updatedAt || createdAt),
      updated_by: String(item.updated_by || item.updatedBy || item.usuario || userName || 'Sessão local').trim(),
      updated_by_id: String(item.updated_by_id || item.updatedById || item.user_id || userId || '').trim(),
    };
  };

  const normalizeDemandApontamentos = (demand={}) => {
    const list = Array.isArray(demand.apontamentos) ? demand.apontamentos : [];
    return sortApontamentosChronological(list.map(normalizeApontamento).filter(a => a.data && a.etapa && Number(a.horas) > 0));
  };

  const demandExecutionMetrics = (demand={}, apontamentosOverride=null) => {
    const apontamentos = Array.isArray(apontamentosOverride) ? normalizeDemandApontamentos({ apontamentos: apontamentosOverride }) : normalizeDemandApontamentos(demand);
    const realHours = Math.round(apontamentos.reduce((acc, a) => acc + Number(a.horas || 0), 0) * 100) / 100;

    const start = String(demand.data_inicio || '').trim();
    const end = String(demand.data_fim || '').trim();
    const resourceId = String(demand.responsavel_id || '').trim();
    const allocations = demandAllocations(demand);
    const primaryAlloc = allocations.find(a => String(a.resourceId || '') === resourceId) || allocations[0] || {};

    let plannedDays = 0;
    let plannedHoursAcc = 0;
    if (isISODateString(start) && isISODateString(end) && start <= end) {
      let cursor = isoToLocalMidnight(start);
      const limit = isoToLocalMidnight(end);
      while (cursor && limit && cursor.getTime() <= limit.getTime()) {
        const dateStr = formatDate(cursor);
        const baseEligible = !isWeekend(cursor) && !isHoliday(dateStr);
        let dayHours = 0;
        if (baseEligible) {
          if (allocations.length) {
            for (const allocation of allocations) {
              const rid = String(allocation.resourceId || '').trim();
              if (!rid || !demandAllocationActiveOnDate(allocation, demand, dateStr)) continue;
              if (nonWorkingReasonForDay(rid, cursor)) continue;
              dayHours += demandAllocationHoursForDate(allocation, rid, cursor, state.resources || []);
            }
          } else {
            const rid = String(primaryAlloc.resourceId || resourceId || '').trim();
            if (!rid || !nonWorkingReasonForDay(rid, cursor)) {
              dayHours += demandAllocationHoursForDate(primaryAlloc, rid, cursor, state.resources || []);
            }
          }
        }
        if (dayHours > 0) {
          plannedDays++;
          plannedHoursAcc += dayHours;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const plannedHours = Math.round(plannedHoursAcc * 100) / 100;
    const delta = Math.round((plannedHours - realHours) * 100) / 100; // saldo: horas planejadas restantes; negativo = acima do planejado
    const progressPct = plannedHours > 0 ? Math.round((realHours / plannedHours) * 1000) / 10 : (realHours > 0 ? 100 : 0);
    const efficiencyPct = plannedHours > 0 ? Math.round((realHours / plannedHours) * 1000) / 10 : null;

    let trend = 'Sem dados suficientes';
    let trendTone = 'neutral';
    if (plannedHours > 0) {
      if (realHours > plannedHours) { trend = 'Estourado'; trendTone = 'danger'; }
      else if (realHours >= plannedHours * 0.9) { trend = 'Atenção'; trendTone = 'warn'; }
      else if (realHours > 0) { trend = 'Dentro do planejado'; trendTone = 'ok'; }
      else { trend = 'Não iniciado'; trendTone = 'neutral'; }
    }

    return {
      plannedHours,
      realHours,
      delta,
      progressPct,
      efficiencyPct,
      trend,
      trendTone,
      plannedDays,
      apontamentosCount: apontamentos.length,
      windowSummary: demandApontamentoWindowSummary(demand, apontamentos),
      windowClassification: demandWindowClassification(demand, apontamentos),
    };
  };


  // Dashboard Operacional (v0.3.0) ? leitura gerencial das horas reais apontadas.
  // Não altera capacidade planejada; apenas consolida apontamentos já registrados nas demandas.
  const buildOperationalDashboardModel = (demands=[], periodStart='', periodEnd='') => {
    const inPeriod = (dateStr) => {
      const d = String(dateStr || '').trim();
      if (!isISODateString(d)) return false;
      if (periodStart && d < periodStart) return false;
      if (periodEnd && d > periodEnd) return false;
      return true;
    };
    const addHours = (map, key, horas, meta={}) => {
      const k = String(key || 'Não informado').trim() || 'Não informado';
      if (!map.has(k)) map.set(k, { label:k, horas:0, count:0, ...meta });
      const item = map.get(k);
      item.horas = Math.round((Number(item.horas || 0) + Number(horas || 0)) * 100) / 100;
      item.count = Number(item.count || 0) + 1;
      Object.assign(item, meta);
      return item;
    };
    const weekStartKey = (iso) => {
      const d = isoToLocalMidnight(iso);
      if (!d) return 'Sem semana';
      const day = d.getDay(); // 0 domingo
      const diff = day === 0 ? -6 : 1 - day; // segunda-feira
      d.setDate(d.getDate() + diff);
      return formatDate(d);
    };

    const byStep = new Map();
    const byUser = new Map();
    const byWeek = new Map();
    const byDemand = new Map();
    const bottlenecks = [];
    let totalRealHours = 0;
    let totalApontamentos = 0;
    let lastApontamento = null;

    for (const demand of (demands || [])) {
      const apontamentos = normalizeDemandApontamentos(demand).filter(a => inPeriod(a.data));
      const realHoursDemand = Math.round(apontamentos.reduce((acc,a)=>acc+Number(a.horas||0),0) * 100) / 100;
      if (realHoursDemand > 0) {
        addHours(byDemand, demand.id || demand.titulo || 'Demanda', realHoursDemand, {
          title: demand.titulo || demand.id || 'Demanda',
          demandId: demand.id || ''
        });
      }

      for (const a of apontamentos) {
        const h = Number(a.horas || 0);
        totalRealHours = Math.round((totalRealHours + h) * 100) / 100;
        totalApontamentos += 1;
        addHours(byStep, normalizeProjectStep(a.etapa || 'Outro'), h);
        addHours(byUser, a.usuario || a.updated_by || 'Sessão local', h);
        addHours(byWeek, weekStartKey(a.data), h, { label: `Semana de ${formatDateBR(weekStartKey(a.data))}` });
        if (!lastApontamento || String(a.data) > String(lastApontamento.data) || (String(a.data) === String(lastApontamento.data) && Number(a.created_at||0) > Number(lastApontamento.created_at||0))) {
          lastApontamento = { ...a, demandTitle: demand.titulo || demand.id || 'Demanda' };
        }
      }

      const allMetrics = demandExecutionMetrics(demand);
      if (allMetrics.plannedHours > 0 && allMetrics.realHours > 0) {
        const ratio = allMetrics.realHours / allMetrics.plannedHours;
        if (ratio >= 0.9) {
          bottlenecks.push({
            title: demand.titulo || demand.id || 'Demanda',
            plannedHours: allMetrics.plannedHours,
            realHours: allMetrics.realHours,
            pct: Math.round(ratio * 1000) / 10,
            tone: ratio > 1 ? 'Estourado' : 'Atenção'
          });
        }
      }
    }

    const sortHoursDesc = (arr) => arr.sort((a,b) => Number(b.horas||0) - Number(a.horas||0));
    return {
      periodStart,
      periodEnd,
      totalRealHours,
      totalApontamentos,
      byStep: sortHoursDesc([...byStep.values()]),
      byUser: sortHoursDesc([...byUser.values()]),
      byWeek: [...byWeek.values()].sort((a,b)=>String(a.label).localeCompare(String(b.label))),
      byDemand: sortHoursDesc([...byDemand.values()]),
      bottlenecks: bottlenecks.sort((a,b)=>Number(b.pct||0)-Number(a.pct||0)),
      lastApontamento,
    };
  };

  const validateApontamentoInput = ({ data, etapa, horas }, demand={}) => {
    const dateValidation = validateDateYearLimit(data, 'Data do apontamento');
    if (dateValidation) return dateValidation;
    if (!isISODateString(data)) return 'Informe uma data válida para o apontamento.';
    if (!normalizeProjectStep(etapa)) return 'Informe a etapa do projeto.';
    if (!Number.isFinite(horas) || horas <= 0) return 'Informe horas gastas maior que zero.';
    if (horas > 24) return 'Horas gastas não pode ser maior que 24h em um único apontamento.';
    return '';
  };

  const apontamentoWindowFlags = (demand={}, apontamento={}) => {
    const data = String(apontamento?.data || '').trim();
    const start = String(demand?.data_inicio || '').trim();
    const end = String(demand?.data_fim || '').trim();
    return {
      early: !!(isISODateString(data) && isISODateString(start) && data < start),
      late: !!(isISODateString(data) && isISODateString(end) && data > end),
    };
  };

  const demandApontamentoWindowSummary = (demand={}, apontamentosOverride=null) => {
    const apontamentos = Array.isArray(apontamentosOverride) ? normalizeDemandApontamentos({ apontamentos: apontamentosOverride }) : normalizeDemandApontamentos(demand);
    const early = apontamentos.filter(a => apontamentoWindowFlags(demand, a).early);
    const late = apontamentos.filter(a => apontamentoWindowFlags(demand, a).late);
    return {
      earlyCount: early.length,
      lateCount: late.length,
      earlyHours: Math.round(early.reduce((acc,a)=>acc+Number(a.horas||0),0) * 100) / 100,
      lateHours: Math.round(late.reduce((acc,a)=>acc+Number(a.horas||0),0) * 100) / 100,
      hasEarly: early.length > 0,
      hasLate: late.length > 0,
    };
  };

  const diffDaysISO = (start, end) => {
    const a = isoToLocalMidnight(start);
    const b = isoToLocalMidnight(end);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  };

  const demandWindowClassification = (demand={}, apontamentosOverride=null) => {
    const baselineStart = String(demand.baseline_inicio || demand.data_inicio || '').trim();
    const baselineEnd = String(demand.baseline_fim || demand.data_fim || '').trim();
    const currentStart = String(demand.data_inicio || '').trim();
    const currentEnd = String(demand.data_fim || '').trim();
    const summary = demandApontamentoWindowSummary(demand, apontamentosOverride);
    const exceedsPlannedWindow = !!(isISODateString(baselineEnd) && isISODateString(currentEnd) && currentEnd > baselineEnd);
    const startsAfterBaseline = !!(isISODateString(baselineStart) && isISODateString(currentStart) && currentStart > baselineStart);
    const startsBeforeBaseline = !!(isISODateString(baselineStart) && isISODateString(currentStart) && currentStart < baselineStart);
    const exceededDays = exceedsPlannedWindow ? Math.max(0, diffDaysISO(baselineEnd, currentEnd)) : 0;
    const labels = [];
    if (exceedsPlannedWindow) labels.push('Janela excedente do programado');
    if (summary.hasEarly) labels.push('Execução antecipada');
    if (summary.hasLate) labels.push('Execução fora do prazo atual');
    return {
      baselineStart,
      baselineEnd,
      currentStart,
      currentEnd,
      exceedsPlannedWindow,
      exceededDays,
      startsAfterBaseline,
      startsBeforeBaseline,
      hasEarlyExecution: summary.hasEarly,
      hasLateExecution: summary.hasLate,
      earlyCount: summary.earlyCount,
      lateCount: summary.lateCount,
      earlyHours: summary.earlyHours,
      lateHours: summary.lateHours,
      labels,
      severity: (exceedsPlannedWindow || summary.hasLate) ? 'warn' : (summary.hasEarly ? 'info' : 'ok'),
    };
  };

  const isoToLocalMidnight = (iso) => {
    const s = String(iso||'').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  };

  const daysLate = (demand) => {
    const prazo = (demand?.data_fim||'').trim();
    if (!prazo) return 0;
    const t = todayISO();
    if (t <= prazo) return 0;
    const a = isoToLocalMidnight(prazo);
    const b = isoToLocalMidnight(t);
    if (!a || !b) return 0;
    const diff = Math.floor((b.getTime() - a.getTime()) / 86400000);
    return Math.max(1, diff);
  };

  const effectiveStatus = (demand) => {
    const base = normalizeStatus(demand?.status);
    // Concluída, Cancelada e Congelada nunca viram atrasadas automaticamente
    if (base === 'Concluída' || base === 'Cancelada' || base === 'Congelada') return base;
    const prazo = (demand?.data_fim||'').trim();
    // Atrasada começa no DIA SEGUINTE ao prazo (HOJE > data_fim)
    if (prazo && todayISO() > prazo) return 'Atrasada';
    return base;
  };

  const timestampToLocalISO = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    const dt = new Date(n);
    if (Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const demandCompletionActionDate = (demand) => {
    if (normalizeStatus(demand?.status) !== 'Concluída') return '';
    const explicitDate = normalizeDateLikeToISO(
      demand?.status_action_date ||
      demand?.completed_at ||
      demand?.completion_date ||
      demand?.data_conclusao ||
      demand?.data_conclusão ||
      ''
    );
    return explicitDate || timestampToLocalISO(demand?.status_changed_at || demand?.last_edit_at || demand?.updatedAt || demand?.updated_at);
  };

  const demandCompletionInfo = (demand) => {
    const isCompleted = normalizeStatus(demand?.status) === 'Concluída';
    const completionDate = demandCompletionActionDate(demand);
    const currentDeadline = String(demand?.data_fim || demand?.end || '').trim();
    const originalDeadline = String(demand?.baseline_fim || demand?.prazo_original || currentDeadline || '').trim();
    const reprogrammings = relatedDemandReprogrammings(demand, state.reprogrammings);
    const wasPostponed = reprogrammings.length > 0 || (isISODateString(originalDeadline) && isISODateString(currentDeadline) && currentDeadline > originalDeadline);
    const referenceDeadline = currentDeadline || originalDeadline;
    let classification = isCompleted ? 'Concluída sem prazo informado' : 'Não concluída';
    let daysDelta = '';
    if (isCompleted && isISODateString(completionDate) && isISODateString(referenceDeadline)) {
      const diff = diffDaysISO(referenceDeadline, completionDate);
      daysDelta = diff;
      if (diff <= 0) classification = wasPostponed ? 'Concluída no prazo após postergação' : 'Concluída no prazo';
      else classification = wasPostponed ? 'Concluída fora do prazo após postergação' : 'Concluída fora do prazo';
    } else if (isCompleted && completionDate) {
      classification = wasPostponed ? 'Concluída após postergação' : 'Concluída';
    }
    return {
      isCompleted,
      completionDate,
      completionDateBR: completionDate ? formatDateBR(completionDate) : '',
      currentDeadline,
      originalDeadline,
      referenceDeadline,
      wasPostponed,
      reprogrammingsCount: reprogrammings.length,
      classification,
      daysDelta,
    };
  };

  const demandFinalStatusInfo = (demand) => {
    const status = normalizeStatus(demand?.status);
    const isFinal = status === 'Concluída' || status === 'Cancelada';
    if (!isFinal) return { isFinal:false, status };
    const actionDate = normalizeDateLikeToISO(
      demand?.status_action_date ||
      (status === 'Concluída' ? (demand?.completed_at || demand?.completion_date || demand?.data_conclusao || demand?.data_conclusão) : '') ||
      ''
    ) || timestampToLocalISO(demand?.status_changed_at || demand?.last_edit_at || demand?.updatedAt || demand?.updated_at);
    const actor = String(demand?.status_changed_by || demand?.last_edit_by || demand?.updated_by || demand?.updatedBy || '').trim();
    const actorId = String(demand?.status_changed_by_id || demand?.updated_by_id || demand?.updatedById || '').trim();
    const reason = String(demand?.status_reason || demand?.last_edit_justification || '').trim();
    const actionLabel = status === 'Cancelada' ? 'cancelada' : 'concluída';
    return {
      isFinal,
      status,
      actionLabel,
      buttonLabel: `Demanda ${actionLabel}`,
      actionDate,
      actionDateBR: actionDate ? formatDateBR(actionDate) : '',
      actor,
      actorId,
      reason,
    };
  };

  const openDemandFinalStatusDetailsModal = (demand) => {
    const info = demandFinalStatusInfo(demand);
    if (!info.isFinal) return;
    const dlg = qs('#demandStatusModal');
    if (!dlg) return;
    qs('#demandStatusModalTitle').textContent = info.status === 'Cancelada' ? 'Demanda cancelada' : 'Demanda concluída';
    qs('#demandStatusModalSub').textContent = demand?.titulo || demand?.id || 'Detalhes da demanda';
    const body = qs('#demandStatusModalBody');
    body.innerHTML = '';
    const detailRow = (label, value) => el('div', { style:'border:1px solid var(--border);border-radius:14px;padding:10px;background:var(--surface)' }, [
      el('div', { class:'tiny muted' }, [label]),
      el('div', { style:'font-weight:900;margin-top:3px;white-space:pre-wrap;word-break:break-word' }, [value || '-'])
    ]);
    body.appendChild(el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'hint' }, [
        el('b', {}, [demand?.titulo || 'Demanda']),
        el('div', { class:'tiny muted', style:'margin-top:4px' }, [`Status atual: ${info.status}`])
      ]),
      el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px' }, [
        detailRow('Quando', info.actionDateBR || info.actionDate),
        detailRow('Quem', info.actorId ? `${info.actor} (${info.actorId})` : info.actor),
        detailRow('Situação', info.status),
      ]),
      detailRow('Justificativa', info.reason),
      el('div', { class:'row end' }, [button('Fechar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } })])
    ]));
    openDialog(dlg);
  };

  const demandCountsInAllocationOnDate = (demand, dateStr) => {
    const st = effectiveStatus(demand);
    if (STATUS_COUNTS_IN_ALLOCATION.has(st)) return true;
    if (st !== 'Concluída') return false;

    // Demandas concluídas mantêm o histórico de alocação somente até a véspera
    // da conclusão. No dia da conclusão a janela já fica livre para nova demanda.
    const completionDate = demandCompletionActionDate(demand);
    return !!completionDate && String(dateStr || '') < completionDate;
  };

  const demandAppearsInHeatmapOnDate = (demand, dateStr) => {
    const date = String(dateStr || '').trim();
    if (!date) return false;
    if (demandCountsInAllocationOnDate(demand, date)) return true;
    if (effectiveStatus(demand) !== 'Concluída') return false;

    // Mantém o registro visual da demanda concluída nos cards/drilldowns do
    // heatmap até a data de conclusão, sem continuar consumindo capacidade.
    const completionDate = demandCompletionActionDate(demand);
    return !!completionDate && date === completionDate;
  };

  const demandAppearsInHeatmapRange = (demand, rangeStart='', rangeEnd='') => {
    if (!demandHistoricalWindowOverlapsRange(demand, rangeStart, rangeEnd)) return false;
    const st = effectiveStatus(demand);
    if (STATUS_COUNTS_IN_ALLOCATION.has(st)) return true;
    if (st !== 'Concluída') return false;

    const completionDate = demandCompletionActionDate(demand);
    if (!completionDate) return false;
    const historicalStart = demandHistoricalStart(demand) || normalizeDateLikeToISO(demand?.data_inicio || '') || completionDate;
    const historicalEnd = demandHistoricalEnd(demand) || normalizeDateLikeToISO(demand?.data_fim || '') || completionDate;
    const visibleEnd = historicalEnd && historicalEnd < completionDate ? historicalEnd : completionDate;
    return overlapsRange(historicalStart, visibleEnd, rangeStart, rangeEnd) || demandHasActualWorkInRange(demand, rangeStart, rangeEnd);
  };

  const overdueTooltip = (demand) => {
    const dl = daysLate(demand);
    if (!dl) return '';
    const prazo = formatDateBR(demand.data_fim);
    return `Atrasada há ${dl} dia(s). Prazo: ${prazo}. (Status automático)`;
  };



  ({displayName: userName, userId} = loadUserIdentity());

  let activeTab = 'dashboard';

  // filtros de UI (não persistidos)
  const uiFilters = {
    demandStatus: '', // '', 'Em andamento', 'Atrasada', 'Concluída', 'Mapeada', 'Congelada'
    demandResourceId: '', // '', resourceId, '__NONE__'
    demandDateStart: '', // YYYY-MM-DD
    demandDateEnd: '',   // YYYY-MM-DD
    dashboardDemandTitle: '',  // pesquisa por título no Visão Geral
    evaluationDemandTitle: '', // pesquisa por projeto no Apontamentos
    demandsDemandTitle: '',    // pesquisa por título na aba Demandas
    focusDemandsList: false,
    focusDemandsForm: false,
    prefillDemand: null, // { responsavel_id, data_inicio, data_fim }
  };

  const DEMAND_CREATE_DRAFT_KEY = 'capview_demand_create_draft_v1';

  const normalizeDemandCreateDraft = (draft) => {
    if (!draft || typeof draft !== 'object') return null;
    const responsavelIds = Array.isArray(draft.responsavelIds)
      ? [...new Set(draft.responsavelIds.map(id => String(id || '').trim()).filter(Boolean))]
      : [];
    const respHoursById = {};
    const respStartById = {};
    const respEndById = {};
    const respDailyById = {};
    const hoursSource = draft.respHoursById && typeof draft.respHoursById === 'object' ? draft.respHoursById : {};
    const startSource = draft.respStartById && typeof draft.respStartById === 'object' ? draft.respStartById : {};
    const endSource = draft.respEndById && typeof draft.respEndById === 'object' ? draft.respEndById : {};
    const dailySource = draft.respDailyById && typeof draft.respDailyById === 'object' ? draft.respDailyById : {};
    const pctSource = draft.respPctById && typeof draft.respPctById === 'object' ? draft.respPctById : {};
    for (const rid of responsavelIds) {
      const rawHours = parseHoursLikeToDecimal(hoursSource[rid]);
      if (rawHours !== null) respHoursById[rid] = rawHours;
      else {
        const rawPct = Number(pctSource[rid] ?? 100);
        respHoursById[rid] = percentToDemandHours(Number.isFinite(rawPct) ? rawPct : 100, rid, state?.resources || []);
      }
      respStartById[rid] = normalizeDateLikeToISO(startSource[rid] || '') || String(draft.data_inicio || '');
      respEndById[rid] = normalizeDateLikeToISO(endSource[rid] || '') || String(draft.data_fim || '');
      respDailyById[rid] = normalizeAllocationDailyHours(dailySource[rid] || {});
    }
    return {
      titulo: String(draft.titulo || ''),
      predio: String(draft.predio || ''),
      focal: String(draft.focal || ''),
      data_inicio: String(draft.data_inicio || ''),
      data_fim: String(draft.data_fim || ''),
      prioridade: String(draft.prioridade || 'Média'),
      status: normalizeStatus(draft.status || (responsavelIds.length ? 'Em andamento' : 'Mapeada')),
      observacoes: String(draft.observacoes || ''),
      responsavelIds,
      respHoursById,
      respStartById,
      respEndById,
      respDailyById,
      updatedAt: Number(draft.updatedAt || Date.now()),
    };
  };

  const hasMeaningfulDemandCreateDraft = (draft) => {
    const d = normalizeDemandCreateDraft(draft);
    if (!d) return false;
    return !!(
      d.titulo.trim() ||
      d.predio.trim() ||
      d.focal.trim() ||
      d.data_inicio ||
      d.data_fim ||
      d.observacoes.trim() ||
      d.responsavelIds.length ||
      d.prioridade !== 'Média' ||
      d.status !== 'Mapeada'
    );
  };

  const loadDemandCreateDraft = () => {
    try {
      const raw = sessionStorage.getItem(DEMAND_CREATE_DRAFT_KEY);
      return raw ? normalizeDemandCreateDraft(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  const saveDemandCreateDraft = (draft) => {
    try {
      const normalized = normalizeDemandCreateDraft({ ...(draft || {}), updatedAt: Date.now() });
      if (!hasMeaningfulDemandCreateDraft(normalized)) {
        sessionStorage.removeItem(DEMAND_CREATE_DRAFT_KEY);
        return;
      }
      sessionStorage.setItem(DEMAND_CREATE_DRAFT_KEY, JSON.stringify(normalized));
    } catch (e) {
      console.warn('[ORIZON Draft] Falha ao salvar rascunho da demanda:', e);
    }
  };

  const clearDemandCreateDraft = () => {
    try { sessionStorage.removeItem(DEMAND_CREATE_DRAFT_KEY); } catch {}
  };

  // Busca por título sem perder foco: evita render() a cada tecla de forma destrutiva.
  let demandTitleSearchTimer = null;
  let demandTitleSearchFocus = null;

  const restoreDemandTitleSearchFocus = () => {
    if (!demandTitleSearchFocus || !demandTitleSearchFocus.id) return;
    const info = demandTitleSearchFocus;
    demandTitleSearchFocus = null;
    const inp = document.getElementById(info.id);
    if (!inp) return;
    try {
      inp.focus();
      const len = String(inp.value || '').length;
      const start = Math.min(Number(info.start ?? len), len);
      const end = Math.min(Number(info.end ?? start), len);
      if (typeof inp.setSelectionRange === 'function') inp.setSelectionRange(start, end);
    } catch {}
  };

  const demandTitleFilterKey = (scope = 'demands') => ({
    dashboard: 'dashboardDemandTitle',
    evaluation: 'evaluationDemandTitle',
    demands: 'demandsDemandTitle'
  }[scope] || 'demandsDemandTitle');

  const getDemandTitleFilter = (scope = 'demands') => uiFilters[demandTitleFilterKey(scope)] || '';
  const setDemandTitleFilter = (scope = 'demands', value = '') => {
    uiFilters[demandTitleFilterKey(scope)] = value || '';
  };

  const bindDemandTitleSearch = (inputEl, inputId, pageKey = 'demandsPage', tabKey = null, scope = null) => {
    const filterScope = scope || tabKey || 'demands';
    inputEl.id = inputId;
    inputEl.value = getDemandTitleFilter(filterScope);
    inputEl.addEventListener('input', () => {
      setDemandTitleFilter(filterScope, inputEl.value || '');
      if (pageKey && uiPagination[pageKey] !== undefined) uiPagination[pageKey] = 1;
      if (tabKey) activeTab = tabKey;
      demandTitleSearchFocus = {
        id: inputId,
        start: inputEl.selectionStart,
        end: inputEl.selectionEnd
      };
      clearTimeout(demandTitleSearchTimer);
      demandTitleSearchTimer = setTimeout(() => {
        requestAnimationFrame(() => {
          render();
          requestAnimationFrame(restoreDemandTitleSearchFocus);
        });
      }, 120);
    });
  };

  // paginação (não persistida)
  let editingInternalActivityId = '';
  let launchMode = 'demand';
  let launchDemandId = '';
  let editingLaunchApontamentoId = '';
  let dailyExecutionUnlocked = false;
  let dailyExecutionDate = todayISO();
  let dailyExecutionStartDate = todayISO();
  let dailyExecutionEndDate = todayISO();
  const DAILY_EXECUTION_PASSWORD = 'CAPVIEW';

  const uiPagination = {
    demandsPage: 1,
    resourcesPage: 1,
    dashboardPerResourcePage: 1,
    dashboardSheetPage: 1,
    evaluationPage: 1,
    blockingsPage: 1,
    holidaysPage: 1,
    internalActivitiesPage: 1,
    launchDemandApontamentosPage: 1,
    myDayPage: 1,
    // Modais
    donutModalPage: 1,
    dayModalPage: 1,
    // Janelas Livres
    windowsHeatPage: 1,   // Heatmap (Janelas por recurso x meses)
    windowsNextPage: 1,   // Próxima janela livre
  };


  const STATUS_COLORS = {
    'Em andamento': '#4F46E5',
    'Atrasada': '#E52525',
    'Concluída': '#1BAA55',
    'Cancelada': '#64748B',
    'Mapeada': '#9BAEC1',
    'Congelada': '#D28A00'
  };

  const hasAnyDemandFilters = () => {
    return !!(uiFilters.demandStatus || uiFilters.demandResourceId || uiFilters.demandDateStart || uiFilters.demandDateEnd || getDemandTitleFilter('demands'));
  };

  const buildFilterPills = ({ includeClear=true } = {}) => {
    const pills = [];

    if (uiFilters.demandStatus) {
      const st = uiFilters.demandStatus;
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:`background:${STATUS_COLORS[st]||'var(--indigo)'}` }),
        `Status: ${st}`,
        el('button', { class:'xbtn', title:'Remover filtro de status', onclick: () => { uiFilters.demandStatus=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (uiFilters.demandResourceId) {
      let label = 'Recurso';
      if (uiFilters.demandResourceId === '__NONE__') label = 'Sem responsável (Mapeada)';
      else {
        const r = (state.resources||[]).find(x => x.id === uiFilters.demandResourceId);
        label = r ? r.nome : 'Recurso';
      }
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--slate)' }),
        `Recurso: ${label}`,
        el('button', { class:'xbtn', title:'Remover filtro de recurso', onclick: () => { uiFilters.demandResourceId=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (getDemandTitleFilter('demands')) {
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--indigo)' }),
        `Título: ${getDemandTitleFilter('demands')}`,
        el('button', { class:'xbtn', title:'Remover pesquisa por título', onclick: () => { setDemandTitleFilter('demands', ''); uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (uiFilters.demandDateStart) {
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--indigo)' }),
        `De: ${uiFilters.demandDateStart}`,
        el('button', { class:'xbtn', title:'Remover data início do filtro', onclick: () => { uiFilters.demandDateStart=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (uiFilters.demandDateEnd) {
      pills.push(el('span', { class:'pill' }, [
        el('span', { class:'dot', style:'background:var(--indigo2)' }),
        `Até: ${uiFilters.demandDateEnd}`,
        el('button', { class:'xbtn', title:'Remover data fim do filtro', onclick: () => { uiFilters.demandDateEnd=''; uiPagination.demandsPage=1; render(); } }, ['×'])
      ]));
    }

    if (!pills.length) return null;

    const clearAll = () => {
      uiFilters.demandStatus = '';
      uiFilters.demandResourceId = '';
      uiFilters.demandDateStart = '';
      uiFilters.demandDateEnd = '';
      setDemandTitleFilter('demands', '');
      toast('Filtros limpos.');
      uiPagination.demandsPage=1;
      render();
    };

    return el('div', { class:'row' }, [
      ...pills,
      ...(includeClear ? [button('Limpar filtros', '', clearAll)] : [])
    ]); 
  };

  const disableEventModeForDbLoad = () => {
    try { stopEventAutoSync(); } catch {}
    capviewEventMode.enabled = false;
    capviewEventMode.folderName = '';
    capviewEventMode.lastStatus = 'Modo Eventos desligado ao carregar BD direto.';
    capviewEventMode.pendingReadCount = 0;
    capviewDataDirHandle = null;
    capviewEventsDirHandle = null;
    capviewSnapshotFileHandle = null;
    persistEventFolderMeta();
    resetAppliedEventControl();
  };

  let state = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeImportedState(JSON.parse(saved));
    } catch {}
    // Quando a base ? grande, o app não duplica o BD no localStorage.
    // Nesses casos, o usuário deve carregar/selecionar o JSON normalmente;
    // o marcador leve evita erro de quota, mas não tenta restaurar dados incompletos.
    return defaultState();
  })();

  // Cache de capacidade usado pelos gráficos da dashboard.
  // A chave usa uma versão simples, invalidada sempre que o estado operacional
  // muda. Isso evita recalcular recurso x dia x mês a cada renderização da tela.
  let dashboardCapacityCacheVersion = 0;
  const dashboardCapacityMonthCache = new Map();
  const dashboardCapacityYearCache = new Map();
  let capacityIndexCache = null;
  let capacityIndexCacheVersion = -1;
  const capacityFreeHoursInfoCache = new Map();
  const capacityMonthlyWindowCache = new Map();
  const capacityNextWindowCache = new Map();
  const cloneFreeHoursInfo = (info) => info ? ({
    ...info,
    overtime: info.overtime ? { ...info.overtime, items:[...(info.overtime.items || [])] } : info.overtime
  }) : info;
  const pushMapList = (map, key, item) => {
    const k = String(key || '').trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  };
  const buildCapacityIndexes = () => {
    const resourcesById = new Map((state.resources || []).map(r => [String(r.id || ''), r]));
    const holidaysByDate = new Set((state.holidays || []).map(h => String(h.data || '').trim()).filter(Boolean));
    const blockingsByResourceId = new Map();
    const blockingsByResourceDate = new Map();
    const globalBlockingsByDate = new Map();
    const globalBlockings = [];
    for (const b of (state.blockings || [])) {
      const rawIds = Array.isArray(b.ids) ? b.ids : [b.recurso_id || b.resourceId || b.resource_id || '__ALL__'];
      const ids = rawIds.map(String).filter(Boolean);
      const start = blockingStartDate(b);
      const end = blockingEndDate(b) || start;
      for (const id of ids) {
        const isGlobal = id === '__ALL__';
        if (isGlobal) globalBlockings.push(b);
        else pushMapList(blockingsByResourceId, id, b);
        if (start && end) {
          let cursor = start;
          let guard = 0;
          while (cursor && cursor <= end && guard < 3660) {
            if (isGlobal) pushMapList(globalBlockingsByDate, cursor, b);
            else pushMapList(blockingsByResourceDate, `${id}|${cursor}`, b);
            cursor = addDaysISO(cursor, 1);
            guard++;
          }
        }
      }
    }
    const overtimesByResourceDate = new Map();
    const globalOvertimesByDate = new Map();
    for (const o of (state.overtimes || [])) {
      const date = String(o.date ?? o.data ?? '').trim();
      if (!date) continue;
      const rid = String(o.resourceId ?? o.recurso_id ?? '__ALL__');
      if (rid === '__ALL__') pushMapList(globalOvertimesByDate, date, o);
      else pushMapList(overtimesByResourceDate, `${rid}|${date}`, o);
    }
    const demandEntriesByResourceId = new Map();
    const demandsByResourceId = new Map();
    for (const demand of (state.demands || [])) {
      const allocs = demandAllocations(demand);
      const allocsByResourceId = new Map();
      for (const a of allocs) {
        const rid = String(a.resourceId || '').trim();
        if (!rid || !resourcesById.has(rid)) continue;
        pushMapList(allocsByResourceId, rid, a);
      }
      for (const [rid, resourceAllocs] of allocsByResourceId.entries()) {
        pushMapList(demandEntriesByResourceId, rid, { demand, allocations:resourceAllocs });
        pushMapList(demandsByResourceId, rid, demand);
      }
    }
    return { resourcesById, holidaysByDate, blockingsByResourceId, blockingsByResourceDate, globalBlockingsByDate, globalBlockings, overtimesByResourceDate, globalOvertimesByDate, demandEntriesByResourceId, demandsByResourceId };
  };
  const getCapacityIndexes = () => {
    if (!capacityIndexCache || capacityIndexCacheVersion !== dashboardCapacityCacheVersion) {
      capacityIndexCache = buildCapacityIndexes();
      capacityIndexCacheVersion = dashboardCapacityCacheVersion;
    }
    return capacityIndexCache;
  };
  const invalidateDashboardCapacityCache = () => {
    dashboardCapacityCacheVersion += 1;
    dashboardCapacityMonthCache.clear();
    dashboardCapacityYearCache.clear();
    capacityFreeHoursInfoCache.clear();
    capacityMonthlyWindowCache.clear();
    capacityNextWindowCache.clear();
    capacityIndexCache = null;
    capacityIndexCacheVersion = -1;
  };

  /* migrate demands */
  try {
    state.demands = (state.demands||[]).map(d => {
      const st = effectiveStatus(d);
      const out = { ...d, status: st };
      // Mapeada = sempre sem responsável
      if (st === 'Mapeada') { out.responsavel_id = ''; out.responsavel = ''; }
      return out;
    });
  } catch {}

  // Autosync runtime: keeps localStorage fast while allowing safe queued DB saves.
  let dbAutoSyncEnabled = localStorage.getItem('capview_db_autosync_enabled') !== '0';
  let dbAutoSaveTimer = null;
  let dbAutoSaveRunning = false;
  let dbAutoSaveStartedAt = 0;
  let dbAutoSavePending = false;
  let dbAutoSaveDirtySince = 0;
  let dbWatcherTimer = null;
  let dbWatcherRunning = false;
  let suppressDbAutoSave = false;
  let dbLastSyncLabel = '';
  let dbAutoSyncPauseReason = localStorage.getItem('capview_db_autosync_pause_reason') || '';

  // V5.5.1 ? Modo Eventos por usuário (sem backend)
  const EVENT_MODE_KEY = 'capview_event_mode_enabled_v551';
  const EVENT_FOLDER_META_KEY = 'capview_event_folder_meta_v551';
  let capviewEventMode = {
    enabled: localStorage.getItem(EVENT_MODE_KEY) === '1',
    folderName: '',
    lastReadAt: '',
    lastWriteAt: '',
    lastStatus: '',
    pendingReadCount: 0,
    autoSyncEnabled: localStorage.getItem('capview_event_autosync_enabled_v560') !== '0',
    autoSyncMs: 4000,
    autoSyncRunning: false,
    autoSyncLastTickAt: '',
    autoSyncError: '',
  };
  try { capviewEventMode = { ...capviewEventMode, ...(JSON.parse(localStorage.getItem(EVENT_FOLDER_META_KEY)||'{}')||{}) }; } catch {}
  if (capviewEventMode.enabled && dbAutoSyncEnabled) {
    dbAutoSyncEnabled = false;
    dbAutoSyncPauseReason = '';
    try {
      localStorage.setItem('capview_db_autosync_enabled', '0');
      localStorage.removeItem('capview_db_autosync_pause_reason');
    } catch {}
  }
  let capviewDataDirHandle = null;
  let capviewEventsDirHandle = null;
  let capviewSnapshotFileHandle = null;

  // V5.7 ? Outbox local: se a pasta ainda não estiver selecionada ou se a gravação falhar,
  // o evento fica guardado no navegador e ? reenviado quando a pasta ORIZONData for vinculada.
  const EVENT_OUTBOX_KEY = 'capview_event_outbox_v570';
  const EVENT_OUTBOX_MAX = 500;
  let capviewEventWriteInFlight = false;
  let scannedEventUsers = [];
  let scannedEventDiagnostics = [];


  // V5.8 ? Controle local de eventos já vistos/aplicados.
  // O snapshot pode ainda não estar consolidado; por isso o app continua
  // aplicando todos os eventos pendentes para montar a tela, mas s? notifica
  // como "novo" o que ainda não foi visto nesta estação.
  const APPLIED_EVENTS_KEY = 'capview_applied_event_ids_v580';
  const APPLIED_EVENTS_MAX = 5000;

  const loadAppliedEventIds = () => {
    try {
      const arr = JSON.parse(localStorage.getItem(APPLIED_EVENTS_KEY) || '[]');
      return new Set((Array.isArray(arr) ? arr : []).map(String).filter(Boolean));
    } catch { return new Set(); }
  };

  const saveAppliedEventIds = (set) => {
    try {
      const arr = [...(set || new Set())].map(String).filter(Boolean).slice(-APPLIED_EVENTS_MAX);
      localStorage.setItem(APPLIED_EVENTS_KEY, JSON.stringify(arr));
    } catch {}
  };

  const markAppliedEvents = (events) => {
    const ids = loadAppliedEventIds();
    for (const ev of (Array.isArray(events) ? events : [])) {
      if (ev && ev.id) ids.add(String(ev.id));
    }
    saveAppliedEventIds(ids);
  };

  const resetAppliedEventControl = () => {
    try { localStorage.removeItem(APPLIED_EVENTS_KEY); } catch {}
  };

  const loadLocalEventOutbox = () => {
    try {
      const arr = JSON.parse(localStorage.getItem(EVENT_OUTBOX_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter(e => e && e.id).slice(-EVENT_OUTBOX_MAX) : [];
    } catch { return []; }
  };

  const saveLocalEventOutbox = (arr) => {
    try { localStorage.setItem(EVENT_OUTBOX_KEY, JSON.stringify((Array.isArray(arr) ? arr : []).filter(e => e && e.id).slice(-EVENT_OUTBOX_MAX))); } catch {}
  };

  const rememberLocalEventForSharedFile = (event) => {
    if (!event || !event.id) return;
    const arr = loadLocalEventOutbox();
    if (!arr.some(e => String(e.id) === String(event.id))) arr.push(event);
    saveLocalEventOutbox(arr);
  };

  const forgetLocalEventsFromOutbox = (ids) => {
    const idSet = new Set((ids || []).map(String));
    if (!idSet.size) return;
    saveLocalEventOutbox(loadLocalEventOutbox().filter(e => !idSet.has(String(e.id))));
  };

  const mergeEventListsUnique = (...lists) => {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const ev of (Array.isArray(list) ? list : [])) {
        if (!ev || !ev.id) continue;
        const id = String(ev.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(ev);
      }
    }
    return out.sort((a,b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  };

  const isConsolidatedEventReceipt = (event) =>
    !!(event && event.consolidated === true && !Object.prototype.hasOwnProperty.call(event, 'payload'));

  const compactConsolidatedEventReceipt = (event) => {
    if (!event || !event.id) return null;
    const receipt = {
      id: String(event.id),
      type: String(event.type || ''),
      timestamp: Number(event.timestamp || 0),
      user: String(event.user || ''),
      user_id: String(event.user_id || event.userId || ''),
      consolidated: true
    };
    if (event.sourceFile) receipt.sourceFile = String(event.sourceFile);
    if (Object.prototype.hasOwnProperty.call(event, 'payload')) {
      try { receipt.payloadHash = simpleHash(stableStringify(event.payload)); } catch {}
    } else if (event.payloadHash) {
      receipt.payloadHash = String(event.payloadHash);
    }
    return receipt;
  };

  const compactConsolidatedEventReceipts = (events=[]) =>
    mergeEventListsUnique(events).map(compactConsolidatedEventReceipt).filter(Boolean);

  const sharedFolderReady = () => !!(capviewEventMode.enabled && capviewDataDirHandle && capviewEventsDirHandle && capviewSnapshotFileHandle);
  const hasEventFolderIntent = () => !!(capviewEventMode.enabled || capviewEventMode.folderName || loadLocalEventOutbox().length);
  const eventFolderConnectionStatus = () => {
    if (sharedFolderReady()) {
      return {
        state: 'connected',
        label: 'Pasta de eventos conectada',
        detail: capviewEventMode.folderName || 'ORIZONData',
        actionLabel: 'Ver sincronização'
      };
    }
    if (hasEventFolderIntent()) {
      return {
        state: 'reconnect',
        label: 'Reconectar pasta de eventos',
        detail: capviewEventMode.folderName || 'ORIZONData',
        actionLabel: 'Reconectar pasta de eventos'
      };
    }
    return {
      state: 'disconnected',
      label: 'Conectar pasta de eventos',
      detail: 'ORIZONData',
      actionLabel: 'Conectar pasta de eventos'
    };
  };

  const persistEventFolderMeta = () => {
    try { localStorage.setItem(EVENT_MODE_KEY, capviewEventMode.enabled ? '1' : '0'); } catch {}
    try { localStorage.setItem(EVENT_FOLDER_META_KEY, JSON.stringify({
      folderName: capviewEventMode.folderName || '',
      lastReadAt: capviewEventMode.lastReadAt || '',
      lastWriteAt: capviewEventMode.lastWriteAt || '',
      lastStatus: capviewEventMode.lastStatus || '',
      pendingReadCount: Number(capviewEventMode.pendingReadCount || 0),
      autoSyncEnabled: capviewEventMode.autoSyncEnabled !== false,
      autoSyncMs: Number(capviewEventMode.autoSyncMs || 4000),
      autoSyncLastTickAt: capviewEventMode.autoSyncLastTickAt || '',
      autoSyncError: capviewEventMode.autoSyncError || '',
    })); } catch {}
    try { localStorage.setItem('capview_event_autosync_enabled_v560', capviewEventMode.autoSyncEnabled === false ? '0' : '1'); } catch {}
  };

  const setEventModeStatus = (msg) => {
    capviewEventMode.lastStatus = String(msg || '');
    persistEventFolderMeta();
    try { console.log('[ORIZON Eventos]', msg || ''); } catch {}
  };

  const isEventFolderRecoverableError = (e) => isDbHandleRecoverableError(e) || /directory|file|permission|not.?found|network|handle|pasta|arquivo/i.test(String(e?.message || ''));

  const markEventFolderDisconnected = (message='Pasta de eventos desconectada. Reconecte a pasta ORIZONData para voltar a sincronizar.') => {
    capviewEventMode.enabled = true;
    capviewEventMode.autoSyncError = String(message || '');
    setEventModeStatus(message);
    capviewDataDirHandle = null;
    capviewEventsDirHandle = null;
    capviewSnapshotFileHandle = null;
    try { stopEventAutoSync(); } catch {}
    persistEventFolderMeta();
    try { requestRenderSafely('event-folder-disconnected'); } catch { try { render(); } catch {} }
  };

  // V5.6 ? Autosync de eventos por pasta compartilhada.
  let capviewEventAutoSyncTimer = null;
  let capviewEventAutoSyncInFlight = false;
  let capviewEventAutoSyncDirty = false;

  const eventAutoSyncAvailable = () => !!(
    capviewEventMode.enabled &&
    capviewEventMode.autoSyncEnabled !== false &&
    capviewDataDirHandle &&
    capviewEventsDirHandle &&
    capviewSnapshotFileHandle
  );

  const stopEventAutoSync = () => {
    if (capviewEventAutoSyncTimer) clearInterval(capviewEventAutoSyncTimer);
    capviewEventAutoSyncTimer = null;
    capviewEventMode.autoSyncRunning = false;
    persistEventFolderMeta();
  };

  const eventAutoSyncTick = async (reason='timer') => {
    if (!eventAutoSyncAvailable()) return 0;
    if (document.hidden && reason === 'timer') return 0;
    if (capviewEventAutoSyncInFlight) { capviewEventAutoSyncDirty = true; return 0; }
    capviewEventAutoSyncInFlight = true;
    capviewEventMode.autoSyncRunning = true;
    capviewEventMode.autoSyncLastTickAt = new Date().toISOString();
    capviewEventMode.autoSyncError = '';
    persistEventFolderMeta();
    try {
      const count = await syncEventsFromFolder({ silent:true, source:'autosync' });
      if (count > 0) toast('Eventos sincronizados automaticamente: ' + count);
      return count;
    } catch (e) {
      capviewEventMode.autoSyncError = e?.message || 'Falha no autosync de eventos.';
      setEventModeStatus('Autosync eventos: ' + capviewEventMode.autoSyncError);
      return 0;
    } finally {
      capviewEventAutoSyncInFlight = false;
      capviewEventMode.autoSyncRunning = false;
      persistEventFolderMeta();
      if (capviewEventAutoSyncDirty) {
        capviewEventAutoSyncDirty = false;
        setTimeout(() => eventAutoSyncTick('dirty'), 250);
      }
    }
  };

  // V5.8.1 ? Prote??o de edição ativa.
  // Quando o autosync recebe eventos enquanto o usuário est? digitando, o app
  // atualiza o estado em memória, mas adia o render() para não apagar campos
  // ainda não salvos no formulário aberto.
  let capviewDeferredRenderPending = false;
  let capviewDeferredRenderReason = '';
  let capviewDeferredRenderToastAt = 0;

  const isEditableElement = (node) => {
    if (!node) return false;
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    try { if (node.isContentEditable) return true; } catch {}
    return false;
  };

  const hasOpenEditingDialog = () => {
    const editingDialogIds = new Set(['demandEditModal','demandReprogramModal','resourceEditModal','heModal','userModal']);
    return !![...document.querySelectorAll('dialog[open]')].some(d => editingDialogIds.has(String(d.id || '')));
  };

  const isUserEditingDemandCreateForm = () => {
    const active = document.activeElement;
    return !!(active && isEditableElement(active) && active.closest && active.closest('#demandsFormCard'));
  };

  const captureDemandCreateFocus = () => {
    const active = document.activeElement;
    if (!active || !active.closest || !active.closest('#demandsFormCard')) return null;
    const field = String(active.getAttribute('data-demand-create-field') || '');
    if (!field) return null;
    const info = {
      field,
      rid: String(active.getAttribute('data-demand-create-rid') || ''),
      value: String(active.value || ''),
      start: null,
      end: null,
    };
    try {
      info.start = typeof active.selectionStart === 'number' ? active.selectionStart : null;
      info.end = typeof active.selectionEnd === 'number' ? active.selectionEnd : null;
    } catch {}
    return info;
  };

  const findDemandCreateFocusTarget = (info) => {
    if (!info || !info.field) return null;
    const form = document.getElementById('demandsFormCard');
    if (!form) return null;
    const matches = [...form.querySelectorAll(`[data-demand-create-field="${info.field}"]`)];
    if (info.rid) {
      const byRid = matches.find(elm => String(elm.getAttribute('data-demand-create-rid') || '') === String(info.rid));
      if (byRid) return byRid;
    }
    return matches[0] || null;
  };

  const restoreDemandCreateFocus = (info) => {
    if (!info || !info.field) return;
    setTimeout(() => {
      const target = findDemandCreateFocusTarget(info);
      if (!target) return;
      try {
        if (info.field === 'responsavelBusca') target.value = info.value || '';
        target.focus();
        if (typeof target.setSelectionRange === 'function') {
          const len = String(target.value || '').length;
          const start = Math.min(Number(info.start ?? len), len);
          const end = Math.min(Number(info.end ?? start), len);
          target.setSelectionRange(start, end);
        }
        if (info.field === 'responsavelBusca') {
          try { target.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
        }
      } catch {}
    }, 0);
  };

  const renderPreservingDemandCreateFocus = () => {
    const focusInfo = captureDemandCreateFocus();
    render();
    restoreDemandCreateFocus(focusInfo);
  };

  const isUserEditingNow = () => {
    const active = document.activeElement;
    if (isEditableElement(active)) return true;
    if (hasOpenEditingDialog()) return true;
    return false;
  };

  const requestRenderSafely = (reason='autosync') => {
    if (hasOpenEditingDialog()) {
      capviewDeferredRenderPending = true;
      capviewDeferredRenderReason = reason;
      const now = Date.now();
      if (now - capviewDeferredRenderToastAt > 12000) {
        capviewDeferredRenderToastAt = now;
        toast('Atualização recebida. A tela será atualizada ao finalizar a edição.');
      }
      setEventModeStatus('Atualização recebida, render adiado para preservar modal em edição.');
      return false;
    }
    if (isUserEditingDemandCreateForm()) {
      capviewDeferredRenderPending = false;
      capviewDeferredRenderReason = '';
      renderPreservingDemandCreateFocus();
      setEventModeStatus('Atualização recebida e aplicada; rascunho da demanda preservado.');
      return true;
    }
    if (isEditableElement(document.activeElement)) {
      capviewDeferredRenderPending = true;
      capviewDeferredRenderReason = reason;
      const now = Date.now();
      if (now - capviewDeferredRenderToastAt > 12000) {
        capviewDeferredRenderToastAt = now;
        toast('Atualização recebida. A tela será atualizada ao finalizar a edição.');
      }
      setEventModeStatus('Atualização recebida, render adiado para preservar campos em edição.');
      return false;
    }
    capviewDeferredRenderPending = false;
    capviewDeferredRenderReason = '';
    render();
    return true;
  };

  const flushDeferredRenderIfSafe = () => {
    if (!capviewDeferredRenderPending) return false;
    if (isUserEditingNow()) return false;
    capviewDeferredRenderPending = false;
    const reason = capviewDeferredRenderReason || 'autosync';
    capviewDeferredRenderReason = '';
    render();
    toast('Tela atualizada com eventos recebidos.');
    try { console.log('[ORIZON Eventos] Render adiado aplicado:', reason); } catch {}
    return true;
  };

  document.addEventListener('focusout', () => setTimeout(flushDeferredRenderIfSafe, 200), true);
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const txt = String(t?.textContent || '').toLowerCase();
    const action = String(t?.getAttribute?.('data-action') || '').toLowerCase();
    if (/salvar|cancelar|fechar/.test(txt) || /save|cancel|close/.test(action)) {
      setTimeout(flushDeferredRenderIfSafe, 450);
    }
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Tab' || ev.key === 'Enter') setTimeout(flushDeferredRenderIfSafe, 450);
  }, true);
  setInterval(flushDeferredRenderIfSafe, 2500);

  const startEventAutoSync = () => {
    stopEventAutoSync();
    if (!eventAutoSyncAvailable()) return false;
    const ms = Math.max(3000, Number(capviewEventMode.autoSyncMs || 4000));
    capviewEventAutoSyncTimer = setInterval(() => eventAutoSyncTick('timer'), ms);
    setEventModeStatus('Autosync de eventos ligado a cada ' + Math.round(ms/1000) + 's.');
    setTimeout(() => eventAutoSyncTick('start'), 150);
    return true;
  };

  const toggleEventAutoSync = () => {
    capviewEventMode.autoSyncEnabled = capviewEventMode.autoSyncEnabled === false;
    persistEventFolderMeta();
    if (capviewEventMode.autoSyncEnabled) {
      if (startEventAutoSync()) toast('Autosync de eventos ligado.');
      else toast('Autosync ligado, mas selecione a pasta ORIZONData para iniciar.');
    } else {
      stopEventAutoSync();
      setEventModeStatus('Autosync de eventos desligado.');
      toast('Autosync de eventos desligado.');
    }
    render();
  };

  // V5.5 ? marcador global de status do autosync.
  function markDbSync(msg) {
    try {
      dbLastSyncLabel = `${new Date().toLocaleTimeString('pt-BR')} - ${String(msg || '')}`;
      console.log('[ORIZON DB Sync]', msg || '');
    } catch (e) {
      console.warn('[ORIZON DB Sync] Falha ao atualizar status:', e);
    }
  }


  // V5.4.5 ? Fila operacional local para autosync sem backend.
  // O navegador/File System Access API não entrega lock atémico entre usuários,
  // então a proteção realista ?: registrar alteração local como pendente, reler
  // o JSON compartilhado, rebater a alteração local em cima da versão mais nova,
  // reler novamente antes de gravar e repetir em caso de corrida.
  const DB_OP_QUEUE_KEY = 'capview_db_operation_queue_v2';
  const DB_OP_QUEUE_MAX = 25;
  let dbOperationQueue = [];

  const loadDbOperationQueue = () => {
    try {
      const raw = localStorage.getItem(DB_OP_QUEUE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(-DB_OP_QUEUE_MAX) : [];
    } catch { return []; }
  };

  const persistDbOperationQueue = () => {
    try {
      const payload = JSON.stringify(dbOperationQueue.slice(-DB_OP_QUEUE_MAX));
      if (payload.length > LOCAL_STORAGE_LIMIT_HINT_BYTES) throw new DOMException('Fila grande demais para localStorage', 'QuotaExceededError');
      localStorage.setItem(DB_OP_QUEUE_KEY, payload);
    } catch (e) {
      // Em BD grande, não insistimos em persistir snapshots enormes na fila local.
      // A fila em memória continua válida durante a sessão e evita travar a UI/carregamento.
      try { localStorage.removeItem(DB_OP_QUEUE_KEY); } catch {}
      console.warn('[ORIZON Queue] Fila grande demais para localStorage. Mantida apenas em memória nesta sessão.', e);
    }
  };

  const clearDbOperationQueue = () => {
    dbOperationQueue = [];
    try { localStorage.removeItem(DB_OP_QUEUE_KEY); } catch {}
  };

  const enqueueDbOperation = (reason='change') => {
    try {
      const snapshot = normalizeImportedState(buildDbExportObject());
      dbOperationQueue = loadDbOperationQueue();
      dbOperationQueue.push({
        id: `${Date.now()}_${uid()}`,
        reason: String(reason || 'change'),
        queuedAt: new Date().toISOString(),
        baselineHash: String(dbBinding?.baselineHash || ''),
        snapshot
      });
      dbOperationQueue = dbOperationQueue.slice(-DB_OP_QUEUE_MAX);
      persistDbOperationQueue();
      markDbSync(`aguardando para salvar (${dbOperationQueue.length})`);
      return true;
    } catch (e) {
      console.warn('[ORIZON Queue] Falha ao enfileirar operação. UI liberada; persistência local mantida.', e);
      markDbSync('fila local indisponível; dados mantidos localmente');
      return false;
    }
  };

  const getQueuedLocalSnapshot = () => {
    dbOperationQueue = loadDbOperationQueue();
    if (dbOperationQueue.length) {
      const last = dbOperationQueue[dbOperationQueue.length - 1];
      if (last && last.snapshot) return normalizeImportedState(last.snapshot);
    }
    return normalizeImportedState(buildDbExportObject());
  };

  const pauseDbAutoSync = (reason='pausado', message='Autosync pausado. Ligue novamente para mesclar com o BD mais atual.') => {
    dbAutoSyncEnabled = false;
    dbAutoSyncPauseReason = String(reason || 'pausado');
    localStorage.setItem('capview_db_autosync_enabled', '0');
    localStorage.setItem('capview_db_autosync_pause_reason', dbAutoSyncPauseReason);
    stopDbWatcher();
    dbAutoSavePending = false;
    dbAutoSaveDirtySince = 0;
    try { markDbSync(`autosync pausado: ${dbAutoSyncPauseReason}`); } catch {}
    toast(message);
    render();
  };

  const disableDbAutoSyncForEventMode = () => {
    dbAutoSyncEnabled = false;
    dbAutoSyncPauseReason = '';
    localStorage.setItem('capview_db_autosync_enabled', '0');
    localStorage.removeItem('capview_db_autosync_pause_reason');
    stopDbWatcher();
    dbAutoSavePending = false;
    dbAutoSaveDirtySince = 0;
    try { markDbSync('autosync BD desligado: modo Eventos ativo'); } catch {}
  };

  const clearDbAutoSyncPause = () => {
    dbAutoSyncPauseReason = '';
    localStorage.removeItem('capview_db_autosync_pause_reason');
  };

  const LOCAL_LIGHT_STATE_KEY = 'capview_lightweight_state_v1';
  const LOCAL_STORAGE_LIMIT_HINT_BYTES = 4200000;

  const buildLightweightLocalState = () => ({
    schemaVersion: APP_SCHEMA_VERSION,
    meta: {
      lightweight: true,
      savedAt: new Date().toISOString(),
      reason: 'BD grande mantido no JSON/BD selecionado, sem duplicar no localStorage.',
      counts: {
        resources: Array.isArray(state.resources) ? state.resources.length : 0,
        demands: Array.isArray(state.demands) ? state.demands.length : 0,
        blockings: Array.isArray(state.blockings) ? state.blockings.length : 0,
        holidays: Array.isArray(state.holidays) ? state.holidays.length : 0,
        reprogrammings: Array.isArray(state.reprogrammings) ? state.reprogrammings.length : 0,
        overtimes: Array.isArray(state.overtimes) ? state.overtimes.length : 0,
        events: Array.isArray(state.events) ? state.events.length : 0,
      }
    },
    resources: [],
    demands: [],
    blockings: [],
    holidays: [],
    reprogrammings: [],
    overtimes: [],
    events: []
  });

  const persistStateLocallySafe = () => {
    try {
      const payload = JSON.stringify(state);
      // Evita bater na cota típica do localStorage em bases grandes.
      if (payload.length > LOCAL_STORAGE_LIMIT_HINT_BYTES) throw new DOMException('Estado local muito grande para localStorage', 'QuotaExceededError');
      localStorage.setItem(STORAGE_KEY, payload);
      localStorage.removeItem(LOCAL_LIGHT_STATE_KEY);
      return true;
    } catch (e) {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      try { localStorage.setItem(LOCAL_LIGHT_STATE_KEY, JSON.stringify(buildLightweightLocalState())); } catch {}
      console.warn('[ORIZON Storage] Estado grande demais para localStorage. O BD será mantido no JSON selecionado e em memória durante a sessão.', e);
      return false;
    }
  };

  const persist = (opts={}) => {
    // A gravação local nunca pode ser bloqueada pela camada de autosync.
    persistStateLocallySafe();
    if (capviewEventMode.enabled && !opts.skipAutoSave && !sharedFolderReady()) {
      setEventModeStatus('Modo Eventos ligado, mas a pasta ORIZONData ainda não foi selecionada nesta sessão. Eventos ficam no outbox local.');
    }
    if (!capviewEventMode.enabled && !suppressDbAutoSave && !opts.skipAutoSave && dbAutoSyncEnabled && hasDbBinding && hasDbBinding() && dbBinding.mode === 'rw' && dbFileHandle) {
      dbAutoSaveDirtySince = Date.now();
      dbAutoSavePending = true;
      try { enqueueDbOperation('persist'); }
      catch (e) { console.warn('[ORIZON Persist] enqueue falhou sem bloquear a UI:', e); }
      try { scheduleDbAutoSave('persist'); }
      catch (e) { console.warn('[ORIZON Persist] schedule autosave falhou sem bloquear a UI:', e); }
    }
  };

  let scheduleDbAutoSave = (_reason='') => {};
  let startDbWatcher = () => {};
  let stopDbWatcher = () => {
    if (dbWatcherTimer) clearInterval(dbWatcherTimer);
    dbWatcherTimer = null;
    dbWatcherRunning = false;
  };

  const isUserIdentityLocked = () => !!(userName && userId && !String(userId).startsWith('sessao-local__'));

  const updateAvatar = () => {
    const av = qs('#avatar');
    const inp = qs('#userName');
    if (!av || !inp) return;
    document.body.classList.toggle('need-user', !userName);
    av.setAttribute('role','button');
    av.tabIndex = 0;
    inp.value = userName || '';
    const locked = isUserIdentityLocked();
    inp.readOnly = locked;
    inp.classList.toggle('locked', locked);
    inp.setAttribute('aria-readonly', locked ? 'true' : 'false');
    inp.title = locked ? 'Usuário bloqueado após cadastro' : 'Digite seu usuário';
    if (!userName) {
      av.textContent = '!';
      av.classList.add('warn');
      av.setAttribute('aria-label','Defina o usuário');
      av.title = 'Clique para definir o usuário';
    } else {
      av.textContent = userName.slice(0,1).toUpperCase();
      av.classList.remove('warn');
      av.title = userId ? `ID: ${userId}` : '';
    }
    try { if (typeof updateNotificationsBell === 'function') updateNotificationsBell(); } catch {}
  };

  const setUser = (name) => {
    if (isUserIdentityLocked()) {
      updateAvatar();
      return;
    }
    const validation = validateTextLimit(name, 'Nome do usuário', INPUT_LIMITS.userName, { required:true });
    if (validation) { toast(validation); updateAvatar(); return; }
    const u = ensureUserIdentity(name);
    userName = u.displayName;
    userId = u.userId;
    ensureUserAsResource();
    updateAvatar();
  };
  const resolveActiveUser = async ({ displayName='', userId:selectedUserId='', createNew=false } = {}) => {
    const nm = String(displayName || '').trim();
    const selectedId = String(selectedUserId || '').trim();
    const validation = validateTextLimit(nm, 'Nome do usuário', INPUT_LIMITS.userName, { required:true });
    if (validation) { toast(validation); return false; }
    if (!sharedFolderReady()) { toast('Selecione a pasta de eventos antes de salvar o usuário.'); return false; }
    if (!createNew && !selectedId) { toast('Selecione um usuário existente ou crie um novo.'); return false; }

    let finalUser = createNew ? { displayName:nm, userId:(selectedId || previewUserIdentity(nm).userId) } : { displayName:nm, userId:selectedId };
    if (createNew) {
      try { await scanEventFolderUsers(); } catch {}
      const existing = preferredExistingUserForName(nm);
      if (existing?.userId) {
        finalUser = { displayName: existing.displayName || nm, userId: existing.userId };
        toast(`Usuário já existia em /events; identidade existente reutilizada: ${existing.userId}.`);
      }
    }
    userName = finalUser.displayName;
    userId = finalUser.userId;
    persistUserIdentity(finalUser);

    try { await scanEventFolderUsers(); } catch {}
    ensureUserAsResource({ repairedFromUserIdentity: !createNew });
    await flushLocalEventOutbox();
    try { await scanEventFolderUsers(); } catch {}
    if (capviewEventMode.autoSyncEnabled !== false) setTimeout(() => eventAutoSyncTick('user-save'), 250);
    updateAvatar();
    return true;
  };


  const demandAllocations = (demand) => {
    const allocs = normalizeDemandAllocations(demand, state.resources || []);
    return allocs.length ? allocs : [];
  };
  const activeDemandAllocations = (demand, dateStr=todayISO()) => demandAllocations(demand)
    .filter(a => demandAllocationActiveOnDate(a, demand, dateStr));

  const dedupeDemandAllocationLabels = (labels=[]) => {
    const seen = new Set();
    const out = [];
    for (const label of (Array.isArray(labels) ? labels : [])) {
      const key = String(label || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  };

  const buildEditedDemandAllocations = (previousDemand={}, selectedResourceIds=[], hoursById=new Map(), nextStatus='', nextStart='', nextEnd='') => {
    if (normalizeStatus(nextStatus) === 'Mapeada') return [];
    const selectedIds = [...new Set((Array.isArray(selectedResourceIds) ? selectedResourceIds : []).map(id => String(id || '').trim()).filter(Boolean))];
    if (!selectedIds.length) return [];

    const selected = new Set(selectedIds);
    const demandStart = normalizeDateLikeToISO(nextStart || previousDemand.data_inicio || '') || '';
    const demandEnd = normalizeDateLikeToISO(nextEnd || previousDemand.data_fim || '') || '';
    const previousAllocs = demandAllocations(previousDemand).map(a => ({ ...a }));
    const out = [];

    for (const allocation of previousAllocs) {
      const rid = String(allocation.resourceId || '').trim();
      if (!rid || !selected.has(rid)) continue;
      const hours = firstHoursLike(hoursById.get(rid), allocation.horas_planejadas_dia, allocation.horas_dia, previousDemand.horas_planejadas_dia, previousDemand.horas_dia) ?? resourceHoursById(rid, state.resources || []);
      out.push({
        ...allocation,
        data_inicio: normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || demandStart,
        data_fim: demandEnd,
        horas_planejadas_dia: roundDemandHours(hours),
        percentual_diario: demandHoursToPercent(hours, rid, state.resources || []),
      });
    }

    const currentOrFutureIds = new Set(out.map(a => String(a.resourceId || '').trim()).filter(Boolean));
    for (const rid of selectedIds) {
      if (currentOrFutureIds.has(rid)) continue;
      const hours = firstHoursLike(hoursById.get(rid), previousDemand.horas_planejadas_dia, previousDemand.horas_dia) ?? resourceHoursById(rid, state.resources || []);
      const nextAlloc = makeDemandAllocation(rid, hours, state.resources || []);
      // A tela de demanda não possui período individual por responsável.
      // Portanto, ao incluir um responsável pela edição comum, a alocação deve
      // herdar a janela da demanda inteira; datas segmentadas devem surgir
      // apenas pelos fluxos explícitos de transferência/reprogramação.
      nextAlloc.data_inicio = demandStart;
      nextAlloc.data_fim = demandEnd;
      nextAlloc.created_at = Date.now();
      out.push(nextAlloc);
    }

    return out;
  };

  const demandAllocationPeriodLabel = (allocation={}, demand={}) => {
    const start = normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || normalizeDateLikeToISO(demand.data_inicio || '') || '';
    const end = normalizeDateLikeToISO(allocation.data_fim || allocation.dataFim || allocation.end_date || '') || normalizeDateLikeToISO(demand.data_fim || '') || '';
    if (start && end) return `${formatDateBR(start)}-${formatDateBR(end)}`;
    if (start) return `desde ${formatDateBR(start)}`;
    if (end) return `ate ${formatDateBR(end)}`;
    return '';
  };

  const demandAllocationTimelineLabels = (demand={}, resources=state.resources || []) => {
    const resMap = Object.fromEntries((Array.isArray(resources) ? resources : []).map(r => [String(r?.id || ''), r]));
    return demandAllocations(demand)
      .slice()
      .sort((a,b) =>
        String(a.data_inicio || '').localeCompare(String(b.data_inicio || '')) ||
        String(a.data_fim || '').localeCompare(String(b.data_fim || '')) ||
        String(a.resourceId || '').localeCompare(String(b.resourceId || ''))
      )
      .map(a => {
        const rid = String(a.resourceId || '').trim();
        const name = resMap[rid]?.nome || rid || '-';
        const period = demandAllocationPeriodLabel(a, demand);
        const hours = decimalHoursToHHMM(demandAllocationDisplayHours(a, demand, resources));
        return `${name}${period ? ` (${period})` : ''}: ${hours}`;
      });
  };


  const demandAllocationPeriodsForResource = (demand={}, resourceId='', dateStr='') => {
    const rid = String(resourceId || '').trim();
    if (!rid) return [];
    return demandAllocations(demand)
      .filter(a => String(a.resourceId || '').trim() === rid)
      .filter(a => !dateStr || demandAllocationActiveOnDate(a, demand, dateStr))
      .map(a => demandAllocationPeriodLabel(a, demand))
      .filter(Boolean);
  };

  const demandAllocationPeriodsTextForResource = (demand={}, resourceId='', dateStr='') => {
    const periods = demandAllocationPeriodsForResource(demand, resourceId, dateStr);
    return periods.length ? periods.join(' | ') : '-';
  };

  const demandAllocationOverlapsRange = (allocation={}, demand={}, rangeStart='', rangeEnd='') => {
    const start = normalizeDateLikeToISO(allocation.data_inicio || allocation.dataInicio || allocation.start_date || '') || normalizeDateLikeToISO(demand.data_inicio || '') || '';
    const end = normalizeDateLikeToISO(allocation.data_fim || allocation.dataFim || allocation.end_date || '') || normalizeDateLikeToISO(demand.data_fim || '') || '';
    return overlapsRange(start, end, rangeStart, rangeEnd) || demandHasActualWorkInRange(demand, rangeStart, rangeEnd);
  };


  const demandHasTransferHistory = (demand={}) => Array.isArray(demand?.transfer_history) && demand.transfer_history.length > 0;

  const alignNonTransferAllocationsToDemandWindow = (demand={}, resources=state.resources || []) => {
    if (!demand || typeof demand !== 'object' || Array.isArray(demand)) return demand;
    if (demandHasTransferHistory(demand)) return demand;
    const start = normalizeDateLikeToISO(demand.data_inicio || '') || '';
    const end = normalizeDateLikeToISO(demand.data_fim || '') || '';
    const allocations = normalizeDemandAllocations(demand, resources).map(a => ({
      ...a,
      data_inicio: start,
      data_fim: end,
    }));
    return { ...demand, allocations };
  };

  const normalizeDemandAllocationState = (demand, previousDemand=null, resources=state.resources || []) => {
    const transfer_history = Array.isArray(demand?.transfer_history) && demand.transfer_history.length
      ? demand.transfer_history
      : (Array.isArray(previousDemand?.transfer_history) ? previousDemand.transfer_history : []);
    const merged = { ...(previousDemand || {}), ...(demand || {}), transfer_history };
    const allocations = normalizeDemandAllocations(merged, resources);
    const active = allocations.filter(a => demandAllocationActiveOnDate(a, merged, todayISO()));
    const primary = active.find(a => String(a.resourceId || '') === String(merged.responsavel_id || '')) || active[0] || allocations[0] || {};
    return { ...merged, allocations, responsavel_id:String(primary.resourceId || merged.responsavel_id || '').trim() };
  };
  const internalActivitiesForResourceOnDate = (resourceId, dateObj, { onlyCapacity=true } = {}) => {
    const dateStr = formatDate(dateObj);
    const rid = String(resourceId || '').trim();
    const resource = (state.resources || []).find(r => String(r?.id || '').trim() === rid);
    const resourceName = String(resource?.nome || '').trim().toLowerCase();
    return (state.internalActivities || []).filter((a) => {
      const candidateIds = [
        a?.resourceId, a?.resource_id,
        a?.responsavel_id, a?.responsible_id,
        a?.responsavelId, a?.responsibleId,
      ].map(v => String(v || '').trim()).filter(Boolean);

      const candidateNames = [
        a?.resourceName, a?.resource_name,
        a?.responsavel, a?.responsible,
        a?.nome_recurso, a?.nomeResource,
      ].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);

      const matchesResource = !!rid && (
        candidateIds.includes(rid) ||
        (!!resourceName && candidateNames.includes(resourceName))
      );
      if (!matchesResource) return false;

      const ini = normalizeDateLikeToISO(a?.data_inicio || a?.dataInicio || a?.start_date || a?.data || '');
      const fim = normalizeDateLikeToISO(a?.data_fim || a?.dataFim || a?.end_date || ini || a?.data || '') || ini;
      if (!ini) return false;
      return dateStr >= ini && dateStr <= fim;
    });
  };
  const internalActivityHoursForDay = (resourceId, dateObj) => {
    return internalActivitiesForResourceOnDate(resourceId, dateObj, { onlyCapacity:true })
      .reduce((acc, a) => acc + Math.max(0, Number(a?.horas_dia || a?.horas || 0)), 0);
  };

  const ownerFromInternalActivityId = (id) => {
    const raw = String(id || '').trim();
    const match = raw.match(/^(.+)::ia::/);
    const owner = String(match?.[1] || '').trim();
    if (!owner || owner === 'unknown') return '';
    return owner;
  };

  const internalActivityOwnerId = (activity={}) => {
    const owner = String(
      activity.owner_user_id || activity.ownerUserId ||
      activity.created_by_id || activity.createdById ||
      activity.user_id || activity.userId ||
      ownerFromInternalActivityId(activity.id) || ''
    ).trim();
    return owner;
  };

  const internalActivityOwnerName = (activity={}) => String(
    activity.created_by || activity.createdBy ||
    activity.usuario || activity.user ||
    activity.owner_user_name || activity.ownerUserName || ''
  ).trim();

  const canViewInternalActivityDetails = (activity={}) => {
    const ownerId = internalActivityOwnerId(activity);
    if (ownerId) return !!userId && ownerId === String(userId);

    const ownerName = internalActivityOwnerName(activity);
    if (ownerName) return !!userName && normalizedPersonName(ownerName) === normalizedPersonName(userName);

    // Legado sem autoria: mantém visível para não "sumir" com dados antigos/importados.
    return true;
  };

  const canManageInternalActivity = canViewInternalActivityDetails;

  const INPUT_LIMITS = {
    userName: 30,
    resourceName: 30,
    demandTitle: 80,
    building: 50,
    focal: 60,
    demandNotes: 500,
    shortNote: 180,
    justification: 400,
  };
  const MIN_APP_YEAR = 2000;
  const MAX_APP_YEAR = 2100;

  const validateTextLimit = (value, label, max, { required=false } = {}) => {
    const text = String(value || '').trim();
    if (required && !text) return `${label}: preenchimento obrigatório.`;
    if (text.length > max) return `${label}: limite de ${max} caracteres.`;
    return '';
  };

  const validateDateYearLimit = (value, label) => {
    const date = String(value || '').trim();
    if (!date) return '';
    if (!isISODateString(date)) return `${label}: informe uma data válida.`;
    const year = Number(date.slice(0, 4));
    if (year < MIN_APP_YEAR || year > MAX_APP_YEAR) return `${label}: use datas entre ${MIN_APP_YEAR} e ${MAX_APP_YEAR}.`;
    return '';
  };

  const validateDateRangeLimits = (start, end, { allowEmpty=false, label='Período' } = {}) => {
    const ini = String(start || '').trim();
    const fim = String(end || '').trim();
    if (!allowEmpty && (!ini || !fim)) return `${label}: informe início e fim.`;
    if ((ini && !fim) || (!ini && fim)) return `${label}: preencha início e fim ou deixe ambos em branco.`;
    const startValidation = validateDateYearLimit(ini, `${label} início`);
    if (startValidation) return startValidation;
    const endValidation = validateDateYearLimit(fim, `${label} fim`);
    if (endValidation) return endValidation;
    if (ini && fim && fim < ini) return `${label}: a data fim não pode ser anterior ao início.`;
    return '';
  };

  const validateResourcePayload = ({ nome, vigencia_inicio='', vigencia_fim='', tipo='Interno' } = {}) => {
    const nameValidation = validateTextLimit(nome, 'Nome do recurso', INPUT_LIMITS.resourceName, { required:true });
    if (nameValidation) return nameValidation;
    if (String(tipo || '').trim() === 'Terceiro') {
      return validateDateRangeLimits(vigencia_inicio, vigencia_fim, { allowEmpty:true, label:'Vigência do terceiro' });
    }
    return '';
  };



  const focalUserOptions = () => {
    const names = [];
    const add = (value) => {
      const name = String(value || '').trim();
      if (name) names.push(name);
    };
    add(userName);
    for (const u of (scannedEventUsers || [])) add(u?.displayName || u?.name || u?.userName);
    for (const r of (state.resources || [])) add(r?.nome || r?.name);
    for (const ev of (state.events || [])) {
      add(ev?.user || ev?.usuario || ev?.user_name);
      const payload = ev?.payload || {};
      add(payload.user || payload.usuario || payload.user_name || payload.created_by || payload.createdBy);
    }
    return [...new Set(names)].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  };

  const createFocalPicker = ({ value='', draftField=false } = {}) => {
    const attrs = { value, placeholder:'Digite para buscar o focal...', maxlength:String(INPUT_LIMITS.focal) };
    if (draftField) attrs['data-demand-create-field'] = 'focal';
    const input = el('input', attrs);
    input.className = 'multiSelectInput';
    const menu = el('div', { class:'multiSelectMenu' });
    const box = el('div', { class:'multiSelectBox' }, [input]);
    const control = el('div', { class:'multiSelect', title:'Digite para buscar e clique para selecionar um usuário cadastrado' }, [box, menu]);
    const closeMenu = () => control.classList.remove('open');
    const renderOptions = () => {
      const q = normalizeSearchText(input.value || '');
      const options = focalUserOptions().filter(name => !q || normalizeSearchText(name).includes(q)).slice(0, 50);
      menu.innerHTML = '';
      if (!options.length) {
        menu.appendChild(el('div', { class:'multiSelectEmpty' }, [q ? 'Nenhum usuário encontrado.' : 'Nenhum usuário cadastrado encontrado.']));
        return;
      }
      for (const name of options) {
        menu.appendChild(el('button', { type:'button', class:'multiSelectOption', 'data-focal-name':name }, [name]));
      }
    };
    const openMenu = () => { control.classList.add('open'); renderOptions(); };
    menu.addEventListener('mousedown', (ev) => {
      const opt = ev.target.closest('.multiSelectOption');
      if (!opt) return;
      ev.preventDefault();
      ev.stopPropagation();
      input.value = opt.getAttribute('data-focal-name') || '';
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.dispatchEvent(new Event('change', { bubbles:true }));
      closeMenu();
    });
    input.addEventListener('input', openMenu);
    input.addEventListener('focus', openMenu);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });
    document.addEventListener('mousedown', (ev) => { if (!control.contains(ev.target)) closeMenu(); });
    return { input, control };
  };

  const validateDemandFields = ({ titulo='', predio='', focal='', data_inicio='', data_fim='', observacoes='', status='Mapeada' } = {}) => {
    const textRules = [
      ['Título', titulo, INPUT_LIMITS.demandTitle, true],
      ['Prédio', predio, INPUT_LIMITS.building, false],
      ['Focal', focal, INPUT_LIMITS.focal, false],
      ['Observações', observacoes, INPUT_LIMITS.demandNotes, false],
    ];
    for (const [label, value, max, required] of textRules) {
      const validation = validateTextLimit(value, label, max, { required });
      if (validation) return validation;
    }
    const isMapped = normalizeStatus(status) === 'Mapeada';
    return validateDateRangeLimits(data_inicio, data_fim, { allowEmpty:isMapped, label: isMapped ? 'Período da demanda mapeada' : 'Período da demanda' });
  };

  const validateDemandAllocationLimits = (allocations=[]) => {
    const list = Array.isArray(allocations) ? allocations : [];
    for (const a of list) {
      const rid = String(a?.resourceId || '').trim();
      const horas = Number(a?.horas_planejadas_dia ?? a?.horas_dia ?? 0);
      const maxHours = resourceHoursById(rid, state.resources || []);
      if (!Number.isFinite(horas) || horas < 0) return { ok:false, msg:'Horas por recurso inválidas (use HH:MM, exemplo 03:30).' };
      if (horas > maxHours) return { ok:false, msg:`Horas por recurso não podem passar de ${decimalHoursToHHMM(maxHours)} por dia.` };
      const start = normalizeDateLikeToISO(a?.data_inicio || a?.dataInicio || a?.start_date || '') || '';
      const end = normalizeDateLikeToISO(a?.data_fim || a?.dataFim || a?.end_date || '') || '';
      const rangeValidation = validateDateRangeLimits(start, end, { allowEmpty:true, label:'Período da alocação' });
      if (rangeValidation) return { ok:false, msg:rangeValidation };
      const daily = normalizeAllocationDailyHours(a?.daily_hours || a?.dailyHours || a?.horas_por_dia || {});
      for (const [date, dayHours] of Object.entries(daily)) {
        if (start && date < start) return { ok:false, msg:'Agenda diária da alocação possui data antes do início da alocação.' };
        if (end && date > end) return { ok:false, msg:'Agenda diária da alocação possui data depois do fim da alocação.' };
        if (dayHours > maxHours) return { ok:false, msg:`Horas da agenda diária não podem passar de ${decimalHoursToHHMM(maxHours)} por dia.` };
      }
    }
    return { ok:true };
  };


  const blockingResourceId = (blocking={}) => String(blocking.recurso_id || blocking.resourceId || '').trim();
  const blockingStartDate = (blocking={}) => normalizeDateLikeToISO(blocking.data_inicio || blocking.start || blocking.dateStart || blocking.data || blocking.date || '');
  const blockingEndDate = (blocking={}) => normalizeDateLikeToISO(blocking.data_fim || blocking.end || blocking.dateEnd || blocking.data || blocking.date || blockingStartDate(blocking));
  const blockingDateLabel = (blocking={}) => {
    const start = blockingStartDate(blocking);
    const end = blockingEndDate(blocking) || start;
    if (!start) return '-';
    return end && end !== start ? `${formatDateBR(start)} - ${formatDateBR(end)}` : formatDateBR(start);
  };
  const blockingCoversDate = (blocking={}, resourceId='', dateStr='') => {
    const rid = blockingResourceId(blocking);
    if (!rid || rid !== String(resourceId || '').trim()) return false;
    const start = blockingStartDate(blocking);
    const end = blockingEndDate(blocking) || start;
    const date = String(dateStr || '').trim();
    return !!(start && end && date && date >= start && date <= end);
  };
  const addDaysISO = (iso, days=1) => {
    const d = isoToLocalMidnight(iso);
    if (!d) return '';
    d.setDate(d.getDate() + Number(days || 0));
    return formatDate(d);
  };

  const fillDailyHoursRange = (dailyHours={}, startStr='', endStr='', hours=0) => {
    const daily = normalizeAllocationDailyHours(dailyHours || {});
    let cursor = normalizeDateLikeToISO(startStr || '') || '';
    const end = normalizeDateLikeToISO(endStr || '') || '';
    const value = roundDemandHours(hours);
    let guard = 0;
    while (cursor && end && cursor <= end && guard < 8000) {
      daily[cursor] = value;
      cursor = addDaysISO(cursor, 1);
      guard++;
    }
    return daily;
  };

  const applyAllocationHoursFromDate = ({ rid='', changeFrom='', nextHours=0, respHoursById, respStartById, respEndById, respDailyById, fallbackStart='', fallbackEnd='', originalStartOverride='' }) => {
    const resourceId = String(rid || '').trim();
    if (!resourceId) return;
    const currentStart = normalizeDateLikeToISO(respStartById.get(resourceId) || fallbackStart || '') || '';
    const originalStart = normalizeDateLikeToISO(originalStartOverride || '') || currentStart;
    const end = normalizeDateLikeToISO(respEndById.get(resourceId) || fallbackEnd || '') || originalStart;
    const from = normalizeDateLikeToISO(changeFrom || '') || originalStart;
    const previousHours = Number(respHoursById.get(resourceId) ?? 0);
    const newHours = roundDemandHours(nextHours);
    let daily = normalizeAllocationDailyHours(respDailyById.get(resourceId) || {});

    if (originalStart && from && from > originalStart && Number.isFinite(previousHours)) {
      daily = fillDailyHoursRange(daily, originalStart, addDaysISO(from, -1), previousHours);
      respHoursById.set(resourceId, newHours);
      // A data informada no editor de horas representa o início da nova carga,
      // não o início da alocação. Mantemos a alocação ativa desde o início
      // planejado e materializamos as horas anteriores em daily_hours para o
      // heatmap continuar contando o histórico dia a dia.
      respStartById.set(resourceId, originalStart);
      if (end && from <= end) daily = fillDailyHoursRange(daily, from, end, newHours);
      respDailyById.set(resourceId, daily);
      return;
    }

    respStartById.set(resourceId, originalStart || from);
    if (end && from && from <= end) daily = fillDailyHoursRange(daily, from, end, newHours);
    respHoursById.set(resourceId, newHours);
    respDailyById.set(resourceId, daily);
  };
  const buildBlockingDisplayRows = (items=[]) => {
    const list = (Array.isArray(items) ? items : []).slice().sort((a,b) => {
      const ra = blockingResourceId(a);
      const rb = blockingResourceId(b);
      if (ra !== rb) return ra.localeCompare(rb);
      const ta = String(a.tipo || '').trim();
      const tb = String(b.tipo || '').trim();
      if (ta !== tb) return ta.localeCompare(tb);
      const da = blockingStartDate(a);
      const db = blockingStartDate(b);
      if (da !== db) return da.localeCompare(db);
      return String(a.id||'').localeCompare(String(b.id||''));
    });
    const rows = [];
    for (const b of list) {
      const rid = blockingResourceId(b);
      const start = blockingStartDate(b);
      const end = blockingEndDate(b) || start;
      const tipo = String(b.tipo || '').trim();
      const last = rows[rows.length - 1];
      const canMergeLegacyDaily = last && last.resourceId === rid && last.tipo === tipo && last.end && start && addDaysISO(last.end, 1) === start;
      const isSingleDayLegacy = start && end === start && !b.data_inicio && !b.data_fim;
      if (canMergeLegacyDaily && isSingleDayLegacy && last.isLegacyDailyGroup) {
        last.end = end;
        last.ids.push(b.id);
        last.items.push(b);
        continue;
      }
      rows.push({
        id: b.id,
        ids: [b.id],
        items: [b],
        resourceId: rid,
        start,
        end,
        tipo,
        observacao: b.obs || b.observacao || '',
        isLegacyDailyGroup: isSingleDayLegacy,
      });
    }
    return rows;
  };

  const resourceOwnerId = (resource) => String(resource?.owner_user_id || resource?.ownerUserId || '').trim();

  const identityPriorityScore = (identity={}) => {
    let score = 0;
    if (String(identity.userId || '').trim() === String(userId || '').trim()) score += 1000;
    if (String(identity.resourceId || '').trim()) score += 100;
    if (Number(identity.eventCount || 0) > 0) score += 60;
    const sources = Array.isArray(identity.sources) ? identity.sources : [identity.source || ''];
    if (sources.some(src => /snapshot\.resources|events\.payload|ADD_RESOURCE|UPDATE_RESOURCE/i.test(String(src || '')))) score += 20;
    if (sources.some(src => /events\.metadata/i.test(String(src || '')))) score += 10;
    if (sources.some(src => /events\.filename/i.test(String(src || '')))) score += 5;
    return score;
  };

  const choosePreferredUserIdentity = (identities=[], fallbackName='') => {
    const unique = (identities || [])
      .filter(item => item && String(item.userId || '').trim() && !isSyntheticLegacyOwnerId(item.userId))
      .filter((item, idx, arr) => arr.findIndex(x => String(x.userId || '').trim() === String(item.userId || '').trim()) === idx);
    if (!unique.length) return null;
    return [...unique].sort((a,b) => {
      const scoreDiff = identityPriorityScore(b) - identityPriorityScore(a);
      if (scoreDiff) return scoreDiff;
      return String(a.userId || '').localeCompare(String(b.userId || ''), 'pt-BR');
    })[0] || { displayName:fallbackName, userId:'' };
  };

  const existingUserIdentitiesForName = (displayName='') => {
    const nm = String(displayName || '').trim();
    if (!nm) return [];
    const key = normalizedPersonName(nm);
    const candidates = [];
    for (const u of (scannedEventUsers || [])) {
      if (normalizedPersonName(u?.displayName) === key && u?.userId) {
        candidates.push({ ...u, displayName: String(u.displayName || nm).trim(), userId: String(u.userId).trim(), source:u.source || 'events' });
      }
    }
    for (const r of (state.resources || [])) {
      const owner = resourceOwnerId(r);
      if (owner && normalizedPersonName(r?.nome || r?.name) === key) {
        candidates.push({ displayName: String(r.nome || r.name || nm).trim(), userId: owner, resourceId:String(r.id || '').trim(), source:'resources' });
      }
    }
    for (const ev of (state.events || [])) {
      if (!ev || (ev.type !== 'ADD_RESOURCE' && ev.type !== 'UPDATE_RESOURCE')) continue;
      const payload = ev.payload || {};
      const owner = resourceOwnerId(payload);
      if (owner && normalizedPersonName(payload?.nome || payload?.name) === key) {
        candidates.push({ displayName: String(payload.nome || payload.name || nm).trim(), userId: owner, resourceId:String(payload.id || '').trim(), source:'events.payload' });
      }
    }
    return candidates.filter((item, idx, arr) => item.userId && arr.findIndex(x => String(x.userId) === String(item.userId)) === idx);
  };

  const preferredExistingUserForName = (displayName='') => choosePreferredUserIdentity(existingUserIdentitiesForName(displayName), displayName);

  const userIdentityForResourceName = (displayName='') => {
    const nm = String(displayName || '').trim();
    if (!nm) return { displayName:'', userId:'' };
    const existing = existingUserIdentitiesForName(nm);
    const preferred = choosePreferredUserIdentity(existing, nm);
    if (preferred) {
      if (existing.length > 1) {
        console.warn('[ORIZON Usuários] Nome de usuário duplicado detectado; reutilizando identidade preferida para evitar novo arquivo:', { nome:nm, escolhido:preferred.userId, encontrados:existing.map(u => u.userId) });
      }
      return preferred;
    }
    return previewUserIdentity(nm);
  };

  const ensureResourceUserEventFile = async (resource, opts={}) => {
    const owner = resourceOwnerId(resource);
    const displayName = String(resource?.nome || resource?.name || '').trim();
    if (!owner || isSyntheticLegacyOwnerId(owner) || !displayName || !sharedFolderReady()) return false;
    try {
      const { safeName } = await getEventFileHandleForIdentity(owner, displayName);
      if (opts.toast !== false) toast(`Usuário ${displayName} criado em /events/${safeName}.json.`);
      try { await scanEventFolderUsers(); } catch {}
      return true;
    } catch (err) {
      console.warn('[ORIZON Usuários] Falha ao criar arquivo de eventos do recurso:', err);
      if (opts.toast !== false) toast('Recurso salvo, mas não foi possível criar o JSON do usuário em /events.');
      return false;
    }
  };

  const ensureResourceUserEventFiles = async (opts={}) => {
    if (!sharedFolderReady()) return 0;
    let created = 0;
    for (const resource of (state.resources || [])) {
      const owner = resourceOwnerId(resource);
      if (!owner || isSyntheticLegacyOwnerId(owner) || !String(resource?.nome || resource?.name || '').trim()) continue;
      if (await ensureResourceUserEventFile(resource, { toast:false })) created += 1;
    }
    if (created && opts.toast !== false) toast(`${created} arquivo(s) de usuário conferido(s) em /events.`);
    return created;
  };

  const ensureUserAsResource = (opts={}) => {
    try {
      if (!hasUser()) return false;
      const uid = String(userId || '').trim();
      if (!uid || uid.startsWith('sessao-local__')) return false;
      const alreadyExists = (state.resources || []).some((r) => resourceOwnerId(r) === uid);
      if (alreadyExists) return false;
      const resourceAlreadyInEvents = (state.events || []).some((ev) => {
        if (!ev || (ev.type !== 'ADD_RESOURCE' && ev.type !== 'UPDATE_RESOURCE')) return false;
        return resourceOwnerId(ev.payload || {}) === uid;
      });
      const knownResourceInEventFolder = (scannedEventUsers || []).some(u => String(u.userId || '') === uid && String(u.resourceId || '').trim());
      if (resourceAlreadyInEvents || knownResourceInEventFolder) return false;
      if (capviewEventMode.enabled && !sharedFolderReady()) return false;
      const payload = {
        id: generateId('resource'),
        nome: String(userName || '').trim() || 'Usuário',
        tipo: 'Interno',
        horas_dia: HOURS_PER_DAY,
        ativo: true,
        owner_user_id: uid,
        auto_created_from_user: true,
        repaired_from_user_identity: !!opts.repairedFromUserIdentity,
      };
      try {
        dispatch('ADD_RESOURCE', payload);
      } catch (errDispatch) {
        console.warn('[ORIZON] Falha no dispatch ao auto-criar recurso do usuário, aplicando fallback local:', errDispatch);
        state.resources.unshift(applyCreateMeta(payload));
      }
      return true;
    } catch (err) {
      console.warn('[ORIZON] Falha ao garantir usuário como recurso:', err);
      return false;
    }
  };

  // ----------------------
  // Guard: require user identity for any action that creates/edits data
  const hasUser = () => !!(userName && userId);

  const openUserModal = (force=false) => {
    const dlg = qs('#userModal');
    if (!dlg) return;
    const nameInput = qs('#userModalName');
    const idInput = qs('#userModalId');
    const existingSelect = qs('#userExistingSelect');
    const createMode = qs('#userCreateMode');
    const folderStatus = qs('#userFolderStatus');
    const currentName = userName || (qs('#userName')?.value || '');
    if (nameInput) nameInput.value = currentName;
    if (idInput) idInput.value = userId || '';
    if (existingSelect && userId) existingSelect.value = userId;
    if (createMode) createMode.checked = false;
    if (folderStatus) folderStatus.textContent = sharedFolderReady()
      ? `Pasta conectada: ${capviewEventMode.folderName || 'ORIZONData'}`
      : 'Nenhuma pasta selecionada. Selecione a pasta ORIZONData que contém a subpasta events.';
    dlg.dataset.force = force ? '1' : '0';
    const must = (dlg.dataset.force === '1') && !hasUser();
    const btnClose = qs('#userModalClose');
    const btnCancel = qs('#userModalCancel');
    if (btnClose) { btnClose.disabled = must; btnClose.style.opacity = must ? '.45' : ''; }
    if (btnCancel) { btnCancel.disabled = must; btnCancel.style.opacity = must ? '.45' : ''; }
    document.body.classList.add('user-modal-open');
    openDialog(dlg);
    setTimeout(() => {
      try {
        if (wireUserModal.refreshFolderUsers) wireUserModal.refreshFolderUsers();
        if (wireUserModal.setCreateMode) wireUserModal.setCreateMode(false);
      } catch {}
    }, 0);
  };

  // V5.4.6 ? guard não-bloqueante para CRUD local.
  // A fila/autosync não pode impedir o usuário de criar/editar dados.
  // Se a identidade não estiver definida em uma segunda instância/navegador,
  // criamos uma identidade técnica local e mantemos o aviso para o usuário
  // informar o nome depois. Isso evita o sintoma de botão/ação parecer
  // "travado" enquanto preserva autoria mínima nos IDs/metadados.
  const ensureNonBlockingUser = () => {
    if (hasUser()) return true;
    const suffix = (safeUUID() || uid()).toString().replace(/[^a-z0-9]/gi,'').slice(0,8);
    userName = 'Sessão local';
    userId = `sessao-local__${suffix}`;
    persistUserIdentity({ displayName:userName, userId });
    updateAvatar();
    return true;
  };

  const requireUser = (reason='', opts={}) => {
    if (hasUser()) return true;
    if (opts && opts.blocking === true) {
      toast(reason || 'Defina seu usuário para registrar autoria e evitar conflitos.');
      openUserModal(true);
      return false;
    }
    ensureNonBlockingUser();
    toast('Identidade técnica criada para não bloquear a edição. Depois, clique no avatar e informe seu nome.');
    return true;
  };

  const requiresUserByType = (type) => {
    const t = String(type||'');
    return [
      'ADD_DEMAND','UPDATE_DEMAND','EDIT_DEMAND','DELETE_DEMAND','DELETE_DEMANDS',
      'REPROGRAM_DEMAND','TRANSFER_DEMAND_ALLOCATION',
      'ADD_RESOURCE','UPDATE_RESOURCE','EDIT_RESOURCE','DELETE_RESOURCE',
      'ADD_BLOCKING','DELETE_BLOCKING',
      'ADD_HOLIDAY','DELETE_HOLIDAY',
      'ADD_OVERTIME','DELETE_OVERTIME',
      'ADD_INTERNAL_ACTIVITY','UPDATE_INTERNAL_ACTIVITY','DELETE_INTERNAL_ACTIVITY',
      'IMPORT_ADD','IMPORT_REPLACE'
    ].includes(t);
  };

  const requiresBlockingUserByType = (type) => {
    const t = String(type||'');
    return ['CLEAR_ALL'].includes(t);
  };

  const resourceDeleteId = (payload) =>
    normalizeLegacyIdKind(String((payload && typeof payload === 'object') ? payload.id : payload || ''), 'id', 'resource');

  const removeResourceCascade = (target, payload) => {
    const id = resourceDeleteId(payload);
    if (!target || !id) return;
    target.resources = (target.resources || []).filter(r => String(r.id) !== id);
    target.demands = (target.demands || []).filter(d =>
      String(d.responsavel_id || d.resourceId || '') !== id
    );
    target.blockings = (target.blockings || []).filter(b =>
      String(b.recurso_id || b.resourceId || '') !== id
    );
  };



  const dispatch = (type, payload) => {
    if (requiresUserByType(type) && !requireUser('Defina seu usuário para registrar autoria e evitar conflitos.', { blocking: requiresBlockingUserByType(type) })) return;
    let eventPayload = payload;
    let didMutate = true;

    switch (type) {
      case 'ADD_RESOURCE': {
        const stamped = applyCreateMeta(payload);
        state.resources.unshift(stamped);
        eventPayload = stamped;
        break;
      }
      case 'UPDATE_RESOURCE': {
        const prev = (state.resources||[]).find(r => r.id === payload.id);
        const stamped = applyUpdateMeta(payload, prev);
        state.resources = state.resources.map(r => r.id === stamped.id ? stamped : r);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_RESOURCE':
        removeResourceCascade(state, payload);
        break;
      case 'ADD_DEMAND': {
        if (hasLikelyDuplicateDemand(state.demands, payload)) {
          didMutate = false;
          break;
        }
        const stamped = applyCreateMeta(normalizeDemandBaseline(payload));
        state.demands.unshift(stamped);
        eventPayload = stamped;
        break;
      }
      case 'ADD_INTERNAL_ACTIVITY': {
        const stamped = applyCreateMeta(payload);
        state.internalActivities.unshift(stamped);
        eventPayload = stamped;
        break;
      }
      case 'UPDATE_INTERNAL_ACTIVITY': {
        const prev = (state.internalActivities||[]).find(x => x.id === payload.id);
        const stamped = applyUpdateMeta(payload, prev);
        state.internalActivities = (state.internalActivities||[]).map(x => x.id === stamped.id ? stamped : x);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_INTERNAL_ACTIVITY':
        state.internalActivities = (state.internalActivities||[]).filter(x => String(x.id) !== String(payload));
        break;
      case 'UPDATE_DEMAND': {
        const prev = (state.demands||[]).find(d => d.id === payload.id);
        const stamped = applyUpdateMeta(normalizeDemandAllocationState(normalizeDemandBaseline({ ...payload, baseline_inicio: payload.baseline_inicio || prev?.baseline_inicio, baseline_fim: payload.baseline_fim || prev?.baseline_fim }), prev), prev);
        state.demands = state.demands.map(d => d.id === stamped.id ? stamped : d);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_DEMAND':
        state.demands = (state.demands||[]).filter(d => String(d.id) !== String(payload));
        break;
      case 'DELETE_DEMANDS': {
        state.demands = (state.demands||[]).filter(d => !demandMatchesDeletePayload(d, payload));
        break;
      }
      case 'REPROGRAM_DEMAND': {
        const rp = applyCreateMeta(payload.reprogramming || {});
        state.reprogrammings.push(rp);
        state.demands = state.demands.map(d => {
          if (d.id !== payload.demandId) return d;
          const novoFim = rp.novo_fim || rp.novo_prazo || d.data_fim || '';
          const updated = { ...d, data_fim: novoFim, reprogramacoes: (d.reprogramacoes||0) + 1 };
          return applyUpdateMeta(alignNonTransferAllocationsToDemandWindow(updated), d);
        });
        eventPayload = { ...payload, reprogramming: rp };
        break;
      }
      case 'TRANSFER_DEMAND_ALLOCATION': {
        const prev = (state.demands||[]).find(d => d.id === payload.demandId);
        if (!prev) { didMutate = false; break; }
        const transferDate = normalizeDateLikeToISO(payload.transferDate || todayISO()) || todayISO();
        const transferEnd = normalizeDateLikeToISO(payload.transferEnd || payload.endDate || '') || '';
        const previousEnd = addDaysISO(transferDate, -1) || transferDate;
        const nextStart = transferDate;
        const fromId = String(payload.fromResourceId || prev.responsavel_id || '').trim();
        const toId = String(payload.toResourceId || '').trim();
        const hours = firstHoursLike(payload.horas_planejadas_dia, payload.horas_dia) ?? firstHoursLike(prev.horas_planejadas_dia, prev.horas_dia) ?? 0;
        const allocations = demandAllocations(prev)
          .map(a => (String(a.resourceId || '') === fromId && demandAllocationActiveOnDate(a, prev, transferDate))
            ? { ...a, data_inicio: a.data_inicio || prev.data_inicio || '', data_fim: previousEnd }
            : a);
        const nextAlloc = makeDemandAllocation(toId, hours, state.resources || []);
        nextAlloc.data_inicio = nextStart;
        nextAlloc.data_fim = transferEnd || prev.data_fim || '';
        nextAlloc.created_at = Date.now();
        allocations.push(nextAlloc);
        const stamped = applyUpdateMeta({
          ...prev,
          responsavel_id: toId,
          allocations,
          transfer_history: [
            ...(Array.isArray(prev.transfer_history) ? prev.transfer_history : []),
            {
              id: generateId('transfer'),
              fromResourceId: fromId,
              toResourceId: toId,
              transferDate,
              previousEnd,
              nextStart,
              transferEnd,
              horas_planejadas_dia: roundDemandHours(hours),
              justification: String(payload.justification || '').trim(),
              timestamp: Date.now(),
              user: userName,
              user_id: userId || ''
            }
          ]
        }, prev);
        state.demands = state.demands.map(d => d.id === stamped.id ? stamped : d);
        eventPayload = { ...payload, demand: stamped };
        break;
      }
      case 'ADD_BLOCKING': {
        const stamped = applyCreateMeta(payload);
        state.blockings.push(stamped);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_BLOCKING':
        state.blockings = state.blockings.filter(b => b.id !== payload);
        break;
      case 'ADD_HOLIDAY': {
        const stamped = applyCreateMeta(payload);
        state.holidays.push(stamped);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_HOLIDAY':
        state.holidays = state.holidays.filter(h => h.id !== payload);
        break;
      case 'ADD_OVERTIME': {
        const stamped = applyCreateMeta(payload);
        state.overtimes.push(stamped);
        eventPayload = stamped;
        break;
      }
      case 'DELETE_OVERTIME': {
        const id = (payload && typeof payload==='object') ? payload.id : payload;
        state.overtimes = state.overtimes.filter(o => String(o.id) !== String(id));
        break;
      }
      case 'IMPORT_SNAPSHOT':
        state = { ...payload, events: state.events };
        break;
      default:
        break;
    }

    if (!didMutate) {
      if (type === 'ADD_DEMAND') toast('Demanda ja cadastrada; duplicidade ignorada.');
      return;
    }

    invalidateDashboardCapacityCache();

    const event = { id: generateId('event'), type, payload: eventPayload, timestamp: Date.now(), user: userName, user_id: userId || '' };
    state.events = [...state.events, event];

    // Em modo eventos, nunca dependa de gravação direta no snapshot.
    // O evento ? salvo no outbox local primeiro e depois enviado para /events/usuario.json.
    try {
      if (capviewEventMode.enabled) rememberLocalEventForSharedFile(event);
      recordSharedEvent(event);
    } catch(e) {
      console.warn('[ORIZON Eventos] Registro assíncrono não iniciado:', e);
      if (capviewEventMode.enabled) setEventModeStatus('Evento mantido no outbox local. Selecione a pasta ORIZONData para gravar em /events.');
    }

    persist();
    render();
  };

  const importEvents = (newEvents) => {
    const existing = new Set((state.events||[]).map(e => e.id));
    const filtered = (newEvents||[]).filter(e => e && e.id && !existing.has(e.id));
    const combined = [...(state.events||[]), ...filtered].sort((a,b) => (a.timestamp||0)-(b.timestamp||0));

    const rebuilt = defaultState();
    rebuilt.events = combined;

    for (const event of combined) {
      const { type, payload } = event;
      switch (type) {
        case 'ADD_RESOURCE': rebuilt.resources.push(payload); break;
        case 'UPDATE_RESOURCE': rebuilt.resources = rebuilt.resources.map(r => r.id === payload.id ? payload : r); break;
        case 'DELETE_RESOURCE': removeResourceCascade(rebuilt, payload); break;
        case 'ADD_DEMAND': rebuilt.demands.push(normalizeDemandAllocationState(normalizeDemandBaseline(payload), null, rebuilt.resources || [])); break;
        case 'ADD_INTERNAL_ACTIVITY': rebuilt.internalActivities.push(payload); break;
        case 'UPDATE_INTERNAL_ACTIVITY': rebuilt.internalActivities = rebuilt.internalActivities.map(x => x.id === payload.id ? payload : x); break;
        case 'DELETE_INTERNAL_ACTIVITY': rebuilt.internalActivities = rebuilt.internalActivities.filter(x => String(x.id) !== String(payload)); break;
        case 'UPDATE_DEMAND': rebuilt.demands = rebuilt.demands.map(d => d.id === payload.id ? normalizeDemandAllocationState(normalizeDemandBaseline(payload), d, rebuilt.resources || []) : d); break;
        case 'DELETE_DEMAND': rebuilt.demands = rebuilt.demands.filter(d => String(d.id) !== String(payload)); break;
        case 'DELETE_DEMANDS': rebuilt.demands = rebuilt.demands.filter(d => !demandMatchesDeletePayload(d, payload)); break;
        case 'REPROGRAM_DEMAND':
          rebuilt.reprogrammings.push(payload.reprogramming);
          rebuilt.demands = rebuilt.demands.map(d => {
            if (d.id !== payload.demandId) return d;
            const novoFim = payload.reprogramming.novo_fim || payload.reprogramming.novo_prazo || d.data_fim || '';
            return { ...d, data_fim: novoFim, reprogramacoes: (d.reprogramacoes||0) + 1 };
          });
          break;
        case 'TRANSFER_DEMAND_ALLOCATION':
          rebuilt.demands = rebuilt.demands.map(d => d.id === payload.demandId ? normalizeDemandAllocationState(normalizeDemandBaseline(payload.demand || d), d, rebuilt.resources || []) : d);
          break;
        case 'ADD_BLOCKING': rebuilt.blockings.push(payload); break;
        case 'DELETE_BLOCKING': rebuilt.blockings = rebuilt.blockings.filter(b => b.id !== payload); break;
        case 'ADD_HOLIDAY': rebuilt.holidays.push(payload); break;
        case 'DELETE_HOLIDAY': rebuilt.holidays = rebuilt.holidays.filter(h => h.id !== payload); break;
        case 'ADD_OVERTIME': rebuilt.overtimes.push(payload); break;
        case 'DELETE_OVERTIME': { const id = (payload && typeof payload==='object') ? payload.id : payload; rebuilt.overtimes = rebuilt.overtimes.filter(o => String(o.id) !== String(id)); break; }
        default: break;
      }
    }

    state = rebuilt;
    invalidateDashboardCapacityCache();
    persist();
    render();
  };


  // ----------------------
  // V5.5.1 ? Eventos por usuário em pasta compartilhada
  // ----------------------
  const eventSafeNameForIdentity = (identityId='', identityName='') => {
    const base = String(identityId || identityName || 'sessao-local').trim() || 'sessao-local';
    return base.replace(/[^a-z0-9_.-]+/gi,'_').slice(0,80) || 'sessao-local';
  };
  const eventSafeName = () => eventSafeNameForIdentity(userId, userName);

  const ensureEventUser = () => {
    if (!hasUser()) ensureNonBlockingUser();
    return true;
  };

  const fileTextOrDefault = async (handle, fallback='', opts={}) => {
    try {
      const file = await handle.getFile();
      const txt = await file.text();
      return String(txt || fallback || '');
    } catch (err) {
      if (opts.throwOnReadError) throw err;
      return String(fallback || '');
    }
  };

  const writeTextToFileHandle = async (handle, text) => {
    const expected = String(text ?? '');
    let writable = null;
    try {
      writable = await handle.createWritable();
      await writable.write(expected);
      await writable.close();
      writable = null;
    } catch (err) {
      if (writable) {
        try {
          if (typeof writable.abort === 'function') await writable.abort();
          else await writable.close();
        } catch {}
      }
      throw err;
    }
    // Confirma a gravação imediatamente. Em pastas de rede/sincronizadas, uma falha
    // no close() pode deixar o arquivo recém-criado com 0 bytes; nesse caso mantemos
    // o evento no outbox e não mascaramos o problema como sucesso.
    try {
      const file = await handle.getFile();
      const actual = await file.text();
      if (String(actual) !== expected) throw new Error('Conteúdo verificado difere do conteúdo gravado.');
    } catch (err) {
      const verifyError = new Error('Gravação não confirmada no arquivo: ' + (err?.message || 'falha de verificação'));
      verifyError.name = 'FileWriteVerificationError';
      verifyError.cause = err;
      throw verifyError;
    }
  };
  const stringifyJsonForFile = (obj, opts={}) => opts.pretty === true
    ? JSON.stringify(obj, null, 2)
    : JSON.stringify(obj);
  const writeJsonToFileHandle = async (handle, obj, opts={}) => writeTextToFileHandle(handle, stringifyJsonForFile(obj, opts));
  const compactSharedEventForStorage = (event) => {
    if (!event || !event.id) return null;
    if (isConsolidatedEventReceipt(event)) return compactConsolidatedEventReceipt(event);
    const out = { ...event };
    delete out.sourceFile;
    delete out.status;
    if (out.consolidated === true && Object.prototype.hasOwnProperty.call(out, 'payload')) {
      return compactConsolidatedEventReceipt(out);
    }
    return out;
  };
  const compactSharedEventsForStorage = (events=[]) =>
    mergeEventListsUnique(events).map(compactSharedEventForStorage).filter(e => e && e.id);
  const eventFileEnvelopeForIdentity = (identityId='', identityName='', events=[]) => ({
    user: {
      userId: String(identityId || '').trim(),
      displayName: String(identityName || '').trim(),
    },
    events: compactSharedEventsForStorage(events),
    meta: { schema: 'orizon-user-events-v2' }
  });

  const ensureEventFolderReady = async ({ createSnapshotIfMissing=true } = {}) => {
    if (!capviewDataDirHandle || !capviewEventsDirHandle || !capviewSnapshotFileHandle) throw new Error('Selecione a pasta ORIZONData primeiro.');
    if (createSnapshotIfMissing) {
      let txt = '';
      try { txt = await fileTextOrDefault(capviewSnapshotFileHandle, '', { throwOnReadError:true }); }
      catch (err) { throw new Error('Não foi possível ler snapshot.json; nada foi sobrescrito. Reconecte a pasta ORIZONData.'); }
      if (!String(txt||'').trim()) await writeJsonToFileHandle(capviewSnapshotFileHandle, normalizeImportedState(buildDbExportObject()));
    }
    return true;
  };

  const ensureUserEventFileInitialized = async () => {
    ensureEventUser();
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const handle = await capviewEventsDirHandle.getFileHandle(eventSafeName() + '.json', { create:true });
    let txt = '';
    try { txt = await fileTextOrDefault(handle, '', { throwOnReadError:true }); }
    catch (err) { throw new Error('Não foi possível ler o arquivo de eventos do usuário; nada foi sobrescrito.'); }
    if (!String(txt || '').trim()) await writeJsonToFileHandle(handle, eventFileEnvelopeForIdentity(userId, userName, []));
    return handle;
  };

  const selectORIZONDataFolder = async (opts={}) => {
    try {
      if (!window.showDirectoryPicker) { toast('Seu navegador não permite selecionar pasta. Use Edge/Chrome atualizado.'); return false; }
      if (opts.requireUser !== false) ensureEventUser();
      const dir = await window.showDirectoryPicker({ mode:'readwrite' });
      if (!dir) return false;
      resetAppliedEventControl();
      capviewDataDirHandle = dir;
      capviewEventsDirHandle = await dir.getDirectoryHandle('events', { create:true });
      capviewSnapshotFileHandle = await dir.getFileHandle('snapshot.json', { create:true });
      capviewEventMode.enabled = true;
      capviewEventMode.folderName = dir.name || 'ORIZONData';
      capviewEventMode.lastStatus = 'Pasta vinculada. Alterações seráo registradas em /events por usuário.';
      persistEventFolderMeta();
      await ensureEventFolderReady({ createSnapshotIfMissing:true });
      await cleanupSyntheticLegacyOwnerEventFiles();
      if (opts.requireUser !== false) await ensureUserEventFileInitialized();
      await ensureResourceUserEventFiles({ toast:false });
      await cleanupDuplicateEmptyEventUserFiles();
      try { stopDbWatcher(); } catch {}
      disableDbAutoSyncForEventMode();
      const flushed = await flushLocalEventOutbox();
      toast('Pasta ORIZONData vinculada. Modo Eventos ligado.' + (flushed ? ' Outbox enviado: ' + flushed + ' evento(s).' : ''));
      await syncEventsFromFolder({ silent:true });
      if (capviewEventMode.autoSyncEnabled !== false) startEventAutoSync();
      render();
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      console.error('[ORIZON Eventos] Falha ao selecionar pasta:', e);
      toast('Falha ao selecionar pasta de eventos.');
      return false;
    }
  };

  const getMyEventFileHandle = async () => ensureUserEventFileInitialized();
  const getEventFileHandleForIdentity = async (identityId='', identityName='') => {
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const safeName = eventSafeNameForIdentity(identityId, identityName);
    const handle = await capviewEventsDirHandle.getFileHandle(safeName + '.json', { create:true });
    let txt = '';
    try { txt = await fileTextOrDefault(handle, '', { throwOnReadError:true }); }
    catch (err) { throw new Error('Não foi possível ler /events/' + safeName + '.json; nada foi sobrescrito.'); }
    if (!String(txt || '').trim()) await writeJsonToFileHandle(handle, eventFileEnvelopeForIdentity(identityId, identityName, []));
    return { handle, safeName };
  };

  const readEventFileDocument = async (handle) => {
    const txt = await fileTextOrDefault(handle, '[]');
    if (!String(txt||'').trim()) return { raw:'', parsed:null, events:[], user:null, invalid:false };
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) return { raw:txt, parsed, events:parsed.filter(e => e && e.id), user:null, invalid:false };
      if (parsed && typeof parsed === 'object') {
        const user = (parsed.user && typeof parsed.user === 'object') ? parsed.user : null;
        return { raw:txt, parsed, events:Array.isArray(parsed.events) ? parsed.events.filter(e => e && e.id) : [], user, invalid:false };
      }
    } catch (e) {
      console.warn('[ORIZON Eventos] Arquivo de eventos inválido:', handle?.name, e);
      return { raw:txt, parsed:null, events:[], user:null, invalid:true };
    }
    return { raw:txt, parsed:null, events:[], user:null, invalid:false };
  };

  const readEventArrayFromHandle = async (handle) => (await readEventFileDocument(handle)).events;

  const cleanupSyntheticLegacyOwnerEventFiles = async () => {
    if (!sharedFolderReady() || !capviewEventsDirHandle || typeof capviewEventsDirHandle.removeEntry !== 'function') return 0;
    let removed = 0;
    try {
      for await (const [name, handle] of capviewEventsDirHandle.entries()) {
        if (!handle || handle.kind !== 'file') continue;
        if (!String(name || '').toLowerCase().endsWith('.json')) continue;
        if (!isSyntheticLegacyOwnerEventFilename(name)) continue;
        const doc = await readEventFileDocument(handle);
        const docUserId = String(doc.user?.userId || doc.user?.id || normalizeEventFilenameBaseToOwnerId(name)).trim();
        const onlyLegacyOwnerEnvelope = isSyntheticLegacyOwnerId(docUserId) && !doc.invalid && !(doc.events || []).length;
        if (!onlyLegacyOwnerEnvelope) continue;
        await capviewEventsDirHandle.removeEntry(name);
        removed += 1;
      }
    } catch (err) {
      console.warn('[ORIZON Eventos] Falha ao limpar arquivos legacy-owner vazios:', err);
    }
    if (removed) setEventModeStatus(`${removed} arquivo(s) legacy-owner vazio(s) removido(s) de /events.`);
    return removed;
  };

  const eventUserIdentityFromFile = async (name, handle) => {
    const fileUser = userFromEventFilename(name);
    let docUser = null;
    let eventCount = 0;
    let invalid = false;
    try {
      const doc = await readEventFileDocument(handle);
      eventCount = Array.isArray(doc.events) ? doc.events.length : 0;
      invalid = !!doc.invalid;
      if (doc.user && (doc.user.userId || doc.user.displayName)) {
        docUser = {
          userId: String(doc.user.userId || doc.user.id || '').trim(),
          displayName: String(doc.user.displayName || doc.user.name || '').trim(),
          source:'events.metadata',
          sourceFile:String(name || '').trim(),
          eventCount
        };
      }
    } catch { invalid = true; }
    const user = docUser?.userId ? { ...fileUser, ...docUser, sources:[fileUser?.source, docUser.source].filter(Boolean) } : fileUser;
    return user ? { ...user, eventCount, invalid, sourceFile:String(name || '').trim() } : null;
  };

  const cleanupDuplicateEmptyEventUserFiles = async () => {
    if (!sharedFolderReady() || !capviewEventsDirHandle || typeof capviewEventsDirHandle.removeEntry !== 'function') return 0;
    const byName = new Map();
    try {
      for await (const [name, handle] of capviewEventsDirHandle.entries()) {
        if (!handle || handle.kind !== 'file') continue;
        if (!String(name || '').toLowerCase().endsWith('.json')) continue;
        if (isSyntheticLegacyOwnerEventFilename(name)) continue;
        const user = await eventUserIdentityFromFile(name, handle);
        const key = normalizedPersonName(user?.displayName);
        if (!user || !user.userId || !key || isSyntheticLegacyOwnerId(user.userId)) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(user);
      }
      let removed = 0;
      for (const users of byName.values()) {
        const unique = users.filter((item, idx, arr) => arr.findIndex(x => String(x.userId) === String(item.userId)) === idx);
        if (unique.length < 2) continue;
        const keep = choosePreferredUserIdentity(unique) || unique[0];
        for (const duplicate of unique) {
          if (String(duplicate.userId) === String(keep.userId)) continue;
          if (String(duplicate.userId) === String(userId || '').trim()) continue;
          if (duplicate.invalid || Number(duplicate.eventCount || 0) > 0 || !duplicate.sourceFile) continue;
          await capviewEventsDirHandle.removeEntry(duplicate.sourceFile);
          removed += 1;
        }
      }
      if (removed) setEventModeStatus(`${removed} arquivo(s) duplicado(s) vazio(s) removido(s) de /events.`);
      return removed;
    } catch (err) {
      console.warn('[ORIZON Eventos] Falha ao limpar usuários duplicados vazios:', err);
      return 0;
    }
  };

  const writeEventArrayToHandle = async (handle, events, identityId='', identityName='', opts={}) => {
    const current = opts.currentDoc || await readEventFileDocument(handle);
    const existingUser = (current.user && typeof current.user === 'object') ? current.user : {};
    const envelope = eventFileEnvelopeForIdentity(
      identityId || existingUser.userId || existingUser.id || '',
      identityName || existingUser.displayName || existingUser.name || '',
      Array.isArray(events) ? events : []
    );
    envelope.meta = { schema: 'orizon-user-events-v2' };
    await writeJsonToFileHandle(handle, envelope);
  };

  const eventArchiveFolderName = (date=new Date()) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  };

  const archiveAndClearConsolidatedEventFiles = async (consolidatedEvents, opts={}) => {
    if (!sharedFolderReady()) return { archivedEventCount:0, activeFilesTouched:0, archiveFolder:'' };
    const consolidatedIds = eventIdsSet(consolidatedEvents || []);
    const snapshotEventsToPreserve = (Array.isArray(opts.snapshotEvents) ? opts.snapshotEvents : [])
      .filter(ev => ev && ev.id && Object.prototype.hasOwnProperty.call(ev, 'payload'));
    if (!consolidatedIds.size && !snapshotEventsToPreserve.length) return { archivedEventCount:0, activeFilesTouched:0, archiveFolder:'' };

    const archiveRoot = await capviewEventsDirHandle.getDirectoryHandle('archive', { create:true });
    const folderName = String(opts.folderName || eventArchiveFolderName()).replace(/[^a-z0-9_.-]+/gi, '_').slice(0,80) || eventArchiveFolderName();
    const archiveDir = await archiveRoot.getDirectoryHandle(folderName, { create:true });
    let archivedEventCount = 0;
    let activeFilesTouched = 0;
    const archivedFiles = [];

    for await (const [name, handle] of capviewEventsDirHandle.entries()) {
      if (!handle || handle.kind !== 'file') continue;
      if (!String(name || '').toLowerCase().endsWith('.json')) continue;
      const currentDoc = await readEventFileDocument(handle);
      const current = currentDoc.events || [];
      const archived = current.filter(ev => ev && ev.id && consolidatedIds.has(String(ev.id)));
      if (!archived.length) continue;
      const remaining = current.filter(ev => !ev || !ev.id || !consolidatedIds.has(String(ev.id)));
      const archiveHandle = await archiveDir.getFileHandle(name, { create:true });
      const archiveCurrent = await readEventArrayFromHandle(archiveHandle);
      await writeJsonToFileHandle(archiveHandle, mergeEventListsUnique(archiveCurrent, archived));
      await writeEventArrayToHandle(handle, remaining, '', '', { currentDoc });
      const verifiedRemaining = await readEventArrayFromHandle(handle);
      const uncleared = verifiedRemaining.filter(ev => ev && ev.id && consolidatedIds.has(String(ev.id)));
      if (uncleared.length) throw new Error(`${name}: ${uncleared.length} evento(s) permaneceram no arquivo ativo após a limpeza.`);
      archivedEventCount += archived.length;
      activeFilesTouched += 1;
      archivedFiles.push(String(name));
    }

    if (snapshotEventsToPreserve.length) {
      const snapshotArchiveHandle = await archiveDir.getFileHandle('_snapshot_events_before_compact.json', { create:true });
      const archiveCurrent = await readEventArrayFromHandle(snapshotArchiveHandle);
      const uniqueSnapshotEvents = mergeEventListsUnique(archiveCurrent, snapshotEventsToPreserve);
      await writeJsonToFileHandle(snapshotArchiveHandle, uniqueSnapshotEvents);
      archivedEventCount += snapshotEventsToPreserve.length;
      archivedFiles.push('_snapshot_events_before_compact.json');
    }

    return {
      archivedEventCount,
      activeFilesTouched,
      archiveFolder: `events/archive/${folderName}`,
      archivedFiles: [...new Set(archivedFiles)]
    };
  };

  const verifyConsolidatedSnapshot = async (expectedEvents=[]) => {
    const writtenSnapshot = await readSnapshotFromEventFolder();
    const writtenIds = eventIdsSet(writtenSnapshot.events || []);
    const missingIds = eventIdsSet(expectedEvents || []);
    for (const id of writtenIds) missingIds.delete(id);
    if (missingIds.size) {
      throw new Error(`SNAP GERAL não confirmou ${missingIds.size} evento(s); os arquivos de origem foram preservados.`);
    }
    return writtenSnapshot;
  };

  const writeSingleEventToUserFile = async (event) => {
    const rawTargetUserId = String(event?.user_id || event?.userId || userId || '').trim();
    const targetUserId = isSyntheticLegacyOwnerId(rawTargetUserId) ? String(userId || '').trim() : rawTargetUserId;
    const targetUserName = String(event?.user || event?.userName || userName || '').trim();
    if (!targetUserId || isSyntheticLegacyOwnerId(targetUserId)) throw new Error('Evento sem usuário real; arquivo legacy-owner não será criado.');
    const { handle, safeName } = await getEventFileHandleForIdentity(targetUserId, targetUserName);
    const arr = await readEventArrayFromHandle(handle);
    if (!arr.some(e => String(e.id) === String(event.id))) {
      arr.push(compactSharedEventForStorage(event));
      arr.sort((a,b) => Number(a.timestamp||0) - Number(b.timestamp||0));
      await writeEventArrayToHandle(handle, arr, targetUserId, targetUserName);
    }
    // Verificação pós-gravação: evita falso positivo se o navegador negar escrita.
    const check = await readEventArrayFromHandle(handle);
    if (!check.some(e => String(e.id) === String(event.id))) throw new Error('Evento não confirmado no arquivo do usuário.');
    return safeName;
  };

  const flushLocalEventOutbox = async () => {
    if (!capviewEventMode.enabled || !sharedFolderReady()) return 0;
    if (capviewEventWriteInFlight) return 0;
    capviewEventWriteInFlight = true;
    const outbox = loadLocalEventOutbox();
    const writtenIds = [];
    const writtenFiles = new Set();
    try {
      for (const ev of outbox) {
        const safeName = await writeSingleEventToUserFile(ev);
        if (safeName) writtenFiles.add(safeName + '.json');
        writtenIds.push(String(ev.id));
      }
      if (writtenIds.length) {
        forgetLocalEventsFromOutbox(writtenIds);
        capviewEventMode.lastWriteAt = new Date().toISOString();
        const filesText = writtenFiles.size === 1 ? [...writtenFiles][0] : `${writtenFiles.size} arquivo(s) de usuário`;
        setEventModeStatus('Outbox enviado para /events/' + filesText + ': ' + writtenIds.length + ' evento(s).');
      }
      return writtenIds.length;
    } catch (e) {
      console.warn('[ORIZON Eventos] Falha ao enviar outbox:', e);
      const msg = 'Falha ao enviar outbox: ' + (e?.message || 'erro desconhecido');
      setEventModeStatus(msg);
      if (isEventFolderRecoverableError(e)) markEventFolderDisconnected('Pasta de eventos desconectada. Pendências locais preservadas; reconecte a ORIZONData para enviar o outbox.');
      return writtenIds.length;
    } finally {
      capviewEventWriteInFlight = false;
    }
  };

  const recordSharedEvent = async (event) => {
    if (!capviewEventMode.enabled) return false;
    if (!event || !event.id) return false;
    rememberLocalEventForSharedFile(event);

    if (!sharedFolderReady()) {
      setEventModeStatus('Evento guardado no outbox local. Selecione a pasta ORIZONData para criar /events/' + eventSafeName() + '.json.');
      return false;
    }

    const flushed = await flushLocalEventOutbox();
    if (flushed > 0 && capviewEventMode.autoSyncEnabled !== false) setTimeout(() => eventAutoSyncTick('local-write'), 250);
    return flushed > 0;
  };

  const readSnapshotFromEventFolder = async () => {
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const txt = await fileTextOrDefault(capviewSnapshotFileHandle, '{}');
    try { return normalizeImportedState(JSON.parse(txt || '{}')); }
    catch { return defaultState(); }
  };

  const readAllSharedEvents = async () => {
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const all = [];
    try {
      for await (const [name, handle] of capviewEventsDirHandle.entries()) {
        if (!handle || handle.kind !== 'file') continue;
        if (!String(name||'').toLowerCase().endsWith('.json')) continue;
        const arr = await readEventArrayFromHandle(handle);
        for (const ev of arr) all.push({ ...ev, sourceFile: ev.sourceFile || name });
      }
    } catch (e) { console.warn('[ORIZON Eventos] Falha ao ler diretório de eventos:', e); }
    const seen = new Set();
    return all.filter(e => e && e.id && !seen.has(String(e.id)) && seen.add(String(e.id))).sort((a,b) => Number(a.timestamp||0) - Number(b.timestamp||0));
  };

  const resourceUserRecord = (resource, source='snapshot') => {
    const r = normalizeLegacyResource(resource || {});
    const owner = String(r.owner_user_id || '').trim();
    const name = String(r.nome || r.name || r.createdBy || '').trim();
    if (!owner || isSyntheticLegacyOwnerId(owner) || !name) return null;
    return { userId: owner, displayName: name, resourceId: String(r.id || ''), source, resource: r };
  };
  const displayNameFromEventFileSlug = (slug='') => String(slug || '')
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : '')
    .join(' ')
    .trim();
  const userFromEventFilename = (filename='') => {
    const base = String(filename || '').trim().replace(/\.json$/i, '');
    if (isSyntheticLegacyOwnerEventFilename(base)) return null;
    const match = base.match(/^(.+?)__([a-z0-9]{4,})$/i);
    if (!match) return null;
    const displayName = displayNameFromEventFileSlug(match[1]);
    if (!displayName) return null;
    return { userId: base, displayName, source:'events.filename', sourceFile:String(filename || '').trim() };
  };
  const scanEventFolderUserFiles = async () => {
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    const users = [];
    try {
      for await (const [name, handle] of capviewEventsDirHandle.entries()) {
        if (!handle || handle.kind !== 'file') continue;
        if (!String(name || '').toLowerCase().endsWith('.json')) continue;
        const user = await eventUserIdentityFromFile(name, handle);
        if (user && !isSyntheticLegacyOwnerId(user.userId)) users.push(user);
      }
    } catch (e) { console.warn('[ORIZON Usuários] Falha ao ler nomes dos arquivos de eventos:', e); }
    return users;
  };

  const scanEventFolderUsers = async () => {
    await ensureEventFolderReady({ createSnapshotIfMissing:true });
    await cleanupSyntheticLegacyOwnerEventFiles();
    await cleanupDuplicateEmptyEventUserFiles();
    const snapshot = await readSnapshotFromEventFolder();
    const sharedEvents = await readAllSharedEvents();
    const fileUsers = await scanEventFolderUserFiles();
    const fileUserIds = new Set(fileUsers.map(u => String(u?.userId || '').trim()).filter(Boolean));
    const byId = new Map();
    const add = (u, opts={}) => {
      if (!u || !u.userId) return;
      const id = String(u.userId).trim();
      if (opts.requireEventFile && !fileUserIds.has(id)) return;
      const prev = byId.get(id) || {};
      byId.set(id, {
        ...prev,
        ...u,
        userId: id,
        displayName: String(u.displayName || prev.displayName || id).trim(),
        sources: [...new Set([...(prev.sources || []), u.source || 'desconhecido'])]
      });
    };
    for (const fileUser of fileUsers) add(fileUser);
    for (const r of (snapshot.resources || [])) add(resourceUserRecord(r, 'snapshot.resources'), { requireEventFile:true });
    for (const ev of sharedEvents) {
      if (ev.user_id && ev.user) add({ userId: ev.user_id, displayName: ev.user, source: ev.sourceFile || 'events' }, { requireEventFile:true });
      if ((ev.type === 'ADD_RESOURCE' || ev.type === 'UPDATE_RESOURCE') && ev.payload) add(resourceUserRecord(ev.payload, ev.sourceFile || ev.type), { requireEventFile:true });
    }
    for (const ev of (snapshot.events || [])) {
      if (ev.user_id && ev.user) add({ userId: ev.user_id, displayName: ev.user, source:'snapshot.events' }, { requireEventFile:true });
      if ((ev.type === 'ADD_RESOURCE' || ev.type === 'UPDATE_RESOURCE') && ev.payload) add(resourceUserRecord(ev.payload, 'snapshot.events.payload'), { requireEventFile:true });
    }
    const rawUsers = [...byId.values()];
    const byName = new Map();
    for (const u of rawUsers) {
      const key = normalizedPersonName(u.displayName);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(u);
    }
    const diagnostics = [...byName.entries()]
      .filter(([, items]) => new Set(items.map(u => String(u.userId || ''))).size > 1)
      .map(([name, items]) => ({ type:'duplicate-name-distinct-users', name, userIds:[...new Set(items.map(u => String(u.userId || '')))] }));
    const users = [...byName.values()]
      .map(items => choosePreferredUserIdentity(items) || items[0])
      .filter(Boolean)
      .sort((a,b) => String(a.displayName).localeCompare(String(b.displayName), 'pt-BR'));
    scannedEventUsers = users;
    scannedEventDiagnostics = diagnostics;
    if (diagnostics.length) console.warn('[ORIZON Usuários] Mesmo nome com user_id diferente:', diagnostics);
    return { users, diagnostics, snapshot, events: sharedEvents, fileUsers };
  };

  const applySingleEventToState = (target, event) => {
    if (!target || !event) return target;
    if (isConsolidatedEventReceipt(event)) {
      if (!Array.isArray(target.events)) target.events = [];
      if (event.id && !target.events.some(e => String(e.id) === String(event.id))) target.events.push(event);
      return target;
    }
    const type = event.type;
    let payload = event.payload;
    if ((type === 'ADD_RESOURCE' || type === 'UPDATE_RESOURCE') && payload && typeof payload === 'object') payload = normalizeLegacyResource(payload);
    if (type === 'DELETE_RESOURCE' && payload && typeof payload === 'object' && payload.id) payload = { ...payload, id: normalizeLegacyIdKind(payload.id, 'id', 'resource') };
    else if (type === 'DELETE_RESOURCE' && typeof payload === 'string') payload = normalizeLegacyIdKind(payload, 'id', 'resource');
    const upsert = (arr, item) => {
      if (!item || !item.id) return Array.isArray(arr) ? arr : [];
      const base = Array.isArray(arr) ? arr : [];
      return base.some(x => String(x.id) === String(item.id)) ? base.map(x => String(x.id) === String(item.id) ? item : x) : [...base, item];
    };
    switch (type) {
      case 'ADD_RESOURCE': case 'UPDATE_RESOURCE': target.resources = upsert(target.resources, payload); break;
      case 'DELETE_RESOURCE': removeResourceCascade(target, payload); break;
      case 'ADD_DEMAND': case 'UPDATE_DEMAND': {
        const prev = (target.demands || []).find(d => String(d.id) === String(payload?.id));
        target.demands = upsert(target.demands, normalizeDemandAllocationState(normalizeDemandBaseline(payload), prev, target.resources || []));
        break;
      }
      case 'ADD_INTERNAL_ACTIVITY': case 'UPDATE_INTERNAL_ACTIVITY': target.internalActivities = upsert(target.internalActivities, payload); break;
      case 'DELETE_INTERNAL_ACTIVITY': target.internalActivities = (target.internalActivities||[]).filter(x => String(x.id) !== String(payload)); break;
      case 'DELETE_DEMAND': target.demands = (target.demands||[]).filter(d => String(d.id) !== String(payload)); break;
      case 'DELETE_DEMANDS': target.demands = (target.demands||[]).filter(d => !demandMatchesDeletePayload(d, payload)); break;
      case 'REPROGRAM_DEMAND': {
        if (payload?.reprogramming) target.reprogrammings = upsert(target.reprogrammings, payload.reprogramming);
        target.demands = (target.demands||[]).map(d => {
          if (String(d.id) !== String(payload?.demandId)) return d;
          const rp = payload.reprogramming || {};
          const updated = { ...d, data_fim: rp.novo_fim || rp.novo_prazo || d.data_fim || '', reprogramacoes: (d.reprogramacoes||0) + 1 };
          return alignNonTransferAllocationsToDemandWindow(updated, target.resources || []);
        });
        break;
      }
      case 'TRANSFER_DEMAND_ALLOCATION': {
        if (payload?.demand && payload.demand.id) {
          target.demands = upsert(target.demands, normalizeDemandAllocationState(normalizeDemandBaseline(payload.demand), (target.demands || []).find(d => String(d.id) === String(payload.demand.id)), target.resources || []));
          break;
        }

        const demandId = String(payload?.demandId || '').trim();
        target.demands = (target.demands || []).map(d => {
          if (String(d.id || '') !== demandId) return d;
          const transferDate = normalizeDateLikeToISO(payload.transferDate || todayISO()) || todayISO();
          const transferEnd = normalizeDateLikeToISO(payload.transferEnd || payload.endDate || '') || '';
          const previousEnd = addDaysISO(transferDate, -1) || transferDate;
          const nextStart = transferDate;
          const fromId = String(payload.fromResourceId || d.responsavel_id || '').trim();
          const toId = String(payload.toResourceId || '').trim();
          if (!toId || fromId === toId) return d;
          const hours = firstHoursLike(payload.horas_planejadas_dia, payload.horas_dia, d.horas_planejadas_dia, d.horas_dia) ?? 0;
          const allocations = normalizeDemandAllocations(d, target.resources || [])
            .map(a => (String(a.resourceId || '') === fromId && demandAllocationActiveOnDate(a, d, transferDate))
              ? { ...a, data_inicio: a.data_inicio || d.data_inicio || '', data_fim: previousEnd }
              : a);
          const nextAlloc = makeDemandAllocation(toId, hours, target.resources || []);
          nextAlloc.data_inicio = nextStart;
          nextAlloc.data_fim = transferEnd || d.data_fim || '';
          nextAlloc.created_at = Number(event.timestamp || Date.now());
          allocations.push(nextAlloc);
          return normalizeDemandBaseline({
            ...d,
            responsavel_id: toId,
            allocations,
            transfer_history: [
              ...(Array.isArray(d.transfer_history) ? d.transfer_history : []),
              {
                id: generateId('transfer'),
                fromResourceId: fromId,
                toResourceId: toId,
                transferDate,
                previousEnd,
                nextStart,
                transferEnd,
                horas_planejadas_dia: roundDemandHours(hours),
                justification: String(payload.justification || '').trim(),
                timestamp: Number(event.timestamp || Date.now()),
                user: event.user || '',
                user_id: event.user_id || ''
              }
            ]
          });
        });
        break;
      }
      case 'ADD_BLOCKING': target.blockings = upsert(target.blockings, payload); break;
      case 'DELETE_BLOCKING': target.blockings = (target.blockings||[]).filter(b => String(b.id) !== String(payload)); break;
      case 'ADD_HOLIDAY': target.holidays = upsert(target.holidays, payload); break;
      case 'DELETE_HOLIDAY': target.holidays = (target.holidays||[]).filter(h => String(h.id) !== String(payload)); break;
      case 'ADD_OVERTIME': target.overtimes = upsert(target.overtimes, payload); break;
      case 'DELETE_OVERTIME': { const id = (payload && typeof payload==='object') ? payload.id : payload; target.overtimes = (target.overtimes||[]).filter(o => String(o.id) !== String(id)); break; }
      default: break;
    }
    if (!Array.isArray(target.events)) target.events = [];
    if (!target.events.some(e => String(e.id) === String(event.id))) target.events.push(event);
    return target;
  };

  const eventPayloadId = (payload) =>
    normalizeLegacyIdKind(String((payload && typeof payload === 'object') ? (payload.id || payload.demandId || payload.resource_id || payload.resourceId || '') : payload || ''), 'id', 'resource');

  const applyDeleteTombstonesFromEvents = (target, events) => {
    if (!target || !Array.isArray(events)) return target;
    const deletedDemandIds = new Set();
    const deletedDemandGroupKeys = new Set();
    const deletedLogicalGroupIds = new Set();
    const deletedResourceIds = new Set();
    for (const ev of events) {
      if (!ev || !ev.type) continue;
      const id = eventPayloadId(ev.payload);
      if (ev.type === 'DELETE_DEMAND') deletedDemandIds.add(id);
      if (ev.type === 'DELETE_DEMANDS') {
        for (const demandId of (Array.isArray(ev.payload?.ids) ? ev.payload.ids : [])) {
          if (demandId) deletedDemandIds.add(String(demandId));
        }
        for (const key of (Array.isArray(ev.payload?.groupKeys) ? ev.payload.groupKeys : [])) {
          if (key) deletedDemandGroupKeys.add(String(key));
        }
        for (const groupId of (Array.isArray(ev.payload?.logicalGroupIds) ? ev.payload.logicalGroupIds : [])) {
          if (groupId) deletedLogicalGroupIds.add(String(groupId));
        }
      }
      if (ev.type === 'DELETE_RESOURCE' && id) deletedResourceIds.add(id);
    }
    if (deletedDemandIds.size) {
      target.demands = (target.demands || []).filter(d => !deletedDemandIds.has(String(d.id)));
      target.reprogrammings = (target.reprogrammings || []).filter(rp => !deletedDemandIds.has(String(rp.demanda_id || rp.demandId || '')));
    }
    if (deletedDemandGroupKeys.size || deletedLogicalGroupIds.size) {
      target.demands = (target.demands || []).filter(d =>
        !deletedDemandGroupKeys.has(demandDisplayGroupKey(d)) &&
        !deletedLogicalGroupIds.has(String(d.logical_group_id || ''))
      );
    }
    for (const id of deletedResourceIds) removeResourceCascade(target, { id });
    return target;
  };

  const eventIdsSet = (events=[]) => new Set((Array.isArray(events) ? events : []).map(e => String(e?.id || '')).filter(Boolean));

  const pendingEventsNotInSnapshot = (snapshot, events) => {
    const inSnapshot = eventIdsSet(snapshot?.events || []);
    return (Array.isArray(events) ? events : []).filter(e => e && e.id && !isConsolidatedEventReceipt(e) && !inSnapshot.has(String(e.id)));
  };

  const rebuildSnapshotFromEvents = (snapshot, events, opts={}) => {
    const baseSnapshot = normalizeImportedState(snapshot || defaultState());
    const allEvents = mergeEventListsUnique(baseSnapshot.events || [], events || []);
    const snapshotEventIds = eventIdsSet(baseSnapshot.events || []);
    const pending = (Array.isArray(events) ? events : [])
      .filter(e => e && e.id && !snapshotEventIds.has(String(e.id)) && !isConsolidatedEventReceipt(e))
      .sort((a,b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
    const base = normalizeImportedState(deepClone(baseSnapshot));

    if (opts.preserveSnapshotResources === false) base.resources = [];
    for (const ev of pending) applySingleEventToState(base, ev);
    applyDeleteTombstonesFromEvents(base, pending);
    base.demands = dedupeLikelyDuplicateDemands(base.demands);

    base.events = compactConsolidatedEventReceipts(allEvents);
    base.meta = {
      ...(baseSnapshot.meta && typeof baseSnapshot.meta === 'object' ? baseSnapshot.meta : {}),
      rebuiltFromEventsAt: new Date().toISOString(),
      rebuiltEventCount: allEvents.length,
      compactedEventReceiptCount: base.events.length,
      pendingEventsBeforeRebuild: pending.length,
    };
    return normalizeImportedState(base);
  };

  const buildStateFromSnapshotAndEvents = (snapshot, events) => {
    const merged = normalizeImportedState(deepClone(snapshot || defaultState()));

    // FIX V6.0.4 ? Feriados são base de calend?rio, não apenas eventos.
    // Quando o snapshot.json da pasta ainda não tem holidays, o sync de eventos
    // não pode reconstruir o estado zerando os feriados cadastrados/localmente.
    // Por isso, antes de aplicar eventos, mescla os feriados do snapshot com os
    // feriados já existentes na sessão/localStorage. Eventos DELETE_HOLIDAY
    // continuam respeitados logo abaixo, porque são aplicados depois desta uni?o.
    try {
      const localHolidays = Array.isArray(state?.holidays) ? state.holidays : [];
      merged.holidays = mergeHolidaysNonDestructive(merged.holidays, localHolidays);
    } catch (e) {
      console.warn('[ORIZON Feriados] Falha ao preservar feriados locais durante sync de eventos:', e);
    }

    // Eventos já incorporados no snapshot consolidado. Esses não precisam ser
    // reaplicados na tela.
    const snapshotEventIds = new Set((merged.events||[]).map(e => String(e.id)));

    // Eventos ainda não consolidados no snapshot. Eles precisam ser reaplicados
    // a cada leitura para montar a visão atual, mas não devem gerar toast em loop.
    const pending = (events||[])
      .filter(e => e && e.id && !snapshotEventIds.has(String(e.id)))
      .sort((a,b) => Number(a.timestamp||0) - Number(b.timestamp||0));

    const appliedIds = loadAppliedEventIds();
    const newPending = pending.filter(e => !appliedIds.has(String(e.id)));

    for (const ev of pending) applySingleEventToState(merged, ev);
    applyDeleteTombstonesFromEvents(merged, mergeEventListsUnique(events, merged.events || []));
    merged.demands = dedupeLikelyDuplicateDemands(merged.demands);

    // Marca como visto depois de montar a tela. Assim o próximo autosync pode
    // reconstruir a visão, mas não mostra novamente "evento recebido".
    markAppliedEvents(pending);

    merged.meta = {
      ...(merged.meta && typeof merged.meta === 'object' ? merged.meta : {}),
      eventModeMergedAt: new Date().toISOString(),
      eventModePendingApplied: pending.length,
      eventModeNewPendingApplied: newPending.length
    };
    return { merged, pending, newPending };
  };

  const syncEventsFromFolder = async ({ silent=false, source='manual' } = {}) => {
    try {
      await ensureEventFolderReady({ createSnapshotIfMissing:true });
      await flushLocalEventOutbox();
      const snapshot = await readSnapshotFromEventFolder();
      const sharedEvents = await readAllSharedEvents();
      const events = mergeEventListsUnique(sharedEvents, loadLocalEventOutbox());
      const { merged, pending, newPending } = buildStateFromSnapshotAndEvents(snapshot, events);
      state = normalizeImportedState(merged);
      invalidateDashboardCapacityCache();
      capviewEventMode.lastReadAt = new Date().toISOString();
      capviewEventMode.pendingReadCount = newPending.length;
      const pendingUsers = [...new Set(newPending.map(e => e.user || e.user_id || e.sourceFile || 'usuário').filter(Boolean))].slice(0,3);
      setEventModeStatus((source === 'autosync' ? 'Autosync: ' : '') + newPending.length + ' evento(s) novo(s); ' + pending.length + ' pendente(s) aplicado(s) sobre o snapshot' + (pendingUsers.length ? ' ? recebido de: ' + pendingUsers.join(', ') : '') + '.');
      const prevSuppress = suppressDbAutoSave;
      suppressDbAutoSave = true;
      try { persist({ skipAutoSave:true }); } finally { suppressDbAutoSave = prevSuppress; }
      if (!silent) toast(newPending.length + ' evento(s) novo(s); ' + pending.length + ' pendente(s) aplicado(s).');
      else if (newPending.length > 0 && source === 'autosync') toast('Evento recebido: ' + pendingUsers.join(', '));
      if (!silent || newPending.length > 0 || source !== 'autosync') requestRenderSafely(source === 'autosync' ? 'autosync-eventos' : 'sync-eventos');
      return newPending.length;
    } catch (e) {
      console.error('[ORIZON Eventos] Falha ao sincronizar:', e);
      if (isEventFolderRecoverableError(e)) markEventFolderDisconnected('Pasta de eventos desconectada. Reconecte a ORIZONData para ler snapshot e eventos.');
      if (!silent) toast(e?.message || 'Falha ao ler eventos da pasta.');
      return 0;
    }
  };

  const consolidateEventsToSnapshot = async () => {
    try {
      await ensureEventFolderReady({ createSnapshotIfMissing:true });
      await flushLocalEventOutbox();
      const snapshot = await readSnapshotFromEventFolder();
      const sharedEvents = await readAllSharedEvents();
      const events = mergeEventListsUnique(sharedEvents, loadLocalEventOutbox());
      const pending = pendingEventsNotInSnapshot(snapshot, events);
      const merged = rebuildSnapshotFromEvents(snapshot, events, { preserveSnapshotResources:true });
      const consolidatedAt = new Date().toISOString();
      markAppliedEvents(merged.events || []);
      merged.meta = {
        ...(merged.meta && typeof merged.meta === 'object' ? merged.meta : {}),
        consolidatedAt,
        consolidatedBy: userName || '',
        consolidatedById: userId || '',
        consolidatedEventCount: events.length,
        compactedEventReceiptCount: (merged.events || []).length
      };
      await writeJsonToFileHandle(capviewSnapshotFileHandle, normalizeImportedState(merged));
      await verifyConsolidatedSnapshot(events);
      forgetLocalEventsFromOutbox(events.map(ev => ev?.id).filter(Boolean));

      let archiveSummary = null;
      try {
        archiveSummary = await archiveAndClearConsolidatedEventFiles(sharedEvents, { snapshotEvents: snapshot.events || [] });
        if (sharedEvents.length && (!archiveSummary || archiveSummary.archivedEventCount < sharedEvents.length || !archiveSummary.activeFilesTouched)) {
          throw new Error('SNAP GERAL foi atualizado, mas nem todos os eventos foram arquivados e zerados nos arquivos de origem.');
        }
        if (archiveSummary && archiveSummary.archiveFolder) {
          merged.meta = {
            ...(merged.meta && typeof merged.meta === 'object' ? merged.meta : {}),
            lastArchiveFolder: archiveSummary.archiveFolder,
            archivedEventCount: archiveSummary.archivedEventCount || 0,
            archivedActiveFileCount: archiveSummary.activeFilesTouched || 0
          };
          await writeJsonToFileHandle(capviewSnapshotFileHandle, normalizeImportedState(merged));
        }
      } catch (archiveError) {
        console.warn('[ORIZON Eventos] Snapshot consolidado, mas falha ao arquivar/limpar eventos ativos:', archiveError);
        merged.meta = {
          ...(merged.meta && typeof merged.meta === 'object' ? merged.meta : {}),
          lastArchiveErrorAt: new Date().toISOString(),
          lastArchiveError: archiveError?.message || 'Falha ao arquivar eventos ativos'
        };
        try { await writeJsonToFileHandle(capviewSnapshotFileHandle, normalizeImportedState(merged)); } catch {}
        throw new Error('SNAP GERAL atualizado, porém os arquivos de eventos não foram zerados: ' + (archiveError?.message || 'falha de limpeza'));
      }

      state = normalizeImportedState(merged);
      invalidateDashboardCapacityCache();
      capviewEventMode.lastReadAt = new Date().toISOString();
      capviewEventMode.pendingReadCount = 0;
      const archiveText = archiveSummary?.archiveFolder
        ? ' Arquivo: ' + archiveSummary.archiveFolder + ' (' + (archiveSummary.archivedEventCount || 0) + ' evento(s)).'
        : '';
      setEventModeStatus('Snapshot consolidado com ' + pending.length + ' evento(s) novo(s).' + archiveText);
      const prevSuppress = suppressDbAutoSave;
      suppressDbAutoSave = true;
      try { persist({ skipAutoSave:true }); } finally { suppressDbAutoSave = prevSuppress; }
      toast('Snapshot consolidado. ' + pending.length + ' evento(s) novo(s) incorporado(s).' + (archiveSummary?.activeFilesTouched ? ' Eventos ativos limpos.' : ''));
      render();
      return true;
    } catch (e) {
      console.error('[ORIZON Eventos] Falha ao consolidar snapshot:', e);
      if (isEventFolderRecoverableError(e)) markEventFolderDisconnected('Pasta de eventos desconectada. Reconecte a ORIZONData para consolidar o snapshot.');
      toast(e?.message || 'Falha ao consolidar eventos no snapshot.');
      return false;
    }
  };

  const disableEventMode = () => {
    stopEventAutoSync();
    capviewEventMode.enabled = false;
    capviewEventMode.lastStatus = 'Modo Eventos desligado nesta sessão.';
    persistEventFolderMeta();
    toast('Modo Eventos desligado.');
    render();
  };




  // ----------------------
  // Import snapshot (Adicionar / Mesclar)
  // - Mantém tudo LOCAL (file://)
  // - Não sobrescreve: concatena coleções e resolve colisões de ID
  // - Une resources/holidays de forma não destrutiva (base oficial)
  const mergeSnapshotAdd = (incoming) => {
    if (!incoming || typeof incoming !== 'object') throw new Error('Snapshot inválido.');

    const meta = (incoming.meta && typeof incoming.meta === 'object') ? incoming.meta : {};
    const originName = String(meta.authorName || incoming.userName || '').trim();
    const originUserId = String(meta.authorUserId || incoming.userId || '').trim();
    const origin = (originUserId || (originName ? (slugify(originName)||'import') : 'import'));

    const makeImportedId = (kind) => `${origin}::${kind}::${safeUUID()||uid()}`;

    const mergeUnionById = (target, add, kind) => {
      const arrT = Array.isArray(target) ? target : [];
      const arrA = Array.isArray(add) ? add : [];
      const seen = new Set(arrT.map(x => String(x && x.id)));
      for (const raw of arrA) {
        if (!raw || typeof raw !== 'object') continue;
        const item = { ...raw };
        const id0 = String(item.id || '').trim();
        if (!id0 || seen.has(id0)) item.id = makeImportedId(kind);
        seen.add(String(item.id));
        // carimbo de origem (não quebra builds antigas)
        if (!item.created_by) item.created_by = originName || origin;
        if (!item.created_by_id) item.created_by_id = originUserId || origin;
        arrT.push(item);
      }
      return arrT;
    };

    // Base: resources / holidays -> uni?o não destrutiva
    if (Array.isArray(incoming.resources)) {
      const existing = new Set((state.resources||[]).map(r=>String(r.id)));
      for (const r of incoming.resources) {
        if (!r || !r.id) continue;
        if (!existing.has(String(r.id))) state.resources.push(r);
      }
    }
    if (Array.isArray(incoming.holidays)) {
      const existing = new Set((state.holidays||[]).map(h=>String(h.id||h.data)));
      for (const h of incoming.holidays) {
        if (!h) continue;
        const key = String(h.id||h.data||'');
        if (!key) continue;
        if (!existing.has(key)) state.holidays.push(h);
      }
    }

    // Propostas: concatena + resolve colisões
    state.demands = mergeUnionById(state.demands, incoming.demands, 'demand');
    state.blockings = mergeUnionById(state.blockings, incoming.blockings, 'blocking');
    state.overtimes = mergeUnionById(state.overtimes, incoming.overtimes, 'he');
    state.reprogrammings = mergeUnionById(state.reprogrammings, incoming.reprogrammings, 'reprogram');

    // Events: concatena, mas garante IDs únicos
    const evT = Array.isArray(state.events) ? state.events : [];
    const evA = Array.isArray(incoming.events) ? incoming.events : [];
    const seenEv = new Set(evT.map(e => String(e && e.id)));
    for (const raw of evA) {
      if (!raw || typeof raw !== 'object') continue;
      const e = { ...raw };
      const id0 = String(e.id||'').trim();
      if (!id0 || seenEv.has(id0)) e.id = makeImportedId('event');
      seenEv.add(String(e.id));
      if (!e.user) e.user = originName || origin;
      if (!e.user_id) e.user_id = originUserId || origin;
      evT.push(e);
    }
    state.events = evT;

    persist();
    render();
  };

  // ----------------------
  // Calculations
  // ----------------------
  const resourceById = () => Object.fromEntries(state.resources.map(r => [r.id, r]));

  // ----------------------
  // Capacity Engine v0.1.2
  // ----------------------
  // Núcleo único para regras de capacidade, HE, feriados, bloqueios, férias/OFF e alocação.
  // Mantém wrappers legados abaixo para não alterar chamadas existentes nem visual.
  const CapacityEngine = {
    isHoliday(dateStr) {
      return getCapacityIndexes().holidaysByDate.has(String(dateStr || ''));
    },

    blockingFor(resourceId, dateStr) {
      const idx = getCapacityIndexes();
      const direct = [
        ...(idx.blockingsByResourceDate.get(`${String(resourceId || '')}|${String(dateStr || '')}`) || []),
        ...(idx.globalBlockingsByDate.get(String(dateStr || '')) || [])
      ].find(b => blockingCoversDate(b, resourceId, dateStr) || String(b.recurso_id || b.resourceId || b.resource_id || '') === '__ALL__');
      if (direct) return direct;
      const list = [
        ...(idx.blockingsByResourceId.get(String(resourceId || '')) || []),
        ...(idx.globalBlockings || [])
      ];
      return list.find(b => blockingCoversDate(b, resourceId, dateStr));
    },

    overtimeInfo(resourceId, dateStr) {
      const idx = getCapacityIndexes();
      const list = [
        ...(idx.globalOvertimesByDate.get(String(dateStr || '')) || []),
        ...(idx.overtimesByResourceDate.get(`${String(resourceId || '')}|${String(dateStr || '')}`) || [])
      ];
      const items = list.map(o => ({
        id: o.id,
        horas: Number(o.horas || 0) || 0,
        motivo: (o.motivo || '').trim(),
        titulo: (o.titulo || o.atividade || '').trim(),
        atividade: (o.atividade || o.titulo || '').trim(),
        predio: (o.predio || '').trim(),
        focal: (o.focal || '').trim(),
        prioridade: (o.prioridade || '').trim(),
        observacoes: (o.observacoes || '').trim(),
        resourceId: (o.resourceId ?? o.recurso_id ?? '__ALL__'),
        date: (o.date ?? o.data ?? dateStr),
        createdAt: o.createdAt,
      }));

      const total = items.reduce((s, x) => s + Math.max(0, Number(x.horas || 0)), 0);
      return { total, items };
    },

    fmtHours(h) {
      const v = Math.max(0, Number(h || 0));
      if (!isFinite(v)) return '0';
      return (Math.abs(v - Math.round(v)) < 1e-9) ? String(Math.round(v)) : v.toFixed(1);
    },

    isThirdPartyOff(resource, dateStr) {
      if (!resource || resource.tipo !== 'Terceiro') return false;
      if (resource.vigencia_inicio && dateStr < resource.vigencia_inicio) return true;
      if (resource.vigencia_fim && dateStr > resource.vigencia_fim) return true;
      return false;
    },

    nonWorkingReasonForDay(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      if (this.isHoliday(dateStr)) return { code: -2, label: 'FER' };
      if (isWeekend(dateObj)) return { code: -5, label: 'FDS' };
      const blk = this.blockingFor(resourceId, dateStr);
      if (blk) {
        if (String(blk.tipo || '').trim().toLowerCase() === 'férias') return { code: -4, label: 'FÉR' };
        return { code: -1, label: 'BLOQ' };
      }
      const res = getCapacityIndexes().resourcesById.get(String(resourceId || ''));
      if (this.isThirdPartyOff(res, dateStr)) return { code: -3, label: 'OFF' };
      return null;
    },

    baseCapacityForDay(resourceId, dateObj) {
      const reason = this.nonWorkingReasonForDay(resourceId, dateObj);
      if (reason) return 0;
      const res = getCapacityIndexes().resourcesById.get(String(resourceId || ''));
      return getResourceHoursForDate(res, dateObj);
    },

    dailyCapacityWithOvertime(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      const he = this.overtimeInfo(resourceId, dateStr).total;
      const base = this.baseCapacityForDay(resourceId, dateObj);
      return Math.max(0, Number(base || 0)) + Math.max(0, Number(he || 0));
    },

    dailyDemandHoursAllocated(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      const reason = this.nonWorkingReasonForDay(resourceId, dateObj);

      // Regra conservadora HE/FDS:
      // HE adiciona capacidade extra, mas NÃO libera demanda normal em dia não útil.
      // Assim, FDS/feriado/bloqueio/férias/OFF com HE aparece como HE azul, sem somar demandas do intervalo.
      if (reason) return 0;

      let total = 0;
      const entries = getCapacityIndexes().demandEntriesByResourceId.get(String(resourceId || '')) || [];
      for (const entry of entries) {
        const dem = entry.demand;
        if (!demandCountsInAllocationOnDate(dem, dateStr)) continue;
        if (!demandHistoricalWindowContainsDate(dem, dateStr)) continue;
        const allocHours = (entry.allocations || [])
          .filter(a => demandAllocationActiveOnDate(a, dem, dateStr))
          .reduce((acc, a) => acc + demandAllocationHoursForDate(a, resourceId, dateObj, state.resources || []), 0);
        total += allocHours;
      }
      return roundDemandHours(total);
    },

    dailyPercentAllocated(resourceId, dateObj) {
      const reason = this.nonWorkingReasonForDay(resourceId, dateObj);
      if (reason) return reason.code;
      const res = getCapacityIndexes().resourcesById.get(String(resourceId || ''));
      const base = getResourceHoursForDate(res, dateObj);
      if (!base) return 0;
      return Math.round((this.dailyDemandHoursAllocated(resourceId, dateObj) / base) * 1000) / 10;
    },

    freeHoursInfo(resourceId, dateObj) {
      const dateStr = formatDate(dateObj);
      const cacheKey = `${dashboardCapacityCacheVersion}|${String(resourceId || '')}|${dateStr}`;
      const cached = capacityFreeHoursInfoCache.get(cacheKey);
      if (cached) return cloneFreeHoursInfo(cached);
      const remember = (info) => {
        capacityFreeHoursInfoCache.set(cacheKey, info);
        return cloneFreeHoursInfo(info);
      };
      const otInfo = this.overtimeInfo(resourceId, dateStr);
      const otHours = Math.max(0, Number(otInfo.total || 0));
      const res = getCapacityIndexes().resourcesById.get(String(resourceId || ''));
      const blk = this.blockingFor(resourceId, dateStr);
      const isVac = blk && String(blk.tipo || '').trim().toLowerCase() === 'férias';
      const blockedNoHe = isWeekend(dateObj) || this.isHoliday(dateStr) || !!blk || this.isThirdPartyOff(res, dateStr);

      if (blockedNoHe && otHours <= 0) {
        if (this.isHoliday(dateStr)) return remember({ dateStr, capacity: 0, allocated: 0, free: 0, tag: 'FER', cls: 'bg-holiday', eligible: false, overtime: otInfo });
        if (isWeekend(dateObj)) return remember({ dateStr, capacity: 0, allocated: 0, free: 0, tag: 'FDS', cls: 'bg-wknd', eligible: false, overtime: otInfo });
        if (blk) return remember({ dateStr, capacity: 0, allocated: 0, free: 0, tag: isVac ? 'FÉRIAS' : 'BLOQ', cls: isVac ? 'bg-vac' : 'bg-block', eligible: false, overtime: otInfo });
        return remember({ dateStr, capacity: 0, allocated: 0, free: 0, tag: 'OFF', cls: 'bg-off', eligible: false, overtime: otInfo });
      }

      const base = blockedNoHe ? 0 : getResourceHoursForDate(res, dateObj);
      const capacity = Math.max(0, Number(base || 0)) + otHours;
      const allocatedFromDemandsHH = this.dailyDemandHoursAllocated(resourceId, dateObj);
      const perc = demandHoursToPercent(allocatedFromDemandsHH, resourceId, state.resources || []);
      const allocatedFromInternalHH = internalActivityHoursForDay(resourceId, dateObj);
      // Ocupação/janelas consideram somente demandas planejadas.
      // Atividades internas permanecem disponíveis como indicador separado, sem consumir a janela.
      const allocated = allocatedFromDemandsHH;
      const free = capacity - allocated;

      let cls = '';
      if (this.isHoliday(dateStr)) cls = 'bg-holiday';
      else if (isWeekend(dateObj) && otHours > 0) cls = 'bg-he';
      else if (free < 0) cls = 'bg-over';
      else if (free <= capacity * 0.2) cls = 'bg-mid';
      else cls = 'bg-ok';

      const tag = this.isHoliday(dateStr) ? 'FER' :
        ((isWeekend(dateObj) && otHours > 0) ? `HE ${otHours}h` : (perc > 0 ? `-${allocated.toFixed(1)}h` : 'livre'));

      return remember({ dateStr, capacity, allocated, allocatedFromDemandsHH, allocatedFromInternalHH, free, tag, cls, eligible: true, overtime: otInfo });
    }
  };

  const isHoliday = (dateStr) => CapacityEngine.isHoliday(dateStr);
  const blockingFor = (resourceId, dateStr) => CapacityEngine.blockingFor(resourceId, dateStr);
  const overtimeInfo = (resourceId, dateStr) => CapacityEngine.overtimeInfo(resourceId, dateStr);
  const fmtHours = (h) => CapacityEngine.fmtHours(h);
  const isThirdPartyOff = (resource, dateStr) => CapacityEngine.isThirdPartyOff(resource, dateStr);
  const nonWorkingReasonForDay = (resourceId, dateObj) => CapacityEngine.nonWorkingReasonForDay(resourceId, dateObj);
  const baseCapacityForDay = (resourceId, dateObj) => CapacityEngine.baseCapacityForDay(resourceId, dateObj);
  const dailyCapacityWithOvertime = (resourceId, dateObj) => CapacityEngine.dailyCapacityWithOvertime(resourceId, dateObj);
  const dailyDemandHoursAllocated = (resourceId, dateObj) => CapacityEngine.dailyDemandHoursAllocated(resourceId, dateObj);
  const dailyPercentAllocated = (resourceId, dateObj) => CapacityEngine.dailyPercentAllocated(resourceId, dateObj);


  const kpis = (demandsList = state.demands) => {
    const totalResources = state.resources.length;
    const activeResources = state.resources.filter(r => r.ativo !== false).length;
    const logicalDemands = groupDemandsForDisplay(demandsList || []);
    const totalDemands = logicalDemands.length;
    const openDemands = logicalDemands.filter(d => !['Concluída','Cancelada'].includes(effectiveStatus(d))).length;
    return { totalResources, activeResources, totalDemands, openDemands };
  };



  // ----------------------
  // Detalhes por dia (modal)
  // ----------------------
  const demandsForResourceOnDate = (resourceId, dateStr) => {
    return (getCapacityIndexes().demandEntriesByResourceId.get(String(resourceId || '')) || []).filter(entry => {
      const d = entry.demand;
      const hasResource = (entry.allocations || []).some(a => demandAllocationActiveOnDate(a, d, dateStr));
      if (!hasResource) return false;
      if (!demandHistoricalWindowContainsDate(d, dateStr)) return false;
      return demandAppearsInHeatmapOnDate(d, dateStr);
    }).map(entry => entry.demand);
  };

  const openDayDetails = (resourceId, dateObj) => {
    const dateStr = formatDate(dateObj);
    const res = state.resources.find(r => r.id === resourceId);
    const dlg = qs('#dayModal');

    qs('#dayModalTitle').textContent = `${(res && res.nome) ? res.nome : 'Recurso'} - ${formatDateBR(dateStr)}`;

    const weekday = dateObj.toLocaleString('pt-BR', { weekday:'long' });
    const meta = [];
    if (isWeekend(dateObj)) meta.push('fim de semana');
    if (isHoliday(dateStr)) meta.push('feriado');
    const blk = blockingFor(resourceId, dateStr);
    if (blk) meta.push((String(blk.tipo||'').trim().toLowerCase() === 'férias') ? 'férias' : 'bloqueio');
    if (isThirdPartyOff(res, dateStr)) meta.push('fora de vigência');
    qs('#dayModalSub').textContent = `${weekday}${meta.length ? ' ? ' + meta.join(' ? ') : ''}`;

    const demands = demandsForResourceOnDate(resourceId, dateStr);
    const internalActivities = internalActivitiesForResourceOnDate(resourceId, dateObj, { onlyCapacity:true });
    const heInfo = overtimeInfo(resourceId, dateStr);
    const nonWorkingReason = nonWorkingReasonForDay(resourceId, dateObj);

    // Patch conservador HE/FDS no modal:
    // em dia não útil (FDS/feriado/bloqueio/férias/OFF), HE NÃO libera as demandas normais do intervalo.
    // O modal deve refletir a mesma regra do card: mostra apenas HE quando houver HE.
    const visibleDemands = nonWorkingReason ? [] : demands;
    const totalDemands = visibleDemands.length;

    // sempre começa na primeira página ao abrir o modal
    uiPagination.dayModalPage = 1;

    const freeInfoDay = CapacityEngine.freeHoursInfo(resourceId, dateObj);
    const capFinal = Number(freeInfoDay.capacity || 0);
    const allocFromDemandsHH = Number(freeInfoDay.allocatedFromDemandsHH || 0);
    const allocFromInternalHH = Number(freeInfoDay.allocatedFromInternalHH || 0);
    const allocTotalHH = Number(freeInfoDay.allocated || 0);
    const allocTotalPct = capFinal > 0 ? (allocTotalHH / capFinal) * 100 : 0;

    const summaryBadges = [];
    if (heInfo.total > 0) {
      summaryBadges.push(el('span', { class:'heBadge' }, [el('span', { class:'sDot' }, []), `HE no dia: +${fmtHours(heInfo.total)}h`]));
    }
    if (!nonWorkingReason) {
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-ok' }), `${totalDemands} demandas`]));
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-mid' }), `${Math.max(0, Math.round(allocTotalPct))}% planejado em demandas`]));
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-holiday' }), `${allocTotalHH.toFixed(1)}h de ${capFinal.toFixed(1)}h`]));
      if (allocFromInternalHH > 0) {
        summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-vac' }), `Internas informativas: ${allocFromInternalHH.toFixed(1)}h`]));
        summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-vac' }), `${internalActivities.length} registro(s) interno(s)`]));
      }
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:'dot bg-ok' }), `Demandas: ${allocFromDemandsHH.toFixed(1)}h`]));
    } else if (heInfo.total <= 0) {
      const reasonDotClass = nonWorkingReason?.label === 'FER' ? 'bg-holiday' :
        nonWorkingReason?.label === 'FÉR' ? 'bg-vac' :
        nonWorkingReason?.label === 'BLOQ' ? 'bg-block' :
        nonWorkingReason?.label === 'OFF' ? 'bg-off' : 'bg-wknd';
      summaryBadges.push(el('span', { class:'pill' }, [el('span', { class:`dot ${reasonDotClass}` }), `${nonWorkingReason.label || 'Dia não útil'}`]));
    }

    const summary = el('div', { class:'grid' }, [
      el('div', { class:'row' }, summaryBadges),
      el('div', { class:'tiny muted' }, [
        nonWorkingReason
          ? 'Dia não útil: demandas normais do intervalo não são contabilizadas nem listadas neste card. Quando existir HE, apenas a HE aparece.'
          : 'Obs: para a capacidade do dashboard, só contam status: ',
        !nonWorkingReason ? el('b', {}, ['Em andamento']) : null,
        !nonWorkingReason ? ' e ' : null,
        !nonWorkingReason ? el('b', {}, ['Atrasada']) : null,
        !nonWorkingReason ? '. Concluída aparece como registro histórico até a data de conclusão, sem consumir capacidade no dia da conclusão.' : null
      ].filter(Boolean))
    ]);

    const body = qs('#dayModalBody');

    const renderDayModal = () => {
      body.innerHTML = '';

      // Ação rápida: cadastrar demanda já com recurso e data preenchidos
      body.appendChild(el('div', { class:'row', style:'justify-content:flex-end;margin-bottom:10px' }, [
        button('Cadastrar demanda', 'primary', () => {
          const dateStr2 = dateStr;
          uiFilters.prefillDemand = { responsavel_id: resourceId, data_inicio: dateStr2, data_fim: dateStr2 };
          // opcional: já aplicar filtro por recurso na lista
          uiFilters.demandResourceId = resourceId;
          // levar o usuário direto para o cadastro
          activeTab = 'demands';
          uiFilters.focusDemandsForm = true;
          try { dlg.close(); } catch {}
          render();
        })
      ]));
      body.appendChild(summary);

      body.appendChild(el('div', { class:'hr' }));

      const total = visibleDemands.length;
      const totalPages = Math.max(1, Math.ceil(total / MODAL_DEMANDS_PAGE_SIZE));
      uiPagination.dayModalPage = Math.min(Math.max(1, uiPagination.dayModalPage), totalPages);
      const startIdx = (uiPagination.dayModalPage - 1) * MODAL_DEMANDS_PAGE_SIZE;
      const pageItems = visibleDemands.slice(startIdx, startIdx + MODAL_DEMANDS_PAGE_SIZE);

      const t = el('table');
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Título']),
        el('th', {}, ['Status']),
        el('th', {}, ['Horas/dia']),
        el('th', {}, ['Prédio']),
        el('th', {}, ['Focal']),
        el('th', {}, ['Responsável']),
        el('th', {}, ['Períodos']),
      ])]));
      const tb = el('tbody');
      if (pageItems.length === 0 && heInfo.items.length === 0) {
        tb.appendChild(el('tr', {}, [el('td', { colspan:'7', style:'padding:16px;text-align:center;color:var(--muted)' }, [nonWorkingReason ? 'Nenhuma alocação contabilizada neste dia.' : 'Sem demandas nesse dia.'])]));
      } else {
        for (const d of pageItems) {
          const st = effectiveStatus(d);
          const counts = demandCountsInAllocationOnDate(d, dateStr);
          const allocHoursForResource = demandAllocations(d)
            .filter(a => String(a.resourceId || '') === String(resourceId || ''))
            .filter(a => demandAllocationActiveOnDate(a, d, dateStr))
            .reduce((acc, a) => acc + demandAllocationHoursForDate(a, resourceId, dateObj, state.resources || []), 0);
          const tr = el('tr');
          if (st === 'Atrasada') tr.classList.add('overdueRow');
          tr.appendChild(el('td', {}, [
            el('div', { style:'font-weight:950' }, [d.titulo]),
            el('div', { class:'tiny' }, [counts ? 'Conta na alocação' : 'Não conta na alocação'])
          ]));
          tr.appendChild(el('td', {}, [statusPill(d)]));
          tr.appendChild(el('td', { class:'mono' }, [decimalHoursToHHMM(Math.max(0, allocHoursForResource))]));
          tr.appendChild(el('td', {}, [d.predio||'-']));
          tr.appendChild(el('td', {}, [d.focal||'-']));
          const actingPeriod = demandAllocationPeriodsTextForResource(d, resourceId, dateStr);
          tr.appendChild(el('td', {}, [resourceById()[resourceId]?.nome || resourceById()[d.responsavel_id]?.nome || '-']));
          tr.appendChild(el('td', { class:'mono tiny' }, [
            el('div', {}, [`Demanda: ${formatDateBR(d.data_inicio)} - ${formatDateBR(d.data_fim)}`]),
            el('div', { class:'muted' }, [`Atuação: ${actingPeriod}`])
          ]));
          tb.appendChild(tr);
        }

        for (const ia of internalActivities) {
          const canSeeIaDetails = canViewInternalActivityDetails(ia);
          const iaTitle = canSeeIaDetails
            ? String(ia.titulo || ia.tipo || 'Atividade interna').trim()
            : 'Atividade interna privada';
          const iaHours = Math.max(0, Number(ia.horas_dia || ia.horas || 0));
          const trIa = el('tr');
          trIa.appendChild(el('td', {}, [
            el('div', { style:'font-weight:950;color:#446A0C' }, [`Interna - ${iaTitle}`]),
            el('div', { class:'tiny' }, [canSeeIaDetails
              ? (ia.observacoes ? `Obs: ${ia.observacoes}` : 'Registro interno informativo; não consome a janela planejada')
              : 'Detalhes visíveis apenas para quem lançou; horas não consomem a janela planejada.'
            ])
          ]));
          trIa.appendChild(el('td', {}, [el('span', { class:'statusPill s-andamento' }, [el('span', { class:'sDot' }), 'Atividade interna'])]));
          trIa.appendChild(el('td', { class:'mono' }, [decimalHoursToHHMM(iaHours)]));
          trIa.appendChild(el('td', {}, ['-']));
          trIa.appendChild(el('td', {}, ['-']));
          trIa.appendChild(el('td', {}, [res?.nome || '-']));
          trIa.appendChild(el('td', { class:'mono tiny' }, [`${formatDateBR(ia.data_inicio || dateStr)} - ${formatDateBR(ia.data_fim || ia.data_inicio || dateStr)}`]));
          tb.appendChild(trIa);
        }

        for (const x of heInfo.items) {
          const tituloHe = String(x.titulo || x.atividade || x.motivo || 'Hora extra').trim();
          const trHe = el('tr', { class:'heRow' });
          trHe.appendChild(el('td', {}, [
            el('div', { style:'font-weight:950;color:#1e3a8a' }, [`HE - ${tituloHe}`]),
            el('div', { class:'tiny' }, [x.motivo ? `Motivo: ${x.motivo}` : 'Capacidade extra cadastrada'])
          ]));
          trHe.appendChild(el('td', {}, [el('span', { class:'heBadge' }, [el('span', { class:'sDot' }, []), 'Hora Extra'])]));
          trHe.appendChild(el('td', { class:'mono' }, [`+${fmtHours(x.horas)}h`]));
          trHe.appendChild(el('td', {}, [x.predio || '-']));
          trHe.appendChild(el('td', {}, [x.focal || '-']));
          trHe.appendChild(el('td', {}, [resourceById()[x.resourceId || resourceId]?.nome || (x.resourceId === '__ALL__' ? 'Todos' : '-')]));
          trHe.appendChild(el('td', { class:'mono tiny' }, [formatDateBR(x.date || dateStr)]));
          tb.appendChild(trHe);
        }
      }
      t.appendChild(tb);
      body.appendChild(t);

      if (total > MODAL_DEMANDS_PAGE_SIZE) {
        body.appendChild(buildPager({
          page: uiPagination.dayModalPage,
          totalPages,
          total,
          startIdx,
          shown: pageItems.length,
          onPrev: () => { uiPagination.dayModalPage--; renderDayModal(); },
          onNext: () => { uiPagination.dayModalPage++; renderDayModal(); },
          onFirst: () => { uiPagination.dayModalPage = 1; renderDayModal(); },
          onLast: () => { uiPagination.dayModalPage = totalPages; renderDayModal(); },
        }));
      }
    };

    renderDayModal();
    openDialog(dlg);
  };

  // ----------------------
  // Editar Demanda (modal com justificativa opcional)
  // ----------------------
  const requestDemandStatusJustificationWithText = (demand, nextStatus, justification, { silent=false, actionDate='', relatedDemands=[] } = {}) => {
    if (!demand) return false;
    const normalizedNextStatus = normalizeStatus(nextStatus);
    const targets = [demand, ...(Array.isArray(relatedDemands) ? relatedDemands : [])]
      .filter(Boolean)
      .filter((item, idx, arr) => String(item.id || '') && arr.findIndex(x => String(x.id || '') === String(item.id || '')) === idx)
      .map(item => (state.demands || []).find(d => String(d.id) === String(item.id)) || item);
    const pendingTargets = targets.filter(item => effectiveStatus(item) !== normalizedNextStatus || normalizeStatus(item.status) !== normalizedNextStatus);
    if (!pendingTargets.length) {
      if (!silent) toast(`Demanda já está ${normalizedNextStatus.toLowerCase()}.`);
      return false;
    }
    const justValidation = validateTextLimit(justification, 'Justificativa', INPUT_LIMITS.justification, { required:true });
    if (justValidation) { if (!silent) toast(justValidation); return false; }

    const statusChangedAt = Date.now();
    const statusActionDate = actionDate || todayISO();
    const finalStatusAudit = normalizedNextStatus === 'Concluída'
      ? { completion_date: statusActionDate, data_conclusao: statusActionDate, completed_at: statusActionDate }
      : (normalizedNextStatus === 'Cancelada' ? { cancellation_date: statusActionDate, canceled_at: statusActionDate } : {});

    for (const latestDemand of pendingTargets) {
      const currentStatus = effectiveStatus(latestDemand);
      const next = {
        ...latestDemand,
        ...finalStatusAudit,
        status: normalizedNextStatus,
        status_reason: justification,
        status_reason_type: normalizedNextStatus,
        status_changed_at: statusChangedAt,
        status_action_date: statusActionDate,
        status_changed_by: userName || 'Sessão local',
        status_changed_by_id: userId || '',
        last_edit_by: userName,
        last_edit_at: statusChangedAt,
        last_edit_justification: justification,
      };
      state.events = [...state.events, {
        id: generateId('event'),
        type:'CHANGE_DEMAND_STATUS',
        payload:{ demand_id: latestDemand.id, before:{ status: currentStatus }, after:{ status: normalizedNextStatus, action_date: statusActionDate }, justification },
        timestamp: statusChangedAt,
        user: userName,
        user_id: userId || ''
      }];
      dispatch('UPDATE_DEMAND', next);
    }
    if (!silent) {
      render();
      toast(pendingTargets.length > 1 ? `${pendingTargets.length} demandas atualizadas para ${normalizedNextStatus.toLowerCase()}.` : `Demanda ${normalizedNextStatus.toLowerCase()}.`);
    }
    return true;
  };

  const requestDemandStatusJustification = (demand, nextStatus, actionLabel) => {
    if (!demand) return;
    const normalizedNextStatus = normalizeStatus(nextStatus);
    if (effectiveStatus(demand) === normalizedNextStatus) {
      toast(`Demanda já está ${normalizedNextStatus.toLowerCase()}.`);
      return;
    }
    const justification = String(prompt(`Informe a justificativa para ${actionLabel.toLowerCase()} a demanda "${demand.titulo || demand.id || ''}":`) || '').trim();
    requestDemandStatusJustificationWithText(demand, normalizedNextStatus, justification);
  };

  const openDemandStatusActionModal = (demand, nextStatus, relatedDemands=[]) => {
    const dlg = qs('#demandStatusModal');
    if (!dlg || !demand) return;
    const normalizedNextStatus = normalizeStatus(nextStatus);
    const actionName = normalizedNextStatus === 'Cancelada' ? 'cancelamento' : 'conclusão';
    qs('#demandStatusModalTitle').textContent = normalizedNextStatus === 'Cancelada' ? 'Cancelar demanda' : 'Concluir demanda';
    qs('#demandStatusModalSub').textContent = `Justificativa obrigatória para ${actionName} da demanda.`;
    const body = qs('#demandStatusModalBody');
    body.innerHTML = '';

    const actionDate = el('input', { type:'date', value: todayISO(), min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const justification = el('textarea', { placeholder:`Descreva a justificativa obrigatória para ${actionName}...`, maxlength:String(INPUT_LIMITS.justification), style:'min-height:120px' });
    const save = () => {
      const dateVal = String(actionDate.value || '').trim();
      const dateValidation = validateDateYearLimit(dateVal, 'Data da ação');
      if (dateValidation) return toast(dateValidation);
      if (!isISODateString(dateVal)) return toast('Data da ação: informe uma data válida.');
      const text = String(justification.value || '').trim();
      const justValidation = validateTextLimit(text, 'Justificativa', INPUT_LIMITS.justification, { required:true });
      if (justValidation) return toast(justValidation);
      const changed = requestDemandStatusJustificationWithText(demand, normalizedNextStatus, text, { actionDate: dateVal, relatedDemands });
      if (changed) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
    };

    body.appendChild(el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'hint' }, [
        el('b', {}, [demand.titulo || 'Demanda']),
        el('div', { class:'tiny muted', style:'margin-top:4px' }, [`Situação atual: ${effectiveStatus(demand)} → ${normalizedNextStatus}`])
      ]),
      el('div', { class:'row' }, [
        el('div', { class:'field' }, [el('label', {}, ['Data da ação']), actionDate]),
        el('div', { class:'field' }, [el('label', {}, ['Nova situação']), el('input', { value: normalizedNextStatus, disabled:'', readonly:'' })]),
      ]),
      el('div', { class:'field' }, [el('label', {}, [`Justificativa obrigatória para ${actionName}`]), justification]),
      el('div', { class:'row end' }, [
        button('Fechar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }),
        button(normalizedNextStatus === 'Cancelada' ? 'Confirmar cancelamento' : 'Confirmar conclusão', 'primary', save),
      ])
    ]));
    openDialog(dlg);
  };

  const auditDateTimeBR = (timestamp) => {
    const n = Number(timestamp || 0);
    if (!n) return '-';
    try { return new Date(n).toLocaleString('pt-BR'); } catch { return '-'; }
  };

  const allocationAuditSnapshot = (demand={}) => {
    const rows = [];
    for (const a of demandAllocations(demand)) {
      const rid = String(a.resourceId || '').trim();
      const start = normalizeDateLikeToISO(a.data_inicio || a.dataInicio || a.start_date || '') || normalizeDateLikeToISO(demand.data_inicio || '') || '';
      const end = normalizeDateLikeToISO(a.data_fim || a.dataFim || a.end_date || '') || normalizeDateLikeToISO(demand.data_fim || '') || start;
      const name = resourceById()[rid]?.nome || rid || '-';
      let cursor = start;
      let current = null;
      let guard = 0;
      while (cursor && end && cursor <= end && guard < 8000) {
        const horas = demandAllocationHoursForDate(a, rid, isoToLocalMidnight(cursor), state.resources || []);
        if (!current || current.horas !== horas) {
          if (current) rows.push(current);
          current = { resourceId:rid, recurso:name, data_inicio:cursor, data_fim:cursor, horas };
        } else {
          current.data_fim = cursor;
        }
        cursor = addDaysISO(cursor, 1);
        guard++;
      }
      if (current) rows.push(current);
      if (!start) rows.push({ resourceId:rid, recurso:name, data_inicio:'', data_fim:'', horas:roundDemandHours(firstHoursLike(a.horas_planejadas_dia, a.horas_dia, a.horas, demand.horas_planejadas_dia, demand.horas_dia) ?? 0) });
    }
    return rows.sort((a,b) => `${a.resourceId}|${a.data_inicio}|${a.data_fim}`.localeCompare(`${b.resourceId}|${b.data_inicio}|${b.data_fim}`));
  };

  const allocationAuditLine = (a={}) => `${a.recurso || a.resourceId || '-'}: ${formatDateBR(a.data_inicio)} até ${formatDateBR(a.data_fim)} • ${decimalHoursToHHMM(a.horas || 0)}/dia`;

  const allocationAuditKey = (a={}) => [
    String(a.resourceId || '').trim(),
    normalizeDateLikeToISO(a.data_inicio || '') || '',
    normalizeDateLikeToISO(a.data_fim || '') || ''
  ].join('|');

  const buildAllocationAuditDetails = (beforeAlloc=[], afterAlloc=[]) => {
    const beforeMap = new Map((Array.isArray(beforeAlloc) ? beforeAlloc : []).map(a => [allocationAuditKey(a), a]));
    const afterMap = new Map((Array.isArray(afterAlloc) ? afterAlloc : []).map(a => [allocationAuditKey(a), a]));
    const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
    const details = [];
    for (const key of keys) {
      const before = beforeMap.get(key);
      const after = afterMap.get(key);
      const base = after || before || {};
      const name = base.recurso || resourceById()[base.resourceId]?.nome || base.resourceId || '-';
      const period = `${formatDateBR(base.data_inicio)} até ${formatDateBR(base.data_fim)}`;
      if (before && after) {
        const beforeHours = roundDemandHours(before.horas || 0);
        const afterHours = roundDemandHours(after.horas || 0);
        if (beforeHours !== afterHours) details.push(`${name} (${period}) - Horas/dia: ${decimalHoursToHHMM(beforeHours)} → ${decimalHoursToHHMM(afterHours)}`);
      } else if (before && !after) {
        details.push(`${name} (${period}) - Período/carga removido: ${decimalHoursToHHMM(before.horas || 0)}/dia`);
      } else if (!before && after) {
        details.push(`${name} (${period}) - Período/carga adicionado: ${decimalHoursToHHMM(after.horas || 0)}/dia`);
      }
    }
    return details;
  };

  const demandAuditValue = (field, value) => {
    if (field === 'data_inicio' || field === 'data_fim') return value ? formatDateBR(value) : '-';
    if (field === 'horas_planejadas_dia') return decimalHoursToHHMM(Number(value || 0));
    if (field === 'percentual_diario') return `${Number(value || 0)}%`;
    if (field === 'responsavel_id') return value ? (resourceById()[value]?.nome || value) : '-';
    return String(value ?? '').trim() || '-';
  };

  const buildDemandFieldAuditDetails = (before={}, after={}) => {
    const labels = {
      titulo:'Título',
      predio:'Prédio',
      focal:'Focal',
      responsavel_id:'Responsável principal',
      data_inicio:'Início da demanda',
      data_fim:'Fim da demanda',
      prioridade:'Prioridade',
      status:'Status',
      observacoes:'Descrição'
    };
    const details = [];
    for (const [field, label] of Object.entries(labels)) {
      const b = before?.[field] ?? '';
      const a = after?.[field] ?? '';
      if (String(b ?? '') !== String(a ?? '')) {
        details.push(`${label}: ${demandAuditValue(field, b)} → ${demandAuditValue(field, a)}`);
      }
    }
    return details;
  };

  const demandAuditEventId = (event={}) => {
    const p = event?.payload || {};
    return String(p.demand_id || p.demandId || p.id || p.demanda_id || p.reprogramming?.demanda_id || p.reprogramming?.demandId || '').trim();
  };

  const buildDemandAuditTrail = (demand={}) => {
    const did = String(demand.id || '').trim();
    const rows = [];
    const add = (row) => rows.push({ timestamp:Number(row.timestamp || 0), ...row });
    if (demand.createdAt || demand.created_at) add({ title:'Demanda criada', timestamp:demand.createdAt || demand.created_at, actor:demand.createdBy || demand.created_by || '', details:[`Status inicial: ${normalizeStatus(demand.status)}`] });
    for (const ev of (state.events || [])) {
      if (demandAuditEventId(ev) !== did) continue;
      const p = ev.payload || {};
      const type = String(ev.type || 'EVENTO');
      const beforeAlloc = p.before?.allocations || [];
      const afterAlloc = p.after?.allocations || [];
      const allocationChanged = JSON.stringify(beforeAlloc) !== JSON.stringify(afterAlloc);
      if (type === 'UPDATE_DEMAND' && !p.before && !p.after) continue;
      const details = buildDemandFieldAuditDetails(p.before || {}, p.after || {});
      if (allocationChanged) {
        details.push('Alocação/atuação alterada:');
        details.push(...buildAllocationAuditDetails(beforeAlloc, afterAlloc));
        details.push(`Resumo anterior: ${beforeAlloc.length ? beforeAlloc.map(allocationAuditLine).join(' | ') : '-'}`);
        details.push(`Resumo novo: ${afterAlloc.length ? afterAlloc.map(allocationAuditLine).join(' | ') : '-'}`);
      }
      if (!details.length) details.push('A demanda foi salva sem alteração material nos campos auditados.');
      add({ title: type === 'EDIT_DEMAND' ? 'Edição de demanda' : type, timestamp:ev.timestamp, actor:ev.user || '', reason:p.justification || ev.justification || '', details });
    }
    for (const t of transferHistoryEntries(demand)) {
      add({ title:'Transferência de atuação', timestamp:t.timestamp || 0, actor:t.user || '', reason:t.justification || '', details:[`${resourceById()[t.fromResourceId]?.nome || t.fromResourceId || '-'} → ${resourceById()[t.toResourceId]?.nome || t.toResourceId || '-'}`, `Data inicial: ${formatDateBR(t.transferDate)}`, `Data final: ${formatDateBR(t.transferEnd || t.data_fim || '') || '-'}`, `Horas/dia: ${decimalHoursToHHMM(t.horas_planejadas_dia || t.horas_dia || 0)}`] });
    }
    return rows.sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  };

  const renderDemandAuditTrail = (demand={}) => {
    const rows = buildDemandAuditTrail(demand);
    const box = el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'hint' }, [el('b', {}, ['Trilha de Auditoria']), el('div', { class:'tiny muted', style:'margin-top:4px' }, ['Mostra data/hora da ação, autor, justificativa e alterações de atuação registradas para esta demanda.'])])
    ]);
    if (!rows.length) {
      box.appendChild(el('div', { style:'padding:16px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:16px;background:var(--surface)' }, ['Nenhuma ação registrada para esta demanda.']));
      return box;
    }
    for (const row of rows) {
      box.appendChild(el('div', { class:'apontamentoEntryCard', style:'padding:12px' }, [
        el('div', { style:'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
          el('div', {}, [el('div', { style:'font-weight:950' }, [row.title || 'Ação']), el('div', { class:'tiny muted' }, [`Data/hora da ação: ${auditDateTimeBR(row.timestamp)}${row.actor ? ' • ' + row.actor : ''}`])]),
        ]),
        row.reason ? el('div', { class:'tiny', style:'margin-top:8px;white-space:pre-wrap' }, [`Justificativa: ${row.reason}`]) : el('div', { style:'display:none' }, []),
        row.details?.length ? el('ul', { class:'tiny muted', style:'margin:8px 0 0 18px;padding:0' }, row.details.filter(Boolean).map(d => el('li', {}, [d]))) : el('div', { style:'display:none' }, []),
      ]));
    }
    return box;
  };

  const openDemandEditModal = (demand, { viewOnly=false, targetStatus='' } = {}) => {
    const isFinalView = viewOnly || ['Concluída','Cancelada'].includes(effectiveStatus(demand));
    const dlg = qs('#demandEditModal');
    const resMap = resourceById();

    qs('#demandEditModalTitle').textContent = `${isFinalView ? 'Visualizar demanda' : 'Editar demanda'} - ${demand.titulo}`;
    qs('#demandEditModalSub').textContent = isFinalView
      ? 'Demanda bloqueada para edição. Apenas a situação pode ser alterada com justificativa.'
      : 'Justificativa opcional (fica registrada no histórico se preenchida).';

    const body = qs('#demandEditModalBody');
    body.innerHTML = '';

    const titulo = el('input', { value: demand.titulo || '', placeholder:'Ex: PQ Sistema X', maxlength:String(INPUT_LIMITS.demandTitle) });
    const predio = el('input', { value: demand.predio || '', placeholder:'Ex: Prédio A', maxlength:String(INPUT_LIMITS.building) });
    const { input: focal, control: focalControl } = createFocalPicker({ value: demand.focal || '' });

    const selectedRespIds = new Set();
    const respHoursById = new Map();
    const respStartById = new Map();
    const respEndById = new Map();
    const respDailyById = new Map();
    const demandStartForAlloc = normalizeDateLikeToISO(demand.data_inicio || '') || '';
    const demandEndForAlloc = normalizeDateLikeToISO(demand.data_fim || '') || '';
    for (const a of demandAllocations(demand)) {
      const rid = String(a.resourceId || '').trim();
      if (!rid) continue;
      selectedRespIds.add(rid);
      respHoursById.set(rid, demandAllocationDisplayHours(a, demand, state.resources || []));
      respStartById.set(rid, normalizeDateLikeToISO(a.data_inicio || a.dataInicio || a.start_date || '') || demandStartForAlloc);
      respEndById.set(rid, normalizeDateLikeToISO(a.data_fim || a.dataFim || a.end_date || '') || demandEndForAlloc);
      respDailyById.set(rid, normalizeAllocationDailyHours(a.daily_hours || a.dailyHours || a.horas_por_dia || {}));
    }
    if (!selectedRespIds.size && demand.responsavel_id) {
      selectedRespIds.add(demand.responsavel_id);
      respHoursById.set(demand.responsavel_id, firstHoursLike(demand.horas_planejadas_dia, demand.horas_dia) ?? percentToDemandHours(demand.percentual_diario ?? 100, demand.responsavel_id, state.resources || []));
      respStartById.set(demand.responsavel_id, demandStartForAlloc);
      respEndById.set(demand.responsavel_id, demandEndForAlloc);
      respDailyById.set(demand.responsavel_id, {});
    }
    const originalRespHoursById = new Map(respHoursById);
    const originalRespStartById = new Map(respStartById);
    const originalRespEndById = new Map(respEndById);
    const respSearch = el('input', { class:'multiSelectInput', placeholder:'Digite o nome do responsável...' });
    const respChips = el('div', { style:'display:contents' });
    const respMenu = el('div', { class:'multiSelectMenu' });
    const respBox = el('div', { class:'multiSelectBox' }, [respChips, respSearch]);
    const responsavel = el('div', { class:'multiSelect', title:'Digite para buscar e clique para adicionar responsáveis' }, [
      respBox,
      respMenu
    ]);
    const selectedResponsaveis = () => [...selectedRespIds].filter(Boolean);
    const getRespName = (id) => (state.resources||[]).find(r => r.id === id)?.nome || id;
    let refreshAllocationPreview = () => {};
    const closeRespMenu = () => responsavel.classList.remove('open');
    const renderRespOptions = () => {
      const q = (respSearch.value||'').trim().toLowerCase();
      const available = (state.resources||[])
        .filter(r => !selectedRespIds.has(r.id))
        .filter(r => !q || String(r.nome||'').toLowerCase().includes(q) || String(r.tipo||'').toLowerCase().includes(q));
      respMenu.innerHTML = '';
      if (!available.length) {
        respMenu.appendChild(el('div', { class:'multiSelectEmpty' }, [q ? 'Nenhum responsável encontrado.' : 'Todos os responsáveis já foram selecionados.']));
        return;
      }
      for (const r of available) {
        respMenu.appendChild(el('button', { type:'button', class:'multiSelectOption', 'data-rid': r.id }, [`${r.nome}${r.tipo==='Terceiro' ? ' (Terceiro)' : ''}`]));
      }
    };
    const respAllocList = el('div', { class:'respAllocList' });
    const respAllocPick = el('select', { title:'Selecione o responsável para ver a alocação configurada' });
    const respAllocStartEditor = el('input', { type:'date', style:'display:none' });
    const respAllocEndEditor = el('input', { type:'date', style:'display:none' });
    const respAllocHoursEditor = el('input', { type:'text', style:'display:none' });
    const respAllocSummary = el('div', { class:'respAllocList' });
    const syncRespAllocEditor = () => {
      const rid = String(respAllocPick.value || '');
      respAllocHoursEditor.value = rid ? decimalHoursToHHMM(respHoursById.get(rid) ?? resourceHoursById(rid, state.resources || [])) : '';
      respAllocStartEditor.value = rid ? (respStartById.get(rid) || ini.value || demandStartForAlloc) : '';
      respAllocEndEditor.value = rid ? (respEndById.get(rid) || fim.value || demandEndForAlloc) : '';
    };
    const compactDailySegmentsForSummary = (rid, start='', end='') => {
      const daily = normalizeAllocationDailyHours(respDailyById.get(rid) || {});
      const entries = Object.entries(daily).filter(([date]) => (!start || date >= start) && (!end || date <= end)).sort(([a],[b]) => a.localeCompare(b));
      if (!entries.length) return [{ start, end, hours:roundDemandHours(respHoursById.get(rid) ?? resourceHoursById(rid, state.resources || [])), custom:false }];
      const segments = [];
      for (const [date, hoursRaw] of entries) {
        const hours = roundDemandHours(hoursRaw);
        const last = segments.at(-1);
        if (last && last.hours === hours && addDaysISO(last.end, 1) === date) {
          last.end = date;
        } else {
          segments.push({ start:date, end:date, hours, custom:true });
        }
      }
      return segments;
    };
    const renderRespAllocSummary = () => {
      respAllocSummary.innerHTML = '';
      const ids = selectedResponsaveis();
      respAllocSummary.classList.add('allocSummaryGrid');
      if (!ids.length) {
        respAllocSummary.appendChild(el('div', { class:'respAllocEmpty' }, ['Adicione um responsável para configurar atuação e horas alocadas.']));
        return;
      }
      const current = ids.includes(respAllocPick.value) ? respAllocPick.value : ids[0];
      respAllocPick.value = current;
      const rid = current;
      const start = normalizeDateLikeToISO(respStartById.get(rid) || '') || ini.value || demandStartForAlloc;
      const end = normalizeDateLikeToISO(respEndById.get(rid) || '') || fim.value || demandEndForAlloc;
      const segments = compactDailySegmentsForSummary(rid, start, end);
      const visibleSegments = segments.slice(0, 8);
      const extraCount = Math.max(0, segments.length - visibleSegments.length);
      respAllocSummary.appendChild(el('div', { class:'allocResourcePicker' }, [
        el('div', { class:'field' }, [el('label', {}, ['Responsável']), respAllocPick]),
        el('div', { class:'tiny muted' }, ['Selecione um responsável para revisar as horas cadastradas sem ocupar espaço com todos na tela.'])
      ]));
      respAllocSummary.appendChild(el('details', { class:'allocSummaryDetails', open:'' }, [
        el('summary', { title:'Clique para recolher/abrir as horas cadastradas' }, [
          el('div', { class:'allocSummaryNameWrap' }, [
            el('span', { class:'allocSummaryChevron' }, ['▶']),
            el('span', { class:'allocSummaryName' }, [getRespName(rid)]),
            el('span', { class:'allocSummaryRange' }, [`${formatDateBR(start)} até ${formatDateBR(end)}`])
          ]),
          el('span', { class:'allocSummaryBadge' }, [segments.length > 1 ? `${segments.length} trechos` : 'padrão'])
        ]),
        el('div', { class:'allocSegmentList' }, [
          ...visibleSegments.map(seg => el('span', { class:'allocSegmentChip', title:`${formatDateBR(seg.start)} até ${formatDateBR(seg.end)}` }, [`${formatDateBR(seg.start)}-${formatDateBR(seg.end)} • ${decimalHoursToHHMM(seg.hours)}`])),
          extraCount ? el('span', { class:'allocSegmentChip' }, [`+${extraCount} trecho(s)`]) : el('span', { style:'display:none' }, [])
        ])
      ]));
    };
    respAllocPick.addEventListener('change', renderRespAllocSummary);
    const ensureDailyHoursCoversAllocation = (rid, start='', end='') => {
      const resourceId = String(rid || '').trim();
      if (!resourceId || !start || !end) return;
      let daily = normalizeAllocationDailyHours(respDailyById.get(resourceId) || {});
      const fallbackHours = roundDemandHours(respHoursById.get(resourceId) ?? resourceHoursById(resourceId, state.resources || []));
      let cursor = start;
      let guard = 0;
      while (cursor && cursor <= end && guard < 8000) {
        if (!Object.prototype.hasOwnProperty.call(daily, cursor)) daily[cursor] = fallbackHours;
        cursor = addDaysISO(cursor, 1);
        guard++;
      }
      respDailyById.set(resourceId, daily);
    };
    const openDailyAllocationModal = () => {
      if (!selectedRespIds.size) { toast('Adicione um responsável antes de alterar a alocação diária.'); return; }
      if (!window.confirm('Deseja alterar a alocação diária?')) return;
      const modal = document.createElement('dialog');
      modal.className = 'modal';
      const pick = el('select');
      for (const rid of selectedResponsaveis()) pick.appendChild(el('option', { value:rid }, [getRespName(rid)]));
      if (selectedResponsaveis().includes(respAllocPick.value)) pick.value = respAllocPick.value;
      const startInput = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
      const endInput = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
      const hoursInput = el('input', { type:'text', inputmode:'decimal', placeholder:'Ex: 03:30 ou 3' });
      const fill = () => {
        const rid = String(pick.value || '');
        startInput.value = normalizeDateLikeToISO(respStartById.get(rid) || '') || ini.value || demandStartForAlloc;
        endInput.value = normalizeDateLikeToISO(respEndById.get(rid) || '') || fim.value || demandEndForAlloc;
        hoursInput.value = decimalHoursToHHMM(respHoursById.get(rid) ?? resourceHoursById(rid, state.resources || []));
      };
      pick.addEventListener('change', fill);
      fill();
      const saveDaily = () => {
        const rid = String(pick.value || '');
        const changeFrom = normalizeDateLikeToISO(startInput.value || '') || '';
        const changeTo = normalizeDateLikeToISO(endInput.value || '') || '';
        const nextHours = parseHoursInput(hoursInput.value);
        if (!rid) { toast('Selecione um responsável.'); return; }
        if (!changeFrom || !changeTo || changeTo < changeFrom) { toast('Informe um período válido para a alteração diária.'); return; }
        if (!Number.isFinite(nextHours) || nextHours < 0) { toast('Informe horas válidas para a alteração diária.'); return; }
        if (nextHours > resourceHoursById(rid, state.resources || [])) { toast(`Horas não podem passar de ${decimalHoursToHHMM(resourceHoursById(rid, state.resources || []))} por dia.`); return; }
        const demandStartLimit = normalizeDateLikeToISO(ini.value || demandStartForAlloc || '') || '';
        const demandEndLimit = normalizeDateLikeToISO(fim.value || demandEndForAlloc || '') || '';
        if (demandStartLimit && changeFrom < demandStartLimit) { toast('O início da atuação precisa estar dentro do período da demanda.'); return; }
        if (demandEndLimit && changeTo > demandEndLimit) { toast('O fim da atuação precisa estar dentro do período da demanda.'); return; }
        respStartById.set(rid, changeFrom);
        respEndById.set(rid, changeTo);
        let daily = {};
        daily = fillDailyHoursRange(daily, changeFrom, changeTo, nextHours);
        respDailyById.set(rid, daily);
        respHoursById.set(rid, roundDemandHours(nextHours));
        renderRespAllocSummary();
        renderApontamentos();
        refreshAllocationPreview();
        closeDialog(modal);
        modal.remove();
        toast('Alteração diária cadastrada. Salve a demanda para persistir.');
      };
      modal.appendChild(el('div', { class:'modalCard', style:'max-width:720px' }, [
        el('div', { class:'modalHd' }, [el('div', {}, [el('h2', {}, ['Alterar alocação diária']), el('div', { class:'sub' }, ['Recadastre o período e as horas. O heatmap passa a usar essa agenda diária.'])]), button('Fechar', '', () => { closeDialog(modal); modal.remove(); })]),
        el('div', { class:'modalBd' }, [el('div', { class:'grid' }, [
          el('div', { class:'allocDailyModalGrid' }, [el('div', { class:'field' }, [el('label', {}, ['Responsável']), pick]), el('div', { class:'field' }, [el('label', {}, ['De']), startInput]), el('div', { class:'field' }, [el('label', {}, ['Até']), endInput]), el('div', { class:'field' }, [el('label', {}, ['Horas/dia']), hoursInput])]),
          el('div', { class:'hint' }, ['Exemplo: 01 a 07 = 03:00, depois 08 a 10 = 02:00, depois 11 a 15 = 06:00. Cada salvamento adiciona/atualiza esse trecho na alocação do responsável.']),
          el('div', { class:'row', style:'justify-content:flex-end' }, [button('Salvar alteração diária', 'primary', saveDaily)])
        ])])
      ]));
      document.body.appendChild(modal);
      openDialog(modal);
    };
    const respAllocEditor = el('div', { class:'respAllocEditor allocSummaryMode is-empty' }, [respAllocSummary]);
    const allocationChangeBtn = el('button', { type:'button', class:'btn small ghost allocIconBtn', title:'Alterar alocação diária', 'aria-label':'Alterar alocação diária' }, ['✎']);
    allocationChangeBtn.addEventListener('click', openDailyAllocationModal);
    const renderRespChips = () => {
      respChips.innerHTML = '';
      respAllocList.innerHTML = '';
      const ids = [...selectedRespIds];
      respAllocEditor.classList.toggle('is-empty', !ids.length);
      respAllocList.style.display = ids.length ? 'none' : 'block';
      if (!ids.length) {
        respAllocList.appendChild(el('div', { class:'respAllocEmpty' }, ['Adicione um responsável para configurar atuação e horas alocadas.']));
      }
      respAllocPick.innerHTML = '';
      for (const rid of ids) respAllocPick.appendChild(el('option', { value: rid }, [getRespName(rid)]));
      if (ids.length) {
        const current = ids.includes(respAllocPick.value) ? respAllocPick.value : ids[0];
        respAllocPick.value = current;
        respAllocHoursEditor.value = decimalHoursToHHMM(respHoursById.get(current) ?? resourceHoursById(current, state.resources || []));
        respAllocStartEditor.value = respStartById.get(current) || ini.value || demandStartForAlloc;
        respAllocEndEditor.value = respEndById.get(current) || fim.value || demandEndForAlloc;
      } else {
        respAllocHoursEditor.value = '';
        respAllocStartEditor.value = '';
        respAllocEndEditor.value = '';
      }
      syncRespAllocEditor();
      renderRespAllocSummary();
      refreshAllocationPreview();
      for (const rid of selectedRespIds) {
        const chip = el('span', { class:'multiSelectChip', 'data-rid': rid }, [
          el('span', {}, [getRespName(rid)]),
          el('button', { type:'button', title:'Remover responsável', 'data-remove-rid': rid }, ['×'])
        ]);
        chip.querySelector('button').addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          selectedRespIds.delete(rid);
          respHoursById.delete(rid);
          respStartById.delete(rid);
          respEndById.delete(rid);
          respDailyById.delete(rid);
          if (!selectedRespIds.size) status.value = 'Mapeada';
          syncMapeada();
          renderRespAllocSummary();
          refreshAllocationPreview();
        });
        respChips.appendChild(chip);
      }
    };
    const openRespMenu = () => { responsavel.classList.add('open'); renderRespOptions(); };
    const addResponsavelChip = (rid) => {
      if (!rid || selectedRespIds.has(rid)) return;
      selectedRespIds.add(rid);
      if (!respHoursById.has(rid)) respHoursById.set(rid, resourceHoursById(rid, state.resources || []));
      if (!respStartById.has(rid)) respStartById.set(rid, ini.value || demandStartForAlloc);
      if (!respEndById.has(rid)) respEndById.set(rid, fim.value || demandEndForAlloc);
      if (!respDailyById.has(rid)) respDailyById.set(rid, {});
      respSearch.value = '';
      if (normalizeStatus(status.value) === 'Mapeada') status.value = 'Em andamento';
      syncMapeada();
      renderRespAllocSummary();
      refreshAllocationPreview();
      openRespMenu();
    };
    respMenu.addEventListener('mousedown', (ev) => {
      const opt = ev.target.closest('.multiSelectOption');
      if (!opt) return;
      ev.preventDefault();
      ev.stopPropagation();
      addResponsavelChip(opt.getAttribute('data-rid'));
    });
    respSearch.addEventListener('input', openRespMenu);
    respSearch.addEventListener('focus', openRespMenu);
    respSearch.addEventListener('keydown', (ev) => {
      if (ev.key === 'Backspace' && !respSearch.value && selectedRespIds.size) {
        selectedRespIds.delete([...selectedRespIds].at(-1));
        if (!selectedRespIds.size) status.value = 'Mapeada';
        syncMapeada();
      }
      if (ev.key === 'Escape') closeRespMenu();
    });
    responsavel.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.multiSelectOption') || ev.target.closest('[data-remove-rid]')) return;
      setTimeout(() => { try { respSearch.focus(); openRespMenu(); } catch {} }, 0);
    });
    document.addEventListener('mousedown', (ev) => { if (!responsavel.contains(ev.target)) closeRespMenu(); });

    const ini = el('input', { type:'date', value: demand.data_inicio || '', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const fim = el('input', { type:'date', value: demand.data_fim || '', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const prioridade = el('select', {}, [
      el('option', { value:'Baixa' }, ['Baixa']),
      el('option', { value:'Média' }, ['Média']),
      el('option', { value:'Alta' }, ['Alta']),
      el('option', { value:'Crítica' }, ['Crítica']),
    ]);
    prioridade.value = demand.prioridade || 'Média';

    const status = el('select', { 'data-final-view-editable':'true' }, [
        el('option', { value:'Em andamento' }, ['Em andamento']),
        el('option', { value:'Atrasada', disabled:'' }, ['Atrasada (automático)']),
        el('option', { value:'Concluída' }, ['Concluída']),
      el('option', { value:'Cancelada' }, ['Cancelada']),
      el('option', { value:'Mapeada' }, ['Mapeada (sem responsável)']),
      el('option', { value:'Congelada' }, ['Congelada']),
    ]);
    status.value = targetStatus ? normalizeStatus(targetStatus) : normalizeStatus(demand.status);

    const obs = el('textarea', { placeholder:'Observações...', maxlength:String(INPUT_LIMITS.demandNotes) }, [demand.observacoes || '']);

    const just = el('textarea', { placeholder: isFinalView ? 'Justificativa obrigatória para alterar a situação...' : 'Justificativa (opcional)...', maxlength:String(INPUT_LIMITS.justification), style:'min-height:92px', 'data-final-view-editable':'true' });
    const justHint = el('div', { class:'tiny muted' }, [
      'Se você preencher, a justificativa será registrada no histórico (events) do app para rastreabilidade.'
    ]);
    const allocationDiffPreview = el('div', { class:'hint', style:'display:none' });
    const selectedAllocationPreviewState = () => {
      const rid = String(respAllocPick.value || '').trim();
      if (!rid || !selectedRespIds.has(rid) || normalizeStatus(status.value) === 'Mapeada') return null;
      return {
        rid,
        name:getRespName(rid),
        before:{
          inicio: normalizeDateLikeToISO(originalRespStartById.get(rid) || '') || demandStartForAlloc,
          fim: normalizeDateLikeToISO(originalRespEndById.get(rid) || '') || demandEndForAlloc,
          horas: roundDemandHours(originalRespHoursById.get(rid) ?? resourceHoursById(rid, state.resources || [])),
        },
        after:{
          inicio: normalizeDateLikeToISO(respAllocStartEditor.value || respStartById.get(rid) || '') || ini.value || demandStartForAlloc,
          fim: normalizeDateLikeToISO(respAllocEndEditor.value || respEndById.get(rid) || '') || fim.value || demandEndForAlloc,
          horas: roundDemandHours(parseHoursInput(respAllocHoursEditor.value) ?? respHoursById.get(rid) ?? resourceHoursById(rid, state.resources || [])),
        }
      };
    };
    refreshAllocationPreview = () => {
      const statePreview = selectedAllocationPreviewState();
      const lines = [];
      if (statePreview) {
        if (statePreview.before.inicio !== statePreview.after.inicio) lines.push(`Início da atuação: ${formatDateBR(statePreview.before.inicio)} → ${formatDateBR(statePreview.after.inicio)}`);
        if (statePreview.before.fim !== statePreview.after.fim) lines.push(`Data de atuação final: ${formatDateBR(statePreview.before.fim)} → ${formatDateBR(statePreview.after.fim)}`);
        if (statePreview.before.horas !== statePreview.after.horas) lines.push(`Horas/dia: ${decimalHoursToHHMM(statePreview.before.horas)} → ${decimalHoursToHHMM(statePreview.after.horas)}`);
      }
      const changed = lines.length > 0;
      allocationDiffPreview.innerHTML = '';
      allocationDiffPreview.style.display = changed ? '' : 'none';
      if (!changed) return;
      allocationDiffPreview.appendChild(el('b', {}, [`Alterações detectadas na alocação de ${statePreview.name}`]));
      allocationDiffPreview.appendChild(el('ul', { class:'tiny', style:'margin:8px 0 0 18px;padding:0' }, [
        ...lines.map(line => el('li', {}, [line])),
        el('li', {}, [`Planejado: ${formatDateBR(statePreview.before.inicio)} até ${formatDateBR(statePreview.before.fim)} • ${decimalHoursToHHMM(statePreview.before.horas)}/dia`]),
        el('li', {}, [`Alterado: ${formatDateBR(statePreview.after.inicio)} até ${formatDateBR(statePreview.after.fim)} • ${decimalHoursToHHMM(statePreview.after.horas)}/dia`]),
      ]));
    };
    ini.addEventListener('input', () => { renderRespAllocSummary(); refreshAllocationPreview(); });
    fim.addEventListener('input', () => { renderRespAllocSummary(); refreshAllocationPreview(); });
    status.addEventListener('change', refreshAllocationPreview);

    // v0.2.2 ? Apontamentos reais com timeline visual por demanda.
    let apontamentos = normalizeDemandApontamentos(demand);
    let editingAptId = '';
    const aptData = el('input', { type:'date', value: todayISO(), min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const aptEtapa = el('select');
    for (const step of PROJECT_STEP_OPTIONS) aptEtapa.appendChild(el('option', { value:step }, [step]));
    const aptHoras = el('input', { type:'text', inputmode:'decimal', placeholder:'Ex: 02:30 ou 2.5' });
    const aptObs = el('input', { placeholder:'Observação do apontamento...', maxlength:String(INPUT_LIMITS.shortNote) });
    const aptList = el('div');
    const aptSummary = el('div', { class:'tiny muted' });
    let saveAptBtn = null;
    let cancelAptBtn = null;

    const resetApontamentoForm = () => {
      editingAptId = '';
      aptData.value = todayISO();
      aptEtapa.value = PROJECT_STEP_OPTIONS[0];
      aptHoras.value = '';
      aptObs.value = '';
      if (saveAptBtn) saveAptBtn.textContent = 'Adicionar etapa';
      if (cancelAptBtn) cancelAptBtn.style.display = 'none';
    };

    const renderApontamentos = () => {
      apontamentos = sortApontamentosChronological(apontamentos.map(normalizeApontamento).filter(a => a.data && a.etapa && Number(a.horas) > 0));
      aptList.innerHTML = '';

      const totalHoras = apontamentos.reduce((acc, a) => acc + Number(a.horas || 0), 0);
      const etapasUnicas = new Set(apontamentos.map(a => normalizeProjectStep(a.etapa)).filter(Boolean));
      const ultimo = apontamentos.length ? apontamentos[apontamentos.length - 1] : null;
      aptSummary.textContent = `${apontamentos.length} apontamento(s) - ${etapasUnicas.size} etapa(s) - ${fmtHours(totalHoras)}h realizadas - Último: ${ultimo ? `${formatDateBR(ultimo.data)} / ${ultimo.etapa}` : '-'}. Essas horas não alteram a capacidade planejada.`;

      const stagePalette = (etapa='') => {
        const key = normalizeProjectStep(etapa).toLowerCase();
        if (['ari','pv','anr','qi','qo','qp','rp'].includes(key)) return { bg:'var(--primary-soft)', fg:'var(--accent)', border:'var(--primary-light)' };
        if (['eru','urs','rtm'].includes(key)) return { bg:'var(--success-soft)', fg:'var(--success)', border:'var(--success)' };
        if (['revisão','reuniao','reunião'].includes(key)) return { bg:'var(--warning-soft)', fg:'var(--alert)', border:'var(--warning)' };
        if (['execução de teste','execucao de teste','evidência','evidencia'].includes(key)) return { bg:'var(--primary-soft)', fg:'var(--primary)', border:'var(--primary-light)' };
        if (['correção','correcao'].includes(key)) return { bg:'var(--danger-soft)', fg:'var(--danger)', border:'var(--danger-border)' };
        return { bg:'var(--surface)', fg:'var(--text)', border:'var(--border)' };
      };

      const badge = (etapa) => {
        const c = stagePalette(etapa);
        return el('span', { style:`display:inline-flex;align-items:center;border:1px solid ${c.border};background:${c.bg};color:${c.fg};border-radius:999px;padding:3px 9px;font-size:11px;font-weight:900;line-height:1;white-space:nowrap` }, [etapa || 'Outro']);
      };

      const allocationsForMetrics = (normalizeStatus(status.value) === 'Mapeada')
        ? []
        : selectedResponsaveis().map(rid => ({
          ...makeDemandAllocation(rid, respHoursById.get(rid) ?? resourceHoursById(rid, state.resources || []), state.resources || []),
          data_inicio: normalizeDateLikeToISO(respStartById.get(rid) || '') || ini.value || demandStartForAlloc,
          data_fim: normalizeDateLikeToISO(respEndById.get(rid) || '') || fim.value || demandEndForAlloc,
          daily_hours: normalizeAllocationDailyHours(respDailyById.get(rid) || {}),
        }));
      const demandForMetrics = {
        ...demand,
        data_inicio: String(ini.value || demand.data_inicio || '').trim(),
        data_fim: String(fim.value || demand.data_fim || '').trim(),
        percentual_diario: Number(allocationsForMetrics[0]?.percentual_diario ?? demand.percentual_diario ?? 0),
        horas_planejadas_dia: Number(allocationsForMetrics[0]?.horas_planejadas_dia ?? demand.horas_planejadas_dia ?? 0),
        allocations: allocationsForMetrics,
        responsavel_id: normalizeStatus(status.value) === 'Mapeada' ? '' : String(allocationsForMetrics[0]?.resourceId || demand.responsavel_id || '').trim(),
        status: normalizeStatus(status.value || demand.status)
      };
      const execMetrics = demandExecutionMetrics(demandForMetrics, apontamentos);
      const fmtSignedMetricHours = (h) => {
        const v = Number(h || 0);
        const abs = Math.abs(v);
        const out = Math.abs(abs - Math.round(abs)) < 1e-9 ? String(Math.round(abs)) : abs.toFixed(1);
        return `${v > 0 ? '+' : (v < 0 ? '-' : '')}${out}`;
      };
      const fmtMetricHoursAbs = (h) => {
        const abs = Math.abs(Number(h || 0));
        return Math.abs(abs - Math.round(abs)) < 1e-9 ? String(Math.round(abs)) : abs.toFixed(1);
      };
      const deltaLabel = `${fmtMetricHoursAbs(execMetrics.delta)}h`;
      const deltaHint = execMetrics.delta > 0 ? 'restantes' : (execMetrics.delta < 0 ? 'acima do planejado' : 'planejado atingido');
      const efficiencyLabel = execMetrics.efficiencyPct === null ? '?' : `${execMetrics.efficiencyPct}%`;
      const progressLabel = `${execMetrics.progressPct}%`;
      const trendColor = execMetrics.trendTone === 'danger' ? 'var(--danger)' : (execMetrics.trendTone === 'warn' ? 'var(--alert)' : (execMetrics.trendTone === 'ok' ? 'var(--success)' : 'var(--muted)'));
      const trendBg = execMetrics.trendTone === 'danger' ? 'var(--danger-soft)' : (execMetrics.trendTone === 'warn' ? 'var(--warning-soft)' : (execMetrics.trendTone === 'ok' ? 'var(--success-soft)' : 'var(--surface)'));
      const metricCard = (label, value, hint='', extraStyle='') => el('div', { style:`border:1px solid var(--border);border-radius:14px;padding:10px;background:var(--surface);${extraStyle}` }, [
        el('div', { class:'tiny muted' }, [label]),
        el('div', { class:'mono', style:'font-weight:950;font-size:18px' }, [value]),
        hint ? el('div', { class:'tiny muted', style:'margin-top:2px' }, [hint]) : el('div', { class:'tiny muted', style:'margin-top:2px' }, [''])
      ]);
      const metrics = el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:10px 0 12px' }, [
        metricCard('Horas planejadas', `${fmtHours(execMetrics.plannedHours)}h`, `${execMetrics.plannedDays} dia(s) úteis`),
        metricCard('Horas realizadas', `${fmtHours(execMetrics.realHours)}h`, `${apontamentos.length} apontamento(s)`),
        metricCard('Saldo de horas', deltaLabel, deltaHint, execMetrics.delta < 0 ? 'background:var(--danger-soft)' : (execMetrics.delta > 0 ? 'background:var(--success-soft)' : '')),
        metricCard('Eficiência', efficiencyLabel, 'realizado ÷ planejado'),
        metricCard('Progresso real', progressLabel, 'realizado ÷ planejado'),
        el('div', { style:`border:1px solid var(--border);border-radius:14px;padding:10px;background:${trendBg}` }, [
          el('div', { class:'tiny muted' }, ['Tendência']),
          el('div', { style:`font-weight:950;font-size:16px;color:${trendColor}` }, [execMetrics.trend]),
          el('div', { class:'tiny muted', style:'margin-top:2px' }, ['baseado nas horas realizadas'])
        ]),
        metricCard('Etapas', String(etapasUnicas.size), 'tipos documentais'),
        el('div', { style:'border:1px solid var(--border);border-radius:14px;padding:10px;background:var(--surface)' }, [
          el('div', { class:'tiny muted' }, ['Último apontamento']),
          el('div', { style:'font-weight:850;font-size:13px' }, [ultimo ? `${formatDateBR(ultimo.data)} - ${ultimo.etapa}` : '-']),
          el('div', { class:'tiny muted', style:'margin-top:2px' }, ['histórico operacional'])
        ]),
      ]);
      aptList.appendChild(metrics);

      if (!apontamentos.length) {
        aptList.appendChild(el('div', { style:'padding:14px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:16px;background:var(--surface)' }, [
          'Nenhum apontamento cadastrado para esta demanda.'
        ]));
        return;
      }

      const groups = new Map();
      for (const a of apontamentos) {
        const key = a.data || 'Sem data';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
      }

      const timeline = el('div', { style:'display:flex;flex-direction:column;gap:14px;margin-top:8px' });
      for (const [data, items] of groups.entries()) {
        const dayTotal = items.reduce((acc, a) => acc + Number(a.horas || 0), 0);
        const dayBox = el('div', { style:'position:relative;padding-left:22px' });
        dayBox.appendChild(el('div', { style:'position:absolute;left:7px;top:4px;bottom:-14px;width:2px;background:#e5e7eb' }, []));
        dayBox.appendChild(el('div', { style:'position:absolute;left:0;top:3px;width:16px;height:16px;border-radius:999px;background:var(--primary);border:3px solid var(--primary-soft);box-shadow:0 0 0 1px var(--primary-light)' }, []));
        dayBox.appendChild(el('div', { style:'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap' }, [
          el('div', { style:'font-weight:950' }, [formatDateBR(data)]),
          el('div', { class:'tiny muted mono' }, [`${items.length} item(ns) - ${fmtHours(dayTotal)}h`])
        ]));

        const cards = el('div', { style:'display:flex;flex-direction:column;gap:8px' });
        for (const a of items) {
          const created = a.created_at ? new Date(Number(a.created_at)).toLocaleString('pt-BR') : '-';
          const updated = a.updated_at && Number(a.updated_at) !== Number(a.created_at) ? ` é alterado em ${new Date(Number(a.updated_at)).toLocaleString('pt-BR')}` : '';
          const card = el('div', { class:'apontamentoEntryCard' }, [
            el('div', { style:'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
              el('div', { style:'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
                badge(a.etapa),
                el('span', { class:'mono', style:'font-weight:950' }, [`${fmtHours(a.horas || 0)}h`])
              ]),
              el('div', { class:'row', style:'gap:6px;flex-wrap:nowrap' }, [
                iconButton('Editar', '✎', '', () => {
                  editingAptId = String(a.id);
                  aptData.value = a.data || todayISO();
                  aptEtapa.value = normalizeProjectStep(a.etapa) || PROJECT_STEP_OPTIONS[0];
                  aptHoras.value = String(a.horas || '');
                  aptObs.value = a.observacao || '';
                  if (saveAptBtn) saveAptBtn.textContent = 'Salvar etapa';
                  if (cancelAptBtn) cancelAptBtn.style.display = '';
                }),
                iconButton('Excluir', '🗑', 'danger', () => {
                  apontamentos = apontamentos.filter(x => String(x.id) !== String(a.id));
                  if (editingAptId === String(a.id)) resetApontamentoForm();
                  renderApontamentos();
                  toast('Apontamento removido. Salve a demanda para persistir.');
                })
              ])
            ]),
            el('div', { style:'margin-top:8px;color:var(--text)' }, [a.observacao || 'Sem observação.']),
            el('div', { class:'tiny muted', style:'margin-top:8px' }, [`${a.usuario || '-'} - criado em ${created}${updated}`])
          ]);
          cards.appendChild(card);
        }
        dayBox.appendChild(cards);
        timeline.appendChild(dayBox);
      }

      aptList.appendChild(timeline);
    };

    const upsertApontamento = () => {
      const data = String(aptData.value || '').trim();
      const etapa = normalizeProjectStep(aptEtapa.value);
      const horas = parseApontamentoHours(aptHoras.value);
      const validation = validateApontamentoInput({ data, etapa, horas }, demand);
      if (validation) { toast(validation); return; }
      const obsValidation = validateTextLimit(aptObs.value, 'Observação do apontamento', INPUT_LIMITS.shortNote);
      if (obsValidation) { toast(obsValidation); return; }

      if (editingAptId) {
        const idx = apontamentos.findIndex(a => String(a.id) === String(editingAptId));
        if (idx < 0) { toast('Apontamento em edição não encontrado.'); resetApontamentoForm(); return; }
        apontamentos[idx] = normalizeApontamento({
          ...apontamentos[idx],
          data,
          etapa,
          horas,
          observacao: String(aptObs.value || '').trim(),
          updated_at: Date.now(),
          updated_by: userName || 'Sessão local',
          updated_by_id: userId || '',
        });
        toast('Apontamento atualizado. Salve a demanda para persistir.');
      } else {
        apontamentos.push(normalizeApontamento({
          id: generateId('apt'),
          data,
          etapa,
          horas,
          observacao: String(aptObs.value || '').trim(),
          usuario: userName || 'Sessão local',
          user_id: userId || '',
          created_at: Date.now(),
          updated_at: Date.now(),
          updated_by: userName || 'Sessão local',
          updated_by_id: userId || '',
        }));
        toast('Apontamento adicionado. Salve a demanda para persistir.');
      }
      resetApontamentoForm();
      renderApontamentos();
    };
    renderApontamentos();

    saveAptBtn = button('Adicionar etapa', 'primary', upsertApontamento);
    cancelAptBtn = button('Cancelar edição', '', () => { resetApontamentoForm(); });
    cancelAptBtn.style.display = 'none';

    const apontamentosBox = el('div', { class:'field apontamentoEditorSurface' }, [
      el('label', {}, ['Etapas do projeto / apontamento real']),
      el('div', { class:'tiny muted', style:'margin-bottom:10px' }, ['Registre horas reais gastas por documento/atividade. Não soma novamente na capacidade planejada.']),
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'min-width:150px;flex:0 0 150px' }, [el('label', {}, ['Data']), aptData]),
        el('div', { class:'field', style:'min-width:170px;flex:0 0 170px' }, [el('label', {}, ['Etapa']), aptEtapa]),
        el('div', { class:'field', style:'min-width:130px;flex:0 0 130px' }, [el('label', {}, ['Horas gastas']), aptHoras]),
        el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Observação']), aptObs]),
        el('div', { class:'field', style:'align-self:flex-end;flex:0 0 auto' }, [saveAptBtn]),
        el('div', { class:'field', style:'align-self:flex-end;flex:0 0 auto' }, [cancelAptBtn]),
      ]),
      aptSummary,
      aptList
    ]);

      const syncMapeada = () => {
        const st = normalizeStatus(status.value);
        if (st === 'Mapeada') {
          selectedRespIds.clear();
          respHoursById.clear();
          respSearch.value = '';
        } else {
          if (!selectedRespIds.size) {
            for (const a of demandAllocations(demand)) {
              const rid = String(a.resourceId || '').trim();
              if (!rid) continue;
              selectedRespIds.add(rid);
              if (!respHoursById.has(rid)) respHoursById.set(rid, demandAllocationDisplayHours(a, demand, state.resources || []));
            }
            if (!selectedRespIds.size && demand.responsavel_id) {
              selectedRespIds.add(demand.responsavel_id);
              if (!respHoursById.has(demand.responsavel_id)) respHoursById.set(demand.responsavel_id, firstHoursLike(demand.horas_planejadas_dia, demand.horas_dia) ?? percentToDemandHours(demand.percentual_diario ?? 100, demand.responsavel_id, state.resources || []));
            }
          }
        }
        renderRespChips();
        renderRespOptions();
      };
    status.addEventListener('change', () => { syncMapeada(); renderApontamentos(); });
    [ini, fim].forEach(field => field.addEventListener('input', renderApontamentos));
    syncMapeada();

    const before = {
      titulo: demand.titulo,
      predio: demand.predio,
      focal: demand.focal,
      responsavel_id: demand.responsavel_id,
      data_inicio: demand.data_inicio,
      data_fim: demand.data_fim,
      percentual_diario: demand.percentual_diario,
      horas_planejadas_dia: demand.horas_planejadas_dia,
      prioridade: demand.prioridade,
      status: demand.status,
      observacoes: demand.observacoes,
      allocations: allocationAuditSnapshot(demand),
      apontamentos: normalizeDemandApontamentos(demand)
    };

    // Botão de salvar será criado mais abaixo
    let saveBtn = null;

	    const save = () => {
      const justification = (just.value || '').trim();

      const nextStatus = normalizeStatus(status.value);
      if (nextStatus === 'Atrasada') { toast('Status Atrasada ? automático. Selecione outro status.'); return; }
      const titleVal = (titulo.value || '').trim();
      const predioVal = (predio.value || '').trim();
      const focalVal = (focal.value || '').trim();
      const iniVal = (ini.value || '').trim();
      const fimVal = (fim.value || '').trim();
      const obsVal = (obs.value || '').trim();
      const justValidation = validateTextLimit(justification, 'Justificativa', INPUT_LIMITS.justification, { required: isFinalView && normalizeStatus(status.value) !== normalizeStatus(demand.status) });
      if (justValidation) { toast(justValidation); return; }
      if (isFinalView) {
        const changed = requestDemandStatusJustificationWithText(demand, nextStatus, justification);
        if (changed) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
        return;
      }
      const demandValidation = validateDemandFields({
        titulo: titleVal,
        predio: predioVal,
        focal: focalVal,
        data_inicio: iniVal,
        data_fim: fimVal,
        observacoes: obsVal,
        status: nextStatus,
      });
      if (demandValidation) { toast(demandValidation); return; }
      const respIds = (nextStatus === 'Mapeada') ? [] : selectedResponsaveis();
      if (nextStatus !== 'Mapeada' && !respIds.length) { toast('Selecione um ou mais responsáveis ou marque como Mapeada.'); return; }
      const latestDemand = (state.demands || []).find(d => String(d.id) === String(demand.id)) || demand;
      const allocations = buildEditedDemandAllocations(latestDemand, respIds, respHoursById, nextStatus, iniVal, fimVal)
        .map(a => {
          const rid = String(a.resourceId || '').trim();
          return {
            ...a,
            data_inicio: normalizeDateLikeToISO(respStartById.get(rid) || '') || iniVal,
            data_fim: normalizeDateLikeToISO(respEndById.get(rid) || '') || fimVal,
            daily_hours: normalizeAllocationDailyHours(respDailyById.get(rid) || {}),
          };
        });
      const allocValidation = validateDemandAllocationLimits(allocations);
      if (!allocValidation.ok) { toast(allocValidation.msg); return; }
      const demandForPrimary = { ...latestDemand, data_inicio: iniVal, data_fim: fimVal, allocations };
      const primaryAllocForSave = activeDemandAllocations(demandForPrimary)[0] || allocations.find(a => respIds.includes(String(a.resourceId || ''))) || allocations[0] || {};
      const primaryResponsavelId = String(primaryAllocForSave.resourceId || '').trim();
      const previousStatus = normalizeStatus(latestDemand.status);
      const statusChanged = previousStatus !== nextStatus;
      const statusAudit = statusChanged ? {
        status_reason: justification || latestDemand.status_reason || '',
        status_reason_type: nextStatus,
        status_changed_at: Date.now(),
        status_action_date: todayISO(),
        status_changed_by: userName || 'Sessão local',
        status_changed_by_id: userId || '',
      } : {};
      const next = {
        ...latestDemand,
        ...statusAudit,
        titulo: titleVal,
        predio: predioVal,
        focal: focalVal,
        responsavel_id: (nextStatus === 'Mapeada') ? '' : primaryResponsavelId,
        data_inicio: iniVal,
        data_fim: fimVal,
        baseline_inicio: latestDemand.baseline_inicio || latestDemand.data_inicio || iniVal,
        baseline_fim: latestDemand.baseline_fim || latestDemand.data_fim || fimVal,
        percentual_diario: Number(allocations[0]?.percentual_diario || 0),
        horas_planejadas_dia: Number(allocations[0]?.horas_planejadas_dia || 0),
        allocations,
        prioridade: prioridade.value,
        status: nextStatus,
        observacoes: obsVal,
        apontamentos: normalizeDemandApontamentos({ apontamentos }),
        last_edit_by: userName,
        last_edit_at: Date.now(),
        last_edit_justification: justification,
      };

      // registra um evento extra com diff para auditoria (além do UPDATE_DEMAND padrão)
      const after = {
        titulo: next.titulo,
        predio: next.predio,
        focal: next.focal,
        responsavel_id: next.responsavel_id,
        data_inicio: next.data_inicio,
        data_fim: next.data_fim,
        percentual_diario: next.percentual_diario,
        horas_planejadas_dia: next.horas_planejadas_dia,
        prioridade: next.prioridade,
        status: next.status,
        observacoes: next.observacoes,
        allocations: allocationAuditSnapshot(next),
        apontamentos: normalizeDemandApontamentos(next)
      };
      state.events = [...state.events, { id: generateId('event'), type:'EDIT_DEMAND', payload:{ demand_id: demand.id, action_at: Date.now(), before, after, justification }, timestamp: Date.now(), user: userName, user_id: userId || '' }];

      dispatch('UPDATE_DEMAND', next);
      try { dlg.close(); } catch { dlg.removeAttribute('open'); }
      toast('Demanda atualizada.');
    };

	    saveBtn = button(isFinalView ? 'Salvar situação' : 'Salvar alterações', 'primary', save);
	    saveBtn.setAttribute('data-final-view-action', 'true');
	    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:10px' }, [
      button(isFinalView ? 'Fechar' : 'Cancelar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }),
	      saveBtn,
    ]);

    const sectionTitle = (num, text) => el('div', { class:'demandCreateSectionTitle' }, [el('span', { class:'step' }, [String(num)]), text]);
    const editPanel = el('div');
    const auditPanel = el('div', { style:'display:none' }, [renderDemandAuditTrail(demand)]);
    let editTabBtn = null;
    let auditTabBtn = null;
    const setDemandModalTab = (tab) => {
      const audit = tab === 'audit';
      editPanel.style.display = audit ? 'none' : '';
      auditPanel.style.display = audit ? '' : 'none';
      if (editTabBtn) editTabBtn.className = audit ? 'btn small' : 'btn primary small';
      if (auditTabBtn) auditTabBtn.className = audit ? 'btn primary small' : 'btn small';
    };
    editTabBtn = button('Edição de demanda', 'primary small', () => setDemandModalTab('edit'));
    auditTabBtn = button('Trilha de Auditoria', 'small', () => setDemandModalTab('audit'));
    body.appendChild(el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'row', style:'gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:10px' }, [editTabBtn, auditTabBtn]),
      editPanel,
      auditPanel,
    ]));
    editPanel.appendChild(el('div', { class:'demandCreateForm' }, [
      el('div', { class:'demandCreateIntro' }, [
        el('div', {}, [
          el('strong', {}, [isFinalView ? 'Visualização de demanda' : 'Edição de demanda']),
          el('span', {}, ['Revise identificação, planejamento e alocação seguindo o mesmo fluxo do cadastro.'])
        ]),
        el('span', { class:'pill info' }, [effectiveStatus(demand)])
      ]),
      el('div', { class:'demandCreateSection' }, [
        sectionTitle(1, 'Identificação'),
        el('div', { class:'demandCreateGrid' }, [
          el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Título']), titulo]),
          el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Prioridade']), prioridade]),
          el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Prédio']), predio]),
          el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Focal']), focalControl, el('div', { class:'tiny muted' }, ['Busque usuários cadastrados para evitar nomes digitados aleatoriamente.'])]),
        ])
      ]),
      el('div', { class:'demandCreateSection' }, [
        sectionTitle(2, 'Planejamento'),
        el('div', { class:'demandCreateGrid' }, [
          el('div', { class:'field demandCreateField span-4' }, [el('label', {}, ['Início']), ini]),
          el('div', { class:'field demandCreateField span-4' }, [el('label', {}, ['Fim']), fim]),
          el('div', { class:'field demandCreateField demandStatusField span-4' }, [el('label', {}, ['Situação da demanda']), status]),
        ])
      ]),
      el('div', { class:'demandCreateSection demandCreateAllocationBox' }, [
        sectionTitle(3, 'Responsáveis e dedicação'),
        el('div', { class:'demandCreateGrid' }, [
          el('div', { class:'field demandCreateField demandRespField span-8' }, [el('label', {}, ['Responsável(is)']), responsavel]),
          el('div', { class:'field demandCreateField demandPercField demandAllocSummaryField span-12' }, [el('div', { class:'allocHeaderPremium' }, [el('label', {}, ['Alocação do responsável']), allocationChangeBtn]), respAllocEditor, respAllocList]),
        ])
      ]),
      el('div', { class:'demandCreateSection' }, [
        sectionTitle(4, 'Observações'),
        el('div', { class:'demandCreateGrid' }, [
          el('div', { class:'field demandCreateField span-12' }, [el('label', {}, ['Observações']), obs]),
          el('div', { class:'field demandCreateField span-12' }, [el('label', {}, ['Justificativa (opcional)']), just, justHint]),
        ])
      ]),
      el('div', { class:'demandCreateActions' }, [footer])
    ]));

    if (isFinalView) {
      footer.querySelectorAll('button').forEach(btn => btn.setAttribute('data-final-view-action', 'true'));
      editPanel.querySelectorAll('input, textarea, select, button').forEach(ctrl => {
        if (ctrl.matches('[data-final-view-editable=\"true\"], [data-final-view-action=\"true\"]')) return;
        ctrl.disabled = true;
        ctrl.setAttribute('aria-disabled', 'true');
      });
      responsavel.classList.add('disabled');
    }

    openDialog(dlg);
  };

  // ----------------------
  // Reprogramar Demanda (modal: novo prazo final + justificativa obrigatória)
  // ----------------------

  const openDemandStagesModal = (demand) => {
    const dlg = qs('#demandStagesModal');
    if (!dlg || !demand) return;

    qs('#demandStagesModalTitle').textContent = `Apontamento - ${demand.titulo}`;
    qs('#demandStagesModalSub').textContent = 'Cadastre a atividade realizada nesta demanda.';

    const body = qs('#demandStagesModalBody');
    body.innerHTML = '';

    let apontamentos = normalizeDemandApontamentos(demand);
    const data = el('input', { type:'date', value: todayISO(), min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const etapa = el('select');
    for (const step of PROJECT_STEP_OPTIONS) etapa.appendChild(el('option', { value:step }, [step]));
    const horas = el('input', { type:'text', inputmode:'decimal', placeholder:'Ex: 02:30 ou 2.5' });
    const obs = el('textarea', { placeholder:'Descreva rapidamente a atividade realizada...', maxlength:String(INPUT_LIMITS.shortNote), style:'min-height:92px' });
    const history = el('div');
    const summary = el('div', { class:'tiny muted' });
    let editingAptId = '';
    let saveBtn = null;
    let cancelBtn = null;

    const resetForm = () => {
      editingAptId = '';
      data.value = todayISO();
      etapa.value = PROJECT_STEP_OPTIONS[0];
      horas.value = '';
      obs.value = '';
      if (saveBtn) saveBtn.textContent = 'Salvar apontamento';
      if (cancelBtn) cancelBtn.style.display = 'none';
    };

    const renderHistory = () => {
      apontamentos = normalizeDemandApontamentos({ apontamentos });
      history.innerHTML = '';
      const totalHoras = apontamentos.reduce((acc, a) => acc + Number(a.horas || 0), 0);
      const ultimo = apontamentos.length ? apontamentos[apontamentos.length - 1] : null;
      summary.textContent = `${apontamentos.length} apontamento(s) - ${fmtHours(totalHoras)}h realizadas - Ultimo: ${ultimo ? `${formatDateBR(ultimo.data)} / ${ultimo.etapa}` : '-'}.`;

      if (!apontamentos.length) {
        history.appendChild(el('div', { style:'padding:14px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:16px;background:var(--surface)' }, [
          'Nenhum apontamento cadastrado para esta demanda.'
        ]));
        return;
      }

      const list = el('div', { style:'display:flex;flex-direction:column;gap:8px;margin-top:8px' });
      for (const a of [...apontamentos].reverse().slice(0, 8)) {
        const flags = apontamentoWindowFlags(demand, a);
        const windowBadges = [
          flags.early ? el('span', { class:'pill warn', title:'Apontamento antes da data de início planejada.' }, ['Execução antecipada']) : null,
          flags.late ? el('span', { class:'pill bad', title:'Apontamento depois do prazo atual da demanda.' }, ['Fora do prazo']) : null,
        ].filter(Boolean);
        list.appendChild(el('div', { class:'apontamentoEntryCard', style:'border-radius:14px' }, [
          el('div', { style:'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
            el('div', {}, [
              el('div', { style:'font-weight:950' }, [`${formatDateBR(a.data)} - ${a.etapa}`]),
              el('div', { class:'mono', style:'font-weight:950;margin-top:2px' }, [`${fmtHours(a.horas || 0)}h`]),
              windowBadges.length ? el('div', { class:'row', style:'gap:6px;flex-wrap:wrap;margin-top:6px' }, windowBadges) : null
            ]),
            el('div', { class:'row', style:'gap:6px;flex-wrap:nowrap' }, [
              iconButton('Editar', '✎', '', () => {
                editingAptId = String(a.id);
                data.value = a.data || todayISO();
                etapa.value = normalizeProjectStep(a.etapa) || PROJECT_STEP_OPTIONS[0];
                horas.value = String(a.horas || '');
                obs.value = a.observacao || '';
                if (saveBtn) saveBtn.textContent = 'Salvar edicao';
                if (cancelBtn) cancelBtn.style.display = '';
              }),
              iconButton('Excluir', '🗑', 'danger', () => {
                apontamentos = apontamentos.filter(x => String(x.id) !== String(a.id));
                if (editingAptId === String(a.id)) resetForm();
                persistApontamentos('Apontamento removido.');
              })
            ])
          ]),
          el('div', { class:'tiny muted', style:'margin-top:6px' }, [a.observacao || 'Sem observacao.']),
          el('div', { class:'tiny muted', style:'margin-top:6px' }, [a.usuario || 'Sessao local'])
        ]));
      }
      history.appendChild(list);
    };

    const persistApontamentos = (message) => {
      apontamentos = normalizeDemandApontamentos({ apontamentos });
      dispatch('UPDATE_DEMAND', {
        ...demand,
        apontamentos,
        last_edit_by: userName,
        last_edit_at: Date.now(),
        last_edit_justification: 'Apontamento registrado.',
      });
      renderHistory();
      toast(message);
      render();
    };

    const save = () => {
      const nextData = String(data.value || '').trim();
      const nextEtapa = normalizeProjectStep(etapa.value);
      const nextHoras = parseApontamentoHours(horas.value);
      const validation = validateApontamentoInput({ data: nextData, etapa: nextEtapa, horas: nextHoras }, demand);
      if (validation) { toast(validation); return; }
      const obsValidation = validateTextLimit(obs.value, 'Observação do apontamento', INPUT_LIMITS.shortNote);
      if (obsValidation) { toast(obsValidation); return; }

      if (editingAptId) {
        const idx = apontamentos.findIndex(a => String(a.id) === String(editingAptId));
        if (idx < 0) { toast('Apontamento em edicao nao encontrado.'); resetForm(); return; }
        apontamentos[idx] = normalizeApontamento({
          ...apontamentos[idx],
          data: nextData,
          etapa: nextEtapa,
          horas: nextHoras,
          observacao: String(obs.value || '').trim(),
          updated_at: Date.now(),
          updated_by: userName || 'Sessao local',
          updated_by_id: userId || '',
        });
        resetForm();
        persistApontamentos('Apontamento atualizado.');
        return;
      }

      apontamentos.push(normalizeApontamento({
        id: generateId('apt'),
        data: nextData,
        etapa: nextEtapa,
        horas: nextHoras,
        observacao: String(obs.value || '').trim(),
        usuario: userName || 'Sessao local',
        user_id: userId || '',
        created_at: Date.now(),
        updated_at: Date.now(),
        updated_by: userName || 'Sessao local',
        updated_by_id: userId || '',
      }));
      resetForm();
      persistApontamentos('Apontamento cadastrado.');
    };

    saveBtn = button('Salvar apontamento', 'primary', save);
    cancelBtn = button('Cancelar edicao', '', () => { resetForm(); });
    cancelBtn.style.display = 'none';

    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:10px' }, [
      button('Fechar', '', () => closeDialog(dlg)),
      cancelBtn,
      saveBtn,
    ]);

    body.appendChild(el('div', { class:'grid' }, [
      el('div', { class:'hint' }, [
        el('b', {}, [demand.titulo || 'Demanda']),
        el('div', { class:'tiny muted', style:'margin-top:4px' }, [
          `${formatDateBR(demand.data_inicio)} -> ${formatDateBR(demand.data_fim)} - ${demand.prioridade || 'Media'} - ${effectiveStatus(demand)}`
        ]),
        el('div', { class:'tiny muted', style:'margin-top:4px' }, ['Apontamentos antes do início planejado são permitidos e contabilizados como execução antecipada.'])
      ]),
      el('div', { class:'field apontamentoEditorSurface' }, [
        el('label', {}, ['Etapas do projeto / apontamento real']),
        el('div', { class:'tiny muted' }, ['Registre horas reais gastas por documento/atividade. Nao altera a capacidade planejada.'])
      ]),
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'min-width:150px;flex:0 0 150px' }, [el('label', {}, ['Data']), data]),
        el('div', { class:'field', style:'min-width:180px;flex:0 0 180px' }, [el('label', {}, ['Etapa / atividade']), etapa]),
        el('div', { class:'field', style:'min-width:130px;flex:0 0 130px' }, [el('label', {}, ['Horas gastas']), horas]),
      ]),
      el('div', { class:'field' }, [el('label', {}, ['Observacao']), obs]),
      summary,
      history,
      footer
    ]));

    renderHistory();
    openDialog(dlg);
    setTimeout(() => { try { horas.focus(); } catch {} }, 0);
  };

  const openDemandTransferModal = (demand) => {
    if (!demand) return;
    const currentAllocs = activeDemandAllocations(demand);
    const currentRid = String(demand.responsavel_id || currentAllocs[0]?.resourceId || '').trim();
    const currentAlloc = currentAllocs.find(a => String(a.resourceId || '') === currentRid) || currentAllocs[0] || {};
    let dlg = qs('#demandTransferModal');
    if (dlg) dlg.remove();
    const transferDate = el('input', { type:'date', value:todayISO(), min:demand.data_inicio || `${MIN_APP_YEAR}-01-01`, max:demand.data_fim || `${MAX_APP_YEAR}-12-31` });
    const transferEnd = el('input', { type:'date', value:demand.data_fim || '', min:demand.data_inicio || `${MIN_APP_YEAR}-01-01`, max:demand.data_fim || `${MAX_APP_YEAR}-12-31` });
    const fromSel = el('select', {}, currentAllocs.map(a => {
      const rid = String(a.resourceId || '').trim();
      return el('option', { value:rid, selected:rid === currentRid }, [resourceById()[rid]?.nome || rid || '-']);
    }));
    const toSel = el('select', {}, (state.resources || []).filter(r => r?.ativo !== false && String(r.id) !== currentRid).map(r => el('option', { value:r.id }, [r.nome || r.id])));
    const hours = el('input', { type:'text', inputmode:'decimal', value:decimalHoursToHHMM(currentAlloc.horas_planejadas_dia || currentAlloc.horas_dia || demand.horas_planejadas_dia || demand.horas_dia || 0), placeholder:'Ex: 06:00' });
    const justification = el('textarea', { placeholder:'Explique o motivo da transferência de atuação...', maxlength:String(INPUT_LIMITS.justification), style:'min-height:110px' });
    const status = el('div', { class:'tiny muted' }, ['Na data informada, a alocação ativa passa imediatamente para o novo recurso; o recurso de origem fica com histórico até o dia anterior.']);
    const confirmTransfer = () => {
      const dateVal = normalizeDateLikeToISO(transferDate.value);
      const fromId = String(fromSel.value || '').trim();
      const toId = String(toSel.value || '').trim();
      const endVal = normalizeDateLikeToISO(transferEnd.value || '') || '';
      const h = firstHoursLike(hours.value);
      const text = String(justification.value || '').trim();
      if (!dateVal) { status.textContent = 'Informe uma data de transferência válida.'; status.style.color = 'var(--danger)'; return; }
      if (demand.data_fim && dateVal > demand.data_fim) { status.textContent = 'A data da transferência precisa estar dentro do período da demanda.'; status.style.color = 'var(--danger)'; return; }
      if (endVal && endVal < dateVal) { status.textContent = 'A data final da atuação precisa ser igual ou posterior à transferência.'; status.style.color = 'var(--danger)'; return; }
      if (demand.data_fim && endVal && endVal > demand.data_fim) { status.textContent = 'A data final da atuação precisa estar dentro do período da demanda.'; status.style.color = 'var(--danger)'; return; }
      if (!fromId || !toId || fromId === toId) { status.textContent = 'Selecione recursos de origem e destino diferentes.'; status.style.color = 'var(--danger)'; return; }
      if (h === null || h <= 0) { status.textContent = 'Informe horas/dia válidas para o novo responsável.'; status.style.color = 'var(--danger)'; return; }
      if (!text) { status.textContent = 'Informe a justificativa da transferência.'; status.style.color = 'var(--danger)'; return; }
      dispatch('TRANSFER_DEMAND_ALLOCATION', { demandId:demand.id, fromResourceId:fromId, toResourceId:toId, transferDate:dateVal, transferEnd:endVal, horas_planejadas_dia:h, justification:text });
      closeDialog(dlg);
      toast('Atuação transferida com histórico preservado.');
    };
    dlg = el('dialog', { id:'demandTransferModal', class:'modal' }, [
      el('div', { class:'modalCard' }, [
        el('div', { class:'modalHd' }, [
          el('div', {}, [el('div', { class:'modalTitle' }, [`Transferir atuação - ${demand.titulo || '-'}`]), el('div', { class:'modalSub' }, ['Preserva a origem no histórico até o dia anterior e inicia o novo recurso na data da transferência.'])]),
          button('Fechar ×', 'ghost', () => closeDialog(dlg))
        ]),
        el('div', { class:'modalBd' }, [
          el('div', { class:'grid', style:'grid-template-columns:repeat(2,minmax(0,1fr));gap:10px' }, [
            el('div', { class:'field' }, [el('label', {}, ['Sai de']), fromSel]),
            el('div', { class:'field' }, [el('label', {}, ['Vai para']), toSel]),
            el('div', { class:'field' }, [el('label', {}, ['Data inicial da atuação']), transferDate]),
            el('div', { class:'field' }, [el('label', {}, ['Data final da atuação']), transferEnd]),
            el('div', { class:'field' }, [el('label', {}, ['Horas/dia no novo recurso']), hours]),
          ]),
          el('div', { class:'field', style:'margin-top:10px' }, [el('label', {}, ['Justificativa obrigatória']), justification]),
          status,
          el('div', { class:'row end', style:'margin-top:14px' }, [button('Transferir atuação', 'primary', confirmTransfer)])
        ])
      ])
    ]);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(dlg); });
    document.body.appendChild(dlg);
    openDialog(dlg);
  };

  const openDemandReprogramModal = (demand) => {
    const dlg = qs('#demandReprogramModal');
    if (!dlg || !demand) return;

    qs('#demandReprogramModalTitle').textContent = `Reprogramar demanda - ${demand.titulo}`;
    qs('#demandReprogramModalSub').textContent = 'Altere apenas o prazo final e informe a justificativa (obrigatória).';

    const body = qs('#demandReprogramModalBody');
    body.innerHTML = '';

    const inicioAtual = String(demand.data_inicio || '').trim();
    const baselineInicio = String(demand.baseline_inicio || demand.data_inicio || '').trim();
    const baselineFim = String(demand.baseline_fim || demand.data_fim || '').trim();
    const prazoAtual = String(demand.data_fim || '').trim();
    const novaIni = el('input', { type:'date', value: inicioAtual, disabled:'true', title:'A data de início não é alterada na reprogramação.' });
    const novaFim = el('input', { type:'date', value: demand.data_fim || '', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const just = el('textarea', { placeholder:'Justificativa (obrigatória)...', maxlength:String(INPUT_LIMITS.justification), style:'min-height:92px' });

    const dateErr = el('div', { class:'inlineError', style:'display:none' }, ['Verifique o prazo final: ele é obrigatório e não pode ser anterior ao início atual.']);
    const justErr = el('div', { class:'inlineError', style:'display:none' }, ['Informe uma justificativa para confirmar a reprogramação.']);
    const formatSignedDays = (days) => {
      const n = Number(days || 0);
      if (!Number.isFinite(n) || n === 0) return 'sem alteração de dias';
      return `${n > 0 ? '+' : ''}${n} dia(s)`;
    };
    const daysBetweenSafe = (start, end) => (isISODateString(start) && isISODateString(end)) ? diffDaysISO(start, end) : 0;
    const currentOverOriginal = Math.max(0, daysBetweenSafe(baselineFim, prazoAtual));
    const summaryCard = (label, main, hint='', tone='') => el('div', {
      style:`border:1px solid ${tone==='danger'?'var(--danger-border)':'var(--border)'};border-radius:14px;padding:10px 12px;background:${tone==='danger'?'var(--danger-soft)':'var(--surface)'};min-width:0`
    }, [
      el('div', { class:'tiny muted', style:'font-weight:900' }, [label]),
      el('div', { class:'mono', style:'font-weight:950;margin-top:4px;line-height:1.25' }, [main]),
      hint ? el('div', { class:'tiny muted', style:'margin-top:4px' }, [hint]) : null
    ]);
    const impactOriginal = el('div', { class:'mono', style:'font-weight:950;line-height:1.25' }, ['-']);
    const impactCurrent = el('div', { class:'mono', style:'font-weight:950;line-height:1.25' }, ['-']);
    const impactHint = el('div', { class:'tiny muted', style:'margin-top:4px;line-height:1.35' }, ['Informe o novo prazo final para ver o impacto em dias.']);

    const setInvalid = (fieldEl, ok) => {
      const wrap = fieldEl.closest('.field');
      if (wrap) wrap.classList.toggle('invalid', !ok);
    };

    const validateDates = () => {
      const ini = inicioAtual;
      const fim = (novaFim.value || '').trim();
      let ok = true;
      const dateValidation = validateDateRangeLimits(ini, fim, { allowEmpty:false, label:'Reprogramação' });
      if (dateValidation) ok = false;
      dateErr.textContent = dateValidation || 'Verifique o prazo final: ele é obrigatório e não pode ser anterior ao início atual.';
      setInvalid(novaFim, ok);
      dateErr.style.display = ok ? 'none' : 'block';
      return ok;
    };

    const validateJust = () => {
      const j = (just.value || '').trim();
      const msg = validateTextLimit(j, 'Justificativa', INPUT_LIMITS.justification, { required:true });
      const ok = !msg;
      justErr.textContent = msg || 'Informe uma justificativa para confirmar a reprogramação.';
      setInvalid(just, ok);
      justErr.style.display = ok ? 'none' : 'block';
      return ok;
    };

    const confirmBtn = button('Confirmar reprogramação', 'primary', () => {
      const okDates = validateDates();
      const okJust = validateJust();
      if (!okDates) {
        novaFim.focus();
        return;
      }
      if (!okJust) {
        just.focus();
        return;
      }

      const rp = {
        id: generateId(),
        demanda_id: demand.id,
        data: formatDate(new Date()),
        inicio_original: baselineInicio || inicioAtual,
        prazo_original: baselineFim || demand.data_fim || '',
        prazo_anterior: demand.data_fim || '',
        novo_fim: novaFim.value,
        // compatibilidade com snapshots antigos
        novo_prazo: novaFim.value,
        motivo: (just.value || '').trim(),
        impacto_hh: 0,
        timestamp: Date.now(),
        user: userName,
        user_id: userId || '',
      };

      dispatch('REPROGRAM_DEMAND', { demandId: demand.id, reprogramming: rp });
      try { dlg.close(); } catch { dlg.removeAttribute('open'); }
      toast('Demanda reprogramada.');
    });

    // Começa bloqueado até preencher justificativa + prazo válido
    confirmBtn.disabled = true;

    const refreshImpact = () => {
      const nextFim = String(novaFim.value || '').trim();
      if (!isISODateString(nextFim)) {
        impactOriginal.textContent = '-';
        impactCurrent.textContent = '-';
        impactHint.textContent = 'Informe o novo prazo final para ver o impacto em dias.';
        return;
      }
      const originalDelta = daysBetweenSafe(baselineFim, nextFim);
      const currentDelta = daysBetweenSafe(prazoAtual, nextFim);
      impactOriginal.textContent = `${formatSignedDays(originalDelta)} vs. prazo original`;
      impactCurrent.textContent = `${formatSignedDays(currentDelta)} vs. prazo atual`;
      impactHint.textContent = originalDelta > 0
        ? `A demanda ficará ${originalDelta} dia(s) além do fim originalmente programado.`
        : 'O novo prazo não ultrapassa o fim originalmente programado.';
    };

    const refreshConfirmState = () => {
      const ini = inicioAtual;
      const fim = (novaFim.value || '').trim();
      const okDates = !validateDateRangeLimits(ini, fim, { allowEmpty:false, label:'Reprogramação' });
      const okJust = !validateTextLimit(just.value, 'Justificativa', INPUT_LIMITS.justification, { required:true });
      refreshImpact();
      confirmBtn.disabled = !(okDates && okJust);
    };

    const onInput = () => {
      // se usuario ja interagiu, mostra erro conforme necessario
      const fim = (novaFim.value || '').trim();
      if (inicioAtual && fim) validateDates();
      else dateErr.style.display = 'none';

      if ((just.value || '').trim()) { setInvalid(just, true); justErr.style.display = 'none'; }

      refreshConfirmState();
    };

    novaFim.addEventListener('input', onInput);
    just.addEventListener('input', onInput);

    // estado inicial
    refreshConfirmState();

    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:4px;width:100%' }, [
      button('Cancelar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }),
      confirmBtn,
    ]);

    body.appendChild(el('div', { class:'grid', style:'gap:14px' }, [
      el('div', { style:'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:stretch' }, [
        summaryCard('Programado original', `${formatDateBR(baselineInicio)} → ${formatDateBR(baselineFim)}`, 'Base usada no Avanço da janela.'),
        summaryCard('Prazo atual', `${formatDateBR(inicioAtual)} → ${formatDateBR(prazoAtual)}`, currentOverOriginal ? `${currentOverOriginal} dia(s) além do programado.` : 'Ainda dentro do prazo original.', currentOverOriginal ? 'danger' : '')
      ]),
      el('div', { style:'border:1px solid var(--danger-border);border-radius:14px;padding:12px;background:var(--danger-soft);display:grid;gap:4px' }, [
        el('div', { class:'tiny muted', style:'font-weight:900' }, ['Impacto calculado ao vivo']),
        impactOriginal,
        impactCurrent,
        impactHint
      ]),
      el('div', { style:'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start' }, [
        el('div', { class:'field', style:'min-width:0' }, [el('label', {}, ['Data de início (não altera)']), novaIni, el('div', { class:'hint tiny' }, ['A reprogramação mantém o início original.'])]),
        el('div', { class:'field', style:'min-width:0' }, [el('label', {}, ['Novo prazo final']), novaFim]),
      ]),
      el('div', { class:'field', style:'margin-top:-6px' }, [dateErr]),
      el('div', { class:'field' }, [el('label', {}, ['Justificativa (obrigatória)']), just, justErr]),
      footer
    ]));

    openDialog(dlg);
  };

  // ----------------------
  // Editar Recurso (modal flutuante)
  // ----------------------
  const openResourceEditModal = (resource) => {
    const dlg = qs('#resourceEditModal');
    if (!dlg || !resource) return;

    qs('#resourceEditModalTitle').textContent = `Editar recurso - ${resource.nome || '-'}`;
    qs('#resourceEditModalSub').textContent = 'Atualize os campos e salve.';

    const body = qs('#resourceEditModalBody');
    body.innerHTML = '';

    const nome = el('input', { value: resource.nome || '', placeholder:'Ex: Arthur', maxlength:String(INPUT_LIMITS.resourceName) });

    const tipo = el('select', {}, [
      el('option', { value:'Interno' }, ['Interno']),
      el('option', { value:'Terceiro' }, ['Terceiro']),
    ]);
    tipo.value = (resource.tipo === 'Terceiro') ? 'Terceiro' : 'Interno';

    // Regra fixa do app: mostramos só como informativo
    const horasInfo = el('input', { value: resourceHoursLabel(resource), disabled:'', title:'Interno: 9h/dia (sexta 8h) | Terceiro: 8h/dia' });

    const ativo = el('select', {}, [
      el('option', { value:'true' }, ['Ativo']),
      el('option', { value:'false' }, ['Inativo']),
    ]);
    ativo.value = (resource.ativo === false) ? 'false' : 'true';

    const vigIni = el('input', { type:'date', value: (resource.vigencia_inicio || ''), min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const vigFim = el('input', { type:'date', value: (resource.vigencia_fim || ''), min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });

    const vigRow = el('div', { class:'row' }, [
      el('div', { class:'field' }, [el('label', {}, ['Vigência início']), vigIni]),
      el('div', { class:'field' }, [el('label', {}, ['Vigência fim']), vigFim]),
    ]);

    const vigHint = el('div', { class:'warn', style:'margin-top:10px;display:none' }, [
      'Dica: Para Terceiro, fora da vigência o recurso aparece como OFF e não conta capacidade.'
    ]);

    const syncVig = () => {
      const isThird = (String(tipo.value).trim() === 'Terceiro');
      vigRow.style.display = isThird ? '' : 'none';
      vigHint.style.display = isThird ? '' : 'none';
      horasInfo.value = String(isThird ? HOURS_PER_DAY_THIRD : HOURS_PER_DAY);
      if (!isThird) {
        vigIni.value = '';
        vigFim.value = '';
      }
    };
    tipo.addEventListener('change', syncVig);
    syncVig();

    const before = {
      nome: resource.nome,
      tipo: resource.tipo,
      ativo: (resource.ativo === false ? false : true),
      vigencia_inicio: resource.vigencia_inicio,
      vigencia_fim: resource.vigencia_fim,
    };

    const save = () => {
      const tipoVal = (String(tipo.value).trim() === 'Terceiro') ? 'Terceiro' : 'Interno';
      const nomeVal = (nome.value || '').trim();
      const vigIniVal = tipoVal === 'Terceiro' ? (vigIni.value || '') : '';
      const vigFimVal = tipoVal === 'Terceiro' ? (vigFim.value || '') : '';
      const validation = validateResourcePayload({ nome:nomeVal, tipo:tipoVal, vigencia_inicio:vigIniVal, vigencia_fim:vigFimVal });
      if (validation) { toast(validation); return; }
      const next = {
        ...resource,
        nome: nomeVal,
        tipo: tipoVal,
        horas_dia: (tipoVal === 'Terceiro' ? HOURS_PER_DAY_THIRD : HOURS_PER_DAY),
        ativo: (ativo.value === 'true'),
        vigencia_inicio: (tipoVal === 'Terceiro' ? (vigIniVal || undefined) : undefined),
        vigencia_fim: (tipoVal === 'Terceiro' ? (vigFimVal || undefined) : undefined),
        last_edit_by: userName,
        last_edit_at: Date.now(),
      };

      const after = {
        nome: next.nome,
        tipo: next.tipo,
        ativo: (next.ativo === false ? false : true),
        vigencia_inicio: next.vigencia_inicio,
        vigencia_fim: next.vigencia_fim,
      };

      state.events = [...state.events, {
        id: generateId(),
        type: 'EDIT_RESOURCE',
        payload: { resource_id: resource.id, before, after },
        timestamp: Date.now(),
        user: userName
      }];

      dispatch('UPDATE_RESOURCE', next);
      try { dlg.close(); } catch { dlg.removeAttribute('open'); }
      syncModalBlur();
      toast('Recurso atualizado.');
    };

    const footer = el('div', { class:'row', style:'justify-content:flex-end;gap:10px;margin-top:10px' }, [
      button('Cancelar', '', () => { try { dlg.close(); } catch { dlg.removeAttribute('open'); } syncModalBlur(); }),
      button('Salvar alterações', 'primary', save),
    ]);

    body.appendChild(el('div', { class:'grid' }, [
      el('div', { class:'row' }, [
        el('div', { class:'field', style:'flex:2' }, [el('label', {}, ['Nome']), nome]),
        el('div', { class:'field', style:'flex:1;min-width:200px' }, [el('label', {}, ['Tipo']), tipo]),
      ]),
      el('div', { class:'row' }, [
        // Horas/dia e um campo compacto (regra fixa 9h/dia)
        el('div', { class:'field compact', style:'max-width:140px' }, [el('label', {}, ['Horas/dia']), horasInfo]),
        el('div', { class:'field', style:'flex:1;min-width:200px' }, [el('label', {}, ['Status']), ativo]),
      ]),
      vigRow,
      vigHint,
      footer
    ]));

    openDialog(dlg);
  };
  // ----------------------
  // UI building blocks
  // ----------------------
  const el = (tag, attrs={}, children=[]) => {
    const node = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs||{})) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === false || v === undefined || v === null) continue;
      else node.setAttribute(k, String(v));
    }
    for (const ch of (Array.isArray(children) ? children : [children])) {
      if (ch === null || ch === undefined) continue;
      node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
    }
    return node;
  };

  const NOTIFICATION_ACK_KEY = 'orizon_notifications_ack_v1';

  const notificationUserKey = () => String(userId || userName || 'sem-usuario');

  const loadNotificationAckMap = () => {
    try {
      const obj = JSON.parse(localStorage.getItem(NOTIFICATION_ACK_KEY) || '{}');
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    } catch { return {}; }
  };

  const saveNotificationAckMap = (ackMap) => {
    try { localStorage.setItem(NOTIFICATION_ACK_KEY, JSON.stringify(ackMap || {})); } catch {}
  };

  const notificationAckSet = () => {
    const map = loadNotificationAckMap();
    return new Set(Array.isArray(map[notificationUserKey()]) ? map[notificationUserKey()].map(String) : []);
  };

  const saveNotificationAckSet = (set) => {
    const map = loadNotificationAckMap();
    map[notificationUserKey()] = [...(set || new Set())].slice(-500);
    saveNotificationAckMap(map);
  };

  const personMatchKey = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

  const demandCreatorId = (demand={}) => String(
    demand.createdById || demand.created_by_id || demand.user_id || demand.userId || ''
  ).trim() || ownerFromLegacyResourceId(demand.id || '');

  const demandCreatorName = (demand={}) => String(
    demand.createdBy || demand.created_by || demand.user || demand.usuario || ''
  ).trim();

  const demandAssignedResourceIds = (demand={}) => {
    const ids = new Set();
    for (const a of demandAllocations(demand)) {
      const rid = String(a?.resourceId || a?.responsavel_id || a?.resource_id || '').trim();
      if (rid) ids.add(rid);
    }
    const hasExplicitAllocations = Array.isArray(demand.allocations) && demand.allocations.length > 0;
    const direct = String(demand.responsavel_id || demand.resourceId || demand.resource_id || '').trim();
    if (!hasExplicitAllocations && direct) ids.add(direct);
    return [...ids];
  };

  const activeUserResourceIds = () => {
    if (!hasUser()) return [];
    const ids = new Set();
    const currentUserId = String(userId || '').trim();
    const currentNameKey = personMatchKey(userName);
    for (const r of (state.resources || [])) {
      const rid = String(r?.id || '').trim();
      if (!rid) continue;
      const ownerId = String(r?.owner_user_id || r?.ownerUserId || '').trim();
      const resourceNameKey = personMatchKey(r?.nome || r?.name || '');
      if ((currentUserId && ownerId === currentUserId) || (currentNameKey && resourceNameKey === currentNameKey)) ids.add(rid);
    }
    return [...ids];
  };

  const buildAssignedActivityNotifications = () => {
    if (!hasUser()) return [];
    const ownResourceIds = new Set(activeUserResourceIds().map(String));
    if (!ownResourceIds.size) return [];
    const acknowledged = notificationAckSet();
    const currentUserId = String(userId || '').trim();
    const currentNameKey = personMatchKey(userName);
    return (state.demands || [])
      .filter(d => d && String(d.id || '').trim())
      .filter(d => !['Concluída','Cancelada'].includes(effectiveStatus(d)))
      .map(d => {
        const assignedIds = demandAssignedResourceIds(d).filter(rid => ownResourceIds.has(String(rid)));
        if (!assignedIds.length) return null;
        const creatorId = demandCreatorId(d);
        const creatorName = demandCreatorName(d);
        const creatorNameKey = personMatchKey(creatorName);
        const createdByCurrentUser = (currentUserId && creatorId === currentUserId) || (currentNameKey && creatorNameKey && creatorNameKey === currentNameKey);
        if (createdByCurrentUser) return null;
        const key = `assigned-demand::${d.id}`;
        if (acknowledged.has(key)) return null;
        return {
          key,
          demand: d,
          assignedIds,
          title: String(d.titulo || 'Atividade sem título'),
          creator: creatorName || creatorId || 'outro usuário',
          createdAt: d.createdAt || d.updatedAt || '',
        };
      })
      .filter(Boolean)
      .sort((a,b) => demandCreatedMs(b.demand) - demandCreatedMs(a.demand));
  };

  const acknowledgeNotifications = (keys=[]) => {
    const ack = notificationAckSet();
    for (const key of keys) if (key) ack.add(String(key));
    saveNotificationAckSet(ack);
    updateNotificationsBell();
  };

  const openNotificationDemand = (notification) => {
    if (!notification) return;
    acknowledgeNotifications([notification.key]);
    activeTab = 'demands';
    uiFilters.demandStatus = '';
    uiFilters.demandDateStart = '';
    uiFilters.demandDateEnd = '';
    uiFilters.demandResourceId = notification.assignedIds?.[0] || '';
    setDemandTitleFilter('demands', notification.title || '');
    uiPagination.demandsPage = 1;
    const wrap = qs('#notifyWrap');
    const bell = qs('#notifyBell');
    if (wrap) wrap.classList.remove('open');
    if (bell) bell.setAttribute('aria-expanded', 'false');
    render();
  };

  const updateNotificationsBell = () => {
    const wrap = qs('#notifyWrap');
    const bell = qs('#notifyBell');
    const badge = qs('#notifyBadge');
    const panel = qs('#notifyPanel');
    if (!wrap || !bell || !badge || !panel) return;
    const notifications = buildAssignedActivityNotifications();
    const count = notifications.length;
    bell.classList.toggle('active', count > 0);
    bell.classList.toggle('open', wrap.classList.contains('open'));
    badge.textContent = count > 99 ? '99+' : String(count);
    bell.title = count ? `${count} atividade(s) nova(s) atribuída(s) a você` : 'Nenhuma nova atividade atribuída';
    panel.innerHTML = '';
    panel.appendChild(el('div', { class:'notifyHead' }, [
      el('div', {}, [
        el('strong', {}, ['Notificações']),
        el('span', {}, [count ? `${count} atividade(s) atribuída(s) por outro usuário` : 'Sem novas atividades atribuídas'])
      ]),
      count ? el('button', { class:'notifyClear', type:'button', onclick:(e) => { e.stopPropagation(); acknowledgeNotifications(notifications.map(n => n.key)); toast('Notificações marcadas como lidas.'); } }, ['Marcar lidas']) : null
    ].filter(Boolean)));
    if (!count) {
      panel.appendChild(el('div', { class:'notifyEmpty' }, [hasUser() ? 'Quando alguém atribuir uma demanda ao seu recurso, ela aparecerá aqui.' : 'Defina seu usuário para ver notificações.']));
      return;
    }
    for (const n of notifications.slice(0, 12)) {
      panel.appendChild(el('button', { class:'notifyItem', type:'button', onclick:() => openNotificationDemand(n) }, [
        el('div', { class:'top' }, [el('span', { class:'dot' }, []), n.title]),
        el('div', { class:'sub' }, [`Cadastrada por ${n.creator}${n.createdAt ? ' em ' + formatDateBR(normalizeDateLikeToISO(n.createdAt) || n.createdAt) : ''}. Clique para abrir em Demandas.`])
      ]));
    }
    if (notifications.length > 12) panel.appendChild(el('div', { class:'notifyEmpty' }, [`+${notifications.length - 12} notificação(ões) adicional(is).`]));
  };

  const wireNotificationsBell = () => {
    const wrap = qs('#notifyWrap');
    const bell = qs('#notifyBell');
    if (!wrap || !bell || bell.__bound) return;
    bell.__bound = true;
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !wrap.classList.contains('open');
      wrap.classList.toggle('open', open);
      bell.setAttribute('aria-expanded', open ? 'true' : 'false');
      updateNotificationsBell();
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        wrap.classList.remove('open');
        bell.setAttribute('aria-expanded', 'false');
        updateNotificationsBell();
      }
    });
  };

  const card = (title, rightNode, bodyNode) => {
    return el('div', { class:'card' }, [
      el('div', { class:'hd' }, [
        el('h2', {}, [title]),
        rightNode || el('div')
      ]),
      el('div', { class:'bd' }, [bodyNode])
    ]);
  };

  const badgeLegend = () => {
    const root = el('div', { class:'legendDropdown' });
    const btn = el('button', { class:'legendBtn', type:'button', title:'Abrir menu de legendas' }, [
      '☰ Legendas',
      el('span', { class:'chev' }, ['▾'])
    ]);

    const item = (dotCls, label, desc='') => el('div', { class:'legendItem' }, [
      el('span', { class:`legendDot ${dotCls}` }, []),
      el('span', {}, [label, desc ? el('small', {}, [desc]) : null])
    ]);

    const group = (title, items) => el('div', { class:'legendGroup' }, [
      el('div', { class:'legendGroupTitle' }, [title]),
      ...items
    ]);

    const menu = el('div', { class:'legendMenu', role:'menu' }, [
      group('Capacidade', [
        item('ok', '<= 80%', 'Alocacao confortavel'),
        item('mid', '81-100%', 'Proximo do limite'),
        item('over', '> 100%', 'Capacidade excedida'),
      ]),
      group('Bloqueios', [
        item('block', 'Bloqueio', 'Dia sem capacidade'),
        item('vac', 'Férias', 'Recurso indisponível'),
        item('off', 'Fora vigência', 'Terceiro fora do período'),
      ]),
      group('Eventos especiais', [
        item('holiday', 'Feriado', 'Capacidade zerada'),
        item('he', 'HE', 'Hora extra registrada'),
      ]),
    ]);

    const close = () => { root.classList.remove('open'); btn.setAttribute('aria-expanded','false'); };
    const open = () => { root.classList.add('open'); btn.setAttribute('aria-expanded','true'); };

    btn.setAttribute('aria-haspopup','true');
    btn.setAttribute('aria-expanded','false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (root.classList.contains('open')) close(); else open();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
      if (!root.isConnected) return;
      if (!root.contains(e.target)) close();
    });

    root.appendChild(btn);
    root.appendChild(menu);
    return root;
  };

  const pill = (label, cls) => el('span', { class:'pill' }, [
    el('span', { class:'dot '+cls }, []),
    label
  ]);

  const statusPill = (statusOrDemand) => {
    // Aceita string (status) OU um objeto demanda (para tooltip/?cone)
    const isObj = statusOrDemand && typeof statusOrDemand === 'object';
    const s = isObj ? effectiveStatus(statusOrDemand) : normalizeStatus(statusOrDemand);
    const key = (s === 'Em andamento') ? 'andamento' : (s === 'Atrasada') ? 'atrasada' : (s === 'Concluída') ? 'concluida' : (s === 'Cancelada') ? 'cancelada' : (s === 'Mapeada') ? 'mapeada' : (s === 'Congelada') ? 'congelada' : 'planejada';
    const title = isObj ? (overdueTooltip(statusOrDemand) || '') : '';
    const children = [
      el('span', { class:'sDot' }, []),
    ];
    if (s === 'Atrasada') {
      children.push(el('span', { class:'statusIcon', title: title || 'Atrasada (automático)' }, ['']));
    }
    children.push(s || 'Mapeada');
    return el('span', { class:`statusPill s-${key}`, title: title || undefined }, children);
  };

  const button = (label, cls, onClick, attrs={}) => el('button', { class:'btn '+(cls||''), type:'button', onclick:onClick, ...(attrs || {}) }, [label]);
  const barNode = (pct, title='', tone='') => {
    const width = Math.min(100, Math.max(0, Number(pct || 0))).toFixed(0);
    return el('div', { class:`bar${tone ? ' ' + tone : ''}`, title }, [
      el('span', { style:`width:${width}%` })
    ]);
  };
  const iconButton = (label, icon, cls, onClick) => el('button', {
    class:'btn iconBtn '+(cls||''),
    type:'button',
    title:label,
    'aria-label':label,
    onclick:onClick
  }, [icon]);
  const actionMenuButton = (items=[]) => {
    const root = el('div', { class:'actionsMenu' });
    let panel = null;
    const close = () => {
      root.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      if (panel) {
        panel.remove();
        panel = null;
      }
    };
    const positionPanel = () => {
      if (!panel) return;
      const rect = btn.getBoundingClientRect();
      const margin = 10;
      const width = Math.min(300, Math.max(220, window.innerWidth - (margin * 2)));
      panel.style.width = `${width}px`;
      const panelHeight = Math.min(panel.scrollHeight || 0, window.innerHeight - (margin * 2));
      const opensUp = rect.bottom + 8 + panelHeight > window.innerHeight && rect.top > panelHeight;
      const top = opensUp ? Math.max(margin, rect.top - panelHeight - 8) : Math.min(window.innerHeight - panelHeight - margin, rect.bottom + 8);
      const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.right - width));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.classList.toggle('opensUp', opensUp);
    };
    const open = () => {
      qsa('.floatingActionMenu').forEach(menu => menu.remove());
      qsa('.actionsMenu.open').forEach(menu => { if (menu !== root) menu.classList.remove('open'); });
      panel = el('div', { class:'floatingActionMenu', role:'menu' }, items.map(item => el('button', {
        class:`menuAction ${item.cls || ''}`,
        type:'button',
        role:'menuitem',
        onclick:(ev) => {
          ev.stopPropagation();
          close();
          item.onClick?.(ev);
        }
      }, [el('span', { class:'ico' }, [item.icon || '•']), el('span', {}, [item.label || 'Ação'])])));
      document.body.appendChild(panel);
      root.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      positionPanel();
      setTimeout(() => {
        const outside = (ev) => { if (!root.contains(ev.target) && !panel?.contains(ev.target)) close(); };
        document.addEventListener('click', outside, { once:true });
      }, 0);
    };
    const btn = iconButton('Ações', '☰', '', (ev) => {
      ev.stopPropagation();
      if (panel) close();
      else open();
    });
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    root.appendChild(btn);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return root;
  };

  const sortTimestampValue = (item) => {
    if (!item || typeof item !== 'object') return 0;
    const candidates = [item.createdAt, item.timestamp, item.updatedAt, item.last_edit_at];
    for (const v of candidates) {
      if (v === undefined || v === null || v === '') continue;
      const n = (typeof v === 'number') ? v : Date.parse(String(v));
      if (Number.isFinite(n)) return n;
    }
    return 0;
  };

  const newestFirst = (items) => (Array.isArray(items) ? [...items] : [])
    .sort((a,b) => {
      const diff = sortTimestampValue(b) - sortTimestampValue(a);
      if (diff !== 0) return diff;
      return String(b?.id || '').localeCompare(String(a?.id || ''));
    });

  const buildPager = ({ page, totalPages, total, startIdx, shown, onPrev, onNext, onFirst, onLast } = {}) => {
    const infoTxt = (total===0) ? 'Nenhum item' : `Mostrando ${startIdx+1}-${startIdx+shown} de ${total}`;
    const info = el('div', { class:'info' }, [`${infoTxt} - Página ${page} de ${totalPages}`]);

    const firstBtn = button('« Início', '', onFirst || onPrev);
    firstBtn.disabled = page <= 1;
    const prevBtn = button('‹ Anterior', '', onPrev);
    prevBtn.disabled = page <= 1;
    const nextBtn = button('Próxima ›', '', onNext);
    nextBtn.disabled = page >= totalPages;
    const lastBtn = button('Final »', '', onLast || onNext);
    lastBtn.disabled = page >= totalPages;

    return el('div', { class:'pager' }, [
      info,
      el('div', { class:'controls' }, [firstBtn, prevBtn, nextBtn, lastBtn])
    ]);
  };


  const input = (label, attrs) => el('div', { class:'field' }, [
    el('label', {}, [label]),
    el('input', attrs)
  ]);

  const select = (label, attrs, options) => el('div', { class:'field' }, [
    el('label', {}, [label]),
    (() => {
      const s = el('select', attrs);
      for (const opt of options) {
        s.appendChild(el('option', { value: opt.value }, [opt.label]));
      }
      return s;
    })()
  ]);

  const textarea = (label, attrs) => el('div', { class:'field' }, [
    el('label', {}, [label]),
    el('textarea', attrs)
  ]);

  // ----------------------
  // Views
  // ----------------------
  let viewDate = new Date();


  /* === Capacidade VSC helpers (global) === */
/* === Capacidade VSC helpers (global) === */
function buildConsolidatedMonthTotals(year, m0) {
  const y = Number(year);
  const m = Number(m0);
  const cacheKey = `${dashboardCapacityCacheVersion}|${y}|${m}`;
  const cached = dashboardCapacityMonthCache.get(cacheKey);
  if (cached) return { ...cached };

  const resources = (state.resources || []);
  let cap = 0;
  let alloc = 0;
  let free = 0;
  let overResources = 0;

  // Self-contained month aggregation (does NOT depend on view-scoped helpers like monthlyWindow/freeHoursInfo)
  const days = getDaysInMonth(year, m0);

  for (const r of resources) {
    let mCap = 0, mAlloc = 0, mFree = 0;

    for (const d of days) {
      const dateStr = formatDate(d);

      // HE for this resource OR __ALL__ is included by overtimeInfo()
      const ot = (typeof overtimeInfo === 'function') ? overtimeInfo(r.id, dateStr) : { total: 0, items: [] };
      const otHours = Math.max(0, Number(ot.total || 0));

      // Weekends do NOT count unless there is HE (rule of the app)
      const weekend = isWeekend(d);
      if (weekend && otHours <= 0) continue;

      // Base capacity:
      // - Weekday: 9h
      // - Weekend: 0h (+ HE only)
      // - Holiday / Blocking / OFF: 0h (+ HE only)
      const resObj = (state.resources || []).find(x => x.id === r.id);
      let base = weekend ? 0 : getResourceHoursForDate(resObj, d);

      if (isHoliday(dateStr)) base = 0;
      const blk = blockingFor(r.id, dateStr);
      if (blk) base = 0;

      if (typeof isThirdPartyOff === 'function' && isThirdPartyOff(resObj, dateStr)) base = 0;

      const dayCap = Math.max(0, Number(base || 0)) + otHours;

      // Allocated continues based on 9h rule and only for normal days
      // For Holiday/Blocking/OFF we keep allocated/free as 0 (same behavior used in Janelas Livres),
      // but capacity still counts if HE exists.
      let dayAlloc = 0;
      let dayFree = 0;

      if (!isHoliday(dateStr) && !blk && !(typeof isThirdPartyOff === 'function' && isThirdPartyOff(resObj, dateStr))) {
        const info = CapacityEngine.freeHoursInfo(r.id, d);
        dayAlloc = Math.max(0, Number(info.allocatedFromDemandsHH || info.allocated || 0));
        dayFree = Number(info.free || 0);
      }

      mCap += dayCap;
      mAlloc += dayAlloc;
      mFree += dayFree;
    }

    cap += mCap;
    alloc += mAlloc;
    free += mFree;
    if (mAlloc > mCap) overResources += 1;
  }

  const usagePct = cap > 0 ? (alloc / cap) * 100 : 0;
  const overHH = Math.max(0, alloc - cap);
  const result = { cap, alloc, free, usagePct, overHH, overResources, totalResources: resources.length };
  dashboardCapacityMonthCache.set(cacheKey, result);
  return { ...result };
}
function buildConsolidatedYearSeries(year) {
    const y = Number(year);
    const cacheKey = `${dashboardCapacityCacheVersion}|${y}`;
    const cached = dashboardCapacityYearCache.get(cacheKey);
    if (cached) return cached.map(p => ({ ...p }));
    const labels = Array.from({ length: 12 }, (_, m0) =>
      new Date(year, m0, 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')
    );
    const points = [];
    for (let m0 = 0; m0 < 12; m0++) {
      const t = buildConsolidatedMonthTotals(year, m0);
      points.push({ m0, label: labels[m0], ...t });
    }
    dashboardCapacityYearCache.set(cacheKey, points);
    return points.map(p => ({ ...p }));
  }
  function serializeSvg(svgEl) {
    const clone = svgEl.cloneNode(true);
    // garantir xmlns
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    return `<?xml version="1.0" encoding="UTF-8"?>\n` + xml;
  }
  function exportSvg(svgEl, fileName) {
    const xml = serializeSvg(svgEl);
    downloadFile(xml, fileName, 'image/svg+xml;charset=utf-8');
  }
  async function exportPngFromSvg(svgEl, fileName) {
    const xml = serializeSvg(svgEl);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const vb = (svgEl.getAttribute('viewBox') || '0 0 1200 520').split(/\s+/).map(Number);
    const w = Math.max(1, Math.round(vb[2] || 1200));
    const h = Math.max(1, Math.round(vb[3] || 520));

    const img = new Image();
    img.decoding = 'async';

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // fundo branco (corporativo)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    URL.revokeObjectURL(url);

    await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) return resolve();
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(pngUrl);
        resolve();
      }, 'image/png');
    });
  }
  function buildCapacityVsPlannedSvg({ title, series }) {
    const W = 1200;
    const H = 440;
    const pad = { l: 70, r: 36, t: 34, b: 110 };
    const cw = W - pad.l - pad.r;
    const ch = H - pad.t - pad.b;

    const visualMaxPct = 150;
    const maxPct = visualMaxPct;
    const yPct = (pct) => {
      const v = Math.min(maxPct, Math.max(0, Number(pct || 0)));
      return pad.t + (ch - (v / maxPct) * ch);
    };

    const xStep = cw / series.length;
    const barW = Math.min(54, Math.max(34, xStep * 0.54));
    const currentM0 = (new Date()).getMonth();

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('style','max-width:100%;height:auto;display:block;');
    svg.setAttribute('role', 'img');

    const rect = (x, y, w, h, fill, rx=4) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', w);
      r.setAttribute('height', Math.max(0, h));
      r.setAttribute('rx', rx);
      r.setAttribute('fill', fill);
      return r;
    };

    const line = (x1, y1, x2, y2, stroke, w=2, dash=null) => {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', stroke);
      l.setAttribute('stroke-width', w);
      if (dash) l.setAttribute('stroke-dasharray', dash);
      return l;
    };

    const text = (x, y, s, fill='var(--text)', size=12, weight=600, anchor='middle') => {
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      t.setAttribute('fill', fill);
      t.setAttribute('font-size', size);
      t.setAttribute('font-weight', weight);
      t.setAttribute('text-anchor', anchor);
      t.setAttribute('font-family', 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial');
      t.textContent = s;
      return t;
  }
    const pctColor = (pct) => {
      const v = Number(pct || 0);
      if (v > 100) return 'var(--danger)';
      if (v >= 86) return 'var(--warning)';
      if (v > 0) return 'var(--success)';
      return 'var(--border)';
    };
    const pctBg = (pct) => {
      const v = Number(pct || 0);
      if (v > 100) return 'var(--danger-soft)';
      if (v >= 86) return 'var(--warning-soft)';
      if (v > 0) return 'var(--success-soft)';
      return 'var(--surface)';
    };

    // background
    svg.appendChild(rect(0, 0, W, H, '#ffffff', 0));

    const y100 = yPct(100);
    const overloadBand = rect(pad.l, pad.t, cw, y100 - pad.t, 'var(--danger-soft)', 0);
    overloadBand.setAttribute('opacity', '.42');
    svg.appendChild(overloadBand);
    svg.appendChild(rect(pad.l, y100, cw, pad.t + ch - y100, '#ffffff', 0));
    svg.appendChild(text(pad.l, 20, title || 'Ocupação Consolidada - Ano', 'var(--text)', 16, 950, 'start'));
    svg.appendChild(text(W-pad.r, 20, 'escala visual 0-150%', 'var(--muted)', 11, 800, 'end'));

    // grid (%)
    const gridValues = [0,30,60,90,120,150];
    for (const v of gridValues){
      const y = yPct(v);
      svg.appendChild(line(pad.l, y, W-pad.r, y, 'var(--border)', 1));
      svg.appendChild(text(pad.l-10, y+4, `${Math.round(v)}%`, 'var(--muted)', 11, 750, 'end'));
    }

    // 100% reference line
    svg.appendChild(line(pad.l, y100, W-pad.r, y100, 'var(--danger)', 2, '6 6'));
    svg.appendChild(text(W-pad.r-4, y100-8, 'limite 100%', 'var(--danger)', 12, 900, 'end'));

    series.forEach((p, i) => {
      const cx = pad.l + xStep*i + xStep/2;
      const pct = Number(p.usagePct || 0);
      const isClipped = pct > visualMaxPct;
      const shownPct = Math.min(visualMaxPct, Math.max(0, pct));
      const h = (shownPct / maxPct) * ch;
      const x = cx - barW/2;
      const y = pad.t + (ch - h);
      const fill = pctColor(pct);

      const bg = rect(x, pad.t, barW, ch, pctBg(pct), 12);
      bg.setAttribute('opacity', '0.72');
      svg.appendChild(bg);

      const bar = rect(x, y, barW, h, fill, 12);
      bar.setAttribute('data-month', p.label);
      const tip = document.createElementNS(ns, 'title');
      tip.textContent = `${p.label}: ${Math.round(pct)}% de ocupação | Planejado ${fmtHours(p.alloc||0)}h | Capacidade ${fmtHours(p.cap||0)}h | Livre ${fmtHours(p.free||0)}h | Overcap ${fmtHours(p.overHH||0)}h`;
      bar.appendChild(tip);
      svg.appendChild(bar);

      if (p.m0 === currentM0) {
        svg.appendChild(rect(x-5, pad.t-5, barW+10, ch+10, 'none', 14));
        svg.lastChild.setAttribute('stroke', 'var(--primary)');
        svg.lastChild.setAttribute('stroke-width', '2');
        svg.lastChild.setAttribute('stroke-dasharray', '5 5');
      }

      svg.appendChild(text(cx, pad.t + ch + 26, p.label, 'var(--text)', 12, 800, 'middle'));

      const pctLabel = `${Math.round(pct)}%`;
      const labelY = pct > 100 ? Math.max(pad.t + 18, y + 20) : Math.max(pad.t + 18, y - 8);
      svg.appendChild(text(cx, labelY, pctLabel, pct > 100 ? '#ffffff' : 'var(--text)', 13, 950, 'middle'));

      const hhLabel = `${fmtHours(p.alloc || 0)}/${fmtHours(p.cap || 0)}`;
      svg.appendChild(text(cx, pad.t + ch + 48, hhLabel, 'var(--muted)', 10, 750, 'middle'));

      if ((p.overHH || 0) > 0) {
        const overBadge = rect(cx - 30, pad.t + ch + 56, 60, 18, 'var(--danger-soft)', 6);
        overBadge.setAttribute('stroke', 'var(--danger-border)');
        svg.appendChild(overBadge);
        svg.appendChild(text(cx, pad.t + ch + 69, `+${fmtHours(p.overHH)}h`, 'var(--danger)', 10, 900, 'middle'));
      }

      if (isClipped) {
        svg.appendChild(line(x + 8, pad.t + 10, x + barW - 8, pad.t + 10, 'var(--danger)', 3));
        svg.appendChild(line(x + 8, pad.t + 18, x + barW - 8, pad.t + 18, 'var(--danger)', 3));
      }
    });

    // legend
    const lx = pad.l;
    const ly = H - 18;
    svg.appendChild(rect(lx, ly-10, 14, 10, 'var(--success)', 2));
    svg.appendChild(text(lx+20, ly-1, 'Saudável', 'var(--text)', 12, 800, 'start'));
    svg.appendChild(rect(lx+130, ly-10, 14, 10, 'var(--warning)', 2));
    svg.appendChild(text(lx+150, ly-1, 'Atenção', 'var(--text)', 12, 800, 'start'));
    svg.appendChild(rect(lx+250, ly-10, 14, 10, 'var(--danger)', 2));
    svg.appendChild(text(lx+270, ly-1, 'Acima da capacidade', 'var(--text)', 12, 800, 'start'));
    svg.appendChild(text(W-pad.r, ly-1, 'rótulo inferior: planejado/capacidade (Horas)', 'var(--muted)', 11, 750, 'end'));

    return svg;
  }

  const viewDashboard = () => {
    const dashboardFilteredDemands = filterDemands({
      status: uiFilters.demandStatus,
      resourceId: uiFilters.demandResourceId,
      dateStart: uiFilters.demandDateStart,
      dateEnd: uiFilters.demandDateEnd,
      titleQuery: getDemandTitleFilter('dashboard')
    });

    const { totalResources, activeResources, totalDemands, openDemands } = kpis(dashboardFilteredDemands);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const days = getDaysInMonth(year, month);

    const right = el('div', { class:'row' }, [
      button('◀', 'ghost', () => { viewDate = new Date(year, month-1, 1); render(); }),
      el('div', { class:'tag' }, [viewDate.toLocaleString('pt-BR', { month:'long', year:'numeric' })]),
      button('▶', 'ghost', () => { viewDate = new Date(year, month+1, 1); render(); }),
    ]);

    const sheetTotal = state.resources.length;
    const sheetTotalPages = Math.max(1, Math.ceil(sheetTotal / DASH_SHEET_PAGE_SIZE));
    uiPagination.dashboardSheetPage = Math.min(Math.max(1, uiPagination.dashboardSheetPage), sheetTotalPages);
    const sheetStartIdx = (uiPagination.dashboardSheetPage - 1) * DASH_SHEET_PAGE_SIZE;
    const sheetResources = state.resources.slice(sheetStartIdx, sheetStartIdx + DASH_SHEET_PAGE_SIZE);
    const table = el('div', { class:'scrollX' }, [
      (() => {
        const t = el('table', { class:'calTable' });
        const thead = el('thead');
        const trh = el('tr');
        trh.appendChild(el('th', { class:'stickyCol', style:'min-width:220px' }, ['Recurso / Dia']));
        for (const d of days) {
          const wd = d.toLocaleString('pt-BR', { weekday:'short' }).slice(0,3);
          const dateStr = formatDate(d);
          const holidayDay = isHoliday(dateStr);
          const headCls = ['dayHead', (!holidayDay && isWeekend(d)) ? 'bg-wknd' : '', holidayDay ? 'bg-holiday' : ''].filter(Boolean).join(' ');
          trh.appendChild(el('th', { class:headCls, title: formatDateBR(d) }, [
            el('div', { class:'mono', style:'font-weight:900' }, [String(d.getDate())]),
            el('div', { class:'tiny' }, [holidayDay ? 'FER' : wd])
          ]));
        }
        thead.appendChild(trh);
        t.appendChild(thead);

        const tbody = el('tbody');
        if (state.resources.length === 0) {
          const tr = el('tr');
          tr.appendChild(el('td', { colspan: String(days.length+1), style:'padding:34px;text-align:center;color:var(--muted)' }, ['Nenhum recurso cadastrado. Vá em "Recursos" para começar.']));
          tbody.appendChild(tr);
        } else {
          for (const r of sheetResources) {
            const tr = el('tr', { id: `winres-${r.id}` });
            tr.appendChild(el('td', { class:'stickyCol' }, [
              el('div', { style:'font-weight:950' }, [r.nome]),
              el('div', { class:'tiny' }, [`${r.tipo} - ${resourceHoursLabel(r)}`])
            ]));
            for (const d of days) {
              const dateStr = formatDate(d);
              const heTotal = overtimeInfo(r.id, dateStr).total;
              const freeInfo = CapacityEngine.freeHoursInfo(r.id, d);
              const freeHours = Number(freeInfo.free || 0);
              const capacityHours = Number(freeInfo.capacity || 0);
              const allocatedHours = Number(freeInfo.allocated || 0);
              const pctAllocated = capacityHours > 0 ? Math.max(0, (allocatedHours / capacityHours) * 100) : 0;
              const nonWorkingDay = freeInfo.eligible === false;
              let cls = `cell ${freeInfo.cls || ''}`.trim();
              let top = `${Math.round(pctAllocated)}%`;
              let sub = `${freeHours.toFixed(1)}h livre`;

              if (nonWorkingDay && heTotal <= 0) {
                top = '0%';
                sub = String(freeInfo.tag || '').trim() || '-';
              }

              // Mantém destaque visual para fim de semana; só contabiliza se houver HE.
              if (!isHoliday(dateStr) && isWeekend(d)) cls += ' bg-wknd nonWork';
              if (heTotal > 0) {
                cls += ' has-he';
                // HE vira badge discreto; o tipo do dia continua legível.
              }

              tr.appendChild(el('td', { class: cls+' clickable', title: `${formatDateBR(dateStr)} - ${top} alocado - ${sub}`, onclick: () => openDayDetails(r.id, d) }, [
                el('div', { class:'top' }, [top]),
                el('div', { class:'sub' }, [sub]),
                (heTotal > 0) ? el('div', { class:'heLine mono' }, [`HE +${fmtHours(heTotal)}h`]) : null
              ].filter(Boolean)));
            }
            tbody.appendChild(tr);
          }
        }
        t.appendChild(tbody);
        return t;
      })()
    ]);

    const sheetPager = buildPager({
      page: uiPagination.dashboardSheetPage,
      totalPages: sheetTotalPages,
      total: sheetTotal,
      startIdx: sheetStartIdx,
      shown: sheetResources.length,
      onPrev: () => { uiPagination.dashboardSheetPage--; render(); },
      onNext: () => { uiPagination.dashboardSheetPage++; render(); },
      onFirst: () => { uiPagination.dashboardSheetPage = 1; render(); },
      onLast: () => { uiPagination.dashboardSheetPage = sheetTotalPages; render(); },
    });

    const tableBlock = el('div', {}, [table, sheetPager]);

    const statusCounts = (() => {
      const counts = { 'Em andamento':0, 'Atrasada':0, 'Concluída':0, 'Cancelada':0, 'Mapeada':0, 'Congelada':0 };
      for (const d of (dashboardFilteredDemands||[])) {
        const st = effectiveStatus(d);
        if (counts[st] === undefined) counts[st] = 0;
        counts[st] += 1;
      }
      return counts;
    })();

    const dashFiltersBar = (() => {
      const statusSel = el('select');
      statusSel.appendChild(el('option', { value:'' }, ['Todos os status']));
      for (const s of STATUS) statusSel.appendChild(el('option', { value:s }, [s]));
      statusSel.value = uiFilters.demandStatus || '';
      statusSel.addEventListener('change', () => { uiFilters.demandStatus = statusSel.value; uiPagination.demandsPage=1; render(); });

      const resSel = el('select');
      resSel.appendChild(el('option', { value:'' }, ['Todos os recursos']));
      resSel.appendChild(el('option', { value:'__NONE__' }, ['Sem responsável (Mapeada)']));
      for (const r of state.resources) resSel.appendChild(el('option', { value:r.id }, [r.nome]));
      resSel.value = uiFilters.demandResourceId || '';
      resSel.addEventListener('change', () => { uiFilters.demandResourceId = resSel.value; uiPagination.demandsPage=1; render(); });

      const titleSearch = el('input', { type:'search', placeholder:'Digite título ou status...' });
      bindDemandTitleSearch(titleSearch, 'dashboardDemandTitleSearch', 'dashboardSheetPage', 'dashboard', 'dashboard');

      const ds = el('input', { type:'date' });
      const de = el('input', { type:'date' });
      ds.value = uiFilters.demandDateStart || '';
      de.value = uiFilters.demandDateEnd || '';
      ds.addEventListener('change', () => { uiFilters.demandDateStart = ds.value || ''; uiPagination.demandsPage=1; render(); });
      de.addEventListener('change', () => { uiFilters.demandDateEnd = de.value || ''; uiPagination.demandsPage=1; render(); });

      const pills = buildFilterPills({ includeClear:true });

      return el('div', { class:'grid', style:'gap:10px' }, [
        el('div', { class:'row' }, [
          el('div', { class:'field' }, [el('label', {}, ['Status']), statusSel]),
          el('div', { class:'field' }, [el('label', {}, ['Recurso']), resSel]),
          el('div', { class:'field', style:'flex:1;min-width:240px' }, [el('label', {}, ['Pesquisar título/status']), titleSearch]),
          el('div', { class:'field' }, [el('label', {}, ['De']), ds]),
          el('div', { class:'field' }, [el('label', {}, ['Até']), de]),
        ]),
        pills ? pills : el('div', { style:'display:none' }, [''])
      ]);
    })();

    const donutNode = (() => {
      const order = ['Em andamento','Atrasada','Concluída','Cancelada','Mapeada','Congelada'];
      const colors = STATUS_COLORS;
      const realTotal = order.reduce((a,k)=>a+(statusCounts[k]||0),0);

      // Quando não há nenhuma demanda (ou filtros zeraram), não deixar o donut
      // parecer "Congelada" (amarelo). Usamos um estado vazio: cinza + borda tracejada.
      let donut;
      if (!realTotal) {
        donut = el('div', { class:'donut empty', style:`background:conic-gradient(var(--border) 0 100%);` });
      } else {
        const total = realTotal;
        let acc = 0;
        const stops = [];
        const activeStatuses = order.filter(k => (statusCounts[k] || 0) > 0);
        activeStatuses.forEach((k, idx) => {
          const v = (statusCounts[k]||0);
          const pct = (v/total)*100;
          const start = acc;
          acc = idx === activeStatuses.length - 1 ? 100 : acc + pct;
          stops.push(`${colors[k]} ${start.toFixed(2)}% ${acc.toFixed(2)}%`);
        });
        donut = el('div', { class:'donut', style:`background:conic-gradient(${stops.join(',')});` });
      }
      const legend = el('div', { class:'legend' }, order.map(k =>
        el('div', {
          class:'item',
          title:`Filtrar demandas: ${k}`,
          'data-donut-status': k
        }, [
          el('span', { class:'sw', style:`background:${colors[k]}` }),
          `${k}: ${statusCounts[k]||0}`
        ])
      ));
      legend.addEventListener('click', (ev) => {
        const target = ev.target?.closest ? ev.target : ev.target?.parentElement;
        const item = target?.closest?.('[data-donut-status]');
        if (!item || !legend.contains(item)) return;
        openDonutModal(item.getAttribute('data-donut-status'));
      });
      return el('div', { class:'donutWrap' }, [donut, legend]);
    })();

    const perResource = (() => {
      const perTotal = state.resources.length;
      const perTotalPages = Math.max(1, Math.ceil(perTotal / DASH_PER_RESOURCE_PAGE_SIZE));
      uiPagination.dashboardPerResourcePage = Math.min(Math.max(1, uiPagination.dashboardPerResourcePage), perTotalPages);
      const perStartIdx = (uiPagination.dashboardPerResourcePage - 1) * DASH_PER_RESOURCE_PAGE_SIZE;
      const pageResources = state.resources.slice(perStartIdx, perStartIdx + DASH_PER_RESOURCE_PAGE_SIZE);

      const t = el('table');
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Recurso']),
        el('th', {}, ['Demandas ativas (mês)']),
        el('th', {}, ['% médio alocado (mês)']),
        el('th', {}, ['Pico']),
        el('th', {}, ['Barra']),
      ])]));
      const tb = el('tbody');
      const daysInMonth = days;

      for (const r of pageResources) {
        // demandas ativas no mês (exclui Concluída e Mapeada)
        const active = (dashboardFilteredDemands||[]).filter(d => {
          if (!demandAllocations(d).some(a => String(a.resourceId || '') === String(r.id))) return false;
          const st = effectiveStatus(d);
          if (st === 'Mapeada' || st === 'Concluída' || st === 'Cancelada') return false;
          // Conta demanda ativa no mês somente se a atuação deste recurso
          // cruza o mês exibido. A janela da demanda pode ser maior que a
          // janela do responsável, então usar só data_inicio/data_fim confunde.
          const monthStart = formatDate(daysInMonth[0]);
          const monthEnd = formatDate(daysInMonth[daysInMonth.length-1]);
          return demandAllocations(d).some(a => {
            if (String(a.resourceId || '') !== String(r.id)) return false;
            const allocStart = normalizeDateLikeToISO(a.data_inicio || a.dataInicio || a.start_date || '') || normalizeDateLikeToISO(d.data_inicio || '') || '';
            const allocEnd = normalizeDateLikeToISO(a.data_fim || a.dataFim || a.end_date || '') || normalizeDateLikeToISO(d.data_fim || '') || '';
            return overlapsRange(allocStart, allocEnd, monthStart, monthEnd);
          });
        }).length;

        // % medio/pico alocado considerando apenas dias úteis disponíveis; FDS/feriado só entram com HE
        let sum = 0;
        let n = 0;
        let peak = 0;
        for (const day of daysInMonth) {
          const v = dailyPercentAllocated(r.id, day);
          if (v < 0) continue; // feriado/bloq/férias/off
          const p = Number(v||0);
          peak = Math.max(peak, p);
          sum += p;
          n += 1;
        }
        const avg = n ? (sum/n) : 0;
        const tr = el('tr');
        tr.appendChild(el('td', {}, [el('div', { style:'font-weight:950' }, [r.nome]), el('div', { class:'tiny' }, [r.tipo]) ]));
        tr.appendChild(el('td', {}, [String(active)]));
        tr.appendChild(el('td', {}, [`${avg.toFixed(0)}%`]));
        tr.appendChild(el('td', {}, [`${peak.toFixed(0)}%`]));
        tr.appendChild(el('td', {}, [
          barNode(avg, `Média ${avg.toFixed(0)}%`)
        ]));
        tb.appendChild(tr);
      }

      if (perTotal === 0) {
        tb.appendChild(el('tr', {}, [el('td', { colspan:'5', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Cadastre recursos para ver o gráfico por recurso.'])]));
      }

      t.appendChild(tb);

      const pager = buildPager({
        page: uiPagination.dashboardPerResourcePage,
        totalPages: perTotalPages,
        total: perTotal,
        startIdx: perStartIdx,
        shown: pageResources.length,
        onPrev: () => { uiPagination.dashboardPerResourcePage--; render(); },
        onNext: () => { uiPagination.dashboardPerResourcePage++; render(); },
        onFirst: () => { uiPagination.dashboardPerResourcePage = 1; render(); },
        onLast: () => { uiPagination.dashboardPerResourcePage = perTotalPages; render(); },
      });

      return el('div', {}, [
        el('div', { class:'scrollX' }, [t]),
        pager
      ]);
    })();


    const operationalDashboard = (() => {
      const monthStart = formatDate(new Date(year, month, 1));
      const monthEnd = formatDate(new Date(year, month + 1, 0));
      const periodStart = uiFilters.demandDateStart || monthStart;
      const periodEnd = uiFilters.demandDateEnd || monthEnd;
      const model = buildOperationalDashboardModel(dashboardFilteredDemands, periodStart, periodEnd);

      const fmtPct = (v) => `${Number(v || 0).toFixed(Number(v || 0) % 1 ? 1 : 0)}%`;
      const miniMetric = (label, value, hint='') => el('div', { style:'border:1px solid var(--border);border-radius:14px;padding:10px;background:var(--surface)' }, [
        el('div', { class:'tiny muted' }, [label]),
        el('div', { class:'mono', style:'font-weight:950;font-size:18px' }, [value]),
        el('div', { class:'tiny muted', style:'margin-top:2px' }, [hint])
      ]);

      const simpleRanking = (title, rows, columns, emptyMsg) => {
        const t = el('table');
        t.appendChild(el('thead', {}, [el('tr', {}, columns.map(c => el('th', {}, [c.label])))]));
        const tb = el('tbody');
        const topRows = (rows || []).slice(0, 5);
        if (!topRows.length) {
          tb.appendChild(el('tr', {}, [el('td', { colspan:String(columns.length), style:'padding:14px;text-align:center;color:var(--muted)' }, [emptyMsg])]));
        } else {
          for (const row of topRows) {
            tb.appendChild(el('tr', {}, columns.map(c => el('td', {}, [String(c.get(row))]))));
          }
        }
        t.appendChild(tb);
        return el('div', { class:'grid', style:'gap:8px' }, [
          el('div', { style:'font-weight:950' }, [title]),
          el('div', { class:'scrollX' }, [t])
        ]);
      };

      const gargalos = simpleRanking('Gargalos / atenção', model.bottlenecks, [
        { label:'Demanda', get:r => r.title },
        { label:'Realizado', get:r => `${fmtHours(r.realHours)}h` },
        { label:'Planejado', get:r => `${fmtHours(r.plannedHours)}h` },
        { label:'Consumo', get:r => `${fmtPct(r.pct)} - ${r.tone}` },
      ], 'Nenhum gargalo encontrado no período/filtro atual.');

      const rankingDocs = simpleRanking('Ranking de documentos', model.byStep, [
        { label:'Etapa', get:r => r.label },
        { label:'Horas', get:r => `${fmtHours(r.horas)}h` },
        { label:'Apontamentos', get:r => r.count },
      ], 'Nenhuma etapa apontada no período.');

      const rankingUsers = simpleRanking('Horas por colaborador', model.byUser, [
        { label:'Colaborador', get:r => r.label },
        { label:'Horas', get:r => `${fmtHours(r.horas)}h` },
        { label:'Apontamentos', get:r => r.count },
      ], 'Nenhum colaborador com apontamento no período.');

      const semanal = simpleRanking('Produtividade semanal', model.byWeek, [
        { label:'Semana', get:r => r.label },
        { label:'Horas', get:r => `${fmtHours(r.horas)}h` },
        { label:'Apontamentos', get:r => r.count },
      ], 'Nenhuma produtividade semanal no período.');

      const demandasConsumidas = simpleRanking('Demandas mais consumidas', model.byDemand, [
        { label:'Demanda', get:r => r.title },
        { label:'Horas realizadas', get:r => `${fmtHours(r.horas)}h` },
      ], 'Nenhuma demanda consumiu horas reais no período.');

      return el('div', { class:'grid', style:'gap:12px' }, [
        el('div', { class:'tiny muted' }, [
          `Período operacional: ${formatDateBR(periodStart)} até ${formatDateBR(periodEnd)}. `,
          'Considera somente apontamentos reais cadastrados nas demandas filtradas. Não altera a capacidade planejada.'
        ]),
        el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px' }, [
          miniMetric('Horas reais no período', `${fmtHours(model.totalRealHours)}h`, `${model.totalApontamentos} apontamento(s)`),
          miniMetric('Tipos documentais', String(model.byStep.length), 'etapas diferentes'),
          miniMetric('Colaboradores', String(model.byUser.length), 'com apontamento'),
          miniMetric('Demandas consumidas', String(model.byDemand.length), 'com horas reais'),
          miniMetric('Último apontamento', model.lastApontamento ? `${formatDateBR(model.lastApontamento.data)} - ${model.lastApontamento.etapa}` : '-', model.lastApontamento ? model.lastApontamento.demandTitle : 'sem histórico no período'),
        ]),
        el('div', { class:'split' }, [rankingDocs, rankingUsers]),
        el('div', { class:'split' }, [semanal, demandasConsumidas]),
        gargalos
      ]);
    })();

    return el('div', { class:'grid', 'data-view':'dashboard' }, [
      el('div', { class:'kpi', 'data-dashboard-section':'kpis' }, [
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Recursos (total)']), el('div', { class:'val' }, [String(totalResources)])]),
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Recursos (ativos)']), el('div', { class:'val' }, [String(activeResources)])]),
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Demandas (total)']), el('div', { class:'val' }, [String(totalDemands)])]),
        el('div', { class:'k' }, [el('div', { class:'lbl' }, ['Demandas (abertas)']), el('div', { class:'val' }, [String(openDemands)])]),
      ]),
      el('div', { class:'split', 'data-dashboard-section':'demand-summary' }, [
        card('Demandas (Geral)', null, el('div', { class:'grid' }, [dashFiltersBar, donutNode])),
        card('Por Recurso (mês)', null, perResource)
      ]),

      (() => {
        const series = buildConsolidatedYearSeries(year);
const svg = buildCapacityVsPlannedSvg({ title: 'Ocupação Consolidada - Ano (demandas alocadas)', series });
        const totalsMonth = buildConsolidatedMonthTotals(year, (new Date()).getMonth());
        const validMonths = series.filter(m => Number(m.cap || 0) > 0);
        const avgUsage = validMonths.length
          ? validMonths.reduce((acc, m) => acc + Number(m.usagePct || 0), 0) / validMonths.length
          : 0;
        const peakMonth = series.reduce((best, m) => Number(m.usagePct || 0) > Number(best.usagePct || 0) ? m : best, series[0] || {});
        const overMonths = series.filter(m => Number(m.usagePct || 0) > 100).length;
        const totalOverHH = series.reduce((acc, m) => acc + Number(m.overHH || 0), 0);
        const criticalMonths = series
          .filter(m => Number(m.usagePct || 0) > 150)
          .sort((a,b) => Number(b.usagePct || 0) - Number(a.usagePct || 0));
        const summaryCard = (label, value, hint='', tone='') => el('div', {
          style:`border:1px solid var(--border);border-radius:14px;padding:10px;background:${tone==='danger'?'var(--danger-soft)':tone==='warn'?'var(--warning-soft)':tone==='ok'?'var(--success-soft)':'var(--surface)'}`
        }, [
          el('div', { class:'tiny muted' }, [label]),
          el('div', { class:'mono', style:'font-weight:950;font-size:18px;line-height:1.15' }, [value]),
          el('div', { class:'tiny muted', style:'margin-top:3px' }, [hint])
        ]);
        const rightNode = el('div', { class:'row', style:'gap:10px;flex-wrap:wrap;justify-content:flex-end' }, [
          el('div', { class:'tag', title:'Uso do mês atual (Planejado/Capacidade)' }, [
            `Mês: ${Math.round(totalsMonth.usagePct||0)}% - Overcap: ${fmtHours(totalsMonth.overHH||0)}h - Estourados: ${totalsMonth.overResources||0}/${totalsMonth.totalResources||0}`
          ]),
          button('Exportar SVG', 'ghost', () => exportSvg(svg, `capacidade_vsc_${year}.svg`)),
          button('Exportar PNG', 'ghost', () => exportPngFromSvg(svg, `capacidade_vsc_${year}.png`)),
        ]);

        const bodyNode = el('div', { class:'grid', style:'gap:10px' }, [
          el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px' }, [
            summaryCard('Ocupação média', `${Math.round(avgUsage)}%`, 'média dos meses com capacidade', avgUsage > 100 ? 'danger' : (avgUsage >= 86 ? 'warn' : 'ok')),
            summaryCard('Maior pico', `${Math.round(peakMonth.usagePct || 0)}%`, peakMonth.label ? `em ${peakMonth.label}` : 'sem dados', Number(peakMonth.usagePct || 0) > 100 ? 'danger' : (Number(peakMonth.usagePct || 0) >= 86 ? 'warn' : 'ok')),
            summaryCard('Meses estourados', String(overMonths), 'acima de 100%', overMonths ? 'danger' : 'ok'),
            summaryCard('Horas acima da capacidade', `${fmtHours(totalOverHH)}h`, 'soma anual de overcap', totalOverHH > 0 ? 'danger' : 'ok'),
          ]),
          criticalMonths.length ? el('div', { class:'warn', style:'background:var(--danger-soft);border-color:var(--danger-border);color:var(--danger)' }, [
            el('div', { style:'font-weight:950;margin-bottom:6px' }, ['Meses críticos acima da escala visual (150%)']),
            el('div', { class:'row', style:'gap:8px' }, criticalMonths.slice(0, 6).map(m =>
              el('span', { class:'tag', style:'background:#fff;color:var(--danger);border-color:var(--danger-border)' }, [
                `${m.label}: ${Math.round(m.usagePct || 0)}% ? +${fmtHours(m.overHH || 0)}h`
              ])
            )),
            criticalMonths.length > 6 ? el('div', { class:'tiny', style:'margin-top:6px;color:var(--danger)' }, [`+${criticalMonths.length - 6} mês(es) crítico(s) ocultos nesta lista.`]) : null
          ].filter(Boolean)) : null,
          el('div', { style:'max-width:100%;overflow:auto' }, [svg])
        ].filter(Boolean));

        const node = card('Ocupação Consolidada - Ano', rightNode, bodyNode);
        node.setAttribute('data-dashboard-section', 'capacity-year');
        return node;
      })(),
      (() => {
        const node = card('Visão Geral', el('div', { class:'row', style:'gap:10px;flex-wrap:wrap;justify-content:flex-end;align-items:center' }, [right, badgeLegend()]), tableBlock);
        node.setAttribute('data-dashboard-section', 'overview');
        return node;
      })()
    ]);
  };


  // Apontamentos (v0.3.1.3) ? cards em estilo kanban com paginação.
  // Objetivo: comparar janela planejada x execução real apontada, mantendo foco no projeto.
  const viewEvaluationDashboard = () => {
    const dashboardFilteredDemands = filterDemands({
      status: uiFilters.demandStatus,
      resourceId: uiFilters.demandResourceId,
      dateStart: uiFilters.demandDateStart,
      dateEnd: uiFilters.demandDateEnd,
      titleQuery: getDemandTitleFilter('evaluation')
    });

    const now = todayISO();
    const EVALUATION_PAGE_SIZE = 6;
    const clamp = (v, min=0, max=100) => Math.max(min, Math.min(max, Number(v || 0)));
    const pctText = (v) => `${clamp(v).toFixed(1).replace('.0','')}%`;
    const hoursText = (v) => `${fmtHours(v)}h`;
    const daysInclusive = (start, end) => {
      const a = isoToLocalMidnight(start);
      const b = isoToLocalMidnight(end);
      if (!a || !b) return 0;
      return Math.max(1, Math.floor((b.getTime() - a.getTime()) / 86400000) + 1);
    };
    const elapsedWindowPct = (range) => {
      const start = range?.data_inicio || range?.start || '';
      const end = range?.data_fim || range?.end || '';
      if (!isISODateString(start) || !isISODateString(end)) return 0;
      if (now < start) return 0;
      if (now > end) return 100;
      const total = daysInclusive(start, end);
      const elapsed = daysInclusive(start, now);
      return total ? clamp((elapsed / total) * 100) : 0;
    };
    const reprogrammedWindowPct = (classification={}) => {
      const start = String(classification.baselineEnd || '').trim();
      const end = String(classification.currentEnd || '').trim();
      if (!classification.exceedsPlannedWindow || !isISODateString(start) || !isISODateString(end) || end <= start) return 0;
      if (now <= start) return 0;
      if (now >= end) return 100;
      const total = Math.max(1, diffDaysISO(start, end));
      const elapsed = Math.max(0, diffDaysISO(start, now));
      return clamp((elapsed / total) * 100);
    };
    const remainingDaysLabel = (demand) => {
      if (!demand?.data_fim || !isISODateString(demand.data_fim)) return '';
      const a = isoToLocalMidnight(now);
      const b = isoToLocalMidnight(demand.data_fim);
      if (!a || !b) return '';
      const diff = Math.ceil((b.getTime() - a.getTime()) / 86400000);
      if (diff < 0) return `${Math.abs(diff)} dia(s) após o prazo`;
      if (diff === 0) return 'vence hoje';
      return `${diff} dia(s) restantes`;
    };
    const projectHealth = (metrics, windowPct, demand) => {
      const finalInfo = demandFinalStatusInfo(demand);
      const saldo = Number(metrics.delta || 0);
      const saldoTxt = `${fmtHours(Math.abs(saldo))}h ${saldo >= 0 ? 'restantes' : 'acima do planejado'}`;
      if (finalInfo.isFinal) {
        if (finalInfo.status === 'Concluída') {
          return {
            label:'Demanda concluída',
            tone:'ok',
            hint:`Concluída${finalInfo.actionDateBR ? ' em ' + finalInfo.actionDateBR : ''}${finalInfo.actor ? ' por ' + finalInfo.actor : ''}. Saldo final: ${saldoTxt}.`
          };
        }
        return {
          label:'Demanda cancelada',
          tone:'danger',
          hint:`Cancelada${finalInfo.actionDateBR ? ' em ' + finalInfo.actionDateBR : ''}${finalInfo.actor ? ' por ' + finalInfo.actor : ''}. Saldo no cancelamento: ${saldoTxt}.`
        };
      }
      const realPct = Number(metrics.progressPct || 0);
      const remainingText = remainingDaysLabel(demand);
      const isExpired = remainingText.includes('após o prazo');
      if (!metrics.plannedHours) return { label:'Sem base planejada', tone:'neutral', hint:'Demanda sem horas planejadas calculáveis.' };
      if (metrics.realHours > metrics.plannedHours) return { label:'Acima do planejado', tone:'danger', hint:'Horas realizadas já superaram as horas planejadas.' };
      if (isExpired && realPct < 100) return { label:'Prazo vencido', tone:'danger', hint:'Janela encerrada com execução real abaixo do planejado.' };
      if (windowPct >= 70 && realPct < 40) return { label:'Atenção ao andamento', tone:'warn', hint:'A janela avançou mais que a execução real apontada.' };
      if (realPct >= 90) return { label:'Próximo do limite', tone:'warn', hint:'Consumo de horas já está próximo do planejado.' };
      if (realPct > windowPct + 25) return { label:'Consumo acelerado', tone:'warn', hint:'Execução real está consumindo horas mais rápido que a janela.' };
      if (realPct > 0) return { label:'Dentro do planejado', tone:'ok', hint:'Execução real compatível com a janela planejada.' };
      return { label:'Não iniciado', tone:'neutral', hint:'Sem apontamentos reais registrados para a demanda.' };
    };

    const projects = (dashboardFilteredDemands || []).map(d => {
      const metrics = demandExecutionMetrics(d);
      const apontamentos = normalizeDemandApontamentos(d);
      const windowClassification = demandWindowClassification(d, apontamentos);
      const plannedWindowPct = elapsedWindowPct({
        data_inicio: windowClassification.baselineStart || d.data_inicio,
        data_fim: windowClassification.baselineEnd || d.data_fim,
      });
      const reprogrammedPct = reprogrammedWindowPct(windowClassification);
      const windowPct = plannedWindowPct;
      const health = projectHealth(metrics, plannedWindowPct, d);
      const remainingBalance = Number(metrics.plannedHours || 0) - Number(metrics.realHours || 0);
      const etapasUnicas = new Set(apontamentos.map(a => normalizeProjectStep(a.etapa)).filter(Boolean)).size;
      const lastStep = apontamentos.slice().sort((a,b) =>
        String(b.data||'').localeCompare(String(a.data||'')) || Number(b.created_at||0)-Number(a.created_at||0)
      )[0] || null;
      const stepBadges = [...new Set(apontamentos.map(a => normalizeProjectStep(a.etapa)).filter(Boolean))].slice(0,6);
      const windowSummary = demandApontamentoWindowSummary(d, apontamentos);
      const finalStatusInfo = demandFinalStatusInfo(d);
      return { demand:d, metrics, apontamentos, windowPct, plannedWindowPct, reprogrammedPct, health, remainingBalance, etapasUnicas, lastStep, stepBadges, windowSummary, windowClassification, remainingDays: remainingDaysLabel(d), finalStatusInfo };
    }).sort((a,b) => {
      const toneWeight = { danger:0, warn:1, neutral:2, ok:3 };
      return (toneWeight[a.health.tone] ?? 9) - (toneWeight[b.health.tone] ?? 9) || String(a.demand.data_fim||'').localeCompare(String(b.demand.data_fim||''));
    });

    const totals = projects.reduce((acc,p) => {
      acc.planned += Number(p.metrics.plannedHours || 0);
      acc.real += Number(p.metrics.realHours || 0);
      acc.apontamentos += Number(p.metrics.apontamentosCount || 0);
      if (p.health.tone === 'danger' || p.health.tone === 'warn') acc.attention += 1;
      return acc;
    }, { planned:0, real:0, apontamentos:0, attention:0 });
    const overallPct = totals.planned > 0 ? (totals.real / totals.planned) * 100 : 0;

    const miniMetric = (label, value, hint='', tone='') => el('div', {
      class:`evaluationMetric tone-${tone || 'neutral'}`
    }, [
      el('div', { class:'tiny muted' }, [label]),
      el('div', { class:'mono evaluationMetricValue' }, [value]),
      el('div', { class:'tiny muted', style:'margin-top:3px' }, [hint])
    ]);

    const progressRow = (label, pct, subtitle, title, tone='') => el('div', { class:'grid', style:'gap:4px' }, [
      el('div', { class:'row', style:'justify-content:space-between' }, [el('div', { class:'tiny muted' }, [label]), el('div', { class:'tiny mono' }, [pctText(pct)])]),
      subtitle ? el('div', { class:'tiny muted' }, [subtitle]) : null,
      barNode(pct, title, tone)
    ]);

    const projectCard = (p) => {
      const d = p.demand;
      const m = p.metrics;
      const finalInfo = p.finalStatusInfo || demandFinalStatusInfo(d);
      const statusTone = p.health.tone === 'danger' ? 'bad' : (p.health.tone === 'warn' ? 'warn' : (p.health.tone === 'ok' ? 'good' : 'info'));
      const balanceText = p.remainingBalance >= 0
        ? `${hoursText(p.remainingBalance)}`
        : `${hoursText(Math.abs(p.remainingBalance))}`;
      const balanceHint = finalInfo?.isFinal
        ? (finalInfo.status === 'Cancelada' ? 'saldo no cancelamento' : 'saldo na conclusão')
        : (p.remainingBalance >= 0 ? 'restantes' : 'acima do planejado');
      const balanceTone = p.remainingBalance < 0 ? 'danger' : 'ok';
      const lastText = p.lastStep
        ? `${formatDateBR(p.lastStep.data)} - ${normalizeProjectStep(p.lastStep.etapa)}`
        : '-';
      const wc = p.windowClassification || {};
      const finalStatusTone = finalInfo.status === 'Cancelada' ? 'bad' : 'good';
      const finalStatusBlock = finalInfo.isFinal ? el('div', { class:'evaluationFinalStatus' }, [
        el('div', { class:'row', style:'gap:8px;justify-content:space-between;align-items:center' }, [
          el('span', { class:`pill ${finalStatusTone}` }, [finalInfo.status]),
          button(finalInfo.buttonLabel, finalInfo.status === 'Cancelada' ? 'danger small' : 'primary small', () => openDemandFinalStatusDetailsModal(d))
        ]),
        el('div', { class:'tiny muted' }, [
          `${finalInfo.buttonLabel} ${finalInfo.actionDateBR ? 'em ' + finalInfo.actionDateBR : 'sem data registrada'}${finalInfo.actor ? ' por ' + finalInfo.actor : ''}.`
        ])
      ]) : null;
      const windowIndicatorBadges = [
        wc.exceedsPlannedWindow ? el('span', {
          class:'pill warn',
          title:`Baseline: ${formatDateBR(wc.baselineStart)} até ${formatDateBR(wc.baselineEnd)}. Prazo atual: ${formatDateBR(wc.currentEnd)}.`
        }, [`Prazo original excedido${wc.exceededDays ? `: +${wc.exceededDays} dia(s)` : ''}`]) : null,
        wc.hasEarlyExecution ? el('span', { class:'pill info', title:'Há apontamentos antes da data de início planejada.' }, [`Execução antecipada: ${wc.earlyCount} apontamento(s) / ${fmtHours(wc.earlyHours)}h`]) : null,
        wc.hasLateExecution ? el('span', { class:'pill bad', title:'Há apontamentos depois do prazo atual da demanda.' }, [`Execução fora do prazo: ${wc.lateCount} apontamento(s) / ${fmtHours(wc.lateHours)}h`]) : null,
      ].filter(Boolean);

      return el('div', { class:`evaluationProjectCard tone-${p.health.tone || 'info'}` }, [
        el('div', { class:'grid', style:'gap:8px;min-width:0' }, [
          el('div', { style:'min-width:0' }, [
            el('div', { style:'font-weight:950;font-size:15px;line-height:1.25;word-break:break-word' }, [d.titulo || d.id || 'Demanda']),
            el('div', { class:'tiny muted', style:'margin-top:4px' }, [`Janela atual: ${formatDateBR(d.data_inicio)} até ${formatDateBR(d.data_fim)}${p.remainingDays ? ' - ' + p.remainingDays : ''}`]),
            el('div', { class:'tiny muted', style:'margin-top:3px' }, [`Programado original: ${formatDateBR(wc.baselineStart)} até ${formatDateBR(wc.baselineEnd)}`])
          ]),
          el('div', { class:'row', style:'gap:6px;flex-wrap:wrap;align-items:center;justify-content:space-between' }, [
            el('div', { class:'row', style:'gap:6px;flex-wrap:wrap;align-items:center;min-width:0;flex:1 1 220px' }, windowIndicatorBadges.length ? windowIndicatorBadges : [el('span', { class:'tiny muted' }, ['Sem alertas de janela'])]),
            el('div', { class:'row', style:'gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end;flex:0 1 auto' }, [
              statusPill(d),
              el('span', { class:`pill ${statusTone}`, title:p.health.hint }, [p.health.label])
            ])
          ])
        ]),

        finalStatusBlock,

        el('div', { style:'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px' }, [
          miniMetric('Horas planejadas', hoursText(m.plannedHours), `${m.plannedDays || 0} dia(s) úteis`),
          miniMetric('Horas realizadas', hoursText(m.realHours), `${m.apontamentosCount || 0} apontamento(s)`),
          miniMetric('Saldo de horas', balanceText, balanceHint, balanceTone),
          miniMetric('Progresso real', pctText(m.progressPct), 'realizado ÷ planejado'),
          miniMetric('Status da demanda', p.health.label, p.health.hint || 'baseado no status e nas horas realizadas', p.health.tone === 'danger' ? 'danger' : (p.health.tone === 'warn' ? 'warn' : (p.health.tone === 'ok' ? 'ok' : ''))),
          miniMetric('Etapas', String(p.etapasUnicas || 0), 'tipos documentais'),
          miniMetric('Último apontamento', lastText, 'histórico operacional')
        ]),

        el('div', { class:'grid', style:'gap:10px;margin-top:auto' }, [
          progressRow(
            'Avanço da janela original',
            p.plannedWindowPct ?? p.windowPct,
            `Original: ${formatDateBR(wc.baselineStart)} → ${formatDateBR(wc.baselineEnd)}. Ao fim original, permanece em 100%.`,
            `Conta somente a janela original: ${formatDateBR(wc.baselineStart)} até ${formatDateBR(wc.baselineEnd)}.`
          ),
          wc.exceedsPlannedWindow ? progressRow(
            'Janela reprogramada',
            p.reprogrammedPct,
            `Extensão: ${formatDateBR(wc.baselineEnd)} → ${formatDateBR(wc.currentEnd)} (${wc.exceededDays} dia(s)).`,
            `Conta somente a extensão reprogramada: ${formatDateBR(wc.baselineEnd)} até ${formatDateBR(wc.currentEnd)}.`,
            'reprogrammed'
          ) : null,
          progressRow(
            'Execução real apontada',
            m.progressPct,
            `${hoursText(m.realHours)} realizadas de ${hoursText(m.plannedHours)} planejadas.`,
            'Percentual das horas planejadas já apontado como realizado'
          )
        ]),

        p.stepBadges.length
          ? el('div', { class:'row', style:'gap:6px;flex-wrap:wrap' }, p.stepBadges.map(step => el('span', { class:'tag' }, [step])))
          : el('div', { class:'tiny muted' }, ['Sem etapas apontadas.'])
      ]);
    };

    const filtersBar = (() => {
      const title = el('input', { type:'search', placeholder:'Filtrar por título ou status...', value: getDemandTitleFilter('evaluation') });
      bindDemandTitleSearch(title, 'evaluationProjectSearch', 'evaluationPage', 'evaluation', 'evaluation');
      const status = el('select', {}, [
        el('option', { value:'' }, ['Todos os status']),
        ...STATUS.map(s => el('option', { value:s, selected: uiFilters.demandStatus === s }, [s]))
      ]);
      status.addEventListener('change', () => { uiFilters.demandStatus = status.value; uiPagination.evaluationPage = 1; render(); });
      const resource = el('select', {}, [
        el('option', { value:'' }, ['Todos os recursos']),
        el('option', { value:'__NONE__' }, ['Sem responsável (Mapeada)']),
        ...(state.resources || []).map(r => el('option', { value:r.id, selected: uiFilters.demandResourceId === r.id }, [r.nome || r.id]))
      ]);
      resource.addEventListener('change', () => { uiFilters.demandResourceId = resource.value; uiPagination.evaluationPage = 1; render(); });
      const dateStart = el('input', { type:'date', value:uiFilters.demandDateStart || '' });
      const dateEnd = el('input', { type:'date', value:uiFilters.demandDateEnd || '' });
      dateStart.addEventListener('change', () => { uiFilters.demandDateStart = dateStart.value; uiPagination.evaluationPage = 1; render(); });
      dateEnd.addEventListener('change', () => { uiFilters.demandDateEnd = dateEnd.value; uiPagination.evaluationPage = 1; render(); });
      return el('div', { class:'row', style:'gap:10px;flex-wrap:wrap;align-items:end' }, [
        el('div', { class:'field', style:'min-width:220px;flex:1' }, [el('label', {}, ['Título / status']), title]),
        el('div', { class:'field', style:'min-width:180px' }, [el('label', {}, ['Status']), status]),
        el('div', { class:'field', style:'min-width:220px' }, [el('label', {}, ['Recurso']), resource]),
        el('div', { class:'field', style:'min-width:150px' }, [el('label', {}, ['De']), dateStart]),
        el('div', { class:'field', style:'min-width:150px' }, [el('label', {}, ['Até']), dateEnd]),
      ]);
    })();

    const total = projects.length;
    const totalPages = Math.max(1, Math.ceil(total / EVALUATION_PAGE_SIZE));
    uiPagination.evaluationPage = Math.min(Math.max(1, uiPagination.evaluationPage || 1), totalPages);
    const startIdx = (uiPagination.evaluationPage - 1) * EVALUATION_PAGE_SIZE;
    const pageItems = projects.slice(startIdx, startIdx + EVALUATION_PAGE_SIZE);

    const cards = projects.length
      ? el('div', { class:'grid', style:'gap:12px' }, [
          el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px;align-items:stretch' }, pageItems.map(projectCard)),
          buildPager({
            page: uiPagination.evaluationPage,
            totalPages,
            total,
            startIdx,
            shown: pageItems.length,
            onPrev: () => { uiPagination.evaluationPage--; render(); },
            onNext: () => { uiPagination.evaluationPage++; render(); },
            onFirst: () => { uiPagination.evaluationPage = 1; render(); },
            onLast: () => { uiPagination.evaluationPage = totalPages; render(); },
          })
        ])
      : el('div', { class:'evaluationEmptyState' }, ['Nenhuma demanda encontrada para avaliação.']);

    return el('div', { class:'grid', style:'gap:14px' }, [
      card('Apontamentos', null, el('div', { class:'grid', style:'gap:12px' }, [
        el('div', { class:'tiny muted' }, ['Visão por projeto: compara a janela planejada com as horas reais apontadas, sem ranking por colaborador.']),
        filtersBar,
        el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px' }, [
          miniMetric('Projetos avaliados', String(projects.length), 'demandas no filtro atual'),
          miniMetric('Horas planejadas', hoursText(totals.planned), 'base de planejamento'),
          miniMetric('Horas realizadas', hoursText(totals.real), `${totals.apontamentos} apontamento(s)`),
          miniMetric('Aderência geral', pctText(overallPct), 'realizado ÷ planejado'),
          miniMetric('Projetos em atenção', String(totals.attention), 'atenção ou acima do planejado')
        ])
      ])),
      card('Avaliação por Projeto', null, cards)
    ]);
  };

  const plannedDemandHoursForDate = (demand={}, dateStr='', resourceIds=null) => {
    const ids = Array.isArray(resourceIds) ? resourceIds.map(String) : null;
    if (!dateStr || !demandHistoricalWindowContainsDate(demand, dateStr)) return 0;
    if (!demandCountsInAllocationOnDate(demand, dateStr)) return 0;
    return demandAllocations(demand).reduce((acc, a) => {
      const rid = String(a.resourceId || '').trim();
      if (ids && !ids.includes(rid)) return acc;
      if (!demandAllocationActiveOnDate(a, demand, dateStr)) return acc;
      const reason = rid ? nonWorkingReasonForDay(rid, isoToLocalMidnight(dateStr)) : null;
      if (reason) return acc;
      return acc + demandAllocationHoursForDate(a, rid, isoToLocalMidnight(dateStr), state.resources || []);
    }, 0);
  };

  const apontamentoMatchesUser = (a={}) => {
    const aid = String(a.user_id || a.userId || a.updated_by_id || '').trim();
    if (userId && aid && aid === String(userId)) return true;
    const aname = normalizedPersonName(a.usuario || a.user || a.updated_by || '');
    const uname = normalizedPersonName(userName || '');
    return !!uname && !!aname && aname === uname;
  };

  const demandApontamentosForDate = (demand={}, dateStr='', { onlyCurrentUser=false } = {}) => {
    return normalizeDemandApontamentos(demand).filter(a => {
      if (String(a.data || '') !== String(dateStr || '')) return false;
      if (onlyCurrentUser && !apontamentoMatchesUser(a)) return false;
      return true;
    });
  };

  const dailyExecutionRows = ({ dateStr=todayISO(), resourceIds=null, onlyCurrentUser=false } = {}) => {
    return (state.demands || []).map(d => {
      const planned = plannedDemandHoursForDate(d, dateStr, resourceIds);
      const apontamentos = demandApontamentosForDate(d, dateStr, { onlyCurrentUser });
      const real = apontamentos.reduce((acc, a) => acc + Number(a.horas || 0), 0);
      return { demand:d, planned, real, apontamentos };
    }).filter(row => row.planned > 0 || row.real > 0);
  };

  const summarizeDailyExecutionRows = (rows=[]) => {
    const planned = rows.reduce((acc, r) => acc + Number(r.planned || 0), 0);
    const real = rows.reduce((acc, r) => acc + Number(r.real || 0), 0);
    const apontamentos = rows.reduce((acc, r) => acc + (Array.isArray(r.apontamentos) ? r.apontamentos.length : 0), 0);
    return {
      planned,
      real,
      apontamentos,
      adherence: planned > 0 ? (real / planned) * 100 : (real > 0 ? 100 : 0),
      pending: Math.max(0, planned - real),
      extra: Math.max(0, real - planned),
    };
  };

  const resourceIdForApontamento = (apontamento={}, demand={}) => {
    const aid = String(apontamento.user_id || apontamento.userId || apontamento.updated_by_id || '').trim();
    const aname = normalizedPersonName(apontamento.usuario || apontamento.user || apontamento.updated_by || '');
    for (const r of (state.resources || [])) {
      const rid = String(r?.id || '').trim();
      if (!rid) continue;
      const owner = resourceOwnerId(r);
      const rname = normalizedPersonName(r?.nome || r?.name || '');
      if ((aid && owner && aid === owner) || (aname && rname && aname === rname)) return rid;
    }
    const assigned = demandAssignedResourceIds(demand);
    if (assigned.length === 1) return assigned[0];
    return assigned[0] || '';
  };

  const expectedExecutionHoursForResource = (resource={}, dateStr=todayISO()) => getResourceHoursForDate(resource, isoToLocalMidnight(dateStr));

  const dailyResourceExecutionRows = (dateStr=todayISO(), { includeAllResources=false } = {}) => {
    const byResource = new Map();
    const ensure = (resource) => {
      const rid = String(resource?.id || '').trim();
      if (!rid) return null;
      if (!byResource.has(rid)) {
        byResource.set(rid, {
          resource,
          planned: expectedExecutionHoursForResource(resource, dateStr),
          demandReal: 0,
          internalReal: 0,
          items: [],
        });
      }
      return byResource.get(rid);
    };
    for (const r of (state.resources || [])) {
      if (includeAllResources || r?.ativo !== false) ensure(r);
    }
    for (const demand of (state.demands || [])) {
      for (const apontamento of demandApontamentosForDate(demand, dateStr)) {
        const rid = resourceIdForApontamento(apontamento, demand);
        const row = ensure((state.resources || []).find(r => String(r?.id || '') === rid));
        if (!row) continue;
        const hours = Math.max(0, Number(apontamento.horas || 0));
        if (hours > 0) {
          row.demandReal += hours;
          row.items.push({ type:'demand', label:demand.titulo || demand.id || 'Demanda', hours, hint:apontamento.etapa || 'apontamento', obs: apontamento.observacao || '', user: apontamento.usuario || '' });
        }
      }
    }
    const dateObj = isoToLocalMidnight(dateStr);
    for (const r of (state.resources || [])) {
      const row = ensure(r);
      if (!row) continue;
      for (const ia of internalActivitiesForResourceOnDate(r.id, dateObj, { onlyCapacity:false })) {
        const hours = Math.max(0, Number(ia?.horas_dia || ia?.horas || 0));
        if (hours > 0) {
          row.internalReal += hours;
          row.items.push({ type:'internal', label:ia.titulo || ia.nome || ia.descricao || 'Atividade interna', hours, hint:'interna', obs: ia.observacoes || ia.observacao || '', user: internalActivityOwnerName(ia) || '' });
        }
      }
    }
    return [...byResource.values()]
      .map(row => ({
        ...row,
        planned: roundDemandHours(row.planned),
        demandReal: roundDemandHours(row.demandReal),
        internalReal: roundDemandHours(row.internalReal),
        real: roundDemandHours(row.demandReal + row.internalReal),
      }))
      .filter(row => includeAllResources || row.planned > 0 || row.real > 0)
      .sort((a,b) => (Number(b.real || 0) - Number(a.real || 0)) || String(a.resource?.nome || '').localeCompare(String(b.resource?.nome || '')));
  };


  const dailyResourceExecutionRowsForRange = (startStr=todayISO(), endStr=startStr, { includeAllResources=false } = {}) => {
    let start = normalizeDateLikeToISO(startStr) || todayISO();
    let end = normalizeDateLikeToISO(endStr) || start;
    if (end < start) [start, end] = [end, start];
    const byResource = new Map();
    let cursor = start;
    let guard = 0;
    while (cursor && cursor <= end && guard < 8000) {
      for (const dayRow of dailyResourceExecutionRows(cursor, { includeAllResources })) {
        const rid = String(dayRow.resource?.id || '').trim();
        if (!rid) continue;
        if (!byResource.has(rid)) {
          byResource.set(rid, { resource:dayRow.resource, planned:0, demandReal:0, internalReal:0, items:[] });
        }
        const row = byResource.get(rid);
        row.planned += Number(dayRow.planned || 0);
        row.demandReal += Number(dayRow.demandReal || 0);
        row.internalReal += Number(dayRow.internalReal || 0);
        for (const item of (dayRow.items || [])) row.items.push({ ...item, date:cursor });
      }
      cursor = addDaysISO(cursor, 1);
      guard++;
    }
    return {
      rows:[...byResource.values()]
        .map(row => ({
          ...row,
          planned:roundDemandHours(row.planned),
          demandReal:roundDemandHours(row.demandReal),
          internalReal:roundDemandHours(row.internalReal),
          real:roundDemandHours(row.demandReal + row.internalReal),
        }))
        .filter(row => includeAllResources || row.planned > 0 || row.real > 0)
        .sort((a,b) => (Number(b.real || 0) - Number(a.real || 0)) || String(a.resource?.nome || '').localeCompare(String(b.resource?.nome || ''))),
      start,
      end,
    };
  };

  const executionExportDateBounds = () => {
    const dates = [];
    const add = (value) => {
      const iso = normalizeDateLikeToISO(value);
      if (iso) dates.push(iso);
    };
    for (const d of (state.demands || [])) {
      add(d.data_inicio);
      add(d.data_fim);
      for (const a of normalizeDemandApontamentos(d)) add(a.data);
    }
    for (const ia of (state.internalActivities || [])) {
      const ini = normalizeDateLikeToISO(ia?.data_inicio || ia?.dataInicio || ia?.start_date || ia?.data || '');
      const fim = normalizeDateLikeToISO(ia?.data_fim || ia?.dataFim || ia?.end_date || ini || ia?.data || '') || ini;
      add(ini);
      add(fim);
    }
    if (!dates.length) return { start: todayISO(), end: todayISO() };
    dates.sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  };

  const dailyExecutionExportRowsForDate = (dateStr=todayISO()) => {
    return dailyResourceExecutionRows(dateStr, { includeAllResources:true }).map(row => {
      const adherence = row.planned > 0 ? (row.real / row.planned) * 100 : (row.real > 0 ? 100 : 0);
      return {
        data: dateStr,
        data_br: formatDateBR(dateStr),
        recurso: row.resource?.nome || row.resource?.name || row.resource?.id || '',
        tipo_recurso: row.resource?.tipo || '',
        planejado_meta_horas: row.planned,
        executado_total_horas: row.real,
        executado_demandas_horas: row.demandReal,
        executado_internas_horas: row.internalReal,
        aderencia_pct: Math.round(adherence * 10) / 10,
        saldo_horas: roundDemandHours(row.real - row.planned),
        lancamentos_resumo: row.items.filter(i => i.type !== 'planned').map(i => `${i.type === 'internal' ? 'Interna' : 'Demanda'}: ${i.label} (${fmtHours(i.hours)}h)`).join(' | ')
      };
    });
  };

  const dailyExecutionExportRowsForRange = (startStr=todayISO(), endStr=startStr) => {
    let start = normalizeDateLikeToISO(startStr) || todayISO();
    let end = normalizeDateLikeToISO(endStr) || start;
    if (end < start) [start, end] = [end, start];
    const rows = [];
    let cursor = start;
    let guard = 0;
    while (cursor && cursor <= end && guard < 8000) {
      rows.push(...dailyExecutionExportRowsForDate(cursor));
      cursor = addDaysISO(cursor, 1);
      guard++;
    }
    return { rows, start, end };
  };

  const exportDailyExecutionRangeCSV = (startStr=todayISO(), endStr=startStr) => {
    const { rows, start, end } = dailyExecutionExportRowsForRange(startStr, endStr);
    const headers = ['data','data_br','recurso','tipo_recurso','planejado_meta_horas','executado_total_horas','executado_demandas_horas','executado_internas_horas','aderencia_pct','saldo_horas','lancamentos_resumo'];
    const rangeLabel = start === end ? start : `${start}_a_${end}`;
    downloadText(`execucao_diaria_${rangeLabel}_todos_recursos.csv`, toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast(start === end
      ? `CSV de Execução diária exportado para ${formatDateBR(start)}.`
      : `CSV de Execução diária exportado de ${formatDateBR(start)} até ${formatDateBR(end)}.`);
  };

  const openDailyExecutionExportModal = (initialStart='', initialEnd='') => {
    let dlg = qs('#dailyExecutionExportModal');
    if (dlg) dlg.remove();
    const defaultStart = normalizeDateLikeToISO(initialStart || dailyExecutionStartDate || dailyExecutionDate) || todayISO();
    const defaultEnd = normalizeDateLikeToISO(initialEnd || dailyExecutionEndDate || defaultStart) || defaultStart;
    const startDateInput = el('input', { type:'date', value:defaultStart });
    const endDateInput = el('input', { type:'date', value:defaultEnd });
    const status = el('div', { class:'tiny muted', style:'margin-top:8px' }, ['Informe a data inicial e final para exportar o período desejado.']);
    const syncBounds = () => {
      if (startDateInput.value) endDateInput.min = startDateInput.value;
      if (endDateInput.value) startDateInput.max = endDateInput.value;
    };
    startDateInput.onchange = syncBounds;
    endDateInput.onchange = syncBounds;
    syncBounds();
    const confirm = () => {
      const start = normalizeDateLikeToISO(startDateInput.value || defaultStart);
      const end = normalizeDateLikeToISO(endDateInput.value || start || defaultEnd);
      if (!start || !end) {
        status.textContent = 'Selecione uma data inicial e uma data final válidas.';
        status.style.color = 'var(--danger)';
        return;
      }
      dailyExecutionStartDate = start;
      dailyExecutionEndDate = end;
      dailyExecutionDate = end;
      exportDailyExecutionRangeCSV(start, end);
      closeDialog(dlg);
    };
    dlg = el('dialog', { id:'dailyExecutionExportModal', class:'modal' }, [
      el('div', { class:'modalCard' }, [
        el('div', { class:'modalHd' }, [
          el('div', {}, [
            el('div', { class:'modalTitle' }, ['Exportar execução diária']),
            el('div', { class:'modalSub' }, ['Escolha a data inicial e final que deseja exportar para todos os recursos.'])
          ]),
          button('Fechar ×', 'ghost', () => closeDialog(dlg))
        ]),
        el('div', { class:'modalBd' }, [
          el('div', { class:'row toolbarAligned' }, [
            el('div', { class:'field', style:'max-width:220px' }, [el('label', {}, ['Data inicial']), startDateInput]),
            el('div', { class:'field', style:'max-width:220px' }, [el('label', {}, ['Data final']), endDateInput])
          ]),
          status,
          el('div', { class:'row end', style:'margin-top:14px' }, [button('Exportar período selecionado', 'primary', confirm)])
        ])
      ])
    ]);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(dlg); });
    document.body.appendChild(dlg);
    openDialog(dlg);
  };

  const openDailyResourceLaunchesModal = (row, dateStr, endDateStr='') => {
    let dlg = qs('#dailyResourceLaunchesModal');
    if (dlg) dlg.remove();
    const resourceName = row.resource?.nome || row.resource?.name || row.resource?.id || 'Recurso';
    const items = row.items.filter(i => i.type !== 'planned');
    const tbl = el('table', { class:'demandsTable' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, ['Data','Tipo','Lançamento','Horas','Detalhe','Usuário'].map(h => el('th', {}, [h])))]));
    const tbody = el('tbody');
    for (const item of items) {
      tbody.appendChild(el('tr', {}, [
        el('td', { class:'mono' }, [formatDateBR(item.date || dateStr)]),
        el('td', {}, [item.type === 'internal' ? 'Atividade interna' : 'Demanda']),
        el('td', {}, [item.label || '-']),
        el('td', { class:'mono' }, [`${fmtHours(item.hours)}h`]),
        el('td', {}, [item.obs || item.hint || '-']),
        el('td', {}, [item.user || '-']),
      ]));
    }
    if (!items.length) tbody.appendChild(el('tr', {}, [el('td', { colspan:'6', style:'padding:18px;text-align:center;color:var(--muted)' }, ['Nenhum lançamento registrado para este recurso na data.'])]));
    tbl.appendChild(tbody);
    dlg = el('dialog', { id:'dailyResourceLaunchesModal', class:'modal' }, [
      el('div', { class:'modalCard' }, [
        el('div', { class:'modalHd' }, [
          el('div', {}, [
            el('div', { class:'modalTitle' }, [`Lançamentos de ${resourceName}`]),
            el('div', { class:'modalSub' }, [`${endDateStr && endDateStr !== dateStr ? formatDateBR(dateStr) + ' até ' + formatDateBR(endDateStr) : formatDateBR(dateStr)} · Meta ${fmtHours(row.planned)}h · Executado ${fmtHours(row.real)}h`])
          ]),
          button('Fechar ×', 'ghost', () => closeDialog(dlg))
        ]),
        el('div', { class:'modalBd' }, [
          el('div', { class:'tiny muted', style:'margin-bottom:10px' }, ['Resumo do período selecionado. A exportação da aba usa a data inicial e final informadas.']),
          el('div', { class:'scrollX' }, [tbl])
        ])
      ])
    ]);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(dlg); });
    document.body.appendChild(dlg);
    openDialog(dlg);
  };



  const monthlyExecutionDailySeries = (dateStr=todayISO()) => {
    const base = isoToLocalMidnight(dateStr) || new Date();
    return getDaysInMonth(base.getFullYear(), base.getMonth()).map(dayObj => {
      const date = formatDate(dayObj);
      const rows = dailyResourceExecutionRows(date, { includeAllResources:false });
      const planned = roundDemandHours(rows.reduce((acc, r) => acc + Number(r.planned || 0), 0));
      const executed = roundDemandHours(rows.reduce((acc, r) => acc + Number(r.real || 0), 0));
      return { date, day:dayObj.getDate(), planned, executed };
    });
  };

  const buildMonthlyExecutionSvg = (dateStr=todayISO()) => {
    const ns = 'http://www.w3.org/2000/svg';
    const series = monthlyExecutionDailySeries(dateStr);
    const width = 1120;
    const height = 360;
    const left = 58;
    const right = 24;
    const top = 42;
    const bottom = 54;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const maxValue = Math.max(1, ...series.flatMap(p => [Number(p.planned || 0), Number(p.executed || 0)]));
    const barGroupW = plotW / Math.max(1, series.length);
    const barW = Math.max(5, Math.min(14, (barGroupW - 6) / 2));
    const monthLabel = (isoToLocalMidnight(dateStr) || new Date()).toLocaleString('pt-BR', { month:'long', year:'numeric' });
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('style', 'max-width:100%;height:auto;display:block;');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Gráfico mensal de execução diária - ${monthLabel}`);
    const make = (tag, attrs={}, text='') => {
      const node = document.createElementNS(ns, tag);
      for (const [k,v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      if (text !== '') node.textContent = String(text);
      svg.appendChild(node);
      return node;
    };
    make('defs');
    const defs = svg.querySelector('defs');
    const grad = (id, stops) => {
      const g = document.createElementNS(ns, 'linearGradient');
      g.setAttribute('id', id);
      g.setAttribute('x1', '0%'); g.setAttribute('x2', '0%'); g.setAttribute('y1', '100%'); g.setAttribute('y2', '0%');
      for (const [offset, color] of stops) {
        const st = document.createElementNS(ns, 'stop');
        st.setAttribute('offset', offset);
        st.setAttribute('stop-color', color);
        g.appendChild(st);
      }
      defs.appendChild(g);
    };
    grad('monthlyPlannedGrad', [['0%', '#E5E7EB'], ['100%', '#050505']]);
    grad('monthlyExecutedGrad', [['0%', '#BBF7D0'], ['100%', '#15803D']]);
    make('rect', { x:0, y:0, width, height, rx:0, fill:'#fff' });
    make('text', { x:left, y:24, fill:'var(--text)', 'font-size':16, 'font-weight':950, 'font-family':'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' }, `Execução diária mensal - ${monthLabel}`);
    make('text', { x:width-right, y:24, fill:'var(--muted)', 'font-size':11, 'font-weight':800, 'text-anchor':'end', 'font-family':'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' }, 'Planejado x Executado (h)');
    for (let i = 0; i <= 4; i++) {
      const value = (maxValue / 4) * i;
      const y = top + plotH - (value / maxValue) * plotH;
      make('line', { x1:left, y1:y, x2:width-right, y2:y, stroke:'var(--border)', 'stroke-width':1 });
      make('text', { x:left-8, y:y+4, fill:'var(--muted)', 'font-size':10, 'font-weight':750, 'text-anchor':'end', 'font-family':'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' }, fmtHours(value));
    }
    series.forEach((p, i) => {
      const x0 = left + i * barGroupW + Math.max(2, (barGroupW - (barW * 2 + 3)) / 2);
      const plannedH = (Number(p.planned || 0) / maxValue) * plotH;
      const executedH = (Number(p.executed || 0) / maxValue) * plotH;
      const planned = make('rect', { x:x0, y:top + plotH - plannedH, width:barW, height:plannedH, rx:Math.min(5, barW/2), fill:'url(#monthlyPlannedGrad)' });
      const plannedTip = document.createElementNS(ns, 'title');
      plannedTip.textContent = `${formatDateBR(p.date)} | Planejado ${fmtHours(p.planned)}h`;
      planned.appendChild(plannedTip);
      const executed = make('rect', { x:x0 + barW + 3, y:top + plotH - executedH, width:barW, height:executedH, rx:Math.min(5, barW/2), fill:'url(#monthlyExecutedGrad)' });
      const executedTip = document.createElementNS(ns, 'title');
      executedTip.textContent = `${formatDateBR(p.date)} | Executado ${fmtHours(p.executed)}h`;
      executed.appendChild(executedTip);
      if (series.length <= 31 && (p.day === 1 || p.day % 2 === 0 || i === series.length - 1)) {
        make('text', { x:x0 + barW + 1.5, y:height-30, fill:'var(--muted)', 'font-size':10, 'font-weight':800, 'text-anchor':'middle', 'font-family':'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' }, String(p.day));
      }
    });
    make('rect', { x:left, y:height-15, width:14, height:10, rx:2, fill:'url(#monthlyPlannedGrad)' });
    make('text', { x:left+20, y:height-6, fill:'var(--text)', 'font-size':12, 'font-weight':800, 'font-family':'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' }, 'Planejado');
    make('rect', { x:left+120, y:height-15, width:14, height:10, rx:2, fill:'url(#monthlyExecutedGrad)' });
    make('text', { x:left+140, y:height-6, fill:'var(--text)', 'font-size':12, 'font-weight':800, 'font-family':'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' }, 'Executado');
    return svg;
  };

  const monthlyDemandExecutionSummary = (dateStr=todayISO()) => {
    const base = isoToLocalMidnight(dateStr) || new Date();
    const year = base.getFullYear();
    const month = base.getMonth();
    const days = getDaysInMonth(year, month).map(formatDate);
    const summary = new Map();
    for (const day of days) {
      for (const row of dailyExecutionRows({ dateStr:day })) {
        const id = String(row.demand?.id || row.demand?.titulo || '').trim();
        if (!id) continue;
        if (!summary.has(id)) summary.set(id, { demand:row.demand, planned:0, real:0, apontamentos:0 });
        const item = summary.get(id);
        item.planned += Number(row.planned || 0);
        item.real += Number(row.real || 0);
        item.apontamentos += Array.isArray(row.apontamentos) ? row.apontamentos.length : 0;
      }
    }
    return [...summary.values()].map(item => ({
      ...item,
      planned: roundDemandHours(item.planned),
      real: roundDemandHours(item.real),
      adherence: item.planned > 0 ? (item.real / item.planned) * 100 : (item.real > 0 ? 100 : 0),
    })).sort((a,b) => Number(b.real || 0) - Number(a.real || 0) || String(a.demand?.titulo || '').localeCompare(String(b.demand?.titulo || '')));
  };

  const openMonthlyDemandExecutionModal = (dateStr=todayISO()) => {
    let dlg = qs('#monthlyDemandExecutionModal');
    if (dlg) dlg.remove();
    const rows = monthlyDemandExecutionSummary(dateStr);
    const tbl = el('table', { class:'demandsTable' });
    tbl.appendChild(el('thead', {}, [el('tr', {}, ['Demanda','Status','Planejado','Executado','Aderência','Apontamentos'].map(h => el('th', {}, [h])))]));
    const tbody = el('tbody');
    for (const row of rows) {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [row.demand?.titulo || row.demand?.id || '-']),
        el('td', {}, [effectiveStatus(row.demand)]),
        el('td', { class:'mono' }, [`${fmtHours(row.planned)}h`]),
        el('td', { class:'mono' }, [`${fmtHours(row.real)}h`]),
        el('td', { class:'mono' }, [`${Math.round(row.adherence || 0)}%`]),
        el('td', { class:'mono' }, [String(row.apontamentos || 0)]),
      ]));
    }
    if (!rows.length) tbody.appendChild(el('tr', {}, [el('td', { colspan:'6', style:'padding:18px;text-align:center;color:var(--muted)' }, ['Nenhuma demanda planejada ou executada no mês selecionado.'])]));
    tbl.appendChild(tbody);
    dlg = el('dialog', { id:'monthlyDemandExecutionModal', class:'modal' }, [
      el('div', { class:'modalCard' }, [
        el('div', { class:'modalHd' }, [
          el('div', {}, [el('div', { class:'modalTitle' }, ['Demandas mensais']), el('div', { class:'modalSub' }, [isoToLocalMidnight(dateStr).toLocaleString('pt-BR', { month:'long', year:'numeric' })])]),
          button('Fechar ×', 'ghost', () => closeDialog(dlg))
        ]),
        el('div', { class:'modalBd' }, [el('div', { class:'scrollX' }, [tbl])])
      ])
    ]);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(dlg); });
    document.body.appendChild(dlg);
    openDialog(dlg);
  };

  const viewDailyExecution = () => {
    const unlockInput = el('input', { type:'password', placeholder:'Digite a senha', autocomplete:'off' });
    const unlockStatus = el('div', { class:'tiny muted' }, ['Acesso restrito aos indicadores de execução diária.']);
    const unlock = () => {
      if (String(unlockInput.value || '') === DAILY_EXECUTION_PASSWORD) {
        dailyExecutionUnlocked = true;
        render();
      } else {
        unlockStatus.textContent = 'Senha inválida.';
        unlockStatus.style.color = 'var(--danger)';
      }
    };
    if (!dailyExecutionUnlocked) {
      return el('div', { class:'grid' }, [
        card('Execução diária - acesso restrito', null, el('div', { class:'grid', style:'max-width:420px' }, [
          el('div', { class:'tiny muted' }, ['Informe a senha para visualizar aderência diária, horas apontadas e pendências de execução.']),
          el('div', { class:'field' }, [el('label', {}, ['Senha']), unlockInput]),
          el('div', { class:'row end' }, [button('Liberar acesso', 'primary', unlock)]),
          unlockStatus
        ]))
      ]);
    }

    dailyExecutionStartDate = normalizeDateLikeToISO(dailyExecutionStartDate || dailyExecutionDate) || todayISO();
    dailyExecutionEndDate = normalizeDateLikeToISO(dailyExecutionEndDate || dailyExecutionStartDate) || dailyExecutionStartDate;
    if (dailyExecutionEndDate < dailyExecutionStartDate) dailyExecutionEndDate = dailyExecutionStartDate;
    dailyExecutionDate = dailyExecutionEndDate || dailyExecutionStartDate || todayISO();
    const startDateInput = el('input', { type:'date', value:dailyExecutionStartDate, onchange:(ev) => {
      dailyExecutionStartDate = normalizeDateLikeToISO(ev.target.value) || todayISO();
      if (!dailyExecutionEndDate || dailyExecutionEndDate < dailyExecutionStartDate) dailyExecutionEndDate = dailyExecutionStartDate;
      dailyExecutionDate = dailyExecutionEndDate;
      render();
    } });
    const endDateInput = el('input', { type:'date', value:dailyExecutionEndDate, onchange:(ev) => {
      dailyExecutionEndDate = normalizeDateLikeToISO(ev.target.value) || dailyExecutionStartDate || todayISO();
      if (dailyExecutionEndDate < dailyExecutionStartDate) dailyExecutionStartDate = dailyExecutionEndDate;
      dailyExecutionDate = dailyExecutionEndDate;
      render();
    } });
    const dailyRange = dailyResourceExecutionRowsForRange(dailyExecutionStartDate, dailyExecutionEndDate);
    const resourceRows = dailyRange.rows;
    const rangeIsSingleDay = dailyRange.start === dailyRange.end;
    const rangeLabel = rangeIsSingleDay ? formatDateBR(dailyRange.start) : `${formatDateBR(dailyRange.start)} até ${formatDateBR(dailyRange.end)}`;
    const totalsWithInternal = {
      planned: resourceRows.reduce((acc, r) => acc + Number(r.planned || 0), 0),
      real: resourceRows.reduce((acc, r) => acc + Number(r.real || 0), 0),
      internal: resourceRows.reduce((acc, r) => acc + Number(r.internalReal || 0), 0),
      apontamentos: resourceRows.reduce((acc, r) => acc + r.items.filter(i => i.type === 'demand').length, 0),
    };
    totalsWithInternal.adherence = totalsWithInternal.planned > 0 ? (totalsWithInternal.real / totalsWithInternal.planned) * 100 : (totalsWithInternal.real > 0 ? 100 : 0);
    totalsWithInternal.pending = Math.max(0, totalsWithInternal.planned - totalsWithInternal.real);
    totalsWithInternal.extra = Math.max(0, totalsWithInternal.real - totalsWithInternal.planned);
    const pct = (v) => `${Math.max(0, Number(v || 0)).toFixed(0)}%`;
    const metric = (label, value, hint='', tone='') => el('div', {
      class:`executionMetric tone-${tone || 'neutral'}`
    }, [
      el('div', { class:'tiny muted', style:'text-transform:uppercase;font-weight:950;letter-spacing:.08em' }, [label]),
      el('div', { class:'mono executionMetricValue' }, [value]),
      hint ? el('div', { class:'tiny muted', style:'margin-top:3px' }, [hint]) : null
    ].filter(Boolean));

    const resourceCards = resourceRows.length
      ? el('div', { class:'resourceCardGrid' }, resourceRows.map(row => {
          const maxHours = Math.max(1, row.planned, row.real);
          const plannedW = Math.max(4, Math.round((row.planned / maxHours) * 100));
          const realW = Math.max(4, Math.round((row.real / maxHours) * 100));
          const adherence = row.planned > 0 ? (row.real / row.planned) * 100 : (row.real > 0 ? 100 : 0);
          const cardTone = row.planned <= 0 ? 'info' : adherence > 130 ? 'danger' : adherence < 80 ? 'warn' : 'ok';
          const tone = cardTone === 'danger' ? 'bad' : cardTone === 'ok' ? 'good' : cardTone;
          const workedItems = row.items
            .filter(i => i.type !== 'planned')
            .sort((a,b) => Number(b.hours || 0) - Number(a.hours || 0))
            .slice(0, 4);
          const resourceName = row.resource?.nome || row.resource?.name || row.resource?.id || 'Recurso';
          return el('div', {
            class:`resourceExecutionCard tone-${cardTone}`,
            role:'button',
            tabindex:'0',
            title:'Abrir lançamentos do recurso',
            style:'padding:12px;display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:12px;align-items:center',
            onclick:() => openDailyResourceLaunchesModal(row, rangeIsSingleDay ? dailyRange.start : dailyRange.start, dailyRange.end),
            onkeydown:(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDailyResourceLaunchesModal(row, rangeIsSingleDay ? dailyRange.start : dailyRange.start, dailyRange.end); } }
          }, [
            el('div', {}, [
              el('div', { style:'font-weight:950;text-align:left;color:var(--primary)' }, [resourceName]),
              el('div', { class:'tiny muted', style:'margin-top:4px' }, [`Meta ${fmtHours(row.planned)}h · Executado ${fmtHours(row.real)}h`]),
              el('div', { style:'margin-top:8px' }, [el('span', { class:`pill ${tone}` }, [pct(adherence)])])
            ]),
            el('div', { style:'display:grid;gap:8px' }, [
              el('div', { style:'display:grid;grid-template-columns:74px 1fr 56px;gap:8px;align-items:center' }, [
                el('div', { class:'tiny muted' }, ['Planejado']),
                el('div', { class:'resourceBarTrack', style:'height:16px' }, [
                  el('div', { class:'resourceBarFill planned', title:`Planejado: ${fmtHours(row.planned)}h`, style:`width:${plannedW}%` })
                ]),
                el('div', { class:'mono tiny', style:'text-align:right' }, [`${fmtHours(row.planned)}h`])
              ]),
              el('div', { style:'display:grid;grid-template-columns:74px 1fr 56px;gap:8px;align-items:center' }, [
                el('div', { class:'tiny muted' }, ['Executado']),
                el('div', { class:'resourceBarTrack', style:'height:16px' }, [
                  el('div', { class:'resourceBarFill executed', title:`Executado: ${fmtHours(row.real)}h`, style:`width:${realW}%` })
                ]),
                el('div', { class:'mono tiny', style:'text-align:right' }, [`${fmtHours(row.real)}h`])
              ]),
              el('div', { class:'tiny muted' }, [
                `Demandas: ${fmtHours(row.demandReal)}h · Internas: ${fmtHours(row.internalReal)}h`,
                workedItems.length ? ` · ${workedItems.map(i => i.label).slice(0,2).join(', ')}${workedItems.length > 2 ? '...' : ''}` : ''
              ])
            ])
          ]);
        }))
      : el('div', { class:'hint tiny' }, ['Nenhum recurso com planejamento, apontamento ou atividade interna no período selecionado.']);

    return el('div', { class:'grid' }, [
      card('Execução diária', el('div', { class:'row toolbarAligned' }, [
        el('div', { class:'field' }, [el('label', {}, ['Data inicial']), startDateInput]),
        el('div', { class:'field' }, [el('label', {}, ['Data final']), endDateInput]),
        button('Hoje', '', () => { dailyExecutionDate = todayISO(); dailyExecutionStartDate = todayISO(); dailyExecutionEndDate = todayISO(); render(); }),
        button('Exportar período', 'primary', () => openDailyExecutionExportModal(dailyRange.start, dailyRange.end)),
        button('Bloquear', 'ghost', () => { dailyExecutionUnlocked = false; render(); })
      ]), el('div', { class:'grid', style:'gap:12px' }, [
        el('div', { class:'tiny muted' }, [`Indicador gerencial do período selecionado (${rangeLabel}). A meta é 9h para interno, 8h para interno às sextas e 8h para terceiro. Clique no nome do recurso para ver os lançamentos do período.`]),
        el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px' }, [
          metric('Meta do período', `${fmtHours(totalsWithInternal.planned)}h`, 'interno 9h; sexta 8h; terceiro 8h'),
          metric('Executado no período', `${fmtHours(totalsWithInternal.real)}h`, `${totalsWithInternal.apontamentos} apontamento(s) + ${fmtHours(totalsWithInternal.internal)}h internas`),
          metric('Aderência', pct(totalsWithInternal.adherence), 'executado ÷ planejado', totalsWithInternal.adherence < 60 ? 'warn' : ''),
          metric('Pendente', `${fmtHours(totalsWithInternal.pending)}h`, 'meta ainda sem execução'),
          metric('Extra', `${fmtHours(totalsWithInternal.extra)}h`, 'executado acima da meta', totalsWithInternal.extra > 0 ? 'warn' : ''),
        ]),
        card('Gráfico mensal de execução', el('div', { class:'row', style:'gap:8px;justify-content:flex-end' }, [
          el('span', { class:'pill' }, ['Planejado: cinza claro → preto']),
          el('span', { class:'pill info' }, ['Executado: verde claro → verde escuro'])
        ]), el('div', { style:'max-width:100%;overflow:auto' }, [buildMonthlyExecutionSvg(dailyExecutionDate || todayISO())])),
        card('Demandas mensais', null, el('button', { type:'button', class:'monthlyDemandCard', onclick:() => openMonthlyDemandExecutionModal(dailyExecutionDate || todayISO()) }, [
          el('div', { style:'font-weight:950' }, ['Avaliar demandas do mês selecionado']),
          el('div', { class:'tiny muted', style:'margin-top:4px' }, ['Clique para comparar planejamento, execução real, aderência e apontamentos por demanda no mês.'])
        ])),
        card('Execução por recurso', null, el('div', { class:'grid', style:'gap:10px' }, [
          el('div', { class:'tiny muted' }, ['Gráfico horizontal por recurso no período. Executado soma apontamentos em demandas e atividades internas lançadas no mesmo recurso.']),
          resourceCards
        ]))
      ]))
    ]);
  };


  const viewResources = () => {
    const form = (() => {
      const name = el('input', { placeholder:'Ex: Arthur', value:'', maxlength:String(INPUT_LIMITS.resourceName) });
      const type = el('select', {}, [
        el('option', { value:'Interno' }, ['Interno']),
        el('option', { value:'Terceiro' }, ['Terceiro']),
      ]);
      const hours = el('input', { type:'number', min:'0', step:'0.5', value:String(HOURS_PER_DAY), disabled:'true', title:'Interno: 9h/dia (sexta 8h) | Terceiro: 8h/dia' });
      const active = el('select', {}, [
        el('option', { value:'true' }, ['Ativo']),
        el('option', { value:'false' }, ['Inativo']),
      ]);
      const vigIni = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
      const vigFim = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });

      const thirdWrap = el('div', { class:'row', style:'width:100%' }, [
        el('div', { class:'field' }, [el('label', {}, ['Vigência Início (Terceiro)']), vigIni]),
        el('div', { class:'field' }, [el('label', {}, ['Vigência Fim (Terceiro)']), vigFim]),
      ]);
      const updateThirdVisibility = () => {
        thirdWrap.style.display = (type.value === 'Terceiro') ? '' : 'none';
        hours.value = String(type.value === 'Terceiro' ? HOURS_PER_DAY_THIRD : HOURS_PER_DAY);
      };
      type.addEventListener('change', updateThirdVisibility);
      updateThirdVisibility();

      const submit = () => {
        const nome = name.value.trim();
        const validation = validateResourcePayload({ nome, tipo:type.value, vigencia_inicio:vigIni.value, vigencia_fim:vigFim.value });
        if (validation) return toast(validation);
        const resourceUser = userIdentityForResourceName(nome);
        const payload = {
          id: generateId('resource'),
          nome,
          tipo: type.value,
          horas_dia: (type.value === 'Terceiro' ? HOURS_PER_DAY_THIRD : HOURS_PER_DAY),
          ativo: active.value === 'true',
          vigencia_inicio: vigIni.value || undefined,
          vigencia_fim: vigFim.value || undefined,
          owner_user_id: resourceUser.userId,
          owner_user_name: resourceUser.displayName || nome,
          created_as_user: true,
        };
        dispatch('ADD_RESOURCE', payload);
        ensureResourceUserEventFile(payload).then((created) => {
          if (created && capviewEventMode.autoSyncEnabled !== false) setTimeout(() => eventAutoSyncTick('resource-user-file'), 250);
        });
        name.value = ''; hours.value = String(HOURS_PER_DAY); type.value = 'Interno'; active.value = 'true'; vigIni.value=''; vigFim.value='';
        updateThirdVisibility();
        toast(sharedFolderReady() ? 'Recurso adicionado como usuário.' : 'Recurso adicionado como usuário. Conecte a pasta ORIZONData para criar o JSON em /events.');
      };

      return card('Cadastrar Recurso',
        el('div', { class:'row' }, [button('Adicionar', 'primary', submit)]),
        el('div', { class:'split' }, [
          el('div', {}, [
            el('div', { class:'row' }, [
              el('div', { class:'field' }, [el('label', {}, ['Nome']), name]),
              el('div', { class:'field' }, [el('label', {}, ['Tipo']), type]),
              el('div', { class:'field' }, [el('label', {}, ['Horas/dia']), hours]),
              el('div', { class:'field' }, [el('label', {}, ['Status']), active]),
            ]),
            thirdWrap,
            el('div', { class:'hint tiny' }, [
              el('b', {}, ['Dica: ']),
              'Para Terceiro, fora da vigência o dia aparece como OFF e não conta capacidade.'
            ])
          ]),
        ])
      );
    })();

    const list = (() => {
      const t = el('table');
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Nome']),
        el('th', {}, ['Tipo']),
        el('th', {}, ['Horas/dia']),
        el('th', {}, ['Ativo']),
        el('th', {}, ['Vigência']),
        el('th', {}, ['Ações']),
      ])]));

      const tb = el('tbody');
      const allRes = newestFirst(state.resources||[]);
      const total = allRes.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      uiPagination.resourcesPage = Math.min(Math.max(1, uiPagination.resourcesPage), totalPages);
      const startIdx = (uiPagination.resourcesPage - 1) * PAGE_SIZE;
      const pageItems = allRes.slice(startIdx, startIdx + PAGE_SIZE);

      for (const r of pageItems) {
        const tr = el('tr');
        tr.appendChild(el('td', {}, [el('div', { style:'font-weight:950' }, [r.nome]) ]));
        tr.appendChild(el('td', {}, [r.tipo]));
        tr.appendChild(el('td', {}, [resourceHoursLabel(r)]));
        tr.appendChild(el('td', {}, [r.ativo === false ? 'Não' : 'Sim']));
        const vig = (r.tipo === 'Terceiro') ? `${r.vigencia_inicio?formatDateBR(r.vigencia_inicio):'-'} - ${r.vigencia_fim?formatDateBR(r.vigencia_fim):'-'}` : '-';
        tr.appendChild(el('td', { class:'mono tiny' }, [vig]));

        const edit = () => {
          openResourceEditModal(r);
        };

        const del = () => {
          if (!confirm(`Excluir recurso "${r.nome}"?`)) return;
          dispatch('DELETE_RESOURCE', { id: r.id });
          toast('Recurso excluído.');
        };

        tr.appendChild(el('td', {}, [
          el('div', { class:'actionBtns' }, [
            iconButton('Editar', '✎', '', edit),
            iconButton('Excluir', '🗑', 'danger', del),
          ])
        ]));

        tb.appendChild(tr);
      }

      if (state.resources.length === 0) {
        tb.appendChild(el('tr', {}, [el('td', { colspan:'6', style:'padding:20px;text-align:center;color:var(--muted)' }, ['Nenhum recurso ainda.'])]));
      }

      t.appendChild(tb);

      const pager = buildPager({
        page: uiPagination.resourcesPage,
        totalPages,
        total,
        startIdx,
        shown: pageItems.length,
        onPrev: () => { uiPagination.resourcesPage--; render(); },
        onNext: () => { uiPagination.resourcesPage++; render(); },
        onFirst: () => { uiPagination.resourcesPage = 1; render(); },
        onLast: () => { uiPagination.resourcesPage = totalPages; render(); },
      });

      const right = el('div', { class:'row' }, [
        button('Limpar dados do sistema', 'danger', confirmClearAllData)
      ]);

      const body = el('div', { class:'grid', style:'gap:10px' }, [t, (totalPages>1 ? pager : null)].filter(Boolean));
      return card('Recursos Cadastrados', right, body);
    })();

    return el('div', { class:'grid' }, [form, list]);
  };

  const viewDemands = () => {
    const resMap = resourceById();

    const filteredDemands = (() => {
      return filterDemands({
        status: uiFilters.demandStatus,
        resourceId: uiFilters.demandResourceId,
        dateStart: uiFilters.demandDateStart,
        dateEnd: uiFilters.demandDateEnd,
        titleQuery: getDemandTitleFilter('demands')
      });
    })();

    const form = (() => {
      const titulo = el('input', { placeholder:'Ex: PQ Sistema X', maxlength:String(INPUT_LIMITS.demandTitle), 'data-demand-create-field':'titulo' });
      const predio = el('input', { placeholder:'Ex: Prédio A', maxlength:String(INPUT_LIMITS.building), 'data-demand-create-field':'predio' });
      const { input: focal, control: focalControl } = createFocalPicker({ draftField:true });

      // Responsáveis: busca + chips (mais intuitivo que select multiple/Ctrl)
      const selectedRespIds = new Set();
      const respHoursById = new Map();
      const respStartById = new Map();
      const respEndById = new Map();
      const respDailyById = new Map();
      const respSearch = el('input', { class:'multiSelectInput', placeholder:'Digite o nome do responsável...', 'data-demand-create-field':'responsavelBusca' });
      const respChips = el('div', { style:'display:contents' });
      const respMenu = el('div', { class:'multiSelectMenu' });
      const respBox = el('div', { class:'multiSelectBox' }, [respChips, respSearch]);
      const responsavel = el('div', { class:'multiSelect', title:'Digite para buscar e clique para adicionar responsáveis' }, [
        respBox,
        respMenu
      ]);
      let persistDemandCreateDraft = () => {};

      const getRespName = (id) => (state.resources||[]).find(r => r.id === id)?.nome || id;
      const selectedResponsaveis = () => [...selectedRespIds].filter(Boolean);
      const closeRespMenu = () => responsavel.classList.remove('open');
      const openRespMenu = () => { if (!respSearch.disabled) { responsavel.classList.add('open'); renderRespOptions(); } };
      const isRespBoxAtEnd = () => {
        if (!respBox) return true;
        return (respBox.scrollLeft + respBox.clientWidth) >= (respBox.scrollWidth - 8);
      };
      const restoreRespBoxScroll = (scrollLeft, shouldStayAtEnd=false) => {
        if (!respBox) return;
        respBox.scrollLeft = shouldStayAtEnd ? respBox.scrollWidth : scrollLeft;
      };
      const removeResponsavelChip = (rid) => {
        if (!rid || !selectedRespIds.has(rid)) return;
        const keepScrollLeft = respBox ? respBox.scrollLeft : 0;
        selectedRespIds.delete(rid);
        respHoursById.delete(rid);
        respStartById.delete(rid);
        respEndById.delete(rid);
        respDailyById.delete(rid);
        renderRespChips();
        renderRespOptions();
        restoreRespBoxScroll(keepScrollLeft, false);
        if (selectedRespIds.size === 0) { status.value = 'Mapeada'; syncMapeada(); }
        persistDemandCreateDraft();
      };

      const respAllocList = el('div', { class:'respAllocList' });
      const respAllocPick = el('select', { title:'Selecione o responsável para ajustar a alocação', 'data-demand-create-field':'horasResponsavel' });
      const respAllocStartEditor = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31`, title:'Data de atuação inicial do responsável', 'data-demand-create-field':'inicioAlocacaoSelecionada' });
      const respAllocEndEditor = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31`, title:'Data de atuação final do responsável', 'data-demand-create-field':'fimAlocacaoSelecionada' });
      const respAllocHoursEditor = el('input', { type:'text', inputmode:'decimal', placeholder:'Ex: 03:30', title:'Horas alocadas por dia para o responsável', 'data-demand-create-field':'horasValor' });
      const respAllocEditor = el('div', { class:'respAllocEditor is-empty' }, [
      el('div', { class:'respAllocEditorField' }, [el('label', {}, ['Responsável']), respAllocPick]),
      el('div', { class:'respAllocEditorField' }, [el('label', {}, ['Início da atuação / alteração de carga']), respAllocStartEditor]),
      el('div', { class:'respAllocEditorField' }, [el('label', {}, ['Data de atuação final']), respAllocEndEditor]),
      el('div', { class:'respAllocEditorField' }, [el('label', {}, ['Horas alocadas']), respAllocHoursEditor]),
    ]);
      const syncRespAllocEditor = () => {
        const rid = String(respAllocPick.value || '');
        respAllocHoursEditor.value = rid ? decimalHoursToHHMM(respHoursById.get(rid) ?? resourceHoursById(rid, state.resources || [])) : '';
        respAllocStartEditor.value = rid ? (respStartById.get(rid) || ini.value) : '';
        respAllocEndEditor.value = rid ? (respEndById.get(rid) || fim.value) : '';
        if (rid) respAllocHoursEditor.setAttribute('data-demand-create-rid', rid); else respAllocHoursEditor.removeAttribute('data-demand-create-rid');
      };
      respAllocPick.addEventListener('change', syncRespAllocEditor);
      respAllocStartEditor.addEventListener('input', () => { const rid = String(respAllocPick.value || ''); if (rid) respStartById.set(rid, normalizeDateLikeToISO(respAllocStartEditor.value || '') || respAllocStartEditor.value || ''); persistDemandCreateDraft(); });
      respAllocEndEditor.addEventListener('input', () => { const rid = String(respAllocPick.value || ''); if (!rid) return; respEndById.set(rid, respAllocEndEditor.value); persistDemandCreateDraft(); });
      respAllocHoursEditor.addEventListener('input', () => {
        const rid = String(respAllocPick.value || '');
        if (!rid) return;
        applyAllocationHoursFromDate({ rid, changeFrom: respAllocStartEditor.value, nextHours: parseHoursInput(respAllocHoursEditor.value), respHoursById, respStartById, respEndById, respDailyById, fallbackStart: ini.value, fallbackEnd: fim.value, originalStartOverride: ini.value });
        persistDemandCreateDraft();
      });
      const renderRespChips = () => {
        const keepScrollLeft = respBox ? respBox.scrollLeft : 0;
        respChips.innerHTML = '';
        respAllocList.innerHTML = '';
        const ids = [...selectedRespIds];
        respAllocEditor.classList.toggle('is-empty', !ids.length);
        respAllocList.style.display = ids.length ? 'none' : 'block';
        respAllocPick.innerHTML = '';
        if (!ids.length) {
          respAllocList.appendChild(el('div', { class:'respAllocEmpty' }, ['Adicione um responsável para configurar atuação e horas alocadas.']));
        }
        for (const rid of ids) respAllocPick.appendChild(el('option', { value: rid }, [getRespName(rid)]));
        if (ids.length) {
          const current = ids.includes(respAllocPick.value) ? respAllocPick.value : ids[0];
          respAllocPick.value = current;
          respAllocHoursEditor.value = decimalHoursToHHMM(respHoursById.get(current) ?? resourceHoursById(current, state.resources || []));
          respAllocHoursEditor.setAttribute('data-demand-create-rid', current);
        } else {
          respAllocHoursEditor.value = '';
          respAllocStartEditor.value = '';
          respAllocEndEditor.value = '';
          respAllocHoursEditor.removeAttribute('data-demand-create-rid');
        }
        syncRespAllocEditor();
        for (const rid of selectedRespIds) {
          const chip = el('span', { class:'multiSelectChip', 'data-rid': rid }, [
            el('span', {}, [getRespName(rid)]),
            el('button', { type:'button', title:'Remover responsável', 'data-remove-rid': rid }, ['×'])
          ]);
          const btnRemove = chip.querySelector('button');
          btnRemove.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            removeResponsavelChip(rid);
          });
          btnRemove.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
          });
          respChips.appendChild(chip);
        }
        restoreRespBoxScroll(keepScrollLeft, false);
      };
      const addResponsavelChip = (rid) => {
        if (!rid || selectedRespIds.has(rid)) return;
        const keepScrollLeft = respBox ? respBox.scrollLeft : 0;
        const wasAtEnd = isRespBoxAtEnd() && document.activeElement === respSearch;
        selectedRespIds.add(rid);
        if (!respHoursById.has(rid)) respHoursById.set(rid, resourceHoursById(rid, state.resources || []));
        if (!respStartById.has(rid)) respStartById.set(rid, ini.value);
        if (!respEndById.has(rid)) respEndById.set(rid, fim.value);
        if (!respDailyById.has(rid)) respDailyById.set(rid, {});
        respSearch.value = '';
        if (normalizeStatus(status.value) === 'Mapeada') status.value = 'Em andamento';
        syncMapeada();
        renderRespChips();
        renderRespOptions();
        openRespMenu();
        restoreRespBoxScroll(keepScrollLeft, wasAtEnd);
        persistDemandCreateDraft();
      };

      const renderRespOptions = () => {
        const q = (respSearch.value||'').trim().toLowerCase();
        const available = (state.resources||[])
          .filter(r => !selectedRespIds.has(r.id))
          .filter(r => !q || String(r.nome||'').toLowerCase().includes(q) || String(r.tipo||'').toLowerCase().includes(q));
        respMenu.innerHTML = '';
        if (!available.length) {
          respMenu.appendChild(el('div', { class:'multiSelectEmpty' }, [q ? 'Nenhum responsável encontrado.' : 'Todos os responsáveis já foram selecionados.']));
          return;
        }
        for (const r of available) {
          const opt = el('button', { type:'button', class:'multiSelectOption', 'data-rid': r.id }, [`${r.nome}${r.tipo==='Terceiro' ? ' (Terceiro)' : ''}`]);
          respMenu.appendChild(opt);
        }
      };

      respMenu.addEventListener('mousedown', (ev) => {
        const opt = ev.target.closest('.multiSelectOption');
        if (!opt) return;
        ev.preventDefault();
        ev.stopPropagation();
        addResponsavelChip(opt.getAttribute('data-rid'));
      });

      respSearch.addEventListener('input', () => { openRespMenu(); });
      respSearch.addEventListener('focus', openRespMenu);
      respSearch.addEventListener('keydown', (ev) => {
        if (ev.key === 'Backspace' && !respSearch.value && selectedRespIds.size) {
          const last = [...selectedRespIds].at(-1);
          removeResponsavelChip(last);
        }
        if (ev.key === 'Escape') closeRespMenu();
      });
      responsavel.addEventListener('mousedown', (ev) => {
        if (ev.target.closest('.multiSelectOption')) return;
        if (ev.target.closest('[data-remove-rid]')) return;
        if (ev.target.closest('.multiSelectChip')) return;
        if (respSearch.disabled) return;
        setTimeout(() => { try { respSearch.focus(); openRespMenu(); } catch {} }, 0);
      });
      document.addEventListener('mousedown', (ev) => { if (!responsavel.contains(ev.target)) closeRespMenu(); });

      const ini = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31`, 'data-demand-create-field':'dataInicio' });
      const fim = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31`, 'data-demand-create-field':'dataFim' });
      const prioridade = el('select', { 'data-demand-create-field':'prioridade' }, [
        el('option', { value:'Baixa' }, ['Baixa']),
        el('option', { value:'Média' }, ['Média']),
        el('option', { value:'Alta' }, ['Alta']),
        el('option', { value:'Crítica' }, ['Crítica']),
      ]);
      const status = el('select', { 'data-demand-create-field':'status' }, [
        el('option', { value:'Em andamento' }, ['Em andamento']),
        el('option', { value:'Concluída' }, ['Concluída']),
        el('option', { value:'Mapeada' }, ['Mapeada (sem responsável)']),
        el('option', { value:'Congelada' }, ['Congelada']),
      ]);
      const obs = el('textarea', { placeholder:'Observações...', maxlength:String(INPUT_LIMITS.demandNotes), 'data-demand-create-field':'observacoes' });

      const syncMapeada = () => {
        const st = normalizeStatus(status.value);
        if (st === 'Mapeada') {
          selectedRespIds.clear();
          respHoursById.clear();
          respSearch.value = '';
          // Mantém o campo habilitado: se o usuário clicar em um responsável,
          // o status muda automaticamente para Em andamento. Isso evita depender
          // de Ctrl e evita o bloqueio visual do campo.
          respSearch.disabled = false;
          responsavel.classList.remove('disabled');
        } else {
          respSearch.disabled = false;
          responsavel.classList.remove('disabled');
        }
        renderRespChips();
        renderRespOptions();
      };
      persistDemandCreateDraft = () => saveDemandCreateDraft({
        titulo: titulo.value,
        predio: predio.value,
        focal: focal.value,
        data_inicio: ini.value,
        data_fim: fim.value,
        prioridade: prioridade.value,
        status: normalizeStatus(status.value),
        observacoes: obs.value,
        responsavelIds: selectedResponsaveis(),
        respHoursById: Object.fromEntries([...respHoursById].map(([rid, horas]) => [rid, Number(horas || 0)])),
        respStartById: Object.fromEntries([...respStartById]),
        respEndById: Object.fromEntries([...respEndById]),
        respDailyById: Object.fromEntries([...respDailyById].map(([rid, daily]) => [rid, normalizeAllocationDailyHours(daily)])),
      });

      const restoreDemandCreateDraft = (draft) => {
        const d = normalizeDemandCreateDraft(draft);
        if (!hasMeaningfulDemandCreateDraft(d)) return false;
        titulo.value = d.titulo || '';
        predio.value = d.predio || '';
        focal.value = d.focal || '';
        ini.value = d.data_inicio || '';
        fim.value = d.data_fim || '';
        prioridade.value = ['Baixa','Média','Alta','Crítica'].includes(d.prioridade) ? d.prioridade : 'Média';
        status.value = d.status || (d.responsavelIds.length ? 'Em andamento' : 'Mapeada');
        obs.value = d.observacoes || '';
        selectedRespIds.clear();
        respHoursById.clear();
        for (const rid of d.responsavelIds) {
          selectedRespIds.add(rid);
          respHoursById.set(rid, Number(d.respHoursById?.[rid] ?? resourceHoursById(rid, state.resources || [])));
          respStartById.set(rid, normalizeDateLikeToISO(d.respStartById?.[rid] || '') || d.data_inicio || '');
          respEndById.set(rid, normalizeDateLikeToISO(d.respEndById?.[rid] || '') || d.data_fim || '');
          respDailyById.set(rid, normalizeAllocationDailyHours(d.respDailyById?.[rid] || {}));
        }
        if (selectedRespIds.size && normalizeStatus(status.value) === 'Mapeada') status.value = 'Em andamento';
        syncMapeada();
        return true;
      };

      const draftRestored = restoreDemandCreateDraft(loadDemandCreateDraft());
      status.addEventListener('change', () => { syncMapeada(); persistDemandCreateDraft(); });
      [titulo, predio, focal, ini, fim, prioridade, obs].forEach(field => {
        field.addEventListener('input', persistDemandCreateDraft);
        field.addEventListener('change', persistDemandCreateDraft);
      });
      // default
      if (!draftRestored) {
        status.value = 'Mapeada';
        syncMapeada();
      }

      // Prefill vindo de atalhos (ex.: abrir dia na matriz de janelas e clicar em "Cadastrar demanda")
      if (uiFilters.prefillDemand && !draftRestored) {
        const p = uiFilters.prefillDemand;
        if (p.data_inicio) ini.value = p.data_inicio;
        if (p.data_fim) fim.value = p.data_fim;
        if (p.responsavel_id) {
          selectedRespIds.add(p.responsavel_id);
          status.value = 'Em andamento';
        } else {
          status.value = 'Mapeada';
        }
        syncMapeada();
        persistDemandCreateDraft();
        uiFilters.prefillDemand = null;
      } else if (uiFilters.prefillDemand) {
        uiFilters.prefillDemand = null;
      }

      const submit = () => {
        const tituloVal = titulo.value.trim();
        const predioVal = (predio.value||'').trim();
        const focalVal = (focal.value||'').trim();
        const obsVal = (obs.value || '').trim();

        // Regras: Mapeada = sempre sem responsável; demais status permitem 1 ou mais responsáveis
        let st = normalizeStatus(status.value);
        const respIds = selectedResponsaveis();
        const hasResp = respIds.length > 0;
        if (!hasResp) st = 'Mapeada';
        if (st !== 'Mapeada' && !hasResp) return toast('Selecione um ou mais responsáveis ou marque como Mapeada.');

        // Regra: não é permitido CADASTRAR como Atrasada (status ? automático, quando aplicável)
        if (st === 'Atrasada') return toast('Status Atrasada ? automático. Selecione outro status para cadastrar.');

        const iniVal = (ini.value || '').trim();
        const fimVal = (fim.value || '').trim();
        const demandValidation = validateDemandFields({
          titulo: tituloVal,
          predio: predioVal,
          focal: focalVal,
          data_inicio: iniVal,
          data_fim: fimVal,
          observacoes: obsVal,
          status: st,
        });
        if (demandValidation) return toast(demandValidation);

        const allocations = (st === 'Mapeada')
          ? []
          : respIds.map(rid => ({
            ...makeDemandAllocation(rid, respHoursById.get(rid) ?? resourceHoursById(rid, state.resources || []), state.resources || []),
            data_inicio: normalizeDateLikeToISO(respStartById.get(rid) || '') || iniVal,
            data_fim: normalizeDateLikeToISO(respEndById.get(rid) || '') || fimVal,
            daily_hours: normalizeAllocationDailyHours(respDailyById.get(rid) || {}),
          }));
        const allocValidation = validateDemandAllocationLimits(allocations);
        if (!allocValidation.ok) return toast(allocValidation.msg);
        const basePayload = {
          logical_group_id: generateId('demand-group'),
          titulo: tituloVal,
          predio: predioVal,
          focal: focalVal,
          data_inicio: iniVal,
          data_fim: fimVal,
          baseline_inicio: iniVal,
          baseline_fim: fimVal,
          percentual_diario: Number(allocations[0]?.percentual_diario || 0),
          horas_planejadas_dia: Number(allocations[0]?.horas_planejadas_dia || 0),
          observacoes: obsVal,
          prioridade: prioridade.value,
          status: st,
          reprogramacoes: 0,
          allocations,
          responsavel_id: allocations[0]?.resourceId || '',
        };
        const newDemand = { ...basePayload, id: generateId() };
        dispatch('ADD_DEMAND', newDemand);
        const added = (state.demands || []).some(d => String(d.id) === String(newDemand.id));
        if (!added) return;
        clearDemandCreateDraft();
        titulo.value=''; predio.value=''; selectedRespIds.clear(); respHoursById.clear(); respSearch.value=''; focal.value=''; ini.value=''; fim.value=''; obs.value=''; prioridade.value='Média'; status.value='Mapeada';
        syncMapeada();
        render();
        toast('Demanda adicionada.');
      };

      const resetDemandForm = () => {
        clearDemandCreateDraft();
        titulo.value='';
        predio.value='';
        focal.value='';
        selectedRespIds.clear();
        respHoursById.clear();
        respSearch.value='';
        ini.value='';
        fim.value='';
        obs.value='';
        prioridade.value='Média';
        status.value='Mapeada';
        syncMapeada();
        toast('Formulário de demanda limpo.');
      };

      const right = null;
      const sectionTitle = (num, text) => el('div', { class:'demandCreateSectionTitle' }, [el('span', { class:'step' }, [String(num)]), text]);
      const body = el('div', { class:'demandCreateForm' }, [
        el('div', { class:'demandCreateIntro' }, [
          el('div', {}, [
            el('strong', {}, ['Novo cadastro de demanda']),
            el('span', {}, ['Preencha identificação, planejamento e alocação seguindo um fluxo padronizado.'])
          ]),
          el('span', { class:'pill info' }, ['Rascunho salvo automaticamente'])
        ]),
        el('div', { class:'demandCreateSection' }, [
          sectionTitle(1, 'Identificação'),
          el('div', { class:'demandCreateGrid' }, [
            el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Título']), titulo]),
            el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Prioridade']), prioridade]),
            el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Prédio']), predio]),
            el('div', { class:'field demandCreateField span-6' }, [el('label', {}, ['Focal']), focalControl, el('div', { class:'tiny muted' }, ['Busque usuários cadastrados para evitar nomes digitados aleatoriamente.'])]),
          ])
        ]),
        el('div', { class:'demandCreateSection' }, [
          sectionTitle(2, 'Planejamento'),
          el('div', { class:'demandCreateGrid' }, [
            el('div', { class:'field demandCreateField span-4' }, [el('label', {}, ['Início']), ini]),
            el('div', { class:'field demandCreateField span-4' }, [el('label', {}, ['Fim']), fim]),
            el('div', { class:'field demandCreateField demandStatusField span-4' }, [el('label', {}, ['Status']), status]),
          ])
        ]),
        el('div', { class:'demandCreateSection demandCreateAllocationBox' }, [
          sectionTitle(3, 'Responsáveis e dedicação'),
          el('div', { class:'demandCreateGrid' }, [
            el('div', { class:'field demandCreateField demandRespField span-8' }, [el('label', {}, ['Responsável(is)']), responsavel]),
            el('div', { class:'field demandCreateField demandPercField demandAllocSummaryField span-12' }, [el('label', {}, ['Alocação do responsável']), respAllocEditor, respAllocList]),
          ])
        ]),
        el('div', { class:'demandCreateSection' }, [
          sectionTitle(4, 'Observações'),
          el('div', { class:'demandCreateGrid' }, [
            el('div', { class:'field demandCreateField span-12' }, [el('label', {}, ['Observações']), obs])
          ])
        ]),
        el('div', { class:'demandCreateActions' }, [
          button('Limpar formulário', '', resetDemandForm),
          button('Adicionar demanda', 'primary', submit)
        ])
      ]);
      const c = card('Cadastrar Demanda', right, body);
      c.id = 'demandsFormCard';
      return c;
    })();

    const list = (() => {
      // Filtros (Status + Recurso + Intervalo de datas)
      const statusSel = el('select');
      statusSel.appendChild(el('option', { value:'' }, ['Todos os status']));
      for (const s of STATUS) statusSel.appendChild(el('option', { value:s }, [s]));
      statusSel.value = uiFilters.demandStatus || '';
      statusSel.addEventListener('change', () => { uiFilters.demandStatus = statusSel.value; uiPagination.demandsPage=1; render(); });

      const resSel = el('select');
      resSel.appendChild(el('option', { value:'' }, ['Todos os recursos']));
      resSel.appendChild(el('option', { value:'__NONE__' }, ['Sem responsável (Mapeada)']));
      for (const r of state.resources) resSel.appendChild(el('option', { value:r.id }, [r.nome]));
      resSel.value = uiFilters.demandResourceId || '';
      resSel.addEventListener('change', () => { uiFilters.demandResourceId = resSel.value; uiPagination.demandsPage=1; render(); });

      const titleSearch = el('input', { type:'search', placeholder:'Digite título ou status...' });
      bindDemandTitleSearch(titleSearch, 'demandsDemandTitleSearch', 'demandsPage', 'demands', 'demands');

      const ds = el('input', { type:'date' });
      const de = el('input', { type:'date' });
      ds.value = uiFilters.demandDateStart || '';
      de.value = uiFilters.demandDateEnd || '';
      ds.addEventListener('change', () => { uiFilters.demandDateStart = ds.value || ''; uiPagination.demandsPage=1; render(); });
      de.addEventListener('change', () => { uiFilters.demandDateEnd = de.value || ''; uiPagination.demandsPage=1; render(); });

      const clearAll = () => {
        uiFilters.demandStatus = '';
        uiFilters.demandResourceId = '';
        uiFilters.demandDateStart = '';
        uiFilters.demandDateEnd = '';
        setDemandTitleFilter('demands', '');
        toast('Filtros limpos.');
        uiPagination.demandsPage=1;
        render();
      };

      const filtersBar = el('div', { class:'demandFilters' }, [
        el('div', { class:'field' }, [el('label', {}, ['Status']), statusSel]),
        el('div', { class:'field' }, [el('label', {}, ['Recurso']), resSel]),
        el('div', { class:'field', style:'grid-column:span 2' }, [el('label', {}, ['Pesquisar título/status']), titleSearch]),
        el('div', { class:'field' }, [el('label', {}, ['Data início (filtro)']), ds]),
        el('div', { class:'field' }, [el('label', {}, ['Data fim (filtro)']), de]),
      ]);

      const t = el('table', { class:'demandsTable' });
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Título']),
        el('th', {}, ['Prédio']),
        el('th', {}, ['Focal']),
        el('th', {}, ['Responsável']),
        el('th', {}, ['Período']),
        el('th', {}, ['Horas/dia']),
        el('th', {}, ['Prioridade']),
        el('th', {}, ['Status']),
        el('th', {}, ['Conclusão']),
        el('th', {}, ['Ações']),
      ])]));
      const tb = el('tbody');

      const orderedDemands = newestFirst(filteredDemands);
      const displayDemands = groupDemandsForDisplay(orderedDemands);
      const total = displayDemands.length;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      uiPagination.demandsPage = Math.min(Math.max(1, uiPagination.demandsPage), totalPages);
      const startIdx = (uiPagination.demandsPage - 1) * PAGE_SIZE;
      const pageItems = displayDemands.slice(startIdx, startIdx + PAGE_SIZE);

      for (const d of pageItems) {
        const groupItems = Array.isArray(d.display_demands) && d.display_demands.length ? d.display_demands : [d];
        const respIds = Array.isArray(d.display_responsavel_ids) ? d.display_responsavel_ids : [d.responsavel_id].filter(Boolean);
        const respNames = respIds.length
          ? respIds.map(id => resMap[id]?.nome || id)
          : ['-'];
        const primaryDemand = groupItems[0] || d;
        const tr = el('tr');
        if (effectiveStatus(d) === 'Atrasada') tr.classList.add('overdueRow');
        tr.appendChild(el('td', {}, [el('div', { style:'font-weight:950' }, [d.titulo])]));
        tr.appendChild(el('td', {}, [d.predio||'-']));
        tr.appendChild(el('td', {}, [d.focal||'-']));
        tr.appendChild(el('td', {}, respNames.map((name, idx) => el('div', {}, [idx === respNames.length - 1 ? name : `${name},`]))));
        tr.appendChild(el('td', { class:'mono tiny' }, [`${formatDateBR(d.data_inicio)} - ${formatDateBR(d.data_fim)}`]));
        const allocLabels = activeDemandAllocations(d)
          .map(a => `${resMap[String(a.resourceId || '').trim()]?.nome || String(a.resourceId || '').trim() || '-'}: ${decimalHoursToHHMM(demandAllocationDisplayHours(a, d, state.resources || []))}`);
        tr.appendChild(el('td', {}, [allocLabels.length ? allocLabels.join(' | ') : decimalHoursToHHMM(d.horas_planejadas_dia ?? d.horas_dia ?? 0)]));
        tr.appendChild(el('td', {}, [d.prioridade]));
        tr.appendChild(el('td', {}, [statusPill(d)]));
        const completionInfo = demandCompletionInfo(primaryDemand);
        tr.appendChild(el('td', {}, [completionInfo.isCompleted
          ? el('div', { class:'grid', style:'gap:3px;min-width:170px' }, [
              el('span', { class:`pill ${completionInfo.classification.includes('fora') ? 'bad' : (completionInfo.wasPostponed ? 'warn' : 'good')}` }, [completionInfo.classification]),
              el('span', { class:'tiny muted mono' }, [completionInfo.completionDateBR ? `Em ${completionInfo.completionDateBR}` : 'Data de conclusão não registrada']),
              completionInfo.wasPostponed ? el('span', { class:'tiny muted' }, [`${completionInfo.reprogrammingsCount || 1} postergação(ões)`]) : null
            ].filter(Boolean))
          : el('span', { class:'tiny muted' }, ['-'])
        ]));

        const edit = () => {
          openDemandEditModal(primaryDemand);
        };

        const reprogram = () => {
	        openDemandReprogramModal(primaryDemand);
        };

        const del = () => {
          if (!confirm(`Excluir demanda "${d.titulo}"?`)) return;
          dispatch('DELETE_DEMANDS', {
            ids: groupItems.map(item => item.id).filter(Boolean),
            groupKeys: [d.display_group_key || demandDisplayGroupKey(d)].filter(Boolean),
            logicalGroupIds: [...new Set(groupItems.map(item => item.logical_group_id).filter(Boolean))]
          });
          toast('Demanda excluída.');
        };

        const finalStatus = ['Concluída','Cancelada'].includes(effectiveStatus(d));
        const actionItems = finalStatus
          ? [{ label:'Visualizar', icon:'👁', onClick:() => openDemandEditModal(primaryDemand, { viewOnly:true }) }]
          : [
            { label:'Editar', icon:'✎', onClick:edit },
            { label:'Transferir atuação', icon:'⇄', cls:'primary', onClick:() => openDemandTransferModal(primaryDemand) },
            { label:'Reprogramar', icon:'↻', onClick:reprogram },
            { label:'Concluir', icon:'✓', cls:'primary', onClick:() => openDemandStatusActionModal(primaryDemand, 'Concluída', groupItems) },
            { label:'Cancelar', icon:'✕', cls:'danger', onClick:() => openDemandStatusActionModal(primaryDemand, 'Cancelada', groupItems) },
            { label:'Excluir', icon:'🗑', cls:'danger', onClick:del },
          ];
        tr.appendChild(el('td', {}, [
          el('div', { class:'actionBtns' }, [actionMenuButton(actionItems)])
        ]));
        tb.appendChild(tr);
      }

      if (filteredDemands.length === 0) {
        const msg = (state.demands||[]).length === 0
          ? 'Nenhuma demanda ainda.'
          : (hasAnyDemandFilters() ? 'Nenhuma demanda para estes filtros.' : 'Nenhuma demanda encontrada.');
        tb.appendChild(el('tr', {}, [el('td', { colspan:'10', style:'padding:20px;text-align:center;color:var(--muted)' }, [msg])]));
      }

      t.appendChild(tb);
      const right = hasAnyDemandFilters() ? buildFilterPills({ includeClear:true }) : null;

      const pager = buildPager({
        page: uiPagination.demandsPage,
        totalPages,
        total,
        startIdx,
        shown: pageItems.length,
        onPrev: () => { uiPagination.demandsPage--; render(); },
        onNext: () => { uiPagination.demandsPage++; render(); },
        onFirst: () => { uiPagination.demandsPage = 1; render(); },
        onLast: () => { uiPagination.demandsPage = totalPages; render(); },
      });

      const tableWrap = el('div', { class:'scrollX', style:'padding-bottom:4px' }, [t]);
      const bodyWrap = el('div', { class:'grid', style:'gap:10px' }, [filtersBar, tableWrap, (totalPages>1 ? pager : null)].filter(Boolean));
      const c = card('Demandas', right, bodyWrap);
      c.id = 'demandsListCard';
      return c;
    })();

    const warn = (state.resources.length === 0)
      ? el('div', { class:'warn' }, ['Cadastre pelo menos 1 recurso antes de criar demandas.'])
      : null;

    const root = el('div', { class:'grid' }, [warn, form, list].filter(Boolean));
    // se veio do clique na legenda, faz scroll para a lista e reseta o flag
    if (uiFilters.focusDemandsList) {
      uiFilters.focusDemandsList = false;
      setTimeout(() => {
        const node = document.getElementById('demandsListCard');
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior:'smooth', block:'start' });
      }, 0);
    }

    // se veio de um atalho de cadastro (ex.: modal do dia), faz scroll para o formulário
    if (uiFilters.focusDemandsForm) {
      uiFilters.focusDemandsForm = false;
      setTimeout(() => {
        const node = document.getElementById('demandsFormCard');
        if (node && node.scrollIntoView) node.scrollIntoView({ behavior:'smooth', block:'start' });
      }, 0);
    }
    return root;
  };

  const viewCalendar = () => {
    const resMap = resourceById();

    const form = (() => {
      const res = el('select');
      res.appendChild(el('option', { value:'' }, ['Selecione...']));
      for (const r of state.resources) res.appendChild(el('option', { value:r.id }, [r.nome]));
      const dateStart = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
      const dateEnd = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
      const tipo = el('select', {}, [
        el('option', { value:'Férias' }, ['Férias']),
        el('option', { value:'Reunião' }, ['Reunião']),
        el('option', { value:'Indisponível' }, ['Indisponível']),
      ]);

      const hDate = el('input', { type:'date', min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
      const hDesc = el('input', { placeholder:'Ex: Feriado Municipal', maxlength:String(INPUT_LIMITS.shortNote) });

      const addBlocking = () => {
        if (!res.value) return toast('Selecione um recurso.');
        if (!dateStart.value) return toast('Selecione a data de início.');
        const start = dateStart.value;
        const end = dateEnd.value || dateStart.value;
        const dateValidation = validateDateRangeLimits(start, end, { allowEmpty:false, label:'Bloqueio' });
        if (dateValidation) return toast(dateValidation);

        const startDate = isoToLocalMidnight(start);
        const endDate = isoToLocalMidnight(end);
        if (!startDate || !endDate) return toast('Informe datas válidas para o bloqueio.');

        dispatch('ADD_BLOCKING', {
          id: generateId('block'),
          recurso_id: res.value,
          data: start,
          data_inicio: start,
          data_fim: end,
          tipo: tipo.value,
        });
        uiPagination.blockingsPage = 1;
        dateStart.value='';
        dateEnd.value='';
        toast(start === end ? 'Bloqueio adicionado.' : 'Bloqueio adicionado em uma linha para o período selecionado.');
      };
      const addHoliday = () => {
        if (!hDate.value) return toast('Selecione a data do feriado.');
        const dateValidation = validateDateYearLimit(hDate.value, 'Data do feriado');
        if (dateValidation) return toast(dateValidation);
        const descValidation = validateTextLimit(hDesc.value, 'Descrição do feriado', INPUT_LIMITS.shortNote);
        if (descValidation) return toast(descValidation);
        dispatch('ADD_HOLIDAY', { id: generateId(), data: hDate.value, descricao: (hDesc.value||'').trim() || 'Feriado' });
        uiPagination.holidaysPage = 1;
        hDate.value=''; hDesc.value='';
        toast('Feriado adicionado.');
      };

      return el('div', { class:'grid' }, [
        card('Adicionar Bloqueio', el('div', { class:'row' }, [button('Adicionar', 'primary', addBlocking)]),
          el('div', { class:'row' }, [
            el('div', { class:'field' }, [el('label', {}, ['Recurso']), res]),
            el('div', { class:'field' }, [el('label', {}, ['Data início']), dateStart]),
            el('div', { class:'field' }, [el('label', {}, ['Data fim']), dateEnd]),
            el('div', { class:'field' }, [el('label', {}, ['Tipo']), tipo]),
          ])
        ),
        card('Adicionar Feriado', el('div', { class:'row' }, [button('Adicionar', 'primary', addHoliday)]),
          el('div', { class:'row' }, [
            el('div', { class:'field' }, [el('label', {}, ['Data']), hDate]),
            el('div', { class:'field' }, [el('label', {}, ['Descrição']), hDesc]),
          ])
        )
      ]);
    })();

    const lists = (() => {
      // Paginação: 10 itens por página (Bloqueios e Feriados)

      // ---- Bloqueios
      const blockingsAll = buildBlockingDisplayRows(state.blockings||[]).sort((a,b) => {
        const da = a.start || '';
        const db = b.start || '';
        if (da !== db) return da.localeCompare(db);
        const ra = (resMap[a.resourceId]?.nome || '');
        const rb = (resMap[b.resourceId]?.nome || '');
        if (ra !== rb) return ra.localeCompare(rb);
        return String(a.id||'').localeCompare(String(b.id||''));
      });

      const bTotal = blockingsAll.length;
      const bTotalPages = Math.max(1, Math.ceil(bTotal / CALENDAR_PAGE_SIZE));
      uiPagination.blockingsPage = Math.min(Math.max(1, uiPagination.blockingsPage), bTotalPages);
      const bStartIdx = (uiPagination.blockingsPage - 1) * CALENDAR_PAGE_SIZE;
      const blockings = blockingsAll.slice(bStartIdx, bStartIdx + CALENDAR_PAGE_SIZE);

      const t1 = el('table');
      t1.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Recurso']),
        el('th', {}, ['Data']),
        el('th', {}, ['Tipo']),
        el('th', {}, ['Ações'])
      ])]));

      const btb = el('tbody');
      for (const b of blockings) {
        const tr = el('tr');
        tr.appendChild(el('td', {}, [resMap[b.resourceId]?.nome || '-']));
        tr.appendChild(el('td', { class:'mono tiny' }, [blockingDateLabel(b)]));
        tr.appendChild(el('td', {}, [b.tipo || '-']));
        tr.appendChild(el('td', {}, [
          el('div', { class:'actionBtns' }, [
            iconButton('Excluir', '🗑', 'danger', () => {
              for (const id of (b.ids || [b.id]).filter(Boolean)) dispatch('DELETE_BLOCKING', id);
              toast((b.ids || []).length > 1 ? 'Bloqueios do período removidos.' : 'Bloqueio removido.');
            })
          ])
        ]));
        btb.appendChild(tr);
      }
      if (bTotal === 0) {
        btb.appendChild(el('tr', {}, [el('td', { colspan:'4', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Nenhum bloqueio.'])]));
      }
      t1.appendChild(btb);

      const bPager = (bTotalPages > 1) ? buildPager({
        page: uiPagination.blockingsPage,
        totalPages: bTotalPages,
        total: bTotal,
        startIdx: bStartIdx,
        shown: blockings.length,
        onPrev: () => { uiPagination.blockingsPage--; render(); },
        onNext: () => { uiPagination.blockingsPage++; render(); },
        onFirst: () => { uiPagination.blockingsPage = 1; render(); },
        onLast: () => { uiPagination.blockingsPage = bTotalPages; render(); },
      }) : null;

      const bBody = el('div', { class:'grid', style:'gap:10px' }, [t1, bPager].filter(Boolean));

      // ---- Feriados
      const holidaysAll = (state.holidays||[]).slice().sort((a,b) => {
        const da = a.data || '';
        const db = b.data || '';
        if (da !== db) return da.localeCompare(db);
        return String(a.id||'').localeCompare(String(b.id||''));
      });

      const hTotal = holidaysAll.length;
      const hTotalPages = Math.max(1, Math.ceil(hTotal / CALENDAR_PAGE_SIZE));
      uiPagination.holidaysPage = Math.min(Math.max(1, uiPagination.holidaysPage), hTotalPages);
      const hStartIdx = (uiPagination.holidaysPage - 1) * CALENDAR_PAGE_SIZE;
      const holidays = holidaysAll.slice(hStartIdx, hStartIdx + CALENDAR_PAGE_SIZE);

      const t2 = el('table');
      t2.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', {}, ['Data']),
        el('th', {}, ['Descrição']),
        el('th', {}, ['Ações'])
      ])]));

      const htb = el('tbody');
      for (const h of holidays) {
        const tr = el('tr');
        tr.appendChild(el('td', { class:'mono tiny' }, [formatDateBR(h.data)]));
        tr.appendChild(el('td', {}, [h.descricao]));
        tr.appendChild(el('td', {}, [
          el('div', { class:'actionBtns' }, [
            iconButton('Excluir', '🗑', 'danger', () => {
              dispatch('DELETE_HOLIDAY', h.id);
              toast('Feriado removido.');
            })
          ])
        ]));
        htb.appendChild(tr);
      }
      if (hTotal === 0) {
        htb.appendChild(el('tr', {}, [el('td', { colspan:'3', style:'padding:16px;text-align:center;color:var(--muted)' }, ['Nenhum feriado.'])]));
      }
      t2.appendChild(htb);

      const hPager = (hTotalPages > 1) ? buildPager({
        page: uiPagination.holidaysPage,
        totalPages: hTotalPages,
        total: hTotal,
        startIdx: hStartIdx,
        shown: holidays.length,
        onPrev: () => { uiPagination.holidaysPage--; render(); },
        onNext: () => { uiPagination.holidaysPage++; render(); },
        onFirst: () => { uiPagination.holidaysPage = 1; render(); },
        onLast: () => { uiPagination.holidaysPage = hTotalPages; render(); },
      }) : null;

      const hBody = el('div', { class:'grid', style:'gap:10px' }, [t2, hPager].filter(Boolean));

      return el('div', { class:'grid' }, [
        card(`Bloqueios cadastrados (${bTotal})`, null, bBody),
        card(`Feriados cadastrados (${hTotal})`, null, hBody),
      ]);
    })();

    return el('div', { class:'grid' }, [form, lists]);
  };

  
  const viewWindows = () => {
  // Heatmap gerencial + Próxima Janela Livre

  // Heatmap mensal (Recursos × Meses) + drilldown diário por célula

  // UI state (não persistido)
  if (!uiFilters.windows) {
    uiFilters.windows = {
      start: formatDate(new Date()),
      minFree: 4,
    };
  }

  if (!uiFilters.windowsHeat) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth()+1).padStart(2,'0');
    uiFilters.windowsHeat = {
      startMonth: `${y}-${m}`,
      months: 6,
      metric: 'occupation', // 'occupation' | 'freePct' | 'freeHH'
      view: 'occupation', // 'occupation' | 'capacity_free' | 'bottleneck' | 'idleness'
      // Padrão: mostrar todos e usar paginação (evita confusão de recurso "sumir").
      show: 'all',  // 'top' | 'all'
      topN: 10,
      dynamicOrder: true,
      sortDir: 'asc', // asc = menos livre primeiro
      fixedOrderIds: null,
    };
  }

  const w = uiFilters.windows;
  const wh = uiFilters.windowsHeat;
  wh.show = 'all';
  wh.dynamicOrder = true;

  const toDate = (iso) => {
    if (!iso) return new Date();
    const [y,m,d] = String(iso).split('-').map(Number);
    return new Date(y, (m||1)-1, d||1);
  };

  const addDays = (dateObj, n) => {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + Number(n||0));
    return d;
  };

  const parseMonth = (ym) => {
    const [y,m] = String(ym||'').split('-').map(Number);
    if (!y || !m) {
      const n = new Date();
      return { y:n.getFullYear(), m:n.getMonth() };
    }
    return { y, m: m-1 };
  };

  const fmtMonthLabel = (y, m0) => {
    const d = new Date(y, m0, 1);
    const mon = d.toLocaleString('pt-BR', { month:'short' }).replace('.', '');
    return `${mon}/${String(y).slice(-2)}`;
  };

  const addMonths = (y, m0, delta) => {
    const d = new Date(y, m0, 1);
    d.setMonth(d.getMonth() + Number(delta||0));
    return { y: d.getFullYear(), m: d.getMonth() };
  };

  const monthKey = (y, m0) => `${y}-${String(m0+1).padStart(2,'0')}`;

  const clampMonths = (n) => {
    const v = Math.max(1, Math.min(36, Number(n||6)));
    return isFinite(v) ? v : 6;
  };

  const monthlyWindow = (resourceId, y, m0) => {
    const cacheKey = `${dashboardCapacityCacheVersion}|${String(resourceId || '')}|${Number(y)}|${Number(m0)}`;
    const cached = capacityMonthlyWindowCache.get(cacheKey);
    if (cached) return { ...cached };
    const remember = (result) => {
      capacityMonthlyWindowCache.set(cacheKey, result);
      return { ...result };
    };
    const days = getDaysInMonth(y, m0);
    let cap = 0;
    let alloc = 0;
    let free = 0;
    let daysZero = 0;
    let daysOver = 0;
    let eligibleDays = 0;
    let heTotal = 0;
    let holidaysCount = 0;
    let blockingsCount = 0;

    for (const d of days) {
      const dateStr = formatDate(d);
      const info = freeHoursInfo(resourceId, d);
      const he = overtimeInfo(resourceId, dateStr).total;
      heTotal += Math.max(0, Number(he||0));
      if (isHoliday(dateStr)) holidaysCount += 1;
      if (blockingFor(resourceId, dateStr)) blockingsCount += 1;
      // Fins de semana sem HE não entram no cálculo mensal de capacidade gerencial
      if (info.eligible === false) continue;
      eligibleDays += 1;
      cap += info.capacity;
      alloc += info.allocated;
      free += info.free;
      if (info.free <= 0) daysZero += 1;
      if (info.free < 0) daysOver += 1;
    }

    const pct = cap > 0 ? (free / cap) * 100 : 0;
    const occPct = cap > 0 ? (alloc / cap) * 100 : 0;
    const demandsCount = (getCapacityIndexes().demandsByResourceId.get(String(resourceId || '')) || []).filter(d => {
      const monthStart = `${y}-${String(m0+1).padStart(2,'0')}-01`;
      const lastDay = String(new Date(y, m0+1, 0).getDate()).padStart(2,'0');
      const monthEnd = `${y}-${String(m0+1).padStart(2,'0')}-${lastDay}`;
      return demandAppearsInHeatmapRange(d, monthStart, monthEnd);
    }).length;
    return remember({
      y, m0,
      key: monthKey(y, m0),
      label: fmtMonthLabel(y, m0),
      cap, alloc, free, pct, occPct,
      days: days.length,
      eligibleDays,
      demandsCount,
      heTotal,
      holidaysCount,
      blockingsCount,
      daysZero,
      daysOver,
    });
  };

  const heatClassFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (view === 'capacity_free') {
      if (freePct <= 10) return 'heat-overload';
      if (freePct <= 25) return 'heat-tight';
      if (freePct <= 50) return 'heat-attention';
      if (freePct <= 80) return 'heat-healthy';
      return 'heat-free';
    }
    if (view === 'bottleneck') {
      if (m.daysOver > 0 || occ > 100) return 'heat-overload';
      if (freePct <= 10) return 'heat-overload';
      if (freePct <= 25) return 'heat-tight';
      if (freePct <= 50) return 'heat-attention';
      return 'heat-healthy';
    }
    if (view === 'idleness') {
      if (freePct > 80) return 'heat-free';
      if (freePct > 50) return 'heat-healthy';
      if (freePct > 25) return 'heat-attention';
      return 'heat-neutral';
    }
    // Ocupação gerencial: vermelho=sobrecarga, amarelo/laranja=atenção, verde=saudável, azul=ociosidade
    if (occ > 100 || m.daysOver > 0) return 'heat-overload';
    if (occ >= 85) return 'heat-tight';
    if (occ >= 50) return 'heat-healthy';
    if (occ >= 25) return 'heat-attention';
    return 'heat-free';
  };

  const heatLabelFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (m.daysOver > 0 || occ > 100 || Number(m.free||0) < 0) return 'Sobrecarga';
    if (view === 'capacity_free' || view === 'bottleneck') {
      if (freePct <= 10) return 'Sem janela';
      if (freePct <= 25) return 'Apertado';
      if (freePct <= 50) return 'Atenção';
      if (freePct <= 80) return 'Saudável';
      return 'Ociosidade alta';
    }
    if (view === 'idleness') {
      if (freePct > 80) return 'Ociosidade alta';
      if (freePct > 50) return 'Folga moderada';
      if (freePct > 25) return 'Folga baixa';
      return 'Sem ociosidade relevante';
    }
    if (occ >= 90) return 'Apertado';
    if (occ >= 80) return 'Atenção';
    if (occ >= 50) return 'Saudável';
    return 'Ociosidade alta';
  };

  const heatValueFor = (m, view='occupation') => {
    if (view === 'capacity_free') return Math.max(0, Number(m.pct||0));
    if (view === 'bottleneck') return 100 - Math.max(0, Number(m.pct||0));
    if (view === 'idleness') return Math.max(0, Number(m.pct||0));
    return Math.max(0, Number(m.occPct||0));
  };

  const heatTextFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (view === 'capacity_free') return `${freePct.toFixed(0)}% livre`;
    if (view === 'bottleneck') return `${Math.max(0, 100 - freePct).toFixed(0)} risco`;
    if (view === 'idleness') return `${freePct.toFixed(0)}% livre`;
    return `${occ.toFixed(0)}% ocup.`;
  };

  const heatMainTextFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    const occ = Math.max(0, Number(m.occPct||0));
    if (view === 'capacity_free' || view === 'idleness') return `${Math.max(0, Number(m.free||0)).toFixed(0)}h`;
    if (view === 'bottleneck') return `${Math.max(0, 100 - freePct).toFixed(0)}%`;
    return `${occ.toFixed(0)}%`;
  };

  const heatSubTextFor = (m, view='occupation') => {
    const freePct = Math.max(0, Number(m.pct||0));
    if (view === 'capacity_free' || view === 'idleness') return `${freePct.toFixed(0)}% livre`;
    if (view === 'bottleneck') return `${Math.max(0, Number(m.free||0)).toFixed(0)}h livres`;
    return `${Math.max(0, Number(m.free||0)).toFixed(0)}h livres`;
  };

  const buildMonths = () => {
    const { y, m } = parseMonth(wh.startMonth);
    const list = [];
    const count = clampMonths(wh.months);
    for (let i=0;i<count;i++) {
      const mm = addMonths(y, m, i);
      list.push(mm);
    }
    return list;
  };

  // Drilldown mensal: dias do mês (Horas + % por dia) para um recurso
  const openMonthModal = ({ resourceId, y, m0 } = {}) => {
    const modal = qs('#monthModal');
    const title = qs('#monthModalTitle');
    const sub = qs('#monthModalSub');
    const body = qs('#monthModalBody');

    const res = state.resources.find(r => r.id === resourceId);
    const label = fmtMonthLabel(y, m0);
    title.textContent = `Janelas livres - ${label}`;
    sub.textContent = `${res ? res.nome : 'Recurso'} - Horas + % por dia`;
    body.innerHTML = '';

    const monthInfo = monthlyWindow(resourceId, y, m0);
    const summary = el('div', { class:'row', style:'justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px' }, [
      el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
        el('span', { class:'pill' }, [el('span', { class:'dot bg-ok' }), `Livre: ${monthInfo.free.toFixed(1)}h (${Math.max(0, monthInfo.pct).toFixed(0)}%)`]),
        el('span', { class:'pill' }, [el('span', { class:'dot bg-mid' }), `Cap: ${monthInfo.cap.toFixed(1)}h`]),
        el('span', { class:'pill' }, [el('span', { class:'dot bg-holiday' }), `Alocado: ${monthInfo.alloc.toFixed(1)}h (${Math.max(0, monthInfo.occPct).toFixed(0)}% ocup.)`]),
        el('span', { class:'pill' }, [el('span', { class:'dot bg-he' }), `HE: ${monthInfo.heTotal.toFixed(1)}h`]),
      ]),
      el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
        button('Voltar ao heatmap', '', () => { try{ modal.close(); }catch{ modal.removeAttribute('open'); } })
      ])
    ]);
    body.appendChild(summary);

    const dows = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const dowRow = el('div', { class:'monthDow' }, dows.map(x => el('div', { class:'dow' }, [x])));
    body.appendChild(dowRow);

    const grid = el('div', { class:'monthGrid' });
    grid.addEventListener('click', (ev) => {
      const target = ev.target?.closest ? ev.target : ev.target?.parentElement;
      const cell = target?.closest?.('[data-month-date]');
      if (!cell || !grid.contains(cell)) return;
      const dateStr = cell.getAttribute('data-month-date');
      const day = isoToLocalMidnight(dateStr);
      if (!day) return;
      // Fecha este drilldown e abre detalhes do dia (com CTA de cadastrar demanda)
      try{ modal.close(); }catch{ modal.removeAttribute('open'); }
      openDayDetails(resourceId, day);
    });
    const days = getDaysInMonth(y, m0);
    const firstDow = days[0].getDay(); // 0=Dom
    for (let i=0;i<firstDow;i++) grid.appendChild(el('div', { class:'monthBlank' }, ['']));

    for (const d of days) {
      const dateStr = formatDate(d);
      const info = freeHoursInfo(resourceId, d);
      const pct = (info.capacity > 0) ? (Math.max(0, info.free) / info.capacity) * 100 : 0;
      const hhTxt = `${info.free.toFixed(0)}h`;
      const pctTxt = `${pct.toFixed(0)}%`;
      const heTotal = overtimeInfo(resourceId, dateStr).total;

      const ending = (state.demands||[]).filter(x => {
        if (String(x.data_fim || '') !== dateStr) return false;
        return demandAllocations(x).some(a => String(a.resourceId || '') === String(resourceId || ''));
      });
      const endingCount = ending.length;

      const active = demandsForResourceOnDate(resourceId, dateStr);
      const activeCount = active.length;

      const tipLines = [
        `${res ? res.nome : 'Recurso'} - ${formatDateBR(dateStr)}`,
        `Livre: ${info.free.toFixed(1)}h (${pctTxt}) ? Cap: ${info.capacity.toFixed(1)}h ? Alocado: ${info.allocated.toFixed(1)}h`,
        `Demandas no dia: ${activeCount}${endingCount ? ` ? Termina hoje: ${endingCount}` : ''}`
      ];
      if (endingCount) {
        const names = ending.slice(0,3).map(x => x.titulo).filter(Boolean);
        if (names.length) tipLines.push(`Fim: ${names.join(', ')}${endingCount>3?'?':''}`);
      }
      if (info.free < 0) tipLines.push('? Excedente (overalloc)');
      if (info.capacity === 0) tipLines.push('Dia sem capacidade (feriado/bloqueio/férias/off)');

      let cls = 'monthCell';
      // Classe de cor por % livre (apenas neste modal)
      // Regras:
      // 0% = sem janela (vermelho)
      // 1-33% = janela baixa (laranja)
      // 34-66% = janela média (amarelo)
      // 67-99% = boa janela (verde claro)
      // 100% = totalmente livre (verde destacado)
      const freePct = (info.capacity > 0) ? (Math.max(0, info.free) / info.capacity) * 100 : 0;
      if (freePct <= 0) cls += ' free-0';
      else if (freePct <= 33) cls += ' free-1';
      else if (freePct <= 66) cls += ' free-2';
      else if (freePct < 100) cls += ' free-3';
      else cls += ' free-4';
      if (isHoliday(dateStr)) cls += ' bg-holiday';
     

      // Core Clean v1: funções consolidadas de gráfico/exportação ficam no escopo global.

 if (isWeekend(d)) cls += ' mutedDay';
      if (info.capacity === 0) cls += ' zero';
      if (info.free < 0) cls += ' over';

      const cell = el('div', {
        class: cls,
        title: tipLines.join('\n'),
        'data-month-date': dateStr
      }, [
        el('div', { class:'d mono' }, [String(d.getDate()).padStart(2,'0')]),
        el('div', { class:'hh mono' }, [hhTxt]),
        el('div', { class:'pct mono' }, [pctTxt]),
        (heTotal > 0) ? el('div', { class:'heLine mono' }, [`HE +${fmtHours(heTotal)}h`]) : null,
        endingCount ? el('div', { class:'badgeEnd', title:`${endingCount} demanda(s) termina(m) hoje` }, [`fim: ${endingCount}`]) : null,
      ].filter(Boolean));

      grid.appendChild(cell);
    }
    body.appendChild(grid);
    if (!modal.open) openDialog(modal);
  }
  const freeHoursInfo = (resourceId, dateObj) => CapacityEngine.freeHoursInfo(resourceId, dateObj);

  const findNextWindow = (resourceId) => {
    const start = toDate(w.start);
    const minFree = Math.max(0, Number(w.minFree||0));
    const cacheKey = `${dashboardCapacityCacheVersion}|${String(resourceId || '')}|${formatDate(start)}|${minFree}`;
    if (capacityNextWindowCache.has(cacheKey)) {
      const cached = capacityNextWindowCache.get(cacheKey);
      return cached ? { ...cached } : null;
    }
    const MAX_LOOKAHEAD = 3650; // ~10 anos ("sem limite" na prática, sem travar)
    for (let i=0;i<MAX_LOOKAHEAD;i++) {
      const d = addDays(start, i);
      const info = freeHoursInfo(resourceId, d);
      // s? considera dias com janela de verdade
      if (info.eligible && info.capacity > 0 && info.free >= minFree) {
        const result = { date: info.dateStr, free: info.free };
        capacityNextWindowCache.set(cacheKey, result);
        return { ...result };
      }
    }
    capacityNextWindowCache.set(cacheKey, null);
    return null;
  };

  const months = buildMonths();

  const hint = el('div', { class:'hint tiny' }, [
    el('b', {}, ['Leitura rápida: ']),
    'use o heatmap para enxergar gargalos por mês e a tabela de próxima janela para decidir onde encaixar novas demandas. ',
    el('b', {}, ['Janelas = capacidade remanescente diária. ']),
    'Feriado/Bloqueio/Férias/OFF zeram o dia. Excedente (negativo) é permitido.'
  ]);

  // Heatmap mensal (Recursos × Meses)
  const heatmap = (() => {
    if ((state.resources||[]).length === 0) {
      return card('Heatmap gerencial por recurso (meses)', null, el('div', { class:'warn' }, ['Cadastre recursos para ver o heatmap mensal.']));
    }

    // Build dataset for months on screen
    const perRes = (state.resources||[]).map(r => {
      const ms = months.map(mm => monthlyWindow(r.id, mm.y, mm.m));
      const viewMode = wh.metric || wh.view || 'occupation';
      const score = ms.reduce((a,b)=>a + heatValueFor(b, viewMode), 0) / Math.max(1, ms.length);
      return { r, ms, score };
    });

    // Dynamic ordering
    if (wh.dynamicOrder) {
      const dir = wh.sortDir === 'desc' ? -1 : 1;
      perRes.sort((a,b) => (a.score - b.score) * dir);
    } else if (Array.isArray(wh.fixedOrderIds)) {
      const idx = new Map(wh.fixedOrderIds.map((id,i)=>[id,i]));
      perRes.sort((a,b) => (idx.get(a.r.id) ?? 1e9) - (idx.get(b.r.id) ?? 1e9));
    }
    // Todos os recursos com paginação
    const allRows = (wh.show === 'top') ? perRes.slice(0, Math.max(1, Number(wh.topN||10))) : perRes;

    const HEAT_PAGE_SIZE = 10;
    let heatPage = Math.max(1, Number(uiPagination.windowsHeatPage||1));
    const heatTotalPages = Math.max(1, Math.ceil(allRows.length / HEAT_PAGE_SIZE));
    heatPage = Math.min(heatPage, heatTotalPages);
    uiPagination.windowsHeatPage = heatPage;

    const rows = (wh.show === 'all')
      ? allRows.slice((heatPage-1)*HEAT_PAGE_SIZE, heatPage*HEAT_PAGE_SIZE)
      : allRows;

    // Cores do heatmap agora seguem a legenda executiva (classe por faixa),
    // sem escala verde relativa por página.

    const heatControls = (() => {
      const monthInp = el('input', { type:'month' });
      monthInp.value = wh.startMonth;
      monthInp.addEventListener('change', () => { wh.startMonth = monthInp.value || wh.startMonth; render(); });

      const monthsInp = el('input', { type:'number', min:'1', max:'36', step:'1' });
      monthsInp.value = String(clampMonths(wh.months));
      monthsInp.addEventListener('change', () => { wh.months = clampMonths(monthsInp.value); render(); });

      const metricSel = el('select');
      metricSel.appendChild(el('option', { value:'occupation' }, ['Ocupação']));
      metricSel.appendChild(el('option', { value:'capacity_free' }, ['Capacidade livre']));
      metricSel.appendChild(el('option', { value:'bottleneck' }, ['Risco de gargalo']));
      metricSel.appendChild(el('option', { value:'idleness' }, ['Ociosidade']));
      metricSel.value = wh.metric || wh.view || 'occupation';
      metricSel.addEventListener('change', () => { wh.metric = metricSel.value; wh.view = metricSel.value; render(); });

      const shiftMonth = (dir) => {
        const { y, m } = parseMonth(wh.startMonth);
        const moved = addMonths(y, m, clampMonths(wh.months) * (dir<0?-1:1));
        wh.startMonth = monthKey(moved.y, moved.m);
        render();
      };

      return el('div', { class:'row' }, [
        el('div', { class:'field' }, [el('label', {}, ['Mês inicial']), monthInp]),
        el('div', { class:'field' }, [el('label', {}, ['Meses na tela']), monthsInp]),
        el('div', { class:'field' }, [el('label', {}, ['Visualização']), metricSel]),
        button('◀', 'ghost', () => shiftMonth(-1)),
        button('Hoje', '', () => {
          const n = new Date();
          wh.startMonth = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
          render();
        }),
        button('▶', 'ghost', () => shiftMonth(1)),
      ]);
    })();

    const heatPager = (() => {
      if (wh.show !== 'all') return null;
      const total = allRows.length;
      if (total <= HEAT_PAGE_SIZE) return null;
      const totalPages = Math.max(1, Math.ceil(total / HEAT_PAGE_SIZE));
      const startIdx = (uiPagination.windowsHeatPage-1) * HEAT_PAGE_SIZE;
      const shown = Math.min(HEAT_PAGE_SIZE, Math.max(0, total - startIdx));
      return buildPager({
        page: uiPagination.windowsHeatPage,
        totalPages,
        total,
        startIdx,
        shown,
        onPrev: () => { uiPagination.windowsHeatPage = Math.max(1, uiPagination.windowsHeatPage-1); render(); },
        onNext: () => { uiPagination.windowsHeatPage = Math.min(totalPages, uiPagination.windowsHeatPage+1); render(); },
        onFirst: () => { uiPagination.windowsHeatPage = 1; render(); },
        onLast: () => { uiPagination.windowsHeatPage = totalPages; render(); },
      });
    })();

    const heatTable = (() => {
      const t = el('table', { class:'calTable' });
      t.addEventListener('click', (ev) => {
        const target = ev.target?.closest ? ev.target : ev.target?.parentElement;
        const cell = target?.closest?.('[data-heat-resource-id]');
        if (!cell || !t.contains(cell)) return;
        openMonthModal({
          resourceId: cell.getAttribute('data-heat-resource-id'),
          y: Number(cell.getAttribute('data-heat-year')),
          m0: Number(cell.getAttribute('data-heat-month'))
        });
      });
      const thead = el('thead');
      const trh = el('tr');
      trh.appendChild(el('th', { class:'stickyCol', style:'min-width:240px' }, ['Recurso']));
      for (const mm of months) {
        const key = monthKey(mm.y, mm.m);
        trh.appendChild(el('th', { class:'dayHead', title:key, style:'min-width:70px' }, [
          el('div', { style:'font-weight:950' }, [fmtMonthLabel(mm.y, mm.m)]),
          el('div', { class:'tiny' }, ['mês'])
        ]));
      }
      thead.appendChild(trh);
      t.appendChild(thead);

      const tbody = el('tbody');
      for (const rr of rows) {
        const tr = el('tr');
        tr.appendChild(el('td', { class:'stickyCol' }, [
          el('div', { style:'font-weight:950' }, [rr.r.nome]),
          el('div', { class:'tiny' }, [`${rr.r.tipo} - ${resourceHoursLabel(rr.r)}`])
        ]));

        for (const m of rr.ms) {
          const mode = wh.metric || wh.view || 'occupation';
          const cls = heatClassFor(m, mode);
          const label = heatLabelFor(m, mode);
          const title = `${rr.r.nome} - ${m.label}
Status: ${label}
Ocupação: ${Math.max(0,m.occPct).toFixed(0)}% (${m.alloc.toFixed(1)}h alocadas / ${m.cap.toFixed(1)}h cap.)
Livre: ${m.free.toFixed(1)}h (${Math.max(0,m.pct).toFixed(0)}%)
Dias 0h: ${m.daysZero} - Dias excedidos: ${m.daysOver}`;
          tr.appendChild(el('td', {
            class:`cell clickable heatCell ${cls}`,
            title,
            'data-heat-resource-id': rr.r.id,
            'data-heat-year': String(m.y),
            'data-heat-month': String(m.m0)
          }, [
            el('div', { class:'top' }, [heatMainTextFor(m, mode)]),
            el('div', { class:'sub' }, [heatSubTextFor(m, mode)])
          ]));
        }
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      return el('div', { class:'scrollX' }, [t]);
    })();

    return card('Heatmap gerencial por recurso (meses)', null, el('div', { class:'grid' }, [
      el('div', { class:'tiny muted' }, ['Heatmap executivo: no modo Ocupação, a célula mostra % ocupado e horas livres; vermelho = sobrecarga/sem janela, laranja/amarelo = atenção, verde = saudável e azul = ociosidade alta. Clique em uma célula para detalhar.']),
      el('div', { class:'heatLegend' }, [
        el('span', { class:'heatBadge heat-overload' }, ['Sobrecarga / sem janela']),
        el('span', { class:'heatBadge heat-tight' }, ['Apertado']),
        el('span', { class:'heatBadge heat-attention' }, ['Atenção']),
        el('span', { class:'heatBadge heat-healthy' }, ['Saudável']),
        el('span', { class:'heatBadge heat-free' }, ['Ociosidade alta'])
      ]),
      heatControls,
      heatPager || el('div', { style:'display:none' }),
      heatTable,
    ]));
  })();

  // Próxima Janela Livre (tabela comparativa)
  const nextCards = (() => {
    if (state.resources.length === 0) {
      return el('div', { class:'warn' }, ['Cadastre recursos para ver a próxima janela livre.']);
    }

    const nextStartInput = el('input', { type:'date' });
    nextStartInput.value = w.start;
    nextStartInput.addEventListener('change', () => { w.start = nextStartInput.value || formatDate(new Date()); uiPagination.windowsNextPage = 1; render(); });

    const nextMinFreeInput = el('input', { type:'number', min:'0', max:'24', step:'0.5' });
    nextMinFreeInput.value = String(Number(w.minFree||0));
    nextMinFreeInput.addEventListener('change', () => { w.minFree = Math.max(0, Number(nextMinFreeInput.value||0)); uiPagination.windowsNextPage = 1; render(); });

    const nextControls = el('div', { class:'row' }, [
      el('div', { class:'field' }, [el('label', {}, ['Buscar a partir de']), nextStartInput]),
      el('div', { class:'field compact' }, [el('label', {}, ['Janela mínima']), nextMinFreeInput]),
      button('Hoje', '', () => { w.start = formatDate(new Date()); uiPagination.windowsNextPage = 1; render(); }),
    ]);

    const NEXT_PAGE_SIZE = 10;
    const allResources = (state.resources || []).slice()
      .sort((a,b) => String(a.nome || '').localeCompare(String(b.nome || '')));
    let nextPage = Math.max(1, Number(uiPagination.windowsNextPage||1));
    const nextTotalPages = Math.max(1, Math.ceil(allResources.length / NEXT_PAGE_SIZE));
    nextPage = Math.min(nextPage, nextTotalPages);
    uiPagination.windowsNextPage = nextPage;
    const pageResources = allResources.slice((nextPage-1)*NEXT_PAGE_SIZE, nextPage*NEXT_PAGE_SIZE);
    const resPage = pageResources.map(r => ({ r, found: findNextWindow(r.id) }))
      .sort((a,b) => {
        if (a.found && b.found) return String(a.found.date).localeCompare(String(b.found.date)) || String(a.r.nome||'').localeCompare(String(b.r.nome||''));
        if (a.found) return -1;
        if (b.found) return 1;
        return String(a.r.nome||'').localeCompare(String(b.r.nome||''));
      });

    const tableWrap = el('div', { class:'scrollX' });
    const tbl = el('table', { class:'demandsTable' });
    tbl.appendChild(el('thead', {}, [
      el('tr', {}, ['Recurso','Tipo','Próxima data','Horas livres','Status','Ação'].map(h => el('th', {}, [h])))
    ]));
    const tbody = el('tbody');
    for (const item of resPage) {
      const r = item.r;
      const found = item.found;
      const daysUntil = found ? Math.max(0, Math.round((toDate(found.date).getTime() - toDate(w.start).getTime()) / 86400000)) : null;
      const status = !found
        ? el('span', { class:'pill bad' }, ['Sem janela'])
        : daysUntil <= 7
          ? el('span', { class:'pill info' }, ['Curto prazo'])
          : daysUntil <= 30
            ? el('span', { class:'pill warn' }, ['Médio prazo'])
            : el('span', { class:'pill' }, ['Longo prazo']);
      tbody.appendChild(el('tr', {}, [
        el('td', {}, [el('div', { style:'font-weight:950' }, [r.nome || '-'])]),
        el('td', {}, [String(r.tipo || '-')]),
        el('td', { class:'mono' }, [found ? formatDateBR(found.date) : '-']),
        el('td', { class:'mono' }, [found ? `${found.free.toFixed(1)}h` : '-']),
        el('td', {}, [status]),
        el('td', {}, [
          found ? button('Abrir dia', 'primary', () => openDayDetails(r.id, toDate(found.date))) : el('span', { class:'tiny muted' }, ['-'])
        ]),
      ]));
    }
    tbl.appendChild(tbody);
    tableWrap.appendChild(tbl);
    const pager = (() => {
      if (allResources.length <= NEXT_PAGE_SIZE) return null;
      const total = allResources.length;
      const totalPages = nextTotalPages;
      const startIdx = (uiPagination.windowsNextPage-1) * NEXT_PAGE_SIZE;
      const shown = Math.min(NEXT_PAGE_SIZE, Math.max(0, total - startIdx));
      return buildPager({
        page: uiPagination.windowsNextPage,
        totalPages,
        total,
        startIdx,
        shown,
        onPrev: () => { uiPagination.windowsNextPage = Math.max(1, uiPagination.windowsNextPage-1); render(); },
        onNext: () => { uiPagination.windowsNextPage = Math.min(totalPages, uiPagination.windowsNextPage+1); render(); },
        onFirst: () => { uiPagination.windowsNextPage = 1; render(); },
        onLast: () => { uiPagination.windowsNextPage = totalPages; render(); },
      });
    })();

    return card('Próxima janela livre', null, el('div', { class:'grid' }, [
      el('div', { class:'tiny muted' }, ['Lista comparativa ordenada pela data mais próxima em que cada recurso atinge a janela mínima configurada.']),
      nextControls,
      tableWrap,
      pager || el('div', { style:'display:none' }),
    ]));
  })();

  // Hora Extra (HE) ? capacidade pontual (principalmente fins de semana)
  const overtimeCard = (() => {
    const all = Array.isArray(state.overtimes) ? state.overtimes : [];

    const resSel = el('select');
    resSel.appendChild(el('option', { value:'__ALL__' }, ['Todos os recursos']));
    for (const r of (state.resources||[])) resSel.appendChild(el('option', { value:r.id }, [r.nome]));

    const dateInp = el('input', { type:'date' });
    dateInp.value = formatDate(new Date());

    const hoursInp = el('input', { type:'number', min:'0', max:'24', step:'0.5' });
    hoursInp.value = '9';

    const motivoInp = el('input', { type:'text', placeholder:'Motivo (opcional)' });

    const addBtn = button('Adicionar HE', 'primary', () => {
      const date = (dateInp.value||'').trim();
      const horas = Math.max(0, Number(hoursInp.value||0));
      if (!date) return toast('Informe a data da HE.');
      if (!isFinite(horas) || horas <= 0) return toast('Informe as horas da HE (maior que 0).');

      const rid = resSel.value || '__ALL__';
      dispatch('ADD_OVERTIME', {
        id: generateId('he'),
        resourceId: rid,
        date,
        horas,
        motivo: (motivoInp.value||'').trim(),
        createdAt: Date.now(),
      });
      toast('HE adicionada.');
      // limpa motivo para facilitar novos lançamentos
      motivoInp.value = '';
      render();
    });

    const form = el('div', { class:'row' }, [
      el('div', { class:'field' }, [el('label', {}, ['Recurso']), resSel]),
      el('div', { class:'field' }, [el('label', {}, ['Data']), dateInp]),
      el('div', { class:'field' }, [el('label', {}, ['Horas']), hoursInp]),
      el('div', { class:'field', style:'flex:1' }, [el('label', {}, ['Motivo']), motivoInp]),
      addBtn,
    ]);

    const list = (() => {
      if (all.length === 0) return el('div', { class:'muted tiny' }, ['Nenhuma HE cadastrada.']);
      const sorted = all.slice().sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.resourceId||'').localeCompare(String(b.resourceId||'')));
      const wrap = el('div', { class:'scrollX' });
      const tbl = el('table', { class:'demandsTable' });
      const thead = el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Data']),
          el('th', {}, ['Recurso']),
          el('th', {}, ['Horas']),
          el('th', {}, ['Motivo']),
          el('th', {}, ['']),
        ])
      ]);
      tbl.appendChild(thead);
      const tbody = el('tbody');
      for (const ot of sorted) {
        const rid = ot.resourceId || '__ALL__';
        const rname = rid === '__ALL__' ? 'Todos' : (state.resources||[]).find(r=>r.id===rid)?.nome || rid;
        const tr = el('tr', {}, [
          el('td', { class:'mono' }, [formatDateBR(ot.date)]),
          el('td', {}, [rname]),
          el('td', { class:'mono' }, [`${Number(ot.horas||0).toFixed(1)}h`]),
          el('td', { class:'tiny muted' }, [String(ot.motivo||'')]),
          el('td', {}, [
            el('div', { class:'actionBtns' }, [
              iconButton('Excluir', '🗑', 'danger', () => { dispatch('DELETE_OVERTIME', { id: ot.id }); render(); toast('HE removida.'); })
            ])
          ])
        ]);
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      wrap.appendChild(tbl);
      return wrap;
    })();

    const note = el('div', { class:'tiny muted' }, [
      'Regra: fins de semana não entram no cálculo de janelas. ',
      el('b', {}, ['HE']),' adiciona capacidade apenas na data/recurso informado.'
    ]);

    return card('Hora Extra (HE) ? fins de semana', null, el('div', { class:'grid' }, [note, form, list]));
  })();

  return el('div', { class:'grid' }, [
    hint,
    heatmap,
    nextCards,
  ]);
};

  const viewInternalActivities = () => {
    const currentUserResource = () => {
      const uid = String(userId || '').trim();
      const nameKey = normalizedPersonName(userName || '');
      return (state.resources || []).find(r => uid && resourceOwnerId(r) === uid)
        || (state.resources || []).find(r => nameKey && normalizedPersonName(r?.nome || r?.name) === nameKey)
        || null;
    };
    const editingActivity = editingInternalActivityId
      ? (state.internalActivities || []).find(a => String(a.id) === String(editingInternalActivityId) && canManageInternalActivity(a))
      : null;
    if (editingInternalActivityId && !editingActivity) editingInternalActivityId = '';
    const isEditing = !!editingActivity;
    const setSelectValue = (selectEl, value) => {
      const v = String(value || '');
      if (!v) return;
      if (![...selectEl.options].some(opt => String(opt.value) === v)) selectEl.appendChild(el('option', { value:v }, [v]));
      selectEl.value = v;
    };

    const internalActivityTypeOptions = [
      el('option', { value:'Reunião administrativa' }, ['Reunião administrativa']),
      el('option', { value:'Treinamento' }, ['Treinamento']),
      el('option', { value:'Leitura/Estudo' }, ['Leitura/Estudo']),
      el('option', { value:'Fórum/Comunidade' }, ['Fórum/Comunidade']),
      el('option', { value:'Curso/Escola técnica' }, ['Curso/Escola técnica']),
	  el('option', { value:'RO' }, ['RO']),
	  el('option', { value:'Arquivo' }, ['Arquivo']),
      el('option', { value:'Reunião' }, ['Reunião']),
      el('option', { value:'Acompanhamento Execução' }, ['Acompanhamento Execução']),
      el('option', { value:'Suporte Execução' }, ['Suporte Execução']),
      el('option', { value:'Administrativa' }, ['Administrativa']),
      el('option', { value:'Apresentação' }, ['Apresentação']),
      el('option', { value:'Indicadores' }, ['Indicadores']),
      el('option', { value:'Treinamento' }, ['Treinamento']),
      el('option', { value:'Auto Inspeção' }, ['Auto Inspeção']),
      el('option', { value:'Inspeção' }, ['Inspeção']),
      el('option', { value:'CTO' }, ['CTO']),
      el('option', { value:'Levantamento' }, ['Levantamento']),
      el('option', { value:'Investigação' }, ['Investigação']),
      el('option', { value:'Suporte de Revisão' }, ['Suporte de Revisão']),
      el('option', { value:'Plenária' }, ['Plenária']),
      el('option', { value:'Repasse de Informações' }, ['Repasse de Informações']),
      el('option', { value:'PMV' }, ['PMV']),
      el('option', { value:'cBPF - Sólidos Não Estéreis' }, ['cBPF - Sólidos Não Estéreis']),
      el('option', { value:'Atualizações' }, ['Atualizações']),
      el('option', { value:'Chegada em atraso' }, ['Chegada em atraso']),
      el('option', { value:'CM' }, ['CM']),
      el('option', { value:'Avaliação' }, ['Avaliação']),
      el('option', { value:'Projetos' }, ['Projetos']),
      el('option', { value:'Procedimento' }, ['Procedimento']),
      el('option', { value:'Matriz de Treinamento' }, ['Matriz de Treinamento']),
      el('option', { value:'Manutenção TI' }, ['Manutenção TI']),
      el('option', { value:'Scanner' }, ['Scanner']),
      el('option', { value:'Matriz de Parâmetros' }, ['Matriz de Parâmetros']),
      el('option', { value:'N/A' }, ['N/A']),
      el('option', { value:'Ponte/Feriado' }, ['Ponte/Feriado']),
      el('option', { value:'Férias' }, ['Férias']),
      el('option', { value:'Saída antecipada' }, ['Saída antecipada']),
      el('option', { value:'Intervalo' }, ['Intervalo']),
      el('option', { value:'Exame Periódico' }, ['Exame Periódico']),
      el('option', { value:'Feedback' }, ['Feedback']),
      el('option', { value:'Meta' }, ['Meta']),
      el('option', { value:'Suporte Técnico' }, ['Suporte Técnico']),
      el('option', { value:'Organização/Montagem de Book' }, ['Organização/Montagem de Book']),
      el('option', { value:'Banco de Horas' }, ['Banco de Horas']),
      el('option', { value:'Ausência de Atividades' }, ['Ausência de Atividades']),
      el('option', { value:'Afastamento Médico' }, ['Afastamento Médico']),
      el('option', { value:'Levantamento de Informações em Campo' }, ['Levantamento de Informações em Campo']),
      el('option', { value:'Planejamento' }, ['Planejamento']),
      el('option', { value:'Reunião sobre Melhorias' }, ['Reunião sobre Melhorias']),
      el('option', { value:'RM' }, ['RM']),
      el('option', { value:'CAP - Ciclo de Alta Performance' }, ['CAP - Ciclo de Alta Performance']),
    ].filter((option, index, options) =>
      options.findIndex(candidate => String(candidate.value) === String(option.value)) === index
    ).sort((a,b) => String(a.textContent || '').localeCompare(String(b.textContent || ''), 'pt-BR', {
      sensitivity:'base',
      numeric:true,
    }));
    const type = el('select', {}, internalActivityTypeOptions);
    const title = el('input', { placeholder:'Título da atividade', value: editingActivity?.titulo || '' });
    const ini = el('input', { type:'date', value: editingActivity?.data_inicio || todayISO() });
    const fim = el('input', { type:'date', value: editingActivity?.data_fim || todayISO() });
    const horas = el('input', { type:'text', inputmode:'decimal', value: isEditing ? decimalHoursToHHMM(editingActivity?.horas_dia || 0) : '01:00', placeholder:'Ex: 01:30 ou 1.5' });
    const obs = el('textarea', { placeholder:'Observações...', maxlength:String(INPUT_LIMITS.demandNotes) }, [editingActivity?.observacoes || '']);
    setSelectValue(type, editingActivity?.tipo);
    const save = () => {
      const activeResource = currentUserResource() || (ensureUserAsResource() ? currentUserResource() : null);
      if (!activeResource?.id) return toast('Não foi possível vincular sua atividade ao seu usuário/recurso. Confira o usuário logado.');
      if (!title.value.trim()) return toast('Informe o título da atividade interna.');
      if (!ini.value || !fim.value || fim.value < ini.value) return toast('Período inválido.');
      const hh = parseHoursInput(horas.value);
      if (!Number.isFinite(hh) || hh < 0) return toast('Horas/dia inválidas.');
      if (hh > 24) return toast('Horas/dia não pode ser maior que 24h.');
      const base = isEditing ? { ...editingActivity } : { id: generateId('ia') };
      const payload = {
        ...base,
        resourceId: isEditing ? (editingActivity.resourceId || activeResource.id) : activeResource.id,
        tipo: type.value,
        titulo: title.value.trim(),
        data_inicio: ini.value,
        data_fim: fim.value,
        horas_dia: hh,
        contabiliza_capacidade: true,
        observacoes: obs.value || '',
        owner_user_id: editingActivity?.owner_user_id || editingActivity?.ownerUserId || userId || '',
        owner_user_name: editingActivity?.owner_user_name || editingActivity?.ownerUserName || userName || 'Sessão local',
        created_by_id: editingActivity?.created_by_id || editingActivity?.createdById || userId || '',
        created_by: editingActivity?.created_by || editingActivity?.createdBy || userName || 'Sessão local',
      };
      dispatch(isEditing ? 'UPDATE_INTERNAL_ACTIVITY' : 'ADD_INTERNAL_ACTIVITY', payload);
      editingInternalActivityId = '';
      uiPagination.internalActivitiesPage = 1;
      render();
    };
    const allRows = (state.internalActivities||[])
      .filter(canViewInternalActivityDetails)
      .slice()
      .sort((a,b)=>String(b.data_inicio||'').localeCompare(String(a.data_inicio||'')));
    const total = allRows.length;
    const totalPages = Math.max(1, Math.ceil(total / INTERNAL_ACTIVITY_PAGE_SIZE));
    uiPagination.internalActivitiesPage = Math.min(Math.max(1, Number(uiPagination.internalActivitiesPage||1)), totalPages);
    const startIdx = (uiPagination.internalActivitiesPage - 1) * INTERNAL_ACTIVITY_PAGE_SIZE;
    const rows = allRows.slice(startIdx, startIdx + INTERNAL_ACTIVITY_PAGE_SIZE);
    const shown = rows.length;
    const pager = total > INTERNAL_ACTIVITY_PAGE_SIZE ? buildPager({
      page: uiPagination.internalActivitiesPage,
      totalPages,
      total,
      startIdx,
      shown,
      onPrev: () => { uiPagination.internalActivitiesPage = Math.max(1, uiPagination.internalActivitiesPage-1); render(); },
      onNext: () => { uiPagination.internalActivitiesPage = Math.min(totalPages, uiPagination.internalActivitiesPage+1); render(); },
      onFirst: () => { uiPagination.internalActivitiesPage = 1; render(); },
      onLast: () => { uiPagination.internalActivitiesPage = totalPages; render(); },
    }) : null;
    const table = el('table');
    table.appendChild(el('thead', {}, [el('tr', {}, ['Tipo','Título','Período','Horas/dia','Ação'].map(h=>el('th',{},[h])))]));
    const tb = el('tbody');
    for (const a of rows) {
      const tr = el('tr');
      tr.appendChild(el('td',{},[String(a.tipo||'')]));
      tr.appendChild(el('td',{},[String(a.titulo||'')]));
      tr.appendChild(el('td',{},[`${formatDateBR(a.data_inicio)} - ${formatDateBR(a.data_fim)}`]));
      tr.appendChild(el('td',{},[`${Number(a.horas_dia||0).toFixed(1)}h`]));
      tr.appendChild(el('td',{},[el('div',{class:'actionBtns'},[
        button('Editar','',()=>{
          if (!canManageInternalActivity(a)) return toast('Você só pode editar atividades internas lançadas por você.');
          editingInternalActivityId = a.id;
          render();
        }),
        button('Excluir','danger',()=>{
          if (!canManageInternalActivity(a)) return toast('Você só pode excluir atividades internas lançadas por você.');
          if (String(editingInternalActivityId) === String(a.id)) editingInternalActivityId = '';
          dispatch('DELETE_INTERNAL_ACTIVITY', a.id);
          render();
        })
      ])]));
      tb.appendChild(tr);
    }
    if (!rows.length) tb.appendChild(el('tr',{},[el('td',{colspan:'5',style:'padding:16px;text-align:center;color:var(--muted)'},['Nenhuma atividade interna sua cadastrada.'])]));
    table.appendChild(tb);
    const internalActivityPanel = el('div',{class:'grid'},[
      card(isEditing ? 'Editar atividade interna' : 'Cadastrar atividade interna', null, el('div',{class:'grid'},[
        el('div', { class:'tiny muted' }, ['As atividades internas são vinculadas automaticamente ao usuário atual; o campo Recurso fica oculto nesta tela.']),
        el('div',{class:'row'},[
          el('div',{class:'field'},[el('label',{},['Tipo']), type]),
          el('div',{class:'field',style:'flex:1;min-width:240px'},[el('label',{},['Título']), title]),
        ]),
        el('div',{class:'row'},[
          el('div',{class:'field'},[el('label',{},['Início']), ini]),
          el('div',{class:'field'},[el('label',{},['Fim']), fim]),
          el('div',{class:'field compact'},[el('label',{},['Horas/dia']), horas]),
        ]),
        el('div',{class:'field'},[el('label',{},['Observações']), obs]),
        el('div',{class:'row end'},[
          isEditing ? button('Cancelar edição','',()=>{ editingInternalActivityId = ''; render(); }) : null,
          button(isEditing ? 'Salvar alterações' : 'Adicionar atividade','primary',save)
        ].filter(Boolean)),
      ])),
      card('Atividades internas', null, el('div',{class:'grid'},[
        el('div', { class:'tiny muted' }, ['Privacidade: esta lista mostra apenas as atividades internas lançadas pelo usuário atual; todas as atividades internas entram no acompanhamento de capacidade.']),
        pager,
        el('div',{class:'scrollX'},[table])
      ].filter(Boolean)))
    ]);

    const resourceIds = activeUserResourceIds();
    const today = todayISO();
    const myDayRows = dailyExecutionRows({ dateStr: today, resourceIds, onlyCurrentUser:true })
      .sort((a,b) => (Number(b.planned || 0) - Number(a.planned || 0)) || String(a.demand.titulo || '').localeCompare(String(b.demand.titulo || '')));
    const myDayTotals = summarizeDailyExecutionRows(myDayRows);
    const myInternalToday = (state.internalActivities || [])
      .filter(canViewInternalActivityDetails)
      .filter(a => {
        const ini = normalizeDateLikeToISO(a?.data_inicio || a?.dataInicio || a?.start_date || a?.data || '');
        const fim = normalizeDateLikeToISO(a?.data_fim || a?.dataFim || a?.end_date || ini || a?.data || '') || ini;
        return ini && today >= ini && today <= fim;
      })
      .reduce((acc, a) => acc + Math.max(0, Number(a?.horas_dia || a?.horas || 0)), 0);
    const myMetric = (label, value, hint='') => el('div', { style:'border:1px solid var(--border);border-radius:14px;padding:10px;background:var(--surface)' }, [
      el('div', { class:'tiny muted', style:'text-transform:uppercase;font-weight:950;letter-spacing:.08em' }, [label]),
      el('div', { class:'mono', style:'font-size:19px;font-weight:950;margin-top:5px' }, [value]),
      hint ? el('div', { class:'tiny muted', style:'margin-top:3px' }, [hint]) : null
    ].filter(Boolean));
    const myDayPanel = card('Meu dia', null, el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'tiny muted' }, [`Resumo operacional de hoje (${formatDateBR(today)}). Use como guia para escolher a demanda no lançamento abaixo.`]),
      el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px' }, [
        myMetric('Planejado', `${fmtHours(myDayTotals.planned)}h`, 'demandas de hoje'),
        myMetric('Apontado', `${fmtHours(myDayTotals.real)}h`, `${myDayTotals.apontamentos} apontamento(s)`),
        myMetric('Aderência', `${Math.max(0, myDayTotals.adherence).toFixed(0)}%`, 'executado ÷ planejado'),
        myMetric('Pendente', `${fmtHours(myDayTotals.pending)}h`, 'falta apontar'),
        myMetric('Internas', `${fmtHours(myInternalToday)}h`, 'informativo'),
      ]),
      myDayRows.length ? (() => {
        const pageSize = 3;
        const total = myDayRows.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        uiPagination.myDayPage = Math.min(Math.max(1, uiPagination.myDayPage || 1), totalPages);
        const startIdx = (uiPagination.myDayPage - 1) * pageSize;
        const pageItems = myDayRows.slice(startIdx, startIdx + pageSize);
        const t = el('table');
        t.appendChild(el('thead', {}, [el('tr', {}, ['Demanda','Planejado','Apontado','Saldo'].map(h => el('th', {}, [h])))]));
        const b = el('tbody');
        for (const row of pageItems) {
          const saldo = Number(row.planned || 0) - Number(row.real || 0);
          b.appendChild(el('tr', {}, [
            el('td', {}, [row.demand.titulo || row.demand.id || 'Demanda']),
            el('td', { class:'mono' }, [`${fmtHours(row.planned)}h`]),
            el('td', { class:'mono' }, [`${fmtHours(row.real)}h`]),
            el('td', { class:'mono' }, [saldo >= 0 ? `${fmtHours(saldo)}h` : `+${fmtHours(Math.abs(saldo))}h`]),
          ]));
        }
        for (let i = pageItems.length; i < pageSize; i++) {
          b.appendChild(el('tr', { class:'emptyPagerRow', 'aria-hidden':'true' }, [
            el('td', {}, [' ']),
            el('td', { class:'mono' }, [' ']),
            el('td', { class:'mono' }, [' ']),
            el('td', { class:'mono' }, [' ']),
          ]));
        }
        t.appendChild(b);
        return el('div', { class:'grid', style:'gap:10px' }, [
          el('div', { class:'scrollX' }, [t]),
          totalPages > 1 ? buildPager({
            page: uiPagination.myDayPage,
            totalPages,
            total,
            startIdx,
            shown: pageItems.length,
            onPrev: () => { uiPagination.myDayPage--; render(); },
            onNext: () => { uiPagination.myDayPage++; render(); },
            onFirst: () => { uiPagination.myDayPage = 1; render(); },
            onLast: () => { uiPagination.myDayPage = totalPages; render(); },
          }) : null
        ].filter(Boolean));
      })() : el('div', { class:'hint tiny' }, ['Nenhuma demanda planejada ou apontada hoje para o usuário atual.'])
    ]));
    const launchExecutionDate = dailyExecutionDate || today;
    const launchExecutionRows = resourceIds.length
      ? dailyResourceExecutionRows(launchExecutionDate).filter(row => resourceIds.includes(String(row.resource?.id || '')))
      : [];
    const launchExecutionTotals = {
      planned: launchExecutionRows.reduce((acc, r) => acc + Number(r.planned || 0), 0),
      real: launchExecutionRows.reduce((acc, r) => acc + Number(r.real || 0), 0),
      internal: launchExecutionRows.reduce((acc, r) => acc + Number(r.internalReal || 0), 0),
      apontamentos: launchExecutionRows.reduce((acc, r) => acc + r.items.filter(i => i.type === 'demand').length, 0),
    };
    launchExecutionTotals.adherence = launchExecutionTotals.planned > 0 ? (launchExecutionTotals.real / launchExecutionTotals.planned) * 100 : (launchExecutionTotals.real > 0 ? 100 : 0);
    launchExecutionTotals.pending = Math.max(0, launchExecutionTotals.planned - launchExecutionTotals.real);
    const launchExecutionPct = (value) => `${Math.max(0, Number(value || 0)).toFixed(0)}%`;
    const launchExecutionPanel = card('Execuções Diárias', el('div', { class:'row toolbarAligned', style:'gap:8px;justify-content:flex-end' }, [
      el('div', { class:'field', style:'max-width:160px' }, [el('label', {}, ['Data']), el('input', { type:'date', value:launchExecutionDate, onchange:(ev) => { dailyExecutionDate = ev.target.value || todayISO(); render(); } })]),
      button('Hoje', '', () => { dailyExecutionDate = todayISO(); render(); })
    ]), el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'tiny muted' }, ['Recorte individual do usuário logado: meta diária, executado e aderência dos recursos vinculados à sessão.']),
      !hasUser() ? el('div', { class:'warn' }, ['Defina o usuário no topo da tela para ver sua execução diária individual.']) : null,
      hasUser() && !resourceIds.length ? el('div', { class:'hint tiny' }, ['Nenhum recurso vinculado ao usuário atual.']) : null,
      resourceIds.length ? el('div', { style:'display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px' }, [
        myMetric('Meta', `${fmtHours(launchExecutionTotals.planned)}h`, 'dia selecionado'),
        myMetric('Executado', `${fmtHours(launchExecutionTotals.real)}h`, `${launchExecutionTotals.apontamentos} apontamento(s)`),
        myMetric('Aderência', launchExecutionPct(launchExecutionTotals.adherence), 'executado ÷ meta'),
        myMetric('Pendente', `${fmtHours(launchExecutionTotals.pending)}h`, 'saldo do dia')
      ]) : null,
      launchExecutionRows.length ? el('div', { class:'grid', style:'gap:8px' }, launchExecutionRows.map(row => {
        const maxHours = Math.max(1, Number(row.planned || 0), Number(row.real || 0));
        const plannedW = Math.max(4, Math.round((Number(row.planned || 0) / maxHours) * 100));
        const realW = Math.max(4, Math.round((Number(row.real || 0) / maxHours) * 100));
        const adherence = row.planned > 0 ? (row.real / row.planned) * 100 : (row.real > 0 ? 100 : 0);
        const cardTone = row.planned <= 0 ? 'info' : adherence > 130 ? 'danger' : adherence < 80 ? 'warn' : 'ok';
        const pillTone = cardTone === 'danger' ? 'bad' : cardTone === 'ok' ? 'good' : cardTone;
        const resourceName = row.resource?.nome || row.resource?.name || row.resource?.id || 'Recurso';
        return el('div', {
          class:`resourceExecutionCard tone-${cardTone}`,
          role:'button',
          tabindex:'0',
          title:'Abrir lançamentos do recurso',
          style:'padding:10px;border-radius:14px',
          onclick:() => openDailyResourceLaunchesModal(row, launchExecutionDate),
          onkeydown:(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDailyResourceLaunchesModal(row, launchExecutionDate); } }
        }, [
          el('div', { style:'display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap' }, [
            el('div', { style:'font-weight:950;text-align:left;color:var(--primary)' }, [resourceName]),
            el('span', { class:`pill ${pillTone}` }, [launchExecutionPct(adherence)])
          ]),
          el('div', { style:'display:grid;grid-template-columns:74px 1fr 48px;gap:8px;align-items:center;margin-top:8px' }, [
            el('div', { class:'tiny muted' }, ['Meta']),
            el('div', { class:'resourceBarTrack', style:'height:12px' }, [
              el('div', { class:'resourceBarFill planned', title:`Meta: ${fmtHours(row.planned)}h`, style:`width:${plannedW}%` })
            ]),
            el('div', { class:'mono tiny', style:'text-align:right' }, [`${fmtHours(row.planned)}h`])
          ]),
          el('div', { style:'display:grid;grid-template-columns:74px 1fr 48px;gap:8px;align-items:center;margin-top:6px' }, [
            el('div', { class:'tiny muted' }, ['Exec.']),
            el('div', { class:'resourceBarTrack', style:'height:12px' }, [
              el('div', { class:'resourceBarFill executed', title:`Executado: ${fmtHours(row.real)}h`, style:`width:${realW}%` })
            ]),
            el('div', { class:'mono tiny', style:'text-align:right' }, [`${fmtHours(row.real)}h`])
          ]),
          el('div', { class:'tiny muted', style:'margin-top:7px' }, [`Demandas: ${fmtHours(row.demandReal)}h · Internas: ${fmtHours(row.internalReal)}h`])
        ]);
      })) : (resourceIds.length ? el('div', { class:'hint tiny' }, ['Nenhuma execução encontrada para seus recursos na data selecionada.']) : null)
    ].filter(Boolean)));

    const userDemandRows = (state.demands || [])
      .filter(d => resourceIds.length && demandAssignedResourceIds(d).some(rid => resourceIds.includes(String(rid))))
      .filter(d => !['Concluída','Congelada'].includes(effectiveStatus(d)))
      .slice()
      .sort((a,b) => String(a.data_fim || '').localeCompare(String(b.data_fim || '')) || String(a.titulo || '').localeCompare(String(b.titulo || '')));
    if (!launchDemandId || !userDemandRows.some(d => String(d.id) === String(launchDemandId))) launchDemandId = userDemandRows[0]?.id || '';
    const demandSelect = el('select', {
      onchange: (ev) => { launchDemandId = ev.target.value; editingLaunchApontamentoId = ''; uiPagination.launchDemandApontamentosPage = 1; render(); }
    }, [
      el('option', { value:'' }, [userDemandRows.length ? 'Selecione uma demanda...' : 'Nenhuma demanda aberta vinculada a você'])
    ]);
    const plannedTodayIds = new Set(myDayRows.filter(r => Number(r.planned || 0) > 0).map(r => String(r.demand.id)));
    const appendDemandOption = (parent, d) => {
      const dayRow = myDayRows.find(r => String(r.demand.id) === String(d.id));
      const suffix = dayRow
        ? ` · hoje: ${fmtHours(dayRow.planned)}h plan. / ${fmtHours(dayRow.real)}h apont.`
        : ` · ${effectiveStatus(d)} · ${formatDateBR(d.data_fim)}`;
      parent.appendChild(el('option', { value:d.id }, [`${d.titulo || 'Sem título'}${suffix}`]));
    };
    const plannedGroup = el('optgroup', { label:'Planejadas hoje' });
    const otherGroup = el('optgroup', { label:'Outras demandas abertas' });
    for (const d of userDemandRows) {
      appendDemandOption(plannedTodayIds.has(String(d.id)) ? plannedGroup : otherGroup, d);
    }
    if (plannedGroup.children.length) demandSelect.appendChild(plannedGroup);
    if (otherGroup.children.length) demandSelect.appendChild(otherGroup);
    demandSelect.value = launchDemandId;
    const selectedDemand = userDemandRows.find(d => String(d.id) === String(launchDemandId)) || null;
    const selectedApontamentos = selectedDemand ? normalizeDemandApontamentos(selectedDemand) : [];
    if (editingLaunchApontamentoId && !selectedApontamentos.some(a => String(a.id) === String(editingLaunchApontamentoId))) editingLaunchApontamentoId = '';
    const editingLaunchApontamento = selectedApontamentos.find(a => String(a.id) === String(editingLaunchApontamentoId)) || null;
    const launchApontamentosPageSize = 15;
    const sortedLaunchApontamentos = [...selectedApontamentos].reverse();
    const launchAptTotal = sortedLaunchApontamentos.length;
    const launchAptTotalPages = Math.max(1, Math.ceil(launchAptTotal / launchApontamentosPageSize));
    uiPagination.launchDemandApontamentosPage = Math.min(Math.max(1, Number(uiPagination.launchDemandApontamentosPage || 1)), launchAptTotalPages);
    const launchAptStartIdx = (uiPagination.launchDemandApontamentosPage - 1) * launchApontamentosPageSize;
    const launchAptPageItems = sortedLaunchApontamentos.slice(launchAptStartIdx, launchAptStartIdx + launchApontamentosPageSize);
    const launchAptPager = launchAptTotal > launchApontamentosPageSize ? buildPager({
      page: uiPagination.launchDemandApontamentosPage,
      totalPages: launchAptTotalPages,
      total: launchAptTotal,
      startIdx: launchAptStartIdx,
      shown: launchAptPageItems.length,
      onPrev: () => { uiPagination.launchDemandApontamentosPage--; render(); },
      onNext: () => { uiPagination.launchDemandApontamentosPage++; render(); },
      onFirst: () => { uiPagination.launchDemandApontamentosPage = 1; render(); },
      onLast: () => { uiPagination.launchDemandApontamentosPage = launchAptTotalPages; render(); },
    }) : null;
    const aptData = el('input', { type:'date', value:editingLaunchApontamento?.data || todayISO(), min:`${MIN_APP_YEAR}-01-01`, max:`${MAX_APP_YEAR}-12-31` });
    const aptEtapa = el('select');
    for (const step of PROJECT_STEP_OPTIONS) aptEtapa.appendChild(el('option', { value:step }, [step]));
    aptEtapa.value = normalizeProjectStep(editingLaunchApontamento?.etapa || '') || PROJECT_STEP_OPTIONS[0];
    const aptHoras = el('input', { type:'text', inputmode:'decimal', placeholder:'Ex: 02:30 ou 2.5', value: editingLaunchApontamento ? String(editingLaunchApontamento.horas || '') : '' });
    const aptObs = el('textarea', { placeholder:'Descreva rapidamente a atividade realizada...', maxlength:String(INPUT_LIMITS.shortNote), style:'min-height:92px' }, [editingLaunchApontamento?.observacao || '']);
    const saveDemandLaunch = () => {
      const demand = (state.demands || []).find(d => String(d.id) === String(launchDemandId));
      if (!demand) return toast('Selecione uma demanda para apontar.');
      const nextData = String(aptData.value || '').trim();
      const nextEtapa = normalizeProjectStep(aptEtapa.value);
      const nextHoras = parseApontamentoHours(aptHoras.value);
      const validation = validateApontamentoInput({ data: nextData, etapa: nextEtapa, horas: nextHoras }, demand);
      if (validation) { toast(validation); return; }
      const obsValidation = validateTextLimit(aptObs.value, 'Observação do apontamento', INPUT_LIMITS.shortNote);
      if (obsValidation) { toast(obsValidation); return; }
      const apontamentos = normalizeDemandApontamentos(demand);
      if (editingLaunchApontamentoId) {
        const idx = apontamentos.findIndex(a => String(a.id) === String(editingLaunchApontamentoId));
        if (idx < 0) { toast('Apontamento em edição não encontrado.'); editingLaunchApontamentoId = ''; render(); return; }
        apontamentos[idx] = normalizeApontamento({
          ...apontamentos[idx],
          data: nextData,
          etapa: nextEtapa,
          horas: nextHoras,
          observacao: String(aptObs.value || '').trim(),
          updated_at: Date.now(),
          updated_by: userName || 'Sessão local',
          updated_by_id: userId || '',
        });
      } else {
        apontamentos.push(normalizeApontamento({
          id: generateId('apt'),
          data: nextData,
          etapa: nextEtapa,
          horas: nextHoras,
          observacao: String(aptObs.value || '').trim(),
          usuario: userName || 'Sessão local',
          user_id: userId || '',
          created_at: Date.now(),
          updated_at: Date.now(),
          updated_by: userName || 'Sessão local',
          updated_by_id: userId || '',
        }));
      }
      dispatch('UPDATE_DEMAND', {
        ...demand,
        apontamentos,
        last_edit_by: userName,
        last_edit_at: Date.now(),
        last_edit_justification: editingLaunchApontamentoId ? 'Apontamento alterado pela aba Lançamentos.' : 'Apontamento registrado pela aba Lançamentos.',
      });
      const wasEditing = !!editingLaunchApontamentoId;
      editingLaunchApontamentoId = '';
      uiPagination.launchDemandApontamentosPage = 1;
      toast(wasEditing ? 'Apontamento atualizado.' : 'Apontamento cadastrado.');
      render();
    };
    const selectedMetrics = selectedDemand ? demandExecutionMetrics(selectedDemand, selectedApontamentos) : null;
    const demandLaunchPanel = card('Apontamento de demanda', null, el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'tiny muted' }, ['Selecione uma demanda vinculada ao seu usuário e registre horas realizadas sem sair da aba Lançamentos.']),
      !hasUser() ? el('div', { class:'warn' }, ['Defina o usuário no topo da tela para localizar suas demandas.']) : null,
      el('div', { class:'field' }, [el('label', {}, ['Demanda']), demandSelect]),
      selectedDemand ? el('div', { class:'hint' }, [
        el('b', {}, [selectedDemand.titulo || 'Demanda']),
        el('div', { class:'row', style:'gap:8px;margin-top:8px;flex-wrap:wrap' }, [
          statusPill(selectedDemand),
          el('span', { class:'pill' }, [`Prazo: ${formatDateBR(selectedDemand.data_inicio)} → ${formatDateBR(selectedDemand.data_fim)}`]),
          el('span', { class:'pill info' }, [`Realizado: ${fmtHours(selectedMetrics?.realHours || 0)}h`]),
        ])
      ]) : el('div', { class:'hint' }, ['Nenhuma demanda aberta vinculada ao usuário atual.']),
      selectedDemand ? el('div', { class:'row' }, [
        el('div', { class:'field', style:'min-width:150px;flex:0 0 150px' }, [el('label', {}, ['Data']), aptData]),
        el('div', { class:'field', style:'min-width:180px;flex:0 0 180px' }, [el('label', {}, ['Etapa / atividade']), aptEtapa]),
        el('div', { class:'field compact' }, [el('label', {}, ['Horas gastas']), aptHoras]),
      ]) : null,
      selectedDemand ? el('div', { class:'field' }, [el('label', {}, ['Observação']), aptObs]) : null,
      selectedDemand ? el('div', { class:'row end' }, [
        editingLaunchApontamento ? button('Cancelar edição', '', () => { editingLaunchApontamentoId = ''; render(); }) : null,
        button(editingLaunchApontamento ? 'Salvar alterações' : 'Salvar apontamento', 'primary', saveDemandLaunch)
      ].filter(Boolean)) : null,
      selectedDemand ? el('div', { class:'grid', style:'gap:8px' }, [
        el('div', { class:'tiny muted' }, [`Histórico recente: ${selectedApontamentos.length} apontamento(s) / ${fmtHours((selectedMetrics?.realHours || 0))}h.`]),
        selectedApontamentos.length
          ? el('div', { class:'grid', style:'gap:10px' }, [
            el('div', { style:'display:flex;flex-wrap:wrap;gap:8px;align-items:stretch' }, launchAptPageItems.map(a => el('div', { class:'launchEntryCard', style:`flex:0 0 clamp(280px, calc(20% - 8px), 360px);max-width:100%;box-sizing:border-box;border-color:${String(a.id) === String(editingLaunchApontamentoId) ? 'var(--primary-light)' : 'var(--border)'}` }, [
              el('div', { style:'display:flex;justify-content:space-between;gap:8px;align-items:flex-start' }, [
                el('div', { style:'font-weight:950' }, [`${formatDateBR(a.data)} - ${a.etapa} - ${fmtHours(a.horas || 0)}h`]),
                el('div', { class:'row', style:'gap:6px;flex-wrap:nowrap' }, [
                  iconButton('Editar apontamento', '✎', '', () => { editingLaunchApontamentoId = String(a.id); render(); }),
                  iconButton('Excluir apontamento', '🗑', 'danger', () => {
                    const demand = (state.demands || []).find(d => String(d.id) === String(launchDemandId));
                    if (!demand) return toast('Demanda não encontrada.');
                    const apontamentos = normalizeDemandApontamentos(demand).filter(x => String(x.id) !== String(a.id));
                    dispatch('UPDATE_DEMAND', { ...demand, apontamentos, last_edit_by:userName, last_edit_at:Date.now(), last_edit_justification:'Apontamento excluído pela aba Lançamentos.' });
                    if (String(editingLaunchApontamentoId) === String(a.id)) editingLaunchApontamentoId = '';
                    uiPagination.launchDemandApontamentosPage = 1;
                    toast('Apontamento excluído.');
                    render();
                  })
                ])
              ]),
              el('div', { class:'tiny muted', style:'margin-top:4px' }, [a.observacao || 'Sem observação.']),
              el('div', { class:'tiny muted', style:'margin-top:4px' }, [a.usuario || 'Sessão local'])
            ]))),
            launchAptPager
          ].filter(Boolean))
          : el('div', { style:'padding:14px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:16px;background:var(--surface)' }, ['Nenhum apontamento cadastrado para esta demanda.'])
      ]) : null,
    ].filter(Boolean)));

    const modeSelector = card('Novo lançamento', null, el('div', { class:'grid', style:'gap:12px' }, [
      el('div', { class:'tiny muted' }, ['Centralize aqui os registros do dia: apontamentos de demandas e atividades internas.']),
      el('div', { class:'row', style:'gap:10px' }, [
        button('📝 Apontamento de demanda', launchMode === 'demand' ? 'primary' : '', () => { launchMode = 'demand'; editingInternalActivityId = ''; render(); }),
        button('🧩 Atividade interna', launchMode === 'internal' ? 'primary' : '', () => { launchMode = 'internal'; render(); }),
      ])
    ]));

    return el('div',{class:'grid'},[
      el('div', { class:'launchSummaryGrid' }, [myDayPanel, launchExecutionPanel, modeSelector]),
      launchMode === 'internal' ? internalActivityPanel : demandLaunchPanel
    ]);
  };




  const viewOvertime = () => {
    // Hora Extra (HE) ? capacidade pontual (principalmente fins de semana)
    const overtimeCard = (() => {
      const all = Array.isArray(state.overtimes) ? state.overtimes : [];

      const note = el('div', { class:'tiny muted' }, [
        'Regra: fins de semana não entram no cálculo de janelas. ',
        el('b', {}, ['HE']),' adiciona capacidade apenas na data/recurso informado.'
      ]);

      const toolbar = el('div', { class:'row', style:'justify-content:space-between; align-items:center;' }, [
        el('div', { class:'tiny muted' }, ['Cadastre reforços pontuais por data/recurso.']),
        el('button', { class:'btn primary', type:'button', 'data-action':'he-open' }, ['Adicionar HE'])
      ]);

      const list = (() => {
        if (all.length === 0) return el('div', { class:'muted tiny' }, ['Nenhuma HE cadastrada.']);
        const sorted = all.slice().sort((a,b) => String(a.date).localeCompare(String(b.date)) || String(a.resourceId||'').localeCompare(String(b.resourceId||'')));
        const wrap = el('div', { class:'scrollX' });
        const tbl = el('table', { class:'demandsTable' });
        const thead = el('thead', {}, [
          el('tr', {}, [
            el('th', {}, ['Data']),
            el('th', {}, ['Recurso']),
            el('th', {}, ['Horas']),
            el('th', {}, ['Atividade / Contexto']),
            el('th', {}, ['']),
          ])
        ]);
        tbl.appendChild(thead);
        const tbody = el('tbody');
        for (const ot of sorted) {
          const rid = ot.resourceId || '__ALL__';
          const rname = rid === '__ALL__' ? 'Todos' : (state.resources||[]).find(r=>r.id===rid)?.nome || rid;
          const tr = el('tr', {}, [
            el('td', { class:'mono' }, [formatDateBR(ot.date)]),
            el('td', {}, [rname]),
            el('td', { class:'mono' }, [`${Number(ot.horas||0).toFixed(1)}h`]),
            el('td', {}, [
              el('div', { class:'heBadge', style:'width:max-content' }, [el('span', { class:'sDot' }, []), String(ot.titulo || ot.atividade || ot.motivo || 'Hora extra')]),
              el('div', { class:'tiny muted', style:'margin-top:6px' }, [[ot.predio ? `Prédio: ${ot.predio}` : '', ot.focal ? `Focal: ${ot.focal}` : '', ot.prioridade ? `Prioridade: ${ot.prioridade}` : '', ot.motivo ? `Motivo: ${ot.motivo}` : ''].filter(Boolean).join(' ? ')]),
            ]),
            el('td', {}, [
              el('div', { class:'actionBtns' }, [
                el('button', { class:'btn iconBtn danger', type:'button', title:'Excluir', 'aria-label':'Excluir', 'data-action':'he-delete', 'data-id': String(ot.id||'') }, ['🗑'])
              ])
            ])
          ]);
          tbody.appendChild(tr);
        }
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        return wrap;
      })();

      return card('Hora Extra (HE)', null, el('div', { class:'grid' }, [note, toolbar, list]));
    })();

return el('div', { class:'grid' }, [
      el('div', { class:'hint tiny' }, [
        el('b', {}, ['Hora Extra (HE): ']),
        'cadastre capacidade extra pontual por data/recurso. Útil para liberar fins de semana ou reforços específicos.'
      ]),
      overtimeCard
    ]);
  };
  const viewConsolidation = () => {
    const exportSnapshot = () => {
      const safeName = (userName||'sem_usuario').replace(/[^a-z0-9_-]+/gi,'_');
      const safeId = (userId||'noid').replace(/[^a-z0-9_-]+/gi,'_');
      const fileName = `Planner_Snapshot_${safeName}_${safeId}_${formatDate(new Date())}.json`;
      const out = buildDbExportObject();
      downloadFile(JSON.stringify(out, null, 2), fileName, 'application/json');
      toast('Snapshot exportado.');
    };

    const exportEvents = () => {
      const lines = (state.events||[]).map(e => JSON.stringify(e));
      const safeName = (userName||'sem_usuario').replace(/[^a-z0-9_-]+/gi,'_');
      const safeId = (userId||'noid').replace(/[^a-z0-9_-]+/gi,'_');
      const fileName = `Planner_Events_${safeName}_${safeId}_${formatDate(new Date())}.jsonl`;
      downloadFile(lines.join('\n'), fileName, 'application/json');
      toast('Events exportados.');
    };

    const SNAPSHOT_IMPORT_PASSWORD = "CAPVIEW";

    const requireSnapshotPassword = async () => {
      const pw = prompt("Digite a senha para importar o Snapshot padrão:");
      if (!pw) return false;
      return String(pw) === SNAPSHOT_IMPORT_PASSWORD;
    };

    const loadStateFromText = (txt, mode, fileName, handle=null, fileMeta=null) => {
      const obj = parseSnapshotText(txt);
      const applied = applyImportedSnapshot(obj, { preserveHolidays:true });
      setDbBinding({
        mode,
        name: fileName || '',
        lastLoadedAt: new Date().toISOString(),
        writable: mode === 'rw',
        baselineHash: String(fileMeta?.hash || simpleHash(txt)),
        baselineLastModified: Number(fileMeta?.lastModified || 0),
        baselineSize: Number(fileMeta?.size || String(txt||'').length || 0),
      }, handle, applied);
      clearDbAutoSyncPause();
    };

    const importSnapshot = async (file) => {
      if (!(await requireSnapshotPassword())) {
        toast('Senha inválida. Importação cancelada.');
        return;
      }
      const txt = await readFileText(file);
      const obj = parseSnapshotText(txt);
      applyImportedSnapshot(obj);
      toast('Snapshot importado.');
    };

    const importSnapshotAdd = async (file) => {
      const txt = await readFileText(file);
      const obj = parseSnapshotText(txt);
      mergeSnapshotAdd(obj);
      toast('Snapshot adicionado/mesclado.');
    };

    const importDbReadOnly = async (file) => {
      const txt = await readFileText(file);
      if (capviewEventMode.enabled) disableEventModeForDbLoad();
      loadStateFromText(txt, 'ro', file?.name || 'BD importado', null, getDbFileMeta(file, txt));
      toast('BD importado em somente leitura.');
    };

    const selectDbReadOnlyFallback = () => new Promise((resolve) => {
      const inp = el('input', { type:'file', accept:'.json,application/json', style:'display:none' });
      const cleanup = () => {
        try { inp.remove(); } catch {}
      };
      inp.addEventListener('change', async () => {
        try {
          if (!inp.files || !inp.files[0]) { cleanup(); resolve(false); return; }
          await importDbReadOnly(inp.files[0]);
          cleanup();
          resolve(true);
        } catch (e) {
          console.error(e);
          cleanup();
          alert('Falha ao importar o banco de dados.');
          resolve(false);
        }
      }, { once:true });
      document.body.appendChild(inp);
      inp.click();
    });

    selectDbReadWrite = async () => {
      try {
        if (!canUseFileSystemAccess()) {
          toast('Seu navegador não permite vínculo ler/gravar direto. Abrindo importação em somente leitura.');
          return await selectDbReadOnlyFallback();
        }
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: false,
          types: [{ description:'Arquivos JSON', accept: { 'application/json': ['.json'] } }],
        });
        if (!handle) return false;
        const granted = await ensureHandlePermission(handle, 'readwrite', { prompt:true });
        if (!granted) {
          toast(dbWriteHelpText());
          return false;
        }
        const file = await handle.getFile();
        const txt = await file.text();
        if (capviewEventMode.enabled) disableEventModeForDbLoad();
        loadStateFromText(txt, 'rw', file?.name || handle.name || 'BD selecionado', handle, getDbFileMeta(file, txt));
        toast('BD selecionado em ler/gravar.');
        startDbWatcher();
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
        console.error(e);
        if (isDbHandleRecoverableError(e)) {
          clearDbHandleOnly();
          toast('O navegador invalidou o vínculo com o arquivo. Tente selecionar o JSON novamente.');
          return false;
        }
        alert('Falha ao selecionar o banco de dados.');
        return false;
      }
    };


    const readSelectedDbSnapshot = async ({ expectedHash='', retries=5, delayMs=180 } = {}) => {
      if (!dbFileHandle) throw new Error('Nenhum BD selecionado.');
      let last = null;
      try {
        for (let attempt = 0; attempt <= retries; attempt++) {
          const file = await dbFileHandle.getFile();
          const txt = await file.text();
          const meta = getDbFileMeta(file, txt);
          last = { file, txt, meta };
          if (!expectedHash || meta.hash === expectedHash) return { ...last, matchedExpectedHash: true };
          if (attempt < retries) await sleep(delayMs * (attempt + 1));
        }
        return { ...(last || {}), matchedExpectedHash: false };
      } catch (e) {
        if (isDbHandleRecoverableError(e)) {
          const err = new Error('O arquivo selecionado mudou no disco ou perdeu a permissão desta sessão. Selecione o JSON novamente para continuar.');
          err.name = 'RecoverableDbHandleError';
          err.cause = e;
          throw err;
        }
        throw e;
      }
    };

    const backupRemoteBeforeWrite = async (remoteTxt, reason='manual-save') => {
      try {
          const safeDb = String(dbBinding?.name || 'ORIZON_DB').replace(/[^a-z0-9_.-]+/gi,'_');
        const stamp = new Date().toISOString().replace(/[:.]/g,'-');
        downloadFile(String(remoteTxt || '{}'), `backup_antes_${reason}_${safeDb}_${stamp}.json`, 'application/json');
        return true;
      } catch (e) {
        console.warn('[DB] Falha ao gerar backup antes da gravação:', e);
        return false;
      }
    };

    const writeStateToSelectedDb = async (stateToWrite, opts={}) => {
      const granted = await ensureDbHandlePermission('readwrite', { prompt:true });
      if (!granted) {
        const err = new Error(dbWriteHelpText());
        err.name = 'SecurityError';
        throw err;
      }
      let backupTxt = '';
      try {
        if (opts?.backupBeforeWrite !== false) {
          const currentFile = await dbFileHandle.getFile();
          backupTxt = await currentFile.text();
        }
      } catch (e) {
        console.warn('[DB] Não foi possível ler o arquivo atual para backup:', e);
      }
      const payload = normalizeImportedState(stateToWrite || buildDbExportObject());
      const txtOut = JSON.stringify({
        ...payload,
        schemaVersion: APP_SCHEMA_VERSION,
        meta: {
          ...((payload.meta && typeof payload.meta === 'object') ? payload.meta : {}),
          authorName: userName || '',
          authorUserId: userId || '',
          exportedAt: new Date().toISOString(),
          exportSource: 'ORIZON',
          schemaVersion: APP_SCHEMA_VERSION,
        }
      }, null, 2);
      const expectedHash = simpleHash(txtOut);
      try {
        if (backupTxt && opts?.backupBeforeWrite !== false) await backupRemoteBeforeWrite(backupTxt, opts?.backupReason || 'save');
        // V5.4.1: não chamar getFile() imediatamente antes do createWritable().
        // Em Edge/Chrome, se o JSON foi alterado no disco por outra sessão, essa leitura
        // pode deixar o FileSystemHandle em estado inválido e disparar InvalidStateError.
        const writable = await dbFileHandle.createWritable();
        await writable.write(txtOut);
        await writable.close();
        const latest = await readSelectedDbSnapshot({ expectedHash, retries: 6, delayMs: 220 });
        const latestTxt = String((latest && latest.txt) || txtOut);
        let latestObj = parseSnapshotText(latestTxt);

        // Se outra instância sobrescreveu este write no mesmo intervalo, o hash esperado
        // não aparece. Não assumimos sucesso: tentamos preservar a alteração local com
        // merge imediato usando a baseline conhecida.
        if (latest && latest.matchedExpectedHash === false && opts?.allowRaceRecovery !== false) {
          const baseObj = dbLoadedSnapshot || loadDbBaseline() || latestObj;
          const recovery = mergeStatesThreeWay(baseObj, normalizeImportedState(stateToWrite || buildDbExportObject()), latestObj);
          if (recovery.conflictCount === 0) {
            await sleep(350 + (userDelayHash() % 900));
            return await writeStateToSelectedDb(recovery.merged, {
              backupReason: opts?.backupReason || 'race-recovery',
              backupBeforeWrite:false,
              allowRaceRecovery:false
            });
          }
          pauseDbAutoSync('conflito pós-gravação', `Autosync pausado: ${recovery.conflictCount} conflito(s) após gravação simultânea. Use Mesclar manualmente.`);
          const err = new Error('Conflito pós-gravação simultânea. A fila local foi preservada para mesclagem manual.');
          err.name = 'PostWriteConflictError';
          throw err;
        }

        state = latestObj;
        invalidateDashboardCapacityCache();
        suppressDbAutoSave = true;
        try { persist({ skipAutoSave:true }); }
        finally { suppressDbAutoSave = false; }
        setDbBinding({
          ...dbBinding,
          lastLoadedAt: new Date().toISOString(),
          writable: true,
          baselineHash: String((latest && latest.meta && latest.meta.hash) || expectedHash),
          baselineLastModified: Number((latest && latest.meta && latest.meta.lastModified) || 0),
          baselineSize: Number((latest && latest.meta && latest.meta.size) || String(latestTxt).length || 0),
        }, dbFileHandle, latestObj);
        if (opts?.clearQueue !== false) clearDbOperationQueue();
        dbAutoSavePending = false;
        dbAutoSaveDirtySince = 0;
        render();
        return latestObj;
      } catch (e) {
        if (isDbHandleRecoverableError(e) || e?.name === 'RecoverableDbHandleError') {
          const err = new Error('O vínculo com o arquivo ficou inválido após mudan?a no disco ou restrição do navegador. Selecione o JSON novamente para concluir o salvamento.');
          err.name = 'RecoverableDbHandleError';
          err.cause = e;
          throw err;
        }
        throw e;
      }
    };


    // V5.4.3: guarda anti-sobrescrita rápida.
    // Como o File System Access API não oferece gravação atémica/CAS entre abas/PCs,
    // a proteção ?: pequena janela com atraso determinístico por usuário + releitura
    // imediatamente antes de gravar. Assim, quando duas instâncias salvam quase juntas,
    // uma grava primeiro e a outra detecta a alteração remota e entra no merge.
    const userDelayHash = () => {
      const src = String(userId || userName || 'local');
      let h = 0;
      for (let i=0;i<src.length;i++) h = ((h << 5) - h + src.charCodeAt(i)) | 0;
      return Math.abs(h);
    };

    const autosyncRaceGuardDelay = async () => {
      const base = 450;
      const spread = 1450;
      const jitter = userDelayHash() % spread;
      await sleep(base + jitter);
    };

    const autoMergeAndSaveNow = async (reason='auto') => {
      if (!dbAutoSyncEnabled || !dbFileHandle || dbBinding.mode !== 'rw') return false;
      if (dbAutoSaveRunning && dbAutoSaveStartedAt && (Date.now() - dbAutoSaveStartedAt > 30000)) {
        console.warn('[Autosync] Lock antigo liberado automaticamente.');
        dbAutoSaveRunning = false;
        dbAutoSavePending = false;
      }
      if (dbAutoSaveRunning) { dbAutoSavePending = true; return false; }
      dbAutoSaveRunning = true;
      dbAutoSaveStartedAt = Date.now();
      try {
        dbOperationQueue = loadDbOperationQueue();
        const localObj = getQueuedLocalSnapshot();
        const queueCount = dbOperationQueue.length || (dbAutoSavePending ? 1 : 0);
        if (queueCount) markDbSync(`fila: ${queueCount} operação(?es) pendente(s)`);

        let lastMergedResult = null;
        const maxAttempts = 5;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const remote = await readSelectedDbSnapshot({ retries: 1, delayMs: 160 });
          const remoteObj = parseSnapshotText(remote.txt);
          const baselineHash = String(dbBinding.baselineHash || '');
          const remoteChanged = !!(baselineHash && remote.meta.hash && baselineHash !== remote.meta.hash);
          const baseObj = dbLoadedSnapshot || loadDbBaseline() || remoteObj;

          let candidate = localObj;
          let label = 'salvo automaticamente';

          if (remoteChanged) {
            const mergedResult = mergeStatesThreeWay(baseObj, localObj, remoteObj);
            lastMergedResult = mergedResult;
            if (mergedResult.conflictCount > 0) {
              markDbSync(`conflito pendente: ${mergedResult.conflictCount}`);
              pauseDbAutoSync('conflito real', `Autosync pausado: ${mergedResult.conflictCount} conflito(s) real(is). Use Salvar no BD/Mesclar manualmente.`);
              return false;
            }
            candidate = mergedResult.merged;
            label = mergedResult.autoMergedCount > 0
              ? `fila mesclada automaticamente (${mergedResult.autoMergedCount})`
              : 'fila reprocessada no BD mais atual';
          }

          // Janela segura: evita que duas abas/usuários gravem em cima da mesma baseline.
          await autosyncRaceGuardDelay();
          const beforeWriteRemote = await readSelectedDbSnapshot({ retries: 0 });
          const beforeHash = String(beforeWriteRemote?.meta?.hash || '');
          const originalRemoteHash = String(remote?.meta?.hash || '');
          if (beforeHash && originalRemoteHash && beforeHash !== originalRemoteHash) {
            markDbSync(`outra sessão salvou; reprocessando fila (${attempt}/${maxAttempts})`);
            await sleep(220 + (userDelayHash() % 480));
            continue;
          }

          await writeStateToSelectedDb(candidate, {
            backupReason: remoteChanged ? `queue-merge-${reason}` : `queue-${reason}`,
            backupBeforeWrite:false
          });

          clearDbOperationQueue();
          clearDbAutoSyncPause();
          dbLoadedSnapshot = normalizeDbStateOnly(candidate);
          persistDbBaseline(dbLoadedSnapshot);
          dbAutoSavePending = false;
          dbAutoSaveDirtySince = 0;
          markDbSync(label);
          if (remoteChanged || queueCount > 1) {
            toast(remoteChanged
              ? 'Autosync: fila mesclada e salva no BD mais atual.'
              : 'Autosync: fila salva com segurança.');
          }
          return true;
        }

        markDbSync('fila aguardando janela segura');
        dbAutoSavePending = true;
        toast('Autosync: outra sessão está salvando. Sua alteração ficou na fila e será tentada novamente.');
        return false;
      } catch (e) {
        console.warn('[Autosync] Falha:', e);
        markDbSync('falha no autosync; fila preservada');
        if (e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) {
          // Mantém os dados locais intactos; s? pausa a escrita automática.
          pauseDbAutoSync('vínculo do BD inválido', 'Autosync pausado: selecione o BD novamente. Seus dados locais foram mantidos.');
        }
        return false;
      } finally {
        dbAutoSaveRunning = false;
        dbAutoSaveStartedAt = 0;
        if (dbAutoSavePending && dbAutoSyncEnabled && dbFileHandle && dbBinding.mode === 'rw') {
          dbAutoSavePending = false;
          scheduleDbAutoSave('pending');
        }
      }
    };

    scheduleDbAutoSave = (reason='change') => {
      if (!dbAutoSyncEnabled || !dbFileHandle || dbBinding.mode !== 'rw') return;
      if (dbAutoSaveRunning && dbAutoSaveStartedAt && (Date.now() - dbAutoSaveStartedAt > 20000)) {
        console.warn('[Autosync] Autosave travado por mais de 20s; liberando fila.');
        dbAutoSaveRunning = false;
        dbAutoSaveStartedAt = 0;
        dbAutoSavePending = false;
        markDbSync('fila liberada automaticamente');
      }
      if (dbAutoSaveTimer) clearTimeout(dbAutoSaveTimer);
      dbAutoSaveTimer = setTimeout(() => { dbAutoSaveTimer = null; autoMergeAndSaveNow(reason); }, 1200);
    };

    startDbWatcher = () => {
      if (dbWatcherTimer || !dbFileHandle || dbBinding.mode !== 'rw') return;
      dbWatcherTimer = setInterval(async () => {
        if (!dbAutoSyncEnabled || dbWatcherRunning || dbAutoSaveRunning || !dbFileHandle || dbBinding.mode !== 'rw') return;
        dbWatcherRunning = true;
        try {
          const remote = await readSelectedDbSnapshot({ retries:0 });
          const baselineHash = String(dbBinding.baselineHash || '');
          if (baselineHash && remote.meta.hash && baselineHash !== remote.meta.hash) {
            if (dbAutoSavePending || dbAutoSaveDirtySince || loadDbOperationQueue().length) {
              markDbSync('alteração externa detectada; fila será reprocessada');
              dbAutoSavePending = true;
              scheduleDbAutoSave('watcher-rebase');
            } else {
              const remoteObj = parseSnapshotText(remote.txt);
              suppressDbAutoSave = true;
              try {
                state = remoteObj;
                invalidateDashboardCapacityCache();
                persist({ skipAutoSave:true });
              } finally { suppressDbAutoSave = false; }
              setDbBinding({
                ...dbBinding,
                lastLoadedAt: new Date().toISOString(),
                baselineHash: String(remote.meta.hash || ''),
                baselineLastModified: Number(remote.meta.lastModified || 0),
                baselineSize: Number(remote.meta.size || String(remote.txt||'').length || 0),
              }, dbFileHandle, remoteObj);
              markDbSync('recarregado automaticamente');
              render();
              toast('Autosync: alteração externa carregada.');
            }
          }
        } catch (e) {
          console.warn('[Watcher] Falha:', e);
          if (e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) {
            pauseDbAutoSync('vínculo do BD inválido', 'Autosync pausado: vínculo do BD inválido. Seus dados locais foram mantidos.');
          }
        } finally { dbWatcherRunning = false; }
      }, 3000);
    };

    stopDbWatcher = () => {
      if (dbWatcherTimer) clearInterval(dbWatcherTimer);
      dbWatcherTimer = null;
      dbWatcherRunning = false;
    };

    // --- Modal-based merge conflict resolution --------------------------------
    // Replaces the old prompt()-based approach.  Shows a proper <dialog> so the
    // user can choose Mesclar / Recarregar / Salvar Cópia without the browser
    // blocking-prompt limitation (especially bad on file:// origins).
    const resolveConcurrentSave = (remoteFile, remoteTxt) => new Promise((resolve) => {
      const remoteObj = parseSnapshotText(remoteTxt);
      const localObj  = normalizeImportedState(buildDbExportObject());
      // CORRE??O: Se o baseline não existe, sintetizamos uma base aproximada a partir
      // dos itens que são IDÊNTICOS em local e remoto. Itens iguais em ambos os lados
      // entram na base ? localChanged=false e remoteChanged=false ? são preservados
      // sem conflito. Itens que diferem ficam sem base (b=undefined) ? o merge tenta
      // unir campos. Isso é muito mais seguro que usar remoteObj como base, que fazia
      // os campos locais parecerem "iguais ? base" e silenciosamente descartava as
      // alterações do usuário local.
      const _savedBaseline = dbLoadedSnapshot || loadDbBaseline();
      let baseObj;
      if (_savedBaseline) {
        baseObj = normalizeImportedState(_savedBaseline);
      } else {
        // Sem baseline: constrói base sintética com itens idênticos em local e remoto
        const synth = {};
        for (const key of (DB_COLLECTION_KEYS || [])) {
          const lArr = Array.isArray(localObj[key]) ? localObj[key] : [];
          const rArr = Array.isArray(remoteObj[key]) ? remoteObj[key] : [];
          const rMap = new Map(rArr.map(x => [String(x.id||''), x]));
          synth[key] = lArr.filter(x => {
            const rid = String(x.id||'');
            return rMap.has(rid) && (JSON.stringify(x) === JSON.stringify(rMap.get(rid)));
          });
        }
        baseObj = normalizeImportedState(synth);
      }

      const dlg         = qs('#mergeModal');
      const subEl       = qs('#mergeModalSub');
      const statsEl     = qs('#mergeModalStats');
      const actionsEl   = qs('#mergeModalActions');
      const progressEl  = qs('#mergeModalProgress');
      const resultEl    = qs('#mergeModalResult');

      const btnMerge    = qs('#mergeModalMerge');
      const btnReload   = qs('#mergeModalReload');
      const btnCopy     = qs('#mergeModalCopy');
      const btnCancel   = qs('#mergeModalCancel');

      // Pre-compute a quick diff summary to inform the user
      const localCounts  = DB_COLLECTION_KEYS.map(k => `${k}: ${(localObj[k]||[]).length}`).join(' ? ');
      const remoteCounts = DB_COLLECTION_KEYS.map(k => `${k}: ${(remoteObj[k]||[]).length}`).join(' ? ');
      subEl.textContent = `O BD foi alterado por outra sessão desde que você o abriu. Escolha como proceder:`;
      statsEl.style.display = '';
      statsEl.innerHTML = `
        <div style="display:grid;gap:6px">
          <div><b>Sua versão local:</b> ${localCounts}</div>
          <div><b>Versão do arquivo:</b> ${remoteCounts}</div>
          <div class="tiny muted" style="margin-top:4px">Ao Mesclar, itens novos de ambos os lados são preservados. Campos diferentes do mesmo item são unidos automaticamente. Se os dois alterarem o mesmo campo, o app bloqueia o salvamento para evitar sobrescrita.</div>
        </div>`;

      // Reset UI state
      actionsEl.style.display  = '';
      progressEl.style.display = 'none';
      resultEl.style.display   = 'none';
      resultEl.innerHTML       = '';
      [btnMerge, btnReload, btnCopy, btnCancel].forEach(b => { if (b) b.disabled = false; });

      const closeAndResolve = () => {
        // remove listeners to avoid duplicates on next call
        btnMerge.onclick  = null;
        btnReload.onclick = null;
        btnCopy.onclick   = null;
        btnCancel.onclick = null;
        closeDialog(dlg);
        resolve();
      };

      const setLoading = (msg) => {
        actionsEl.style.display  = 'none';
        progressEl.style.display = '';
        progressEl.textContent   = msg || 'Processando...';
        [btnMerge, btnReload, btnCopy, btnCancel].forEach(b => { if (b) b.disabled = true; });
      };

      const showResult = (msg, isError=false) => {
        progressEl.style.display = 'none';
        resultEl.style.display   = '';
        resultEl.innerHTML       = `<div class="${isError ? 'warn' : 'hint tiny'}" style="font-weight:700">${msg}</div>
          <div style="margin-top:10px"><button class="btn primary" type="button" id="mergeModalOk">Fechar</button></div>`;
        const okBtn = qs('#mergeModalOk', resultEl);
        if (okBtn) okBtn.onclick = closeAndResolve;
      };

      btnMerge.onclick = async () => {
        setLoading('Mesclando versões...');
        try {
          const mergedResult = mergeStatesThreeWay(baseObj, localObj, remoteObj);
          if (mergedResult.conflictCount > 0) {
            const detailLines = (mergedResult.conflicts || []).slice(0, 8).map(c => {
              const keys = [...new Set([...(c.localChangedKeys||[]), ...(c.remoteChangedKeys||[])])].join(', ') || 'sem detalhe';
              const reason = c.reason === 'edit_vs_delete'
                ? 'edição vs exclusão'
                : c.reason === 'duplicate_new_id'
                  ? 'novo item com mesmo ID'
                  : 'mesmo campo alterado';
              return `<li><b>${c.collection}</b> - <span class="mono">${c.id}</span> - ${reason}<br><span class="tiny muted">Campos: ${keys}</span></li>`;
            }).join('');
            const more = mergedResult.conflictCount > 8 ? `<div class="tiny muted" style="margin-top:8px">+ ${mergedResult.conflictCount - 8} conflito(s) adicional(is).</div>` : '';
            showResult(`Mesclagem bloqueada para evitar sobrescrita.<br><span class="tiny">${mergedResult.autoMergedCount} item(ns) foram preparados para mesclagem automática, mas ${mergedResult.conflictCount} conflito(s) exigem revisão manual.</span><div style="margin-top:10px;text-align:left"><ol style="padding-left:18px;margin:0">${detailLines}</ol>${more}</div>`, true);
            toast(`Mesclagem bloqueada: ${mergedResult.conflictCount} conflito(s) real(is) detectado(s).`);
            return;
          }
          setLoading('Gravando no arquivo...');
          await writeStateToSelectedDb(mergedResult.merged, { backupReason:'merge' });
          // Atualiza explicitamente o baseline pós-merge para que o próximo salvamento
          // compare contra a versão mesclada, não contra uma base antiga/local.
          dbLoadedSnapshot = normalizeDbStateOnly(mergedResult.merged);
          persistDbBaseline(dbLoadedSnapshot);
          const r = mergedResult.summary || {};
          const parts = DB_COLLECTION_KEYS
            .filter(k => r[k])
            .map(k => `${k}: ${r[k].merged}`)
            .join(' ? ');
          const autoMsg = mergedResult.autoMergedCount > 0
            ? ` | merge ${mergedResult.autoMergedCount} item(ns) unidos automaticamente.`
            : '';
          showResult(`OK Mesclagem concluída e salva com sucesso!<br><span class="tiny">${parts}${autoMsg}</span>`);
          toast(mergedResult.autoMergedCount > 0
            ? `BD mesclado e salvo com sucesso. ${mergedResult.autoMergedCount} item(ns) unidos automaticamente.`
            : 'BD mesclado e salvo com sucesso.');
        } catch (e) {
          console.error('[Merge] Erro ao mesclar:', e);
          showResult(` Falha na mesclagem: ${e?.message || e}. Tente novamente ou salve uma cópia.`, true);
        }
      };

      btnReload.onclick = () => {
        setLoading('Recarregando BD...');
        try {
          loadStateFromText(remoteTxt, 'rw', remoteFile?.name || dbBinding.name || 'BD selecionado', dbFileHandle, getDbFileMeta(remoteFile, remoteTxt));
          toast('BD recarregado com a versão mais nova do arquivo.');
          closeAndResolve();
        } catch (e) {
          console.error('[Reload] Erro:', e);
          showResult(` Falha ao recarregar: ${e?.message || e}`, true);
        }
      };

      btnCopy.onclick = () => {
        const safeName = (userName||'sem_usuario').replace(/[^a-z0-9_-]+/gi,'_');
        downloadFile(JSON.stringify(localObj, null, 2), `ORIZON_copia_local_${safeName}_${formatDate(new Date())}.json`, 'application/json');
        toast('Cópia local exportada. O arquivo compartilhado não foi alterado.');
        closeAndResolve();
      };

      btnCancel.onclick = () => {
        toast('Salvamento cancelado.');
        closeAndResolve();
      };

      openDialog(dlg);
    });

    const saveToSelectedDb = async (attempt = 0) => {
      if (!dbFileHandle || dbBinding.mode !== 'rw') {
        toast('Nenhum BD em ler/gravar selecionado nesta sessão.');
        return;
      }
      try {
        const granted = await ensureDbHandlePermission('readwrite', { prompt:true });
        if (!granted) {
          toast(dbWriteHelpText());
          return;
        }
        const remote = await readSelectedDbSnapshot();
        const remoteFile = remote.file;
        const remoteTxt = remote.txt;
        const remoteMeta = remote.meta;
        const baselineHash = String(dbBinding.baselineHash || '');
        const unchanged = baselineHash && baselineHash === remoteMeta.hash;
        if (!unchanged) {
          await resolveConcurrentSave(remoteFile, remoteTxt);
          return;
        }
        await writeStateToSelectedDb(buildDbExportObject(), { backupReason:'save' });
        toast('BD salvo no arquivo selecionado.');
      } catch (e) {
        console.error(e);
        if ((e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) && attempt < 1) {
          const recovered = await recoverDbHandleByReselect('O arquivo mudou no disco ou o navegador invalidou a sessão do BD. Selecione o JSON novamente para concluir o salvamento.');
          if (recovered) return await saveToSelectedDb(attempt + 1);
          return;
        }
        alert('Falha ao salvar no BD selecionado. Verifique a permissão do arquivo.');
      }
    };

    const reloadSelectedDb = async (attempt = 0) => {
      if (!dbFileHandle || dbBinding.mode !== 'rw') {
        toast('Nenhum BD em ler/gravar selecionado nesta sessão.');
        return;
      }
      try {
        const remote = await readSelectedDbSnapshot();
        loadStateFromText(remote.txt, 'rw', remote.file?.name || dbBinding.name || 'BD selecionado', dbFileHandle, remote.meta);
        toast('BD recarregado do arquivo selecionado.');
      } catch (e) {
        console.error(e);
        if ((e?.name === 'RecoverableDbHandleError' || isDbHandleRecoverableError(e)) && attempt < 1) {
          const recovered = await recoverDbHandleByReselect('O vínculo com o BD ficou inválido. Selecione o JSON novamente para recarregar.');
          if (recovered) return await reloadSelectedDb(attempt + 1);
          return;
        }
        alert('Falha ao recarregar o BD selecionado.');
      }
    };

    const defineDefaultDb = () => {
      const fileName = 'ORIZON_DB_Modelo.json';
      const out = normalizeImportedState(buildDbExportObject());
      downloadFile(JSON.stringify(out, null, 2), fileName, 'application/json');
      toast('Modelo de BD exportado.');
    };


    const dbStatusPill = (() => {
      let label = 'Nenhum BD vinculado';
      let cls = 'bg-over';
      if (dbBinding.mode === 'rw') { label = 'BD selecionado (ler/gravar)'; cls = 'bg-ok'; }
      else if (dbBinding.mode === 'ro') { label = 'BD importado (somente leitura)'; cls = 'bg-mid'; }
      return el('span', { class:'pill' }, [el('span', { class:`dot ${cls}` }), label]);
    })();

    const dbMeta = el('div', { class:'grid', style:'gap:8px' }, [
      el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
        dbStatusPill,
        dbBinding.name ? el('span', { class:'tag mono' }, [dbBinding.name]) : el('span', { class:'tag' }, ['Sem arquivo selecionado'])
      ]),
      el('div', { class:'tiny muted' }, [
        dbBinding.lastLoadedAt
          ? `Último carregamento: ${new Date(dbBinding.lastLoadedAt).toLocaleString('pt-BR')} - Schema: ${APP_SCHEMA_VERSION} - Base comparativa: ${dbBinding.baselineHash ? dbBinding.baselineHash.slice(0,8) : '-'}`
          : 'Nesta arquitetura, o vínculo ler/gravar vale para a sessão atual do navegador.'
      ]),
      el('div', { class:'tiny muted' }, [`Autosync: ${dbAutoSyncEnabled ? 'ligado' : (dbAutoSyncPauseReason ? 'pausado' : 'desligado')}${dbAutoSyncPauseReason ? ' ? Motivo: ' + dbAutoSyncPauseReason : ''}${dbLastSyncLabel ? ' ? Último sync: ' + dbLastSyncLabel : ''}. O salvamento e a leitura de alterações externas rodam automaticamente quando o BD está selecionado.`])
    ]);

    if (dbAutoSyncEnabled && dbFileHandle && dbBinding.mode === 'rw') startDbWatcher();

    const body = el('div', { class:'grid' }, [
      el('div', { class:'hint tiny' }, [
        el('b', {}, ['Banco JSON direto (avançado): ']),
        'use apenas para importação, manutenção ou recuperação. Para operação diária com múltiplos usuários, conecte a pasta ORIZONData em Eventos por usuário.'
      ]),
      card('Banco JSON direto (avançado)', null, el('div', { class:'grid' }, [
        dbMeta,
        el('div', { class:'tiny muted' }, [
          'Fluxo esperado: selecione o JSON oficial pelo botão. Por segurança do navegador, o app não tenta abrir file:// automaticamente. Ao carregar o BD, feriados já cadastrados são preservados/mesclados e não somem.'
        ]),
        el('details', { class:'hint tiny' }, [
          el('summary', { style:'cursor:pointer;font-weight:950' }, ['Avançado / manutenção do BD']),
          el('div', { class:'grid', style:'margin-top:10px' }, [
            el('div', { class:'field', style:'max-width:260px' }, [
              el('label', {}, ['Senha de manutenção']),
              el('input', {
                type:'password',
                placeholder:'Digite a senha',
                autocomplete:'off',
                oninput:(ev) => {
                  const unlocked = String(ev.target.value || '') === 'manutencao';
                  const details = ev.target.closest('details');
                  if (!details) return;
                  details.querySelectorAll('[data-maintenance-action="1"]').forEach(btn => { btn.disabled = unlocked ? null : true; });
                  const status = details.querySelector('[data-maintenance-status="1"]');
                  if (status) status.textContent = unlocked ? 'Acesso liberado.' : 'Digite a senha para liberar as ações.';
                }
              })
            ]),
            el('div', { class:'row' }, [
              button('Salvar agora no BD', '', saveToSelectedDb, { disabled:true, 'data-maintenance-action':'1' }),
              button('Recarregar do BD', '', reloadSelectedDb, { disabled:true, 'data-maintenance-action':'1' }),
              button('Ligar autosync', '', () => {
                if (capviewEventMode.enabled) {
                  disableDbAutoSyncForEventMode();
                  toast('Modo Eventos ativo: desligue o modo Eventos antes de ligar autosync do BD.');
                  render();
                  return;
                }
                const wasPaused = !!dbAutoSyncPauseReason;
                const wasEnabled = !!dbAutoSyncEnabled;
                dbAutoSyncEnabled = true;
                localStorage.setItem('capview_db_autosync_enabled', '1');
                clearDbAutoSyncPause();
                startDbWatcher();
                scheduleDbAutoSave(wasPaused ? 'resume-merge' : 'toggle-on');
                toast(wasPaused ? 'Autosync religado: mesclando com o BD mais atual.' : (wasEnabled ? 'Autosync já está ligado.' : 'Autosync ligado.'));
                render();
              }, { disabled:true, 'data-maintenance-action':'1' }),
              button('Limpar dados do sistema', 'danger', confirmClearAllData, { disabled:true, 'data-maintenance-action':'1' }),
              button(dbBinding.mode === 'rw' ? 'Trocar arquivo JSON' : 'Selecionar arquivo JSON', 'primary', selectDbReadWrite, { disabled:true, 'data-maintenance-action':'1' }),
            ]),
            el('div', { class:'tiny muted', 'data-maintenance-status':'1' }, [
              'Digite a senha para liberar as ações.'
            ]),
            el('div', { class:'tiny muted' }, [
              'Use estes controles só para recuperação, teste ou manutenção. No uso normal, o autosync salva e recarrega automaticamente.'
            ])
          ])
        ])
      ])),
      card('Eventos por usuário', null, el('div', { class:'grid' }, [
        el('div', { class:'hint tiny' }, [
          el('b', {}, ['Como funciona: ']),
          'selecione uma pasta ', el('span', { class:'mono' }, ['ORIZONData']), '. O app cria/usa ', el('span', { class:'mono' }, ['snapshot.json']), ' e ', el('span', { class:'mono' }, ['events/usuario.json']), '. Cada usuário grava no próprio arquivo de eventos; depois o app lê todos e aplica em ordem.'
        ]),
        el('div', { class:'row', style:'gap:8px;flex-wrap:wrap' }, [
          el('span', { class:'pill' }, [el('span', { class:`dot ${capviewEventMode.enabled ? 'bg-ok' : 'bg-over'}` }), capviewEventMode.enabled ? 'Modo Eventos ligado' : 'Modo Eventos desligado']),
          el('span', { class:'pill' }, [el('span', { class:`dot ${(capviewEventMode.autoSyncEnabled !== false && capviewEventAutoSyncTimer) ? 'bg-ok' : 'bg-mid'}` }), (capviewEventMode.autoSyncEnabled !== false && capviewEventAutoSyncTimer) ? 'Autosync eventos ativo' : (capviewEventMode.autoSyncEnabled !== false ? 'Autosync pronto' : 'Autosync eventos desligado')]),
          capviewEventMode.folderName ? el('span', { class:'tag mono' }, [capviewEventMode.folderName]) : el('span', { class:'tag' }, ['Nenhuma pasta selecionada']),
          el('span', { class:'tag' }, ['Pendentes aplicados na última leitura: ' + Number(capviewEventMode.pendingReadCount||0)]),
          el('span', { class:'tag' }, ['Outbox local: ' + loadLocalEventOutbox().length])
        ]),
        el('div', { class:'tiny muted' }, [
          (capviewEventMode.lastReadAt ? 'Última leitura: ' + new Date(capviewEventMode.lastReadAt).toLocaleString('pt-BR') : 'Última leitura: -') + ' - ' + (capviewEventMode.lastWriteAt ? 'Última gravação de evento: ' + new Date(capviewEventMode.lastWriteAt).toLocaleString('pt-BR') : 'Última gravação de evento: -') + ' - ' + (capviewEventMode.autoSyncLastTickAt ? 'Último autosync: ' + new Date(capviewEventMode.autoSyncLastTickAt).toLocaleTimeString('pt-BR') : 'Último autosync: -') + (capviewEventMode.lastStatus ? ' - Status: ' + capviewEventMode.lastStatus : '') + (capviewEventMode.autoSyncError ? ' - Erro: ' + capviewEventMode.autoSyncError : '')
        ]),
        el('div', { class:'row' }, [
          button(capviewEventMode.folderName ? 'Trocar pasta ORIZONData' : 'Selecionar pasta ORIZONData', 'primary', selectORIZONDataFolder),
          loadLocalEventOutbox().length ? button('Enviar pendências locais', '', async () => { const n = await flushLocalEventOutbox(); toast(n + ' evento(s) enviado(s) do outbox.'); render(); }) : null,
        ].filter(Boolean)),
        el('div', { class:'tiny muted' }, [
          'Uso recomendado: todos apontam para a mesma pasta ORIZONData. Depois de selecionada, o app grava eventos e lê alterações automaticamente enquanto a aba está ativa.'
        ]),
        el('details', { class:'hint tiny' }, [
          el('summary', { style:'cursor:pointer;font-weight:950' }, ['Avançado / manutenão de eventos']),
          el('div', { class:'row', style:'margin-top:10px' }, [
            button('Enviar outbox para /events', '', async () => { const n = await flushLocalEventOutbox(); toast(n + ' evento(s) enviado(s) do outbox.'); render(); }),
            button(capviewEventMode.autoSyncEnabled !== false ? 'Desligar autosync eventos' : 'Ligar autosync eventos', '', toggleEventAutoSync),
            button('Ler / aplicar eventos pendentes', '', () => syncEventsFromFolder()),
            button('Consolidar eventos no snapshot', '', consolidateEventsToSnapshot),
            button('Desligar modo eventos', 'danger', disableEventMode),
          ]),
          el('div', { class:'tiny muted', style:'margin-top:8px' }, [
            'Use estes controles só se o autosync estiver parado, se houver pendências locais ou para manutenão do snapshot.'
          ])
        ])
      ])),
      card('Exportar', null, el('div', { class:'row' }, [
        button('Exportar Snapshot (JSON)', 'primary', exportSnapshot),
        button('Exportar Events (JSONL)', '', exportEvents),
        buildCsvDropdown(),
      ])),
      card('Importar Snapshot', null, el('div', { class:'grid' }, [
        el('div', { class:'row' }, [
          el('div', { class:'field' }, [
            el('label', {}, ['Importar Snapshot (.json)']),
            (() => {
              const inp = el('input', { type:'file', accept:'.json,application/json' });
              inp.addEventListener('change', async () => {
                if (!inp.files || !inp.files[0]) return;
                try { await importSnapshot(inp.files[0]); } catch(e) { console.error(e); alert('Falha ao importar snapshot.'); }
                inp.value='';
              });
              return inp;
            })()
          ])
        ]),
        el('div', { class:'row' }, [
          el('div', { class:'field' }, [
            el('label', {}, ['Importar Snapshot (Adicionar / Mesclar) (.json)']),
            (() => {
              const inp = el('input', { type:'file', accept:'.json,application/json' });
              inp.addEventListener('change', async () => {
                if (!inp.files || !inp.files[0]) return;
                try { await importSnapshotAdd(inp.files[0]); } catch(e) { console.error(e); alert('Falha ao adicionar/mesclar snapshot.'); }
                inp.value='';
              });
              return inp;
            })()
          ])
        ]),
      ])),
      card('Auditoria rápida', null, el('div', { class:'grid' }, [
        el('div', { class:'tiny' }, [`Eventos registrados: `, el('span', { class:'mono' }, [String((state.events||[]).length)])]),
        el('div', { class:'tiny' }, ['(Dica) Para auditoria corporativa, exporte o JSONL semanalmente e mantenha no repositório/pasta de rede.'])
      ]))
    ]);

    return body;
  };

  // ----------------------
  // App shell
  // ----------------------
  const TABS = [
    { id:'dashboard', label:'Visão Geral', icon:'📊' },
    { id:'evaluation', label:'Apontamentos', icon:'📈' },
    { id:'demands', label:'Demandas', icon:'📋' },
    { id:'resources', label:'Recursos', icon:'👥' },
    { id:'calendar', label:'Bloqueio de Janela', icon:'📅' },
    { id:'he', label:'Horas Extras (HE)', icon:'⏱' },
    { id:'windows', label:'Janelas Livres', icon:'🔎' },
    { id:'internal', label:'Lançamentos', icon:'✍️' },
    { id:'dailyExecution', label:'Execução diária', icon:'📆' },
    { id:'consolidation', label:'Sincronização de BD', icon:'📦' },
  ];

  const renderTabs = () => {
    const nav = qs('#tabs');
    nav.innerHTML = '';
    for (const t of TABS) {
      nav.appendChild(el('button', {
        class: (activeTab===t.id ? 'active' : ''),
        onclick: () => { activeTab = t.id; render(); }
      }, [el('span', {}, [t.icon]), t.label]));
    }
  };

  const goToDbSync = () => { activeTab = 'consolidation'; render(); };
  const selectDbFromAnyView = () => {
    if (activeTab !== 'consolidation') {
      activeTab = 'consolidation';
      render();
    }
    return selectDbReadWrite();
  };
  const selectEventFolderFromAnyView = () => {
    if (activeTab !== 'consolidation') {
      activeTab = 'consolidation';
      render();
    }
    return selectORIZONDataFolder();
  };

  const updateEventFolderHeaderStatus = () => {
    const btn = qs('#eventFolderHeaderStatus');
    if (!btn) return;
    const status = eventFolderConnectionStatus();
    btn.className = `eventFolderStatus ${status.state}`;
    btn.title = `${status.actionLabel}: ${status.detail}`;
    btn.onclick = status.state === 'connected' ? goToDbSync : selectEventFolderFromAnyView;
    const txt = qs('.eventFolderText', btn);
    if (txt) txt.textContent = status.label;
  };

  const renderDbReconnectBanner = () => el('div', { class:'globalDbWarn', style:'margin-bottom:14px', 'data-db-reconnect-banner':'true' }, [
    el('div', { style:'font-weight:950' }, ['BD JSON direto desconectado ou vínculo inválido']),
    el('span', { class:'tiny', style:'display:block;margin-top:4px' }, [
      'O autosync do BD JSON foi pausado. Para o fluxo recomendado, conecte a pasta ORIZONData; para manutenção, selecione novamente o JSON oficial.',
      dbAutoSyncPauseReason ? ' Motivo: ' + dbAutoSyncPauseReason + '.' : ''
    ]),
    dbBinding?.name ? el('span', { class:'tiny mono', style:'display:block;margin-top:4px' }, ['Último BD: ', dbBinding.name]) : null,
    el('div', { class:'row', style:'margin-top:10px;gap:8px;flex-wrap:wrap' }, [
      button('Conectar pasta de eventos', 'primary', selectEventFolderFromAnyView),
      button('Reconectar BD JSON', '', selectDbFromAnyView),
      activeTab !== 'consolidation' ? button('Ir para Sincronização de BD', '', goToDbSync) : null,
    ].filter(Boolean))
  ].filter(Boolean));

  const patchDashboardView = (root, nextView, nextBanner=null) => {
    const currentView = qs('[data-view="dashboard"]', root);
    if (!currentView) return false;

    const hasCurrentBanner = !!qs('[data-db-reconnect-banner="true"]', root);
    const hasNextBanner = !!nextBanner;
    if (hasCurrentBanner !== hasNextBanner) return false;

    const currentBanner = qs('[data-db-reconnect-banner="true"]', root);
    if (currentBanner && nextBanner) currentBanner.replaceWith(nextBanner);

    currentView.className = nextView.className;
    currentView.setAttribute('data-view', 'dashboard');
    const nextStyle = nextView.getAttribute('style');
    if (nextStyle) currentView.setAttribute('style', nextStyle);
    else currentView.removeAttribute('style');

    const nextSections = qsa('[data-dashboard-section]', nextView);
    const nextKeys = new Set(nextSections.map(section => section.getAttribute('data-dashboard-section')));
    for (const nextSection of nextSections) {
      const key = nextSection.getAttribute('data-dashboard-section');
      const currentSection = qs(`[data-dashboard-section="${key}"]`, currentView);
      if (currentSection) currentSection.replaceWith(nextSection);
      else currentView.appendChild(nextSection);
    }
    qsa('[data-dashboard-section]', currentView).forEach(section => {
      if (!nextKeys.has(section.getAttribute('data-dashboard-section'))) section.remove();
    });
    return true;
  };

  const render = () => {
    renderTabs();
    updateEventFolderHeaderStatus();
    updateNotificationsBell();
    const root = qs('#app');

    let view;
    if (activeTab === 'dashboard') view = viewDashboard();
    else if (activeTab === 'evaluation') view = viewEvaluationDashboard();
    else if (activeTab === 'demands') view = viewDemands();
    else if (activeTab === 'resources') view = viewResources();
    else if (activeTab === 'calendar') view = viewCalendar();
    else if (activeTab === 'he') view = viewOvertime();
    else if (activeTab === 'windows') view = viewWindows();
    else if (activeTab === 'internal') view = viewInternalActivities();
    else if (activeTab === 'dailyExecution') view = viewDailyExecution();
    else if (activeTab === 'consolidation') view = viewConsolidation();
    else view = el('div', {}, ['Aba inválida.']);

    const reconnectBanner = sharedFolderReady() && hasDbReconnectNeeded()
      ? renderDbReconnectBanner()
      : null;

    if (activeTab === 'dashboard' && patchDashboardView(root, view, reconnectBanner)) {
      return;
    }

    root.innerHTML = '';
    if (reconnectBanner) root.appendChild(reconnectBanner);
    root.appendChild(view);
  };

  // init
  wireNotificationsBell();
  if (userName) setUser(userName);
  else updateAvatar();
  updateNotificationsBell();

  // modal close handlers
  const dlg = qs('#dayModal');
  qs('#dayModalClose').addEventListener('click', () => { try{ dlg.close(); }catch{ dlg.removeAttribute('open'); } });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) { try{ dlg.close(); }catch{ dlg.removeAttribute('open'); } } });
  dlg.addEventListener('close', syncModalBlur);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ dlg.close(); }catch{ dlg.removeAttribute('open'); } syncModalBlur(); });



  const mdlg = qs('#monthModal');
  if (mdlg) {
    qs('#monthModalClose').addEventListener('click', () => { try{ mdlg.close(); }catch{ mdlg.removeAttribute('open'); } });
    mdlg.addEventListener('click', (e) => { if (e.target === mdlg) { try{ mdlg.close(); }catch{ mdlg.removeAttribute('open'); } } });
    mdlg.addEventListener('close', syncModalBlur);
    mdlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ mdlg.close(); }catch{ mdlg.removeAttribute('open'); } syncModalBlur(); });
  }

  const edlg = qs('#demandEditModal');
  qs('#demandEditModalClose').addEventListener('click', () => { try{ edlg.close(); }catch{ edlg.removeAttribute('open'); } });
  edlg.addEventListener('click', (e) => { if (e.target === edlg) { try{ edlg.close(); }catch{ edlg.removeAttribute('open'); } } });
  edlg.addEventListener('close', syncModalBlur);
  edlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ edlg.close(); }catch{ edlg.removeAttribute('open'); } syncModalBlur(); });

  const statusDlg = qs('#demandStatusModal');
  if (statusDlg) {
    qs('#demandStatusModalClose').addEventListener('click', () => { try{ statusDlg.close(); }catch{ statusDlg.removeAttribute('open'); } syncModalBlur(); });
    statusDlg.addEventListener('click', (e) => { if (e.target === statusDlg) { try{ statusDlg.close(); }catch{ statusDlg.removeAttribute('open'); } syncModalBlur(); } });
    statusDlg.addEventListener('close', syncModalBlur);
    statusDlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ statusDlg.close(); }catch{ statusDlg.removeAttribute('open'); } syncModalBlur(); });
  }

	  const rpd = qs('#demandReprogramModal');
	  if (rpd) {
	    qs('#demandReprogramModalClose').addEventListener('click', () => { try{ rpd.close(); }catch{ rpd.removeAttribute('open'); } syncModalBlur(); });
	    rpd.addEventListener('click', (e) => { if (e.target === rpd) { try{ rpd.close(); }catch{ rpd.removeAttribute('open'); } syncModalBlur(); } });
	    rpd.addEventListener('close', syncModalBlur);
	    rpd.addEventListener('cancel', (e) => { e.preventDefault(); try{ rpd.close(); }catch{ rpd.removeAttribute('open'); } syncModalBlur(); });
	  }

  const sdlg = qs('#demandStagesModal');
  if (sdlg) {
    qs('#demandStagesModalClose').addEventListener('click', () => closeDialog(sdlg));
    sdlg.addEventListener('click', (e) => { if (e.target === sdlg) closeDialog(sdlg); });
    sdlg.addEventListener('close', syncModalBlur);
    sdlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(sdlg); });
  }

  const rdlg = qs('#resourceEditModal');
  if (rdlg) {
    qs('#resourceEditModalClose').addEventListener('click', () => { try{ rdlg.close(); }catch{ rdlg.removeAttribute('open'); } syncModalBlur(); });
    rdlg.addEventListener('click', (e) => { if (e.target === rdlg) { try{ rdlg.close(); }catch{ rdlg.removeAttribute('open'); } syncModalBlur(); } });
    rdlg.addEventListener('close', syncModalBlur);
    rdlg.addEventListener('cancel', (e) => { e.preventDefault(); try{ rdlg.close(); }catch{ rdlg.removeAttribute('open'); } syncModalBlur(); });
  }

  const dd = qs('#donutModal');
  if (dd) { dd.addEventListener('close', syncModalBlur); dd.addEventListener('cancel', (e) => { e.preventDefault(); try{ dd.close(); }catch{ dd.removeAttribute('open'); } syncModalBlur(); }); }

  // HE modals: close handlers
  const hed = qs('#heModal');
  if (hed) {
    qs('#heModalClose').addEventListener('click', () => closeHeModal());
    hed.addEventListener('click', (e) => { if (e.target === hed) closeHeModal(); });
    hed.addEventListener('close', syncModalBlur);
    hed.addEventListener('cancel', (e) => { e.preventDefault(); closeHeModal(); });
  }

  const hcd = qs('#heConfirmModal');
  if (hcd) {
    qs('#heConfirmClose').addEventListener('click', () => closeHeConfirm());
    hcd.addEventListener('click', (e) => { if (e.target === hcd) closeHeConfirm(); });
    hcd.addEventListener('close', syncModalBlur);
    hcd.addEventListener('cancel', (e) => { e.preventDefault(); closeHeConfirm(); });
  }

  // Event delegation for HE actions (robusto mesmo com re-render/SPA)
  document.addEventListener('click', (e) => {
    const elBtn = e.target.closest('[data-action]');
    if (!elBtn) return;
    const act = elBtn.getAttribute('data-action');
    if (!act) return;

    if (act === 'he-open') {
      openHeModal({});
      return;
    }

    if (act === 'he-cancel') {
      closeHeModal();
      return;
    }

    if (act === 'he-save') {
      const resourceId = (qs('#heModalResource')?.value || '__ALL__').trim();
      const date = (qs('#heModalDate')?.value || '').trim();
      const horas = Number(qs('#heModalHours')?.value || 0);
      const motivo = (qs('#heModalMotivo')?.value || '').trim();
      const titulo = (qs('#heModalTitulo')?.value || '').trim();
      const predio = (qs('#heModalPredio')?.value || '').trim();
      const focal = (qs('#heModalFocal')?.value || '').trim();
      const prioridade = (qs('#heModalPrioridade')?.value || 'Média').trim();
      const observacoes = (qs('#heModalObs')?.value || '').trim();

      if (!date) return toast('Informe a data da HE.');
      if (!isFinite(horas) || horas <= 0) return toast('Informe as horas da HE (maior que 0).');
      if (!titulo) {
        toast('Informe o título/atividade da HE.');
        try { qs('#heModalTitulo')?.focus(); } catch {}
        return;
      }
      if (!motivo) {
        toast('Motivo é obrigatório.');
        try { qs('#heModalMotivo')?.focus(); } catch {}
        return;
      }

      dispatch('ADD_OVERTIME', {
        id: generateId('id'),
        resourceId: resourceId || '__ALL__',
        date,
        horas,
        motivo,
        titulo,
        atividade: titulo,
        predio,
        focal,
        prioridade,
        observacoes,
        createdAt: Date.now(),
      });
      closeHeModal();
      toast('HE adicionada.');
      render();
      return;
    }

    if (act === 'he-delete') {
      const id = (elBtn.getAttribute('data-id') || '').trim();
      if (!id) return;
      const all = Array.isArray(state.overtimes) ? state.overtimes : [];
      const ot = all.find(x => String(x.id) === String(id));
      if (!ot) return toast('HE não encontrada.');
      hePendingDeleteId = String(id);
      openHeConfirm(ot);
      return;
    }

    if (act === 'he-delete-cancel') {
      closeHeConfirm();
      return;
    }

    if (act === 'he-delete-confirm') {
      if (!hePendingDeleteId) return;
      dispatch('DELETE_OVERTIME', { id: hePendingDeleteId });
      closeHeConfirm();
      toast('HE removida.');
      render();
      return;
    }
  });


  syncModalBlur();



  // ---------------- CSV Export (dropdown) ----------------

  const buildCsvDropdown = () => {
    const root = el('div', { class:'dd', id:'csvDropdown' });
    const btn = el('button', { class:'btn', type:'button', id:'csvBtn' }, ['Exportar CSV ▾']);
    const menu = el('div', { class:'ddMenu', id:'csvMenu', role:'menu' }, [
      el('button', { class:'ddItem', type:'button', 'data-export':'demandas' }, ['Exportar Demandas']),
      el('button', { class:'ddItem', type:'button', 'data-export':'recursos' }, ['Exportar Recursos']),
      el('button', { class:'ddItem', type:'button', 'data-export':'bloqueios' }, ['Exportar Bloqueios']),
      el('button', { class:'ddItem', type:'button', 'data-export':'feriados' }, ['Exportar Feriados']),
      el('button', { class:'ddItem', type:'button', 'data-export':'he' }, ['Exportar HE']),
      el('div', { class:'ddSep' }, []),
      el('button', { class:'ddItem', type:'button', 'data-export':'janelas' }, ['Exportar Janelas Livres por recurso (meses)']),
      el('button', { class:'ddItem', type:'button', 'data-export':'orizon_pack_analise' }, ['Exportar Orizon Pack de Análise']),
      el('button', { class:'ddItem', type:'button', 'data-export':'excel_all' }, ['Exportar Tudo (Excel .xls)']),
    ]);

    const close = () => { root.classList.remove('open'); btn.setAttribute('aria-expanded','false'); };
    const open = () => { root.classList.add('open'); btn.setAttribute('aria-expanded','true'); };

    btn.setAttribute('aria-haspopup','true');
    btn.setAttribute('aria-expanded','false');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (root.classList.contains('open')) close(); else open();
    });

    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-export]');
      if (!b) return;
      const key = b.getAttribute('data-export');
      close();
      switch(key){
        case 'demandas': exportDemandasCSV(); break;
        case 'recursos': exportRecursosCSV(); break;
        case 'bloqueios': exportBloqueiosCSV(); break;
        case 'feriados': exportFeriadosCSV(); break;
        case 'he': exportHECSV(); break;
        case 'janelas': exportJanelasPorRecursoMesCSV(); break;
        case 'orizon_pack_analise': openOrizonPackAnaliseModal(); break;
        case 'excel_all': exportAllExcelWorkbook(); break;
      }
    });

    // close on outside click
    document.addEventListener('click', (e) => {
      if (!root.isConnected) return; // only while in DOM
      if (!root.contains(e.target)) close();
    });

    root.appendChild(btn);
    root.appendChild(menu);
    return root;
  };
  const CSV_SEP = ';';

  const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // normalize newlines (keep deterministic)
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const mustQuote = s.includes('"') || s.includes(CSV_SEP) || s.includes('\n');
    if (s.includes('"')) s = s.replace(/"/g, '""');
    return mustQuote ? `"${s}"` : s;
  };

  const toCSV = (rows, headers) => {
    const out = [];
    out.push(headers.map(csvEscape).join(CSV_SEP));
    for (const r of rows) {
      out.push(headers.map(h => csvEscape(r[h])).join(CSV_SEP));
    }
    return out.join('\n');
  };

  const downloadText = (filename, text, mime='text/csv;charset=utf-8') => {
    try {
      // Excel (principalmente em Windows pt-BR) costuma abrir CSV como ANSI.
      // O BOM UTF-8 ajuda o Excel a detectar acentuação corretamente.
      const BOM = 'ï»¿';
      const blob = new Blob([BOM, text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
      console.error(e);
      toast('Falha ao exportar CSV.');
    }
  };
  const fallbackCopyText = (value) => {
    const tmp = document.createElement('textarea');
    tmp.value = String(value || '');
    tmp.setAttribute('readonly', '');
    tmp.style.position = 'fixed';
    tmp.style.top = '-1000px';
    document.body.appendChild(tmp);
    tmp.select();
    tmp.setSelectionRange(0, tmp.value.length);
    const ok = document.execCommand('copy');
    tmp.remove();
    return ok;
  };

  const excelXmlEscape = (v) => String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const excelSheetName = (name) => excelXmlEscape(String(name || 'Aba').replace(/[\[\]\*\/\\\?:]/g, ' ').slice(0, 31));

  const excelCellXml = (value) => {
    if (value === null || value === undefined || value === '') return '<Cell><Data ss:Type="String"></Data></Cell>';
    const n = Number(value);
    const isNumber = typeof value === 'number' || (String(value).trim() !== '' && isFinite(n) && !/^0\d+/.test(String(value).trim()));
    if (isNumber) return `<Cell><Data ss:Type="Number">${excelXmlEscape(String(n))}</Data></Cell>`;
    return `<Cell><Data ss:Type="String">${excelXmlEscape(value)}</Data></Cell>`;
  };

  const worksheetXml = (name, headers, rows) => {
    const headerRow = `<Row>${headers.map(h => `<Cell ss:StyleID="header"><Data ss:Type="String">${excelXmlEscape(h)}</Data></Cell>`).join('')}</Row>`;
    const bodyRows = (rows || []).map(r =>
      `<Row>${headers.map(h => excelCellXml(r[h])).join('')}</Row>`
    ).join('');
    return `<Worksheet ss:Name="${excelSheetName(name)}"><Table>${headerRow}${bodyRows}</Table></Worksheet>`;
  };

  const downloadExcelWorkbook = (filename, sheets) => {
    try {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#EAF8D1" ss:Pattern="Solid"/></Style>
 </Styles>
 ${sheets.map(s => worksheetXml(s.name, s.headers, s.rows)).join('')}
</Workbook>`;
      downloadText(filename, xml, 'application/vnd.ms-excel;charset=utf-8');
    } catch (e) {
      console.error(e);
      toast('Falha ao exportar Excel.');
    }
  };

  const buildDemandasExportData = () => {
    const headers = [
      'id','titulo','responsavel','data_inicio','data_fim','status_base','status_atual',
      'concluida','data_conclusao','classificacao_conclusao','concluida_pos_postergacao','qtd_reprogramacoes','dias_apos_prazo',
      'percentual_diario','horas_dia','prioridade','predio','focal','observacoes'
    ];
    const resMap = resourceById();
    const rows = (state.demands||[]).map(d => {
      const rid = d.responsavel_id || d.resourceId || '';
      const alloc = demandAllocations(d).find(a => String(a.resourceId || '') === String(rid || '')) || demandAllocations(d)[0] || {};
      const pct = Number(alloc.percentual_diario ?? d.dailyPercent ?? d.percentual_diario ?? d.percent ?? 0);
      const horas = Number(alloc.horas_planejadas_dia ?? d.horas_planejadas_dia ?? d.horas_dia ?? 0);
      const res = resMap[rid];
      const completionInfo = demandCompletionInfo(d);
      return {
        id: d.id || '',
        titulo: d.titulo || d.nome || '',
        responsavel: res?.nome || d.responsavel || rid || '',
        data_inicio: d.start || d.data_inicio || '',
        data_fim: d.end || d.data_fim || '',
        status_base: d.status || '',
        status_atual: effectiveStatus ? effectiveStatus(d) : (d.status||''),
        concluida: completionInfo.isCompleted ? 'true' : 'false',
        data_conclusao: completionInfo.completionDate || '',
        classificacao_conclusao: completionInfo.classification || '',
        concluida_pos_postergacao: completionInfo.wasPostponed ? 'true' : 'false',
        qtd_reprogramacoes: completionInfo.reprogrammingsCount || 0,
        dias_apos_prazo: completionInfo.daysDelta === '' ? '' : Math.max(0, Number(completionInfo.daysDelta || 0)),
        percentual_diario: isFinite(pct) ? pct : '',
        horas_dia: isFinite(horas) ? Number(horas.toFixed(2)) : '',
        prioridade: d.prioridade || '',
        predio: d.predio || '',
        focal: d.focal || '',
        observacoes: d.obs || d.observacoes || ''
      };
    });
    return { headers, rows };
  };

  const buildRecursosExportData = () => ({
    headers: ['id','nome','tipo','ativo','inicio','fim'],
    rows: (state.resources||[]).map(r => ({
      id: r.id || '',
      nome: r.nome || '',
      tipo: r.tipo || '',
      ativo: (r.ativo === false) ? 'false' : 'true',
      inicio: r.inicio || r.vigencia_inicio || '',
      fim: r.fim || r.vigencia_fim || ''
    }))
  });

  const buildOrizonPackAnaliseContext = (options={}) => {
    const now = new Date();
    const y = now.getFullYear();
    const m0 = now.getMonth();
    const currentMonthStart = formatDate(new Date(y, m0, 1));
    const currentMonthEnd = formatDate(new Date(y, m0 + 1, 0));
    const currentYearStart = `${y}-01-01`;
    const currentYearEnd = `${y}-12-31`;
    const scope = String(options.scope || 'ano_atual');
    const periodStart = scope === 'mes_atual' ? currentMonthStart : currentYearStart;
    const periodEnd = scope === 'mes_atual' ? currentMonthEnd : currentYearEnd;
    return {
      exportedAt: nowIso(),
      exportDate: formatDate(now),
      currentYear: y,
      currentMonth: `${y}-${String(m0 + 1).padStart(2, '0')}`,
      currentMonthStart,
      currentMonthEnd,
      currentYearStart,
      currentYearEnd,
      periodScope: scope === 'mes_atual' ? 'mes_atual' : 'ano_atual',
      periodLabel: scope === 'mes_atual' ? 'Mês atual' : 'Ano atual',
      periodStart,
      periodEnd,
      privacyMode: 'completo',
    };
  };

  const countAllApontamentos = () => (state.demands || [])
    .reduce((acc, d) => acc + normalizeDemandApontamentos(d).length, 0);

  const buildOrizonPackManifestData = (ctx=buildOrizonPackAnaliseContext(), qualityRows=[]) => {
    const headers = ['campo','valor'];
    const rows = [
      { campo:'nome_export', valor:'Orizon Pack de Análise' },
      { campo:'formato', valor:'XLS multiaba' },
      { campo:'schema_version', valor:'orizon_pack_analise_v1' },
      { campo:'exportado_em', valor:ctx.exportedAt },
      { campo:'usuario_exportador', valor:userName || 'Sessão local' },
      { campo:'user_id_exportador', valor:userId || '' },
      { campo:'escopo_dados', valor:'todos os dados disponíveis no app' },
      { campo:'escopo_periodo_configurado', valor:ctx.periodLabel },
      { campo:'periodo_configurado_inicio', valor:ctx.periodStart },
      { campo:'periodo_configurado_fim', valor:ctx.periodEnd },
      { campo:'mes_atual', valor:ctx.currentMonth },
      { campo:'periodo_mes_inicio', valor:ctx.currentMonthStart },
      { campo:'periodo_mes_fim', valor:ctx.currentMonthEnd },
      { campo:'ano_atual', valor:ctx.currentYear },
      { campo:'periodo_ano_inicio', valor:ctx.currentYearStart },
      { campo:'periodo_ano_fim', valor:ctx.currentYearEnd },
      { campo:'modo_atividades_internas', valor:ctx.privacyMode },
      { campo:'total_recursos', valor:(state.resources || []).length },
      { campo:'total_demandas', valor:(state.demands || []).length },
      { campo:'total_apontamentos', valor:countAllApontamentos() },
      { campo:'total_atividades_internas', valor:(state.internalActivities || []).length },
      { campo:'total_reprogramacoes', valor:(state.reprogrammings || []).length },
      { campo:'total_he', valor:(state.overtimes || []).length },
      { campo:'total_alertas_qualidade', valor:(qualityRows || []).length },
      { campo:'observacao', valor:'Pacote consolidado com dimensões, fatos, indicadores executivos, atrasos, reprogramações e diagnóstico de qualidade para análise operacional.' },
    ];
    return { headers, rows };
  };

  const buildOrizonPackDimRecursoData = () => ({
    headers: ['resource_id','nome','tipo','ativo','vigencia_inicio','vigencia_fim','horas_dia','owner_user_id','created_by','created_by_id','updated_by','updated_by_id'],
    rows: (state.resources || []).map(r => ({
      resource_id: r.id || '',
      nome: r.nome || '',
      tipo: r.tipo || '',
      ativo: (r.ativo === false) ? 'false' : 'true',
      vigencia_inicio: r.inicio || r.vigencia_inicio || '',
      vigencia_fim: r.fim || r.vigencia_fim || '',
      horas_dia: getResourceHoursPerDay(r),
      owner_user_id: r.owner_user_id || r.ownerUserId || '',
      created_by: r.createdBy || r.created_by || '',
      created_by_id: r.createdById || r.created_by_id || '',
      updated_by: r.updatedBy || r.updated_by || '',
      updated_by_id: r.updatedById || r.updated_by_id || '',
    }))
  });

  const buildOrizonPackDimDemandaData = () => {
    const resMap = resourceById();
    const headers = [
      'demand_id','titulo','status_base','status_atual','responsavel_id','responsavel','data_inicio','data_fim',
      'baseline_inicio','baseline_fim','data_conclusao','classificacao_conclusao','concluida_pos_postergacao','qtd_reprogramacoes','dias_apos_prazo',
      'percentual_diario','horas_dia','prioridade','predio','focal',
      'observacoes','created_by','created_by_id','updated_by','updated_by_id'
    ];
    const rows = (state.demands || []).map(d => {
      const rid = d.responsavel_id || d.resourceId || '';
      const alloc = demandAllocations(d).find(a => String(a.resourceId || '') === String(rid || '')) || demandAllocations(d)[0] || {};
      const pct = Number(alloc.percentual_diario ?? d.dailyPercent ?? d.percentual_diario ?? d.percent ?? 0);
      const horas = Number(alloc.horas_planejadas_dia ?? d.horas_planejadas_dia ?? d.horas_dia ?? 0);
      const completionInfo = demandCompletionInfo(d);
      return {
        demand_id: d.id || '',
        titulo: d.titulo || d.nome || '',
        status_base: d.status || '',
        status_atual: effectiveStatus ? effectiveStatus(d) : (d.status || ''),
        responsavel_id: rid,
        responsavel: resMap[rid]?.nome || d.responsavel || rid || '',
        data_inicio: d.start || d.data_inicio || '',
        data_fim: d.end || d.data_fim || '',
        baseline_inicio: d.baseline_inicio || d.data_inicio || '',
        baseline_fim: d.baseline_fim || d.data_fim || '',
        data_conclusao: completionInfo.completionDate || '',
        classificacao_conclusao: completionInfo.classification || '',
        concluida_pos_postergacao: completionInfo.wasPostponed ? 'true' : 'false',
        qtd_reprogramacoes: completionInfo.reprogrammingsCount || 0,
        dias_apos_prazo: completionInfo.daysDelta === '' ? '' : Math.max(0, Number(completionInfo.daysDelta || 0)),
        percentual_diario: isFinite(pct) ? pct : '',
        horas_dia: isFinite(horas) ? Number(horas.toFixed(2)) : '',
        prioridade: d.prioridade || '',
        predio: d.predio || '',
        focal: d.focal || '',
        observacoes: d.obs || d.observacoes || '',
        created_by: d.createdBy || d.created_by || '',
        created_by_id: d.createdById || d.created_by_id || '',
        updated_by: d.updatedBy || d.updated_by || '',
        updated_by_id: d.updatedById || d.updated_by_id || '',
      };
    });
    return { headers, rows };
  };

  const buildOrizonPackQualidadeDadosData = () => {
    const headers = ['severidade','categoria','entidade','entidade_id','campo','mensagem','sugestao'];
    const rows = [];
    const resMap = resourceById();
    const demandMap = new Map((state.demands || []).map(d => [String(d.id || ''), d]));
    const add = (severidade, categoria, entidade, entidadeId, campo, mensagem, sugestao='') => rows.push({
      severidade, categoria, entidade, entidade_id: entidadeId || '', campo, mensagem, sugestao
    });
    const validDate = (v) => isISODateString(String(v || '').trim());

    for (const r of (state.resources || [])) {
      if (!String(r.id || '').trim()) add('erro', 'cadastro', 'recurso', '', 'id', 'Recurso sem ID.', 'Recriar ou revisar o cadastro do recurso.');
      if (!String(r.nome || '').trim()) add('erro', 'cadastro', 'recurso', r.id, 'nome', 'Recurso sem nome.', 'Informar nome do recurso.');
      const ini = String(r.inicio || r.vigencia_inicio || '').trim();
      const fim = String(r.fim || r.vigencia_fim || '').trim();
      if (ini && !validDate(ini)) add('erro', 'data', 'recurso', r.id, 'vigencia_inicio', 'Vigência inicial inválida.', 'Usar data no formato AAAA-MM-DD.');
      if (fim && !validDate(fim)) add('erro', 'data', 'recurso', r.id, 'vigencia_fim', 'Vigência final inválida.', 'Usar data no formato AAAA-MM-DD.');
      if (validDate(ini) && validDate(fim) && fim < ini) add('erro', 'data', 'recurso', r.id, 'vigencia', 'Vigência final menor que a inicial.', 'Revisar início/fim da vigência.');
    }

    for (const d of (state.demands || [])) {
      const id = d.id || '';
      const st = effectiveStatus ? effectiveStatus(d) : (d.status || '');
      const start = String(d.start || d.data_inicio || '').trim();
      const end = String(d.end || d.data_fim || '').trim();
      const allocations = demandAllocations(d);
      if (!String(id).trim()) add('erro', 'cadastro', 'demanda', '', 'id', 'Demanda sem ID.', 'Revisar cadastro/importação da demanda.');
      if (!String(d.titulo || d.nome || '').trim()) add('erro', 'cadastro', 'demanda', id, 'titulo', 'Demanda sem título.', 'Informar título da demanda.');
      if (st !== 'Mapeada' && !allocations.length) add('erro', 'alocacao', 'demanda', id, 'responsavel', 'Demanda não mapeada sem responsável/alocação.', 'Definir pelo menos um responsável ou marcar como Mapeada.');
      if (start && !validDate(start)) add('erro', 'data', 'demanda', id, 'data_inicio', 'Data de início inválida.', 'Usar data no formato AAAA-MM-DD.');
      if (end && !validDate(end)) add('erro', 'data', 'demanda', id, 'data_fim', 'Data fim inválida.', 'Usar data no formato AAAA-MM-DD.');
      if (!start && st !== 'Mapeada') add('erro', 'data', 'demanda', id, 'data_inicio', 'Demanda não mapeada sem data de início.', 'Informar início do planejamento.');
      if (!end && st !== 'Mapeada') add('erro', 'data', 'demanda', id, 'data_fim', 'Demanda não mapeada sem data fim.', 'Informar prazo do planejamento.');
      if (validDate(start) && validDate(end) && end < start) add('erro', 'data', 'demanda', id, 'periodo', 'Data fim menor que data de início.', 'Revisar período da demanda.');
      for (const a of allocations) {
        if (!resMap[a.resourceId]) add('erro', 'alocacao', 'demanda', id, 'responsavel_id', `Responsável não encontrado: ${a.resourceId || '-'}.`, 'Selecionar um recurso existente.');
        const horas = Number(a.horas_planejadas_dia || a.horas_dia || 0);
        if (!isFinite(horas) || horas <= 0) add('aviso', 'alocacao', 'demanda', id, 'horas_planejadas_dia', `Alocação sem horas válidas para recurso ${a.resourceId || '-'}.`, 'Informar horas por dia maiores que zero.');
      }
      const rawApts = Array.isArray(d.apontamentos) ? d.apontamentos : [];
      rawApts.forEach((apt, idx) => {
        const aptId = apt?.id || `${id || 'demanda'}::apt::${idx + 1}`;
        const data = String(apt?.data || '').trim();
        const horas = parseApontamentoHours(apt?.horas);
        if (!data || !validDate(data)) add('erro', 'apontamento', 'apontamento', aptId, 'data', `Apontamento da demanda "${d.titulo || id}" sem data válida.`, 'Informar data no formato AAAA-MM-DD.');
        if (!normalizeProjectStep(apt?.etapa || apt?.tipo || '')) add('erro', 'apontamento', 'apontamento', aptId, 'etapa', `Apontamento da demanda "${d.titulo || id}" sem etapa válida.`, 'Selecionar uma etapa/documento.');
        if (!Number.isFinite(horas) || horas <= 0) add('erro', 'apontamento', 'apontamento', aptId, 'horas', `Apontamento da demanda "${d.titulo || id}" sem horas válidas.`, 'Informar horas maiores que zero.');
        if (!String(apt?.usuario || apt?.user || apt?.created_by || '').trim() && !String(apt?.user_id || apt?.userId || '').trim()) {
          add('aviso', 'autoria', 'apontamento', aptId, 'usuario', `Apontamento da demanda "${d.titulo || id}" sem autoria explícita.`, 'Registrar usuário responsável pelo apontamento.');
        }
      });
    }

    for (const ia of (state.internalActivities || [])) {
      const id = ia.id || '';
      const rid = ia.resourceId || ia.resource_id || ia.recurso_id || '';
      const ini = String(ia.data_inicio || ia.dataInicio || ia.start_date || ia.data || '').trim();
      const fim = String(ia.data_fim || ia.dataFim || ia.end_date || ini || ia.data || '').trim();
      const horas = Number(ia.horas_dia ?? ia.horas ?? 0);
      if (!String(id).trim()) add('erro', 'atividade_interna', 'atividade_interna', '', 'id', 'Atividade interna sem ID.', 'Revisar cadastro/importação da atividade.');
      if (!rid) add('erro', 'atividade_interna', 'atividade_interna', id, 'resourceId', 'Atividade interna sem recurso.', 'Vincular atividade a um recurso.');
      else if (!resMap[rid]) add('erro', 'atividade_interna', 'atividade_interna', id, 'resourceId', `Recurso da atividade interna não encontrado: ${rid}.`, 'Selecionar recurso existente.');
      if (!String(ia.titulo || ia.tipo || '').trim()) add('aviso', 'atividade_interna', 'atividade_interna', id, 'titulo', 'Atividade interna sem título/tipo.', 'Informar título ou tipo.');
      if (!ini || !validDate(ini)) add('erro', 'atividade_interna', 'atividade_interna', id, 'data_inicio', 'Atividade interna sem início válido.', 'Usar data no formato AAAA-MM-DD.');
      if (!fim || !validDate(fim)) add('erro', 'atividade_interna', 'atividade_interna', id, 'data_fim', 'Atividade interna sem fim válido.', 'Usar data no formato AAAA-MM-DD.');
      if (validDate(ini) && validDate(fim) && fim < ini) add('erro', 'atividade_interna', 'atividade_interna', id, 'periodo', 'Atividade interna com fim menor que início.', 'Revisar período.');
      if (!isFinite(horas) || horas < 0 || horas > 24) add('erro', 'atividade_interna', 'atividade_interna', id, 'horas_dia', 'Horas/dia da atividade interna inválidas.', 'Informar valor entre 0 e 24.');
      if (!internalActivityOwnerId(ia) && !internalActivityOwnerName(ia)) add('aviso', 'autoria', 'atividade_interna', id, 'owner', 'Atividade interna sem dono/autoria explícita.', 'Registrar owner_user_id ou created_by_id.');
    }

    for (const o of (state.overtimes || [])) {
      const id = o.id || '';
      const rid = o.resourceId || o.recurso_id || o.recurso || '';
      const date = String(o.date || o.data || '').trim();
      const horas = Number(o.horas ?? o.hours ?? 0);
      if (!date || !validDate(date)) add('erro', 'he', 'he', id, 'data', 'HE sem data válida.', 'Usar data no formato AAAA-MM-DD.');
      if (!isFinite(horas) || horas <= 0) add('erro', 'he', 'he', id, 'horas', 'HE sem horas válidas.', 'Informar horas maiores que zero.');
      if (rid && rid !== '__ALL__' && !resMap[rid]) add('erro', 'he', 'he', id, 'resourceId', `Recurso da HE não encontrado: ${rid}.`, 'Selecionar recurso existente ou Todos.');
      if (!String(o.motivo || o.obs || o.titulo || o.atividade || '').trim()) add('aviso', 'he', 'he', id, 'motivo', 'HE sem motivo/título.', 'Informar motivo para rastreabilidade.');
    }

    for (const rp of (state.reprogrammings || [])) {
      const id = rp.id || '';
      const did = rp.demanda_id || rp.demandId || rp.demand_id || '';
      const novoFim = String(rp.novo_fim || rp.novo_prazo || '').trim();
      if (!did) add('erro', 'reprogramacao', 'reprogramacao', id, 'demanda_id', 'Reprogramação sem demanda vinculada.', 'Vincular reprogramação a uma demanda.');
      else if (!demandMap.has(String(did))) add('erro', 'reprogramacao', 'reprogramacao', id, 'demanda_id', `Demanda da reprogramação não encontrada: ${did}.`, 'Revisar histórico da reprogramação.');
      if (!String(rp.motivo || rp.justificativa || '').trim()) add('erro', 'reprogramacao', 'reprogramacao', id, 'motivo', 'Reprogramação sem motivo.', 'Informar justificativa da reprogramação.');
      if (novoFim && !validDate(novoFim)) add('erro', 'reprogramacao', 'reprogramacao', id, 'novo_fim', 'Novo prazo da reprogramação inválido.', 'Usar data no formato AAAA-MM-DD.');
    }

    return { headers, rows };
  };

  const orizonPackWeekStartKey = (iso) => {
    const d = isoToLocalMidnight(iso);
    if (!d) return '';
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return formatDate(d);
  };

  const buildOrizonPackFactApontamentosData = () => {
    const resMap = resourceById();
    const headers = [
      'apontamento_id','data','semana_inicio','ano_mes','demand_id','demanda','status_atual',
      'responsavel_id','responsavel','etapa','horas','usuario','user_id','observacao',
      'demanda_finalizada','status_final','data_status_final','usuario_status_final','user_id_status_final','justificativa_status_final',
      'created_at','updated_at','updated_by','updated_by_id','antecipado','fora_prazo',
      'predio','focal','prioridade'
    ];
    const rows = [];
    for (const d of (state.demands || [])) {
      const rid = d.responsavel_id || d.resourceId || '';
      const responsavel = resMap[rid]?.nome || d.responsavel || rid || '';
      const finalInfo = demandFinalStatusInfo(d);
      for (const a of normalizeDemandApontamentos(d)) {
        const flags = apontamentoWindowFlags(d, a);
        rows.push({
          apontamento_id: a.id || '',
          data: a.data || '',
          semana_inicio: orizonPackWeekStartKey(a.data),
          ano_mes: String(a.data || '').slice(0, 7),
          demand_id: d.id || '',
          demanda: d.titulo || d.nome || d.id || '',
          status_atual: effectiveStatus ? effectiveStatus(d) : (d.status || ''),
          responsavel_id: rid,
          responsavel,
          etapa: normalizeProjectStep(a.etapa) || a.etapa || '',
          horas: Number(a.horas || 0),
          usuario: a.usuario || '',
          user_id: a.user_id || '',
          observacao: a.observacao || '',
          demanda_finalizada: finalInfo.isFinal ? 'true' : 'false',
          status_final: finalInfo.isFinal ? finalInfo.status : '',
          data_status_final: finalInfo.actionDate || '',
          usuario_status_final: finalInfo.actor || '',
          user_id_status_final: finalInfo.actorId || '',
          justificativa_status_final: finalInfo.reason || '',
          created_at: a.created_at || '',
          updated_at: a.updated_at || '',
          updated_by: a.updated_by || '',
          updated_by_id: a.updated_by_id || '',
          antecipado: flags.early ? 'true' : 'false',
          fora_prazo: flags.late ? 'true' : 'false',
          predio: d.predio || '',
          focal: d.focal || '',
          prioridade: d.prioridade || '',
        });
      }
    }
    return { headers, rows };
  };

  const buildOrizonPackIndicadoresApontamentosData = (factRows=[]) => {
    const headers = ['tipo_indicador','chave','rotulo','horas','quantidade_apontamentos','demandas_distintas','usuarios_distintos'];
    const groups = new Map();
    const add = (tipo, chave, rotulo, row) => {
      const k = `${tipo}::${chave || 'nao_informado'}`;
      if (!groups.has(k)) groups.set(k, {
        tipo_indicador: tipo,
        chave: chave || 'nao_informado',
        rotulo: rotulo || chave || 'Não informado',
        horas: 0,
        quantidade_apontamentos: 0,
        demandas: new Set(),
        usuarios: new Set(),
      });
      const g = groups.get(k);
      g.horas = Math.round((Number(g.horas || 0) + Number(row.horas || 0)) * 100) / 100;
      g.quantidade_apontamentos += 1;
      if (row.demand_id) g.demandas.add(String(row.demand_id));
      if (row.user_id || row.usuario) g.usuarios.add(String(row.user_id || row.usuario));
    };
    for (const r of (factRows || [])) {
      add('por_dia', r.data, formatDateBR(r.data), r);
      add('por_semana', r.semana_inicio, r.semana_inicio ? `Semana de ${formatDateBR(r.semana_inicio)}` : 'Sem semana', r);
      add('por_mes', r.ano_mes, r.ano_mes || 'Sem mês', r);
      add('por_usuario', r.user_id || r.usuario, r.usuario || r.user_id || 'Sem usuário', r);
      add('por_demanda', r.demand_id, r.demanda || r.demand_id || 'Sem demanda', r);
      add('por_status', r.status_atual, r.status_atual || 'Sem status', r);
    }
    const rows = [...groups.values()]
      .map(g => ({
        tipo_indicador: g.tipo_indicador,
        chave: g.chave,
        rotulo: g.rotulo,
        horas: Number(g.horas || 0),
        quantidade_apontamentos: g.quantidade_apontamentos,
        demandas_distintas: g.demandas.size,
        usuarios_distintos: g.usuarios.size,
      }))
      .sort((a,b) => String(a.tipo_indicador).localeCompare(String(b.tipo_indicador)) || Number(b.horas || 0) - Number(a.horas || 0));
    return { headers, rows };
  };

  const buildOrizonPackIndicadoresAtividadeData = (factRows=[]) => {
    const headers = ['origem','atividade','horas','quantidade_registros','demandas_distintas','usuarios_distintos','primeira_data','ultima_data'];
    const groups = new Map();
    for (const r of (factRows || [])) {
      const atividade = r.etapa || 'Não informado';
      const k = `apontamento::${atividade}`;
      if (!groups.has(k)) groups.set(k, {
        origem: 'apontamento', atividade, horas: 0, quantidade_registros: 0, demandas: new Set(), usuarios: new Set(), primeira_data: '', ultima_data: ''
      });
      const g = groups.get(k);
      g.horas = Math.round((Number(g.horas || 0) + Number(r.horas || 0)) * 100) / 100;
      g.quantidade_registros += 1;
      if (r.demand_id) g.demandas.add(String(r.demand_id));
      if (r.user_id || r.usuario) g.usuarios.add(String(r.user_id || r.usuario));
      if (r.data && (!g.primeira_data || r.data < g.primeira_data)) g.primeira_data = r.data;
      if (r.data && (!g.ultima_data || r.data > g.ultima_data)) g.ultima_data = r.data;
    }
    const rows = [...groups.values()]
      .map(g => ({
        origem: g.origem,
        atividade: g.atividade,
        horas: Number(g.horas || 0),
        quantidade_registros: g.quantidade_registros,
        demandas_distintas: g.demandas.size,
        usuarios_distintos: g.usuarios.size,
        primeira_data: g.primeira_data,
        ultima_data: g.ultima_data,
      }))
      .sort((a,b) => Number(b.horas || 0) - Number(a.horas || 0));
    return { headers, rows };
  };

  const orizonPackDaysBetween = (startIso, endIso) => {
    const start = isoToLocalMidnight(startIso);
    const end = isoToLocalMidnight(endIso);
    if (!start || !end || end < start) return [];
    const out = [];
    const cursor = new Date(start.getTime());
    while (cursor.getTime() <= end.getTime()) {
      out.push(new Date(cursor.getTime()));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  };

  const buildOrizonPackFactCapacidadeDiaRecursoData = (ctx=buildOrizonPackAnaliseContext()) => {
    const headers = [
      'data','ano_mes','semana_inicio','resource_id','recurso','tipo_recurso','horas_dia_recurso',
      'capacidade_total_hh','alocado_demandas_hh','alocado_internas_hh','alocado_total_hh',
      'livre_hh','overcap_hh','pct_ocupacao','pct_livre','he_hh','elegivel','motivo_nao_util','tag','classe'
    ];
    const rows = [];
    const days = orizonPackDaysBetween(ctx.periodStart, ctx.periodEnd);
    for (const r of (state.resources || [])) {
      for (const d of days) {
        const info = CapacityEngine.freeHoursInfo(r.id, d);
        const dateStr = info.dateStr || formatDate(d);
        const cap = Number(info.capacity || 0);
        const allocDem = Number(info.allocatedFromDemandsHH || 0);
        const allocInt = Number(info.allocatedFromInternalHH || 0);
        const alloc = Number(info.allocated || 0);
        const free = Number(info.free || 0);
        const he = Number(info.overtime?.total || 0);
        const reason = CapacityEngine.nonWorkingReasonForDay(r.id, d);
        rows.push({
          data: dateStr,
          ano_mes: dateStr.slice(0, 7),
          semana_inicio: orizonPackWeekStartKey(dateStr),
          resource_id: r.id || '',
          recurso: r.nome || '',
          tipo_recurso: r.tipo || '',
          horas_dia_recurso: getResourceHoursForDate(r, d),
          capacidade_total_hh: Number(cap.toFixed(2)),
          alocado_demandas_hh: Number(allocDem.toFixed(2)),
          alocado_internas_hh: Number(allocInt.toFixed(2)),
          alocado_total_hh: Number(alloc.toFixed(2)),
          livre_hh: Number(free.toFixed(2)),
          overcap_hh: Number(Math.max(0, -free).toFixed(2)),
          pct_ocupacao: cap > 0 ? Number(((alloc / cap) * 100).toFixed(1)) : '',
          pct_livre: cap > 0 ? Number(((Math.max(0, free) / cap) * 100).toFixed(1)) : '',
          he_hh: Number(he.toFixed(2)),
          elegivel: info.eligible === false ? 'false' : 'true',
          motivo_nao_util: info.eligible === false ? (reason?.label || info.tag || '') : '',
          tag: info.tag || '',
          classe: info.cls || '',
        });
      }
    }
    return { headers, rows };
  };

  const summarizeOrizonPackCapacityRows = (rows=[]) => {
    const cap = rows.reduce((acc, r) => acc + Number(r.capacidade_total_hh || 0), 0);
    const allocDem = rows.reduce((acc, r) => acc + Number(r.alocado_demandas_hh || 0), 0);
    const allocInt = rows.reduce((acc, r) => acc + Number(r.alocado_internas_hh || 0), 0);
    const alloc = rows.reduce((acc, r) => acc + Number(r.alocado_total_hh || 0), 0);
    const free = rows.reduce((acc, r) => acc + Number(r.livre_hh || 0), 0);
    const over = rows.reduce((acc, r) => acc + Number(r.overcap_hh || 0), 0);
    const he = rows.reduce((acc, r) => acc + Number(r.he_hh || 0), 0);
    return {
      capacidade_total_hh: Number(cap.toFixed(2)),
      alocado_demandas_hh: Number(allocDem.toFixed(2)),
      alocado_internas_hh: Number(allocInt.toFixed(2)),
      alocado_total_hh: Number(alloc.toFixed(2)),
      livre_hh: Number(free.toFixed(2)),
      overcap_hh: Number(over.toFixed(2)),
      he_hh: Number(he.toFixed(2)),
      pct_ocupacao: cap > 0 ? Number(((alloc / cap) * 100).toFixed(1)) : '',
      pct_livre: cap > 0 ? Number(((Math.max(0, free) / cap) * 100).toFixed(1)) : '',
      dias_elegiveis: rows.filter(r => r.elegivel !== 'false').length,
      dias_com_overcap: rows.filter(r => Number(r.overcap_hh || 0) > 0).length,
      dias_com_he: rows.filter(r => Number(r.he_hh || 0) > 0).length,
      dias_com_interna: rows.filter(r => Number(r.alocado_internas_hh || 0) > 0).length,
    };
  };

  const buildOrizonPackIndicadoresRecursoData = (factRows=[], ctx=buildOrizonPackAnaliseContext()) => {
    const headers = [
      'escopo','resource_id','recurso','tipo_recurso','capacidade_total_hh','alocado_demandas_hh',
      'alocado_internas_hh','alocado_total_hh','livre_hh','overcap_hh','he_hh','pct_ocupacao',
      'pct_livre','dias_elegiveis','dias_com_overcap','dias_com_he','dias_com_interna'
    ];
    const scopes = ctx.periodScope === 'mes_atual'
      ? [{ escopo:'mes_atual', rows: factRows }]
      : [
        { escopo:'mes_atual', rows: factRows.filter(r => r.data >= ctx.currentMonthStart && r.data <= ctx.currentMonthEnd) },
        { escopo:'ano_atual', rows: factRows },
      ];
    const rows = [];
    for (const scope of scopes) {
      const byResource = new Map();
      for (const r of scope.rows) {
        const k = r.resource_id || 'nao_informado';
        if (!byResource.has(k)) byResource.set(k, []);
        byResource.get(k).push(r);
      }
      for (const [rid, list] of byResource.entries()) {
        const first = list[0] || {};
        rows.push({
          escopo: scope.escopo,
          resource_id: rid,
          recurso: first.recurso || '',
          tipo_recurso: first.tipo_recurso || '',
          ...summarizeOrizonPackCapacityRows(list),
        });
      }
    }
    return { headers, rows: rows.sort((a,b) => String(a.escopo).localeCompare(String(b.escopo)) || Number(b.pct_ocupacao || 0) - Number(a.pct_ocupacao || 0)) };
  };

  const buildOrizonPackIndicadoresCapacidadeData = (factRows=[], ctx=buildOrizonPackAnaliseContext()) => {
    const headers = [
      'escopo','chave','rotulo','capacidade_total_hh','alocado_demandas_hh','alocado_internas_hh',
      'alocado_total_hh','livre_hh','overcap_hh','he_hh','pct_ocupacao','pct_livre',
      'dias_elegiveis','dias_com_overcap','dias_com_he','dias_com_interna'
    ];
    const monthRows = factRows.filter(r => r.data >= ctx.currentMonthStart && r.data <= ctx.currentMonthEnd);
    const byMonth = new Map();
    for (const r of factRows) {
      const k = r.ano_mes || 'sem_mes';
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(r);
    }
    const rows = ctx.periodScope === 'mes_atual'
      ? [{ escopo:'mes_atual', chave:ctx.currentMonth, rotulo:ctx.currentMonth, ...summarizeOrizonPackCapacityRows(factRows) }]
      : [
        { escopo:'mes_atual', chave:ctx.currentMonth, rotulo:ctx.currentMonth, ...summarizeOrizonPackCapacityRows(monthRows) },
        { escopo:'ano_atual', chave:String(ctx.currentYear), rotulo:String(ctx.currentYear), ...summarizeOrizonPackCapacityRows(factRows) },
      ];
    for (const [month, list] of byMonth.entries()) {
      rows.push({ escopo:'por_mes', chave:month, rotulo:month, ...summarizeOrizonPackCapacityRows(list) });
    }
    return { headers, rows };
  };

  const buildOrizonPackFactPlanejadoDiaDemandaRecursoData = (ctx=buildOrizonPackAnaliseContext()) => {
    const resMap = resourceById();
    const headers = [
      'data','ano_mes','semana_inicio','demand_id','demanda','status_atual','resource_id','recurso',
      'percentual_diario','horas_planejadas_dia','conta_alocacao','elegivel_capacidade',
      'motivo_nao_util','data_inicio','data_fim','baseline_inicio','baseline_fim','predio','focal','prioridade'
    ];
    const rows = [];
    for (const d of (state.demands || [])) {
      const start = String(d.data_inicio || d.start || '').trim();
      const end = String(d.data_fim || d.end || '').trim();
      if (!isISODateString(start) || !isISODateString(end) || end < ctx.periodStart || start > ctx.periodEnd) continue;
      const rangeStart = start < ctx.periodStart ? ctx.periodStart : start;
      const rangeEnd = end > ctx.periodEnd ? ctx.periodEnd : end;
      const statusAtual = effectiveStatus ? effectiveStatus(d) : (d.status || '');
      for (const alloc of demandAllocations(d)) {
        const rid = alloc.resourceId || '';
        const res = resMap[rid];
        const pct = Number(alloc.percentual_diario || 0);
        for (const day of orizonPackDaysBetween(rangeStart, rangeEnd)) {
          const dateStr = formatDate(day);
          const reason = CapacityEngine.nonWorkingReasonForDay(rid, day);
          const elegivel = !reason;
          const contaAlocacao = demandCountsInAllocationOnDate(d, dateStr);
          const activeAllocation = demandAllocationActiveOnDate(alloc, d, dateStr);
          const plannedHH = contaAlocacao && elegivel && activeAllocation ? demandAllocationHoursForDate(alloc, rid, day, state.resources || []) : 0;
          rows.push({
            data: dateStr,
            ano_mes: dateStr.slice(0, 7),
            semana_inicio: orizonPackWeekStartKey(dateStr),
            demand_id: d.id || '',
            demanda: d.titulo || d.nome || d.id || '',
            status_atual: statusAtual,
            resource_id: rid,
            recurso: res?.nome || d.responsavel || rid || '',
            percentual_diario: pct,
            horas_planejadas_dia: Number(plannedHH.toFixed(2)),
            conta_alocacao: contaAlocacao ? 'true' : 'false',
            elegivel_capacidade: elegivel ? 'true' : 'false',
            motivo_nao_util: reason?.label || '',
            data_inicio: start,
            data_fim: end,
            baseline_inicio: d.baseline_inicio || start,
            baseline_fim: d.baseline_fim || end,
            predio: d.predio || '',
            focal: d.focal || '',
            prioridade: d.prioridade || '',
          });
        }
      }
    }
    return { headers, rows };
  };

  const buildOrizonPackIndicadoresDemandaData = (plannedRows=[], apontamentoRows=[], ctx=buildOrizonPackAnaliseContext()) => {
    const headers = [
      'escopo','demand_id','demanda','status_atual','responsavel','horas_planejadas','horas_realizadas',
      'saldo_horas','pct_realizado','qtd_apontamentos','qtd_recursos_planejados','qtd_etapas',
      'apontamentos_antecipados','apontamentos_fora_prazo','data_inicio','data_fim','baseline_inicio','baseline_fim','predio','focal','prioridade'
    ];
    const resMap = resourceById();
    const scopes = ctx.periodScope === 'mes_atual'
      ? [{ escopo:'mes_atual', start:ctx.periodStart, end:ctx.periodEnd }]
      : [
        { escopo:'mes_atual', start:ctx.currentMonthStart, end:ctx.currentMonthEnd },
        { escopo:'ano_atual', start:ctx.currentYearStart, end:ctx.currentYearEnd },
      ];
    const rows = [];
    for (const scope of scopes) {
      for (const d of (state.demands || [])) {
        const did = String(d.id || '');
        const planned = plannedRows.filter(r => String(r.demand_id || '') === did && r.data >= scope.start && r.data <= scope.end);
        const real = apontamentoRows.filter(r => String(r.demand_id || '') === did && r.data >= scope.start && r.data <= scope.end);
        const plannedHH = planned.reduce((acc, r) => acc + Number(r.horas_planejadas_dia || 0), 0);
        const realHH = real.reduce((acc, r) => acc + Number(r.horas || 0), 0);
        if (plannedHH <= 0 && realHH <= 0) continue;
        const rid = d.responsavel_id || d.resourceId || '';
        const etapas = new Set(real.map(r => r.etapa).filter(Boolean));
        const recursos = new Set(planned.map(r => r.resource_id).filter(Boolean));
        rows.push({
          escopo: scope.escopo,
          demand_id: did,
          demanda: d.titulo || d.nome || did || '',
          status_atual: effectiveStatus ? effectiveStatus(d) : (d.status || ''),
          responsavel: resMap[rid]?.nome || d.responsavel || rid || '',
          horas_planejadas: Number(plannedHH.toFixed(2)),
          horas_realizadas: Number(realHH.toFixed(2)),
          saldo_horas: Number((plannedHH - realHH).toFixed(2)),
          pct_realizado: plannedHH > 0 ? Number(((realHH / plannedHH) * 100).toFixed(1)) : (realHH > 0 ? 100 : ''),
          qtd_apontamentos: real.length,
          qtd_recursos_planejados: recursos.size,
          qtd_etapas: etapas.size,
          apontamentos_antecipados: real.filter(r => r.antecipado === 'true').length,
          apontamentos_fora_prazo: real.filter(r => r.fora_prazo === 'true').length,
          data_inicio: d.data_inicio || d.start || '',
          data_fim: d.data_fim || d.end || '',
          baseline_inicio: d.baseline_inicio || d.data_inicio || d.start || '',
          baseline_fim: d.baseline_fim || d.data_fim || d.end || '',
          predio: d.predio || '',
          focal: d.focal || '',
          prioridade: d.prioridade || '',
        });
      }
    }
    return { headers, rows: rows.sort((a,b) => String(a.escopo).localeCompare(String(b.escopo)) || Number(b.pct_realizado || 0) - Number(a.pct_realizado || 0)) };
  };

  const buildOrizonPackFactAtividadesInternasData = (ctx=buildOrizonPackAnaliseContext()) => {
    const resMap = resourceById();
    const headers = [
      'internal_activity_id','data','ano_mes','semana_inicio','resource_id','recurso','tipo','titulo',
      'horas_dia','contabiliza_capacidade','owner_user_id','owner_user_name','created_by','created_by_id',
      'data_inicio','data_fim','observacoes'
    ];
    const rows = [];
    for (const ia of (state.internalActivities || [])) {
      const startRaw = normalizeDateLikeToISO(ia.data_inicio || ia.dataInicio || ia.start_date || ia.data || '');
      const endRaw = normalizeDateLikeToISO(ia.data_fim || ia.dataFim || ia.end_date || startRaw || ia.data || '') || startRaw;
      if (!startRaw || !endRaw || endRaw < ctx.periodStart || startRaw > ctx.periodEnd) continue;
      const start = startRaw < ctx.periodStart ? ctx.periodStart : startRaw;
      const end = endRaw > ctx.periodEnd ? ctx.periodEnd : endRaw;
      const rid = ia.resourceId || ia.resource_id || ia.recurso_id || '';
      const res = resMap[rid];
      for (const day of orizonPackDaysBetween(start, end)) {
        const dateStr = formatDate(day);
        rows.push({
          internal_activity_id: ia.id || '',
          data: dateStr,
          ano_mes: dateStr.slice(0, 7),
          semana_inicio: orizonPackWeekStartKey(dateStr),
          resource_id: rid,
          recurso: res?.nome || rid || '',
          tipo: ia.tipo || '',
          titulo: ia.titulo || '',
          horas_dia: Number(ia.horas_dia ?? ia.horas ?? 0) || 0,
          contabiliza_capacidade: ia.contabiliza_capacidade === false ? 'false' : 'true',
          owner_user_id: internalActivityOwnerId(ia),
          owner_user_name: internalActivityOwnerName(ia),
          created_by: ia.created_by || ia.createdBy || '',
          created_by_id: ia.created_by_id || ia.createdById || '',
          data_inicio: startRaw,
          data_fim: endRaw,
          observacoes: ia.observacoes || '',
        });
      }
    }
    return { headers, rows };
  };

  const buildOrizonPackFactHEData = (ctx=buildOrizonPackAnaliseContext()) => {
    const resMap = resourceById();
    const headers = ['he_id','data','ano_mes','semana_inicio','resource_id','recurso','horas','titulo','motivo','predio','focal','prioridade','observacoes'];
    const rows = (state.overtimes || []).map(o => {
      const date = String(o.date || o.data || '').trim();
      if (!isISODateString(date) || date < ctx.periodStart || date > ctx.periodEnd) return null;
      const rid = o.resourceId || o.recurso_id || o.recurso || '';
      return {
        he_id: o.id || '',
        data: date,
        ano_mes: date.slice(0, 7),
        semana_inicio: orizonPackWeekStartKey(date),
        resource_id: rid,
        recurso: rid === '__ALL__' ? 'Todos os recursos' : (resMap[rid]?.nome || rid || ''),
        horas: Number(o.horas ?? o.hours ?? 0) || 0,
        titulo: o.titulo || o.atividade || '',
        motivo: o.motivo || o.obs || '',
        predio: o.predio || '',
        focal: o.focal || '',
        prioridade: o.prioridade || '',
        observacoes: o.observacoes || '',
      };
    }).filter(Boolean);
    return { headers, rows };
  };

  const buildOrizonPackFactBloqueiosDiaData = (ctx=buildOrizonPackAnaliseContext()) => {
    const resMap = resourceById();
    const headers = ['blocking_id','data','ano_mes','semana_inicio','resource_id','recurso','tipo','observacao','horas_capacidade_removidas','eh_ferias'];
    const rows = [];
    for (const b of (state.blockings || [])) {
      const startRaw = blockingStartDate(b);
      const endRaw = blockingEndDate(b) || startRaw;
      if (!startRaw || !endRaw || endRaw < ctx.periodStart || startRaw > ctx.periodEnd) continue;
      const start = startRaw < ctx.periodStart ? ctx.periodStart : startRaw;
      const end = endRaw > ctx.periodEnd ? ctx.periodEnd : endRaw;
      const rid = blockingResourceId(b);
      const res = resMap[rid];
      const tipo = String(b.tipo || '').trim();
      for (const day of orizonPackDaysBetween(start, end)) {
        const dateStr = formatDate(day);
        const removeHH = (!isWeekend(day) && !isHoliday(dateStr)) ? getResourceHoursForDate(res, day) : 0;
        rows.push({
          blocking_id: b.id || '',
          data: dateStr,
          ano_mes: dateStr.slice(0, 7),
          semana_inicio: orizonPackWeekStartKey(dateStr),
          resource_id: rid,
          recurso: res?.nome || rid || '',
          tipo,
          observacao: b.observacao || '',
          horas_capacidade_removidas: Number(removeHH.toFixed(2)),
          eh_ferias: tipo.toLowerCase() === 'férias' ? 'true' : 'false',
        });
      }
    }
    return { headers, rows };
  };

  const buildOrizonPackIndicadoresInternasData = (factRows=[]) => {
    const headers = ['tipo_indicador','chave','rotulo','horas','quantidade_registros','recursos_distintos','usuarios_distintos'];
    const groups = new Map();
    const add = (tipo, chave, rotulo, row) => {
      const k = `${tipo}::${chave || 'nao_informado'}`;
      if (!groups.has(k)) groups.set(k, { tipo_indicador: tipo, chave: chave || 'nao_informado', rotulo: rotulo || chave || 'Não informado', horas: 0, quantidade_registros: 0, recursos: new Set(), usuarios: new Set() });
      const g = groups.get(k);
      g.horas = Math.round((Number(g.horas || 0) + Number(row.horas_dia || 0)) * 100) / 100;
      g.quantidade_registros += 1;
      if (row.resource_id) g.recursos.add(String(row.resource_id));
      if (row.owner_user_id || row.owner_user_name) g.usuarios.add(String(row.owner_user_id || row.owner_user_name));
    };
    for (const r of factRows || []) {
      add('por_tipo', r.tipo, r.tipo || 'Sem tipo', r);
      add('por_recurso', r.resource_id, r.recurso || r.resource_id || 'Sem recurso', r);
      add('por_usuario', r.owner_user_id || r.owner_user_name, r.owner_user_name || r.owner_user_id || 'Sem usuário', r);
      add('por_mes', r.ano_mes, r.ano_mes || 'Sem mês', r);
    }
    const rows = [...groups.values()].map(g => ({
      tipo_indicador: g.tipo_indicador, chave: g.chave, rotulo: g.rotulo, horas: g.horas,
      quantidade_registros: g.quantidade_registros, recursos_distintos: g.recursos.size, usuarios_distintos: g.usuarios.size,
    })).sort((a,b) => String(a.tipo_indicador).localeCompare(String(b.tipo_indicador)) || Number(b.horas || 0) - Number(a.horas || 0));
    return { headers, rows };
  };

  const buildOrizonPackIndicadoresHEBloqueiosData = (heRows=[], bloqueioRows=[]) => {
    const headers = ['origem','tipo_indicador','chave','rotulo','horas','quantidade_registros','recursos_distintos'];
    const groups = new Map();
    const add = (origem, tipo, chave, rotulo, horas, recursoId) => {
      const k = `${origem}::${tipo}::${chave || 'nao_informado'}`;
      if (!groups.has(k)) groups.set(k, { origem, tipo_indicador: tipo, chave: chave || 'nao_informado', rotulo: rotulo || chave || 'Não informado', horas: 0, quantidade_registros: 0, recursos: new Set() });
      const g = groups.get(k);
      g.horas = Math.round((Number(g.horas || 0) + Number(horas || 0)) * 100) / 100;
      g.quantidade_registros += 1;
      if (recursoId) g.recursos.add(String(recursoId));
    };
    for (const r of heRows || []) {
      add('he', 'por_recurso', r.resource_id, r.recurso || r.resource_id || 'Sem recurso', r.horas, r.resource_id);
      add('he', 'por_motivo', r.motivo || r.titulo, r.motivo || r.titulo || 'Sem motivo', r.horas, r.resource_id);
      add('he', 'por_mes', r.ano_mes, r.ano_mes || 'Sem mês', r.horas, r.resource_id);
    }
    for (const r of bloqueioRows || []) {
      add('bloqueio', 'por_recurso', r.resource_id, r.recurso || r.resource_id || 'Sem recurso', r.horas_capacidade_removidas, r.resource_id);
      add('bloqueio', 'por_tipo', r.tipo, r.tipo || 'Sem tipo', r.horas_capacidade_removidas, r.resource_id);
      add('bloqueio', 'por_mes', r.ano_mes, r.ano_mes || 'Sem mês', r.horas_capacidade_removidas, r.resource_id);
    }
    const rows = [...groups.values()].map(g => ({
      origem: g.origem, tipo_indicador: g.tipo_indicador, chave: g.chave, rotulo: g.rotulo, horas: g.horas,
      quantidade_registros: g.quantidade_registros, recursos_distintos: g.recursos.size,
    })).sort((a,b) => String(a.origem).localeCompare(String(b.origem)) || String(a.tipo_indicador).localeCompare(String(b.tipo_indicador)) || Number(b.horas || 0) - Number(a.horas || 0));
    return { headers, rows };
  };

  const orizonPackReprogramDate = (rp={}) => {
    const direct = normalizeDateLikeToISO(rp.data || rp.date || rp.createdAt || '');
    if (direct) return direct;
    const ts = Number(rp.timestamp || 0);
    return ts > 0 ? formatDate(new Date(ts)) : '';
  };

  const buildOrizonPackFactReprogramacoesData = (ctx=buildOrizonPackAnaliseContext()) => {
    const demandMap = new Map((state.demands || []).map(d => [String(d.id || ''), d]));
    const headers = [
      'reprogramacao_id','data_reprogramacao','ano_mes','demand_id','demanda','status_atual',
      'inicio_original','prazo_original','prazo_anterior','novo_fim','dias_adicionados',
      'motivo','usuario','user_id','timestamp'
    ];
    const rows = [];
    for (const rp of (state.reprogrammings || [])) {
      const date = orizonPackReprogramDate(rp);
      if (date && (date < ctx.periodStart || date > ctx.periodEnd)) continue;
      const did = String(rp.demanda_id || rp.demandId || rp.demand_id || '').trim();
      const d = demandMap.get(did) || {};
      const prevEnd = String(rp.prazo_anterior || rp.prazo_original || d.baseline_fim || '').trim();
      const newEnd = String(rp.novo_fim || rp.novo_prazo || '').trim();
      rows.push({
        reprogramacao_id: rp.id || '',
        data_reprogramacao: date,
        ano_mes: date ? date.slice(0, 7) : '',
        demand_id: did,
        demanda: d.titulo || d.nome || did || '',
        status_atual: d.id && effectiveStatus ? effectiveStatus(d) : (d.status || ''),
        inicio_original: rp.inicio_original || d.baseline_inicio || d.data_inicio || '',
        prazo_original: rp.prazo_original || d.baseline_fim || '',
        prazo_anterior: rp.prazo_anterior || '',
        novo_fim: newEnd,
        dias_adicionados: (isISODateString(prevEnd) && isISODateString(newEnd)) ? Math.max(0, diffDaysISO(prevEnd, newEnd)) : '',
        motivo: rp.motivo || rp.justificativa || '',
        usuario: rp.user || rp.usuario || rp.createdBy || '',
        user_id: rp.user_id || rp.userId || rp.createdById || '',
        timestamp: rp.timestamp || '',
      });
    }
    return { headers, rows };
  };

  const inferOrizonPackDelayReason = ({ demand, metrics, windowClassification, reprogrammings }) => {
    const lastRp = (reprogrammings || [])[reprogrammings.length - 1] || {};
    const motivo = String(lastRp.motivo || lastRp.justificativa || '').trim();
    if (motivo) return `Reprogramado: ${motivo}`;
    if (Number(metrics.apontamentosCount || 0) === 0 && daysLate(demand) > 0) return 'Sem execução registrada';
    if (Number(metrics.plannedHours || 0) > 0 && Number(metrics.progressPct || 0) < 50 && daysLate(demand) > 0) return 'Execução abaixo do planejado';
    if (windowClassification?.hasLateExecution) return 'Execução fora do prazo';
    if (Number(metrics.realHours || 0) > Number(metrics.plannedHours || 0) && Number(metrics.plannedHours || 0) > 0) return 'Esforço acima do estimado';
    if (windowClassification?.exceedsPlannedWindow) return 'Prazo original excedido';
    if (effectiveStatus(demand) === 'Atrasada') return 'Prazo vencido';
    return 'Sem atraso identificado';
  };

  const buildOrizonPackFactAtrasosData = () => {
    const resMap = resourceById();
    const headers = [
      'demand_id','demanda','status_atual','responsavel','data_inicio','data_fim','baseline_inicio','baseline_fim',
      'dias_atraso','prazo_original_excedido','dias_excedidos_original','qtd_reprogramacoes','ultimo_motivo_reprogramacao',
      'data_conclusao','classificacao_conclusao','concluida_pos_postergacao','dias_apos_prazo',
      'motivo_inferido','horas_planejadas','horas_realizadas','saldo_horas','pct_realizado',
      'qtd_apontamentos','apontamentos_antecipados','apontamentos_fora_prazo','horas_antecipadas','horas_fora_prazo',
      'predio','focal','prioridade'
    ];
    const rows = [];
    for (const d of (state.demands || [])) {
      const apontamentos = normalizeDemandApontamentos(d);
      const metrics = demandExecutionMetrics(d, apontamentos);
      const wc = demandWindowClassification(d, apontamentos);
      const rps = relatedDemandReprogrammings(d, state.reprogrammings);
      const st = effectiveStatus ? effectiveStatus(d) : (d.status || '');
      const isAttention = st === 'Atrasada' || wc.exceedsPlannedWindow || wc.hasLateExecution || Number(metrics.realHours || 0) > Number(metrics.plannedHours || 0);
      if (!isAttention) continue;
      const rid = d.responsavel_id || d.resourceId || '';
      const lastRp = rps[rps.length - 1] || {};
      const completionInfo = demandCompletionInfo(d);
      rows.push({
        demand_id: d.id || '',
        demanda: d.titulo || d.nome || d.id || '',
        status_atual: st,
        responsavel: resMap[rid]?.nome || d.responsavel || rid || '',
        data_inicio: d.data_inicio || d.start || '',
        data_fim: d.data_fim || d.end || '',
        baseline_inicio: wc.baselineStart || d.baseline_inicio || d.data_inicio || '',
        baseline_fim: wc.baselineEnd || d.baseline_fim || d.data_fim || '',
        dias_atraso: daysLate(d),
        prazo_original_excedido: wc.exceedsPlannedWindow ? 'true' : 'false',
        dias_excedidos_original: wc.exceededDays || 0,
        qtd_reprogramacoes: rps.length,
        ultimo_motivo_reprogramacao: lastRp.motivo || lastRp.justificativa || '',
        data_conclusao: completionInfo.completionDate || '',
        classificacao_conclusao: completionInfo.classification || '',
        concluida_pos_postergacao: completionInfo.wasPostponed ? 'true' : 'false',
        dias_apos_prazo: completionInfo.daysDelta === '' ? '' : Math.max(0, Number(completionInfo.daysDelta || 0)),
        motivo_inferido: inferOrizonPackDelayReason({ demand:d, metrics, windowClassification:wc, reprogrammings:rps }),
        horas_planejadas: Number(metrics.plannedHours || 0),
        horas_realizadas: Number(metrics.realHours || 0),
        saldo_horas: Number(metrics.delta || 0),
        pct_realizado: Number(metrics.progressPct || 0),
        qtd_apontamentos: Number(metrics.apontamentosCount || 0),
        apontamentos_antecipados: wc.earlyCount || 0,
        apontamentos_fora_prazo: wc.lateCount || 0,
        horas_antecipadas: wc.earlyHours || 0,
        horas_fora_prazo: wc.lateHours || 0,
        predio: d.predio || '',
        focal: d.focal || '',
        prioridade: d.prioridade || '',
      });
    }
    return { headers, rows };
  };

  const buildOrizonPackIndicadoresAtrasosData = (atrasoRows=[], reprogramRows=[]) => {
    const headers = ['tipo_indicador','chave','rotulo','quantidade','dias_atraso','horas_planejadas','horas_realizadas','horas_fora_prazo','dias_adicionados'];
    const groups = new Map();
    const add = (tipo, chave, rotulo, row={}) => {
      const k = `${tipo}::${chave || 'nao_informado'}`;
      if (!groups.has(k)) groups.set(k, { tipo_indicador: tipo, chave: chave || 'nao_informado', rotulo: rotulo || chave || 'Não informado', quantidade: 0, dias_atraso: 0, horas_planejadas: 0, horas_realizadas: 0, horas_fora_prazo: 0, dias_adicionados: 0 });
      const g = groups.get(k);
      g.quantidade += 1;
      g.dias_atraso += Number(row.dias_atraso || 0);
      g.horas_planejadas += Number(row.horas_planejadas || 0);
      g.horas_realizadas += Number(row.horas_realizadas || 0);
      g.horas_fora_prazo += Number(row.horas_fora_prazo || 0);
      g.dias_adicionados += Number(row.dias_adicionados || 0);
    };
    for (const r of atrasoRows || []) {
      add('atraso_por_motivo', r.motivo_inferido, r.motivo_inferido, r);
      add('atraso_por_status', r.status_atual, r.status_atual, r);
      add('atraso_por_responsavel', r.responsavel, r.responsavel, r);
    }
    for (const r of reprogramRows || []) {
      add('reprogramacao_por_motivo', r.motivo, r.motivo || 'Sem motivo', r);
      add('reprogramacao_por_mes', r.ano_mes, r.ano_mes || 'Sem mês', r);
    }
    const rows = [...groups.values()].map(g => ({
      tipo_indicador: g.tipo_indicador, chave: g.chave, rotulo: g.rotulo, quantidade: g.quantidade,
      dias_atraso: g.dias_atraso, horas_planejadas: Number(g.horas_planejadas.toFixed(2)),
      horas_realizadas: Number(g.horas_realizadas.toFixed(2)), horas_fora_prazo: Number(g.horas_fora_prazo.toFixed(2)),
      dias_adicionados: g.dias_adicionados,
    })).sort((a,b) => String(a.tipo_indicador).localeCompare(String(b.tipo_indicador)) || Number(b.quantidade || 0) - Number(a.quantidade || 0));
    return { headers, rows };
  };

  const ensureOrizonPackAnaliseModal = () => {
    let dlg = qs('#orizonPackAnaliseModal');
    if (dlg) return dlg;
    dlg = el('dialog', { id:'orizonPackAnaliseModal', class:'modal' }, [
      el('div', { class:'modalCard', style:'max-width:720px' }, [
        el('div', { class:'modalHd' }, [
          el('div', {}, [
            el('div', { class:'modalTitle' }, ['Orizon Pack de Análise']),
            el('div', { class:'modalSub' }, ['Configure o período dos fatos antes de gerar o XLS multiaba.']),
          ]),
          el('button', { class:'btn ghost', type:'button', id:'orizonPackAnaliseClose' }, ['Fechar ×']),
        ]),
        el('div', { class:'modalBd', id:'orizonPackAnaliseBody' }, []),
      ]),
    ]);
    document.body.appendChild(dlg);
    qs('#orizonPackAnaliseClose', dlg)?.addEventListener('click', () => closeDialog(dlg));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDialog(dlg); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeDialog(dlg); });
    return dlg;
  };

  const openOrizonPackAnaliseModal = () => {
    const ctx = buildOrizonPackAnaliseContext();
    const dlg = ensureOrizonPackAnaliseModal();
    const body = qs('#orizonPackAnaliseBody', dlg);
    const scopeSelect = el('select', { id:'orizonPackScope', style:'width:100%' }, [
      el('option', { value:'ano_atual', selected:'selected' }, [`Ano atual (${ctx.currentYearStart} a ${ctx.currentYearEnd})`]),
      el('option', { value:'mes_atual' }, [`Mês atual (${ctx.currentMonthStart} a ${ctx.currentMonthEnd})`]),
    ]);
    body.innerHTML = '';
    body.appendChild(el('div', { class:'grid' }, [
      el('label', {}, [el('b', {}, ['Período dos fatos']), scopeSelect]),
      el('div', { class:'hint' }, [
        el('b', {}, ['O que entra no pacote?']),
        el('div', { class:'tiny muted', style:'margin-top:6px;line-height:1.5' }, [
          'Dimensões e diagnóstico olham para a base completa. Fatos operacionais, capacidade, planejamento, HE, bloqueios, internas e reprogramações respeitam o período escolhido. Atividades internas saem completas no XLS para análise, mantendo a privacidade apenas na tela operacional.'
        ]),
      ]),
      el('div', { class:'grid two' }, [
        el('div', { class:'card kpi' }, [el('div', { class:'tiny muted' }, ['Abas principais']), el('div', { class:'big' }, ['21'])]),
        el('div', { class:'card kpi' }, [el('div', { class:'tiny muted' }, ['Modo internas']), el('div', { class:'big' }, ['Completo'])]),
      ]),
      el('div', { class:'modalActions' }, [
        button('Cancelar', '', () => closeDialog(dlg)),
        button('Gerar Orizon Pack', 'primary', () => {
          closeDialog(dlg);
          exportOrizonPackAnaliseWorkbook({ scope: scopeSelect.value });
        }),
      ]),
    ]));
    openDialog(dlg);
  };

  const orizonPackSlug = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'nao_informado';

  const sumOrizonPackRows = (rows=[], field) => Number((rows || []).reduce((acc, r) => acc + Number(r[field] || 0), 0).toFixed(2));

  const countOrizonPackRowsInRange = (rows=[], dateField, start, end) => (rows || []).filter(r => {
    const d = String(r[dateField] || '').slice(0, 10);
    return d && d >= start && d <= end;
  }).length;

  const buildOrizonPackKpiExecutivoData = ({ ctx, qualidade, factApontamentos, factCapacidade, factPlanejado, factInternas, factHE, factBloqueios, factReprogramacoes, factAtrasos }) => {
    const headers = ['categoria','indicador','escopo','valor','unidade','observacao'];
    const rows = [];
    const add = (categoria, indicador, escopo, valor, unidade='', observacao='') => rows.push({
      categoria, indicador, escopo, valor: typeof valor === 'number' ? Number((Number.isFinite(valor) ? valor : 0).toFixed(2)) : valor, unidade, observacao,
    });
    const demands = state.demands || [];
    const resources = state.resources || [];
    const demandStatus = new Map();
    for (const d of demands) {
      const st = effectiveStatus ? effectiveStatus(d) : (d.status || 'Sem status');
      demandStatus.set(st, (demandStatus.get(st) || 0) + 1);
    }
    add('base', 'total_recursos', 'base_completa', resources.length, 'recursos');
    add('base', 'recursos_ativos', 'base_completa', resources.filter(r => r.ativo !== false).length, 'recursos');
    add('base', 'total_demandas', 'base_completa', demands.length, 'demandas');
    for (const [status, total] of [...demandStatus.entries()].sort((a,b) => String(a[0]).localeCompare(String(b[0])))) {
      add('base', `demandas_${orizonPackSlug(status || 'sem_status')}`, 'base_completa', total, 'demandas', status || 'Sem status');
    }
    const capPeriodo = summarizeOrizonPackCapacityRows(factCapacidade.rows || []);
    const capMes = summarizeOrizonPackCapacityRows((factCapacidade.rows || []).filter(r => r.data >= ctx.currentMonthStart && r.data <= ctx.currentMonthEnd));
    add('capacidade', 'capacidade_total_hh', ctx.periodScope, capPeriodo.capacidade_total_hh, 'hh');
    add('capacidade', 'alocado_total_hh', ctx.periodScope, capPeriodo.alocado_total_hh, 'hh');
    add('capacidade', 'livre_hh', ctx.periodScope, capPeriodo.livre_hh, 'hh');
    add('capacidade', 'overcap_hh', ctx.periodScope, capPeriodo.overcap_hh, 'hh');
    add('capacidade', 'ocupacao_pct', ctx.periodScope, capPeriodo.pct_ocupacao, '%');
    add('capacidade', 'capacidade_mes_atual_hh', 'mes_atual', capMes.capacidade_total_hh, 'hh');
    add('capacidade', 'ocupacao_mes_atual_pct', 'mes_atual', capMes.pct_ocupacao, '%');
    add('execucao', 'apontamentos_qtd_periodo', ctx.periodScope, countOrizonPackRowsInRange(factApontamentos.rows, 'data', ctx.periodStart, ctx.periodEnd), 'registros');
    add('execucao', 'apontamentos_hh_periodo', ctx.periodScope, sumOrizonPackRows((factApontamentos.rows || []).filter(r => r.data >= ctx.periodStart && r.data <= ctx.periodEnd), 'horas'), 'hh');
    add('planejamento', 'planejado_hh_periodo', ctx.periodScope, sumOrizonPackRows(factPlanejado.rows || [], 'horas_planejadas_dia'), 'hh');
    add('internas', 'atividades_internas_hh_periodo', ctx.periodScope, sumOrizonPackRows(factInternas.rows || [], 'horas_dia'), 'hh');
    add('internas', 'atividades_internas_registros_periodo', ctx.periodScope, (factInternas.rows || []).length, 'registros');
    add('calendario', 'he_hh_periodo', ctx.periodScope, sumOrizonPackRows(factHE.rows || [], 'horas'), 'hh');
    add('calendario', 'bloqueios_hh_removidas_periodo', ctx.periodScope, sumOrizonPackRows(factBloqueios.rows || [], 'horas_capacidade_removidas'), 'hh');
    add('reprogramacoes', 'reprogramacoes_periodo', ctx.periodScope, (factReprogramacoes.rows || []).length, 'registros');
    add('atrasos', 'demandas_em_diagnostico_atraso', 'base_completa', (factAtrasos.rows || []).length, 'demandas');
    add('atrasos', 'horas_fora_prazo', 'base_completa', sumOrizonPackRows(factAtrasos.rows || [], 'horas_fora_prazo'), 'hh');
    add('qualidade', 'alertas_qualidade', 'base_completa', (qualidade.rows || []).length, 'alertas');
    add('pacote', 'abas_exportadas', 'arquivo', 21, 'abas', 'Manifesto, dimensões, fatos, indicadores, KPI executivo e qualidade.');
    return { headers, rows };
  };

  const exportOrizonPackAnaliseWorkbook = (options={}) => {
    const ctx = buildOrizonPackAnaliseContext(options);
    const qualidade = buildOrizonPackQualidadeDadosData();
    const factApontamentos = buildOrizonPackFactApontamentosData();
    const indicadoresApontamentos = buildOrizonPackIndicadoresApontamentosData(factApontamentos.rows);
    const indicadoresAtividade = buildOrizonPackIndicadoresAtividadeData(factApontamentos.rows);
    const factCapacidade = buildOrizonPackFactCapacidadeDiaRecursoData(ctx);
    const indicadoresRecurso = buildOrizonPackIndicadoresRecursoData(factCapacidade.rows, ctx);
    const indicadoresCapacidade = buildOrizonPackIndicadoresCapacidadeData(factCapacidade.rows, ctx);
    const factPlanejado = buildOrizonPackFactPlanejadoDiaDemandaRecursoData(ctx);
    const indicadoresDemanda = buildOrizonPackIndicadoresDemandaData(factPlanejado.rows, factApontamentos.rows, ctx);
    const factInternas = buildOrizonPackFactAtividadesInternasData(ctx);
    const factHE = buildOrizonPackFactHEData(ctx);
    const factBloqueios = buildOrizonPackFactBloqueiosDiaData(ctx);
    const indicadoresInternas = buildOrizonPackIndicadoresInternasData(factInternas.rows);
    const indicadoresHEBloqueios = buildOrizonPackIndicadoresHEBloqueiosData(factHE.rows, factBloqueios.rows);
    const factReprogramacoes = buildOrizonPackFactReprogramacoesData(ctx);
    const factAtrasos = buildOrizonPackFactAtrasosData();
    const indicadoresAtrasos = buildOrizonPackIndicadoresAtrasosData(factAtrasos.rows, factReprogramacoes.rows);
    const kpiExecutivo = buildOrizonPackKpiExecutivoData({ ctx, qualidade, factApontamentos, factCapacidade, factPlanejado, factInternas, factHE, factBloqueios, factReprogramacoes, factAtrasos });
    downloadExcelWorkbook(`orizon_pack_analise_${ctx.exportDate}.xls`, [
      { name:'manifest', ...buildOrizonPackManifestData(ctx, qualidade.rows) },
      { name:'kpi_executivo', ...kpiExecutivo },
      { name:'dim_recurso', ...buildOrizonPackDimRecursoData() },
      { name:'dim_demanda', ...buildOrizonPackDimDemandaData() },
      { name:'fact_apontamentos', ...factApontamentos },
      { name:'fact_capacidade', ...factCapacidade },
      { name:'fact_planejado', ...factPlanejado },
      { name:'fact_internas', ...factInternas },
      { name:'fact_he', ...factHE },
      { name:'fact_bloqueios', ...factBloqueios },
      { name:'fact_reprogramacoes', ...factReprogramacoes },
      { name:'fact_atrasos', ...factAtrasos },
      { name:'indic_apontamentos', ...indicadoresApontamentos },
      { name:'indic_atividade', ...indicadoresAtividade },
      { name:'indic_recurso', ...indicadoresRecurso },
      { name:'indic_capacidade', ...indicadoresCapacidade },
      { name:'indic_demanda', ...indicadoresDemanda },
      { name:'indic_internas', ...indicadoresInternas },
      { name:'indic_he_bloq', ...indicadoresHEBloqueios },
      { name:'indic_atrasos', ...indicadoresAtrasos },
      { name:'qualidade_dados', ...qualidade },
    ]);
    toast('Orizon Pack de Análise exportado.');
  };

  const buildBloqueiosExportData = () => {
    const resMap = resourceById();
    return {
      headers: ['id','recurso','data','tipo','observacao'],
      rows: buildBlockingDisplayRows(state.blockings||[]).map(b => ({
        id: (b.ids || [b.id]).filter(Boolean).join('|'),
        recurso: resMap[b.resourceId]?.nome || b.resourceId || '',
        data: blockingDateLabel(b),
        tipo: b.tipo || '',
        observacao: b.observacao || ''
      }))
    };
  };

  const buildFeriadosExportData = () => ({
    headers: ['id','data','descricao'],
    rows: (state.holidays||[]).map(h => ({
      id: (typeof h === 'string') ? '' : (h.id || ''),
      data: (typeof h === 'string') ? h : (h.data || h.date || ''),
      descricao: (typeof h === 'string') ? '' : (h.descricao || h.desc || '')
    }))
  });

  const buildHEExportData = () => {
    const resMap = resourceById();
    return {
      headers: ['id','recurso','data','horas','titulo','motivo','predio','focal','prioridade','observacoes'],
      rows: (state.overtimes||[]).map(o => {
        const rid = o.resourceId || o.recurso_id || o.recurso || '';
        return {
          id: o.id || '',
          recurso: rid === '__ALL__' ? 'Todos os recursos' : (resMap[rid]?.nome || rid),
          data: o.date || o.data || '',
          horas: (o.horas ?? o.hours ?? ''),
          titulo: o.titulo || o.atividade || '',
          motivo: o.motivo || o.obs || '',
          predio: o.predio || '',
          focal: o.focal || '',
          prioridade: o.prioridade || '',
          observacoes: o.observacoes || ''
        };
      })
    };
  };

  const exportDemandasCSV = () => {
    const headers = [
      'id','titulo','responsavel','data_inicio','data_fim','status_base','status_atual',
      'concluida','data_conclusao','classificacao_conclusao','concluida_pos_postergacao','qtd_reprogramacoes','dias_apos_prazo',
      'percentual_diario','horas_planejadas_dia','prioridade','observacoes'
    ];
    const rows = (state.demands||[]).map(d => {
      const alloc = demandAllocations(d)[0] || {};
      const completionInfo = demandCompletionInfo(d);
      return {
        id: d.id || '',
        titulo: d.titulo || d.nome || '',
        responsavel: d.resourceId || d.responsavel || '',
        data_inicio: d.start || d.data_inicio || '',
        data_fim: d.end || d.data_fim || '',
        status_base: d.status || '',
        status_atual: effectiveStatus ? effectiveStatus(d) : (d.status||''),
        concluida: completionInfo.isCompleted ? 'true' : 'false',
        data_conclusao: completionInfo.completionDate || '',
        classificacao_conclusao: completionInfo.classification || '',
        concluida_pos_postergacao: completionInfo.wasPostponed ? 'true' : 'false',
        qtd_reprogramacoes: completionInfo.reprogrammingsCount || 0,
        dias_apos_prazo: completionInfo.daysDelta === '' ? '' : Math.max(0, Number(completionInfo.daysDelta || 0)),
        percentual_diario: (alloc.percentual_diario ?? d.dailyPercent ?? d.percentual_diario ?? d.percent ?? ''),
        horas_planejadas_dia: (alloc.horas_planejadas_dia ?? d.horas_planejadas_dia ?? d.horas_dia ?? ''),
        prioridade: d.prioridade || '',
        observacoes: d.obs || d.observacoes || ''
      };
    });
    downloadText('demandas.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Demandas exportado.');
  };

  const exportRecursosCSV = () => {
    const headers = ['id','nome','tipo','ativo','inicio','fim'];
    const rows = (state.resources||[]).map(r => ({
      id: r.id || '',
      nome: r.nome || '',
      tipo: r.tipo || '',
      ativo: (r.ativo === false) ? 'false' : 'true',
      inicio: r.inicio || '',
      fim: r.fim || ''
    }));
    downloadText('recursos.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Recursos exportado.');
  };

  const exportBloqueiosCSV = () => {
    const headers = ['id','recurso','data','tipo','observacao'];
    const resMap = resourceById();
    const rows = buildBlockingDisplayRows(state.blockings||[]).map(b => ({
      id: (b.ids || [b.id]).filter(Boolean).join('|'),
      recurso: resMap[b.resourceId]?.nome || b.resourceId || '',
      data: blockingDateLabel(b),
      tipo: b.tipo || '',
      observacao: b.observacao || ''
    }));
    downloadText('bloqueios.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Bloqueios exportado.');
  };

  const exportFeriadosCSV = () => {
    const headers = ['data','descricao'];
    const rows = (state.holidays||[]).map(h => ({
      data: (typeof h === 'string') ? h : (h.date || ''),
      descricao: (typeof h === 'string') ? '' : (h.desc || h.descricao || '')
    }));
    downloadText('feriados.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de Feriados exportado.');
  };

  const exportHECSV = () => {
    const headers = ['id','recurso','data','horas','motivo'];
    const rows = (state.overtimes||[]).map(o => ({
      id: o.id || '',
      recurso: o.resourceId || o.recurso || '',
      data: o.date || o.data || '',
      horas: (o.horas ?? o.hours ?? ''),
      motivo: o.motivo || o.obs || ''
    }));
    downloadText('he.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
    toast('CSV de HE exportado.');
  };

  const monthStatsForExport = (resourceId, y, m0) => {
    const days = getDaysInMonth(y, m0);
    let dias_uteis_contados = 0;
    let dias_com_bloqueio = 0;
    let dias_com_feriado = 0;
    let dias_com_HE = 0;

    // Local, export-safe HE lookup (do not depend on view-scoped helpers).
    const overtimeTotalLocal = (rid, dateStr) => {
      const list = (state.overtimes || state.he || []);
      let sum = 0;
      for (const o of list) {
        const r = (o.resourceId ?? o.recurso_id ?? o.recurso ?? o.resource ?? '');
        const dt = (o.date ?? o.data ?? '');
        if (!r || !dt) continue;
        if (String(r) !== String(rid)) continue;
        if (String(dt) !== String(dateStr)) continue;
        const h = Number(o.horas ?? o.hours ?? 0);
        if (isFinite(h)) sum += h;
      }
      return sum;
    };

    for (const d of days) {
      const dateStr = formatDate(d);
      // Export must not depend on freeHoursInfo() (it may be scoped inside the Janelas view).
      // Eligibility rule (same intent as Janelas Livres): weekends are ignored unless there is HE for that day.
      const isWeekend = (d.getDay() === 0 || d.getDay() === 6);
      const hasHE = (overtimeTotalLocal(resourceId, dateStr) > 0) || (overtimeTotalLocal('__ALL__', dateStr) > 0);
      if (isWeekend && !hasHE) continue;
      dias_uteis_contados += 1;
      if (hasHE) dias_com_HE += 1;
      if (isHoliday(dateStr)) dias_com_feriado += 1;
      if (blockingFor(resourceId, dateStr)) dias_com_bloqueio += 1;
    }

    return { dias_uteis_contados, dias_com_bloqueio, dias_com_feriado, dias_com_HE };
  };

  const exportJanelasPorRecursoMesCSV = () => {
    try {
	      const whLocal = (typeof wh !== 'undefined' && wh) ? wh : {
	        startMonth: '',
	        months: 6,
	        metric: 'pct',
	        dynamicOrder: true,
	        sortDir: 'desc',
	        fixedOrderIds: [],
	        show: 'all',
	        topN: 10,
	      };
      // NOTE: buildMonths/monthlyWindow are scoped inside the Janelas Livres view.
      // Export must be self-contained to avoid ReferenceError when the view isn't mounted.
      const clampMonthsLocal = (n) => {
        const v = Math.max(1, Math.min(36, Number(n || 6)));
        return isFinite(v) ? v : 6;
      };
      const parseStartMonthLocal = (ym) => {
        const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
        if (!m) {
          const now = new Date();
          return { y: now.getFullYear(), m0: now.getMonth() };
        }
        return { y: Number(m[1]), m0: Number(m[2]) - 1 };
      };
      const fmtMonthLabelLocal = (y, m0) => {
        const d = new Date(y, m0, 1);
        return d.toLocaleString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
      };
      const monthKeyLocal = (y, m0) => `${y}-${String(m0 + 1).padStart(2, '0')}`;
      const addMonthsLocal = (y, m0, delta) => {
        const d = new Date(y, m0 + delta, 1);
        return { y: d.getFullYear(), m0: d.getMonth() };
      };
	      const buildMonthsLocal = () => {
	        const start = whLocal.startMonth || '';
        const { y, m0 } = parseStartMonthLocal(start);
	        const count = clampMonthsLocal(whLocal.months);
        const list = [];
        for (let i = 0; i < count; i++) {
          const mm = addMonthsLocal(y, m0, i);
          list.push({
            y: mm.y,
            m0: mm.m0,
            key: monthKeyLocal(mm.y, mm.m0),
            label: fmtMonthLabelLocal(mm.y, mm.m0),
          });
        }
        return list;
      };
      const monthlyWindowLocal = (resourceId, y, m0) => {
        // Alguns helpers (como freeHoursInfo) podem estar escopados em views.
        // Para o export, garantimos um fallback local equivalente.
        const freeHoursInfoLocal = (typeof freeHoursInfo === 'function') ? freeHoursInfo : ((rid, dObj) => {
          const dateStr = formatDate(dObj);
          const ot = (typeof overtimeInfo === 'function') ? overtimeInfo(rid, dateStr) : { total: 0, items: [] };
          const otHours = Math.max(0, Number(ot.total || 0));
          const res = (state.resources || []).find(r => r.id === rid);
          const blk0 = blockingFor(rid, dateStr);
          const blockedNoHe = isWeekend(dObj) || isHoliday(dateStr) || !!blk0 || isThirdPartyOff(res, dateStr);

          // Regra: dias não úteis não recebem demanda normal. Com HE, só a capacidade extra entra.
          if (blockedNoHe && otHours <= 0) {
            return { dateStr, capacity: 0, allocated: 0, free: 0, eligible: false, overtime: ot };
          }

          // Capacidade base (janelas): dia útil usa as horas do recurso; dia não útil = 0h; HE soma sobre a data/recurso.
          let base = blockedNoHe ? 0 : getResourceHoursForDate(res, dObj);

          const capacity = Math.max(0, Number(base || 0)) + otHours;

          // Alocado usa a regra central de horas do recurso (Interno 9h, Terceiro 8h).
          const info = CapacityEngine.freeHoursInfo(rid, dObj);
          return { dateStr, capacity: Number(info.capacity||0), allocated: Number(info.allocated||0), free: Number(info.free||0), eligible: info.eligible !== false, overtime: ot };
        });
        const days = getDaysInMonth(y, m0);
        let cap = 0;
        let alloc = 0;
        let free = 0;
        let daysZero = 0;
        let daysOver = 0;
        for (const d of days) {
          const info = freeHoursInfoLocal(resourceId, d);
          // Fins de semana sem HE não entram no cálculo mensal de janelas
          if (info.eligible === false) continue;
          cap += info.capacity;
          alloc += info.allocated;
          free += info.free;
          if (info.free <= 0) daysZero += 1;
          if (info.free < 0) daysOver += 1;
        }
        const pct = cap > 0 ? (free / cap) * 100 : 0;
        return {
          y, m0,
          key: monthKeyLocal(y, m0),
          label: fmtMonthLabelLocal(y, m0),
          cap, alloc, free, pct,
          days: days.length,
          daysZero,
          daysOver,
        };
      };

      const months = buildMonthsLocal();
      const resources = (state.resources||[]);

      if (!months.length) {
        toast('Sem meses configurados para exportar.');
        return;
      }
      if (!resources.length) {
        toast('Não há recursos cadastrados para exportar.');
        return;
      }

      // build per resource same logic as heatmap (but export ALL rows, not just current page)
	      const perRes = resources.map(r => {
        const ms = months.map(mm => monthlyWindowLocal(r.id, mm.y, mm.m0));
	        const score = (whLocal.metric === 'pct')
          ? (ms.reduce((a,b)=>a + b.pct, 0) / Math.max(1, ms.length))
          : ms.reduce((a,b)=>a + b.free, 0);
        return { r, ms, score };
      });

	      if (whLocal.dynamicOrder) {
	        const dir = whLocal.sortDir === 'desc' ? -1 : 1;
        perRes.sort((a,b) => (a.score - b.score) * dir);
	      } else if (Array.isArray(whLocal.fixedOrderIds)) {
	        const idx = new Map(whLocal.fixedOrderIds.map((id,i)=>[id,i]));
        perRes.sort((a,b) => (idx.get(a.r.id) ?? 1e9) - (idx.get(b.r.id) ?? 1e9));
      }

	      const allRows = (whLocal.show === 'top') ? perRes.slice(0, Math.max(1, Number(whLocal.topN||10))) : perRes;

      const headers = ['recurso','mes','horas_total','horas_livre','pct_livre','dias_uteis_contados','dias_com_bloqueio','dias_com_feriado','dias_com_HE'];
      const rows = [];

      for (const rr of allRows) {
        for (const m of rr.ms) {
          const stats = monthStatsForExport(rr.r.id, m.y, m.m0);
          rows.push({
            recurso: rr.r.nome,
            mes: m.key,
            horas_total: Number(m.cap||0).toFixed(1),
            horas_livre: Number(m.free||0).toFixed(1),
            pct_livre: Number(Math.max(0,m.pct)||0).toFixed(1),
            dias_uteis_contados: stats.dias_uteis_contados,
            dias_com_bloqueio: stats.dias_com_bloqueio,
            dias_com_feriado: stats.dias_com_feriado,
            dias_com_HE: stats.dias_com_HE,
          });
        }
      }

      downloadText('janelas_por_recurso_mes.csv', toCSV(rows, headers), 'application/vnd.ms-excel;charset=utf-8');
      toast('CSV de Janelas Livres (Recursos × Meses) exportado.');
    } catch (e) {
      console.error(e);
      toast('Falha ao exportar Janelas Livres. Veja o console (F12) para detalhes.');
    }
  };

  const buildJanelasExportData = () => {
    const whLocal = (typeof wh !== 'undefined' && wh) ? wh : {
      startMonth: '',
      months: 6,
      metric: 'pct',
      dynamicOrder: true,
      sortDir: 'desc',
      fixedOrderIds: [],
      show: 'all',
      topN: 10,
    };
    const clampMonthsLocal = (n) => {
      const v = Math.max(1, Math.min(36, Number(n || 6)));
      return isFinite(v) ? v : 6;
    };
    const parseStartMonthLocal = (ym) => {
      const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
      if (!m) {
        const now = new Date();
        return { y: now.getFullYear(), m0: now.getMonth() };
      }
      return { y: Number(m[1]), m0: Number(m[2]) - 1 };
    };
    const fmtMonthLabelLocal = (y, m0) => new Date(y, m0, 1)
      .toLocaleString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
    const monthKeyLocal = (y, m0) => `${y}-${String(m0 + 1).padStart(2, '0')}`;
    const addMonthsLocal = (y, m0, delta) => {
      const d = new Date(y, m0 + delta, 1);
      return { y: d.getFullYear(), m0: d.getMonth() };
    };
    const buildMonthsLocal = () => {
      const { y, m0 } = parseStartMonthLocal(whLocal.startMonth || '');
      const count = clampMonthsLocal(whLocal.months);
      const list = [];
      for (let i = 0; i < count; i++) {
        const mm = addMonthsLocal(y, m0, i);
        list.push({ y: mm.y, m0: mm.m0, key: monthKeyLocal(mm.y, mm.m0), label: fmtMonthLabelLocal(mm.y, mm.m0) });
      }
      return list;
    };
    const monthlyWindowLocal = (resourceId, y, m0) => {
      const freeHoursInfoLocal = (typeof freeHoursInfo === 'function') ? freeHoursInfo : ((rid, dObj) => {
        const dateStr = formatDate(dObj);
        const ot = (typeof overtimeInfo === 'function') ? overtimeInfo(rid, dateStr) : { total: 0, items: [] };
        const otHours = Math.max(0, Number(ot.total || 0));
        const res = (state.resources || []).find(r => r.id === rid);
        const blk0 = blockingFor(rid, dateStr);
        const blockedNoHe = isWeekend(dObj) || isHoliday(dateStr) || !!blk0 || isThirdPartyOff(res, dateStr);
        if (blockedNoHe && otHours <= 0) return { dateStr, capacity: 0, allocated: 0, free: 0, eligible: false, overtime: ot };
        const info = CapacityEngine.freeHoursInfo(rid, dObj);
        return { dateStr, capacity: Number(info.capacity||0), allocated: Number(info.allocated||0), free: Number(info.free||0), eligible: info.eligible !== false, overtime: ot };
      });
      const days = getDaysInMonth(y, m0);
      let cap = 0, alloc = 0, free = 0, daysZero = 0, daysOver = 0;
      for (const d of days) {
        const info = freeHoursInfoLocal(resourceId, d);
        if (info.eligible === false) continue;
        cap += info.capacity;
        alloc += info.allocated;
        free += info.free;
        if (info.free <= 0) daysZero += 1;
        if (info.free < 0) daysOver += 1;
      }
      const pct = cap > 0 ? (free / cap) * 100 : 0;
      return { y, m0, key: monthKeyLocal(y, m0), label: fmtMonthLabelLocal(y, m0), cap, alloc, free, pct, days: days.length, daysZero, daysOver };
    };

    const months = buildMonthsLocal();
    const perRes = (state.resources||[]).map(r => {
      const ms = months.map(mm => monthlyWindowLocal(r.id, mm.y, mm.m0));
      const score = (whLocal.metric === 'pct')
        ? (ms.reduce((a,b)=>a + b.pct, 0) / Math.max(1, ms.length))
        : ms.reduce((a,b)=>a + b.free, 0);
      return { r, ms, score };
    });
    if (whLocal.dynamicOrder) {
      const dir = whLocal.sortDir === 'desc' ? -1 : 1;
      perRes.sort((a,b) => (a.score - b.score) * dir);
    } else if (Array.isArray(whLocal.fixedOrderIds)) {
      const idx = new Map(whLocal.fixedOrderIds.map((id,i)=>[id,i]));
      perRes.sort((a,b) => (idx.get(a.r.id) ?? 1e9) - (idx.get(b.r.id) ?? 1e9));
    }
    const allRows = (whLocal.show === 'top') ? perRes.slice(0, Math.max(1, Number(whLocal.topN||10))) : perRes;
    const headers = ['recurso','mes','horas_total','horas_livre','pct_livre','dias_uteis_contados','dias_com_bloqueio','dias_com_feriado','dias_com_HE'];
    const rows = [];
    for (const rr of allRows) {
      for (const m of rr.ms) {
        const stats = monthStatsForExport(rr.r.id, m.y, m.m0);
        rows.push({
          recurso: rr.r.nome,
          mes: m.key,
          horas_total: Number(m.cap||0).toFixed(1),
          horas_livre: Number(m.free||0).toFixed(1),
          pct_livre: Number(Math.max(0,m.pct)||0).toFixed(1),
          dias_uteis_contados: stats.dias_uteis_contados,
          dias_com_bloqueio: stats.dias_com_bloqueio,
          dias_com_feriado: stats.dias_com_feriado,
          dias_com_HE: stats.dias_com_HE,
        });
      }
    }
    return { headers, rows };
  };

  const exportAllExcelWorkbook = () => {
    const demandas = buildDemandasExportData();
    const recursos = buildRecursosExportData();
    const bloqueios = buildBloqueiosExportData();
    const feriados = buildFeriadosExportData();
    const he = buildHEExportData();
    const janelas = buildJanelasExportData();
    downloadExcelWorkbook('orizon_export_completo.xls', [
      { name:'Demandas', ...demandas },
      { name:'Recursos', ...recursos },
      { name:'Bloqueios', ...bloqueios },
      { name:'Feriados', ...feriados },
      { name:'HE', ...he },
      { name:'Janelas Livres', ...janelas },
    ]);
    toast('Excel completo exportado.');
  };
  // ----------------------
  // User modal wiring + onboarding
  const wireUserModal = () => {
    const dlg = qs('#userModal');
    const btnOpen = qs('#btnOpenUserModal');
    const closeBtn = qs('#userModalClose');
    const cancelBtn = qs('#userModalCancel');
    const saveBtn = qs('#userModalSave');
    const nameInput = qs('#userModalName');
    const idInput = qs('#userModalId');
    const btnCopy = qs('#btnCopyUserId');
    const btnFolder = qs('#btnUserSelectEventFolder');
    const folderStatus = qs('#userFolderStatus');
    const existingSelect = qs('#userExistingSelect');
    const existingHint = qs('#userExistingHint');
    const createMode = qs('#userCreateMode');
    const localWarning = qs('#userLocalWarning');

    const selectedExistingUser = () => {
      const id = String(existingSelect?.value || '').trim();
      return (scannedEventUsers || []).find(u => String(u.userId) === id) || null;
    };
    let pendingNewUserIdentity = null;

    const refreshSaveState = () => {
      const folderReady = sharedFolderReady();
      const selected = selectedExistingUser();
      if (selected && createMode?.checked) createMode.checked = false;
      const creating = !!createMode?.checked;
      const nm = String(nameInput?.value || '').trim();
      if (createMode) createMode.disabled = !folderReady || !!selected;
      if (nameInput) nameInput.disabled = !folderReady || !creating;
      if (existingSelect) existingSelect.disabled = !folderReady || creating || !(scannedEventUsers || []).length;
      const matchingExisting = (creating && nm) ? preferredExistingUserForName(nm) : null;
      const existingLoginReady = !!(selected && !creating);
      const newUserReady = !!(!selected && creating && nm);
      if (saveBtn) saveBtn.disabled = !(folderReady && (existingLoginReady || newUserReady));
      if (idInput) {
        if (existingLoginReady) idInput.value = selected.userId;
        else if (newUserReady) {
          if (matchingExisting?.userId) {
            pendingNewUserIdentity = { displayName: matchingExisting.displayName || nm, userId: matchingExisting.userId };
            idInput.value = matchingExisting.userId;
            if (existingHint) existingHint.textContent = `Nome já encontrado em /events; ao salvar, o usuário existente será reutilizado (${matchingExisting.userId}).`;
          } else {
            if (!pendingNewUserIdentity || pendingNewUserIdentity.displayName !== nm) pendingNewUserIdentity = previewUserIdentity(nm);
            idInput.value = pendingNewUserIdentity.userId;
          }
        }
        else idInput.value = '';
      }
    };

    const populateUsers = (users=[]) => {
      if (!existingSelect) return;
      existingSelect.innerHTML = '';
      existingSelect.appendChild(el('option', { value:'' }, [users.length ? 'Selecione um usuário existente' : 'Nenhum usuário encontrado']));
      for (const u of users) {
        const label = `${u.displayName} — ${u.userId}`;
        existingSelect.appendChild(el('option', { value:u.userId }, [label]));
      }
      existingSelect.disabled = !sharedFolderReady() || !users.length;
      if (existingHint) existingHint.textContent = users.length
        ? `${users.length} usuário(s) com arquivo em events encontrado(s). ${scannedEventDiagnostics.length ? 'Atenção: há nomes iguais com IDs diferentes no diagnóstico.' : ''}`
        : 'Nenhum usuário encontrado na pasta events; habilite Criar novo usuário.';
    };

    const refreshFolderUsers = async () => {
      if (folderStatus) folderStatus.textContent = sharedFolderReady() ? `Pasta conectada: ${capviewEventMode.folderName || 'ORIZONData'}` : 'Nenhuma pasta selecionada.';
      if (createMode) createMode.disabled = !sharedFolderReady();
      if (!sharedFolderReady()) {
        populateUsers([]);
        if (nameInput) nameInput.disabled = true;
        refreshSaveState();
        return;
      }
      try {
        const result = await scanEventFolderUsers();
        populateUsers(result.users);
        const localKnown = !hasUser() || result.users.some(u => String(u.userId) === String(userId));
        if (localWarning) localWarning.style.display = localKnown ? 'none' : '';
        if (hasUser()) {
          const match = result.users.find(u => String(u.userId) === String(userId));
          if (match && existingSelect) {
            existingSelect.value = match.userId;
            if (nameInput) nameInput.value = match.displayName;
            if (idInput) idInput.value = match.userId;
          }
        }
      } catch (e) {
        console.warn('[ORIZON Usuários] Falha ao carregar usuários da pasta:', e);
        if (existingHint) existingHint.textContent = 'Não foi possível carregar usuários da pasta selecionada.';
      }
      refreshSaveState();
    };

    const setCreateMode = (enabled) => {
      const turnOnCreate = !!enabled;
      if (turnOnCreate && existingSelect) existingSelect.value = '';
      if (createMode) createMode.checked = turnOnCreate;
      if (nameInput) {
        nameInput.disabled = !sharedFolderReady() || !turnOnCreate;
        nameInput.readOnly = false;
        nameInput.classList.remove('locked');
        if (turnOnCreate) {
          nameInput.value = '';
          pendingNewUserIdentity = null;
        }
      }
      if (existingSelect) existingSelect.disabled = !sharedFolderReady() || turnOnCreate || !(scannedEventUsers || []).length;
      refreshSaveState();
    };

    if (btnFolder) btnFolder.addEventListener('click', async () => {
      const ok = await selectORIZONDataFolder({ requireUser:false });
      if (ok) await refreshFolderUsers();
    });

    if (existingSelect) existingSelect.addEventListener('change', () => {
      const u = selectedExistingUser();
      if (u) {
        setCreateMode(false);
        if (nameInput) nameInput.value = u.displayName;
        if (idInput) idInput.value = u.userId;
      } else {
        if (nameInput && !createMode?.checked) nameInput.value = '';
        if (idInput) idInput.value = '';
      }
      refreshSaveState();
    });

    if (createMode) createMode.addEventListener('change', () => setCreateMode(createMode.checked));
    if (nameInput) nameInput.addEventListener('input', refreshSaveState);

    if (btnCopy) btnCopy.addEventListener('click', async () => {
      const val = String(idInput?.value||'').trim();
      if (!val) { toast('Gere ou selecione um ID primeiro.'); return; }
      try {
        await navigator.clipboard.writeText(val);
        toast('ID copiado.');
      } catch {
        const copied = fallbackCopyText(val);
        toast(copied ? 'ID copiado.' : 'Não foi possível copiar o ID.');
      }
    });

    const tryClose = () => {
      if (dlg?.dataset.force === '1' && !hasUser()) {
        toast('Você precisa definir o usuário para continuar.');
        return;
      }
      closeDialog(dlg);
      document.body.classList.remove('user-modal-open');
    };

    if (btnOpen) btnOpen.addEventListener('click', () => openUserModal(true));
    if (closeBtn) closeBtn.addEventListener('click', tryClose);
    if (cancelBtn) cancelBtn.addEventListener('click', tryClose);
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const creating = !!createMode?.checked;
      const existing = selectedExistingUser();
      if (creating && existing) {
        toast('Escolha apenas uma opção: usuário existente ou criar novo usuário.');
        refreshSaveState();
        return;
      }
      const ok = await resolveActiveUser({
        displayName: creating ? String(nameInput?.value || '').trim() : (existing?.displayName || ''),
        userId: creating ? String(idInput?.value || '') : (existing?.userId || ''),
        createNew: creating
      });
      if (!ok) { refreshSaveState(); return; }
      const hdr = qs('#userName'); if (hdr) hdr.value = userName;
      closeDialog(dlg);
      document.body.classList.remove('user-modal-open');
      toast(creating ? 'Novo usuário criado com sucesso.' : 'Usuário existente selecionado com sucesso.');
      render();
    });

    if (dlg) dlg.addEventListener('cancel', (e) => {
      if (dlg.dataset.force === '1' && !hasUser()) { e.preventDefault(); }
    });

    if (dlg) dlg.addEventListener('close', () => document.body.classList.remove('user-modal-open'));

    wireUserModal.refreshFolderUsers = refreshFolderUsers;
    wireUserModal.setCreateMode = setCreateMode;
  };
  wireUserModal();


  // Mantém múltiplas abas do mesmo navegador alinhadas quando o usuário é definido em outra instância.
  window.addEventListener('storage', (ev) => {
    if (ev.key === USER_KEY) {
      const u = loadUserIdentity();
      userName = u.displayName;
      userId = u.userId;
      ensureUserAsResource();
      updateAvatar();
    }
  });

  // Avatar always opens identity modal
  const avatarClickHandler__capview = () => openUserModal(true);
  const avatarEl = qs('#avatar');
  if (avatarEl) {
    avatarEl.addEventListener('click', avatarClickHandler__capview);
    avatarEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
      }
    });
  }

const commitHeaderUserName = (input) => {
  if (!input) return;
  if (isUserIdentityLocked()) {
    input.value = userName || '';
    return;
  }
  const nm = String(input.value || '').trim();
  if (!nm) {
    input.value = userName || '';
    return;
  }
  setUser(nm);
};
qs('#userName').addEventListener('input', (e) => {
  if (isUserIdentityLocked()) e.target.value = userName || '';
});
qs('#userName').addEventListener('change', (e) => commitHeaderUserName(e.target));
qs('#userName').addEventListener('blur', (e) => commitHeaderUserName(e.target));
qs('#userName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
  }
});
  // Initialize user UI (after helpers exist)
  ensureUserAsResource();
  updateAvatar();
  if (!hasUser()) { setTimeout(() => openUserModal(true), 60); }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && eventAutoSyncAvailable()) eventAutoSyncTick('visible');
  });

  render();
}
