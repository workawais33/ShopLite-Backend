import { Router } from "express";
import { supabase } from "../lib/supabase.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const accessToken = authorization.replace("Bearer ", "").trim();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired session.",
      });
      return;
    }

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select(
        `
          id,
          status,
          total_amount,
          stripe_session_id,
          created_at,
          updated_at,
          order_items (
            id,
            product_id,
            product_name,
            quantity,
            price,
            created_at
          )
        `
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (ordersError) {
      throw new Error(ordersError.message);
    }

    res.json({
      success: true,
      orders: orders ?? [],
    });
  } catch (error) {
    next(error);
  }
});

export default router;