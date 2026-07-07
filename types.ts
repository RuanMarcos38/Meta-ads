export type User = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'CLIENT';
  tenant?: string;
  client?: string;
};

export type Client = { id: string; name: string; notes?: string };

export type Summary = {
  totals: {
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpc: number;
    cpm: number;
  };
  campaigns: Array<{
    provider: 'META' | 'GOOGLE';
    campaignExternalId: string;
    campaignName: string;
    clientName: string;
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
  }>;
  clients: Client[];
};
