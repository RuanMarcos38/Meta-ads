import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useScope } from '../store';
import GlobalScopeBar from './GlobalScopeBar';
import {
  BarChart3, Bell, BriefcaseBusiness, Building2, CreditCard, FileClock,
  FileText, HelpCircle, LayoutDashboard, Link2, LogOut, Megaphone, MessageSquareText,
  Plus, Search, Settings2, ShieldCheck, UserCircle, Users,
} from 'lucide-react';

type MenuItem={to:string;label:string;icon:any;end?:boolean;roles?:string[]};
type MenuGroup={label:string;items:MenuItem[]};

const groups:MenuGroup[]=[
  {label:'Visão',items:[
    {to:'/',label:'Dashboard',icon:BarChart3,end:true},
    {to:'/agencia',label:'Visão da agência',icon:LayoutDashboard,roles:['SUPER_ADMIN','AGENCY_ADMIN']},
  ]},
  {label:'Estrutura',items:[
    {to:'/empresas',label:'Empresas',icon:Building2,roles:['SUPER_ADMIN','AGENCY_ADMIN','MANAGER']},
    {to:'/business-managers',label:'Business Managers',icon:BriefcaseBusiness},
    {to:'/contas-meta',label:'Contas Meta',icon:CreditCard},
  ]},
  {label:'Operação',items:[
    {to:'/campanhas',label:'Campanhas',icon:Megaphone},
    {to:'/relatorios',label:'Relatórios',icon:FileText},
    {to:'/alertas',label:'Alertas',icon:Bell},
    {to:'/atendimento',label:'Atendimento',icon:MessageSquareText},
  ]},
  {label:'Gestão',items:[
    {to:'/usuarios',label:'Usuários e acessos',icon:Users,roles:['SUPER_ADMIN','AGENCY_ADMIN','MANAGER']},
    {to:'/configuracoes',label:'Configurações',icon:Settings2},
  ]},
  {label:'Administração',items:[
    {to:'/integracoes',label:'Integrações',icon:Link2,roles:['SUPER_ADMIN','AGENCY_ADMIN']},
    {to:'/auditoria',label:'Auditoria',icon:FileClock,roles:['SUPER_ADMIN','AGENCY_ADMIN']},
  ]},
];

