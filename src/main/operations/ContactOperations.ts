/**
 * ContactOperations - Contact CRUD operations
 *
 * Handles parsing, adding, and removing contacts.
 * Import operations are in ContactImportOperations.ts.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { Contact, DataError } from "@shared/ipc";
import { parseCsvAsync, desanitizeField, stringifyCsv } from "../csvUtils";
import { cleanAndFormatPhoneNumber } from '../../shared/phoneUtils';
import { HeaderMatcher } from "../HeaderMatcher";
import { validateContacts, isValidEmail, isValidPhone } from "../csvValidation";
import { CONTACT_COLUMN_ALIASES } from "@shared/csvTypes";
import { FileContext, CONTACT_FILES } from "./FileContext";
import { loggers } from "../logger";

/**
 * Parse contacts.csv into an array of Contact objects
 */
export async function parseContacts(ctx: FileContext): Promise<Contact[]> {
  const path = await ctx.resolveExistingFile(CONTACT_FILES);
  if (!path) return [];

  try {
    const contents = await fs.readFile(path, "utf-8");
    const data = await parseCsvAsync(contents);

    if (data.length < 2) return [];

    const header = data[0].map((h: unknown) =>
      desanitizeField(String(h).trim().toLowerCase())
    );
    const rows = data.slice(1);

    const matcher = new HeaderMatcher(header);
    const phoneIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.phone);

    let needsWrite = false;

    if (phoneIdx !== -1) {
      for (let i = 1; i < data.length; i++) {
        const rawPhone = desanitizeField(data[i][phoneIdx]);
        if (rawPhone) {
          const cleaned = cleanAndFormatPhoneNumber(String(rawPhone));
          if (cleaned !== rawPhone) {
            data[i][phoneIdx] = cleaned;
            needsWrite = true;
          }
        }
      }
    }

    if (needsWrite) {
      loggers.fileManager.info("[ContactOperations] Cleaning phone numbers and rewriting contacts.csv...");
      const csvOutput = stringifyCsv(data);
      void ctx.rewriteFileDetached(path, csvOutput);
    }

    const results = rows.map((rowValues: string[]) => {
      const row: { [key: string]: string } = {};
      header.forEach((h: string, i: number) => {
        row[h] = desanitizeField(rowValues[i]);
      });

      const getField = (fieldNames: string[]) => {
        for (const fieldName of fieldNames) {
          if (row[fieldName.toLowerCase()]) return row[fieldName.toLowerCase()].trim();
        }
        return "";
      };

      const name = getField(["name", "full name"]);
      const email = getField(["email", "e-mail"]);
      const phone = getField(["phone", "phone number"]);
      const title = getField(["title", "role", "position", "department", "dept"]);

      return {
        name,
        email,
        phone,
        title,
        _searchString: `${name} ${email} ${phone} ${title}`.toLowerCase(),
        raw: row,
      };
    });

    const validation = validateContacts(results);
    if (validation.warnings.length > 0) {
      const error: DataError = {
        type: "validation",
        message: `Found ${validation.warnings.length} validation warnings in contacts.csv`,
        file: "contacts.csv",
        details: validation.warnings,
      };
      ctx.emitError(error);
    }

    return results;
  } catch (e) {
    const error: DataError = {
      type: "parse",
      message: "Error parsing contacts.csv",
      file: "contacts.csv",
      details: e instanceof Error ? e.message : String(e),
    };
    ctx.emitError(error);
    return [];
  }
}

/**
 * Remove a contact by email
 */
