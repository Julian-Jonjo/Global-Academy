const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles,
    isAdminOrProprietor,
    isPrimaryFinanceOfficer,
    isSecondaryFinanceOfficer,
    isFinanceRole
} = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// ROLE PERMISSIONS
// ============================================================

const FINANCE_MANAGEMENT_ROLES = [
    'Primary Finance Officer',
    'Secondary Finance Officer'
];

// ============================================================
// GET PAYMENTS SUMMARY (Role-filtered)
// ============================================================

router.get('/summary', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('student_fees')
            .select(`
                fee_id,
                student_id,
                fee_type_id,
                amount_due,
                total_paid,
                balance,
                payment_status,
                school_section
            `);

        // Role-based filtering
        if (isPrimaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data: fees, error } = await query;

        if (error) throw error;

        // Calculate summary
        const summary = {
            total_expected: 0,
            total_collected: 0,
            total_outstanding: 0,
            total_students: 0,
            paid_records: 0,
            partially_paid_records: 0,
            unpaid_records: 0
        };

        (fees || []).forEach(fee => {
            const expected = Number(fee.amount_due || 0);
            const paid = Number(fee.total_paid || 0);
            const balance = Number(fee.balance || 0);

            summary.total_expected += expected;
            summary.total_collected += paid;
            summary.total_outstanding += balance;

            if (fee.payment_status === 'Paid') {
                summary.paid_records++;
            } else if (fee.payment_status === 'Partially Paid') {
                summary.partially_paid_records++;
            } else {
                summary.unpaid_records++;
            }
        });

        // Count unique students
        const uniqueStudents = new Set((fees || []).map(f => f.student_id));
        summary.total_students = uniqueStudents.size;

        res.json({ summary });
    } catch (error) {
        console.error('Error loading payment summary:', error);
        res.status(500).json({ message: 'Failed to load payment summary' });
    }
});

// ============================================================
// GET FEE SUMMARY BY CATEGORY (Role-filtered)
// ============================================================

router.get('/summary-by-fee', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('student_fees')
            .select(`
                fee_id,
                amount_due,
                total_paid,
                balance,
                payment_status,
                school_section,
                fee_types (
                    fee_type_id,
                    fee_name
                )
            `);

        if (isPrimaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data, error } = await query;

        if (error) throw error;

        // Group by fee type
        const categories = {};
        
        (data || []).forEach(item => {
            const feeName = item.fee_types?.fee_name || 'Other';
            
            if (!categories[feeName]) {
                categories[feeName] = {
                    fee_name: feeName,
                    total_expected: 0,
                    total_collected: 0,
                    total_outstanding: 0,
                    paid_records: 0,
                    partially_paid_records: 0,
                    unpaid_records: 0
                };
            }

            categories[feeName].total_expected += Number(item.amount_due || 0);
            categories[feeName].total_collected += Number(item.total_paid || 0);
            categories[feeName].total_outstanding += Number(item.balance || 0);

            if (item.payment_status === 'Paid') {
                categories[feeName].paid_records++;
            } else if (item.payment_status === 'Partially Paid') {
                categories[feeName].partially_paid_records++;
            } else {
                categories[feeName].unpaid_records++;
            }
        });

        res.json({ categories: Object.values(categories) });
    } catch (error) {
        console.error('Error loading fee summary:', error);
        res.status(500).json({ message: 'Failed to load fee summary' });
    }
});

// ============================================================
// GET STUDENTS WITH FINANCE INFO (Role-filtered)
// ============================================================

router.get('/students', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('students')
            .select(`
                student_id,
                admission_number,
                first_name,
                middle_name,
                last_name,
                school_section,
                classes (
                    class_name,
                    arm
                )
            `)
            .eq('student_status', 'Active');

        if (isPrimaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data: students, error: studentsError } = await query;

        if (studentsError) throw studentsError;

        // Get fees for these students
        const studentIds = (students || []).map(s => s.student_id);

        let feesQuery = supabase
            .from('student_fees')
            .select('*')
            .in('student_id', studentIds.length ? studentIds : [0]);

        if (isPrimaryFinanceOfficer(userRole)) {
            feesQuery = feesQuery.ilike('school_section', '%primary%');
        } else if (isSecondaryFinanceOfficer(userRole)) {
            feesQuery = feesQuery.ilike('school_section', '%secondary%');
        }

        const { data: fees, error: feesError } = await feesQuery;

        if (feesError) throw feesError;

        // Combine student and fee data
        const result = (students || []).map(student => {
            const studentFees = (fees || []).filter(f => f.student_id === student.student_id);
            
            const total_expected = studentFees.reduce((sum, f) => sum + Number(f.amount_due || 0), 0);
            const total_paid = studentFees.reduce((sum, f) => sum + Number(f.total_paid || 0), 0);
            const total_balance = studentFees.reduce((sum, f) => sum + Number(f.balance || 0), 0);
            const paid_fees = studentFees.filter(f => f.payment_status === 'Paid').length;
            const partially_paid_fees = studentFees.filter(f => f.payment_status === 'Partially Paid').length;
            const unpaid_fees = studentFees.filter(f => f.payment_status === 'Unpaid').length;

            return {
                student_id: student.student_id,
                admission_number: student.admission_number,
                student_name: [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' '),
                class_name: student.classes?.class_name || 'N/A',
                arm: student.classes?.arm || '',
                total_expected,
                total_paid,
                total_balance,
                paid_fees,
                partially_paid_fees,
                unpaid_fees
            };
        });

        res.json({ students: result });
    } catch (error) {
        console.error('Error loading finance students:', error);
        res.status(500).json({ message: 'Failed to load students' });
    }
});

// ============================================================
// GET FEE BALANCES (Role-filtered)
// ============================================================