export default function Layout(){
 const{user,setUser}=useAuth();const scope=useScope();const navigate=useNavigate();const[unread,setUnread]=useState(0);const[alerts,setAlerts]=useState(0);
 const initial=(user?.name||user?.email||'U').trim().charAt(0).toUpperCase();
 const allowed=(roles?:string[])=>!roles||roles.includes(user?.role||'');
 async function loadBadges(){try{const[s,a]=await Promise.all([api.get('/support/summary').catch(()=>null),api.get('/workspace/alerts',{params:{...(scope.clientId?{clientId:scope.clientId}:{}),...(scope.businessId?{businessId:scope.businessId}:{}),unread:true}}).catch(()=>null)]);setUnread(Number(s?.data?.data?.unread||0));setAlerts(Array.isArray(a?.data?.data)?a.data.data.length:0);}catch{/*não bloqueia layout*/}}
 useEffect(()=>{void loadBadges();const id=window.setInterval(()=>{void loadBadges();},30000);const support=()=>{void loadBadges();};window.addEventListener('gestao-ads:alerts-refresh',support);return()=>{clearInterval(id);window.removeEventListener('gestao-ads:alerts-refresh',support);};},[scope.clientId,scope.businessId]);
 async function logout(){try{await api.post('/auth/logout');}catch{}localStorage.removeItem('token');localStorage.removeItem('refresh');scope.clearScope();setUser(null);navigate('/login',{replace:true});}
 return <div className="app-viewport min-h-screen bg-[#f1f3f1] text-slate-950 lg:p-3 xl:p-4"><div className="mx-auto flex min-h-screen max-w-[1680px] min-w-0 flex-col overflow-hidden border border-[#d9dfdb] bg-white lg:min-h-[calc(100vh-1.5rem)] lg:flex-row lg:rounded-[12px] lg:shadow-[0_10px_28px_rgba(25,42,33,0.06)]">
  <aside className="relative z-30 flex min-w-0 flex-col border-b border-[#dfe4e1] bg-[#fafbfa] px-3 py-3 sm:px-4 lg:w-[232px] lg:shrink-0 lg:border-b-0 lg:border-r lg:p-4">
   <div className="flex min-w-0 items-center justify-between gap-3"><button onClick={()=>navigate('/')} className="flex min-w-0 items-center gap-3 text-left"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] bg-[#2563eb] text-white"><BarChart3 size={18}/></span><span className="min-w-0"><strong className="block truncate text-[14px] font-semibold text-[#18231d]">Gestão Ads</strong><small className="block truncate text-[9px] tracking-wide text-slate-500">R2R Marketing Digital</small></span></button><button onClick={logout} className="icon-button text-red-600 lg:hidden"><LogOut size={15}/></button></div>
   <div className="premium-scrollbar mt-3 min-w-0 flex-1 overflow-x-auto pb-1 lg:mt-6 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1"><div className="flex min-w-max gap-2 lg:min-w-0 lg:flex-col lg:gap-4">{groups.map(group=>{const items=group.items.filter(i=>allowed(i.roles));if(!items.length)return null;return <div key={group.label} className="flex gap-2 lg:block"><p className="mb-1.5 hidden px-2 text-[8px] font-semibold uppercase tracking-[0.15em] text-slate-400 lg:block">{group.label}</p><nav className="flex gap-1.5 lg:flex-col">{items.map(item=>{const Icon=item.icon;const badge=item.to==='/atendimento'?unread:item.to==='/alertas'?alerts:0;return <NavLink key={item.to} to={item.to} end={item.end} className={({isActive})=>`relative flex min-h-9 min-w-fit items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-[11px] font-semibold transition-colors ${isActive?'bg-[#2563eb] text-white':'text-slate-600 hover:bg-[#eff6ff] hover:text-slate-950'}`}><Icon size={14}/><span>{item.label}</span>{badge>0&&<span className="ml-auto min-w-4 rounded-full bg-red-500 px-1 text-center text-[8px] leading-4 text-white">{badge>99?'99+':badge}</span>}</NavLink>})}</nav></div>})}</div></div>
   <div className="hidden border-t border-[#e2e7e4] pt-3 lg:block"><div className="rounded-[7px] bg-[#eff6ff] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-[#1e3a8a]"><ShieldCheck size={13}/>Produção</div><p className="mt-1 text-[9px] leading-4 text-slate-500">Dados reais, escopo por empresa e BM.</p></div><button onClick={()=>navigate('/atendimento')} className="mt-2 flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-[10px] font-semibold text-slate-500 hover:bg-[#eff6ff]"><HelpCircle size={14}/>Ajuda e chamados</button><button onClick={logout} className="mt-1 flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-[10px] font-semibold text-red-600 hover:bg-red-50"><LogOut size={14}/>Sair</button></div>
  </aside>
  <main className="min-w-0 flex-1 overflow-visible bg-white lg:overflow-hidden"><header className="flex min-w-0 flex-col gap-2 border-b border-[#dfe4e1] bg-white px-3 py-2.5 sm:px-4 md:flex-row md:items-center md:justify-between md:px-5"><label className="relative block min-w-0 flex-1 md:max-w-xl"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14}/><input className="h-9 w-full rounded-[7px] border border-[#dfe5e1] bg-[#f8faf8] pl-9 pr-3 text-[11px] outline-none focus:border-[#93c5fd] focus:bg-white" placeholder="Buscar campanha, empresa ou conta" onKeyDown={e=>{if(e.key==='Enter')navigate('/campanhas');}}/></label><div className="flex min-w-0 items-center justify-between gap-1.5 md:justify-end"><button onClick={()=>navigate('/campanhas')} className="primary-button h-9"><Plus size={14}/><span className="hidden sm:inline">Nova campanha</span></button><button onClick={()=>navigate('/atendimento')} className="icon-button relative" title="Atendimento"><MessageSquareText size={14}/>{unread>0&&<i className="notification-dot"/>}</button><button onClick={()=>navigate('/alertas')} className="icon-button relative" title="Alertas"><Bell size={14}/>{alerts>0&&<i className="notification-dot"/>}</button><div className="ml-1 flex min-w-0 items-center gap-2 border-l border-[#dfe4e1] pl-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#dbeafe] text-[11px] font-semibold text-[#1e3a8a]">{initial}</span><span className="hidden min-w-0 sm:block sm:max-w-[150px]"><strong className="block truncate text-[10px] font-semibold">{user?.name||'Usuário'}</strong><small className="block truncate text-[8px] text-slate-500">{user?.email||user?.role}</small></span><UserCircle className="hidden text-slate-300 xl:block" size={16}/></div></div></header><GlobalScopeBar/><section className="premium-scrollbar min-w-0 overflow-visible px-3 py-3 sm:px-4 md:px-5 md:py-4 lg:max-h-[calc(100vh-112px)] lg:overflow-auto"><Outlet/></section></main>
 </div></div>;
}
