// User Roles
export type UserRole = 'admin' | 'camp_worker' | 'purchasing_supervisor' | 'purchasing_team';

export interface User {
  id: number;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  property_id: number | null;
  property_name?: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Property {
  id: number;
  name: string;
  code: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface Item {
  id: number;
  name: string;
  brand: string | null;
  category_id: number | null;
  category_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  unit: string;
  unit_price: number | null;
  price: number | null;
  quantity_per_unit: number | null;
  par_level: number | null;
  current_stock: number | null;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface CreateItemPayload {
  name: string;
  brand?: string | null;
  category_id?: number | null;
  supplier_id?: number | null;
  unit?: string;
  unit_price?: number | null;
  price?: number | null;
  quantity_per_unit?: number | null;
  par_level?: number | null;
  current_stock?: number | null;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  notes?: string | null;
}

export interface InventoryItem {
  id: number;
  property_id: number;
  name: string;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  brand: string | null;  // Preferred brand
  qty: string | null;  // Product size e.g., "50#", "5 Gal"
  product_notes: string | null;  // Purchasing notes (e.g., "individually wrapped")
  supplier_id: number | null;
  supplier_name: string | null;
  unit: string;
  order_unit: string | null;  // Order unit (e.g., "case" when counting by "box")
  units_per_order_unit: number | null;  // Conversion factor (e.g., 8 boxes per case)
  effective_order_unit: string | null;  // Order unit or falls back to inventory unit
  par_level: number | null;
  order_at: number | null;
  current_stock: number;
  avg_weekly_usage: number | null;
  unit_price: number | null;
  sort_order: number;
  is_active: boolean;
  is_recurring: boolean;
  is_low_stock: boolean;
  suggested_order_qty: number;  // Now in order units
  created_at: string;
  updated_at: string | null;
}

// Order System
export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'changes_requested'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type OrderItemFlag = 'low_stock' | 'trend_suggested' | 'manual' | 'custom' | 'previous_shortage';

export interface OrderItem {
  id: number;
  order_id: number;
  inventory_item_id: number | null;
  custom_item_name: string | null;
  requested_quantity: number;
  approved_quantity: number | null;
  received_quantity: number | null;
  unit: string;
  unit_price: number | null;
  flag: OrderItemFlag | null;
  notes: string | null;
  reviewer_notes: string | null;
  item_name?: string | null;
  category?: string | null;
  supplier_id?: number | null;
  supplier_name?: string | null;
  par_level?: number | null;
  current_stock?: number | null;
  final_quantity?: number;
  line_total?: number;
  is_received?: boolean;
  has_issue?: boolean;
  issue_description?: string | null;
  issue_photo_url?: string | null;
  shortage_dismissed?: boolean;
  receiving_notes?: string | null;
}

export interface Order {
  id: number;
  order_number?: string;
  property_id: number;
  property_name?: string | null;
  week_of: string;
  status: OrderStatus;
  created_by: number;
  created_by_name?: string | null;
  reviewed_by: number | null;
  reviewed_by_name?: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  ordered_at: string | null;
  received_at: string | null;
  notes: string | null;
  review_notes: string | null;
  estimated_total?: number;
  actual_total?: number | null;
  total_requested_value: number | null;
  total_approved_value: number | null;
  created_at: string;
  updated_at: string | null;
  items: OrderItem[];
  item_count?: number;
}

// Inventory Counting
export interface InventoryCountItem {
  id: number;
  count_id: number;
  inventory_item_id: number;
  counted_quantity: number | null;
  item_name?: string | null;
  unit?: string | null;
  par_level?: number | null;
}

export interface InventoryCount {
  id: number;
  property_id: number;
  property_name?: string | null;
  count_date: string;
  counted_by: number;
  counted_by_name?: string | null;
  notes: string | null;
  is_complete: boolean;
  photo_url: string | null;
  ai_suggestions: any | null;
  created_at: string;
  updated_at: string | null;
  items: InventoryCountItem[];
}

// Receipt System
export interface ReceiptLineItem {
  item_name?: string;
  name?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
  total?: number;
  matched_order_item_id?: number | null;
  matched_order_item_name?: string | null;
  matched_inventory_item_id?: number | null;
}

export interface UnmatchedReceiptItem {
  item_name: string;
  suggested_name?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  suggested_category?: string | null;
}

export interface Receipt {
  id: number;
  order_id: number | null;
  property_id?: number | null;
  property_name?: string | null;
  supplier_id: number | null;
  supplier_name?: string | null;
  detected_supplier_name?: string | null;
  image_url: string;
  receipt_date: string | null;
  receipt_number: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  line_items: ReceiptLineItem[] | null;
  unmatched_items?: UnmatchedReceiptItem[] | null;
  is_processed: boolean;
  processing_error: string | null;
  confidence_score: number | null;
  is_manually_verified: boolean;
  verified_by: number | null;
  verified_at: string | null;
  uploaded_by: number;
  uploaded_by_name?: string | null;
  notes: string | null;
  order_number?: string | null;
  created_at: string;
  updated_at: string | null;
}

// Dashboard Data
export interface SupplierSpendingSummary {
  supplier_id: number;
  supplier_name: string;
  total_spent: number;
  receipt_count: number;
  avg_receipt_amount: number;
}

export interface PropertySpendingSummary {
  property_id: number;
  property_name: string;
  total_spent: number;
  receipt_count: number;
  order_count: number;
}

export interface SpendingByPeriod {
  period: string;
  total_spent: number;
  receipt_count: number;
  order_count: number;
}

export interface FinancialDashboard {
  total_spent_this_month: number;
  total_spent_this_year: number;
  pending_orders_total: number;
  receipts_pending_verification: number;
  spending_by_supplier: SupplierSpendingSummary[];
  spending_by_property: PropertySpendingSummary[];
  spending_trend: SpendingByPeriod[];
  total_spending?: number;
  avg_receipt_total?: number;
  receipt_count?: number;
}

export interface PropertyDashboard {
  property: Property;
  inventory_count: number;
  low_stock_count: number;
  pending_orders: number;
  recent_counts: InventoryCount[];
}

// Auth
export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthToken {
  access_token: string;
  token_type: string;
}

// Create/Update Payloads
export interface CreatePropertyPayload {
  name: string;
  code: string;
  address?: string | null;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  full_name?: string | null;
  role: UserRole;
  property_id?: number | null;
}

export interface UpdateUserPayload {
  email?: string;
  full_name?: string | null;
  role?: UserRole;
  property_id?: number | null;
  is_active?: boolean;
}

export interface CreateSupplierPayload {
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface CreateInventoryItemPayload {
  property_id: number;
  name: string;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  brand?: string | null;  // Preferred brand
  qty?: string | null;  // Product size e.g., "50#", "5 Gal"
  product_notes?: string | null;  // Purchasing notes
  supplier_id?: number | null;
  unit: string;
  order_unit?: string | null;
  units_per_order_unit?: number | null;
  par_level?: number | null;
  order_at?: number | null;
  current_stock?: number;
  unit_price?: number | null;
  is_recurring?: boolean;
}

export interface CreateOrderPayload {
  property_id: number;
  week_of?: string;
  notes?: string | null;
  items: {
    inventory_item_id?: number | null;
    custom_item_name?: string | null;
    requested_quantity: number;
    unit?: string | null;
    unit_price?: number | null;
    flag?: OrderItemFlag | null;
    camp_notes?: string | null;
  }[];
}

export interface UpdateOrderItemPayload {
  // Using standardized naming (approved_quantity, reviewer_notes)
  // Backend also accepts quantity_approved and review_notes for backwards compatibility
  approved_quantity?: number | null;
  reviewer_notes?: string | null;
  supplier_id?: number | null;
}

export interface CreateInventoryCountPayload {
  property_id: number;
  notes?: string | null;
  items: {
    inventory_item_id: number;
    quantity: number;
    notes?: string | null;
    confidence?: number | null;
  }[];
}

export interface CreateReceiptPayload {
  order_id?: number | null;
  supplier_id?: number | null;
  image_url: string;
  notes?: string | null;
}

// Role permission helpers
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  camp_worker: 'Camp Team',
  purchasing_supervisor: 'Purchasing Support',
  purchasing_team: 'Purchasing Team',
};

export const canManageUsers = (role: UserRole): boolean => role === 'admin';
export const canManageProperties = (role: UserRole): boolean => role === 'admin';
export const canManageInventory = (role: UserRole): boolean => role === 'camp_worker' || role === 'admin';
export const canCreateOrders = (role: UserRole): boolean => role === 'camp_worker';
export const canReviewOrders = (role: UserRole): boolean => role === 'purchasing_supervisor';
export const canManageReceipts = (role: UserRole): boolean => role === 'purchasing_team' || role === 'purchasing_supervisor';
export const canViewAllProperties = (role: UserRole): boolean => role !== 'camp_worker';

// Supplier Purchase List (for viewing approved orders grouped by supplier)
export interface SupplierPurchaseItem {
  item_id: number;
  item_name: string;
  category: string | null;
  brand: string | null;  // Preferred brand
  qty: string | null;  // Product size e.g., "50#", "5 Gal"
  product_notes: string | null;  // Purchasing notes
  quantity: number;
  unit: string;
  unit_price: number | null;
  line_total: number | null;
  order_id: number;
  order_number: string;
  property_name: string;
}

export interface SupplierPurchaseGroup {
  supplier_id: number | null;
  supplier_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  items: SupplierPurchaseItem[];
  total_items: number;
  total_value: number;
}

export interface SupplierPurchaseList {
  suppliers: SupplierPurchaseGroup[];
  order_ids: number[];
  total_orders: number;
  grand_total: number;
}

// Flagged items for purchasing team dashboard
export interface FlaggedItem {
  item_id: number;
  item_name: string;
  order_id: number;
  order_number: string;
  property_id: number;
  property_name: string;
  received_quantity: number;
  approved_quantity: number | null;
  has_issue: boolean;
  issue_description: string | null;
  issue_photo_url: string | null;
  receiving_notes: string | null;
  received_at: string | null;
  flagged_by_name: string | null;
}

export interface FlaggedItemsList {
  items: FlaggedItem[];
  total_count: number;
}

// Receiving payload for order items
export interface ReceiveItemPayload {
  item_id: number;
  received_quantity: number;
  has_issue?: boolean;
  issue_description?: string;
  receiving_notes?: string;
}

// Receipt Code Alias types
export interface ReceiptCodeAlias {
  id: number;
  inventory_item_id: number;
  supplier_id: number | null;
  receipt_code: string;
  unit_price: number | null;
  last_seen: string | null;
  match_count: number;
  is_active: boolean;
  created_at: string;
  item_name?: string | null;
  supplier_name?: string | null;
}

export interface MatchReceiptItemRequest {
  receipt_code: string;
  inventory_item_id: number;
  supplier_id?: number | null;
  unit_price?: number | null;
  receipt_id?: number | null;
}

// Purchase Order System
export interface PurchaseOrderItem {
  id: number;
  purchase_order_id: number;
  item_id: number | null;
  item_name: string | null;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
}

export interface PurchaseOrder {
  id: number;
  order_number: string;
  supplier_id: number | null;
  supplier_name: string | null;
  status: string;
  notes: string | null;
  total_amount: number | null;
  created_by: number;
  created_by_name: string | null;
  approved_by: number | null;
  submitted_at: string | null;
  approved_at: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string | null;
  items: PurchaseOrderItem[];
}

export interface CreatePurchaseOrderPayload {
  supplier_id: number;
  notes?: string | null;
  items: {
    item_id: number;
    quantity: number;
    unit_price?: number | null;
  }[];
}

// Unreceived items from previous orders (aggregated by inventory item)
export interface UnreceivedItem {
  inventory_item_id: number | null;
  item_name: string;
  total_shortage: number;
  unit: string | null;
  unit_price: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  property_id: number | null;
  property_name: string | null;
  source_order_item_ids: number[];
  latest_order_number: string | null;
  latest_week_of: string | null;
  order_count: number;
}

export interface UnreceivedItemsList {
  items: UnreceivedItem[];
  total_count: number;
  total_shortage_value: number;
}

// Master Product System
export interface MasterProduct {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  subcategory: string | null;
  seasonal_availability: string | null;  // midnight_sun, aurora, year_round
  description: string | null;
  brand: string | null;
  qty: string | null;  // Product size e.g., "50#", "5 Gal"
  product_notes: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  unit: string;
  order_unit: string | null;
  units_per_order_unit: number | null;
  unit_price: number | null;
  default_par_level: number | null;
  default_order_at: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  assigned_property_count: number;
}

export interface PropertyAssignment {
  property_id: number;
  property_name: string;
  property_code: string;
  inventory_item_id: number;
  current_stock: number;
  par_level: number | null;
  order_at: number | null;
  is_synced: boolean;
}

export interface MasterProductWithAssignments extends MasterProduct {
  assignments: PropertyAssignment[];
}

export interface CreateMasterProductPayload {
  name: string;
  sku?: string | null;
  category?: string | null;
  subcategory?: string | null;
  seasonal_availability?: string | null;
  description?: string | null;
  brand?: string | null;
  qty?: string | null;
  product_notes?: string | null;
  supplier_id?: number | null;
  unit?: string;
  order_unit?: string | null;
  units_per_order_unit?: number | null;
  unit_price?: number | null;
  default_par_level?: number | null;
  default_order_at?: number | null;
}

export interface UpdateMasterProductPayload extends Partial<CreateMasterProductPayload> {
  is_active?: boolean;
}

export interface AssignMasterProductRequest {
  property_ids: number[];
  par_level?: number | null;
  order_at?: number | null;
}

export interface SyncFromMasterRequest {
  inventory_item_ids: number[];
  sync_fields?: string[];
}

export interface SeedFromPropertyRequest {
  property_id: number;
  item_ids?: number[] | null;
}

export interface UnlinkedInventoryItem {
  id: number;
  name: string;
  category: string | null;
  unit: string;
  property_id: number;
  property_name: string | null;
  property_code: string | null;
}
