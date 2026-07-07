(() => {
  const config = window.APP_CONFIG || {};
  const api = window.GestaoAdsAPI;
  const preview = new URLSearchParams(window.location.search).get('preview') === '1';
  const demoMode = config.DEMO_MODE !== false || preview;
  const app = document.getElementById('app');

  function daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }

  const state = {
    logged: demoMode ? preview || localStorage.getItem('gestaoAdsLogged') === 'true' : Boolean(api?.getToken()),
    page: 'dashboard',
    clientId: localStorage.getItem('gestaoAdsClient') || '',
    user: api?.getUser?.() || null,
    clients: [],
    summary: null,
    campaigns: [],
    health: null,
    loading: false,
    error: '',
    filters: { from: daysAgo(7), to: daysAgo(0), platform: '' }
  };

  const demoClients = [
    {
      id: 'r2r',
      name: 'R2R Marketing Digital',
      owner: 'Administrador',
      email: 'admin@r2rmarketingdigital.com.br',
      period: '01/07 a 06/07/2026',
      updatedAt: '06/07/2026 as 20:48',
      health: 86,
      spend: 12603.2,
      impressions: 587760,
      reach: 266180,
      clicks: 18426,
      resultsLabel: 'Conversas iniciadas',
      results: 1510,
      cpr: 8.35,
      ctr: 3.13,
      metaShare: 51,
      googleShare: 31,
      remarketingShare: 18,
      summary: 'As campanhas estao com volume consistente de conversas, custo controlado e boa distribuicao entre Meta Ads, Google Ads e remarketing.',
      insights: [
        'Landing Page Profissional concentra o maior volume de investimento e mantem bom custo por resultado.',
        'Automacao WhatsApp IA apresenta o melhor custo por conversa entre as campanhas ativas.',
        'Remarketing segue importante para recuperar interessados que ja visitaram paginas e ofertas.'
      ],
      campaigns: [
        { name: 'Landing Page Profissional', channel: 'Meta Ads', objective: 'Conversas', status: 'Ativa', spend: 4250.9, impressions: 189430, clicks: 6210, results: 486, cpr: 8.75, ctr: 3.28 },
        { name: 'Automacao WhatsApp IA', channel: 'Meta Ads', objective: 'Conversas', status: 'Ativa', spend: 2912.4, impressions: 157220, clicks: 5320, results: 512, cpr: 5.69, ctr: 3.38 },
        { name: 'CRM com IA para Empresas', channel: 'Google Ads', objective: 'Leads', status: 'Ativa', spend: 3380.1, impressions: 132880, clicks: 3926, results: 341, cpr: 9.91, ctr: 2.95 },
        { name: 'Remarketing Servicos Digitais', channel: 'Meta Ads', objective: 'Retorno', status: 'Pausada', spend: 2059.8, impressions: 108230, clicks: 2970, results: 171, cpr: 12.05, ctr: 2.74 }
      ]
    }
  ];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function brl(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function number(value) {
    return Number(value || 0).toLocaleString('pt-BR');
  }

  function percent(value) {
    return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function query(extra = {}) {
    const params = new URLSearchParams();
    const clientId = extra.clientId ?? state.clientId;
    if (clientId) params.set('clientId', clientId);
    if (state.filters.from) params.set('from', state.filters.from);
    if (state.filters.to) params.set('to', state.filters.to);
    if (state.filters.platform) params.set('platform', state.filters.platform);
    Object.entries(extra).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const text = params.toString();
    return text ? `?${text}` : '';
  }

  async function loadApiData() {
    if (demoMode || !state.logged) return;
    state.loading = true;
    state.error = '';
    render();
    try {
      const me = await api.request('/auth/me');
      state.user = me.user;
      api.setUser(me.user);
      const clients = await api.request('/clients');
      state.clients = clients.clients || [];
      if (!state.clientId || !state.clients.some((client) => client.id === state.clientId)) {
        state.clientId = state.clients[0]?.id || '';
        if (state.clientId) localStorage.setItem('gestaoAdsClient', state.clientId);
      }
      await loadDashboard(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel carregar os dados.';
      if (!api.getToken()) state.logged = false;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadDashboard(shouldRender = true) {
    if (demoMode || !state.logged || !state.clientId) return;
    if (shouldRender) {
      state.loading = true;
      state.error = '';
      render();
    }
    try {
      const [summary, campaigns, health] = await Promise.all([
        api.request(`/dashboard/summary${query()}`),
        api.request(`/dashboard/campaigns${query()}`),
        api.request(`/dashboard/health${query({ platform: '' })}`)
      ]);
      state.summary = summary;
      state.campaigns = campaigns.campaigns || summary.campaigns || [];
      state.health = health;
    } catch (error) {
      state.error = error.message || 'Nao foi possivel carregar o dashboard.';
    } finally {
      if (shouldRender) {
        state.loading = false;
        render();
      }
    }
  }

  function mapCampaign(campaign) {
    return {
      name: campaign.campaignName,
      channel: campaign.platform === 'META' ? 'Meta Ads' : 'Google Ads',
      objective: campaign.objective || 'Resultados',
      status: ['ACTIVE', 'ENABLED'].includes(campaign.status) ? 'Ativa' : campaign.status === 'PAUSED' ? 'Pausada' : campaign.status || 'Sem status',
      spend: campaign.spend,
      impressions: campaign.impressions,
      clicks: campaign.clicks,
      results: campaign.results || campaign.conversions || 0,
      cpr: campaign.costPerResult || 0,
      ctr: campaign.ctr || 0
    };
  }

  function currentClient() {
    if (demoMode) return demoClients.find((item) => item.id === state.clientId) || demoClients[0];

    const selected = state.clients.find((item) => item.id === state.clientId) || state.clients[0] || {};
    const totals = state.summary?.totals || {};
    const campaigns = (state.campaigns || []).map(mapCampaign);
    const spendByPlatform = campaigns.reduce((acc, item) => {
      if (item.channel === 'Meta Ads') acc.meta += Number(item.spend || 0);
      if (item.channel === 'Google Ads') acc.google += Number(item.spend || 0);
      return acc;
    }, { meta: 0, google: 0 });
    const totalSpend = Math.max(1, spendByPlatform.meta + spendByPlatform.google);

    return {
      id: selected.id || '',
      name: selected.tradeName || selected.name || 'Cliente',
      owner: state.user?.name || 'Usuario',
      email: selected.email || state.user?.email || '',
      period: `${state.filters.from} a ${state.filters.to}`,
      updatedAt: state.summary?.lastSyncAt ? new Date(state.summary.lastSyncAt).toLocaleString('pt-BR') : 'Sem sincronizacao',
      health: state.health?.score || 0,
      spend: totals.spend || 0,
      impressions: totals.impressions || 0,
      reach: totals.reach || 0,
      clicks: totals.clicks || 0,
      resultsLabel: 'Resultados gerados',
      results: totals.results || totals.conversions || 0,
      cpr: totals.costPerResult || 0,
      ctr: totals.ctr || 0,
      metaShare: Math.round((spendByPlatform.meta / totalSpend) * 100),
      googleShare: Math.round((spendByPlatform.google / totalSpend) * 100),
      remarketingShare: 0,
      summary: state.summary?.summary || 'Nenhum dado encontrado para o periodo selecionado.',
      insights: [
        state.summary?.lastSyncAt ? `Ultima sincronizacao: ${new Date(state.summary.lastSyncAt).toLocaleString('pt-BR')}` : 'As integracoes ainda nao possuem sincronizacao registrada.',
        campaigns[0] ? `${campaigns[0].name} concentra o maior investimento do periodo.` : 'Conecte uma conta de anuncios para iniciar a leitura das campanhas.',
        state.filters.platform ? `Filtro ativo: ${state.filters.platform}.` : 'Os dados exibem Meta Ads e Google Ads quando houver contas conectadas.'
      ],
      campaigns
    };
  }

  function clientOptions() {
    return demoMode ? demoClients : state.clients;
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '').trim();
    const alert = document.querySelector('[data-alert]');
    if (alert) alert.textContent = '';

    if (demoMode) {
      const demo = config.DEFAULT_LOGIN || {};
      if (email === demo.email && password === demo.password) {
        state.logged = true;
        state.clientId = state.clientId || demoClients[0].id;
        localStorage.setItem('gestaoAdsLogged', 'true');
        render();
        return;
      }
      if (alert) alert.textContent = 'E-mail ou senha invalidos. Confira os dados e tente novamente.';
      return;
    }

    try {
      state.loading = true;
      if (alert) alert.textContent = 'Entrando...';
      const result = await api.login(email, password);
      state.user = result.user;
      state.logged = true;
      await loadApiData();
    } catch (error) {
      if (alert) alert.textContent = error.message || 'Nao foi possivel entrar.';
    } finally {
      state.loading = false;
    }
  }

  function logout() {
    api?.logout?.();
    localStorage.removeItem('gestaoAdsLogged');
    state.logged = false;
    state.user = null;
    state.summary = null;
    state.campaigns = [];
    render();
  }

  async function changeClient(event) {
    state.clientId = event.target.value;
    localStorage.setItem('gestaoAdsClient', state.clientId);
    if (demoMode) render();
    else await loadDashboard(true);
  }

  async function changeFilter(event) {
    state.filters[event.target.dataset.filter] = event.target.value;
    if (demoMode) render();
    else await loadDashboard(true);
  }

  async function refreshData() {
    if (demoMode) {
      const btn = document.querySelector('[data-refresh]');
      const original = btn?.innerHTML || '';
      if (btn) {
        btn.innerHTML = 'R Atualizando';
        btn.disabled = true;
      }
      setTimeout(() => {
        if (btn) {
          btn.innerHTML = original;
          btn.disabled = false;
        }
      }, 900);
      return;
    }

    state.loading = true;
    state.error = '';
    render();
    try {
      await api.request('/dashboard/sync', {
        method: 'POST',
        body: JSON.stringify({
          clientId: state.clientId,
          from: state.filters.from,
          to: state.filters.to,
          platform: state.filters.platform || undefined
        })
      });
      await loadDashboard(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel sincronizar.';
    } finally {
      state.loading = false;
      render();
    }
  }

  async function exportReport(format) {
    if (demoMode) return;
    try {
      const base = String(config.API_BASE_URL || '').replace(/\/+$/, '');
      const path = format === 'pdf' ? '/reports/export.pdf' : '/reports/export.csv';
      const response = await fetch(`${base}${path}${query()}`, {
        headers: { Authorization: `Bearer ${api.getToken()}` }
      });
      if (!response.ok) throw new Error('Nao foi possivel gerar o relatorio.');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `gestao-ads-relatorio.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      state.error = error.message || 'Erro ao exportar relatorio.';
      render();
    }
  }

  function setPage(page) {
    state.page = page;
    render();
  }

  function navButton(page, label, icon) {
    return `<button class="${state.page === page ? 'active' : ''}" data-page="${page}"><span>${icon}</span>${escapeHtml(label)}</button>`;
  }

  function renderShell(content) {
    const client = currentClient();
    const internal = demoMode || ['ADMIN', 'MANAGER'].includes(state.user?.role);
    const nav = [
      navButton('dashboard', 'Resumo', '::'),
      navButton('campaigns', 'Campanhas', '[]'),
      ...(internal ? [navButton('clients', 'Clientes', 'OO'), navButton('integrations', 'Integracoes', '<>')] : []),
      navButton('reports', 'Relatorios', '##'),
      ...(internal ? [navButton('settings', 'Configuracoes', '..')] : [])
    ].join('');

    app.innerHTML = `
      <div class="app-layout">
        <aside class="sidebar">
          <div class="brand-row">
            <div class="logo-mark">R2R</div>
            <div>
              <div class="brand-name">Gestao Ads</div>
              <div class="brand-sub">Painel do cliente</div>
            </div>
          </div>
          <nav class="nav">${nav}</nav>
          <div class="user-box">
            <strong>${escapeHtml(state.user?.name || client.owner || 'Administrador')}</strong>
            <span>${escapeHtml(state.user?.email || client.email || '')}</span>
            <button class="btn secondary" data-logout>Sair</button>
          </div>
        </aside>
        <main class="main">
          ${state.error ? `<div class="alert api-alert">${escapeHtml(state.error)}</div>` : ''}
          ${state.loading ? '<div class="loading-line">Atualizando dados...</div>' : ''}
          ${content}
        </main>
      </div>
      <a class="whatsapp-float" href="https://wa.me/${escapeHtml(config.WHATSAPP_SUPPORT || '5547996753735')}" target="_blank" rel="noopener" title="Suporte WhatsApp">W</a>
    `;
    document.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => setPage(btn.dataset.page)));
    document.querySelector('[data-logout]')?.addEventListener('click', logout);
    document.querySelector('[data-client-select]')?.addEventListener('change', changeClient);
    document.querySelectorAll('[data-filter]').forEach((field) => field.addEventListener('change', changeFilter));
    document.querySelector('[data-refresh]')?.addEventListener('click', refreshData);
    document.querySelectorAll('[data-export]').forEach((btn) => btn.addEventListener('click', () => exportReport(btn.dataset.export)));
  }

  function topbar(title, subtitle) {
    const client = currentClient();
    const options = clientOptions();
    return `
      <header class="topbar">
        <div>
          <p class="eyebrow">${escapeHtml(client.period)}</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="actions">
          <select class="client-select" data-client-select ${state.user?.role === 'CLIENT' ? 'disabled' : ''}>
            ${options.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === client.id ? 'selected' : ''}>${escapeHtml(item.tradeName || item.name)}</option>`).join('')}
          </select>
          <input class="filter-input" type="date" value="${escapeHtml(state.filters.from)}" data-filter="from" />
          <input class="filter-input" type="date" value="${escapeHtml(state.filters.to)}" data-filter="to" />
          <select class="filter-input" data-filter="platform">
            <option value="" ${state.filters.platform === '' ? 'selected' : ''}>Todas</option>
            <option value="META" ${state.filters.platform === 'META' ? 'selected' : ''}>Meta</option>
            <option value="GOOGLE" ${state.filters.platform === 'GOOGLE' ? 'selected' : ''}>Google</option>
          </select>
          <button class="btn" data-refresh ${state.loading ? 'disabled' : ''}>R Atualizar</button>
        </div>
      </header>
    `;
  }

  function metric(label, value, sub, icon) {
    return `
      <article class="metric-card">
        <div class="metric-top">
          <span class="metric-label">${escapeHtml(label)}</span>
          <span class="metric-icon">${escapeHtml(icon)}</span>
        </div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-sub">${escapeHtml(sub)}</div>
      </article>
    `;
  }

  function renderDashboard() {
    const client = currentClient();
    const campaigns = client.campaigns || [];
    const maxSpend = Math.max(1, ...campaigns.map((campaign) => Number(campaign.spend || 0)));
    const rows = campaigns.length ? campaigns.map((campaign) => `
      <tr>
        <td><strong>${escapeHtml(campaign.name)}</strong><span class="small-muted">${escapeHtml(campaign.objective)} - ${escapeHtml(campaign.channel)}</span></td>
        <td>${brl(campaign.spend)}</td>
        <td>${number(campaign.results)}</td>
        <td>${brl(campaign.cpr)}</td>
        <td>${percent(campaign.ctr)}</td>
        <td><span class="status ${campaign.status === 'Pausada' ? 'paused' : ''}">${escapeHtml(campaign.status)}</span></td>
      </tr>
    `).join('') : '<tr><td colspan="6">Nenhuma campanha encontrada para o periodo.</td></tr>';
    const rankRows = campaigns.length ? campaigns.map((campaign) => `
      <div class="rank-row">
        <div class="rank-meta"><span>${escapeHtml(campaign.name)}</span><span>${brl(campaign.spend)}</span></div>
        <div class="bar"><div style="width:${Math.max(12, Math.round((campaign.spend / maxSpend) * 100))}%"></div></div>
      </div>
    `).join('') : '<div class="empty-state">Sem campanhas para ranquear.</div>';

    renderShell(`
      ${topbar('Resumo das campanhas', 'Visao objetiva para o cliente acompanhar os principais resultados do periodo sem excesso de informacao.')}
      <section class="summary-card">
        <div>
          <h2>Resumo executivo</h2>
          <p>${escapeHtml(client.summary)}</p>
          <div class="summary-list">
            ${client.insights.map((item) => `<div class="summary-item"><span class="summary-dot"></span><span>${escapeHtml(item)}</span></div>`).join('')}
          </div>
        </div>
        <aside class="health-panel">
          <div class="health-label">Saude geral das campanhas</div>
          <div class="health-score"><strong>${number(client.health)}%</strong><span>${client.health ? 'Performance monitorada' : 'Aguardando dados'}</span></div>
          <div class="health-bar"><div style="width:${Math.max(0, Math.min(100, client.health))}%"></div></div>
          <div class="updated">Ultima atualizacao: ${escapeHtml(client.updatedAt)}</div>
        </aside>
      </section>
      <section class="metrics-grid">
        ${metric('Investimento', brl(client.spend), 'Valor aplicado no periodo', 'R$')}
        ${metric(client.resultsLabel, number(client.results), 'Principal resultado gerado', 'OK')}
        ${metric('Custo por resultado', brl(client.cpr), 'Media consolidada', 'CPR')}
        ${metric('Alcance', number(client.reach), 'Pessoas alcancadas', 'ALC')}
        ${metric('Cliques', number(client.clicks), 'Trafego gerado', 'CLK')}
        ${metric('CTR medio', percent(client.ctr), 'Taxa de clique', '%')}
      </section>
      <section class="content-grid">
        <article class="panel">
          <div class="panel-head">
            <div><h2>Campanhas principais</h2><p>Informacoes resumidas para leitura rapida do cliente.</p></div>
            <span class="badge">Tempo quase real</span>
          </div>
          <div class="panel-body table-wrap">
            <table>
              <thead><tr><th>Campanha</th><th>Investimento</th><th>Resultados</th><th>Custo/result.</th><th>CTR</th><th>Status</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </article>
        <aside class="panel">
          <div class="panel-head"><div><h2>Distribuicao</h2><p>Onde a verba esta concentrada.</p></div></div>
          <div class="panel-body">
            <div class="rank-list">${rankRows}</div>
            <div class="channel-grid">
              <div class="channel-card"><span>Meta Ads</span><strong>${number(client.metaShare)}%</strong></div>
              <div class="channel-card"><span>Google</span><strong>${number(client.googleShare)}%</strong></div>
              <div class="channel-card"><span>Remarketing</span><strong>${number(client.remarketingShare)}%</strong></div>
            </div>
          </div>
        </aside>
      </section>
    `);
  }

  function renderCampaigns() {
    const client = currentClient();
    const rows = (client.campaigns || []).length ? client.campaigns.map((campaign) => `
      <tr>
        <td><strong>${escapeHtml(campaign.name)}</strong><span class="small-muted">${escapeHtml(campaign.channel)}</span></td>
        <td>${escapeHtml(campaign.objective)}</td>
        <td>${brl(campaign.spend)}</td>
        <td>${number(campaign.impressions)}</td>
        <td>${number(campaign.clicks)}</td>
        <td>${number(campaign.results)}</td>
        <td>${brl(campaign.cpr)}</td>
        <td><span class="status ${campaign.status === 'Pausada' ? 'paused' : ''}">${escapeHtml(campaign.status)}</span></td>
      </tr>
    `).join('') : '<tr><td colspan="8">Nenhuma campanha encontrada para o periodo.</td></tr>';
    renderShell(`
      ${topbar('Campanhas', 'Detalhamento das campanhas ativas e pausadas, mantendo somente os indicadores que o cliente precisa acompanhar.')}
      <article class="panel">
        <div class="panel-head"><div><h2>Lista de campanhas</h2><p>${escapeHtml(client.name)} - ${escapeHtml(client.period)}</p></div></div>
        <div class="panel-body table-wrap">
          <table>
            <thead><tr><th>Campanha</th><th>Objetivo</th><th>Investimento</th><th>Impressoes</th><th>Cliques</th><th>Resultados</th><th>Custo/result.</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </article>
    `);
  }

  function renderClients() {
    const cards = clientOptions().map((client) => `
      <article class="client-card">
        <h3>${escapeHtml(client.tradeName || client.name)}</h3>
        <p>${escapeHtml(client.owner || 'Cliente')} - ${escapeHtml(client.email || '')}</p>
        <div class="mini-grid">
          <div class="mini-stat"><span>Status</span><strong>${escapeHtml(client.status || 'ACTIVE')}</strong></div>
          <div class="mini-stat"><span>Cliente</span><strong>${escapeHtml(client.id ? 'Ativo' : 'Novo')}</strong></div>
        </div>
      </article>
    `).join('');
    renderShell(`${topbar('Clientes', 'Resumo administrativo dos clientes cadastrados no painel.')}<section class="client-section">${cards || '<div class="empty-state">Nenhum cliente cadastrado.</div>'}</section>`);
  }

  function renderSimplePage(title, description, body) {
    renderShell(`
      ${topbar(title, description)}
      <article class="panel">
        <div class="panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div>
        <div class="empty-state">${body}</div>
      </article>
    `);
  }

  function renderReports() {
    const body = demoMode
      ? 'Relatorios reais ficam disponiveis quando DEMO_MODE=false e a API estiver conectada.'
      : '<div class="report-actions"><button class="btn" data-export="csv">Baixar CSV</button><button class="btn secondary" data-export="pdf">Baixar PDF</button></div>';
    renderSimplePage('Relatorios', 'Exportacao consolidada por periodo e cliente.', body);
  }

  function renderLogin() {
    app.innerHTML = `
      <main class="login-page">
        <section class="login-shell">
          <div class="login-hero">
            <div class="brand-row">
              <div class="logo-mark">R2R</div>
              <div><div class="brand-name">${escapeHtml(config.COMPANY_NAME || 'R2R Marketing Digital')}</div><div class="brand-sub">Painel de campanhas para clientes</div></div>
            </div>
            <h1 class="login-title">Resultados de campanhas em uma visao simples e profissional.</h1>
            <p class="login-copy">Acompanhe investimento, resultados, custo por lead, alcance e desempenho das campanhas Meta Ads e Google Ads em um painel objetivo.</p>
            <div class="hero-points">
              <div class="hero-point"><strong>Cliente</strong><span>Acesso individual e seguro</span></div>
              <div class="hero-point"><strong>Resumo</strong><span>Principais metricas do periodo</span></div>
              <div class="hero-point"><strong>Campanhas</strong><span>Ranking e status atualizado</span></div>
            </div>
          </div>
          <form class="login-card" data-login-form>
            <div class="brand-row" style="margin-bottom:24px"><div class="logo-mark">R2R</div><div><div class="brand-name">Gestao Ads</div><div class="brand-sub">Acesso ao painel</div></div></div>
            <h2 class="form-title">Entrar no dashboard</h2>
            <p class="form-sub">Use seu acesso para visualizar as campanhas do seu negocio.</p>
            <div class="form-group"><label>E-mail</label><input class="input" name="email" type="email" value="${escapeHtml(config.DEFAULT_LOGIN?.email || '')}" autocomplete="email" required /></div>
            <div class="form-group"><label>Senha</label><input class="input" name="password" type="password" value="${demoMode ? escapeHtml(config.DEFAULT_LOGIN?.password || '') : ''}" autocomplete="current-password" required /></div>
            <button class="btn full" type="submit" ${state.loading ? 'disabled' : ''}>Acessar painel</button>
            <div class="alert" data-alert></div>
            <p class="demo-note">${demoMode ? 'Demonstracao ativa. Para dados reais, conecte o backend no arquivo config.js.' : 'Dados carregados pela API oficial configurada.'}</p>
          </form>
        </section>
      </main>
    `;
    document.querySelector('[data-login-form]').addEventListener('submit', login);
  }

  function render() {
    if (!state.logged) {
      renderLogin();
      return;
    }
    if (state.page === 'dashboard') renderDashboard();
    else if (state.page === 'campaigns') renderCampaigns();
    else if (state.page === 'clients') renderClients();
    else if (state.page === 'integrations') renderSimplePage('Integracoes', 'Conecte Meta Ads, Google Ads e acompanhe status de sincronizacao.', 'Use a area administrativa da API para gerar URLs OAuth, vincular contas de anuncios e acompanhar logs de sincronizacao.');
    else if (state.page === 'reports') renderReports();
    else if (state.page === 'settings') renderSimplePage('Configuracoes', 'Configuracao visual e tecnica do painel.', 'Edite config.js para alterar nome da empresa, API, modo demonstracao e WhatsApp de suporte.');
  }

  if (!state.clientId && demoMode) state.clientId = demoClients[0].id;
  render();
  if (!demoMode && state.logged) loadApiData();
})();
