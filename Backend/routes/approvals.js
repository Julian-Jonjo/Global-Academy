const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles,
    isAdminOrProprietor,
    isPrimaryManager,
    isSecondaryManager
} = require('../middleware/authMiddleware');

const router = express.Router();

const APPROVAL_ROLES = ['Administrator', 'Proprietor'];
const MANAGEMENT_ROLES = ['Administrator', 'Proprietor', 'Manager-Primary', 'Manager-Secondary'];

// ============================================================
// GET ALL APPROVALS (Role-filtered with student data)
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        const { type, status, sector } = req.query;
        
        let query = supabase
            .from('record_approvals')
            .select('*')
            .order('created_at', { ascending: false });

        if (type) {
            query = query.eq('record_type', type);
        }

        if (status) {
            query = query.eq('approval_status', status);
        }

        if (sector) {
            query = query.eq('school_section', sector);
        }

        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        const { data, error } = await query;
        if (error) throw error;

        const approvals = await Promise.all(
            (data || []).map(async (approval) => {

                let student = null;
                let classData = null;
                let guardianData = null;
                let creator = null;

                if (approval.created_by) {
                    const { data: user } = await supabase
                        .from('users')
                        .select('user_id, username, full_name')
                        .eq('user_id', approval.created_by)
                        .maybeSingle();

                    creator = user;
                }

                if (
                    approval.record_type === 'Student' ||
                    approval.record_type === 'Fee' ||
                    approval.record_type === 'Payment'
                ) {
                    const { data: studentData } = await supabase
                        .from('students')
                        .select(`
                            student_id,
                            admission_number,
                            first_name,
                            middle_name,
                            last_name,
                            gender,
                            date_of_birth,
                            class_id,
                            previous_school,
                            guardian_id,
                            school_section
                        `)
                        .eq('student_id', approval.record_id)
                        .maybeSingle();

                    student = studentData;

                    if (student?.class_id) {
                        const { data: cls } = await supabase
                            .from('classes')
                            .select('class_id, class_name, arm')
                            .eq('class_id', student.class_id)
                            .maybeSingle();

                        classData = cls;
                    }

                    if (student?.guardian_id) {
                        const { data: guardian } = await supabase
                            .from('guardians')
                            .select(`
                                guardian_id,
                                full_name,
                                relationship,
                                phone,
                                email,
                                address
                            `)
                            .eq('guardian_id', student.guardian_id)
                            .maybeSingle();

                        guardianData = guardian;
                    }
                }

                return {
                    approval_id: approval.approval_id,
                    record_type: approval.record_type,
                    record_id: approval.record_id,
                    approval_status: approval.approval_status,

                    created_by: approval.created_by,
                    created_by_name:
                        creator?.full_name ||
                        creator?.username ||
                        null,

                    created_at: approval.created_at,

                    approved_by: approval.approved_by,
                    approved_at: approval.approved_at,

                    rejection_reason: approval.rejection_reason,
                    approval_notes: approval.approval_notes,

                    school_section:
                        approval.school_section ||
                        student?.school_section ||
                        'Secondary',

                    amount: approval.amount || null,
                    fee_name: approval.fee_name || null,
                    description: approval.description || null,

                    admission_number: student?.admission_number || null,
                    first_name: student?.first_name || null,
                    middle_name: student?.middle_name || null,
                    last_name: student?.last_name || null,
                    gender: student?.gender || null,
                    date_of_birth: student?.date_of_birth || null,

                    class_name: classData?.class_name || null,
                    arm: classData?.arm || null,

                    previous_school: student?.previous_school || null,

                    guardian_name: guardianData?.full_name || null,
                    guardian_relationship: guardianData?.relationship || null,
                    guardian_phone: guardianData?.phone || null,
                    guardian_email: guardianData?.email || null,
                    guardian_address: guardianData?.address || null
                };
            })
        );

        res.json(approvals);
    } catch (error) {
        console.error('Error loading approvals:', error);
        res.status(500).json({ message: 'Failed to load approvals' });
    }
});

