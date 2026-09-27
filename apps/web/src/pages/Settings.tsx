import { useEffect, useState } from 'react';
import { Bell, Bot, Database, Link2, MessageSquareText, Palette, RefreshCw, Save, Settings2, ShieldCheck, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { applyBranding, defaultBranding, normalizeBranding, type Branding } from '../branding';
import { useAuth, useScope } from '../store';
import PwaInstallCard from '../components/PwaInstallCard';

export default function Settings(){
  const navigate=useNavigate();
  const user=useAuth(s=>s.user);
  const scope=useScope();
  const admin=['SUPER_ADMIN','AGENCY_ADMIN'].includes(user?.role||'');
  const [branding,setBranding]=useState<Branding>(defaultBranding);
  const [brandingLoading,setBrandingLoading]=useState(false);
  const [brandingMessage,setBrandingMessage]=useState('');
  const [aiStatus,setAiStatus]=useState<any>(null);
  const [aiRunning,setAiRunning]=useState(false);
  const [aiMessage,setAiMessage]=useState('');

  const cards=[
    ['Conexão Meta','Gerencie a conexão e as contas vinculadas.','/integracoes',Link2],
    ['Usuários e acessos','Vínculos por empresa, BM e perfil.','/usuarios',Users],
    ['Alertas','Regras e ocorrências para tomada de decisão.','/alertas',Bell],
    ['Atendimento','Chat interno, chamados, arquivos e áudio.','/atendimento',MessageSquareText],
    ['Gerenciadores de Negócios','Organize gerenciadores e contas por empresa.','/business-managers',Database],
  ];

  useEffect(()=>{
    if(!admin)return;
    api.get('/workspace/branding').then(r=>setBranding(normalizeBranding(r.data?.data))).catch(()=>undefined);
    api.get('/ai/status').then(r=>setAiStatus(r.data?.data||null)).catch(()=>undefined);
  },[admin]);

  async function analyzeNow(){
    if(!admin)return;
    setAiRunning(true);setAiMessage('');
    try{
      const r=await api.post('/ai/analyze/now');
      setAiMessage('Análise atualizada: '+String(r.data?.data?.processed||0)+' campanha(s) processada(s).');
      const status=await api.get('/ai/status');
      setAiStatus(status.data?.data||null);
    }catch(error:any){
      setAiMessage(error?.response?.data?.error?.message||'Não foi possível atualizar a análise da IA.');
    }finally{setAiRunning(false);}
  }
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
    <section className="page-heading"><div><p className="section-kicker">Preferências</p><h1>Configurações</h1><p>Gerencie identidade, acessos e recursos disponíveis na plataforma.</p></div></section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.filter(([title])=>admin||!['Usuários e acessos'].includes(String(title))).map(([title,description,path,Icon]:any)=>
        <button key={path} className="corporate-card p-4 text-left transition hover:border-[#b9c9c0] hover:bg-[#fbfcfb]" onClick={()=>navigate(path)}>
          <span className="metric-icon"><Icon size={15}/></span>
          <h2 className="mt-3 text-[12px] font-semibold">{title}</h2>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">{description}</p>
        </button>)}
    </section>

    <PwaInstallCard />

    {admin&&<section className="corporate-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="metric-icon"><Bot size={15}/></span>
          <div>
            <h2 className="panel-title">Agente IA de Campanhas</h2>
            <p className="panel-subtitle">Pré-atendimento humanizado, leitura contínua das campanhas e análise privada diária para o administrador.</p>
          </div>
        </div>
        <button className="primary-button" type="button" onClick={()=>{void analyzeNow();}} disabled={aiRunning}><RefreshCw size={13} className={aiRunning?'animate-spin':''}/>{aiRunning?'Analisando...':'Analisar agora'}</button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="mini-stat"><span>IA</span><strong>{aiStatus?.configured?'Configurada':'Aguardando chave'}</strong><small>{aiStatus?.model||'modelo configurável'}</small></div>
        <div className="mini-stat"><span>Análise contínua</span><strong>{aiStatus?.intervalMinutes?('A cada '+aiStatus.intervalMinutes+' min'):'—'}</strong><small>24 horas por dia</small></div>
        <div className="mini-stat"><span>Relatório privado</span><strong>{aiStatus?.dailyReportHour!==undefined?(String(aiStatus.dailyReportHour).padStart(2,'0')+':00'):'—'}</strong><small>WhatsApp {aiStatus?.adminWhatsapp||'administrador'}</small></div>
        <div className="mini-stat"><span>Última análise</span><strong>{aiStatus?.lastAnalysisAt?new Date(aiStatus.lastAnalysisAt).toLocaleString('pt-BR'):'Ainda não executada'}</strong><small>Campanhas e métricas</small></div>
      </div>
      {!aiStatus?.configured&&<div className="message-warning mt-3">Os recursos inteligentes ainda não estão disponíveis. O atendimento continuará funcionando normalmente e poderá ser encaminhado para uma pessoa.</div>}
      {aiMessage&&<div className="message-success mt-3">{aiMessage}</div>}
    </section>}

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

    <section className="corporate-card p-4"><div className="flex gap-3"><ShieldCheck size={17} className="mt-0.5 text-[#176846]"/><div><h2 className="panel-title">Seleção atual</h2><p className="panel-subtitle">Estas são as informações selecionadas para visualização.</p><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="mini-stat"><span>Empresa</span><strong>{scope.clients.find(c=>c.id===scope.clientId)?.name||'—'}</strong></div><div className="mini-stat"><span>Gerenciador</span><strong>{scope.businesses.find(b=>b.metaBusinessId===scope.businessId&&b.clientId===scope.clientId)?.name||'Todos'}</strong></div><div className="mini-stat"><span>Conta</span><strong>{scope.accounts.find(a=>a.id===scope.adAccountId)?.name||'Todas'}</strong></div></div></div></div></section>
  </div>;
}
