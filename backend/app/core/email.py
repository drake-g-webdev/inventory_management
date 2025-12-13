import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)


def send_email(
    to_emails: List[str],
    subject: str,
    body_html: str,
    body_text: Optional[str] = None
) -> bool:
    """
    Send an email using Gmail SMTP.

    Args:
        to_emails: List of recipient email addresses
        subject: Email subject line
        body_html: HTML body content
        body_text: Plain text body (optional, will strip HTML if not provided)

    Returns:
        True if email sent successfully, False otherwise
    """
    logger.info(f"send_email called: to={to_emails}, subject={subject}")
    logger.info(f"EMAIL_ENABLED={settings.EMAIL_ENABLED}, SMTP_USER={settings.SMTP_USER}")

    if not settings.EMAIL_ENABLED:
        logger.info(f"Email disabled. Would have sent to: {to_emails}")
        return False

    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.warning("Email credentials not configured")
        return False

    if not to_emails:
        logger.warning("No recipients specified")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.SMTP_USER}>"
        msg["To"] = ", ".join(to_emails)

        # Plain text version
        if body_text:
            part1 = MIMEText(body_text, "plain")
            msg.attach(part1)

        # HTML version
        part2 = MIMEText(body_html, "html")
        msg.attach(part2)

        # Connect to Gmail SMTP
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, to_emails, msg.as_string())

        logger.info(f"Email sent successfully to: {to_emails}")
        return True

    except smtplib.SMTPAuthenticationError:
        logger.error("SMTP authentication failed. Check your Gmail App Password.")
        return False
    except Exception as e:
        logger.error(f"Failed to send email: {str(e)}")
        return False


