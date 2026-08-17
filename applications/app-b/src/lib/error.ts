export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export function formatError(code: string, message: string, requestId: string): ApiErrorBody {
  return { error: { code, message, requestId } };
}
