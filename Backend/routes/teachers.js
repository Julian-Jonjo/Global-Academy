const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireTeacher,
    requireRoles,
    isAdminOrProprietor,
    isPrimaryManager,
    isSecondaryManager
} = require('../middleware/authMiddleware');

const router = express.Router();

// ============================================================
// ROLE PERMISSIONS
// ============================================================

const MANAGEMENT_ROLES = [
    'Proprietor',
    'Administrator',
    'Manager-Primary',
    'Manager-Secondary'
];

const TEACHER_ROLES = ['Teacher - Primary', 'Teacher - Secondary'];

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
        res.status(500).json({ message: 'Failed to load current academic year' });
    }
});

// ============================================================
// DEPARTMENTS
// ============================================================

router.get('/data/departments', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('departments')
            .select(`
                department_id,
                department_name,
                description,
                is_active
            `)
            .eq('is_active', true)
            .order('department_name');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error loading departments:', error);
        res.status(500).json({ message: 'Failed to load departments' });
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
                school_level,
                department_id,
                is_active
            `)
            .eq('is_active', true)
            .order('school_level')
            .order('subject_name');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error loading subjects:', error);
        res.status(500).json({ message: 'Failed to load subjects' });
    }
});

// ============================================================
// ALL ACTIVE CLASSES (Role-filtered)
// ============================================================

router.get('/data/classes', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
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

        // Filter by section for managers
        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        query = query.order('school_section').order('class_name').order('arm');

        const { data, error } = await query;

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error loading classes:', error);
        res.status(500).json({ message: 'Failed to load classes' });
    }
});

// ============================================================
// SECONDARY CLASSES
// ============================================================

router.get('/data/secondary-classes', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('classes')
            .select(`
                class_id,
                class_name,
                arm,
                school_section,
                academic_year_id,
                is_active
            `)
            .in('school_section', ['JSS', 'SSS', 'Secondary'])
            .eq('is_active', true)
            .order('class_name')
            .order('arm');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error loading secondary classes:', error);
        res.status(500).json({ message: 'Failed to load secondary classes' });
    }
});

// ============================================================
// GET HEADS OF DEPARTMENT
// ============================================================

router.get('/department-heads', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id);

        if (!Number.isInteger(academicYearId)) {
            return res.status(400).json({ message: 'Academic year ID is required' });
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
        res.json(data || []);
    } catch (error) {
        console.error('Error loading department heads:', error);
        res.status(500).json({ message: 'Failed to load department heads' });
    }
});

// ============================================================
// ASSIGN HEAD OF DEPARTMENT
// ============================================================

router.post('/department-heads', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const { department_id, teacher_id, academic_year_id } = req.body;

        if (!department_id || !teacher_id || !academic_year_id) {
            return res.status(400).json({ 
                message: 'Department, teacher and academic year are required' 
            });
        }

        const { data, error } = await supabase
            .from('department_heads')
            .insert([{ department_id, teacher_id, academic_year_id }])
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
                message: 'This department already has a Head of Department for this academic year'
            });
        }

        res.status(500).json({ message: 'Failed to assign Head of Department' });
    }
});

// ============================================================
// GET SECONDARY CLASS MASTERS
// ============================================================

router.get('/secondary/class-masters', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id);

        if (!Number.isInteger(academicYearId)) {
            return res.status(400).json({ message: 'Academic year ID is required' });
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
        res.json(data || []);
    } catch (error) {
        console.error('Error loading class masters:', error);
        res.status(500).json({ message: 'Failed to load class masters' });
    }
});

// ============================================================
// ASSIGN SECONDARY CLASS MASTER
// ============================================================

router.post('/secondary/class-masters', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const { class_id, teacher_id, academic_year_id } = req.body;

        if (!class_id || !teacher_id || !academic_year_id) {
            return res.status(400).json({ 
                message: 'Class, teacher and academic year are required' 
            });
        }

        const { data, error } = await supabase
            .from('secondary_class_masters')
            .insert([{ class_id, teacher_id, academic_year_id }])
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
                message: 'This class already has a class master for this academic year'
            });
        }

        res.status(500).json({ message: 'Failed to assign class master' });
    }
});

// ============================================================
// GET ALL TEACHER ASSIGNMENTS (Role-filtered)
// ============================================================

router.get('/assignments', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id);
        const userRole = req.user.role_name || '';

        if (!Number.isInteger(academicYearId)) {
            return res.status(400).json({ message: 'Academic year ID is required' });
        }

        const { data, error } = await supabase
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
            .eq('academic_year_id', academicYearId);

        if (error) throw error;

        // Filter assignments by section for managers
        let filteredData = data || [];
        
        if (isPrimaryManager(userRole)) {
            filteredData = filteredData.filter(
                item => ['nursery', 'primary'].includes(
                    (item.classes?.school_section || '').toLowerCase()
                )
            );
        } else if (isSecondaryManager(userRole)) {
            filteredData = filteredData.filter(
                item => ['jss', 'sss', 'secondary'].includes(
                    (item.classes?.school_section || '').toLowerCase()
                )
            );
        }

        res.json(filteredData);
    } catch (error) {
        console.error('Error loading teacher assignments:', error);
        res.status(500).json({ message: 'Failed to load teacher assignments' });
    }
});

// ============================================================
// GET ALL SECONDARY TEACHER ASSIGNMENTS
// ============================================================

router.get('/secondary-assignments', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id);

        if (!Number.isInteger(academicYearId)) {
            return res.status(400).json({ message: 'Academic year ID is required' });
        }

        const { data, error } = await supabase
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
            .eq('academic_year_id', academicYearId);

        if (error) throw error;

        const secondaryAssignments = (data || []).filter(
            item => ['JSS', 'SSS', 'Secondary'].includes(item.classes?.school_section)
        );

        res.json(secondaryAssignments);
    } catch (error) {
        console.error('Error loading secondary teacher assignments:', error);
        res.status(500).json({ message: 'Failed to load secondary teacher assignments' });
    }
});

// ============================================================
// GET CURRENT LOGGED-IN TEACHER PROFILE
// ============================================================

router.get('/me/profile', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        if (!userRole.includes('Teacher')) {
            return res.status(403).json({ 
                message: 'This endpoint is available to teachers only' 
            });
        }

        const teacherId = Number(req.user.teacher_id);

        if (!Number.isInteger(teacherId)) {
            return res.status(400).json({ 
                message: 'Your account is not linked to a teacher profile' 
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

        if (!data) {
            return res.status(404).json({ 
                message: 'No teacher profile is linked to this account' 
            });
        }

        res.json(data);
    } catch (error) {
        console.error('Error loading current teacher profile:', error);
        res.status(500).json({ message: 'Failed to load your teacher profile' });
    }
});

// ============================================================
// GET CURRENT TEACHER'S ALL ASSIGNMENTS
// ============================================================

router.get('/me/assignments', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        if (!userRole.includes('Teacher')) {
            return res.status(403).json({ 
                message: 'This endpoint is available to teachers only' 
            });
        }

        const teacherId = Number(req.user.teacher_id);

        if (!Number.isInteger(teacherId)) {
            return res.status(400).json({ 
                message: 'Your account is not linked to a teacher profile' 
            });
        }

        const { data: academicYear, error: academicYearError } = await supabase
            .from('academic_years')
            .select('*')
            .eq('is_current', true)
            .single();

        if (academicYearError) throw academicYearError;

        const { data: teacher, error: teacherError } = await supabase
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
            .eq('teacher_id', teacherId)
            .single();

        if (teacherError) throw teacherError;

        const { data: assignments, error: assignmentsError } = await supabase
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
            .eq('teacher_id', teacherId)
            .eq('academic_year_id', academicYear.academic_year_id);

        if (assignmentsError) throw assignmentsError;

        res.json({
            teacher,
            academic_year: academicYear,
            assignments: assignments || []
        });
    } catch (error) {
        console.error('Error loading current teacher assignments:', error);
        res.status(500).json({ message: 'Failed to load your teaching assignments' });
    }
});

// ============================================================
// BACKWARD-COMPATIBLE SECONDARY TEACHER ENDPOINT
// ============================================================

router.get('/me/secondary-assignments', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        if (!userRole.includes('Teacher')) {
            return res.status(403).json({ 
                message: 'This endpoint is available to teachers only' 
            });
        }

        const teacherId = Number(req.user.teacher_id);

        if (!Number.isInteger(teacherId)) {
            return res.status(400).json({ 
                message: 'Your account is not linked to a teacher profile' 
            });
        }

        const { data: academicYear, error: academicYearError } = await supabase
            .from('academic_years')
            .select('*')
            .eq('is_current', true)
            .single();

        if (academicYearError) throw academicYearError;

        const { data: teacher, error: teacherError } = await supabase
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
            .eq('teacher_id', teacherId)
            .single();

        if (teacherError) throw teacherError;

        const { data, error } = await supabase
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
            .eq('teacher_id', teacherId)
            .eq('academic_year_id', academicYear.academic_year_id);

        if (error) throw error;

        const assignments = (data || []).filter(
            item => ['JSS', 'SSS', 'Secondary'].includes(item.classes?.school_section)
        );

        res.json({
            teacher,
            academic_year: academicYear,
            assignments
        });
    } catch (error) {
        console.error('Error loading current secondary teacher assignments:', error);
        res.status(500).json({ message: 'Failed to load your secondary teaching assignments' });
    }
});

// ============================================================
// SCHOOL TEACHER DIRECTORY (Role-filtered)
// ============================================================

router.get('/directory', authenticateToken, async (req, res) => {
    try {
        const currentTeacherId = req.user.teacher_id;
        const userRole = req.user.role_name || '';
        
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
            .eq('teacher_status', 'Active');

        // Filter by section for managers
        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        query = query.order('last_name').order('first_name');

        const { data: allTeachers, error: countError } = await supabase
            .from('teachers')
            .select('teacher_id', { count: 'exact' })
            .eq('teacher_status', 'Active');

        if (!countError && allTeachers.length > 1) {
            query = query.neq('teacher_id', currentTeacherId);
        }

        const { data, error } = await query;

        if (error) throw error;

        res.json({
            success: true,
            teachers: data || [],
            section: req.user.school_section || 'All'
        });
    } catch (error) {
        console.error('Error loading teacher directory:', error);
        res.status(500).json({ message: 'Failed to load teacher directory' });
    }
});

// ============================================================
// SCHOOL TEACHER DIRECTORY WITH ASSIGNMENTS (Role-filtered)
// ============================================================

router.get('/directory/assignments', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';

        const { data: academicYear, error: yearError } = await supabase
            .from('academic_years')
            .select('*')
            .eq('is_current', true)
            .single();

        if (yearError) throw yearError;

        let teachersQuery = supabase
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
            .eq('teacher_status', 'Active');

        if (isPrimaryManager(userRole)) {
            teachersQuery = teachersQuery.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            teachersQuery = teachersQuery.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        teachersQuery = teachersQuery.order('last_name').order('first_name');

        const { data: teachersData, error: teachersError } = await teachersQuery;

        if (teachersError) throw teachersError;

        const { data: assignments, error: assignmentsError } = await supabase
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
            .eq('academic_year_id', academicYear.academic_year_id);

        if (assignmentsError) throw assignmentsError;

        const result = (teachersData || []).map(teacher => {
            const teacherAssignments = (assignments || []).filter(
                assignment => assignment.teacher_id === teacher.teacher_id
            );

            return {
                ...teacher,
                assignments: teacherAssignments
            };
        });

        res.json({
            academic_year: academicYear,
            teachers: result
        });
    } catch (error) {
        console.error('Error loading teacher directory with assignments:', error);
        res.status(500).json({ message: 'Failed to load teacher directory and assignments' });
    }
});

// ============================================================
// GET ALL SECONDARY ASSIGNMENTS FOR ALL TEACHERS (BULK)
// ============================================================

router.get('/secondary-assignments/bulk', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id);

        if (!Number.isInteger(academicYearId)) {
            return res.status(400).json({ message: 'Academic year ID is required' });
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

        if (error) throw error;

        const secondaryAssignments = (data || []).filter(
            item => ['JSS', 'SSS', 'Secondary'].includes(item.classes?.school_section)
        );

        res.json(secondaryAssignments);
    } catch (error) {
        console.error('Error loading bulk secondary assignments:', error);
        res.status(500).json({ message: 'Failed to load secondary assignments' });
    }
});

// ============================================================
// BACKWARD-COMPATIBLE SECONDARY ASSIGNMENTS
// ============================================================

router.get('/:teacherId/secondary-assignments', authenticateToken, async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);
        const academicYearId = Number(req.query.academic_year_id);

        if (!Number.isInteger(teacherId) || !Number.isInteger(academicYearId)) {
            return res.status(400).json({ 
                message: 'Teacher ID and academic year ID are required' 
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

        const secondary = (data || []).filter(
            item => ['JSS', 'SSS', 'Secondary'].includes(item.classes?.school_section)
        );

        res.json(secondary);
    } catch (error) {
        console.error('Error loading secondary teacher assignments:', error);
        res.status(500).json({ message: 'Failed to load teacher assignments' });
    }
});

// ============================================================
// ASSIGN TEACHER TO CLASS + SUBJECT
// ============================================================

router.post('/assignments', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const { teacher_id, class_id, subject_id, academic_year_id } = req.body;

        if (!teacher_id || !class_id || !subject_id || !academic_year_id) {
            return res.status(400).json({ 
                message: 'Teacher, class, subject and academic year are required' 
            });
        }

        const { data, error } = await supabase
            .from('class_subjects')
            .insert([{ teacher_id, class_id, subject_id, academic_year_id }])
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

        if (error) throw error;

        res.status(201).json({
            message: 'Teacher assigned successfully',
            assignment: data
        });
    } catch (error) {
        console.error('Error assigning teacher:', error);
        
        if (error.code === '23505') {
            return res.status(409).json({
                message: 'This teacher is already assigned to this subject and class for this academic year'
            });
        }

        res.status(500).json({ message: 'Failed to assign teacher' });
    }
});

// ============================================================
// BACKWARD-COMPATIBLE SECONDARY ASSIGNMENT ROUTE
// ============================================================

router.post('/secondary-assignments', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const { teacher_id, class_id, subject_id, academic_year_id } = req.body;

        if (!teacher_id || !class_id || !subject_id || !academic_year_id) {
            return res.status(400).json({ 
                message: 'Teacher, class, subject and academic year are required' 
            });
        }

        const { data, error } = await supabase
            .from('class_subjects')
            .insert([{ teacher_id, class_id, subject_id, academic_year_id }])
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

        if (error) throw error;

        res.status(201).json({
            message: 'Teacher assigned successfully',
            assignment: data
        });
    } catch (error) {
        console.error('Error assigning secondary teacher:', error);
        
        if (error.code === '23505') {
            return res.status(409).json({
                message: 'This teacher is already assigned to this subject and class for this academic year'
            });
        }

        res.status(500).json({ message: 'Failed to assign teacher' });
    }
});

// ============================================================
// GET ALL TEACHERS (Role-filtered)
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        
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
                address,
                employment_date,
                teacher_status,
                photo_url,
                school_section,
                employment_type
            `)
            .order('last_name')
            .order('first_name');

        // Role-based section filtering
        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }
        // Admin/Proprietor gets all teachers (no filter)

        const { data, error } = await query;

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading teachers:', error);
        res.status(500).json({ message: 'Failed to load teachers' });
    }
});