// ============================================================
// GET PENDING APPROVALS (Role-filtered with student data)
// ============================================================
router.get('/pending', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        const { type } = req.query;
        
        let query = supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_status', 'Pending')
            .order('created_at', { ascending: false });

        if (type) {
            query = query.eq('record_type', type);
        }

        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        const { data: approvals, error } = await query;
        if (error) throw error;

        const enrichedApprovals = await Promise.all((approvals || []).map(async (approval) => {
            const studentId = approval.record_id;
            
            const { data: student } = await supabase
                .from('students')
                .select('student_id, admission_number, first_name, middle_name, last_name, gender, date_of_birth, class_id, previous_school, guardian_id, school_section')
                .eq('student_id', studentId)
                .maybeSingle();

            let classData = null;
            if (student?.class_id) {
                const { data: cls } = await supabase
                    .from('classes')
                    .select('class_id, class_name, arm')
                    .eq('class_id', student.class_id)
                    .maybeSingle();
                classData = cls;
            }

            let guardianData = null;
            if (student?.guardian_id) {
                const { data: guardian } = await supabase
                    .from('guardians')
                    .select('guardian_id, full_name, relationship, phone, email, address')
                    .eq('guardian_id', student.guardian_id)
                    .maybeSingle();
                guardianData = guardian;
            }

            return {
                approval_id: approval.approval_id,
                record_type: approval.record_type,
                record_id: approval.record_id,
                approval_status: approval.approval_status,
                created_by: approval.created_by,
                created_at: approval.created_at,
                school_section: approval.school_section || student?.school_section || 'Secondary',
                admission_number: student?.admission_number || 'N/A',
                first_name: student?.first_name || 'Unknown',
                middle_name: student?.middle_name || null,
                last_name: student?.last_name || 'Student',
                gender: student?.gender || null,
                date_of_birth: student?.date_of_birth || null,
                class_name: classData?.class_name || 'N/A',
                arm: classData?.arm || null,
                previous_school: student?.previous_school || null,
                guardian_name: guardianData?.full_name || 'N/A',
                guardian_relationship: guardianData?.relationship || null,
                guardian_phone: guardianData?.phone || null,
                guardian_email: guardianData?.email || null,
                guardian_address: guardianData?.address || null
            };
        }));

        res.json(enrichedApprovals);
    } catch (error) {
        console.error('Error loading pending approvals:', error);
        res.status(500).json({ message: 'Failed to load pending approvals: ' + error.message });
    }
});

// ============================================================
// HELPER: Flatten approval with student data
// ============================================================
function flattenApproval(approval) {
    const result = {
        approval_id: approval.approval_id,
        record_type: approval.record_type,
        record_id: approval.record_id,
        approval_status: approval.approval_status,
        created_by: approval.created_by,
        created_by_name: approval.users?.full_name || approval.users?.username || null,
        created_at: approval.created_at,
        approved_by: approval.approved_by,
        approved_at: approval.approved_at,
        rejection_reason: approval.rejection_reason,
        approval_notes: approval.approval_notes,
        school_section: approval.school_section || approval.students?.school_section || 'Secondary',
        amount: approval.amount || null,
        fee_name: approval.fee_name || null,
        description: approval.description || null
    };

    if (approval.record_type === 'Student' || approval.record_type === 'Fee' || approval.record_type === 'Payment') {
        result.admission_number = approval.students?.admission_number || null;
        result.first_name = approval.students?.first_name || null;
        result.middle_name = approval.students?.middle_name || null;
        result.last_name = approval.students?.last_name || null;
        result.gender = approval.students?.gender || null;
        result.date_of_birth = approval.students?.date_of_birth || null;
        result.class_name = approval.students?.classes?.class_name || null;
        result.arm = approval.students?.classes?.arm || null;
        result.previous_school = approval.students?.previous_school || null;
        result.guardian_name = approval.students?.guardians?.full_name || null;
        result.guardian_relationship = approval.students?.guardians?.relationship || null;
        result.guardian_phone = approval.students?.guardians?.phone || null;
        result.guardian_email = approval.students?.guardians?.email || null;
        result.guardian_address = approval.students?.guardians?.address || null;
    }

    return result;
}

