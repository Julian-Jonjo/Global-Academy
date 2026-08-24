const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../Config/db');

const router = express.Router();

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        console.log('🔍 Login attempt:', username);

        if (!username || !password) {
            return res.status(400).json({
                message: 'Username and password are required'
            });
        }

        // Get user from Supabase (without relation)
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .maybeSingle();

        if (error) {
            console.error('❌ Database error:', error);
            return res.status(500).json({
                message: 'Database error: ' + error.message
            });
        }

        if (!user) {
            console.log('❌ User not found:', username);
            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        console.log('✅ User found:', user.username);

        if (!user.is_active) {
            return res.status(403).json({
                message: 'This account is inactive'
            });
        }

        // Compare password
        console.log('🔑 Comparing password...');
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        console.log('✅ Password match:', passwordMatch);

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

        // Create token
        const token = jwt.sign(
            {
                user_id: user.user_id,
                username: user.username,
                role_id: user.role_id
            },
            process.env.JWT_SECRET || 'default_secret_key',
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                user_id: user.user_id,
                username: user.username,
                full_name: user.full_name,
                role_id: user.role_id
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        console.error('❌ Stack:', error.stack);
        res.status(500).json({
            message: 'Server error during login: ' + error.message
        });
    }
});

module.exports = router;