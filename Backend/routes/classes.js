const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles,
    isAdminOrProprietor,
    isPrimaryManager,
    isSecondaryManager,
    ROLE_IDS,
    getRoleId,
    getSector
} = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// ROLE DEFINITIONS
// ============================================================

const READ_ROLES = [
    ROLE_IDS.PROPRIETOR,      // 1
    ROLE_IDS.ADMINISTRATOR,   // 2
    ROLE_IDS.FINANCE,         // 3
    ROLE_IDS.TEACHER,         // 4
    ROLE_IDS.MANAGER          // 6
];

const WRITE_ROLES = [
    ROLE_IDS.PROPRIETOR,      // 1
    ROLE_IDS.ADMINISTRATOR,   // 2
    ROLE_IDS.MANAGER          // 6
];

const PRIMARY_SECTIONS = [
    'Nursery',
    'Primary'
];

const SECONDARY_SECTIONS = [
    'JSS',
    'SSS',
    'Secondary'
];

// ============================================================
// HELPER: NORMALIZE SECTION
// ============================================================

function normalizeSection(section) {
    return String(section || '')
        .trim()
        .toLowerCase();
}

// ============================================================
// HELPER: CHECK WHETHER A SECTION BELONGS TO A SECTOR
// ============================================================

function sectionBelongsToSector(section, sector) {
    const normalizedSection = normalizeSection(section);
    const normalizedSector = String(sector || '')
        .trim()
        .toLowerCase();

    if (normalizedSector === 'primary') {
        return ['nursery', 'primary'].includes(normalizedSection);
    }

    if (normalizedSector === 'secondary') {
        return ['jss', 'sss', 'secondary'].includes(normalizedSection);
    }

    return false;
}

// ============================================================
// HELPER: GET SECTIONS AVAILABLE TO A USER
// ============================================================

function getAllowedSectionsForUser(user) {
    if (isAdminOrProprietor(user)) {
        return null; // null means all sections
    }

    const sector = getSector(user);

    if (sector === 'primary') {
        return PRIMARY_SECTIONS;
    }

    if (sector === 'secondary') {
        return SECONDARY_SECTIONS;
    }

    return [];
}

// ============================================================
// HELPER: CHECK CLASS ACCESS
// ============================================================

function canAccessClass(user, schoolSection) {
    if (isAdminOrProprietor(user)) {
        return true;
    }

    const roleId = getRoleId(user);

    // Only Managers are sector-restricted for class management.
    if (roleId === ROLE_IDS.MANAGER) {
        return sectionBelongsToSector(
            schoolSection,
            getSector(user)
        );
    }

    // Other roles may read classes, but cannot manage them.
    return false;
}

// ============================================================
// HELPER: CHECK MANAGER SECTION
// ============================================================

function managerCanUseSection(user, schoolSection) {
    if (isAdminOrProprietor(user)) {
        return true;
    }

    if (isPrimaryManager(user)) {
        return sectionBelongsToSector(
            schoolSection,
            'primary'
        );
    }

    if (isSecondaryManager(user)) {
        return sectionBelongsToSector(
            schoolSection,
            'secondary'
        );
    }

    return false;
}

// ============================================================
// GET ALL CLASSES
// ============================================================
//
// Proprietor / Administrator:
//     All active classes.
//
// Primary Manager:
//     Nursery + Primary.
//
// Secondary Manager:
//     JSS + SSS + Secondary.
//
// Finance / Teacher:
//     All active classes.
//
// Student:
//     Not permitted through this route.
// ============================================================

