const express = require('express');
const router = express.Router();
const supabase = require('../Config/db');
const {
    authenticateToken,
    requireRoles,
    ROLE_IDS
} = require('../middleware/authMiddleware');

// ============================================================
// ROLE CONSTANTS
// ============================================================

const PROPRIETOR                 = ROLE_IDS.PROPRIETOR;
const ADMINISTRATOR              = ROLE_IDS.ADMINISTRATOR;
const TEACHER                    = ROLE_IDS.TEACHER;
const MANAGER                    = ROLE_IDS.MANAGER;
const ADMIN_OFFICER              = ROLE_IDS.ADMIN_OFFICER;
const ACADEMIC_AFFAIRS_OFFICER   = ROLE_IDS.ACADEMIC_AFFAIRS_OFFICER;
const EXAMINATION_OFFICER        = ROLE_IDS.EXAMINATION_OFFICER;

// Read access to results pages
const VIEW_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    MANAGER,
    TEACHER,
    ADMIN_OFFICER
];

// Write access (save grades)
const WRITE_ROLES = [
    PROPRIETOR,
    ADMINISTRATOR,
    TEACHER,
    MANAGER,
    ADMIN_OFFICER
];

// ============================================================
// ROLE HELPERS (from JWT)
// ============================================================

function isExaminationOfficer(user) {
    return user?.is_exam_officer === true;
}

function isAcademicAffairsOfficer(user) {
    return Number(user?.secondary_role_id) === ACADEMIC_AFFAIRS_OFFICER;
}

function getAAOSector(user) {
    return String(user?.aao_sector || '')
        .trim()
        .toLowerCase();
}

// ============================================================
// SECTOR HELPERS
// ============================================================

function getPrimarySections() {
    return ['Nursery', 'Primary'];
}

function getSecondarySections() {
    return ['JSS', 'SSS', 'Secondary'];
}

function getSectionsForSector(sector) {
    const s = String(sector || '').trim().toLowerCase();
    if (s === 'primary')   return getPrimarySections();
    if (s === 'secondary') return getSecondarySections();
    return [];
}

function normalizeSection(section) {
    return String(section || '').trim().toLowerCase();
}

function sectionBelongsToSector(schoolSection, sector) {
    const normalized = normalizeSection(schoolSection);
    const list = getSectionsForSector(sector);
    return list.some(s => normalizeSection(s) === normalized);
}

// ============================================================
// HELPERS — class master lookups
// ============================================================

async function getClassesForTeacher(teacherId) {
    if (!teacherId) return [];

    const classMap = new Map();

    const { data: primary } = await supabase
        .from('primary_class_teachers')
        .select(`
            class_id,
            classes!class_id ( class_id, class_name, arm, school_section, academic_year_id )
        `)
        .eq('teacher_id', teacherId);

    (primary || []).forEach(row => {
        if (row.classes) classMap.set(row.classes.class_id, row.classes);
    });

    const { data: secondary } = await supabase
        .from('secondary_class_masters')
        .select(`
            class_id,
            classes!class_id ( class_id, class_name, arm, school_section, academic_year_id )
        `)
        .eq('teacher_id', teacherId);

    (secondary || []).forEach(row => {
        if (row.classes) classMap.set(row.classes.class_id, row.classes);
    });

    return Array.from(classMap.values());
}

async function isClassMasterOf(teacherId, classId) {
    if (!teacherId || !classId) return false;
    const list = await getClassesForTeacher(teacherId);
    return list.some(c => Number(c.class_id) === Number(classId));
}

// ============================================================
// AAO SECTOR ENFORCEMENT
// ------------------------------------------------------------
// If the caller is an Academic Affairs Officer, restrict access
// to classes in their sector. Returns true if the caller is not
// an AAO (no restriction).
// ============================================================

