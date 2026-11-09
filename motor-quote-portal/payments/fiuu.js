// Fiuu payment links without logging in to the Fiuu portal.
// Fiuu's hosted payment page takes the amount and order details in the link,
// signed with the merchant's Verify Key:
//   vcode = md5(amount + merchantID + orderID + verifyKey)
// Settings: FIUU_MERCHANT_ID, FIUU_VERIFY_KEY (Fiuu portal → Merchant Profile),
// FIUU_PAY_URL (default https://pay.fiuu.com/RMS/pay/; sandbox: https://sandbox-payment.fiuu.com/RMS/pay/).
import { createHash } from 'node:crypto';

export function fiuuConfigured() {
  return !!(process.env.FIUU_MERCHANT_ID && process.env.FIUU_VERIFY_KEY);
}

export function fiuuPayLink({ orderId, amount, name, email, mobile, description }) {
  const merchant = process.env.FIUU_MERCHANT_ID;
  const key = process.env.FIUU_VERIFY_KEY;
  if (!merchant || !key) throw new Error('Fiuu not set up: add FIUU_MERCHANT_ID and FIUU_VERIFY_KEY to .env');
  const amt = Number(String(amount).replace(/[^\d.]/g, ''));
  if (!(amt > 0)) throw new Error('Amount must be more than RM0.00');
  const fixed = amt.toFixed(2);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(orderId)) throw new Error('Order ID: letters, numbers, _ or - only (max 32)');
  const vcode = createHash('md5').update(fixed + merchant + orderId + key).digest('hex');
  const base = (process.env.FIUU_PAY_URL || 'https://pay.fiuu.com/RMS/pay/').replace(/\/?$/, '/');
  const q = new URLSearchParams({ amount: fixed, orderid: orderId, currency: 'MYR', country: 'MY', vcode });
  if (name) q.set('bill_name', name.slice(0, 128));
  if (email) q.set('bill_email', email);
  if (mobile) q.set('bill_mobile', String(mobile).replace(/\D/g, '').replace(/^0/, '60'));
  if (description) q.set('bill_desc', description.slice(0, 200));
  return `${base}${encodeURIComponent(merchant)}/?${q}`;
}
