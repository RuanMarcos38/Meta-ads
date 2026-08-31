import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, FileText, Headphones, MessageCircle, Mic, Paperclip, Plus, Search, Send, Square, TicketCheck, UserRoundCheck, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

type Person={id:string;name:string;email:string;role:string;clientId?:string|null;clientName?:string|null;lastSeenAt?:string};
type Conv={id:string;createdById:string;assignedToId?:string|null;type:'CHAT'|'TICKET';status:'OPEN'|'PENDING'|'RESOLVED'|'CLOSED';subject?:string|null;priority:string;lastMessageAt:string;requester?:Person|null;assignedTo?:Person|null;peer?:Person|null;lastMessage?:{body?:string|null;attachmentName?:string|null;createdAt:string}|null;unread?:boolean;slaMinutes?:number;slaBreached?:boolean};
type Msg={id:string;senderId:string;kind:'TEXT'|'FILE'|'AUDIO'|'SYSTEM';body?:string|null;attachmentName?:string|null;attachmentMime?:string|null;attachmentSize?:number|null;createdAt:string;sender?:Person|null};
type Attachment={name:string;mime:string;dataBase64:string;kind:'FILE'|'AUDIO';size:number};

const dt=(v:string)=>new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
async function base64(blob:Blob){return await new Promise<string>((res,rej)=>{const r=new FileReader();r.onerror=()=>rej(r.error);r.onload=()=>res(String(r.result||'').split(',')[1]||'');r.readAsDataURL(blob);});}
const roleLabel=(role:string)=>role==='SUPER_ADMIN'||role==='AGENCY_ADMIN'?'Administrador':role==='MANAGER'?'Gestor':'Usuário';
const statusLabel=(status:string)=>status==='OPEN'?'Aberto':status==='PENDING'?'Aguardando':status==='RESOLVED'?'Resolvido':status==='CLOSED'?'Encerrado':status;
const priorityLabel=(priority:string)=>priority==='low'?'baixa':priority==='high'?'alta':priority==='urgent'?'urgente':'normal';

