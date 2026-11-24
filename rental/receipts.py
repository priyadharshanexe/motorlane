"""The booking document (PDF) in the Motorlane design: a tarmac header with the Lane-M mark, the trip as a ticket,
the stored price breakdown line by line, the payment and refunds, and the trip's timeline from its events."""
from decimal import Decimal
from xml.sax.saxutils import escape

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

TARMAC = colors.HexColor("#121417")
ROAD = colors.HexColor("#26292D")
LANE = colors.HexColor("#FFC531")
LANE_TEXT = colors.HexColor("#946000")
CHALK = colors.HexColor("#EDEAE3")
INK = colors.HexColor("#16181B")
DUST = colors.HexColor("#5A5E66")
KERB = colors.HexColor("#D9D5CC")
PAPER = colors.HexColor("#F3F1EC")
GO = colors.HexColor("#0E7A4E")
STOP = colors.HexColor("#E14B4B")

STOP_LABELS = {
    "paid": "Paid", "refund_issued": "Refund issued", "refunded": "Refunded",
    "Pending": "Requested", "Confirmed": "Approved", "Rejected": "Declined", "Expired": "Expired",
    "Cancelled": "Cancelled", "In progress": "Keys handed over", "Returned": "Returned",
}


def render_booking_summary(stream, booking):
    width = A4[0] - 88
    styles = {
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=15, textColor=INK),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, leading=12, textColor=DUST),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=7.5, leading=11, textColor=LANE_TEXT),
        "heading": ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=12, leading=18, textColor=INK),
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=26, leading=30, textColor=INK),
        "amount": ParagraphStyle("amount", fontName="Courier-Bold", fontSize=20, leading=26, textColor=INK, alignment=TA_RIGHT),
        "right": ParagraphStyle("right", fontName="Courier", fontSize=10, leading=15, textColor=INK, alignment=TA_RIGHT),
        "mono": ParagraphStyle("mono", fontName="Courier", fontSize=10, leading=15, textColor=INK),
    }

    def text(value, style="body", empty="Not provided"):
        # the built-in PDF fonts have no rupee sign: write the amount as INR
        value = str(value if value not in (None, "") else empty).replace("₹", "INR ")
        return Paragraph(escape(value), styles[style])

    def money(value):
        return f"₹{Decimal(value):,.2f}".replace("₹", "INR ")

    def table(data, widths, background=None, box=False):
        result = Table(data, colWidths=widths, hAlign="LEFT")
        commands = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 14),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 14), ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]
        if background:
            commands.append(("BACKGROUND", (0, 0), (-1, -1), background))
        if box:
            commands.append(("BOX", (0, 0), (-1, -1), .8, KERB))
        result.setStyle(TableStyle(commands))
        return result

    def field(label, value, style="body"):
        return [text(label.upper(), "label"), Spacer(1, 4), text(value, style)]

    vehicle, owner, days = booking.vehicle, getattr(booking.vehicle, "owner", None), booking.days
    payment = getattr(booking, "payment", None) if hasattr(booking, "payment") else None
    doc = SimpleDocTemplate(stream, pagesize=A4, rightMargin=44, leftMargin=44, topMargin=104, bottomMargin=70,
                            title=f"Motorlane | Trip #{booking.pk}", author="Motorlane")
    rows = [
        text(f"TRIP TICKET · #{booking.pk}", "label"), Spacer(1, 4),
        text(vehicle.name, "title"), Spacer(1, 4),
        text(f"{vehicle.vehicle_type} · {vehicle.location or 'Pickup arranged with the owner'} · {booking.display_status}", "small"),
        Spacer(1, 16),
        table([[field("Pickup", f"{booking.start_date:%a %d %b %Y} · {booking.pickup_time:%H:%M}", "mono"),
                field("Return", f"{booking.end_date:%a %d %b %Y} · {booking.return_time:%H:%M}", "mono"),
                field("Rental days", days, "mono")]], [width * .4, width * .4, width * .2], PAPER, box=True),
        Spacer(1, 6),
        table([[field("Renter", booking.contact_name or booking.user.name),
                field("Hosted by", getattr(owner, "name", None) or "Vehicle owner")]], [width / 2, width / 2]),
        Spacer(1, 10), text("Price breakdown", "heading"), Spacer(1, 6),
    ]
    lines = (booking.price_breakdown or {}).get("lines") or []
    priced = [[text("DESCRIPTION", "label"), text("AMOUNT", "label")]]
    if lines:
        priced += [[text(line.get("label", line.get("kind", ""))), text(money(line.get("amount", 0)), "right")]
                   for line in lines if line.get("kind") != "deposit"]
    else:
        rate = booking.quoted_daily_rate
        priced.append([text(f"Vehicle rental, {days} day{'s' if days != 1 else ''}" + (f" × {money(rate)}" if rate is not None else "")),
                       text(money(booking.total_price), "right")])
    pricing = table(priced, [width * .7, width * .3])
    pricing.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), .6, KERB), ("ALIGN", (1, 0), (1, -1), "RIGHT")]))
    total_rows = [[text("RENTAL TOTAL", "label"), text(money(booking.total_price), "amount")]]
    if booking.deposit_amount:
        total_rows.append([text("REFUNDABLE DEPOSIT (RETURNED AFTER THE TRIP)", "label"), text(money(booking.deposit_amount), "right")])
    total = table(total_rows, [width * .55, width * .45], colors.HexColor("#FFF4D1"))
    rows += [KeepTogether([pricing, Spacer(1, 8), total])]

    rows += [Spacer(1, 18), text("Payment", "heading"), Spacer(1, 6)]
    if payment and payment.is_paid:
        pay_rows = [[text("Paid"), text(f"{money(payment.amount)} · {timezone.localtime(payment.paid_at):%d %b %Y, %H:%M}" if payment.paid_at else money(payment.amount), "right")],
                    [text("Method"), text("Demo payment (no real money)" if payment.provider == "fake" else "Razorpay (test mode)", "right")]]
        if payment.refunded_amount:
            pay_rows.append([text("Refunded"), text(money(payment.refunded_amount), "right")])
        if payment.cancellation_fee:
            pay_rows.append([text("Cancellation fee kept"), text(money(payment.cancellation_fee), "right")])
        rows.append(table(pay_rows, [width * .5, width * .5], box=True))
    else:
        rows.append(text("Not paid yet. Payment opens once the owner approves the request.", "small"))

    events = list(booking.events.all())
    if events:
        stops = []
        for event in events:
            key = event.kind if event.kind != "status" else event.to_status
            label = "Requested" if event.kind == "status" and not event.from_status else STOP_LABELS.get(key, key)
            stops.append([text("•", "body"), text(label), text(f"{timezone.localtime(event.at):%d %b %Y, %H:%M}", "mono"), text(event.note, "small", empty="")])
        timeline = Table(stops, colWidths=[18, width * .25, width * .27, width * .48 - 18], hAlign="LEFT")
        timeline.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TEXTCOLOR", (0, 0), (0, -1), LANE_TEXT),
                                      ("LINEBEFORE", (1, 0), (1, -1), 2, LANE), ("LEFTPADDING", (1, 0), (1, -1), 10),
                                      ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        rows += [Spacer(1, 18), text("The road so far", "heading"), Spacer(1, 6), timeline]

    if booking.pickup_notes:
        rows += [Spacer(1, 16), text("Pickup notes", "heading"), Spacer(1, 4), text(booking.pickup_notes)]
    rows += [Spacer(1, 18),
             text("Amounts in Indian rupees, from the price saved with this booking. Arrange the exact pickup point with the owner. "
                  "This is a booking record, not a tax invoice.", "small")]

    def frame(canvas, document):
        canvas.saveState()
        top = A4[1]
        canvas.setFillColor(TARMAC)
        canvas.rect(0, top - 76, A4[0], 76, fill=1, stroke=0)
        canvas.setStrokeColor(LANE)
        canvas.setLineWidth(4)
        canvas.setLineCap(1)
        canvas.setLineJoin(1)
        path = canvas.beginPath()  # the Lane-M: an M whose middle stroke ends in a lane line
        x, y, s = 44, top - 62, .9
        path.moveTo(x + 6 * s, y + 6 * s)
        for px, py in ((6, 34), (20, 18), (34, 34), (34, 6)):
            path.lineTo(x + px * s, y + py * s)
        canvas.drawPath(path, stroke=1, fill=0)
        canvas.setStrokeColor(CHALK)
        canvas.setLineWidth(2.4)
        canvas.setDash(2.4, 2.4)
        canvas.line(x + 20 * s, y + 15 * s, x + 20 * s, y + 6 * s)
        canvas.setDash()
        canvas.setFillColor(CHALK)
        canvas.setFont("Helvetica-Bold", 17)
        canvas.drawString(88, top - 48, "MOTORLANE")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#A3A7AE"))
        canvas.drawRightString(A4[0] - 44, top - 40, "BOOKING DOCUMENT")
        canvas.drawRightString(A4[0] - 44, top - 52, f"Trip #{booking.pk} · issued {timezone.localtime():%d %b %Y}")
        canvas.setFillColor(LANE)
        canvas.rect(0, top - 80, A4[0], 4, fill=1, stroke=0)
        # footer: the road with its centre line and the kerb
        canvas.setFillColor(ROAD)
        canvas.rect(0, 30, A4[0], 14, fill=1, stroke=0)
        canvas.setFillColor(LANE)
        for dx in range(0, int(A4[0]), 40):
            canvas.rect(dx, 36, 20, 2, fill=1, stroke=0)
        for i, dx in enumerate(range(0, int(A4[0]), 24)):
            canvas.setFillColor(STOP if i % 2 else CHALK)
            canvas.rect(dx, 26, 24, 4, fill=1, stroke=0)
        canvas.setFillColor(DUST)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(44, 12, "Motorlane · cars and bikes from local owners across Tamil Nadu")
        canvas.drawRightString(A4[0] - 44, 12, f"Page {document.page}")
        canvas.restoreState()

    doc.build(rows, onFirstPage=frame, onLaterPages=frame)
