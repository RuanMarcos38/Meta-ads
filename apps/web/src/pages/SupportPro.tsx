import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCheck,
  Circle,
  FileText,
  Headphones,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Plus,
  Search,
  Send,
  Smile,
  Square,
  TicketCheck,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

type PresenceStatus='ONLINE'|'WORKING'|'BUSY'|'BREAK'|'AWAY'|'DND'|'OFFLINE';
type Person={id:string;name:string;email:string;role:string;clientId?:string|null;clientName?:string|null;lastSeenAt?:string|null;presenceStatus?:PresenceStatus;online?:boolean};
type Conv={id:string;createdById:string;assignedToId?:string|null;type:'CHAT'|'TICKET';status:'OPEN'|'PENDING'|'RESOLVED'|'CLOSED';subject?:string|null;priority:string;lastMessageAt:string;aiEnabled?:boolean;aiLastReplyAt?:string|null;humanHandoffAt?:string|null;requester?:Person|null;assignedTo?:Person|null;peer?:Person|null;lastMessage?:{body?:string|null;attachmentName?:string|null;createdAt:string}|null;unread?:boolean;slaMinutes?:number;slaBreached?:boolean};
type Msg={id:string;senderId:string;kind:'TEXT'|'FILE'|'AUDIO'|'SYSTEM';body?:string|null;attachmentName?:string|null;attachmentMime?:string|null;attachmentSize?:number|null;createdAt:string;sender?:Person|null};
type Attachment={name:string;mime:string;dataBase64:string;kind:'FILE'|'AUDIO';size:number};

const EMOJIS=['😀','😁','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳','🙂','😉','🤔','😅','😢','😭','😡','👍','👎','👏','🙌','🙏','🤝','💪','❤️','💚','💙','🔥','✨','🎯','📈','📊','✅','⚠️','🚀','💡'];

const presenceOptions: Array<{value:Exclude<PresenceStatus,'OFFLINE'>;label:string}>=[
  {value:'ONLINE',label:'Online'},
  {value:'WORKING',label:'Trabalhando'},
  {value:'BUSY',label:'Ocupado'},
  {value:'BREAK',label:'Em pausa'},
  {value:'AWAY',label:'Ausente'},
  {value:'DND',label:'Não perturbe'},
];

const presenceMeta=(status:PresenceStatus|string|undefined)=>{
  switch(status){
    case 'ONLINE':return{label:'Online',dot:'bg-emerald-500',text:'text-emerald-700',chip:'bg-emerald-50 border-emerald-200 text-emerald-700',active:true};
    case 'WORKING':return{label:'Trabalhando',dot:'bg-blue-500',text:'text-blue-700',chip:'bg-blue-50 border-blue-200 text-blue-700',active:true};
    case 'BUSY':return{label:'Ocupado',dot:'bg-amber-500',text:'text-amber-700',chip:'bg-amber-50 border-amber-200 text-amber-700',active:true};
    case 'BREAK':return{label:'Em pausa',dot:'bg-violet-500',text:'text-violet-700',chip:'bg-violet-50 border-violet-200 text-violet-700',active:false};
    case 'DND':return{label:'Não perturbe',dot:'bg-red-500',text:'text-red-700',chip:'bg-red-50 border-red-200 text-red-700',active:false};
    case 'AWAY':return{label:'Ausente',dot:'bg-orange-400',text:'text-orange-700',chip:'bg-orange-50 border-orange-200 text-orange-700',active:false};
    default:return{label:'Offline',dot:'bg-slate-300',text:'text-slate-500',chip:'bg-slate-50 border-slate-200 text-slate-500',active:false};
  }
};

