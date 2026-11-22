import { money } from './api'

export function Price({ value, label }: { value: string | number; label?: string }) {
  return <span className={label === "/day" ? "price-display daily-price" : "price-display"}><strong>{money(value)}</strong>{label && <small>{label}</small>}</span>
}

export function PriceBreakdown({ rate, days, total, estimate = false }: {
  rate: string | null; days: number; total: string; estimate?: boolean
}) {
  return <section className="price-breakdown">
    <h3>{estimate ? 'Rental estimate' : 'Price breakdown'}</h3>
    <dl>
      {rate && <div><dt>Daily rental rate</dt><dd>{money(rate)}</dd></div>}
      <div><dt>Rental duration</dt><dd>{days} {days === 1 ? 'day' : 'days'}</dd></div>
      <div className="price-total">
        <dt>{estimate ? 'Estimated total' : 'Booking total'}<small>{rate ? `${money(rate)} × ${days} ${days === 1 ? 'day' : 'days'}` : 'Recorded rental amount'}</small></dt>
        <dd>{money(total)}</dd>
      </div>
    </dl>
  </section>
}

export interface QuoteLine { kind: string; label: string; amount: string }
export interface Quote {
  days: number
  lines: QuoteLine[]
  subtotal: string
  discount: string
  rental_total: string
  deposit: string
  due_now: string
  total_price: string
}

/** The server's line-by-line quote (weekday/weekend days, long-rental discount, refundable deposit). */
export function QuoteLines({ quote, title = 'Price breakdown' }: { quote: Quote; title?: string }) {
  const deposit = Number(quote.deposit) > 0
  return <section className="price-breakdown">
    <h3>{title}</h3>
    <dl>
      <div><dt>Rental duration</dt><dd>{quote.days} {quote.days === 1 ? 'day' : 'days'}</dd></div>
      {quote.lines.filter(line => line.kind !== 'deposit').map(line =>
        <div key={line.kind}><dt>{line.label}</dt><dd>{money(line.amount)}</dd></div>)}
      <div className="price-total">
        <dt>Rental total<small>Charged after the owner confirms</small></dt>
        <dd>{money(quote.rental_total)}</dd>
      </div>
      {deposit && <div><dt>Refundable deposit<small>Returned after the vehicle is back</small></dt><dd>{money(quote.deposit)}</dd></div>}
      {deposit && <div><dt>Due at payment</dt><dd>{money(quote.due_now)}</dd></div>}
    </dl>
  </section>
}
