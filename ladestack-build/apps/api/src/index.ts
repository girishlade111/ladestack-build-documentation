import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error";
import { health } from "./routes/health";
import { chat } from "./routes/chat";
import { projects } from "./routes/projects";
import { sessions } from "./routes/sessions";
import { skills } from "./routes/skills";
import { files } from "./routes/files";

const app = new Hono();

app.use("*", errorHandler);
app.use("*", cors({
  origin: ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
app.use("/api/*", authMiddleware);

app.route("/api/health", health);
app.route("/api/chat", chat);
app.route("/api/projects", projects);
app.route("/api/sessions", sessions);
app.route("/api/skills", skills);
app.route("/api/files", files);

const port = parseInt(process.env["PORT"] ?? "3001", 10);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`LadeStack API running on http://localhost:${info.port}`);
  }
);

export default app;
