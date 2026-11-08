import { Router } from "express";
import { z } from "zod";
import { stripe } from "../services/stripeService.js";
import { supabase } from "../lib/supabase.js";

const router = Router();

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1),
      })
    )
    .min(1),
});

router.post("/create-session", async (req, res, next) => {
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

    const parsed = checkoutSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Invalid checkout data.",
      });
      return;
    }

    const { items } = parsed.data;

    const productIds = items.map((item) => item.productId);

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, price, image_url")
      .in("id", productIds);

    if (productsError) {
      throw new Error(productsError.message);
    }

    if (!products || products.length !== productIds.length) {
      res.status(400).json({
        success: false,
        message: "One or more products were not found.",
      });
      return;
    }

    const orderItems = items.map((item) => {
      const product = products.find(
        (currentProduct) => currentProduct.id === item.productId
      );

      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      return {
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        price: product.price,
      };
    });

    const totalAmount = orderItems.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: user.id,
        status: "pending",
        total_amount: totalAmount,
      })
      .select("id")
      .single();

    if (orderError || !order) {
      throw new Error(
        orderError?.message || "Unable to create order."
      );
    }

    const { error: orderItemsError } = await supabase
      .from("order_items")
      .insert(
        orderItems.map((item) => ({
          order_id: order.id,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          price: item.price,
        }))
      );

    if (orderItemsError) {
      await supabase.from("orders").delete().eq("id", order.id);
      throw new Error(orderItemsError.message);
    }

    const lineItems = orderItems.map((item) => {
      const product = products.find(
        (currentProduct) => currentProduct.id === item.product_id
      );

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.product_name,
            images: product?.image_url
              ? [product.image_url]
              : undefined,
          },
          unit_amount: item.price,
        },
        quantity: item.quantity,
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: `${process.env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cart`,
      metadata: {
        order_id: order.id,
      },
    });

    const { error: updateOrderError } = await supabase
      .from("orders")
      .update({
        stripe_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (updateOrderError) {
      await supabase.from("order_items").delete().eq("order_id", order.id);
      await supabase.from("orders").delete().eq("id", order.id);
      throw new Error(updateOrderError.message);
    }

    res.json({
      success: true,
      url: session.url,
      orderId: order.id,
    });
  } catch (error) {
    next(error);
  }
});

export default router;