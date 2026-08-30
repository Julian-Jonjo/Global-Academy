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

// ============================================================
// ROLE PERMISSIONS
// ============================================================

const MANAGEMENT_ROLES = [
    'Proprietor',
    'Administrator',
    'Manager-Primary',
    'Manager-Secondary'
];

const APPROVAL_ROLES = [
    'Proprietor',
    'Administrator'
];

// ============================================================
// GET ALL APPROVALS (Role-filtered)
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('record_approvals')
            .select('*')
            .order('created_at', { ascending: false });

        // Role-based filtering
        if (isPrimaryManager(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryManager(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }
        // Admin/Proprietor gets all

        const { data, error } = await query;

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading approvals:', error);
        res.status(500).json({ message: 'Failed to load approvals' });
    }
});

// ============================================================
// GET PENDING APPROVALS (Role-filtered)
// ============================================================

router.get('/pending', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_status', 'Pending')
            .order('created_at', { ascending: false });

        // Role-based filtering
        if (isPrimaryManager(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryManager(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading pending approvals:', error);
        res.status(500).json({ message: 'Failed to load pending approvals' });
    }
});

// ============================================================
// GET APPROVED APPROVALS (Role-filtered)
// ============================================================

router.get('/approved', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_status', 'Approved')
            .order('approved_at', { ascending: false });

        if (isPrimaryManager(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryManager(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading approved approvals:', error);
        res.status(500).json({ message: 'Failed to load approved approvals' });
    }
});

// ============================================================
// GET REJECTED APPROVALS (Role-filtered)
// ============================================================

router.get('/rejected', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
        let query = supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_status', 'Rejected')
            .order('approved_at', { ascending: false });

        if (isPrimaryManager(userRole)) {
            query = query.ilike('school_section', '%primary%');
        } else if (isSecondaryManager(userRole)) {
            query = query.ilike('school_section', '%secondary%');
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading rejected approvals:', error);
        res.status(500).json({ message: 'Failed to load rejected approvals' });
    }
});

// ============================================================
// CREATE APPROVAL (Managers can create for their section)
// ============================================================

router.post('/', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const {
            record_type,
            record_id,
            school_section,
            approval_notes
        } = req.body;

        if (!record_type || !record_id) {
            return res.status(400).json({ 
                message: 'Record type and record ID are required' 
            });
        }

        const userRole = req.user.role_name || '';
        const requestedSection = (school_section || '').toLowerCase();

        // Enforce section access
        if (isPrimaryManager(userRole) && !requestedSection.includes('primary')) {
            return res.status(403).json({
                message: 'Manager-Primary can only create approvals for Primary School.'
            });
        }

        if (isSecondaryManager(userRole) && !requestedSection.includes('secondary')) {
            return res.status(403).json({
                message: 'Manager-Secondary can only create approvals for Secondary School.'
            });
        }

        const { data, error } = await supabase
            .from('record_approvals')
            .insert([{
                record_type,
                record_id,
                school_section: school_section || 'Secondary',
                approval_status: 'Pending',
                created_by: req.user.user_id,
                approval_notes
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            message: 'Approval request created successfully',
            approval: data
        });
    } catch (error) {
        console.error('Error creating approval:', error);
        res.status(500).json({ message: 'Failed to create approval' });
    }
});

// ============================================================
// APPROVE RECORD (Proprietor/Administrator only)
// ============================================================

router.put('/:approvalId/approve', authenticateToken, requireRoles(...APPROVAL_ROLES), async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);

        if (!Number.isInteger(approvalId)) {
            return res.status(400).json({ message: 'Invalid approval ID' });
        }

        const { approval_notes } = req.body;

        const { data, error } = await supabase
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

        if (error) throw error;

        res.json({
            message: 'Record approved successfully',
            approval: data
        });
    } catch (error) {
        console.error('Error approving record:', error);
        res.status(500).json({ message: 'Failed to approve record' });
    }
});

// ============================================================
// REJECT RECORD (Proprietor/Administrator only)
// ============================================================

router.put('/:approvalId/reject', authenticateToken, requireRoles(...APPROVAL_ROLES), async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);

        if (!Number.isInteger(approvalId)) {
            return res.status(400).json({ message: 'Invalid approval ID' });
        }

        const { rejection_reason } = req.body;

        if (!rejection_reason) {
            return res.status(400).json({ 
                message: 'Rejection reason is required' 
            });
        }

        const { data, error } = await supabase
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

        if (error) throw error;

        res.json({
            message: 'Record rejected successfully',
            approval: data
        });
    } catch (error) {
        console.error('Error rejecting record:', error);
        res.status(500).json({ message: 'Failed to reject record' });
    }
});

// ============================================================
// GET SINGLE APPROVAL (Role-checked)
// ============================================================

router.get('/:approvalId', authenticateToken, async (req, res) => {
    try {
        const approvalId = Number(req.params.approvalId);
        const userRole = req.user.role_name || '';

        if (!Number.isInteger(approvalId)) {
            return res.status(400).json({ message: 'Invalid approval ID' });
        }

        const { data, error } = await supabase
            .from('record_approvals')
            .select('*')
            .eq('approval_id', approvalId)
            .single();

        if (error || !data) {
            return res.status(404).json({ message: 'Approval not found' });
        }

        // Check section access
        const approvalSection = (data.school_section || '').toLowerCase();

        if (isPrimaryManager(userRole) && !approvalSection.includes('primary')) {
            return res.status(403).json({
                message: 'Access denied. This is not a Primary School approval.'
            });
        }

        if (isSecondaryManager(userRole) && !approvalSection.includes('secondary')) {
            return res.status(403).json({
                message: 'Access denied. This is not a Secondary School approval.'
            });
        }

        res.json(data);
    } catch (error) {
        console.error('Error loading approval:', error);
        res.status(500).json({ message: 'Failed to load approval' });
    }
});

module.exports = router;