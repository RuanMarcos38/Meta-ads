import { useEffect, useState } from 'react';
import { CalendarRange, Download, FileSpreadsheet, FileText, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useScope } from '../store';

type Report = { id:string; title:string; clientId:string; businessId?:string|null; adAccountId?:string|null; periodStart:string; periodEnd:string; summaryText?:string|null; createdAt:string; status:string };
const today = () => new Date().toISOString().slice(0,10);
const ago = (d:number) => { const x = new Date(); x.setDate(x.getDate()-d); return x.toISOString().slice(0,10); };

export default function Reports() {
  const scope = useScope();
  const [rows,setRows] = useState<Report[]>([]);
  const [title,setTitle] = useState('Relatório de desempenho');
  const [since,setSince] = useState(ago(29));
  const [until,setUntil] = useState(today());
  const [loading,setLoading] = useState(false);
  const [saving,setSaving] = useState(false);
  const [downloading,setDownloading] = useState('');
  const [error,setError] = useState('');

  async function load() { if (!scope.clientId) return; setLoading(true); try { const r = await api.get('/workspace/reports',{params:{clientId:scope.clientId,...(scope.businessId?{businessId:scope.businessId}:{})}}); setRows(Array.isArray(r.data?.data)?r.data.data:[]); } catch(e:any){setError(e?.response?.data?.error?.message||'Não foi possível carregar os relatórios.');} finally{setLoading(false);} }
  useEffect(()=>{void load();},[scope.clientId,scope.businessId]);

  async function create(e:React.FormEvent){e.preventDefault();if(!scope.clientId)return;setSaving(true);setError('');try{await api.post('/workspace/reports',{clientId:scope.clientId,...(scope.businessId?{businessId:scope.businessId}:{}),...(scope.adAccountId?{adAccountId:scope.adAccountId}:{}),title,since,until});await load();}catch(err:any){setError(err?.response?.data?.error?.message||'Não foi possível gerar o relatório.');}finally{setSaving(false);}}
  async function download(row:Report,format:'pdf'|'csv'|'xlsx'){setDownloading(`${row.id}-${format}`);try{const r=await api.get(`/workspace/reports/${row.id}/export`,{params:{format},responseType:'blob',timeout:120000});const url=URL.createObjectURL(r.data);const a=document.createElement('a');a.href=url;a.download=`${row.title.replace(/[^a-z0-9]+/gi,'-')}.${format}`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}catch(e:any){setError('Não foi possível baixar este relatório.');}finally{setDownloading('');}}

  return <div className="space-y-4"><section className="page-heading"><div><p className="section-kicker">Documentação</p><h1>Relatórios</h1><p>Gere relatórios separados por empresa, BM, conta e período, com exportação em PDF, Excel e CSV.</p></div><button className="secondary-button" onClick={()=>{void load();}} disabled={loading}><RefreshCw size={14} className={loading?'animate-spin':''}/>Atualizar</button></section>{error&&<div className="message-warning">{error}</div>}<form onSubmit={create} className="filter-panel"><div className="grid gap-3 md:grid-cols-4 md:items-end"><label className="field-label md:col-span-2">Título<input className="field-control" value={title} onChange={e=>setTitle(e.target.value)} required minLength={3}/></label><label className="field-label"><span><CalendarRange size={12}/> Data inicial</span><input className="field-control" type="date" value={since} onChange={e=>setSince(e.target.value)} max={until}/></label><label className="field-label"><span><CalendarRange size={12}/> Data final</span><input className="field-control" type="date" value={until} onChange={e=>setUntil(e.target.value)} min={since} max={today()}/></label></div><div className="mt-3 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-500">O relatório usa exatamente o escopo selecionado no topo: Empresa → BM → Conta.</span><button className="primary-button" disabled={saving||!scope.clientId}><Plus size={14}/>{saving?'Gerando':'Salvar relatório'}</button></div></form><section className="corporate-card overflow-hidden"><div className="table-scroll"><table className="corporate-table"><thead><tr><th>Relatório</th><th>Período</th><th>Resumo</th><th>Gerado em</th><th>Exportar</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.title}</strong><small>{row.status}</small></td><td>{new Date(row.periodStart).toLocaleDateString('pt-BR')} a {new Date(row.periodEnd).toLocaleDateString('pt-BR')}</td><td className="max-w-[420px] whitespace-normal">{row.summaryText||'—'}</td><td>{new Date(row.createdAt).toLocaleString('pt-BR')}</td><td><div className="flex gap-1"><button className="icon-button" title="PDF" onClick={()=>{void download(row,'pdf');}} disabled={downloading===`${row.id}-pdf`}><FileText size={14}/></button><button className="icon-button" title="Excel" onClick={()=>{void download(row,'xlsx');}} disabled={downloading===`${row.id}-xlsx`}><FileSpreadsheet size={14}/></button><button className="icon-button" title="CSV" onClick={()=>{void download(row,'csv');}} disabled={downloading===`${row.id}-csv`}><Download size={14}/></button></div></td></tr>)}{!rows.length&&!loading&&<tr><td colSpan={5}><div className="empty-state"><FileText size={20}/><span>Nenhum relatório salvo neste escopo.</span></div></td></tr>}</tbody></table></div></section></div>;
}
