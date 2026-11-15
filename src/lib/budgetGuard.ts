import { randomUUID } from 'node:crypto';
import { logger } from './logger';

/**
 * Guarda de orçamento das APIs pagas (L5).
 *
 * Contrato: reserva → chamada → confirmação (ou libertação).
 *   1. BudgetRepo.reserve() reserva o custo estimado ANTES da chamada. Se a
 *      reserva for recusada (tecto excedido com hard_stop, sem configuração,
 *      erro do repositório), a API paga NÃO é chamada.
 *   2. Depois da chamada: release() SÓ quando é certo que nenhum pedido
 *      chegou ao fornecedor; confirm() em todos os outros casos, incluindo
 *      os incertos (ver Billable). Contar a mais é o lado seguro.
 *   3. Uma reserva por TENTATIVA HTTP (attemptGate): cada repetição do
 *      cliente reserva antes de enviar; uma recusa pára as repetições.
 *
 * Alertas (50/80/100%): deduplicados POR PROCESSO. Processos diferentes
 * (execuções separadas, ou concorrentes) podem repetir o mesmo alerta
 * mensal/diário; isso é esperado — o tecto é imposto pela reserva, não
 * pelo alerta.
 *
 * Dois repositórios com o mesmo contrato:
 *   - InMemoryBudgetRepo: acumulador válido só para o processo actual
 *     (por omissão nos scripts; dry-run e testes). Tectos mensal, diário e
 *     por execução em memória — várias execuções NÃO se somam.
 *   - SupabaseBudgetRepo (src/persistence/repositories/): RPC atómicas
 *     staging.reserve_api_budget / confirm_api_spend / release_api_budget
 *     (migração 0028), activado só com --budget=persistent.
 *
 * Mês e dia de orçamento em UTC (igual à 0028).
 */

export type BudgetScope = 'month' | 'day' | 'run';

export const DEFAULT_ALERT_THRESHOLDS: readonly number[] = [0.5, 0.8, 1.0];

/** Configuração do InMemoryBudgetRepo (compatível com GooglePlacesProductConfig). */
export interface BudgetConfig {
  provider: string;
  monthly_budget_usd: number;
  daily_budget_usd?: number | null;
  per_run_budget_usd?: number | null;
  hard_stop_enabled: boolean;
  /** Limiares de alerta (fracção do tecto). Por omissão 0.5, 0.8 e 1.0. */
  alert_thresholds_pct?: readonly number[];
  /**
   * Legado (limiar único, calculado antes da chamada). Ignorado desde o L5:
   * os alertas usam alert_thresholds_pct.
   */
  alert_threshold_pct?: number;
}

export interface BudgetReserveRequest {
  provider: string;
  callType: string;
  /** Identificador estável da execução (tecto por execução). */
  runKey: string;
  /** staging.ingestion_runs.id, quando existe (ligação de auditoria). */
  ingestionRunId: string | null;
  estimatedCostUsd: number;
}

export interface BudgetLimits {
  month: number | null;
  day: number | null;
  run: number | null;
}

export interface BudgetReservation {
  allowed: boolean;
  /**
   * null quando permitido sem reservas. Recusas: 'no_config',
   * 'monthly_cap' | 'daily_cap' | 'per_run_cap', 'invalid_arguments',
   * 'rpc_error: ...', 'empty_response'. Permitido acima do tecto com
   * hard_stop desligado: 'soft_<tecto>'.
   */
  reason: string | null;
  reservationId: string | null;
  /** Gasto (reserved + spent) no período; inclui esta reserva quando permitida. */
  spentMonth: number | null;
  spentDay: number | null;
  spentRun: number | null;
  limits: BudgetLimits | null;
  hardStopEnabled: boolean | null;
  alertThresholds: readonly number[] | null;
}

