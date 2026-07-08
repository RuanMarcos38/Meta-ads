// Mapeia actions da Meta dinamicamente (nomes variam por conta/objetivo)
const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'leadgen.other', 'offsite_conversion.fb_pixel_lead'];
const CONV_TYPES = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'];
const PURCHASE_TYPES = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'];

type Action = { action_type: string; value: string };

function sumByTypes(actions: Action[] | undefined, types: string[]): number {
  if (!actions) return 0;
  return actions.filter(a => types.includes(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0);
}

export function mapMetaActions(actions?: Action[], primaryResultAction?: string) {
  const leads = sumByTypes(actions, LEAD_TYPES);
  const conversations = sumByTypes(actions, CONV_TYPES);
  const purchases = sumByTypes(actions, PURCHASE_TYPES);
  const primary = primaryResultAction ? sumByTypes(actions, [primaryResultAction]) : (leads || conversations || purchases);
  return { leads, conversations, purchases, primaryResult: primary };
}
