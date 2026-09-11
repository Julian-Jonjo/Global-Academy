const express = require('express');
const bcrypt = require('bcrypt');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// ROLE DEFINITIONS
// ============================================================

const PROTECTED_ROLE_IDS = [1, 2];
const ASSIGNABLE_ROLE_IDS = [3, 4, 5, 6];

// ============================================================
// HELPER: Get Role Name
// ============================================================
async function getRoleName(roleId) {
    const { data: role, error } = await supabase
        .from('user_roles')
        .select('role_name')
        .eq('role_id', roleId)
        .single();

    if (error || !role) {
        return 'Unknown';
    }

    return role.role_name;
}

// ============================================================
// GET AVAILABLE PEOPLE (For User Creation)
// ============================================================
router.get('/available-people', authenticateToken, requireRoles(1, 2, 6), async (req, res) => {
    try {
        const { role, sector } = req.query;

        if (!role || !sector) {
            return res.status(400).json({ message: 'role and sector are required.' });
        }

        // Fetch Teachers
        if (role === '4' || role === 'teacher') {
            const { data, error } = await supabase
                .from('teachers')
                .select('teacher_id, first_name, last_name, staff_number, school_section')
                .eq('school_section', sector)
                .eq('teacher_status', 'Active');

            if (error) throw error;
            return res.json(data || []);
        }

        res.json([]);
    } catch (error) {
        console.error('AVAILABLE PEOPLE ERROR:', error);
        res.status(500).json({ message: 'Failed to load available people' });
    }
});

// ============================================================
// GET: All Users
// ============================================================
router.get(
    '/',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const { data: users, error } = await supabase
                .from('users')
                .select(`
                    user_id,
                    username,
                    full_name,
                    email,
                    is_active,
                    created_at,
                    last_login,
                    role_id,
                    sector,
                    teacher_id,
                    user_roles!inner (
                        role_id,
                        role_name
                    )
                `)
                .order('user_id', { ascending: true });

            if (error) throw error;

            const result = (users || []).map(u => ({
                user_id: u.user_id,
                username: u.username,
                full_name: u.full_name,
                email: u.email,
                is_active: u.is_active,
                created_at: u.created_at,
                last_login: u.last_login,
                role_id: u.role_id,
                role_name: u.user_roles?.role_name || 'No Role',
                sector: u.sector || 'primary',
                teacher_id: u.teacher_id || null
            }));

            res.json(result);

        } catch (error) {
            console.error('Error loading users:', error);
            res.status(500).json({ message: error.message });
        }
    }
);

// ============================================================
// GET: Single User
// ============================================================
router.get(
    '/:id',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const userId = parseInt(req.params.id);

            if (isNaN(userId)) {
                return res.status(400).json({ message: 'Invalid user ID' });
            }

            const { data: user, error } = await supabase
                .from('users')
                .select(`
                    user_id,
                    username,
                    full_name,
                    email,
                    is_active,
                    created_at,
                    last_login,
                    role_id,
                    sector,
                    teacher_id,
                    user_roles!inner (
                        role_id,
                        role_name
                    )
                `)
                .eq('user_id', userId)
                .single();

            if (error || !user) {
                return res.status(404).json({ message: 'User not found' });
            }

            res.json({
                user_id: user.user_id,
                username: user.username,
                full_name: user.full_name,
                email: user.email,
                is_active: user.is_active,
                created_at: user.created_at,
                last_login: user.last_login,
                role_id: user.role_id,
                role_name: user.user_roles?.role_name || 'No Role',
                sector: user.sector || 'primary',
                teacher_id: user.teacher_id || null
            });

        } catch (error) {
            console.error('Error loading user:', error);
            res.status(500).json({ message: error.message });
        }
    }
);