export interface BudgetRepo {
  reserve(request: BudgetReserveRequest): Promise<BudgetReservation>;
  confirm(reservationId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
}

export function refusedReservation(reason: string): BudgetReservation {
  return {
    allowed: false,
    reason,
    reservationId: null,
    spentMonth: null,
    spentDay: null,
    spentRun: null,
    limits: null,
    hardStopEnabled: null,
    alertThresholds: null,
  };
}

/** Mês (AAAA-MM) e dia (AAAA-MM-DD) de orçamento em UTC. */
export function budgetPeriods(now: Date): { month: string; day: string } {
  const iso = now.toISOString();
  return { month: iso.slice(0, 7), day: iso.slice(0, 10) };
}

type EntryStatus = 'reserved' | 'spent' | 'released';

interface InMemoryEntry {
  id: string;
  provider: string;
  callType: string;
  runKey: string;
  costUsd: number;
  status: EntryStatus;
  month: string;
  day: string;
}

/**
 * Implementação em memória — o mesmo contrato do repositório persistente,
 * com tectos mensal, diário e por execução calculados só sobre as reservas
 * deste processo. Fornecedor diferente do configurado → recusa
 * (fail-closed, como a RPC sem linha de config).
 */
export class InMemoryBudgetRepo implements BudgetRepo {
  private readonly entries = new Map<string, InMemoryEntry>();
  private nextId = 1;

  constructor(
    private readonly config: BudgetConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(req: BudgetReserveRequest): Promise<BudgetReservation> {
    if (!req.provider || !req.callType || !req.runKey || !(req.estimatedCostUsd >= 0)) {
      return refusedReservation('invalid_arguments');
    }
    if (req.provider !== this.config.provider) {
      return refusedReservation('no_config');
    }

    const { month, day } = budgetPeriods(this.now());
    let spentMonth = 0;
    let spentDay = 0;
    let spentRun = 0;
    for (const e of this.entries.values()) {
      if (e.provider !== req.provider || e.status === 'released') continue;
      if (e.month === month) spentMonth += e.costUsd;
      if (e.day === day) spentDay += e.costUsd;
      if (e.runKey === req.runKey) spentRun += e.costUsd;
    }

    const cost = req.estimatedCostUsd;
    const limits: BudgetLimits = {
      month: this.config.monthly_budget_usd,
      day: this.config.daily_budget_usd ?? null,
      run: this.config.per_run_budget_usd ?? null,
    };
    let exceeded: string | null = null;
    if (spentMonth + cost > limits.month!) exceeded = 'monthly_cap';
    else if (limits.day !== null && spentDay + cost > limits.day) exceeded = 'daily_cap';
    else if (limits.run !== null && spentRun + cost > limits.run) exceeded = 'per_run_cap';

    const base = {
      limits,
      hardStopEnabled: this.config.hard_stop_enabled,
      alertThresholds: this.config.alert_thresholds_pct ?? DEFAULT_ALERT_THRESHOLDS,
    };

    if (exceeded && this.config.hard_stop_enabled) {
      return { ...base, allowed: false, reason: exceeded, reservationId: null, spentMonth, spentDay, spentRun };
    }

    const id = String(this.nextId++);
    this.entries.set(id, {
      id,
      provider: req.provider,
      callType: req.callType,
      runKey: req.runKey,
      costUsd: cost,
      status: 'reserved',
      month,
      day,
    });
    return {
      ...base,
      allowed: true,
      reason: exceeded ? `soft_${exceeded}` : null,
      reservationId: id,
      spentMonth: spentMonth + cost,
      spentDay: spentDay + cost,
      spentRun: spentRun + cost,
    };
  }

  async confirm(reservationId: string): Promise<void> {
    this.settle(reservationId, 'spent');
  }

  async release(reservationId: string): Promise<void> {
    this.settle(reservationId, 'released');
  }

  private settle(reservationId: string, status: 'spent' | 'released'): void {
    const entry = this.entries.get(reservationId);
    if (!entry || entry.status !== 'reserved') {
      throw new Error(`reserva ${reservationId} inexistente ou já liquidada`);
    }
    entry.status = status;
  }
}

// ---------------------------------------------------------------------------
// Resumo de custo por execução
// ---------------------------------------------------------------------------

export interface ApiCostLine {
  provider: string;
  call_type: string;
  /** Reservas aceites. */
  reserved_count: number;
  reserved_usd: number;
  spent_count: number;
  spent_usd: number;
  released_count: number;
  released_usd: number;
  /** Reservas ainda por liquidar (confirm/release falhou): contam para o tecto. */
  pending_count: number;
  pending_usd: number;
  /** Chamadas recusadas pela guarda (a API não foi chamada). */
  refused_count: number;
}

export interface RunCostSummary {
  run_key: string;
  ingestion_run_id: string | null;
  /** 'memory' | 'persistent' (só informativo) */
  budget_mode: string;
  totals: Omit<ApiCostLine, 'provider' | 'call_type'>;
  by_provider_call_type: ApiCostLine[];
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function emptyLine(provider: string, callType: string): ApiCostLine {
  return {
    provider,
    call_type: callType,
    reserved_count: 0,
    reserved_usd: 0,
    spent_count: 0,
    spent_usd: 0,
    released_count: 0,
    released_usd: 0,
    pending_count: 0,
    pending_usd: 0,
    refused_count: 0,
  };
}

// ---------------------------------------------------------------------------
// BudgetGuard: estado por processo (alertas, execução, resumo de custo)
// ---------------------------------------------------------------------------

type GuardLogger = Pick<typeof logger, 'warn' | 'error' | 'info'>;

export interface BudgetGuardOptions {
  /** 'memory' | 'persistent' — só para o resumo e os logs. */
  mode?: string;
  /** Injecção para testes. */
  log?: GuardLogger;
  now?: () => Date;
  newRunKey?: () => string;
}

export class BudgetGuard {
  private runKey: string;
  private ingestionRunId: string | null = null;
  private readonly alerted = new Set<string>();
  private lines = new Map<string, ApiCostLine>();
  private readonly log: GuardLogger;
  private readonly now: () => Date;
  private readonly newRunKey: () => string;
  readonly mode: string;

