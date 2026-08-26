const express = require('express');
const multer = require('multer');
const supabase = require('../Config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, PDF, DOC, DOCX are allowed.'));
        }
    }
});

// Helper function to upload file to Supabase Storage
async function uploadFileToSupabase(file, folder, fileName) {
    if (!file) return null;
    
    try {
        const filePath = `${folder}/${fileName}`;
        const { data, error } = await supabase
            .storage
            .from('student_files')
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                cacheControl: '3600',
                upsert: true
            });

        if (error) {
            console.error('Upload error:', error);
            return null;
        }

        const { data: urlData } = supabase
            .storage
            .from('student_files')
            .getPublicUrl(filePath);

        return urlData.publicUrl;
    } catch (error) {
        console.error('File upload error:', error);
        return null;
    }
}

// ============================================================
// GET ALL STUDENTS (with Academic Year filter)
// ============================================================
router.get(
    '/',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const { search, class_id, status, academic_year_id } = req.query;

            let query = supabase
                .from('students')
                .select(`
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    date_of_birth,
                    phone,
                    address,
                    class_id,
                    guardian_id,
                    admission_date,
                    student_status,
                    photo_url,
                    created_at,
                    nationality,
                    previous_school,
                    emergency_contact_name,
                    emergency_contact_phone,
                    emergency_contact_relationship,
                    registration_date,
                    academic_year_id,
                    classes:class_id (
                        class_name,
                        arm
                    ),
                    guardians:guardian_id (
                        full_name,
                        relationship,
                        phone,
                        email,
                        address
                    )
                `);

            // Academic Year Filter - if not specified, use current
            if (!academic_year_id) {
                const { data: currentYear } = await supabase
                    .from('academic_years')
                    .select('academic_year_id')
                    .eq('is_current', true)
                    .single();

                if (currentYear) {
                    query = query.eq('academic_year_id', currentYear.academic_year_id);
                }
            } else {
                query = query.eq('academic_year_id', academic_year_id);
            }

            // Search filter
            if (search) {
                query = query.or(`admission_number.ilike.%${search}%,first_name.ilike.%${search}%,middle_name.ilike.%${search}%,last_name.ilike.%${search}%`);
            }

            // Class filter
            if (class_id) {
                query = query.eq('class_id', class_id);
            }

            // Status filter
            if (status) {
                query = query.eq('student_status', status);
            }

            query = query.order('admission_number', { ascending: true });

            const { data, error } = await query;

            if (error) throw error;

            const students = data.map(student => ({
                student_id: student.student_id,
                admission_number: student.admission_number,
                first_name: student.first_name,
                middle_name: student.middle_name,
                last_name: student.last_name,
                gender: student.gender,
                date_of_birth: student.date_of_birth,
                phone: student.phone,
                address: student.address,
                class_id: student.class_id,
                guardian_id: student.guardian_id,
                admission_date: student.admission_date,
                student_status: student.student_status,
                photo_url: student.photo_url,
                created_at: student.created_at,
                nationality: student.nationality,
                previous_school: student.previous_school,
                emergency_contact_name: student.emergency_contact_name,
                emergency_contact_phone: student.emergency_contact_phone,
                emergency_contact_relationship: student.emergency_contact_relationship,
                registration_date: student.registration_date,
                academic_year_id: student.academic_year_id,
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
            res.status(500).json({
                message: 'Failed to load students'
            });
        }
    }
);

// ============================================================
// GET SINGLE STUDENT (For Review/Edit)
// ============================================================
router.get(
    '/:studentId',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {
        const studentId = parseInt(req.params.studentId);

        if (Number.isNaN(studentId)) {
            return res.status(400).json({
                message: 'Invalid student ID'
            });
        }

        try {
            const { data: student, error } = await supabase
                .from('students')
                .select(`
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    gender,
                    date_of_birth,
                    phone,
                    address,
                    class_id,
                    guardian_id,
                    admission_date,
                    student_status,
                    photo_url,
                    nationality,
                    previous_school,
                    emergency_contact_name,
                    emergency_contact_phone,
                    emergency_contact_relationship,
                    registration_date,
                    academic_year_id,
                    classes:class_id (
                        class_name,
                        arm
                    ),
                    guardians:guardian_id (
                        full_name,
                        relationship,
                        phone,
                        email,
                        address
                    )
                `)
                .eq('student_id', studentId)
                .single();

            if (error || !student) {
                return res.status(404).json({
                    message: 'Student not found'
                });
            }

            // Format the response
            const formattedStudent = {
                student_id: student.student_id,
                admission_number: student.admission_number,
                first_name: student.first_name,
                middle_name: student.middle_name,
                last_name: student.last_name,
                gender: student.gender,
                date_of_birth: student.date_of_birth,
                phone: student.phone,
                address: student.address,
                class_id: student.class_id,
                guardian_id: student.guardian_id,
                admission_date: student.admission_date,
                student_status: student.student_status,
                photo_url: student.photo_url,
                nationality: student.nationality,
                previous_school: student.previous_school,
                emergency_contact_name: student.emergency_contact_name,
                emergency_contact_phone: student.emergency_contact_phone,
                emergency_contact_relationship: student.emergency_contact_relationship,
                registration_date: student.registration_date,
                academic_year_id: student.academic_year_id,
                class_name: student.classes?.class_name || null,
                arm: student.classes?.arm || null,
                guardian_name: student.guardians?.full_name || null,
                guardian_relationship: student.guardians?.relationship || null,
                guardian_phone: student.guardians?.phone || null,
                guardian_email: student.guardians?.email || null,
                guardian_address: student.guardians?.address || null
            };

            res.json(formattedStudent);

        } catch (error) {
            console.error('Error getting student:', error);
            res.status(500).json({
                message: 'Failed to load student data'
            });
        }
    }
);

// ============================================================
// CREATE NEW STUDENT REGISTRATION (WITH ACADEMIC YEAR)
// ============================================================
router.post(
    '/register',
    authenticateToken,
    requireRoles('Manager', 'Administrator'),
    upload.fields([
        { name: 'photo', maxCount: 1 },
        { name: 'result_file', maxCount: 1 },
        { name: 'birth_certificate', maxCount: 1 },
        { name: 'testimonial', maxCount: 1 },
        { name: 'transfer_form', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            console.log('📝 Registration started');
            console.log('📦 Body:', req.body);
            console.log('📎 Files:', req.files ? Object.keys(req.files) : 'None');

            // Get current academic year
            const { data: currentYear, error: yearError } = await supabase
                .from('academic_years')
                .select('academic_year_id')
                .eq('is_current', true)
                .single();

            if (yearError || !currentYear) {
                return res.status(400).json({
                    message: 'No current academic year set. Please contact administrator.'
                });
            }

            const {
                admission_number,
                first_name,
                middle_name,
                last_name,
                gender,
                date_of_birth,
                phone,
                address,
                class_id,
                admission_date,
                previous_school,
                student_status,
                nationality,
                emergency_contact_name,
                emergency_contact_phone,
                emergency_contact_relationship,
                parent_name,
                parent_relationship,
                parent_phone,
                parent_email,
                parent_address
            } = req.body;

            // Required fields
            if (!admission_number || !first_name || !last_name) {
                return res.status(400).json({
                    message: 'Admission number, first name and last name are required'
                });
            }

            if (!parent_name || !parent_relationship) {
                return res.status(400).json({
                    message: 'Parent/Guardian name and relationship are required'
                });
            }

            // Check duplicate admission number
            const { data: existing, error: checkError } = await supabase
                .from('students')
                .select('student_id')
                .eq('admission_number', admission_number)
                .single();

            if (existing) {
                return res.status(409).json({
                    message: 'A student with this admission number already exists'
                });
            }

            // ====================================================
            // 1. CREATE PARENT/GUARDIAN FIRST
            // ====================================================
            const { data: guardian, error: guardianError } = await supabase
                .from('guardians')
                .insert({
                    full_name: parent_name,
                    relationship: parent_relationship,
                    phone: parent_phone || null,
                    email: parent_email || null,
                    address: parent_address || null
                })
                .select()
                .single();

            if (guardianError) {
                console.error('Guardian creation error:', guardianError);
                return res.status(500).json({
                    message: 'Failed to create guardian record'
                });
            }

            console.log('✅ Guardian created:', guardian.guardian_id);

            // ====================================================
            // 2. UPLOAD PHOTO TO SUPABASE STORAGE
            // ====================================================
            let photoUrl = null;
            if (req.files && req.files.photo) {
                const photoFile = req.files.photo[0];
                const fileName = `student_${admission_number}_${Date.now()}.jpg`;
                photoUrl = await uploadFileToSupabase(photoFile, 'student-photos', fileName);
                console.log('📸 Photo uploaded:', photoUrl);
            }

            // ====================================================
            // 3. CREATE STUDENT WITH GUARDIAN ID & ACADEMIC YEAR
            // ====================================================
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
                    class_id: class_id || null,
                    guardian_id: guardian.guardian_id,
                    admission_date: admission_date || null,
                    student_status: student_status || 'Pending',
                    nationality: nationality || null,
                    previous_school: previous_school || null,
                    emergency_contact_name: emergency_contact_name || null,
                    emergency_contact_phone: emergency_contact_phone || null,
                    emergency_contact_relationship: emergency_contact_relationship || null,
                    registration_date: new Date().toISOString(),
                    photo_url: photoUrl,
                    academic_year_id: currentYear.academic_year_id
                })
                .select()
                .single();

            if (insertError) {
                console.error('Student creation error:', insertError);
                await supabase
                    .from('guardians')
                    .delete()
                    .eq('guardian_id', guardian.guardian_id);
                return res.status(500).json({
                    message: 'Failed to create student record'
                });
            }

            console.log('✅ Student created:', student.student_id);

            // ====================================================
            // 4. UPLOAD DOCUMENTS
            // ====================================================
            const documentTypes = {
                'result_file': 'results',
                'birth_certificate': 'birth-certificates',
                'testimonial': 'testimonials',
                'transfer_form': 'transfer-forms'
            };

            if (req.files) {
                for (const [fieldName, folder] of Object.entries(documentTypes)) {
                    if (req.files[fieldName]) {
                        const file = req.files[fieldName][0];
                        const fileName = `student_${student.student_id}_${fieldName}_${Date.now()}.${file.originalname.split('.').pop()}`;
                        await uploadFileToSupabase(file, folder, fileName);
                        console.log(`📄 ${fieldName} uploaded`);
                    }
                }
            }

            // ====================================================
            // 5. CREATE APPROVAL RECORD
            // ====================================================
            const { error: approvalError } = await supabase
                .from('record_approvals')
                .insert({
                    record_type: 'Student',
                    record_id: student.student_id,
                    approval_status: 'Pending',
                    created_by: req.user.user_id,
                    created_at: new Date().toISOString()
                });

            if (approvalError) {
                console.error('Approval creation error:', approvalError);
                await supabase
                    .from('students')
                    .delete()
                    .eq('student_id', student.student_id);
                await supabase
                    .from('guardians')
                    .delete()
                    .eq('guardian_id', guardian.guardian_id);
                return res.status(500).json({
                    message: 'Failed to create approval record'
                });
            }

            console.log('✅ Approval record created');

            res.status(201).json({
                message: 'Student registered successfully with Parent/Guardian',
                student_id: student.student_id,
                guardian_id: guardian.guardian_id,
                status: 'Pending',
                academic_year: currentYear
            });

        } catch (error) {
            console.error('❌ Student registration error:', error);
            res.status(500).json({
                message: 'Failed to register student: ' + error.message
            });
        }
    }
);