// ============================================================
// REGISTER TEACHER (Section-enforced)
// ============================================================

router.post('/', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
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
                message: 'Staff number, first name and last name are required' 
            });
        }

        const userRole = req.user.role_name || '';

        // Enforce section access
        if (isPrimaryManager(userRole)) {
            const allowedSections = ['Nursery', 'Primary'];
            if (!allowedSections.includes(school_section)) {
                return res.status(403).json({
                    message: 'Manager-Primary can only register Nursery or Primary School teachers.'
                });
            }
        }

        if (isSecondaryManager(userRole)) {
            const allowedSections = ['JSS', 'SSS', 'Secondary'];
            if (!allowedSections.includes(school_section)) {
                return res.status(403).json({
                    message: 'Manager-Secondary can only register JSS or SSS teachers.'
                });
            }
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
                employment_date: employment_date || null,
                teacher_status: teacher_status || 'Active',
                photo_url: photo_url || null,
                school_section: school_section || null,
                employment_type: employment_type || null
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
                message: 'A teacher with this staff number already exists'
            });
        }

        res.status(500).json({ message: 'Failed to register teacher' });
    }
});

// ============================================================
// UPDATE TEACHER (Section-enforced)
// ============================================================

router.put('/:teacherId', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);

        if (!Number.isInteger(teacherId)) {
            return res.status(400).json({ message: 'Invalid teacher ID' });
        }

        const { data: existingTeacher, error: fetchError } = await supabase
            .from('teachers')
            .select('school_section')
            .eq('teacher_id', teacherId)
            .single();

        if (fetchError || !existingTeacher) {
            return res.status(404).json({ message: 'Teacher not found' });
        }

        const userRole = req.user.role_name || '';
        const existingSection = (existingTeacher.school_section || '').toLowerCase();

        if (isPrimaryManager(userRole)) {
            const allowedSections = ['nursery', 'primary'];
            if (!allowedSections.includes(existingSection)) {
                return res.status(403).json({
                    message: 'Manager-Primary can only update Nursery or Primary School teachers.'
                });
            }
        }

        if (isSecondaryManager(userRole)) {
            const allowedSections = ['jss', 'sss', 'secondary'];
            if (!allowedSections.includes(existingSection)) {
                return res.status(403).json({
                    message: 'Manager-Secondary can only update JSS or SSS teachers.'
                });
            }
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
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updateData[field] = req.body[field];
            }
        });

        if (!Object.keys(updateData).length) {
            return res.status(400).json({ 
                message: 'No valid fields supplied for update' 
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
                message: 'A teacher with this staff number already exists'
            });
        }

        res.status(500).json({ message: 'Failed to update teacher' });
    }
});

