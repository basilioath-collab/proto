const diacriticPattern = /[\u0300-\u036f]/g;

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(diacriticPattern, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

interface CachedSearchText {
  signature: string;
  normalized: string;
}

/**
 * Keeps normalization work proportional to records that actually changed.
 * The signature also makes the cache safe when the legacy store mutates an
 * object in place instead of replacing its reference.
 */
export class SearchTextCache<T extends object = Record<string, unknown>> {
  private readonly entries = new WeakMap<T, CachedSearchText>();

  get(record: T, fields: readonly unknown[]): string {
    const signature = fields.map((field) => String(field ?? "")).join("\u0000");
    const cached = this.entries.get(record);

    if (cached?.signature === signature) return cached.normalized;

    const normalized = normalizeSearchText(signature);
    this.entries.set(record, { signature, normalized });
    return normalized;
  }

  matches(record: T, fields: readonly unknown[], query: unknown): boolean {
    const normalizedQuery = normalizeSearchText(query);
    return !normalizedQuery || this.get(record, fields).includes(normalizedQuery);
  }
}
