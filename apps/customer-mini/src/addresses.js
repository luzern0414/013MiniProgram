import {
  addressStorageKey,
  addressErrorText,
  createCustomerAddresses,
} from "@restaurant/mini-core";

const copy = (value) => JSON.parse(JSON.stringify(value));

// uni returns an empty value for absent keys. Enumerate first so absent,
// empty and damaged records can be distinguished without scanning identities.
export function uniAddressStorage(runtime = uni) {
  return {
    get(key) {
      const keys = runtime.getStorageInfoSync().keys;
      if (!Array.isArray(keys)) throw Error("无法核对本机储存");
      return keys.includes(key) ? runtime.getStorageSync(key) : undefined;
    },
    set: (key, value) => runtime.setStorageSync(key, copy(value)),
    remove: (key) => runtime.removeStorageSync(key),
  };
}

export function createMiniCustomerAddresses({
  state,
  request,
  context,
  storage = uniAddressStorage(),
  locked = () => false,
  key,
}) {
  const controller = createCustomerAddresses({
    state,
    request,
    context,
    storage,
    locked,
    key,
  });
  let alive = true;
  const discover = () => {
    if (alive) controller.discover();
  };
  const write =
    (method) =>
    async (...args) => {
      if (!alive) return false;
      discover();
      return controller[method](...args);
    };
  return {
    state,
    discover,
    load: async () => {
      if (!alive) return false;
      discover();
      return controller.load();
    },
    get: async (...args) => {
      if (!alive) return false;
      discover();
      return controller.get(...args);
    },
    beginCreate: (...args) => {
      if (!alive) return false;
      discover();
      return controller.beginCreate(...args);
    },
    beginEdit: (...args) => {
      if (!alive) return false;
      discover();
      return controller.beginEdit(...args);
    },
    cancelEdit: (...args) => {
      if (!alive) return false;
      return controller.cancelEdit(...args);
    },
    create: write("create"),
    update: write("update"),
    setDefault: write("setDefault"),
    remove: write("remove"),
    reloadForReview: async (...args) => {
      if (!alive) return false;
      return controller.reloadForReview(...args);
    },
    acceptReview: (...args) => {
      if (!alive) return false;
      return controller.acceptReview(...args);
    },
    recover: write("recover"),
    dispose() {
      alive = false;
      controller.dispose();
    },
  };
}

export { addressErrorText, addressStorageKey };
