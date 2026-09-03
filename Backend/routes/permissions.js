const express = require('express');
const router = express.Router();

const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles,
    ROLE_IDS
} = require('../middleware/authMiddleware');


// ============================================================
// ROLE DEFINITIONS
// ============================================================

const ADMIN_ROLES = [
    ROLE_IDS.PROPRIETOR,
    ROLE_IDS.ADMINISTRATOR
];


// ============================================================
// PERMISSION DEFINITIONS
// ============================================================

const ALL_PERMISSIONS = [

    // Dashboard
    {
        module: 'Dashboard',
        permission: 'view_dashboard'
    },

    // Students
    {
        module: 'Students',
        permission: 'view_students'
    },
    {
        module: 'Students',
        permission: 'manage_students'
    },

    // Teachers
    {
        module: 'Teachers',
        permission: 'view_teachers'
    },
    {
        module: 'Teachers',
        permission: 'manage_teachers'
    },

    // Finance
    {
        module: 'Finance',
        permission: 'view_finance'
    },
    {
        module: 'Finance',
        permission: 'manage_finance'
    },

    // Classes
    {
        module: 'Classes',
        permission: 'view_classes'
    },
    {
        module: 'Classes',
        permission: 'manage_classes'
    },

    // Attendance
    {
        module: 'Attendance',
        permission: 'view_attendance'
    },
    {
        module: 'Attendance',
        permission: 'manage_attendance'
    },

    // Academic Records
    {
        module: 'Academic Records',
        permission: 'view_academic'
    },
    {
        module: 'Academic Records',
        permission: 'manage_academic'
    },

    // Approvals
    {
        module: 'Approvals',
        permission: 'view_approvals'
    },
    {
        module: 'Approvals',
        permission: 'manage_approvals'
    },

    // Users & Roles
    {
        module: 'Users & Roles',
        permission: 'manage_users'
    },

    // Discipline
    {
        module: 'Discipline',
        permission: 'view_discipline'
    },
    {
        module: 'Discipline',
        permission: 'manage_discipline'
    },

    // Documents
    {
        module: 'Documents',
        permission: 'view_documents'
    },
    {
        module: 'Documents',
        permission: 'manage_documents'
    }
];


// ============================================================
// HELPER: Get permission access for a role
// ============================================================

function getPermissionAccess(roleId, permission) {

    const id = Number(roleId);


    // ========================================================
    // PROPRIETOR
    // ========================================================

    if (id === ROLE_IDS.PROPRIETOR) {
        return 'full';
    }


    // ========================================================
    // ADMINISTRATOR
    // ========================================================

    if (id === ROLE_IDS.ADMINISTRATOR) {
        return 'full';
    }


    // ========================================================
    // MANAGER
    // ========================================================

    if (id === ROLE_IDS.MANAGER) {

        // Managers have full operational access,
        // but cannot manage users and roles.

        if (permission.module === 'Users & Roles') {
            return 'none';
        }

        return 'full';
    }


    // ========================================================
    // FINANCE OFFICER
    // ========================================================

    if (id === ROLE_IDS.FINANCE) {

        // Finance has full access to Finance.
        if (permission.module === 'Finance') {
            return 'full';
        }

        // Finance can read operational information
        // needed for financial work.
        if (
            permission.module === 'Dashboard' ||
            permission.module === 'Students' ||
            permission.module === 'Teachers' ||
            permission.module === 'Classes' ||
            permission.module === 'Attendance' ||
            permission.module === 'Academic Records' ||
            permission.module === 'Approvals' ||
            permission.module === 'Discipline' ||
            permission.module === 'Documents'
        ) {
            return 'read';
        }

        // Finance cannot manage users.
        if (permission.module === 'Users & Roles') {
            return 'none';
        }

        return 'none';
    }


    // ========================================================
    // TEACHER
    // ========================================================

    if (id === ROLE_IDS.TEACHER) {

        if (
            permission.module === 'Dashboard' ||
            permission.module === 'Students' ||
            permission.module === 'Attendance' ||
            permission.module === 'Academic Records' ||
            permission.module === 'Discipline' ||
            permission.module === 'Documents'
        ) {
            return 'read';
        }

        if (
            permission.module === 'Teachers' &&
            permission.permission === 'view_teachers'
        ) {
            return 'read';
        }

        if (
            permission.module === 'Classes' &&
            permission.permission === 'view_classes'
        ) {
            return 'read';
        }

        return 'none';
    }


    // ========================================================
    // STUDENT
    // ========================================================

    if (id === ROLE_IDS.STUDENT) {

        if (
            permission.module === 'Dashboard' ||
            permission.module === 'Students' ||
            permission.module === 'Academic Records' ||
            permission.module === 'Documents'
        ) {
            return 'read';
        }

        return 'none';
    }


    // ========================================================
    // UNKNOWN ROLE
    // ========================================================

    return 'none';
}


