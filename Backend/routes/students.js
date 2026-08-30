const express = require('express');
const multer = require('multer');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles,
    isAdminOrProprietor,
    isPrimaryManager,
    isSecondaryManager
} = require('../middleware/authMiddleware');

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
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
        console.log('Uploading to bucket:', bucket, 'path:', filePath);
        const { error } = await supabase.storage.from(bucket).upload(filePath, file.buffer, {
            contentType: file.mimetype,
            cacheControl: '3600',
            upsert: true
        });
        if (error) {
            console.error('Upload error:', error.message);
            return null;
        }
        console.log('Upload successful:', filePath);
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(filePath);
        return urlData.publicUrl;
    } catch (error) {
        console.error('File upload exception:', error.message);
        return null;
    }
}

const MANAGEMENT_ROLES = ['Proprietor', 'Administrator', 'Manager-Primary', 'Manager-Secondary'];

// ============================================================
// GET ALL STUDENTS (Role-filtered)
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        let query = supabase
    .from('students')
    .select(`
        *,
        classes!students_class_id_fkey (class_name, arm, school_section),
        guardians!students_guardian_id_fkey (full_name, relationship, phone, email, address)
    `)
            .order('student_id', { ascending: false });

        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        const { data, error } = await query;
        if (error) throw error;

        const students = (data || []).map(student => ({
            ...student,
            class_name: student.classes?.class_name || null,
            arm: student.classes?.arm || null,
            guardian_name: student.guardians?.full_name || null,
            guardian_relationship: student.guardians?.relationship || null,
            guardian_phone: student.guardians?.phone || null,
            guardian_email: student.guardians?.email || null,
            guardian_address: student.guardians?.address || null
        }));

        res.json(students);
    } catch (error) {
        console.error('Error loading students:', error);
        res.status(500).json({ message: 'Failed to load students' });
    }
});