// ============================================================
// CREATE APPROVAL (Student, Teacher, Fee, Payment, Expenditure)
// ============================================================
router.post('/', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        const { 
            record_type, 
            record_id, 
            school_section, 
            approval_notes,
            amount,
            fee_name,
            description
        } = req.body;

        if (!record_type || !record_id) {
            return res.status(400).json({ message: 'Record type and record ID are required' });
        }

        const section = school_section || 'Secondary';

        if (isPrimaryManager(userRole) && !['Nursery', 'Primary'].includes(section)) {
            return res.status(403).json({ message: 'Can only create Primary School approvals.' });
        }
        if (isSecondaryManager(userRole) && !['JSS', 'SSS', 'Secondary'].includes(section)) {
            return res.status(403).json({ message: 'Can only create Secondary School approvals.' });
        }

        const { data, error } = await supabase
            .from('record_approvals')
            .insert({
                record_type,
                record_id,
                school_section: section,
                approval_status: 'Pending',
                created_by: req.user.user_id,
                approval_notes,
                amount: amount || null,
                fee_name: fee_name || null,
                description: description || null
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ message: 'Approval request created', approval: data });
    } catch (error) {
        console.error('Error creating approval:', error);
        res.status(500).json({ message: 'Failed to create approval' });
    }
});

// ============================================================
// APPROVE RECORD (Admin/Proprietor only) - WITH AUTO-FEE ASSIGNMENT
// ============================================================
router.put('/:approvalId/approve', authenticateToken, requireRoles(...APPROVAL_ROLES), async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);
        if (Number.isNaN(approvalId)) return res.status(400).json({ message: 'Invalid approval ID' });

        const { approval_notes } = req.body;

        // Get the approval first to know what type it is
        const { data: approval, error: getError } = await supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_id', approvalId)
            .single();

        if (getError || !approval) {
            return res.status(404).json({ message: 'Approval not found' });
        }

        // =========================================================
        // STEP 1: If it's a Student approval, update status and assign fees
        // =========================================================
        if (approval.record_type === 'Student') {
            // Update student status to Active
            await supabase
                .from('students')
                .update({ student_status: 'Active' })
                .eq('student_id', approval.record_id);

            // =====================================================
            // AUTO-ASSIGN FEES TO THE APPROVED STUDENT
            // =====================================================
            // Get student's class info
            const { data: student } = await supabase
                .from('students')
                .select('student_id, class_id, school_section')
                .eq('student_id', approval.record_id)
                .single();

            if (student) {
                // Get current academic year
                const { data: currentYear } = await supabase
                    .from('academic_years')
                    .select('academic_year_id')
                    .eq('is_current', true)
                    .single();

                const academicYearId = currentYear?.academic_year_id || 1;

                // Get current term
                const { data: currentTerm } = await supabase
                    .from('terms')
                    .select('term_id')
                    .eq('is_current', true)
                    .single();

                const termId = currentTerm?.term_id || 1;

                // Get the class level from the class
                const { data: classData } = await supabase
                    .from('classes')
                    .select('class_name')
                    .eq('class_id', student.class_id)
                    .single();

                // Determine class level
                let classLevel = '';
                const className = classData?.class_name || '';
                
                if (className.toLowerCase().includes('nursery')) {
                    classLevel = 'nursery';
                } else if (className.toLowerCase().includes('primary') && 
                          (className.toLowerCase().includes('1') || 
                           className.toLowerCase().includes('2') || 
                           className.toLowerCase().includes('3'))) {
                    classLevel = 'primary_lower';
                } else if (className.toLowerCase().includes('primary') && 
                          (className.toLowerCase().includes('4') || 
                           className.toLowerCase().includes('5') || 
                           className.toLowerCase().includes('6'))) {
                    classLevel = 'primary_upper';
                } else if (className.toLowerCase().includes('jss') || 
                          className.toLowerCase().includes('junior')) {
                    classLevel = 'jss';
                } else if (className.toLowerCase().includes('sss') || 
                          className.toLowerCase().includes('senior')) {
                    classLevel = 'sss';
                }

                // Get fee categories for this class level
                const { data: feeCategories } = await supabase
                    .from('fee_categories')
                    .select(`
                        id,
                        name,
                        amount,
                        sector
                    `)
                    .eq('sector', student.school_section || 'primary')
                    .eq('class_level', classLevel)
                    .eq('is_active', true)
                    .eq('academic_year', '2026/2027');

                if (feeCategories && feeCategories.length > 0) {
                    // Get fee_type_id for each fee category
                    for (const feeCat of feeCategories) {
                        const { data: feeType } = await supabase
                            .from('fee_types')
                            .select('fee_type_id')
                            .eq('fee_name', feeCat.name)
                            .single();

                        if (feeType) {
                            // Check if fee already exists for this student
                            const { data: existingFee } = await supabase
                                .from('student_fees')
                                .select('student_fee_id')
                                .eq('student_id', student.student_id)
                                .eq('fee_type_id', feeType.fee_type_id)
                                .eq('academic_year_id', academicYearId)
                                .eq('term_id', termId)
                                .single();

                            if (!existingFee) {
                                // Insert the fee
                                await supabase
                                    .from('student_fees')
                                    .insert([{
                                        student_id: student.student_id,
                                        fee_type_id: feeType.fee_type_id,
                                        academic_year_id: academicYearId,
                                        term_id: termId,
                                        amount_due: feeCat.amount
                                    }]);
                            }
                        }
                    }
                }
            }
        }

        // =========================================================
        // STEP 2: Update the approval status
        // =========================================================
        const { data: updatedApproval, error: approveError } = await supabase
            .from('record_approvals')
            .update({
                approval_status: 'Approved',
                approved_by: req.user.user_id,
                approved_at: new Date().toISOString(),
                approval_notes: approval_notes || approval.approval_notes
            })
            .eq('approval_id', approvalId)
            .select()
            .single();

        if (approveError) throw approveError;

        // Handle other record types
        if (approval.record_type === 'Payment') {
            await supabase
                .from('payments')
                .update({ approval_status: 'approved' })
                .eq('payment_id', approval.record_id);
        } else if (approval.record_type === 'Expenditure') {
            await supabase
                .from('expenditure')
                .update({ 
                    approval_status: 'approved',
                    reviewed_by: req.user.user_id,
                    reviewed_at: new Date().toISOString()
                })
                .eq('expenditure_id', approval.record_id);
        }

        res.json({ message: 'Record approved successfully', approval: updatedApproval });
    } catch (error) {
        console.error('Error approving record:', error);
        res.status(500).json({ message: 'Failed to approve record' });
    }
});