router.get(
    '/',
    authenticateToken,
    requireRoles(...READ_ROLES),
    async (req, res) => {
        try {
            const user = req.user;
            const roleId = getRoleId(user);

            let query = supabase
                .from('classes')
                .select('*')
                .eq('is_active', true)
                .order('school_section')
                .order('class_name')
                .order('arm');

            // Managers MUST be restricted to their own sector.
            if (roleId === ROLE_IDS.MANAGER) {
                const allowedSections =
                    getAllowedSectionsForUser(user);

                if (!allowedSections.length) {
                    return res.status(403).json({
                        message:
                            'Access denied. Manager sector is not configured.'
                    });
                }

                query = query.in(
                    'school_section',
                    allowedSections
                );
            }

            const { data, error } = await query;

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {
            console.error('Error loading classes:', error);

            res.status(500).json({
                message: 'Failed to load classes'
            });
        }
    }
);

// ============================================================
// GET SINGLE CLASS
// ============================================================

router.get(
    '/:classId',
    authenticateToken,
    requireRoles(...READ_ROLES),
    async (req, res) => {
        try {
            const classId = Number(req.params.classId);

            if (!Number.isInteger(classId)) {
                return res.status(400).json({
                    message: 'Invalid class ID'
                });
            }

            const { data, error } = await supabase
                .from('classes')
                .select('*')
                .eq('class_id', classId)
                .single();

            if (error || !data) {
                return res.status(404).json({
                    message: 'Class not found'
                });
            }

            const user = req.user;
            const roleId = getRoleId(user);

            // Managers can only access classes in their own sector.
            if (roleId === ROLE_IDS.MANAGER) {
                if (
                    !sectionBelongsToSector(
                        data.school_section,
                        getSector(user)
                    )
                ) {
                    return res.status(403).json({
                        message:
                            'Access denied to this class.'
                    });
                }
            }

            res.json(data);

        } catch (error) {
            console.error('Error loading class:', error);

            res.status(500).json({
                message: 'Failed to load class'
            });
        }
    }
);

// ============================================================
// CREATE CLASS
// ============================================================
//
// Proprietor / Administrator:
//     Can create any section.
//
// Manager:
//     Can create only within own sector.
//
// Finance / Teacher / Student:
//     Cannot create classes.
// ============================================================

router.post(
    '/',
    authenticateToken,
    requireRoles(...WRITE_ROLES),
    async (req, res) => {
        try {
            const user = req.user;

            const {
                class_name,
                arm,
                school_section,
                academic_year_id
            } = req.body;

            // ----------------------------------------------------
            // VALIDATION
            // ----------------------------------------------------

            if (
                !class_name ||
                !String(class_name).trim() ||
                !school_section ||
                !String(school_section).trim() ||
                !academic_year_id
            ) {
                return res.status(400).json({
                    message:
                        'Class name, school section and academic year are required'
                });
            }

            const cleanedClassName =
                String(class_name).trim();

            const cleanedSection =
                String(school_section).trim();

            // ----------------------------------------------------
            // MANAGER SECTOR ENFORCEMENT
            // ----------------------------------------------------

            if (
                !managerCanUseSection(
                    user,
                    cleanedSection
                )
            ) {
                return res.status(403).json({
                    message:
                        'You are not permitted to create a class in this school section.'
                });
            }

            // ----------------------------------------------------
            // CREATE CLASS
            // ----------------------------------------------------

            const { data, error } = await supabase
                .from('classes')
                .insert([
                    {
                        class_name: cleanedClassName,
                        arm: arm
                            ? String(arm).trim()
                            : null,
                        school_section: cleanedSection,
                        academic_year_id,
                        is_active: true
                    }
                ])
                .select()
                .single();

            if (error) {
                throw error;
            }

            res.status(201).json({
                message: 'Class created successfully',
                class: data
            });

        } catch (error) {
            console.error('Error creating class:', error);

            res.status(500).json({
                message: 'Failed to create class'
            });
        }
    }
);

// ============================================================
// UPDATE CLASS
// ============================================================
//
// Important:
// The existing class AND the new school_section are checked.
//
// This prevents a Primary Manager from taking a Primary class
// and changing it into a Secondary class.
// ============================================================

router.put(
    '/:classId',
    authenticateToken,
    requireRoles(...WRITE_ROLES),
    async (req, res) => {
        try {
            const classId = Number(req.params.classId);

            if (!Number.isInteger(classId)) {
                return res.status(400).json({
                    message: 'Invalid class ID'
                });
            }

            const user = req.user;

            // ----------------------------------------------------
            // GET EXISTING CLASS
            // ----------------------------------------------------

            const {
                data: existingClass,
                error: fetchError
            } = await supabase
                .from('classes')
                .select('*')
                .eq('class_id', classId)
                .single();

            if (fetchError || !existingClass) {
                return res.status(404).json({
                    message: 'Class not found'
                });
            }

            // ----------------------------------------------------
            // EXISTING CLASS ACCESS
            // ----------------------------------------------------

            if (
                !canAccessClass(
                    user,
                    existingClass.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied to update this class.'
                });
            }

            // ----------------------------------------------------
            // BUILD SAFE UPDATE OBJECT
            // ----------------------------------------------------
            //
            // Do not blindly update req.body. This prevents a
            // client from changing unexpected database columns.
            // ----------------------------------------------------

            const updateData = {};

            if (
                req.body.class_name !== undefined
            ) {
                if (
                    !String(req.body.class_name).trim()
                ) {
                    return res.status(400).json({
                        message:
                            'Class name cannot be empty'
                    });
                }

                updateData.class_name =
                    String(req.body.class_name).trim();
            }

            if (
                req.body.arm !== undefined
            ) {
                updateData.arm =
                    req.body.arm === null ||
                    req.body.arm === ''
                        ? null
                        : String(req.body.arm).trim();
            }

            if (
                req.body.school_section !== undefined
            ) {
                const newSection =
                    String(
                        req.body.school_section
                    ).trim();

                if (!newSection) {
                    return res.status(400).json({
                        message:
                            'School section cannot be empty'
                    });
                }

                // Manager must be allowed to use the NEW section.
                if (
                    !managerCanUseSection(
                        user,
                        newSection
                    )
                ) {
                    return res.status(403).json({
                        message:
                            'You are not permitted to move this class to that school section.'
                    });
                }

                updateData.school_section =
                    newSection;
            }

            if (
                req.body.academic_year_id !== undefined
            ) {
                if (!req.body.academic_year_id) {
                    return res.status(400).json({
                        message:
                            'Academic year ID cannot be empty'
                    });
                }

                updateData.academic_year_id =
                    req.body.academic_year_id;
            }

            if (
                req.body.is_active !== undefined
            ) {
                updateData.is_active =
                    Boolean(req.body.is_active);
            }

            // ----------------------------------------------------
            // NOTHING TO UPDATE
            // ----------------------------------------------------

            if (Object.keys(updateData).length === 0) {
                return res.status(400).json({
                    message:
                        'No valid class fields were provided for update'
                });
            }

            // ----------------------------------------------------
            // UPDATE
            // ----------------------------------------------------

            const {
                data,
                error
            } = await supabase
                .from('classes')
                .update(updateData)
                .eq('class_id', classId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            res.json({
                message: 'Class updated successfully',
                class: data
            });

        } catch (error) {
            console.error('Error updating class:', error);

            res.status(500).json({
                message: 'Failed to update class'
            });
        }
    }
);

// ============================================================
// DELETE CLASS
// ============================================================
//
// Proprietor / Administrator:
//     Can delete any class.
//
// Manager:
//     Can delete only classes in own sector.
//
// Finance / Teacher / Student:
//     Cannot delete classes.
// ============================================================

router.delete(
    '/:classId',
    authenticateToken,
    requireRoles(...WRITE_ROLES),
    async (req, res) => {
        try {
            const classId = Number(req.params.classId);

            if (!Number.isInteger(classId)) {
                return res.status(400).json({
                    message: 'Invalid class ID'
                });
            }

            const user = req.user;

            // ----------------------------------------------------
            // GET EXISTING CLASS
            // ----------------------------------------------------

            const {
                data: existingClass,
                error: fetchError
            } = await supabase
                .from('classes')
                .select('class_id, school_section, class_name, arm')
                .eq('class_id', classId)
                .single();

            if (fetchError || !existingClass) {
                return res.status(404).json({
                    message: 'Class not found'
                });
            }

            // ----------------------------------------------------
            // SECTOR ACCESS
            // ----------------------------------------------------

            if (
                !canAccessClass(
                    user,
                    existingClass.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied to delete this class.'
                });
            }

            // ----------------------------------------------------
            // DELETE
            // ----------------------------------------------------

            const { error } = await supabase
                .from('classes')
                .delete()
                .eq('class_id', classId);

            if (error) {
                throw error;
            }

            res.json({
                message: 'Class deleted successfully'
            });

        } catch (error) {
            console.error('Error deleting class:', error);

            res.status(500).json({
                message: 'Failed to delete class'
            });
        }
    }
);

module.exports = router;