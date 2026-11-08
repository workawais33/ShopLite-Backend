
import { Router, type Request } from "express";
import { supabase } from "../lib/supabase.js";
import { stripe } from "../services/stripeService.js";

const router = Router();

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

router.get("/stats", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

    if (admin.status !== 200) {
      res.status(admin.status).json({
        success: false,
        message: admin.message,
      });
      return;
    }

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, user_id, status, total_amount, created_at");

    if (ordersError) {
      throw new Error(ordersError.message);
    }

    const allOrders = orders ?? [];

    const paidOrders = allOrders.filter(
      (order) => order.status === "paid"
    );

    const totalRevenue = paidOrders.reduce(
      (total, order) => total + order.total_amount,
      0
    );

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayTimestamp = startOfToday.getTime();

    const todaySales = paidOrders
      .filter(
        (order) =>
          new Date(order.created_at).getTime() >= todayTimestamp
      )
      .reduce((total, order) => total + order.total_amount, 0);

    const customerIds = new Set(
      allOrders.map((order) => order.user_id)
    );

    res.json({
      success: true,
      data: {
        totalRevenue,
        totalOrders: allOrders.length,
        totalCustomers: customerIds.size,
        todaySales,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/orders", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

    if (admin.status !== 200) {
      res.status(admin.status).json({
        success: false,
        message: admin.message,
      });
      return;
    }

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select(
        `
          id,
          user_id,
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
      .order("created_at", { ascending: false });

    if (ordersError) {
      throw new Error(ordersError.message);
    }

    const orderList = orders ?? [];

    const userIds = [
      ...new Set(orderList.map((order) => order.user_id)),
    ];

    let profiles: {
      id: string;
      full_name: string | null;
      avatar_url: string | null;
    }[] = [];

    if (userIds.length > 0) {
      const { data: profileData, error: profilesError } =
        await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

      if (profilesError) {
        throw new Error(profilesError.message);
      }

      profiles = profileData ?? [];
    }

    const profileMap = new Map(
      profiles.map((profile) => [profile.id, profile])
    );

    const enrichedOrders = orderList.map((order) => ({
      ...order,
      customer: profileMap.get(order.user_id) ?? {
        id: order.user_id,
        full_name: null,
        avatar_url: null,
      },
    }));

    res.json({
      success: true,
      data: enrichedOrders,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/orders/:id/refund", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

    if (admin.status !== 200) {
      res.status(admin.status).json({
        success: false,
        message: admin.message,
      });
      return;
    }

    const orderId = req.params.id;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, stripe_session_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) {
      throw new Error(orderError.message);
    }

    if (!order) {
      res.status(404).json({
        success: false,
        message: "Order not found.",
      });
      return;
    }

    if (order.status === "refunded") {
      res.status(400).json({
        success: false,
        message: "This order has already been refunded.",
      });
      return;
    }

    if (order.status !== "paid") {
      res.status(400).json({
        success: false,
        message: "Only paid orders can be refunded.",
      });
      return;
    }

    if (!order.stripe_session_id) {
      res.status(400).json({
        success: false,
        message: "Stripe session is missing for this order.",
      });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(
      order.stripe_session_id
    );

    if (!session.payment_intent) {
      res.status(400).json({
        success: false,
        message: "Stripe payment intent is missing.",
      });
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent.id;

    await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
      },
      {
        idempotencyKey: `refund-${order.id}`,
      }
    );

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: "refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    res.json({
      success: true,
      message: "Order refunded successfully.",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/customers", async (req, res, next) => {
  try {
    const admin = await authenticateAdmin(req);

    if (admin.status !== 200) {
      res.status(admin.status).json({
        success: false,
        message: admin.message,
      });
      return;
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, role")
      .eq("role", "user")
      .order("full_name", { ascending: true });

    if (profilesError) {
      throw new Error(profilesError.message);
    }

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("user_id, status, total_amount");

    if (ordersError) {
      throw new Error(ordersError.message);
    }

    const orderList = orders ?? [];

    const customers = (profiles ?? []).map((profile) => {
      const customerOrders = orderList.filter(
        (order) => order.user_id === profile.id
      );

      const totalSpent = customerOrders
        .filter((order) => order.status === "paid")
        .reduce(
          (total, order) => total + order.total_amount,
          0
        );

      return {
        id: profile.id,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        order_count: customerOrders.length,
        total_spent: totalSpent,
      };
    });

    res.json({
      success: true,
      data: customers,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
