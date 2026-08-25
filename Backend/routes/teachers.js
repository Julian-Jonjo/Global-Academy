const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// CURRENT ACADEMIC YEAR
// ============================================================

router.get('/academic-year/current', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('academic_years')
            .select('*')
            .eq('is_current', true)
            .single();

        if (error) throw error;
        res.json(data);

    } catch (error) {
        console.error('Error loading current academic year:', error);
        res.status(500).json({
            message: 'Failed to load current academic year'
        });
    }
});


// ============================================================
// DEPARTMENTS
// ============================================================

router.get('/data/departments', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('departments')
            .select('*')
            .order('department_name');

        if (error) {
            console.error('SUPABASE DEPARTMENTS ERROR:', error);

            return res.status(500).json({
                message: 'Failed to load departments',
                error: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint
            });
        }

        console.log('DEPARTMENTS LOADED:', data);

        res.json(data || []);

    } catch (error) {
        console.error('DEPARTMENTS ROUTE ERROR:', error);

        res.status(500).json({
            message: 'Failed to load departments',
            error: error.message
        });
    }
});

// ============================================================
// SUBJECTS
// ============================================================

router.get('/data/subjects', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('subjects')
            .select(`
                subject_id,
                subject_code,
                subject_name,
                school_level
            `)
            .order('school_level')
            .order('subject_name');

        if (error) throw error;

        res.json(data || []);

    } catch (error) {
        console.error('Error loading subjects:', error);

        res.status(500).json({
            message: 'Failed to load subjects'
        });
    }
});

// ============================================================
// GET HEADS OF DEPARTMENT
// ============================================================

router.get('/department-heads', authenticateToken, async (req, res) => {
    try {
        const academicYearId =
            Number(req.query.academic_year_id);

        if (!Number.isInteger(academicYearId)) {
            return res.status(400).json({
                message: 'Academic year ID is required'
            });
        }

        const { data, error } = await supabase
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
            .eq('academic_year_id', academicYearId);

        if (error) throw error;
        res.json(data);

    } catch (error) {
        console.error('Error loading department heads:', error);
        res.status(500).json({
            message: 'Failed to load department heads'
        });
    }
});


// ============================================================
// ASSIGN HEAD OF DEPARTMENT
// ============================================================

router.post(
    '/department-heads',
    authenticateToken,
    requireRoles('Administrator', 'Principal', 'Vice Principal'),
    async (req, res) => {
        try {
            const {
                department_id,
                teacher_id,
                academic_year_id
            } = req.body;

            if (!department_id || !teacher_id || !academic_year_id) {
                return res.status(400).json({
                    message:
                        'Department, teacher and academic year are required'
                });
            }

            const { data, error } = await supabase
                .from('department_heads')
                .insert([{
                    department_id,
                    teacher_id,
                    academic_year_id
                }])
                .select()
                .single();

            if (error) throw error;

            res.status(201).json({
                message: 'Head of Department assigned successfully',
                assignment: data
            });

        } catch (error) {
            console.error('Error assigning HOD:', error);

            if (error.code === '23505') {
                return res.status(409).json({
                    message:
                        'This department already has a Head of Department for this academic year'
                });
            }

            res.status(500).json({
                message: 'Failed to assign Head of Department'
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
                    message: 'Academic year ID is required'
                });
            }

            const { data, error } = await supabase
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
                .eq('academic_year_id', academicYearId);

            if (error) throw error;
            res.json(data);

        } catch (error) {
            console.error('Error loading class masters:', error);
            res.status(500).json({
                message: 'Failed to load class masters'
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
    requireRoles('Administrator', 'Principal', 'Vice Principal'),
    async (req, res) => {
        try {
            const {
                class_id,
                teacher_id,
                academic_year_id
            } = req.body;

            if (!class_id || !teacher_id || !academic_year_id) {
                return res.status(400).json({
                    message:
                        'Class, teacher and academic year are required'
                });
            }

            const { data, error } = await supabase
                .from('secondary_class_masters')
                .insert([{
                    class_id,
                    teacher_id,
                    academic_year_id
                }])
                .select()
                .single();

            if (error) throw error;

            res.status(201).json({
                message: 'Class master assigned successfully',
                assignment: data
            });

        } catch (error) {
            console.error('Error assigning class master:', error);

            if (error.code === '23505') {
                return res.status(409).json({
                    message:
                        'This class already has a class master for this academic year'
                });
            }

            res.status(500).json({
                message: 'Failed to assign class master'
            });
        }
    }
);


// ============================================================
// GET TEACHER'S SECONDARY ASSIGNMENTS
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
                        subject_code,
                        subject_name,
                        school_level
                    )
                `)
                .eq('teacher_id', teacherId)
                .eq('academic_year_id', academicYearId);

            if (error) throw error;
            res.json(data);

        } catch (error) {
            console.error(
                'Error loading teacher assignments:',
                error
            );

            res.status(500).json({
                message: 'Failed to load teacher assignments'
            });
        }
    }
);


// ============================================================
// ASSIGN TEACHER TO SECONDARY CLASS + SUBJECT
// ============================================================

router.post(
    '/secondary-assignments',
    authenticateToken,
    requireRoles('Administrator', 'Principal', 'Vice Principal'),
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

            const { data, error } = await supabase
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
                        arm
                    ),
                    subjects (
                        subject_code,
                        subject_name
                    )
                `)
                .single();

            if (error) throw error;

            res.status(201).json({
                message: 'Teacher assigned successfully',
                assignment: data
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
                message: 'Failed to assign teacher'
            });
        }
    }
);


