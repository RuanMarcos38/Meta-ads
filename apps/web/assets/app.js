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
    features: {},
    integrations: [],
    adAccounts: [],
    syncLogs: [],
    syncJobs: [],
    users: [],
    apiStatus: null,
    pageLoading: false,
    actionMessage: '',
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

  function dateTime(value) {
    return value ? new Date(value).toLocaleString('pt-BR') : 'Sem registro';
  }

  function platformLabel(value) {
    return value === 'META' ? 'Meta Ads' : value === 'GOOGLE' ? 'Google Ads' : 'Todas';
  }

  function roleLabel(value) {
    const labels = {
      SUPER_ADMIN: 'Super Admin',
      COMPANY_ADMIN: 'Administrador da Empresa',
      ADMIN: 'Administrador da Empresa',
      MANAGER: 'Gestor',
      USER: 'Usuario Comum',
      CLIENT: 'Usuario Comum'
    };
    return labels[value] || value || 'Usuario';
  }

  function featureLabel(value) {
    const labels = {
      integrations: 'Integracoes',
      reports: 'Relatorios',
      sync: 'Sincronizacao'
    };
    return labels[value] || value;
  }

  function featureDescription(value) {
    const labels = {
      integrations: 'Meta Ads, Google Ads, contas de anuncio e tokens.',
      reports: 'Exportacoes CSV/PDF e leitura executiva do periodo.',
      sync: 'Atualizacao manual e recorrente dos dados de midia.'
    };
    return labels[value] || 'Funcionalidade controlada por empresa.';
  }

  function hasFeature(featureName) {
    return state.features[featureName] !== false;
  }

  function isInternalUser() {
    return demoMode || ['SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN', 'MANAGER'].includes(state.user?.role);
  }

  function isClientScopedUser() {
    return ['USER', 'CLIENT'].includes(state.user?.role);
  }

  function canAccessPage(page) {
    if (page === 'clients' || page === 'settings') return isInternalUser();
    if (page === 'integrations') return isInternalUser() && hasFeature('integrations');
    if (page === 'reports') return hasFeature('reports');
    return true;
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

  function clientQuery(extra = {}) {
    const params = new URLSearchParams();
    const clientId = extra.clientId ?? state.clientId;
    if (clientId) params.set('clientId', clientId);
    Object.entries(extra).forEach(([key, value]) => {
      if (key !== 'clientId' && value !== undefined && value !== null && value !== '') params.set(key, value);
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
      try {
        const me = await api.request('/auth/me');
        state.user = me.user || state.user;
        api.setUser(state.user);
      } catch {
        state.user = state.user || api.getUser();
      }
      try {
        const features = await api.request('/feature-flags');
        state.features = Object.fromEntries((features.flags || []).map((flag) => [flag.featureName, flag.enabled]));
      } catch {
        state.features = {};
      }
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
      const summary = await api.request(`/dashboard/summary${query()}`);
      let campaigns = { campaigns: summary.campaigns || [] };
      let health = null;
      try {
        campaigns = await api.request(`/dashboard/campaigns${query()}`);
      } catch {
        campaigns = { campaigns: summary.campaigns || [] };
      }
      try {
        health = await api.request(`/dashboard/health${query({ platform: '' })}`);
      } catch {
        health = { score: summary.totals?.spend || summary.totals?.results ? 80 : 0 };
      }
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

  async function loadIntegrationData(shouldRender = true) {
    if (demoMode) {
      state.integrations = [
        { id: 'demo-meta', platform: 'META', status: 'CONNECTED', updatedAt: new Date().toISOString(), providerAccountId: 'business-demo' },
        { id: 'demo-google', platform: 'GOOGLE', status: 'DISCONNECTED', updatedAt: null, providerAccountId: '' }
      ];
      state.adAccounts = [
        { id: 'demo-act-1', platform: 'META', accountName: 'Conta Meta - R2R', status: 'active', lastSyncAt: new Date().toISOString(), currency: 'BRL' },
        { id: 'demo-gads-1', platform: 'GOOGLE', accountName: 'Conta Google - R2R', status: 'active', lastSyncAt: new Date().toISOString(), currency: 'BRL' }
      ];
      state.syncLogs = [
        { id: 'log-1', level: 'info', platform: 'META', message: 'Sincronizacao concluida.', createdAt: new Date().toISOString() },
        { id: 'log-2', level: 'info', platform: 'GOOGLE', message: 'Metricas normalizadas para o painel.', createdAt: new Date().toISOString() }
      ];
      state.syncJobs = [];
      if (shouldRender) render();
      return;
    }
    if (!state.logged || !state.clientId) return;
    state.pageLoading = true;
    state.error = '';
    if (shouldRender) render();
    try {
      const [integrations, accounts, logs, jobs] = await Promise.all([
        api.request(`/integrations${clientQuery()}`),
        api.request(`/ad-accounts${clientQuery()}`),
        api.request(`/sync/logs${clientQuery({ limit: 12 })}`),
        api.request(`/sync/status${clientQuery()}`)
      ]);
      state.integrations = integrations.integrations || [];
      state.adAccounts = accounts.accounts || [];
      state.syncLogs = logs.logs || [];
      state.syncJobs = jobs.jobs || [];
    } catch (error) {
      state.error = error.message || 'Nao foi possivel carregar integracoes.';
    } finally {
      state.pageLoading = false;
      if (shouldRender) render();
    }
  }

  async function loadSettingsData(shouldRender = true) {
    if (demoMode) {
      state.users = [
        { id: 'admin-demo', name: 'Administrador', email: config.DEFAULT_LOGIN?.email || 'admin@r2rmarketingdigital.com.br', role: 'COMPANY_ADMIN', status: 'ACTIVE', lastLoginAt: new Date().toISOString() },
        { id: 'cliente-demo', name: 'Cliente R2R', email: 'cliente@r2rmarketingdigital.com.br', role: 'USER', status: 'ACTIVE', lastLoginAt: null }
      ];
      state.apiStatus = { ok: true, database: 'demo' };
      if (shouldRender) render();
      return;
    }
    if (!state.logged) return;
    state.pageLoading = true;
    state.error = '';
    if (shouldRender) render();
    try {
      const [users, flags, ready] = await Promise.allSettled([
        api.request('/users'),
        api.request('/feature-flags'),
        api.request('/ready')
      ]);
      if (users.status === 'fulfilled') state.users = users.value.users || [];
      if (flags.status === 'fulfilled') state.features = Object.fromEntries((flags.value.flags || []).map((flag) => [flag.featureName, flag.enabled]));
      state.apiStatus = ready.status === 'fulfilled' ? ready.value : { ok: false };
    } catch (error) {
      state.error = error.message || 'Nao foi possivel carregar configuracoes.';
    } finally {
      state.pageLoading = false;
      if (shouldRender) render();
    }
  }

  async function loadPageData(page, shouldRender = true) {
    if (page === 'integrations') await loadIntegrationData(shouldRender);
    if (page === 'settings') await loadSettingsData(shouldRender);
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
    state.integrations = [];
    state.adAccounts = [];
    state.syncLogs = [];
    state.syncJobs = [];
    if (demoMode) render();
    else {
      await loadDashboard(true);
      await loadPageData(state.page, true);
    }
  }

  async function changeFilter(event) {
    state.filters[event.target.dataset.filter] = event.target.value;
    if (demoMode) render();
    else await loadDashboard(true);
  }

  async function refreshData() {
    if (!hasFeature('sync')) {
      state.error = 'Sincronizacao desativada para esta empresa.';
      render();
      return;
    }
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
      if (state.page === 'integrations') await loadIntegrationData(false);
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

  async function connectOAuth(platform) {
    if (demoMode) {
      state.actionMessage = `${platformLabel(platform)} conectado no modo teste.`;
      render();
      return;
    }
    try {
      state.pageLoading = true;
      state.error = '';
      render();
      const path = platform === 'META' ? '/integrations/meta/auth-url' : '/integrations/google/auth-url';
      const result = await api.request(`${path}${clientQuery()}`);
      if (result.url) window.open(result.url, '_blank', 'noopener');
      state.actionMessage = `Autorizacao ${platformLabel(platform)} aberta em nova aba.`;
    } catch (error) {
      state.error = error.message || 'Nao foi possivel iniciar a autorizacao.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function syncPlatform(platform) {
    if (demoMode) {
      state.actionMessage = `${platformLabel(platform)} sincronizado no modo teste.`;
      await loadIntegrationData(false);
      render();
      return;
    }
    try {
      state.pageLoading = true;
      state.error = '';
      render();
      const base = platform === 'META' ? '/integrations/meta/sync' : '/integrations/google/sync';
      await api.request(`${base}/${encodeURIComponent(state.clientId)}`, {
        method: 'POST',
        body: JSON.stringify({ from: state.filters.from, to: state.filters.to })
      });
      state.actionMessage = `${platformLabel(platform)} sincronizado.`;
      await loadDashboard(false);
      await loadIntegrationData(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel sincronizar.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function disconnectIntegration(integrationId, platform) {
    if (demoMode) {
      state.integrations = state.integrations.map((item) => item.id === integrationId ? { ...item, status: 'DISCONNECTED' } : item);
      state.actionMessage = `${platformLabel(platform)} desconectado no modo teste.`;
      render();
      return;
    }
    try {
      state.pageLoading = true;
      render();
      const path = platform === 'META' ? '/integrations/meta/disconnect' : '/integrations/google/disconnect';
      await api.request(path, { method: 'POST', body: JSON.stringify({ integrationId }) });
      state.actionMessage = `${platformLabel(platform)} desconectado.`;
      await loadIntegrationData(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel desconectar.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function saveManualToken(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      clientId: state.clientId,
      platform: String(form.get('platform') || 'META'),
      providerAccountId: String(form.get('providerAccountId') || '').trim() || undefined,
      accessToken: String(form.get('accessToken') || '').trim() || undefined,
      refreshToken: String(form.get('refreshToken') || '').trim() || undefined,
      scopes: String(form.get('scopes') || '').trim() || undefined
    };
    if (demoMode) {
      state.integrations.unshift({ id: `demo-${Date.now()}`, ...body, status: 'CONNECTED', updatedAt: new Date().toISOString() });
      state.actionMessage = 'Token salvo no modo teste.';
      render();
      return;
    }
    try {
      state.pageLoading = true;
      render();
      await api.request('/integrations/token', { method: 'POST', body: JSON.stringify(body) });
      state.actionMessage = 'Token criptografado e salvo.';
      await loadIntegrationData(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel salvar o token.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function connectManualAccount(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const platform = String(form.get('platform') || 'META');
    const body = {
      clientId: state.clientId,
      externalAccountId: String(form.get('externalAccountId') || '').trim(),
      accountName: String(form.get('accountName') || '').trim(),
      currency: String(form.get('currency') || 'BRL').trim() || 'BRL',
      timezone: String(form.get('timezone') || '').trim() || undefined
    };
    if (demoMode) {
      state.adAccounts.unshift({ id: `demo-account-${Date.now()}`, platform, ...body, status: 'active', lastSyncAt: null });
      state.actionMessage = 'Conta vinculada no modo teste.';
      render();
      return;
    }
    try {
      state.pageLoading = true;
      render();
      const path = platform === 'META' ? '/integrations/meta/connect-account' : '/integrations/google/connect-account';
      await api.request(path, { method: 'POST', body: JSON.stringify(body) });
      state.actionMessage = 'Conta de anuncio vinculada.';
      await loadIntegrationData(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel vincular a conta.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function toggleFeature(featureName, enabled) {
    if (demoMode) {
      state.features[featureName] = enabled;
      state.actionMessage = `${featureLabel(featureName)} ${enabled ? 'ativada' : 'desativada'} no modo teste.`;
      render();
      return;
    }
    try {
      state.pageLoading = true;
      render();
      const result = await api.request(`/feature-flags/${encodeURIComponent(featureName)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled })
      });
      state.features[featureName] = result.flag?.enabled ?? enabled;
      state.actionMessage = `${featureLabel(featureName)} ${enabled ? 'ativada' : 'desativada'}.`;
      await loadSettingsData(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel alterar a funcionalidade.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function createUser(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = String(form.get('role') || 'USER');
    const body = {
      name: String(form.get('name') || '').trim(),
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || '').trim(),
      role,
      clientId: ['USER', 'CLIENT'].includes(role) ? String(form.get('clientId') || state.clientId) : undefined
    };
    if (demoMode) {
      state.users.unshift({ id: `demo-user-${Date.now()}`, ...body, status: 'ACTIVE', createdAt: new Date().toISOString() });
      state.actionMessage = 'Usuario criado no modo teste.';
      render();
      return;
    }
    try {
      state.pageLoading = true;
      render();
      await api.request('/users', { method: 'POST', body: JSON.stringify(body) });
      state.actionMessage = 'Usuario criado com acesso isolado por empresa.';
      await loadSettingsData(false);
    } catch (error) {
      state.error = error.message || 'Nao foi possivel criar o usuario.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      currentPassword: String(form.get('currentPassword') || ''),
      newPassword: String(form.get('newPassword') || '')
    };
    if (demoMode) {
      state.actionMessage = 'Senha validada no modo teste.';
      render();
      return;
    }
    try {
      state.pageLoading = true;
      render();
      await api.request('/auth/change-password', { method: 'PATCH', body: JSON.stringify(body) });
      state.actionMessage = 'Senha atualizada.';
      event.currentTarget.reset();
    } catch (error) {
      state.error = error.message || 'Nao foi possivel alterar a senha.';
    } finally {
      state.pageLoading = false;
      render();
    }
  }

  async function setPage(page) {
    if (!canAccessPage(page)) return;
    state.page = page;
    state.actionMessage = '';
    render();
    await loadPageData(page, true);
  }

  function navButton(page, label, icon) {
    return `<button class="${state.page === page ? 'active' : ''}" data-page="${page}"><span>${icon}</span>${escapeHtml(label)}</button>`;
  }

  function renderShell(content) {
    const client = currentClient();
    const internal = isInternalUser();
    const nav = [
      navButton('dashboard', 'Resumo', '::'),
      navButton('campaigns', 'Campanhas', '[]'),
      ...(internal ? [navButton('clients', 'Clientes', 'OO')] : []),
      ...(internal && hasFeature('integrations') ? [navButton('integrations', 'Integracoes', '<>')] : []),
      ...(hasFeature('reports') ? [navButton('reports', 'Relatorios', '##')] : []),
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
          ${state.actionMessage ? `<div class="success-line">${escapeHtml(state.actionMessage)}</div>` : ''}
          ${state.loading ? '<div class="loading-line">Atualizando dados...</div>' : ''}
          ${state.pageLoading ? '<div class="loading-line">Carregando tela...</div>' : ''}
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
    document.querySelectorAll('[data-oauth]').forEach((btn) => btn.addEventListener('click', () => connectOAuth(btn.dataset.oauth)));
    document.querySelectorAll('[data-sync-platform]').forEach((btn) => btn.addEventListener('click', () => syncPlatform(btn.dataset.syncPlatform)));
    document.querySelectorAll('[data-disconnect]').forEach((btn) => btn.addEventListener('click', () => disconnectIntegration(btn.dataset.disconnect, btn.dataset.platform)));
    document.querySelector('[data-token-form]')?.addEventListener('submit', saveManualToken);
    document.querySelector('[data-account-form]')?.addEventListener('submit', connectManualAccount);
    document.querySelectorAll('[data-feature-toggle]').forEach((input) => input.addEventListener('change', () => toggleFeature(input.dataset.featureToggle, input.checked)));
    document.querySelector('[data-user-form]')?.addEventListener('submit', createUser);
    document.querySelector('[data-password-form]')?.addEventListener('submit', changePassword);
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
          <select class="client-select" data-client-select ${isClientScopedUser() ? 'disabled' : ''}>
            ${options.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === client.id ? 'selected' : ''}>${escapeHtml(item.tradeName || item.name)}</option>`).join('')}
          </select>
          <input class="filter-input" type="date" value="${escapeHtml(state.filters.from)}" data-filter="from" />
          <input class="filter-input" type="date" value="${escapeHtml(state.filters.to)}" data-filter="to" />
          <select class="filter-input" data-filter="platform">
            <option value="" ${state.filters.platform === '' ? 'selected' : ''}>Todas</option>
            <option value="META" ${state.filters.platform === 'META' ? 'selected' : ''}>Meta</option>
            <option value="GOOGLE" ${state.filters.platform === 'GOOGLE' ? 'selected' : ''}>Google</option>
          </select>
          <button class="btn" data-refresh ${state.loading || !hasFeature('sync') ? 'disabled' : ''}>R Atualizar</button>
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

  function renderIntegrations() {
    const client = currentClient();
    const platformCards = ['META', 'GOOGLE'].map((platform) => {
      const integration = state.integrations.find((item) => item.platform === platform);
      const accounts = state.adAccounts.filter((item) => item.platform === platform);
      const connected = integration?.status === 'CONNECTED';
      return `
        <article class="ops-card">
          <div class="ops-card-head">
            <div class="ops-icon ${platform.toLowerCase()}">${platform === 'META' ? 'M' : 'G'}</div>
            <div>
              <h3>${platformLabel(platform)}</h3>
              <p>${connected ? 'Conectada ao backend oficial' : 'Aguardando autorizacao'}</p>
            </div>
            <span class="status ${connected ? '' : 'paused'}">${escapeHtml(integration?.status || 'DISCONNECTED')}</span>
          </div>
          <div class="ops-stats">
            <div><span>Contas</span><strong>${number(accounts.length)}</strong></div>
            <div><span>Ultima sync</span><strong>${escapeHtml(dateTime(accounts[0]?.lastSyncAt).split(',')[0])}</strong></div>
          </div>
          <div class="ops-actions">
            <button class="btn" data-oauth="${platform}" ${state.pageLoading ? 'disabled' : ''}>Conectar</button>
            <button class="btn secondary" data-sync-platform="${platform}" ${state.pageLoading || !hasFeature('sync') ? 'disabled' : ''}>Sincronizar</button>
            ${integration ? `<button class="btn secondary" data-disconnect="${escapeHtml(integration.id)}" data-platform="${platform}" ${state.pageLoading ? 'disabled' : ''}>Desconectar</button>` : ''}
          </div>
        </article>
      `;
    }).join('');

    const accountsRows = state.adAccounts.length ? state.adAccounts.map((account) => `
      <tr>
        <td><strong>${escapeHtml(account.accountName)}</strong><span class="small-muted">${escapeHtml(account.externalAccountId || account.id)}</span></td>
        <td>${escapeHtml(platformLabel(account.platform))}</td>
        <td>${escapeHtml(account.currency || 'BRL')}</td>
        <td><span class="status ${account.status === 'active' ? '' : 'paused'}">${escapeHtml(account.status || 'active')}</span></td>
        <td>${escapeHtml(dateTime(account.lastSyncAt))}</td>
      </tr>
    `).join('') : '<tr><td colspan="5">Nenhuma conta vinculada para este cliente.</td></tr>';

    const logRows = state.syncLogs.length ? state.syncLogs.map((log) => `
      <div class="timeline-row">
        <span class="timeline-dot ${escapeHtml(log.level || 'info')}"></span>
        <div>
          <strong>${escapeHtml(platformLabel(log.platform))}</strong>
          <p>${escapeHtml(log.message)}</p>
          <small>${escapeHtml(dateTime(log.createdAt))}</small>
        </div>
      </div>
    `).join('') : '<div class="empty-state compact">Sem logs de sincronizacao para este cliente.</div>';

    renderShell(`
      ${topbar('Integracoes', `Conexoes de midia e sincronizacao de dados para ${client.name}.`)}
      <section class="ops-grid">${platformCards}</section>
      <section class="content-grid">
        <article class="panel">
          <div class="panel-head">
            <div><h2>Contas de anuncio</h2><p>Contas conectadas e status de leitura.</p></div>
            <span class="badge">${number(state.adAccounts.length)} contas</span>
          </div>
          <div class="panel-body table-wrap">
            <table>
              <thead><tr><th>Conta</th><th>Plataforma</th><th>Moeda</th><th>Status</th><th>Ultima sync</th></tr></thead>
              <tbody>${accountsRows}</tbody>
            </table>
          </div>
        </article>
        <aside class="panel">
          <div class="panel-head"><div><h2>Eventos recentes</h2><p>Leitura operacional da sincronizacao.</p></div></div>
          <div class="panel-body timeline">${logRows}</div>
        </aside>
      </section>
      <section class="form-grid">
        <article class="panel">
          <div class="panel-head"><div><h2>Token manual</h2><p>Entrada segura para credenciais ja autorizadas.</p></div></div>
          <form class="panel-body form-grid-inner" data-token-form>
            <select class="input" name="platform"><option value="META">Meta Ads</option><option value="GOOGLE">Google Ads</option></select>
            <input class="input" name="providerAccountId" placeholder="ID do provedor" />
            <input class="input" name="accessToken" placeholder="Access token" />
            <input class="input" name="refreshToken" placeholder="Refresh token" />
            <input class="input full-row" name="scopes" placeholder="Escopos autorizados" />
            <button class="btn full-row" type="submit" ${state.pageLoading ? 'disabled' : ''}>Salvar token</button>
          </form>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h2>Vincular conta</h2><p>Associe uma conta de anuncio ao cliente selecionado.</p></div></div>
          <form class="panel-body form-grid-inner" data-account-form>
            <select class="input" name="platform"><option value="META">Meta Ads</option><option value="GOOGLE">Google Ads</option></select>
            <input class="input" name="externalAccountId" placeholder="ID da conta" required />
            <input class="input" name="accountName" placeholder="Nome da conta" required />
            <input class="input" name="currency" placeholder="Moeda" value="BRL" />
            <input class="input full-row" name="timezone" placeholder="Fuso horario" />
            <button class="btn full-row" type="submit" ${state.pageLoading ? 'disabled' : ''}>Vincular conta</button>
          </form>
        </article>
      </section>
    `);
  }

  function renderReports() {
    const client = currentClient();
    const campaigns = client.campaigns || [];
    const totalResults = Number(client.results || 0);
    const topCampaign = campaigns.slice().sort((a, b) => Number(b.results || 0) - Number(a.results || 0))[0];
    const spendLimit = Math.max(1, Number(client.spend || 0));
    const rows = campaigns.length ? campaigns.map((campaign) => `
      <tr>
        <td><strong>${escapeHtml(campaign.name)}</strong><span class="small-muted">${escapeHtml(campaign.channel)} - ${escapeHtml(campaign.objective)}</span></td>
        <td>${brl(campaign.spend)}</td>
        <td>${number(campaign.results)}</td>
        <td>${brl(campaign.cpr)}</td>
        <td>${percent(campaign.ctr)}</td>
      </tr>
    `).join('') : '<tr><td colspan="5">Sem campanhas para o periodo selecionado.</td></tr>';
    const allocation = campaigns.length ? campaigns.map((campaign) => `
      <div class="rank-row">
        <div class="rank-meta"><span>${escapeHtml(campaign.name)}</span><span>${number((Number(campaign.spend || 0) / spendLimit) * 100)}%</span></div>
        <div class="bar"><div style="width:${Math.max(8, Math.round((Number(campaign.spend || 0) / spendLimit) * 100))}%"></div></div>
      </div>
    `).join('') : '<div class="empty-state compact">Sem distribuicao disponivel.</div>';

    renderShell(`
      ${topbar('Relatorios', `Leitura executiva de ${client.name} com exportacao consolidada.`)}
      <section class="metrics-grid">
        ${metric('Investimento', brl(client.spend), 'Periodo selecionado', 'R$')}
        ${metric(client.resultsLabel, number(totalResults), 'Resultados atribuidos', 'OK')}
        ${metric('Custo medio', brl(client.cpr), 'Por resultado', 'CPR')}
        ${metric('CTR medio', percent(client.ctr), 'Engajamento de clique', '%')}
        ${metric('Melhor campanha', topCampaign?.name || 'Sem dados', topCampaign ? `${number(topCampaign.results)} resultados` : 'Aguardando dados', 'TOP')}
        ${metric('Saude', `${number(client.health)}%`, 'Indice operacional', 'S')}
      </section>
      <section class="summary-card">
        <div>
          <h2>Resumo executivo</h2>
          <p>${escapeHtml(client.summary)}</p>
          <div class="summary-list">
            ${client.insights.map((item) => `<div class="summary-item"><span class="summary-dot"></span><span>${escapeHtml(item)}</span></div>`).join('')}
          </div>
        </div>
        <aside class="health-panel report-panel">
          <div class="health-label">Exportacoes</div>
          <div class="report-actions">
            <button class="btn" data-export="csv" ${demoMode ? 'disabled' : ''}>Baixar CSV</button>
            <button class="btn secondary" data-export="pdf" ${demoMode ? 'disabled' : ''}>Baixar PDF</button>
          </div>
          <div class="updated">${demoMode ? 'Modo teste ativo' : 'Arquivos gerados pela API oficial'}</div>
        </aside>
      </section>
      <section class="content-grid">
        <article class="panel">
          <div class="panel-head"><div><h2>Campanhas no relatorio</h2><p>Indicadores usados no arquivo exportado.</p></div></div>
          <div class="panel-body table-wrap">
            <table>
              <thead><tr><th>Campanha</th><th>Investimento</th><th>Resultados</th><th>CPR</th><th>CTR</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </article>
        <aside class="panel">
          <div class="panel-head"><div><h2>Alocacao de verba</h2><p>Participacao relativa por campanha.</p></div></div>
          <div class="panel-body rank-list">${allocation}</div>
        </aside>
      </section>
    `);
  }

  function renderSettings() {
    const client = currentClient();
    const featureKeys = ['integrations', 'reports', 'sync'];
    const flags = featureKeys.map((featureName) => `
      <label class="toggle-row">
        <div>
          <strong>${escapeHtml(featureLabel(featureName))}</strong>
          <span>${escapeHtml(featureDescription(featureName))}</span>
        </div>
        <input type="checkbox" data-feature-toggle="${escapeHtml(featureName)}" ${hasFeature(featureName) ? 'checked' : ''} ${state.pageLoading ? 'disabled' : ''} />
      </label>
    `).join('');
    const usersRows = state.users.length ? state.users.map((user) => `
      <tr>
        <td><strong>${escapeHtml(user.name)}</strong><span class="small-muted">${escapeHtml(user.email)}</span></td>
        <td>${escapeHtml(roleLabel(user.role))}</td>
        <td><span class="status ${user.status === 'ACTIVE' ? '' : 'paused'}">${escapeHtml(user.status || 'ACTIVE')}</span></td>
        <td>${escapeHtml(dateTime(user.lastLoginAt))}</td>
      </tr>
    `).join('') : '<tr><td colspan="4">Nenhum usuario carregado.</td></tr>';
    const clientOptionsHtml = clientOptions().map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.clientId ? 'selected' : ''}>${escapeHtml(item.tradeName || item.name)}</option>`).join('');

    renderShell(`
      ${topbar('Configuracoes', `Governanca, acessos e recursos ativos para ${client.name}.`)}
      <section class="settings-grid">
        <article class="panel">
          <div class="panel-head"><div><h2>Empresa e API</h2><p>Estado operacional do ambiente real.</p></div><span class="badge">${state.apiStatus?.ok ? 'Online' : demoMode ? 'Teste' : 'Verificando'}</span></div>
          <div class="panel-body config-list">
            <div><span>Empresa</span><strong>${escapeHtml(config.COMPANY_NAME || client.name)}</strong></div>
            <div><span>API</span><strong>${escapeHtml(config.API_BASE_URL || 'Nao configurada')}</strong></div>
            <div><span>Banco</span><strong>${escapeHtml(state.apiStatus?.database || (demoMode ? 'modo teste' : 'pendente'))}</strong></div>
            <div><span>Perfil atual</span><strong>${escapeHtml(roleLabel(state.user?.role))}</strong></div>
          </div>
        </article>
        <article class="panel">
          <div class="panel-head"><div><h2>Funcionalidades</h2><p>Controle por empresa com bloqueio no backend.</p></div></div>
          <div class="panel-body toggle-list">${flags}</div>
        </article>
      </section>
      <section class="content-grid">
        <article class="panel">
          <div class="panel-head"><div><h2>Usuarios</h2><p>Acessos vinculados ao tenant autenticado.</p></div><span class="badge">${number(state.users.length)} usuarios</span></div>
          <div class="panel-body table-wrap">
            <table>
              <thead><tr><th>Usuario</th><th>Perfil</th><th>Status</th><th>Ultimo acesso</th></tr></thead>
              <tbody>${usersRows}</tbody>
            </table>
          </div>
        </article>
        <aside class="panel">
          <div class="panel-head"><div><h2>Novo acesso</h2><p>Convite interno ou usuario do cliente.</p></div></div>
          <form class="panel-body stacked-form" data-user-form>
            <input class="input" name="name" placeholder="Nome" required />
            <input class="input" name="email" type="email" placeholder="E-mail" required />
            <input class="input" name="password" type="password" placeholder="Senha inicial" required />
            <select class="input" name="role"><option value="USER">Usuario Comum</option><option value="MANAGER">Gestor</option><option value="COMPANY_ADMIN">Administrador da Empresa</option></select>
            <select class="input" name="clientId">${clientOptionsHtml}</select>
            <button class="btn" type="submit" ${state.pageLoading ? 'disabled' : ''}>Criar usuario</button>
          </form>
        </aside>
      </section>
      <section class="form-grid single">
        <article class="panel">
          <div class="panel-head"><div><h2>Senha do administrador</h2><p>Atualizacao autenticada pelo backend.</p></div></div>
          <form class="panel-body form-grid-inner" data-password-form>
            <input class="input" name="currentPassword" type="password" placeholder="Senha atual" required />
            <input class="input" name="newPassword" type="password" placeholder="Nova senha" required />
            <button class="btn" type="submit" ${state.pageLoading ? 'disabled' : ''}>Atualizar senha</button>
          </form>
        </article>
      </section>
    `);
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
    if (!canAccessPage(state.page)) state.page = 'dashboard';
    if (state.page === 'dashboard') renderDashboard();
    else if (state.page === 'campaigns') renderCampaigns();
    else if (state.page === 'clients') renderClients();
    else if (state.page === 'integrations') renderIntegrations();
    else if (state.page === 'reports') renderReports();
    else if (state.page === 'settings') renderSettings();
  }

  if (!state.clientId && demoMode) state.clientId = demoClients[0].id;
  render();
  if (!demoMode && state.logged) loadApiData();
})();
