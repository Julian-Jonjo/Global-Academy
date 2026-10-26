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

const PROPRIETOR                 = ROLE_IDS.PROPRIETOR;
const ADMINISTRATOR              = ROLE_IDS.ADMINISTRATOR;
const FINANCE                    = ROLE_IDS.FINANCE;
const TEACHER                    = ROLE_IDS.TEACHER;
const STUDENT                    = ROLE_IDS.STUDENT;
const MANAGER                    = ROLE_IDS.MANAGER;
const ADMIN_OFFICER              = ROLE_IDS.ADMIN_OFFICER;
const ACADEMIC_AFFAIRS_OFFICER   = ROLE_IDS.ACADEMIC_AFFAIRS_OFFICER;
const EXAMINATION_OFFICER        = ROLE_IDS.EXAMINATION_OFFICER;

const FINANCE_READ_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    FINANCE,
    MANAGER,
    ADMIN_OFFICER
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
// HELPERS
// ============================================================

function isAllowedRole(user, roles) {
    const roleId = getRoleId(user);
    return roles.includes(roleId);
}

function isAdminOrProprietor(user) {
    const roleId = getRoleId(user);
    return roleId === PROPRIETOR || roleId === ADMINISTRATOR;
}

function isSectorUser(user) {
    const roleId = getRoleId(user);
    return roleId === FINANCE || roleId === MANAGER;
}

function isAcademicAffairsOfficer(user) {
    return Number(user?.secondary_role_id) === ACADEMIC_AFFAIRS_OFFICER;
}

function getAAOSector(user) {
    return String(user?.aao_sector || '').trim().toLowerCase();
}

function normalizeSector(value) {
    if (!value) return null;
    const sector = String(value).trim().toLowerCase();
    if (sector === 'primary') return 'primary';
    if (sector === 'secondary') return 'secondary';
    return null;
}

function getSectionsForSector(sector) {
    if (sector === 'primary') return PRIMARY_SECTIONS;
    if (sector === 'secondary') return SECONDARY_SECTIONS;
    return [];
}

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}

