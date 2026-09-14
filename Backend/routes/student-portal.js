const express = require('express');
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles,
    ROLE_IDS
} = require('../middleware/authMiddleware');

const router = express.Router();

const STUDENT = ROLE_IDS.STUDENT; // 5

/* =========================================================
   GUARD
   Every route:
     - requires a valid token
     - requires role_id = 5 (Student)
     - requires req.user.student_id
   The student's own ID comes from the JWT, never the URL.
   ========================================================= */

function requireStudent(req, res, next) {
    if (!req.user || !req.user.student_id) {
        return res.status(403).json({
            message: 'Student profile is not linked to this account.'
        });
    }
    next();
}


/* =========================================================
   GET /me — Own profile
   ========================================================= */

router.get(
    '/me',
    authenticateToken,
    requireRoles(STUDENT),
    requireStudent,
    async (req, res) => {

        try {

            const studentId = req.user.student_id;

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
                    nationality,
                    phone,
                    address,
                    photo_url,
                    admission_date,
                    registration_date,
                    student_status,
                    school_section,
                    class_id,
                    guardian_id,
                    classes (
                        class_id,
                        class_name,
                        arm,
                        school_section
                    )
                `)
                .eq('student_id', studentId)
                .maybeSingle();

            if (error) throw error;

            if (!student) {
                return res.status(404).json({
                    message: 'Student record not found.'
                });
            }

            let guardian = null;

            if (student.guardian_id) {
                const { data } = await supabase
                    .from('guardians')
                    .select('guardian_id, full_name, relationship, phone, email, address')
                    .eq('guardian_id', student.guardian_id)
                    .maybeSingle();

                guardian = data || null;
            }

            return res.json({
                ...student,
                class_name: student.classes?.class_name || null,
                arm: student.classes?.arm || null,
                guardian
            });

        } catch (error) {
            console.error('STUDENT PORTAL /me ERROR:', error);
            return res.status(500).json({
                message: 'Failed to load profile.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET /classmates — Names + class only, no contact
   ========================================================= */

router.get(
    '/classmates',
    authenticateToken,
    requireRoles(STUDENT),
    requireStudent,
    async (req, res) => {

        try {

            const studentId = req.user.student_id;

            const { data: me } = await supabase
                .from('students')
                .select('class_id')
                .eq('student_id', studentId)
                .maybeSingle();

            if (!me?.class_id) {
                return res.json([]);
            }

            const { data, error } = await supabase
                .from('students')
                .select('student_id, first_name, middle_name, last_name, gender, photo_url')
                .eq('class_id', me.class_id)
                .eq('student_status', 'Active')
                .order('last_name');

            if (error) throw error;

            return res.json(data || []);

        } catch (error) {
            console.error('STUDENT PORTAL /classmates ERROR:', error);
            return res.status(500).json({
                message: 'Failed to load classmates.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET /attendance — Own attendance only
   ========================================================= */

router.get(
    '/attendance',
    authenticateToken,
    requireRoles(STUDENT),
    requireStudent,
    async (req, res) => {

        try {

            const studentId = req.user.student_id;

            const { data, error } = await supabase
                .from('attendance')
                .select('attendance_id, attendance_date, status, session, remarks')
                .eq('student_id', studentId)
                .order('attendance_date', { ascending: false });

            if (error) throw error;

            const rows = data || [];
            const present = rows.filter(r => r.status === 'Present').length;
            const absent  = rows.filter(r => r.status === 'Absent').length;
            const late    = rows.filter(r => r.status === 'Late').length;
            const total   = rows.length;
            const percentage = total ? Math.round((present / total) * 100) : 0;

            return res.json({
                summary: { total, present, absent, late, percentage },
                records: rows
            });

        } catch (error) {
            console.error('STUDENT PORTAL /attendance ERROR:', error);
            return res.status(500).json({
                message: 'Failed to load attendance.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET /results — Own results, mirroring /api/results/report
   ========================================================= */

router.get(
    '/results',
    authenticateToken,
    requireRoles(STUDENT),
    requireStudent,
    async (req, res) => {

        try {

            const studentId = req.user.student_id;

            const { data: student, error: stuErr } = await supabase
                .from('students')
                .select('student_id, admission_number, first_name, middle_name, last_name, gender, date_of_birth, photo_url, class_id, school_section')
                .eq('student_id', studentId)
                .single();

            if (stuErr || !student) {
                return res.status(404).json({ message: 'Student not found.' });
            }

            const classId = student.class_id;

            const { data: classData } = await supabase
                .from('classes')
                .select('class_id, class_name, arm, school_section, academic_year_id')
                .eq('class_id', classId)
                .maybeSingle();

            const { data: studentResults } = await supabase
                .from('results')
                .select('subject_id, term, test_score, exam_score, total_score, subjects!subject_id ( subject_id, subject_name )')
                .eq('student_id', studentId)
                .order('term');

            const { data: classResults } = await supabase
                .from('results')
                .select('student_id, subject_id, term, total_score')
                .eq('class_id', classId);

            const { data: termRows } = await supabase
                .from('terms')
                .select('term_id, term_name, academic_year_id, start_date, end_date, is_current')
                .order('start_date');

            const { data: attendanceRows } = await supabase
                .from('attendance')
                .select('attendance_date, status')
                .eq('student_id', studentId);

            const { data: termComments } = await supabase
                .from('student_term_comments')
                .select('term_id, comment')
                .eq('student_id', studentId);

            const { data: currentYear } = await supabase
                .from('academic_years')
                .select('academic_year_id, year_name')
                .eq('is_current', true)
                .maybeSingle();

            let yearComment = null;
            if (currentYear) {
                const { data: yc } = await supabase
                    .from('student_year_comments')
                    .select('comment')
                    .eq('student_id', studentId)
                    .eq('academic_year_id', currentYear.academic_year_id)
                    .maybeSingle();
                yearComment = yc?.comment || null;
            }

            const buildTermSummary = (termNumber) => {

                const termRow = (termRows || []).find(t => t.term_id === termNumber);

                const subjectRows = (studentResults || [])
                    .filter(r => Number(r.term) === termNumber)
                    .map(r => ({
                        subject_id: r.subject_id,
                        subject_name: r.subjects?.subject_name || '—',
                        test_score: r.test_score,
                        exam_score: r.exam_score,
                        total_score: r.total_score
                    }))
                    .sort((a, b) => a.subject_name.localeCompare(b.subject_name));

                subjectRows.forEach(sr => {
                    const allInSubject = (classResults || [])
                        .filter(cr =>
                            Number(cr.term) === termNumber &&
                            Number(cr.subject_id) === Number(sr.subject_id)
                        )
                        .map(cr => ({ student_id: cr.student_id, total: cr.total_score || 0 }))
                        .sort((a, b) => b.total - a.total);

                    const pos = allInSubject.findIndex(
                        x => Number(x.student_id) === studentId
                    ) + 1;

                    sr.position = pos > 0 ? pos : null;
                    sr.class_size = allInSubject.length;
                });

                const studentTotal = subjectRows.reduce(
                    (sum, r) => sum + (r.total_score || 0),
                    0
                );
                const studentAverage = subjectRows.length
                    ? studentTotal / subjectRows.length
                    : 0;

                const totalByStudent = new Map();
                (classResults || [])
                    .filter(cr => Number(cr.term) === termNumber)
                    .forEach(cr => {
                        const id = Number(cr.student_id);
                        totalByStudent.set(
                            id,
                            (totalByStudent.get(id) || 0) + (cr.total_score || 0)
                        );
                    });

                const ranked = Array.from(totalByStudent.entries())
                    .map(([id, total]) => ({ student_id: id, total }))
                    .sort((a, b) => b.total - a.total);

                const classPosition =
                    ranked.findIndex(x => Number(x.student_id) === studentId) + 1;

                let presentCount = 0, absentCount = 0;
                if (termRow) {
                    (attendanceRows || []).forEach(a => {
                        if (
                            a.attendance_date >= termRow.start_date &&
                            a.attendance_date <= termRow.end_date
                        ) {
                            if (a.status === 'Present') presentCount++;
                            else if (a.status === 'Absent') absentCount++;
                        }
                    });
                }
                const totalDays = presentCount + absentCount;
                const attendancePct = totalDays
                    ? Math.round((presentCount / totalDays) * 100)
                    : 0;

                const termCommentRow = (termComments || []).find(
                    tc => Number(tc.term_id) === termNumber
                );

                return {
                    term_id: termNumber,
                    term_name: termRow?.term_name || `Term ${termNumber}`,
                    subjects: subjectRows,
                    student_total: studentTotal,
                    student_average: Number(studentAverage.toFixed(2)),
                    class_position: classPosition > 0 ? classPosition : null,
                    class_size: ranked.length,
                    attendance: {
                        present: presentCount,
                        absent: absentCount,
                        percentage: attendancePct
                    },
                    term_comment: termCommentRow?.comment || null
                };
            };

            return res.json({
                student: {
                    student_id: student.student_id,
                    admission_number: student.admission_number,
                    first_name: student.first_name,
                    middle_name: student.middle_name,
                    last_name: student.last_name,
                    gender: student.gender,
                    date_of_birth: student.date_of_birth,
                    photo_url: student.photo_url,
                    class_id: classId,
                    class_name: classData?.class_name || null,
                    arm: classData?.arm || null,
                    school_section: student.school_section || classData?.school_section || null
                },
                academic_year: currentYear?.year_name || null,
                terms: [buildTermSummary(1), buildTermSummary(2), buildTermSummary(3)],
                year_comment: yearComment
            });

        } catch (error) {
            console.error('STUDENT PORTAL /results ERROR:', error);
            return res.status(500).json({
                message: 'Failed to load results.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET /discipline — Own discipline records only
   ========================================================= */

router.get(
    '/discipline',
    authenticateToken,
    requireRoles(STUDENT),
    requireStudent,
    async (req, res) => {

        try {

            const studentId = req.user.student_id;

            const { data, error } = await supabase
                .from('discipline_records')
                .select('discipline_id, incident_date, crime, description, punishment, duration, hearing_officer, notes, status, created_at')
                .eq('student_id', studentId)
                .order('incident_date', { ascending: false });

            if (error) throw error;

            return res.json(data || []);

        } catch (error) {
            console.error('STUDENT PORTAL /discipline ERROR:', error);
            return res.status(500).json({
                message: 'Failed to load discipline records.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET /notices — Announcements targeted to this student
   Rules (all must be true):
     - is_active
     - expires_at is null OR > now()
     - audience matches:
         'all'            -> always visible
         'primary'        -> student's section is Nursery/Primary
         'secondary'      -> student's section is JSS/SSS/Secondary
         'class'          -> student's class_id matches
   ========================================================= */

router.get(
    '/notices',
    authenticateToken,
    requireRoles(STUDENT),
    requireStudent,
    async (req, res) => {

        try {

            const studentId = req.user.student_id;

            const { data: me } = await supabase
                .from('students')
                .select(`
                    class_id,
                    school_section,
                    classes (
                        school_section
                    )
                `)
                .eq('student_id', studentId)
                .maybeSingle();

            const classId = me?.class_id || null;
            const section =
                me?.classes?.school_section ||
                me?.school_section ||
                null;

            const nowIso = new Date().toISOString();

            const { data, error } = await supabase
                .from('announcements')
                .select('announcement_id, title, body, audience, school_section, class_id, posted_at, expires_at')
                .eq('is_active', true)
                .order('posted_at', { ascending: false });

            if (error) throw error;

            const normalizedSection =
                String(section || '').trim().toLowerCase();

            const visible = (data || []).filter(n => {

                if (n.expires_at && n.expires_at <= nowIso) return false;

                const audience = String(n.audience || '').toLowerCase();

                if (audience === 'all') return true;

                if (audience === 'primary') {
                    return ['nursery', 'primary'].includes(normalizedSection);
                }

                if (audience === 'secondary') {
                    return ['jss', 'sss', 'secondary'].includes(normalizedSection);
                }

                if (audience === 'class') {
                    return classId && Number(n.class_id) === Number(classId);
                }

                return false;
            });

            return res.json(visible);

        } catch (error) {
            console.error('STUDENT PORTAL /notices ERROR:', error);
            return res.status(500).json({
                message: 'Failed to load notices.',
                error: error.message
            });
        }
    }
);


/* =========================================================
   GET /fees — Own fee balance + payment history
   ========================================================= */

router.get(
    '/fees',
    authenticateToken,
    requireRoles(STUDENT),
    requireStudent,
    async (req, res) => {

        try {

            const studentId = req.user.student_id;

            /* ---------------------------------------------------
               Current academic year + all years for the filter
            --------------------------------------------------- */

            const { data: currentYear } = await supabase
                .from('academic_years')
                .select('academic_year_id, year_name, is_current')
                .eq('is_current', true)
                .maybeSingle();

            const { data: allYears } = await supabase
                .from('academic_years')
                .select('academic_year_id, year_name, is_current')
                .order('academic_year_id', { ascending: false });

            /* ---------------------------------------------------
               Load ALL fee balances + payments for this student.
               Year filtering happens on the frontend so the
               dropdown doesn't need a server round-trip.
            --------------------------------------------------- */

            const { data: balances, error: balErr } = await supabase
                .from('student_fee_balances')
                .select('student_fee_id, fee_name, academic_year, term_name, amount_due, total_paid, balance, payment_status')
                .eq('student_id', studentId);

            if (balErr) throw balErr;

            const { data: payments, error: payErr } = await supabase
                .from('payments')
                .select('payment_id, amount_paid, payment_date, payment_method, payment_slip_number, bank_reference, purpose, notes, approval_status, academic_year_id')
                .eq('student_id', studentId)
                .order('payment_date', { ascending: false });

            if (payErr) throw payErr;

            return res.json({
                current_academic_year: currentYear?.year_name || null,
                current_academic_year_id: currentYear?.academic_year_id || null,
                all_academic_years: allYears || [],
                balances: balances || [],
                payments: payments || []
            });

        } catch (error) {
            console.error('STUDENT PORTAL /fees ERROR:', error);
            return res.status(500).json({
                message: 'Failed to load fees.',
                error: error.message
            });
        }
    }
);


module.exports = router;