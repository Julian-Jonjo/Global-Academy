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

// Protected system-level roles.
// These roles appear in the Users list but are NOT assignable
// through normal user creation/editing.
const PROTECTED_ROLE_IDS = [1, 2];

// Normal roles that can be assigned to users.
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
                sector: u.sector || 'primary'
            }));

            res.json(result);

        } catch (error) {
            console.error('Error loading users:', error);

            res.status(500).json({
                message: error.message
            });
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
                return res.status(400).json({
                    message: 'Invalid user ID'
                });
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
                    user_roles!inner (
                        role_id,
                        role_name
                    )
                `)
                .eq('user_id', userId)
                .single();

            if (error || !user) {
                return res.status(404).json({
                    message: 'User not found'
                });
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
                sector: user.sector || 'primary'
            });

        } catch (error) {
            console.error('Error loading user:', error);

            res.status(500).json({
                message: error.message
            });
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
                sector
            } = req.body;

            // ----------------------------------------------------
            // Validate required fields
            // ----------------------------------------------------
            if (!username || !full_name || !password || !role_id) {
                return res.status(400).json({
                    message:
                        'Username, full name, password, and role are required'
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    message: 'Password must be at least 6 characters'
                });
            }

            const parsedRoleId = parseInt(role_id);

            if (isNaN(parsedRoleId)) {
                return res.status(400).json({
                    message: 'Invalid role ID'
                });
            }

            // ----------------------------------------------------
            // Prevent creation of Proprietor / Administrator
            // through the normal Add User API
            // ----------------------------------------------------
            if (PROTECTED_ROLE_IDS.includes(parsedRoleId)) {
                return res.status(403).json({
                    message:
                        'Proprietor and Administrator accounts cannot be created through normal user registration.'
                });
            }

            // ----------------------------------------------------
            // Only allow the four normal roles
            // ----------------------------------------------------
            if (!ASSIGNABLE_ROLE_IDS.includes(parsedRoleId)) {
                return res.status(400).json({
                    message:
                        'Invalid role. Users may only be assigned Manager, Finance Officer, Teacher, or Student.'
                });
            }

            // ----------------------------------------------------
            // Verify role actually exists
            // ----------------------------------------------------
            const { data: role, error: roleError } = await supabase
                .from('user_roles')
                .select('role_id, role_name')
                .eq('role_id', parsedRoleId)
                .single();

            if (roleError || !role) {
                return res.status(400).json({
                    message: 'Selected role does not exist'
                });
            }

            // ----------------------------------------------------
            // Check username
            // ----------------------------------------------------
            const { data: existingUser, error: existingUserError } =
                await supabase
                    .from('users')
                    .select('user_id')
                    .eq('username', username)
                    .maybeSingle();

            if (existingUserError) {
                console.error(
                    'Username check error:',
                    existingUserError
                );

                return res.status(500).json({
                    message: 'Failed to check username'
                });
            }

            if (existingUser) {
                return res.status(409).json({
                    message: 'Username already exists'
                });
            }

            // ----------------------------------------------------
            // Hash password
            // ----------------------------------------------------
            const passwordHash = await bcrypt.hash(password, 10);

            // ----------------------------------------------------
            // Sector validation
            // ----------------------------------------------------
            const allowedSectors = ['primary', 'secondary'];

            const selectedSector = allowedSectors.includes(
                String(sector || '').toLowerCase()
            )
                ? String(sector).toLowerCase()
                : 'primary';

            // ----------------------------------------------------
            // Create user
            // ----------------------------------------------------
            const { data: user, error } = await supabase
                .from('users')
                .insert([
                    {
                        username: username.trim(),
                        full_name: full_name.trim(),
                        email: email ? email.trim() : null,
                        password_hash: passwordHash,
                        role_id: parsedRoleId,
                        is_active: is_active !== false,
                        sector: selectedSector,
                        created_at: new Date().toISOString()
                    }
                ])
                .select()
                .single();

            if (error) {
                console.error(
                    'User creation error:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to create user: ' + error.message
                });
            }

            // ----------------------------------------------------
            // Return created user
            // ----------------------------------------------------
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
                    sector: user.sector || 'primary'
                }
            });

        } catch (error) {
            console.error(
                'User creation error:',
                error
            );

            res.status(500).json({
                message: error.message
            });
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
                return res.status(400).json({
                    message: 'Invalid user ID'
                });
            }

            const {
                username,
                full_name,
                email,
                password,
                role_id,
                is_active,
                sector
            } = req.body;

            // ----------------------------------------------------
            // Get existing user first
            // ----------------------------------------------------
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
                        sector
                    `)
                    .eq('user_id', userId)
                    .single();

            if (existingUserError || !existingUser) {
                return res.status(404).json({
                    message: 'User not found'
                });
            }

            const currentRoleId = Number(existingUser.role_id);

            // ----------------------------------------------------
            // Determine whether this is a protected account
            // ----------------------------------------------------
            const isProtectedAccount =
                PROTECTED_ROLE_IDS.includes(currentRoleId);

            // ----------------------------------------------------
            // Build update object WITHOUT destroying fields
            // that were not supplied.
            // ----------------------------------------------------
            const updateData = {};

            // Username
            if (username !== undefined) {
                if (!String(username).trim()) {
                    return res.status(400).json({
                        message: 'Username cannot be empty'
                    });
                }

                updateData.username = String(username).trim();
            }

            // Full name
            if (full_name !== undefined) {
                if (!String(full_name).trim()) {
                    return res.status(400).json({
                        message: 'Full name cannot be empty'
                    });
                }

                updateData.full_name = String(full_name).trim();
            }

            // Email
            if (email !== undefined) {
                updateData.email = email
                    ? String(email).trim()
                    : null;
            }

            // ----------------------------------------------------
            // ROLE HANDLING
            // ----------------------------------------------------
            if (role_id !== undefined && role_id !== null && role_id !== '') {

                const newRoleId = parseInt(role_id);

                if (isNaN(newRoleId)) {
                    return res.status(400).json({
                        message: 'Invalid role ID'
                    });
                }

                // Existing Proprietor/Administrator:
                // role cannot be changed.
                if (isProtectedAccount) {

                    if (newRoleId !== currentRoleId) {
                        return res.status(403).json({
                            message:
                                'The Proprietor and Administrator roles are protected and cannot be changed.'
                        });
                    }

                    // Keep original protected role
                    updateData.role_id = currentRoleId;

                } else {

                    // Normal user can only use normal roles
                    if (!ASSIGNABLE_ROLE_IDS.includes(newRoleId)) {
                        return res.status(403).json({
                            message:
                                'Users may only be assigned Manager, Finance Officer, Teacher, or Student.'
                        });
                    }

                    // Verify role exists
                    const { data: role, error: roleError } =
                        await supabase
                            .from('user_roles')
                            .select('role_id')
                            .eq('role_id', newRoleId)
                            .single();

                    if (roleError || !role) {
                        return res.status(400).json({
                            message: 'Selected role does not exist'
                        });
                    }

                    updateData.role_id = newRoleId;
                }

            } else {

                // If no role was supplied, KEEP current role.
                updateData.role_id = currentRoleId;
            }

            // ----------------------------------------------------
            // Status
            // ----------------------------------------------------
            if (is_active !== undefined) {
                updateData.is_active =
                    is_active === true ||
                    is_active === 'true';
            }

            // ----------------------------------------------------
            // Sector
            // ----------------------------------------------------
            if (sector !== undefined) {

                const allowedSectors = [
                    'primary',
                    'secondary'
                ];

                const selectedSector =
                    String(sector).toLowerCase();

                if (!allowedSectors.includes(selectedSector)) {
                    return res.status(400).json({
                        message:
                            'Invalid sector. Sector must be primary or secondary.'
                    });
                }

                updateData.sector = selectedSector;
            }

            // ----------------------------------------------------
            // Password
            // ----------------------------------------------------
            if (password !== undefined && password !== null && password !== '') {

                if (password.length < 6) {
                    return res.status(400).json({
                        message:
                            'Password must be at least 6 characters'
                    });
                }

                updateData.password_hash =
                    await bcrypt.hash(password, 10);
            }

            // ----------------------------------------------------
            // Updated timestamp
            // ----------------------------------------------------
            updateData.updated_at =
                new Date().toISOString();

            // ----------------------------------------------------
            // Prevent duplicate username
            // ----------------------------------------------------
            if (
                updateData.username &&
                updateData.username !== existingUser.username
            ) {

                const { data: duplicateUser } =
                    await supabase
                        .from('users')
                        .select('user_id')
                        .eq(
                            'username',
                            updateData.username
                        )
                        .neq('user_id', userId)
                        .maybeSingle();

                if (duplicateUser) {
                    return res.status(409).json({
                        message:
                            'Username already exists'
                    });
                }
            }

            // ----------------------------------------------------
            // Update user
            // ----------------------------------------------------
            const { data: user, error } = await supabase
                .from('users')
                .update(updateData)
                .eq('user_id', userId)
                .select()
                .single();

            if (error || !user) {

                console.error(
                    'User update error:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to update user: ' +
                        (error?.message || 'Unknown error')
                });
            }

            // ----------------------------------------------------
            // Get role name
            // ----------------------------------------------------
            const roleName =
                await getRoleName(user.role_id);

            // ----------------------------------------------------
            // Return updated user
            // ----------------------------------------------------
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
                    sector: user.sector || 'primary'
                }
            });

        } catch (error) {

            console.error(
                'User update error:',
                error
            );

            res.status(500).json({
                message: error.message
            });
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
                return res.status(400).json({
                    message: 'Invalid user ID'
                });
            }

            // ----------------------------------------------------
            // Prevent deleting yourself
            // ----------------------------------------------------
            if (userId === req.user.user_id) {
                return res.status(403).json({
                    message:
                        'You cannot delete your own account'
                });
            }

            // ----------------------------------------------------
            // Check if user exists
            // ----------------------------------------------------
            const { data: existingUser, error: userError } =
                await supabase
                    .from('users')
                    .select(`
                        user_id,
                        username,
                        role_id
                    `)
                    .eq('user_id', userId)
                    .single();

            if (userError || !existingUser) {
                return res.status(404).json({
                    message: 'User not found'
                });
            }

            // ----------------------------------------------------
            // Delete user
            // ----------------------------------------------------
            const { error } = await supabase
                .from('users')
                .delete()
                .eq('user_id', userId);

            if (error) {
                throw error;
            }

            res.json({
                message: 'User deleted successfully'
            });

        } catch (error) {

            console.error(
                'User delete error:',
                error
            );

            res.status(500).json({
                message: error.message
            });
        }
    }
);

module.exports = router;