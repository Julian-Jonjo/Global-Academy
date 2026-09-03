const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const supabase = require('../Config/db');

const {
    authenticateToken,
    requireTeacher,
    requireRoles,
    getRoleId,
    getSector,
    ROLE_IDS
} = require('../middleware/authMiddleware');


// ============================================================
// ROLE CONSTANTS
// ============================================================

const PROPRIETOR = ROLE_IDS.PROPRIETOR;
const ADMINISTRATOR = ROLE_IDS.ADMINISTRATOR;
const FINANCE = ROLE_IDS.FINANCE;
const TEACHER = ROLE_IDS.TEACHER;
const STUDENT = ROLE_IDS.STUDENT;
const MANAGER = ROLE_IDS.MANAGER;

const MANAGEMENT_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    MANAGER
];

const TEACHER_VIEW_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE,
    TEACHER,
    MANAGER
];


// ============================================================
// SCHOOL SECTIONS
// ============================================================

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
// HELPERS
// ============================================================

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}


function managerCanAccessSector(user, sector) {
    const roleId = getRoleId(user);
    const userSector = getSector(user);

    if (roleId === PROPRIETOR || roleId === ADMINISTRATOR) {
        return true;
    }

    if (roleId !== MANAGER) {
        return false;
    }

    return normalize(userSector) === normalize(sector);
}


function managerCanAccessSection(user, schoolSection) {
    const roleId = getRoleId(user);
    const sector = getSector(user);

    if (roleId === PROPRIETOR || roleId === ADMINISTRATOR) {
        return true;
    }

    if (roleId !== MANAGER) {
        return false;
    }

    const section = normalize(schoolSection);

    if (sector === 'primary') {
        return PRIMARY_SECTIONS.some(
            item => normalize(item) === section
        );
    }

    if (sector === 'secondary') {
        return SECONDARY_SECTIONS.some(
            item => normalize(item) === section
        );
    }

    return false;
}


function getAllowedSchoolSections(sector) {
    const normalizedSector = normalize(sector);

    if (normalizedSector === 'primary') {
        return PRIMARY_SECTIONS;
    }

    if (normalizedSector === 'secondary') {
        return SECONDARY_SECTIONS;
    }

    return [];
}


function getSectorFromSchoolSection(section) {
    const normalized = normalize(section);

    if (
        PRIMARY_SECTIONS.some(
            item => normalize(item) === normalized
        )
    ) {
        return 'primary';
    }

    if (
        SECONDARY_SECTIONS.some(
            item => normalize(item) === normalized
        )
    ) {
        return 'secondary';
    }

    return null;
}


// ============================================================
// MULTER CONFIGURATION
// ============================================================

const uploadDirectory = path.join(
    __dirname,
    '..',
    'uploads',
    'teacher-applications'
);

if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, {
        recursive: true
    });
}


const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDirectory);
    },

    filename: function (req, file, cb) {
        const extension = path.extname(file.originalname);

        const safeName = path
            .basename(file.originalname, extension)
            .replace(/[^a-zA-Z0-9_-]/g, '_');

        cb(
            null,
            `${Date.now()}-${safeName}${extension}`
        );
    }
});


const upload = multer({
    storage,

    limits: {
        fileSize: 10 * 1024 * 1024
    }
});


// ============================================================
// CURRENT ACADEMIC YEAR
// ============================================================

