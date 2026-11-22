"""Professional reservation document using the booked price snapshot."""
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether


def render_booking_summary(stream, booking):
    ink = colors.HexColor("#243247")
    blue = colors.HexColor("#315fa8")
    muted = colors.HexColor("#64748b")
    line = colors.HexColor("#dfe6ef")
    pale = colors.HexColor("#f1f5fb")
    width = A4[0] - 88
    styles = {
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=10, leading=15, textColor=ink),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, leading=12, textColor=muted),
        "label": ParagraphStyle("label", fontName="Helvetica-Bold", fontSize=8, leading=12, textColor=muted),
        "heading": ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=12, leading=18, textColor=ink),
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=25, leading=31, textColor=ink),
        "amount": ParagraphStyle("amount", fontName="Helvetica-Bold", fontSize=20, leading=26, textColor=blue, alignment=TA_RIGHT),
        "right": ParagraphStyle("right", fontName="Helvetica", fontSize=10, leading=15, textColor=ink, alignment=TA_RIGHT),
    }

    def text(value, style="body"):
        return Paragraph(escape(str(value if value is not None and value != "" else "Not provided")), styles[style])

    def money(value):
        return f"INR {value:,.2f}"

    def table(data, widths, background=None):
        result = Table(data, colWidths=widths, hAlign="LEFT")
        commands = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 14),
            ("RIGHTPADDING", (0, 0), (-1, -1), 14),
            ("TOPPADDING", (0, 0), (-1, -1), 12),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ]
        if background:
            commands.append(("BACKGROUND", (0, 0), (-1, -1), background))
        result.setStyle(TableStyle(commands))
        return result

    def field(label, value):
        return [text(label.upper(), "label"), Spacer(1, 5), text(value)]

    vehicle = booking.vehicle
    owner = getattr(vehicle, "owner", None)
    days = booking.days
    status = booking.display_status
    doc = SimpleDocTemplate(stream, pagesize=A4, rightMargin=44, leftMargin=44,
                            topMargin=94, bottomMargin=58, title="Motorlane | Booking summary",
                            author="Motorlane")
    rows = [
        text("Booking summary", "title"),
        Spacer(1, 5),
        text("Your vehicle, rental schedule and agreed booking value.", "small"),
        Spacer(1, 22),
        table([[field("Vehicle", vehicle.name),
                field("Rental status", status)]], [width*.66, width*.34], pale),
        Spacer(1, 4),
        table([[field("Renter", booking.contact_name or booking.user.name),
                field("Listed by", getattr(owner, "name", None) or "Vehicle owner")],
               [field("Vehicle type", vehicle.vehicle_type),
                field("Pickup area", vehicle.location or "Arrange with the owner")]],
              [width/2, width/2]),
        Spacer(1, 10),
        text("Rental schedule", "heading"),
        Spacer(1, 8),
        table([[field("Pickup", f"{booking.start_date:%a, %d %b %Y}, {booking.pickup_time:%H:%M}"),
                field("Return", f"{booking.end_date:%a, %d %b %Y}, {booking.return_time:%H:%M}")]],
              [width/2, width/2], pale),
        Spacer(1, 7),
        text(f"{days} rental day{'s' if days != 1 else ''}. Every started 24 hours counts as a rental day.", "small"),
        Spacer(1, 22),
        text("Price breakdown", "heading"),
        Spacer(1, 9),
    ]
    rate = booking.quoted_daily_rate
    pricing = table([
        [text("DESCRIPTION", "label"), text("DAYS", "label"),
         text("DAILY RATE", "label"), text("AMOUNT (INR)", "label")],
        [text("Vehicle rental"), text(days),
         text(money(rate) if rate is not None else "Not recorded", "right"),
         text(money(booking.total_price), "right")],
    ], [width*.37, width*.12, width*.25, width*.26])
    pricing.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), pale),
        ("LINEBELOW", (0, 1), (-1, 1), .7, line),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
    ]))
    total = table([[text("TOTAL BOOKING VALUE", "label"),
                    text(money(booking.total_price), "amount")]],
                  [width*.52, width*.48], pale)
    rows += [KeepTogether([pricing, Spacer(1, 10), total]), Spacer(1, 9),
             text("Currency: Indian rupees (INR). Calculated using the rate saved with this booking.", "small")]
    if booking.pickup_notes:
        rows += [Spacer(1, 18), text("Pickup notes", "heading"),
                 Spacer(1, 5), text(booking.pickup_notes)]
    rows += [Spacer(1, 22), text("Reservation information", "heading"), Spacer(1, 5),
             text("Arrange the exact pickup point and handoff with the vehicle owner. A pending request requires owner confirmation.", "small"),
             Spacer(1, 8),
             text("This document records the reservation and booked price. It is not a payment receipt or tax invoice; payment collection is not recorded by Motorlane.", "small")]

    def frame(canvas, document):
        canvas.saveState()
        canvas.setFillColor(blue)
        canvas.roundRect(44, A4[1]-64, 30, 30, 9, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 16)
        canvas.drawCentredString(59, A4[1]-55, "M")
        canvas.setFillColor(ink)
        canvas.setFont("Helvetica-Bold", 19)
        canvas.drawString(84, A4[1]-55, "Motorlane")
        canvas.setFillColor(muted)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A4[0]-44, A4[1]-47, "VEHICLE RENTAL")
        canvas.drawRightString(A4[0]-44, A4[1]-60, "Reservation document")
        canvas.setStrokeColor(line)
        canvas.line(44, A4[1]-78, A4[0]-44, A4[1]-78)
        canvas.line(44, 45, A4[0]-44, 45)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(44, 30, "Motorlane  |  Local rides. New possibilities.")
        canvas.drawRightString(A4[0]-44, 30, f"Booking summary  /  Page {document.page}")
        canvas.restoreState()
    doc.build(rows, onFirstPage=frame, onLaterPages=frame)
