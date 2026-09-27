import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CreditCard,
  History,
  QrCode,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { api } from '../api';
import { useScope } from '../store';

type PaymentCenter={
  client:{id:string;name:string};
  account:{
    id:string;accountId:string;name:string;businessId?:string|null;businessName?:string|null;
    currency:string;accountStatus?:number|null;balance:number;amountSpent:number;spendCap:number;
    isPrepayAccount:boolean;fundingSource?:{type?:string|null;displayString?:string|null;lastFourDigits?:string|null;expiration?:string|null}|null;
  };
  metaFinancialCapabilities:{
    businessId?:string|null;
    paymentSourcesReadable:boolean;
    businessCreditCards:Array<{id?:string|null;name:string;status?:string|null;displayString?:string|null;expiration?:string|null}>;
    extendedCredits:Array<{id?:string|null;name:string;legalEntityName?:string|null;maxBalance?:unknown;onlineMaxBalance?:unknown;owned:boolean}>;
    hasExtendedCredit:boolean;
    capabilityErrors:string[];
  };
  supportedInPlatform:{
    readBalance:boolean;
    readSpend:boolean;
    readFundingSourceSummary:boolean;
    readBillingActivity:boolean;
    readBusinessCreditCards:boolean;
    readExtendedCredit:boolean;
    createMetaPixDirectly:boolean;
    createMetaBoletoDirectly:boolean;
    addMetaPaymentMethodDirectly:boolean;
    addMetaFundsDirectly:boolean;
  };
  securityNotice:string;
  updatedAt:string;
};
type Activity={eventType:string;label:string;eventTime?:string|null;actorName?:string|null;translatedEventType?:string|null;details?:Record<string,unknown>|null};

const money=(value:unknown,currency='BRL')=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:currency||'BRL',maximumFractionDigits:2}).format(Number(value||0));
const dateTime=(value?:string|null)=>value?new Date(value).toLocaleString('pt-BR'):'—';

function detailText(details?:Record<string,unknown>|null){
  if(!details)return'';
  return Object.entries(details).filter(([,v])=>v!==null&&v!==undefined&&String(v).trim()!=='').slice(0,4).map(([k,v])=>`${k.replace(/_/g,' ')}: ${String(v)}`).join(' · ');
}

