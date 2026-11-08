import { Router } from "express";
import Stripe from "stripe";
import { stripe } from "../services/stripeService.js";
import { supabase } from "../lib/supabase.js";
import { sendOrderConfirmationEmail } from "../services/emailService.js";

const router = Router();

router.post("/", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    res.status(400).json({
      success: false,
      message: "Missing Stripe webhook configuration.",
    });
    return;
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);

    res.status(400).json({
      success: false,
      message: "Invalid webhook signature.",
    });
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;

      if (!orderId) {
        res.status(400).json({
          success: false,
          message: "Order ID is missing from Stripe session.",
        });
        return;
      }

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "paid",
          stripe_session_id: session.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (updateError) {
        throw new Error(updateError.message);
      }

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, user_id, total_amount")
        .eq("id", orderId)
        .single();

      if (orderError || !order) {
        throw new Error(orderError?.message || "Order not found.");
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.admin.getUserById(order.user_id);

      if (userError || !user?.email) {
        throw new Error(
          userError?.message || "Customer email could not be found."
        );
      }

      await sendOrderConfirmationEmail(
        user.email,
        order.id,
        Number(order.total_amount)
      );

      console.log(`Order confirmation email sent for order ${order.id}.`);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;

      if (orderId) {
        const { error } = await supabase
          .from("orders")
          .update({
            status: "failed",
            stripe_session_id: session.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", orderId);

        if (error) {
          throw new Error(error.message);
        }
      }
    }

    res.json({
      received: true,
    });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error);

    res.status(500).json({
      success: false,
      message: "Webhook processing failed.",
    });
  }
});

export default router;
