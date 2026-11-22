import { afterEach, describe, expect, it } from 'vitest'
import { razorpayCheckout } from './payments'

type Handler = (response: Record<string, string>) => void

function stubRazorpay(onOpen: (options: Record<string, unknown>) => void) {
  ;(globalThis as unknown as { window: unknown }).window = {
    Razorpay: class {
      options: Record<string, unknown>
      constructor(options: Record<string, unknown>) { this.options = options }
      on() {}
      open() { onOpen(this.options) }
    },
  }
}

afterEach(() => { delete (globalThis as { window?: unknown }).window })

describe('razorpayCheckout', () => {
  it('opens Checkout with the server order and returns the signed result', async () => {
    let seen: Record<string, unknown> = {}
    stubRazorpay(options => {
      seen = options
      ;(options.handler as Handler)({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'sig' })
    })
    const result = await razorpayCheckout({ provider: 'razorpay', key_id: 'rzp_test_x', order_id: 'order_1', amount: 1500, currency: 'INR' }, 'Rental')
    expect(result).toEqual({ order_id: 'order_1', payment_id: 'pay_1', signature: 'sig' })
    expect(seen).toMatchObject({ key: 'rzp_test_x', order_id: 'order_1', amount: 1500, currency: 'INR' })
  })

  it('rejects when the renter closes Checkout', async () => {
    stubRazorpay(options => (options.modal as { ondismiss: () => void }).ondismiss())
    await expect(razorpayCheckout({ provider: 'razorpay', key_id: 'k', order_id: 'o', amount: 1, currency: 'INR' }, 'x'))
      .rejects.toThrow('Payment was cancelled.')
  })
})
