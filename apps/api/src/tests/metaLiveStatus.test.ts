import { describe, expect, it } from 'vitest';
import { resolveAccountFinancialState, resolveCampaignDeliveryState } from '../metaLiveStatus.js';

describe('Meta live billing/status mapping', () => {
  it('marca conta pré-paga sem saldo', () => {
    const state = resolveAccountFinancialState({ currency: 'BRL', account_status: 1, is_prepay_account: true, balance: '0', amount_spent: '12500' });
    expect(state.financialStatusKey).toBe('NO_BALANCE');
    expect(state.financialStatusLabel).toBe('Sem saldo');
    expect(state.balance).toBe(0);
  });

  it('calcula limite restante em moeda da conta', () => {
    const state = resolveAccountFinancialState({ currency: 'BRL', account_status: 1, amount_spent: '25000', spend_cap: '100000' });
    expect(state.amountSpent).toBe(250);
    expect(state.spendCap).toBe(1000);
    expect(state.remainingSpendLimit).toBe(750);
  });

  it('prioriza erro de pagamento sobre status ativo da campanha', () => {
    const account = resolveAccountFinancialState({ currency: 'BRL', account_status: 3, balance: '1000' });
    const campaign = resolveCampaignDeliveryState({ effective_status: 'ACTIVE' }, account);
    expect(campaign.deliveryStatusKey).toBe('PAYMENT_ERROR');
    expect(campaign.deliveryStatusLabel).toBe('Erro de pagamento');
  });

  it('traduz estados de revisão e processamento da Meta', () => {
    expect(resolveCampaignDeliveryState({ effective_status: 'PENDING_REVIEW' }, null).deliveryStatusLabel).toBe('Em análise');
    expect(resolveCampaignDeliveryState({ effective_status: 'IN_PROCESS' }, null).deliveryStatusLabel).toBe('Processando');
  });
});