async function fetchAllRows(buildQuery, pageSize = 1000) {
    const all = [];
    let from = 0;
    while (true) {
        const { data, error } = await buildQuery()
            .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

async function resolveAcademicYearId(academicYear) {
    if (academicYear) {
        const { data, error } = await supabase
            .from('academic_years')
            .select('academic_year_id')
            .eq('year_name', academicYear)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to resolve academic year: ${error.message}`);
        }
        if (data) return data.academic_year_id;
    }

    const { data: currentYear, error: currentYearError } = await supabase
        .from('academic_years')
        .select('academic_year_id')
        .eq('is_current', true)
        .maybeSingle();

    if (currentYearError) {
        throw new Error(`Failed to determine current academic year: ${currentYearError.message}`);
    }

    return currentYear?.academic_year_id || null;
}

function determineEffectiveSector(req, requestedSector) {

    const roleId = getRoleId(req.user);
    const authenticatedSector = normalizeSector(getSector(req.user));

    if (roleId === MANAGER) {
        if (!authenticatedSector) {
            return { error: 'Your account does not have a valid school sector.' };
        }
        return { sector: authenticatedSector };
    }

    if (isAcademicAffairsOfficer(req.user)) {
        const aaoSector = normalizeSector(getAAOSector(req.user));
        if (!aaoSector) {
            return { error: 'Your AAO account does not have a valid sector.' };
        }
        return { sector: aaoSector };
    }

    if (
        roleId === PROPRIETOR ||
        roleId === ADMINISTRATOR ||
        roleId === FINANCE ||
        roleId === ADMIN_OFFICER ||
        req.user?.is_exam_officer === true
    ) {
        if (!requestedSector) return { sector: null };
        const normalized = normalizeSector(requestedSector);
        if (!normalized) return { error: 'Invalid school sector.' };
        return { sector: normalized };
    }

    return { error: 'Access denied.' };
}

/* ============================================================
   WAIVER HELPERS
   ============================================================ */

async function buildWaivedMaps(studentIds, academicYearId) {

    const feeWaived = {};
    const studentWaived = {};

    if (!studentIds || !studentIds.length) {
        return { feeWaived, studentWaived };
    }

    const chunks = chunkArray(studentIds, 100);
    const allWaivers = [];

    for (const idChunk of chunks) {
        const rows = await fetchAllRows(() => {
            let q = supabase
                .from('student_fee_waivers')
                .select('waiver_id, student_id, student_fee_id, waive_type, waive_amount')
                .in('student_id', idChunk)
                .eq('status', 'approved');

            if (academicYearId) q = q.eq('academic_year_id', academicYearId);
            return q;
        });
        allWaivers.push(...rows);
    }

    const fullWaiverFeeIds = allWaivers
        .filter(w => w.waive_type === 'full' && w.student_fee_id)
        .map(w => w.student_fee_id);

    const feeAmountById = {};

    if (fullWaiverFeeIds.length) {
        const uniqueFeeIds = [...new Set(fullWaiverFeeIds)];
        const feeChunks = chunkArray(uniqueFeeIds, 100);

        for (const idChunk of feeChunks) {
            const rows = await fetchAllRows(() =>
                supabase
                    .from('student_fees')
                    .select('student_fee_id, amount_due')
                    .in('student_fee_id', idChunk)
            );
            rows.forEach(f => {
                feeAmountById[f.student_fee_id] = Number(f.amount_due || 0);
            });
        }
    }

    for (const w of allWaivers) {
        let amountWaived = 0;
        if (w.waive_type === 'full') {
            amountWaived = feeAmountById[w.student_fee_id] || 0;
        } else {
            amountWaived = Number(w.waive_amount || 0);
        }

        if (w.student_fee_id) {
            feeWaived[w.student_fee_id] =
                (feeWaived[w.student_fee_id] || 0) + amountWaived;
        }

        studentWaived[w.student_id] =
            (studentWaived[w.student_id] || 0) + amountWaived;
    }

    return { feeWaived, studentWaived };
}

/* ============================================================
   NET PAID HELPER (payments minus refunds)
   ============================================================ */

function netPaidFromRow(p) {
    return p.payment_type === 'refund'
        ? -Number(p.amount_paid || 0)
        :  Number(p.amount_paid || 0);
}

// ============================================================
// GET /api/payments
// ============================================================

router.get('/', authenticateToken, async (req, res) => {
    try {
        if (!isAllowedRole(req.user, FINANCE_READ_ROLES)) {
            return res.status(403).json({ message: 'Access denied. You do not have permission to view payment records.' });
        }

        const { sector: requestedSector, student_id, academic_year } = req.query;

        const sectorResult = determineEffectiveSector(req, requestedSector);
        if (sectorResult.error) return res.status(403).json({ message: sectorResult.error });

        const effectiveSector = sectorResult.sector;
        const academicYearId = await resolveAcademicYearId(academic_year);

        let studentIds = null;

        if (effectiveSector) {
            const sections = getSectionsForSector(effectiveSector);
            const { data: students, error: studentsError } = await supabase
                .from('students')
                .select('student_id')
                .in('school_section', sections);

            if (studentsError) {
                console.error('SECTOR STUDENTS ERROR:', studentsError);
                return res.status(500).json({ message: 'Failed to load students for the selected sector.', error: studentsError.message });
            }

            studentIds = (students || []).map(s => s.student_id);
            if (studentIds.length === 0) return res.json({ payments: [] });
        }

        let query = supabase
            .from('payments')
            .select(`
                payment_id,
                student_id,
                student_fee_id,
                amount_paid,
                payment_type,
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
            .order('payment_date', { ascending: false });

        if (student_id) {
            const parsedStudentId = parseInt(student_id, 10);
            if (Number.isNaN(parsedStudentId)) return res.status(400).json({ message: 'Invalid student_id.' });
            query = query.eq('student_id', parsedStudentId);
        }

        if (studentIds !== null) query = query.in('student_id', studentIds);
        if (academicYearId) query = query.eq('academic_year_id', academicYearId);

        const { data: payments, error: paymentError } = await query;

        if (paymentError) {
            console.error('PAYMENT HISTORY QUERY ERROR:', paymentError);
            return res.status(500).json({ message: 'Failed to load payment history.', error: paymentError.message });
        }

        const paymentRecords = payments || [];
        if (paymentRecords.length === 0) return res.json({ payments: [] });

        const paymentStudentIds = [...new Set(paymentRecords.map(p => p.student_id).filter(Boolean))];

        let studentsMap = {};
        if (paymentStudentIds.length > 0) {
            const { data: students, error: studentsError } = await supabase
                .from('students')
                .select('student_id, first_name, middle_name, last_name, admission_number, school_section')
                .in('student_id', paymentStudentIds);

            if (studentsError) {
                console.error('PAYMENT STUDENT DETAILS ERROR:', studentsError);
                return res.status(500).json({ message: 'Failed to load student information.', error: studentsError.message });
            }

            for (const s of students || []) studentsMap[s.student_id] = s;
        }

        const feeIds = [...new Set(paymentRecords.map(p => p.student_fee_id).filter(Boolean))];
        let feesMap = {};

        if (feeIds.length > 0) {
            const { data: fees, error: feesError } = await supabase
                .from('student_fees')
                .select('student_fee_id, fee_type_id, amount_due')
                .in('student_fee_id', feeIds);

            if (feesError) {
                console.error('PAYMENT FEE DETAILS ERROR:', feesError);
                return res.status(500).json({ message: 'Failed to load fee information.', error: feesError.message });
            }

            for (const f of fees || []) feesMap[f.student_fee_id] = f;
        }

        const result = paymentRecords.map(payment => {
            const student = studentsMap[payment.student_id] || {};
            const fee = feesMap[payment.student_fee_id] || {};

            return {
                ...payment,
                student: {
                    student_id: student.student_id || payment.student_id,
                    first_name: student.first_name || '',
                    middle_name: student.middle_name || '',
                    last_name: student.last_name || '',
                    admission_number: student.admission_number || '',
                    school_section: student.school_section || null
                },
                fee: {
                    student_fee_id: fee.student_fee_id || payment.student_fee_id || null,
                    fee_type_id: fee.fee_type_id || null,
                    amount_due: Number(fee.amount_due || 0)
                }
            };
        });

        return res.json({ payments: result });

    } catch (error) {
        console.error('GET /api/payments ERROR:', error);
        return res.status(500).json({ message: 'Server error while loading payment history.', error: error.message });
    }
});

// ============================================================
// GET /api/payments/history
// ============================================================

router.get('/history', authenticateToken, async (req, res) => {
    try {
        if (!isAllowedRole(req.user, FINANCE_READ_ROLES)) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const { student_id, sector, academic_year } = req.query;

        const sectorResult = determineEffectiveSector(req, sector);
        if (sectorResult.error) return res.status(403).json({ message: sectorResult.error });

        const effectiveSector = sectorResult.sector;
        const academicYearId = await resolveAcademicYearId(academic_year);

        let query = supabase
            .from('payments')
            .select('*')
            .order('payment_date', { ascending: false });

        if (student_id) query = query.eq('student_id', parseInt(student_id, 10));
        if (academicYearId) query = query.eq('academic_year_id', academicYearId);

        if (effectiveSector) {
            const sections = getSectionsForSector(effectiveSector);
            const { data: students, error } = await supabase
                .from('students')
                .select('student_id')
                .in('school_section', sections);

            if (error) throw error;

            const ids = (students || []).map(s => s.student_id);
            if (ids.length === 0) return res.json({ payments: [] });

            query = query.in('student_id', ids);
        }

        const { data: payments, error } = await query;
        if (error) throw error;

        return res.json({ payments: payments || [] });

    } catch (error) {
        console.error('PAYMENT HISTORY ERROR:', error);
        return res.status(500).json({ message: 'Failed to load payment history.', error: error.message });
    }
});

// ============================================================
// GET /api/payments/summary
// ============================================================

router.get('/summary', authenticateToken, async (req, res) => {
    try {
        if (!isAllowedRole(req.user, FINANCE_READ_ROLES)) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const { sector, academic_year } = req.query;

        const sectorResult = determineEffectiveSector(req, sector);
        if (sectorResult.error) return res.status(403).json({ message: sectorResult.error });

        const effectiveSector = sectorResult.sector;
        const academicYearId = await resolveAcademicYearId(academic_year);

        let studentIds = null;

        if (effectiveSector) {
            const sections = getSectionsForSector(effectiveSector);
            const { data: students, error: studentsError } = await supabase
                .from('students')
                .select('student_id')
                .in('school_section', sections);

            if (studentsError) throw studentsError;
            studentIds = (students || []).map(s => s.student_id);
        }

        let totalExpected = 0;

        if (studentIds === null) {
            const rows = await fetchAllRows(() => {
                let q = supabase
                    .from('student_fees')
                    .select('student_fee_id, amount_due');
                if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                return q;
            });
            totalExpected = rows.reduce((sum, r) => sum + Number(r.amount_due || 0), 0);
        } else if (studentIds.length > 0) {
            const chunks = chunkArray(studentIds, 100);
            for (const idChunk of chunks) {
                const rows = await fetchAllRows(() => {
                    let q = supabase
                        .from('student_fees')
                        .select('student_fee_id, amount_due')
                        .in('student_id', idChunk);
                    if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                    return q;
                });
                totalExpected += rows.reduce((sum, r) => sum + Number(r.amount_due || 0), 0);
            }
        }

        /* ---- total collected (payments − refunds) ---- */
        let totalCollected = 0;

        if (studentIds === null) {
            const rows = await fetchAllRows(() => {
                let q = supabase
                    .from('payments')
                    .select('payment_id, amount_paid, payment_type')
                    .eq('approval_status', 'approved');
                if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                return q;
            });
            totalCollected = rows.reduce((sum, r) => sum + netPaidFromRow(r), 0);
        } else if (studentIds.length > 0) {
            const chunks = chunkArray(studentIds, 100);
            for (const idChunk of chunks) {
                const rows = await fetchAllRows(() => {
                    let q = supabase
                        .from('payments')
                        .select('payment_id, amount_paid, payment_type')
                        .in('student_id', idChunk)
                        .eq('approval_status', 'approved');
                    if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                    return q;
                });
                totalCollected += rows.reduce((sum, r) => sum + netPaidFromRow(r), 0);
            }
        }

        /* ---- total waived ---- */
        let totalWaived = 0;

        if (studentIds === null) {
            const waiverRows = await fetchAllRows(() => {
                let q = supabase
                    .from('student_fee_waivers')
                    .select('waiver_id, waive_type, waive_amount, student_fee_id')
                    .eq('status', 'approved');
                if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                return q;
            });

            const fullFeeIds = waiverRows
                .filter(w => w.waive_type === 'full' && w.student_fee_id)
                .map(w => w.student_fee_id);

            let feeAmt = {};
            if (fullFeeIds.length) {
                const uniqueIds = [...new Set(fullFeeIds)];
                const feeChunks = chunkArray(uniqueIds, 100);
                for (const idChunk of feeChunks) {
                    const rows = await fetchAllRows(() =>
                        supabase
                            .from('student_fees')
                            .select('student_fee_id, amount_due')
                            .in('student_fee_id', idChunk)
                    );
                    rows.forEach(f => { feeAmt[f.student_fee_id] = Number(f.amount_due || 0); });
                }
            }

            waiverRows.forEach(w => {
                if (w.waive_type === 'full') {
                    totalWaived += feeAmt[w.student_fee_id] || 0;
                } else {
                    totalWaived += Number(w.waive_amount || 0);
                }
            });

        } else if (studentIds.length > 0) {
            const chunks = chunkArray(studentIds, 100);
            for (const idChunk of chunks) {
                const waiverRows = await fetchAllRows(() => {
                    let q = supabase
                        .from('student_fee_waivers')
                        .select('waiver_id, waive_type, waive_amount, student_fee_id')
                        .in('student_id', idChunk)
                        .eq('status', 'approved');
                    if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                    return q;
                });

                const fullFeeIds = waiverRows
                    .filter(w => w.waive_type === 'full' && w.student_fee_id)
                    .map(w => w.student_fee_id);

                let feeAmt = {};
                if (fullFeeIds.length) {
                    const uniqueIds = [...new Set(fullFeeIds)];
                    const feeChunks = chunkArray(uniqueIds, 100);
                    for (const idFeeChunk of feeChunks) {
                        const rows = await fetchAllRows(() =>
                            supabase
                                .from('student_fees')
                                .select('student_fee_id, amount_due')
                                .in('student_fee_id', idFeeChunk)
                        );
                        rows.forEach(f => { feeAmt[f.student_fee_id] = Number(f.amount_due || 0); });
                    }
                }

                waiverRows.forEach(w => {
                    if (w.waive_type === 'full') {
                        totalWaived += feeAmt[w.student_fee_id] || 0;
                    } else {
                        totalWaived += Number(w.waive_amount || 0);
                    }
                });
            }
        }

        const effectiveExpected = Math.max(0, totalExpected - totalWaived);
        const totalOutstanding = Math.max(0, effectiveExpected - totalCollected);

        let studentCountQuery = supabase
            .from('students')
            .select('student_id', { count: 'exact', head: true })
            .eq('student_status', 'Active');

        if (effectiveSector) {
            studentCountQuery = studentCountQuery.in('school_section', getSectionsForSector(effectiveSector));
        }

        const { count: totalStudents, error: studentCountError } = await studentCountQuery;
        if (studentCountError) {
            console.error('STUDENT COUNT ERROR:', studentCountError);
            throw studentCountError;
        }

        const summary = {
            total_expected: totalExpected,
            total_waived: totalWaived,
            effective_expected: effectiveExpected,
            total_collected: totalCollected,
            total_outstanding: totalOutstanding,
            total_students: totalStudents || 0
        };

        return res.json({ summary });

    } catch (error) {
        console.error('PAYMENT SUMMARY ERROR:', error);
        return res.status(500).json({ message: 'Failed to load payment summary.', error: error.message });
    }
});

// ============================================================
// GET /api/payments/students
// ============================================================

router.get('/students', authenticateToken, async (req, res) => {
    try {
        if (!isAllowedRole(req.user, FINANCE_READ_ROLES)) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const { sector, academic_year } = req.query;

        const sectorResult = determineEffectiveSector(req, sector);
        if (sectorResult.error) return res.status(403).json({ message: sectorResult.error });

        const effectiveSector = sectorResult.sector;
        const academicYearId = await resolveAcademicYearId(academic_year);

        let studentQuery = supabase
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
            .eq('student_status', 'Active');

        if (effectiveSector) {
            studentQuery = studentQuery.in('school_section', getSectionsForSector(effectiveSector));
        }

        const { data: students, error: studentError } = await studentQuery;
        if (studentError) {
            console.error('STUDENT FINANCE QUERY ERROR:', studentError);
            throw studentError;
        }

        const studentRecords = students || [];
        if (studentRecords.length === 0) return res.json({ students: [] });

        const studentIds = studentRecords.map(s => s.student_id);
        const studentIdChunks = chunkArray(studentIds, 100);

        /* ---- student_fees ---- */
        let feeRecords = [];
        for (const idChunk of studentIdChunks) {
            const chunkRows = await fetchAllRows(() => {
                let q = supabase
                    .from('student_fees')
                    .select(`
                        student_fee_id,
                        student_id,
                        fee_type_id,
                        amount_due,
                        academic_year_id,
                        fee_types ( fee_name )
                    `)
                    .in('student_id', idChunk);
                if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                return q;
            });
            feeRecords = feeRecords.concat(chunkRows);
        }

        /* ---- payments (approved) ---- */
        let paymentRecords = [];
        for (const idChunk of studentIdChunks) {
            const chunkRows = await fetchAllRows(() => {
                let q = supabase
                    .from('payments')
                    .select(`
                        payment_id,
                        student_id,
                        student_fee_id,
                        amount_paid,
                        payment_type,
                        approval_status,
                        academic_year_id
                    `)
                    .in('student_id', idChunk)
                    .eq('approval_status', 'approved');
                if (academicYearId) q = q.eq('academic_year_id', academicYearId);
                return q;
            });
            paymentRecords = paymentRecords.concat(chunkRows);
        }

        /* ---- approved waivers ---- */
        const { feeWaived, studentWaived } = await buildWaivedMaps(studentIds, academicYearId);

        /* ---- maps (net of refunds) ---- */
        const paymentMapByFee = {};
        for (const payment of paymentRecords || []) {
            const key = `${payment.student_id}_${payment.student_fee_id}`;
            if (!paymentMapByFee[key]) paymentMapByFee[key] = 0;
            paymentMapByFee[key] += netPaidFromRow(payment);
        }

        const paymentMapByStudent = {};
        for (const payment of paymentRecords || []) {
            if (!paymentMapByStudent[payment.student_id]) paymentMapByStudent[payment.student_id] = 0;
            paymentMapByStudent[payment.student_id] += netPaidFromRow(payment);
        }

        const feeMap = {};
        for (const fee of feeRecords || []) {
            if (!feeMap[fee.student_id]) feeMap[fee.student_id] = [];
            feeMap[fee.student_id].push(fee);
        }

        const result = studentRecords.map(student => {
            const fees = feeMap[student.student_id] || [];

            const feesWithPayments = fees.map(fee => {
                const key = `${student.student_id}_${fee.student_fee_id}`;
                const feePaid = Number(paymentMapByFee[key] || 0);
                const waived = Number(feeWaived[fee.student_fee_id] || 0);
                const dueAfterWaiver = Math.max(0, Number(fee.amount_due || 0) - waived);

                return {
                    ...fee,
                    amount_paid: feePaid,
                    waived_amount: waived,
                    effective_due: dueAfterWaiver,
                    balance: Math.max(0, dueAfterWaiver - feePaid)
                };
            });

            const totalDue = fees.reduce((sum, fee) => sum + Number(fee.amount_due || 0), 0);
            const totalPaid = Number(paymentMapByStudent[student.student_id] || 0);
            const totalWaived = Number(studentWaived[student.student_id] || 0);
            const effectiveDue = Math.max(0, totalDue - totalWaived);
            const outstanding = Math.max(0, effectiveDue - totalPaid);

            return {
                student_id: student.student_id,
                first_name: student.first_name,
                middle_name: student.middle_name,
                last_name: student.last_name,
                admission_number: student.admission_number,
                student_status: student.student_status,
                school_section: student.school_section,
                class_id: student.class_id || student.classes?.class_id || null,
                class_name: student.classes?.class_name || '',
                arm: student.classes?.arm || '',
                fees: feesWithPayments,
                total_due: totalDue,
                total_waived: totalWaived,
                effective_due: effectiveDue,
                total_paid: totalPaid,
                outstanding
            };
        });

        return res.json({ students: result });

    } catch (error) {
        console.error('GET /api/payments/students ERROR:', error);
        return res.status(500).json({ message: 'Failed to load finance students.', error: error.message });
    }
});

// ============================================================
// GET /api/payments/fees
// ============================================================

router.get('/fees', authenticateToken, async (req, res) => {
    try {
        if (!isAllowedRole(req.user, FINANCE_READ_ROLES)) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const { sector } = req.query;

        const sectorResult = determineEffectiveSector(req, sector);
        if (sectorResult.error) return res.status(403).json({ message: sectorResult.error });

        const effectiveSector = sectorResult.sector;

        let query = supabase
            .from('fee_catalog')
            .select('*')
            .eq('is_active', true);

        if (effectiveSector) query = query.eq('sector', effectiveSector);

        const { data, error } = await query;

        if (error) {
            console.error('FEE CATEGORIES ERROR:', error);
            return res.status(500).json({ message: 'Failed to load fee categories.', error: error.message });
        }

        return res.json({ fees: data || [] });

    } catch (error) {
        console.error('GET /api/payments/fees ERROR:', error);
        return res.status(500).json({ message: 'Failed to load fees.', error: error.message });
    }
});

// ============================================================
// POST /api/payments
// ============================================================

router.post('/', authenticateToken, async (req, res) => {
    try {
        const roleId = getRoleId(req.user);
        if (!PAYMENT_WRITE_ROLES.includes(roleId)) {
            return res.status(403).json({ message: 'Access denied. You are not authorized to record payments.' });
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

        const parsedStudentId = parseInt(student_id, 10);
        const parsedFeeId = parseInt(fee_id, 10);
        const parsedAmount = Number(amount_paid);

        if (Number.isNaN(parsedStudentId)) return res.status(400).json({ message: 'Valid student_id is required.' });
        if (Number.isNaN(parsedFeeId)) return res.status(400).json({ message: 'Valid fee_id is required.' });
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ message: 'Amount paid must be greater than zero.' });

        const { data: student, error: studentError } = await supabase
            .from('students')
            .select('student_id, school_section')
            .eq('student_id', parsedStudentId)
            .maybeSingle();

        if (studentError) throw studentError;
        if (!student) return res.status(404).json({ message: 'Student not found.' });

        const studentSector = normalizeSector(
            PRIMARY_SECTIONS.includes(student.school_section) ? 'primary'
            : SECONDARY_SECTIONS.includes(student.school_section) ? 'secondary'
            : null
        );

        if (!studentSector) return res.status(400).json({ message: 'Student does not belong to a valid school sector.' });

        const { data: studentFee, error: studentFeeError } = await supabase
            .from('student_fees')
            .select('student_fee_id, student_id, amount_due, academic_year_id')
            .eq('student_fee_id', parsedFeeId)
            .eq('student_id', parsedStudentId)
            .maybeSingle();

        if (studentFeeError) throw studentFeeError;
        if (!studentFee) return res.status(404).json({ message: 'Student fee record not found.' });

        /* approved waivers on this fee */
        const { data: approvedWaivers } = await supabase
            .from('student_fee_waivers')
            .select('waive_type, waive_amount')
            .eq('student_id', parsedStudentId)
            .eq('student_fee_id', parsedFeeId)
            .eq('status', 'approved');

        let waivedAmount = 0;
        for (const w of approvedWaivers || []) {
            if (w.waive_type === 'full') waivedAmount += Number(studentFee.amount_due || 0);
            else waivedAmount += Number(w.waive_amount || 0);
        }

        /* net paid on this fee (payments − refunds) */
        const { data: existingPayments } = await supabase
            .from('payments')
            .select('amount_paid, payment_type')
            .eq('student_id', parsedStudentId)
            .eq('student_fee_id', parsedFeeId)
            .eq('approval_status', 'approved');

        const alreadyPaid = (existingPayments || []).reduce((sum, p) => sum + netPaidFromRow(p), 0);

        const effectiveBalance = Math.max(0, Number(studentFee.amount_due || 0) - waivedAmount - alreadyPaid);

        if (parsedAmount > effectiveBalance) {
            return res.status(400).json({
                message: `Amount exceeds the outstanding balance. Effective balance after waiver and prior payments: ${effectiveBalance.toFixed(2)}.`
            });
        }

        let academicYearId = studentFee.academic_year_id || await resolveAcademicYearId(academic_year);
        if (!academicYearId) return res.status(400).json({ message: 'No valid academic year could be determined.' });

        const { data: payment, error: paymentError } = await supabase
            .from('payments')
            .insert([{
                student_id: parsedStudentId,
                student_fee_id: parsedFeeId,
                amount_paid: parsedAmount,
                payment_type: 'payment',
                payment_method: payment_method || null,
                payment_slip_number: payment_slip_number || null,
                bank_reference: bank_reference || null,
                purpose: purpose || null,
                notes: notes || null,
                payment_date: new Date().toISOString(),
                approval_status: 'approved',
                recorded_by: req.user?.user_id || null,
                academic_year_id: academicYearId
            }])
            .select()
            .single();

        if (paymentError) throw paymentError;

        return res.status(201).json({
            message: 'Payment recorded successfully.',
            payment,
            needs_approval: false
        });

    } catch (error) {
        console.error('POST /api/payments ERROR:', error);
        return res.status(500).json({ message: 'Failed to record payment.', error: error.message });
    }
});