const dt=(v:string)=>new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const time=(v:string)=>new Date(v).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
async function base64(blob:Blob){return await new Promise<string>((res,rej)=>{const r=new FileReader();r.onerror=()=>rej(r.error);r.onload=()=>res(String(r.result||'').split(',')[1]||'');r.readAsDataURL(blob);});}
const roleLabel=(role:string)=>role==='SUPER_ADMIN'||role==='AGENCY_ADMIN'?'Administrador':role==='MANAGER'?'Gestor':'Usuário';
const statusLabel=(status:string)=>status==='OPEN'?'Aberto':status==='PENDING'?'Aguardando':status==='RESOLVED'?'Resolvido':status==='CLOSED'?'Encerrado':status;
const priorityLabel=(priority:string)=>priority==='low'?'baixa':priority==='high'?'alta':priority==='urgent'?'urgente':'normal';
const initials=(name?:string|null)=>String(name||'?').trim().split(/\s+/).slice(0,2).map(v=>v[0]?.toUpperCase()).join('')||'?';

export default function SupportPro(){
 const user=useAuth(s=>s.user);
 const admin=['SUPER_ADMIN','AGENCY_ADMIN'].includes(user?.role||'');
 const[convs,setConvs]=useState<Conv[]>([]);
 const[msgs,setMsgs]=useState<Msg[]>([]);
 const[people,setPeople]=useState<Person[]>([]);
 const savedPresence=(localStorage.getItem('supportPresenceStatus')||'ONLINE') as PresenceStatus;
 const[ownStatus,setOwnStatus]=useState<Exclude<PresenceStatus,'OFFLINE'>>(presenceOptions.some(s=>s.value===savedPresence)?savedPresence as Exclude<PresenceStatus,'OFFLINE'>:'ONLINE');
 const[selectedId,setSelectedId]=useState('');
 const[filter,setFilter]=useState<'ALL'|'CHAT'|'TICKET'|'CONTACTS'>('ALL');
 const[search,setSearch]=useState('');
 const[messageSearch,setMessageSearch]=useState('');
 const[showMessageSearch,setShowMessageSearch]=useState(false);
 const[draft,setDraft]=useState('');
 const[attachments,setAttachments]=useState<Attachment[]>([]);
 const[error,setError]=useState('');
 const[sending,setSending]=useState(false);
 const[showNew,setShowNew]=useState(false);
 const[showEmoji,setShowEmoji]=useState(false);
 const[newType,setNewType]=useState<'CHAT'|'TICKET'>('CHAT');
 const[newRecipientId,setNewRecipientId]=useState('');
 const[newSubject,setNewSubject]=useState('');
 const[newPriority,setNewPriority]=useState('normal');
 const[newMessage,setNewMessage]=useState('');
 const[recording,setRecording]=useState(false);
 const[aiConfigured,setAiConfigured]=useState<boolean|null>(null);
 const[audioUrls,setAudioUrls]=useState<Record<string,string>>({});
 const recorder=useRef<MediaRecorder|null>(null);
 const chunks=useRef<Blob[]>([]);
 const bottom=useRef<HTMLDivElement|null>(null);
 const selected=convs.find(c=>c.id===selectedId)||null;

 async function loadAiStatus(){
  const r=await api.get('/ai/status').catch(()=>null);
  setAiConfigured(r?.data?.data?.configured===true);
 }

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

 async function heartbeat(statusOverride?:Exclude<PresenceStatus,'OFFLINE'>){
  const stored=(localStorage.getItem('supportPresenceStatus')||'ONLINE') as Exclude<PresenceStatus,'OFFLINE'>;
  const currentStatus=statusOverride||stored;
  await api.post('/support/presence',{status:currentStatus}).catch(()=>undefined);
  const r=await api.get('/support/presence').catch(()=>null);
  setPeople(Array.isArray(r?.data?.data)?r.data.data:[]);
 }

 async function changeOwnStatus(next:Exclude<PresenceStatus,'OFFLINE'>){
  setOwnStatus(next);
  localStorage.setItem('supportPresenceStatus',next);
  await heartbeat(next);
 }

 useEffect(()=>{
  void loadConvs();
  void heartbeat();
  void loadAiStatus();
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

 const availablePeople=useMemo(()=>people.filter(p=>p.id!==user?.id),[people,user?.id]);
 const visible=useMemo(()=>convs.filter(c=>(filter==='ALL'||(filter!=='CONTACTS'&&c.type===filter))&&(!search.trim()||[c.subject,c.peer?.name,c.peer?.email,c.requester?.name,c.requester?.email,c.lastMessage?.body].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())))),[convs,filter,search]);
 const visibleContacts=useMemo(()=>availablePeople.filter(p=>!search.trim()||[p.name,p.email,p.clientName,roleLabel(p.role)].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase()))),[availablePeople,search]);
 const visibleMessages=useMemo(()=>!messageSearch.trim()?msgs:msgs.filter(m=>[m.body,m.attachmentName,m.sender?.name].some(v=>String(v||'').toLowerCase().includes(messageSearch.toLowerCase()))),[msgs,messageSearch]);
 const presenceById=useMemo(()=>new Map(people.map(p=>[p.id,p.presenceStatus||'OFFLINE'] as const)),[people]);
 const selectedPresence=(selected?.peer?.id?presenceById.get(selected.peer.id):'OFFLINE') as PresenceStatus;

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

 async function choose(files?:FileList|null){
  if(!files?.length)return;
  setError('');
  const picked=Array.from(files).slice(0,5);
  const next:Attachment[]=[];
  for(const file of picked){
   if(file.size>8*1024*1024){setError(`${file.name}: máximo de 8 MB por arquivo.`);continue;}
   next.push({name:file.name,mime:file.type||'application/octet-stream',dataBase64:await base64(file),kind:'FILE',size:file.size});
  }
  setAttachments(current=>[...current,...next].slice(0,5));
 }

 async function toggleRecord(){
  if(recording){recorder.current?.stop();return;}
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const rec=new MediaRecorder(stream);
   chunks.current=[];
   rec.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};
   rec.onstop=async()=>{
    const blob=new Blob(chunks.current,{type:rec.mimeType||'audio/webm'});
    stream.getTracks().forEach(t=>t.stop());
    setRecording(false);
    if(blob.size>8*1024*1024){setError('Áudio acima de 8 MB.');return;}
    const encoded=await base64(blob);
    const audioAttachment:Attachment={name:`audio-${Date.now()}.webm`,mime:blob.type||'audio/webm',dataBase64:encoded,kind:'AUDIO',size:blob.size};
    setAttachments(current=>[...current,audioAttachment].slice(0,5));
   };
   recorder.current=rec;rec.start();setRecording(true);
  }catch{setError('Não foi possível acessar o microfone.');}
 }

 async function send(){
  if(!selected||(!draft.trim()&&!attachments.length))return;
  setSending(true);setError('');
  try{
   const text=draft.trim();
   if(!attachments.length){
    await api.post(`/support/conversations/${selected.id}/messages`,{body:text,kind:'TEXT'});
   }else{
    for(let i=0;i<attachments.length;i+=1){
     const item=attachments[i];
     await api.post(`/support/conversations/${selected.id}/messages`,{
      body:i===0&&text?text:undefined,
      kind:item.kind,
      attachment:{name:item.name,mime:item.mime,dataBase64:item.dataBase64},
     });
    }
   }
   setDraft('');setAttachments([]);setShowEmoji(false);
   await Promise.all([loadMsgs(selected.id),loadConvs()]);
  }catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível enviar.');}
  finally{setSending(false);}
 }

 async function open(m:Msg){
  try{
   const r=await api.get(`/support/messages/${m.id}/attachment`,{responseType:'blob'});
   const url=URL.createObjectURL(r.data);
   if(m.kind==='AUDIO')setAudioUrls(v=>({...v,[m.id]:url}));
   else{const a=document.createElement('a');a.href=url;a.download=m.attachmentName||'arquivo';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  }catch{setError('Não foi possível abrir o anexo.');}
 }

 async function update(values:any){
  if(!selected)return;
  try{await api.patch(`/support/conversations/${selected.id}`,values);await loadConvs();}
  catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível atualizar o chamado.');}
 }

 const selectedMeta=presenceMeta(selectedPresence);

 return <div className="h-[calc(100dvh-1.5rem)] min-h-[640px] lg:h-[calc(100vh-1.5rem)] lg:min-h-0">
  {error&&<div className="message-warning m-2">{error}</div>}

  <section className="h-full min-h-0 overflow-hidden bg-white">
   <div className="grid h-full min-h-0 lg:grid-cols-[360px_minmax(0,1fr)]">
    <aside className={`${selected?'hidden lg:flex':'flex'} h-full min-h-0 flex-col border-r border-[#d8dedb] bg-white`}>
     <div className="flex h-[62px] items-center justify-between bg-[#f0f2f5] px-4">
      <div className="flex min-w-0 items-center gap-3">
       <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#d9fdd3] text-[11px] font-bold text-[#176b50]">{initials(user?.name)}</div>
       <div className="min-w-0"><h2 className="truncate text-[16px] font-semibold text-[#111b21]">Conversas</h2><p className="truncate text-[9px] text-[#667781]">{roleLabel(user?.role||'')}</p></div>
      </div>
      <div className="flex items-center gap-1">
       <button className="grid h-9 w-9 place-items-center rounded-full text-[#54656f] hover:bg-[#e4e7e9]" title="Nova conversa" onClick={()=>setShowNew(true)}><Plus size={19}/></button>
       <button className="grid h-9 w-9 place-items-center rounded-full text-[#54656f] hover:bg-[#e4e7e9]" title="Opções"><MoreVertical size={19}/></button>
      </div>
     </div>

     <div className="border-b border-[#e9edef] bg-white px-3 py-2">
      <div className="flex items-center rounded-[9px] bg-[#f0f2f5] px-3">
       <Search size={15} className="shrink-0 text-[#54656f]"/>
       <input className="h-9 min-w-0 flex-1 border-0 bg-transparent px-3 text-[11px] outline-none placeholder:text-[#667781]" placeholder="Pesquisar ou começar uma nova conversa" value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
       {(['ALL','CHAT','TICKET'] as const).map(v=><button key={v} className={`rounded-full border px-3 py-1 text-[9px] font-medium ${filter===v?'border-[#c7e9db] bg-[#e7fce8] text-[#008069]':'border-[#e0e5e7] bg-white text-[#54656f] hover:bg-[#f5f6f6]'}`} onClick={()=>setFilter(v)}>{v==='ALL'?'Tudo':v==='CHAT'?'Conversas':'Chamados'}</button>)}
      </div>
     </div>

     <div className="premium-scrollbar flex-1 overflow-y-auto">
      {filter==='CONTACTS'?<>
       <div className="border-b border-[#e9edef] px-4 py-2"><p className="text-[9px] font-semibold uppercase tracking-wide text-[#008069]">Contatos internos</p><p className="mt-0.5 text-[8px] text-[#667781]">{admin?'Clientes e equipe autorizados na plataforma':'Administradores e usuários autorizados da sua empresa'}</p></div>
       {visibleContacts.map(p=>{const meta=presenceMeta(p.presenceStatus);return <button key={p.id} onClick={()=>{void openDirect(p);setFilter('ALL');}} className="flex w-full items-center gap-3 border-b border-[#f0f2f5] px-3 py-3 text-left transition hover:bg-[#f5f6f6]">
        <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#dfe5e7] text-[12px] font-semibold text-[#3b4a54]">{initials(p.name)}<span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${meta.dot}`}/></div>
        <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><strong className="truncate text-[12px] font-medium text-[#111b21]">{p.name}</strong><span className={`shrink-0 text-[8px] font-medium ${meta.text}`}>{meta.label}</span></div><p className="mt-0.5 truncate text-[9px] text-[#667781]">{roleLabel(p.role)}{p.clientName?` · ${p.clientName}`:''}</p><p className="mt-0.5 truncate text-[8px] text-[#8696a0]">{p.email}</p></div>
       </button>})}
       {!visibleContacts.length&&<div className="grid h-48 place-items-center px-6 text-center text-[10px] text-[#667781]">Nenhum contato interno encontrado.</div>}
      </>:<>
       {visible.map(c=>{
        const peerStatus=(c.peer?.id?presenceById.get(c.peer.id):'OFFLINE') as PresenceStatus;
        const meta=presenceMeta(peerStatus);
        const peerName=c.type==='CHAT'?(c.peer?.name||c.subject||'Atendimento'):c.subject||'Chamado';
        return <button key={c.id} onClick={()=>setSelectedId(c.id)} className={`flex w-full items-center gap-3 border-b border-[#f0f2f5] px-3 py-2.5 text-left transition ${selectedId===c.id?'bg-[#f0f2f5]':'hover:bg-[#f5f6f6]'}`}>
         <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#dfe5e7] text-[12px] font-semibold text-[#3b4a54]">
          {initials(peerName)}
          {c.type==='CHAT'&&<span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${meta.dot}`}/>}
         </div>
         <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><strong className="truncate text-[12px] font-medium text-[#111b21]">{peerName}</strong><span className={`shrink-0 text-[8px] ${c.unread?'font-semibold text-[#00a884]':'text-[#667781]'}`}>{time(c.lastMessageAt)}</span></div>
          <div className="mt-0.5 flex items-center gap-1.5"><p className="min-w-0 flex-1 truncate text-[9px] text-[#667781]">{c.lastMessage?.attachmentName?'📎 '+c.lastMessage.attachmentName:c.lastMessage?.body||c.peer?.email||'Conversa iniciada'}</p>{c.unread&&<span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#25d366] px-1 text-[8px] font-bold text-white">1</span>}</div>
          <div className="mt-1 flex items-center gap-1">{c.type==='CHAT'&&<span className={`text-[8px] font-medium ${meta.text}`}>{meta.label}</span>}{c.aiEnabled&&<span className="text-[8px] text-[#008069]">· IA ativa</span>}{c.humanHandoffAt&&<span className="text-[8px] text-amber-700">· Gestor solicitado</span>}</div>
         </div>
        </button>
       })}
       {!visible.length&&<div className="grid h-48 place-items-center px-6 text-center text-[10px] text-[#667781]">Nenhuma conversa encontrada.</div>}
      </>}
     </div>

     <div className="border-t border-[#e9edef] bg-[#f7f8f8] p-3">
      <label className="flex items-center justify-between gap-3 text-[9px] font-semibold text-[#54656f]">
       <span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${presenceMeta(ownStatus).dot}`}/>Meu status</span>
       <select className="rounded-[7px] border border-[#d8dedb] bg-white px-2 py-1.5 text-[9px] text-[#111b21] outline-none" value={ownStatus} onChange={e=>{void changeOwnStatus(e.target.value as Exclude<PresenceStatus,'OFFLINE'>);}}>
        {presenceOptions.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
       </select>
      </label>
     </div>
    </aside>

    <main className={`${selected?'flex':'hidden lg:flex'} min-h-[720px] min-w-0 flex-col bg-[#efeae2]`}>
     {selected?<>
      <header className="flex min-h-[62px] items-center justify-between gap-2 border-b border-[#d8dedb] bg-[#f0f2f5] px-3 sm:px-4">
       <div className="flex min-w-0 items-center gap-2.5">
        <button className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#54656f] hover:bg-[#e4e7e9] lg:hidden" onClick={()=>setSelectedId('')} title="Voltar"><ArrowLeft size={18}/></button>
        <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#dfe5e7] text-[11px] font-semibold text-[#3b4a54]">
         {initials(selected.type==='CHAT'?(selected.peer?.name||selected.subject):selected.subject)}
         {selected.type==='CHAT'&&<span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#f0f2f5] ${selectedMeta.dot}`}/>}
        </div>
        <div className="min-w-0">
         <div className="flex min-w-0 items-center gap-2"><h2 className="truncate text-[12px] font-medium text-[#111b21]">{selected.type==='CHAT'?(selected.peer?.name||selected.subject||'Atendimento'):selected.subject||'Chamado'}</h2>{selected.type==='CHAT'&&<span className={`hidden rounded-full border px-2 py-0.5 text-[8px] sm:inline-flex ${selectedMeta.chip}`}>{selectedMeta.label}</span>}</div>
         <p className="truncate text-[8px] text-[#667781]">{selected.type==='TICKET'?`Prioridade ${priorityLabel(selected.priority)} · ${statusLabel(selected.status)}`:selected.peer?.email||'Atendimento interno'}</p>
        </div>
       </div>
       <div className="flex items-center gap-1">
        {selected.type==='CHAT'&&<span className={`hidden items-center gap-1 rounded-full border px-2 py-1 text-[8px] md:inline-flex ${selected.aiEnabled?'border-emerald-200 bg-emerald-50 text-emerald-700':'border-slate-200 bg-white text-slate-500'}`}><Bot size={10}/>{selected.humanHandoffAt?'Gestor solicitado':selected.aiEnabled?'IA ativa':'Humano'}</span>}
        <button className={`grid h-9 w-9 place-items-center rounded-full text-[#54656f] hover:bg-[#e4e7e9] ${showMessageSearch?'bg-[#e4e7e9]':''}`} onClick={()=>setShowMessageSearch(v=>!v)} title="Pesquisar na conversa"><Search size={18}/></button>
        {admin&&selected.type==='CHAT'&&<button className="hidden rounded-full px-3 py-2 text-[9px] font-semibold text-[#008069] hover:bg-[#e4e7e9] sm:block" onClick={()=>{void update({aiEnabled:!selected.aiEnabled});}}>{selected.aiEnabled?'Assumir':'Reativar IA'}</button>}
        {admin&&selected.type==='TICKET'&&<button className="hidden rounded-full px-3 py-2 text-[9px] font-semibold text-[#008069] hover:bg-[#e4e7e9] sm:flex sm:items-center sm:gap-1" onClick={()=>{void update({assignToMe:true});}}><UserRoundCheck size={12}/>Assumir</button>}
        <button className="grid h-9 w-9 place-items-center rounded-full text-[#54656f] hover:bg-[#e4e7e9]" title="Opções"><MoreVertical size={18}/></button>
       </div>
      </header>

      {showMessageSearch&&<div className="border-b border-[#d8dedb] bg-white px-3 py-2"><div className="mx-auto flex max-w-xl items-center rounded-[8px] bg-[#f0f2f5] px-3"><Search size={14} className="text-[#54656f]"/><input autoFocus className="h-9 flex-1 bg-transparent px-3 text-[10px] outline-none" placeholder="Pesquisar mensagens" value={messageSearch} onChange={e=>setMessageSearch(e.target.value)}/><button onClick={()=>{setShowMessageSearch(false);setMessageSearch('');}} className="text-[#54656f]"><X size={15}/></button></div></div>}

      <div className="premium-scrollbar relative min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-8" style={{backgroundColor:'#efeae2',backgroundImage:'radial-gradient(circle at 10px 10px, rgba(100,90,80,.045) 1.2px, transparent 1.3px), radial-gradient(circle at 28px 24px, rgba(100,90,80,.035) 1px, transparent 1.1px)',backgroundSize:'38px 38px'}}>
       <div className="mx-auto flex max-w-[920px] flex-col gap-1.5">
        {visibleMessages.map(m=>{
         const mine=m.senderId===user?.id;
         const senderStatus=(m.sender?.id?presenceById.get(m.sender.id):'OFFLINE') as PresenceStatus;
         return <div key={m.id} className={`flex ${mine?'justify-end':'justify-start'}`}>
          <div className={`relative max-w-[86%] rounded-[8px] px-2.5 py-1.5 shadow-[0_1px_1px_rgba(11,20,26,.12)] sm:max-w-[72%] ${mine?'bg-[#d9fdd3]':'bg-white'}`}>
           {!mine&&m.sender?.name&&<div className="mb-0.5 flex items-center gap-1.5 text-[8px] font-semibold text-[#008069]"><span className={`h-1.5 w-1.5 rounded-full ${presenceMeta(senderStatus).dot}`}/>{m.sender.name}</div>}
           {m.body&&<p className="m-0 whitespace-pre-wrap pr-12 text-[11px] leading-[17px] text-[#111b21]">{m.body}</p>}
           {m.attachmentName&&m.kind!=='AUDIO'&&<button className="my-1 flex w-full min-w-[190px] items-center gap-2 rounded-[7px] bg-black/5 px-3 py-2 text-left text-[10px] font-medium text-[#111b21]" onClick={()=>{void open(m);}}><span className="grid h-8 w-8 place-items-center rounded-full bg-white/80 text-[#008069]"><FileText size={16}/></span><span className="min-w-0 flex-1 truncate">{m.attachmentName}</span></button>}
           {m.kind==='AUDIO'&&m.attachmentName&&<div className="my-1 min-w-[230px]"><button className="mb-1 flex items-center gap-2 text-[9px] font-semibold text-[#008069]" onClick={()=>{void open(m);}}><Headphones size={14}/>{audioUrls[m.id]?'Áudio carregado':'Carregar áudio'}</button>{audioUrls[m.id]&&<audio controls src={audioUrls[m.id]} className="h-8 max-w-full"/>}</div>}
           <div className={`mt-0.5 flex items-center justify-end gap-1 text-[7px] ${mine?'text-[#667781]':'text-[#8696a0]'}`}><span>{time(m.createdAt)}</span>{mine&&<CheckCheck size={12} className="text-[#53bdeb]"/>}</div>
          </div>
         </div>
        })}
        {!visibleMessages.length&&messageSearch&&<div className="mx-auto mt-20 rounded-full bg-white/80 px-4 py-2 text-[9px] text-[#667781]">Nenhuma mensagem encontrada.</div>}
        <div ref={bottom}/>
       </div>
      </div>

      <footer className="relative border-t border-[#d8dedb] bg-[#f0f2f5] px-2 py-2 sm:px-3">
       {attachments.length>0&&<div className="mx-auto mb-2 flex max-w-[920px] flex-wrap gap-2">{attachments.map((item,index)=><div key={item.name+index} className="flex max-w-[220px] items-center gap-2 rounded-[8px] bg-white px-2.5 py-1.5 text-[8px] text-[#3b4a54] shadow-sm"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#e7fce8] text-[#008069]">{item.kind==='AUDIO'?<Mic size={12}/>:<FileText size={12}/>}</span><span className="min-w-0 flex-1 truncate">{item.name}</span><button onClick={()=>setAttachments(current=>current.filter((_,i)=>i!==index))}><X size={12}/></button></div>)}</div>}
       {showEmoji&&<div className="absolute bottom-[66px] left-3 z-20 w-[280px] rounded-[10px] border border-[#d8dedb] bg-white p-2 shadow-xl"><div className="mb-2 flex items-center justify-between px-1"><strong className="text-[10px] text-[#111b21]">Emojis</strong><button onClick={()=>setShowEmoji(false)} className="text-[#667781]"><X size={14}/></button></div><div className="grid grid-cols-8 gap-1">{EMOJIS.map(emoji=><button key={emoji} className="grid h-8 w-8 place-items-center rounded-[6px] text-[18px] hover:bg-[#f0f2f5]" onClick={()=>setDraft(v=>v+emoji)}>{emoji}</button>)}</div></div>}
       <div className="mx-auto flex max-w-[920px] items-end gap-1.5">
        <button className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#54656f] hover:bg-[#e4e7e9] ${showEmoji?'bg-[#e4e7e9]':''}`} title="Emoji" onClick={()=>setShowEmoji(v=>!v)}><Smile size={22}/></button>
        <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full text-[#54656f] hover:bg-[#e4e7e9]" title="Anexar arquivos"><Paperclip size={21}/><input type="file" multiple className="hidden" onChange={e=>{void choose(e.target.files);e.target.value='';}}/></label>
        <div className="flex min-h-[42px] min-w-0 flex-1 items-end rounded-[9px] bg-white px-3 py-1.5">
         <textarea className="max-h-28 min-h-[28px] flex-1 resize-none border-0 bg-transparent py-1 text-[11px] leading-5 text-[#111b21] outline-none placeholder:text-[#667781]" placeholder="Digite uma mensagem" rows={1} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}}/>
        </div>
        {draft.trim()||attachments.length?<button className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#00a884] text-white hover:bg-[#008f72] disabled:opacity-50" title="Enviar" disabled={sending} onClick={()=>{void send();}}><Send size={18}/></button>:<button className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${recording?'bg-red-500 text-white':'text-[#54656f] hover:bg-[#e4e7e9]'}`} title={recording?'Parar gravação':'Gravar áudio'} onClick={()=>{void toggleRecord();}}>{recording?<Square size={16}/>:<Mic size={21}/>}</button>}
       </div>
       {recording&&<div className="mt-1 text-center text-[8px] font-medium text-red-600">● Gravando áudio… clique novamente para finalizar.</div>}
      </footer>
     </>:<div className="flex flex-1 flex-col items-center justify-center bg-[#f8f9fa] px-6 text-center"><div className="grid h-16 w-16 place-items-center rounded-full bg-[#d9fdd3] text-[#008069]"><MessageCircle size={30}/></div><h2 className="mt-4 text-[18px] font-light text-[#41525d]">Atendimento Gestão Ads</h2><p className="mt-2 max-w-md text-[10px] leading-5 text-[#667781]">Selecione uma conversa para responder clientes, enviar arquivos, emojis, áudio e acompanhar o atendimento em tempo real.</p><span className={`mt-4 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[8px] ${aiConfigured?'border-emerald-200 bg-emerald-50 text-emerald-700':'border-amber-200 bg-amber-50 text-amber-700'}`}><Bot size={10}/>{aiConfigured?'Assistente IA disponível':'IA aguardando configuração'}</span></div>}
    </main>
   </div>
  </section>

  {showNew&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"><form onSubmit={create} className="w-full max-w-lg rounded-[12px] bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold text-[#111b21]">Nova conversa</h2><button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#f0f2f5]" onClick={()=>setShowNew(false)}><X size={16}/></button></div><div className="mt-4 grid gap-3"><label className="field-label">Tipo<select className="field-control" value={newType} onChange={e=>{setNewType(e.target.value as any);setNewRecipientId('');}}><option value="CHAT">Conversa</option><option value="TICKET">Chamado</option></select></label>{newType==='CHAT'&&<label className="field-label">Conversar com<select className="field-control" value={newRecipientId} onChange={e=>setNewRecipientId(e.target.value)}><option value="">Atendimento / administrador</option>{availablePeople.map(p=>{const meta=presenceMeta(p.presenceStatus);return <option key={p.id} value={p.id}>{p.name} — {meta.label} — {roleLabel(p.role)}{p.clientName?` · ${p.clientName}`:''}</option>})}</select></label>}{newType==='TICKET'&&<><label className="field-label">Assunto<input className="field-control" value={newSubject} onChange={e=>setNewSubject(e.target.value)} minLength={3} required/></label><label className="field-label">Prioridade<select className="field-control" value={newPriority} onChange={e=>setNewPriority(e.target.value)}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label></>}<label className="field-label">Mensagem<textarea className="field-control" value={newMessage} onChange={e=>setNewMessage(e.target.value)} required={newType==='TICKET'||!newRecipientId} placeholder={newType==='CHAT'&&newRecipientId?'Opcional — você pode escrever depois de abrir a conversa.':'Digite a mensagem inicial'}/></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={()=>setShowNew(false)}>Cancelar</button><button className="primary-button" disabled={sending}><Plus size={13}/>{sending?'Criando':'Iniciar'}</button></div></form></div>}
 </div>;
}
