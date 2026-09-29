export class AppError extends Error {
    constructor(
        public statusCode: number,
        message: string,
    ){
        super(message);
        this.name = 'AppError';
    }
}


// common error constructors for quick use

export const BadRequestError = (msg: string) => new AppError(400, msg);
export const UnauthorizedError = (msg: string) => new AppError(401, msg);
export const ForbiddenError = (msg: string) => new AppError(403, msg);
export const NotFoundError = (msg: string) => new AppError(404, msg);
export const ConflictError = (msg: string) => new AppError(409, msg);