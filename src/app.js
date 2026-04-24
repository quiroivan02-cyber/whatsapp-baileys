import express from "express";
import cors from "cors";
import webRoutes from "./routes/web.routes.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.use("/", webRoutes);

export default app;