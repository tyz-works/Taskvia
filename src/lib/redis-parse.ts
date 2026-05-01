export function parseRedisValue<T>(raw: string | object | null): T | null {
  if (raw === null) return null;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
}

export function parseRedisValues<T>(raws: (string | object | null)[]): T[] {
  return raws
    .filter((r): r is string | object => r !== null)
    .map((r) => parseRedisValue<T>(r)!);
}