// ============================================================
// POST: Create New User
// ============================================================
router.post(
    '/',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const {
                username,
                full_name,
                email,
                password,
                role_id,
                is_active,
                sector,
                teacher_id
            } = req.body;

            if (!username || !full_name || !password || !role_id) {
                return res.status(400).json({
                    message: 'Username, full name, password, and role are required'
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    message: 'Password must be at least 6 characters'
                });
            }

            const parsedRoleId = parseInt(role_id);

            if (isNaN(parsedRoleId)) {
                return res.status(400).json({ message: 'Invalid role ID' });
            }

            if (PROTECTED_ROLE_IDS.includes(parsedRoleId)) {
                return res.status(403).json({
                    message: 'Proprietor and Administrator accounts cannot be created through normal user registration.'
                });
            }

            if (!ASSIGNABLE_ROLE_IDS.includes(parsedRoleId)) {
                return res.status(400).json({
                    message: 'Invalid role. Users may only be assigned Manager, Finance Officer, Teacher, or Student.'
                });
            }

            const { data: role, error: roleError } = await supabase
                .from('user_roles')
                .select('role_id, role_name')
                .eq('role_id', parsedRoleId)
                .single();

            if (roleError || !role) {
                return res.status(400).json({ message: 'Selected role does not exist' });
            }

            const { data: existingUser, error: existingUserError } =
                await supabase
                    .from('users')
                    .select('user_id')
                    .eq('username', username)
                    .maybeSingle();

            if (existingUserError) {
                console.error('Username check error:', existingUserError);
                return res.status(500).json({ message: 'Failed to check username' });
            }

            if (existingUser) {
                return res.status(409).json({ message: 'Username already exists' });
            }

            const passwordHash = await bcrypt.hash(password, 10);

            const allowedSectors = ['primary', 'secondary'];
            const selectedSector = allowedSectors.includes(String(sector || '').toLowerCase())
                ? String(sector).toLowerCase()
                : 'primary';

            const insertData = {
                username: username.trim(),
                full_name: full_name.trim(),
                email: email ? email.trim() : null,
                password_hash: passwordHash,
                role_id: parsedRoleId,
                is_active: is_active !== false,
                sector: selectedSector,
                created_at: new Date().toISOString()
            };

            // Link teacher_id if creating a teacher
            if (parsedRoleId === 4 && teacher_id) {
                insertData.teacher_id = Number(teacher_id);
            }

            const { data: user, error } = await supabase
                .from('users')
                .insert([insertData])
                .select()
                .single();

            if (error) {
                console.error('User creation error:', error);
                return res.status(500).json({
                    message: 'Failed to create user: ' + error.message
                });
            }

            res.status(201).json({
                message: 'User created successfully',

                user: {
                    user_id: user.user_id,
                    username: user.username,
                    full_name: user.full_name,
                    email: user.email,
                    is_active: user.is_active,
                    role_id: user.role_id,
                    role_name: role.role_name,
                    sector: user.sector || 'primary',
                    teacher_id: user.teacher_id || null
                }
            });

        } catch (error) {
            console.error('User creation error:', error);
            res.status(500).json({ message: error.message });
        }
    }
);

