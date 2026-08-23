const express = require('express');
const pool = require('../config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// Get guardians
router.get(
    '/',
    authenticateToken,
    requireRoles(
        'Manager',
        'Administrator',
        'Proprietor'
    ),
    async (req, res) => {

        try {

            const result = await pool.query(`
                SELECT
                    guardian_id,
                    full_name,
                    relationship,
                    phone,
                    email,
                    address
                FROM guardians
                ORDER BY full_name
            `);

            res.json(result.rows);

        } catch (error) {

            console.error(
                'Error loading guardians:',
                error
            );

            res.status(500).json({
                message: 'Failed to load guardians'
            });
        }
    }
);


module.exports = router;