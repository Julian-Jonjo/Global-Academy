const express = require('express');
const router = express.Router();
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles,
    ROLE_IDS
} = require('../middleware/authMiddleware');

// ============================================================
// GET ALL HOLIDAYS
// ============================================================
// Any authenticated user may read the holiday list, since the
// register page needs it to render holiday bands.
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('holidays')
            .select('holiday_id, holiday_date, description, created_by, created_at')
            .order('holiday_date', { ascending: true });

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('HOLIDAYS GET ERROR:', error);
        res.status(500).json({ message: 'Failed to load holidays' });
    }
});

// ============================================================
// CREATE HOLIDAY (Manager / Administrator only)
// ============================================================

router.post(
    '/',
    authenticateToken,
    requireRoles(ROLE_IDS.MANAGER, ROLE_IDS.ADMINISTRATOR),
    async (req, res) => {
        try {
            const { holiday_date, description } = req.body;

            if (!holiday_date) {
                return res.status(400).json({ message: 'holiday_date is required.' });
            }

            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(holiday_date))) {
                return res.status(400).json({ message: 'holiday_date must be YYYY-MM-DD.' });
            }

            const { data, error } = await supabase
                .from('holidays')
                .insert([{
                    holiday_date,
                    description: description ? String(description).trim() : null,
                    created_by: req.user.user_id || null
                }])
                .select()
                .single();

            if (error) {
                if (error.code === '23505') {
                    return res.status(409).json({
                        message: 'That date is already marked as a holiday.'
                    });
                }
                throw error;
            }

            res.status(201).json({
                message: 'Holiday saved.',
                holiday: data
            });
        } catch (error) {
            console.error('HOLIDAYS POST ERROR:', error);
            res.status(500).json({ message: 'Failed to save holiday' });
        }
    }
);

// ============================================================
// DELETE HOLIDAY (Administrator only — class masters cannot remove)
// ============================================================
// Per your rules, only the Administrator may remove a holiday.
// The Manager can add them but not remove.
// ============================================================

router.delete(
    '/:id',
    authenticateToken,
    requireRoles(ROLE_IDS.ADMINISTRATOR),
    async (req, res) => {
        try {
            const holidayId = Number(req.params.id);
            if (!Number.isInteger(holidayId)) {
                return res.status(400).json({ message: 'Invalid holiday ID' });
            }

            const { error } = await supabase
                .from('holidays')
                .delete()
                .eq('holiday_id', holidayId);

            if (error) throw error;

            res.json({ message: 'Holiday removed.' });
        } catch (error) {
            console.error('HOLIDAYS DELETE ERROR:', error);
            res.status(500).json({ message: 'Failed to remove holiday' });
        }
    }
);

module.exports = router;