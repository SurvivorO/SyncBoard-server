import express, { request } from "express";
import cors from "cors";
import { env } from "./env";

import { json } from "node:stream/consumers";

const app = express();

app.use(cors({
    origin: env.CORS_ORIGIN
}));
app.use(express.json());

// Routes

// health check
app.get('/health', (req, res) => res.json({
    status: 'ok'
}))

// Error Handler

export default app;