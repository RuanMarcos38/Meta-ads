import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  FileText,
  Headphones,
  MessageCircle,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Square,
  TicketCheck,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../store';

type Person = { id: string; name: string; email: string; role: string; clientId?: string | null; lastSeenAt?: string };
type Conversation = {
  id: string;
  clientId?: string | null;
  createdById: string;
  assignedToId?: string | null;
  type: 'CHAT' | 'TICKET';
  status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  subject?: string | null;
  priority: string;
  lastMessageAt: string;
  requester?: Person | null;
  assignedTo?: Person | null;
  lastMessage?: { id: string; senderId: string; kind: string; body?: string | null; attachmentName?: string | null; createdAt: string } | null;
};
type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: 'TEXT' | 'FILE' | 'AUDIO' | 'SYSTEM';
  body?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentSize?: number | null;
  createdAt: string;
  sender?: Person | null;
};
type PendingAttachment = { name: string; mime: string; dataBase64: string; size: number; kind: 'FILE' | 'AUDIO' };

const statusLabel: Record<string, string> = { OPEN: 'Aberto', PENDING: 'Aguardando', RESOLVED: 'Resolvido', CLOSED: 'Encerrado' };
const priorityLabel: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const dateTime = (value: string) => new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function toBase64(file: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

export default function Support() {
  const user = useAuth((state) => state.user);
  const isAdmin = ['SUPER_ADMIN', 'AGENCY_ADMIN'].includes(user?.role || '');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [online, setOnline] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'CHAT' | 'TICKET'>('ALL');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newType, setNewType] = useState<'CHAT' | 'TICKET'>('CHAT');
  const [newSubject, setNewSubject] = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [newMessage, setNewMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selected = conversations.find((item) => item.id === selectedId) || null;

  async function loadConversations(silent = false) {
    if (!silent) setLoading(true);
    try {
      const response = await api.get('/support/conversations');
      const rows = Array.isArray(response.data?.data) ? response.data.data as Conversation[] : [];
      setConversations(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].id);
      if (selectedId && !rows.some((item) => item.id === selectedId)) setSelectedId(rows[0]?.id || '');
      setError('');
    } catch (requestError: any) {
      if (!silent) setError(requestError?.response?.data?.message || 'Não foi possível carregar o atendimento interno.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadMessages(conversationId: string, silent = false) {
    if (!conversationId) return;
    try {
      const response = await api.get(`/support/conversations/${conversationId}/messages`);
      setMessages(Array.isArray(response.data?.data) ? response.data.data : []);
      if (!silent) window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (requestError: any) {
      if (!silent) setError(requestError?.response?.data?.message || 'Não foi possível carregar as mensagens.');
    }
  }

  async function heartbeat() {
    await api.post('/support/presence').catch(() => undefined);
    try {
      const response = await api.get('/support/presence');
      setOnline(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch {
      setOnline([]);
    }
  }

  useEffect(() => {
    void Promise.all([loadConversations(), heartbeat()]);
    const conversationsTimer = window.setInterval(() => { void loadConversations(true); }, 5000);
    const presenceTimer = window.setInterval(() => { void heartbeat(); }, 25000);
    return () => {
      window.clearInterval(conversationsTimer);
      window.clearInterval(presenceTimer);
      Object.values(audioUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId);
    const timer = window.setInterval(() => { void loadMessages(selectedId, true); }, 2200);
    return () => window.clearInterval(timer);
  }, [selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const visibleConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    return conversations.filter((item) => {
      if (filter !== 'ALL' && item.type !== filter) return false;
      if (!term) return true;
      return [item.subject, item.requester?.name, item.requester?.email, item.lastMessage?.body]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }, [conversations, filter, search]);

  async function createConversation(event: React.FormEvent) {
    event.preventDefault();
    if (!newMessage.trim() || (newType === 'TICKET' && newSubject.trim().length < 3)) return;
    setSending(true);
    setError('');
    try {
      const response = await api.post('/support/conversations', {
        type: newType,
        ...(newType === 'TICKET' ? { subject: newSubject.trim(), priority: newPriority } : {}),
        message: newMessage.trim(),
      });
      setShowNew(false);
      setNewSubject('');
      setNewMessage('');
      setNewPriority('normal');
      await loadConversations(true);
      if (response.data?.data?.id) setSelectedId(response.data.data.id);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível iniciar o atendimento.');
    } finally {
      setSending(false);
    }
  }

  async function pickFile(file?: File) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError('O arquivo deve ter no máximo 8 MB.');
      return;
    }
    const dataBase64 = await toBase64(file);
    setAttachment({ name: file.name, mime: file.type || 'application/octet-stream', dataBase64, size: file.size, kind: 'FILE' });
  }

  async function sendMessage() {
    if (!selected || sending || (!draft.trim() && !attachment)) return;
    setSending(true);
    setError('');
    try {
      await api.post(`/support/conversations/${selected.id}/messages`, {
        body: draft.trim() || undefined,
        kind: attachment?.kind || 'TEXT',
        ...(attachment ? { attachment: { name: attachment.name, mime: attachment.mime, dataBase64: attachment.dataBase64 } } : {}),
      });
      setDraft('');
      setAttachment(null);
      await Promise.all([loadMessages(selected.id, true), loadConversations(true)]);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('A gravação de áudio não está disponível neste navegador.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        if (blob.size > 8 * 1024 * 1024) {
          setError('O áudio ultrapassou o limite de 8 MB. Grave uma mensagem menor.');
          return;
        }
        const dataBase64 = await toBase64(blob);
        setAttachment({ name: `audio-${Date.now()}.webm`, mime: blob.type || 'audio/webm', dataBase64, size: blob.size, kind: 'AUDIO' });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
    }
  }

  async function openAttachment(message: Message) {
    try {
      const response = await api.get(`/support/messages/${message.id}/attachment`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      if (message.kind === 'AUDIO') {
        setAudioUrls((current) => ({ ...current, [message.id]: url }));
      } else {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = message.attachmentName || 'arquivo';
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch {
      setError('Não foi possível abrir o arquivo desta mensagem.');
    }
  }

  async function updateConversation(values: Record<string, unknown>) {
    if (!selected) return;
    try {
      await api.patch(`/support/conversations/${selected.id}`, values);
      await loadConversations(true);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || 'Não foi possível atualizar o atendimento.');
    }
  }

  return (
    <div className="space-y-4">
      <section className="flex flex-col gap-3 rounded-[10px] border border-[#dfe4e1] bg-white px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-[#176846]">Comunicação interna</p>
          <h1 className="mt-1 text-[25px] font-semibold tracking-[-0.03em] text-[#17221c]">Atendimento e chamados</h1>
          <p className="mt-1 text-[11px] text-slate-500">Conversas privadas entre usuários e administradores, com arquivos, áudio e histórico do atendimento.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-[8px] border border-[#dfe5e1] bg-[#fafbfa] px-3 py-2 text-[10px] text-slate-500"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><Circle size={8} fill="#16a36a" className="text-emerald-600" /> {online.length} online</span><span className="ml-2">{isAdmin ? 'equipe e usuários' : 'equipe disponível'}</span></div>
          <button type="button" onClick={() => setShowNew(true)} className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#176846] px-3.5 text-[11px] font-semibold text-white hover:bg-[#12563a]"><Plus size={14} /> Novo atendimento</button>
        </div>
      </section>

      {error && <p className="rounded-[8px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[11px] text-red-700">{error}</p>}

      <section className="grid min-h-[610px] overflow-hidden rounded-[10px] border border-[#dfe4e1] bg-white lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="border-b border-[#e5e9e6] bg-[#fafbfa] lg:border-b-0 lg:border-r">
          <div className="border-b border-[#e5e9e6] p-3.5">
            <label className="relative block"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar atendimento" className="h-9 w-full rounded-[7px] border border-[#d9dfdb] bg-white pl-9 pr-3 text-[11px] outline-none" /></label>
            <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-[7px] bg-[#eef2ef] p-1">
              {([['ALL', 'Todos'], ['CHAT', 'Conversas'], ['TICKET', 'Chamados']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-[5px] px-2 py-1.5 text-[10px] font-semibold ${filter === value ? 'bg-white text-[#176846] shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
            </div>
          </div>
          <div className="premium-scrollbar max-h-[540px] overflow-y-auto">
            {visibleConversations.map((conversation) => {
              const active = conversation.id === selectedId;
              return <button key={conversation.id} type="button" onClick={() => setSelectedId(conversation.id)} className={`block w-full border-b border-[#edf0ee] px-3.5 py-3 text-left transition-colors ${active ? 'bg-[#edf5f0]' : 'hover:bg-white'}`}>
                <div className="flex items-start justify-between gap-2"><p className="truncate text-[11px] font-semibold text-[#17251c]">{conversation.type === 'TICKET' ? conversation.subject || 'Chamado' : conversation.requester?.name || 'Conversa interna'}</p><span className="shrink-0 text-[9px] text-slate-400">{dateTime(conversation.lastMessageAt)}</span></div>
                <div className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-500">{conversation.type === 'TICKET' ? <TicketCheck size={11} /> : <MessageCircle size={11} />}<span>{conversation.type === 'TICKET' ? `Chamado · ${priorityLabel[conversation.priority] || conversation.priority}` : conversation.requester?.email || 'Atendimento'}</span><span>·</span><span>{statusLabel[conversation.status]}</span></div>
                <p className="mt-1.5 truncate text-[10px] text-slate-400">{conversation.lastMessage?.body || conversation.lastMessage?.attachmentName || 'Sem mensagem'}</p>
              </button>;
            })}
            {!loading && !visibleConversations.length && <p className="p-5 text-center text-[11px] text-slate-400">Nenhum atendimento encontrado.</p>}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          {!selected ? <div className="grid flex-1 place-items-center p-10 text-center"><div><MessageCircle className="mx-auto text-slate-300" size={34} /><h2 className="mt-3 text-[14px] font-semibold text-slate-700">Selecione uma conversa</h2><p className="mt-1 text-[11px] text-slate-400">Ou abra um novo atendimento para falar com a equipe.</p></div></div> : <>
            <header className="flex flex-col gap-2 border-b border-[#e5e9e6] px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-[13px] font-semibold text-[#17251c]">{selected.type === 'TICKET' ? selected.subject : selected.requester?.name || 'Conversa interna'}</h2><span className="rounded-[5px] bg-[#f0f3f1] px-2 py-1 text-[9px] font-semibold text-slate-600">{statusLabel[selected.status]}</span></div><p className="mt-0.5 text-[10px] text-slate-400">{selected.type === 'TICKET' ? `${priorityLabel[selected.priority] || selected.priority} prioridade · ${selected.requester?.email || ''}` : selected.requester?.email || 'Atendimento interno'}</p></div>
              <div className="flex flex-wrap items-center gap-1.5">{isAdmin && !selected.assignedToId && <button onClick={() => { void updateConversation({ assignToMe: true }); }} className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-[#d7dfda] px-2.5 text-[10px] font-semibold text-slate-600"><UserRoundCheck size={12} /> Assumir</button>}{isAdmin && <select value={selected.status} onChange={(event) => { void updateConversation({ status: event.target.value }); }} className="h-8 rounded-[6px] border border-[#d7dfda] bg-white px-2 text-[10px] outline-none"><option value="OPEN">Aberto</option><option value="PENDING">Aguardando</option><option value="RESOLVED">Resolvido</option><option value="CLOSED">Encerrado</option></select>}{!isAdmin && selected.status !== 'CLOSED' && <button onClick={() => { void updateConversation({ status: 'CLOSED' }); }} className="h-8 rounded-[6px] border border-[#d7dfda] px-2.5 text-[10px] font-semibold text-slate-500">Encerrar</button>}</div>
            </header>

            <div className="premium-scrollbar flex-1 space-y-2.5 overflow-y-auto bg-[#f6f8f6] px-4 py-4" style={{ minHeight: 390, maxHeight: 470 }}>
              {messages.map((message) => {
                const mine = message.senderId === user?.id;
                return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[78%] rounded-[9px] border px-3 py-2 ${mine ? 'border-[#cfe1d6] bg-[#eaf4ee]' : 'border-[#dde3df] bg-white'}`}><div className="mb-1 flex items-center justify-between gap-4"><span className="text-[9px] font-semibold text-slate-500">{mine ? 'Você' : message.sender?.name || 'Atendimento'}</span><span className="text-[8px] text-slate-400">{dateTime(message.createdAt)}</span></div>{message.body && <p className="whitespace-pre-wrap text-[11px] leading-5 text-slate-700">{message.body}</p>}{message.attachmentName && <div className="mt-1.5">{message.kind === 'AUDIO' && audioUrls[message.id] ? <audio controls src={audioUrls[message.id]} className="h-8 max-w-full" /> : <button onClick={() => { void openAttachment(message); }} className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#d6dfd9] bg-white px-2.5 py-1.5 text-[9px] font-semibold text-[#176846]">{message.kind === 'AUDIO' ? <Headphones size={12} /> : <FileText size={12} />}{message.kind === 'AUDIO' ? 'Ouvir áudio' : message.attachmentName}</button>}</div>}</div></div>;
              })}
              <div ref={bottomRef} />
            </div>

            <footer className="border-t border-[#e5e9e6] bg-white p-3">
              {attachment && <div className="mb-2 flex items-center justify-between rounded-[7px] border border-[#dce4df] bg-[#f7f9f7] px-3 py-2 text-[10px]"><span className="flex min-w-0 items-center gap-2">{attachment.kind === 'AUDIO' ? <Mic size={12} /> : <Paperclip size={12} />}<span className="truncate">{attachment.name}</span><span className="text-slate-400">{Math.ceil(attachment.size / 1024)} KB</span></span><button onClick={() => setAttachment(null)} className="text-slate-400"><X size={13} /></button></div>}
              <div className="flex items-end gap-2"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} disabled={selected.status === 'CLOSED'} rows={2} placeholder={selected.status === 'CLOSED' ? 'Atendimento encerrado' : 'Digite uma mensagem...'} className="min-h-[42px] flex-1 resize-none rounded-[7px] border border-[#d7dfda] bg-white px-3 py-2 text-[11px] leading-5 outline-none disabled:bg-slate-50" /><label className="grid h-10 w-10 cursor-pointer place-items-center rounded-[7px] border border-[#d7dfda] text-slate-500 hover:bg-[#f5f7f5]"><Paperclip size={15} /><input type="file" className="hidden" disabled={selected.status === 'CLOSED'} onChange={(event) => { void pickFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label><button type="button" onClick={() => { void toggleRecording(); }} disabled={selected.status === 'CLOSED'} className={`grid h-10 w-10 place-items-center rounded-[7px] border ${recording ? 'border-red-300 bg-red-50 text-red-600' : 'border-[#d7dfda] text-slate-500 hover:bg-[#f5f7f5]'}`}>{recording ? <Square size={14} fill="currentColor" /> : <Mic size={15} />}</button><button type="button" onClick={() => { void sendMessage(); }} disabled={sending || selected.status === 'CLOSED' || (!draft.trim() && !attachment)} className="grid h-10 w-10 place-items-center rounded-[7px] bg-[#176846] text-white hover:bg-[#12563a] disabled:opacity-40"><Send size={15} /></button></div>
            </footer>
          </>}
        </div>
      </section>

      {showNew && <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4"><form onSubmit={createConversation} className="w-full max-w-md rounded-[10px] border border-[#dfe4e1] bg-white p-5 shadow-xl"><div className="flex items-start justify-between"><div><h2 className="text-[15px] font-semibold text-[#17251c]">Novo atendimento</h2><p className="mt-1 text-[10px] text-slate-500">Abra uma conversa rápida ou um chamado com acompanhamento.</p></div><button type="button" onClick={() => setShowNew(false)} className="text-slate-400"><X size={17} /></button></div><div className="mt-4 grid grid-cols-2 gap-2">{(['CHAT', 'TICKET'] as const).map((type) => <button key={type} type="button" onClick={() => setNewType(type)} className={`rounded-[7px] border px-3 py-2.5 text-[11px] font-semibold ${newType === type ? 'border-[#7fae95] bg-[#eef6f1] text-[#176846]' : 'border-[#dce2de] text-slate-500'}`}>{type === 'CHAT' ? 'Conversa' : 'Chamado'}</button>)}</div>{newType === 'TICKET' && <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]"><label className="text-[10px] font-semibold text-slate-500">Assunto<input required minLength={3} value={newSubject} onChange={(event) => setNewSubject(event.target.value)} className="mt-1 h-9 w-full rounded-[7px] border border-[#d7dfda] px-3 text-[11px] outline-none" /></label><label className="text-[10px] font-semibold text-slate-500">Prioridade<select value={newPriority} onChange={(event) => setNewPriority(event.target.value)} className="mt-1 h-9 w-full rounded-[7px] border border-[#d7dfda] bg-white px-2 text-[11px]"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label></div>}<label className="mt-3 block text-[10px] font-semibold text-slate-500">Mensagem<textarea required value={newMessage} onChange={(event) => setNewMessage(event.target.value)} rows={4} className="mt-1 w-full resize-none rounded-[7px] border border-[#d7dfda] px-3 py-2 text-[11px] leading-5 outline-none" placeholder="Descreva sua solicitação..." /></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setShowNew(false)} className="h-9 rounded-[7px] border border-[#d7dfda] px-3 text-[11px] font-semibold text-slate-500">Cancelar</button><button disabled={sending} className="inline-flex h-9 items-center gap-2 rounded-[7px] bg-[#176846] px-4 text-[11px] font-semibold text-white disabled:opacity-50">{newType === 'TICKET' ? <TicketCheck size={13} /> : <MessageCircle size={13} />}{sending ? 'Abrindo...' : newType === 'TICKET' ? 'Abrir chamado' : 'Iniciar conversa'}</button></div></form></div>}
    </div>
  );
}
