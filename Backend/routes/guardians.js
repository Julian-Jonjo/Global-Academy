const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET GUARDIANS
// ============================================================
router.get(
    '/',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('guardians')
                .select('guardian_id, full_name, relationship, phone, email, address')
                .order('full_name', { ascending: true });

            if (error) throw error;

            res.json(data);

        } catch (error) {
            console.error('Error loading guardians:', error);
            res.status(500).json({
                message: 'Failed to load guardians'
            });
        }
    }
);


module.exports = router;