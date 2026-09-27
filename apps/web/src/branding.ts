export type Branding = {
  enabled: boolean;
  name: string;
  subtitle: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  domain?: string | null;
};

export const defaultBranding: Branding = {
  enabled: false,
  name: 'Gestão Ads',
  subtitle: 'R2R Marketing Digital',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#2563eb',
  secondaryColor: '#1e40af',
  supportEmail: null,
  supportPhone: null,
  domain: null,
};

export function normalizeBranding(value: any): Branding {
  return {
    ...defaultBranding,
    ...(value || {}),
    name: String(value?.name || defaultBranding.name),
    subtitle: String(value?.subtitle || defaultBranding.subtitle),
    primaryColor: String(value?.primaryColor || defaultBranding.primaryColor),
    secondaryColor: String(value?.secondaryColor || defaultBranding.secondaryColor),
  };
}

export function applyBranding(branding: Branding) {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', branding.primaryColor || defaultBranding.primaryColor);
  root.style.setProperty('--brand-secondary', branding.secondaryColor || defaultBranding.secondaryColor);
  document.title = branding.name || defaultBranding.name;

  if (branding.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = branding.faviconUrl;
  }
}
