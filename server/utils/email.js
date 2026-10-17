const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter for sending emails
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // Use STARTTLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Only talk to the SMTP server if credentials were actually configured.
// Without this guard the server dials smtp.gmail.com on every start even when
// EMAIL_USER is blank, which delays startup and prints an alarming stack trace
// that has nothing to do with anything being wrong.
const emailConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);

if (emailConfigured) {
    transporter.verify((error) => {
        if (error) {
            console.error('Email transporter error:', error.message);
            console.error('  For Gmail, EMAIL_PASSWORD must be an App Password, not the account password.');
        } else {
            console.log('Email server is ready to send messages');
        }
    });
} else {
    console.log('[email] EMAIL_USER / EMAIL_PASSWORD not set - outgoing email is disabled.');
}

/**
 * Send email notification when a new order is created
 * @param {Object} order - Order object
 * @param {Array} takers - Array of taker users assigned to the order
 * @param {Object} maker - Maker user who created the order
 */
/**
 * Single choke point for outgoing mail. Returns false (rather than throwing)
 * when email is not configured, so callers stay simple and a missing SMTP
 * setup can never break an order operation.
 */
const deliver = async (mailOptions) => {
    if (!emailConfigured) return false;
    await transporter.sendMail(mailOptions);
    return true;
};

const sendOrderCreatedEmail = async (order, takers, maker) => {
    if (!takers || takers.length === 0) return;

    const itemsList = order.Items?.map(item => `- ${item.name} (Qty: ${item.quantity})`).join('\n') || 'No items';
    const takersList = takers.map(t => t.username).join(', ');

    for (const taker of takers) {
        if (!taker.email) continue;

        const mailOptions = {
            from: `"AMA Order System" <${process.env.EMAIL_USER}>`,
            to: taker.email,
            subject: `🆕 New Order Assigned: ${order.title}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
                    <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        <h2 style="color: #fbbf24; margin-top: 0; border-bottom: 3px solid #fbbf24; padding-bottom: 10px;">
                            🆕 New Order Assigned
                        </h2>
                        
                        <p style="font-size: 16px; color: #374151;">Hello <strong>${taker.username}</strong>,</p>
                        <p style="color: #6b7280;">You have been assigned to a new order by <strong>${maker.username}</strong>.</p>
                        
                        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #fbbf24;">
                            <h3 style="margin-top: 0; color: #1f2937;">📋 Order Details</h3>
                            
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280; width: 40%;"><strong>Customer Name:</strong></td>
                                    <td style="padding: 8px 0; color: #1f2937;">${order.title}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280;"><strong>City:</strong></td>
                                    <td style="padding: 8px 0; color: #1f2937;">${order.city || 'Not specified'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280;"><strong>Status:</strong></td>
                                    <td style="padding: 8px 0;">
                                        <span style="background: #fef3c7; color: #92400e; padding: 4px 12px; border-radius: 12px; font-size: 14px;">
                                            ${order.status}
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280;"><strong>Note:</strong></td>
                                    <td style="padding: 8px 0; color: #1f2937;">${order.description || 'No note provided'}</td>
                                </tr>
                            </table>
                            
                            <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">📦 Items:</h4>
                            <div style="background: white; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 14px; color: #374151;">
                                ${itemsList.replace(/\n/g, '<br>')}
                            </div>
                            
                            <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">👥 Assigned Takers:</h4>
                            <div style="background: white; padding: 15px; border-radius: 6px; color: #374151;">
                                ${takersList}
                            </div>
                        </div>
                        
                        <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0; color: #1e40af;">
                                <strong>👤 Created by:</strong> ${maker.username}
                            </p>
                            <p style="margin: 10px 0 0 0; color: #1e40af;">
                                <strong>🕐 Created at:</strong> ${new Date(order.createdAt).toLocaleString('en-US', {
                timeZone: 'Asia/Jerusalem',
                dateStyle: 'full',
                timeStyle: 'short'
            })}
                            </p>
                        </div>
                        
                        <p style="margin-top: 25px; font-size: 15px; color: #374151;">
                            Please log in to the system to view and manage this order.
                        </p>
                    </div>
                    
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
                    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                        This is an automated message from AMA Order System. Please do not reply to this email.
                    </p>
                </div>
            `
        };

        try {
            if (await deliver(mailOptions)) {
                console.log(`Order created email sent to ${taker.email}`);
            }
        } catch (error) {
            console.error(`Failed to send email to ${taker.email}:`, error);
        }
    }
};