// ============================================================
// POST /api/payments/refund
// ============================================================

router.post('/refund', authenticateToken, async (req, res) => {
    try {
        const roleId = getRoleId(req.user);
        if (!PAYMENT_WRITE_ROLES.includes(roleId)) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        const {
            student_id,
            student_fee_id,
            amount,
            reason,
            payment_method,
            payment_slip_number,
            notes
        } = req.body;

        const studentId = parseInt(student_id, 10);
        const feeId = parseInt(student_fee_id, 10);
        const refundAmount = Number(amount);

        if (Number.isNaN(studentId)) return res.status(400).json({ message: 'Valid student_id required.' });
        if (Number.isNaN(feeId)) return res.status(400).json({ message: 'Valid student_fee_id required.' });
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) return res.status(400).json({ message: 'Refund amount must be greater than zero.' });
        if (!reason || !String(reason).trim()) return res.status(400).json({ message: 'Reason is required for a refund.' });

        const { data: feeRow, error: feeErr } = await supabase
            .from('student_fees')
            .select('student_fee_id, student_id, academic_year_id')
            .eq('student_fee_id', feeId)
            .eq('student_id', studentId)
            .maybeSingle();

        if (feeErr) throw feeErr;
        if (!feeRow) return res.status(404).json({ message: 'Student fee record not found.' });

        const { data: pastRows } = await supabase
            .from('payments')
            .select('amount_paid, payment_type')
            .eq('student_id', studentId)
            .eq('student_fee_id', feeId)
            .eq('approval_status', 'approved');

        const netPaid = (pastRows || []).reduce((sum, p) => sum + netPaidFromRow(p), 0);

        if (refundAmount > netPaid) {
            return res.status(400).json({
                message: `Refund exceeds the amount currently paid on this fee (Le ${netPaid.toFixed(2)}).`
            });
        }

        const { data: refund, error } = await supabase
            .from('payments')
            .insert([{
                student_id: studentId,
                student_fee_id: feeId,
                amount_paid: refundAmount,
                payment_type: 'refund',
                payment_method: payment_method || null,
                payment_slip_number: payment_slip_number || null,
                purpose: 'REFUND',
                notes: reason,
                payment_date: new Date().toISOString(),
                approval_status: 'approved',
                recorded_by: req.user?.user_id || null,
                academic_year_id: feeRow.academic_year_id || null
            }])
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({ message: 'Refund recorded.', refund });

    } catch (error) {
        console.error('POST /api/payments/refund ERROR:', error);
        return res.status(500).json({ message: 'Failed to record refund.', error: error.message });
    }
});

