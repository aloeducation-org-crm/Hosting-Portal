import { v4 as uuidv4 } from "uuid";

type ApiSuccessResponse<T = unknown> = {
  status: number;
  success: true;
  message: string;
  data: T;
  error: null;
  requestId: string;
};

type ApiErrorResponse = {
  status: number;
  success: false;
  message: string;
  data: null;
  error: {
    code: string;
    details?: unknown;
  };
  requestId: string;
};

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

export function apiSuccess<T>(
  data?: T,
  message: string = "Success",
  status: number = 200,
): ApiSuccessResponse<T> {
  return {
    status,
    success: true,
    message,
    data: (data ?? null) as T,
    error: null,
    requestId: uuidv4(),
  };
}

export function apiError(
  message: string,
  code: string = "INTERNAL_ERROR",
  details?: unknown,
  status: number = 500,
): ApiErrorResponse {
  return {
    status,
    success: false,
    message,
    data: null,
    error: {
      code,
      ...(details !== undefined && { details }),
    },
    requestId: uuidv4(),
  };
}
