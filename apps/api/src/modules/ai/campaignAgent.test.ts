import { describe, expect, it } from 'vitest';
import { evaluateCampaignHealth, fallbackAdminReport, wantsHumanHandoff } from './campaignAgent.js';

describe('campaignAgent', () => {
  it('desativa IA quando cliente pede atendimento humano/gestor', () => {
    expect(wantsHumanHandoff('Quero falar com o gestor de tráfego')).toBe(true);
    expect(wantsHumanHandoff('Pode me passar para um atendente humano?')).toBe(true);
    expect(wantsHumanHandoff('Me explica meu CTR desta semana')).toBe(false);
  });

  it('marca campanha ativa sem entrega como crítica', () => {
    const health = evaluateCampaignHealth(
      { metaCampaignId: 'cmp-1', name: 'Campanha teste', status: 'ACTIVE', effectiveStatus: 'ACTIVE' },
      {
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        leads: 0,
        conversations: 0,
        purchases: 0,
        revenue: 0,
        ctr: 0,
        cpc: 0,
        cpm: 0,
        frequency: 0,
        costPerLead: 0,
        costPerConversation: 0,
        costPerPurchase: 0,
        roas: 0,
      },
    );
    expect(health.score).toBeLessThan(70);
    expect(health.issues.join(' ')).toContain('sem entrega');
  });

  it('formata o relatório diário em blocos curtos para WhatsApp', () => {
    const report = fallbackAdminReport([
      {
        client: 'Ecojoi',
        campaignCount: 23,
        attentionCount: 3,
        attentionCampaigns: [
          {
            bm: 'Ecojoi',
            name: 'Sales Campaign',
            status: 'attention',
            score: 55,
            spend: 0,
            ctr: 0,
            cpc: 0,
            conversations: 0,
            costPerConversation: 0,
            frequency: 0,
            roas: 0,
            issues: ['Campanha ativa sem entrega/impressões no período.'],
          },
        ],
        healthyCampaigns: [],
        campaigns: [],
      },
      {
        client: 'ERREJOTA BAR',
        campaignCount: 4,
        attentionCount: 0,
        attentionCampaigns: [],
        healthyCampaigns: [
          {
            bm: 'Restaurante',
            name: 'CBO - SABADO - PAGODE',
            status: 'excellent',
            score: 100,
            spend: 292.06,
            ctr: 1.75,
            cpc: 0.98,
            conversations: 28,
            costPerConversation: 10.43,
            frequency: 1.91,
            roas: 0,
            issues: [],
          },
        ],
        campaigns: [],
      },
    ] as any, '2026-09-27');

    expect(report).toContain('📊 *GESTÃO ADS | RELATÓRIO DIÁRIO*');
    expect(report).toContain('🚨 *PRECISA DE ATENÇÃO*');
    expect(report).toContain('✅ *SEM ALERTAS CRÍTICOS*');
    expect(report).toContain('Campanha ativa sem entrega no período');
    expect(report).not.toContain('[attention/55]');
    expect(report).not.toContain('[excellent/100]');
    expect(report.length).toBeLessThan(3201);
  });

  it('detecta CTR baixo, frequência alta e gasto sem resultado', () => {
    const health = evaluateCampaignHealth(
      { metaCampaignId: 'cmp-2', name: 'Campanha crítica', status: 'ACTIVE', effectiveStatus: 'ACTIVE' },
      {
        spend: 300,
        impressions: 10000,
        reach: 2000,
        clicks: 40,
        leads: 0,
        conversations: 0,
        purchases: 0,
        revenue: 0,
        ctr: 0.4,
        cpc: 7.5,
        cpm: 30,
        frequency: 5,
        costPerLead: 0,
        costPerConversation: 0,
        costPerPurchase: 0,
        roas: 0,
      },
    );
    expect(health.status).toBe('critical');
    expect(health.issues.some((issue) => issue.includes('CTR baixo'))).toBe(true);
    expect(health.issues.some((issue) => issue.includes('Frequência alta'))).toBe(true);
    expect(health.issues.some((issue) => issue.includes('sem geração'))).toBe(true);
  });
});
