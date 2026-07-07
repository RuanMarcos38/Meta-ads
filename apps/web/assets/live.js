(() => {
  const api = window.GestaoAdsAPI;
  const config = window.APP_CONFIG || {};
  const intervalMs = Number(config.LIVE_REFRESH_MS || 15000);
  let timer = null;
  let busy = false;

  function ensureWidget() {
    let widget = document.querySelector('[data-live-widget]');
    if (widget) return widget;
    widget = document.createElement('div');
    widget.setAttribute('data-live-widget', 'true');
    widget.style.cssText = [
      'position:fixed',
      'right:18px',
      'bottom:86px',
      'z-index:9999',
      'max-width:320px',
      'padding:12px 14px',
      'border-radius:16px',
      'background:rgba(7,17,31,.94)',
      'color:#fff',
      'font:12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
      'box-shadow:0 14px 40px rgba(0,0,0,.28)',
      'border:1px solid rgba(255,255,255,.12)'
    ].join(';');
    document.body.appendChild(widget);
    return widget;
  }

  function clientId() {
    try { return localStorage.getItem('gestaoAdsClient') || ''; } catch (_) { return ''; }
  }

  function logged() {
    return Boolean(api && api.getToken && api.getToken());
  }

  function render(status, data) {
    const widget = ensureWidget();
    const ok = status === 'online';
    const dot = ok ? '#22c55e' : status === 'waiting' ? '#f59e0b' : '#ef4444';
    const title = ok ? 'Online ao vivo' : status === 'waiting' ? 'Aguardando login' : 'Conexao instavel';
    const detail = ok
      ? `${data?.counts?.adAccounts || 0} conta(s) | ${data?.counts?.integrations || 0} integracao(oes)`
      : data?.message || 'Verifique API, login ou banco de dados.';
    const updated = ok && data?.serverTime ? new Date(data.serverTime).toLocaleTimeString('pt-BR') : '--:--';
    widget.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span style="width:10px;height:10px;border-radius:999px;background:${dot};box-shadow:0 0 0 4px rgba(255,255,255,.08);margin-top:4px"></span>
        <div>
          <strong style="display:block;font-size:13px;margin-bottom:2px">${title}</strong>
          <span style="display:block;color:rgba(255,255,255,.78)">${detail}</span>
          <small style="display:block;color:rgba(255,255,255,.55);margin-top:4px">Atualizado: ${updated}</small>
        </div>
      </div>`;
  }

  async function tick() {
    if (busy) return;
    if (!logged()) {
      render('waiting', { message: 'Entre no painel para iniciar o acompanhamento.' });
      return;
    }
    busy = true;
    try {
      const params = new URLSearchParams();
      const selectedClientId = clientId();
      if (selectedClientId) params.set('clientId', selectedClientId);
      const data = await api.request(`/dashboard/live${params.toString() ? `?${params.toString()}` : ''}`);
      render('online', data);
    } catch (error) {
      render('offline', { message: error.message || 'Nao foi possivel consultar status ao vivo.' });
    } finally {
      busy = false;
    }
  }

  function start() {
    if (!api || !api.request) return;
    if (timer) clearInterval(timer);
    tick();
    timer = setInterval(tick, intervalMs);
  }

  window.addEventListener('storage', start);
  window.addEventListener('focus', tick);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
