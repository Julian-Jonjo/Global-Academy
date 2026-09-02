const express = require('express');
const supabase = require('../Config/db');
const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, PDF, DOC, DOCX are allowed.'));
        }
    }
});

async function uploadFileToSupabase(file, bucket, folder, fileName) {
    if (!file) return null;
    try {
        const filePath = `${folder}/${fileName}`;
        const { error } = await supabase.storage.from(bucket).upload(filePath, file.buffer, {
            contentType: file.mimetype,
            cacheControl: '3600',
            upsert: true
        });
        if (error) {
            console.error('Upload error:', error.message);
            return null;
        }
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
        return urlData.publicUrl;
    } catch (error) {
        console.error('File upload exception:', error.message);
        return null;
    }
}

const {
    authenticateToken,
    requireTeacher,
    requireRoles,
    isAdminOrProprietor,
    isPrimaryManager,
    isSecondaryManager
} = require('../middleware/authMiddleware');

const router = express.Router();

const MANAGEMENT_ROLES = ['Proprietor', 'Administrator', 'Manager-Primary', 'Manager-Secondary'];
const TEACHER_ROLES = ['Teacher - Primary', 'Teacher - Secondary'];

// ============================================================
// CURRENT ACADEMIC YEAR
// ============================================================
router.get('/academic-year/current', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('academic_years').select('*').eq('is_current', true).single();
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load current academic year' });
    }
});

// ============================================================
// DEPARTMENTS
// ============================================================
router.get('/data/departments', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('departments').select('department_id, department_name, description, is_active').eq('is_active', true).order('department_name');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load departments' });
    }
});

// ============================================================
// SUBJECTS
// ============================================================
router.get('/data/subjects', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('subjects').select('subject_id, subject_code, subject_name, school_level, department_id, is_active').eq('is_active', true).order('school_level').order('subject_name');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load subjects' });
    }
});

// ============================================================
// ALL ACTIVE CLASSES
// ============================================================
router.get('/data/classes', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        let query = supabase.from('classes').select('class_id, class_name, arm, school_section, academic_year_id, is_active').eq('is_active', true);
        if (isPrimaryManager(userRole)) query = query.in('school_section', ['Nursery', 'Primary']);
        else if (isSecondaryManager(userRole)) query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        query = query.order('school_section').order('class_name').order('arm');
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load classes' });
    }
});

// ============================================================
// PUBLIC TEACHER APPLICATION - NO AUTH REQUIRED
// ============================================================
router.post('/apply', upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'id_card', maxCount: 1 },
    { name: 'application_letter', maxCount: 1 },
    { name: 'certificates', maxCount: 5 }
]), async (req, res) => {
    try {
        const { first_name, middle_name, last_name, gender, phone, email, address, school_section, employment_type } = req.body;
        if (!first_name || !last_name || !phone) return res.status(400).json({ message: 'First name, last name and phone are required' });

        let photoUrl = null, idCardUrl = null, applicationLetterUrl = null, certificatesUrl = null;

        if (req.files?.photo) photoUrl = await uploadFileToSupabase(req.files.photo[0], 'student_photos', 'teacher-photos', `teacher_${Date.now()}.jpg`);
        if (req.files?.id_card) idCardUrl = await uploadFileToSupabase(req.files.id_card[0], 'student_files', 'teacher-id-cards', `id_${Date.now()}.${req.files.id_card[0].originalname.split('.').pop()}`);
        if (req.files?.application_letter) applicationLetterUrl = await uploadFileToSupabase(req.files.application_letter[0], 'student_files', 'teacher-letters', `letter_${Date.now()}.${req.files.application_letter[0].originalname.split('.').pop()}`);
        if (req.files?.certificates?.[0]) certificatesUrl = await uploadFileToSupabase(req.files.certificates[0], 'student_files', 'teacher-certificates', `cert_${Date.now()}.${req.files.certificates[0].originalname.split('.').pop()}`);

        const { data, error } = await supabase.from('teacher_applications').insert({
            first_name, middle_name: middle_name || null, last_name, gender: gender || null,
            phone, email: email || null, address: address || null,
            school_section: school_section || 'Primary', employment_type: employment_type || 'Permanent',
            photo_url: photoUrl, id_card_url: idCardUrl, application_letter_url: applicationLetterUrl,
            certificates_url: certificatesUrl, status: 'Pending'
        }).select().single();

        if (error) throw error;
        res.status(201).json({ message: 'Application submitted successfully!', application: data });
    } catch (error) {
        console.error('Teacher application error:', error);
        res.status(500).json({ message: 'Failed to submit application: ' + error.message });
    }
});

