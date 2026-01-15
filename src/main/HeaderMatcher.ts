/**
 * Utility class for flexible CSV header matching and column management
 */

export class HeaderMatcher {
  private headers: string[];
  private lowerHeaders: string[];

  constructor(headers: string[]) {
    this.headers = headers;
    this.lowerHeaders = headers.map(h => String(h).toLowerCase().trim());
  }

  /**
   * Find column index by checking multiple possible aliases (case-insensitive)
   * Checks aliases in priority order - returns first match
   */
  findColumn(aliases: string[]): number {
    for (const alias of aliases) {
      const idx = this.lowerHeaders.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  }

  /**
   * Ensure a column exists, creating it if necessary
   * @param aliases - Possible column names to search for
   * @param defaultName - Name to use if column needs to be created
   * @param data - Optional data array to extend with empty values
   * @returns Column index
   */
  ensureColumn(aliases: string[], defaultName: string, data?: any[][]): number {
    let idx = this.findColumn(aliases);

    if (idx === -1) {
      // Add new column
      this.headers.push(defaultName);
      this.lowerHeaders.push(defaultName.toLowerCase());

      // Extend data rows with empty values if data provided
      if (data) {
        for (let i = 1; i < data.length; i++) {
          data[i].push('');
        }
      }

      idx = this.headers.length - 1;
    }

    return idx;
  }

  /**
   * Ensure multiple columns exist, creating them if necessary
   * Optimized to iterate over data only once
   * @param columns - Array of column definitions { aliases: string[], defaultName: string }
   * @param data - Optional data array to extend with empty values
   * @returns Array of column indices corresponding to the input columns
   */
  ensureColumns(columns: { aliases: string[], defaultName: string }[], data?: any[][]): number[] {
    const indices: number[] = new Array(columns.length).fill(-1);
    const columnsToAdd: { defaultName: string, indexInInput: number }[] = [];

    // First pass: identify existing columns and which ones need to be added
    for (let i = 0; i < columns.length; i++) {
      const idx = this.findColumn(columns[i].aliases);
      if (idx !== -1) {
        indices[i] = idx;
      } else {
        columnsToAdd.push({ defaultName: columns[i].defaultName, indexInInput: i });
      }
    }

    if (columnsToAdd.length > 0) {
      const newColsCount = columnsToAdd.length;

      // Add headers
      for (const col of columnsToAdd) {
        this.headers.push(col.defaultName);
        this.lowerHeaders.push(col.defaultName.toLowerCase());
      }

      const firstNewIndex = this.headers.length - newColsCount;

      // Extend data rows with empty values if data provided
      if (data) {
        for (let i = 1; i < data.length; i++) {
          for (let j = 0; j < newColsCount; j++) {
            data[i].push('');
          }
        }
      }

      // Update indices for added columns
      for (let i = 0; i < newColsCount; i++) {
        indices[columnsToAdd[i].indexInInput] = firstNewIndex + i;
      }
    }

    return indices;
  }

  /**
   * Get the actual header name at an index
   */
  getHeader(index: number): string | undefined {
    return this.headers[index];
  }

  /**
   * Get all headers
   */
  getHeaders(): string[] {
    return [...this.headers];
  }

  /**
   * Check if a header exists
   */
  hasColumn(aliases: string[]): boolean {
    return this.findColumn(aliases) !== -1;
  }

  /**
   * Get column index, throwing error if not found
   */
  requireColumn(aliases: string[], errorMessage?: string): number {
    const idx = this.findColumn(aliases);
    if (idx === -1) {
      throw new Error(errorMessage || `Required column not found. Tried: ${aliases.join(', ')}`);
    }
    return idx;
  }
}
