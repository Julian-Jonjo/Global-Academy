const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../Config/db');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Safely extract role_name from Supabase nested relation.
 */
function getRoleName(user) {
    if (!user?.user_roles) {
        return null;
    }

    if (Array.isArray(user.user_roles)) {
        return user.user_roles[0]?.role_name || null;
    }

    return user.user_roles.role_name || null;
}


/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                message: 'Username and password are required'
            });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                password_hash,
                full_name,
                is_active,
                role_id,
                sector,
                teacher_id,
                student_id,
                secondary_role_id,
                aao_sector,
                is_exam_officer,
                user_roles!users_role_id_fkey!inner (
                    role_id,
                    role_name
                )
            `)
            .eq('username', username)
            .single();

        if (error || !user) {
            console.error('LOGIN USER ERROR:', error);

            return res.status(401).json({
                message: 'Invalid username or password'
            });
        }

        if (!user.is_active) {
            return res.status(403).json({
                message: 'This account is inactive'
            });
        }

        if (!user.password_hash) {
            return res.status(500).json({
                message: 'User account has no password configured'
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

        const roleName = getRoleName(user);

        if (!roleName) {
            return res.status(500).json({
                message: 'User role is not properly configured'
            });
        }

        if (!user.role_id) {
            return res.status(500).json({
                message: 'User has no role assigned'
            });
        }

        const { error: loginUpdateError } = await supabase
            .from('users')
            .update({
                last_login: new Date().toISOString()
            })
            .eq('user_id', user.user_id);

        if (loginUpdateError) {
            console.error(
                'LAST LOGIN UPDATE ERROR:',
                loginUpdateError
            );
        }

        const token = jwt.sign(
            {
                user_id: user.user_id,
                username: user.username,

                role_id: Number(user.role_id),
                role_name: roleName,

                sector: user.sector || null,

                teacher_id: user.teacher_id || null,
                student_id: user.student_id || null,

                secondary_role_id: user.secondary_role_id || null,
                aao_sector: user.aao_sector || null,
                is_exam_officer: user.is_exam_officer === true
            },
            process.env.JWT_SECRET,
            {
                expiresIn: '8h'
            }
        );

        return res.json({
            message: 'Login successful',

            token,

            user: {
                user_id: user.user_id,
                username: user.username,
                full_name: user.full_name,

                role_id: Number(user.role_id),
                role_name: roleName,

                sector: user.sector || null,

                teacher_id: user.teacher_id || null,
                student_id: user.student_id || null,

                secondary_role_id: user.secondary_role_id || null,
                aao_sector: user.aao_sector || null,
                is_exam_officer: user.is_exam_officer === true
            }
        });

    } catch (error) {
        console.error('LOGIN ERROR:', error);

        return res.status(500).json({
            message: 'Server error during login'
        });
    }
});


/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select(`
                user_id,
                username,
                full_name,
                is_active,
                role_id,
                sector,
                teacher_id,
                student_id,
                secondary_role_id,
                aao_sector,
                is_exam_officer,
                user_roles!users_role_id_fkey!inner (
                    role_id,
                    role_name
                )
            `)
            .eq('user_id', req.user.user_id)
            .single();

        if (error || !user) {
            console.error('AUTH ME ERROR:', error);

            return res.status(404).json({
                message: 'User not found'
            });
        }

        if (!user.is_active) {
            return res.status(403).json({
                message: 'This account is inactive'
            });
        }

        const roleName = getRoleName(user);

        if (!roleName) {
            return res.status(500).json({
                message: 'User role is not properly configured'
            });
        }

        return res.json({
            user: {
                user_id: user.user_id,
                username: user.username,
                full_name: user.full_name,

                role_id: Number(user.role_id),
                role_name: roleName,

                sector: user.sector || null,

                teacher_id: user.teacher_id || null,
                student_id: user.student_id || null,

                secondary_role_id: user.secondary_role_id || null,
                aao_sector: user.aao_sector || null,
                is_exam_officer: user.is_exam_officer === true
            }
        });

    } catch (error) {
        console.error('AUTH ME SERVER ERROR:', error);

        return res.status(500).json({
            message: 'Server error retrieving user information'
        });
    }
});


/**
 * POST /api/auth/logout
 */
router.post('/logout', authenticateToken, (req, res) => {
    return res.json({
        message: 'Logged out successfully'
    });
});


module.exports = router;