// ============================================================
// GET SINGLE STUDENT
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        let query = supabase
            .from('students')
            .select('*')
            .order('student_id', { ascending: false });

        if (isPrimaryManager(userRole)) {
            query = query.in('school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('school_section', ['JSS', 'SSS', 'Secondary']);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Fetch all guardians separately
        const { data: guardians } = await supabase
            .from('guardians')
            .select('guardian_id, full_name, relationship, phone, email, address');

        // Create guardians map
        const guardiansMap = {};
        (guardians || []).forEach(g => {
            guardiansMap[g.guardian_id] = g;
        });

        // Fetch all classes separately
        const { data: classes } = await supabase
            .from('classes')
            .select('class_id, class_name, arm, school_section');

        const classesMap = {};
        (classes || []).forEach(c => {
            classesMap[c.class_id] = c;
        });

        // Combine data
        const students = (data || []).map(student => ({
            ...student,
            class_name: classesMap[student.class_id]?.class_name || null,
            arm: classesMap[student.class_id]?.arm || null,
            guardian_name: guardiansMap[student.guardian_id]?.full_name || null,
            guardian_relationship: guardiansMap[student.guardian_id]?.relationship || null,
            guardian_phone: guardiansMap[student.guardian_id]?.phone || null,
            guardian_email: guardiansMap[student.guardian_id]?.email || null,
            guardian_address: guardiansMap[student.guardian_id]?.address || null
        }));

        res.json(students);
    } catch (error) {
        console.error('Error loading students:', error);
        res.status(500).json({ message: 'Failed to load students' });
    }
});
// ============================================================
// GET STUDENT DOCUMENTS
// ============================================================
router.get('/:studentId/documents', authenticateToken, async (req, res) => {
    const studentId = parseInt(req.params.studentId);
    if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student ID' });

    try {
        const { data, error } = await supabase
            .from('student_documents')
            .select('*')
            .eq('student_id', studentId);

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('Error loading documents:', error);
        res.status(500).json({ message: 'Failed to load documents' });
    }
});
// ============================================================
// REGISTER STUDENT
// ============================================================
router.post('/register', authenticateToken, requireRoles(...MANAGEMENT_ROLES),
    upload.fields([
        { name: 'student_photo', maxCount: 1 },
        { name: 'result_file', maxCount: 1 },
        { name: 'birth_certificate_file', maxCount: 1 },
        { name: 'testimonial_file', maxCount: 1 },
        { name: 'transfer_file', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const userRole = req.user.role_name || '';

            console.log('BODY RECEIVED:', req.body);
            console.log('FILES RECEIVED:', req.files ? Object.keys(req.files) : 'None');

            const { data: currentYear, error: yearError } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('is_current', true)
                .single();

            if (yearError || !currentYear) {
                return res.status(400).json({ message: 'No current academic year set.' });
            }

            const {
                admission_number, first_name, middle_name, last_name,
                gender, date_of_birth, phone, address, class_id,
                admission_date, previous_school, nationality,
                emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
                guardian_name, guardian_relationship, guardian_phone, guardian_email, guardian_address,
                parent_name, parent_relationship, parent_phone, parent_email, parent_address
            } = req.body;

            const finalGuardianName = guardian_name || parent_name;
            const finalGuardianRelationship = guardian_relationship || parent_relationship;
            const finalGuardianPhone = guardian_phone || parent_phone || null;
            const finalGuardianEmail = guardian_email || parent_email || null;
            const finalGuardianAddress = guardian_address || parent_address || null;

            console.log('Guardian fields:', { finalGuardianName, finalGuardianRelationship });

            if (!admission_number || !first_name || !last_name || !class_id) {
                return res.status(400).json({ message: 'Admission number, first name, last name and class are required' });
            }

            if (!finalGuardianName || !finalGuardianRelationship) {
                return res.status(400).json({ message: 'Guardian name and relationship are required' });
            }

            const { data: classData, error: classError } = await supabase
                .from('classes')
                .select('class_id, class_name, arm, school_section')
                .eq('class_id', Number(class_id))
                .single();

            if (classError || !classData) {
                return res.status(400).json({ message: 'Selected class does not exist.' });
            }

            const section = classData.school_section;
            if (isPrimaryManager(userRole) && !['Nursery', 'Primary'].includes(section)) {
                return res.status(403).json({ message: 'Access denied to this sector.' });
            }
            if (isSecondaryManager(userRole) && !['JSS', 'SSS', 'Secondary'].includes(section)) {
                return res.status(403).json({ message: 'Access denied to this sector.' });
            }

            const { data: existing } = await supabase
                .from('students')
                .select('student_id')
                .eq('admission_number', admission_number)
                .maybeSingle();

            if (existing) {
                return res.status(409).json({ message: 'A student with this admission number already exists.' });
            }

            // Create guardian
            const { data: guardian, error: guardianError } = await supabase
                .from('guardians')
                .insert({
                    full_name: finalGuardianName,
                    relationship: finalGuardianRelationship,
                    phone: finalGuardianPhone,
                    email: finalGuardianEmail,
                    address: finalGuardianAddress
                })
                .select()
                .single();

            if (guardianError) {
                console.error('Guardian creation error:', guardianError);
                return res.status(500).json({ message: 'Failed to create guardian: ' + guardianError.message });
            }

            console.log('Guardian created with ID:', guardian.guardian_id);

            // Upload photo
            let photoUrl = null;
            if (req.files && req.files.student_photo) {
                const photoFile = req.files.student_photo[0];
                const fileName = `student_${admission_number}_${Date.now()}.jpg`;
                photoUrl = await uploadFileToSupabase(photoFile, 'student_photos', 'student-photos', fileName);
            }

            // Create student
            const { data: student, error: insertError } = await supabase
                .from('students')
                .insert({
                    admission_number,
                    first_name,
                    middle_name: middle_name || null,
                    last_name,
                    gender: gender || null,
                    date_of_birth: date_of_birth || null,
                    phone: phone || null,
                    address: address || null,
                    class_id: Number(class_id),
                    guardian_id: guardian.guardian_id,
                    admission_date: admission_date || null,
                    student_status: 'Pending',
                    nationality: nationality || 'Sierra Leonean',
                    previous_school: previous_school || null,
                    emergency_contact_name: emergency_contact_name || null,
                    emergency_contact_phone: emergency_contact_phone || null,
                    emergency_contact_relationship: emergency_contact_relationship || null,
                    registration_date: new Date().toISOString(),
                    photo_url: photoUrl,
                    academic_year_id: currentYear.academic_year_id,
                    school_section: section
                })
                .select()
                .single();

            if (insertError) {
                console.error('Student creation error:', insertError);
                await supabase.from('guardians').delete().eq('guardian_id', guardian.guardian_id);
                return res.status(500).json({ message: 'Failed to create student: ' + insertError.message });
            }

            console.log('Student created with ID:', student.student_id);

            // UPDATE GUARDIAN with student_id
            const { error: guardianUpdateError } = await supabase
                .from('guardians')
                .update({
                    student_id: student.student_id,
                    emergency_contact_name: emergency_contact_name || null,
                    emergency_contact_phone: emergency_contact_phone || null,
                    emergency_contact_relationship: emergency_contact_relationship || null
                })
                .eq('guardian_id', guardian.guardian_id);

            if (guardianUpdateError) {
                console.error('Guardian update error:', guardianUpdateError);
            } else {
                console.log('✅ Guardian updated with student_id:', student.student_id);
            }

            // Upload documents
            const documentFields = {
                'result_file': 'results',
                'birth_certificate_file': 'birth-certificates',
                'testimonial_file': 'testimonials',
                'transfer_file': 'transfer-forms'
            };

            if (req.files) {
                for (const [fieldName, folder] of Object.entries(documentFields)) {
                    if (req.files[fieldName]) {
                        const file = req.files[fieldName][0];
                        const fileName = `student_${student.student_id}_${fieldName}_${Date.now()}.${file.originalname.split('.').pop()}`;
                        await uploadFileToSupabase(file, 'student_files', folder, fileName);
                    }
                }
            }

            // Create approval record
            const { error: approvalError } = await supabase
                .from('record_approvals')
                .insert({
                    record_type: 'Student',
                    record_id: student.student_id,
                    approval_status: 'Pending',
                    created_by: req.user.user_id,
                    created_at: new Date().toISOString(),
                    school_section: section
                });

            if (approvalError) {
                console.error('Approval creation error:', approvalError);
                await supabase.from('students').delete().eq('student_id', student.student_id);
                await supabase.from('guardians').delete().eq('guardian_id', guardian.guardian_id);
                return res.status(500).json({ message: 'Failed to create approval record' });
            }

            console.log('✅ Registration complete. Student:', student.student_id, 'Guardian:', guardian.guardian_id);

            res.status(201).json({
                message: 'Student registered successfully!',
                student_id: student.student_id,
                guardian_id: guardian.guardian_id,
                status: 'Pending',
                school_section: section,
                class_name: classData.class_name,
                arm: classData.arm
            });

        } catch (error) {
            console.error('Student registration error:', error);
            res.status(500).json({ message: 'Failed to register student: ' + error.message });
        }
    }
);

// ============================================================
// UPDATE STUDENT
// ============================================================
router.put('/:studentId', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    const studentId = parseInt(req.params.studentId);
    if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student ID' });

    const {
        admission_number, first_name, middle_name, last_name, gender,
        date_of_birth, phone, address, class_id, admission_date,
        student_status, nationality, previous_school,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship
    } = req.body;

    if (!admission_number || !first_name || !last_name) {
        return res.status(400).json({ message: 'Admission number, first name and last name are required' });
    }

    try {
        const { data: student, error: updateError } = await supabase
            .from('students')
            .update({
                admission_number, first_name,
                middle_name: middle_name || null,
                last_name, gender: gender || null,
                date_of_birth: date_of_birth || null,
                phone: phone || null, address: address || null,
                class_id: class_id || null,
                admission_date: admission_date || null,
                student_status: student_status || 'Active',
                nationality: nationality || null,
                previous_school: previous_school || null,
                emergency_contact_name: emergency_contact_name || null,
                emergency_contact_phone: emergency_contact_phone || null,
                emergency_contact_relationship: emergency_contact_relationship || null
            })
            .eq('student_id', studentId)
            .select()
            .single();

        if (updateError) throw updateError;
        res.json({ message: 'Student updated successfully', student });
    } catch (error) {
        console.error('Student update error:', error);
        res.status(500).json({ message: 'Failed to update student' });
    }
});

// ============================================================
// RE-APPROVE STUDENT
// ============================================================
router.put('/:studentId/reapprove', authenticateToken, requireRoles('Administrator', 'Proprietor'), async (req, res) => {
    const studentId = parseInt(req.params.studentId);
    if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student ID' });

    try {
        await supabase.from('students').update({ student_status: 'Pending' }).eq('student_id', studentId);
        await supabase.from('record_approvals').delete().eq('record_id', studentId).eq('record_type', 'Student');

        const { error: approvalError } = await supabase
            .from('record_approvals')
            .insert({
                record_type: 'Student',
                record_id: studentId,
                approval_status: 'Pending',
                created_by: req.user.user_id,
                created_at: new Date().toISOString()
            });

        if (approvalError) throw approvalError;

        res.json({ message: 'Student sent for re-approval successfully', student_id: studentId, status: 'Pending' });
    } catch (error) {
        console.error('Re-approve error:', error);
        res.status(500).json({ message: 'Failed to re-approve student: ' + error.message });
    }
});

module.exports = router;