// ============================================================
// UPDATE STUDENT
// ============================================================
router.put(
    '/:student_id',
    authenticateToken,
    requireRoles('Administrator'),
    async (req, res) => {
        const studentId = parseInt(req.params.student_id);

        if (Number.isNaN(studentId)) {
            return res.status(400).json({
                message: 'Invalid student ID'
            });
        }

        const {
            admission_number,
            first_name,
            middle_name,
            last_name,
            gender,
            date_of_birth,
            phone,
            address,
            class_id,
            guardian_id,
            admission_date,
            student_status,
            nationality,
            previous_school,
            emergency_contact_name,
            emergency_contact_phone,
            emergency_contact_relationship
        } = req.body;

        if (!admission_number || !first_name || !last_name) {
            return res.status(400).json({
                message: 'Admission number, first name and last name are required'
            });
        }

        try {
            const { data: existing, error: checkError } = await supabase
                .from('students')
                .select('student_id')
                .eq('student_id', studentId)
                .single();

            if (!existing) {
                return res.status(404).json({
                    message: 'Student not found'
                });
            }

            const { data: duplicate, error: dupError } = await supabase
                .from('students')
                .select('student_id')
                .eq('admission_number', admission_number)
                .neq('student_id', studentId)
                .single();

            if (duplicate) {
                return res.status(409).json({
                    message: 'Another student already uses this admission number'
                });
            }

            const { data: student, error: updateError } = await supabase
                .from('students')
                .update({
                    admission_number,
                    first_name,
                    middle_name: middle_name || null,
                    last_name,
                    gender: gender || null,
                    date_of_birth: date_of_birth || null,
                    phone: phone || null,
                    address: address || null,
                    class_id: class_id || null,
                    guardian_id: guardian_id || null,
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

            res.json({
                message: 'Student updated successfully',
                student: student
            });

        } catch (error) {
            console.error('Student update error:', error);
            res.status(500).json({
                message: 'Failed to update student'
            });
        }
    }
);

// ============================================================
// RE-APPROVE STUDENT (FIXED - Direct approach)
// ============================================================
router.put(
    '/:studentId/reapprove',
    authenticateToken,
    requireRoles('Administrator', 'Proprietor'),
    async (req, res) => {
        const studentId = parseInt(req.params.studentId);

        if (Number.isNaN(studentId)) {
            return res.status(400).json({
                message: 'Invalid student ID'
            });
        }

        try {
            console.log('🔄 Re-approving student:', studentId);

            // 1. Update student status to Pending
            const { error: updateError } = await supabase
                .from('students')
                .update({ student_status: 'Pending' })
                .eq('student_id', studentId);

            if (updateError) {
                console.error('❌ Status update error:', updateError);
                return res.status(500).json({
                    message: 'Failed to update student status: ' + updateError.message
                });
            }
            console.log('✅ Student status changed to Pending');

            // 2. Delete ALL existing approvals for this student
            const { error: deleteError } = await supabase
                .from('record_approvals')
                .delete()
                .eq('record_id', studentId)
                .eq('record_type', 'Student');

            if (deleteError) {
                console.error('❌ Delete error:', deleteError);
                // Continue anyway
            }
            console.log('✅ Deleted existing approval records');

            // 3. Insert a new approval record using raw SQL approach
            // First, get the user_id from the token
            const userId = req.user.user_id;
            
            const { data: newApproval, error: approvalError } = await supabase
                .from('record_approvals')
                .insert({
                    record_type: 'Student',
                    record_id: studentId,
                    approval_status: 'Pending',
                    created_by: userId,
                    created_at: new Date().toISOString()
                })
                .select();

            if (approvalError) {
                console.error('❌ Approval creation error:', approvalError);
                return res.status(500).json({
                    message: 'Failed to create approval record: ' + approvalError.message
                });
            }

            console.log('✅ New approval record created:', newApproval);

            // 4. Verify the approval was created
            const { data: verify, error: verifyError } = await supabase
                .from('record_approvals')
                .select('*')
                .eq('record_id', studentId)
                .eq('record_type', 'Student')
                .eq('approval_status', 'Pending');

            console.log('🔍 Verification:', verify);

            res.json({
                message: 'Student sent for re-approval successfully',
                student_id: studentId,
                approval_id: newApproval?.[0]?.approval_id || null,
                status: 'Pending'
            });

        } catch (error) {
            console.error('❌ Re-approve error:', error);
            res.status(500).json({
                message: 'Failed to re-approve student: ' + error.message
            });
        }
    }
);
// ============================================================
// GET STUDENT FINANCE SUMMARY
// ============================================================
router.get(
    '/students',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            // Get all students with their classes
            const { data: students, error: studentsError } = await supabase
                .from('students')
                .select(`
                    student_id,
                    admission_number,
                    first_name,
                    middle_name,
                    last_name,
                    classes:class_id (
                        class_name,
                        arm
                    )
                `)
                .not('student_status', 'in', '("Withdrawn","Deleted")')
                .order('first_name');

            if (studentsError) throw studentsError;

            const { data: balances, error: balancesError } = await supabase
                .from('student_fee_balances')
                .select('*');

            if (balancesError) throw balancesError;

            const result = students.map(student => {
                const studentBalances = balances.filter(b => b.student_id === student.student_id);
                
                const total_expected = studentBalances.reduce((sum, b) => sum + (b.amount_due || 0), 0);
                const total_paid = studentBalances.reduce((sum, b) => sum + (b.total_paid || 0), 0);
                const total_balance = studentBalances.reduce((sum, b) => sum + (b.balance || 0), 0);

                let payment_status = 'Unpaid';
                if (total_expected > 0 && total_balance <= 0) {
                    payment_status = 'Paid';
                } else if (total_paid > 0) {
                    payment_status = 'Partially Paid';
                }

                return {
                    student_id: student.student_id,
                    admission_number: student.admission_number,
                    student_name: [student.first_name, student.middle_name, student.last_name]
                        .filter(Boolean).join(' ').trim(),
                    class_name: student.classes?.class_name || null,
                    arm: student.classes?.arm || null,
                    total_expected,
                    total_paid,
                    total_balance,
                    payment_status
                };
            });

            res.json({
                success: true,
                students: result
            });

        } catch (error) {
            console.error('GET STUDENT FINANCE SUMMARY ERROR:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to load student finance summary.',
                error: error.message
            });
        }
    }
);

