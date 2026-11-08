import { Router, Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";

const router = Router();

const productSchema = z.object({
name: z.string().trim().min(1).max(150),
description: z.string().trim().max(2000).optional().default(""),
price: z.number().int().min(0),
image_url: z.string().trim().url().optional().or(z.literal("")),
});

const getUserFromRequest = async (req: Request) => {
const authorization = req.headers.authorization;

if (!authorization?.startsWith("Bearer ")) {
return null;
}

const accessToken = authorization.replace("Bearer ", "").trim();
const { data, error } = await supabase.auth.getUser(accessToken);

if (error || !data.user) {
return null;
}

return data.user;
};

const checkAdmin = async (req: Request) => {
const user = await getUserFromRequest(req);

if (!user) {
return {
status: 401,
message: "Authentication required.",
};
}

const { data: profile, error } = await supabase
.from("profiles")
.select("role")
.eq("id", user.id)
.maybeSingle();

if (error) {
throw new Error(error.message);
}

if (!profile || profile.role !== "admin") {
return {
status: 403,
message: "Admin access required.",
};
}

return {
status: 200,
message: "",
};
};

router.get("/", async (_req, res, next) => {
try {
const { data, error } = await supabase
.from("products")
.select("*")
.order("created_at", { ascending: false });

if (error) {
  throw new Error(error.message);
}

const activeProducts = (data ?? []).filter(
  (product) => product.is_active !== false
);

res.json({
  success: true,
  data: activeProducts,
});

} catch (error) {
next(error);
}
});

router.get("/:id", async (req, res, next) => {
try {
const { data, error } = await supabase
.from("products")
.select("*")
.eq("id", req.params.id)
.maybeSingle();

if (error) {
  throw new Error(error.message);
}

if (!data || data.is_active === false) {
  res.status(404).json({
    success: false,
    message: "Product not found.",
  });
  return;
}

res.json({
  success: true,
  data,
});

} catch (error) {
next(error);
}
});

router.post("/admin", async (req, res, next) => {
try {
const admin = await checkAdmin(req);

if (admin.status !== 200) {
  res.status(admin.status).json({
    success: false,
    message: admin.message,
  });
  return;
}

const parsed = productSchema.safeParse(req.body);

if (!parsed.success) {
  res.status(400).json({
    success: false,
    message: "Invalid product data.",
  });
  return;
}

const { data, error } = await supabase
  .from("products")
  .insert({
    name: parsed.data.name,
    description: parsed.data.description,
    price: parsed.data.price,
    image_url: parsed.data.image_url || null,
    is_active: true,
  })
  .select("*")
  .single();

if (error) {
  throw new Error(error.message);
}

res.status(201).json({
  success: true,
  data,
});

} catch (error) {
next(error);
}
});

router.put("/admin/:id", async (req, res, next) => {
try {
const admin = await checkAdmin(req);

if (admin.status !== 200) {
  res.status(admin.status).json({
    success: false,
    message: admin.message,
  });
  return;
}

const parsed = productSchema.safeParse(req.body);

if (!parsed.success) {
  res.status(400).json({
    success: false,
    message: "Invalid product data.",
  });
  return;
}

const { data, error } = await supabase
  .from("products")
  .update({
    name: parsed.data.name,
    description: parsed.data.description,
    price: parsed.data.price,
    image_url: parsed.data.image_url || null,
    updated_at: new Date().toISOString(),
  })
  .eq("id", req.params.id)
  .select("*")
  .maybeSingle();

if (error) {
  throw new Error(error.message);
}

if (!data) {
  res.status(404).json({
    success: false,
    message: "Product not found.",
  });
  return;
}

res.json({
  success: true,
  data,
});

} catch (error) {
next(error);
}
});

router.delete("/admin/:id", async (req, res, next) => {
try {
const admin = await checkAdmin(req);

if (admin.status !== 200) {
  res.status(admin.status).json({
    success: false,
    message: admin.message,
  });
  return;
}

const { data, error } = await supabase
  .from("products")
  .update({
    is_active: false,
    updated_at: new Date().toISOString(),
  })
  .eq("id", req.params.id)
  .select("id")
  .maybeSingle();

if (error) {
  throw new Error(error.message);
}

if (!data) {
  res.status(404).json({
    success: false,
    message: "Product not found.",
  });
  return;
}

res.json({
  success: true,
  message: "Product deleted successfully.",
});

} catch (error) {
next(error);
}
});

export default router;
