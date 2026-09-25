import {config} from "dotenv";
import app from "./app.js";

config();

const PORT = process.env.EXPRESS_PORT;

app.listen(PORT, () => {
    console.log("server started at :", PORT);
})



