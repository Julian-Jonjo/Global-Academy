const express = require('express');
const pool = require('../config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// Get active classes
router.get(
    '/',
    authenticateToken,
    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT
                    class_id,
                    class_name,
                    arm,
                    academic_year_id
                FROM classes
                WHERE is_active = true
                ORDER BY class_name, arm
            `);

            res.json(result.rows);

        } catch (error) {

            console.error(
                'Error loading classes:',
                error
            );

            res.status(500).json({
                message: 'Failed to load classes'
            });
        }
    }
);


module.exports = router;