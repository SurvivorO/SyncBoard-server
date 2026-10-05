import express from "express";
import cors from "cors";
import { env } from "./env.js";
import errorHandler from "./src/modules/errors/errorHandler.js";
import authRoutes from "./src/modules/auth/authRoutes.js";
import { boardRoutes } from "./src/modules/boards/boardRoutes.js";
import listsRoutes from "./src/modules/lists/listsRoutes.js";

const app = express();

app.use(cors({
    origin: env.CORS_ORIGIN
}));
app.use(express.json());

// Routes
app.use('/auth', authRoutes);
app.use('/boards', boardRoutes());
app.use('/', listsRoutes);

// health check
app.get('/health', (req, res) => res.json({
    status: 'ok'
}))

// Error Handler
app.use(errorHandler);

export default app;