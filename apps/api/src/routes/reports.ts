import PDFDocument from 'pdfkit';
import type { FastifyInstance } from 'fastify';
import { Platform } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, resolveClientScope } from '../middleware/auth.js';
import { getCampaigns, getDashboardSummary } from '../services/metrics.js';

function parseQuery(query: unknown) {
  const toDefault = new Date();
  const fromDefault = new Date();
  fromDefault.setDate(toDefault.getDate() - 7);
  const parsed = z.object({
    clientId: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    platform: z.nativeEnum(Platform).optional()
  }).parse(query);
  return {
    ...parsed,
    from: parsed.from ? new Date(`${parsed.from}T00:00:00.000Z`) : fromDefault,
    to: parsed.to ? new Date(`${parsed.to}T23:59:59.999Z`) : toDefault
  };
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports/export.csv', { preHandler: requireAuth }, async (request, reply) => {
    const query = parseQuery(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    const result = await getCampaigns({ tenantId: request.user!.tenantId, clientId, from: query.from, to: query.to, platform: query.platform });
    const header = ['Campanha', 'Plataforma', 'Status', 'Investimento', 'Resultados', 'Custo por resultado', 'CTR', 'Cliques', 'Impressoes'];
    const rows = result.campaigns.map((campaign) => [
      campaign.campaignName,
      campaign.platform,
      campaign.status,
      campaign.spend,
      campaign.results,
      campaign.costPerResult,
      campaign.ctr,
      campaign.clicks,
      campaign.impressions
    ].map(csvEscape).join(','));
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="gestao-ads-relatorio.csv"')
      .send([header.map(csvEscape).join(','), ...rows].join('\n'));
  });

  app.get('/reports/export.pdf', { preHandler: requireAuth }, async (request, reply) => {
    const query = parseQuery(request.query);
    const clientId = await resolveClientScope(request, query.clientId);
    const summary = await getDashboardSummary({ tenantId: request.user!.tenantId, clientId, from: query.from, to: query.to, platform: query.platform });
    const campaigns = summary.campaigns.slice(0, 12);

    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    reply.raw.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="gestao-ads-relatorio.pdf"'
    });
    doc.pipe(reply.raw);
    doc.fontSize(20).text('Gestao Ads - R2R Marketing Digital');
    doc.moveDown(0.5).fontSize(10).fillColor('#555').text(`Periodo: ${summary.period.from} a ${summary.period.to}`);
    doc.moveDown().fillColor('#111').fontSize(12).text(summary.summary);
    doc.moveDown().fontSize(14).text('Resumo');
    doc.fontSize(10)
      .text(`Investimento: R$ ${summary.totals.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
      .text(`Resultados: ${Math.round(summary.totals.results).toLocaleString('pt-BR')}`)
      .text(`Custo por resultado: R$ ${summary.totals.costPerResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
      .text(`Cliques: ${summary.totals.clicks.toLocaleString('pt-BR')}`)
      .text(`CTR: ${summary.totals.ctr.toLocaleString('pt-BR')}%`);
    doc.moveDown().fontSize(14).text('Campanhas');
    doc.fontSize(9);
    for (const campaign of campaigns) {
      doc.moveDown(0.35).text(`${campaign.campaignName} | ${campaign.platform} | ${campaign.status} | R$ ${campaign.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | ${Math.round(campaign.results)} resultados`);
    }
    doc.moveDown().fillColor('#777').text(`Ultima sincronizacao: ${summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString('pt-BR') : 'sem sincronizacao registrada'}`);
    doc.end();
    return reply;
  });
}
