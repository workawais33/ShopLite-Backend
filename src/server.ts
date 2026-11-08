
import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import productRoutes from "./routes/productRoutes.js";
import adminProductRoutes from "./routes/adminProductRoutes.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import stripeWebhookRoutes from "./routes/stripeWebhookRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import adminDashboardRoutes from "./routes/adminDashboardRoutes.js";

const app = express();
const port = Number(process.env.PORT) || 5000;

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(helmet());

app.use(
  cors({
    origin: frontendUrl,
  })
);

app.use(morgan("dev"));

app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookRoutes
);

app.use(
  express.json({
    limit: "10kb",
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "ShopLite Backend is running",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "ShopLite API is running",
  });
});

app.use("/api/products", productRoutes);
app.use("/api/admin/products", adminProductRoutes);
app.use("/api/admin", adminDashboardRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/orders", orderRoutes);

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
);

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`ShopLite API running on http://localhost:${port}`);
  });
}

export default app;