// ============================================================
// GET ALL APPLICATIONS
// ============================================================
router.get('/applications', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        let query = supabase.from('teacher_applications').select('*').order('created_at', { ascending: false });
        if (userRole.includes('manager-primary')) query = query.in('school_section', ['Nursery', 'Primary']);
        else if (userRole.includes('manager-secondary')) query = query.in('school_section', ['JSS', 'SSS']);
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load applications' });
    }
});

// ============================================================
// MANAGER REVIEWS
// ============================================================
router.put('/applications/:id/review', authenticateToken, requireRoles('Manager-Primary', 'Manager-Secondary', 'Administrator'), async (req, res) => {
    try {
        const { data, error } = await supabase.from('teacher_applications').update({ status: 'Manager_Reviewed', reviewed_by: req.user.user_id, reviewed_at: new Date().toISOString() }).eq('application_id', Number(req.params.id)).select().single();
        if (error) throw error;
        res.json({ message: 'Application sent to Proprietor', application: data });
    } catch (error) { res.status(500).json({ message: 'Failed to review application' }); }
});

// ============================================================
// APPROVE APPLICATION
// ============================================================
router.put('/applications/:id/approve', authenticateToken, requireRoles('Proprietor', 'Administrator'), async (req, res) => {
    try {
        const { data: application, error: fetchError } = await supabase.from('teacher_applications').select('*').eq('application_id', Number(req.params.id)).single();
        if (fetchError || !application) return res.status(404).json({ message: 'Application not found' });

        const { data: teacher, error: teacherError } = await supabase.from('teachers').insert({
            staff_number: application.staff_number || `TEA-${Date.now()}`,
            first_name: application.first_name, middle_name: application.middle_name, last_name: application.last_name,
            gender: application.gender, phone: application.phone, email: application.email, address: application.address,
            school_section: application.school_section, employment_type: application.employment_type,
            teacher_status: 'Active', photo_url: application.photo_url
        }).select().single();
        if (teacherError) throw teacherError;

        await supabase.from('teacher_applications').update({ status: 'Approved', approved_by: req.user.user_id, approved_at: new Date().toISOString() }).eq('application_id', Number(req.params.id));
        res.json({ message: 'Teacher approved and added to staff', teacher });
    } catch (error) {
        console.error('Error approving application:', error);
        res.status(500).json({ message: 'Failed to approve application: ' + error.message });
    }
});

// ============================================================
// REJECT APPLICATION
// ============================================================
router.put('/applications/:id/reject', authenticateToken, requireRoles('Proprietor', 'Administrator', 'Manager-Primary', 'Manager-Secondary'), async (req, res) => {
    try {
        const { data, error } = await supabase.from('teacher_applications').update({ status: 'Rejected', rejection_reason: req.body.rejection_reason || null, approved_by: req.user.user_id, approved_at: new Date().toISOString() }).eq('application_id', Number(req.params.id)).select().single();
        if (error) throw error;
        res.json({ message: 'Application rejected', application: data });
    } catch (error) { res.status(500).json({ message: 'Failed to reject application' }); }
});

