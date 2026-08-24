const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../config/db');

const router = express.Router();

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                message: 'Username and password are required'
            });
        }

        // Query Supabase for user with role
        const { data: user, error } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                password_hash,
                full_name,
                is_active,
                role_id,
                user_roles:role_id (
                    role_id,
                    role_name
                )
            `)
            .eq('username', username)
            .single();

        if (error || !user) {
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

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

        // Update last_login
        await supabase
            .from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('user_id', user.user_id);

        const token = jwt.sign(
            {
                user_id: user.user_id,
                username: user.username,
                role_id: user.role_id,
                role_name: user.user_roles?.role_name
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
                role_name: user.user_roles?.role_name
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