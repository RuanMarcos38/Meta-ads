import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Building2, KeyRound, Plus, RefreshCw, Save, Shield, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api } from '../api';
import { useAuth, useScope } from '../store';

type AccessUser={id:string;name:string;email:string;role:string;clientId?:string|null;businessId?:string|null;clientIds?:string[];isActive:boolean;mustChangePassword?:boolean;lastLoginAt?:string|null;createdAt?:string};
type BusinessOption={id:string;clientId:string;metaBusinessId:string;name:string;status?:string|null};
type DiscoveredAccount={accountId:string;name:string;currency?:string|null;accountStatus?:number|null;selected:boolean};
type DiscoveredBusiness={businessId:string;businessName:string;adminEmail?:string|null;selected:boolean;accountCount:number;accounts:DiscoveredAccount[]};

function linkedIds(row:AccessUser){
 const values=Array.isArray(row.clientIds)&&row.clientIds.length?row.clientIds:row.clientId?[row.clientId]:[];
 return Array.from(new Set(values.filter(Boolean)));
}

export default function UsersAccess(){
 const auth=useAuth(s=>s.user);
 const scope=useScope();
 const isAdmin=['SUPER_ADMIN','AGENCY_ADMIN'].includes(auth?.role||'');
 const[rows,setRows]=useState<AccessUser[]>([]);
 const[loading,setLoading]=useState(false);
 const[saving,setSaving]=useState(false);
 const[accessSaving,setAccessSaving]=useState(false);
 const[companySaving,setCompanySaving]=useState(false);
 const[businessLoading,setBusinessLoading]=useState(false);
 const[companyBusinesses,setCompanyBusinesses]=useState<BusinessOption[]>([]);
 const[deletingId,setDeletingId]=useState('');
 const[error,setError]=useState('');
 const[success,setSuccess]=useState('');
 const[name,setName]=useState('');
 const[email,setEmail]=useState('');
 const[password,setPassword]=useState('');
 const[role,setRole]=useState<'CLIENT'|'MANAGER'|'AGENCY_ADMIN'>('CLIENT');
 const[clientId,setClientId]=useState(scope.clientId);
 const[businessId,setBusinessId]=useState(scope.businessId);
 const[additionalClientIds,setAdditionalClientIds]=useState<string[]>([]);
 const[editingUser,setEditingUser]=useState<AccessUser|null>(null);
 const[editClientIds,setEditClientIds]=useState<string[]>([]);
 const[companyName,setCompanyName]=useState('');
 const[companyLegalName,setCompanyLegalName]=useState('');
 const[companyEmail,setCompanyEmail]=useState('');
 const[companyPhone,setCompanyPhone]=useState('');
 const[bmSetupClientId,setBmSetupClientId]=useState('');
 const[bmSetupBusinesses,setBmSetupBusinesses]=useState<DiscoveredBusiness[]>([]);
 const[bmSetupLoading,setBmSetupLoading]=useState(false);
 const[bmSetupSaving,setBmSetupSaving]=useState(false);

 useEffect(()=>{
  setClientId(scope.clientId);
  setBusinessId(scope.businessId);
  setAdditionalClientIds(current=>current.filter(id=>id!==scope.clientId));
 },[scope.clientId,scope.businessId]);

 async function load(){
  setLoading(true);
  try{
   const r=await api.get('/workspace/users',{params:{...(scope.clientId?{clientId:scope.clientId}:{})}});
   setRows(Array.isArray(r.data?.data)?r.data.data:[]);
   setError('');
  }catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível carregar usuários.');}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[scope.clientId]);

 async function loadBusinessOptions(targetClientId:string,refreshSelected=false){
  if(!targetClientId){setCompanyBusinesses([]);setBusinessLoading(false);return;}
  setBusinessLoading(true);
  try{
   if(refreshSelected&&isAdmin){
    try{await api.post('/workspace/business-managers/import-from-meta',{clientId:targetClientId});window.dispatchEvent(new Event('gestao-ads:scope-refresh'));}catch{/* A seleção explícita abaixo continua disponível. */}
   }
   const r=await api.get('/workspace/business-managers',{params:{clientId:targetClientId}});
   const options=(Array.isArray(r.data?.data)?r.data.data:[]).filter((item:any)=>item?.clientId===targetClientId&&item?.metaBusinessId&&item?.status!=='inactive') as BusinessOption[];
   const unique=new Map<string,BusinessOption>();
   options.forEach(item=>unique.set(item.metaBusinessId,item));
   const normalized=Array.from(unique.values()).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
   setCompanyBusinesses(normalized);
   setBusinessId(current=>normalized.some(item=>item.metaBusinessId===current)?current:'');
  }catch(e:any){
   const fallback=scope.businesses.filter(b=>b.clientId===targetClientId&&b.status!=='inactive') as BusinessOption[];
   setCompanyBusinesses(fallback);
   if(!fallback.length)setError(e?.response?.data?.error?.message||'Não foi possível carregar as Business Managers desta empresa.');
  }finally{setBusinessLoading(false);}
 }

 useEffect(()=>{
  if(role==='AGENCY_ADMIN'||!clientId){setCompanyBusinesses([]);return;}
  void loadBusinessOptions(clientId);
 },[clientId,role]);

 const businessOptions=useMemo(()=>{
  const unique=new Map<string,BusinessOption>();
  companyBusinesses.forEach(item=>unique.set(item.metaBusinessId,item));
  scope.businesses.filter(b=>b.clientId===clientId&&b.status!=='inactive').forEach(item=>unique.set(item.metaBusinessId,item));
  return Array.from(unique.values()).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
 },[companyBusinesses,scope.businesses,clientId]);
 const needsBmSetup=isAdmin&&role!=='AGENCY_ADMIN'&&Boolean(clientId)&&!businessLoading&&!businessOptions.length;

 const additionalCompanies=useMemo(()=>scope.clients.filter(item=>item.id!==clientId),[scope.clients,clientId]);
 const bmSetupClient=useMemo(()=>scope.clients.find(item=>item.id===bmSetupClientId),[scope.clients,bmSetupClientId]);
 const selectedBmCount=bmSetupBusinesses.filter(item=>item.selected).length;
 const selectedAccountCount=bmSetupBusinesses.reduce((sum,item)=>sum+(item.selected?item.accounts.filter(account=>account.selected).length:0),0);

 async function openBmSetup(targetClientId:string){
  if(!targetClientId||!isAdmin)return;
  setBmSetupClientId(targetClientId);setBmSetupLoading(true);setBmSetupBusinesses([]);setError('');setSuccess('');
  try{
   const r=await api.post('/workspace/business-managers/discover-from-meta',{clientId:targetClientId});
   const businesses=Array.isArray(r.data?.data?.businesses)?r.data.data.businesses:[];
   setBmSetupBusinesses(businesses.map((item:any)=>({
    businessId:String(item.businessId||''),businessName:String(item.businessName||item.businessId||'BM'),adminEmail:item.adminEmail||null,
    selected:Boolean(item.selected),accountCount:Number(item.accountCount||0),accounts:Array.isArray(item.accounts)?item.accounts.map((account:any)=>({accountId:String(account.accountId||''),name:String(account.name||account.accountId||'Conta'),currency:account.currency||null,accountStatus:account.accountStatus??null,selected:Boolean(account.selected)})):[],
   })));
  }catch(e:any){
   setError(e?.response?.data?.error?.message||'Não foi possível consultar as BMs disponíveis na Meta. Conecte a Meta desta empresa e tente novamente.');
  }finally{setBmSetupLoading(false);}
 }

 function toggleBm(targetBusinessId:string){
  setBmSetupBusinesses(current=>current.map(item=>item.businessId!==targetBusinessId?item:{...item,selected:!item.selected,accounts:!item.selected?item.accounts:item.accounts.map(account=>({...account,selected:false}))}));
 }
 function toggleBmAccount(targetBusinessId:string,targetAccountId:string){
  setBmSetupBusinesses(current=>current.map(item=>item.businessId!==targetBusinessId?item:{...item,selected:true,accounts:item.accounts.map(account=>account.accountId===targetAccountId?{...account,selected:!account.selected}:account)}));
 }

 async function saveBmSetup(){
  if(!bmSetupClientId||!isAdmin)return;
  const selected=bmSetupBusinesses.filter(item=>item.selected);
  if(!selected.length){setError('Selecione pelo menos uma BM que pertença a esta empresa.');return;}
  setBmSetupSaving(true);setError('');setSuccess('');
  try{
   await api.post('/workspace/business-managers/assign-from-meta',{
    clientId:bmSetupClientId,
    selections:selected.map(item=>({businessId:item.businessId,accountIds:item.accounts.filter(account=>account.selected).map(account=>account.accountId)})),
   });
   window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
   if(clientId===bmSetupClientId)await loadBusinessOptions(bmSetupClientId,false);
   setSuccess(selected.length>1?`${selected.length} BMs agrupadas nesta empresa. Dashboard, relatórios e contas permanecem separados por BM.`:'BM vinculada à empresa com as contas selecionadas.');
   setBmSetupClientId('');setBmSetupBusinesses([]);
  }catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível salvar as BMs e contas desta empresa.');}
  finally{setBmSetupSaving(false);}
 }

 async function createCompany(e:React.FormEvent){
  e.preventDefault();
  if(!isAdmin||!companyName.trim())return;
  setCompanySaving(true);setError('');setSuccess('');
  try{
   const r=await api.post('/clients',{
    name:companyName.trim(),
    ...(companyLegalName.trim()?{companyName:companyLegalName.trim()}:{}),
    ...(companyEmail.trim()?{email:companyEmail.trim().toLowerCase()}:{}),
    ...(companyPhone.trim()?{phone:companyPhone.trim()}:{}),
   });
   const created=r.data?.data;
   setCompanyName('');setCompanyLegalName('');setCompanyEmail('');setCompanyPhone('');
   setSuccess('Empresa cadastrada. Selecione abaixo somente as BMs e contas de anúncios que pertencem a ela.');
   window.dispatchEvent(new Event('gestao-ads:scope-refresh'));
   if(created?.id){scope.setClientId(created.id);setClientId(created.id);setBusinessId('');setAdditionalClientIds([]);await openBmSetup(created.id);}
  }catch(err:any){setError(err?.response?.data?.error?.message||'Não foi possível cadastrar a empresa.');}
  finally{setCompanySaving(false);}
 }

 function toggleAdditionalCompany(id:string){
  setAdditionalClientIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
 }

 async function create(e:React.FormEvent){
  e.preventDefault();if(!isAdmin)return;setSaving(true);setError('');setSuccess('');
  try{
   const clientIds=role==='AGENCY_ADMIN'?undefined:Array.from(new Set([clientId,...additionalClientIds].filter(Boolean)));
   await api.post('/workspace/users',{name,email,password,role,clientId:role==='AGENCY_ADMIN'?null:clientId,clientIds,businessId:role==='AGENCY_ADMIN'?null:businessId});
   setName('');setEmail('');setPassword('');setAdditionalClientIds([]);
   setSuccess(clientIds&&clientIds.length>1?'Acesso multiempresa criado com sucesso. O usuário poderá alternar entre as empresas autorizadas.':'Acesso criado com sucesso.');
   await load();
  }catch(err:any){setError(err?.response?.data?.error?.message||'Não foi possível criar o acesso.');}
  finally{setSaving(false);}
 }

 function openCompanyAccess(row:AccessUser){
  setEditingUser(row);
  setEditClientIds(linkedIds(row));
  setError('');setSuccess('');
 }

 function toggleEditCompany(id:string){
  if(id===editingUser?.clientId)return;
  setEditClientIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
 }

 async function saveCompanyAccess(){
  if(!editingUser||!isAdmin)return;
  setAccessSaving(true);setError('');setSuccess('');
  try{
   const clientIds=Array.from(new Set([editingUser.clientId,...editClientIds].filter(Boolean) as string[]));
   await api.patch(`/workspace/users/${editingUser.id}`,{clientIds});
   setSuccess(clientIds.length>1?'Empresas do usuário atualizadas. O acesso às BMs e contas autorizadas acompanhará a empresa selecionada.':'Usuário mantido somente na empresa principal.');
   setEditingUser(null);setEditClientIds([]);
   await load();
  }catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível atualizar as empresas do usuário.');}
  finally{setAccessSaving(false);}
 }

 async function toggle(row:AccessUser){try{await api.patch(`/workspace/users/${row.id}`,{isActive:!row.isActive});await load();}catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível alterar o acesso.');}}
 async function reset(row:AccessUser){const next=window.prompt(`Nova senha temporária para ${row.email} (mínimo 10 caracteres):`);if(!next)return;try{await api.patch(`/workspace/users/${row.id}`,{password:next});setSuccess('Senha temporária atualizada.');await load();}catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível redefinir a senha.');}}
 async function remove(row:AccessUser){if(row.id===auth?.id)return;const confirmed=window.confirm(`Excluir definitivamente o usuário ${row.name} (${row.email})?\n\nO acesso será removido, mas registros de auditoria e histórico de atendimento serão preservados.`);if(!confirmed)return;setDeletingId(row.id);setError('');setSuccess('');try{await api.delete(`/workspace/users/${row.id}`);setSuccess('Usuário excluído.');if(editingUser?.id===row.id){setEditingUser(null);setEditClientIds([]);}await load();}catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível excluir o usuário.');}finally{setDeletingId('');}}

 return <div className="space-y-4">
  <section className="page-heading"><div><p className="section-kicker">Segurança</p><h1>Usuários e acessos</h1><p>Cadastre empresas e vincule o mesmo Cliente/Gestor a uma ou várias empresas, mantendo cada BM e conta de anúncios isoladas nos dashboards e relatórios.</p></div><button className="secondary-button" onClick={()=>{void load();if(clientId&&role!=='AGENCY_ADMIN')void loadBusinessOptions(clientId,true);}} disabled={loading||businessLoading}><RefreshCw size={14} className={loading||businessLoading?'animate-spin':''}/>Atualizar</button></section>
  {error&&<div className="message-warning">{error}</div>}
  {success&&<div className="message-success">{success}</div>}

  {isAdmin&&<form onSubmit={createCompany} className="filter-panel">
   <div className="mb-3 flex items-center gap-2"><Building2 size={15} className="text-[#2563eb]"/><div><h2 className="panel-title">Nova empresa</h2><p className="panel-subtitle">Cadastre a empresa sem sair desta tela. Depois escolha somente as BMs e contas que realmente pertencem a ela.</p></div></div>
   <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
    <label className="field-label">Nome da empresa<input className="field-control" value={companyName} onChange={e=>setCompanyName(e.target.value)} required placeholder="Ex.: ECOJOI"/></label>
    <label className="field-label">Razão social<input className="field-control" value={companyLegalName} onChange={e=>setCompanyLegalName(e.target.value)} placeholder="Opcional"/></label>
    <label className="field-label">E-mail da empresa<input className="field-control" type="email" value={companyEmail} onChange={e=>setCompanyEmail(e.target.value)} placeholder="Opcional"/></label>
    <label className="field-label">Telefone / WhatsApp<input className="field-control" value={companyPhone} onChange={e=>setCompanyPhone(e.target.value)} placeholder="Ex.: (47) 99999-9999"/></label>
   </div>
   <div className="mt-3 flex flex-wrap justify-end gap-2">{clientId&&<button type="button" className="secondary-button" onClick={()=>{void openBmSetup(clientId);}}><BriefcaseBusiness size={14}/>Configurar BMs da empresa atual</button>}<button className="primary-button" disabled={companySaving||!companyName.trim()}><Plus size={14}/>{companySaving?'Cadastrando':'Cadastrar empresa'}</button></div>
  </form>}

  {isAdmin&&bmSetupClientId&&<section className="filter-panel bm-company-panel">
   <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex min-w-0 items-start gap-2"><BriefcaseBusiness size={15} className="mt-0.5 shrink-0 text-[#2563eb]"/><div className="min-w-0"><h2 className="panel-title">Business Managers desta empresa</h2><p className="panel-subtitle">{bmSetupClient?.name||'Empresa selecionada'} · marque somente as BMs corretas. Se houver mais de uma, elas ficam agrupadas nesta empresa, porém dashboards, relatórios e contas continuam separados.</p></div></div><button type="button" className="icon-button" title="Fechar" onClick={()=>{setBmSetupClientId('');setBmSetupBusinesses([]);}}><X size={14}/></button></div>
   {bmSetupLoading?<div className="empty-state"><RefreshCw size={18} className="animate-spin"/><span>Consultando BMs e contas disponíveis na Meta...</span></div>:<div className="mt-3 grid gap-3 xl:grid-cols-2">{bmSetupBusinesses.map(bm=><article key={bm.businessId} className={`rounded-[8px] border p-3 ${bm.selected?'border-blue-200 bg-blue-50/40':'border-[#dfe5e2] bg-white'}`}><label className="flex cursor-pointer items-start gap-2"><input className="mt-1" type="checkbox" checked={bm.selected} onChange={()=>toggleBm(bm.businessId)}/><span className="min-w-0"><strong className="block text-[12px] font-semibold text-slate-700">{bm.businessName}</strong><small className="block text-[10px] text-slate-500">ID {bm.businessId} · {bm.accounts.length} conta{bm.accounts.length===1?'':'s'} encontrada{bm.accounts.length===1?'':'s'}</small></span></label>{bm.selected&&<div className="mt-3 space-y-1.5 border-t border-[#e2e7e4] pt-2"><p className="mb-2 text-[10px] font-semibold text-slate-600">Contas de anúncios autorizadas nesta BM</p>{bm.accounts.map(account=><label key={account.accountId} className="flex cursor-pointer items-center gap-2 rounded-[6px] border border-[#e3e8e5] bg-white px-2.5 py-2 text-[10px] text-slate-600"><input type="checkbox" checked={account.selected} onChange={()=>toggleBmAccount(bm.businessId,account.accountId)}/><span className="min-w-0 flex-1"><strong className="block truncate font-medium text-slate-700">{account.name}</strong><small className="text-slate-400">Conta {account.accountId}{account.currency?` · ${account.currency}`:''}</small></span></label>)}{!bm.accounts.length&&<p className="text-[10px] text-slate-400">Esta BM não retornou contas de anúncios disponíveis.</p>}</div>}</article>)}{!bmSetupBusinesses.length&&<div className="empty-state corporate-card col-span-full"><BriefcaseBusiness size={20}/><span>Nenhuma BM disponível. Confirme a conexão Meta desta empresa em Integrações.</span></div>}</div>}
   {!bmSetupLoading&&bmSetupBusinesses.length>0&&<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#e1e6e3] pt-3"><p className="text-[10px] text-slate-500"><strong>{selectedBmCount}</strong> BM(s) e <strong>{selectedAccountCount}</strong> conta(s) serão vinculadas exclusivamente a esta empresa.</p><button type="button" className="primary-button" disabled={bmSetupSaving||!selectedBmCount} onClick={()=>{void saveBmSetup();}}><Save size={13}/>{bmSetupSaving?'Salvando':'Salvar BMs e contas'}</button></div>}
  </section>}

  {isAdmin&&<form onSubmit={create} className="filter-panel">
   <div className="mb-3 flex items-center gap-2"><UserPlus size={15} className="text-[#2563eb]"/><div><h2 className="panel-title">Novo acesso</h2><p className="panel-subtitle">A Empresa + BM principal continuam obrigatórias para Cliente/Gestor. Só aparecem BMs já vinculadas à empresa selecionada.</p></div></div>
   <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
    <label className="field-label">Nome<input className="field-control" value={name} onChange={e=>setName(e.target.value)} required/></label>
    <label className="field-label">E-mail<input className="field-control" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
    <label className="field-label">Senha temporária<input className="field-control" type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={10} required/></label>
    <label className="field-label">Perfil<select className="field-control" value={role} onChange={e=>{const next=e.target.value as any;setRole(next);if(next==='AGENCY_ADMIN'){setAdditionalClientIds([]);setBusinessId('');}}}><option value="CLIENT">Cliente</option><option value="MANAGER">Gestor</option><option value="AGENCY_ADMIN">Administrador da agência</option></select></label>
    <label className="field-label">Empresa principal<select className="field-control" value={clientId} disabled={role==='AGENCY_ADMIN'} onChange={e=>{const next=e.target.value;setClientId(next);setBusinessId('');setAdditionalClientIds(current=>current.filter(id=>id!==next));}}><option value="">Selecione</option>{scope.clients.map(c=><option key={c.id} value={c.id}>{c.name}{c._count?.businessManagers?` · ${c._count.businessManagers} BM(s)`:''}</option>)}</select></label>
    <label className="field-label">BM principal<div className="flex min-w-0 gap-2"><select className="field-control min-w-0 flex-1" value={businessId} disabled={role==='AGENCY_ADMIN'||!clientId||businessLoading} onChange={e=>setBusinessId(e.target.value)}><option value="">{businessLoading?'Carregando BMs...':businessOptions.length?'Selecione':'Configure as BMs da empresa'}</option>{businessOptions.map(b=><option key={b.id} value={b.metaBusinessId}>{b.name}</option>)}</select>{needsBmSetup&&<button type="button" className="secondary-button shrink-0 px-2" title="Configurar BMs da empresa selecionada" onClick={()=>{void openBmSetup(clientId);}}><BriefcaseBusiness size={13}/><span className="hidden 2xl:inline">Configurar</span></button>}</div></label>
   </div>

   {role!=='AGENCY_ADMIN'&&clientId&&additionalCompanies.length>0&&<div className="mt-3 rounded-[8px] border border-[#dfe5e2] bg-white p-3">
    <div className="mb-2 flex items-start gap-2"><Building2 size={14} className="mt-0.5 text-[#2563eb]"/><div><strong className="block text-[10px] text-slate-700">Empresas adicionais deste mesmo usuário</strong><p className="text-[9px] leading-4 text-slate-500">Marque outras empresas que ele poderá selecionar. Em cada uma serão exibidas somente as BMs e contas de anúncios autorizadas nela.</p></div></div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{additionalCompanies.map(company=><label key={company.id} className="flex cursor-pointer items-center gap-2 rounded-[7px] border border-[#e2e7e4] px-3 py-2 text-[10px] text-slate-600 hover:bg-[#fafbfa]"><input type="checkbox" checked={additionalClientIds.includes(company.id)} onChange={()=>toggleAdditionalCompany(company.id)}/><span className="min-w-0"><strong className="block truncate text-slate-700">{company.name}</strong><small className="text-[8px] text-slate-400">{company._count?.businessManagers||0} BM(s) · {company._count?.adAccounts||0} conta(s)</small></span></label>)}</div>
   </div>}

   <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[9px] text-slate-400">{additionalClientIds.length?`${additionalClientIds.length+1} empresas serão liberadas para este usuário.`:'Somente a empresa principal será liberada.'}</span><button className="primary-button" disabled={saving||businessLoading||(['CLIENT','MANAGER'].includes(role)&&(!clientId||!businessId))}><UserPlus size={14}/>{saving?'Criando':'Criar acesso'}</button></div>
  </form>}

  {isAdmin&&editingUser&&<section className="filter-panel">
   <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-2"><Building2 size={15} className="mt-0.5 text-[#2563eb]"/><div><h2 className="panel-title">Empresas do usuário</h2><p className="panel-subtitle"><strong>{editingUser.name}</strong> · {editingUser.email}. A empresa principal permanece preservada; marque ou desmarque apenas os acessos adicionais.</p></div></div><button className="icon-button" title="Fechar" onClick={()=>{setEditingUser(null);setEditClientIds([]);}}><X size={14}/></button></div>
   <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{scope.clients.map(company=>{const primary=company.id===editingUser.clientId;const checked=editClientIds.includes(company.id)||primary;return <label key={company.id} className={`flex items-center gap-2 rounded-[7px] border px-3 py-2 text-[10px] ${primary?'border-blue-200 bg-blue-50':'border-[#e2e7e4] bg-white'}`}><input type="checkbox" checked={checked} disabled={primary} onChange={()=>toggleEditCompany(company.id)}/><span className="min-w-0"><strong className="block truncate text-slate-700">{company.name}</strong><small className="text-[8px] text-slate-400">{primary?'Empresa principal · não removível':'Acesso adicional'}</small></span></label>})}</div>
   <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-[9px] text-slate-500">Com mais de uma empresa, o usuário poderá alternar Empresa, BM e Conta de anúncios pelo seletor global. Removendo as adicionais, o comportamento volta ao modelo original.</p><div className="flex gap-2"><button className="secondary-button" onClick={()=>{setEditingUser(null);setEditClientIds([]);}}>Cancelar</button><button className="primary-button" disabled={accessSaving} onClick={()=>{void saveCompanyAccess();}}><Save size={13}/>{accessSaving?'Salvando':'Salvar empresas'}</button></div></div>
  </section>}

  <section className="corporate-card overflow-hidden"><div className="table-scroll"><table className="corporate-table"><thead><tr><th>Usuário</th><th>Perfil</th><th>Empresa(s)</th><th>BM</th><th>Status</th><th>Último login</th><th>Ações</th></tr></thead><tbody>{rows.map(row=>{const ids=linkedIds(row);const client=scope.clients.find(c=>c.id===row.clientId);const bm=[...companyBusinesses,...scope.businesses].find(b=>b.clientId===row.clientId&&b.metaBusinessId===row.businessId);const additional=Math.max(0,ids.length-1);return <tr key={row.id}><td><strong>{row.name}</strong><small>{row.email}</small></td><td><span className="status-chip status-neutral"><Shield size={11}/>{row.role}</span></td><td><strong className="block text-[10px]">{client?.name||'Agência'}</strong>{additional>0&&<small className="text-[8px] text-blue-600">+ {additional} empresa{additional>1?'s':''}</small>}</td><td>{additional>0?<span><strong className="block text-[10px]">{bm?.name||row.businessId||'Principal'}</strong><small className="text-[8px] text-slate-400">BMs conforme empresa selecionada</small></span>:bm?.name||row.businessId||'Todas'}</td><td><span className={`status-chip ${row.isActive?'status-success':'status-neutral'}`}>{row.isActive?'Ativo':'Inativo'}</span></td><td>{row.lastLoginAt?new Date(row.lastLoginAt).toLocaleString('pt-BR'):'Nunca'}</td><td>{isAdmin&&<div className="flex flex-wrap gap-1">{['CLIENT','MANAGER'].includes(row.role)&&<button className="icon-button" title="Gerenciar empresas" onClick={()=>openCompanyAccess(row)}><Building2 size={13}/></button>}<button className="secondary-button" onClick={()=>{void toggle(row);}}>{row.isActive?'Desativar':'Ativar'}</button><button className="icon-button" title="Redefinir senha" onClick={()=>{void reset(row);}}><KeyRound size={13}/></button>{row.id!==auth?.id&&<button className="icon-button text-red-600" title="Excluir usuário" disabled={deletingId===row.id} onClick={()=>{void remove(row);}}><Trash2 size={13}/></button>}</div>}</td></tr>})}{!rows.length&&!loading&&<tr><td colSpan={7}><div className="empty-state"><Users size={20}/><span>Nenhum usuário neste escopo.</span></div></td></tr>}</tbody></table></div></section>
 </div>;
}