// ============================================================
// DELETE TEACHER (Section-enforced)
// ============================================================

router.delete('/:teacherId', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);

        if (!Number.isInteger(teacherId)) {
            return res.status(400).json({ message: 'Invalid teacher ID' });
        }

        const { data: existingTeacher, error: fetchError } = await supabase
            .from('teachers')
            .select('school_section')
            .eq('teacher_id', teacherId)
            .single();

        if (fetchError || !existingTeacher) {
            return res.status(404).json({ message: 'Teacher not found' });
        }

        const userRole = req.user.role_name || '';
        const existingSection = (existingTeacher.school_section || '').toLowerCase();

        if (isPrimaryManager(userRole)) {
            const allowedSections = ['nursery', 'primary'];
            if (!allowedSections.includes(existingSection)) {
                return res.status(403).json({
                    message: 'Manager-Primary can only delete Nursery or Primary School teachers.'
                });
            }
        }

        if (isSecondaryManager(userRole)) {
            const allowedSections = ['jss', 'sss', 'secondary'];
            if (!allowedSections.includes(existingSection)) {
                return res.status(403).json({
                    message: 'Manager-Secondary can only delete JSS or SSS teachers.'
                });
            }
        }

        const { error } = await supabase
            .from('teachers')
            .delete()
            .eq('teacher_id', teacherId);

        if (error) throw error;

        res.json({ message: 'Teacher deleted successfully' });
    } catch (error) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({ message: 'Failed to delete teacher' });
    }
});

