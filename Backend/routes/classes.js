const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET ACTIVE CLASSES
// ============================================================
router.get(
    '/',
    authenticateToken,
    async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('classes')
                .select('class_id, class_name, arm, academic_year_id')
                .eq('is_active', true)
                .order('class_name')
                .order('arm');

            if (error) throw error;

            res.json(data);

        } catch (error) {
            console.error('Error loading classes:', error);
            res.status(500).json({
                message: 'Failed to load classes'
            });
        }
    }
);


module.exports = router;