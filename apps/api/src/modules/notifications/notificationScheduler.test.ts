import { describe, expect, it } from 'vitest';
import { buildDailySummaryMessage, normalizePhone, resolveAlertBalance, whatsappDailyLimitKey } from './notificationScheduler.js';

describe('notificationScheduler', () => {
  it('normaliza telefone brasileiro da empresa sem alterar número já internacional', () => {
    expect(normalizePhone('(47) 99937-1478')).toBe('5547999371478');
    expect(normalizePhone('+55 47 99937-1478')).toBe('5547999371478');
    expect(normalizePhone('123')).toBe('');
  });

  it('gera a mesma chave diária para o mesmo telefone no mesmo dia de Brasília', () => {
    const first = whatsappDailyLimitKey('(47) 99937-1478', new Date('2026-09-27T12:00:00.000Z'));
    const second = whatsappDailyLimitKey('+55 47 99937-1478', new Date('2026-09-27T23:00:00.000Z'));
    expect(first.phone).toBe('5547999371478');
    expect(second.phone).toBe('5547999371478');
    expect(first.localDate).toBe('2026-09-27');
    expect(second.localDate).toBe('2026-09-27');
  });

  it('vira uma nova chave somente no próximo dia local de Brasília', () => {
    const beforeMidnight = whatsappDailyLimitKey('5547999371478', new Date('2026-09-28T02:59:00.000Z'));
    const afterMidnight = whatsappDailyLimitKey('5547999371478', new Date('2026-09-28T03:01:00.000Z'));
    expect(beforeMidnight.localDate).toBe('2026-09-27');
    expect(afterMidnight.localDate).toBe('2026-09-28');
  });

  it('não transforma balance em saldo disponível de conta pré-paga', () => {
    expect(resolveAlertBalance({
      is_prepay_account: true,
      currency: 'BRL',
      balance: '381',
    }, 'BRL')).toBeNull();
  });

  it('usa o fundo pré-pago real retornado pela Meta no alerta', () => {
    expect(resolveAlertBalance({
      is_prepay_account: true,
      currency: 'BRL',
      balance: '381',
      total_prepay_balance: {
        amount_in_hundredths: '14515',
        currency: 'BRL',
      },
    }, 'BRL')).toMatchObject({
      value: 145.15,
      currency: 'BRL',
      source: 'total_prepay_balance',
    });
  });

  it('não inventa saldo zero quando o campo balance não veio da Meta', () => {
    expect(resolveAlertBalance({
      is_prepay_account: false,
      currency: 'BRL',
    }, 'BRL')).toBeNull();
  });

  it('mantém o padrão obrigatório do resumo diário', () => {
    const text = buildDailySummaryMessage({
      companyName: 'Empresa Teste',
      businessName: 'BM Teste',
      spend: 101.84,
      conversations: 8,
      impressions: 3316,
      reach: 2410,
    });
    expect(text).toContain('💰 *Investimento total:* R$ 101,84');
    expect(text).toContain('🎯 *Conversas iniciadas:* 8');
    expect(text).toContain('💬 *Custo por conversa:* R$ 12,73');
    expect(text).toContain('👁️ *Impressões:* 3.316');
    expect(text).toContain('📍 *Alcance:* 2.410 pessoas');
    expect(text).toContain('🔁 *Frequência média:* 1,38');
    expect(text).toContain('📌 *CPM médio:* R$ 30,71');
  });
});
