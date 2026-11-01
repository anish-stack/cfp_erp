/** Razorpay Checkout loader + promise wrapper (key comes from the API; nothing hard-coded) */
let loading = null;
export function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('Could not load the payment window. Check your internet and try again.')); };
    document.body.appendChild(s);
  });
  return loading;
}

/** opens checkout; resolves { orderId, paymentId, signature } or rejects (closed / failed) */
export async function payWithRazorpay({ keyId, orderId, amount, name, description, prefill, color = '#e21f26' }) {
  await loadCheckout();
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      key: keyId, order_id: orderId, amount: Math.round(amount * 100), currency: 'INR', name, description, prefill,
      theme: { color },
      handler: (r) => resolve({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
    });
    rz.on('payment.failed', (r) => reject(new Error(r?.error?.description || 'Payment failed')));
    rz.open();
  });
}
