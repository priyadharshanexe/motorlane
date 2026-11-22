// Provider-aware checkout. The backend decides which provider runs (GET payments/config/):
// - "fake": a demo provider; the server signs a stand-in checkout result. No money moves.
// - "razorpay": Razorpay Checkout in TEST mode, loaded from checkout.razorpay.com.
// Either way the server verifies the signature in payment/confirm/ before marking the booking paid.

export interface PaymentConfig {
  provider: 'fake' | 'razorpay'
  key_id: string
  currency: string
  demo: boolean
  label: string
}

export interface CheckoutOptions { provider: string; key_id: string; order_id: string; amount: number; currency: string }
export interface CheckoutResult { order_id: string; payment_id: string; signature: string }

interface RazorpayResponse { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface RazorpayInstance { open(): void; on(event: string, handler: (response: { error?: { description?: string } }) => void): void }
type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance
declare global { interface Window { Razorpay?: RazorpayConstructor } }

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT
    script.async = true
    script.onload = () => window.Razorpay ? resolve(window.Razorpay) : reject(new Error('Razorpay Checkout did not load.'))
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'))
    document.head.appendChild(script)
  })
}

/** Open Razorpay Checkout for a server-created order and resolve with the signed result. */
export async function razorpayCheckout(options: CheckoutOptions, description: string): Promise<CheckoutResult> {
  const Razorpay = await loadRazorpay()
  return new Promise((resolve, reject) => {
    const checkout = new Razorpay({
      key: options.key_id,
      order_id: options.order_id,
      amount: options.amount,
      currency: options.currency,
      name: 'Motorlane',
      description,
      handler: (response: RazorpayResponse) => resolve({
        order_id: response.razorpay_order_id,
        payment_id: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      }),
      modal: { ondismiss: () => reject(new Error('Payment was cancelled.')) },
    })
    checkout.on('payment.failed', response => reject(new Error(response.error?.description ?? 'Payment failed.')))
    checkout.open()
  })
}
