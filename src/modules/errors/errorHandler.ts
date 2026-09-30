import type { ErrorRequestHandler } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { AppError } from "./AppError";

const errorHandler: ErrorRequestHandler = (error, _req, res, _next): void => {
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

export { errorHandler };
export default errorHandler;