  constructor(
    readonly repo: BudgetRepo,
    options: BudgetGuardOptions = {},
  ) {
    this.log = options.log ?? logger;
    this.now = options.now ?? (() => new Date());
    this.newRunKey = options.newRunKey ?? randomUUID;
    this.mode = options.mode ?? 'memory';
    this.runKey = this.newRunKey();
  }

  /** Começa uma execução nova: novo run_key e resumo de custo vazio. */
  startRun(ingestionRunId: string | null = null): void {
    this.runKey = this.newRunKey();
    this.ingestionRunId = ingestionRunId;
    this.lines = new Map();
  }

  get currentRunKey(): string {
    return this.runKey;
  }

  /**
   * Portão por tentativa HTTP para um fornecedor: cada begin() é UMA reserva;
   * settle('no') liberta, settle('yes'|'uncertain') confirma (ver Billable).
   */
  attemptGate(provider: string): PaidAttemptGate {
    return {
      begin: async (callType: string, estimatedCostUsd: number): Promise<PaidAttemptTicket> => {
        const r = await this.reserve(provider, callType, estimatedCostUsd);
        if (!r.allowed || r.reservationId === null) {
          return { ok: false, reason: describeRefusal(r.reason ?? 'refused', r) };
        }
        const reservationId = r.reservationId;
        let settled = false;
        return {
          ok: true,
          reservationId,
          settle: async (billable: Billable) => {
            if (settled) return;
            settled = true;
            await this.settle(provider, callType, reservationId, estimatedCostUsd, billable === 'no' ? 'released' : 'spent');
          },
        };
      },
    };
  }

