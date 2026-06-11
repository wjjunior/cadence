declare const txBrand: unique symbol;

// Opaque transaction handle. A live transaction object cannot be reconstructed
// outside infrastructure, so the brand is a module-private unique symbol (not a
// forgeable string literal). The single concrete cast lives in infrastructure (CAD-15).
export type Tx = { readonly [txBrand]: true };

export interface UnitOfWork {
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}
