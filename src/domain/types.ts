export type DemandStatus =
  | "Em andamento"
  | "Atrasada"
  | "Concluída"
  | "Cancelada"
  | "Mapeada"
  | "Congelada";

export interface DemandAllocation {
  resourceId: string;
  data_inicio?: string;
  data_fim?: string;
  horas_planejadas_dia?: number;
  percentual_diario?: number;
  daily_hours?: Record<string, number>;
}

export interface Demand {
  id: string;
  titulo?: string;
  nome?: string;
  status?: DemandStatus | string;
  data_inicio?: string;
  data_fim?: string;
  responsavel_id?: string;
  allocations?: DemandAllocation[];
  [key: string]: unknown;
}

export interface Resource {
  id: string;
  nome: string;
  tipo?: "Interno" | "Terceiro" | string;
  ativo?: boolean;
  [key: string]: unknown;
}

export interface OrizonState {
  resources: Resource[];
  demands: Demand[];
  internalActivities: Record<string, unknown>[];
  blockings: Record<string, unknown>[];
  holidays: Record<string, unknown>[];
  reprogrammings: Record<string, unknown>[];
  overtimes: Record<string, unknown>[];
  events: Record<string, unknown>[];
  meta?: Record<string, unknown>;
}