// ============================================================
// REJECT RECORD (Admin/Proprietor only)
// ============================================================
router.put('/:approvalId/reject', authenticateToken, requireRoles(...APPROVAL_ROLES), async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);
        if (Number.isNaN(approvalId)) return res.status(400).json({ message: 'Invalid approval ID' });

        const { rejection_reason } = req.body;
        if (!rejection_reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        const { data: approval, error: getError } = await supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_id', approvalId)
            .single();

        if (getError || !approval) {
            return res.status(404).json({ message: 'Approval not found' });
        }

        const { data: updatedApproval, error: rejectError } = await supabase
            .from('record_approvals')
            .update({
                approval_status: 'Rejected',
                approved_by: req.user.user_id,
                approved_at: new Date().toISOString(),
                rejection_reason
            })
            .eq('approval_id', approvalId)
            .select()
            .single();

        if (rejectError) throw rejectError;

        if (approval.record_type === 'Student') {
            await supabase
                .from('students')
                .update({ student_status: 'Rejected' })
                .eq('student_id', approval.record_id);
        } else if (approval.record_type === 'Payment') {
            await supabase
                .from('payments')
                .update({ approval_status: 'rejected' })
                .eq('payment_id', approval.record_id);
        } else if (approval.record_type === 'Expenditure') {
            await supabase
                .from('expenditure')
                .update({ 
                    approval_status: 'rejected',
                    reviewed_by: req.user.user_id,
                    reviewed_at: new Date().toISOString()
                })
                .eq('expenditure_id', approval.record_id);
        }

        res.json({ message: 'Record rejected successfully', approval: updatedApproval });
    } catch (error) {
        console.error('Error rejecting record:', error);
        res.status(500).json({ message: 'Failed to reject record' });
    }
});

