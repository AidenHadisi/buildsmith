export type StoreErrorCode = "not_found" | "ambiguous_id" | "conflict" | "invalid_input";

export class StoreError extends Error {
  override readonly name = "StoreError";
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}