// ============================================================
// DELETE APPLICATION
// ============================================================
router.delete('/applications/:id', authenticateToken, requireRoles('Proprietor', 'Administrator'), async (req, res) => {
    try {
        const { error } = await supabase.from('teacher_applications').delete().eq('application_id', Number(req.params.id));
        if (error) throw error;
        res.json({ message: 'Application deleted' });
    } catch (error) { res.status(500).json({ message: 'Failed to delete application' }); }
});

// ============================================================
// ASSIGN CLASS TO PRIMARY TEACHER
// ============================================================
router.post('/assign-class', authenticateToken, requireRoles('Manager-Primary', 'Administrator'), async (req, res) => {
    try {
        const { teacher_id, class_id, academic_year_id } = req.body;
        if (!teacher_id || !class_id) return res.status(400).json({ message: 'Teacher and class are required' });

        const { data, error } = await supabase.from('primary_class_teachers').insert({
            teacher_id: Number(teacher_id), class_id: Number(class_id), academic_year_id: Number(academic_year_id || 1)
        }).select().single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({ message: 'This teacher is already assigned to this class.' });
            throw error;
        }
        res.status(201).json({ message: 'Class assigned successfully', assignment: data });
    } catch (error) {
        res.status(500).json({ message: 'Failed to assign class: ' + error.message });
    }
});

// ============================================================
// GET PRIMARY CLASS ASSIGNMENTS
// ============================================================
router.get('/primary-class-assignments', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id || 1);
        const { data, error } = await supabase.from('primary_class_teachers').select(`
            assignment_id, teacher_id, class_id, academic_year_id,
            teachers (teacher_id, first_name, middle_name, last_name, staff_number),
            classes (class_id, class_name, arm, school_section)
        `).eq('academic_year_id', academicYearId);
        if (error) throw error;
        res.json(data || []);
    } catch (error) { res.status(500).json({ message: 'Failed to load class assignments' }); }
});

// ============================================================
// GET CURRENT TEACHER PROFILE (/me)
// ============================================================
router.get('/me', authenticateToken, requireTeacher, async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;
        if (!teacherId) return res.status(400).json({ message: 'Invalid teacher ID' });

        const { data: teacher, error } = await supabase.from('teachers').select('*').eq('teacher_id', teacherId).single();
        if (error || !teacher) return res.status(404).json({ message: 'Teacher record not found' });

        res.json({ user: req.user, teacher });
    } catch (error) { res.status(500).json({ message: 'Failed to load teacher profile' }); }
});

// ============================================================
// GET ALL SECONDARY ASSIGNMENTS (BULK)
// ============================================================
router.get('/secondary-assignments/bulk', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id);
        if (!Number.isInteger(academicYearId)) return res.status(400).json({ message: 'Academic year ID is required' });

        const { data, error } = await supabase.from('class_subjects').select(`
            class_subject_id, class_id, subject_id, teacher_id, academic_year_id,
            classes (class_name, arm, school_section),
            subjects (subject_id, subject_code, subject_name, school_level, departments (department_id, department_name))
        `).eq('academic_year_id', academicYearId);
        if (error) throw error;

        const secondary = (data || []).filter(item => ['JSS', 'SSS', 'Secondary'].includes(item.classes?.school_section));
        res.json(secondary);
    } catch (error) { res.status(500).json({ message: 'Failed to load secondary assignments' }); }
});

// ============================================================
// GET ALL SECONDARY ASSIGNMENTS
// ============================================================
router.get('/secondary-assignments', authenticateToken, async (req, res) => {
    try {
        const academicYearId = Number(req.query.academic_year_id);
        if (!Number.isInteger(academicYearId)) return res.status(400).json({ message: 'Academic year ID is required' });

        const { data, error } = await supabase.from('class_subjects').select(`
            class_subject_id, class_id, subject_id, teacher_id, academic_year_id,
            classes (class_id, class_name, arm, school_section),
            subjects (subject_id, subject_code, subject_name, school_level, departments (department_id, department_name)),
            teachers (teacher_id, staff_number, first_name, middle_name, last_name)
        `).eq('academic_year_id', academicYearId);
        if (error) throw error;

        const secondary = (data || []).filter(item => ['JSS', 'SSS', 'Secondary'].includes(item.classes?.school_section));
        res.json(secondary);
    } catch (error) { res.status(500).json({ message: 'Failed to load secondary assignments' }); }
});