  /** @internal usado por attemptGate */
  async reserve(provider: string, callType: string, estimatedCostUsd: number): Promise<BudgetReservation> {
    let reservation: BudgetReservation;
    try {
      reservation = await this.repo.reserve({
        provider,
        callType,
        runKey: this.runKey,
        ingestionRunId: this.ingestionRunId,
        estimatedCostUsd,
      });
    } catch (err) {
      // Fail-closed: sem resposta do repositório, nenhuma chamada paga.
      this.log.error(
        { provider, callType, error: err instanceof Error ? err.message : String(err) },
        'reserva de orçamento falhou — chamada paga recusada',
      );
      reservation = refusedReservation('repo_error');
    }

    const line = this.line(provider, callType);
    if (!reservation.allowed || reservation.reservationId === null) {
      line.refused_count++;
      return { ...reservation, allowed: false };
    }
    line.reserved_count++;
    line.reserved_usd = round4(line.reserved_usd + estimatedCostUsd);
    line.pending_count++;
    line.pending_usd = round4(line.pending_usd + estimatedCostUsd);

    if (reservation.reason?.startsWith('soft_')) {
      this.log.warn(
        {
          provider,
          callType,
          reason: reservation.reason,
          spentMonth: reservation.spentMonth,
          spentDay: reservation.spentDay,
          spentRun: reservation.spentRun,
        },
        'orçamento excedido mas hard_stop desabilitado — chamada permitida',
      );
    }
    this.emitAlerts(provider, reservation);
    return reservation;
  }

  /** @internal */
  async settle(
    provider: string,
    callType: string,
    reservationId: string,
    estimatedCostUsd: number,
    outcome: 'spent' | 'released',
  ): Promise<void> {
    try {
      if (outcome === 'spent') await this.repo.confirm(reservationId);
      else await this.repo.release(reservationId);
    } catch (err) {
      // A reserva fica 'reserved' e continua a contar para o tecto (lado seguro).
      this.log.error(
        { provider, callType, reservationId, outcome, error: err instanceof Error ? err.message : String(err) },
        'falha ao liquidar reserva de orçamento — reserva continua a contar para o tecto',
      );
      return;
    }
    const line = this.line(provider, callType);
    line.pending_count--;
    line.pending_usd = round4(line.pending_usd - estimatedCostUsd);
    if (outcome === 'spent') {
      line.spent_count++;
      line.spent_usd = round4(line.spent_usd + estimatedCostUsd);
    } else {
      line.released_count++;
      line.released_usd = round4(line.released_usd + estimatedCostUsd);
    }
  }

  costSummary(): RunCostSummary {
    const byLine = [...this.lines.values()]
      .map((l) => ({ ...l }))
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.call_type.localeCompare(b.call_type));
    const totals = emptyLine('', '');
    for (const l of byLine) {
      totals.reserved_count += l.reserved_count;
      totals.reserved_usd = round4(totals.reserved_usd + l.reserved_usd);
      totals.spent_count += l.spent_count;
      totals.spent_usd = round4(totals.spent_usd + l.spent_usd);
      totals.released_count += l.released_count;
      totals.released_usd = round4(totals.released_usd + l.released_usd);
      totals.pending_count += l.pending_count;
      totals.pending_usd = round4(totals.pending_usd + l.pending_usd);
      totals.refused_count += l.refused_count;
    }
    const { provider: _p, call_type: _c, ...totalsOnly } = totals;
    return {
      run_key: this.runKey,
      ingestion_run_id: this.ingestionRunId,
      budget_mode: this.mode,
      totals: totalsOnly,
      by_provider_call_type: byLine,
    };
  }

  private line(provider: string, callType: string): ApiCostLine {
    const key = `${provider}\u0000${callType}`;
    let l = this.lines.get(key);
    if (!l) {
      l = emptyLine(provider, callType);
      this.lines.set(key, l);
    }
    return l;
  }

