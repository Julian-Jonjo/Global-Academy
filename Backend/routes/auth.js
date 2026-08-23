const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const router = express.Router();

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                message: 'Username and password are required'
            });
        }

        const result = await pool.query(
            `
            SELECT
                u.user_id,
                u.username,
                u.password_hash,
                u.full_name,
                u.is_active,
                r.role_id,
                r.role_name
            FROM users u
            JOIN user_roles r
                ON u.role_id = r.role_id
            WHERE u.username = $1
            `,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(403).json({
                message: 'This account is inactive'
            });
        }

        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        await pool.query(
            `
            UPDATE users
            SET last_login = CURRENT_TIMESTAMP
            WHERE user_id = $1
            `,
            [user.user_id]
        );

        const token = jwt.sign(
    {
        user_id: user.user_id,
        username: user.username,
        role_id: user.role_id,
        role_name: user.role_name
    },
    process.env.JWT_SECRET,
    {
        expiresIn: '8h'
    }
    );

    res.json({
    message: 'Login successful',
    token,
    user: {
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
        role_id: user.role_id,
        role_name: user.role_name
    }
});

    } catch (error) {
        console.error('Login error:', error);

        res.status(500).json({
            message: 'Server error during login'
        });
    }
});

module.exports = router;