import { useEffect, useMemo, useState } from 'react';
import { Download, Monitor, Smartphone, Tablet, CheckCircle2 } from 'lucide-react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export default function PwaInstallCard() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [installing, setInstalling] = useState(false);
  const ios = useMemo(() => isIos(), []);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const installedHandler = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    setInstalling(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setPromptEvent(null);
    } finally {
      setInstalling(false);
    }
  }

  return <section className="corporate-card p-4">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 gap-3">
        <span className="metric-icon"><Smartphone size={15}/></span>
        <div className="min-w-0">
          <h2 className="panel-title">Aplicativo Gestão Ads</h2>
          <p className="panel-subtitle">A mesma ferramenta funciona em desktop, tablet e celular e pode ser instalada como aplicativo sem alterar seu login, dados ou permissões.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500">
            <span className="status-chip status-neutral"><Monitor size={11}/>Desktop</span>
            <span className="status-chip status-neutral"><Tablet size={11}/>Tablet</span>
            <span className="status-chip status-neutral"><Smartphone size={11}/>Mobile</span>
            <span className="status-chip status-success"><CheckCircle2 size={11}/>PWA instalável</span>
          </div>
        </div>
      </div>

      <div className="shrink-0">
        {installed
          ? <span className="status-chip status-success"><CheckCircle2 size={12}/>Aplicativo instalado</span>
          : promptEvent
            ? <button type="button" className="primary-button" onClick={() => { void install(); }} disabled={installing}><Download size={14}/>{installing ? 'Instalando...' : 'Instalar aplicativo'}</button>
            : <div className="max-w-[360px] text-[10px] leading-5 text-slate-500">
                {ios
                  ? 'No iPhone/iPad: abra no Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.'
                  : 'No Chrome ou Edge, use o ícone de instalação na barra de endereço ou o menu do navegador para instalar.'}
              </div>}
      </div>
    </div>
  </section>;
}