export default function SupportPro(){
 const user=useAuth(s=>s.user);
 const admin=['SUPER_ADMIN','AGENCY_ADMIN'].includes(user?.role||'');
 const[convs,setConvs]=useState<Conv[]>([]);
 const[msgs,setMsgs]=useState<Msg[]>([]);
 const[online,setOnline]=useState<Person[]>([]);
 const[selectedId,setSelectedId]=useState('');
 const[filter,setFilter]=useState<'ALL'|'CHAT'|'TICKET'>('ALL');
 const[search,setSearch]=useState('');
 const[draft,setDraft]=useState('');
 const[attachment,setAttachment]=useState<Attachment|null>(null);
 const[error,setError]=useState('');
 const[sending,setSending]=useState(false);
 const[showNew,setShowNew]=useState(false);
 const[newType,setNewType]=useState<'CHAT'|'TICKET'>('CHAT');
 const[newRecipientId,setNewRecipientId]=useState('');
 const[newSubject,setNewSubject]=useState('');
 const[newPriority,setNewPriority]=useState('normal');
 const[newMessage,setNewMessage]=useState('');
 const[recording,setRecording]=useState(false);
 const[audioUrls,setAudioUrls]=useState<Record<string,string>>({});
 const recorder=useRef<MediaRecorder|null>(null);
 const chunks=useRef<Blob[]>([]);
 const bottom=useRef<HTMLDivElement|null>(null);
 const selected=convs.find(c=>c.id===selectedId)||null;

 async function loadConvs(){
  try{
   const r=await api.get('/support/conversations');
   const rows=Array.isArray(r.data?.data)?r.data.data:[];
   setConvs(rows);
   if(!selectedId&&rows[0])setSelectedId(rows[0].id);
  }catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível carregar o atendimento.');}
 }

 async function loadMsgs(id:string){
  if(!id)return;
  try{
   const r=await api.get(`/support/conversations/${id}/messages`);
   setMsgs(Array.isArray(r.data?.data)?r.data.data:[]);
   await api.post(`/support/conversations/${id}/read`).catch(()=>undefined);
   window.dispatchEvent(new Event('gestao-ads:support-refresh'));
  }catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível carregar mensagens.');}
 }

 async function heartbeat(){
  await api.post('/support/presence').catch(()=>undefined);
  const r=await api.get('/support/presence').catch(()=>null);
  setOnline(Array.isArray(r?.data?.data)?r.data.data:[]);
 }

 useEffect(()=>{
  void loadConvs();
  void heartbeat();
  const conversationsTimer=setInterval(()=>{void loadConvs();},4000);
  const presenceTimer=setInterval(()=>{void heartbeat();},10000);
  return()=>{
   clearInterval(conversationsTimer);
   clearInterval(presenceTimer);
   Object.values(audioUrls).forEach(URL.revokeObjectURL);
  };
 },[]);

 useEffect(()=>{
  if(!selectedId){setMsgs([]);return;}
  void loadMsgs(selectedId);
  const id=setInterval(()=>{void loadMsgs(selectedId);},2500);
  return()=>clearInterval(id);
 },[selectedId]);

 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[msgs.length]);

 const visible=useMemo(()=>convs.filter(c=>(filter==='ALL'||c.type===filter)&&(!search.trim()||[c.subject,c.peer?.name,c.peer?.email,c.requester?.name,c.requester?.email,c.lastMessage?.body].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())))),[convs,filter,search]);
 const availablePeople=useMemo(()=>online.filter(p=>p.id!==user?.id),[online,user?.id]);
 const onlineIds=useMemo(()=>new Set(online.map(p=>p.id)),[online]);
 const selectedOnline=Boolean(selected?.peer?.id&&onlineIds.has(selected.peer.id));

 async function openDirect(person:Person){
  if(person.id===user?.id)return;
  setSending(true);setError('');
  try{
   const r=await api.post('/support/conversations',{type:'CHAT',recipientUserId:person.id});
   await loadConvs();
   if(r.data?.data?.id)setSelectedId(r.data.data.id);
  }catch(err:any){setError(err?.response?.data?.error?.message||'Não foi possível iniciar a conversa.');}
  finally{setSending(false);}
 }

 async function create(e:React.FormEvent){
  e.preventDefault();setSending(true);setError('');
  try{
   const payload:any={type:newType};
   if(newType==='CHAT'&&newRecipientId)payload.recipientUserId=newRecipientId;
   if(newType==='TICKET'){payload.subject=newSubject;payload.priority=newPriority;}
   if(newMessage.trim())payload.message=newMessage.trim();
   const r=await api.post('/support/conversations',payload);
   setShowNew(false);setNewRecipientId('');setNewSubject('');setNewMessage('');
   await loadConvs();
   if(r.data?.data?.id)setSelectedId(r.data.data.id);
  }catch(err:any){setError(err?.response?.data?.error?.message||'Não foi possível iniciar o atendimento.');}
  finally{setSending(false);}
 }

 async function choose(file?:File){if(!file)return;if(file.size>8*1024*1024){setError('O arquivo deve ter no máximo 8 MB.');return;}setAttachment({name:file.name,mime:file.type||'application/octet-stream',dataBase64:await base64(file),kind:'FILE',size:file.size});}
 async function toggleRecord(){if(recording){recorder.current?.stop();return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const rec=new MediaRecorder(stream);chunks.current=[];rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};rec.onstop=async()=>{const blob=new Blob(chunks.current,{type:rec.mimeType||'audio/webm'});stream.getTracks().forEach(t=>t.stop());setRecording(false);if(blob.size>8*1024*1024){setError('Áudio acima de 8 MB.');return;}setAttachment({name:`audio-${Date.now()}.webm`,mime:blob.type||'audio/webm',dataBase64:await base64(blob),kind:'AUDIO',size:blob.size});};recorder.current=rec;rec.start();setRecording(true);}catch{setError('Não foi possível acessar o microfone.');}}
 async function send(){if(!selected||(!draft.trim()&&!attachment))return;setSending(true);try{await api.post(`/support/conversations/${selected.id}/messages`,{body:draft.trim()||undefined,kind:attachment?.kind||'TEXT',...(attachment?{attachment:{name:attachment.name,mime:attachment.mime,dataBase64:attachment.dataBase64}}:{})});setDraft('');setAttachment(null);await Promise.all([loadMsgs(selected.id),loadConvs()]);}catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível enviar.');}finally{setSending(false);}}
 async function open(m:Msg){try{const r=await api.get(`/support/messages/${m.id}/attachment`,{responseType:'blob'});const url=URL.createObjectURL(r.data);if(m.kind==='AUDIO')setAudioUrls(v=>({...v,[m.id]:url}));else{const a=document.createElement('a');a.href=url;a.download=m.attachmentName||'arquivo';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}}catch{setError('Não foi possível abrir o anexo.');}}
 async function update(values:any){if(!selected)return;try{await api.patch(`/support/conversations/${selected.id}`,values);await loadConvs();}catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível atualizar o chamado.');}}

 return <div className="space-y-4">
  <section className="page-heading">
   <div><p className="section-kicker">Comunicação interna</p><h1>Atendimento</h1><p>Conversa ao vivo entre administradores e usuários da mesma empresa, com chamados, presença online, arquivos e áudio.</p></div>
   <button className="primary-button" onClick={()=>setShowNew(true)}><Plus size={14}/>Nova conversa/chamado</button>
  </section>
  {error&&<div className="message-warning">{error}</div>}

  <section className="grid min-h-[620px] overflow-hidden rounded-[8px] border border-[#dfe4e1] bg-white lg:grid-cols-[330px_1fr]">
   <aside className="border-b border-[#e1e6e3] lg:border-b-0 lg:border-r">
    <div className="p-3"><div className="relative"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input className="field-control pl-8" placeholder="Buscar atendimento" value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="mt-2 flex gap-1">{(['ALL','CHAT','TICKET'] as const).map(v=><button key={v} className={`tab-button ${filter===v?'tab-active':''}`} onClick={()=>setFilter(v)}>{v==='ALL'?'Todos':v==='CHAT'?'Conversas':'Chamados'}</button>)}</div></div>
    <div className="premium-scrollbar max-h-[500px] overflow-y-auto border-t border-[#e5e9e6]">{visible.map(c=>{const peerOnline=Boolean(c.peer?.id&&onlineIds.has(c.peer.id));return <button key={c.id} onClick={()=>setSelectedId(c.id)} className={`block w-full border-b border-[#edf0ee] p-3 text-left ${selectedId===c.id?'bg-[#eef4ff]':'hover:bg-[#fafbfa]'}`}><div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5">{c.type==='CHAT'&&<Circle size={7} className={peerOnline?'text-emerald-600':'text-slate-300'} fill="currentColor"/>}<strong className="truncate text-[11px]">{c.type==='CHAT'?(c.peer?.name||c.subject||'Atendimento'):c.subject||'Chamado'}</strong></span><span className="text-[8px] text-slate-400">{dt(c.lastMessageAt)}</span></div><p className="mt-1 truncate text-[9px] text-slate-500">{c.lastMessage?.body||c.lastMessage?.attachmentName||c.peer?.email||'Conversa iniciada'}</p><div className="mt-2 flex items-center gap-1"><span className="status-chip status-neutral">{c.type==='TICKET'?<TicketCheck size={10}/>:<MessageCircle size={10}/>} {statusLabel(c.status)}</span>{c.type==='CHAT'&&peerOnline&&<span className="status-chip status-success">Online</span>}{c.unread&&<span className="status-chip status-danger">Nova</span>}{c.slaBreached&&<span className="status-chip status-warning">Prazo</span>}</div></button>})}</div>
   </aside>

   <main className="flex min-w-0 flex-col">{selected?<>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e1e6e3] p-4"><div><div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold">{selected.type==='CHAT'?(selected.peer?.name||selected.subject||'Atendimento interno'):selected.subject||'Chamado'}</h2>{selected.type==='CHAT'&&<span className={`status-chip ${selectedOnline?'status-success':'status-neutral'}`}><Circle size={7} fill="currentColor"/>{selectedOnline?'Online':'Offline'}</span>}</div><p className="mt-1 text-[9px] text-slate-500">{selected.peer?.email?`${selected.peer.email} · `:''}{selected.type==='TICKET'?`Prioridade ${priorityLabel(selected.priority)}`:'Conversa interna'} · {statusLabel(selected.status)}</p></div>{admin&&<div className="flex gap-1">{selected.type==='TICKET'&&<button className="secondary-button" onClick={()=>{void update({assignToMe:true});}}><UserRoundCheck size={12}/>Assumir</button>}<select className="field-control w-auto" value={selected.status} onChange={e=>{void update({status:e.target.value});}}><option value="OPEN">Aberto</option><option value="PENDING">Aguardando</option><option value="RESOLVED">Resolvido</option><option value="CLOSED">Encerrado</option></select></div>}</header>
    <div className="premium-scrollbar flex-1 space-y-3 overflow-y-auto bg-[#f8fafc] p-4">{msgs.map(m=>{const mine=m.senderId===user?.id;const senderOnline=Boolean(m.sender?.id&&onlineIds.has(m.sender.id));return <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[82%] rounded-[8px] border px-3 py-2 ${mine?'border-[#bfdbfe] bg-[#eff6ff]':'border-[#e0e5e2] bg-white'}`}><div className="mb-1 flex items-center gap-2 text-[8px] text-slate-400"><span className="inline-flex items-center gap-1">{!mine&&<Circle size={6} className={senderOnline?'text-emerald-600':'text-slate-300'} fill="currentColor"/>}{m.sender?.name||'Usuário'}</span><span>{dt(m.createdAt)}</span></div>{m.body&&<p className="m-0 whitespace-pre-wrap text-[11px] leading-5">{m.body}</p>}{m.attachmentName&&<button className="mt-2 flex items-center gap-2 text-[10px] font-semibold text-[#2563eb]" onClick={()=>{void open(m);}}>{m.kind==='AUDIO'?<Headphones size={13}/>:<FileText size={13}/>} {m.attachmentName}</button>}{m.kind==='AUDIO'&&audioUrls[m.id]&&<audio controls src={audioUrls[m.id]} className="mt-2 max-w-full"/>}</div></div>})}<div ref={bottom}/></div>
    <footer className="border-t border-[#e1e6e3] bg-white p-3">{attachment&&<div className="mb-2 flex items-center justify-between rounded-[6px] bg-[#f2f5f3] px-3 py-2 text-[9px]"><span>{attachment.kind==='AUDIO'?'Áudio':'Arquivo'}: {attachment.name}</span><button onClick={()=>setAttachment(null)}><X size={13}/></button></div>}<div className="flex items-end gap-2"><textarea className="field-control min-h-[42px] flex-1" placeholder="Digite uma mensagem..." value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}}/><label className="icon-button cursor-pointer" title="Anexar arquivo"><Paperclip size={14}/><input type="file" className="hidden" onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}}/></label><button className={`icon-button ${recording?'text-red-600':''}`} title={recording?'Parar gravação':'Gravar áudio'} onClick={()=>{void toggleRecord();}}>{recording?<Square size={13}/>:<Mic size={14}/>}</button><button className="primary-button h-[36px]" title="Enviar mensagem" disabled={sending||(!draft.trim()&&!attachment)} onClick={()=>{void send();}}><Send size={14}/></button></div></footer>
   </>:<div className="empty-state flex-1"><MessageCircle size={22}/><span>Selecione uma pessoa online ou inicie uma conversa.</span></div>}</main>
  </section>

  <section className="corporate-card p-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="panel-title">Usuários online agora</h2><p className="panel-subtitle">Administradores e usuários da sua empresa aparecem automaticamente enquanto estiverem ativos na plataforma.</p></div><span className="status-chip status-success"><Circle size={8} fill="currentColor"/>{online.length} online</span></div>
   <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{online.map(p=>{const self=p.id===user?.id;return <div key={p.id} className="flex items-center justify-between gap-3 rounded-[8px] border border-[#e1e6e3] bg-white p-3"><div className="min-w-0"><div className="flex items-center gap-2"><Circle size={8} className="text-emerald-600" fill="currentColor"/><strong className="truncate text-[11px]">{p.name}{self?' (você)':''}</strong></div><p className="mt-1 truncate text-[9px] text-slate-500">{roleLabel(p.role)}{p.clientName?` · ${p.clientName}`:''}</p><p className="mt-0.5 truncate text-[8px] text-slate-400">{p.email}</p></div>{!self&&<button className="secondary-button shrink-0" disabled={sending} onClick={()=>{void openDirect(p);}}><MessageCircle size={12}/>Conversar</button>}</div>})}{!online.length&&<div className="col-span-full text-[10px] text-slate-400">Nenhum usuário identificado online agora.</div>}</div>
  </section>

  {showNew&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4"><form onSubmit={create} className="w-full max-w-lg rounded-[9px] bg-white p-5 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Novo atendimento</h2><button type="button" className="icon-button" onClick={()=>setShowNew(false)}><X size={14}/></button></div><div className="mt-4 grid gap-3"><label className="field-label">Tipo<select className="field-control" value={newType} onChange={e=>{setNewType(e.target.value as any);setNewRecipientId('');}}><option value="CHAT">Conversa</option><option value="TICKET">Chamado</option></select></label>{newType==='CHAT'&&<label className="field-label">Conversar com<select className="field-control" value={newRecipientId} onChange={e=>setNewRecipientId(e.target.value)}><option value="">Atendimento / administrador</option>{availablePeople.map(p=><option key={p.id} value={p.id}>{p.name} — Online — {roleLabel(p.role)}{p.clientName?` · ${p.clientName}`:''}</option>)}</select></label>}{newType==='TICKET'&&<><label className="field-label">Assunto<input className="field-control" value={newSubject} onChange={e=>setNewSubject(e.target.value)} minLength={3} required/></label><label className="field-label">Prioridade<select className="field-control" value={newPriority} onChange={e=>setNewPriority(e.target.value)}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label></>}<label className="field-label">Mensagem<textarea className="field-control" value={newMessage} onChange={e=>setNewMessage(e.target.value)} required={newType==='TICKET'||!newRecipientId} placeholder={newType==='CHAT'&&newRecipientId?'Opcional — você pode escrever depois de abrir a conversa.':'Digite a mensagem inicial'}/></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={()=>setShowNew(false)}>Cancelar</button><button className="primary-button" disabled={sending}><Plus size={13}/>{sending?'Criando':'Iniciar'}</button></div></form></div>}
 </div>;
}
