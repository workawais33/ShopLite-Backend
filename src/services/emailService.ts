import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendOrderConfirmationEmail(
  email: string,
  orderId: string,
  totalAmount: number
) {
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
    to: email,
    subject: `ShopLite Order Confirmation #${orderId}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 24px; color: #1f2937;">
        <h1 style="color: #4f46e5;">Thank you for your order!</h1>
        <p>Your payment was successful, and your ShopLite order is confirmed.</p>
        <div style="padding: 16px; background: #f3f4f6; border-radius: 12px;">
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><strong>Total:</strong> $${(totalAmount / 100).toFixed(2)}</p>
          <p><strong>Status:</strong> Paid</p>
        </div>
        <p>Thank you for shopping with ShopLite!</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
