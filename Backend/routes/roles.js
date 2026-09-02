const express = require('express');
const supabase = require('../Config/db');
const { authenticateToken, requireRoles } = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// GET: All Roles
// ============================================================
router.get('/', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    try {
        const { data: roles, error } = await supabase
            .from('user_roles')
            .select('*')
            .order('role_id', { ascending: true });

        if (error) throw error;

        res.json(roles || []);
    } catch (error) {
        console.error('Error loading roles:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// GET: Single Role
// ============================================================
router.get('/:id', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        if (isNaN(roleId)) {
            return res.status(400).json({ message: 'Invalid role ID' });
        }

        const { data: role, error } = await supabase
            .from('user_roles')
            .select('*')
            .eq('role_id', roleId)
            .single();

        if (error || !role) {
            return res.status(404).json({ message: 'Role not found' });
        }

        res.json(role);
    } catch (error) {
        console.error('Error loading role:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// POST: Create New Role
// ============================================================
router.post('/', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    try {
        const { role_name, description } = req.body;

        if (!role_name) {
            return res.status(400).json({ message: 'Role name is required' });
        }

        // Check if role already exists
        const { data: existingRole } = await supabase
            .from('user_roles')
            .select('role_id')
            .eq('role_name', role_name)
            .single();

        if (existingRole) {
            return res.status(409).json({ message: 'Role already exists' });
        }

        const { data: role, error } = await supabase
            .from('user_roles')
            .insert([{
                role_name: role_name,
                description: description || null,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            message: 'Role created successfully',
            role: role
        });

    } catch (error) {
        console.error('Role creation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// PUT: Update Role
// ============================================================
router.put('/:id', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        if (isNaN(roleId)) {
            return res.status(400).json({ message: 'Invalid role ID' });
        }

        const { role_name, description } = req.body;

        if (!role_name) {
            return res.status(400).json({ message: 'Role name is required' });
        }

        const { data: role, error } = await supabase
            .from('user_roles')
            .update({
                role_name: role_name,
                description: description || null,
                updated_at: new Date().toISOString()
            })
            .eq('role_id', roleId)
            .select()
            .single();

        if (error || !role) {
            return res.status(404).json({ message: 'Role not found' });
        }

        res.json({
            message: 'Role updated successfully',
            role: role
        });

    } catch (error) {
        console.error('Role update error:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// DELETE: Delete Role
// ============================================================
router.delete('/:id', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    try {
        const roleId = parseInt(req.params.id);
        if (isNaN(roleId)) {
            return res.status(400).json({ message: 'Invalid role ID' });
        }

        // Check if any users have this role
        const { data: usersWithRole } = await supabase
            .from('users')
            .select('user_id')
            .eq('role_id', roleId)
            .limit(1);

        if (usersWithRole && usersWithRole.length > 0) {
            return res.status(409).json({
                message: 'Cannot delete role. Users are assigned to this role.',
                users_count: usersWithRole.length
            });
        }

        const { error } = await supabase
            .from('user_roles')
            .delete()
            .eq('role_id', roleId);

        if (error) throw error;

        res.json({ message: 'Role deleted successfully' });

    } catch (error) {
        console.error('Role delete error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;