// ============================================================
// GET SINGLE APPROVAL
// ============================================================
router.get('/:approvalId', authenticateToken, async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);
        const userRole = req.user.role_name || '';

        if (Number.isNaN(approvalId)) return res.status(400).json({ message: 'Invalid approval ID' });

        const { data, error } = await supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_id', approvalId)
            .single();

        if (error || !data) return res.status(404).json({ message: 'Approval not found' });

        const section = (data.school_section || '').toLowerCase();
        if (isPrimaryManager(userRole) && !['nursery', 'primary'].includes(section)) {
            return res.status(403).json({ message: 'Access denied.' });
        }
        if (isSecondaryManager(userRole) && !['jss', 'sss', 'secondary'].includes(section)) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error loading approval:', error);
        res.status(500).json({ message: 'Failed to load approval' });
    }
});

// ============================================================
// APPROVE PAYMENT (Manager/Proprietor/Admin only)
// ============================================================
router.put('/:approvalId/approve-payment', authenticateToken, async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);
        if (Number.isNaN(approvalId)) return res.status(400).json({ message: 'Invalid approval ID' });

        const { approval_notes } = req.body;
        const userId = req.user.user_id;
        const userRole = req.user.role_name || '';

        const canApprove = userRole === 'Manager-Primary' || 
                          userRole === 'Manager-Secondary' || 
                          userRole === 'Manager' ||
                          userRole === 'Proprietor' || 
                          userRole === 'Administrator' ||
                          userRole === 'Admin';

        if (!canApprove) {
            return res.status(403).json({ message: 'Insufficient permissions to approve payment' });
        }

        const { data: approval, error: getError } = await supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_id', approvalId)
            .single();

        if (getError || !approval) {
            return res.status(404).json({ message: 'Approval not found' });
        }

        if (approval.record_type !== 'Payment') {
            return res.status(400).json({ message: 'This endpoint only handles payment approvals' });
        }

        const { data: updatedApproval, error: approveError } = await supabase
            .from('record_approvals')
            .update({
                approval_status: 'Approved',
                approved_by: userId,
                approved_at: new Date().toISOString(),
                approval_notes: approval_notes || approval.approval_notes
            })
            .eq('approval_id', approvalId)
            .select()
            .single();

        if (approveError) throw approveError;

        await supabase
            .from('payments')
            .update({ approval_status: 'approved' })
            .eq('payment_id', approval.record_id);

        res.json({ message: 'Payment approved successfully', approval: updatedApproval });
    } catch (error) {
        console.error('Error approving payment:', error);
        res.status(500).json({ message: 'Failed to approve payment' });
    }
});

// ============================================================
// REJECT PAYMENT (Manager/Proprietor/Admin only)
// ============================================================
router.put('/:approvalId/reject-payment', authenticateToken, async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);
        if (Number.isNaN(approvalId)) return res.status(400).json({ message: 'Invalid approval ID' });

        const { rejection_reason } = req.body;
        const userId = req.user.user_id;
        const userRole = req.user.role_name || '';

        if (!rejection_reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        const canReject = userRole === 'Manager-Primary' || 
                         userRole === 'Manager-Secondary' || 
                         userRole === 'Manager' ||
                         userRole === 'Proprietor' || 
                         userRole === 'Administrator' ||
                         userRole === 'Admin';

        if (!canReject) {
            return res.status(403).json({ message: 'Insufficient permissions to reject payment' });
        }

        const { data: approval, error: getError } = await supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_id', approvalId)
            .single();

        if (getError || !approval) {
            return res.status(404).json({ message: 'Approval not found' });
        }

        if (approval.record_type !== 'Payment') {
            return res.status(400).json({ message: 'This endpoint only handles payment approvals' });
        }

        const { data: updatedApproval, error: rejectError } = await supabase
            .from('record_approvals')
            .update({
                approval_status: 'Rejected',
                approved_by: userId,
                approved_at: new Date().toISOString(),
                rejection_reason: rejection_reason
            })
            .eq('approval_id', approvalId)
            .select()
            .single();

        if (rejectError) throw rejectError;

        await supabase
            .from('payments')
            .update({ approval_status: 'rejected' })
            .eq('payment_id', approval.record_id);

        res.json({ message: 'Payment rejected successfully', approval: updatedApproval });
    } catch (error) {
        console.error('Error rejecting payment:', error);
        res.status(500).json({ message: 'Failed to reject payment' });
    }
});

module.exports = router;