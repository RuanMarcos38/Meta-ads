import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CreditCard,
  History,
  ReceiptText,
  RefreshCw,
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
  paymentProfile:{
    businessId?:string|null;
    currentFundingSource?:{type?:string|null;displayString?:string|null;lastFourDigits?:string|null;expiration?:string|null}|null;
    businessCreditCards:Array<{id?:string|null;name:string;status?:string|null;displayString?:string|null;expiration?:string|null}>;
    extendedCredits:Array<{id?:string|null;name:string;legalEntityName?:string|null;maxBalance?:unknown;onlineMaxBalance?:unknown;owned:boolean}>;
  };
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
  const funding=data?.paymentProfile?.currentFundingSource||account?.fundingSource;
  const fundingText=funding?.displayString||funding?.type||(funding?.lastFourDigits?`Final ${funding.lastFourDigits}`:'Nenhuma forma cadastrada');
  const creditCards=data?.paymentProfile?.businessCreditCards||[];
  const credits=data?.paymentProfile?.extendedCredits||[];

  return <div className="space-y-4">
    <section className="page-heading">
      <div><p className="section-kicker">Financeiro</p><h1>Cobrança e pagamentos</h1><p>Consulte saldo, forma de pagamento e movimentações da conta selecionada.</p></div>
      <button className="secondary-button" onClick={()=>{void load();void loadActivity();}} disabled={loading||activityLoading}><RefreshCw size={13} className={loading||activityLoading?'animate-spin':''}/>Atualizar</button>
    </section>

    {error&&<div className="message-warning">{error}</div>}

    {!selectedAccountId&&<section className="corporate-card p-5"><div className="empty-state"><CreditCard size={22}/><span>Selecione uma conta de anúncios para consultar cobrança e pagamentos.</span></div></section>}

    {selectedAccountId&&<>
      <section className="grid gap-3 lg:grid-cols-[1.45fr_.75fr]">
        <div className="corporate-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="section-kicker">Fundos disponíveis</p>
              <strong className="mt-2 block text-[30px] font-medium tracking-[-0.04em] text-slate-900">{loading?'Atualizando...':money(account?.balance,account?.currency)}</strong>
              <p className="mt-1 text-[9px] text-slate-500">{account?.businessName||'Gerenciador selecionado'} · {account?.name||'Conta de anúncios'}</p>
            </div>
            <button className="secondary-button" onClick={()=>{void load();}} disabled={loading}><RefreshCw size={13} className={loading?'animate-spin':''}/>Atualizar saldo</button>
          </div>
          <div className="mt-5 border-t border-[#e4e9e6] pt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="mini-stat"><span>Gasto acumulado</span><strong>{money(account?.amountSpent,account?.currency)}</strong><small>Conta selecionada</small></div>
              <div className="mini-stat"><span>Limite de gastos</span><strong>{account?.spendCap?money(account.spendCap,account.currency):'Sem limite informado'}</strong><small>Configuração atual</small></div>
              <div className="mini-stat"><span>Tipo de cobrança</span><strong>{account?.isPrepayAccount?'Saldo pré-pago':'Cobrança automática'}</strong><small>Conta selecionada</small></div>
            </div>
          </div>
        </div>

        <aside className="corporate-card p-5">
          <div className="flex items-center gap-2"><ReceiptText size={16} className="text-[#176846]"/><h2 className="panel-title">Conta de anúncios</h2></div>
          <p className="panel-subtitle">As informações exibidas pertencem somente à conta selecionada acima.</p>
          <div className="mt-4 rounded-[8px] border border-[#dce7e1] bg-[#f6fbf8] p-3">
            <strong className="block text-[10px] text-[#2f5f49]">{account?.name||'Conta selecionada'}</strong>
            <span className="mt-1 block text-[8px] text-[#5f756a]">ID {account?.accountId||'—'}</span>
          </div>
        </aside>
      </section>

      <section className="corporate-card overflow-hidden">
        <div className="border-b border-[#e2e7e4] p-4"><h2 className="panel-title">Como você pagará</h2><p className="panel-subtitle">Formas de pagamento disponíveis para esta conta.</p></div>
        <div className="grid gap-0 md:grid-cols-[1fr_1.4fr]">
          <div className="border-b border-[#e8ece9] p-4 md:border-b-0 md:border-r">
            <div className="flex items-start gap-3"><span className="metric-icon"><WalletCards size={15}/></span><div className="min-w-0"><strong className="block text-[11px] text-slate-800">Forma atual</strong><p className="mt-1 break-words text-[10px] text-slate-500">{fundingText}</p>{funding?.lastFourDigits&&<p className="mt-1 text-[9px] text-slate-400">Final {funding.lastFourDigits}{funding.expiration?` · ${funding.expiration}`:''}</p>}</div></div>
          </div>
          <div className="p-4">
            <strong className="text-[10px] text-slate-700">Outras formas vinculadas</strong>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {creditCards.map((card,index)=><div key={card.id||index} className="rounded-[8px] border border-[#dfe5e1] bg-white p-3"><CreditCard size={17} className="text-[#176846]"/><strong className="mt-2 block text-[10px]">{card.name||'Cartão'}</strong><small className="mt-1 block text-[8px] leading-4 text-slate-500">{card.displayString||card.status||'Forma de pagamento cadastrada'}{card.expiration?` · validade ${card.expiration}`:''}</small></div>)}
              {credits.map((credit,index)=><div key={credit.id||index} className="rounded-[8px] border border-[#dfe5e1] bg-white p-3"><Banknote size={17} className="text-[#176846]"/><strong className="mt-2 block text-[10px]">{credit.name}</strong><small className="mt-1 block text-[8px] leading-4 text-slate-500">Linha de crédito{credit.legalEntityName?` · ${credit.legalEntityName}`:''}</small></div>)}
              {!creditCards.length&&!credits.length&&<div className="col-span-full rounded-[8px] border border-dashed border-[#d8dedb] p-4 text-[9px] leading-4 text-slate-500">Nenhuma forma adicional disponível para esta conta.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="corporate-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-3"><span className="metric-icon"><History size={15}/></span><div><h2 className="panel-title">Atividade de pagamento</h2><p className="panel-subtitle">Cobranças, recargas, reembolsos, recusas e alterações da conta selecionada.</p></div></div>
          <button className="secondary-button" onClick={()=>{void loadActivity();}} disabled={activityLoading}><RefreshCw size={12} className={activityLoading?'animate-spin':''}/>Atualizar atividade</button>
        </div>
        <div className="mt-4 overflow-hidden rounded-[8px] border border-[#e1e6e3]">
          {activities.map((item,index)=><div key={`${item.eventType}-${item.eventTime}-${index}`} className="grid gap-2 border-b border-[#edf0ee] px-3 py-3 last:border-0 sm:grid-cols-[1fr_auto]"><div><strong className="text-[10px] text-slate-700">{item.label}</strong><p className="mt-1 text-[8px] leading-4 text-slate-500">{item.actorName||'Sistema'}{detailText(item.details)?` · ${detailText(item.details)}`:''}</p></div><span className="text-[8px] text-slate-400">{dateTime(item.eventTime)}</span></div>)}
          {!activityLoading&&!activities.length&&<div className="p-5 text-center text-[9px] text-slate-400">Nenhuma atividade encontrada para esta conta no período.</div>}
          {activityLoading&&<div className="p-5 text-center text-[9px] text-slate-400">Atualizando atividade...</div>}
        </div>
      </section>
    </>}
  </div>;
}