// ============================================================
// GET FEE CATEGORY SUMMARY
// ============================================================
router.get(
    '/fee-summary',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const { data: feeTypes, error: feeError } = await supabase
                .from('fee_types')
                .select('fee_type_id, fee_name')
                .eq('is_active', true)
                .order('fee_name');

            if (feeError) throw feeError;

            const { data: balances, error: balanceError } = await supabase
                .from('student_fee_balances')
                .select('fee_name, amount_due, total_paid, balance');

            if (balanceError) throw balanceError;

            const groupedData = feeTypes.map(ft => {
                const feeBalances = balances.filter(b => b.fee_name === ft.fee_name);
                
                const total_expected = feeBalances.reduce((sum, b) => sum + (b.amount_due || 0), 0);
                const total_collected = feeBalances.reduce((sum, b) => sum + (b.total_paid || 0), 0);
                const total_outstanding = feeBalances.reduce((sum, b) => sum + (b.balance || 0), 0);

                return {
                    fee_type_id: ft.fee_type_id,
                    fee_name: ft.fee_name,
                    total_expected: Number(total_expected),
                    total_collected: Number(total_collected),
                    total_outstanding: Number(total_outstanding)
                };
            });

            res.json({
                success: true,
                feeSummary: groupedData
            });

        } catch (error) {
            console.error('FEE CATEGORY SUMMARY ERROR:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to load fee category summary.',
                error: error.message
            });
        }
    }
);

module.exports = router;