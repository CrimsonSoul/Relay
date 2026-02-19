/**
 * CSV column definitions and type safety for CSV import operations
 */

// Column alias mappings for flexible header matching
export const SERVER_COLUMN_ALIASES = {
  name: ['name', 'vm-m', 'server name', 'vm name'],
  businessArea: ['business area', 'businessarea'],
  lob: ['lob', 'line of business'],
  comment: ['comment', 'comments', 'notes'],
  owner: ['owner', 'lob owner', 'lobowner'],
  contact: ['it contact', 'it tech support contact', 'it support', 'contact', 'tech support'],
  os: ['os type', 'server os', 'os'],
} as const;

export const CONTACT_COLUMN_ALIASES = {
  name: ['name', 'full name'],
  email: ['email', 'e-mail'],
  phone: ['phone', 'phone number', 'mobile'],
  title: ['title', 'role', 'position', 'department', 'dept'],
} as const;

// CSV parsing result types
export type CsvRow = string[];
