import { env } from "./env.js";
import { db } from "./src/prisma/db.js";
import app from "./app.js";

const server = app.listen(env.PORT, () => {
    console.log(`🚀 Server running on http://localhost:${env.PORT} `);
});

// Graceful shutdown

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(async() => {
        await db.close();
        process.exit(0);
    })
})