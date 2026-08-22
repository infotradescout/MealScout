export const PUBLIC_SEO_SCAN_BATCH_SIZE = 100;

type ScanPublicSeoRowsInput<Row> = {
  loadBatch: (offset: number, limit: number) => Promise<Row[]>;
  visitBatch: (rows: Row[]) => boolean | void | Promise<boolean | void>;
  batchSize?: number;
};

/**
 * Deterministically walks a bounded SQL projection until the caller has found
 * enough public rows or the source is exhausted. Queries using this helper
 * must provide a stable order with a unique final tie-breaker.
 */
export async function scanPublicSeoRowsInBatches<Row>(
  input: ScanPublicSeoRowsInput<Row>,
) {
  const batchSize = Math.max(
    1,
    Math.min(input.batchSize || PUBLIC_SEO_SCAN_BATCH_SIZE, 500),
  );
  let offset = 0;
  for (;;) {
    const rows = await input.loadBatch(offset, batchSize);
    if (rows.length === 0) return;
    if ((await input.visitBatch(rows)) === false) return;
    if (rows.length < batchSize) return;
    offset += rows.length;
  }
}

export async function collectPublicSeoRowsInBatches<Row>(input: {
  loadBatch: (offset: number, limit: number) => Promise<Row[]>;
  selectVisible: (row: Row) => boolean;
  visibleLimit: number;
  batchSize?: number;
}) {
  const visible: Row[] = [];
  await scanPublicSeoRowsInBatches({
    loadBatch: input.loadBatch,
    batchSize: input.batchSize,
    visitBatch(rows) {
      for (const row of rows) {
        if (input.selectVisible(row)) visible.push(row);
        if (visible.length >= input.visibleLimit) return false;
      }
    },
  });
  return visible;
}