// ============================================================
// PUT: Update User
// ============================================================
router.put(
    '/:id',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const userId = parseInt(req.params.id);

            if (isNaN(userId)) {
                return res.status(400).json({ message: 'Invalid user ID' });
            }

            const {
                username,
                full_name,
                email,
                password,
                role_id,
                is_active,
                sector,
                teacher_id
            } = req.body;

            const { data: existingUser, error: existingUserError } =
                await supabase
                    .from('users')
                    .select(`
                        user_id,
                        username,
                        full_name,
                        email,
                        password_hash,
                        role_id,
                        is_active,
                        sector,
                        teacher_id
                    `)
                    .eq('user_id', userId)
                    .single();

            if (existingUserError || !existingUser) {
                return res.status(404).json({ message: 'User not found' });
            }

            const currentRoleId = Number(existingUser.role_id);
            const isProtectedAccount = PROTECTED_ROLE_IDS.includes(currentRoleId);

            const updateData = {};

            if (username !== undefined) {
                if (!String(username).trim()) {
                    return res.status(400).json({ message: 'Username cannot be empty' });
                }
                updateData.username = String(username).trim();
            }

            if (full_name !== undefined) {
                if (!String(full_name).trim()) {
                    return res.status(400).json({ message: 'Full name cannot be empty' });
                }
                updateData.full_name = String(full_name).trim();
            }

            if (email !== undefined) {
                updateData.email = email ? String(email).trim() : null;
            }

            if (role_id !== undefined && role_id !== null && role_id !== '') {
                const newRoleId = parseInt(role_id);

                if (isNaN(newRoleId)) {
                    return res.status(400).json({ message: 'Invalid role ID' });
                }

                if (isProtectedAccount) {
                    if (newRoleId !== currentRoleId) {
                        return res.status(403).json({
                            message: 'The Proprietor and Administrator roles are protected and cannot be changed.'
                        });
                    }
                    updateData.role_id = currentRoleId;
                } else {
                    if (!ASSIGNABLE_ROLE_IDS.includes(newRoleId)) {
                        return res.status(403).json({
                            message: 'Users may only be assigned Manager, Finance Officer, Teacher, or Student.'
                        });
                    }
                    const { data: role, error: roleError } = await supabase
                        .from('user_roles')
                        .select('role_id')
                        .eq('role_id', newRoleId)
                        .single();

                    if (roleError || !role) {
                        return res.status(400).json({ message: 'Selected role does not exist' });
                    }

                    updateData.role_id = newRoleId;
                }
            } else {
                updateData.role_id = currentRoleId;
            }

            if (is_active !== undefined) {
                updateData.is_active = is_active === true || is_active === 'true';
            }

            if (sector !== undefined) {
                const allowedSectors = ['primary', 'secondary'];
                const selectedSector = String(sector).toLowerCase();

                if (!allowedSectors.includes(selectedSector)) {
                    return res.status(400).json({ message: 'Invalid sector. Sector must be primary or secondary.' });
                }

                updateData.sector = selectedSector;
            }

            // Link teacher_id
            if (teacher_id !== undefined) {
                updateData.teacher_id = teacher_id ? Number(teacher_id) : null;
            }

            if (password !== undefined && password !== null && password !== '') {
                if (password.length < 6) {
                    return res.status(400).json({ message: 'Password must be at least 6 characters' });
                }
                updateData.password_hash = await bcrypt.hash(password, 10);
            }

            updateData.updated_at = new Date().toISOString();

            if (updateData.username && updateData.username !== existingUser.username) {
                const { data: duplicateUser } = await supabase
                    .from('users')
                    .select('user_id')
                    .eq('username', updateData.username)
                    .neq('user_id', userId)
                    .maybeSingle();

                if (duplicateUser) {
                    return res.status(409).json({ message: 'Username already exists' });
                }
            }

            const { data: user, error } = await supabase
                .from('users')
                .update(updateData)
                .eq('user_id', userId)
                .select()
                .single();

            if (error || !user) {
                console.error('User update error:', error);
                return res.status(500).json({
                    message: 'Failed to update user: ' + (error?.message || 'Unknown error')
                });
            }

            const roleName = await getRoleName(user.role_id);

            res.json({
                message: 'User updated successfully',
                user: {
                    user_id: user.user_id,
                    username: user.username,
                    full_name: user.full_name,
                    email: user.email,
                    is_active: user.is_active,
                    role_id: user.role_id,
                    role_name: roleName,
                    sector: user.sector || 'primary',
                    teacher_id: user.teacher_id || null
                }
            });

        } catch (error) {
            console.error('User update error:', error);
            res.status(500).json({ message: error.message });
        }
    }
);

// ============================================================
// DELETE: Delete User
// ============================================================
router.delete(
    '/:id',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const userId = parseInt(req.params.id);

            if (isNaN(userId)) {
                return res.status(400).json({ message: 'Invalid user ID' });
            }

            if (userId === req.user.user_id) {
                return res.status(403).json({ message: 'You cannot delete your own account' });
            }

            const { data: existingUser, error: userError } = await supabase
                .from('users')
                .select('user_id, username, role_id')
                .eq('user_id', userId)
                .single();

            if (userError || !existingUser) {
                return res.status(404).json({ message: 'User not found' });
            }

            const { error } = await supabase
                .from('users')
                .delete()
                .eq('user_id', userId);

            if (error) {
                throw error;
            }

            res.json({ message: 'User deleted successfully' });

        } catch (error) {
            console.error('User delete error:', error);
            res.status(500).json({ message: error.message });
        }
    }
);

module.exports = router;