export default function BillingPayments(){
  const scope=useScope();
  const [data,setData]=useState<PaymentCenter|null>(null);
  const [activities,setActivities]=useState<Activity[]>([]);
  const [loading,setLoading]=useState(false);
  const [activityLoading,setActivityLoading]=useState(false);
  const [error,setError]=useState('');

  const allowedAccounts=useMemo(()=>scope.accounts.filter(a=>a.clientId===scope.clientId&&a.isActive&&a.isAssigned&&(!scope.businessId||a.businessId===scope.businessId)),[scope.accounts,scope.clientId,scope.businessId]);
  const selectedAccountId=scope.adAccountId||allowedAccounts[0]?.id||'';

  async function load(){
    if(!scope.clientId||!selectedAccountId){setData(null);return;}
    setLoading(true);setError('');
    try{
      const params={clientId:scope.clientId,...(scope.businessId?{businessId:scope.businessId}:{}),adAccountId:selectedAccountId};
      const response=await api.get('/financial/meta-payment-center',{params});
      setData(response.data?.data||null);
    }catch(e:any){
      setData(null);
      setError(e?.response?.data?.error?.message||'Não foi possível carregar cobrança e pagamentos desta conta.');
    }finally{setLoading(false);}
  }

  async function loadActivity(){
    if(!scope.clientId||!selectedAccountId)return;
    setActivityLoading(true);
    try{
      const response=await api.get('/financial/meta-activity',{params:{clientId:scope.clientId,...(scope.businessId?{businessId:scope.businessId}:{}),adAccountId:selectedAccountId}});
      setActivities(Array.isArray(response.data?.data?.activities)?response.data.data.activities:[]);
    }catch(e:any){
      setActivities([]);
      setError(e?.response?.data?.error?.message||'Não foi possível consultar a atividade de pagamento.');
    }finally{setActivityLoading(false);}
  }

  useEffect(()=>{void load();void loadActivity();},[scope.clientId,scope.businessId,selectedAccountId]);

  const account=data?.account;
  const funding=account?.fundingSource;
  const fundingText=funding?.displayString||funding?.type||(funding?.lastFourDigits?`Final ${funding.lastFourDigits}`:'Nenhuma forma identificada pela integração Meta');
  const creditCards=data?.metaFinancialCapabilities.businessCreditCards||[];
  const credits=data?.metaFinancialCapabilities.extendedCredits||[];

  return <div className="space-y-4">
    <section className="page-heading">
      <div><p className="section-kicker">Financeiro Meta</p><h1>Cobrança e pagamentos</h1><p>Intermediação direta com os dados financeiros disponibilizados pela Meta para a empresa, BM e conta autorizadas neste perfil.</p></div>
      <button className="secondary-button" onClick={()=>{void load();void loadActivity();}} disabled={loading||activityLoading}><RefreshCw size={13} className={loading||activityLoading?'animate-spin':''}/>Sincronizar Meta</button>
    </section>

    {error&&<div className="message-warning">{error}</div>}

    {!selectedAccountId&&<section className="corporate-card p-5"><div className="empty-state"><CreditCard size={22}/><span>Selecione uma conta de anúncios no cabeçalho para consultar cobrança e pagamentos da Meta.</span></div></section>}

    {selectedAccountId&&<>
      <section className="grid gap-3 lg:grid-cols-[1.45fr_.75fr]">
        <div className="corporate-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="section-kicker">Fundos disponíveis na Meta</p><strong className="mt-2 block text-[30px] font-medium tracking-[-0.04em] text-slate-900">{loading?'Atualizando...':money(account?.balance,account?.currency)}</strong><p className="mt-1 text-[9px] text-slate-500">{account?.businessName||'BM selecionada'} · {account?.name||'Conta Meta'}</p></div>
            <button className="secondary-button" onClick={()=>{void load();}} disabled={loading}><RefreshCw size={13} className={loading?'animate-spin':''}/>Atualizar saldo</button>
          </div>
          <div className="mt-5 border-t border-[#e4e9e6] pt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="mini-stat"><span>Gasto acumulado</span><strong>{money(account?.amountSpent,account?.currency)}</strong><small>Retornado pela Meta</small></div>
              <div className="mini-stat"><span>Limite de gastos</span><strong>{account?.spendCap?money(account.spendCap,account.currency):'Sem limite informado'}</strong><small>Definido na Meta</small></div>
              <div className="mini-stat"><span>Modelo de cobrança</span><strong>{account?.isPrepayAccount?'Pré-pago':'Faturamento Meta'}</strong><small>Conforme configuração da conta</small></div>
            </div>
          </div>
        </div>

        <aside className="corporate-card p-5">
          <div className="flex items-center gap-2"><ReceiptText size={16} className="text-[#176846]"/><h2 className="panel-title">Integração financeira</h2></div>
          <p className="panel-subtitle">A Gestão Ads apenas intermedeia e exibe o que a Meta disponibiliza para esta BM/conta.</p>
          <div className="mt-4 rounded-[8px] border border-[#dce7e1] bg-[#f6fbf8] p-3 text-[9px] leading-4 text-[#37594a]">
            Nenhum Pix, boleto ou cartão é criado pela Gestão Ads. Quando a Meta disponibilizar um instrumento financeiro pela integração, ele é exibido aqui vinculado à BM correta.
          </div>
        </aside>
      </section>

      <section className="corporate-card overflow-hidden">
        <div className="border-b border-[#e2e7e4] p-4"><h2 className="panel-title">Formas de pagamento da BM</h2><p className="panel-subtitle">Fontes financeiras retornadas pela integração oficial da Meta para o escopo selecionado.</p></div>
        <div className="grid gap-0 md:grid-cols-[1fr_1.4fr]">
          <div className="border-b border-[#e8ece9] p-4 md:border-b-0 md:border-r">
            <div className="flex items-start gap-3"><span className="metric-icon"><WalletCards size={15}/></span><div className="min-w-0"><strong className="block text-[11px] text-slate-800">Forma atual da conta</strong><p className="mt-1 break-words text-[10px] text-slate-500">{fundingText}</p>{funding?.lastFourDigits&&<p className="mt-1 text-[9px] text-slate-400">Final {funding.lastFourDigits}{funding.expiration?` · ${funding.expiration}`:''}</p>}</div></div>
          </div>
          <div className="p-4">
            <strong className="text-[10px] text-slate-700">Fontes financeiras sincronizadas</strong>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {creditCards.map((card,index)=><div key={card.id||index} className="rounded-[8px] border border-[#dfe5e1] bg-white p-3"><CreditCard size={17} className="text-[#176846]"/><strong className="mt-2 block text-[10px]">{card.name||'Cartão Meta'}</strong><small className="mt-1 block text-[8px] leading-4 text-slate-500">{card.displayString||card.status||'Fonte retornada pela Meta'}{card.expiration?` · validade ${card.expiration}`:''}</small></div>)}
              {credits.map((credit,index)=><div key={credit.id||index} className="rounded-[8px] border border-[#dfe5e1] bg-white p-3"><Banknote size={17} className="text-[#176846]"/><strong className="mt-2 block text-[10px]">{credit.name}</strong><small className="mt-1 block text-[8px] leading-4 text-slate-500">Linha de crédito Meta{credit.legalEntityName?` · ${credit.legalEntityName}`:''}</small></div>)}
              {!creditCards.length&&!credits.length&&<div className="col-span-full rounded-[8px] border border-dashed border-[#d8dedb] p-4 text-[9px] leading-4 text-slate-500">A Meta não retornou cartões ou linhas de crédito adicionais para esta BM através das permissões/API disponíveis.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="corporate-card p-4">
          <div className="flex gap-3"><span className="metric-icon"><QrCode size={15}/></span><div><h2 className="panel-title">Pix Meta</h2><p className="panel-subtitle">Somente será exibido quando a própria Meta disponibilizar QR Code/código Pix pela integração desta BM.</p></div></div>
          <div className="mt-3 rounded-[8px] border border-[#e2e7e4] bg-[#fafbfa] p-3 text-[9px] text-slate-500">No momento, a API conectada não retornou uma cobrança Pix gerável para esta conta.</div>
        </div>
        <div className="corporate-card p-4">
          <div className="flex gap-3"><span className="metric-icon"><Banknote size={15}/></span><div><h2 className="panel-title">Boleto Meta</h2><p className="panel-subtitle">Somente será exibido quando a própria Meta disponibilizar linha digitável/URL de boleto pela integração desta BM.</p></div></div>
          <div className="mt-3 rounded-[8px] border border-[#e2e7e4] bg-[#fafbfa] p-3 text-[9px] text-slate-500">No momento, a API conectada não retornou um boleto gerável para esta conta.</div>
        </div>
      </section>

      <section className="corporate-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex gap-3"><span className="metric-icon"><History size={15}/></span><div><h2 className="panel-title">Atividade de pagamento</h2><p className="panel-subtitle">Recargas, cobranças, reembolsos, recusas e alterações financeiras retornadas pela Meta para a conta selecionada.</p></div></div><button className="secondary-button" onClick={()=>{void loadActivity();}} disabled={activityLoading}><RefreshCw size={12} className={activityLoading?'animate-spin':''}/>Atualizar atividade</button></div>
        <div className="mt-4 overflow-hidden rounded-[8px] border border-[#e1e6e3]">
          {activities.map((item,index)=><div key={`${item.eventType}-${item.eventTime}-${index}`} className="grid gap-2 border-b border-[#edf0ee] px-3 py-3 last:border-0 sm:grid-cols-[1fr_auto]"><div><strong className="text-[10px] text-slate-700">{item.label}</strong><p className="mt-1 text-[8px] leading-4 text-slate-500">{item.actorName||'Meta / sistema'}{detailText(item.details)?` · ${detailText(item.details)}`:''}</p></div><span className="text-[8px] text-slate-400">{dateTime(item.eventTime)}</span></div>)}
          {!activityLoading&&!activities.length&&<div className="p-5 text-center text-[9px] text-slate-400">Nenhuma atividade financeira retornada pela Meta para esta conta no período.</div>}
          {activityLoading&&<div className="p-5 text-center text-[9px] text-slate-400">Consultando atividade financeira na Meta...</div>}
        </div>
      </section>

      <section className="corporate-card p-4">
        <div className="flex gap-3"><ShieldCheck size={17} className="mt-0.5 text-[#176846]"/><div><h2 className="panel-title">Intermediação segura com a Meta</h2><p className="panel-subtitle">{data?.securityNotice||'A Gestão Ads não cria cobranças próprias nem armazena dados completos de cartão.'}</p><p className="mt-2 text-[9px] leading-4 text-slate-500">O escopo continua vinculado à empresa, BM e conta selecionadas. A ferramenta nunca deve apresentar um Pix, boleto ou cobrança local como se fosse da Meta.</p></div></div>
      </section>
    </>}
  </div>;
}