  /**
   * Alerta estruturado uma vez por limiar, por âmbito e período, por
   * processo: mês (AAAA-MM UTC), dia (AAAA-MM-DD UTC) e execução (run_key).
   */
  private emitAlerts(provider: string, r: BudgetReservation): void {
    if (!r.limits) return;
    const thresholds = r.alertThresholds && r.alertThresholds.length > 0 ? r.alertThresholds : DEFAULT_ALERT_THRESHOLDS;
    const { month, day } = budgetPeriods(this.now());
    const scopes: Array<{ scope: BudgetScope; period: string; spent: number | null; budget: number | null }> = [
      { scope: 'month', period: month, spent: r.spentMonth, budget: r.limits.month },
      { scope: 'day', period: day, spent: r.spentDay, budget: r.limits.day },
      { scope: 'run', period: this.runKey, spent: r.spentRun, budget: r.limits.run },
    ];
    for (const s of scopes) {
      if (s.spent === null || s.budget === null || s.budget <= 0) continue;
      const pct = s.spent / s.budget;
      const crossed = [...thresholds].sort((a, b) => a - b).filter((t) => pct >= t - 1e-9);
      for (const threshold of crossed) {
        const key = `${provider}|${s.scope}|${s.period}|${threshold}`;
        if (this.alerted.has(key)) continue;
        this.alerted.add(key);
        this.log.warn(
          {
            alert: 'api_budget_threshold',
            provider,
            scope: s.scope,
            threshold,
            pct: Math.round(pct * 1000) / 10,
            spent: round4(s.spent),
            budget: s.budget,
          },
          `orçamento da API ${provider}: ${Math.round(threshold * 100)}% do tecto (${s.scope}) atingido`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// checkBudgetBeforeCall: reserva → chamada → confirm | release
// ---------------------------------------------------------------------------

/**
 * Se um pedido pago pode ter sido cobrado. Regra conservadora (r0 L5):
 *   'no'        → CERTEZA de que nenhum pedido chegou ao fornecedor (falha
 *                 antes de enviar, ou falha na fase de ligação: DNS, ligação
 *                 recusada, timeout de ligação). Só este caso liberta.
 *   'yes'       → houve resposta 2xx (mesmo que a leitura do corpo falhe).
 *   'uncertain' → tudo o resto (resposta não-2xx, ligação perdida depois de
 *                 enviar, erro desconhecido). Conta como GASTO.
 * Contar a mais é o lado seguro: o tecto nunca é excedido por pedidos
 * cobrados que desapareceram do total.
 */
export type Billable = 'yes' | 'no' | 'uncertain';

/** Erro que declara explicitamente que o pedido NÃO chegou ao fornecedor. */
export class NotBilledError extends Error {
  readonly billable = 'no' as const;
}

/** A reserva de orçamento foi recusada: nenhum (outro) pedido pago foi enviado. */
export class BudgetRefusedError extends Error {
  constructor(
    readonly reason: string,
    /** Tentativas HTTP já enviadas (e liquidadas) antes da recusa. */
    readonly attemptsSent: number,
  ) {
    super(`orçamento recusou o pedido pago: ${reason}`);
    this.name = 'BudgetRefusedError';
  }
}

/** Classifica uma excepção lançada por `call`: só NotBilledError/billable='no' liberta. */
export function billableOfError(err: unknown): Billable {
  return (err as { billable?: unknown } | null)?.billable === 'no' ? 'no' : 'uncertain';
}

export interface PaidCallOutcome<T> {
  value: T;
  /** Ver Billable. 'no' liberta a reserva; 'yes' e 'uncertain' confirmam. */
  billable: Billable;
}

export type BudgetedCallResult<T> =
  | { allowed: true; value: T; billable: Billable; reservationId: string }
  | { allowed: false; reason: string };

/**
 * UMA reserva para UM pedido HTTP pago. Só se a reserva for aceite chama
 * `call`. Depois: release só se billable='no'; confirm em 'yes' e
 * 'uncertain'. Se `call` lançar, confirm salvo se o erro declarar
 * billable='no' (NotBilledError); a excepção é propagada.
 *
 * Para clientes com tentativas repetidas use attemptGate(): cada tentativa
 * HTTP tem a sua própria reserva.
 *
 * O valor registado é a ESTIMATIVA reservada (o custo da Google Places é
 * tabelado por SKU, igual à estimativa).
 */
export async function checkBudgetBeforeCall<T>(
  guard: BudgetGuard,
  params: { provider: string; callType: string; estimatedCostUsd: number },
  call: () => Promise<PaidCallOutcome<T>>,
): Promise<BudgetedCallResult<T>> {
  const ticket = await guard.attemptGate(params.provider).begin(params.callType, params.estimatedCostUsd);
  if (!ticket.ok) return { allowed: false, reason: ticket.reason };

  let outcome: PaidCallOutcome<T>;
  try {
    outcome = await call();
  } catch (err) {
    await ticket.settle(billableOfError(err));
    throw err;
  }
  await ticket.settle(outcome.billable);
  return { allowed: true, value: outcome.value, billable: outcome.billable, reservationId: ticket.reservationId };
}

/**
 * Portão por tentativa HTTP: o cliente da API chama begin() ANTES de cada
 * tentativa (incluindo repetições) e settle() com o resultado. Recusa →
 * o cliente não envia a tentativa nem as seguintes.
 */
export interface PaidAttemptGate {
  begin(callType: string, estimatedCostUsd: number): Promise<PaidAttemptTicket>;
}

export type PaidAttemptTicket =
  | { ok: true; reservationId: string; settle(billable: Billable): Promise<void> }
  | { ok: false; reason: string };

export function describeRefusal(reason: string, r: BudgetReservation): string {
  const fmt = (n: number | null | undefined): string => (n === null || n === undefined ? '?' : n.toFixed(2));
  switch (reason) {
    case 'monthly_cap':
      return `orçamento mensal de USD ${fmt(r.limits?.month)} seria excedido (gasto atual: USD ${fmt(r.spentMonth)})`;
    case 'daily_cap':
      return `orçamento diário de USD ${fmt(r.limits?.day)} seria excedido (gasto atual: USD ${fmt(r.spentDay)})`;
    case 'per_run_cap':
      return `orçamento por execução de USD ${fmt(r.limits?.run)} seria excedido (gasto atual: USD ${fmt(r.spentRun)})`;
    case 'no_config':
      return 'sem configuração de orçamento para o fornecedor (fail-closed)';
    default:
      return `reserva de orçamento recusada (${reason})`;
  }
}

/** Aceita um BudgetRepo (envolvido num BudgetGuard novo) ou um BudgetGuard. */
export function toBudgetGuard(repoOrGuard: BudgetRepo | BudgetGuard): BudgetGuard {
  return repoOrGuard instanceof BudgetGuard ? repoOrGuard : new BudgetGuard(repoOrGuard);
}

// ---------------------------------------------------------------------------
// Selecção do modo nos scripts (--budget=memory|persistent)
// ---------------------------------------------------------------------------

export type BudgetMode = 'memory' | 'persistent';

export type BudgetModeResult = { ok: true; mode: BudgetMode } | { ok: false; error: string };

/**
 * Lê --budget= de argv. Por omissão 'memory'. 'persistent' com --dry-run é
 * recusado: o dry-run nunca cria cliente Supabase (reposForRun), e um
 * orçamento em memória num dry-run que faz chamadas pagas não pode passar
 * por persistente.
 */
export function resolveBudgetMode(argv: readonly string[], dryRun: boolean): BudgetModeResult {
  const arg = argv.filter((a) => a.startsWith('--budget='));
  if (arg.length > 1) return { ok: false, error: '--budget= indicado mais de uma vez' };
  const value = arg.length === 1 ? arg[0].slice('--budget='.length) : 'memory';
  if (value !== 'memory' && value !== 'persistent') {
    return { ok: false, error: `--budget=${value} inválido (usar memory ou persistent)` };
  }
  if (value === 'persistent' && dryRun) {
    return { ok: false, error: '--budget=persistent não pode ser usado com --dry-run (o dry-run nunca cria cliente Supabase)' };
  }
  return { ok: true, mode: value };
}

/**
 * Repositório de orçamento para uma execução. 'memory' nunca toca no
 * Supabase; 'persistent' usa o cliente único (getSupabaseClient → envGuard)
 * por import dinâmico, como RepositoryFactory.forSupabase.
 */
export async function budgetRepoForRun(
  mode: BudgetMode,
  inMemoryConfig: BudgetConfig,
  createPersistent: () => Promise<BudgetRepo> = async () => {
    const { getSupabaseClient } = await import('../persistence/client/supabase.js');
    const { SupabaseBudgetRepo } = await import('../persistence/repositories/SupabaseBudgetRepo.js');
    return new SupabaseBudgetRepo(getSupabaseClient());
  },
): Promise<BudgetRepo> {
  return mode === 'persistent' ? createPersistent() : new InMemoryBudgetRepo(inMemoryConfig);
}