export async function removeContact(ctx: FileContext, email: string): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, CONTACT_FILES[0]);
    if (!existsSync(path)) return false;

    const contents = await fs.readFile(path, "utf-8");
    const data = await parseCsvAsync(contents);

    if (data.length < 2) return false;

    const header = data[0].map((h: unknown) => desanitizeField(String(h).toLowerCase()));
    const emailIdx = header.findIndex((h: string) => ["email", "e-mail"].includes(h));

    if (emailIdx === -1) return false;

    const newData = [data[0]];
    let removed = false;

    for (let i = 1; i < data.length; i++) {
      const val = desanitizeField(data[i][emailIdx]);
      if (val === email) {
        removed = true;
      } else {
        newData.push(data[i]);
      }
    }

    if (removed) {
      const csvOutput = ctx.safeStringify(newData);
      await ctx.writeAndEmit(path, csvOutput);
      void ctx.performBackup("removeContact");
      return true;
    }
    return false;
  } catch (e) {
    loggers.fileManager.error("[ContactOperations] removeContact error:", { error: e });
    return false;
  }
}

/**
 * Add or update a contact
 */
export async function addContact(ctx: FileContext, contact: Partial<Contact>): Promise<boolean> {
  try {
    const path = join(ctx.rootDir, CONTACT_FILES[0]);
    let contents = "";
    if (existsSync(path)) {
      contents = await fs.readFile(path, "utf-8");
    }

    const data = await parseCsvAsync(contents);
    const workingData = data.map((row) => row.map((cell: string) => desanitizeField(cell)));
    let workingHeader = workingData.length > 0 ? workingData[0] : [];

    const findIdxWorking = (names: string[]) =>
      workingHeader.findIndex((h: string) => names.includes(h.toLowerCase()));
    const ensureColWorking = (names: string[], defaultName: string) => {
      let idx = findIdxWorking(names);
      if (idx === -1) {
        workingHeader.push(defaultName);
        for (let i = 1; i < workingData.length; i++) workingData[i].push("");
        idx = workingHeader.length - 1;
      }
      return idx;
    };

    if (workingData.length === 0) {
      workingHeader = ["Name", "Title", "Email", "Phone"];
      workingData.push(workingHeader);
    }

    const nameIdx = ensureColWorking(["name", "full name"], "Name");
    const emailIdx = ensureColWorking(["email", "e-mail"], "Email");
    const titleIdx = ensureColWorking(["title", "role", "position"], "Title");
    const phoneIdx = ensureColWorking(["phone", "phone number"], "Phone");

    if (contact.phone) {
      contact.phone = cleanAndFormatPhoneNumber(contact.phone);
    }

    let rowIndex = -1;
    if (emailIdx !== -1 && contact.email) {
      if (!isValidEmail(contact.email)) {
        loggers.fileManager.warn(`[ContactOperations] Invalid email rejected: ${contact.email}`);
        return false;
      }
      rowIndex = workingData.findIndex((row, idx) => idx > 0 && row[emailIdx] === contact.email);
    }
    
    if (contact.phone && !isValidPhone(contact.phone)) {
        loggers.fileManager.warn(`[ContactOperations] Invalid phone rejected: ${contact.phone}`);
        return false;
    }

    if (rowIndex !== -1) {
      const row = workingData[rowIndex];
      if (nameIdx !== -1 && contact.name !== undefined) row[nameIdx] = contact.name;
      if (titleIdx !== -1 && contact.title !== undefined) row[titleIdx] = contact.title;
      if (phoneIdx !== -1 && contact.phone !== undefined) row[phoneIdx] = contact.phone;
    } else {
      const newRow = new Array(workingHeader.length).fill("");
      const setVal = (idx: number, val?: string) => {
        if (idx !== -1 && val !== undefined) newRow[idx] = val;
      };
      setVal(nameIdx, contact.name);
      setVal(emailIdx, contact.email);
      setVal(titleIdx, contact.title);
      setVal(phoneIdx, contact.phone);
      workingData.push(newRow);
    }

    const csvOutput = ctx.safeStringify(workingData);
    await ctx.writeAndEmit(path, csvOutput);
    void ctx.performBackup("addContact");
    return true;
  } catch (e) {
    loggers.fileManager.error("[ContactOperations] addContact error:", { error: e });
    return false;
  }
}
