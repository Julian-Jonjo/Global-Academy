const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireTeacher,
    requireRoles
} = require('../middleware/authMiddleware');


const router = express.Router();


// ============================================================
// ROLE PERMISSIONS
// ============================================================

// Roles allowed to manage teachers and teaching assignments
const MANAGEMENT_ROLES = [
    'Proprietor',
    'Administrator',
    'Manager'
];

// Teacher role
const TEACHER_ROLE = 'Teacher';


// ============================================================
// CURRENT ACADEMIC YEAR
// ============================================================

router.get(
    '/academic-year/current',
    authenticateToken,
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from('academic_years')
                .select('*')
                .eq('is_current', true)
                .single();

            if (error) {
                throw error;
            }

            res.json(data);

        } catch (error) {

            console.error(
                'Error loading current academic year:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load current academic year'
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

            const {
                data,
                error
            } = await supabase
                .from('departments')
                .select(`
                    department_id,
                    department_name,
                    description,
                    is_active
                `)
                .eq('is_active', true)
                .order('department_name');

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading departments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load departments'
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

            const {
                data,
                error
            } = await supabase
                .from('subjects')
                .select(`
                    subject_id,
                    subject_code,
                    subject_name,
                    school_level,
                    department_id,
                    is_active
                `)
                .eq('is_active', true)
                .order('school_level')
                .order('subject_name');

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading subjects:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load subjects'
            });
        }
    }
);


// ============================================================
// ALL ACTIVE CLASSES
// ============================================================
// Supports BOTH Primary and Secondary teachers.
// ============================================================

router.get(
    '/data/classes',
    authenticateToken,
    async (req, res) => {

        try {

            const {
                data,
                error
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
                .eq('is_active', true)
                .order('school_section')
                .order('class_name')
                .order('arm');

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading classes:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load classes'
            });
        }
    }
);


// ============================================================
// SECONDARY CLASSES
// ============================================================

router.get(
    '/data/secondary-classes',
    authenticateToken,
    async (req, res) => {

        try {

            const {
                data,
                error
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
                .eq('school_section', 'Secondary')
                .eq('is_active', true)
                .order('class_name')
                .order('arm');

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading secondary classes:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load secondary classes'
            });
        }
    }
);


// ============================================================
// GET HEADS OF DEPARTMENT
// ============================================================

