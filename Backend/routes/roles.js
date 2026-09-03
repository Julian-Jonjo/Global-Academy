const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles,
    ROLE_IDS
} = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// SYSTEM ROLE IDS
// These IDs are authoritative throughout the application.
// ============================================================
const SYSTEM_ROLE_IDS = [
    ROLE_IDS.PROPRIETOR,      // 1
    ROLE_IDS.ADMINISTRATOR,   // 2
    ROLE_IDS.FINANCE,         // 3
    ROLE_IDS.TEACHER,         // 4
    ROLE_IDS.STUDENT,         // 5
    ROLE_IDS.MANAGER          // 6
];

// Only Proprietor and Administrator may manage roles.
const ROLE_MANAGEMENT_ROLES = [
    ROLE_IDS.PROPRIETOR,
    ROLE_IDS.ADMINISTRATOR
];

// ============================================================
// GET: All Roles
// ============================================================
router.get(
    '/',
    authenticateToken,
    requireRoles(...ROLE_MANAGEMENT_ROLES),
    async (req, res) => {
        try {
            const { data: roles, error } = await supabase
                .from('user_roles')
                .select('*')
                .order('role_id', { ascending: true });

            if (error) {
                throw error;
            }

            res.json(roles || []);

        } catch (error) {
            console.error('Error loading roles:', error);

            res.status(500).json({
                message: error.message || 'Failed to load roles'
            });
        }
    }
);

// ============================================================
// GET: Single Role
// ============================================================
router.get(
    '/:id',
    authenticateToken,
    requireRoles(...ROLE_MANAGEMENT_ROLES),
    async (req, res) => {
        try {
            const roleId = Number.parseInt(req.params.id, 10);

            if (Number.isNaN(roleId)) {
                return res.status(400).json({
                    message: 'Invalid role ID'
                });
            }

            const { data: role, error } = await supabase
                .from('user_roles')
                .select('*')
                .eq('role_id', roleId)
                .single();

            if (error || !role) {
                return res.status(404).json({
                    message: 'Role not found'
                });
            }

            res.json(role);

        } catch (error) {
            console.error('Error loading role:', error);

            res.status(500).json({
                message: error.message || 'Failed to load role'
            });
        }
    }
);

// ============================================================
// POST: Create New Role
// ============================================================
//
// NOTE:
// The current authorization system is based on the six
// predefined role IDs. Creating arbitrary new roles can create
// roles that the application does not know how to authorize.
//
// Therefore, this endpoint is intentionally disabled for now.
// ============================================================
router.post(
    '/',
    authenticateToken,
    requireRoles(...ROLE_MANAGEMENT_ROLES),
    async (req, res) => {
        return res.status(403).json({
            message:
                'Creating custom roles is disabled. The system uses the predefined role IDs 1-6.'
        });
    }
);

// ============================================================
// PUT: Update Role
// ============================================================
//
// The six system roles are protected because their role_id values
// are referenced throughout the backend authorization system.
//
// We therefore allow viewing roles but do not allow changing
// their names or IDs through this endpoint.
// ============================================================
router.put(
    '/:id',
    authenticateToken,
    requireRoles(...ROLE_MANAGEMENT_ROLES),
    async (req, res) => {
        try {
            const roleId = Number.parseInt(req.params.id, 10);

            if (Number.isNaN(roleId)) {
                return res.status(400).json({
                    message: 'Invalid role ID'
                });
            }

            if (SYSTEM_ROLE_IDS.includes(roleId)) {
                return res.status(403).json({
                    message:
                        'System roles cannot be renamed or modified because their role IDs are used by the authorization system.'
                });
            }

            const { role_name, description } = req.body;

            if (!role_name || !String(role_name).trim()) {
                return res.status(400).json({
                    message: 'Role name is required'
                });
            }

            // Check whether the role exists.
            const { data: existingRole, error: existingError } =
                await supabase
                    .from('user_roles')
                    .select('role_id')
                    .eq('role_id', roleId)
                    .maybeSingle();

            if (existingError) {
                throw existingError;
            }

            if (!existingRole) {
                return res.status(404).json({
                    message: 'Role not found'
                });
            }

            // Check for duplicate role name.
            const { data: duplicateRole, error: duplicateError } =
                await supabase
                    .from('user_roles')
                    .select('role_id')
                    .ilike('role_name', String(role_name).trim())
                    .neq('role_id', roleId)
                    .maybeSingle();

            if (duplicateError) {
                throw duplicateError;
            }

            if (duplicateRole) {
                return res.status(409).json({
                    message: 'Another role already uses this role name'
                });
            }

            const { data: role, error } = await supabase
                .from('user_roles')
                .update({
                    role_name: String(role_name).trim(),
                    description: description
                        ? String(description).trim()
                        : null,
                    updated_at: new Date().toISOString()
                })
                .eq('role_id', roleId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            if (!role) {
                return res.status(404).json({
                    message: 'Role not found'
                });
            }

            res.json({
                message: 'Role updated successfully',
                role
            });

        } catch (error) {
            console.error('Role update error:', error);

            res.status(500).json({
                message: error.message || 'Failed to update role'
            });
        }
    }
);

// ============================================================
// DELETE: Delete Role
// ============================================================
//
// System roles 1-6 cannot be deleted.
// Custom roles, if they exist in the database, may be deleted
// only when no users are assigned to them.
// ============================================================
router.delete(
    '/:id',
    authenticateToken,
    requireRoles(...ROLE_MANAGEMENT_ROLES),
    async (req, res) => {
        try {
            const roleId = Number.parseInt(req.params.id, 10);

            if (Number.isNaN(roleId)) {
                return res.status(400).json({
                    message: 'Invalid role ID'
                });
            }

            // Never allow deletion of the six core roles.
            if (SYSTEM_ROLE_IDS.includes(roleId)) {
                return res.status(403).json({
                    message:
                        'System roles cannot be deleted because they are required by the authorization system.'
                });
            }

            // Check whether users are assigned to this role.
            const { data: usersWithRole, error: usersError } =
                await supabase
                    .from('users')
                    .select('user_id')
                    .eq('role_id', roleId)
                    .limit(1);

            if (usersError) {
                throw usersError;
            }

            if (usersWithRole && usersWithRole.length > 0) {
                return res.status(409).json({
                    message:
                        'Cannot delete role. Users are assigned to this role.',
                    users_count: usersWithRole.length
                });
            }

            // Confirm that the role exists before deleting.
            const { data: existingRole, error: roleCheckError } =
                await supabase
                    .from('user_roles')
                    .select('role_id')
                    .eq('role_id', roleId)
                    .maybeSingle();

            if (roleCheckError) {
                throw roleCheckError;
            }

            if (!existingRole) {
                return res.status(404).json({
                    message: 'Role not found'
                });
            }

            const { error } = await supabase
                .from('user_roles')
                .delete()
                .eq('role_id', roleId);

            if (error) {
                throw error;
            }

            res.json({
                message: 'Role deleted successfully'
            });

        } catch (error) {
            console.error('Role delete error:', error);

            res.status(500).json({
                message: error.message || 'Failed to delete role'
            });
        }
    }
);

module.exports = router;