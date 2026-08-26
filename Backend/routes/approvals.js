const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET PENDING APPROVALS (SIMPLIFIED)
// ============================================================
router.get(
    '/pending',
    authenticateToken,
    requireRoles('Proprietor', 'Administrator'),
    async (req, res) => {
        try {
            console.log('📋 Fetching pending approvals...');

            // First, get all pending approvals
            const { data: approvals, error: approvalsError } = await supabase
                .from('record_approvals')
                .select('*')
                .eq('record_type', 'Student')
                .eq('approval_status', 'Pending')
                .order('created_at', { ascending: true });

            if (approvalsError) {
                console.error('❌ Approvals error:', approvalsError);
                return res.status(500).json({
                    message: 'Failed to fetch approvals: ' + approvalsError.message
                });
            }

            console.log('✅ Found', approvals?.length || 0, 'pending approvals');

            if (!approvals || approvals.length === 0) {
                return res.json([]);
            }

            // Get student IDs from approvals
            const studentIds = approvals.map(a => a.record_id);

            // Fetch all students with their details in one query
            const { data: students, error: studentsError } = await supabase
                .from('students')
                .select(`
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    date_of_birth,
                    phone,
                    address,
                    nationality,
                    previous_school,
                    admission_date,
                    class_id,
                    guardian_id,
                    emergency_contact_name,
                    emergency_contact_phone,
                    emergency_contact_relationship,
                    classes:class_id (
                        class_name,
                        arm
                    ),
                    guardians:guardian_id (
                        full_name,
                        relationship,
                        phone,
                        email,
                        address
                    )
                `)
                .in('student_id', studentIds);

            if (studentsError) {
                console.error('❌ Students error:', studentsError);
                return res.status(500).json({
                    message: 'Failed to fetch students: ' + studentsError.message
                });
            }

            // Create a map of student_id -> student data
            const studentMap = {};
            students.forEach(s => {
                studentMap[s.student_id] = s;
            });

            // Get user names for created_by
            const userIds = approvals.map(a => a.created_by).filter(id => id);
            let userMap = {};
            
            if (userIds.length > 0) {
                const { data: users, error: usersError } = await supabase
                    .from('users')
                    .select('user_id, full_name')
                    .in('user_id', userIds);

                if (!usersError && users) {
                    users.forEach(u => {
                        userMap[u.user_id] = u.full_name;
                    });
                }
            }

            // Format the response
            const formatted = approvals.map(approval => {
                const student = studentMap[approval.record_id] || {};
                const classes = student.classes || {};
                const guardian = student.guardians || {};

                return {
                    approval_id: approval.approval_id,
                    record_type: approval.record_type,
                    record_id: approval.record_id,
                    approval_status: approval.approval_status,
                    created_by: approval.created_by,
                    created_at: approval.created_at,
                    notes: approval.notes,
                    rejection_reason: approval.rejection_reason,
                    created_by_name: userMap[approval.created_by] || null,
                    admission_number: student.admission_number,
                    first_name: student.first_name,
                    middle_name: student.middle_name,
                    last_name: student.last_name,
                    gender: student.gender,
                    date_of_birth: student.date_of_birth,
                    phone: student.phone,
                    address: student.address,
                    nationality: student.nationality,
                    previous_school: student.previous_school,
                    admission_date: student.admission_date,
                    class_name: classes.class_name,
                    arm: classes.arm,
                    guardian_name: guardian.full_name,
                    guardian_relationship: guardian.relationship,
                    guardian_phone: guardian.phone,
                    guardian_email: guardian.email,
                    guardian_address: guardian.address,
                    emergency_contact_name: student.emergency_contact_name,
                    emergency_contact_phone: student.emergency_contact_phone,
                    emergency_contact_relationship: student.emergency_contact_relationship
                };
            });

            res.json(formatted);

        } catch (error) {
            console.error('❌ Error loading pending approvals:', error);
            res.status(500).json({
                message: 'Failed to load pending approvals: ' + error.message
            });
        }
    }
);


// ============================================================
// APPROVE RECORD
// ============================================================
router.post(
    '/:approvalId/approve',
    authenticateToken,
    requireRoles('Proprietor', 'Administrator'),
    async (req, res) => {
        const approvalId = parseInt(req.params.approvalId);
        const { notes } = req.body;

        if (Number.isNaN(approvalId)) {
            return res.status(400).json({ message: 'Invalid approval ID' });
        }

        try {
            // Get the approval record
            const { data: approval, error: fetchError } = await supabase
                .from('record_approvals')
                .select('*')
                .eq('approval_id', approvalId)
                .single();

            if (fetchError || !approval) {
                return res.status(404).json({ message: 'Approval record not found' });
            }

            if (approval.approval_status !== 'Pending') {
                return res.status(400).json({
                    message: `This record is already ${approval.approval_status}`
                });
            }

            // Update the student status to 'Active'
            await supabase
                .from('students')
                .update({ student_status: 'Active' })
                .eq('student_id', approval.record_id);

            // Update approval status
            const { error: updateError } = await supabase
                .from('record_approvals')
                .update({
                    approval_status: 'Approved',
                    approved_by: req.user.user_id,
                    approved_at: new Date().toISOString(),
                    notes: notes || null
                })
                .eq('approval_id', approvalId);

            if (updateError) throw updateError;

            res.json({
                message: 'Record approved successfully',
                approval_id: approvalId
            });

        } catch (error) {
            console.error('Approval error:', error);
            res.status(500).json({ message: error.message || 'Failed to approve record' });
        }
    }
);


// ============================================================
// REJECT RECORD
// ============================================================
router.post(
    '/:approvalId/reject',
    authenticateToken,
    requireRoles('Proprietor', 'Administrator'),
    async (req, res) => {
        const approvalId = parseInt(req.params.approvalId);
        const { reason } = req.body;

        if (Number.isNaN(approvalId)) {
            return res.status(400).json({ message: 'Invalid approval ID' });
        }

        if (!reason || !reason.trim()) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        try {
            // Get the approval record
            const { data: approval, error: fetchError } = await supabase
                .from('record_approvals')
                .select('*')
                .eq('approval_id', approvalId)
                .single();

            if (fetchError || !approval) {
                return res.status(404).json({ message: 'Approval record not found' });
            }

            if (approval.approval_status !== 'Pending') {
                return res.status(400).json({
                    message: `This record is already ${approval.approval_status}`
                });
            }

            // Update the student status to 'Rejected'
            await supabase
                .from('students')
                .update({ student_status: 'Rejected' })
                .eq('student_id', approval.record_id);

            // Update approval status
            const { error: updateError } = await supabase
                .from('record_approvals')
                .update({
                    approval_status: 'Rejected',
                    approved_by: req.user.user_id,
                    approved_at: new Date().toISOString(),
                    rejection_reason: reason.trim()
                })
                .eq('approval_id', approvalId);

            if (updateError) throw updateError;

            res.json({
                message: 'Record rejected successfully',
                approval_id: approvalId
            });

        } catch (error) {
            console.error('Rejection error:', error);
            res.status(500).json({ message: error.message || 'Failed to reject record' });
        }
    }
);

module.exports = router;