export const webRefundStorage = (storage) => ({
  get: (key) => storage.getItem(key) ?? undefined,
  set: (key, value) => storage.setItem(key, JSON.stringify(value)),
  remove: (key) => storage.removeItem(key),
});