async function aaoCanAccessClass(user, classId) {
    if (!isAcademicAffairsOfficer(user)) {
        return true;  // not an AAO, no restriction from this helper
    }

    const { data: classRow } = await supabase
        .from('classes')
        .select('school_section')
        .eq('class_id', classId)
        .maybeSingle();

    if (!classRow) return false;

    const aaoSector = getAAOSector(user);
    return sectionBelongsToSector(classRow.school_section, aaoSector);
}

// ============================================================
// 1. GET TEACHER'S ASSIGNED CLASSES & SUBJECTS
// ============================================================

router.get('/my-assignments', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;
        if (!teacherId) return res.status(404).json({ message: 'Teacher profile not found' });

        const { data, error } = await supabase
            .from('class_subjects')
            .select('*, classes!class_id ( class_id, class_name, arm ), subjects!subject_id ( subject_id, subject_name )')
            .eq('teacher_id', teacherId);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('MY ASSIGNMENTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load assignments' });
    }
});

// ============================================================
// 2. GET CLASS MASTER'S CLASSES (may be more than one)
// ============================================================

router.get('/my-classes', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const teacherId = req.user.teacher_id;
        if (!teacherId) return res.status(404).json({ message: 'Teacher profile not found' });
        const list = await getClassesForTeacher(teacherId);
        res.json(list);
    } catch (error) {
        console.error('MY CLASSES ERROR:', error);
        res.status(500).json({ message: 'Failed to load classes' });
    }
});

// ============================================================
// 3. GET CLASS STUDENTS
// ============================================================

router.get('/students/:classId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        if (!(await aaoCanAccessClass(req.user, req.params.classId))) {
            return res.status(403).json({ message: 'Access denied. Outside your sector.' });
        }

        const { data, error } = await supabase
            .from('students')
            .select('student_id, first_name, last_name, gender, date_of_birth, photo_url')
            .eq('class_id', req.params.classId)
            .eq('student_status', 'Active')
            .order('last_name');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('STUDENTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load students' });
    }
});

// ============================================================
// 4. GET ALL SUBJECTS FOR A CLASS
// ============================================================

router.get('/subjects/:classId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        if (!(await aaoCanAccessClass(req.user, req.params.classId))) {
            return res.status(403).json({ message: 'Access denied. Outside your sector.' });
        }

        const { data, error } = await supabase
            .from('class_subjects')
            .select('*, subjects!subject_id ( subject_id, subject_name )')
            .eq('class_id', req.params.classId);
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('SUBJECTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load subjects' });
    }
});

// ============================================================
// 5. SAVE GRADES
//
// Saves grade rows as 'draft'. If a row is already 'approved'
// or 'submitted', it is not silently overwritten — the teacher
// must have it rejected first.
// ============================================================

