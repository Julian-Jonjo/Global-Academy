const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET PENDING APPROVALS
// ============================================================
router.get(
    '/pending',
    authenticateToken,
    requireRoles('Proprietor', 'Administrator'),
    async (req, res) => {
        try {
            // Get pending approvals with related data
            const { data: approvals, error } = await supabase
                .from('record_approvals')
                .select(`
                    approval_id,
                    record_type,
                    record_id,
                    approval_status,
                    created_by,
                    created_at,
                    users:created_by (
                        username,
                        full_name
                    ),
                    students!record_type_student (
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
                    )
                `)
                .eq('approval_status', 'Pending')
                .order('created_at', { ascending: true });

            if (error) throw error;

            // Format the response
            const formattedApprovals = approvals.map(approval => {
                const student = approval.students || {};
                const classes = student.classes || {};
                const guardian = student.guardians || {};

                return {
                    approval_id: approval.approval_id,
                    record_type: approval.record_type,
                    record_id: approval.record_id,
                    approval_status: approval.approval_status,
                    created_by: approval.created_by,
                    created_at: approval.created_at,
                    created_by_username: approval.users?.username,
                    created_by_name: approval.users?.full_name,
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
                    emergency_contact_name: student.emergency_contact_name,
                    emergency_contact_phone: student.emergency_contact_phone,
                    emergency_contact_relationship: student.emergency_contact_relationship,
                    class_name: classes.class_name,
                    arm: classes.arm,
                    guardian_name: guardian.full_name,
                    guardian_relationship: guardian.relationship,
                    guardian_phone: guardian.phone,
                    guardian_email: guardian.email,
                    guardian_address: guardian.address
                };
            });

            res.json(formattedApprovals);

        } catch (error) {
            console.error('Error loading pending approvals:', error);
            res.status(500).json({
                message: 'Failed to load pending approvals'
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
        const approverId = req.user.user_id;
        const notes = req.body.notes || null;

        if (Number.isNaN(approvalId)) {
            return res.status(400).json({
                message: 'Invalid approval ID'
            });
        }

        try {
            // Get the approval record
            const { data: approval, error: fetchError } = await supabase
                .from('record_approvals')
                .select('*')
                .eq('approval_id', approvalId)
                .single();

            if (fetchError || !approval) {
                return res.status(404).json({
                    message: 'Approval record not found'
                });
            }

            if (approval.approval_status !== 'Pending') {
                return res.status(400).json({
                    message: `This record is already ${approval.approval_status}`
                });
            }

            // Update approval status
            const { error: updateError } = await supabase
                .from('record_approvals')
                .update({
                    approval_status: 'Approved',
                    approved_by: approverId,
                    approved_at: new Date().toISOString(),
                    notes: notes
                })
                .eq('approval_id', approvalId);

            if (updateError) throw updateError;

            res.json({
                message: 'Record approved successfully',
                approval_id: approvalId
            });

        } catch (error) {
            console.error('Approval error:', error);
            res.status(400).json({
                message: error.message
            });
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
        const approverId = req.user.user_id;
        const reason = req.body.reason;

        if (Number.isNaN(approvalId)) {
            return res.status(400).json({
                message: 'Invalid approval ID'
            });
        }

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                message: 'Rejection reason is required'
            });
        }

        try {
            // Get the approval record
            const { data: approval, error: fetchError } = await supabase
                .from('record_approvals')
                .select('created_by, approval_status')
                .eq('approval_id', approvalId)
                .single();

            if (fetchError || !approval) {
                return res.status(404).json({
                    message: 'Approval record not found'
                });
            }

            if (approval.approval_status !== 'Pending') {
                return res.status(400).json({
                    message: `This record is already ${approval.approval_status}`
                });
            }

            // Prevent self-rejection
            if (approval.created_by === approverId) {
                return res.status(403).json({
                    message: 'A user cannot reject their own record'
                });
            }

            // Update approval status
            const { error: updateError } = await supabase
                .from('record_approvals')
                .update({
                    approval_status: 'Rejected',
                    approved_by: approverId,
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
            res.status(500).json({
                message: 'Failed to reject record'
            });
        }
    }
);

module.exports = router;