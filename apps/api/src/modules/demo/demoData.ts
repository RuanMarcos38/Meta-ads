// Dados demo usados quando DEMO_MODE=true (sem Meta conectada)
import dayjs from 'dayjs';

export function demoSummary() {
  return {
    spend: 12450.75, impressions: 845000, reach: 320000, frequency: 2.64,
    cpm: 14.73, clicks: 18200, ctr: 2.15, cpc: 0.68,
    conversations: 412, leads: 289, costPerLead: 43.08, costPerConversation: 30.22,
  };
}

export function demoCampaigns() {
  return [
    { id: '1', name: 'Campanha Vendas - Black Friday', status: 'ACTIVE', objective: 'OUTCOME_SALES',
      spend: 5200.5, impressions: 410000, reach: 180000, ctr: 2.4, cpc: 0.62, cpm: 12.68,
      conversations: 210, leads: 160, lastSync: new Date().toISOString() },
    { id: '2', name: 'Geração de Leads - Institucional', status: 'ACTIVE', objective: 'OUTCOME_LEADS',
      spend: 4100.25, impressions: 280000, reach: 95000, ctr: 1.9, cpc: 0.71, cpm: 14.6,
      conversations: 130, leads: 95, lastSync: new Date().toISOString() },
    { id: '3', name: 'Remarketing - Carrinho', status: 'PAUSED', objective: 'OUTCOME_SALES',
      spend: 3150.0, impressions: 155000, reach: 45000, ctr: 2.6, cpc: 0.7, cpm: 20.3,
      conversations: 72, leads: 34, lastSync: new Date().toISOString() },
  ];
}

export function demoDaily() {
  return Array.from({ length: 15 }).map((_, i) => {
    const d = dayjs().subtract(14 - i, 'day');
    return { date: d.format('DD/MM'), spend: 600 + Math.random() * 400, leads: 12 + Math.round(Math.random() * 15) };
  });
}
