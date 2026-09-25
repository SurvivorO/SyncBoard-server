import express from "express";
import cors from "cors";
import { json } from "node:stream/consumers";

const app = express();

app.use(cors);
app.use(express.json());

app.get("/",    (req, res) => {
    res.json({
        message: "API working ... "
    })
})

export default app;