router.post('/save', authenticateToken, requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
        const { class_id, subject_id, term, records } = req.body;

        if (!class_id || !subject_id || !term || !Array.isArray(records)) {
            return res.status(400).json({ message: 'Invalid data' });
        }

        const user = req.user;
        const isClassMaster = await isClassMasterOf(user.teacher_id, class_id);

        const { data: classRow } = await supabase
            .from('classes')
            .select('school_section')
            .eq('class_id', class_id)
            .maybeSingle();

        const classSection = String(classRow?.school_section || '').trim().toLowerCase();
        const isPrimaryClass = ['nursery', 'primary'].includes(classSection);

        // ---------------------------------------------------------
        // Existing rows for this student/subject/term — we need to
        // know their status to decide how to write.
        // ---------------------------------------------------------
        const studentIds = records.map(r => r.student_id);

        const { data: existingRows } = await supabase
            .from('results')
            .select('student_id, status')
            .eq('class_id', class_id)
            .eq('subject_id', subject_id)
            .eq('term', term)
            .in('student_id', studentIds);

        const existingStatus = new Map(
            (existingRows || []).map(r => [Number(r.student_id), r.status])
        );

        // ---------------------------------------------------------
        // PRIMARY: any teacher assigned to the class saves directly.
        // SECONDARY: only class masters save directly; other teachers
        //            go to result_edit_requests for Manager approval.
        //
        // (unchanged — kept for backward compatibility with the
        //  existing result_edit_requests workflow)
        // ---------------------------------------------------------

        if (!isPrimaryClass && !isClassMaster && user.role_id === ROLE_IDS.TEACHER) {
            const approvalRequests = records.map(r => ({
                teacher_id: user.teacher_id,
                class_id: class_id,
                subject_id: subject_id,
                term: term,
                student_id: r.student_id,
                test_score: r.test_score || 0,
                exam_score: r.exam_score || 0
            }));

            const { error: reqError } = await supabase
                .from('result_edit_requests')
                .insert(approvalRequests);

            if (reqError) throw reqError;
            return res.json({ message: 'Grade changes sent for Manager approval.' });
        }

        // ---------------------------------------------------------
        // Direct write. Preserve any 'submitted' or 'approved' row
        // (teacher must submit-for-rejection to edit those).
        // Everything else goes in as 'draft'.
        // ---------------------------------------------------------
        const insertData = records
            .filter(r => {
                const current = existingStatus.get(Number(r.student_id));
                return current !== 'submitted' && current !== 'approved';
            })
            .map(r => ({
                student_id: r.student_id,
                class_id: class_id,
                subject_id: subject_id,
                term: term,
                test_score: r.test_score || 0,
                exam_score: r.exam_score || 0,
                total_score: (r.test_score || 0) + (r.exam_score || 0),
                academic_year_id: 1,
                status: 'draft',
                rejection_reason: null
            }));

        if (insertData.length === 0) {
            return res.json({
                message: 'All selected rows are submitted or approved and cannot be edited.'
            });
        }

        const { error } = await supabase
            .from('results')
            .upsert(insertData, { onConflict: 'student_id, subject_id, term' });

        if (error) throw error;
        res.json({ message: 'Grades saved as draft.' });
    } catch (error) {
        console.error('SAVE RESULT ERROR:', error);
        res.status(500).json({ message: 'Failed to save grades' });
    }
});

// ============================================================
// 5b. SUBMIT GRADES TO EXAMINATION OFFICER
//
// Teacher (or class master or higher) submits a whole
// subject+class+term for EO review. All draft rows for that
// subject/class/term become 'submitted'.
// ============================================================

router.post('/submit', authenticateToken, requireRoles(...WRITE_ROLES), async (req, res) => {
    try {
        const { class_id, subject_id, term } = req.body;

        if (!class_id || !subject_id || !term) {
            return res.status(400).json({ message: 'class_id, subject_id, term are required' });
        }

        if (!(await aaoCanAccessClass(req.user, class_id))) {
            return res.status(403).json({ message: 'Access denied. Outside your sector.' });
        }

        const { data: draftRows, error: fetchError } = await supabase
            .from('results')
            .select('result_id')
            .eq('class_id', class_id)
            .eq('subject_id', subject_id)
            .eq('term', term)
            .eq('status', 'draft');

        if (fetchError) throw fetchError;

        if (!draftRows || draftRows.length === 0) {
            return res.status(400).json({
                message: 'No draft grades found for this subject and term.'
            });
        }

        const { error } = await supabase
            .from('results')
            .update({
                status: 'submitted',
                submitted_by: req.user.user_id,
                submitted_at: new Date().toISOString(),
                rejection_reason: null
            })
            .eq('class_id', class_id)
            .eq('subject_id', subject_id)
            .eq('term', term)
            .eq('status', 'draft');

        if (error) throw error;

        res.json({
            message: `Submitted ${draftRows.length} grade(s) to the Examination Officer.`,
            count: draftRows.length
        });
    } catch (error) {
        console.error('SUBMIT RESULT ERROR:', error);
        res.status(500).json({ message: 'Failed to submit grades' });
    }
});

// ============================================================
// 5c. GET THE EXAMINATION OFFICER'S REVIEW QUEUE
// ============================================================

