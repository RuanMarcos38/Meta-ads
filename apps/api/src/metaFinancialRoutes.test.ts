import { describe, expect, it } from 'vitest';
import { resolveDisplayedBalance } from './metaFinancialRoutes.js';

describe('resolveDisplayedBalance', () => {
  it('usa total_prepay_balance como fundos disponíveis em conta pré-paga', () => {
    expect(resolveDisplayedBalance({
      is_prepay_account: true,
      balance: '6688',
      total_prepay_balance: {
        amount_in_hundredths: '14515',
        currency: 'BRL',
      },
    }, 'BRL')).toEqual({
      value: 145.15,
      label: 'Fundos disponíveis',
      source: 'total_prepay_balance',
    });
  });

  it('usa prepay_account_balance como fallback em conta pré-paga', () => {
    expect(resolveDisplayedBalance({
      is_prepay_account: true,
      balance: '6688',
      prepay_account_balance: {
        amount_in_hundredths: '12000',
        currency: 'BRL',
      },
    }, 'BRL')).toEqual({
      value: 120,
      label: 'Fundos disponíveis',
      source: 'prepay_account_balance',
    });
  });

  it('não usa balance como fundos disponíveis quando a conta é pré-paga', () => {
    expect(resolveDisplayedBalance({
      is_prepay_account: true,
      balance: '6688',
    }, 'BRL')).toEqual({
      value: null,
      label: 'Fundos disponíveis',
      source: 'unavailable',
    });
  });

  it('mantém balance como saldo a pagar em conta pós-paga', () => {
    expect(resolveDisplayedBalance({
      is_prepay_account: false,
      balance: '6688',
    }, 'BRL')).toEqual({
      value: 66.88,
      label: 'Saldo a pagar',
      source: 'balance',
    });
  });
});
