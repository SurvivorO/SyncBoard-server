import type { ErrorRequestHandler } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

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

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next): void => {
    if (error instanceof AppError) {
        res.status(error.statusCode).json({
            error: error.message
        });
        return;
    }

    if (error instanceof z.ZodError) {
        res.status(400).json({
            error: "Validation failed",
            details: error.issues
        });
        return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json({
            error: "Invalid token"
        });
        return;
    }

    res.status(500).json({
        error: "Internal server error"
    });
};