// ============================================================
// GET CURRENT TEACHER PROFILE (/me)
// ============================================================

router.get('/me', authenticateToken, requireTeacher, async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;

        if (!teacherId) {
            return res.status(400).json({ message: 'Invalid teacher ID' });
        }

        const { data: teacher, error: teacherError } = await supabase
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
            return res.status(404).json({ message: 'Teacher record not found' });
        }

        const { data: user, error: userError } = await supabase
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
        res.status(500).json({ message: 'Failed to load teacher profile' });
    }
});

// ============================================================
// GET SINGLE TEACHER (/:teacherId) - MUST BE LAST
// ============================================================

router.get('/:teacherId', authenticateToken, async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);
        const userRole = req.user.role_name || '';

        if (!Number.isInteger(teacherId)) {
            return res.status(400).json({ message: 'Invalid teacher ID' });
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
            return res.status(404).json({ message: 'Teacher not found' });
        }

        const teacherSection = (data.school_section || '').toLowerCase();

        if (isPrimaryManager(userRole)) {
            const allowedSections = ['nursery', 'primary'];
            if (!allowedSections.includes(teacherSection)) {
                return res.status(403).json({
                    message: 'Access denied. This is not a Primary School teacher.'
                });
            }
        }

        if (isSecondaryManager(userRole)) {
            const allowedSections = ['jss', 'sss', 'secondary'];
            if (!allowedSections.includes(teacherSection)) {
                return res.status(403).json({
                    message: 'Access denied. This is not a Secondary School teacher.'
                });
            }
        }

        res.json(data);
    } catch (error) {
        console.error('Error loading teacher:', error);
        res.status(500).json({ message: 'Failed to load teacher' });
    }
});
// Public teacher application - NO AUTH REQUIRED
router.post('/apply', upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'id_card', maxCount: 1 },
    { name: 'application_letter', maxCount: 1 },
    { name: 'certificates', maxCount: 5 }
]), async (req, res) => {
    try {
        const { first_name, middle_name, last_name, gender, phone, email, address, school_section, employment_type } = req.body;

        if (!first_name || !last_name || !phone) {
            return res.status(400).json({ message: 'First name, last name and phone are required' });
        }

        // Upload photo
        let photoUrl = null;
        if (req.files && req.files.photo) {
            const file = req.files.photo[0];
            const fileName = `teacher_${Date.now()}.jpg`;
            photoUrl = await uploadFileToSupabase(file, 'student_photos', 'teacher-photos', fileName);
        }

        // Upload ID card
        let idCardUrl = null;
        if (req.files && req.files.id_card) {
            const file = req.files.id_card[0];
            const fileName = `id_${Date.now()}.${file.originalname.split('.').pop()}`;
            idCardUrl = await uploadFileToSupabase(file, 'student_files', 'teacher-id-cards', fileName);
        }

        // Upload application letter
        let applicationLetterUrl = null;
        if (req.files && req.files.application_letter) {
            const file = req.files.application_letter[0];
            const fileName = `letter_${Date.now()}.${file.originalname.split('.').pop()}`;
            applicationLetterUrl = await uploadFileToSupabase(file, 'student_files', 'teacher-letters', fileName);
        }

        // Upload certificates
        let certificatesUrl = null;
        if (req.files && req.files.certificates && req.files.certificates.length > 0) {
            const file = req.files.certificates[0];
            const fileName = `cert_${Date.now()}.${file.originalname.split('.').pop()}`;
            certificatesUrl = await uploadFileToSupabase(file, 'student_files', 'teacher-certificates', fileName);
        }

        const { data, error } = await supabase
            .from('teacher_applications')
            .insert({
                first_name,
                middle_name: middle_name || null,
                last_name,
                gender: gender || null,
                phone,
                email: email || null,
                address: address || null,
                school_section: school_section || 'Primary',
                employment_type: employment_type || 'Permanent',
                photo_url: photoUrl,
                id_card_url: idCardUrl,
                application_letter_url: applicationLetterUrl,
                certificates_url: certificatesUrl,
                status: 'Pending'
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ message: 'Application submitted successfully!', application: data });
    } catch (error) {
        console.error('Teacher application error:', error);
        res.status(500).json({ message: 'Failed to submit application: ' + error.message });
    }
});
// GET ALL APPLICATIONS (Manager/Admin/Proprietor)
router.get('/applications', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        let query = supabase.from('teacher_applications').select('*').order('created_at', { ascending: false });
        
        // Filter by section for managers
        if (userRole.includes('manager-primary')) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (userRole.includes('manager-secondary')) {
            query = query.in('school_section', ['JSS', 'SSS']);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error loading applications:', error);
        res.status(500).json({ message: 'Failed to load applications' });
    }
});