def send_order_submitted_notification(
    supervisor_emails: List[str],
    order_number: str,
    property_name: str,
    submitted_by: str,
    item_count: int,
    estimated_total: float,
    week_of: str
) -> bool:
    """
    Send notification email when an order is submitted for review.
    """
    subject = f"From: {submitted_by} - New Order Submitted: {order_number} - {property_name}"

    body_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #2563eb; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .detail-row {{ padding: 10px 0; border-bottom: 1px solid #e5e7eb; }}
            .label {{ font-weight: bold; color: #6b7280; }}
            .value {{ color: #111827; }}
            .button {{ display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px;
                       text-decoration: none; border-radius: 6px; margin-top: 20px; }}
            .footer {{ text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>New Order Submitted</h1>
            </div>
            <div class="content">
                <p>A new order has been submitted and requires your review.</p>

                <div class="detail-row">
                    <span class="label">Order Number:</span>
                    <span class="value">{order_number}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Property:</span>
                    <span class="value">{property_name}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Submitted By:</span>
                    <span class="value">{submitted_by}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Week Of:</span>
                    <span class="value">{week_of}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Items:</span>
                    <span class="value">{item_count} items</span>
                </div>
                <div class="detail-row">
                    <span class="label">Estimated Total:</span>
                    <span class="value">${estimated_total:,.2f}</span>
                </div>

                <p style="margin-top: 20px;">
                    Please log in to the purchasing system to review this order.
                </p>

                <a href="{settings.FRONTEND_URL}/supervisor/orders" class="button">
                    Review Order
                </a>
            </div>
            <div class="footer">
                <p>This is an automated message from SUKAKPAK Purchasing System.</p>
            </div>
        </div>
    </body>
    </html>
    """

    body_text = f"""
    New Order Submitted for Review

    Order Number: {order_number}
    Property: {property_name}
    Submitted By: {submitted_by}
    Week Of: {week_of}
    Items: {item_count}
    Estimated Total: ${estimated_total:,.2f}

    Please log in to the purchasing system to review this order.
    {settings.FRONTEND_URL}/supervisor/orders
    """

    return send_email(supervisor_emails, subject, body_html, body_text)


def send_order_approved_notification(
    worker_email: str,
    order_number: str,
    property_name: str,
    approved_by: str,
    review_notes: Optional[str] = None
) -> bool:
    """
    Send notification email when an order is approved.
    """
    subject = f"From: {approved_by} - Order Approved: {order_number}"

    notes_html = ""
    notes_text = ""
    if review_notes:
        notes_html = f"""
        <div class="detail-row">
            <span class="label">Notes from Reviewer:</span>
            <p class="value">{review_notes}</p>
        </div>
        """
        notes_text = f"\nNotes from Reviewer: {review_notes}\n"

    body_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #16a34a; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .detail-row {{ padding: 10px 0; border-bottom: 1px solid #e5e7eb; }}
            .label {{ font-weight: bold; color: #6b7280; }}
            .value {{ color: #111827; }}
            .footer {{ text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Order Approved</h1>
            </div>
            <div class="content">
                <p>Your order has been approved!</p>

                <div class="detail-row">
                    <span class="label">Order Number:</span>
                    <span class="value">{order_number}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Property:</span>
                    <span class="value">{property_name}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Approved By:</span>
                    <span class="value">{approved_by}</span>
                </div>
                {notes_html}
            </div>
            <div class="footer">
                <p>This is an automated message from SUKAKPAK Purchasing System.</p>
            </div>
        </div>
    </body>
    </html>
    """

    body_text = f"""
    Order Approved

    Your order has been approved!

    Order Number: {order_number}
    Property: {property_name}
    Approved By: {approved_by}
    {notes_text}
    """

    return send_email([worker_email], subject, body_html, body_text)


def send_order_changes_requested_notification(
    worker_email: str,
    order_number: str,
    property_name: str,
    reviewed_by: str,
    review_notes: str
) -> bool:
    """
    Send notification email when changes are requested on an order.
    """
    subject = f"From: {reviewed_by} - Changes Requested: {order_number}"

    body_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #dc2626; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .detail-row {{ padding: 10px 0; border-bottom: 1px solid #e5e7eb; }}
            .label {{ font-weight: bold; color: #6b7280; }}
            .value {{ color: #111827; }}
            .notes-box {{ background-color: #fef3c7; border: 1px solid #f59e0b; padding: 15px;
                          border-radius: 6px; margin: 15px 0; }}
            .button {{ display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px;
                       text-decoration: none; border-radius: 6px; margin-top: 20px; }}
            .footer {{ text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Changes Requested</h1>
            </div>
            <div class="content">
                <p>Your order requires some changes before it can be approved.</p>

                <div class="detail-row">
                    <span class="label">Order Number:</span>
                    <span class="value">{order_number}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Property:</span>
                    <span class="value">{property_name}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Reviewed By:</span>
                    <span class="value">{reviewed_by}</span>
                </div>

                <div class="notes-box">
                    <strong>Reviewer Notes:</strong>
                    <p>{review_notes}</p>
                </div>

                <p>Please review the feedback and make the necessary changes.</p>

                <a href="{settings.FRONTEND_URL}/orders" class="button">
                    Edit Order
                </a>
            </div>
            <div class="footer">
                <p>This is an automated message from SUKAKPAK Purchasing System.</p>
            </div>
        </div>
    </body>
    </html>
    """

    body_text = f"""
    Changes Requested

    Your order requires some changes before it can be approved.

    Order Number: {order_number}
    Property: {property_name}
    Reviewed By: {reviewed_by}

    Reviewer Notes:
    {review_notes}

    Please log in to review the feedback and make the necessary changes.
    {settings.FRONTEND_URL}/orders
    """

    return send_email([worker_email], subject, body_html, body_text)


def send_flagged_items_notification(
    team_emails: List[str],
    order_number: str,
    property_name: str,
    flagged_by: str,
    flagged_items: List[dict]  # List of {item_name, issue_description}
) -> bool:
    """
    Send notification email when items are flagged during receiving.
    """
    subject = f"Items Flagged: {order_number} - {property_name}"

    items_html = ""
    items_text = ""
    for item in flagged_items:
        items_html += f"""
        <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 10px 0;">
            <strong>{item['item_name']}</strong>
            <p style="margin: 5px 0 0 0; color: #92400e;">{item['issue_description']}</p>
        </div>
        """
        items_text += f"\n- {item['item_name']}: {item['issue_description']}"

    body_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background-color: #f59e0b; color: white; padding: 20px; text-align: center; }}
            .content {{ padding: 20px; background-color: #f9fafb; }}
            .detail-row {{ padding: 10px 0; border-bottom: 1px solid #e5e7eb; }}
            .label {{ font-weight: bold; color: #6b7280; }}
            .value {{ color: #111827; }}
            .button {{ display: inline-block; background-color: #f59e0b; color: white; padding: 12px 24px;
                       text-decoration: none; border-radius: 6px; margin-top: 20px; }}
            .footer {{ text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Items Flagged During Receiving</h1>
            </div>
            <div class="content">
                <p>The following items were flagged with issues during order receiving:</p>

                <div class="detail-row">
                    <span class="label">Order Number:</span>
                    <span class="value">{order_number}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Property:</span>
                    <span class="value">{property_name}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Flagged By:</span>
                    <span class="value">{flagged_by}</span>
                </div>

                <h3 style="margin-top: 20px;">Flagged Items ({len(flagged_items)}):</h3>
                {items_html}

                <a href="{settings.FRONTEND_URL}/orders/flagged-items" class="button">
                    View Flagged Items
                </a>
            </div>
            <div class="footer">
                <p>This is an automated message from SUKAKPAK Purchasing System.</p>
            </div>
        </div>
    </body>
    </html>
    """

    body_text = f"""
    Items Flagged During Receiving

    Order Number: {order_number}
    Property: {property_name}
    Flagged By: {flagged_by}

    Flagged Items ({len(flagged_items)}):
    {items_text}

    View flagged items: {settings.FRONTEND_URL}/orders/flagged-items
    """

    return send_email(team_emails, subject, body_html, body_text)