router.get(
    '/academic-year/current',
    authenticateToken,
    async (req, res) => {
        try {

            const { data, error } = await supabase
                .from('academic_years')
                .select('*')
                .eq('is_current', true)
                .maybeSingle();

            if (error) {
                console.error(
                    'CURRENT ACADEMIC YEAR ERROR:',
                    error
                );

                return res.status(500).json({
                    message: 'Failed to load current academic year',
                    error: error.message
                });
            }

            res.json(data);

        } catch (error) {
            console.error(
                'CURRENT ACADEMIC YEAR EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// DEPARTMENTS
// ============================================================

router.get(
    '/data/departments',
    authenticateToken,
    async (req, res) => {
        try {

            const { data, error } = await supabase
                .from('departments')
                .select('*')
                .order('name');

            if (error) {
                console.error(
                    'DEPARTMENTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message: 'Failed to load departments',
                    error: error.message
                });
            }

            res.json(data || []);

        } catch (error) {
            console.error(
                'DEPARTMENTS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// SUBJECTS
// ============================================================

router.get(
    '/data/subjects',
    authenticateToken,
    async (req, res) => {
        try {

            const { data, error } = await supabase
                .from('subjects')
                .select('*')
                .order('subject_name');

            if (error) {
                console.error(
                    'SUBJECTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message: 'Failed to load subjects',
                    error: error.message
                });
            }

            res.json(data || []);

        } catch (error) {
            console.error(
                'SUBJECTS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// CLASSES
// ============================================================

router.get(
    '/data/classes',
    authenticateToken,
    async (req, res) => {
        try {

            let query = supabase
                .from('classes')
                .select(`
                    class_id,
                    class_name,
                    arm,
                    school_section,
                    academic_year_id,
                    is_active
                `)
                .eq('is_active', true);

            const roleId = getRoleId(req.user);
            const sector = getSector(req.user);

            if (roleId === MANAGER) {

                const allowedSections =
                    getAllowedSchoolSections(sector);

                if (!allowedSections.length) {
                    return res.status(403).json({
                        message:
                            'Manager does not have a valid school sector.'
                    });
                }

                query = query.in(
                    'school_section',
                    allowedSections
                );
            }

            const {
                data,
                error
            } = await query.order('class_name');

            if (error) {
                console.error(
                    'CLASSES ERROR:',
                    error
                );

                return res.status(500).json({
                    message: 'Failed to load classes',
                    error: error.message
                });
            }

            res.json(data || []);

        } catch (error) {
            console.error(
                'CLASSES EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// TEACHER APPLICATION
// PUBLIC ROUTE
// ============================================================

router.post(
    '/apply',
    upload.single('application_document'),
    async (req, res) => {

        try {

            const body = req.body;

            const {
                first_name,
                middle_name,
                last_name,
                gender,
                date_of_birth,
                phone,
                email,
                address,
                qualification,
                specialization,
                years_experience,
                previous_school,
                school_section,
                department,
                subject,
                class_name,
                notes
            } = body;

            if (
                !first_name ||
                !last_name ||
                !school_section
            ) {
                return res.status(400).json({
                    message:
                        'First name, last name and school section are required.'
                });
            }


            const sector =
                getSectorFromSchoolSection(
                    school_section
                );

            if (!sector) {
                return res.status(400).json({
                    message:
                        'Invalid school section.'
                });
            }


            let applicationDocument = null;

            if (req.file) {
                applicationDocument =
                    `/uploads/teacher-applications/${req.file.filename}`;
            }


            const { data, error } = await supabase
                .from('teacher_applications')
                .insert([{
                    first_name,
                    middle_name:
                        middle_name || null,
                    last_name,
                    gender:
                        gender || null,
                    date_of_birth:
                        date_of_birth || null,
                    phone:
                        phone || null,
                    email:
                        email || null,
                    address:
                        address || null,
                    qualification:
                        qualification || null,
                    specialization:
                        specialization || null,
                    years_experience:
                        years_experience || null,
                    previous_school:
                        previous_school || null,
                    school_section,
                    department:
                        department || null,
                    subject:
                        subject || null,
                    class_name:
                        class_name || null,
                    notes:
                        notes || null,
                    application_document:
                        applicationDocument,
                    application_status:
                        'Pending'
                }])
                .select()
                .single();

            if (error) {
                console.error(
                    'TEACHER APPLICATION ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to submit teacher application',
                    error: error.message
                });
            }

            res.status(201).json({
                message:
                    'Teacher application submitted successfully.',
                application: data
            });

        } catch (error) {

            console.error(
                'TEACHER APPLICATION EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// GET TEACHER APPLICATIONS
// ============================================================

router.get(
    '/applications',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            let query = supabase
                .from('teacher_applications')
                .select('*')
                .order('created_at', {
                    ascending: false
                });


            const roleId = getRoleId(req.user);
            const sector = getSector(req.user);


            if (roleId === MANAGER) {

                const allowedSections =
                    getAllowedSchoolSections(sector);

                if (!allowedSections.length) {
                    return res.status(403).json({
                        message:
                            'Manager does not have a valid school sector.'
                    });
                }

                query = query.in(
                    'school_section',
                    allowedSections
                );
            }


            const {
                data,
                error
            } = await query;


            if (error) {
                console.error(
                    'APPLICATIONS ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load teacher applications',
                    error: error.message
                });
            }


            res.json(data || []);

        } catch (error) {

            console.error(
                'APPLICATIONS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// REVIEW APPLICATION
// MANAGER / ADMINISTRATOR
// ============================================================

router.put(
    '/applications/:id/review',
    authenticateToken,
    requireRoles(
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const applicationId =
                req.params.id;

            const {
                review_notes,
                application_status
            } = req.body;


            const {
                data: application,
                error: applicationError
            } = await supabase
                .from('teacher_applications')
                .select('*')
                .eq('id', applicationId)
                .maybeSingle();


            if (applicationError) {
                console.error(
                    'APPLICATION LOOKUP ERROR:',
                    applicationError
                );

                return res.status(500).json({
                    message:
                        'Failed to load application',
                    error:
                        applicationError.message
                });
            }


            if (!application) {
                return res.status(404).json({
                    message:
                        'Teacher application not found.'
                });
            }


            if (
                getRoleId(req.user) === MANAGER &&
                !managerCanAccessSection(
                    req.user,
                    application.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Application belongs to another school sector.'
                });
            }


            const updateData = {};


            if (review_notes !== undefined) {
                updateData.review_notes =
                    review_notes;
            }


            if (application_status !== undefined) {
                updateData.application_status =
                    application_status;
            }


            updateData.reviewed_by =
                req.user.user_id || null;

            updateData.reviewed_at =
                new Date().toISOString();


            const {
                data,
                error
            } = await supabase
                .from('teacher_applications')
                .update(updateData)
                .eq('id', applicationId)
                .select()
                .single();


            if (error) {
                console.error(
                    'APPLICATION REVIEW ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to review application',
                    error: error.message
                });
            }


            res.json({
                message:
                    'Application reviewed successfully.',
                application: data
            });

        } catch (error) {

            console.error(
                'APPLICATION REVIEW EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// APPROVE APPLICATION
// PROPRIETOR / ADMINISTRATOR
// ============================================================

router.put(
    '/applications/:id/approve',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR
    ),
    async (req, res) => {

        try {

            const applicationId =
                req.params.id;


            const {
                data,
                error
            } = await supabase
                .from('teacher_applications')
                .update({
                    application_status:
                        'Approved',
                    approved_by:
                        req.user.user_id || null,
                    approved_at:
                        new Date().toISOString()
                })
                .eq('id', applicationId)
                .select()
                .single();


            if (error) {
                console.error(
                    'APPLICATION APPROVE ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to approve application',
                    error: error.message
                });
            }


            res.json({
                message:
                    'Teacher application approved successfully.',
                application: data
            });

        } catch (error) {

            console.error(
                'APPLICATION APPROVE EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// REJECT APPLICATION
// ============================================================

router.put(
    '/applications/:id/reject',
    authenticateToken,
    requireRoles(
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const applicationId =
                req.params.id;

            const {
                rejection_reason
            } = req.body;


            const {
                data: application,
                error: applicationError
            } = await supabase
                .from('teacher_applications')
                .select(`
                    id,
                    school_section
                `)
                .eq('id', applicationId)
                .maybeSingle();


            if (applicationError) {
                return res.status(500).json({
                    message:
                        'Failed to load application',
                    error:
                        applicationError.message
                });
            }


            if (!application) {
                return res.status(404).json({
                    message:
                        'Teacher application not found.'
                });
            }


            if (
                getRoleId(req.user) === MANAGER &&
                !managerCanAccessSection(
                    req.user,
                    application.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Application belongs to another school sector.'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teacher_applications')
                .update({
                    application_status:
                        'Rejected',
                    rejection_reason:
                        rejection_reason || null,
                    reviewed_by:
                        req.user.user_id || null,
                    reviewed_at:
                        new Date().toISOString()
                })
                .eq('id', applicationId)
                .select()
                .single();


            if (error) {
                console.error(
                    'APPLICATION REJECT ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to reject application',
                    error: error.message
                });
            }


            res.json({
                message:
                    'Teacher application rejected.',
                application: data
            });

        } catch (error) {

            console.error(
                'APPLICATION REJECT EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// DELETE APPLICATION
// ============================================================

router.delete(
    '/applications/:id',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR
    ),
    async (req, res) => {

        try {

            const applicationId =
                req.params.id;


            const {
                data: application,
                error: lookupError
            } = await supabase
                .from('teacher_applications')
                .select('id, application_document')
                .eq('id', applicationId)
                .maybeSingle();


            if (lookupError) {
                return res.status(500).json({
                    message:
                        'Failed to load application',
                    error:
                        lookupError.message
                });
            }


            if (!application) {
                return res.status(404).json({
                    message:
                        'Teacher application not found.'
                });
            }


            const {
                error
            } = await supabase
                .from('teacher_applications')
                .delete()
                .eq('id', applicationId);


            if (error) {
                console.error(
                    'APPLICATION DELETE ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to delete application',
                    error: error.message
                });
            }


            res.json({
                message:
                    'Teacher application deleted successfully.'
            });

        } catch (error) {

            console.error(
                'APPLICATION DELETE EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// ASSIGN TEACHER TO CLASS
// MANAGER / ADMINISTRATOR / PROPRIETOR
// ============================================================

router.post(
    '/assign-class',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const {
                teacher_id,
                class_id,
                academic_year_id
            } = req.body;


            if (!teacher_id || !class_id) {
                return res.status(400).json({
                    message:
                        'teacher_id and class_id are required.'
                });
            }


            // ----------------------------------------------------
            // LOAD TEACHER
            // ----------------------------------------------------

            const {
                data: teacher,
                error: teacherError
            } = await supabase
                .from('teachers')
                .select(`
                    id,
                    school_section
                `)
                .eq('id', teacher_id)
                .maybeSingle();


            if (teacherError) {
                return res.status(500).json({
                    message:
                        'Failed to load teacher',
                    error:
                        teacherError.message
                });
            }


            if (!teacher) {
                return res.status(404).json({
                    message:
                        'Teacher not found.'
                });
            }


            // ----------------------------------------------------
            // LOAD CLASS
            // IMPORTANT: PRIMARY KEY IS class_id
            // ----------------------------------------------------

            const {
                data: classData,
                error: classError
            } = await supabase
                .from('classes')
                .select(`
                    class_id,
                    class_name,
                    arm,
                    school_section,
                    academic_year_id,
                    is_active
                `)
                .eq('class_id', class_id)
                .maybeSingle();


            if (classError) {
                return res.status(500).json({
                    message:
                        'Failed to load class',
                    error:
                        classError.message
                });
            }


            if (!classData) {
                return res.status(404).json({
                    message:
                        'Class not found.'
                });
            }


            if (!classData.is_active) {
                return res.status(400).json({
                    message:
                        'Cannot assign a teacher to an inactive class.'
                });
            }


            // ----------------------------------------------------
            // CHECK TEACHER / CLASS SECTOR
            // ----------------------------------------------------

            const teacherSector =
                getSectorFromSchoolSection(
                    teacher.school_section
                );

            const classSector =
                getSectorFromSchoolSection(
                    classData.school_section
                );


            if (!teacherSector || !classSector) {
                return res.status(400).json({
                    message:
                        'Teacher or class has an invalid school section.'
                });
            }


            if (teacherSector !== classSector) {
                return res.status(400).json({
                    message:
                        'A teacher cannot be assigned to a class in another school sector.'
                });
            }


            // ----------------------------------------------------
            // MANAGER SECTOR SECURITY
            // ----------------------------------------------------

            if (getRoleId(req.user) === MANAGER) {

                const managerSector =
                    getSector(req.user);

                if (
                    managerSector !== teacherSector ||
                    managerSector !== classSector
                ) {
                    return res.status(403).json({
                        message:
                            'Access denied. You can only assign teachers within your own school sector.'
                    });
                }
            }


            // ----------------------------------------------------
            // ACADEMIC YEAR
            // ----------------------------------------------------

            let finalAcademicYearId =
                academic_year_id ||
                classData.academic_year_id ||
                null;


            if (!finalAcademicYearId) {

                const {
                    data: currentYear,
                    error: yearError
                } = await supabase
                    .from('academic_years')
                    .select('id')
                    .eq('is_current', true)
                    .maybeSingle();


                if (yearError) {
                    return res.status(500).json({
                        message:
                            'Failed to load current academic year',
                        error:
                            yearError.message
                    });
                }


                if (currentYear) {
                    finalAcademicYearId =
                        currentYear.id;
                }
            }


            // ----------------------------------------------------
            // PREVENT DUPLICATE ASSIGNMENT
            // ----------------------------------------------------

            let duplicateQuery = supabase
                .from('teacher_class_assignments')
                .select('id')
                .eq('teacher_id', teacher_id)
                .eq('class_id', class_id);


            if (finalAcademicYearId) {
                duplicateQuery =
                    duplicateQuery.eq(
                        'academic_year_id',
                        finalAcademicYearId
                    );
            }


            const {
                data: existingAssignment,
                error: duplicateError
            } = await duplicateQuery.maybeSingle();


            if (duplicateError) {
                return res.status(500).json({
                    message:
                        'Failed to check existing assignment',
                    error:
                        duplicateError.message
                });
            }


            if (existingAssignment) {
                return res.status(409).json({
                    message:
                        'This teacher is already assigned to this class.'
                });
            }


            // ----------------------------------------------------
            // CREATE ASSIGNMENT
            // ----------------------------------------------------

            const {
                data,
                error
            } = await supabase
                .from('teacher_class_assignments')
                .insert([{
                    teacher_id,
                    class_id,
                    academic_year_id:
                        finalAcademicYearId,
                    assigned_by:
                        req.user.user_id || null
                }])
                .select()
                .single();


            if (error) {
                console.error(
                    'TEACHER CLASS ASSIGNMENT ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to assign teacher to class',
                    error: error.message
                });
            }


            res.status(201).json({
                message:
                    'Teacher assigned to class successfully.',
                assignment: data
            });

        } catch (error) {

            console.error(
                'ASSIGN CLASS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// PRIMARY CLASS ASSIGNMENTS
// ============================================================

router.get(
    '/primary-class-assignments',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            if (
                getRoleId(req.user) === MANAGER &&
                getSector(req.user) !== 'primary'
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Primary sector only.'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teacher_class_assignments')
                .select(`
                    *,
                    teachers (
                        id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name,
                        teacher_status,
                        school_section
                    ),
                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    )
                `);


            if (error) {
                console.error(
                    'PRIMARY ASSIGNMENTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load primary assignments',
                    error: error.message
                });
            }


            const filtered =
                (data || []).filter(item => {

                    const section =
                        item.classes?.school_section;

                    return PRIMARY_SECTIONS.some(
                        allowed =>
                            normalize(allowed) ===
                            normalize(section)
                    );
                });


            res.json(filtered);

        } catch (error) {

            console.error(
                'PRIMARY ASSIGNMENTS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// SECONDARY ASSIGNMENTS - BULK
// ============================================================

router.get(
    '/secondary-assignments/bulk',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            if (
                getRoleId(req.user) === MANAGER &&
                getSector(req.user) !== 'secondary'
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Secondary sector only.'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teacher_class_assignments')
                .select(`
                    *,
                    teachers (
                        id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name,
                        teacher_status,
                        school_section
                    ),
                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    )
                `);


            if (error) {
                console.error(
                    'SECONDARY BULK ASSIGNMENTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load secondary assignments',
                    error: error.message
                });
            }


            const filtered =
                (data || []).filter(item => {

                    const section =
                        item.classes?.school_section;

                    return SECONDARY_SECTIONS.some(
                        allowed =>
                            normalize(allowed) ===
                            normalize(section)
                    );
                });


            res.json(filtered);

        } catch (error) {

            console.error(
                'SECONDARY BULK ASSIGNMENTS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// SECONDARY ASSIGNMENTS
// ============================================================

router.get(
    '/secondary-assignments',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            if (
                getRoleId(req.user) === MANAGER &&
                getSector(req.user) !== 'secondary'
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Secondary sector only.'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teacher_class_assignments')
                .select(`
                    *,
                    teachers (
                        id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name,
                        teacher_status,
                        school_section
                    ),
                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    )
                `);


            if (error) {
                console.error(
                    'SECONDARY ASSIGNMENTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load secondary assignments',
                    error: error.message
                });
            }


            const filtered =
                (data || []).filter(item => {

                    const section =
                        item.classes?.school_section;

                    return SECONDARY_SECTIONS.some(
                        allowed =>
                            normalize(allowed) ===
                            normalize(section)
                    );
                });


            res.json(filtered);

        } catch (error) {

            console.error(
                'SECONDARY ASSIGNMENTS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// TEACHER'S SECONDARY ASSIGNMENTS
// ============================================================

router.get(
    '/:teacherId/secondary-assignments',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER,
        TEACHER,
        FINANCE
    ),
    async (req, res) => {

        try {

            const teacherId =
                req.params.teacherId;


            const {
                data: teacher,
                error: teacherError
            } = await supabase
                .from('teachers')
                .select(`
                    id,
                    school_section
                `)
                .eq('id', teacherId)
                .maybeSingle();


            if (teacherError) {
                return res.status(500).json({
                    message:
                        'Failed to load teacher',
                    error:
                        teacherError.message
                });
            }


            if (!teacher) {
                return res.status(404).json({
                    message:
                        'Teacher not found.'
                });
            }


            if (
                getRoleId(req.user) === MANAGER &&
                !managerCanAccessSection(
                    req.user,
                    teacher.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Teacher belongs to another school sector.'
                });
            }


            if (
                getRoleId(req.user) === TEACHER &&
                req.user.teacher_id &&
                String(req.user.teacher_id) !==
                String(teacherId)
            ) {
                return res.status(403).json({
                    message:
                        'You can only access your own assignments.'
                });
            }


            if (
                !SECONDARY_SECTIONS.some(
                    section =>
                        normalize(section) ===
                        normalize(teacher.school_section)
                )
            ) {
                return res.json([]);
            }


            const {
                data,
                error
            } = await supabase
                .from('teacher_class_assignments')
                .select(`
                    *,
                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    )
                `)
                .eq('teacher_id', teacherId);


            if (error) {
                console.error(
                    'TEACHER SECONDARY ASSIGNMENTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load teacher assignments',
                    error: error.message
                });
            }


            res.json(data || []);

        } catch (error) {

            console.error(
                'TEACHER SECONDARY ASSIGNMENTS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// ALL ASSIGNMENTS
// ============================================================

router.get(
    '/assignments',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from('teacher_class_assignments')
                .select(`
                    *,
                    teachers (
                        id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name,
                        teacher_status,
                        school_section
                    ),
                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    )
                `);


            if (error) {
                console.error(
                    'ASSIGNMENTS ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load assignments',
                    error: error.message
                });
            }


            let filtered =
                data || [];


            if (
                getRoleId(req.user) === MANAGER
            ) {

                const sector =
                    getSector(req.user);

                const allowedSections =
                    getAllowedSchoolSections(
                        sector
                    );


                filtered =
                    filtered.filter(item =>
                        allowedSections.some(
                            section =>
                                normalize(section) ===
                                normalize(
                                    item.classes?.school_section
                                )
                        )
                    );
            }


            res.json(filtered);

        } catch (error) {

            console.error(
                'ASSIGNMENTS EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// GET ALL TEACHERS
// ============================================================

router.get(
    '/',
    authenticateToken,
    requireRoles(...TEACHER_VIEW_ROLES),
    async (req, res) => {

        try {

            let query = supabase
                .from('teachers')
                .select('*')
                .order('last_name')
                .order('first_name');


            if (
                getRoleId(req.user) === MANAGER
            ) {

                const allowedSections =
                    getAllowedSchoolSections(
                        getSector(req.user)
                    );


                if (!allowedSections.length) {
                    return res.status(403).json({
                        message:
                            'Manager does not have a valid school sector.'
                    });
                }


                query = query.in(
                    'school_section',
                    allowedSections
                );
            }


            const {
                data,
                error
            } = await query;


            if (error) {
                console.error(
                    'TEACHERS GET ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load teachers',
                    error: error.message
                });
            }


            res.json(data || []);

        } catch (error) {

            console.error(
                'TEACHERS GET EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// GET CURRENT LOGGED-IN TEACHER
// IMPORTANT: THIS MUST COME BEFORE /:teacherId
// ============================================================

router.get(
    '/me',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            if (!req.user.teacher_id) {
                return res.status(404).json({
                    message:
                        'No teacher record is linked to this account.'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .select('*')
                .eq('id', req.user.teacher_id)
                .maybeSingle();


            if (error) {
                console.error(
                    'MY TEACHER ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load teacher profile',
                    error: error.message
                });
            }


            if (!data) {
                return res.status(404).json({
                    message:
                        'Teacher profile not found.'
                });
            }


            res.json(data);

        } catch (error) {

            console.error(
                'MY TEACHER EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// CREATE TEACHER
// PROPRIETOR / ADMINISTRATOR / MANAGER
// ============================================================

router.post(
    '/',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const body = req.body;


            if (
                getRoleId(req.user) === MANAGER &&
                !managerCanAccessSection(
                    req.user,
                    body.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. You can only create teachers in your own school sector.'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .insert([body])
                .select()
                .single();


            if (error) {
                console.error(
                    'TEACHER CREATE ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to create teacher',
                    error: error.message
                });
            }


            res.status(201).json({
                message:
                    'Teacher created successfully.',
                teacher: data
            });

        } catch (error) {

            console.error(
                'TEACHER CREATE EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// UPDATE TEACHER
// ============================================================

router.put(
    '/:teacherId',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const teacherId =
                req.params.teacherId;


            const {
                data: existingTeacher,
                error: lookupError
            } = await supabase
                .from('teachers')
                .select('*')
                .eq('id', teacherId)
                .maybeSingle();


            if (lookupError) {
                return res.status(500).json({
                    message:
                        'Failed to load teacher',
                    error:
                        lookupError.message
                });
            }


            if (!existingTeacher) {
                return res.status(404).json({
                    message:
                        'Teacher not found.'
                });
            }


            const roleId =
                getRoleId(req.user);


            if (
                roleId === MANAGER &&
                !managerCanAccessSection(
                    req.user,
                    existingTeacher.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Teacher belongs to another school sector.'
                });
            }


            const updateData = {
                ...req.body
            };


            if (
                roleId === MANAGER &&
                updateData.school_section &&
                !managerCanAccessSection(
                    req.user,
                    updateData.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'You cannot move a teacher into another school sector.'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .update(updateData)
                .eq('id', teacherId)
                .select()
                .single();


            if (error) {
                console.error(
                    'TEACHER UPDATE ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to update teacher',
                    error: error.message
                });
            }


            res.json({
                message:
                    'Teacher updated successfully.',
                teacher: data
            });

        } catch (error) {

            console.error(
                'TEACHER UPDATE EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// DELETE TEACHER
// ============================================================

router.delete(
    '/:teacherId',
    authenticateToken,
    requireRoles(
        PROPRIETOR,
        ADMINISTRATOR,
        MANAGER
    ),
    async (req, res) => {

        try {

            const teacherId =
                req.params.teacherId;


            const {
                data: teacher,
                error: lookupError
            } = await supabase
                .from('teachers')
                .select(`
                    id,
                    school_section
                `)
                .eq('id', teacherId)
                .maybeSingle();


            if (lookupError) {
                return res.status(500).json({
                    message:
                        'Failed to load teacher',
                    error:
                        lookupError.message
                });
            }


            if (!teacher) {
                return res.status(404).json({
                    message:
                        'Teacher not found.'
                });
            }


            if (
                getRoleId(req.user) === MANAGER &&
                !managerCanAccessSection(
                    req.user,
                    teacher.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Teacher belongs to another school sector.'
                });
            }


            const {
                error
            } = await supabase
                .from('teachers')
                .delete()
                .eq('id', teacherId);


            if (error) {
                console.error(
                    'TEACHER DELETE ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to delete teacher',
                    error: error.message
                });
            }


            res.json({
                message:
                    'Teacher deleted successfully.'
            });

        } catch (error) {

            console.error(
                'TEACHER DELETE EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// GET SINGLE TEACHER
// IMPORTANT: THIS IS AFTER /me AND OTHER NAMED ROUTES
// ============================================================

router.get(
    '/:teacherId',
    authenticateToken,
    requireRoles(...TEACHER_VIEW_ROLES),
    async (req, res) => {

        try {

            const teacherId =
                req.params.teacherId;


            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .select('*')
                .eq('id', teacherId)
                .maybeSingle();


            if (error) {
                console.error(
                    'SINGLE TEACHER ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load teacher',
                    error: error.message
                });
            }


            if (!data) {
                return res.status(404).json({
                    message:
                        'Teacher not found.'
                });
            }


            if (
                getRoleId(req.user) === MANAGER &&
                !managerCanAccessSection(
                    req.user,
                    data.school_section
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. Teacher belongs to another school sector.'
                });
            }


            res.json(data);

        } catch (error) {

            console.error(
                'SINGLE TEACHER EXCEPTION:',
                error
            );

            res.status(500).json({
                message: 'Server error'
            });
        }
    }
);


// ============================================================
// EXPORT ROUTER
// ============================================================

module.exports = router;