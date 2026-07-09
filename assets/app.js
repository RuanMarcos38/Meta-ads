(() => {
  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById('app');
  const demoData = {
    source: 'demo',
    status: 'bom',
    summary: { investment: 1603.20, leads: 151, cpl: 10.62, impressions: 58776, reach: 26618, frequency: 2.21, cpm: 27.28, clicks: 1894, ctr: 3.22, cpc: 0.85, roas: 0 },
    insight: 'As campanhas estão mantendo bom volume de conversas com custo médio controlado. O próximo passo recomendado é separar os criativos com maior CTR e reforçar o orçamento nos anúncios que geram conversas mais qualificadas.',
    daily: [{ label: '01/07', leads: 18 }, { label: '02/07', leads: 22 }, { label: '03/07', leads: 24 }, { label: '04/07', leads: 27 }, { label: '05/07', leads: 30 }, { label: '06/07', leads: 30 }],
    campaigns: [
      { name: 'Campanha Conversas WhatsApp', channel: 'Meta Ads', spend: 842.40, leads: 86, cpl: 9.79, status: 'Ativa' },
      { name: 'Remarketing Clientes Engajados', channel: 'Meta Ads', spend: 315.90, leads: 35, cpl: 9.03, status: 'Ativa' },
      { name: 'Criativo Oferta Principal', channel: 'Meta Ads', spend: 444.90, leads: 30, cpl: 14.83, status: 'Atenção' }
    ]
  };

  let state = {
    token: localStorage.getItem('gestao_ads_token') || '',
    user: JSON.parse(localStorage.getItem('gestao_ads_user') || 'null'),
    demo: localStorage.getItem('gestao_ads_demo') === '1'
  };

  const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const number = (v) => Number(v || 0).toLocaleString('pt-BR');
  const percent = (v) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  async function request(path, options = {}) {
    const base = (cfg.API_BASE_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('API_BASE_URL não configurada.');
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) }
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) throw new Error(payload?.message || payload?.error || `Erro HTTP ${response.status}`);
    return payload;
  }

  function normalizeDashboard(payload) {
    const data = payload?.data || payload?.dashboard || payload || {};
    return {
      source: 'api',
      status: data.status || data.health || 'bom',
      summary: {
        investment: data.investment ?? data.spend ?? data.totalSpend ?? data.summary?.investment ?? demoData.summary.investment,
        leads: data.leads ?? data.conversations ?? data.summary?.leads ?? demoData.summary.leads,
        cpl: data.cpl ?? data.costPerLead ?? data.summary?.cpl ?? demoData.summary.cpl,
        impressions: data.impressions ?? data.summary?.impressions ?? demoData.summary.impressions,
        reach: data.reach ?? data.summary?.reach ?? demoData.summary.reach,
        frequency: data.frequency ?? data.summary?.frequency ?? demoData.summary.frequency,
        cpm: data.cpm ?? data.summary?.cpm ?? demoData.summary.cpm,
        clicks: data.clicks ?? data.summary?.clicks ?? demoData.summary.clicks,
        ctr: data.ctr ?? data.summary?.ctr ?? demoData.summary.ctr,
        cpc: data.cpc ?? data.summary?.cpc ?? demoData.summary.cpc,
        roas: data.roas ?? data.summary?.roas ?? demoData.summary.roas
      },
      insight: data.insight || data.executiveSummary || demoData.insight,
      daily: data.daily || data.evolution || demoData.daily,
      campaigns: data.campaigns || data.topCampaigns || demoData.campaigns
    };
  }

  async function login(email, password) {
    if (cfg.DEMO_MODE) return enterDemo(email);
    const paths = ['/auth/login', '/login', '/sessions'];
    let lastError;
    for (const path of paths) {
      try {
        const payload = await request(path, { method: 'POST', body: JSON.stringify({ email, password }) });
        const token = payload?.token || payload?.accessToken || payload?.access_token || payload?.data?.token || payload?.data?.accessToken;
        if (!token) throw new Error('A API não retornou token.');
        state.token = token;
        state.user = payload?.user || payload?.data?.user || { email };
        state.demo = false;
        localStorage.setItem('gestao_ads_token', token);
        localStorage.setItem('gestao_ads_user', JSON.stringify(state.user));
        localStorage.removeItem('gestao_ads_demo');
        return loadDashboard();
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Não foi possível autenticar na API.');
  }

  function enterDemo(email = 'admin@r2rmarketingdigital.com.br') {
    state.demo = true;
    state.user = { name: 'Administrador', email };
    localStorage.setItem('gestao_ads_demo', '1');
    localStorage.setItem('gestao_ads_user', JSON.stringify(state.user));
    renderDashboard(demoData);
  }

  async function loadDashboard() {
    if (state.demo || cfg.DEMO_MODE) return renderDashboard(demoData);
    const paths = ['/dashboard', '/dashboard/summary', '/metrics/dashboard'];
    let lastError;
    for (const path of paths) {
      try { return renderDashboard(normalizeDashboard(await request(path))); }
      catch (error) { lastError = error; }
    }
    renderDashboard({ ...demoData, source: 'fallback', insight: `Login conectado, mas o dashboard não retornou dados. Último erro: ${lastError?.message || 'endpoint indisponível'}.` });
  }

  function logout() {
    state = { token: '', user: null, demo: false };
    localStorage.removeItem('gestao_ads_token');
    localStorage.removeItem('gestao_ads_user');
    localStorage.removeItem('gestao_ads_demo');
    renderLogin();
  }

  function renderLogin(message = '') {
    const email = cfg.DEFAULT_LOGIN?.email || 'admin@r2rmarketingdigital.com.br';
    const pass = cfg.DEFAULT_LOGIN?.password || '';
    app.innerHTML = `<main class="login-shell"><section class="login-card"><div class="login-hero"><span class="badge">Painel do cliente • Meta Ads</span><h1>Gestão Ads</h1><p>Dashboard profissional para clientes acompanharem investimento, conversas, campanhas e indicadores de performance sem depender de prints ou relatórios manuais.</p><div class="hero-metrics"><div class="hero-metric"><strong>151</strong><span>conversas iniciadas</span></div><div class="hero-metric"><strong>R$ 10,62</strong><span>custo médio</span></div><div class="hero-metric"><strong>58.776</strong><span>impressões</span></div></div></div><form class="login-form" id="loginForm"><div class="logo"><div class="logo-mark">R2R</div><div class="logo-text"><strong>${esc(cfg.COMPANY_NAME || 'R2R Marketing Digital')}</strong><span>${esc(cfg.APP_NAME || 'Gestão Ads')}</span></div></div><h2 class="form-title">Acessar painel</h2><div class="field"><label for="email">E-mail</label><input id="email" type="email" autocomplete="email" value="${esc(email)}" required></div><div class="field"><label for="password">Senha</label><input id="password" type="password" autocomplete="current-password" value="${esc(pass)}" required></div><div class="actions"><button class="btn" type="submit">Entrar no painel</button><button class="btn secondary" type="button" id="demoBtn">Ver demonstração</button></div>${message ? `<div class="message">${esc(message)}</div>` : ''}</form></section></main>`;
    document.getElementById('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      button.textContent = 'Entrando...';
      try { await login(document.getElementById('email').value.trim(), document.getElementById('password').value); }
      catch (error) { renderLogin(`Não foi possível entrar pela API: ${error.message}. Verifique se o backend está publicado e se o CORS permite este domínio.`); }
    });
    document.getElementById('demoBtn').addEventListener('click', () => enterDemo(email));
  }

  function metricCard(label, value, hint) {
    return `<article class="panel metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></article>`;
  }

  function renderDashboard(data) {
    const s = data.summary || demoData.summary;
    const daily = data.daily || [];
    const maxLeads = Math.max(...daily.map((i) => Number(i.leads || 0)), 1);
    const mode = data.source === 'api' ? '<span class="status-pill">Conectado à API</span>' : '<span class="status-pill warning">Visualização demonstração</span>';
    app.innerHTML = `<main class="page"><header class="app-header"><div class="header-title"><h1>${esc(cfg.APP_NAME || 'Gestão Ads')}</h1><p>${esc(cfg.COMPANY_NAME || 'R2R Marketing Digital')} • Atualização visual para cliente final</p></div><div class="header-actions">${mode}<button class="btn secondary" id="syncBtn">Atualizar dados</button><a class="btn success" href="https://wa.me/${esc(cfg.WHATSAPP_SUPPORT || '5547996753735')}" target="_blank" rel="noreferrer">Suporte WhatsApp</a><button class="btn secondary" id="logoutBtn">Sair</button></div></header><section class="summary"><article class="panel executive"><h2>Resumo executivo</h2><p>${esc(data.insight || demoData.insight)}</p></article><article class="panel health-card"><div class="health-score"><div class="score-dot"></div><div class="score-text"><strong>Status ${esc(data.status || 'bom')}</strong><span>Conta com acompanhamento ativo</span></div></div></article></section><section class="cards">${metricCard('Investimento', money(s.investment), 'Verba total aplicada no período')}${metricCard('Conversas / Leads', number(s.leads), 'Volume de oportunidades geradas')}${metricCard('Custo por Lead', money(s.cpl), 'Média de custo por oportunidade')}${metricCard('Impressões', number(s.impressions), 'Quantidade de exibições dos anúncios')}${metricCard('Alcance', number(s.reach), 'Pessoas impactadas')}${metricCard('Frequência', Number(s.frequency || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 }), 'Média de vezes por pessoa')}${metricCard('CTR', percent(s.ctr), 'Taxa de cliques')}${metricCard('CPM', money(s.cpm), 'Custo por mil impressões')}</section><section class="grid"><article class="panel block"><h2>Evolução de leads</h2><p class="insight">Acompanhe a quantidade de conversas/leads geradas por dia no período analisado.</p><div class="chart">${daily.map((item) => `<div class="chart-row"><span>${esc(item.label)}</span><div class="bar"><i style="--w:${Math.max(6, (Number(item.leads || 0) / maxLeads) * 100)}%"></i></div><strong>${number(item.leads)}</strong></div>`).join('')}</div></article><article class="panel block"><h2>Leitura simples das métricas</h2><div class="insight"><strong>CPL</strong> mostra quanto custa cada oportunidade.<br><strong>CTR</strong> mostra se o anúncio está chamando atenção.<br><strong>CPM</strong> mostra quanto custa aparecer para mil pessoas.<br><strong>Frequência</strong> ajuda a identificar possível desgaste do público.</div></article></section><section class="panel block" style="margin-top:18px"><h2>Campanhas principais</h2><div class="table-wrap"><table><thead><tr><th>Campanha</th><th>Canal</th><th>Investimento</th><th>Leads</th><th>CPL</th><th>Status</th></tr></thead><tbody>${(data.campaigns || []).map((c) => `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.channel || 'Meta Ads')}</td><td>${money(c.spend)}</td><td>${number(c.leads)}</td><td>${money(c.cpl)}</td><td><span class="tag">${esc(c.status || 'Ativa')}</span></td></tr>`).join('')}</tbody></table></div></section><p class="footer-note">Frontend preparado para Hostinger. Backend esperado: ${esc(cfg.API_BASE_URL || 'modo demonstração')}.</p></main>`;
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('syncBtn').addEventListener('click', syncDashboard);
  }

  async function syncDashboard() {
    const button = document.getElementById('syncBtn');
    button.disabled = true;
    button.textContent = 'Atualizando...';
    try {
      if (!state.demo && !cfg.DEMO_MODE) {
        try { await request('/dashboard/sync', { method: 'POST' }); } catch (error) { console.warn('Falha ao sincronizar:', error); }
        await loadDashboard();
      } else renderDashboard(demoData);
    } finally { button.disabled = false; button.textContent = 'Atualizar dados'; }
  }

  if (state.token || state.demo || cfg.DEMO_MODE) loadDashboard().catch(() => renderDashboard(demoData));
  else renderLogin();
})();