// ============================================================
// PUT /api/payments/:paymentId
// ============================================================

router.put('/:paymentId', authenticateToken, async (req, res) => {
    try {
        const roleId = getRoleId(req.user);
        if (!PAYMENT_WRITE_ROLES.includes(roleId)) {
            return res.status(403).json({ message: 'Access denied. You are not authorized to edit payments.' });
        }

        const paymentId = parseInt(req.params.paymentId, 10);
        if (Number.isNaN(paymentId)) return res.status(400).json({ message: 'Invalid payment ID.' });

        const { data: existingPayment, error: existingError } = await supabase
            .from('payments')
            .select(`*, students ( student_id, school_section )`)
            .eq('payment_id', paymentId)
            .maybeSingle();

        if (existingError) throw existingError;
        if (!existingPayment) return res.status(404).json({ message: 'Payment not found.' });

        const studentSection = existingPayment.students?.school_section || null;

        const {
            amount_paid,
            payment_method,
            payment_slip_number,
            bank_reference,
            purpose,
            notes
        } = req.body;

        const updateData = {};

        if (amount_paid !== undefined) {
            const amount = Number(amount_paid);
            if (!Number.isFinite(amount) || amount <= 0) {
                return res.status(400).json({ message: 'Amount paid must be greater than zero.' });
            }
            updateData.amount_paid = amount;
        }

        if (payment_method !== undefined) updateData.payment_method = payment_method;
        if (payment_slip_number !== undefined) updateData.payment_slip_number = payment_slip_number;
        if (bank_reference !== undefined) updateData.bank_reference = bank_reference;
        if (purpose !== undefined) updateData.purpose = purpose;
        if (notes !== undefined) updateData.notes = notes;

        updateData.approval_status = roleId === FINANCE ? 'pending' : 'approved';

        const { data: updatedPayment, error: updateError } = await supabase
            .from('payments')
            .update(updateData)
            .eq('payment_id', paymentId)
            .select()
            .single();

        if (updateError) throw updateError;

        if (roleId === FINANCE) {
            const { error: approvalError } = await supabase
                .from('record_approvals')
                .insert([{
                    record_type: 'payment',
                    record_id: paymentId,
                    submitted_by: req.user?.user_id || null,
                    approval_status: 'pending',
                    school_section: studentSection || null,
                    submitted_at: new Date().toISOString()
                }]);

            if (approvalError) {
                console.error('PAYMENT UPDATE APPROVAL ERROR:', approvalError);
            }
        }

        return res.json({
            message: roleId === FINANCE
                ? 'Payment updated and submitted for approval.'
                : 'Payment updated successfully.',
            payment: updatedPayment,
            needs_approval: roleId === FINANCE
        });

    } catch (error) {
        console.error('PUT /api/payments/:paymentId ERROR:', error);
        return res.status(500).json({ message: 'Failed to update payment.', error: error.message });
    }
});

