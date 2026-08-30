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
        
        let query = supabase
            .from('record_approvals')
            .select(`
                *,
                students:record_id (
                    student_id, admission_number, first_name, middle_name, last_name,
                    gender, date_of_birth, class_id, previous_school, guardian_id,
                    school_section,
                    classes:class_id (class_name, arm),
                    guardians:guardian_id (full_name, relationship, phone, email, address)
                )
            `)
            .order('created_at', { ascending: false });

        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        const { data, error } = await query;
        if (error) throw error;

        const approvals = (data || []).map(flattenApproval);
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
        
        let query = supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_status', 'Pending')
            .order('created_at', { ascending: false });

        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        const { data: approvals, error } = await query;
        if (error) throw error;

        // Fetch each student individually
        const enrichedApprovals = await Promise.all((approvals || []).map(async (approval) => {
            const studentId = approval.record_id;
            
            // Fetch student
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
    return {
        approval_id: approval.approval_id,
        record_type: approval.record_type,
        record_id: approval.record_id,
        approval_status: approval.approval_status,
        created_by: approval.created_by,
        created_at: approval.created_at,
        approved_by: approval.approved_by,
        approved_at: approval.approved_at,
        rejection_reason: approval.rejection_reason,
        approval_notes: approval.approval_notes,
        school_section: approval.school_section || approval.students?.school_section || 'Secondary',
        admission_number: approval.students?.admission_number || null,
        first_name: approval.students?.first_name || null,
        middle_name: approval.students?.middle_name || null,
        last_name: approval.students?.last_name || null,
        gender: approval.students?.gender || null,
        date_of_birth: approval.students?.date_of_birth || null,
        class_name: approval.students?.classes?.class_name || null,
        arm: approval.students?.classes?.arm || null,
        previous_school: approval.students?.previous_school || null,
        guardian_name: approval.students?.guardians?.full_name || null,
        guardian_relationship: approval.students?.guardians?.relationship || null,
        guardian_phone: approval.students?.guardians?.phone || null,
        guardian_email: approval.students?.guardians?.email || null,
        guardian_address: approval.students?.guardians?.address || null
    };
}

// ============================================================
// CREATE APPROVAL
// ============================================================
router.post('/', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        const { record_type, record_id, school_section, approval_notes } = req.body;

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
                approval_notes
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
// APPROVE RECORD (Admin/Proprietor only)
// ============================================================
router.put('/:approvalId/approve', authenticateToken, requireRoles(...APPROVAL_ROLES), async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);
        if (Number.isNaN(approvalId)) return res.status(400).json({ message: 'Invalid approval ID' });

        const { approval_notes } = req.body;

        const { data: approval, error: approveError } = await supabase
            .from('record_approvals')
            .update({
                approval_status: 'Approved',
                approved_by: req.user.user_id,
                approved_at: new Date().toISOString(),
                approval_notes: approval_notes || null
            })
            .eq('approval_id', approvalId)
            .select()
            .single();

        if (approveError) throw approveError;

        // Update student status to Active
        if (approval.record_type === 'Student') {
            await supabase
                .from('students')
                .update({ student_status: 'Active' })
                .eq('student_id', approval.record_id);
        }

        res.json({ message: 'Record approved successfully', approval });
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

        const { data: approval, error: rejectError } = await supabase
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

        // Update student status to Rejected
        if (approval.record_type === 'Student') {
            await supabase
                .from('students')
                .update({ student_status: 'Rejected' })
                .eq('student_id', approval.record_id);
        }

        res.json({ message: 'Record rejected successfully', approval });
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

module.exports = router;