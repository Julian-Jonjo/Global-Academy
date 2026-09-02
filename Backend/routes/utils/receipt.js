// utils/receipt.js
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/supabase');

// Generate unique receipt number
async function generateReceiptNumber(sector) {
    const prefix = sector === 'primary' ? 'PR' : 'SC';
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Get last receipt number for this prefix
    const { data } = await supabase
        .from('payments')
        .select('receipt_number')
        .ilike('receipt_number', `${prefix}${year}${month}%`)
        .order('receipt_number', { ascending: false })
        .limit(1);

    let lastNumber = 0;
    if (data && data.length > 0) {
        const match = data[0].receipt_number.match(/\d{4}$/);
        if (match) {
            lastNumber = parseInt(match[0]);
        }
    }

    const nextNumber = String(lastNumber + 1).padStart(4, '0');
    return `${prefix}${year}${month}${nextNumber}`;
}

// Generate Receipt PDF
async function generateReceiptPDF(data) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 50, bottom: 50, left: 50, right: 50 }
            });

            const filename = `receipt-${data.receipt_number}.pdf`;
            const filepath = path.join(__dirname, '../uploads/receipts', filename);
            
            // Ensure directory exists
            const dir = path.dirname(filepath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const stream = fs.createWriteStream(filepath);
            doc.pipe(stream);

            // Header
            doc.fontSize(20)
                .font('Helvetica-Bold')
                .text('GLOBAL EDUCATION ACADEMY', { align: 'center' });
            
            doc.fontSize(12)
                .font('Helvetica')
                .text(data.school_sector === 'primary' ? 'Primary School' : 'Secondary School', { align: 'center' })
                .moveDown(0.5);

            // Receipt Title
            doc.fontSize(16)
                .font('Helvetica-Bold')
                .text('PAYMENT RECEIPT', { align: 'center' })
                .moveDown(0.5);

            // Receipt Details Box
            const startX = 50;
            let startY = doc.y;

            // Border box
            doc.rect(startX, startY, 495, 200)
                .stroke();

            // Receipt number
            doc.fontSize(10)
                .font('Helvetica-Bold')
                .text('Receipt No:', startX + 20, startY + 15)
                .font('Helvetica')
                .text(data.receipt_number || 'N/A', startX + 120, startY + 15);

            // Date
            doc.font('Helvetica-Bold')
                .text('Date:', startX + 300, startY + 15)
                .font('Helvetica')
                .text(new Date(data.payment_date).toLocaleDateString(), startX + 370, startY + 15);

            // Student Name
            doc.font('Helvetica-Bold')
                .text('Student Name:', startX + 20, startY + 45)
                .font('Helvetica')
                .text(data.student_name || 'N/A', startX + 120, startY + 45);

            // Admission Number
            doc.font('Helvetica-Bold')
                .text('Admission No:', startX + 300, startY + 45)
                .font('Helvetica')
                .text(data.admission_number || 'N/A', startX + 400, startY + 45);

            // Fee Description
            doc.font('Helvetica-Bold')
                .text('Fee Description:', startX + 20, startY + 75)
                .font('Helvetica')
                .text(data.fee_name || 'N/A', startX + 120, startY + 75);

            // Academic Year
            doc.font('Helvetica-Bold')
                .text('Academic Year:', startX + 20, startY + 105)
                .font('Helvetica')
                .text(data.academic_year || 'N/A', startX + 120, startY + 105);

            // Term
            doc.font('Helvetica-Bold')
                .text('Term:', startX + 300, startY + 105)
                .font('Helvetica')
                .text(data.term || 'N/A', startX + 370, startY + 105);

            // Amount
            doc.font('Helvetica-Bold')
                .text('Amount Paid:', startX + 20, startY + 135)
                .font('Helvetica')
                .text(`Le${Number(data.amount_paid).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, startX + 120, startY + 135);

            // Payment Method
            doc.font('Helvetica-Bold')
                .text('Payment Method:', startX + 300, startY + 135)
                .font('Helvetica')
                .text(data.payment_method || 'N/A', startX + 400, startY + 135);

            // Purpose
            if (data.purpose) {
                doc.font('Helvetica-Bold')
                    .text('Purpose:', startX + 20, startY + 165)
                    .font('Helvetica')
                    .text(data.purpose, startX + 120, startY + 165, { width: 350 });
            }

            doc.moveDown(2);

            // Payment Status
            doc.fontSize(14)
                .font('Helvetica-Bold')
                .fillColor('#166534')
                .text('✓ PAID', { align: 'center' })
                .fillColor('#000000');

            doc.moveDown(1);

            // Footer
            doc.fontSize(9)
                .font('Helvetica')
                .text('This is a computer-generated receipt. No signature required.', { align: 'center' });

            doc.text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });

            // Footer line
            doc.moveDown(0.5);
            doc.text('Thank you for your payment!', { align: 'center' });

            // Finalize PDF
            doc.end();

            stream.on('finish', () => {
                resolve(`/uploads/receipts/${filename}`);
            });

            stream.on('error', (err) => {
                reject(err);
            });

        } catch (error) {
            reject(error);
        }
    });
}

// Download receipt
async function getReceiptUrl(receiptPath) {
    if (!receiptPath) return null;
    return `${process.env.BASE_URL || ''}${receiptPath}`;
}

module.exports = {
    generateReceiptNumber,
    generateReceiptPDF,
    getReceiptUrl
};