// ============================================================
// DELETE /api/payments/:paymentId
// ============================================================

router.delete('/:paymentId', authenticateToken, async (req, res) => {
    try {
        const roleId = getRoleId(req.user);
        if (!PAYMENT_WRITE_ROLES.includes(roleId)) {
            return res.status(403).json({ message: 'Access denied. You are not authorized to delete payments.' });
        }

        const paymentId = parseInt(req.params.paymentId, 10);
        if (Number.isNaN(paymentId)) return res.status(400).json({ message: 'Invalid payment ID.' });

        const { data: existingPayment, error: existingError } = await supabase
            .from('payments')
            .select(`*, students ( student_id, school_section )`)
            .eq('payment_id', paymentId)
            .maybeSingle();

        if (existingError) throw existingError;
        if (!existingPayment) return res.status(404).json({ message: 'Payment not found.' });

        const studentSection = existingPayment.students?.school_section || null;

        if (roleId === FINANCE) {
            const { error: approvalError } = await supabase
                .from('record_approvals')
                .insert([{
                    record_type: 'payment',
                    record_id: paymentId,
                    submitted_by: req.user?.user_id || null,
                    approval_status: 'pending',
                    school_section: studentSection || null,
                    submitted_at: new Date().toISOString()
                }]);

            if (approvalError) throw approvalError;

            return res.json({
                message: 'Payment deletion submitted for approval.',
                needs_approval: true
            });
        }

        const { error: deleteError } = await supabase
            .from('payments')
            .delete()
            .eq('payment_id', paymentId);

        if (deleteError) throw deleteError;

        return res.json({
            message: 'Payment deleted successfully.',
            needs_approval: false
        });

    } catch (error) {
        console.error('DELETE /api/payments/:paymentId ERROR:', error);
        return res.status(500).json({ message: 'Failed to delete payment.', error: error.message });
    }
});

// ============================================================
// EXPORT
// ============================================================

module.exports = router;