export const ok = (data: unknown, message = '', meta: unknown = {}) => ({
  success: true, data, message, meta,
});
export const fail = (code: string, message: string, details: unknown = {}) => ({
  success: false, error: { code, message, details },
});
