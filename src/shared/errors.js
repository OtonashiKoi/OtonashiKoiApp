class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

const ERROR_CODES = {
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  UNSUPPORTED_CURRENCY: "UNSUPPORTED_CURRENCY",
  UNAUTHORIZED: "UNAUTHORIZED",
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  ITEM_OUT_OF_STOCK: "ITEM_OUT_OF_STOCK",
  SHOP_ITEM_DISABLED: "SHOP_ITEM_DISABLED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR"
};

function isAppError(error) {
  return error instanceof AppError;
}

module.exports = {
  AppError,
  ERROR_CODES,
  isAppError
};
