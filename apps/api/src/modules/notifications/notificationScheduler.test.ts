import { describe, expect, it } from 'vitest';
import { buildDailySummaryMessage, normalizePhone } from './notificationScheduler.js';

describe('notificationScheduler', () => {
  it('normaliza telefone brasileiro da empresa sem alterar número já internacional', () => {
    expect(normalizePhone('(47) 99937-1478')).toBe('5547999371478');
    expect(normalizePhone('+55 47 99937-1478')).toBe('5547999371478');
    expect(normalizePhone('123')).toBe('');
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
