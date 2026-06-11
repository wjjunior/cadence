declare const txBrand: unique symbol;

// Module-private brand so a Tx cannot be forged outside infrastructure's single cast.
export type Tx = { readonly [txBrand]: true };

export interface UnitOfWork {
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}
