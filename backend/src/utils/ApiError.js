export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
  static badRequest(m = 'Bad request', d) { return new ApiError(400, m, d); }
  static unauthorized(m = 'Unauthorized') { return new ApiError(401, m); }
  static forbidden(m = 'Forbidden') { return new ApiError(403, m); }
  static notFound(m = 'Not found') { return new ApiError(404, m); }
  static conflict(m = 'Conflict', d) { return new ApiError(409, m, d); }
  static tooMany(m = 'Too many requests') { return new ApiError(429, m); }
}