/**
 * Send email notification when an order is updated
 * @param {Object} order - Updated order object
 * @param {Array} takers - Array of taker users assigned to the order
 * @param {Object} editor - User who made the update
 * @param {Array} changes - Recent order changes/logs
 */
const sendOrderUpdatedEmail = async (order, takers, editor, changes = []) => {
    if (!takers || takers.length === 0) return;

    const itemsList = order.Items?.map(item => `- ${item.name} (Qty: ${item.quantity})`).join('\n') || 'No items';
    const takersList = takers.map(t => t.username).join(', ');

    // Format changes
    let changesHtml = '';
    if (changes && changes.length > 0) {
        changesHtml = `
            <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">📝 Recent Changes:</h4>
            <div style="background: white; padding: 15px; border-radius: 6px;">
                ${changes.map(change => `
                    <div style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">
                        <div style="color: #6b7280; font-size: 13px;">
                            ${new Date(change.createdAt).toLocaleString('en-US', {
            timeZone: 'Asia/Jerusalem',
            dateStyle: 'short',
            timeStyle: 'short'
        })} - ${change.Editor?.username || 'System'}
                        </div>
                        <div style="color: #374151; margin-top: 4px;">${change.newDescription}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    for (const taker of takers) {
        if (!taker.email) continue;

        const mailOptions = {
            from: `"AMA Order System" <${process.env.EMAIL_USER}>`,
            to: taker.email,
            subject: `📝 Order Updated: ${order.title}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
                    <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                        <h2 style="color: #3b82f6; margin-top: 0; border-bottom: 3px solid #3b82f6; padding-bottom: 10px;">
                            📝 Order Updated
                        </h2>
                        
                        <p style="font-size: 16px; color: #374151;">Hello <strong>${taker.username}</strong>,</p>
                        <p style="color: #6b7280;">An order assigned to you has been updated by <strong>${editor.username}</strong>.</p>
                        
                        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6;">
                            <h3 style="margin-top: 0; color: #1f2937;">📋 Updated Order Details</h3>
                            
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280; width: 40%;"><strong>Customer Name:</strong></td>
                                    <td style="padding: 8px 0; color: #1f2937;">${order.title}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280;"><strong>City:</strong></td>
                                    <td style="padding: 8px 0; color: #1f2937;">${order.city || 'Not specified'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280;"><strong>Status:</strong></td>
                                    <td style="padding: 8px 0;">
                                        <span style="background: #dbeafe; color: #1e40af; padding: 4px 12px; border-radius: 12px; font-size: 14px;">
                                            ${order.status}
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #6b7280;"><strong>Note:</strong></td>
                                    <td style="padding: 8px 0; color: #1f2937;">${order.description || 'No note provided'}</td>
                                </tr>
                            </table>
                            
                            <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">📦 Items:</h4>
                            <div style="background: white; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 14px; color: #374151;">
                                ${itemsList.replace(/\n/g, '<br>')}
                            </div>
                            
                            <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">👥 Assigned Takers:</h4>
                            <div style="background: white; padding: 15px; border-radius: 6px; color: #374151;">
                                ${takersList}
                            </div>
                            
                            ${changesHtml}
                        </div>
                        
                        <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0; color: #1e40af;">
                                <strong>👤 Updated by:</strong> ${editor.username}
                            </p>
                            <p style="margin: 10px 0 0 0; color: #1e40af;">
                                <strong>🕐 Updated at:</strong> ${new Date(order.updatedAt).toLocaleString('en-US', {
                timeZone: 'Asia/Jerusalem',
                dateStyle: 'full',
                timeStyle: 'short'
            })}
                            </p>
                        </div>
                        
                        <p style="margin-top: 25px; font-size: 15px; color: #374151;">
                            Please log in to the system to view the updated order.
                        </p>
                    </div>
                    
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
                    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                        This is an automated message from AMA Order System. Please do not reply to this email.
                    </p>
                </div>
            `
        };

        try {
            if (await deliver(mailOptions)) {
                console.log(`Order updated email sent to ${taker.email}`);
            }
        } catch (error) {
            console.error(`Failed to send email to ${taker.email}:`, error);
        }
    }
};

/**
 * Send email notification to maker when taker updates an order
 * @param {Object} order - Updated order object
 * @param {Object} maker - Maker user who created the order
 * @param {Object} taker - Taker user who made the update
 * @param {Array} changes - Recent order changes/logs
 */
const sendOrderUpdatedByTakerEmail = async (order, maker, taker, changes = []) => {
    if (!maker.email) return;

    const itemsList = order.Items?.map(item => `- ${item.name} (Qty: ${item.quantity})`).join('\n') || 'No items';
    const takersList = order.AssignedTakers?.map(t => t.username).join(', ') || 'None';

    // Format changes
    let changesHtml = '';
    if (changes && changes.length > 0) {
        changesHtml = `
            <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">📝 Recent Changes:</h4>
            <div style="background: white; padding: 15px; border-radius: 6px;">
                ${changes.map(change => `
                    <div style="padding: 8px 0; border-bottom: 1px solid #f3f4f6;">
                        <div style="color: #6b7280; font-size: 13px;">
                            ${new Date(change.createdAt).toLocaleString('en-US', {
            timeZone: 'Asia/Jerusalem',
            dateStyle: 'short',
            timeStyle: 'short'
        })} - ${change.Editor?.username || 'System'}
                        </div>
                        <div style="color: #374151; margin-top: 4px;">${change.newDescription}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    const mailOptions = {
        from: `"AMA Order System" <${process.env.EMAIL_USER}>`,
        to: maker.email,
        subject: `🔔 Taker Updated Your Order: ${order.title}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
                <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <h2 style="color: #10b981; margin-top: 0; border-bottom: 3px solid #10b981; padding-bottom: 10px;">
                        🔔 Order Updated by Taker
                    </h2>
                    
                    <p style="font-size: 16px; color: #374151;">Hello <strong>${maker.username}</strong>,</p>
                    <p style="color: #6b7280;">Taker <strong>${taker.username}</strong> has updated one of your orders.</p>
                    
                    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
                        <h3 style="margin-top: 0; color: #1f2937;">📋 Order Details</h3>
                        
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280; width: 40%;"><strong>Customer Name:</strong></td>
                                <td style="padding: 8px 0; color: #1f2937;">${order.title}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280;"><strong>City:</strong></td>
                                <td style="padding: 8px 0; color: #1f2937;">${order.city || 'Not specified'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280;"><strong>Status:</strong></td>
                                <td style="padding: 8px 0;">
                                    <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 14px;">
                                        ${order.status}
                                    </span>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280;"><strong>Note:</strong></td>
                                <td style="padding: 8px 0; color: #1f2937;">${order.description || 'No note provided'}</td>
                            </tr>
                        </table>
                        
                        <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">📦 Items:</h4>
                        <div style="background: white; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 14px; color: #374151;">
                            ${itemsList.replace(/\n/g, '<br>')}
                        </div>
                        
                        <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">👥 Assigned Takers:</h4>
                        <div style="background: white; padding: 15px; border-radius: 6px; color: #374151;">
                            ${takersList}
                        </div>
                        
                        ${changesHtml}
                    </div>
                    
                    <div style="background: #ecfdf5; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0; color: #065f46;">
                            <strong>👤 Updated by:</strong> ${taker.username}
                        </p>
                        <p style="margin: 10px 0 0 0; color: #065f46;">
                            <strong>🕐 Updated at:</strong> ${new Date(order.updatedAt).toLocaleString('en-US', {
            timeZone: 'Asia/Jerusalem',
            dateStyle: 'full',
            timeStyle: 'short'
        })}
                        </p>
                    </div>
                    
                    <p style="margin-top: 25px; font-size: 15px; color: #374151;">
                        Please log in to the system to review the changes.
                    </p>
                </div>
                
                <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    This is an automated message from AMA Order System. Please do not reply to this email.
                </p>
            </div>
        `
    };

    try {
        if (await deliver(mailOptions)) {
            console.log(`Order updated by taker email sent to ${maker.email}`);
        }
    } catch (error) {
        console.error(`Failed to send email to ${maker.email}:`, error);
    }
};

/**
 * Send bulk email notification when multiple orders are sent at once
 * @param {Array} orders - Array of order objects
 * @param {Object} taker - Taker user receiving the orders
 * @param {Object} sender - User who sent the bulk orders
 */
const sendBulkOrdersEmail = async (orders, taker, sender) => {
    if (!taker.email || !orders || orders.length === 0) return;

    // Group orders by customer name for better organization
    const ordersHtml = orders.map((order, index) => {
        const itemsList = order.Items?.map(item => `${item.name} (Qty: ${item.quantity})`).join(', ') || 'No items';

        return `
            <div style="background: white; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #fbbf24;">
                <h4 style="margin: 0 0 10px 0; color: #1f2937;">📦 Order ${index + 1}: ${order.title}</h4>
                <table style="width: 100%; font-size: 14px;">
                    <tr>
                        <td style="padding: 4px 0; color: #6b7280; width: 30%;"><strong>City:</strong></td>
                        <td style="padding: 4px 0; color: #374151;">${order.city || 'Not specified'}</td>
                    </tr>
                    <tr>
                        <td style="padding: 4px 0; color: #6b7280;"><strong>Status:</strong></td>
                        <td style="padding: 4px 0;">
                            <span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 8px; font-size: 12px;">
                                ${order.status}
                            </span>
                        </td>
                    </tr>
                    ${order.description ? `
                    <tr>
                        <td style="padding: 4px 0; color: #6b7280;"><strong>Note:</strong></td>
                        <td style="padding: 4px 0; color: #374151;">${order.description}</td>
                    </tr>
                    ` : ''}
                    <tr>
                        <td style="padding: 4px 0; color: #6b7280;"><strong>Items:</strong></td>
                        <td style="padding: 4px 0; color: #374151;">${itemsList}</td>
                    </tr>
                </table>
            </div>
        `;
    }).join('');

    const mailOptions = {
        from: `"AMA Order System" <${process.env.EMAIL_USER}>`,
        to: taker.email,
        subject: `📦 ${orders.length} New Orders Assigned to You`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #f9fafb; padding: 20px;">
                <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <h2 style="color: #fbbf24; margin-top: 0; border-bottom: 3px solid #fbbf24; padding-bottom: 10px;">
                        📦 ${orders.length} New Orders Assigned
                    </h2>
                    
                    <p style="font-size: 16px; color: #374151;">Hello <strong>${taker.username}</strong>,</p>
                    <p style="color: #6b7280;">You have been assigned to <strong>${orders.length} new orders</strong> by <strong>${sender.username}</strong>.</p>
                    
                    <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0; color: #1e40af;">
                            <strong>📊 Summary:</strong> ${orders.length} orders
                        </p>
                        <p style="margin: 10px 0 0 0; color: #1e40af;">
                            <strong>👤 Sent by:</strong> ${sender.username}
                        </p>
                        <p style="margin: 10px 0 0 0; color: #1e40af;">
                            <strong>🕐 Sent at:</strong> ${new Date().toLocaleString('en-US', {
            timeZone: 'Asia/Jerusalem',
            dateStyle: 'full',
            timeStyle: 'short'
        })}
                        </p>
                    </div>
                    
                    <h3 style="color: #1f2937; margin-top: 25px; margin-bottom: 15px;">📋 Order Details:</h3>
                    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px;">
                        ${ordersHtml}
                    </div>
                    
                    <p style="margin-top: 25px; font-size: 15px; color: #374151;">
                        Please log in to the system to view and manage these orders.
                    </p>
                </div>
                
                <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    This is an automated message from AMA Order System. Please do not reply to this email.
                </p>
            </div>
        `
    };

    try {
        if (await deliver(mailOptions)) {
            console.log(`Bulk orders email sent to ${taker.email} (${orders.length} orders)`);
        }
    } catch (error) {
        console.error(`Failed to send bulk email to ${taker.email}:`, error);
    }
};

/**
 * Send email notification to accounter when an order is completed
 * @param {Object} order - Completed order object
 * @param {Object} accounter - Accounter user assigned to the order
 */
const sendCompletedOrderToAccounterEmail = async (order, accounter) => {
    if (!accounter.email) return;

    const itemsList = order.Items?.map(item => `- ${item.name} (Qty: ${item.quantity}${item.price ? `, Price: ${item.price} ₪` : ''})`).join('\n') || 'No items';

    const mailOptions = {
        from: `"AMA Order System" <${process.env.EMAIL_USER}>`,
        to: accounter.email,
        subject: `✅ New Completed Order Ready for Review: ${order.title}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9fafb; padding: 20px;">
                <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <h2 style="color: #10b981; margin-top: 0; border-bottom: 3px solid #10b981; padding-bottom: 10px;">
                        ✅ New Completed Order Ready for Review
                    </h2>
                    
                    <p style="font-size: 16px; color: #374151;">Hello <strong>${accounter.username}</strong>,</p>
                    <p style="color: #6b7280;">A new completed order has been assigned to you and is ready for review.</p>
                    
                    <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981;">
                        <h3 style="margin-top: 0; color: #1f2937;">📋 Order Details</h3>
                        
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280; width: 40%;"><strong>Order ID:</strong></td>
                                <td style="padding: 8px 0; color: #1f2937;">#${order.id}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280;"><strong>Customer Name:</strong></td>
                                <td style="padding: 8px 0; color: #1f2937;">${order.title}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280;"><strong>City:</strong></td>
                                <td style="padding: 8px 0; color: #1f2937;">${order.city || 'Not specified'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280;"><strong>Status:</strong></td>
                                <td style="padding: 8px 0;">
                                    <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 14px;">
                                        Completed
                                    </span>
                                </td>
                            </tr>
                            ${order.description ? `
                            <tr>
                                <td style="padding: 8px 0; color: #6b7280;"><strong>Note:</strong></td>
                                <td style="padding: 8px 0; color: #1f2937;">${order.description}</td>
                            </tr>
                            ` : ''}
                        </table>
                        
                        <h4 style="margin-top: 20px; margin-bottom: 10px; color: #1f2937;">📦 Items:</h4>
                        <div style="background: white; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 14px; color: #374151;">
                            ${itemsList.replace(/\n/g, '<br>')}
                        </div>
                    </div>
                    
                    <div style="background: #ecfdf5; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0; color: #065f46;">
                            <strong>👤 Created by:</strong> ${order.Maker?.username || 'Unknown'}
                        </p>
                        <p style="margin: 10px 0 0 0; color: #065f46;">
                            <strong>🕐 Completed at:</strong> ${new Date().toLocaleString('en-US', {
            timeZone: 'Asia/Jerusalem',
            dateStyle: 'full',
            timeStyle: 'short'
        })}
                        </p>
                    </div>
                    
                    <p style="margin-top: 25px; font-size: 15px; color: #374151;">
                        Please log in to the system to review this order and mark it as entered to ERP when ready.
                    </p>
                </div>
                
                <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    This is an automated message from AMA Order System. Please do not reply to this email.
                </p>
            </div>
        `
    };

    try {
        if (await deliver(mailOptions)) {
            console.log(`Completed order email sent to accounter ${accounter.email}`);
        }
    } catch (error) {
        console.error(`Failed to send email to accounter ${accounter.email}:`, error);
    }
};

module.exports = {
    sendOrderCreatedEmail,
    sendOrderUpdatedEmail,
    sendOrderUpdatedByTakerEmail,
    sendBulkOrdersEmail,
    sendCompletedOrderToAccounterEmail
};
