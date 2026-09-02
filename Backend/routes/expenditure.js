const express = require('express');
const router = express.Router();
const supabase = require('../Config/db');
const { authenticateToken } = require('../middleware/authMiddleware');

// ============================================================
// GET: All Expenditure Records
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { sector, status, start_date, end_date } = req.query;
        const userRole = req.user?.role_name || '';

        let query = supabase
            .from('expenditure')
            .select(`
                *,
                users:recorded_by (user_id, username, full_name)
            `)
            .order('expenditure_date', { ascending: false });

        // Filter by sector
        if (sector) {
            query = query.eq('sector', sector);
        }
        if (status) {
            query = query.eq('approval_status', status);
        }
        if (start_date) {
            query = query.gte('expenditure_date', start_date);
        }
        if (end_date) {
            query = query.lte('expenditure_date', end_date);
        }

        // Role-based filtering
        if (userRole === 'Finance Officer (Primary)') {
            query = query.eq('sector', 'primary');
        } else if (userRole === 'Finance Officer (Secondary)') {
            query = query.eq('sector', 'secondary');
        }

        const { data: expenditure, error } = await query;

        if (error) throw error;

        const result = expenditure?.map(e => ({
            id: e.expenditure_id,
            category: e.category,
            description: e.description,
            amount: e.amount,
            expenditure_date: e.expenditure_date,
            receipt_number: e.receipt_number,
            approval_status: e.approval_status,
            sector: e.sector,
            recorded_by: e.recorded_by,
            recorded_by_name: e.users?.full_name || e.users?.username,
            reviewed_by: e.reviewed_by,
            reviewed_at: e.reviewed_at,
            created_at: e.created_at,
            updated_at: e.updated_at
        })) || [];

        res.json({ expenditure: result });
    } catch (error) {
        console.error('Expenditure error:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// POST: Record Expenditure
// ============================================================
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            category,
            amount,
            description,
            expenditure_date,
            receipt_number,
            sector
        } = req.body;

        const userId = req.user?.user_id;
        const userRole = req.user?.role_name || '';

        // Validate
        if (!category || !amount || amount <= 0 || !description) {
            return res.status(400).json({ message: 'Category, amount, and description are required' });
        }

        // Determine if approval is needed
        const needsApproval = userRole === 'Finance Officer (Primary)' || 
                             userRole === 'Finance Officer (Secondary)';
        const approvalStatus = needsApproval ? 'pending' : 'approved';

        // Create expenditure record
        const { data: expenditure, error: expError } = await supabase
            .from('expenditure')
            .insert([{
                category,
                amount,
                description,
                expenditure_date: expenditure_date || new Date().toISOString().split('T')[0],
                receipt_number: receipt_number || null,
                sector: sector || 'primary',
                approval_status: approvalStatus,
                recorded_by: userId,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (expError) throw expError;

        res.status(201).json({
            message: 'Expenditure recorded successfully',
            expenditure: {
                id: expenditure.expenditure_id,
                category: expenditure.category,
                amount: expenditure.amount,
                description: expenditure.description,
                expenditure_date: expenditure.expenditure_date,
                receipt_number: expenditure.receipt_number,
                approval_status: expenditure.approval_status,
                sector: expenditure.sector,
                recorded_by: expenditure.recorded_by,
                created_at: expenditure.created_at
            },
            needs_approval: needsApproval
        });

    } catch (error) {
        console.error('Expenditure creation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// PUT: Update Expenditure
// ============================================================
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { category, amount, description, expenditure_date, receipt_number } = req.body;
        const userId = req.user?.user_id;
        const userRole = req.user?.role_name || '';

        // Get existing record
        const { data: existing, error: getError } = await supabase
            .from('expenditure')
            .select('*')
            .eq('expenditure_id', id)
            .single();

        if (getError || !existing) {
            return res.status(404).json({ message: 'Expenditure not found' });
        }

        // Only pending records can be edited
        if (existing.approval_status !== 'pending') {
            return res.status(403).json({ message: 'Only pending records can be edited' });
        }

        // Check permissions
        if (existing.recorded_by !== userId && 
            userRole !== 'Manager' && userRole !== 'Proprietor' && userRole !== 'Administrator') {
            return res.status(403).json({ message: 'You can only edit your own records' });
        }

        // Update
        const { data: updated, error: updateError } = await supabase
            .from('expenditure')
            .update({
                category: category || existing.category,
                amount: amount || existing.amount,
                description: description || existing.description,
                expenditure_date: expenditure_date || existing.expenditure_date,
                receipt_number: receipt_number || existing.receipt_number,
                updated_at: new Date().toISOString()
            })
            .eq('expenditure_id', id)
            .select()
            .single();

        if (updateError) throw updateError;

        res.json({
            message: 'Expenditure updated successfully',
            expenditure: {
                id: updated.expenditure_id,
                category: updated.category,
                amount: updated.amount,
                description: updated.description,
                expenditure_date: updated.expenditure_date,
                receipt_number: updated.receipt_number,
                approval_status: updated.approval_status,
                sector: updated.sector
            }
        });

    } catch (error) {
        console.error('Expenditure update error:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// DELETE: Expenditure (only if pending)
// ============================================================
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.user_id;

        // Get existing record
        const { data: existing, error: getError } = await supabase
            .from('expenditure')
            .select('*')
            .eq('expenditure_id', id)
            .single();

        if (getError || !existing) {
            return res.status(404).json({ message: 'Expenditure not found' });
        }

        if (existing.approval_status !== 'pending') {
            return res.status(403).json({ message: 'Can only delete pending records' });
        }

        if (existing.recorded_by !== userId) {
            return res.status(403).json({ message: 'You can only delete your own records' });
        }

        const { error } = await supabase
            .from('expenditure')
            .delete()
            .eq('expenditure_id', id);

        if (error) throw error;

        res.json({ message: 'Expenditure deleted successfully' });

    } catch (error) {
        console.error('Expenditure delete error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;