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

const MANAGEMENT_ROLES = ['Proprietor', 'Administrator', 'Manager-Primary', 'Manager-Secondary'];

// ============================================================
// HELPER: Get sector from role
// ============================================================
function getSectorFromRole(roleName) {
    if (roleName === 'Manager-Primary' || roleName === 'Finance Officer (Primary)') {
        return 'primary';
    } else if (roleName === 'Manager-Secondary' || roleName === 'Finance Officer (Secondary)') {
        return 'secondary';
    }
    return null;
}

// ============================================================
// GET ALL STUDENTS (Role-filtered with sector)
// ============================================================
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userRole = req.user.role_name || '';
        const { sector } = req.query;
        
        let query = supabase
            .from('students')
            .select(`
                *,
                classes!inner (
                    class_id,
                    class_name,
                    arm,
                    school_section
                )
            `)
            .order('student_id', { ascending: false });

        // Sector filtering from query param
        if (sector) {
            query = query.eq('classes.school_section', sector);
        }

        // Role-based filtering
        if (isPrimaryManager(userRole)) {
            query = query.in('classes.school_section', ['Nursery', 'Primary']);
        } else if (isSecondaryManager(userRole)) {
            query = query.in('classes.school_section', ['JSS', 'SSS', 'Secondary']);
        }

        const { data, error } = await query;
        if (error) throw error;

        const { data: guardians } = await supabase
            .from('guardians')
            .select('guardian_id, full_name, relationship, phone, email, address, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship');

        const guardiansMap = {};
        (guardians || []).forEach(g => { guardiansMap[g.guardian_id] = g; });

        const students = (data || []).map(student => ({
            ...student,
            class_name: student.classes?.class_name || null,
            arm: student.classes?.arm || null,
            school_section: student.classes?.school_section || null,
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
// GET STUDENTS FOR FINANCE (with sector and academic year filtering)
// ============================================================
router.get('/finance', authenticateToken, async (req, res) => {
    try {
        const { sector, class_id } = req.query;
        const userRole = req.user.role_name || '';

        /*
         * ---------------------------------------------------------
         * NORMALIZE SECTOR
         * ---------------------------------------------------------
         * Frontend may send:
         *   primary
         *   Primary
         *   secondary
         *   Secondary
         *
         * Database uses values such as:
         *   Nursery
         *   Primary
         *   JSS
         *   SSS
         *   Secondary
         */
        const normalizedSector = String(sector || '').trim().toLowerCase();

        let sectorValues = null;

        if (normalizedSector === 'primary') {
            sectorValues = ['Nursery', 'Primary'];
        } else if (normalizedSector === 'secondary') {
            sectorValues = ['JSS', 'SSS', 'Secondary'];
        }

        /*
         * ---------------------------------------------------------
         * LOAD STUDENTS
         * ---------------------------------------------------------
         * We deliberately do NOT filter students based on whether
         * they have paid a fee. Every relevant student must appear.
         */
        let query = supabase
            .from('students')
            .select(`
                student_id,
                first_name,
                middle_name,
                last_name,
                admission_number,
                class_id,
                student_status,
                school_section,
                classes!inner (
                    class_id,
                    class_name,
                    arm,
                    school_section
                )
            `)
            .order('student_id', { ascending: false });

        /*
         * Sector requested by frontend
         */
        if (sectorValues) {
            query = query.in(
                'classes.school_section',
                sectorValues
            );
        }

        /*
         * Specific class filter
         */
        if (class_id) {
            query = query.eq('class_id', class_id);
        }

        /*
         * Finance Officer permissions
         */
        if (userRole === 'Finance Officer (Primary)') {
            query = query.in(
                'classes.school_section',
                ['Nursery', 'Primary']
            );
        } else if (userRole === 'Finance Officer (Secondary)') {
            query = query.in(
                'classes.school_section',
                ['JSS', 'SSS', 'Secondary']
            );
        }

        /*
         * IMPORTANT:
         * Keep Active students for the normal finance list.
         * We are NOT filtering by payment status.
         */
        query = query.eq('student_status', 'Active');

        const {
            data: students,
            error: studentError
        } = await query;

        if (studentError) {
            console.error(
                'Finance student query error:',
                studentError
            );

            throw studentError;
        }

        /*
         * No students
         */
        if (!students || students.length === 0) {
            return res.json({
                students: []
            });
        }

        const studentIds = students.map(
            student => student.student_id
        );

        /*
         * ---------------------------------------------------------
         * LOAD STUDENT FEES
         * ---------------------------------------------------------
         */
        const {
            data: feeRecords,
            error: feeError
        } = await supabase
            .from('student_fees')
            .select(`
                student_fee_id,
                student_id,
                fee_type_id,
                amount_due,
                academic_year_id,
                term_id,
                fee_types (
                    fee_name
                )
            `)
            .in('student_id', studentIds);

        if (feeError) {
            console.error(
                'Finance fee query error:',
                feeError
            );

            throw feeError;
        }

        /*
         * ---------------------------------------------------------
         * LOAD PAYMENTS
         * ---------------------------------------------------------
         *
         * We retrieve the payments for these students and then
         * count ONLY approved payments.
         *
         * This protects us against differences such as:
         *   approved
         *   Approved
         *   APPROVED
         */
        const {
            data: paymentRecords,
            error: paymentError
        } = await supabase
            .from('payments')
            .select(`
                payment_id,
                student_id,
                student_fee_id,
                amount_paid,
                payment_date,
                payment_method,
                payment_slip_number,
                bank_reference,
                purpose,
                academic_year_id,
                approval_status
            `)
            .in('student_id', studentIds);

        if (paymentError) {
            console.error(
                'Finance payment query error:',
                paymentError
            );

            throw paymentError;
        }

        /*
         * ---------------------------------------------------------
         * CREATE FINANCE MAP
         * ---------------------------------------------------------
         */
        const financeMap = {};

        studentIds.forEach(studentId => {
            financeMap[studentId] = {
                total_expected: 0,
                total_paid: 0,
                total_balance: 0,

                paid_fees: 0,
                partially_paid_fees: 0,
                unpaid_fees: 0,

                payment_count: 0,

                fee_details: []
            };
        });

        /*
         * ---------------------------------------------------------
         * ADD FEES
         * ---------------------------------------------------------
         */
        (feeRecords || []).forEach(fee => {
            const studentId = fee.student_id;

            if (!financeMap[studentId]) {
                return;
            }

            const amountDue = Number(
                fee.amount_due || 0
            );

            financeMap[studentId].total_expected += amountDue;

            financeMap[studentId].fee_details.push({
                student_fee_id: fee.student_fee_id,
                fee_type_id: fee.fee_type_id,
                fee_name: fee.fee_types?.fee_name || 'Unknown Fee',
                amount_due: amountDue,
                amount_paid: 0,
                balance: amountDue
            });
        });

        /*
         * ---------------------------------------------------------
         * ADD APPROVED PAYMENTS
         * ---------------------------------------------------------
         */
        (paymentRecords || []).forEach(payment => {

            const studentId = payment.student_id;

            if (!financeMap[studentId]) {
                return;
            }

            const approvalStatus = String(
                payment.approval_status || ''
            ).trim().toLowerCase();

            /*
             * ONLY APPROVED PAYMENTS COUNT
             */
            if (approvalStatus !== 'approved') {
                return;
            }

            const amountPaid = Number(
                payment.amount_paid || 0
            );

            financeMap[studentId].total_paid += amountPaid;

            financeMap[studentId].payment_count += 1;

            /*
             * If the payment is linked to a specific student fee,
             * add it to that fee's payment amount.
             */
            if (payment.student_fee_id) {

                const fee = financeMap[studentId]
                    .fee_details
                    .find(
                        item =>
                            item.student_fee_id ===
                            payment.student_fee_id
                    );

                if (fee) {
                    fee.amount_paid += amountPaid;
                }
            }
        });

        /*
         * ---------------------------------------------------------
         * CALCULATE BALANCES AND FEE STATUSES
         * ---------------------------------------------------------
         */
        studentIds.forEach(studentId => {

            const finance = financeMap[studentId];

            /*
             * Calculate individual fee balances
             */
            finance.fee_details.forEach(fee => {

                fee.balance =
                    Math.max(
                        0,
                        fee.amount_due -
                        fee.amount_paid
                    );

                if (fee.amount_paid >= fee.amount_due) {
                    finance.paid_fees += 1;
                } else if (fee.amount_paid > 0) {
                    finance.partially_paid_fees += 1;
                } else {
                    finance.unpaid_fees += 1;
                }
            });

            /*
             * Overall student balance
             */
            finance.total_balance =
                Math.max(
                    0,
                    finance.total_expected -
                    finance.total_paid
                );
        });

        /*
         * ---------------------------------------------------------
         * BUILD RESPONSE
         * ---------------------------------------------------------
         */
        const result = students.map(student => {

            const studentId = student.student_id;

            const finance =
                financeMap[studentId] || {
                    total_expected: 0,
                    total_paid: 0,
                    total_balance: 0,
                    paid_fees: 0,
                    partially_paid_fees: 0,
                    unpaid_fees: 0,
                    payment_count: 0,
                    fee_details: []
                };

            /*
             * Overall payment status
             */
            let paymentStatus = 'Unpaid';

            if (finance.total_expected <= 0) {
                paymentStatus = 'Unpaid';
            } else if (
                finance.total_paid >=
                finance.total_expected
            ) {
                paymentStatus = 'Paid';
            } else if (finance.total_paid > 0) {
                paymentStatus = 'Partially Paid';
            }

            return {
                student_id: studentId,

                student_name:
                    `${student.first_name || ''} ${student.middle_name || ''} ${student.last_name || ''}`
                        .replace(/\s+/g, ' ')
                        .trim(),

                admission_number:
                    student.admission_number,

                class_id:
                    student.class_id,

                class_name:
                    student.classes?.class_name || null,

                arm:
                    student.classes?.arm || null,

                sector:
                    student.classes?.school_section ||
                    student.school_section ||
                    null,

                student_status:
                    student.student_status,

                total_expected:
                    finance.total_expected,

                total_paid:
                    finance.total_paid,

                total_balance:
                    finance.total_balance,

                paid_fees:
                    finance.paid_fees,

                partially_paid_fees:
                    finance.partially_paid_fees,

                unpaid_fees:
                    finance.unpaid_fees,

                payment_count:
                    finance.payment_count,

                payment_status:
                    paymentStatus,

                fee_details:
                    finance.fee_details
            };
        });

        console.log(
            `Finance students loaded: ${result.length}`
        );

        res.json({
            students: result
        });

    } catch (error) {

        console.error(
            'Finance students error:',
            error
        );

        res.status(500).json({
            message:
                error.message ||
                'Failed to load finance students'
        });
    }
});

// ============================================================
// GET SINGLE STUDENT
// ============================================================
router.get('/:studentId', authenticateToken, async (req, res) => {
    const studentId = parseInt(req.params.studentId);
    if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student ID' });

    try {
        const { data: student, error } = await supabase
            .from('students')
            .select(`
                *,
                classes!inner (
                    class_id,
                    class_name,
                    arm,
                    school_section
                )
            `)
            .eq('student_id', studentId)
            .single();

        if (error || !student) return res.status(404).json({ message: 'Student not found' });

        const { data: guardian } = await supabase
            .from('guardians')
            .select('*')
            .eq('guardian_id', student.guardian_id)
            .maybeSingle();

        res.json({
            ...student,
            class_name: student.classes?.class_name || null,
            arm: student.classes?.arm || null,
            school_section: student.classes?.school_section || null,
            guardian_name: guardian?.full_name || null,
            guardian_relationship: guardian?.relationship || null,
            guardian_phone: guardian?.phone || null,
            guardian_email: guardian?.email || null,
            guardian_address: guardian?.address || null
        });
    } catch (error) {
        console.error('Error getting student:', error);
        res.status(500).json({ message: 'Failed to load student data' });
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
                return res.status(500).json({ message: 'Failed to create guardian: ' + guardianError.message });
            }

            let photoUrl = null;
            if (req.files && req.files.student_photo) {
                const photoFile = req.files.student_photo[0];
                const fileName = `student_${admission_number}_${Date.now()}.jpg`;
                photoUrl = await uploadFileToSupabase(photoFile, 'student_photos', 'student-photos', fileName);
            }

            const documentFiles = {
                'result_file': { folder: 'results', column: 'result_file_url' },
                'birth_certificate_file': { folder: 'birth-certificates', column: 'birth_certificate_url' },
                'testimonial_file': { folder: 'testimonials', column: 'testimonial_url' },
                'transfer_file': { folder: 'transfer-forms', column: 'transfer_form_url' }
            };

            const documentUrls = {};

            if (req.files) {
                for (const [fieldName, config] of Object.entries(documentFiles)) {
                    if (req.files[fieldName]) {
                        const file = req.files[fieldName][0];
                        const fileName = `student_${admission_number}_${fieldName}_${Date.now()}.${file.originalname.split('.').pop()}`;
                        const fileUrl = await uploadFileToSupabase(file, 'student_files', config.folder, fileName);

                        if (fileUrl) {
                            documentUrls[config.column] = fileUrl;
                        }
                    }
                }
            }

            const { data: student, error: insertError } = await supabase
                .from('students')
                .insert({
                    admission_number, first_name,
                    middle_name: middle_name || null,
                    last_name, gender: gender || null,
                    date_of_birth: date_of_birth || null,
                    phone: phone || null, address: address || null,
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
                    school_section: section,
                    ...documentUrls
                })
                .select()
                .single();

            if (insertError) {
                await supabase.from('guardians').delete().eq('guardian_id', guardian.guardian_id);
                return res.status(500).json({ message: 'Failed to create student: ' + insertError.message });
            }

            await supabase
                .from('guardians')
                .update({
                    student_id: student.student_id,
                    emergency_contact_name: emergency_contact_name || null,
                    emergency_contact_phone: emergency_contact_phone || null,
                    emergency_contact_relationship: emergency_contact_relationship || null
                })
                .eq('guardian_id', guardian.guardian_id);

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
                await supabase.from('students').delete().eq('student_id', student.student_id);
                await supabase.from('guardians').delete().eq('guardian_id', guardian.guardian_id);
                return res.status(500).json({ message: 'Failed to create approval record' });
            }

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
// UPDATE STUDENT WITH PHOTO AND DOCUMENTS
// ============================================================
router.put('/:studentId/update-with-photo', authenticateToken, 
    upload.fields([
        { name: 'student_photo', maxCount: 1 },
        { name: 'result_file', maxCount: 1 },
        { name: 'birth_certificate_file', maxCount: 1 },
        { name: 'testimonial_file', maxCount: 1 },
        { name: 'transfer_file', maxCount: 1 }
    ]), 
    async (req, res) => {
        const studentId = parseInt(req.params.studentId);
        if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student ID' });

        try {
            // Build student update with ONLY students table columns
            const studentUpdate = {
                admission_number: req.body.admission_number,
                first_name: req.body.first_name,
                middle_name: req.body.middle_name || null,
                last_name: req.body.last_name,
                gender: req.body.gender || null,
                date_of_birth: req.body.date_of_birth || null,
                nationality: req.body.nationality || null,
                phone: req.body.phone || null,
                address: req.body.address || null,
                class_id: req.body.class_id ? Number(req.body.class_id) : null,
                admission_date: req.body.admission_date || null,
                previous_school: req.body.previous_school || null,
                student_status: req.body.student_status || 'Active',
                emergency_contact_name: req.body.emergency_contact_name || null,
                emergency_contact_phone: req.body.emergency_contact_phone || null,
                emergency_contact_relationship: req.body.emergency_contact_relationship || null
            };

            if (req.files && req.files.student_photo) {
                const photoFile = req.files.student_photo[0];
                const fileName = `student_${studentId}_${Date.now()}.jpg`;
                const photoUrl = await uploadFileToSupabase(photoFile, 'student_photos', 'student-photos', fileName);
                if (photoUrl) studentUpdate.photo_url = photoUrl;
            }

            const documentFiles = {
                'result_file': { folder: 'results', column: 'result_file_url' },
                'birth_certificate_file': { folder: 'birth-certificates', column: 'birth_certificate_url' },
                'testimonial_file': { folder: 'testimonials', column: 'testimonial_url' },
                'transfer_file': { folder: 'transfer-forms', column: 'transfer_form_url' }
            };

            if (req.files) {
                for (const [fieldName, config] of Object.entries(documentFiles)) {
                    if (req.files[fieldName]) {
                        const file = req.files[fieldName][0];
                        const fileName = `student_${studentId}_${fieldName}_${Date.now()}.${file.originalname.split('.').pop()}`;
                        const fileUrl = await uploadFileToSupabase(file, 'student_files', config.folder, fileName);
                        if (fileUrl) studentUpdate[config.column] = fileUrl;
                    }
                }
            }

            const { data, error } = await supabase
                .from('students')
                .update(studentUpdate)
                .eq('student_id', studentId)
                .select()
                .single();

            if (error) throw error;

            // Update guardian separately
            const guardianName = req.body.guardian_name;
            if (guardianName) {
                const { data: studentData } = await supabase
                    .from('students')
                    .select('guardian_id')
                    .eq('student_id', studentId)
                    .single();

                if (studentData?.guardian_id) {
                    await supabase
                        .from('guardians')
                        .update({
                            full_name: guardianName,
                            relationship: req.body.guardian_relationship || null,
                            phone: req.body.guardian_phone || null,
                            email: req.body.guardian_email || null,
                            address: req.body.guardian_address || null
                        })
                        .eq('guardian_id', studentData.guardian_id);
                }
            }

            res.json({ message: 'Student updated successfully', student: data });
        } catch (error) {
            console.error('Update with photo error:', error);
            res.status(500).json({ message: 'Failed to update student: ' + error.message });
        }
    }
);

// ============================================================
// UPDATE STUDENT (JSON)
// ============================================================
router.put('/:studentId', authenticateToken, requireRoles(...MANAGEMENT_ROLES), async (req, res) => {
    const studentId = parseInt(req.params.studentId);
    if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student ID' });

    try {
        const { data: student, error: updateError } = await supabase
            .from('students')
            .update(req.body)
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
router.put('/:studentId/reapprove', authenticateToken, requireRoles('Administrator', 'Proprietor', 'Manager-Primary', 'Manager-Secondary'), async (req, res) => {
    const studentId = parseInt(req.params.studentId);
    if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Invalid student ID' });

    try {
        // Update student status to Pending
        await supabase
            .from('students')
            .update({ student_status: 'Pending' })
            .eq('student_id', studentId);

        // Update the EXISTING approval to Pending instead of deleting
        const { error: updateApprovalError } = await supabase
            .from('record_approvals')
            .update({
                approval_status: 'Pending',
                approved_by: null,
                approved_at: null,
                rejection_reason: null,
                created_at: new Date().toISOString()
            })
            .eq('record_id', studentId)
            .eq('record_type', 'Student');

        if (updateApprovalError) {
            // If no existing approval, create new one
            const { error: insertError } = await supabase
                .from('record_approvals')
                .insert({
                    record_type: 'Student',
                    record_id: studentId,
                    approval_status: 'Pending',
                    created_by: req.user.user_id,
                    created_at: new Date().toISOString()
                });
            if (insertError) throw insertError;
        }

        res.json({ message: 'Student sent for re-approval successfully', student_id: studentId, status: 'Pending' });
    } catch (error) {
        console.error('Re-approve error:', error);
        res.status(500).json({ message: 'Failed to re-approve student: ' + error.message });
    }
});

module.exports = router;