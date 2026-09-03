const express = require('express');
const router = express.Router();

const supabase = require('../Config/db');

const {
    authenticateToken,
    ROLE_IDS,
    getRoleId,
    getSector
} = require('../middleware/authMiddleware');

console.log('🔍 Loading payments.js...');

// ============================================================
// ROLE CONSTANTS
// ============================================================

const PROPRIETOR = ROLE_IDS.PROPRIETOR;
const ADMINISTRATOR = ROLE_IDS.ADMINISTRATOR;
const FINANCE = ROLE_IDS.FINANCE;
const TEACHER = ROLE_IDS.TEACHER;
const STUDENT = ROLE_IDS.STUDENT;
const MANAGER = ROLE_IDS.MANAGER;

const FINANCE_READ_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE,
    MANAGER
];

const PAYMENT_WRITE_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE
];

const PRIMARY_SECTIONS = [
    'Nursery',
    'Primary'
];

const SECONDARY_SECTIONS = [
    'Secondary',
    'JSS',
    'SSS'
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function isAllowedRole(user, roles) {
    const roleId = getRoleId(user);
    return roles.includes(roleId);
}

function isAdminOrProprietor(user) {
    const roleId = getRoleId(user);

    return (
        roleId === PROPRIETOR ||
        roleId === ADMINISTRATOR
    );
}

function isSectorUser(user) {
    const roleId = getRoleId(user);

    return (
        roleId === FINANCE ||
        roleId === MANAGER
    );
}

function normalizeSector(value) {
    if (!value) return null;

    const sector = String(value)
        .trim()
        .toLowerCase();

    if (sector === 'primary') {
        return 'primary';
    }

    if (sector === 'secondary') {
        return 'secondary';
    }

    return null;
}

function getSectionsForSector(sector) {
    if (sector === 'primary') {
        return PRIMARY_SECTIONS;
    }

    if (sector === 'secondary') {
        return SECONDARY_SECTIONS;
    }

    return [];
}

async function resolveAcademicYearId(academicYear) {

    if (academicYear) {

        const {
            data,
            error
        } = await supabase
            .from('academic_years')
            .select('academic_year_id')
            .eq('year_name', academicYear)
            .maybeSingle();

        if (error) {
            throw new Error(
                `Failed to resolve academic year: ${error.message}`
            );
        }

        if (data) {
            return data.academic_year_id;
        }
    }

    const {
        data: currentYear,
        error: currentYearError
    } = await supabase
        .from('academic_years')
        .select('academic_year_id')
        .eq('is_current', true)
        .maybeSingle();

    if (currentYearError) {
        throw new Error(
            `Failed to determine current academic year: ${currentYearError.message}`
        );
    }

    return currentYear?.academic_year_id || null;
}

// ============================================================
// DETERMINE EFFECTIVE SECTOR
//
// Proprietor / Administrator:
//     Can request primary or secondary.
//
// Finance / Manager:
//     MUST use their authenticated sector.
//
// ============================================================

function determineEffectiveSector(req, requestedSector) {

    const roleId = getRoleId(req.user);
    const authenticatedSector =
        normalizeSector(getSector(req.user));

    // Finance and Managers are restricted to their own sector.
    if (
        roleId === FINANCE ||
        roleId === MANAGER
    ) {

        if (!authenticatedSector) {
            return {
                error: 'Your account does not have a valid school sector.'
            };
        }

        return {
            sector: authenticatedSector
        };
    }

    // Proprietor / Administrator may choose sector.
    if (
        roleId === PROPRIETOR ||
        roleId === ADMINISTRATOR
    ) {

        if (!requestedSector) {
            return {
                sector: null
            };
        }

        const normalized =
            normalizeSector(requestedSector);

        if (!normalized) {
            return {
                error: 'Invalid school sector.'
            };
        }

        return {
            sector: normalized
        };
    }

    return {
        error: 'Access denied.'
    };
}

// ============================================================
// GET /api/payments
//
// PAYMENT HISTORY
//
// Supports:
//
// /api/payments
// /api/payments?sector=primary
// /api/payments?sector=secondary
// /api/payments?student_id=12
// /api/payments?sector=secondary&student_id=12
// /api/payments?academic_year=2026/2027
//
// ============================================================

router.get(
    '/',
    authenticateToken,
    async (req, res) => {

        try {

            console.log('====================================');
            console.log('GET /api/payments');
            console.log('Query:', req.query);
            console.log('User:', req.user);
            console.log('====================================');

            if (
                !isAllowedRole(
                    req.user,
                    FINANCE_READ_ROLES
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. You do not have permission to view payment records.'
                });
            }

            const {
                sector: requestedSector,
                student_id,
                academic_year
            } = req.query;

            // ----------------------------------------------------
            // EFFECTIVE SECTOR
            // ----------------------------------------------------

            const sectorResult =
                determineEffectiveSector(
                    req,
                    requestedSector
                );

            if (sectorResult.error) {
                return res.status(403).json({
                    message: sectorResult.error
                });
            }

            const effectiveSector =
                sectorResult.sector;

            // ----------------------------------------------------
            // ACADEMIC YEAR
            // ----------------------------------------------------

            const academicYearId =
                await resolveAcademicYearId(
                    academic_year
                );

            // ----------------------------------------------------
            // GET STUDENT IDs FOR SECTOR
            // ----------------------------------------------------

            let studentIds = null;

            if (effectiveSector) {

                const sections =
                    getSectionsForSector(
                        effectiveSector
                    );

                const {
                    data: students,
                    error: studentsError
                } = await supabase
                    .from('students')
                    .select('student_id')
                    .in(
                        'school_section',
                        sections
                    );

                if (studentsError) {

                    console.error(
                        'SECTOR STUDENTS ERROR:',
                        studentsError
                    );

                    return res.status(500).json({
                        message:
                            'Failed to load students for the selected sector.',
                        error:
                            studentsError.message
                    });
                }

                studentIds =
                    (students || []).map(
                        student =>
                            student.student_id
                    );

                // No students in sector.
                if (studentIds.length === 0) {

                    return res.json({
                        payments: []
                    });
                }
            }

            // ----------------------------------------------------
            // PAYMENT QUERY
            // ----------------------------------------------------

            let query =
                supabase
                    .from('payments')
                    .select(`
                        payment_id,
                        student_id,
                        student_fee_id,
                        amount_paid,
                        payment_method,
                        payment_slip_number,
                        bank_reference,
                        purpose,
                        notes,
                        payment_date,
                        approval_status,
                        academic_year_id,
                        recorded_by,
                        created_at
                    `)
                    .order(
                        'payment_date',
                        {
                            ascending: false
                        }
                    );

            // Student
            if (student_id) {

                const parsedStudentId =
                    parseInt(
                        student_id,
                        10
                    );

                if (
                    Number.isNaN(
                        parsedStudentId
                    )
                ) {
                    return res.status(400).json({
                        message:
                            'Invalid student_id.'
                    });
                }

                query =
                    query.eq(
                        'student_id',
                        parsedStudentId
                    );
            }

            // Sector
            if (studentIds !== null) {

                query =
                    query.in(
                        'student_id',
                        studentIds
                    );
            }

            // Academic year
            if (academicYearId) {

                query =
                    query.eq(
                        'academic_year_id',
                        academicYearId
                    );
            }

            const {
                data: payments,
                error: paymentError
            } = await query;

            if (paymentError) {

                console.error(
                    'PAYMENT HISTORY QUERY ERROR:',
                    paymentError
                );

                return res.status(500).json({
                    message:
                        'Failed to load payment history.',
                    error:
                        paymentError.message
                });
            }

            const paymentRecords =
                payments || [];

            if (
                paymentRecords.length === 0
            ) {

                return res.json({
                    payments: []
                });
            }

            // ----------------------------------------------------
            // STUDENT DETAILS
            // ----------------------------------------------------

            const paymentStudentIds = [
                ...new Set(
                    paymentRecords
                        .map(
                            payment =>
                                payment.student_id
                        )
                        .filter(Boolean)
                )
            ];

            let studentsMap = {};

            if (
                paymentStudentIds.length > 0
            ) {

                const {
                    data: students,
                    error: studentsError
                } = await supabase
                    .from('students')
                    .select(`
                        student_id,
                        first_name,
                        middle_name,
                        last_name,
                        admission_number,
                        school_section
                    `)
                    .in(
                        'student_id',
                        paymentStudentIds
                    );

                if (studentsError) {

                    console.error(
                        'PAYMENT STUDENT DETAILS ERROR:',
                        studentsError
                    );

                    return res.status(500).json({
                        message:
                            'Failed to load student information.',
                        error:
                            studentsError.message
                    });
                }

                for (
                    const student of
                    students || []
                ) {

                    studentsMap[
                        student.student_id
                    ] = student;
                }
            }

            // ----------------------------------------------------
            // FEE DETAILS
            // ----------------------------------------------------

            const feeIds = [
                ...new Set(
                    paymentRecords
                        .map(
                            payment =>
                                payment.student_fee_id
                        )
                        .filter(Boolean)
                )
            ];

            let feesMap = {};

            if (feeIds.length > 0) {

                const {
                    data: fees,
                    error: feesError
                } = await supabase
                    .from('student_fees')
                    .select(`
                        student_fee_id,
                        fee_type_id,
                        amount_due
                    `)
                    .in(
                        'student_fee_id',
                        feeIds
                    );

                if (feesError) {

                    console.error(
                        'PAYMENT FEE DETAILS ERROR:',
                        feesError
                    );

                    return res.status(500).json({
                        message:
                            'Failed to load fee information.',
                        error:
                            feesError.message
                    });
                }

                for (
                    const fee of
                    fees || []
                ) {

                    feesMap[
                        fee.student_fee_id
                    ] = fee;
                }
            }

            // ----------------------------------------------------
            // BUILD RESPONSE
            // ----------------------------------------------------

            const result =
                paymentRecords.map(
                    payment => {

                        const student =
                            studentsMap[
                                payment.student_id
                            ] || {};

                        const fee =
                            feesMap[
                                payment.student_fee_id
                            ] || {};

                        return {
                            ...payment,

                            student: {
                                student_id:
                                    student.student_id ||
                                    payment.student_id,

                                first_name:
                                    student.first_name ||
                                    '',

                                middle_name:
                                    student.middle_name ||
                                    '',

                                last_name:
                                    student.last_name ||
                                    '',

                                admission_number:
                                    student.admission_number ||
                                    '',

                                school_section:
                                    student.school_section ||
                                    null
                            },

                            fee: {
                                student_fee_id:
                                    fee.student_fee_id ||
                                    payment.student_fee_id ||
                                    null,

                                fee_type_id:
                                    fee.fee_type_id ||
                                    null,

                                amount_due:
                                    Number(
                                        fee.amount_due ||
                                        0
                                    )
                            }
                        };
                    }
                );

            return res.json({
                payments: result
            });

        } catch (error) {

            console.error(
                'GET /api/payments ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Server error while loading payment history.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// GET /api/payments/history
// ============================================================

router.get(
    '/history',
    authenticateToken,
    async (req, res) => {

        try {

            if (
                !isAllowedRole(
                    req.user,
                    FINANCE_READ_ROLES
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied.'
                });
            }

            const {
                student_id,
                sector,
                academic_year
            } = req.query;

            const sectorResult =
                determineEffectiveSector(
                    req,
                    sector
                );

            if (sectorResult.error) {
                return res.status(403).json({
                    message:
                        sectorResult.error
                });
            }

            const effectiveSector =
                sectorResult.sector;

            const academicYearId =
                await resolveAcademicYearId(
                    academic_year
                );

            let query =
                supabase
                    .from('payments')
                    .select('*')
                    .order(
                        'payment_date',
                        {
                            ascending: false
                        }
                    );

            if (student_id) {

                query =
                    query.eq(
                        'student_id',
                        parseInt(
                            student_id,
                            10
                        )
                    );
            }

            if (academicYearId) {

                query =
                    query.eq(
                        'academic_year_id',
                        academicYearId
                    );
            }

            if (effectiveSector) {

                const sections =
                    getSectionsForSector(
                        effectiveSector
                    );

                const {
                    data: students,
                    error
                } = await supabase
                    .from('students')
                    .select('student_id')
                    .in(
                        'school_section',
                        sections
                    );

                if (error) {
                    throw error;
                }

                const ids =
                    (students || []).map(
                        student =>
                            student.student_id
                    );

                if (ids.length === 0) {

                    return res.json({
                        payments: []
                    });
                }

                query =
                    query.in(
                        'student_id',
                        ids
                    );
            }

            const {
                data: payments,
                error
            } = await query;

            if (error) {
                throw error;
            }

            return res.json({
                payments:
                    payments || []
            });

        } catch (error) {

            console.error(
                'PAYMENT HISTORY ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load payment history.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// GET /api/payments/summary
//
// FINANCIAL SUMMARY
//
// Returns:
// total_expected
// total_collected
// total_outstanding
// total_students
//
// ============================================================

router.get(
    '/summary',
    authenticateToken,
    async (req, res) => {

        try {

            console.log('====================================');
            console.log('PAYMENT SUMMARY');
            console.log('Query:', req.query);
            console.log('User:', req.user);
            console.log('====================================');

            if (
                !isAllowedRole(
                    req.user,
                    FINANCE_READ_ROLES
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied.'
                });
            }

            const {
                sector,
                academic_year
            } = req.query;

            const sectorResult =
                determineEffectiveSector(
                    req,
                    sector
                );

            if (sectorResult.error) {

                return res.status(403).json({
                    message:
                        sectorResult.error
                });
            }

            const effectiveSector =
                sectorResult.sector;

            // ----------------------------------------------------
            // ACADEMIC YEAR
            // ----------------------------------------------------

            const academicYearId =
                await resolveAcademicYearId(
                    academic_year
                );

            // ----------------------------------------------------
            // STUDENT IDS FOR SECTOR
            // ----------------------------------------------------

            let studentIds = null;

            if (effectiveSector) {

                const sections =
                    getSectionsForSector(
                        effectiveSector
                    );

                const {
                    data: students,
                    error: studentsError
                } = await supabase
                    .from('students')
                    .select('student_id')
                    .in(
                        'school_section',
                        sections
                    );

                if (studentsError) {
                    throw studentsError;
                }

                studentIds =
                    (students || []).map(
                        student =>
                            student.student_id
                    );
            }

            // ----------------------------------------------------
            // FEES / EXPECTED
            // ----------------------------------------------------

            let feeQuery =
                supabase
                    .from('student_fees')
                    .select(`
                        student_fee_id,
                        student_id,
                        amount_due,
                        academic_year_id
                    `);

            if (academicYearId) {

                feeQuery =
                    feeQuery.eq(
                        'academic_year_id',
                        academicYearId
                    );
            }

            if (studentIds !== null) {

                if (
                    studentIds.length === 0
                ) {

                    return res.json({
                        summary: {
                            total_expected: 0,
                            total_collected: 0,
                            total_outstanding: 0,
                            total_students: 0
                        }
                    });
                }

                feeQuery =
                    feeQuery.in(
                        'student_id',
                        studentIds
                    );
            }

            const {
                data: feeRecords,
                error: feeError
            } = await feeQuery;

            if (feeError) {

                console.error(
                    'FEE SUMMARY ERROR:',
                    feeError
                );

                throw feeError;
            }

            const totalExpected =
                (feeRecords || []).reduce(
                    (sum, fee) =>
                        sum +
                        Number(
                            fee.amount_due || 0
                        ),
                    0
                );

            // ----------------------------------------------------
            // PAYMENTS / COLLECTED
            // ----------------------------------------------------

            let paymentQuery =
                supabase
                    .from('payments')
                    .select(`
                        payment_id,
                        student_id,
                        amount_paid,
                        approval_status,
                        academic_year_id
                    `)
                    .eq(
                        'approval_status',
                        'approved'
                    );

            if (academicYearId) {

                paymentQuery =
                    paymentQuery.eq(
                        'academic_year_id',
                        academicYearId
                    );
            }

            if (studentIds !== null) {

                paymentQuery =
                    paymentQuery.in(
                        'student_id',
                        studentIds
                    );
            }

            const {
                data: paymentRecords,
                error: paymentError
            } = await paymentQuery;

            if (paymentError) {

                console.error(
                    'PAYMENT SUMMARY ERROR:',
                    paymentError
                );

                throw paymentError;
            }

            const totalCollected =
                (paymentRecords || []).reduce(
                    (sum, payment) =>
                        sum +
                        Number(
                            payment.amount_paid || 0
                        ),
                    0
                );

            // ----------------------------------------------------
            // OUTSTANDING
            // ----------------------------------------------------

            const totalOutstanding =
                Math.max(
                    0,
                    totalExpected -
                    totalCollected
                );

            // ----------------------------------------------------
            // STUDENT COUNT
            // ----------------------------------------------------

            let studentCountQuery =
                supabase
                    .from('students')
                    .select(
                        'student_id',
                        {
                            count: 'exact',
                            head: true
                        }
                    )
                    .eq(
                        'student_status',
                        'Active'
                    );

            if (effectiveSector) {

                studentCountQuery =
                    studentCountQuery.in(
                        'school_section',
                        getSectionsForSector(
                            effectiveSector
                        )
                    );
            }

            const {
                count: totalStudents,
                error: studentCountError
            } = await studentCountQuery;

            if (studentCountError) {

                console.error(
                    'STUDENT COUNT ERROR:',
                    studentCountError
                );

                throw studentCountError;
            }

            const summary = {
                total_expected:
                    totalExpected,

                total_collected:
                    totalCollected,

                total_outstanding:
                    totalOutstanding,

                total_students:
                    totalStudents || 0
            };

            console.log(
                'PAYMENT SUMMARY RESULT:',
                summary
            );

            return res.json({
                summary
            });

        } catch (error) {

            console.error(
                'PAYMENT SUMMARY ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load payment summary.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// GET /api/payments/students
//
// FINANCE STUDENT LIST
// ============================================================

router.get(
    '/students',
    authenticateToken,
    async (req, res) => {

        try {

            if (
                !isAllowedRole(
                    req.user,
                    FINANCE_READ_ROLES
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied.'
                });
            }

            const {
                sector,
                academic_year
            } = req.query;

            const sectorResult =
                determineEffectiveSector(
                    req,
                    sector
                );

            if (sectorResult.error) {

                return res.status(403).json({
                    message:
                        sectorResult.error
                });
            }

            const effectiveSector =
                sectorResult.sector;

            const academicYearId =
                await resolveAcademicYearId(
                    academic_year
                );

            // ----------------------------------------------------
            // STUDENTS
            // ----------------------------------------------------

            let studentQuery =
                supabase
                    .from('students')
                    .select(`
                        student_id,
                        first_name,
                        middle_name,
                        last_name,
                        admission_number,
                        student_status,
                        school_section,
                        class_id,
                        classes (
                            class_id,
                            class_name,
                            arm
                        )
                    `)
                    .eq(
                        'student_status',
                        'Active'
                    );

            if (effectiveSector) {

                studentQuery =
                    studentQuery.in(
                        'school_section',
                        getSectionsForSector(
                            effectiveSector
                        )
                    );
            }

            const {
                data: students,
                error: studentError
            } = await studentQuery;

            if (studentError) {

                console.error(
                    'STUDENT FINANCE QUERY ERROR:',
                    studentError
                );

                throw studentError;
            }

            const studentRecords =
                students || [];

            if (
                studentRecords.length === 0
            ) {

                return res.json({
                    students: []
                });
            }

            const studentIds =
                studentRecords.map(
                    student =>
                        student.student_id
                );

            // ----------------------------------------------------
            // FEES
            // ----------------------------------------------------

            let feeQuery =
                supabase
                    .from('student_fees')
                    .select(`
                        student_fee_id,
                        student_id,
                        fee_type_id,
                        amount_due,
                        academic_year_id,
                        fee_types (
                            fee_name
                        )
                    `)
                    .in(
                        'student_id',
                        studentIds
                    );

            if (academicYearId) {

                feeQuery =
                    feeQuery.eq(
                        'academic_year_id',
                        academicYearId
                    );
            }

            const {
                data: feeRecords,
                error: feeError
            } = await feeQuery;

            if (feeError) {

                console.error(
                    'STUDENT FEE QUERY ERROR:',
                    feeError
                );

                throw feeError;
            }

            // ----------------------------------------------------
            // PAYMENTS - Get ALL approved payments with fee_id
            // ----------------------------------------------------

            let paymentQuery =
                supabase
                    .from('payments')
                    .select(`
                        payment_id,
                        student_id,
                        student_fee_id,
                        amount_paid,
                        approval_status,
                        academic_year_id
                    `)
                    .in(
                        'student_id',
                        studentIds
                    )
                    .eq(
                        'approval_status',
                        'approved'
                    );

            if (academicYearId) {

                paymentQuery =
                    paymentQuery.eq(
                        'academic_year_id',
                        academicYearId
                    );
            }

            const {
                data: paymentRecords,
                error: paymentError
            } = await paymentQuery;

            if (paymentError) {

                console.error(
                    'STUDENT PAYMENT QUERY ERROR:',
                    paymentError
                );

                throw paymentError;
            }

            // ----------------------------------------------------
            // BUILD PAYMENT MAP BY FEE (student_id + student_fee_id)
            // ----------------------------------------------------

            const paymentMapByFee = {};

            for (
                const payment of
                paymentRecords || []
            ) {

                const key = `${payment.student_id}_${payment.student_fee_id}`;
                
                if (
                    !paymentMapByFee[key]
                ) {
                    paymentMapByFee[key] = 0;
                }

                paymentMapByFee[key] += Number(
                    payment.amount_paid || 0
                );
            }

            // Also keep total by student for summary
            const paymentMapByStudent = {};

            for (
                const payment of
                paymentRecords || []
            ) {

                if (
                    !paymentMapByStudent[
                        payment.student_id
                    ]
                ) {
                    paymentMapByStudent[
                        payment.student_id
                    ] = 0;
                }

                paymentMapByStudent[
                    payment.student_id
                ] += Number(
                    payment.amount_paid || 0
                );
            }

            // ----------------------------------------------------
            // BUILD FEE MAP
            // ----------------------------------------------------

            const feeMap = {};

            for (
                const fee of
                feeRecords || []
            ) {

                if (!feeMap[fee.student_id]) {
                    feeMap[fee.student_id] = [];
                }

                feeMap[fee.student_id].push(
                    fee
                );
            }

            // ----------------------------------------------------
            // RESULT
            // ----------------------------------------------------

            const result =
                studentRecords.map(
                    student => {

                        const fees =
                            feeMap[
                                student.student_id
                            ] || [];

                        // Build fees with payment amounts
                        const feesWithPayments = fees.map(fee => {
                            const key = `${student.student_id}_${fee.student_fee_id}`;
                            const feePaid = Number(paymentMapByFee[key] || 0);
                            
                            return {
                                ...fee,
                                amount_paid: feePaid,
                                balance: Math.max(0, Number(fee.amount_due || 0) - feePaid)
                            };
                        });

                        const totalDue =
                            fees.reduce(
                                (
                                    sum,
                                    fee
                                ) =>
                                    sum +
                                    Number(
                                        fee.amount_due ||
                                        0
                                    ),
                                0
                            );

                        const totalPaid =
                            Number(
                                paymentMapByStudent[
                                    student.student_id
                                ] || 0
                            );

                        const outstanding =
                            Math.max(
                                0,
                                totalDue -
                                totalPaid
                            );

                        return {

                            student_id:
                                student.student_id,

                            first_name:
                                student.first_name,

                            middle_name:
                                student.middle_name,

                            last_name:
                                student.last_name,

                            admission_number:
                                student.admission_number,

                            student_status:
                                student.student_status,

                            school_section:
                                student.school_section,

                            class_id:
                                student.class_id ||
                                student.classes?.class_id ||
                                null,

                            class_name:
                                student.classes?.class_name ||
                                '',

                            arm:
                                student.classes?.arm ||
                                '',

                            fees: feesWithPayments,

                            total_due:
                                totalDue,

                            total_paid:
                                totalPaid,

                            outstanding
                        };
                    }
                );

            return res.json({
                students: result
            });

        } catch (error) {

            console.error(
                'GET /api/payments/students ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load finance students.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// GET /api/payments/fees
// ============================================================

router.get(
    '/fees',
    authenticateToken,
    async (req, res) => {

        try {

            if (
                !isAllowedRole(
                    req.user,
                    FINANCE_READ_ROLES
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied.'
                });
            }

            const {
                sector
            } = req.query;

            const sectorResult =
                determineEffectiveSector(
                    req,
                    sector
                );

            if (sectorResult.error) {

                return res.status(403).json({
                    message:
                        sectorResult.error
                });
            }

            const effectiveSector =
                sectorResult.sector;

            // ----------------------------------------------------
            // IMPORTANT:
            // Existing application uses fee_categories here.
            // ----------------------------------------------------

            let query =
                supabase
                    .from('fee_categories')
                    .select('*')
                    .eq(
                        'is_active',
                        true
                    );

            if (effectiveSector) {

                query =
                    query.eq(
                        'sector',
                        effectiveSector
                    );
            }

            const {
                data,
                error
            } = await query;

            if (error) {

                console.error(
                    'FEE CATEGORIES ERROR:',
                    error
                );

                return res.status(500).json({
                    message:
                        'Failed to load fee categories.',
                    error:
                        error.message
                });
            }

            return res.json({
                fees: data || []
            });

        } catch (error) {

            console.error(
                'GET /api/payments/fees ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to load fees.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// POST /api/payments
//
// RECORD PAYMENT
// ============================================================
router.post(
    '/',
    authenticateToken,
    async (req, res) => {

        try {

            const roleId =
                getRoleId(req.user);

            if (
                !PAYMENT_WRITE_ROLES.includes(
                    roleId
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. You are not authorized to record payments.'
                });
            }

            const {
                student_id,
                fee_id,
                amount_paid,
                payment_method,
                payment_slip_number,
                bank_reference,
                purpose,
                notes,
                academic_year
            } = req.body;

            // ----------------------------------------------------
            // VALIDATION
            // ----------------------------------------------------

            const parsedStudentId =
                parseInt(
                    student_id,
                    10
                );

            const parsedFeeId =
                parseInt(
                    fee_id,
                    10
                );

            const parsedAmount =
                Number(
                    amount_paid
                );

            if (
                Number.isNaN(
                    parsedStudentId
                )
            ) {
                return res.status(400).json({
                    message:
                        'Valid student_id is required.'
                });
            }

            if (
                Number.isNaN(
                    parsedFeeId
                )
            ) {
                return res.status(400).json({
                    message:
                        'Valid fee_id is required.'
                });
            }

            if (
                !Number.isFinite(
                    parsedAmount
                ) ||
                parsedAmount <= 0
            ) {
                return res.status(400).json({
                    message:
                        'Amount paid must be greater than zero.'
                });
            }

            // ----------------------------------------------------
            // GET STUDENT
            // ----------------------------------------------------

            const {
                data: student,
                error: studentError
            } = await supabase
                .from('students')
                .select(`
                    student_id,
                    school_section
                `)
                .eq(
                    'student_id',
                    parsedStudentId
                )
                .maybeSingle();

            if (studentError) {
                throw studentError;
            }

            if (!student) {

                return res.status(404).json({
                    message:
                        'Student not found.'
                });
            }

            const studentSector =
                normalizeSector(
                    PRIMARY_SECTIONS.includes(
                        student.school_section
                    )
                        ? 'primary'
                        : SECONDARY_SECTIONS.includes(
                            student.school_section
                        )
                            ? 'secondary'
                            : null
                );

            if (!studentSector) {

                return res.status(400).json({
                    message:
                        'Student does not belong to a valid school sector.'
                });
            }

            // Finance officers can only record for own sector.
            if (
                roleId === FINANCE &&
                normalizeSector(
                    getSector(req.user)
                ) !== studentSector
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. You cannot record a payment for another school sector.'
                });
            }

            // ----------------------------------------------------
            // GET STUDENT FEE
            // ----------------------------------------------------

            const {
                data: studentFee,
                error: studentFeeError
            } = await supabase
                .from('student_fees')
                .select(`
                    student_fee_id,
                    student_id,
                    amount_due,
                    academic_year_id
                `)
                .eq(
                    'student_fee_id',
                    parsedFeeId
                )
                .eq(
                    'student_id',
                    parsedStudentId
                )
                .maybeSingle();

            if (studentFeeError) {
                throw studentFeeError;
            }

            if (!studentFee) {

                return res.status(404).json({
                    message:
                        'Student fee record not found.'
                });
            }

            // ----------------------------------------------------
            // ACADEMIC YEAR
            // ----------------------------------------------------

            let academicYearId =
                studentFee.academic_year_id ||
                await resolveAcademicYearId(
                    academic_year
                );

            if (!academicYearId) {

                return res.status(400).json({
                    message:
                        'No valid academic year could be determined.'
                });
            }

            // ----------------------------------------------------
            // NEW PAYMENTS ARE ALWAYS APPROVED
            // ----------------------------------------------------

            const approvalStatus = 'approved';

            // ----------------------------------------------------
            // INSERT PAYMENT
            // ----------------------------------------------------

            const {
                data: payment,
                error: paymentError
            } = await supabase
                .from('payments')
                .insert([{
                    student_id:
                        parsedStudentId,

                    student_fee_id:
                        parsedFeeId,

                    amount_paid:
                        parsedAmount,

                    payment_method:
                        payment_method || null,

                    payment_slip_number:
                        payment_slip_number || null,

                    bank_reference:
                        bank_reference || null,

                    purpose:
                        purpose || null,

                    notes:
                        notes || null,

                    payment_date:
                        new Date().toISOString(),

                    approval_status:
                        approvalStatus,

                    recorded_by:
                        req.user?.user_id || null,

                    academic_year_id:
                        academicYearId
                }])
                .select()
                .single();

            if (paymentError) {
                throw paymentError;
            }

            // NEW PAYMENTS ARE IMMEDIATELY APPROVED
            // NO APPROVAL RECORD IS CREATED

            return res.status(201).json({
                message:
                    'Payment recorded successfully.',

                payment,

                needs_approval:
                    false
            });

        } catch (error) {

            console.error(
                'POST /api/payments ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to record payment.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// PUT /api/payments/:paymentId
//
// UPDATE PAYMENT
//
// Finance: Pending approval (requires review)
// Proprietor / Administrator: Approved immediately
// Manager: Cannot edit
//
// ============================================================

router.put(
    '/:paymentId',
    authenticateToken,
    async (req, res) => {

        try {

            const roleId =
                getRoleId(req.user);

            if (
                !PAYMENT_WRITE_ROLES.includes(
                    roleId
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. You are not authorized to edit payments.'
                });
            }

            const paymentId =
                parseInt(
                    req.params.paymentId,
                    10
                );

            if (
                Number.isNaN(
                    paymentId
                )
            ) {
                return res.status(400).json({
                    message:
                        'Invalid payment ID.'
                });
            }

            // ----------------------------------------------------
            // EXISTING PAYMENT
            // ----------------------------------------------------

            const {
                data: existingPayment,
                error: existingError
            } = await supabase
                .from('payments')
                .select(`
                    *,
                    students (
                        student_id,
                        school_section
                    )
                `)
                .eq(
                    'payment_id',
                    paymentId
                )
                .maybeSingle();

            if (existingError) {
                throw existingError;
            }

            if (!existingPayment) {

                return res.status(404).json({
                    message:
                        'Payment not found.'
                });
            }

            const studentSection =
                existingPayment.students
                    ?.school_section || null;

            const paymentSector =
                normalizeSector(
                    PRIMARY_SECTIONS.includes(
                        studentSection
                    )
                        ? 'primary'
                        : SECONDARY_SECTIONS.includes(
                            studentSection
                        )
                            ? 'secondary'
                            : null
                );

            // Finance officer sector restriction.
            if (
                roleId === FINANCE
            ) {

                const userSector =
                    normalizeSector(
                        getSector(req.user)
                    );

                if (
                    !userSector ||
                    userSector !== paymentSector
                ) {
                    return res.status(403).json({
                        message:
                            'Access denied. You cannot edit a payment outside your school sector.'
                    });
                }
            }

            // ----------------------------------------------------
            // UPDATE FIELDS
            // ----------------------------------------------------

            const {
                amount_paid,
                payment_method,
                payment_slip_number,
                bank_reference,
                purpose,
                notes
            } = req.body;

            const updateData = {};

            if (
                amount_paid !== undefined
            ) {

                const amount =
                    Number(
                        amount_paid
                    );

                if (
                    !Number.isFinite(
                        amount
                    ) ||
                    amount <= 0
                ) {
                    return res.status(400).json({
                        message:
                            'Amount paid must be greater than zero.'
                    });
                }

                updateData.amount_paid =
                    amount;
            }

            if (
                payment_method !== undefined
            ) {
                updateData.payment_method =
                    payment_method;
            }

            if (
                payment_slip_number !== undefined
            ) {
                updateData.payment_slip_number =
                    payment_slip_number;
            }

            if (
                bank_reference !== undefined
            ) {
                updateData.bank_reference =
                    bank_reference;
            }

            if (
                purpose !== undefined
            ) {
                updateData.purpose =
                    purpose;
            }

            if (
                notes !== undefined
            ) {
                updateData.notes =
                    notes;
            }

            // Finance changes require approval.
            if (
                roleId === FINANCE
            ) {
                updateData.approval_status =
                    'pending';
            } else {
                updateData.approval_status =
                    'approved';
            }

            // ----------------------------------------------------
            // UPDATE
            // ----------------------------------------------------

            const {
                data: updatedPayment,
                error: updateError
            } = await supabase
                .from('payments')
                .update(updateData)
                .eq(
                    'payment_id',
                    paymentId
                )
                .select()
                .single();

            if (updateError) {
                throw updateError;
            }

            // ----------------------------------------------------
            // APPROVAL RECORD FOR EDITS
            // ----------------------------------------------------

            if (
                roleId === FINANCE
            ) {

                const {
                    error: approvalError
                } = await supabase
                    .from('record_approvals')
                    .insert([{
                        record_type:
                            'payment',

                        record_id:
                            paymentId,

                        submitted_by:
                            req.user?.user_id ||
                            null,

                        approval_status:
                            'pending',

                        school_section:
                            studentSection ||
                            null,

                        submitted_at:
                            new Date().toISOString()
                    }]);

                if (approvalError) {

                    console.error(
                        'PAYMENT UPDATE APPROVAL ERROR:',
                        approvalError
                    );
                }
            }

            return res.json({
                message:
                    roleId === FINANCE
                        ? 'Payment updated and submitted for approval.'
                        : 'Payment updated successfully.',

                payment:
                    updatedPayment,

                needs_approval:
                    roleId === FINANCE
            });

        } catch (error) {

            console.error(
                'PUT /api/payments/:paymentId ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to update payment.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// DELETE /api/payments/:paymentId
//
// Finance: Creates pending approval (does NOT delete immediately)
// Proprietor / Administrator: Deletes immediately
// Manager: Cannot delete
//
// ============================================================

router.delete(
    '/:paymentId',
    authenticateToken,
    async (req, res) => {

        try {

            const roleId =
                getRoleId(req.user);

            if (
                !PAYMENT_WRITE_ROLES.includes(
                    roleId
                )
            ) {
                return res.status(403).json({
                    message:
                        'Access denied. You are not authorized to delete payments.'
                });
            }

            const paymentId =
                parseInt(
                    req.params.paymentId,
                    10
                );

            if (
                Number.isNaN(
                    paymentId
                )
            ) {
                return res.status(400).json({
                    message:
                        'Invalid payment ID.'
                });
            }

            // ----------------------------------------------------
            // EXISTING PAYMENT
            // ----------------------------------------------------

            const {
                data: existingPayment,
                error: existingError
            } = await supabase
                .from('payments')
                .select(`
                    *,
                    students (
                        student_id,
                        school_section
                    )
                `)
                .eq(
                    'payment_id',
                    paymentId
                )
                .maybeSingle();

            if (existingError) {
                throw existingError;
            }

            if (!existingPayment) {

                return res.status(404).json({
                    message:
                        'Payment not found.'
                });
            }

            const studentSection =
                existingPayment.students
                    ?.school_section || null;

            const paymentSector =
                normalizeSector(
                    PRIMARY_SECTIONS.includes(
                        studentSection
                    )
                        ? 'primary'
                        : SECONDARY_SECTIONS.includes(
                            studentSection
                        )
                            ? 'secondary'
                            : null
                );

            // ----------------------------------------------------
            // FINANCE SECTOR CHECK
            // ----------------------------------------------------

            if (
                roleId === FINANCE
            ) {

                const userSector =
                    normalizeSector(
                        getSector(req.user)
                    );

                if (
                    !userSector ||
                    userSector !== paymentSector
                ) {
                    return res.status(403).json({
                        message:
                            'Access denied. You cannot delete a payment outside your school sector.'
                    });
                }

                // ------------------------------------------------
                // FINANCE DELETE REQUIRES APPROVAL
                // ------------------------------------------------

                const {
                    error: approvalError
                } = await supabase
                    .from('record_approvals')
                    .insert([{
                        record_type:
                            'payment',

                        record_id:
                            paymentId,

                        submitted_by:
                            req.user?.user_id ||
                            null,

                        approval_status:
                            'pending',

                        school_section:
                            studentSection ||
                            null,

                        submitted_at:
                            new Date().toISOString()
                    }]);

                if (approvalError) {
                    throw approvalError;
                }

                return res.json({
                    message:
                        'Payment deletion submitted for approval.',

                    needs_approval:
                        true
                });
            }

            // ----------------------------------------------------
            // ADMIN / PROPRIETOR DELETE
            // ----------------------------------------------------

            const {
                error: deleteError
            } = await supabase
                .from('payments')
                .delete()
                .eq(
                    'payment_id',
                    paymentId
                );

            if (deleteError) {
                throw deleteError;
            }

            return res.json({
                message:
                    'Payment deleted successfully.',

                needs_approval:
                    false
            });

        } catch (error) {

            console.error(
                'DELETE /api/payments/:paymentId ERROR:',
                error
            );

            return res.status(500).json({
                message:
                    'Failed to delete payment.',
                error:
                    error.message
            });
        }
    }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;