const express = require('express');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireTeacher
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// TEACHER PROFILE
// ============================================================

router.get(
    '/me',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            const userId = req.user.user_id;

            const { data: user, error: userError } =
                await supabase
                    .from('users')
                    .select(`
                        user_id,
                        username,
                        full_name,
                        teacher_id,
                        role_id,

                        user_roles (
                            role_name
                        )
                    `)
                    .eq('user_id', userId)
                    .single();


            if (userError || !user) {

                return res.status(404).json({
                    message: 'Teacher account not found'
                });

            }


            if (!user.teacher_id) {

                return res.status(400).json({
                    message:
                        'This teacher account is not linked to a teacher record'
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
                    .eq('teacher_id', user.teacher_id)
                    .single();


            if (teacherError || !teacher) {

                return res.status(404).json({
                    message: 'Teacher record not found'
                });

            }


            res.json({

                user: {
                    user_id: user.user_id,
                    username: user.username,
                    full_name: user.full_name,
                    teacher_id: user.teacher_id,
                    role_id: user.role_id,

                    role_name:
                        user.user_roles?.role_name ||
                        'Teacher'
                },

                teacher

            });


        } catch (error) {

            console.error(
                'Error loading teacher profile:',
                error
            );


            res.status(500).json({
                message:
                    'Failed to load teacher profile'
            });

        }

    }
);


// ============================================================
// TEACHER PROFILE
//
// Frontend-friendly route:
// /teachers/me/profile
//
// Returns the teacher record directly.
// ============================================================

router.get(
    '/me/profile',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            const userId = req.user.user_id;

            const { data: user, error: userError } =
                await supabase
                    .from('users')
                    .select(`
                        user_id,
                        teacher_id,
                        full_name,

                        user_roles (
                            role_name
                        )
                    `)
                    .eq('user_id', userId)
                    .single();


            if (userError || !user) {

                return res.status(404).json({
                    message: 'Teacher account not found'
                });

            }


            if (!user.teacher_id) {

                return res.status(400).json({
                    message:
                        'This teacher account is not linked to a teacher record'
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
                    .eq('teacher_id', user.teacher_id)
                    .single();


            if (teacherError || !teacher) {

                return res.status(404).json({
                    message: 'Teacher record not found'
                });

            }


            res.json(teacher);


        } catch (error) {

            console.error(
                'Error loading teacher profile:',
                error
            );


            res.status(500).json({
                message:
                    'Failed to load teacher profile'
            });

        }

    }
);


// ============================================================
// ALL ACTIVE TEACHERS DIRECTORY
// ============================================================

router.get(
    '/teachers',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            const { data, error } =
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
                        photo_url,
                        school_section,
                        employment_type
                    `)
                    .eq('teacher_status', 'Active')
                    .order('last_name')
                    .order('first_name');


            if (error) {
                throw error;
            }


            res.json(data || []);


        } catch (error) {

            console.error(
                'Error loading teacher directory:',
                error
            );


            res.status(500).json({
                message:
                    'Failed to load teacher directory'
            });

        }

    }
);


// ============================================================
// CURRENT ACADEMIC YEAR
// ============================================================

router.get(
    '/academic-year/current',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            const { data, error } =
                await supabase
                    .from('academic_years')
                    .select(`
                        academic_year_id,
                        year_name,
                        start_date,
                        end_date,
                        is_current
                    `)
                    .eq('is_current', true)
                    .single();


            if (error) {
                throw error;
            }


            res.json(data);


        } catch (error) {

            console.error(
                'Error loading teacher academic year:',
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
// LOGGED-IN TEACHER ASSIGNMENTS
//
// IMPORTANT:
// This now returns BOTH PRIMARY and SECONDARY assignments.
//
// Optional:
// /teachers/assignments?academic_year_id=1
// ============================================================

router.get(
    '/assignments',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            const teacherId =
                Number(req.user.teacher_id);


            if (!Number.isInteger(teacherId)) {

                return res.status(400).json({
                    message:
                        'Teacher account is not linked to a valid teacher'
                });

            }


            let academicYearId =
                Number(req.query.academic_year_id);


            /*
             * If academic_year_id was not supplied,
             * automatically use the current academic year.
             */

            if (!Number.isInteger(academicYearId)) {

                const {
                    data: currentYear,
                    error: yearError
                } =
                    await supabase
                        .from('academic_years')
                        .select(`
                            academic_year_id,
                            year_name,
                            start_date,
                            end_date,
                            is_current
                        `)
                        .eq('is_current', true)
                        .single();


                if (yearError || !currentYear) {

                    return res.status(404).json({
                        message:
                            'Current academic year not found'
                    });

                }


                academicYearId =
                    Number(
                        currentYear.academic_year_id
                    );

            }


            /*
             * Load academic year information.
             */

            const {
                data: academicYear,
                error: academicYearError
            } =
                await supabase
                    .from('academic_years')
                    .select(`
                        academic_year_id,
                        year_name,
                        start_date,
                        end_date,
                        is_current
                    `)
                    .eq(
                        'academic_year_id',
                        academicYearId
                    )
                    .single();


            if (
                academicYearError ||
                !academicYear
            ) {

                return res.status(404).json({
                    message:
                        'Academic year not found'
                });

            }


            /*
             * Load ALL assignments belonging to
             * the logged-in teacher.
             *
             * No Secondary-only filter here.
             */

            const { data, error } =
                await supabase
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


            /*
             * Keep only assignments with a valid
             * class and recognized school section.
             *
             * Both Primary and Secondary are allowed.
             */

            const assignments =
                (data || []).filter(item => {

                    const section =
                        item.classes?.school_section;

                    return (
                        section === 'Primary' ||
                        section === 'Secondary'
                    );

                });


            res.json({

                academic_year:
                    academicYear,

                assignments

            });


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
// TEACHER ASSIGNMENTS
//
// Frontend-friendly route:
//
// /teachers/me/secondary-assignments
//
// The route name is retained for compatibility with the
// current frontend, but it now returns BOTH Primary and
// Secondary assignments.
//
// We can rename the endpoint later, but there is no need
// to break the existing frontend right now.
// ============================================================

router.get(
    '/me/secondary-assignments',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            const teacherId =
                Number(req.user.teacher_id);


            if (!Number.isInteger(teacherId)) {

                return res.status(400).json({
                    message:
                        'Teacher account is not linked to a valid teacher'
                });

            }


            /*
             * Find current academic year.
             */

            const {
                data: academicYear,
                error: academicYearError
            } =
                await supabase
                    .from('academic_years')
                    .select(`
                        academic_year_id,
                        year_name,
                        start_date,
                        end_date,
                        is_current
                    `)
                    .eq('is_current', true)
                    .single();


            if (
                academicYearError ||
                !academicYear
            ) {

                return res.status(404).json({
                    message:
                        'Current academic year not found'
                });

            }


            /*
             * Load ALL teacher assignments.
             *
             * Primary + Secondary.
             */

            const { data, error } =
                await supabase
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
                (data || []).filter(item => {

                    const section =
                        item.classes?.school_section;

                    return (
                        section === 'Primary' ||
                        section === 'Secondary'
                    );

                });


            res.json({

                academic_year:
                    academicYear,

                assignments

            });


        } catch (error) {

            console.error(
                'Error loading teacher portal assignments:',
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
// TEACHER'S CLASSES
//
// Returns BOTH PRIMARY and SECONDARY classes.
// ============================================================

router.get(
    '/classes',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            const teacherId =
                Number(req.user.teacher_id);


            if (!Number.isInteger(teacherId)) {

                return res.status(400).json({
                    message:
                        'Teacher account is not linked to a valid teacher'
                });

            }


            let academicYearId =
                Number(req.query.academic_year_id);


            /*
             * Automatically use current academic year
             * when none is supplied.
             */

            if (!Number.isInteger(academicYearId)) {

                const {
                    data: currentYear,
                    error: yearError
                } =
                    await supabase
                        .from('academic_years')
                        .select(`
                            academic_year_id
                        `)
                        .eq('is_current', true)
                        .single();


                if (yearError || !currentYear) {

                    return res.status(404).json({
                        message:
                            'Current academic year not found'
                    });

                }


                academicYearId =
                    Number(
                        currentYear.academic_year_id
                    );

            }


            const { data, error } =
                await supabase
                    .from('class_subjects')
                    .select(`
                        class_id,
                        academic_year_id,

                        classes (
                            class_id,
                            class_name,
                            arm,
                            school_section
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


            const uniqueClasses = [];

            const seen = new Set();


            for (const row of data || []) {

                if (!row.classes) {
                    continue;
                }


                const section =
                    row.classes.school_section;


                if (
                    section !== 'Primary' &&
                    section !== 'Secondary'
                ) {

                    continue;

                }


                const key =
                    row.classes.class_id;


                if (!seen.has(key)) {

                    seen.add(key);

                    uniqueClasses.push(
                        row.classes
                    );

                }

            }


            res.json(uniqueClasses);


        } catch (error) {

            console.error(
                'Error loading teacher classes:',
                error
            );


            res.status(500).json({
                message:
                    'Failed to load teacher classes'
            });

        }

    }
);


// ============================================================
// TEACHER DIRECTORY WITH ASSIGNMENTS
//
// Frontend route:
//
// /teachers/directory/assignments
//
// Returns active teachers together with their
// Primary and Secondary teaching assignments.
// ============================================================

router.get(
    '/directory/assignments',
    authenticateToken,
    requireTeacher,
    async (req, res) => {

        try {

            /*
             * Get current academic year.
             */

            const {
                data: academicYear,
                error: academicYearError
            } =
                await supabase
                    .from('academic_years')
                    .select(`
                        academic_year_id,
                        year_name,
                        start_date,
                        end_date,
                        is_current
                    `)
                    .eq('is_current', true)
                    .single();


            if (
                academicYearError ||
                !academicYear
            ) {

                return res.status(404).json({
                    message:
                        'Current academic year not found'
                });

            }


            /*
             * Get all active teachers.
             */

            const {
                data: teachers,
                error: teachersError
            } =
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
                        photo_url,
                        school_section,
                        employment_type
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


            /*
             * Get all assignments for the current
             * academic year.
             */

            const {
                data: assignments,
                error: assignmentsError
            } =
                await supabase
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


            /*
             * Only retain Primary and Secondary
             * assignments.
             */

            const validAssignments =
                (assignments || []).filter(item => {

                    const section =
                        item.classes?.school_section;

                    return (
                        section === 'Primary' ||
                        section === 'Secondary'
                    );

                });


            /*
             * Attach assignments to each teacher.
             */

            const result =
                (teachers || []).map(teacher => {

                    const teacherAssignments =
                        validAssignments.filter(
                            assignment =>
                                Number(
                                    assignment.teacher_id
                                ) ===
                                Number(
                                    teacher.teacher_id
                                )
                        );


                    return {

                        ...teacher,

                        assignments:
                            teacherAssignments

                    };

                });


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
                    'Failed to load teacher directory'
            });

        }

    }
);


// ============================================================
// TEACHER DIRECTORY — SINGLE TEACHER
// ============================================================

router.get(
    '/teachers/:teacherId',
    authenticateToken,
    requireTeacher,
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


            const { data, error } =
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
                        photo_url,
                        school_section,
                        employment_type
                    `)
                    .eq(
                        'teacher_id',
                        teacherId
                    )
                    .eq(
                        'teacher_status',
                        'Active'
                    )
                    .single();


            if (error || !data) {

                return res.status(404).json({
                    message:
                        'Teacher not found'
                });

            }


            res.json(data);


        } catch (error) {

            console.error(
                'Error loading teacher:',
                error
            );


            res.status(500).json({
                message:
                    'Failed to load teacher'
            });

        }

    }
);


// ============================================================
// EXPORT
// ============================================================

module.exports = router;