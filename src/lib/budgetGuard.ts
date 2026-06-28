import { logger } from './logger';

/**
 * Guarda de orçamento. Em modo dry-run / sem repositório configurado,
 * opera com um acumulador em memória válido apenas para a execução
 * atual — suficiente para testes locais. Em produção real, o backing
 * store é staging.api_usage_log + staging.api_budget_config (ver
 * BudgetRepo abaixo, implementação Supabase fica para quando este
 * Collector deixar do modo dry-run).
 */
export interface BudgetConfig {
  provider: string;
  monthly_budget_usd: number;
  hard_stop_enabled: boolean;
  alert_threshold_pct: number;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface BudgetRepo {
  getConfig(provider: string): Promise<BudgetConfig>;
  getMonthSpend(provider: string): Promise<number>;
  recordSpend(provider: string, callType: string, costUsd: number): Promise<void>;
}

/**
 * Implementação em memória — usada pelo script de dry-run para não
 * depender do Supabase só para testar o Collector isoladamente.
 */
export class InMemoryBudgetRepo implements BudgetRepo {
  private spend = new Map<string, number>();

  constructor(private readonly config: BudgetConfig) {}

  async getConfig(): Promise<BudgetConfig> {
    return this.config;
  }

  async getMonthSpend(provider: string): Promise<number> {
    return this.spend.get(provider) ?? 0;
  }

  async recordSpend(provider: string, _callType: string, costUsd: number): Promise<void> {
    this.spend.set(provider, (this.spend.get(provider) ?? 0) + costUsd);
  }
}

export async function checkBudgetBeforeCall(
  provider: string,
  estimatedCost: number,
  budgetRepo: BudgetRepo,
): Promise<BudgetCheckResult> {
  const config = await budgetRepo.getConfig(provider);
  const spentThisMonth = await budgetRepo.getMonthSpend(provider);

  if (spentThisMonth + estimatedCost > config.monthly_budget_usd) {
    if (config.hard_stop_enabled) {
      return {
        allowed: false,
        reason: `orçamento mensal de USD ${config.monthly_budget_usd.toFixed(2)} seria excedido (gasto atual: USD ${spentThisMonth.toFixed(2)})`,
      };
    }
    logger.warn({ provider, spentThisMonth }, 'orçamento excedido mas hard_stop desabilitado — chamada permitida');
  }

  if (spentThisMonth / config.monthly_budget_usd >= config.alert_threshold_pct) {
    logger.warn(
      { provider, spentThisMonth, budget: config.monthly_budget_usd },
      'orçamento próximo do limite mensal',
    );
  }

  return { allowed: true };
}
