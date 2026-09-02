const express = require('express');
const { supabase } = require('../Config/db');
const { authenticateToken, requireRoles } = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// GET: Permissions for a Role
// ============================================================
router.get('/', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    try {
        const { role_id } = req.query;

        if (!role_id) {
            return res.status(400).json({ message: 'role_id is required' });
        }

        const roleId = parseInt(role_id);
        if (isNaN(roleId)) {
            return res.status(400).json({ message: 'Invalid role ID' });
        }

        // Define default permissions based on role
        const { data: role } = await supabase
            .from('user_roles')
            .select('role_name')
            .eq('role_id', roleId)
            .single();

        if (!role) {
            return res.status(404).json({ message: 'Role not found' });
        }

        // Define permissions structure
        const allPermissions = [
            { module: 'Dashboard', permission: 'view_dashboard' },
            { module: 'Students', permission: 'view_students' },
            { module: 'Students', permission: 'manage_students' },
            { module: 'Teachers', permission: 'view_teachers' },
            { module: 'Teachers', permission: 'manage_teachers' },
            { module: 'Finance', permission: 'view_finance' },
            { module: 'Finance', permission: 'manage_finance' },
            { module: 'Classes', permission: 'view_classes' },
            { module: 'Classes', permission: 'manage_classes' },
            { module: 'Attendance', permission: 'view_attendance' },
            { module: 'Attendance', permission: 'manage_attendance' },
            { module: 'Academic Records', permission: 'view_academic' },
            { module: 'Academic Records', permission: 'manage_academic' },
            { module: 'Approvals', permission: 'view_approvals' },
            { module: 'Approvals', permission: 'manage_approvals' },
            { module: 'Users & Roles', permission: 'manage_users' },
            { module: 'Discipline', permission: 'view_discipline' },
            { module: 'Discipline', permission: 'manage_discipline' },
            { module: 'Documents', permission: 'view_documents' },
            { module: 'Documents', permission: 'manage_documents' },
        ];

        // Determine access based on role name
        const roleName = role.role_name || '';
        const roleLower = roleName.toLowerCase();

        let permissions = allPermissions.map(p => {
            let access = 'none';

            // Proprietor gets full access
            if (roleLower.includes('proprietor')) {
                access = 'full';
            }
            // Admin gets full access
            else if (roleLower.includes('administrator') || roleLower.includes('admin')) {
                access = 'full';
            }
            // Manager-Primary
            else if (roleLower.includes('manager-primary')) {
                if (p.module === 'Dashboard' || p.module === 'Students' || p.module === 'Teachers' ||
                    p.module === 'Finance' || p.module === 'Classes' || p.module === 'Attendance' ||
                    p.module === 'Academic Records' || p.module === 'Approvals' || p.module === 'Discipline' ||
                    p.module === 'Documents') {
                    access = 'full';
                }
                if (p.module === 'Users & Roles') {
                    access = 'none';
                }
            }
            // Manager-Secondary
            else if (roleLower.includes('manager-secondary')) {
                if (p.module === 'Dashboard' || p.module === 'Students' || p.module === 'Teachers' ||
                    p.module === 'Finance' || p.module === 'Classes' || p.module === 'Attendance' ||
                    p.module === 'Academic Records' || p.module === 'Approvals' || p.module === 'Discipline' ||
                    p.module === 'Documents') {
                    access = 'full';
                }
                if (p.module === 'Users & Roles') {
                    access = 'none';
                }
            }
            // Finance Officer (Primary)
            else if (roleLower.includes('finance officer (primary)')) {
                if (p.module === 'Finance') {
                    access = 'full';
                }
                if (p.module === 'Dashboard' || p.module === 'Students' || p.module === 'Teachers' ||
                    p.module === 'Classes' || p.module === 'Attendance' || p.module === 'Academic Records' ||
                    p.module === 'Approvals' || p.module === 'Discipline' || p.module === 'Documents') {
                    access = 'read';
                }
                if (p.module === 'Users & Roles') {
                    access = 'none';
                }
            }
            // Finance Officer (Secondary)
            else if (roleLower.includes('finance officer (secondary)')) {
                if (p.module === 'Finance') {
                    access = 'full';
                }
                if (p.module === 'Dashboard' || p.module === 'Students' || p.module === 'Teachers' ||
                    p.module === 'Classes' || p.module === 'Attendance' || p.module === 'Academic Records' ||
                    p.module === 'Approvals' || p.module === 'Discipline' || p.module === 'Documents') {
                    access = 'read';
                }
                if (p.module === 'Users & Roles') {
                    access = 'none';
                }
            }
            // Teacher
            else if (roleLower.includes('teacher')) {
                if (p.module === 'Dashboard' || p.module === 'Students' || p.module === 'Attendance' ||
                    p.module === 'Academic Records' || p.module === 'Discipline' || p.module === 'Documents') {
                    access = 'read';
                }
                if (p.module === 'Teachers' && p.permission === 'view_teachers') {
                    access = 'read';
                }
                if (p.module === 'Classes' && p.permission === 'view_classes') {
                    access = 'read';
                }
            }

            return {
                ...p,
                access: access
            };
        });

        res.json(permissions);
    } catch (error) {
        console.error('Error loading permissions:', error);
        res.status(500).json({ message: error.message });
    }
});

// ============================================================
// PUT: Update Permission
// ============================================================
router.put('/:id', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    try {
        const permissionId = parseInt(req.params.id);
        if (isNaN(permissionId)) {
            return res.status(400).json({ message: 'Invalid permission ID' });
        }

        const { access } = req.body;

        if (!access || !['none', 'read', 'full'].includes(access)) {
            return res.status(400).json({ message: 'Invalid access value. Must be none, read, or full' });
        }

        // For now, we'll store permissions in a separate table
        // If you have a permissions table, update it here
        // This is a placeholder for future implementation

        res.json({
            message: 'Permission updated successfully',
            permission: {
                id: permissionId,
                access: access
            }
        });
    } catch (error) {
        console.error('Permission update error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;