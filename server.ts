import http from "node:http";
import { env } from "./env.js";
import { db } from "./src/prisma/db.js";
import app from "./app.js";
import { initSocketServer, closeSocketServer } from "./src/modules/realtime/index.js";

const httpServer = http.createServer(app);
initSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT} `);
});

// Graceful shutdown
const handleShutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down gracefully`);
    await closeSocketServer();
    httpServer.close(async () => {
        await db.close();
        process.exit(0);
    });
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));