router.get('/submitted', authenticateToken, async (req, res) => {
    try {
        if (!isExaminationOfficer(req.user)) {
            return res.status(403).json({ message: 'Only the Examination Officer can view the approval queue.' });
        }

        const { data, error } = await supabase
            .from('results')
            .select(`
                result_id,
                student_id,
                class_id,
                subject_id,
                term,
                test_score,
                exam_score,
                total_score,
                submitted_at,
                classes!class_id ( class_id, class_name, arm, school_section ),
                subjects!subject_id ( subject_id, subject_name ),
                students!student_id ( student_id, first_name, middle_name, last_name, admission_number )
            `)
            .eq('status', 'submitted')
            .order('submitted_at', { ascending: true });

        if (error) throw error;

        // Group by (class_id, subject_id, term) so the frontend
        // shows one row per submission batch.
        const grouped = new Map();

        (data || []).forEach(row => {
            const key = `${row.class_id}|${row.subject_id}|${row.term}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    class_id: row.class_id,
                    class_name: row.classes?.class_name || null,
                    arm: row.classes?.arm || null,
                    school_section: row.classes?.school_section || null,
                    subject_id: row.subject_id,
                    subject_name: row.subjects?.subject_name || null,
                    term: row.term,
                    submitted_at: row.submitted_at,
                    student_count: 0,
                    students: []
                });
            }
            const group = grouped.get(key);
            group.student_count += 1;
            group.students.push({
                result_id: row.result_id,
                student_id: row.student_id,
                admission_number: row.students?.admission_number || null,
                first_name: row.students?.first_name || null,
                middle_name: row.students?.middle_name || null,
                last_name: row.students?.last_name || null,
                test_score: row.test_score,
                exam_score: row.exam_score,
                total_score: row.total_score
            });
        });

        res.json(Array.from(grouped.values()));
    } catch (error) {
        console.error('SUBMITTED QUEUE ERROR:', error);
        res.status(500).json({ message: 'Failed to load approval queue' });
    }
});

// ============================================================
// 5d. EXAMINATION OFFICER — APPROVE
// ============================================================

router.put('/approve/:classId/:subjectId/:term', authenticateToken, async (req, res) => {
    try {
        if (!isExaminationOfficer(req.user)) {
            return res.status(403).json({ message: 'Only the Examination Officer can approve grades.' });
        }

        const { classId, subjectId, term } = req.params;

        const { data: rows, error: fetchError } = await supabase
            .from('results')
            .select('result_id')
            .eq('class_id', classId)
            .eq('subject_id', subjectId)
            .eq('term', term)
            .eq('status', 'submitted');

        if (fetchError) throw fetchError;

        if (!rows || rows.length === 0) {
            return res.status(400).json({ message: 'No submitted grades found for this subject and term.' });
        }

        const { error } = await supabase
            .from('results')
            .update({
                status: 'approved',
                approved_by: req.user.user_id,
                approved_at: new Date().toISOString(),
                rejection_reason: null
            })
            .eq('class_id', classId)
            .eq('subject_id', subjectId)
            .eq('term', term)
            .eq('status', 'submitted');

        if (error) throw error;

        res.json({
            message: `Approved ${rows.length} grade(s).`,
            count: rows.length
        });
    } catch (error) {
        console.error('APPROVE GRADES ERROR:', error);
        res.status(500).json({ message: 'Failed to approve grades' });
    }
});

// ============================================================
// 5e. EXAMINATION OFFICER — REJECT
// ============================================================

router.put('/reject/:classId/:subjectId/:term', authenticateToken, async (req, res) => {
    try {
        if (!isExaminationOfficer(req.user)) {
            return res.status(403).json({ message: 'Only the Examination Officer can reject grades.' });
        }

        const { classId, subjectId, term } = req.params;
        const { reason } = req.body;

        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ message: 'A rejection reason is required.' });
        }

        const { data: rows, error: fetchError } = await supabase
            .from('results')
            .select('result_id')
            .eq('class_id', classId)
            .eq('subject_id', subjectId)
            .eq('term', term)
            .eq('status', 'submitted');

        if (fetchError) throw fetchError;

        if (!rows || rows.length === 0) {
            return res.status(400).json({ message: 'No submitted grades found for this subject and term.' });
        }

        const { error } = await supabase
            .from('results')
            .update({
                status: 'rejected',
                rejection_reason: String(reason).trim(),
                approved_by: req.user.user_id,
                approved_at: new Date().toISOString()
            })
            .eq('class_id', classId)
            .eq('subject_id', subjectId)
            .eq('term', term)
            .eq('status', 'submitted');

        if (error) throw error;

        res.json({
            message: `Rejected ${rows.length} grade(s).`,
            count: rows.length
        });
    } catch (error) {
        console.error('REJECT GRADES ERROR:', error);
        res.status(500).json({ message: 'Failed to reject grades' });
    }
});

// ============================================================
// 6. GET RESULTS FOR SUBJECT
// ============================================================

router.get('/subject/:classId/:subjectId/:term', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        if (!(await aaoCanAccessClass(req.user, req.params.classId))) {
            return res.status(403).json({ message: 'Access denied. Outside your sector.' });
        }

        const { data, error } = await supabase
            .from('results')
            .select('*')
            .eq('class_id', req.params.classId)
            .eq('subject_id', req.params.subjectId)
            .eq('term', req.params.term);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('SUBJECT RESULTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load subject results' });
    }
});

// ============================================================
// 7. GET FULL CLASS RESULTS
// ============================================================

router.get('/all/:classId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        if (!(await aaoCanAccessClass(req.user, req.params.classId))) {
            return res.status(403).json({ message: 'Access denied. Outside your sector.' });
        }

        const { data, error } = await supabase
            .from('results')
            .select('*')
            .eq('class_id', req.params.classId)
            .order('term')
            .order('subject_id');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('ALL RESULTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load results' });
    }
});

// ============================================================
// 8. GET SINGLE STUDENT DETAILS
// ============================================================

router.get('/student/:studentId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('students')
            .select('*, classes!class_id ( class_id, class_name, arm, school_section )')
            .eq('student_id', req.params.studentId)
            .single();

        if (error) throw error;

        if (isAcademicAffairsOfficer(req.user)) {
            const classSection = data?.classes?.school_section || data?.school_section || '';
            if (!sectionBelongsToSector(classSection, getAAOSector(req.user))) {
                return res.status(403).json({ message: 'Access denied. Outside your sector.' });
            }
        }

        res.json(data);
    } catch (error) {
        console.error('STUDENT DETAILS ERROR:', error);
        res.status(500).json({ message: 'Failed to load student details' });
    }
});

// ============================================================
// 9. GET PENDING EDIT REQUESTS
// ============================================================

router.get('/pending-edits/:sector', authenticateToken, requireRoles(MANAGER, ADMINISTRATOR), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('result_edit_requests')
            .select('*')
            .eq('status', 'Pending');

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('PENDING EDITS ERROR:', error);
        res.status(500).json({ message: 'Failed to load pending edits' });
    }
});

// ============================================================
// 10. APPROVE / REJECT EDIT REQUESTS
// ============================================================

router.put('/review-edit/:requestId', authenticateToken, requireRoles(MANAGER, ADMINISTRATOR), async (req, res) => {
    try {
        const { status } = req.body;
        const requestId = req.params.requestId;

        const { data: requestData } = await supabase
            .from('result_edit_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (!requestData) return res.status(404).json({ message: 'Request not found' });

        if (status === 'Approved') {
            await supabase
                .from('results')
                .upsert({
                    student_id: requestData.student_id,
                    class_id: requestData.class_id,
                    subject_id: requestData.subject_id,
                    term: requestData.term,
                    test_score: requestData.test_score,
                    exam_score: requestData.exam_score,
                    total_score: requestData.test_score + requestData.exam_score,
                    academic_year_id: 1,
                    status: 'draft',
                    rejection_reason: null
                }, { onConflict: 'student_id, subject_id, term' });
        }

        await supabase
            .from('result_edit_requests')
            .update({
                status: status,
                reviewed_by: req.user.user_id,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', requestId);

        res.json({ message: 'Request ' + status });
    } catch (error) {
        console.error('REVIEW EDIT ERROR:', error);
        res.status(500).json({ message: 'Failed to review request' });
    }
});

// ============================================================
// 11. GET FULL CLASS RESULTS FOR ONE TERM
// ------------------------------------------------------------
// Used for report-card position calculations. Only 'approved'
// grades count toward totals and positions.
// ============================================================

router.get('/class-term/:classId/:term', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const classId = Number(req.params.classId);
        const term = Number(req.params.term);

        if (!Number.isInteger(classId) || !Number.isInteger(term)) {
            return res.status(400).json({ message: 'Invalid class or term' });
        }

        if (!(await aaoCanAccessClass(req.user, classId))) {
            return res.status(403).json({ message: 'Access denied. Outside your sector.' });
        }

        const { data, error } = await supabase
            .from('results')
            .select('student_id, subject_id, test_score, exam_score, total_score')
            .eq('class_id', classId)
            .eq('term', term)
            .eq('status', 'approved');

        if (error) throw error;

        res.json(data || []);
    } catch (error) {
        console.error('CLASS TERM RESULTS ERROR:', error);
        res.status(500).json({ message: 'Failed to load class results' });
    }
});

// ============================================================
// 12. GET FULL REPORT FOR A STUDENT
// ------------------------------------------------------------
// Only 'approved' grades appear on report cards.
// ============================================================

router.get('/report/:studentId', authenticateToken, requireRoles(...VIEW_ROLES), async (req, res) => {
    try {
        const studentId = Number(req.params.studentId);
        if (!Number.isInteger(studentId)) {
            return res.status(400).json({ message: 'Invalid student ID' });
        }

        const { data: student, error: stuErr } = await supabase
            .from('students')
            .select('student_id, admission_number, first_name, middle_name, last_name, gender, date_of_birth, photo_url, class_id, school_section')
            .eq('student_id', studentId)
            .single();

        if (stuErr || !student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        if (isAcademicAffairsOfficer(req.user)) {
            const section = student.school_section || '';
            if (!sectionBelongsToSector(section, getAAOSector(req.user))) {
                return res.status(403).json({ message: 'Access denied. Outside your sector.' });
            }
        }

        const classId = student.class_id;

        const { data: classData } = await supabase
            .from('classes')
            .select('class_id, class_name, arm, school_section, academic_year_id')
            .eq('class_id', classId)
            .maybeSingle();

        const { data: studentResults, error: resErr } = await supabase
            .from('results')
            .select('subject_id, term, test_score, exam_score, total_score, subjects!subject_id ( subject_id, subject_name )')
            .eq('student_id', studentId)
            .eq('status', 'approved')
            .order('term');

        if (resErr) throw resErr;

        const { data: classResults, error: crErr } = await supabase
            .from('results')
            .select('student_id, subject_id, term, total_score')
            .eq('class_id', classId)
            .eq('status', 'approved');

        if (crErr) throw crErr;

        const { data: classmates } = await supabase
            .from('students')
            .select('student_id')
            .eq('class_id', classId)
            .eq('student_status', 'Active');

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
                    .filter(cr => Number(cr.term) === termNumber && Number(cr.subject_id) === Number(sr.subject_id))
                    .map(cr => ({ student_id: cr.student_id, total: cr.total_score || 0 }))
                    .sort((a, b) => b.total - a.total);

                const pos = allInSubject.findIndex(x => Number(x.student_id) === studentId) + 1;
                sr.position = pos > 0 ? pos : null;
                sr.class_size = allInSubject.length;
            });

            const studentTotal = subjectRows.reduce((sum, r) => sum + (r.total_score || 0), 0);
            const studentAverage = subjectRows.length ? (studentTotal / subjectRows.length) : 0;

            const totalByStudent = new Map();
            (classResults || [])
                .filter(cr => Number(cr.term) === termNumber)
                .forEach(cr => {
                    const id = Number(cr.student_id);
                    totalByStudent.set(id, (totalByStudent.get(id) || 0) + (cr.total_score || 0));
                });

            const ranked = Array.from(totalByStudent.entries())
                .map(([id, total]) => ({ student_id: id, total }))
                .sort((a, b) => b.total - a.total);

            const classPosition = ranked.findIndex(x => Number(x.student_id) === studentId) + 1;

            let presentCount = 0, absentCount = 0;
            if (termRow) {
                (attendanceRows || []).forEach(a => {
                    if (a.attendance_date >= termRow.start_date && a.attendance_date <= termRow.end_date) {
                        if (a.status === 'Present') presentCount++;
                        else if (a.status === 'Absent') absentCount++;
                    }
                });
            }
            const totalDays = presentCount + absentCount;
            const attendancePct = totalDays ? Math.round((presentCount / totalDays) * 100) : 0;

            const termCommentRow = (termComments || []).find(tc => Number(tc.term_id) === termNumber);

            return {
                term_id: termNumber,
                term_name: termRow?.term_name || `Term ${termNumber}`,
                term_start: termRow?.start_date || null,
                term_end: termRow?.end_date || null,
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

        const report = {
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
        };

        res.json(report);
    } catch (error) {
        console.error('REPORT ERROR:', error);
        res.status(500).json({ message: 'Failed to load report: ' + error.message });
    }
});

// ============================================================
// 13. SAVE TERM COMMENT
// ============================================================

router.put('/term-comment', authenticateToken, requireRoles(TEACHER, ADMINISTRATOR, ADMIN_OFFICER), async (req, res) => {
    try {
        const { student_id, term_id, comment } = req.body;

        if (!student_id || !term_id) {
            return res.status(400).json({ message: 'student_id and term_id are required' });
        }

        const user = req.user;

        if (user.role_id === ROLE_IDS.TEACHER) {
            const { data: studentRow } = await supabase
                .from('students')
                .select('class_id')
                .eq('student_id', student_id)
                .maybeSingle();

            if (!studentRow) {
                return res.status(404).json({ message: 'Student not found' });
            }

            const isMaster = await isClassMasterOf(user.teacher_id, studentRow.class_id);
            if (!isMaster) {
                return res.status(403).json({ message: 'Only the class master can write the term comment for this student.' });
            }
        }

        const { error } = await supabase
            .from('student_term_comments')
            .upsert({
                student_id: student_id,
                term_id: term_id,
                comment: comment || '',
                written_by: user.user_id,
                updated_at: new Date().toISOString()
            }, { onConflict: 'student_id, term_id' });

        if (error) throw error;

        res.json({ message: 'Term comment saved' });
    } catch (error) {
        console.error('TERM COMMENT ERROR:', error);
        res.status(500).json({ message: 'Failed to save term comment' });
    }
});

// ============================================================
// 14. SAVE YEAR COMMENT
// ============================================================

router.put('/year-comment', authenticateToken, requireRoles(MANAGER, ADMINISTRATOR, ADMIN_OFFICER), async (req, res) => {
    try {
        const { student_id, academic_year_id, comment } = req.body;

        if (!student_id || !academic_year_id) {
            return res.status(400).json({ message: 'student_id and academic_year_id are required' });
        }

        const { error } = await supabase
            .from('student_year_comments')
            .upsert({
                student_id: student_id,
                academic_year_id: academic_year_id,
                comment: comment || '',
                written_by: req.user.user_id,
                updated_at: new Date().toISOString()
            }, { onConflict: 'student_id, academic_year_id' });

        if (error) throw error;

        res.json({ message: 'Year comment saved' });
    } catch (error) {
        console.error('YEAR COMMENT ERROR:', error);
        res.status(500).json({ message: 'Failed to save year comment' });
    }
});

module.exports = router;