import { describe, it, expect } from 'vitest';
import { mapMetaActions } from './metaActions.js';

describe('mapMetaActions', () => {
  it('soma leads e conversas corretamente', () => {
    const actions = [
      { action_type: 'lead', value: '5' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' },
    ];
    const r = mapMetaActions(actions);
    expect(r.leads).toBe(5);
    expect(r.conversations).toBe(3);
  });
  it('não quebra com actions vazio', () => {
    expect(mapMetaActions(undefined).leads).toBe(0);
  });
});
