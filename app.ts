import express, { request } from "express";
import cors from "cors";
import { env } from "./env";
import errorHandler from "./src/modules/errors/errorHandler.js";
import authRoutes from "./src/modules/auth/authRoutes.js";

import { json } from "node:stream/consumers";

const app = express();

app.use(cors({
    origin: env.CORS_ORIGIN
}));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);

// health check
app.get('/health', (req, res) => res.json({
    status: 'ok'
}))

// Error Handler
app.use(errorHandler);

export default app;