// MANAGER REVIEWS AND SENDS TO PROPRIETOR
router.put('/applications/:id/review', authenticateToken, requireRoles('Manager-Primary', 'Manager-Secondary', 'Administrator'), async (req, res) => {
    try {
        const applicationId = Number(req.params.id);
        const { data, error } = await supabase
            .from('teacher_applications')
            .update({ status: 'Manager_Reviewed', reviewed_by: req.user.user_id, reviewed_at: new Date().toISOString() })
            .eq('application_id', applicationId)
            .select()
            .single();
        if (error) throw error;
        res.json({ message: 'Application sent to Proprietor', application: data });
    } catch (error) {
        console.error('Error reviewing application:', error);
        res.status(500).json({ message: 'Failed to review application' });
    }
});

// APPROVE APPLICATION - Move to teachers table
router.put('/applications/:id/approve', authenticateToken, requireRoles('Proprietor', 'Administrator'), async (req, res) => {
    try {
        const applicationId = Number(req.params.id);
        
        // Get application
        const { data: application, error: fetchError } = await supabase
            .from('teacher_applications')
            .select('*')
            .eq('application_id', applicationId)
            .single();
        if (fetchError || !application) return res.status(404).json({ message: 'Application not found' });
        
        // Create teacher record
        const { data: teacher, error: teacherError } = await supabase
            .from('teachers')
            .insert({
                staff_number: application.staff_number || `TEA-${Date.now()}`,
                first_name: application.first_name,
                middle_name: application.middle_name,
                last_name: application.last_name,
                gender: application.gender,
                phone: application.phone,
                email: application.email,
                address: application.address,
                school_section: application.school_section,
                employment_type: application.employment_type,
                teacher_status: 'Active',
                photo_url: application.photo_url
            })
            .select()
            .single();
        
        if (teacherError) throw teacherError;
        
        // Update application status
        await supabase
            .from('teacher_applications')
            .update({ status: 'Approved', approved_by: req.user.user_id, approved_at: new Date().toISOString() })
            .eq('application_id', applicationId);
        
        res.json({ message: 'Teacher approved and added to staff', teacher });
    } catch (error) {
        console.error('Error approving application:', error);
        res.status(500).json({ message: 'Failed to approve application' });
    }
});