// ============================================================
// GET TEACHER ASSIGNMENTS BY ID
// ============================================================
router.get('/:teacherId/secondary-assignments', authenticateToken, async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);
        const academicYearId = Number(req.query.academic_year_id);
        if (!Number.isInteger(teacherId) || !Number.isInteger(academicYearId)) return res.status(400).json({ message: 'Teacher ID and academic year ID are required' });

        const { data, error } = await supabase.from('class_subjects').select(`
            class_subject_id, class_id, subject_id, teacher_id, academic_year_id,
            classes (class_name, arm, school_section),
            subjects (subject_code, subject_name, school_level)
        `).eq('teacher_id', teacherId).eq('academic_year_id', academicYearId);
        if (error) throw error;

        const secondary = (data || []).filter(item => ['JSS', 'SSS', 'Secondary'].includes(item.classes?.school_section));
        res.json(secondary);
    } catch (error) { res.status(500).json({ message: 'Failed to load teacher assignments' }); }
});

// ============================================================
// ASSIGN TEACHER TO CLASS + SUBJECT
// ============================================================
router.post('/assignments', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const { teacher_id, class_id, subject_id, academic_year_id } = req.body;
        if (!teacher_id || !class_id || !subject_id || !academic_year_id) return res.status(400).json({ message: 'Teacher, class, subject and academic year are required' });

        const { data, error } = await supabase.from('class_subjects').insert([{ teacher_id, class_id, subject_id, academic_year_id }]).select().single();
        if (error) {
            if (error.code === '23505') return res.status(409).json({ message: 'This teacher is already assigned to this subject and class.' });
            throw error;
        }
        res.status(201).json({ message: 'Teacher assigned successfully', assignment: data });
    } catch (error) { res.status(500).json({ message: 'Failed to assign teacher' }); }
});

// ============================================================
// GET ALL TEACHERS
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        let query = supabase.from('teachers').select('teacher_id, staff_number, first_name, middle_name, last_name, gender, phone, email, address, employment_date, teacher_status, photo_url, school_section, employment_type').order('last_name').order('first_name');
        if (isPrimaryManager(userRole)) query = query.in('school_section', ['Nursery', 'Primary']);
        else if (isSecondaryManager(userRole)) query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (error) { res.status(500).json({ message: 'Failed to load teachers' }); }
});

// ============================================================
// REGISTER TEACHER
// ============================================================
router.post('/', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const { staff_number, first_name, middle_name, last_name, gender, phone, email, address, employment_date, teacher_status, photo_url, school_section, employment_type } = req.body;
        if (!staff_number || !first_name || !last_name) return res.status(400).json({ message: 'Staff number, first name and last name are required' });

        const userRole = req.user.role_name || '';
        if (isPrimaryManager(userRole) && !['Nursery', 'Primary'].includes(school_section)) return res.status(403).json({ message: 'Manager-Primary can only register Nursery or Primary School teachers.' });
        if (isSecondaryManager(userRole) && !['JSS', 'SSS', 'Secondary'].includes(school_section)) return res.status(403).json({ message: 'Manager-Secondary can only register JSS or SSS teachers.' });

        const { data, error } = await supabase.from('teachers').insert([{
            staff_number, first_name, middle_name: middle_name || null, last_name, gender: gender || null,
            phone: phone || null, email: email || null, address: address || null,
            employment_date: employment_date || null, teacher_status: teacher_status || 'Active',
            photo_url: photo_url || null, school_section: school_section || null, employment_type: employment_type || null
        }]).select().single();

        if (error) throw error;
        res.status(201).json({ message: 'Teacher registered successfully', teacher: data });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: 'A teacher with this staff number already exists' });
        res.status(500).json({ message: 'Failed to register teacher' });
    }
});

