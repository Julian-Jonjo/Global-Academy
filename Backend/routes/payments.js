const express = require('express');
const router = express.Router();
const supabase = require('../Config/db');
const { authenticateToken } = require('../middleware/authMiddleware');

console.log('🔍 Loading payments.js...');

// ============================================================
// GET: Payment History
// ============================================================
router.get('/history', authenticateToken, async (req, res) => {
    try {
        console.log('📜 /history called');
        console.log('🔍 Query:', req.query);

        const { student_id } = req.query;

        let query = supabase
            .from('payments')
            .select('*')
            .order('payment_date', { ascending: false });

        if (student_id) {
            query = query.eq('student_id', parseInt(student_id));
        }

        const { data: payments, error } = await query;

        if (error) {
            console.error('❌ Query error:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log('✅ Found payments:', payments?.length || 0);

        res.json({ payments: payments || [] });

    } catch (error) {
        console.error('❌ History error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// GET: Payment Summary
// ============================================================
router.get('/summary', authenticateToken, async (req, res) => {
    try {
        console.log('📊 /summary called');
        console.log('🔍 Query:', req.query);

        const { sector, academic_year } = req.query;

        // Get academic_year_id
        let academicYearId = null;
        if (academic_year) {
            const { data: yearData } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('year_name', academic_year)
                .single();

            if (yearData) {
                academicYearId = yearData.academic_year_id;
            }
        }

        if (!academicYearId) {
            const { data: currentYear } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('is_current', true)
                .single();
            if (currentYear) {
                academicYearId = currentYear.academic_year_id;
            }
        }

        console.log('📊 Academic Year ID:', academicYearId);

        // =========================================================
        // Get ALL student fees
        // =========================================================
        let feeQuery = supabase
            .from('student_fees')
            .select(`
                student_fee_id,
                student_id,
                amount_due,
                academic_year_id,
                students!inner (
                    student_id,
                    first_name,
                    last_name,
                    school_section
                )
            `);

        if (academicYearId) {
            feeQuery = feeQuery.eq('academic_year_id', academicYearId);
        }

        // Filter by sector
        if (sector) {
            if (sector.toLowerCase() === 'primary') {
                feeQuery = feeQuery.in('students.school_section', ['Primary', 'Nursery']);
            } else if (sector.toLowerCase() === 'secondary') {
                feeQuery = feeQuery.in('students.school_section', ['Secondary', 'JSS', 'SSS']);
            }
        }

        const { data: feeRecords } = await feeQuery;

        console.log('📊 Fee records found:', feeRecords?.length || 0);

        let totalExpected = 0;
        const studentSet = new Set();

        (feeRecords || []).forEach(record => {
            const amount = Number(record.amount_due || 0);
            totalExpected += amount;
            if (record.student_id) {
                studentSet.add(record.student_id);
            }
        });

        console.log('📊 Total Expected:', totalExpected);
        console.log('📊 Students with fees:', studentSet.size);

        // =========================================================
        // Get APPROVED payments
        // =========================================================
        let paymentQuery = supabase
            .from('payments')
            .select(`
                payment_id,
                student_id,
                amount_paid,
                approval_status,
                academic_year_id
            `)
            .eq('approval_status', 'approved');

        if (academicYearId) {
            paymentQuery = paymentQuery.eq('academic_year_id', academicYearId);
        }

        // Filter by sector using student IDs
        if (sector) {
            let studentIds = [];
            if (sector.toLowerCase() === 'primary') {
                const { data: students } = await supabase
                    .from('students')
                    .select('student_id')
                    .in('school_section', ['Primary', 'Nursery']);
                studentIds = (students || []).map(s => s.student_id);
            } else if (sector.toLowerCase() === 'secondary') {
                const { data: students } = await supabase
                    .from('students')
                    .select('student_id')
                    .in('school_section', ['Secondary', 'JSS', 'SSS']);
                studentIds = (students || []).map(s => s.student_id);
            }

            if (studentIds.length > 0) {
                paymentQuery = paymentQuery.in('student_id', studentIds);
            } else {
                paymentQuery = paymentQuery.in('student_id', []);
            }
        }

        const { data: paymentRecords } = await paymentQuery;

        let totalCollected = 0;
        (paymentRecords || []).forEach(record => {
            totalCollected += Number(record.amount_paid || 0);
        });

        console.log('📊 Total Collected:', totalCollected);

        // =========================================================
        // Calculate Outstanding
        // =========================================================
        const totalOutstanding = totalExpected - totalCollected;

        console.log('📊 Total Outstanding:', totalOutstanding);

        // =========================================================
        // Get total active students in this sector
        // =========================================================
        let studentCountQuery = supabase
            .from('students')
            .select('student_id', { count: 'exact', head: true })
            .eq('student_status', 'Active');

        if (sector) {
            if (sector.toLowerCase() === 'primary') {
                studentCountQuery = studentCountQuery.in('school_section', ['Primary', 'Nursery']);
            } else if (sector.toLowerCase() === 'secondary') {
                studentCountQuery = studentCountQuery.in('school_section', ['Secondary', 'JSS', 'SSS']);
            }
        }

        const { count: totalStudents } = await studentCountQuery;

        res.json({
            summary: {
                total_expected: totalExpected,
                total_collected: totalCollected,
                total_outstanding: totalOutstanding,
                total_students: totalStudents || 0
            }
        });

    } catch (error) {
        console.error('❌ Summary error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// GET: Students Finance Data (ALL students, with fee data if available)
// ============================================================
router.get('/students', authenticateToken, async (req, res) => {
    try {
        console.log('👨‍🎓 /students called');
        console.log('🔍 Query:', req.query);

        const { sector, academic_year } = req.query;

        // Get academic_year_id
        let academicYearId = null;
        if (academic_year) {
            const { data: yearData } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('year_name', academic_year)
                .single();

            if (yearData) {
                academicYearId = yearData.academic_year_id;
            }
        }

        if (!academicYearId) {
            const { data: currentYear } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('is_current', true)
                .single();
            if (currentYear) {
                academicYearId = currentYear.academic_year_id;
            }
        }

        // =========================================================
        // STEP 1: Get ALL active students
        // =========================================================
        let studentQuery = supabase
            .from('students')
            .select(`
                student_id,
                first_name,
                middle_name,
                last_name,
                admission_number,
                student_status,
                school_section,
                classes!inner (
                    class_name,
                    arm
                )
            `)
            .eq('student_status', 'Active');

        // Filter by sector - use exact values
        if (sector) {
            if (sector.toLowerCase() === 'primary') {
                studentQuery = studentQuery.in('school_section', ['Primary', 'Nursery']);
            } else if (sector.toLowerCase() === 'secondary') {
                studentQuery = studentQuery.in('school_section', ['Secondary', 'JSS', 'SSS']);
            }
        }

        const { data: students, error: studentError } = await studentQuery;

        if (studentError) {
            console.error('❌ Students query error:', studentError);
            return res.status(500).json({ error: studentError.message });
        }

        console.log('📊 Total students found:', students?.length || 0);

        if (!students || students.length === 0) {
            return res.json({ students: [] });
        }

        const studentIds = students.map(s => s.student_id);

        // =========================================================
        // STEP 2: Get fee records for these students
        // =========================================================
        let feeQuery = supabase
            .from('student_fees')
            .select(`
                student_fee_id,
                student_id,
                fee_type_id,
                amount_due,
                academic_year_id,
                fee_types!inner (fee_name)
            `)
            .in('student_id', studentIds);

        if (academicYearId) {
            feeQuery = feeQuery.eq('academic_year_id', academicYearId);
        }

        const { data: feeRecords } = await feeQuery;

        console.log('📊 Fee records found:', feeRecords?.length || 0);

        // =========================================================
        // STEP 3: Get approved payments for these students
        // =========================================================
        let paymentQuery = supabase
            .from('payments')
            .select(`
                payment_id,
                student_id,
                amount_paid,
                approval_status,
                academic_year_id
            `)
            .in('student_id', studentIds)
            .eq('approval_status', 'approved');

        if (academicYearId) {
            paymentQuery = paymentQuery.eq('academic_year_id', academicYearId);
        }

        const { data: paymentRecords } = await paymentQuery;

        console.log('📊 Payment records found:', paymentRecords?.length || 0);

        // =========================================================
        // STEP 4: Build fee map per student
        // =========================================================
        const feeMap = {};
        studentIds.forEach(id => {
            feeMap[id] = {
                total_expected: 0,
                total_paid: 0,
                total_balance: 0,
                paid_fees: 0,
                partially_paid_fees: 0,
                unpaid_fees: 0,
                fee_details: [],
                payment_count: 0
            };
        });

        // Process fee records
        (feeRecords || []).forEach(record => {
            const studentId = record.student_id;
            if (feeMap[studentId]) {
                const amount = Number(record.amount_due || 0);
                feeMap[studentId].total_expected += amount;
                feeMap[studentId].fee_details.push({
                    student_fee_id: record.student_fee_id,
                    fee_type_id: record.fee_type_id,
                    fee_name: record.fee_types?.fee_name || 'Unknown',
                    amount_due: amount,
                    amount_paid: 0,
                    balance: amount
                });
            }
        });

        // Process payments
        (paymentRecords || []).forEach(payment => {
            const studentId = payment.student_id;
            if (feeMap[studentId]) {
                feeMap[studentId].total_paid += Number(payment.amount_paid || 0);
                feeMap[studentId].payment_count += 1;
            }
        });

        // Calculate balances and counts
        studentIds.forEach(id => {
            if (feeMap[id]) {
                const map = feeMap[id];
                map.total_balance = map.total_expected - map.total_paid;

                // Update individual fee balances
                let remainingPaid = map.total_paid;
                map.fee_details.forEach(fee => {
                    if (remainingPaid > 0) {
                        const paidAmount = Math.min(remainingPaid, fee.amount_due);
                        fee.amount_paid = paidAmount;
                        fee.balance = fee.amount_due - paidAmount;
                        remainingPaid -= paidAmount;
                    }
                });

                // Count fee statuses
                map.fee_details.forEach(fee => {
                    if (fee.balance <= 0 && fee.amount_due > 0) {
                        map.paid_fees += 1;
                    } else if (fee.amount_paid > 0 && fee.balance > 0) {
                        map.partially_paid_fees += 1;
                    } else if (fee.balance > 0 && fee.amount_paid === 0) {
                        map.unpaid_fees += 1;
                    }
                });
            }
        });

        // =========================================================
        // STEP 5: Build result for ALL students
        // =========================================================
        const result = students.map(s => {
            const studentId = s.student_id;
            const data = feeMap[studentId] || {
                total_expected: 0,
                total_paid: 0,
                total_balance: 0,
                paid_fees: 0,
                partially_paid_fees: 0,
                unpaid_fees: 0,
                fee_details: [],
                payment_count: 0
            };

            // Determine payment status
            let paymentStatus = 'No Fees';
            if (data.total_expected > 0) {
                if (data.total_balance <= 0) {
                    paymentStatus = 'Fully Paid';
                } else if (data.total_paid > 0) {
                    paymentStatus = 'Partially Paid';
                } else {
                    paymentStatus = 'Unpaid';
                }
            }

            return {
                student_id: studentId,
                student_name: `${s.first_name} ${s.last_name}`.trim(),
                admission_number: s.admission_number,
                class_id: s.classes?.class_id || null,
                class_name: s.classes?.class_name || null,
                arm: s.classes?.arm || null,
                sector: s.school_section,
                student_status: s.student_status,
                total_expected: data.total_expected,
                total_paid: data.total_paid,
                total_balance: data.total_balance,
                paid_fees: data.paid_fees,
                partially_paid_fees: data.partially_paid_fees,
                unpaid_fees: data.unpaid_fees,
                payment_count: data.payment_count,
                payment_status: paymentStatus,
                fee_details: data.fee_details
            };
        });

        console.log('📊 Returning students:', result.length);

        res.json({ students: result });

    } catch (error) {
        console.error('❌ Students error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// GET: Fee Categories
// ============================================================
router.get('/fees', authenticateToken, async (req, res) => {
    try {
        console.log('📂 /fees called');

        const { sector } = req.query;

        let query = supabase
            .from('fee_categories')
            .select('*')
            .eq('is_active', true);

        if (sector) {
            query = query.eq('sector', sector);
        }

        const { data: fees, error } = await query;

        if (error) {
            console.error('❌ Fees query error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ fees: fees || [] });

    } catch (error) {
        console.error('❌ Fees error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// POST: Record Payment
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    try {
        console.log('💳 POST /payment called');
        console.log('📦 Body:', req.body);

        const {
            student_id,
            fee_id,
            amount_paid,
            payment_method,
            payment_slip_number,
            bank_reference,
            purpose,
            notes,
            academic_year
        } = req.body;

        // Validate
        if (!student_id || !fee_id || !amount_paid || amount_paid <= 0) {
            console.error('❌ Missing required fields');
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Get academic_year_id
        let academicYearId = null;
        if (academic_year) {
            const { data: yearData } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('year_name', academic_year)
                .single();
            if (yearData) {
                academicYearId = yearData.academic_year_id;
            }
        }

        if (!academicYearId) {
            const { data: currentYear } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('is_current', true)
                .single();
            if (currentYear) {
                academicYearId = currentYear.academic_year_id;
            }
        }

        // Verify student_fee record exists
        const { data: studentFee } = await supabase
            .from('student_fees')
            .select('*')
            .eq('student_fee_id', parseInt(fee_id))
            .single();

        if (!studentFee) {
            return res.status(404).json({ message: 'Fee record not found' });
        }

        console.log('📊 Found student fee:', studentFee);

        // =========================================================
        // INSERT PAYMENT - Uses ONLY columns that exist
        // =========================================================
        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .insert([{
                student_id: parseInt(student_id),
                student_fee_id: parseInt(fee_id),
                amount_paid: parseFloat(amount_paid),
                payment_method: payment_method || null,
                payment_slip_number: payment_slip_number || null,
                bank_reference: bank_reference || null,
                purpose: purpose || null,
                notes: notes || null,
                payment_date: new Date().toISOString(),
                approval_status: 'approved',
                recorded_by: req.user?.user_id,
                academic_year_id: academicYearId || 1
            }])
            .select()
            .single();

        if (paymentError) {
            console.error('❌ Payment insert error:', paymentError);
            return res.status(500).json({ message: paymentError.message });
        }

        console.log('✅ Payment recorded successfully:', payment);

        res.status(201).json({
            message: 'Payment recorded successfully',
            payment: payment,
            needs_approval: false
        });

    } catch (error) {
        console.error('❌ Payment error:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// PUT: Edit Payment (Requires Approval for Finance Officers)
// ============================================================
router.put('/:paymentId', authenticateToken, async (req, res) => {
    try {
        console.log('✏️ PUT /payment/:id called');
        console.log('📦 Body:', req.body);

        const { paymentId } = req.params;
        const { amount_paid, payment_method, payment_slip_number, bank_reference, purpose } = req.body;
        const userId = req.user?.user_id;
        const userRole = req.user?.role_name || '';

        if (!amount_paid || amount_paid <= 0) {
            return res.status(400).json({ message: 'Amount is required' });
        }

        const { data: existingPayment, error: getError } = await supabase
            .from('payments')
            .select('*')
            .eq('payment_id', parseInt(paymentId))
            .single();

        if (getError || !existingPayment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        const isFinanceOfficer = userRole === 'Finance Officer (Primary)' || userRole === 'Finance Officer (Secondary)';
        
        let approvalStatus = 'approved';
        let needsApproval = false;

        if (isFinanceOfficer) {
            approvalStatus = 'pending';
            needsApproval = true;
        }

        const { data: payment, error } = await supabase
            .from('payments')
            .update({
                amount_paid: parseFloat(amount_paid),
                payment_method: payment_method || null,
                payment_slip_number: payment_slip_number || null,
                bank_reference: bank_reference || null,
                purpose: purpose || null,
                approval_status: approvalStatus,
                updated_at: new Date().toISOString()
            })
            .eq('payment_id', parseInt(paymentId))
            .select()
            .single();

        if (error) {
            console.error('❌ Payment update error:', error);
            return res.status(500).json({ message: error.message });
        }

        if (needsApproval) {
            await supabase
                .from('record_approvals')
                .insert([{
                    record_type: 'Payment',
                    record_id: payment.payment_id,
                    amount: parseFloat(amount_paid),
                    fee_name: 'Payment Edit',
                    description: `Edit payment from ${existingPayment.amount_paid} to ${amount_paid}`,
                    approval_status: 'Pending',
                    created_by: userId,
                    school_section: existingPayment.sector || 'primary',
                    created_at: new Date().toISOString()
                }]);

            console.log('✅ Edit pending approval');
        }

        res.json({
            message: needsApproval ? 'Payment update submitted for approval' : 'Payment updated successfully',
            payment: payment,
            needs_approval: needsApproval
        });

    } catch (error) {
        console.error('❌ Payment update error:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// DELETE: Delete Payment (Requires Approval for Finance Officers)
// ============================================================
router.delete('/:paymentId', authenticateToken, async (req, res) => {
    try {
        console.log('🗑️ DELETE /payment/:id called');

        const { paymentId } = req.params;
        const userId = req.user?.user_id;
        const userRole = req.user?.role_name || '';

        const { data: existingPayment, error: getError } = await supabase
            .from('payments')
            .select('*')
            .eq('payment_id', parseInt(paymentId))
            .single();

        if (getError || !existingPayment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        const isFinanceOfficer = userRole === 'Finance Officer (Primary)' || userRole === 'Finance Officer (Secondary)';

        if (isFinanceOfficer) {
            await supabase
                .from('record_approvals')
                .insert([{
                    record_type: 'Payment',
                    record_id: parseInt(paymentId),
                    amount: Number(existingPayment.amount_paid || 0),
                    fee_name: 'Payment Deletion',
                    description: `Delete payment of ${existingPayment.amount_paid} for student ${existingPayment.student_id}`,
                    approval_status: 'Pending',
                    created_by: userId,
                    school_section: existingPayment.sector || 'primary',
                    created_at: new Date().toISOString()
                }]);

            return res.json({
                message: 'Payment deletion submitted for approval',
                needs_approval: true
            });
        }

        const { error: deleteError } = await supabase
            .from('payments')
            .delete()
            .eq('payment_id', parseInt(paymentId));

        if (deleteError) {
            console.error('❌ Payment delete error:', deleteError);
            return res.status(500).json({ message: deleteError.message });
        }

        res.json({
            message: 'Payment deleted successfully',
            needs_approval: false
        });

    } catch (error) {
        console.error('❌ Payment delete error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;