// REJECT APPLICATION
router.put('/applications/:id/reject', authenticateToken, requireRoles('Proprietor', 'Administrator', 'Manager-Primary', 'Manager-Secondary'), async (req, res) => {
    try {
        const applicationId = Number(req.params.id);
        const { rejection_reason } = req.body;
        
        const { data, error } = await supabase
            .from('teacher_applications')
            .update({ status: 'Rejected', rejection_reason: rejection_reason || null, approved_by: req.user.user_id, approved_at: new Date().toISOString() })
            .eq('application_id', applicationId)
            .select()
            .single();
        if (error) throw error;
        
        res.json({ message: 'Application rejected', application: data });
    } catch (error) {
        console.error('Error rejecting application:', error);
        res.status(500).json({ message: 'Failed to reject application' });
    }
});

// DELETE APPLICATION
router.delete('/applications/:id', authenticateToken, requireRoles('Proprietor', 'Administrator'), async (req, res) => {
    try {
        const applicationId = Number(req.params.id);
        const { error } = await supabase
            .from('teacher_applications')
            .delete()
            .eq('application_id', applicationId);
        if (error) throw error;
        res.json({ message: 'Application deleted' });
    } catch (error) {
        console.error('Error deleting application:', error);
        res.status(500).json({ message: 'Failed to delete application' });
    }
});

module.exports = router;