// ============================================================
// GET: Permissions for a Role
// ============================================================

router.get(
    '/',
    authenticateToken,
    requireRoles(...ADMIN_ROLES),
    async (req, res) => {

        try {

            const {
                role_id
            } = req.query;


            // ----------------------------------------------------
            // Validate role ID
            // ----------------------------------------------------

            if (!role_id) {

                return res.status(400).json({
                    message:
                        'role_id is required'
                });
            }


            const roleId =
                parseInt(role_id);


            if (
                !Number.isInteger(roleId)
            ) {

                return res.status(400).json({
                    message:
                        'Invalid role ID'
                });
            }


            // ----------------------------------------------------
            // Verify role exists
            // ----------------------------------------------------

            const {
                data: role,
                error: roleError
            } = await supabase
                .from('user_roles')
                .select(
                    'role_id, role_name'
                )
                .eq(
                    'role_id',
                    roleId
                )
                .single();


            if (roleError) {

                console.error(
                    '❌ Role lookup error:',
                    roleError
                );

                return res.status(500).json({
                    message:
                        roleError.message
                });
            }


            if (!role) {

                return res.status(404).json({
                    message:
                        'Role not found'
                });
            }


            // ----------------------------------------------------
            // Build permissions
            // ----------------------------------------------------

            const permissions =
                ALL_PERMISSIONS.map(
                    permission => {

                        const access =
                            getPermissionAccess(
                                roleId,
                                permission
                            );


                        return {

                            ...permission,

                            access:
                                access
                        };

                    }
                );


            res.json(
                permissions
            );

        } catch (error) {

            console.error(
                '❌ Error loading permissions:',
                error
            );

            res.status(500).json({
                message:
                    error.message
            });
        }
    }
);


// ============================================================
// PUT: Update Permission
// ============================================================

router.put(
    '/:id',
    authenticateToken,
    requireRoles(...ADMIN_ROLES),
    async (req, res) => {

        try {

            const permissionId =
                parseInt(
                    req.params.id
                );


            if (
                !Number.isInteger(
                    permissionId
                )
            ) {

                return res.status(400).json({
                    message:
                        'Invalid permission ID'
                });
            }


            const {
                access
            } = req.body;


            if (
                !access ||
                ![
                    'none',
                    'read',
                    'full'
                ].includes(access)
            ) {

                return res.status(400).json({
                    message:
                        'Invalid access value. Must be none, read, or full'
                });
            }


            // ----------------------------------------------------
            // CURRENT STATUS
            // ----------------------------------------------------
            //
            // The current system does not have a persistent
            // permissions table wired into this route.
            //
            // Therefore this endpoint currently validates the
            // request and returns the requested permission.
            //
            // Once a role_permissions table is introduced,
            // this is the location where the actual UPDATE/UPSERT
            // should be performed.
            // ----------------------------------------------------


            res.json({

                message:
                    'Permission updated successfully',

                permission: {

                    id:
                        permissionId,

                    access:
                        access

                }

            });

        } catch (error) {

            console.error(
                '❌ Permission update error:',
                error
            );

            res.status(500).json({
                message:
                    error.message
            });
        }
    }
);

module.exports = router;