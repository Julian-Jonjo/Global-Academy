const express = require('express');
const supabase = require('../config/db');

const {
    authenticateToken,
    requireRoles
} = require('../middleware/authMiddleware');

const router = express.Router();


// ============================================================
// GET ALL STUDENTS
// ============================================================
router.get(
    '/',
    authenticateToken,
    requireRoles('Manager', 'Administrator', 'Proprietor'),
    async (req, res) => {
        try {
            const { search, class_id, status } = req.query;

            // Start building the query
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

            // Apply filters
            if (search) {
                query = query.or(`admission_number.ilike.%${search}%,first_name.ilike.%${search}%,middle_name.ilike.%${search}%,last_name.ilike.%${search}%`);
            }

            if (class_id) {
                query = query.eq('class_id', class_id);
            }

            if (status) {
                query = query.eq('student_status', status);
            }

            // Order by admission_number
            query = query.order('admission_number', { ascending: true });

            const { data, error } = await query;

            if (error) throw error;

            // Format the response
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
// CREATE NEW STUDENT REGISTRATION
// ============================================================
router.post(
    '/',
    authenticateToken,
    requireRoles('Manager', 'Administrator'),
    async (req, res) => {
        try {
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
                emergency_contact_relationship,
                registration_date
            } = req.body;

            // Required fields
            if (!admission_number || !first_name || !last_name) {
                return res.status(400).json({
                    message: 'Admission number, first name and last name are required'
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
                    class_id: class_id || null,
                    guardian_id: guardian_id || null,
                    admission_date: admission_date || null,
                    student_status: student_status || 'Pending',
                    nationality: nationality || null,
                    previous_school: previous_school || null,
                    emergency_contact_name: emergency_contact_name || null,
                    emergency_contact_phone: emergency_contact_phone || null,
                    emergency_contact_relationship: emergency_contact_relationship || null,
                    registration_date: registration_date || new Date().toISOString()
                })
                .select()
                .single();

            if (insertError) throw insertError;

            // Create approval record
            const { error: approvalError } = await supabase
                .from('record_approvals')
                .insert({
                    record_type: 'Student',
                    record_id: student.student_id,
                    approval_status: 'Pending',
                    created_by: req.user.user_id,
                    created_at: new Date().toISOString()
                });

            if (approvalError) throw approvalError;

            res.status(201).json({
                message: 'Student registration submitted for approval',
                student_id: student.student_id,
                status: 'Pending'
            });

        } catch (error) {
            console.error('Student registration error:', error);
            res.status(500).json({
                message: 'Failed to register student'
            });
        }
    }
);


// ============================================================
// UPDATE STUDENT — ADMINISTRATOR ONLY
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

        // Required fields
        if (!admission_number || !first_name || !last_name) {
            return res.status(400).json({
                message: 'Admission number, first name and last name are required'
            });
        }

        try {
            // Check student exists
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

            // Check duplicate admission number
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

            // Update student
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

            // Get all fee balances
            const { data: balances, error: balancesError } = await supabase
                .from('student_fee_balances')
                .select('*');

            if (balancesError) throw balancesError;

            // Combine data
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
            // Get all fee types
            const { data: feeTypes, error: feeError } = await supabase
                .from('fee_types')
                .select('fee_type_id, fee_name')
                .eq('is_active', true)
                .order('fee_name');

            if (feeError) throw feeError;

            // Get all fee balances
            const { data: balances, error: balanceError } = await supabase
                .from('student_fee_balances')
                .select('fee_name, amount_due, total_paid, balance');

            if (balanceError) throw balanceError;

            // Group by fee_name
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