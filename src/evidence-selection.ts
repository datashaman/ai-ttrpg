import { createHash } from "node:crypto";

export interface RankedEvidenceItem<Item> {
  readonly item: Item;
  readonly priority: number;
  readonly order: number;
}

export const selectRankedEvidence = <Item extends { readonly id: string }>(
  candidates: readonly RankedEvidenceItem<Item>[],
  maxItems: number,
  deduplicate = false,
): readonly Item[] => {
  const seen = new Set<string>();
  return [...candidates]
    .sort((left, right) =>
      left.priority === right.priority
        ? left.order - right.order
        : left.priority - right.priority,
    )
    .filter(({ item }) => {
      if (!deduplicate) return true;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, maxItems)
    .map(({ item }) => item);
};

export const evidenceBundleId = (items: readonly unknown[]): string =>
  `evidence:${createHash("sha256").update(JSON.stringify(items)).digest("hex")}`;
