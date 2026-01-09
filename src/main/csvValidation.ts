/** CSV data validation utilities */
import { ValidationError, ValidationResult } from '@shared/csvTypes';
import type { Contact, Server } from '@shared/ipc';
import { isValidEmail, isValidPhone } from './validationHelpers';

export { isValidEmail, isValidPhone };

export function validateContact(contact: Partial<Contact>, row: number): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!contact.email?.trim()) errors.push({ row, field: 'email', value: contact.email || '', message: 'Email is required' });
  else if (!isValidEmail(contact.email)) errors.push({ row, field: 'email', value: contact.email, message: 'Invalid email format' });
  if (!contact.name?.trim()) errors.push({ row, field: 'name', value: contact.name || '', message: 'Name is recommended (not required)' });
  if (contact.phone && !isValidPhone(contact.phone)) errors.push({ row, field: 'phone', value: contact.phone, message: 'Invalid phone format' });
  return errors;
}

export function validateServer(server: Partial<Server>, row: number): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!server.name?.trim()) errors.push({ row, field: 'name', value: server.name || '', message: 'Server name is required' });
  if (server.owner?.trim() && !isValidEmail(server.owner)) errors.push({ row, field: 'owner', value: server.owner, message: 'Invalid owner email format' });
  if (server.contact?.trim() && !isValidEmail(server.contact)) errors.push({ row, field: 'contact', value: server.contact, message: 'Invalid IT contact email format' });
  return errors;
}

export function findDuplicateContacts(contacts: Partial<Contact>[]): ValidationError[] {
  const errors: ValidationError[] = [], seen = new Map<string, number>();
  contacts.forEach((c, idx) => { const email = c.email?.toLowerCase().trim(); if (!email) return;
    const firstRow = seen.get(email); if (firstRow !== undefined) errors.push({ row: idx + 2, field: 'email', value: c.email || '', message: `Duplicate email (first seen on row ${firstRow})` });
    else seen.set(email, idx + 2); });
  return errors;
}

export function findDuplicateServers(servers: Partial<Server>[]): ValidationError[] {
  const errors: ValidationError[] = [], seen = new Map<string, number>();
  servers.forEach((s, idx) => { const name = s.name?.toLowerCase().trim(); if (!name) return;
    const firstRow = seen.get(name); if (firstRow !== undefined) errors.push({ row: idx + 2, field: 'name', value: s.name || '', message: `Duplicate server name (first seen on row ${firstRow})` });
    else seen.set(name, idx + 2); });
  return errors;
}

export function validateContacts(contacts: Partial<Contact>[]): ValidationResult {
  const errors: ValidationError[] = [], warnings: ValidationError[] = [];
  contacts.forEach((contact, idx) => { const errs = validateContact(contact, idx + 2); errs.forEach(e => e.message.includes('recommended') ? warnings.push(e) : errors.push(e)); });
  warnings.push(...findDuplicateContacts(contacts));
  return { valid: errors.length === 0, errors, warnings };
}

export function validateServers(servers: Partial<Server>[]): ValidationResult {
  const errors: ValidationError[] = [], warnings: ValidationError[] = [];
  servers.forEach((server, idx) => errors.push(...validateServer(server, idx + 2)));
  warnings.push(...findDuplicateServers(servers));
  return { valid: errors.length === 0, errors, warnings };
}