router.get('/balances', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('student_fees')
            .select(`
                fee_id,
                student_id,
                fee_type_id,
                amount_due,
                total_paid,
                balance,
                payment_status,
                school_section,
                academic_year_id,
                term_id,
                students (
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    classes (
                        class_name,
                        arm
                    )
                ),
                fee_types (
                    fee_type_id,
                    fee_name
                ),
                academic_years (
                    academic_year_id,
                    year_name
                ),
                terms (
                    term_id,
                    term_name
                )
            `);

        if (isPrimaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;

        if (error) throw error;

        const balances = (data || []).map(item => ({
            fee_id: item.fee_id,
            student_id: item.student_id,
            admission_number: item.students?.admission_number || 'N/A',
            student_name: [item.students?.first_name, item.students?.middle_name, item.students?.last_name].filter(Boolean).join(' ') || 'N/A',
            class_name: item.students?.classes?.class_name || 'N/A',
            arm: item.students?.classes?.arm || '',
            fee_name: item.fee_types?.fee_name || 'N/A',
            academic_year: item.academic_years?.year_name || 'N/A',
            term_name: item.terms?.term_name || 'N/A',
            amount_due: item.amount_due,
            total_paid: item.total_paid,
            balance: item.balance,
            payment_status: item.payment_status,
            school_section: item.school_section
        }));

        res.json({ balances });
    } catch (error) {
        console.error('Error loading balances:', error);
        res.status(500).json({ message: 'Failed to load balances' });
    }
});

// ============================================================
// GET PAYMENT HISTORY (Role-filtered)
// ============================================================

router.get('/history', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('payment_history')
            .select(`
                payment_id,
                student_id,
                fee_id,
                amount_paid,
                payment_method,
                payment_date,
                payment_slip_number,
                bank_reference,
                purpose,
                school_section,
                students (
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    classes (
                        class_name,
                        arm
                    )
                ),
                student_fees (
                    fee_id,
                    fee_types (
                        fee_name
                    )
                )
            `)
            .order('payment_date', { ascending: false });

        if (isPrimaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data, error } = await query;

        if (error) throw error;

        const payments = (data || []).map(item => ({
            payment_id: item.payment_id,
            student_id: item.student_id,
            admission_number: item.students?.admission_number || 'N/A',
            student_name: [item.students?.first_name, item.students?.middle_name, item.students?.last_name].filter(Boolean).join(' ') || 'N/A',
            class_name: item.students?.classes?.class_name || 'N/A',
            arm: item.students?.classes?.arm || '',
            fee_name: item.student_fees?.fee_types?.fee_name || 'N/A',
            amount_paid: item.amount_paid,
            payment_method: item.payment_method,
            payment_date: item.payment_date,
            payment_slip_number: item.payment_slip_number,
            bank_reference: item.bank_reference,
            purpose: item.purpose,
            school_section: item.school_section
        }));

        res.json({ payments });
    } catch (error) {
        console.error('Error loading payment history:', error);
        res.status(500).json({ message: 'Failed to load payment history' });
    }
});

// ============================================================
// RECORD PAYMENT (Finance Officers only, section-enforced)
// ============================================================

router.post('/record', authenticateToken, requireRoles(...FINANCE_MANAGEMENT_ROLES), async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        const {
            student_id,
            fee_id,
            amount_paid,
            payment_method,
            payment_slip_number,
            bank_reference,
            purpose,
            school_section
        } = req.body;

        if (!student_id || !fee_id || !amount_paid) {
            return res.status(400).json({ 
                message: 'Student, fee and amount are required' 
            });
        }

        const requestedSection = (school_section || '').toLowerCase();

        // Enforce section access
        if (isPrimaryFinanceOfficer(userRole) && !requestedSection.includes('primary')) {
            return res.status(403).json({
                message: 'Primary Finance Officer can only record Primary School payments.'
            });
        }

        if (isSecondaryFinanceOfficer(userRole) && !requestedSection.includes('secondary')) {
            return res.status(403).json({
                message: 'Secondary Finance Officer can only record Secondary School payments.'
            });
        }

        // Insert payment record
        const { data: payment, error: paymentError } = await supabase
            .from('payment_history')
            .insert([{
                student_id,
                fee_id,
                amount_paid,
                payment_method,
                payment_slip_number,
                bank_reference,
                purpose,
                school_section,
                payment_date: new Date().toISOString()
            }])
            .select()
            .single();

        if (paymentError) throw paymentError;

        // Update student fee balance
        const { data: existingFee, error: feeFetchError } = await supabase
            .from('student_fees')
            .select('total_paid, balance, payment_status')
            .eq('fee_id', fee_id)
            .single();

        if (feeFetchError) throw feeFetchError;

        const newTotalPaid = Number(existingFee.total_paid || 0) + Number(amount_paid);
        const newBalance = Number(existingFee.balance || 0) - Number(amount_paid);
        let newStatus = 'Partially Paid';
        
        if (newBalance <= 0) {
            newStatus = 'Paid';
        } else if (newTotalPaid <= 0) {
            newStatus = 'Unpaid';
        }

        const { error: updateError } = await supabase
            .from('student_fees')
            .update({
                total_paid: newTotalPaid,
                balance: newBalance,
                payment_status: newStatus
            })
            .eq('fee_id', fee_id);

        if (updateError) throw updateError;

        res.status(201).json({
            message: 'Payment recorded successfully',
            payment
        });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ message: 'Failed to record payment' });
    }
});

// ============================================================
// GET ALL PAYMENTS (Role-filtered)
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('payments')
            .select('*')
            .order('payment_date', { ascending: false });

        if (isPrimaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryFinanceOfficer(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading payments:', error);
        res.status(500).json({ message: 'Failed to load payments' });
    }
});

module.exports = router;