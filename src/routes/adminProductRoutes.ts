
import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";

const router = Router();

const productSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional().default(""),
  price: z.number().int().min(0),
  image_url: z.string().trim().url().optional().or(z.literal("")),
});

const authenticateAdmin = async (req: Request) => {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return {
      status: 401,
      message: "Authentication required.",
    };
  }

  const accessToken = authorization.replace("Bearer ", "").trim();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user) {
    return {
      status: 401,
      message: "Invalid or expired session.",
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
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

router.get("/", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

    if (admin.status !== 200) {
      res.status(admin.status).json({
        success: false,
        message: admin.message,
      });
      return;
    }

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      data: data ?? [],
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

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

router.put("/:id", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

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

router.delete("/:id", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

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
      .eq("is_active", true)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      res.status(404).json({
        success: false,
        message: "Active product not found.",
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
