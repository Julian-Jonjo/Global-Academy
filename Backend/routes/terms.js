const express = require('express');
const router = express.Router();
const supabase = require('../Config/db');

const { authenticateToken, requireRoles } = require('../middleware/authMiddleware');

// ============================================================
// GET ALL TERMS
// ------------------------------------------------------------
// Any authenticated user may read term dates.
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('terms')
            .select('term_id, term_name, academic_year_id, start_date, end_date, is_current')
            .order('start_date', { ascending: true });

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('TERMS FETCH ERROR:', error);
        res.status(500).json({ message: 'Failed to load terms' });
    }
});

// ============================================================
// UPDATE A TERM (Administrator only)
// ------------------------------------------------------------
// Editable fields: term_name, start_date, end_date, is_current.
// If is_current is set to true, all other terms are set to false.
// ============================================================

router.put(
    '/:id',
    authenticateToken,
    requireRoles('Administrator'),
    async (req, res) => {
        try {
            const termId = Number(req.params.id);
            if (!Number.isInteger(termId)) {
                return res.status(400).json({ message: 'Invalid term ID' });
            }

            const { term_name, start_date, end_date, is_current } = req.body;

            const updateData = {};

            if (term_name !== undefined) {
                if (!String(term_name).trim()) {
                    return res.status(400).json({ message: 'Term name cannot be empty' });
                }
                updateData.term_name = String(term_name).trim();
            }

            if (start_date !== undefined) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date))) {
                    return res.status(400).json({ message: 'start_date must be YYYY-MM-DD' });
                }
                updateData.start_date = start_date;
            }

            if (end_date !== undefined) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(String(end_date))) {
                    return res.status(400).json({ message: 'end_date must be YYYY-MM-DD' });
                }
                updateData.end_date = end_date;
            }

            if (updateData.start_date && updateData.end_date) {
                if (updateData.start_date > updateData.end_date) {
                    return res.status(400).json({ message: 'start_date must be on or before end_date' });
                }
            }

            if (is_current !== undefined) {
                updateData.is_current = is_current === true || is_current === 'true';
            }

            if (!Object.keys(updateData).length) {
                return res.status(400).json({ message: 'No fields to update' });
            }

            const { data: existing, error: fetchError } = await supabase
                .from('terms')
                .select('term_id')
                .eq('term_id', termId)
                .single();

            if (fetchError || !existing) {
                return res.status(404).json({ message: 'Term not found' });
            }

            // If this term is being set as current, unset all others first.
            if (updateData.is_current === true) {
                const { error: clearError } = await supabase
                    .from('terms')
                    .update({ is_current: false })
                    .neq('term_id', termId);

                if (clearError) throw clearError;
            }

            const { data: term, error } = await supabase
                .from('terms')
                .update(updateData)
                .eq('term_id', termId)
                .select()
                .single();

            if (error) throw error;

            res.json({
                message: 'Term updated successfully',
                term
            });
        } catch (error) {
            console.error('TERM UPDATE ERROR:', error);
            res.status(500).json({ message: 'Failed to update term: ' + error.message });
        }
    }
);

module.exports = router;