// ============================================================
// UPDATE TEACHER
// ============================================================
router.put('/:teacherId', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);
        if (!Number.isInteger(teacherId)) return res.status(400).json({ message: 'Invalid teacher ID' });

        const { data: existingTeacher, error: fetchError } = await supabase.from('teachers').select('school_section').eq('teacher_id', teacherId).single();
        if (fetchError || !existingTeacher) return res.status(404).json({ message: 'Teacher not found' });

        const userRole = req.user.role_name || '';
        const existingSection = (existingTeacher.school_section || '').toLowerCase();
        if (isPrimaryManager(userRole) && !['nursery', 'primary'].includes(existingSection)) return res.status(403).json({ message: 'Manager-Primary can only update Nursery or Primary School teachers.' });
        if (isSecondaryManager(userRole) && !['jss', 'sss', 'secondary'].includes(existingSection)) return res.status(403).json({ message: 'Manager-Secondary can only update JSS or SSS teachers.' });

        const allowedFields = ['staff_number', 'first_name', 'middle_name', 'last_name', 'gender', 'phone', 'email', 'address', 'employment_date', 'teacher_status', 'photo_url', 'school_section', 'employment_type'];
        const updateData = {};
        allowedFields.forEach(field => { if (req.body[field] !== undefined) updateData[field] = req.body[field]; });

        const { data, error } = await supabase.from('teachers').update(updateData).eq('teacher_id', teacherId).select().single();
        if (error) throw error;
        res.json({ message: 'Teacher updated successfully', teacher: data });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: 'A teacher with this staff number already exists' });
        res.status(500).json({ message: 'Failed to update teacher' });
    }
});

// ============================================================
// DELETE TEACHER
// ============================================================
router.delete('/:teacherId', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);
        if (!Number.isInteger(teacherId)) return res.status(400).json({ message: 'Invalid teacher ID' });

        const { data: existingTeacher, error: fetchError } = await supabase.from('teachers').select('school_section').eq('teacher_id', teacherId).single();
        if (fetchError || !existingTeacher) return res.status(404).json({ message: 'Teacher not found' });

        const userRole = req.user.role_name || '';
        const existingSection = (existingTeacher.school_section || '').toLowerCase();
        if (isPrimaryManager(userRole) && !['nursery', 'primary'].includes(existingSection)) return res.status(403).json({ message: 'Manager-Primary can only delete Nursery or Primary School teachers.' });
        if (isSecondaryManager(userRole) && !['jss', 'sss', 'secondary'].includes(existingSection)) return res.status(403).json({ message: 'Manager-Secondary can only delete JSS or SSS teachers.' });

        const { error } = await supabase.from('teachers').delete().eq('teacher_id', teacherId);
        if (error) throw error;
        res.json({ message: 'Teacher deleted successfully' });
    } catch (error) { res.status(500).json({ message: 'Failed to delete teacher' }); }
});

// ============================================================
// GET SINGLE TEACHER - MUST BE LAST
// ============================================================
router.get('/:teacherId', authenticateToken, async (req, res) => {
    try {
        const teacherId = Number(req.params.teacherId);
        const userRole = req.user.role_name || '';
        if (!Number.isInteger(teacherId)) return res.status(400).json({ message: 'Invalid teacher ID' });

        const { data, error } = await supabase.from('teachers').select('*').eq('teacher_id', teacherId).single();
        if (error || !data) return res.status(404).json({ message: 'Teacher not found' });

        const teacherSection = (data.school_section || '').toLowerCase();
        if (isPrimaryManager(userRole) && !['nursery', 'primary'].includes(teacherSection)) return res.status(403).json({ message: 'Access denied.' });
        if (isSecondaryManager(userRole) && !['jss', 'sss', 'secondary'].includes(teacherSection)) return res.status(403).json({ message: 'Access denied.' });

        res.json(data);
    } catch (error) { res.status(500).json({ message: 'Failed to load teacher' }); }
});

module.exports = router;