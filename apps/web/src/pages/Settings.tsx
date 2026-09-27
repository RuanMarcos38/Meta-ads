import { useEffect, useState } from 'react';
import { Bell, Database, Link2, MessageSquareText, Palette, RefreshCw, Save, Settings2, ShieldCheck, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { applyBranding, defaultBranding, normalizeBranding, type Branding } from '../branding';
import { useAuth, useScope } from '../store';

export default function Settings(){
  const navigate=useNavigate();
  const user=useAuth(s=>s.user);
  const scope=useScope();
  const admin=['SUPER_ADMIN','AGENCY_ADMIN'].includes(user?.role||'');
  const [branding,setBranding]=useState<Branding>(defaultBranding);
  const [brandingLoading,setBrandingLoading]=useState(false);
  const [brandingMessage,setBrandingMessage]=useState('');

  const cards=[
    ['Integração Meta','Conexões, tokens, permissões e saúde das BMs.','/integracoes',Link2],
    ['Usuários e acessos','Vínculos por empresa, BM e perfil.','/usuarios',Users],
    ['Alertas','Regras e ocorrências para tomada de decisão.','/alertas',Bell],
    ['Atendimento','Chat interno, chamados, arquivos e áudio.','/atendimento',MessageSquareText],
    ['Business Managers','Estrutura e sincronização independente.','/business-managers',Database],
  ];

  useEffect(()=>{
    if(!admin)return;
    api.get('/workspace/branding').then(r=>setBranding(normalizeBranding(r.data?.data))).catch(()=>undefined);
  },[admin]);

  async function saveBranding(event:React.FormEvent){
    event.preventDefault();
    if(!admin)return;
    setBrandingLoading(true);setBrandingMessage('');
    try{
      const response=await api.patch('/workspace/branding',{
        enabled:branding.enabled,
        name:branding.name||null,
        subtitle:branding.subtitle||null,
        logoUrl:branding.logoUrl||null,
        faviconUrl:branding.faviconUrl||null,
        primaryColor:branding.primaryColor||null,
        secondaryColor:branding.secondaryColor||null,
        supportEmail:branding.supportEmail||null,
        supportPhone:branding.supportPhone||null,
        domain:branding.domain||null,
      });
      const next=normalizeBranding(response.data?.data);
      setBranding(next);
      applyBranding(next);
      setBrandingMessage('White Label salvo. A identidade será aplicada aos usuários desta organização.');
    }catch(error:any){
      setBrandingMessage(error?.response?.data?.error?.message||'Não foi possível salvar o White Label.');
    }finally{setBrandingLoading(false);}
  }

  return <div className="space-y-4">
    <section className="page-heading"><div><p className="section-kicker">Sistema</p><h1>Configurações</h1><p>Configurações operacionais ficam agrupadas aqui. O usuário comum não vê informações técnicas espalhadas no dashboard.</p></div></section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.filter(([title])=>admin||!['Usuários e acessos'].includes(String(title))).map(([title,description,path,Icon]:any)=>
        <button key={path} className="corporate-card p-4 text-left transition hover:border-[#b9c9c0] hover:bg-[#fbfcfb]" onClick={()=>navigate(path)}>
          <span className="metric-icon"><Icon size={15}/></span>
          <h2 className="mt-3 text-[12px] font-semibold">{title}</h2>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">{description}</p>
        </button>)}
    </section>

    {admin&&<form onSubmit={saveBranding} className="corporate-card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="metric-icon"><Palette size={15}/></span>
          <div>
            <h2 className="panel-title">White Label</h2>
            <p className="panel-subtitle">Personalize nome, logotipo, cores, suporte e domínio sem alterar a estrutura funcional do sistema.</p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[10px] font-semibold text-slate-600">
          <input type="checkbox" checked={branding.enabled} onChange={e=>setBranding(v=>({...v,enabled:e.target.checked}))}/>
          Ativar White Label
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="field-label">Nome da plataforma<input className="field-control" value={branding.name} onChange={e=>setBranding(v=>({...v,name:e.target.value}))} placeholder="Gestão Ads"/></label>
        <label className="field-label">Subtítulo / Empresa<input className="field-control" value={branding.subtitle} onChange={e=>setBranding(v=>({...v,subtitle:e.target.value}))} placeholder="Sua agência"/></label>
        <label className="field-label">Domínio White Label<input className="field-control" value={branding.domain||''} onChange={e=>setBranding(v=>({...v,domain:e.target.value}))} placeholder="ads.seudominio.com.br"/></label>
        <label className="field-label md:col-span-2">URL do logotipo<input className="field-control" value={branding.logoUrl||''} onChange={e=>setBranding(v=>({...v,logoUrl:e.target.value}))} placeholder="https://.../logo.png"/></label>
        <label className="field-label">URL do favicon<input className="field-control" value={branding.faviconUrl||''} onChange={e=>setBranding(v=>({...v,faviconUrl:e.target.value}))} placeholder="https://.../favicon.png"/></label>
        <label className="field-label">Cor principal<input type="color" className="field-control p-1" value={branding.primaryColor} onChange={e=>setBranding(v=>({...v,primaryColor:e.target.value}))}/></label>
        <label className="field-label">Cor secundária<input type="color" className="field-control p-1" value={branding.secondaryColor} onChange={e=>setBranding(v=>({...v,secondaryColor:e.target.value}))}/></label>
        <label className="field-label">E-mail de suporte<input type="email" className="field-control" value={branding.supportEmail||''} onChange={e=>setBranding(v=>({...v,supportEmail:e.target.value}))}/></label>
        <label className="field-label">Telefone / WhatsApp de suporte<input className="field-control" value={branding.supportPhone||''} onChange={e=>setBranding(v=>({...v,supportPhone:e.target.value}))}/></label>
      </div>

      {brandingMessage&&<div className="message-success mt-3">{brandingMessage}</div>}
      <div className="mt-3 flex justify-end"><button className="primary-button" disabled={brandingLoading}><Save size={13}/>{brandingLoading?'Salvando...':'Salvar White Label'}</button></div>
    </form>}

    <section className="corporate-card p-4"><div className="flex gap-3"><ShieldCheck size={17} className="mt-0.5 text-[#176846]"/><div><h2 className="panel-title">Escopo atual</h2><p className="panel-subtitle">As páginas operacionais herdam este escopo automaticamente.</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="mini-stat"><span>Empresa</span><strong>{scope.clients.find(c=>c.id===scope.clientId)?.name||'—'}</strong><small>ID interno</small></div><div className="mini-stat"><span>Business Manager</span><strong>{scope.businesses.find(b=>b.metaBusinessId===scope.businessId&&b.clientId===scope.clientId)?.name||'Todas/—'}</strong><small>{scope.businessId||'sem filtro'}</small></div><div className="mini-stat"><span>Conta Meta</span><strong>{scope.accounts.find(a=>a.id===scope.adAccountId)?.name||'Todas'}</strong><small>{scope.accounts.find(a=>a.id===scope.adAccountId)?.accountId||'sem filtro'}</small></div></div></div></div></section>

    <section className="corporate-card p-4"><div className="flex items-center gap-2"><RefreshCw size={14} className="text-[#176846]"/><h2 className="panel-title">Atualização de dados</h2></div><p className="mt-2 text-[10px] leading-5 text-slate-500">Sincronização automática configurada a cada 5 minutos, isolada por empresa e BM. Uma falha em uma BM não interrompe as demais. O histórico importado permanece preservado em desconexões.</p></section>
  </div>;
}
