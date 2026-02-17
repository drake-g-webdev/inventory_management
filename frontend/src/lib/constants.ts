// Shared constants used across the application

// Standard units of measure - used for inventory items, orders, etc.
export const UNITS = [
  'Each',
  'Lb',
  'Oz',
  'Gallon',
  'Quart',
  'Pint',
  'Case',
  'Box',
  'Bag',
  'Dozen',
  'Bunch',
  'Bundle',
  'Head',
  'Jar',
  'Can',
  'Bottle',
  'Pack',
  'Roll',
  'Sheet',
  'Unit'
] as const;

export type UnitType = typeof UNITS[number];

// Standard inventory categories
export const CATEGORIES = [
  'Bakery',
  'Beverages',
  'Canned Goods',
  'Cleaning Supplies',
  'Condiments',
  'Dairy',
  'Dry Goods',
  'Frozen',
  'Packaged Snacks',
  'Paper & Plastic Goods',
  'Produce',
  'Protein',
  'Spices',
  'Other',
] as const;

// Default units for common categories and subcategories
export const SUBCATEGORY_DEFAULT_UNITS: Record<string, string> = {
  // Categories
  'Produce': 'Lb',
  'Meat': 'Lb',
  'Canned Goods': 'Can',
  'Dairy': 'Each',
  'Dry Goods': 'Each',
  'Beverages': 'Case',
  'Frozen': 'Each',
  'Cleaning': 'Each',
  // Beverage subcategories
  'BIB': 'Unit',
  'Cans/Bottles': 'Case',
  'Dry': 'Each',
  'Concentrate': 'Each',
};