// ============================================================
// GET ALL TEACHERS
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
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
            .order('last_name')
            .order('first_name');

        if (error) throw error;
        res.json(data);

    } catch (error) {
        console.error('Error loading teachers:', error);
        res.status(500).json({
            message: 'Failed to load teachers'
        });
    }
});


// ============================================================
// REGISTER TEACHER
// ============================================================

router.post(
    '/',
    authenticateToken,
    requireRoles('Administrator', 'Principal', 'Vice Principal'),
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

            if (!staff_number || !first_name || !last_name) {
                return res.status(400).json({
                    message:
                        'Staff number, first name and last name are required'
                });
            }

            const { data, error } = await supabase
                .from('teachers')
                .insert([{
                    staff_number,
                    first_name,
                    middle_name: middle_name || null,
                    last_name,
                    gender: gender || null,
                    phone: phone || null,
                    email: email || null,
                    address: address || null,
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

            if (error) throw error;

            res.status(201).json({
                message: 'Teacher registered successfully',
                teacher: data
            });

        } catch (error) {
            console.error('Error registering teacher:', error);

            if (error.code === '23505') {
                return res.status(409).json({
                    message:
                        'A teacher with this staff number already exists'
                });
            }

            res.status(500).json({
                message: 'Failed to register teacher'
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
    requireRoles('Administrator', 'Principal', 'Vice Principal'),
    async (req, res) => {
        try {
            const teacherId =
                Number(req.params.teacherId);

            if (!Number.isInteger(teacherId)) {
                return res.status(400).json({
                    message: 'Invalid teacher ID'
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

            allowedFields.forEach(field => {
                if (
                    Object.prototype.hasOwnProperty.call(
                        req.body,
                        field
                    )
                ) {
                    updateData[field] = req.body[field];
                }
            });

            if (!Object.keys(updateData).length) {
                return res.status(400).json({
                    message:
                        'No valid fields supplied for update'
                });
            }

            const { data, error } = await supabase
                .from('teachers')
                .update(updateData)
                .eq('teacher_id', teacherId)
                .select()
                .single();

            if (error) throw error;

            res.json({
                message: 'Teacher updated successfully',
                teacher: data
            });

        } catch (error) {
            console.error('Error updating teacher:', error);

            if (error.code === '23505') {
                return res.status(409).json({
                    message:
                        'A teacher with this staff number already exists'
                });
            }

            res.status(500).json({
                message: 'Failed to update teacher'
            });
        }
    }
);


// ============================================================
// GET SINGLE TEACHER
// ============================================================

router.get('/:teacherId', authenticateToken, async (req, res) => {
    try {
        const teacherId =
            Number(req.params.teacherId);

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

        if (error) throw error;

        res.json(data);

    } catch (error) {
        console.error('Error loading teacher:', error);

        res.status(500).json({
            message: 'Failed to load teacher'
        });
    }
});


module.exports = router;