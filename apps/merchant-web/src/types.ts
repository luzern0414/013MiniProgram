export type User = {
  id: string;
  name: string;
  role: string;
  storeIds: string[];
};
export type DraftSelection = {
  mode: 'PICKUP' | 'DINE_IN'; tableCode?: string; pickupSlotId?: string; note: string;
  lines: { skuId: string; quantity: number; modifierIds: string[]; attributeOptionIds: string[] }[];
};
export type CashierDraft = {
  id: string; storeId: string; name: string; revision: number;
  state: 'DRAFT' | 'CONVERTED' | 'CANCELLED'; selection: DraftSelection;
  display: { lines: { skuId: string; productName: string; skuName: string; modifierNames: string[]; attributeNames: string[] }[] };
  orderId: string | null; createdAt: string; updatedAt: string;
};
export type Store = {
  id: string;
  name: string;
  address: string;
  phone: string;
  notice: string;
  isOpen: boolean;
  serviceModes: string[];
  pickupMinutes: number;
  deliveryFeeFen: number;
  minOrderFen: number;
  themeColor: string;
};
export type AttributeSnapshot = {
  groupId: string;
  groupName: string;
  options: { id: string; name: string }[];
};
export type SpecGroup = {
  id: string;
  name: string;
  enabled: boolean;
  values: { id: string; name: string; enabled: boolean }[];
};
export type AttributeGroup = {
  id: string;
  name: string;
  enabled: boolean;
  minSelections: number;
  maxSelections: number;
  options: { id: string; name: string; enabled: boolean }[];
};
export type Sku = {
  enabled?: boolean;
  selections?: { groupRef: string; valueRef: string }[];
  id: string;
  name: string;
  priceFen: number;
  available: number;
};
export type Modifier = {
  enabled?: boolean;
  id: string;
  name: string;
  priceFen: number;
  available: number;
};
export type Product = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  unit: string;
  unitId: string | null;
  isAvailable: boolean;
  configurationRevision?: number;
  specGroups?: SpecGroup[];
  attributeGroups?: AttributeGroup[];
  skus: Sku[];
  modifiers: Modifier[];
};
export type Catalog = {
  categories: { id: string; name: string; sort: number }[];
  products: Product[];
};
export type Order = {
  cashReceipt: null | {
    shiftId?: string | null;
    amountFen: number;
    tenderedFen: number;
    changeFen: number;
    refundedFen?: number;
  };
  refundedFen?: number;
  netPaidFen?: number;
  cashRefunds?: { id: string; amountFen: number; reason: string; createdAt: string; shiftId?: string | null }[];
  id: string;
  number: string;
  storeId: string;
  storeName: string;
  status: string;
  paymentStatus: string;
  refundStatus: string;
  mode: string;
  totalFen: number;
  note: string;
  tableName: string | null;
  pickupNumber: string | null;
  pickupServiceDate?: string | null;
  pickupOrdinal?: number | null;
  pickupWindow?: {
    slotId: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    serviceDate: string;
  } | null;
  createdAt: string;
  lines: {
    attributes?: AttributeSnapshot[];
    attributeOptionIds?: string[];
    configurationRevision?: number;
    skuId: string;
    productName: string;
    skuName: string;
    quantity: number;
    lineTotalFen: number;
    modifiers: { id: string; name: string; priceFen: number }[];
  }[];
  events: { id: string; status: string; label: string; createdAt: string }[];
};
export type PageContent = {
  notice: string;
  bannerTitle: string;
  bannerSubtitle: string;
  primaryColor: string;
};
export type PageData = {
  draft: PageContent;
  published: PageContent;
  version: number;
};