router.get(
    '/department-heads',
    authenticateToken,
    async (req, res) => {

        try {

            const academicYearId =
                Number(req.query.academic_year_id);

            if (!Number.isInteger(academicYearId)) {

                return res.status(400).json({
                    message:
                        'Academic year ID is required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('department_heads')
                .select(`
                    department_head_id,
                    department_id,
                    teacher_id,
                    academic_year_id,
                    assigned_date,

                    departments (
                        department_id,
                        department_name
                    ),

                    teachers (
                        teacher_id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name
                    )
                `)
                .eq(
                    'academic_year_id',
                    academicYearId
                );

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading department heads:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load department heads'
            });
        }
    }
);


// ============================================================
// ASSIGN HEAD OF DEPARTMENT
// ============================================================

router.post(
    '/department-heads',
    authenticateToken,
    requireRoles(...MANAGEMENT_ROLES),
    async (req, res) => {

        try {

            const {
                department_id,
                teacher_id,
                academic_year_id
            } = req.body;

            if (
                !department_id ||
                !teacher_id ||
                !academic_year_id
            ) {

                return res.status(400).json({
                    message:
                        'Department, teacher and academic year are required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('department_heads')
                .insert([{
                    department_id,
                    teacher_id,
                    academic_year_id
                }])
                .select()
                .single();

            if (error) {
                throw error;
            }

            res.status(201).json({
                message:
                    'Head of Department assigned successfully',
                assignment: data
            });

        } catch (error) {

            console.error(
                'Error assigning HOD:',
                error
            );

            if (error.code === '23505') {

                return res.status(409).json({
                    message:
                        'This department already has a Head of Department for this academic year'
                });
            }

            res.status(500).json({
                message:
                    'Failed to assign Head of Department'
            });
        }
    }
);


// ============================================================
// GET SECONDARY CLASS MASTERS
// ============================================================

router.get(
    '/secondary/class-masters',
    authenticateToken,
    async (req, res) => {

        try {

            const academicYearId =
                Number(req.query.academic_year_id);

            if (!Number.isInteger(academicYearId)) {

                return res.status(400).json({
                    message:
                        'Academic year ID is required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('secondary_class_masters')
                .select(`
                    assignment_id,
                    class_id,
                    teacher_id,
                    academic_year_id,
                    assigned_date,

                    classes (
                        class_name,
                        arm
                    ),

                    teachers (
                        teacher_id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name
                    )
                `)
                .eq(
                    'academic_year_id',
                    academicYearId
                );

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading class masters:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load class masters'
            });
        }
    }
);


// ============================================================
// ASSIGN SECONDARY CLASS MASTER
// ============================================================

router.post(
    '/secondary/class-masters',
    authenticateToken,
    requireRoles(...MANAGEMENT_ROLES),
    async (req, res) => {

        try {

            const {
                class_id,
                teacher_id,
                academic_year_id
            } = req.body;

            if (
                !class_id ||
                !teacher_id ||
                !academic_year_id
            ) {

                return res.status(400).json({
                    message:
                        'Class, teacher and academic year are required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('secondary_class_masters')
                .insert([{
                    class_id,
                    teacher_id,
                    academic_year_id
                }])
                .select()
                .single();

            if (error) {
                throw error;
            }

            res.status(201).json({
                message:
                    'Class master assigned successfully',
                assignment: data
            });

        } catch (error) {

            console.error(
                'Error assigning class master:',
                error
            );

            if (error.code === '23505') {

                return res.status(409).json({
                    message:
                        'This class already has a class master for this academic year'
                });
            }

            res.status(500).json({
                message:
                    'Failed to assign class master'
            });
        }
    }
);


// ============================================================
// GET ALL TEACHER ASSIGNMENTS
// ============================================================
// Returns BOTH Primary and Secondary assignments.
// ============================================================

router.get(
    '/assignments',
    authenticateToken,
    async (req, res) => {

        try {

            const academicYearId =
                Number(req.query.academic_year_id);

            if (!Number.isInteger(academicYearId)) {

                return res.status(400).json({
                    message:
                        'Academic year ID is required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('class_subjects')
                .select(`
                    class_subject_id,
                    class_id,
                    subject_id,
                    teacher_id,
                    academic_year_id,
                    created_at,

                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_id,
                        subject_code,
                        subject_name,
                        school_level,
                        department_id,

                        departments (
                            department_id,
                            department_name
                        )
                    ),

                    teachers (
                        teacher_id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name
                    )
                `)
                .eq(
                    'academic_year_id',
                    academicYearId
                );

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading teacher assignments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load teacher assignments'
            });
        }
    }
);


// ============================================================
// GET ALL SECONDARY TEACHER ASSIGNMENTS
// ============================================================

router.get(
    '/secondary-assignments',
    authenticateToken,
    async (req, res) => {

        try {

            const academicYearId =
                Number(req.query.academic_year_id);

            if (!Number.isInteger(academicYearId)) {

                return res.status(400).json({
                    message:
                        'Academic year ID is required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('class_subjects')
                .select(`
                    class_subject_id,
                    class_id,
                    subject_id,
                    teacher_id,
                    academic_year_id,
                    created_at,

                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_id,
                        subject_code,
                        subject_name,
                        school_level,

                        departments (
                            department_id,
                            department_name
                        )
                    ),

                    teachers (
                        teacher_id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name
                    )
                `)
                .eq(
                    'academic_year_id',
                    academicYearId
                );

            if (error) {
                throw error;
            }

            const secondaryAssignments =
                (data || []).filter(
                    item =>
                        item.classes?.school_section ===
                        'Secondary'
                );

            res.json(secondaryAssignments);

        } catch (error) {

            console.error(
                'Error loading secondary teacher assignments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load secondary teacher assignments'
            });
        }
    }
);


// ============================================================
// GET CURRENT LOGGED-IN TEACHER PROFILE
// ============================================================
// IMPORTANT:
// Uses users.teacher_id from JWT.
// This supports both Primary and Secondary teachers.
// ============================================================

router.get(
    '/me/profile',
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.role_name !==
                TEACHER_ROLE
            ) {

                return res.status(403).json({
                    message:
                        'This endpoint is available to teachers only'
                });
            }

            const teacherId =
                Number(req.user.teacher_id);

            if (!Number.isInteger(teacherId)) {

                return res.status(400).json({
                    message:
                        'Your account is not linked to a teacher profile'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .select(`
                    teacher_id,
                    staff_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    phone,
                    email,
                    address,
                    employment_date,
                    teacher_status,
                    photo_url,
                    school_section,
                    employment_type
                `)
                .eq(
                    'teacher_id',
                    teacherId
                )
                .single();

            if (error) {
                throw error;
            }

            if (!data) {

                return res.status(404).json({
                    message:
                        'No teacher profile is linked to this account'
                });
            }

            res.json(data);

        } catch (error) {

            console.error(
                'Error loading current teacher profile:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load your teacher profile'
            });
        }
    }
);


// ============================================================
// GET CURRENT TEACHER'S ALL ASSIGNMENTS
// ============================================================
// IMPORTANT:
// No Secondary filter here.
// A teacher can now be Primary OR Secondary.
// ============================================================

router.get(
    '/me/assignments',
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.role_name !==
                TEACHER_ROLE
            ) {

                return res.status(403).json({
                    message:
                        'This endpoint is available to teachers only'
                });
            }

            const teacherId =
                Number(req.user.teacher_id);

            if (!Number.isInteger(teacherId)) {

                return res.status(400).json({
                    message:
                        'Your account is not linked to a teacher profile'
                });
            }


            // ----------------------------------------------------
            // CURRENT ACADEMIC YEAR
            // ----------------------------------------------------

            const {
                data: academicYear,
                error: academicYearError
            } = await supabase
                .from('academic_years')
                .select('*')
                .eq('is_current', true)
                .single();

            if (academicYearError) {
                throw academicYearError;
            }


            // ----------------------------------------------------
            // TEACHER PROFILE
            // ----------------------------------------------------

            const {
                data: teacher,
                error: teacherError
            } = await supabase
                .from('teachers')
                .select(`
                    teacher_id,
                    staff_number,
                    first_name,
                    middle_name,
                    last_name,
                    email,
                    phone,
                    school_section,
                    employment_type,
                    teacher_status,
                    photo_url
                `)
                .eq(
                    'teacher_id',
                    teacherId
                )
                .single();

            if (teacherError) {
                throw teacherError;
            }


            // ----------------------------------------------------
            // ALL CURRENT ASSIGNMENTS
            // ----------------------------------------------------

            const {
                data: assignments,
                error: assignmentsError
            } = await supabase
                .from('class_subjects')
                .select(`
                    class_subject_id,
                    class_id,
                    subject_id,
                    teacher_id,
                    academic_year_id,
                    created_at,

                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_id,
                        subject_code,
                        subject_name,
                        school_level,

                        departments (
                            department_id,
                            department_name
                        )
                    )
                `)
                .eq(
                    'teacher_id',
                    teacherId
                )
                .eq(
                    'academic_year_id',
                    academicYear.academic_year_id
                );

            if (assignmentsError) {
                throw assignmentsError;
            }


            res.json({

                teacher,

                academic_year:
                    academicYear,

                assignments:
                    assignments || []

            });

        } catch (error) {

            console.error(
                'Error loading current teacher assignments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load your teaching assignments'
            });
        }
    }
);


// ============================================================
// BACKWARD-COMPATIBLE SECONDARY TEACHER ENDPOINT
// ============================================================
// Kept so your existing Secondary dashboard does not break.
// ============================================================

router.get(
    '/me/secondary-assignments',
    authenticateToken,
    async (req, res) => {

        try {

            if (
                req.user.role_name !==
                TEACHER_ROLE
            ) {

                return res.status(403).json({
                    message:
                        'This endpoint is available to teachers only'
                });
            }

            const teacherId =
                Number(req.user.teacher_id);

            if (!Number.isInteger(teacherId)) {

                return res.status(400).json({
                    message:
                        'Your account is not linked to a teacher profile'
                });
            }


            // ----------------------------------------------------
            // CURRENT ACADEMIC YEAR
            // ----------------------------------------------------

            const {
                data: academicYear,
                error: academicYearError
            } = await supabase
                .from('academic_years')
                .select('*')
                .eq('is_current', true)
                .single();

            if (academicYearError) {
                throw academicYearError;
            }


            // ----------------------------------------------------
            // TEACHER
            // ----------------------------------------------------

            const {
                data: teacher,
                error: teacherError
            } = await supabase
                .from('teachers')
                .select(`
                    teacher_id,
                    staff_number,
                    first_name,
                    middle_name,
                    last_name,
                    email,
                    phone,
                    school_section,
                    employment_type,
                    teacher_status,
                    photo_url
                `)
                .eq(
                    'teacher_id',
                    teacherId
                )
                .single();

            if (teacherError) {
                throw teacherError;
            }


            // ----------------------------------------------------
            // SECONDARY ASSIGNMENTS ONLY
            // ----------------------------------------------------

            const {
                data,
                error
            } = await supabase
                .from('class_subjects')
                .select(`
                    class_subject_id,
                    class_id,
                    subject_id,
                    teacher_id,
                    academic_year_id,
                    created_at,

                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_id,
                        subject_code,
                        subject_name,
                        school_level,

                        departments (
                            department_id,
                            department_name
                        )
                    )
                `)
                .eq(
                    'teacher_id',
                    teacherId
                )
                .eq(
                    'academic_year_id',
                    academicYear.academic_year_id
                );

            if (error) {
                throw error;
            }

            const assignments =
                (data || []).filter(
                    item =>
                        item.classes?.school_section ===
                        'Secondary'
                );

            res.json({
                teacher,
                academic_year: academicYear,
                assignments
            });

        } catch (error) {

            console.error(
                'Error loading current secondary teacher assignments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load your secondary teaching assignments'
            });
        }
    }
);


// ============================================================
// SCHOOL TEACHER DIRECTORY
// ============================================================

router.get(
    '/directory',
    authenticateToken,
    async (req, res) => {

        try {
            const currentTeacherId = req.user.teacher_id;
            
            console.log('🔍 Current teacher ID:', currentTeacherId);

            // Get all active teachers
            let query = supabase
                .from('teachers')
                .select(`
                    teacher_id,
                    staff_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    phone,
                    email,
                    teacher_status,
                    school_section,
                    employment_type,
                    photo_url
                `)
                .eq('teacher_status', 'Active')
                .order('last_name')
                .order('first_name');

            // Only exclude current teacher if there are other teachers
            const { data: allTeachers, error: countError } = await supabase
                .from('teachers')
                .select('teacher_id', { count: 'exact' })
                .eq('teacher_status', 'Active');

            if (!countError && allTeachers.length > 1) {
                query = query.neq('teacher_id', currentTeacherId);
            }

            const { data, error } = await query;

            if (error) {
                throw error;
            }

            console.log('🔍 Teachers found:', data?.length || 0);

            res.json({
                success: true,
                teachers: data || [],
                section: req.user.school_section || 'Secondary'
            });

        } catch (error) {
            console.error('Error loading teacher directory:', error);
            res.status(500).json({
                message: 'Failed to load teacher directory'
            });
        }
    }
);

// ============================================================
// SCHOOL TEACHER DIRECTORY WITH ASSIGNMENTS
// ============================================================

router.get(
    '/directory/assignments',
    authenticateToken,
    async (req, res) => {

        try {

            // ----------------------------------------------------
            // CURRENT ACADEMIC YEAR
            // ----------------------------------------------------

            const {
                data: academicYear,
                error: yearError
            } = await supabase
                .from('academic_years')
                .select('*')
                .eq('is_current', true)
                .single();

            if (yearError) {
                throw yearError;
            }


            // ----------------------------------------------------
            // TEACHERS
            // ----------------------------------------------------

            const {
                data: teachersData,
                error: teachersError
            } = await supabase
                .from('teachers')
                .select(`
                    teacher_id,
                    staff_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    phone,
                    email,
                    teacher_status,
                    school_section,
                    employment_type,
                    photo_url
                `)
                .eq(
                    'teacher_status',
                    'Active'
                )
                .order('last_name')
                .order('first_name');

            if (teachersError) {
                throw teachersError;
            }


            // ----------------------------------------------------
            // CURRENT ASSIGNMENTS
            // ----------------------------------------------------

            const {
                data: assignments,
                error: assignmentsError
            } = await supabase
                .from('class_subjects')
                .select(`
                    class_subject_id,
                    class_id,
                    subject_id,
                    teacher_id,
                    academic_year_id,

                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_id,
                        subject_code,
                        subject_name,
                        school_level,

                        departments (
                            department_id,
                            department_name
                        )
                    )
                `)
                .eq(
                    'academic_year_id',
                    academicYear.academic_year_id
                );

            if (assignmentsError) {
                throw assignmentsError;
            }


            // ----------------------------------------------------
            // ATTACH ASSIGNMENTS TO EACH TEACHER
            // ----------------------------------------------------

            const result =
                (teachersData || []).map(
                    teacher => {

                        const teacherAssignments =
                            (assignments || [])
                                .filter(
                                    assignment =>
                                        assignment.teacher_id ===
                                        teacher.teacher_id
                                );

                        return {
                            ...teacher,

                            assignments:
                                teacherAssignments
                        };

                    }
                );


            res.json({
                academic_year:
                    academicYear,

                teachers:
                    result
            });

        } catch (error) {

            console.error(
                'Error loading teacher directory with assignments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load teacher directory and assignments'
            });
        }
    }
);


// ============================================================
// GET ALL SECONDARY ASSIGNMENTS FOR ALL TEACHERS (BULK)
// ============================================================

router.get(
    '/secondary-assignments/bulk',
    authenticateToken,
    async (req, res) => {

        try {

            const academicYearId =
                Number(req.query.academic_year_id);

            if (!Number.isInteger(academicYearId)) {

                return res.status(400).json({
                    message:
                        'Academic year ID is required'
                });
            }

            const { data, error } = await supabase
                .from('class_subjects')
                .select(`
                    class_subject_id,
                    class_id,
                    subject_id,
                    teacher_id,
                    academic_year_id,

                    classes (
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_id,
                        subject_code,
                        subject_name,
                        school_level,

                        departments (
                            department_id,
                            department_name
                        )
                    )
                `)
                .eq('academic_year_id', academicYearId);

            if (error) {
                throw error;
            }

            // Filter to Secondary only
            const secondaryAssignments =
                (data || []).filter(
                    item =>
                        item.classes?.school_section === 'Secondary'
                );

            res.json(secondaryAssignments);

        } catch (error) {

            console.error(
                'Error loading bulk secondary assignments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load secondary assignments'
            });
        }
    }
);

// ============================================================
// BACKWARD-COMPATIBLE SECONDARY ASSIGNMENTS
// ============================================================

router.get(
    '/:teacherId/secondary-assignments',
    authenticateToken,
    async (req, res) => {

        try {

            const teacherId =
                Number(req.params.teacherId);

            const academicYearId =
                Number(req.query.academic_year_id);

            if (
                !Number.isInteger(teacherId) ||
                !Number.isInteger(academicYearId)
            ) {

                return res.status(400).json({
                    message:
                        'Teacher ID and academic year ID are required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('class_subjects')
                .select(`
                    class_subject_id,
                    class_id,
                    subject_id,
                    teacher_id,
                    academic_year_id,

                    classes (
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_code,
                        subject_name,
                        school_level
                    )
                `)
                .eq(
                    'teacher_id',
                    teacherId
                )
                .eq(
                    'academic_year_id',
                    academicYearId
                );

            if (error) {
                throw error;
            }

            const secondary =
                (data || []).filter(
                    item =>
                        item.classes?.school_section ===
                        'Secondary'
                );

            res.json(secondary);

        } catch (error) {

            console.error(
                'Error loading secondary teacher assignments:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load teacher assignments'
            });
        }
    }
);


// ============================================================
// ASSIGN TEACHER TO CLASS + SUBJECT
// ============================================================
// Supports BOTH Primary and Secondary.
// ============================================================

router.post(
    '/assignments',
    authenticateToken,
    requireRoles(...MANAGEMENT_ROLES),
    async (req, res) => {

        try {

            const {
                teacher_id,
                class_id,
                subject_id,
                academic_year_id
            } = req.body;

            if (
                !teacher_id ||
                !class_id ||
                !subject_id ||
                !academic_year_id
            ) {

                return res.status(400).json({
                    message:
                        'Teacher, class, subject and academic year are required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('class_subjects')
                .insert([{
                    teacher_id,
                    class_id,
                    subject_id,
                    academic_year_id
                }])
                .select(`
                    *,

                    classes (
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_code,
                        subject_name,
                        school_level,

                        departments (
                            department_id,
                            department_name
                        )
                    )
                `)
                .single();

            if (error) {
                throw error;
            }

            res.status(201).json({
                message:
                    'Teacher assigned successfully',

                assignment:
                    data
            });

        } catch (error) {

            console.error(
                'Error assigning teacher:',
                error
            );

            if (error.code === '23505') {

                return res.status(409).json({
                    message:
                        'This teacher is already assigned to this subject and class for this academic year'
                });
            }

            res.status(500).json({
                message:
                    'Failed to assign teacher'
            });
        }
    }
);


// ============================================================
// BACKWARD-COMPATIBLE SECONDARY ASSIGNMENT ROUTE
// ============================================================

router.post(
    '/secondary-assignments',
    authenticateToken,
    requireRoles(...MANAGEMENT_ROLES),
    async (req, res) => {

        try {

            const {
                teacher_id,
                class_id,
                subject_id,
                academic_year_id
            } = req.body;

            if (
                !teacher_id ||
                !class_id ||
                !subject_id ||
                !academic_year_id
            ) {

                return res.status(400).json({
                    message:
                        'Teacher, class, subject and academic year are required'
                });
            }

            const {
                data,
                error
            } = await supabase
                .from('class_subjects')
                .insert([{
                    teacher_id,
                    class_id,
                    subject_id,
                    academic_year_id
                }])
                .select(`
                    *,

                    classes (
                        class_name,
                        arm,
                        school_section
                    ),

                    subjects (
                        subject_code,
                        subject_name
                    )
                `)
                .single();

            if (error) {
                throw error;
            }

            res.status(201).json({
                message:
                    'Teacher assigned successfully',

                assignment:
                    data
            });

        } catch (error) {

            console.error(
                'Error assigning secondary teacher:',
                error
            );

            if (error.code === '23505') {

                return res.status(409).json({
                    message:
                        'This teacher is already assigned to this subject and class for this academic year'
                });
            }

            res.status(500).json({
                message:
                    'Failed to assign teacher'
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
    async (req, res) => {

        try {

            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .select(`
                    teacher_id,
                    staff_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    phone,
                    email,
                    address,
                    employment_date,
                    teacher_status,
                    photo_url,
                    school_section,
                    employment_type
                `)
                .order('last_name')
                .order('first_name');

            if (error) {
                throw error;
            }

            res.json(data || []);

        } catch (error) {

            console.error(
                'Error loading teachers:',
                error
            );

            res.status(500).json({
                message:
                    'Failed to load teachers'
            });
        }
    }
);


// ============================================================
// REGISTER TEACHER
// ============================================================

router.post(
    '/',
    authenticateToken,
    requireRoles(...MANAGEMENT_ROLES),
    async (req, res) => {

        try {

            const {
                staff_number,
                first_name,
                middle_name,
                last_name,
                gender,
                phone,
                email,
                address,
                employment_date,
                teacher_status,
                photo_url,
                school_section,
                employment_type
            } = req.body;


            if (
                !staff_number ||
                !first_name ||
                !last_name
            ) {

                return res.status(400).json({
                    message:
                        'Staff number, first name and last name are required'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .insert([{

                    staff_number,

                    first_name,

                    middle_name:
                        middle_name || null,

                    last_name,

                    gender:
                        gender || null,

                    phone:
                        phone || null,

                    email:
                        email || null,

                    address:
                        address || null,

                    employment_date:
                        employment_date || null,

                    teacher_status:
                        teacher_status || 'Active',

                    photo_url:
                        photo_url || null,

                    school_section:
                        school_section || null,

                    employment_type:
                        employment_type || null

                }])
                .select()
                .single();


            if (error) {
                throw error;
            }


            res.status(201).json({

                message:
                    'Teacher registered successfully',

                teacher:
                    data

            });

        } catch (error) {

            console.error(
                'Error registering teacher:',
                error
            );


            if (error.code === '23505') {

                return res.status(409).json({
                    message:
                        'A teacher with this staff number already exists'
                });
            }


            res.status(500).json({
                message:
                    'Failed to register teacher'
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
    requireRoles(...MANAGEMENT_ROLES),
    async (req, res) => {

        try {

            const teacherId =
                Number(req.params.teacherId);


            if (!Number.isInteger(teacherId)) {

                return res.status(400).json({
                    message:
                        'Invalid teacher ID'
                });
            }


            const allowedFields = [

                'staff_number',
                'first_name',
                'middle_name',
                'last_name',
                'gender',
                'phone',
                'email',
                'address',
                'employment_date',
                'teacher_status',
                'photo_url',
                'school_section',
                'employment_type'

            ];


            const updateData = {};


            allowedFields.forEach(
                field => {

                    if (
                        Object.prototype.hasOwnProperty.call(
                            req.body,
                            field
                        )
                    ) {

                        updateData[field] =
                            req.body[field];

                    }

                }
            );


            if (
                !Object.keys(updateData).length
            ) {

                return res.status(400).json({
                    message:
                        'No valid fields supplied for update'
                });
            }


            const {
                data,
                error
            } = await supabase
                .from('teachers')
                .update(updateData)
                .eq(
                    'teacher_id',
                    teacherId
                )
                .select()
                .single();


            if (error) {
                throw error;
            }


            res.json({

                message:
                    'Teacher updated successfully',

                teacher:
                    data

            });

        } catch (error) {

            console.error(
                'Error updating teacher:',
                error
            );


            if (error.code === '23505') {

                return res.status(409).json({
                    message:
                        'A teacher with this staff number already exists'
                });
            }


            res.status(500).json({
                message:
                    'Failed to update teacher'
            });
        }
    }
);


// ============================================================
// GET CURRENT TEACHER PROFILE (/me)
// ============================================================
router.get(
    '/me',
    authenticateToken,
    requireTeacher,
    async (req, res) => {
        try {
            console.log('🔍 /me route called');
            const teacherId = req.user.teacher_id;
            console.log('🔍 teacher_id from token:', teacherId);

            if (!teacherId) {
                return res.status(400).json({
                    message: 'Invalid teacher ID'
                });
            }

            const { data: teacher, error: teacherError } =
                await supabase
                    .from('teachers')
                    .select(`
                        teacher_id,
                        staff_number,
                        first_name,
                        middle_name,
                        last_name,
                        gender,
                        phone,
                        email,
                        address,
                        employment_date,
                        teacher_status,
                        photo_url,
                        school_section,
                        employment_type
                    `)
                    .eq('teacher_id', teacherId)
                    .single();

            if (teacherError || !teacher) {
                console.log('❌ Teacher error:', teacherError);
                return res.status(404).json({
                    message: 'Teacher record not found'
                });
            }

            const { data: user, error: userError } =
                await supabase
                    .from('users')
                    .select(`
                        user_id,
                        username,
                        full_name,
                        role_id,
                        user_roles (
                            role_name
                        )
                    `)
                    .eq('user_id', req.user.user_id)
                    .single();

            res.json({
                user: {
                    user_id: user?.user_id || req.user.user_id,
                    username: user?.username || req.user.username,
                    full_name: user?.full_name || req.user.full_name,
                    teacher_id: teacherId,
                    role_id: user?.role_id || req.user.role_id,
                    role_name: user?.user_roles?.role_name || req.user.role_name || 'Teacher'
                },
                teacher
            });

        } catch (error) {
            console.error('Error loading teacher profile:', error);
            res.status(500).json({
                message: 'Failed to load teacher profile'
            });
        }
    }
);


// ============================================================
// GET SINGLE TEACHER (/:teacherId) - MUST BE LAST
// ============================================================
router.get(
    '/:teacherId',
    authenticateToken,
    async (req, res) => {
        try {
            const teacherId = Number(req.params.teacherId);

            if (!Number.isInteger(teacherId)) {
                return res.status(400).json({
                    message: 'Invalid teacher ID'
                });
            }

            const { data, error } = await supabase
                .from('teachers')
                .select(`
                    teacher_id,
                    staff_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    phone,
                    email,
                    address,
                    employment_date,
                    teacher_status,
                    photo_url,
                    school_section,
                    employment_type
                `)
                .eq('teacher_id', teacherId)
                .single();

            if (error || !data) {
                return res.status(404).json({
                    message: 'Teacher not found'
                });
            }

            res.json(data);

        } catch (error) {
            console.error('Error loading teacher:', error);
            res.status(500).json({
                message: 'Failed to load teacher'
            });
        }
    }
);


module.exports = router;